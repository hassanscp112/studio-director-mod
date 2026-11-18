// Studio Director, stage 11: the leads (docs/STUDIO_DIRECTOR.md §5.14, docs/studio/leads.md).
// Pure functions, no engine calls: leads.md read into leads, each board row placed
// under its lead (who started it, followed up the chain, or the adopted ids of §8),
// and the board by lead as text.
import type { AppSession, BoardFilter, BoardGroups, BoardRow, Lead, LeadBoard, LeadGroup } from '../types'

/** Where the leads' charter lives, under the checkout. */
export const LEADS_FILE = 'docs/studio/leads.md'
/** How far up a chain of starters a chat is followed (a cycle or a long chain stops here). */
export const MAX_HOPS = 20

const ID = /local_[0-9a-f-]{36}/g

/** The text of one `## N.` section, up to the next `## `; '' when there is none. */
function section(md: string, n: number): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex(l => new RegExp(`^##\\s+${n}\\.`).test(l))
  if (start < 0) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(l => /^##\s/.test(l))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}

const key = (name: string) => name.trim().toLowerCase()

/**
 * The leads in leads.md: §7's chat-id table (name and id), its parts table (the
 * slug) and §8's adopted chats. A lead with no chat id is left out. [] when the
 * file names none (the board stays one list).
 */
export function parseLeads(md: string): Lead[] {
  const parts = section(md, 7)
  const slugs = new Map<string, string>()
  const leads: Lead[] = []
  for (const line of parts.split('\n')) {
    const id = /^\|\s*([^|]+?)\s*\|\s*`(local_[0-9a-f-]{36})`\s*\|/.exec(line)
    if (id) {
      leads.push({ name: id[1]!, slug: null, id: id[2]!, adopted: [] })
      continue
    }
    const slug = /^\|\s*([^|]+?)\s*\|\s*`([a-z0-9-]+)`\s*\|/.exec(line)
    if (slug) slugs.set(key(slug[1]!), slug[2]!)
  }
  const byName = new Map(leads.map(l => [key(l.name), l]))
  for (const l of leads) l.slug = slugs.get(key(l.name)) ?? null
  let at: Lead | null = null
  for (const line of section(md, 8).split('\n')) {
    const head = /^- \*\*(.+?):\*\*/.exec(line)
    if (head) at = byName.get(key(head[1]!)) ?? null
    else if (/^\S/.test(line)) at = null
    if (at === null) continue
    for (const id of line.match(ID) ?? []) if (id !== at.id && !at.adopted.includes(id)) at.adopted.push(id)
  }
  return leads
}

/**
 * The lead a chat sits under, by id, or null. Followed up the chain of starters
 * (`startedBy` from the app's list): the first chat on the way that is a lead, or
 * that a lead adopted, names it. A lead is its own lead.
 */
export function leadOf(id: string, startedBy: ReadonlyMap<string, string>, leads: readonly Lead[]): string | null {
  const isLead = new Set(leads.map(l => l.id))
  const adopted = new Map<string, string>()
  for (const l of leads) for (const a of l.adopted) if (!adopted.has(a)) adopted.set(a, l.id)
  const seen = new Set<string>()
  let at: string | undefined = id
  for (let hop = 0; at !== undefined && hop <= MAX_HOPS && !seen.has(at); hop++) {
    if (isLead.has(at)) return at
    const a = adopted.get(at)
    if (a !== undefined) return a
    seen.add(at)
    at = startedBy.get(at)
  }
  return null
}

const empty = (): BoardGroups => ({ waiting: [], working: [], recent: [], quiet: [] })
const GROUPS = ['waiting', 'working', 'recent', 'quiet'] as const

/** A lead's order on the board: waiting first, then working, then the rest (each kept in leads.md's order). */
const rank = (g: LeadGroup): number => (g.row?.state === 'waiting-you' ? 0 : g.row?.state === 'working' && !g.row.isStalled ? 1 : 2)

/**
 * The board by lead: every lead with its own row and its chats, then the chats
 * under no lead. `sessions` null (no app list): only the adopted ids place chats.
 * Null when there are no leads.
 */
export function byLead(groups: BoardGroups, sessions: readonly AppSession[] | null, leads: readonly Lead[]): LeadBoard | null {
  if (leads.length === 0) return null
  const startedBy = new Map<string, string>()
  for (const s of sessions ?? []) if (typeof s.startedBy === 'string' && s.startedBy !== '') startedBy.set(s.id, s.startedBy)
  const out = new Map<string, LeadGroup>(leads.map(l => [l.id, { lead: l, row: null, chats: empty() }]))
  const rest = empty()
  for (const g of GROUPS) {
    for (const r of groups[g]) {
      const mine = out.get(r.id)
      if (mine !== undefined) {
        mine.row = r
        continue
      }
      const lead = leadOf(r.id, startedBy, leads)
      const at = lead === null ? undefined : out.get(lead)
      if (at === undefined) rest[g].push(r)
      else at.chats[g].push(r)
    }
  }
  const order = [...out.values()]
  const pos = new Map(leads.map((l, i) => [l.id, i]))
  order.sort((a, b) => rank(a) - rank(b) || (pos.get(a.lead.id) ?? 0) - (pos.get(b.lead.id) ?? 0))
  return { leads: order, rest }
}

/** The lead group of one chat id (a lead's own view), or null. */
export function leadGroupOf(board: LeadBoard | null | undefined, leadId: string | null): LeadGroup | null {
  if (!board || leadId === null) return null
  return board.leads.find(g => g.lead.id === leadId) ?? null
}

export const countOf = (g: BoardGroups): number => g.waiting.length + g.working.length + g.recent.length + g.quiet.length

/** `9 chats: 3 waiting, 1 working, 5 idle`; `no chats`. */
export function chatsLine(g: BoardGroups): string {
  const n = countOf(g)
  if (n === 0) return 'no chats'
  const parts: string[] = []
  if (g.waiting.length > 0) parts.push(`${g.waiting.length} waiting`)
  if (g.working.length > 0) parts.push(`${g.working.length} working`)
  const idle = g.recent.length + g.quiet.length
  if (idle > 0) parts.push(`${idle} idle`)
  return `${n} chat${n === 1 ? '' : 's'}: ${parts.join(', ')}`
}

/** `11 leads: 3 waiting, 7 working, 1 idle`. */
export function leadsLine(b: LeadBoard): string {
  const n = b.leads.length
  const waiting = b.leads.filter(g => rank(g) === 0).length
  const working = b.leads.filter(g => rank(g) === 1).length
  const parts = [waiting > 0 ? `${waiting} waiting` : '', working > 0 ? `${working} working` : '', n - waiting - working > 0 ? `${n - waiting - working} idle` : ''].filter(p => p !== '')
  return `${n} lead${n === 1 ? '' : 's'}: ${parts.join(', ')}`
}

/** Does a row pass the board filter (as `filterGroups` keeps rows)? */
export function passes(r: BoardRow, filter: BoardFilter): boolean {
  if (filter === 'needs-me') return r.state === 'waiting-you'
  if (filter === 'working') return r.state === 'working' && !r.isStalled
  if (filter === 'fresh') return r.isFresh
  return true
}

/**
 * The board by lead under a filter: each lead's chats filtered; a lead stays
 * when its own row or one of its chats passes (or under "all").
 */
export function filterLeads(b: LeadBoard, filter: BoardFilter, filterGroups: (g: BoardGroups, f: BoardFilter) => BoardGroups): LeadBoard {
  if (filter === 'all') return b
  const leads = b.leads
    .map(g => ({ ...g, chats: filterGroups(g.chats, filter) }))
    .filter(g => (g.row !== null && passes(g.row, filter)) || countOf(g.chats) > 0)
  return { leads, rest: filterGroups(b.rest, filter) }
}
