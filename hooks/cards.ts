// Studio Director, stage 7: what the pane's cards show (docs/STUDIO_DIRECTOR.md §5.2, §5.10).
// Pure functions, no engine calls: the header's bars, the board filter, the recap
// lines a card shows, the prompts its buttons send to the director chat, the glance
// a minimized pane draws, and the kanban (columns, card files, moves).
import type { BoardFilter, BoardGroups, BoardHeader, BoardRow, BoardView, CardFile, Column } from '../types'
import { RECENT_MS, ago, contextText, modelText, msOf, plain, rowName, stateWord } from './board'
import { prettyModel } from './route'

// ---------------------------------------------------------------- the header

export type Tone = 'warning' | 'error' | undefined

/** A bar's colour: warning from 75 %, error from 90 %. */
export function toneOf(pct: number): Tone {
  return pct >= 90 ? 'error' : pct >= 75 ? 'warning' : undefined
}

export type Bar = { key: string; label: string; pct: number; valueText: string; tone: Tone }

/** The 7-day usage windows as bars (the weekly ones when there are any, as `usageLine` picks them). */
export function usageBars(h: BoardHeader): Bar[] {
  if (h.usage === null || h.usage.length === 0) return []
  const weekly = h.usage.filter(w => /week/i.test(w.label))
  const shown = weekly.length > 0 ? weekly : h.usage
  return shown.map((w, i) => ({
    key: `usage-${i}`,
    label: w.label.replace(/^Weekly\s*·\s*/i, 'Week · '),
    pct: w.pct,
    valueText: `${w.pct} %${w.resetsIn ? ` · resets in ${w.resetsIn}` : ''}`,
    tone: toneOf(w.pct),
  }))
}

/** `4 waiting · 1 working · week 37 %`: what a minimized pane says. */
export function glance(v: BoardView): string {
  const parts = [`${v.groups.waiting.length} waiting`, `${v.groups.working.length} working`]
  const week = usageBars(v.header)[0]
  if (week) parts.push(`week ${week.pct} %`)
  return parts.join(' · ')
}

// ---------------------------------------------------------------- the board

export const FILTERS: ReadonlyArray<{ value: BoardFilter; label: string }> = [
  { value: 'all', label: 'All chats' },
  { value: 'needs-me', label: 'Needs me' },
  { value: 'working', label: 'Working' },
  { value: 'fresh', label: 'Fresh chat due' },
]

export function readFilter(value: string): BoardFilter {
  return FILTERS.some(f => f.value === value) ? (value as BoardFilter) : 'all'
}

/** The groups a filter leaves: `needs-me` the waits, `working` the working, `fresh` every chat past the fresh-chat line. */
export function filterGroups(g: BoardGroups, filter: BoardFilter): BoardGroups {
  if (filter === 'needs-me') return { waiting: g.waiting, working: [], recent: [], quiet: [] }
  if (filter === 'working') return { waiting: [], working: g.working, recent: [], quiet: [] }
  if (filter === 'fresh') {
    const due = (rows: readonly BoardRow[]) => rows.filter(r => r.isFresh)
    return { waiting: due(g.waiting), working: due(g.working), recent: due(g.recent), quiet: due(g.quiet) }
  }
  return g
}

/** The board's Recent group shows this many cards; a button unfolds the older ones. */
export const RECENT_SHOWN = 8

/** The recap's first `n` lines that say something, plain. */
export function recapLines(recap: string, n = 3): string[] {
  const lines = recap
    .split(/\r?\n/)
    .map(l => plain(l.replace(/^\s*[-*]\s+/, '')))
    .filter(l => l !== '')
  return n <= 0 ? lines : lines.slice(0, n)
}

/** A card's state and how long it has held: `waiting 18h`, `working 1h`, `idle 14m`. */
export function cardAge(r: BoardRow, now: number): string {
  if (r.state === 'waiting-you') return `waiting ${ago(now - msOf(r.since))}`
  if (r.state === 'working' && !r.isStalled) return `working ${ago(now - msOf(r.since))}`
  return `${stateWord(r)} ${ago(now - msOf(r.updatedAt))}`
}

/** A card's dim line of facts: model, effort and turn class, the last commit. */
export function cardFacts(r: BoardRow): string {
  const parts: string[] = []
  const m = modelText(r)
  if (m !== '') parts.push(m)
  if (r.lastCommit) parts.push(`commit ${r.lastCommit.hash.slice(0, 7)} ${plain(r.lastCommit.subject)}`)
  return parts.join(' · ')
}

/**
 * The chat that is the director, when the board has one: the row `/director` tagged,
 * or one of the app ids the mod's store holds as directors (a `/clear` can drop the tag).
 */
export function directorRow(g: BoardGroups, tag: string, ids: readonly string[] = []): BoardRow | null {
  for (const rows of [g.waiting, g.working, g.recent, g.quiet]) {
    const r = rows.find(x => x.tag === tag || ids.includes(x.id))
    if (r) return r
  }
  return null
}

/** The header's git facts as two short lines: the counts (docs/studio/ left out), and the last commit. */
export function gitFacts(h: BoardHeader): { counts: string; last: string } {
  const u = h.uncommitted
  return {
    counts: u === null ? 'uncommitted: unknown' : `${u.changed + u.untracked} uncommitted · ${u.changed} changed · ${u.untracked} new`,
    last: h.lastCommit ? `last commit ${h.lastCommit.hash} ${plain(h.lastCommit.subject)}` : 'last commit unknown',
  }
}

export type ModelGroup = { model: string; rows: Array<{ key: string; name: string; facts: string; isCapped: boolean }> }

const MODEL_ORDER = ['fable', 'opus', 'sonnet', 'haiku']

/**
 * The Models tab: the chats grouped by the model they run on, the dearest model
 * first, each chat with its effort and last turn class. Quiet chats are left out.
 */
export function modelGroups(g: BoardGroups): ModelGroup[] {
  const groups = new Map<string, ModelGroup>()
  for (const r of [...g.waiting, ...g.working, ...g.recent]) {
    if (r.isUnreported) continue
    const model = r.model ? prettyModel(r.model) : 'Model unknown'
    const facts = [r.effort, r.turnClass ? `turn: ${r.turnClass}` : ''].filter(x => x !== '').join(' · ')
    const group = groups.get(model) ?? { model, rows: [] }
    group.rows.push({ key: r.id, name: rowName(r), facts, isCapped: r.isCapped })
    groups.set(model, group)
  }
  const rank = (m: string) => {
    const i = MODEL_ORDER.findIndex(f => m.toLowerCase().includes(f))
    return i < 0 ? MODEL_ORDER.length : i
  }
  return [...groups.values()].sort((a, b) => rank(a.model) - rank(b.model) || a.model.localeCompare(b.model))
}

// ---------------------------------------------------------------- prompts the buttons send

/** "Brief me": the director reads that chat and reports. */
export function briefPrompt(r: BoardRow): string {
  return (
    `Brief me on "${rowName(r)}" [${r.id}]: read its transcript, then tell me what it did last, what it is waiting on, ` +
    'and your recommendation. Check the commit or diff it points to before you call anything done.'
  )
}

/** "Answer: <label>": the director passes the user's choice on, quoting it (D4). */
export function answerPrompt(r: BoardRow, label: string): string {
  const question = r.ask ? plain(r.ask.question) : ''
  return (
    `"${rowName(r)}" [${r.id}] is waiting on me${question ? `: "${question}"` : ''}. My answer: "${label}". ` +
    'Pass it on to that chat now, quoting my answer word for word, then write the note.'
  )
}

/** A send from the pane that started no turn stops holding the buttons after this long. */
export const SENT_MS = 60_000

/**
 * What the director is answering, when the pane must not send again: the prompt the
 * pane sent (until its turn ends, or SENT_MS when no turn came of it), or any turn
 * the chat is running. Null: the buttons and the field are live.
 */
export function busyWith(sent: { text: string; at: number } | null, isWorking: boolean, now: number): string | null {
  if (sent !== null && (isWorking || now - sent.at < SENT_MS)) return plain(sent.text)
  return isWorking ? 'a turn in the chat' : null
}

// ---------------------------------------------------------------- notes

/** The last `n` note lines of notes.md, oldest first. */
export function notesTail(notes: string | null, n = 15): string[] {
  if (notes === null) return []
  return notes
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(l => /^\s*[-*] /.test(l))
    .slice(-n)
}

// ---------------------------------------------------------------- the kanban

export const CARDS_DIR = 'cards'
export const COLUMNS: readonly Column[] = ['planned', 'building', 'waiting', 'review', 'done']
export const COLUMN_TITLES: Record<Column, string> = {
  planned: 'Planned',
  building: 'Building',
  waiting: 'Waiting on you',
  review: 'Review',
  done: 'Done',
}
/** The columns a narrow pane keeps side by side; the other two fold under them. */
export const NARROW_COLUMNS: readonly Column[] = ['building', 'waiting', 'review']
/** From this many body columns the kanban shows all five side by side. */
export const WIDE_COLUMNS = 100
/** The Done column shows this many cards; the rest are a count. */
export const DONE_SHOWN = 5

const isColumn = (x: unknown): x is Column => typeof x === 'string' && (COLUMNS as readonly string[]).includes(x)

/** One card file's text, or null for a file caught halfway through a write or of another shape. */
export function parseCard(text: string): CardFile | null {
  let x: unknown
  try {
    x = JSON.parse(text)
  } catch {
    return null
  }
  const c = x as Partial<CardFile> | null
  if (c === null || typeof c !== 'object') return null
  if (typeof c.id !== 'string' || c.id === '' || typeof c.title !== 'string') return null
  return {
    schema: 1,
    id: c.id,
    title: c.title,
    rowId: typeof c.rowId === 'string' ? c.rowId : null,
    pin: isColumn(c.pin) ? c.pin : null,
    createdAt: typeof c.createdAt === 'string' ? c.createdAt : '',
    updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : '',
    ...(typeof c.under === 'string' && c.under !== '' ? { under: c.under } : {}),
  }
}

/** A card file's text: keys always in this order, pretty-printed, so git diffs stay readable. */
export function serializeCard(c: CardFile): string {
  const ordered: CardFile = { schema: 1, id: c.id, title: c.title, rowId: c.rowId, pin: c.pin, createdAt: c.createdAt, updatedAt: c.updatedAt, ...(c.under ? { under: c.under } : {}) }
  return `${JSON.stringify(ordered, null, 2)}\n`
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)

/** The id of the card that stands for a chat: one per chat, so a second pin rewrites the first. */
export const rowCardId = (rowId: string): string => `row-${safe(rowId)}`

/** A hand-made card's id: its time and a few letters of its title. */
export function newCardId(title: string, at: number): string {
  return `card-${at.toString(36)}-${safe(title.toLowerCase()).slice(0, 24) || 'card'}`
}

export const cardFileName = (id: string): string => `${safe(id)}.json`

/** A card added by hand: it starts in Planned, under a milestone when it is a planned stage (stage 10). */
export function newCard(title: string, at: number, under: string | null = null): CardFile {
  const iso = new Date(at).toISOString()
  const text = title.replace(/\s+/g, ' ').trim()
  return { schema: 1, id: newCardId(text, at), title: text, rowId: null, pin: 'planned', createdAt: iso, updatedAt: iso, ...(under ? { under } : {}) }
}

/**
 * The column a chat's own state puts it in: waiting and working are live and win
 * over any pin; an idle chat with a commit in the last 72 h is up for review ("a
 * report is a claim"); any other idle chat is off the kanban until it is pinned.
 */
export function autoColumn(r: BoardRow, now: number): Column | null {
  if (r.state === 'waiting-you') return 'waiting'
  if (r.state === 'working' && !r.isStalled) return 'building'
  if (r.lastCommit && now - msOf(r.lastCommit.at) <= RECENT_MS) return 'review'
  return null
}

export type KanbanItem = {
  /** The card's address in the pane: the chat's card id, or the hand-made card's id. */
  key: string
  title: string
  fact: string
  column: Column
  /** Its chat is working or waiting now: the state holds the column, so it can't be moved. */
  isLive: boolean
  isPinned: boolean
  rowId: string | null
  /** For sorting: epoch ms. */
  at: number
}

export type Kanban = Record<Column, KanbanItem[]>

/**
 * The kanban: every chat its state or a pin puts on it, and every hand-made card.
 * Waiting is oldest first (as the board); the other columns newest first.
 */
export function kanban(v: BoardView, cards: readonly CardFile[]): Kanban {
  const k: Kanban = { planned: [], building: [], waiting: [], review: [], done: [] }
  const now = v.at
  const pins = new Map<string, CardFile>()
  for (const c of cards) if (c.rowId !== null) pins.set(c.rowId, c)
  const seen = new Set<string>()
  for (const r of [...v.groups.waiting, ...v.groups.working, ...v.groups.recent, ...v.groups.quiet]) {
    if (r.isUnreported) continue
    seen.add(r.id)
    const auto = autoColumn(r, now)
    const isLive = auto === 'waiting' || auto === 'building'
    const pin = pins.get(r.id)?.pin ?? null
    const column = isLive ? auto : (pin ?? auto)
    if (column === null) continue
    const fact =
      column === 'waiting'
        ? plain(r.ask?.question ?? 'needs you')
        : column === 'building'
          ? `${ago(now - msOf(r.since))} · ${modelText(r) || contextText(r, false)}`
          : r.lastCommit
            ? `${r.lastCommit.hash.slice(0, 7)} ${plain(r.lastCommit.subject)}`
            : `${stateWord(r)} ${ago(now - msOf(r.updatedAt))}`
    k[column].push({
      key: rowCardId(r.id),
      title: rowName(r),
      fact,
      column,
      isLive,
      isPinned: !isLive && pin !== null,
      rowId: r.id,
      at: column === 'waiting' ? msOf(r.since) : msOf(r.updatedAt),
    })
  }
  for (const c of cards) {
    // a pinned chat the board no longer lists (archived) keeps its card where it was put
    if (c.rowId !== null && seen.has(c.rowId)) continue
    const column = c.pin ?? 'planned'
    k[column].push({ key: c.id, title: plain(c.title) || '(untitled)', fact: c.rowId === null ? '' : 'chat no longer listed', column, isLive: false, isPinned: true, rowId: c.rowId, at: msOf(c.updatedAt) })
  }
  for (const col of COLUMNS) k[col].sort((a, b) => (col === 'waiting' ? a.at - b.at : b.at - a.at))
  return k
}

/** The column one step left (-1) or right (+1); null at either end. */
export function shift(column: Column, dir: -1 | 1): Column | null {
  const i = COLUMNS.indexOf(column) + dir
  return COLUMNS[i] ?? null
}

/** The card file a move writes: the chat's card (made on its first pin) or the hand-made card, pinned to `to`. */
export function pinned(item: KanbanItem, cards: readonly CardFile[], to: Column, at: number): CardFile {
  const iso = new Date(at).toISOString()
  const prev = cards.find(c => c.id === item.key) ?? null
  if (prev) return { ...prev, pin: to, updatedAt: iso }
  return { schema: 1, id: item.key, title: item.title, rowId: item.rowId, pin: to, createdAt: iso, updatedAt: iso }
}
