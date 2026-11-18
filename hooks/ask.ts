// Studio Director, stage 6: the ask box (docs/STUDIO_DIRECTOR.md §3 shape C, §7, §8).
// Pure functions, no engine calls: the box's system text, the prompt one question
// sends (the full board snapshot, the pane's last turns, the question), the turns
// the pane keeps, and the lines it draws. One `$.model.complete` per question: no
// tools, no chat history, no turn, nothing written.
import type { AskLog, AskTurn } from '../types'
import { prettyModel } from './route'

/** §7: Opus at low effort. A full id: the user's settings map the short `opus` to another model. */
export const ASK_MODEL = 'claude-opus-5-5'
export const ASK_EFFORT = 'low'
export const ASK_MAX_TOKENS = 1500
export const ASK_TIMEOUT_MS = 60_000
/** The turns kept for follow-ups ("and the other one?"; user, 2026-11-16). */
export const HISTORY_TURNS = 3
/** The kept turns' questions and answers together stay under this many characters. */
export const HISTORY_CHARS = 4000
/** A longer question is cut here. */
export const QUESTION_CHARS = 2000

export const ASK_SYSTEM = `You answer questions about Scrapshift's production in a small "ask the board" box, in the studio board pane beside a chat. Scrapshift is a Godot co-op horror game built across many Claude Code chats. The board is every chat's own report (its state, the ask it waits on, its last recap, last commit, context and model), the app's list of chats, git, the 7-day usage and the director's notes.

- The <studio-snapshot> in the message was read from files a moment ago: it is the truth. Answer from it alone and never guess past it. When it can't answer (a plan doc, a chat's transcript, a file's content, anything that needs tools), say so in one line and say to ask in the Director chat.
- You can't act: you can't start, message, link or switch chats, write files or commit, so never offer to. When something needs doing, name the chat and what it waits on.
- Name chats by their title (and tag). The pane can't open links: no [links](#...) and no app ids unless asked for.
- "Earlier in this pane" holds the last questions and answers here, for follow-ups. The snapshot is newer: where they differ, the snapshot wins.
- Keep it short: a few lines or a short list, in plain words, with times as the snapshot gives them. At most one recommendation, and only when asked what to do.`

/** The one user message: the snapshot, the pane's earlier turns (oldest first), the question. */
export function askPrompt(snapshot: string, earlier: readonly AskTurn[], question: string): string {
  const out = [snapshot.trimEnd(), '']
  if (earlier.length > 0) {
    out.push('Earlier in this pane (oldest first):')
    for (const t of earlier) out.push(`Q: ${t.q}`, `A: ${t.a.trim()}`, '')
  }
  out.push(`Question: ${question}`)
  return out.join('\n')
}

/** The question as sent: trimmed, cut at QUESTION_CHARS; '' when there is none. */
export function cleanQuestion(text: string): string {
  return text.trim().slice(0, QUESTION_CHARS)
}

/**
 * The turns a follow-up carries: answered ones only (an error line is no answer),
 * the newest HISTORY_TURNS, dropping the oldest while together they pass HISTORY_CHARS.
 */
export function earlierTurns(turns: readonly AskTurn[]): AskTurn[] {
  const kept = turns.filter(t => t.ok).slice(-HISTORY_TURNS)
  const size = (ts: readonly AskTurn[]) => ts.reduce((n, t) => n + t.q.length + t.a.length, 0)
  while (kept.length > 0 && size(kept) > HISTORY_CHARS) kept.shift()
  return kept
}

/** The pane's turns with one added: the newest HISTORY_TURNS. */
export function addTurn(turns: readonly AskTurn[], turn: AskTurn): AskTurn[] {
  return [...turns, turn].slice(-HISTORY_TURNS)
}

/** Why a call left no answer, in one line for the pane. */
export function failText(r: { reason: string; status?: number | null; error?: unknown }): string {
  if (r.reason === 'api-error') return `No answer: the API answered an error${r.status ? ` (${r.status})` : ''}${r.error ? `: ${String(r.error)}` : ''}. Try again in a moment.`
  if (r.reason === 'empty-reply') return 'No answer: the model replied with no text. Try asking again.'
  if (r.reason === 'aborted') return `No answer within ${ASK_TIMEOUT_MS / 1000} s.`
  return `No answer (${r.reason}).`
}

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

/** `HH:MM`, local. */
function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** The dim line under an answer: the model, effort, tokens and the board's time. */
export function turnLine(t: AskTurn): string {
  const tokens = t.tokensIn === null ? '' : ` · ${k(t.tokensIn)} in · ${k(t.tokensOut ?? 0)} out`
  return `${prettyModel(ASK_MODEL)} ${ASK_EFFORT}${tokens} · board read ${hhmm(t.at)}`
}

/** The ask box's turns for `/studio me`, oldest first, answers whole: the pane's own text, so it can be checked. */
export function askLines(log: AskLog): string[] {
  if (log.turns.length === 0 && log.pending === null) return ['ask box: no questions yet']
  const out = [`ask box (last ${log.turns.length}, oldest first):`]
  for (const t of log.turns) {
    out.push(`  Q: ${t.q}`, ...t.a.split(/\r?\n/).map((l, i) => `${i === 0 ? '  A: ' : '     '}${l}`), `     (${t.ok ? '' : 'no answer · '}${turnLine(t)})`)
  }
  if (log.pending !== null) out.push(`  asking now: ${log.pending.q}`)
  return out
}
