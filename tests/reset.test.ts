import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import {
  CACHE_MS,
  COMPACT_ARGS,
  IDLE_MIN_TOKENS,
  IDLE_MS,
  RESET_DELAY_MS,
  RESET_TOKENS,
  CARRY_ASKS,
  CARRY_REPLY_CHARS,
  SKIP_TWICE,
  carryBlock,
  decisionTool,
  noteLine,
  owedNote,
  pushAsk,
  readMethod,
  replyTail,
  resetDecision,
  resetLine,
} from '../hooks/reset'

// Stage 5, the director's reset (docs/STUDIO_DIRECTOR.md §5.5). The hooks here
// stand for the engine and the app beneath the mod: files are one table, the
// context's tokens and the engine id are the world's, and every command the mod
// queues is kept (a /clear changes the engine id and empties the context).
const ROOT = 'E:/Godot Games/scrap-shift'
const STUDIO = `${ROOT}/docs/studio`
const NOTES = `${STUDIO}/notes.md`
const NOW = Date.parse('2026-11-15T10:00:00Z')
const SELF = JSON.stringify({ sessionId: 'local_dir', title: 'Director', model: 'claude-sonnet-5-5', effort: 'medium' })
const USAGE = JSON.stringify({ plan: { status: 'ok', windows: [] }, context: { tokensUsed: 20000, percentUsed: 2 } })

type World = {
  files: Record<string, string>
  tokens: number | undefined
  cliId: string
  label: string
  ran: Array<{ command: string; args: string; origin: string }>
  refuse: string[]
  notices: string[]
  prompts: Array<{ text: string; context: readonly string[] }>
  compacted: string[]
}

function engine(on: On, w: World) {
  mock.env(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: w.cliId }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.turns', () => ({ value: 1 }))
  on('session.surfaces', () => ({ value: [] }))
  on('session.messages', () => ({ value: [] as never }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: w.tokens, window: 1_000_000 }, rateLimits: [] } }))
  on('session.append', (_, e, next) => {
    const block = (e.message.content as ReadonlyArray<{ text?: string }>)[0]
    w.notices.push(`${e.message.type}: ${block?.text ?? ''}`)
    return next(e)
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.run', (_, e) => {
    const o = e.origin as { kind: string; name?: string }
    w.ran.push({ command: e.command, args: e.args, origin: o.kind === 'plugin' ? `plugin:${o.name}` : o.kind })
    if (w.refuse.includes(e.command)) throw new Error(`refused /${e.command}`)
    if (e.command === 'clear') {
      w.cliId = `${w.cliId}+`
      w.tokens = undefined
    }
    if (e.command === 'compact') w.tokens = 9000
    return { text: '' }
  })
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
    if (argv[1] === 'log' && argv.includes('--oneline')) return ok('8c6df61 Studio Director stage 4: auto model\n')
    return ok('')
  })
  on('model.classify', () => ({ value: w.label }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_, e) => {
    w.prompts.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text, context: e.context }
  })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
  on('session.compact', (_, e) => {
    w.compacted.push(e.trigger)
    return { messages: e.messages }
  })
  on('ui.open', () => ({ value: { isPlaced: false as const, reason: 'no-surface' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', (_, e) => {
    const t = e as unknown as { tool: string; file_path?: string; new_string?: string }
    if (t.tool === 'Edit' && t.file_path !== undefined) w.files[t.file_path] = `${w.files[t.file_path] ?? ''}${t.new_string ?? ''}`
    return { result: { answers: {} } } as never
  })
}

const world = (): World => ({ files: {}, tokens: 20_000, cliId: 'cli-dir', label: 'user-asks-or-chats', ran: [], refuse: [], notices: [], prompts: [], compacted: [] })
const ONE = [{ role: 'user', text: 'x', toolUses: [] }]
const typed = (text: string, kind = 'sdk') => ({ text, origin: { kind }, wait: false }) as never
const COMPOSE = { model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] } as never
const sectionIds = async ($: { prompt: { compose: (e: never) => Promise<{ sections: ReadonlyArray<{ id: string }> }> } }) =>
  (await $.prompt.compose(COMPOSE)).sections.map(s => s.id)

type Engineish = Parameters<TestBody>[0]
type Clock = { advance: (ms: number) => Promise<void> }

/** A director chat, started with /director (its first turn's prompt is the mod's own). */
async function director($: Engineish, on: On, w: World): Promise<Clock> {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  await $.command.run({ command: 'director', args: '', origin: { kind: 'composer' } } as never)
  await clock.advance(50)
  w.prompts = []
  return clock
}

let turnNo = 0
/** One of the user's turns: the prompt, the work, the end. */
async function turn($: Engineish, clock: Clock, text: string, work: () => Promise<unknown> = async () => undefined, kind = 'sdk') {
  const turnId = `t${++turnNo}`
  await $.prompt.submit(typed(text, kind))
  await $.turn.start({ text, turnId })
  await work()
  await $.turn.complete({ answer: 'Done.', durationMs: 5, isAborted: false, turnId, reason: 'answer' })
  await clock.advance(50)
}

// ---------------------------------------------------------------- the rules

test('the rules: the threshold, the idle floor, an open ask, an owed note, no twice in a row, a lapsed cache', () => {
  const base = { kind: 'size' as const, tokens: RESET_TOKENS, hasOpenAsk: false, owed: null, isFreshThread: false, method: 'clear' as const }
  expect(resetDecision(base)).toEqual({ isReset: true, method: 'clear' })
  expect(resetDecision({ ...base, tokens: RESET_TOKENS - 1 }).isReset).toBe(false)
  expect(resetDecision({ ...base, tokens: null }).isReset).toBe(false)
  expect(resetDecision({ ...base, hasOpenAsk: true })).toEqual({ isReset: false, why: 'an ask is open: the reset waits for the answer' })
  expect(resetDecision({ ...base, owed: 'started a chat' })).toEqual({ isReset: false, why: 'a note is owed (started a chat)' })
  expect(resetDecision({ ...base, isFreshThread: true }).isReset).toBe(false)
  expect(resetDecision({ ...base, method: 'off' }).isReset).toBe(false)
  const idle = { ...base, kind: 'idle' as const, tokens: IDLE_MIN_TOKENS, elapsedMs: IDLE_MS }
  expect(resetDecision(idle)).toEqual({ isReset: true, method: 'clear' })
  expect(resetDecision({ ...idle, tokens: IDLE_MIN_TOKENS - 1 }).isReset).toBe(false)
  // a /clear costs nothing, so a late timer still clears; a late /compact would read the chat at full price
  expect(resetDecision({ ...idle, elapsedMs: CACHE_MS + 1 }).isReset).toBe(true)
  expect(resetDecision({ ...idle, method: 'compact', elapsedMs: CACHE_MS + 1 })).toEqual({ isReset: false, why: 'the cache already lapsed' })

  expect(owedNote({ decisions: ['started a chat'], notesChanged: false, pendingWhy: null })).toBe('started a chat')
  expect(owedNote({ decisions: ['started a chat'], notesChanged: true, pendingWhy: 'older' })).toBe(null)
  expect(owedNote({ decisions: [], notesChanged: false, pendingWhy: 'older' })).toBe('older')
  expect(owedNote({ decisions: [], notesChanged: false, pendingWhy: null })).toBe(null)

  expect(readMethod('compact', 'clear')).toBe('compact')
  expect(readMethod(' OFF ', 'clear')).toBe('off')
  expect(readMethod(undefined, 'clear')).toBe('clear')
  expect(readMethod('soon', 'compact')).toBe('compact')
  expect(decisionTool('mcp__ccd_session__start_session')).toBe('started a chat')
  expect(decisionTool('Read')).toBe(null)
  expect(noteLine('started a chat')).toContain('took a decision (started a chat) but docs/studio/notes.md did not change')
  expect(resetLine('size', 'clear', 691_400, 0)).toBe(
    'studio: the director cleared its chat (context passed 600k tokens; 691k → 0 tokens). The board and docs/studio/notes.md hold the rest; the next prompt carries the full board.',
  )
  expect(resetLine('idle', 'compact', 240_000, 9000)).toContain('compacted its chat (an hour away; 240k → 9k tokens)')
})

// ---------------------------------------------------------------- the reset in a director chat

test('past 600k tokens the director clears itself after the turn: a dim line, the role kept, the full board next', async ($, on) => {
  const w = world()
  const clock = await director($, on, w)
  await turn($, clock, 'where do we stand?')
  expect(w.prompts[0]?.context[0]).toContain('kind="changes"')
  expect(w.ran).toEqual([]) // 20k: no reset

  w.tokens = 691_400
  await turn($, clock, 'and G5?')
  expect(w.ran).toEqual([]) // queued only after the turn has settled
  await clock.advance(RESET_DELAY_MS)
  expect(w.ran).toEqual([{ command: 'clear', args: '', origin: 'plugin:studio' }])
  expect(w.notices).toEqual([
    'system: studio: the director cleared its chat (context passed 600k tokens; 691k → 0 tokens). The board and docs/studio/notes.md hold the rest; the next prompt carries the full board.',
  ])
  // the new thread still gets the role, and its first prompt the full board
  expect(await sectionIds($ as never)).toEqual(['intro', 'studio:director'])
  w.tokens = 12_000
  await turn($, clock, 'what did we decide?')
  expect(w.prompts.at(-1)?.context[0]).toContain('kind="full"')
  expect(w.ran.length).toBe(1)
  const me = (await $.command.run({ command: 'studio', args: 'me', origin: { kind: 'composer' } } as never)) as { text: string }
  expect(me.text).toContain('reset: /clear past 600k tokens or after 55 min away · last 2026-11-15T10:00:')
  expect(me.text).toContain('(size, /clear, 691400 → 0 tokens)')
})

test('a new prompt before the queued reset stops it', async ($, on) => {
  const w = world()
  const clock = await director($, on, w)
  w.tokens = 620_000
  await turn($, clock, 'one')
  await $.prompt.submit(typed('quick, before it clears'))
  await clock.advance(RESET_DELAY_MS * 2)
  expect(w.ran).toEqual([])
})

test('a worker chat past 600k never resets', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w = world()
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  w.tokens = 900_000
  await turn($, clock, 'build it')
  await clock.advance(IDLE_MS + RESET_DELAY_MS)
  expect(w.ran).toEqual([])
})

test('after 55 min away the director clears itself; a prompt in between cancels the timer; a small chat is left', async ($, on) => {
  const w = world()
  const clock = await director($, on, w)
  w.tokens = 245_000
  await turn($, clock, 'one')
  await clock.advance(IDLE_MS - 60_000)
  await turn($, clock, 'back already') // the timer starts over from this turn's end
  await clock.advance(IDLE_MS - 60_000)
  expect(w.ran).toEqual([])
  await clock.advance(60_000)
  expect(w.ran).toEqual([{ command: 'clear', args: '', origin: 'plugin:studio' }])
  expect(w.notices[0]).toContain('(an hour away; 245k → 0 tokens)')

  // under 200k an idle reset gains little: a fresh chat costs ~116k
  w.tokens = 150_000
  await turn($, clock, 'two')
  await clock.advance(IDLE_MS + 1000)
  expect(w.ran.length).toBe(1)
})

test('an open ask holds the reset; the answer is a decision, so the note comes first, then the reset', async ($, on) => {
  const w = world()
  const clock = await director($, on, w)
  w.tokens = 695_000
  await turn($, clock, 'what next?', () =>
    $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'G5 or Vault next.', ask: 'Start G5 stage 5 next?', actions: [{ label: 'Yes, G5' }, { label: 'Vault first' }] } as never),
  )
  await clock.advance(IDLE_MS + RESET_DELAY_MS)
  expect(w.ran).toEqual([]) // waiting on the user: neither reset runs

  // the user answers; the director forgets the note
  await turn($, clock, 'Yes, G5')
  await clock.advance(RESET_DELAY_MS)
  expect(w.ran).toEqual([])
  // the next prompt carries the hidden line
  await turn($, clock, 'ok', () => $.tool.call({ tool: 'Edit', file_path: NOTES, old_string: '', new_string: '- 2026-11-15 10:05: G5 stage 5 goes next.\n' } as never))
  expect(w.prompts.at(-1)?.context[1]).toContain("<studio-notes-check>Your last turn took a decision (answered the director's ask)")
  // the note is written: the reset runs after that turn
  await clock.advance(RESET_DELAY_MS)
  expect(w.ran.map(r => r.command)).toEqual(['clear'])
  // and the line is gone; the first prompt after the reset carries the thread instead
  await turn($, clock, 'thanks')
  expect(w.prompts.at(-1)?.context.length).toBe(2)
  expect(w.prompts.at(-1)?.context[1]).toContain('<studio-carry')
  expect(w.prompts.at(-1)?.context.some(x => x.includes('<studio-notes-check>'))).toBe(false)
})

test('a chat started, or a prompt the check calls a decision, owes a note; /studio note pays it', async ($, on) => {
  const w = world()
  const clock = await director($, on, w)
  w.tokens = 700_000
  await turn($, clock, 'start G5 stage 5 on Opus', () =>
    $.tool.call({ tool: 'mcp__ccd_session__start_session', model: 'claude-opus-5-5', effort: 'medium', title: 'G5 stage 5', initiation: 'user_asked' } as never),
  )
  await clock.advance(RESET_DELAY_MS)
  expect(w.ran).toEqual([])
  const me = (await $.command.run({ command: 'studio', args: 'me', origin: { kind: 'composer' } } as never)) as { text: string }
  expect(me.text).toContain('note owed since 2026-11-15T10:00:')
  expect(me.text).toContain(': started a chat')
  await $.command.run({ command: 'studio', args: 'note G5 stage 5 started on Opus medium.', origin: { kind: 'composer' } } as never)
  await turn($, clock, 'good')
  await clock.advance(RESET_DELAY_MS)
  expect(w.ran.map(r => r.command)).toEqual(['clear'])

  // the decision check: the user's own words decide something
  w.label = 'user-decides-or-approves'
  w.tokens = 700_000
  await turn($, clock, 'From now on Vault waits until G5 is done.')
  await clock.advance(RESET_DELAY_MS)
  expect(w.ran.length).toBe(1)
  await turn($, clock, 'and?', () => $.tool.call({ tool: 'Edit', file_path: NOTES, old_string: '', new_string: '- 2026-11-15 10:09: Vault waits for G5.\n' } as never))
  expect(w.prompts.at(-1)?.context[1]).toContain('your prompt decided something')
})

test('a /clear refused here falls back to /compact with its instructions', async ($, on) => {
  const w = world()
  w.refuse = ['clear']
  const clock = await director($, on, w)
  w.tokens = 685_000
  await turn($, clock, 'one')
  await clock.advance(RESET_DELAY_MS)
  expect(w.ran.map(r => `${r.command} ${r.args}`.trim())).toEqual(['clear', `compact ${COMPACT_ARGS}`])
  expect(w.notices[0]).toContain('compacted its chat (context passed 600k tokens; 685k → 9k tokens)')
})

test("smart-compact never compacts right after the reset; the user's own /compact always runs", async ($, on) => {
  const w = world()
  const clock = await director($, on, w)
  w.tokens = 685_000
  await turn($, clock, 'one')
  await clock.advance(RESET_DELAY_MS)
  expect(w.ran.length).toBe(1)
  // smart-compact's offer, clicked after the reset: its queued /compact and its $.session.compact
  const skipped = (await $.command.run({ command: 'compact', args: '', origin: { kind: 'plugin', name: 'smart-compact' } } as never)) as { text: string }
  expect(skipped.text).toBe(SKIP_TWICE)
  const vetoed = (await $.session.compact({ trigger: 'plugin', messages: ONE } as never)) as { skip?: string }
  expect(vetoed.skip).toBe(SKIP_TWICE)
  expect(w.compacted).toEqual([])
  // the user's own /compact runs
  await $.command.run({ command: 'compact', args: '', origin: { kind: 'composer' } } as never)
  expect(w.ran.at(-1)).toEqual({ command: 'compact', args: '', origin: 'composer' })
  // after a turn, smart-compact may compact again
  w.tokens = 20_000
  await turn($, clock, 'two')
  await $.session.compact({ trigger: 'plugin', messages: ONE } as never)
  expect(w.compacted).toEqual(['plugin'])
  // and a compaction first (smart-compact's auto request) leaves the studio reset nothing to do
  w.tokens = 690_000
  await turn($, clock, 'three')
  await $.session.compact({ trigger: 'plugin', messages: ONE } as never)
  await clock.advance(RESET_DELAY_MS)
  expect(w.ran.filter(r => r.command === 'clear').length).toBe(1)
})

test('a director whose state lost its mark is found again by its app id', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, { directors: { local_dir: '2026-11-15T09:00:00.000Z' } })
  const w = world()
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  expect(await sectionIds($ as never)).toEqual(['intro', 'studio:director'])
  await turn($, clock, 'where do we stand?')
  expect(w.prompts.at(-1)?.context[0]).toContain('<studio-snapshot kind="full"')
})

// ---------------------------------------------------------------- the carry-over (user, 2026-11-18)

test('the carry-over keeps the last requests and the end of the last reply', () => {
  let asks: string[] = []
  for (const t of ['review the 13 blue chats', 'go on', '', 'continue', 'and the last ones']) asks = pushAsk(asks, t)
  expect(asks).toEqual(['go on', 'continue', 'and the last ones'].slice(-CARRY_ASKS))
  expect(pushAsk([], 'x'.repeat(2000))[0]?.length).toBe(700)
  const long = `${'a'.repeat(5000)} left: Haggler and Vault v2`
  expect(replyTail(long).length).toBe(CARRY_REPLY_CHARS)
  expect(replyTail(long).endsWith('left: Haggler and Vault v2')).toBe(true)
  const block = carryBlock({ at: '2026-11-18T09:00:00Z', kind: 'size', asks: ['review the 13 blue chats', 'go on'], reply: 'Done 6 of 13.', recap: '6 reviewed' })
  expect(block).toContain('<studio-carry at="2026-11-18T09:00:00Z">')
  expect(block).toContain('- review the 13 blue chats')
  expect(block).toContain('Your last recap: 6 reviewed')
  expect(block).toContain('The end of your last reply:\nDone 6 of 13.')
  expect(block).toContain('carry on from where it stopped')
})

test('a reset carries the thread: the first prompt after it gets the last requests and the reply, the next one does not', async ($, on) => {
  const w = world()
  const clock = await director($, on, w)
  await turn($, clock, 'review the 13 blue chats')
  w.tokens = 650_000
  await turn($, clock, 'go on with the rest')
  await clock.advance(RESET_DELAY_MS)
  expect(w.ran).toEqual([{ command: 'clear', args: '', origin: 'plugin:studio' }])
  w.tokens = 12_000
  await turn($, clock, 'continue')
  const first = (w.prompts.at(-1)?.context ?? []).find(x => x.includes('<studio-carry'))
  expect(first).toContain('- review the 13 blue chats')
  expect(first).toContain('- go on with the rest')
  expect(first).toContain('The end of your last reply:\nDone.')
  expect(first).not.toContain('- continue') // the new prompt is the prompt itself
  await turn($, clock, 'thanks')
  expect((w.prompts.at(-1)?.context ?? []).some(x => x.includes('<studio-carry'))).toBe(false)
})
