import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { AskTurn, BoardRow, BoardView } from '../types'
import { ASK_SYSTEM, HISTORY_CHARS, addTurn, askPrompt, cleanQuestion, earlierTurns, failText, turnLine } from '../hooks/ask'
import { snapshotText } from '../hooks/director'

// Stage 6, the ask box. The hooks here stand for the engine and the app beneath
// the mod: the studio folder is a table of files, git and the app's tools answer
// fixed text, and each model call is kept and answered as the test says.
const ROOT = 'E:/Godot Games/scrap-shift'
const STUDIO = `${ROOT}/docs/studio`
const NOW = Date.parse('2026-11-16T10:00:00Z')
const h = (n: number) => new Date(NOW - n * 3_600_000).toISOString()
const USAGE = JSON.stringify({ plan: { status: 'ok', windows: [{ label: 'Weekly · all models', percentUsed: 40, resetsIn: '1d 2h' }] }, context: { tokensUsed: 90000, percentUsed: 9 } })
const listed = (id: string, title: string, ageH: number) => ({ sessionId: id, title, cwd: 'E:\\Godot Games\\scrap-shift', isArchived: false, isRunning: false, lastActivityAt: h(ageH) })
const LIST = JSON.stringify([listed('local_g3e', "G3e: the Warden's sounds", 3), listed('local_self', 'SD6 test', 0.1), listed('local_vault', 'Vault v2', 2)])
const row = (over: Record<string, unknown>) =>
  JSON.stringify({
    schema: 2, appId: 'local_x', cliId: 'cli-x', title: 'A chat', tag: null, tagSource: null, state: 'idle', stateSince: h(1), updatedAt: h(1),
    turns: 1, recap: '', ask: null, lastCommit: null, context: null, model: 'claude-opus-5-5', effort: 'high', turnClass: null, classMs: null, routings: [], cwd: ROOT, ...over,
  })
const FILES: Record<string, string> = {
  'sessions/local_g3e.json': row({ appId: 'local_g3e', cliId: 'cli-g3e', title: "G3e: the Warden's sounds", tag: 'G3e', state: 'waiting-you', stateSince: h(3), updatedAt: h(3), ask: { question: 'Start building G3e on this plan?', buttons: ['Yes, build it'] } }),
  'sessions/local_vault.json': row({ appId: 'local_vault', cliId: 'cli-vault', title: 'Vault v2', updatedAt: h(2), recap: 'Belts are in.' }),
  'sessions/local_self.json': row({ appId: 'local_self', cliId: 'cli-self', title: 'SD6 test', tag: 'SD6', updatedAt: h(0.1), recap: 'Testing the ask box.' }),
  'notes.md': '# Studio notes\n\n- 2026-11-16 09:00: G3e waits for the plan OK.\n',
}

type Reply = { isAnswered: true; text: string } | { isAnswered: false; reason: 'api-error' | 'empty-reply' | 'aborted'; status?: number }
type Call = { model: string; prompt: string; system?: string; effort?: string; maxTokens?: number; timeoutMs?: number }
type World = { files: Record<string, string>; calls: Call[]; replies: Reply[]; release: ((r: Reply) => void) | null; hold: boolean; writes: string[]; prompts: Array<{ text: string; context: readonly string[] }> }

const USAGE_OF = { input_tokens: 5200, output_tokens: 180, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const result = (r: Reply) =>
  r.isAnswered
    ? { isAnswered: true as const, text: r.text, usage: USAGE_OF }
    : r.reason === 'api-error'
      ? { isAnswered: false as const, reason: 'api-error' as const, status: r.status ?? null, error: 'overloaded_error' as never, usage: USAGE_OF }
      : { isAnswered: false as const, reason: r.reason, usage: USAGE_OF }

function engine(on: On, w: World) {
  mock.env(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'cli-self' }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.turns', () => ({ value: 1 }))
  on('session.surfaces', () => ({ value: [] }))
  on('command.register', () => ({ value: { command: 'studio' } }))
  on('mcp.call', (_, e) => {
    const text = e.tool === 'get_usage' ? USAGE : e.tool === 'list_sessions' ? LIST : e.tool === 'get_session' ? JSON.stringify({ sessionId: 'local_self', title: 'SD6 test', model: 'claude-opus-5-5', effort: 'high' }) : '{}'
    return { value: { isError: false, content: [{ type: 'text' as const, text }] } }
  })
  on('fs.write', (_, e) => {
    w.writes.push(e.path)
    return { value: undefined }
  })
  on('fs.list', () => ({
    value: Object.entries(w.files)
      .filter(([n]) => n.startsWith('sessions/'))
      .map(([n, text]) => ({ name: n.slice('sessions/'.length), kind: 'file' as const, size: text.length, mtimeMs: NOW, isLink: false })),
  }))
  on('fs.read', (_, e) => {
    const path = e.path.split('\\').join('/')
    const text = path.startsWith(`${STUDIO}/`) ? w.files[path.slice(STUDIO.length + 1)] : undefined
    if (text === undefined) throw new Error(`ENOENT ${path}`)
    return { value: text }
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[1] === 'rev-parse') return ok(`${ROOT}/.git\n`)
    if (argv[1] === 'status') return ok([' M scripts/a.gd', ''].join('\0'))
    if (argv[1] === 'log' && argv.includes('--oneline')) return ok('aa115fb Studio mod stage 5\ne8fff27 game_v2: the Sentry\n')
    if (argv[1] === 'log') return ok('aa115fb\x1fStudio mod stage 5\x1f2026-11-15T19:30:00+03:00\n')
    return ok('')
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => {
    w.prompts.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text, context: e.context }
  })
  on('session.messages', () => ({ value: [] as never }))
  on('model.classify', () => ({ value: 'chore' }))
  on('model.complete', (_, e) => {
    w.calls.push({ model: e.model, prompt: e.prompt, system: e.system, effort: e.effort, maxTokens: e.maxTokens, timeoutMs: e.timeoutMs })
    if (w.hold) return new Promise(resolve => (w.release = r => resolve({ value: result(r) }))) as never
    return { value: result(w.replies.shift() ?? { isAnswered: true, text: 'An answer.' }) }
  })
}

const world = (): World => ({ files: { ...FILES }, calls: [], replies: [], release: null, hold: false, writes: [], prompts: [] })

const PANE = {
  plugin: 'studio',
  component: 'Pane',
  requestId: 'studio-board',
  props: { title: 'Studio', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const studio = (args: string) => ({ command: 'studio', args, origin: { kind: 'composer' } }) as never

async function setUp($: Engine, on: On, w: World) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  await $.command.run(studio(''))
  // stage 7: the box is the pane's Ask tab; the chat remembers the tab
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-ask' })
  await ui.unmount()
  return clock
}

const turn = (q: string, a: string, ok = true): AskTurn => ({ q, a, at: NOW, ok, tokensIn: 100, tokensOut: 10 })

test('the prompt holds the snapshot, the earlier turns and the question; the kept turns are capped', () => {
  expect(askPrompt('<studio-snapshot>x</studio-snapshot>', [], 'Who waits?')).toBe('<studio-snapshot>x</studio-snapshot>\n\nQuestion: Who waits?')
  const p = askPrompt('<s/>', [turn('Who waits?', 'G3e.')], 'And the other one?')
  expect(p).toBe('<s/>\n\nEarlier in this pane (oldest first):\nQ: Who waits?\nA: G3e.\n\nQuestion: And the other one?')
  expect(cleanQuestion('  hi  ')).toBe('hi')
  expect(cleanQuestion('x'.repeat(3000)).length).toBe(2000)
  // three kept; errors are shown but never sent as history; long turns drop oldest first
  const four = [turn('1', 'a'), turn('2', 'b'), turn('3', 'c'), turn('4', 'd')].reduce<AskTurn[]>((ts, t) => addTurn(ts, t), [])
  expect(four.map(t => t.q)).toEqual(['2', '3', '4'])
  expect(earlierTurns([turn('1', 'a'), turn('2', 'No answer.', false), turn('3', 'c')]).map(t => t.q)).toEqual(['1', '3'])
  const big = 'y'.repeat(HISTORY_CHARS / 2)
  expect(earlierTurns([turn('1', big), turn('2', big), turn('3', 'c')]).map(t => t.q)).toEqual(['2', '3'])
  expect(failText({ reason: 'api-error', status: 529, error: 'overloaded_error' })).toBe('No answer: the API answered an error (529): overloaded_error. Try again in a moment.')
  expect(failText({ reason: 'aborted' })).toBe('No answer within 60 s.')
  expect(turnLine({ ...turn('q', 'a'), tokensIn: 5200, tokensOut: 180 }).startsWith('Opus 5.5 low · 5.2k in · 180 out · board read ')).toBe(true)
})

const boardRow = (over: Partial<BoardRow>): BoardRow => ({
  id: 'local_x', tag: null, title: 'A chat', state: 'idle', since: h(1), updatedAt: h(1), ask: null, recap: '', lastCommit: null, context: null,
  isStalled: false, isFresh: false, isSelf: false, isUnreported: false, model: '', effort: '', turnClass: null, isCapped: false, ...over,
})

test("the box's snapshot is full, holds the chat's own row, and has no director lines", () => {
  const view: BoardView = {
    at: NOW,
    header: { usage: [], uncommitted: { changed: 1, untracked: 0 }, lastCommit: null },
    groups: { waiting: [], working: [], recent: [boardRow({ id: 'local_vault', title: 'Vault v2' }), boardRow({ id: 'local_self', title: 'SD6 test', isSelf: true })], quiet: [] },
  }
  const forAsk = snapshotText({ view, seen: null, log: '', notes: null, forAsk: true }).text
  expect(forAsk).toContain('every Scrapshift chat (2); the one marked "(this chat)" is where this pane is open')
  expect(forAsk).toContain('  SD6 test (this chat) [local_self]')
  expect(forAsk).not.toContain('You: ')
  expect(forAsk).not.toContain('model_policy.md')
  // the director's own snapshot is unchanged: its row left out, its policy line kept
  const director = snapshotText({ view, seen: null, log: '', notes: null }).text
  expect(director).not.toContain('SD6 test')
  expect(director).toContain('every Scrapshift chat but this one (1)')
  expect(director).toContain('You: unknown.')
})

test('a question typed in the pane is answered there from the full board, on Opus 5.5 low, with no turn and no file', async ($, on) => {
  const w = world()
  await setUp($, on, w)
  w.replies.push({ isAnswered: true, text: "**G3e: the Warden's sounds** waits on you: *Start building G3e on this plan?*" })
  const writes = w.writes.length
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^Ask the board$/ }))?.text).toBe('Ask the board')
    expect((await ui.find({ type: 'Input' }))?.key).toBe('ask-0')
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'ask-0', text: "  What's waiting on me?  " })
  expect(w.calls.length).toBe(1)
  const c = w.calls[0]!
  expect([c.model, c.effort, c.maxTokens, c.timeoutMs, c.system]).toEqual(['claude-opus-5-5', 'low', 1500, 60_000, ASK_SYSTEM])
  expect(c.prompt).toContain('<studio-snapshot kind="full"')
  expect(c.prompt).toContain('SD6 test (this chat) [local_self]')
  expect(c.prompt).toContain('ask: Start building G3e on this plan?  [Yes, build it]')
  expect(c.prompt).toContain('aa115fb Studio mod stage 5')
  expect(c.prompt).toContain('- 2026-11-16 09:00: G3e waits for the plan OK.')
  expect(c.prompt).not.toContain('Earlier in this pane')
  expect(c.prompt.endsWith("Question: What's waiting on me?")).toBe(true)
  // the answer shows in the pane; the field comes back empty under a new key
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe("**G3e: the Warden's sounds** waits on you: *Start building G3e on this plan?*")
  expect((await ui.find({ type: 'Text', text: /^> What's waiting on me\?$/ }))?.text).toBe("> What's waiting on me?")
  expect((await ui.find({ type: 'Text', text: /^Opus 5\.5 low · 5\.2k in · 180 out · board read / }))).not.toBe(undefined)
  expect((await ui.find({ type: 'Input' }))?.key).toBe('ask-1')
  // nothing else moved: no prompt, no file
  expect(w.prompts.length).toBe(0)
  expect(w.writes.length).toBe(writes)
  await ui.unmount()
})

test("in the director chat an ask leaves the director's snapshot record alone: its next changes still list a row changed before the ask", async ($, on) => {
  const w = world()
  const clock = await setUp($, on, w)
  const out = (await $.command.run({ command: 'director', args: '', origin: { kind: 'composer' } } as never)) as { context?: readonly string[] }
  expect(out.context?.[0]).toContain('<studio-snapshot kind="full"')
  await clock.advance(50)
  const before = w.prompts.length // the first turn's own prompt
  // Vault v2 changes, then the user asks the box (which reads the board whole)
  w.files['sessions/local_vault.json'] = row({ appId: 'local_vault', cliId: 'cli-vault', title: 'Vault v2', updatedAt: h(0.05), recap: 'The vault door is in.', state: 'idle' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // stage 7: in the director chat the field sends to the chat unless it is switched to the quick ask
  expect((await ui.find({ type: 'Text', text: /^Message the Director$/ }))?.text).toBe('Message the Director')
  await ui.select({ key: 'ask-mode', value: 'quick' })
  await ui.input({ key: 'ask-0', text: 'What did Vault v2 just do?' })
  expect(w.calls[0]!.prompt).toContain('recap: The vault door is in.')
  expect(w.prompts.length).toBe(before) // no prompt from the box
  await ui.unmount()
  // the director's next prompt still sees Vault v2 as changed
  await $.prompt.submit({ text: 'and now?', origin: { kind: 'composer' }, wait: false } as never)
  const snap = w.prompts.at(-1)?.context[0] ?? ''
  expect(snap).toContain('kind="changes"')
  expect(snap).toContain('Vault v2 [local_vault]')
  expect(snap).toContain('recap: The vault door is in.')
})

test('a follow-up carries the last 3 answered turns; Clear empties them', async ($, on) => {
  const w = world()
  await setUp($, on, w)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  w.replies.push({ isAnswered: true, text: 'G3e waits.' }, { isAnswered: false, reason: 'api-error', status: 529 }, { isAnswered: true, text: 'Vault v2 is idle.' })
  await ui.input({ key: 'ask-0', text: 'Who waits?' })
  await ui.input({ key: 'ask-1', text: 'Is the API up?' })
  expect((await ui.find({ type: 'Text', text: /\(529\)/ }))?.text).toBe('No answer: the API answered an error (529): overloaded_error. Try again in a moment.')
  await ui.input({ key: 'ask-2', text: 'And the other one?' })
  const third = w.calls[2]!.prompt
  expect(third).toContain('Earlier in this pane (oldest first):\nQ: Who waits?\nA: G3e waits.\n\nQuestion: And the other one?')
  expect(third).not.toContain('Is the API up?') // an error is no answer to follow up on
  // stage 7: every kept turn shows whole, newest first: its question, then its answer (or why there is none)
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('Vault v2 is idle.')
  expect((await ui.findAll({ type: 'Text', text: /^> / })).map(t => t.text)).toEqual(['> And the other one?', '> Is the API up?', '> Who waits?'])
  expect((await ui.findAll({ type: 'Markdown' })).map(t => t.props.text)).toEqual(['Vault v2 is idle.', 'G3e waits.'])
  w.replies.push({ isAnswered: true, text: 'Four.' })
  await ui.input({ key: 'ask-3', text: 'Fourth?' })
  expect((await ui.findAll({ type: 'Text', text: /^> / })).map(t => t.text)).toEqual(['> Fourth?', '> And the other one?', '> Is the API up?'])
  // /studio me prints the kept turns whole, oldest first
  const me = ((await $.command.run(studio('me'))) as { text: string }).text
  expect(me).toContain('ask box (last 3, oldest first):\n  Q: Is the API up?\n  A: No answer: the API answered an error (529)')
  expect(me).toContain('  Q: Fourth?\n  A: Four.\n     (Opus 5.5 low')
  await ui.press({ key: 'ask-clear' })
  expect(await ui.find({ type: 'Markdown' })).toBe(undefined)
  expect(((await $.command.run(studio('me'))) as { text: string }).text).toContain('ask box: no questions yet')
  w.replies.push({ isAnswered: true, text: 'Fresh.' })
  await ui.input({ key: 'ask-4', text: 'Fresh start?' })
  expect(w.calls[4]!.prompt).not.toContain('Earlier in this pane')
  await ui.unmount()
})

test('one question at a time: Cancel stops the call on its way and keeps nothing', async ($, on) => {
  const w = world()
  w.hold = true
  const clock = await setUp($, on, w)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const asking = ui.input({ key: 'ask-0', text: 'Who waits?' })
  for (let i = 0; i < 200 && w.release === null; i++) await clock.advance(5)
  expect(w.release).not.toBe(null)
  // while it runs the field gives way to the question and a Cancel button
  expect(await ui.find({ type: 'Input' })).toBe(undefined)
  expect((await ui.find({ type: 'Text', text: /^Reading the board and asking/ }))?.text).toBe('Reading the board and asking…')
  await ui.press({ key: 'ask-cancel' })
  w.release?.({ isAnswered: false, reason: 'aborted' })
  await asking
  await clock.advance(50)
  expect(await ui.find({ type: 'Markdown' })).toBe(undefined)
  expect(await ui.find({ type: 'Button', key: 'ask-clear' })).toBe(undefined)
  expect((await ui.find({ type: 'Input' }))?.key).toBe('ask-1')
  expect(w.calls.length).toBe(1)
  await ui.unmount()
})

test('an empty reply and a timeout show why, in the pane', async ($, on) => {
  const w = world()
  await setUp($, on, w)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  w.replies.push({ isAnswered: true, text: '   ' }, { isAnswered: false, reason: 'aborted' })
  await ui.input({ key: 'ask-0', text: 'Anything?' })
  expect((await ui.find({ type: 'Text', text: /replied with no text/ }))?.text).toBe('No answer: the model replied with no text. Try asking again.')
  await ui.input({ key: 'ask-1', text: 'Still there?' })
  expect((await ui.find({ type: 'Text', text: /within 60 s/ }))?.text).toBe('No answer within 60 s.')
  // a blank question asks nothing
  await ui.input({ key: 'ask-2', text: '   ' })
  expect(w.calls.length).toBe(2)
  await ui.unmount()
})
