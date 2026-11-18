// Studio Director, stage 5: the director's automatic reset (docs/STUDIO_DIRECTOR.md §5.5, D3).
// Pure functions, no engine calls: when the director chat resets, the notes check
// before it, and the lines it writes. The hooks are in register.tsx.

/**
 * Context at which the director chat resets after a turn, in tokens (user, 2026-11-15). A fresh
 * turn in this project already costs ~116k (the app's tools, skills and instructions; the board
 * is ~3k), so a line near that resets after every turn and re-buys ~58k of cache each time.
 */
export const RESET_TOKENS = 600_000
/** Away this long after a turn ends, the chat resets while the prompt cache (60 min) is still warm. */
export const IDLE_MS = 55 * 60_000
/** The prompt cache's life: a /compact timer that woke later than this (the machine slept) would read the whole chat at full price. */
export const CACHE_MS = 60 * 60_000
/** Under this an idle reset gains little: ~80k past what a fresh chat costs (~116k). */
export const IDLE_MIN_TOKENS = 200_000
/** From `turn.complete` to the queued command: the engine settles the turn first. */
export const RESET_DELAY_MS = 1_500
/** How long the end of a turn waits for the decision check on the user's prompt. */
export const DECISION_WAIT_MS = 3_000
/** `/compact`'s instructions when the reset compacts (§5.5). */
export const COMPACT_ARGS = 'keep only open questions: the board and notes hold the rest'
/** The decision check's labels: the classifier sees the labels alone, so they say what they mean. */
export const DECISION_LABELS = ['user-decides-or-approves', 'user-asks-or-chats'] as const
export const DECISION_LABEL = DECISION_LABELS[0]

export type ResetMethod = 'clear' | 'compact'
export type ResetKind = 'size' | 'idle'

/** Tools whose call acts on a decision: starting, switching or messaging a chat. */
const DECISION_TOOLS: Readonly<Record<string, string>> = {
  mcp__ccd_session__start_session: 'started a chat',
  mcp__ccd_session__hand_off_to_session: 'handed work to a chat',
  mcp__ccd_session_mgmt__set_session_model: "switched a chat's model",
  mcp__ccd_session_mgmt__set_session_effort: "switched a chat's effort",
  mcp__ccd_session_mgmt__send_message: 'messaged a chat',
  SendMessage: 'messaged a chat',
}

/** What a director tool call says about a decision, or null. */
export function decisionTool(tool: string): string | null {
  return DECISION_TOOLS[tool] ?? null
}

/** `STUDIO_RESET` (an env override for tests in the app): `clear`, `compact` or `off`; anything else is the default. */
export function readMethod(env: string | undefined, fallback: ResetMethod): ResetMethod | 'off' {
  const v = (env ?? '').trim().toLowerCase()
  return v === 'clear' || v === 'compact' || v === 'off' ? v : fallback
}

/** What the end of one director turn says. */
export type TurnFacts = {
  /** Why the turn counts as a decision (empty: it doesn't). */
  decisions: readonly string[]
  /** docs/studio/notes.md differs from the turn's start. */
  notesChanged: boolean
  /** A note was already owed from an earlier turn. */
  pendingWhy: string | null
}

/**
 * The notes check (§5.5): a decision with no note leaves one owed; a notes write
 * pays whatever was owed. Returns what is owed after this turn, or null.
 */
export function owedNote(f: TurnFacts): string | null {
  if (f.notesChanged) return null
  if (f.decisions.length > 0) return f.decisions.join('; ')
  return f.pendingWhy
}

export type ResetInput = {
  kind: ResetKind
  /** The context's tokens now; null when unknown (never resets on a guess). */
  tokens: number | null
  /** The director's last turn ended with an ask still open (a wrap-up ask). */
  hasOpenAsk: boolean
  /** A note is owed (the notes check). */
  owed: string | null
  /** No model turn since the last reset or compaction. */
  isFreshThread: boolean
  method: ResetMethod | 'off'
  /** For an idle reset: how long since the timer was armed. */
  elapsedMs?: number
}

export type ResetDecision = { isReset: true; method: ResetMethod } | { isReset: false; why: string }

/** Whether to reset now, and how. */
export function resetDecision(r: ResetInput): ResetDecision {
  if (r.method === 'off') return { isReset: false, why: 'off (STUDIO_RESET)' }
  if (r.isFreshThread) return { isReset: false, why: 'no turn since the last reset or compaction' }
  if (r.tokens === null) return { isReset: false, why: 'context unknown' }
  if (r.hasOpenAsk) return { isReset: false, why: 'an ask is open: the reset waits for the answer' }
  if (r.owed !== null) return { isReset: false, why: `a note is owed (${r.owed})` }
  if (r.kind === 'size') {
    return r.tokens >= RESET_TOKENS ? { isReset: true, method: r.method } : { isReset: false, why: `under ${RESET_TOKENS} tokens` }
  }
  if (r.tokens < IDLE_MIN_TOKENS) return { isReset: false, why: `under ${IDLE_MIN_TOKENS} tokens` }
  // A compaction reads the chat: past the cache's life it would read it at full price for no one.
  if (r.method === 'compact' && (r.elapsedMs ?? 0) >= CACHE_MS) return { isReset: false, why: 'the cache already lapsed' }
  return { isReset: true, method: r.method }
}

/** The hidden line the next prompt carries while a note is owed. */
export function noteLine(why: string): string {
  return (
    `<studio-notes-check>Your last turn took a decision (${why}) but docs/studio/notes.md did not change. ` +
    'Before anything else, append its line there (`- YYYY-MM-DD HH:MM: <the decision>`): the studio mod resets this chat once the note is written, and only the notes and the board survive a reset.</studio-notes-check>'
  )
}

const k = (n: number | null) => (n === null ? '?' : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

/** The dim transcript line after a reset (§5.5: no ask; a line says it happened). */
export function resetLine(kind: ResetKind, method: ResetMethod, before: number | null, after: number | null): string {
  const why = kind === 'size' ? `context passed ${k(RESET_TOKENS)} tokens` : 'an hour away'
  const how = method === 'clear' ? 'cleared' : 'compacted'
  return `studio: the director ${how} its chat (${why}; ${k(before)} → ${k(after)} tokens). The board and docs/studio/notes.md hold the rest; the next prompt carries the full board.`
}

/** The answer to a compaction the studio skips (smart-compact's right after a reset). */
export const SKIP_TWICE = 'studio: skipped: the director chat was just reset, and no turn has run since (no compacting twice in a row).'

// ---------------------------------------------------------------- the carry-over (user, 2026-11-18)

/** How many of the user's last prompts the carry-over keeps, and how long each may be. */
export const CARRY_ASKS = 3
export const CARRY_ASK_CHARS = 700
/** How much of the end of the director's last reply it keeps. */
export const CARRY_REPLY_CHARS = 2500

const squeeze = (t: string) => t.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

/** The user's prompts after one more: the last CARRY_ASKS, each cut to CARRY_ASK_CHARS. */
export function pushAsk(asks: readonly string[], text: string): string[] {
  const t = squeeze(text)
  if (t === '') return [...asks]
  return [...asks, t.length > CARRY_ASK_CHARS ? `${t.slice(0, CARRY_ASK_CHARS - 1)}…` : t].slice(-CARRY_ASKS)
}

/** A reply's end: its status and what is left usually close it. */
export function replyTail(reply: string): string {
  const t = squeeze(reply)
  return t.length > CARRY_REPLY_CHARS ? `…${t.slice(-(CARRY_REPLY_CHARS - 1))}` : t
}

/**
 * The hidden block the first prompt after a reset carries: what the user last asked,
 * how the director last answered, and the rule to carry unfinished work on.
 */
export function carryBlock(c: { at: string; kind: ResetKind; asks: readonly string[]; reply: string; recap: string }): string {
  const why = c.kind === 'size' ? `its context passed ${Math.round(RESET_TOKENS / 1000)}k tokens` : 'the user was away an hour'
  const lines = [
    `<studio-carry at="${c.at}">`,
    `The studio mod cleared this chat between turns (${why}). This is where the thread stood, so work spread over several prompts carries on.`,
    '',
    "The user's last requests, oldest first:",
    ...c.asks.map(a => `- ${a.replace(/\n+/g, ' ')}`),
  ]
  if (c.recap !== '') lines.push('', `Your last recap: ${c.recap}`)
  if (c.reply !== '') lines.push('', 'The end of your last reply:', c.reply)
  lines.push(
    '',
    'If that work is unfinished and the new prompt does not change course, carry on from where it stopped: the board, the cards and docs/studio/notes.md show what is already done. Say in one line that you picked the thread up.',
    '</studio-carry>',
  )
  return lines.join('\n')
}
