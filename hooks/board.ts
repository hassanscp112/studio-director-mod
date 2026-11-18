// Studio Director, stage 2: the board (docs/STUDIO_DIRECTOR.md §5.2).
// Pure functions, no engine calls: rows in, groups and text out, so the tests
// can drive every rule with plain values.
import { prettyModel } from './route'
import type { AppSession, Ask, BoardGroups, BoardHeader, BoardRow, BoardView, Commit, Report, UsageWindow } from '../types'

/** Context at or over this many tokens marks a chat "time for a fresh chat" (user, 2026-11-14). */
export const FRESH_TOKENS = 400_000
/** A `working` row with no write for this long is a chat that died mid-turn. */
export const STALL_MS = 2 * 3_600_000
/** Idle or stopped chats newer than this are Recent; older ones are Quiet. */
export const RECENT_MS = 72 * 3_600_000
/** A wait older than this is never toasted (the first poll after an install stays quiet). */
export const TOAST_MAX_AGE_MS = 24 * 3_600_000
/** Toast records older than this are dropped from the store. */
export const TOAST_KEEP_MS = 7 * 24 * 3_600_000

const STATES = new Set(['working', 'waiting-you', 'idle', 'stopped'])

/** One report file's text, or null for a file caught halfway through a write (read again next time). */
export function parseRow(text: string): Report | null {
  let x: unknown
  try {
    x = JSON.parse(text)
  } catch {
    return null
  }
  const r = x as Partial<Report> | null
  if (r === null || typeof r !== 'object') return null
  if (typeof r.cliId !== 'string' || typeof r.state !== 'string' || !STATES.has(r.state)) return null
  if (typeof r.stateSince !== 'string' || typeof r.updatedAt !== 'string') return null
  return r as Report
}

const time = (iso: string | undefined): number => {
  const t = Date.parse(iso ?? '')
  return Number.isFinite(t) ? t : 0
}

/** `[text](#local_…)` → `text`; newlines folded; for one-line display. */
export function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The recap's first line (up to its first line break), plain. */
export function firstLine(recap: string): string {
  return plain((recap.split(/\r?\n/)[0] ?? '').trim())
}

/** `3m`, `5h`, `2d 4h`; under a minute is `now`. */
export function ago(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  const rest = h % 24
  return rest === 0 ? `${d}d` : `${d}d ${rest}h`
}

export function tokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

/** The row's name: `G3e · title` when the title doesn't already open with the tag. */
export function rowName(r: Pick<BoardRow, 'tag' | 'title'>): string {
  const title = plain(r.title) || '(untitled)'
  if (r.tag === null || r.tag === '' || title.toLowerCase().startsWith(r.tag.toLowerCase())) return title
  return `${r.tag} · ${title}`
}

/** The app's `list_sessions` JSON (archived ones left out by the call), or null when unreadable. */
export function readSessions(text: string): AppSession[] | null {
  try {
    const x = JSON.parse(text) as unknown
    if (!Array.isArray(x)) return null
    return (x as Array<Record<string, unknown>>)
      .filter(s => typeof s?.sessionId === 'string' && s.isArchived !== true)
      .map(s => ({
        id: String(s.sessionId),
        title: typeof s.title === 'string' ? s.title : '',
        cwd: typeof s.cwd === 'string' ? s.cwd : '',
        isRunning: s.isRunning === true,
        lastActivityAt: typeof s.lastActivityAt === 'string' ? s.lastActivityAt : '',
        startedBy: typeof s.startedBy === 'string' ? s.startedBy : null,
      }))
  } catch {
    return null
  }
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** A chat of this project: its folder is the checkout or one inside it (a worktree). */
export function isProjectDir(cwd: string, root: string): boolean {
  const c = norm(cwd)
  const r = norm(root)
  return r !== '' && (c === r || c.startsWith(`${r}/`))
}

/**
 * The reports with the app's list laid over them (§9.2: rows from `list_sessions`,
 * filtered to this project): a report of a chat the app no longer lists (archived or
 * deleted) is dropped, and a project chat with no report gets a row of its own, so
 * the board holds every open chat. `sessions` null (no app, or the call failed):
 * the reports alone. This chat is never in the app's list, so its report stays.
 * `isCut`: the list stopped at its limit (most recent first), so a report older
 * than its oldest row may simply be past the cut: it is kept.
 */
export function withSessions(reports: readonly Report[], sessions: readonly AppSession[] | null, root: string, selfCliId: string, isCut = false): Report[] {
  if (sessions === null) return [...reports]
  const mine = sessions.filter(s => isProjectDir(s.cwd, root))
  const listed = new Set(mine.map(s => s.id))
  const times = sessions.map(s => time(s.lastActivityAt)).filter(t => t > 0)
  const oldest = isCut && times.length > 0 ? Math.min(...times) : -Infinity
  const isGone = (r: Report) => !listed.has(r.appId ?? '') && time(r.updatedAt) >= oldest
  const kept = reports.filter(r => r.cliId === selfCliId || r.appId === null || r.appId === undefined || !isGone(r))
  const reported = new Set(kept.map(r => r.appId))
  for (const s of mine) {
    if (reported.has(s.id)) continue
    kept.push({
      ...UNREPORTED,
      appId: s.id,
      title: s.title,
      stateSince: s.lastActivityAt,
      updatedAt: s.lastActivityAt,
      cwd: s.cwd,
    })
  }
  return kept
}

/** The fields of a row made from the app's list; `cliId` marks it. */
const UNREPORTED: Report = {
  schema: 2,
  appId: null,
  cliId: '(unreported)',
  title: '',
  tag: null,
  tagSource: null,
  state: 'idle',
  stateSince: '',
  updatedAt: '',
  turns: 0,
  recap: '',
  ask: null,
  lastCommit: null,
  context: null,
  model: '',
  effort: '',
  turnClass: null,
  classMs: null,
  routings: [],
  cwd: '',
}

function toRow(r: Report, now: number, selfCliId: string): BoardRow {
  const isStalled = r.state === 'working' && now - time(r.updatedAt) > STALL_MS
  return {
    id: r.appId ?? `cli-${r.cliId}`,
    tag: r.tag ?? null,
    title: typeof r.title === 'string' ? r.title : '',
    state: r.state,
    since: r.stateSince,
    updatedAt: r.updatedAt,
    ask: r.ask ?? null,
    recap: typeof r.recap === 'string' ? r.recap : '',
    lastCommit: r.lastCommit ?? null,
    context: r.context ?? null,
    isStalled,
    isFresh: (r.context?.tokens ?? 0) >= FRESH_TOKENS,
    isSelf: r.cliId === selfCliId,
    isUnreported: r.cliId === UNREPORTED.cliId,
    model: typeof r.model === 'string' ? r.model : '',
    effort: typeof r.effort === 'string' ? r.effort : '',
    turnClass: typeof r.turnClass === 'string' ? r.turnClass : null,
    isCapped: Array.isArray(r.routings) && r.routings.at(-1)?.isCapped === true,
  }
}

/** A row's state as the board says it. */
export function stateWord(r: BoardRow): string {
  if (r.isUnreported) return 'no report yet, last active'
  if (r.isStalled) return 'stalled (likely died mid-turn)'
  return r.state
}

/**
 * Sorts reports into the board's four groups. Headless runs (`appId: null`) are
 * left out. A stalled `working` row goes to Recent, marked.
 */
export function groupRows(reports: readonly Report[], now: number, selfCliId = ''): BoardGroups {
  const g: BoardGroups = { waiting: [], working: [], recent: [], quiet: [] }
  for (const r of reports) {
    if (r.appId === null || r.appId === undefined) continue
    const row = toRow(r, now, selfCliId)
    if (row.state === 'waiting-you') g.waiting.push(row)
    else if (row.state === 'working' && !row.isStalled) g.working.push(row)
    else if (now - time(row.updatedAt) <= RECENT_MS) g.recent.push(row)
    else g.quiet.push(row)
  }
  const oldest = (a: BoardRow, b: BoardRow) => time(a.since) - time(b.since)
  const newest = (a: BoardRow, b: BoardRow) => time(b.updatedAt) - time(a.updatedAt)
  g.waiting.sort(oldest)
  g.working.sort(oldest)
  g.recent.sort(newest)
  g.quiet.sort(newest)
  return g
}

/** `get_usage`'s plan windows, or null where plan limits don't apply or can't be read. */
export function readPlan(text: string): UsageWindow[] | null {
  try {
    const x = JSON.parse(text) as { plan?: { status?: unknown; windows?: unknown } }
    if (x.plan?.status === 'not_applicable') return []
    if (x.plan?.status !== 'ok' || !Array.isArray(x.plan.windows)) return null
    return (x.plan.windows as Array<{ label?: unknown; percentUsed?: unknown; resetsIn?: unknown }>)
      .filter(w => typeof w?.label === 'string' && typeof w.percentUsed === 'number')
      .map(w => ({ label: String(w.label), pct: Number(w.percentUsed), resetsIn: typeof w.resetsIn === 'string' ? w.resetsIn : '' }))
  } catch {
    return null
  }
}

/**
 * Counts `git status --porcelain=v1 -z` entries outside docs/studio/ (§5.8: the
 * count means other chats' work), as `git status` shows them: a new folder is one
 * entry. A rename's second path is its source, not another file.
 */
export function countUncommitted(z: string, studioDir = 'docs/studio'): { changed: number; untracked: number } {
  const parts = z.split('\0')
  const n = { changed: 0, untracked: 0 }
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i] ?? ''
    if (entry.length < 4) continue
    const code = entry.slice(0, 2)
    const path = entry.slice(3).replace(/\/$/, '')
    if (code.includes('R') || code.includes('C')) i++
    if (path === studioDir || path.startsWith(`${studioDir}/`)) continue
    if (code === '??') n.untracked++
    else n.changed++
  }
  return n
}

/** `git log -1 --format=%h%x1f%s%x1f%cI`, or null. */
export function readLastCommit(out: string | null): Commit | null {
  if (out === null) return null
  const [hash = '', subject = '', at = ''] = out.trim().split('\x1f')
  return hash === '' ? null : { hash, subject, at }
}

// ---- the text board (/studio, and the lines the pane draws) ----

export function usageLine(h: BoardHeader): string {
  if (h.usage === null) return '7-day usage: unavailable'
  if (h.usage.length === 0) return '7-day usage: no plan limits here'
  const weekly = h.usage.filter(w => /week/i.test(w.label))
  const shown = weekly.length > 0 ? weekly : h.usage
  const parts = shown.map(w => `${w.label.replace(/^Weekly\s*·\s*/i, '')} ${w.pct} %`)
  const reset = shown[0]?.resetsIn ? ` (resets in ${shown[0].resetsIn})` : ''
  return `7-day usage: ${parts.join(' · ')}${reset}`
}

export function gitLine(h: BoardHeader): string {
  const u = h.uncommitted
  const count = u === null ? 'uncommitted: unknown' : `${u.changed + u.untracked} uncommitted: ${u.changed} changed, ${u.untracked} new (docs/studio/ left out)`
  const last = h.lastCommit ? `last commit ${h.lastCommit.hash} ${h.lastCommit.subject}` : 'last commit unknown'
  return `${count} · ${last}`
}

export function askLine(ask: Ask | null): string {
  if (ask === null) return ''
  const buttons = ask.buttons.length > 0 ? `  [${ask.buttons.join(' | ')}]` : ''
  return `${plain(ask.question)}${buttons}`
}

/** The chat's model, effort and last turn class: `Opus 5.5 high · turn: hard`; '' when none is known. */
export function modelText(r: Pick<BoardRow, 'model' | 'effort' | 'turnClass'>): string {
  const parts: string[] = []
  const m = `${r.model ? prettyModel(r.model) : ''} ${r.effort ?? ''}`.trim()
  if (m !== '') parts.push(m)
  if (r.turnClass) parts.push(`turn: ${r.turnClass}`)
  return parts.join(' · ')
}

/** The warning line for a chat whose last subagent wanted more than the chat runs on. */
export const CAPPED_LINE = "floor capped: a subagent's floor is above this chat's model (wrong row?)"

const withModel = (base: string, r: BoardRow): string => {
  const m = modelText(r)
  return m === '' ? base : `${base} · ${m}`
}

/** A Working row's facts after its name: how long, context, model. */
export function workingFacts(r: BoardRow, now: number, withFlag = true): string {
  return withModel(`${ago(now - time(r.since))} · ${contextText(r, withFlag)}`, r)
}

export function contextText(r: BoardRow, withFlag = true): string {
  if (r.context === null) return 'context ?'
  const base = `${r.context.pct} % (${tokens(r.context.tokens)})`
  return withFlag && r.isFresh ? `${base}, time for a fresh chat` : base
}

/** The facts after a Recent row's name: state and age, context, last commit. */
export function recentFacts(r: BoardRow, now: number, withFlag = true): string {
  const parts = [`${stateWord(r)} ${ago(now - time(r.updatedAt))}`]
  if (!r.isUnreported) parts.push(contextText(r, withFlag))
  if (!r.isUnreported && modelText(r) !== '') parts.push(modelText(r))
  if (r.lastCommit) parts.push(`commit ${r.lastCommit.hash.slice(0, 7)} ${r.lastCommit.subject}`)
  return parts.join(' · ')
}

const self = (r: BoardRow) => (r.isSelf ? ' (this chat)' : '')

export function quietLine(r: BoardRow, now: number): string {
  return `  ${rowName(r)} · ${stateWord(r)} ${ago(now - time(r.updatedAt))}`
}

export function boardText(v: BoardView): string {
  const { header: h, at: now } = v
  const out: string[] = ['Studio board', usageLine(h), gitLine(h), '']
  const leads = v.leads ?? null
  if (leads !== null) {
    // Stage 11: each lead with its live chats and a count of the rest; then the chats under no lead.
    out.push(`Leads (${leads.leads.length})`)
    for (const l of leads.leads) {
      const r = l.row
      const facts =
        r === null
          ? 'no report yet'
          : r.state === 'waiting-you'
          ? `waiting ${ago(now - time(r.since))}`
          : r.state === 'working' && !r.isStalled
          ? `working ${ago(now - time(r.since))}`
          : `${stateWord(r)} ${ago(now - time(r.updatedAt))}`
      out.push(`  ${l.lead.name}${r?.isSelf ? ' (this chat)' : ''} · ${facts}`)
      if (r?.state === 'waiting-you') out.push(`    ${askLine(r.ask) || '(no ask recorded)'}`)
      const n = l.chats.waiting.length + l.chats.working.length + l.chats.recent.length + l.chats.quiet.length
      const idle = l.chats.recent.length + l.chats.quiet.length
      for (const c of l.chats.waiting) out.push(`    waiting · ${rowName(c)}${self(c)} · ${ago(now - time(c.since))}: ${askLine(c.ask) || '(no ask recorded)'}`)
      for (const c of l.chats.working) out.push(`    working · ${rowName(c)}${self(c)} · ${ago(now - time(c.since))}`)
      if (n === 0) out.push('    no chats')
      else if (idle > 0) out.push(`    and ${idle} idle chat${idle === 1 ? '' : 's'}`)
    }
    out.push('', 'Under no lead')
  }
  const g = leads?.rest ?? v.groups
  out.push(`Waiting on you (${g.waiting.length})`)
  for (const r of g.waiting) {
    out.push(`  ${rowName(r)}${self(r)} · waiting ${ago(now - time(r.since))}`)
    out.push(`    ${askLine(r.ask) || '(no ask recorded)'}`)
  }
  out.push(`Working now (${g.working.length})`)
  for (const r of g.working) {
    out.push(`  ${rowName(r)}${self(r)} · ${workingFacts(r, now)}`)
    if (r.isCapped) out.push(`    ${CAPPED_LINE}`)
  }
  out.push(`Recent, last 72 h (${g.recent.length})`)
  for (const r of g.recent) {
    out.push(`  ${rowName(r)}${self(r)} · ${recentFacts(r, now)}`)
    if (r.isCapped) out.push(`    ${CAPPED_LINE}`)
    const line = firstLine(r.recap)
    if (line) out.push(`    ${line}`)
  }
  out.push(`Quiet (${g.quiet.length})`)
  for (const r of g.quiet) out.push(quietLine(r, now))
  return out.join('\n')
}

/** An ISO time in epoch ms; 0 when unreadable. */
export const msOf = time

/** Cut to `n` cells with an ellipsis. */
export function clip(text: string, n: number): string {
  const max = Math.max(4, Math.floor(n))
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

// ---- toasts ----

/** One wait's identity: the chat and when its wait began. */
export const waitKey = (r: Pick<BoardRow, 'id' | 'since'>): string => `${r.id}@${r.since}`

/**
 * The waits to toast now: not this chat's, not toasted before, and begun within
 * the last day. `seen` maps wait keys to when they were toasted.
 */
export function newWaits(g: BoardGroups, seen: Readonly<Record<string, number>>, now: number): BoardRow[] {
  return g.waiting.filter(r => !r.isSelf && seen[waitKey(r)] === undefined && now - time(r.since) <= TOAST_MAX_AGE_MS)
}

export function toastText(r: BoardRow): string {
  const who = r.tag ?? plain(r.title)
  const what = r.ask ? plain(r.ask.question) : 'needs you'
  return `${who || 'A chat'} waiting: ${what}`
}

/** The record after toasting `rows`, with entries past a week dropped. */
export function markSeen(seen: Readonly<Record<string, number>>, rows: readonly BoardRow[], now: number): Record<string, number> {
  const next: Record<string, number> = {}
  for (const [k, t] of Object.entries(seen)) if (typeof t === 'number' && now - t <= TOAST_KEEP_MS) next[k] = t
  for (const r of rows) next[waitKey(r)] = now
  return next
}
