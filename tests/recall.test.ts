import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { NUDGE_TEXT, RECALL_CHARS, startRefusal } from '../hooks/recall'
import type { BoardRow } from '../types'

// The memory graph end to end (stage 8): the hooks here stand for the engine and
// the app. Files are one table keyed by path, each with its own mtime; the user's
// home is C:/Users/test, so the memory folder and the graph's folder sit under it.
const ROOT = 'E:/Godot Games/scrap-shift'
const STUDIO = `${ROOT}/docs/studio`
const HOME = 'C:/Users/test'
const PROJ = `${HOME}/.claude/projects/E--Godot-Games-scrap-shift`
const MEM = `${PROJ}/memory`
const NOW = Date.parse('2026-11-16T10:00:00Z')
const h = (n: number) => new Date(NOW - n * 3_600_000).toISOString()
const SELF = JSON.stringify({ sessionId: 'local_dir', title: 'Director', model: 'claude-opus-5-5', effort: 'high' })
const LIST = JSON.stringify(
  ['local_g3e', 'local_g5', 'local_dir'].map(id => ({ sessionId: id, title: id, cwd: 'E:/Godot Games/scrap-shift', isArchived: false, isRunning: true, lastActivityAt: h(0.1) })),
)
const USAGE = JSON.stringify({ plan: { status: 'ok', windows: [] }, context: { tokensUsed: 20000, percentUsed: 2 } })
const report = (over: Record<string, unknown>) =>
  JSON.stringify({
    schema: 2, appId: 'local_x', cliId: 'cli-x', title: 'A chat', tag: null, tagSource: null, state: 'idle', stateSince: h(1), updatedAt: h(1),
    turns: 1, recap: '', ask: null, lastCommit: null, context: null, model: 'claude-opus-5-5', effort: 'high', turnClass: null, classMs: null,
    routings: [], cwd: ROOT, ...over,
  })

const FILES: Record<string, string> = {
  [`${ROOT}/docs/MASTER_PLAN.md`]: '# Master Plan\n\n- [milestones_g](plan/milestones_g.md) — Milestones G\n  - G3 — The Warden overhaul\n  - G5 — The shopping cart (9–12 sessions)\n',
  [`${ROOT}/docs/plan/milestones_g.md`]: '# Milestones G\n\n## G5 — The shopping cart\n\nThe cart is a crew item.\n\n## G3 — The Warden overhaul\n\nRagdolls.\n',
  [`${ROOT}/docs/plan/status_09.md`]: "## 6. Status\n\n- **2026-11-15 (G5's building chat): stage 5, the cart's sounds, accepted by the user.**\n  - Takes are CC0 recordings.\n",
  [`${ROOT}/docs/CART.md`]: '# The cart (G5)\n\n## Stage 5 — sound\n\nWheels rattle on the yard.\nTakes: 16 ffmpeg edits.\n\n## Stage 6 — the Warden\n\nThe Warden hears a loud cart.\n',
  [`${ROOT}/CLAUDE.md`]: '# Scrapshift\n\n## Game rules\n- **No code-synthesized sounds** (user rule): Stable Audio Open and ElevenLabs takes.\n- Parts have a hidden condition.\n',
  [`${MEM}/MEMORY.md`]: '- [No synthesized SFX](feedback-no-synth-sfx.md) — real takes\n- [Sounds must fit](feedback-sounds-must-fit.md) — fit\n- [Godot shot runs](project-godot-shot-runs.md) — ports\n',
  [`${MEM}/feedback-no-synth-sfx.md`]: '---\nname: feedback-no-synth-sfx\ndescription: No code-synthesized sound effects; real recordings or ElevenLabs only\nmetadata:\n  type: feedback\n---\n\nBody. [[feedback-sounds-must-fit]]\n',
  [`${MEM}/feedback-sounds-must-fit.md`]: '---\nname: feedback-sounds-must-fit\ndescription: Every sound must make physical sense for where it plays\nmetadata:\n  type: feedback\n---\n\nBody.\n',
  [`${MEM}/project-godot-shot-runs.md`]: '---\nname: project-godot-shot-runs\ndescription: Shot runs need a free port and a quiet machine\nmetadata:\n  type: project\n---\n\nBody.\n',
  [`${STUDIO}/sessions/local_g3e.json`]: report({ appId: 'local_g3e', title: "G3e: the Warden's sounds", tag: 'G3e', state: 'waiting-you', stateSince: h(3), updatedAt: h(3), ask: { question: 'Play G3e yourself now?', buttons: ['Play it'] } }),
  [`${STUDIO}/sessions/local_g5.json`]: report({ appId: 'local_g5', title: 'G5 stage 6: the Warden and the cart', tag: 'G5', state: 'working', stateSince: h(0.2), updatedAt: h(0.1) }),
}

type Prompt = { text: string; context: readonly string[] }
type World = {
  files: Record<string, string>
  mtimes: Record<string, number>
  writes: string[]
  prompts: Prompt[]
  ran: string[]
  tools: string[]
  completes: string[]
  seq: number
}

const norm = (p: string) => p.split('\\').join('/')

function engine(on: On, w: World) {
  mock.env(on, { USERPROFILE: HOME })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'cli-dir' }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.turns', () => ({ value: 0 }))
  on('session.surfaces', () => ({ value: [] }))
  on('session.messages', () => ({ value: [] as never }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => {
    w.tools.push(e.name)
    return { value: { tool: `mcp__studio__${e.name}` } }
  })
  on('mcp.call', (_, e) => {
    const text = e.tool === 'get_session' ? SELF : e.tool === 'get_usage' ? USAGE : e.tool === 'list_sessions' ? LIST : '{}'
    return { value: { isError: false, content: [{ type: 'text' as const, text }] } }
  })
  on('fs.write', (_, e) => {
    const p = norm(e.path)
    w.files[p] = e.text
    w.mtimes[p] = NOW + ++w.seq
    w.writes.push(p)
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    const text = w.files[norm(e.path)]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.stat', (_, e) => {
    const p = norm(e.path)
    if (w.files[p] === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: 'file' as const, size: w.files[p]?.length ?? 0, mtimeMs: w.mtimes[p] ?? NOW, isLink: false } }
  })
  on('fs.list', (_, e) => {
    const dir = `${norm(e.path).replace(/\/$/, '')}/`
    const names = Object.keys(w.files).filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/'))
    return { value: names.map(p => ({ name: p.slice(dir.length), kind: 'file' as const, size: 1, mtimeMs: w.mtimes[p] ?? NOW, isLink: false })) }
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[1] === 'rev-parse' && argv.includes('--git-common-dir')) return ok(`${ROOT}/.git\n`)
    if (argv[1] === 'rev-parse') return ok('h0\n')
    if (argv[1] === 'status') return ok('')
    if (argv[1] === 'log' && argv.includes('--oneline')) return ok('9460a2d G5 stages 3-6b: the cart\n')
    if (argv[1] === 'log' && argv.includes('-60')) return ok('9460a2d\x1fG5 stages 3-6b: the cart\x1f2026-11-16T07:00:00+03:00\n')
    if (argv[1] === 'log') return ok('h0\x1fsubject\x1f2026-11-15T12:00:00+03:00\n')
    return ok('')
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.append', () => ({ value: undefined }) as never)
  on('prompt.submit', (_, e) => {
    w.prompts.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text, context: e.context }
  })
  // The fallback and the decision check: no label fits.
  on('model.classify', (_, e) => ({ value: e.labels.includes('none of these') ? 'none of these' : undefined }))
  on('model.complete', (_, e) => {
    w.completes.push(e.prompt)
    const text = e.prompt.includes('Stage 6')
      ? '{"concepts":[{"name":"rattle","is":"the wheels\' sound"}],"links":[{"a":"rattle","rel":"draws","b":"the Warden","sure":0.85}]}'
      : '{"concepts":[],"links":[]}'
    return { value: { isAnswered: true as const, text, usage: { input_tokens: 900, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('tool.call', (_, e) => {
    w.ran.push(String((e as unknown as { tool: string }).tool))
    return { result: { stdout: 'ok' } } as never
  })
}

const world = (): World => ({ files: { ...FILES }, mtimes: {}, writes: [], prompts: [], ran: [], tools: [], completes: [], seq: 0 })
const cmd = (command: string, args = '', kind = 'composer') => ({ command, args, origin: { kind } }) as never
const typed = (text: string) => ({ text, origin: { kind: 'composer' }, wait: false }) as never
const textOf = (r: unknown): string => {
  const x = r as { result?: unknown; deny?: unknown; text?: unknown }
  return String(x.deny ?? x.result ?? x.text ?? '')
}

async function director($: Engine, on: On) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w = world()
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  await $.command.run(cmd('director'))
  await clock.advance(50)
  return { clock, w }
}

test('in the director chat a prompt about sounds carries the audio rules, each with its source; a bare "thanks" carries none', async ($, on) => {
  const { w } = await director($, on)
  expect(w.tools.sort()).toEqual(['studio_overview', 'studio_path', 'studio_plan', 'studio_recall', 'studio_remember', 'studio_section'])

  await $.prompt.submit(typed("how should the cart's sounds be made?"))
  const ctx = w.prompts.at(-1)?.context ?? []
  expect(ctx[0]).toContain('<studio-snapshot')
  const recall = ctx[1] ?? ''
  expect(recall).toContain('<studio-recall about="audio; the shopping cart"')
  expect(recall).toContain('No synthesized SFX: No code-synthesized sound effects; real recordings or ElevenLabs only (memory feedback-no-synth-sfx.md) [guess .85]')
  expect(recall).toContain('Sounds must fit')
  expect(recall).toContain('(CLAUDE.md:4)')
  expect(recall).toContain('(docs/plan/status_09.md:3)')
  expect(recall).toContain('docs/CART.md')
  expect(recall).not.toContain('Godot shot runs') // a rule about something else
  expect(recall.length).toBeLessThanOrEqual(RECALL_CHARS)

  await $.prompt.submit(typed('thanks'))
  expect(w.prompts.at(-1)?.context.length).toBe(1)
  await $.prompt.submit(typed('let us go over everything once more today'))
  expect(w.prompts.at(-1)?.context.length).toBe(1) // the Haiku fallback named no topic

  // nothing from the memory folder is written anywhere; in the repo only docs/studio/ is written
  expect(w.writes.filter(p => p.includes('/memory/'))).toEqual([])
  expect(w.writes.filter(p => p.startsWith(ROOT) && !p.startsWith(`${STUDIO}/`))).toEqual([])
})

test('a decision written with studio_remember, pushed out of the 80 note lines, is still recalled from the archive', async ($, on) => {
  const { clock, w } = await director($, on)
  const r = await $.tool.call({ tool: 'mcp__studio__studio_remember', text: 'Carts never roll on their own on slopes', about: ['G5', 'the shopping cart'] } as never)
  expect(textOf(r)).toContain('Carts never roll on their own on slopes [about: G5, the shopping cart]')
  for (let i = 0; i < 80; i++) await $.command.run(cmd('studio', `note filler line ${i}`))
  expect(w.files[`${STUDIO}/notes_archive.md`]).toContain('Carts never roll on their own on slopes [about: G5, the shopping cart]')
  expect(w.files[`${STUDIO}/notes.md`]).not.toContain('Carts never roll')

  await clock.advance(61_000) // the graph re-reads at most once a minute
  await $.prompt.submit(typed('what did we decide about G5?'))
  const recall = w.prompts.at(-1)?.context[1] ?? ''
  expect(recall).toContain('Carts never roll on their own on slopes')
  expect(recall).toMatch(/\(docs\/studio\/notes_archive\.md:\d+\)/)
  expect(recall).toContain('[G5 stage 6: the Warden and the cart](#local_g5) working')
})

test('a second chat for a live tag is refused once, naming the first, until the user says yes; another chat working is no reason (stage 11)', async ($, on) => {
  const { w } = await director($, on)
  const start = (title: string, extra: Record<string, unknown> = {}) =>
    $.tool.call({ tool: 'mcp__ccd_session__start_session', title, initiation: 'user_asked', prompt: 'brief', ...extra } as never)
  const twin = textOf(await start("G3e: the Warden's sounds, part 2"))
  expect(twin).toContain('a live chat already has the tag G3e')
  expect(twin).toContain('[local_g3e]')
  // stage 11: G5 stage 6 is working, but work runs in parallel: a new tag goes through
  await start('N1e: SLIP 7 sound')
  expect(w.ran).toContain('mcp__ccd_session__start_session')
  w.ran.length = 0
  // a card the user starts is the user's own press
  await start('N1e: SLIP 7 sound', { initiation: 'own_initiative' })
  expect(w.ran).toContain('mcp__ccd_session__start_session')
  w.ran.length = 0
  // the user's yes in this turn lets it through
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Start a second G3e chat?', header: 'G3e', options: [{ label: 'Yes' }, { label: 'No' }], multiSelect: false }] } as never)
  await start("G3e: the Warden's sounds, part 2")
  expect(w.ran).toEqual(['AskUserQuestion', 'mcp__ccd_session__start_session'])
})

test('the start checks as pure rules', () => {
  const row = (over: Partial<BoardRow>): BoardRow => ({
    id: 'local_a', tag: null, title: 'A', state: 'idle', since: '', updatedAt: '', ask: null, recap: '', lastCommit: null, context: null,
    isStalled: false, isFresh: false, isSelf: false, isUnreported: false, model: '', effort: '', turnClass: null, isCapped: false, ...over,
  })
  const T = 'mcp__ccd_session__start_session'
  const rows = [row({ id: 'local_dir', tag: 'Director', state: 'working', isSelf: true }), row({ id: 'local_old', tag: 'G5', state: 'working', isStalled: true })]
  expect(startRefusal(T, { title: 'G5 stage 7' }, { rows, hasConsent: false })).toBeNull() // the director itself and a stalled chat don't count
  expect(startRefusal(T, { title: 'G5 stage 7' }, { rows: [...rows, row({ tag: 'G5', state: 'idle' })], hasConsent: false })).toBeNull()
  expect(startRefusal(T, { title: 'G5 stage 7' }, { rows: [row({ tag: 'G5', state: 'waiting-you' })], hasConsent: false })).toContain('tag G5')
  expect(startRefusal(T, { title: 'G5 stage 7' }, { rows: [row({ tag: 'G5', state: 'waiting-you' })], hasConsent: true })).toBeNull()
  expect(startRefusal(T, { title: 'N1e: SLIP 7 sound' }, { rows: [row({ tag: 'G5', state: 'working' })], hasConsent: false })).toBeNull() // stage 11: no one-builder rule
  expect(startRefusal(T, { proposal_id: 'p1' }, { rows: [row({ state: 'working' })], hasConsent: false })).toBeNull()
  expect(startRefusal('mcp__ccd_session_mgmt__send_message', {}, { rows: [row({ state: 'working' })], hasConsent: false })).toBeNull()
})

test('the tools answer from the graph: a section, a path, a topic, the overview', async ($, on) => {
  await director($, on)
  const section = textOf(await $.tool.call({ tool: 'mcp__studio__studio_section', doc: 'CART.md', heading: 'stage 5' } as never))
  expect(section).toContain('docs/CART.md, lines 3-7')
  expect(section).toContain('Wheels rattle on the yard.')
  expect(section).not.toContain('The Warden hears')
  const none = textOf(await $.tool.call({ tool: 'mcp__studio__studio_section', doc: 'CART.md', heading: 'zebra' } as never))
  expect(none).toContain('No heading matches "zebra"')
  expect(none).toContain('§"Stage 6 — the Warden"')

  const path = textOf(await $.tool.call({ tool: 'mcp__studio__studio_path', from: 'No synthesized SFX', to: 'Sounds must fit' } as never))
  expect(path).toContain('1 links, as sure as its weakest (all stated by files)')
  const topic = textOf(await $.tool.call({ tool: 'mcp__studio__studio_recall', topic: 'G3e' } as never))
  expect(topic).toContain('## G3e (workstream')
  expect(topic).toContain('Play G3e yourself now?')
  const overview = textOf(await $.tool.call({ tool: 'mcp__studio__studio_overview' } as never))
  expect(overview).toContain('The studio memory graph:')
  expect(overview).toContain('Clusters')
  expect(overview).toContain('brain:')
})

test('the nudge: a doc opened while the graph was not asked gets a hint, 5 a thread at most', async ($, on) => {
  await director($, on)
  const hints: number[] = []
  for (let i = 0; i < 7; i++) {
    const r = (await $.tool.call({ tool: 'Read', file_path: `${ROOT}/docs/CART.md` } as never)) as { context?: readonly string[] }
    hints.push((r.context ?? []).filter(c => c === NUDGE_TEXT).length)
  }
  expect(hints).toEqual([1, 1, 1, 1, 1, 0, 0])
  const notes = (await $.tool.call({ tool: 'Read', file_path: `${STUDIO}/notes.md` } as never)) as { context?: readonly string[] }
  expect(notes.context ?? []).toEqual([])
})

test('the brain pass reads the docs with Haiku in the background, keeps its answers outside the repo, and links what it found', async ($, on) => {
  const { clock, w } = await director($, on)
  await $.prompt.submit(typed('where is the cart?')) // the first graph build
  for (let i = 0; i < 8; i++) await clock.advance(4_100)
  const brainFile = `${PROJ}/studio-graph/brain.json`
  expect(w.files[brainFile]).toBeDefined()
  expect(w.completes.length).toBeGreaterThan(0)
  expect(w.completes[0]).toContain('Known names:')
  const status = textOf(await $.command.run(cmd('studio', 'brain')))
  expect(status).toMatch(/brain: (\d+) of \1 doc chunks read \(up to date\)/)
  expect(status).toContain(`${PROJ}/studio-graph/brain.json`)

  await clock.advance(61_000)
  const topic = textOf(await $.tool.call({ tool: 'mcp__studio__studio_recall', topic: 'the Warden' } as never))
  expect(topic).toContain('rattle → draws → the Warden')
  // a done brain reads nothing again
  const before = w.completes.length
  for (let i = 0; i < 3; i++) await clock.advance(4_100)
  expect(w.completes.length).toBe(before)
  expect(w.writes.filter(p => p.startsWith(ROOT) && !p.startsWith(`${STUDIO}/`))).toEqual([])
})

test('/studio recall shows what the director would be reminded of', async ($, on) => {
  await director($, on)
  expect(textOf(await $.command.run(cmd('studio', 'recall the cart sounds')))).toContain('<studio-recall about="audio; the shopping cart"')
  expect(textOf(await $.command.run(cmd('studio', 'recall nothing here at all')))).toContain('Nothing in the graph matches')
})
