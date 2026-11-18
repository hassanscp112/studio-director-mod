import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// Auto model end to end (stage 4): the hooks here stand for the engine and the
// app beneath the mod. The classifier answers from the world (or never), every
// spawn and model request that reaches the bottom is kept, and the report is
// read back from the written files.
const ROOT = 'E:/Godot Games/scrap-shift'
const STUDIO = `${ROOT}/docs/studio`
const NOW = Date.parse('2026-11-15T10:00:00Z')
const SELF = JSON.stringify({ sessionId: 'local_w', title: 'G5 stage 5: sounds', model: 'claude-opus-5-5', effort: 'high' })
const USAGE = JSON.stringify({ plan: { status: 'not_applicable' }, context: { tokensUsed: 20000, percentUsed: 2 } })

type Spawned = { type: string; model: string | undefined }
type World = {
  files: Record<string, string>
  messages: Array<{ role: string }>
  /** The classifier's answer; 'slow' never answers, 'fail' rejects, 'late:<label>' answers on release(). */
  label: string
  release?: () => void
  classified: Array<{ text: string; model: string | undefined }>
  spawned: Spawned[]
  steps: Array<{ model: string; effort: unknown }>
  ran: string[]
}

function engine(on: On, w: World) {
  mock.env(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'cli-w' }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.turns', () => ({ value: 1 }))
  on('session.surfaces', () => ({ value: [] }))
  on('session.messages', () => ({ value: w.messages as never }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('mcp.call', (_, e) => {
    const text = e.tool === 'get_session' ? SELF : e.tool === 'get_usage' ? USAGE : e.tool === 'list_sessions' ? '[]' : '{}'
    return { value: { isError: false, content: [{ type: 'text' as const, text }] } }
  })
  on('fs.write', (_, e) => {
    w.files[e.path.split('\\').join('/')] = e.text
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    const text = w.files[e.path.split('\\').join('/')]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.list', (_, e) => {
    const dir = `${e.path.split('\\').join('/').replace(/\/$/, '')}/`
    const names = Object.keys(w.files).filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/'))
    return { value: names.map(p => ({ name: p.slice(dir.length), kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false })) }
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[1] === 'rev-parse' && argv.includes('--git-common-dir')) return ok(`${ROOT}/.git\n`)
    if (argv[1] === 'log' && argv.includes('--oneline')) return ok('ee536f9 Studio Director stage 3\n')
    return ok('')
  })
  on('model.classify', (_, e) => {
    w.classified.push({ text: e.text, model: e.options?.model })
    if (w.label === 'slow') return new Promise(() => undefined) as never
    const late = /^late:(.+)$/.exec(w.label)
    if (late) return new Promise(resolve => (w.release = () => resolve({ value: late[1] }))) as never
    if (w.label === 'fail') throw new Error('api-error 529')
    return { value: w.label }
  })
  on('agent.spawn', (_, e) => {
    w.spawned.push({ type: e.subagentType, model: e.model })
    return { model: e.model ?? e.parentModel, agentId: `a${w.spawned.length}` }
  })
  on('turn.step', async function* (_, e) {
    w.steps.push({ model: e.model, effort: e.effort })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('prompt.compose', () => ({ sections: [] }))
  on('ui.open', () => ({ value: { isPlaced: false as const, reason: 'no-surface' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', (_, e) => {
    w.ran.push(String((e as unknown as { tool: string }).tool))
    return { result: { answers: {} } } as never
  })
}

const world = (label = 'chore'): World => ({ files: {}, messages: [], label, classified: [], spawned: [], steps: [], ran: [] })
const typed = (text: string, kind = 'sdk') => ({ text, origin: { kind }, wait: false }) as never
const spawnOf = (over: Record<string, unknown>) =>
  ({
    tool_use_id: 'tu1', prompt: '', description: 'task', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5', background: false, fork: false, ...over,
  }) as never
const report = (w: World) => JSON.parse(w.files[`${STUDIO}/sessions/local_w.json`] ?? '{}') as {
  schema?: number
  turnClass?: string | null
  classMs?: number | null
  routings?: Array<{ agentType: string; asked: string | null; sent: string | null; ranOn: string; why: string; isCapped: boolean }>
  effort?: string
}
const why = (r: unknown): string => String((r as { deny?: unknown }).deny ?? '')

test('the turn layer routes a chore subagent to Haiku and keeps a Blender one on Opus, by full id', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w = world('design-3d')
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)

  await $.prompt.submit(typed('Model the crate in Blender and wire its sounds'))
  await clock.advance(50)
  // the prompt's text alone, on Haiku by full id
  expect(w.classified).toEqual([{ text: 'Model the crate in Blender and wire its sounds', model: 'claude-haiku-5-5' }])
  expect(report(w).turnClass).toBe('design-3d')

  const explore = await $.agent.spawn(spawnOf({ subagentType: 'Explore', prompt: 'Find the crate scenes under scenes/' }))
  const blender = await $.agent.spawn(spawnOf({ prompt: 'In Blender, model the crate and export the GLB', model: 'haiku' }))
  expect(w.spawned).toEqual([
    { type: 'Explore', model: 'claude-haiku-5-5' },
    { type: 'general-purpose', model: 'claude-opus-5-5' },
  ])
  expect((explore as { model: string }).model).toBe('claude-haiku-5-5')
  expect((blender as { model: string }).model).toBe('claude-opus-5-5')
  await clock.advance(50)
  const r = report(w)
  expect(r.schema).toBe(2)
  expect(r.classMs).toBe(0) // the mock answers at once
  expect(r.routings?.map(x => [x.agentType, x.asked, x.sent, x.ranOn])).toEqual([
    ['Explore', null, 'claude-haiku-5-5', 'claude-haiku-5-5'],
    ['general-purpose', 'haiku', 'claude-opus-5-5', 'claude-opus-5-5'],
  ])
  expect(r.routings?.[1]?.why).toBe('asked haiku → claude-haiku-5-5; turn: design-3d')

  // a fork is left alone (it inherits) and still recorded
  await $.agent.spawn(spawnOf({ fork: true, prompt: 'Blender' }))
  expect(w.spawned[2]?.model).toBe(undefined)

  // the board and /studio me show it
  const me = (await $.command.run({ command: 'studio', args: 'me', origin: { kind: 'composer' } } as never)) as { text: string }
  expect(me.text).toContain('last turn class: design-3d')
  expect(me.text).toContain('Explore: asked (none) → sent claude-haiku-5-5 → ran on claude-haiku-5-5 · turn: design-3d; down: read-only (Explore)')
})

test("the chat's own model and effort pass through every request untouched (S9)", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w = world('hard')
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  await $.prompt.submit(typed('Fix the rpc desync root cause'))
  await clock.advance(50)
  await $.turn.start({ text: 'Fix the rpc desync root cause', turnId: 't1' })
  for (const [i, effort] of (['high', 'high', 'low'] as const).entries()) {
    const stream = $.turn.step({ turnId: 't1', index: i, model: 'claude-opus-5-5', effort, messageCount: 3 + i })
    for await (const _ of stream) void _
  }
  const sub = $.turn.step({ turnId: 't1', index: 0, model: 'claude-haiku-5-5', effort: 'medium', messageCount: 1, agentId: 'a1' })
  for await (const _ of sub) void _
  expect(w.steps).toEqual([
    { model: 'claude-opus-5-5', effort: 'high' },
    { model: 'claude-opus-5-5', effort: 'high' },
    { model: 'claude-opus-5-5', effort: 'low' },
    { model: 'claude-haiku-5-5', effort: 'medium' },
  ])
})

test('a classifier that fails or is late leaves no class; the prompt never waits on it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w = world('slow')
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  const out = (await $.prompt.submit(typed('Write the patch for the lobby'))) as { text: string }
  expect(out.text).toBe('Write the patch for the lobby') // went on before any class
  await clock.advance(900)
  expect(report(w).turnClass).toBe(null)
  // the spawn waits at most 800 ms for the class, then goes on the rules alone
  // (no hunch raises the asked Sonnet)
  const spawned = $.agent.spawn(spawnOf({ prompt: 'Write the patch for the lobby', model: 'sonnet' }))
  await clock.advance(700)
  expect(w.spawned.length).toBe(0)
  await clock.advance(200)
  await spawned
  expect(w.spawned[0]?.model).toBe('claude-sonnet-5-5')
  await clock.advance(10_000) // the classifier's own cap passes: still no class
  expect(report(w).turnClass).toBe(null)
  expect(report(w).classMs).toBe(null)

  w.label = 'fail'
  await $.prompt.submit(typed('Review the rpc code'))
  await clock.advance(50)
  expect(report(w).turnClass).toBe(null)
  w.label = 'poetry' // names no class
  await $.prompt.submit(typed('hello'))
  await clock.advance(50)
  expect(report(w).turnClass).toBe(null)
  // slash commands and engine notices aren't classified
  const before = w.classified.length
  await $.prompt.submit({ text: '/studio', origin: { kind: 'composer' }, wait: false, command: { name: 'studio', args: '' } } as never)
  await $.prompt.submit({ text: 'notice', origin: { kind: 'unclassified' }, wait: false, isMeta: true } as never)
  expect(w.classified.length).toBe(before)
})

test('a class that comes in after 800 ms is still recorded, with its time, and used by later spawns', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w = world('late:hard')
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  await $.prompt.submit(typed('Fix the lobby desync'))
  await clock.advance(1500)
  w.release?.()
  await clock.advance(50)
  expect(report(w).turnClass).toBe('hard')
  expect(report(w).classMs).toBe(1500)
  await $.agent.spawn(spawnOf({ prompt: 'Write the patch', model: 'claude-sonnet-5-5' }))
  expect(w.spawned[0]?.model).toBe('claude-opus-5-5')
  const me = (await $.command.run({ command: 'studio', args: 'me', origin: { kind: 'composer' } } as never)) as { text: string }
  expect(me.text).toContain('last turn class: hard (1500 ms)')
})

test('D7 in the director chat: Fable and a higher effort wait for an answered question in the same turn', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w = world('chore')
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  // a worker chat isn't gated
  await $.tool.call({ tool: 'mcp__ccd_session__start_session', model: 'claude-fable-5-2', title: 'x' } as never)
  expect(w.ran).toEqual(['mcp__ccd_session__start_session'])
  w.ran = []

  const dir = (await $.command.run({ command: 'director', args: '', origin: { kind: 'composer' } } as never)) as { context?: readonly string[] }
  await clock.advance(50)
  expect(dir.context?.[0]).toContain('You: Opus 5.5 high.')
  // the director seeds the policy file
  expect(w.files[`${STUDIO}/model_policy.md`]?.startsWith('# Model policy')).toBe(true)

  await $.turn.start({ text: 'start G5 stage 6 on Fable', turnId: 't1' })
  const fable = { tool: 'mcp__ccd_session__start_session', model: 'claude-fable-5-2', title: 'G5 stage 6', initiation: 'user_asked' } as never
  expect(why(await $.tool.call(fable))).toContain('studio (D7): ask the user first. Fable needs')
  expect(why(await $.tool.call({ tool: 'mcp__ccd_session_mgmt__set_session_effort', session_id: 'local_g5', effort: 'max' } as never))).toContain('effort max, above yours (high)')
  expect(why(await $.tool.call({ tool: 'mcp__ccd_session__start_session', model: 'opus', title: 'x' } as never))).toContain('use a full model id')
  // an Opus chat at medium needs no ask
  await $.tool.call({ tool: 'mcp__ccd_session__start_session', model: 'claude-opus-5-5', effort: 'medium', title: 'G5 stage 6' } as never)
  expect(w.ran).toEqual(['mcp__ccd_session__start_session'])

  // the user answers: Fable goes through in this turn
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Start G5 stage 6 on Fable 5.2?', header: 'Model', options: [{ label: 'Yes' }, { label: 'No' }], multiSelect: false }] } as never)
  await $.tool.call(fable)
  expect(w.ran.at(-1)).toBe('mcp__ccd_session__start_session')
  await $.turn.complete({ answer: 'Started.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })

  // the next turn needs a new answer
  await $.turn.start({ text: 'and switch G6 too', turnId: 't2' })
  expect(why(await $.tool.call({ tool: 'mcp__ccd_session_mgmt__set_session_model', session_id: 'local_g6', model: 'claude-fable-5-2' } as never))).toContain('D7')
})
