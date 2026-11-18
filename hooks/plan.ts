// Studio Director, stage 10: the plan map (docs/STUDIO_DIRECTOR.md §5.13). Pure
// functions, no engine calls. The Map tab's Plan view: "Scrapshift" in the middle,
// the milestones around it with a strip of their stages' states; a milestone's own
// view, its stages as boxes coloured by state (building, waiting on you, to review,
// done, planned). Stages are the chats on the milestone (their tag) and the cards
// planned under it. "Like MindMeister when making new plans" (the user, 2026-11-17).
import type { BoardRow, BoardView, CardFile, Column } from '../types'
import { ago, clip, msOf, plain, rowName } from './board'
import { kanban } from './cards'
import type { KanbanItem } from './cards'
import { matchPrompt, parentCode } from './graph'
import type { Graph } from './graph'
import { centerLines, fitText, textWidth } from './map'

export const PLAN_HOME = 'home'

export type PlanState = 'waiting' | 'building' | 'review' | 'planned' | 'done'

/** How urgent a state is for the user: waiting first, done last. */
export const STATE_RANK: Record<PlanState, number> = { waiting: 0, building: 1, review: 2, planned: 3, done: 4 }

export const STATE_WORD: Record<PlanState, string> = {
  waiting: 'waiting on you',
  building: 'building',
  review: 'to review',
  planned: 'planned',
  done: 'done',
}

export type PlanItem = {
  /** The item's address: its kanban key (a chat's card id, or a hand-made card's id). */
  key: string
  title: string
  state: PlanState
  /** One line: the question it waits on, its last commit, or how long it has been idle. */
  fact: string
  /** The chat (its board row id), or null for a card no chat has taken yet. */
  rowId: string | null
  /** The hand-made card, or null for a chat. */
  cardId: string | null
  /** The milestone code it sits under. */
  under: string
  /** Epoch ms, for sorting. */
  at: number
  /** The kanban's own item, for a move (Mark done). */
  kanban: KanbanItem | null
}

export type PlanMilestone = { code: string; label: string; items: PlanItem[] }

export type PlanView =
  | { kind: 'home'; label: string; milestones: PlanMilestone[]; hidden: number }
  | { kind: 'milestone'; code: string; label: string; items: PlanItem[]; pick: string | null }

/**
 * The milestone code a chat tag sits under: the tag itself when it is a milestone
 * (G5), else its parent (N1d → N1), else null (a tag outside the plan).
 */
export function codeOfTag(tag: string | null, milestones: ReadonlyMap<string, string>): string | null {
  if (tag === null) return null
  const t = tag.trim()
  if (milestones.has(t)) return t
  const p = parentCode(t)
  return p !== null && milestones.has(p) ? p : null
}

/** The area for chats that name no milestone or topic. */
export const OTHER = 'other'

/**
 * The plan's areas, key to name: MASTER_PLAN.md's milestones by code (G5), then
 * the topics by node id (topic:metro9), then "Other work". A chat sits under its
 * tag's milestone, else the milestone or topic its title names (the memory graph's
 * matcher), else Other: every chat that waits on the user is on the plan.
 */
export function planAreas(g: Graph | null): { areas: Map<string, string>; areaOf: (r: BoardRow) => string } {
  const areas = new Map<string, string>()
  if (g !== null) {
    for (const n of g.nodes.values()) if (n.kind === 'milestone') areas.set(n.id.slice('milestone:'.length), n.label)
    for (const n of g.nodes.values()) if (n.kind === 'topic') areas.set(n.id, n.label)
  }
  areas.set(OTHER, 'Other work')
  const seen = g !== null ? (AREA_CACHE.get(g) ?? new Map<string, string>()) : new Map<string, string>()
  if (g !== null) AREA_CACHE.set(g, seen)
  const areaOf = (r: BoardRow): string => {
    const code = codeOfTag(r.tag, areas)
    if (code !== null) return code
    if (g === null) return OTHER
    const memo = `${r.id}\u0000${r.tag ?? ''}\u0000${r.title}`
    const hit = seen.get(memo)
    if (hit !== undefined) return hit
    const found = matchPrompt(g, `${r.tag ?? ''} ${r.title}`, 3)
    let area = OTHER
    for (const f of found) {
      const code2 = f.id.startsWith('milestone:') ? f.id.slice('milestone:'.length) : f.id.startsWith('workstream:') ? parentCode(f.id.slice('workstream:'.length)) : null
      if (code2 !== null && areas.has(code2)) {
        area = code2
        break
      }
    }
    if (area === OTHER) area = found.find(f => f.id.startsWith('topic:'))?.id ?? OTHER
    seen.set(memo, area)
    return area
  }
  return { areas, areaOf }
}

/** One answer per chat per graph build (the matcher is not free). */
const AREA_CACHE = new WeakMap<Graph, Map<string, string>>()

/** An area named by the user or the director: its key (G5, topic:metro9), or its name in any case. */
export function findArea(areas: ReadonlyMap<string, string>, text: string): string | null {
  const t = text.trim()
  if (areas.has(t)) return t
  const low = t.toLowerCase().replace(/^the\s+/, '')
  for (const [k, label] of areas) if (label.toLowerCase().replace(/^the\s+/, '') === low || label.toLowerCase().startsWith(`${low}:`)) return k
  return null
}

const COLUMN_STATE: Record<Column, PlanState> = { planned: 'planned', building: 'building', waiting: 'waiting', review: 'review', done: 'done' }

/**
 * Every stage on the plan: each chat with a milestone tag (its kanban column, or
 * done when it is idle and off the kanban) and each card planned under a milestone.
 */
export function planItems(v: BoardView, cards: readonly CardFile[], milestones: ReadonlyMap<string, string>, areaOf: (r: BoardRow) => string | null = r => codeOfTag(r.tag, milestones)): PlanItem[] {
  const rows = new Map<string, BoardRow>()
  for (const r of [...v.groups.waiting, ...v.groups.working, ...v.groups.recent, ...v.groups.quiet]) if (!r.isUnreported) rows.set(r.id, r)
  const k = kanban(v, cards)
  const out: PlanItem[] = []
  const seen = new Set<string>()
  for (const col of ['waiting', 'building', 'review', 'planned', 'done'] as const) {
    for (const it of k[col]) {
      const row = it.rowId !== null ? rows.get(it.rowId) : undefined
      const card = it.rowId === null ? cards.find(c => c.id === it.key) : undefined
      const under = row ? areaOf(row) : card?.under && milestones.has(card.under) ? card.under : null
      if (under === null) continue
      if (it.rowId !== null) seen.add(it.rowId)
      out.push({ key: it.key, title: it.title, state: COLUMN_STATE[col], fact: it.fact, rowId: it.rowId, cardId: card ? card.id : null, under, at: it.at, kanban: it })
    }
  }
  // An idle chat off the kanban (no commit in the last 72 h, no pin) is a stage that is done.
  for (const r of rows.values()) {
    if (seen.has(r.id)) continue
    const under = areaOf(r)
    if (under === null) continue
    const fact = r.lastCommit ? `${r.lastCommit.hash.slice(0, 7)} ${plain(r.lastCommit.subject)}` : `idle ${ago(v.at - msOf(r.updatedAt))}`
    out.push({ key: `row-${r.id}`, title: rowName(r), state: 'done', fact, rowId: r.id, cardId: null, under, at: msOf(r.updatedAt), kanban: null })
  }
  return out
}

/** Stages in the order the user meets them: waiting (oldest first), then building, review, planned, done (newest first). */
export function byUrgency(a: PlanItem, b: PlanItem): number {
  return STATE_RANK[a.state] - STATE_RANK[b.state] || (a.state === 'waiting' ? a.at - b.at : b.at - a.at)
}

/** A milestone's hottest state, for sorting the home view: null when it has no stage. */
export const hottest = (items: readonly PlanItem[]): PlanState | null => (items.length === 0 ? null : [...items].sort(byUrgency)[0]?.state ?? null)

/** How many of a milestone's stages are not done. */
const liveCount = (items: readonly PlanItem[]) => items.filter(i => i.state !== 'done').length

/** Milestones the home view shows at most. */
export const HOME_MILESTONES = 10

/**
 * The plan view for a focus: home (the milestones with work that isn't done, the
 * most urgent first) or one milestone (its stages, the most urgent first).
 */
export function planView(items: readonly PlanItem[], milestones: ReadonlyMap<string, string>, focus: string, pick: string | null = null): PlanView {
  if (focus !== PLAN_HOME && milestones.has(focus)) {
    const own = items.filter(i => i.under === focus).sort(byUrgency)
    return { kind: 'milestone', code: focus, label: milestones.get(focus) ?? focus, items: own, pick: own.some(i => i.key === pick) ? pick : null }
  }
  const groups = new Map<string, PlanItem[]>()
  for (const i of items) groups.set(i.under, [...(groups.get(i.under) ?? []), i])
  const live = [...groups.entries()]
    .filter(([, list]) => list.some(i => i.state !== 'done'))
    .map(([code, list]) => ({ code, label: milestones.get(code) ?? code, items: [...list].sort(byUrgency) }))
    .sort((a, b) => STATE_RANK[hottest(a.items) ?? 'done'] - STATE_RANK[hottest(b.items) ?? 'done'] || liveCount(b.items) - liveCount(a.items) || (a.items[0]?.at ?? 0) - (b.items[0]?.at ?? 0))
  return { kind: 'home', label: 'Scrapshift', milestones: live.slice(0, HOME_MILESTONES), hidden: Math.max(0, live.length - HOME_MILESTONES) }
}

/** The jump picker: home, then every milestone with a stage on the plan (its count), then the rest of the plan's milestones. */
export function planJump(items: readonly PlanItem[], milestones: ReadonlyMap<string, string>): Array<{ value: string; label: string }> {
  const count = new Map<string, number>()
  for (const i of items) count.set(i.under, (count.get(i.under) ?? 0) + 1)
  const all = [...milestones.entries()].filter(([code]) => count.has(code) || !code.includes(':') && code !== OTHER).sort((a, b) => (count.get(b[0]) ?? 0) - (count.get(a[0]) ?? 0) || a[0].localeCompare(b[0], undefined, { numeric: true }))
  return [{ value: PLAN_HOME, label: 'Scrapshift (all milestones)' }, ...all.map(([code, label]) => ({ value: code, label: `${clip(label, 44)}${count.get(code) ? ` (${count.get(code)})` : ''}` }))]
}

/** The home view's line beside the map: how many stages wait, build, wait for review, are planned. */
export function planSummary(items: readonly PlanItem[]): string[] {
  const n = (s: PlanState) => items.filter(i => i.state === s).length
  const lines = [`${n('waiting')} waiting on you · ${n('building')} building · ${n('review')} to review · ${n('planned')} planned`]
  const first = [...items].filter(i => i.state === 'waiting').sort(byUrgency)[0]
  if (first) lines.push(`oldest wait: ${clip(first.title, 40)}: ${clip(first.fact, 70)}`)
  lines.push('Pick a milestone under the map to see its stages; plan a new stage from there, or tell the director.')
  return lines
}

/** "Start": the director prepares the planned stage's breakdown for the user's OK (CLAUDE.md: before each build), then starts its chat. */
export function startPrompt(item: PlanItem, milestone: string): string {
  return (
    `Start the planned stage "${item.title}" under ${milestone}${item.cardId ? ` [card ${item.cardId}]` : ''}: ` +
    'recall what applies, write its task breakdown and ask me to OK it. Once I do, start its chat (the start rules apply: send a part’s work to its lead; a live chat with the same tag is asked about first), ' +
    'then move the card to Done with studio_plan.'
  )
}

// ---------------------------------------------------------------- the drawing

/** Fills that read on a dark pane and on a white frame alike: light tones with their darkest text. */
export const STATE_INK: Record<PlanState, { fill: string; text: string; stroke?: string }> = {
  building: { fill: '#97C459', text: '#173404' },
  waiting: { fill: '#EF9F27', text: '#412402' },
  review: { fill: '#85B7EB', text: '#042C53' },
  done: { fill: '#B4B2A9', text: '#2C2C2A' },
  planned: { fill: 'none', text: '#9C9A92', stroke: '#9C9A92' },
}
const INK = { line: '#888780', center: '#6A61CF', milestone: '#5F5E5A', on: '#FFFFFF', pick: '#AFA9EC' } as const

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const FONT = 'font-family="system-ui, Segoe UI, sans-serif"'
const MIN_WIDTH = 440
const EDGE = 8
const BOX_W = 150
const LEGEND_H = 26

/** A box's text: one line at 13 px when it fits, else two balanced lines at 12 px (cut only past that). */
export function boxLines(text: string, room: number): { lines: string[]; size: number } {
  if (textWidth(text, 13) <= room) return { lines: [text], size: 13 }
  return { lines: centerLines(text, room, 12), size: 12 }
}


/** One box, centred on `cy`: a fill (or a dashed outline for planned), its text on one or two lines, a hover title. */
function box(x: number, cy: number, w: number, text: string, ink: { fill: string; text: string; stroke?: string }, title: string, isPicked = false): string {
  const stroke = isPicked ? ` stroke="${INK.pick}" stroke-width="3"` : ink.stroke ? ` stroke="${ink.stroke}" stroke-width="1.4" stroke-dasharray="4 3"` : ''
  const { lines, size } = boxLines(text, w - 14)
  const h = lines.length === 1 ? 34 : 44
  const body = lines.map((l, k) => `<text x="${x + w / 2}" y="${cy + 4.5 + (k - (lines.length - 1) / 2) * 15}" font-size="${size}" font-weight="600" ${FONT} text-anchor="middle" fill="${ink.text}">${esc(l)}</text>`).join('')
  return `<g><title>${esc(title)}</title><rect x="${x}" y="${cy - h / 2}" width="${w}" height="${h}" rx="5" fill="${ink.fill}"${stroke}/>${body}</g>`
}

/** The legend along the drawing's foot: a swatch and a word per state. */
function legend(W: number, y: number): string {
  const states: PlanState[] = ['waiting', 'building', 'review', 'done', 'planned']
  const widths = states.map(s => 16 + textWidth(STATE_WORD[s], 11) + 14)
  let x = (W - widths.reduce((a, b) => a + b, 0)) / 2
  const parts: string[] = []
  states.forEach((s, i) => {
    const ink = STATE_INK[s]
    parts.push(`<rect x="${x}" y="${y - 9}" width="11" height="11" rx="2" fill="${ink.fill}"${ink.stroke ? ` stroke="${ink.stroke}" stroke-dasharray="2 2"` : ''}/>`)
    parts.push(`<text x="${x + 16}" y="${y + 1}" font-size="11" ${FONT} fill="${INK.line}">${esc(STATE_WORD[s])}</text>`)
    x += widths[i] as number
  })
  return parts.join('')
}

/** The centre pill: the project or the milestone, on one line or two. */
function center(cx: number, cy: number, label: string, title: string): { svg: string; w: number } {
  const lines = centerLines(label, 160, 14)
  const w = Math.max(96, Math.max(...lines.map(l => textWidth(l, 14))) + 30)
  const h = lines.length === 1 ? 38 : 54
  const text = lines.map((l, k) => `<text x="${cx}" y="${cy + 5 + (k - (lines.length - 1) / 2) * 17}" font-size="14" font-weight="700" ${FONT} text-anchor="middle" fill="${INK.on}">${esc(l)}</text>`).join('')
  return { svg: `<g><title>${esc(title)}</title><rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="19" fill="${INK.center}"/>${text}</g>`, w }
}

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const m = (x1 + x2) / 2
  return `<path d="M${x1} ${y1} C ${m} ${y1}, ${m} ${y2}, ${x2} ${y2}" fill="none" stroke="${INK.line}" stroke-width="1.4"/>`
}

/** A milestone box for the home view, centred on `cy`: its name on one or two lines, then a strip of its stages' states (the most urgent first). */
function milestoneBox(x: number, cy: number, m: PlanMilestone): string {
  const names = centerLines(m.label, BOX_W - 16, 12)
  const h = names.length === 1 ? 44 : 58
  const y = cy - h / 2
  const shown = m.items.slice(0, 8)
  const chips = shown
    .map((it, k) => {
      const ink = STATE_INK[it.state]
      return `<rect x="${x + 8 + k * 15}" y="${y + h - 18}" width="11" height="11" rx="2" fill="${ink.fill === 'none' ? INK.milestone : ink.fill}"${ink.stroke ? ` stroke="${ink.stroke}" stroke-dasharray="2 2"` : ' stroke="#2C2C2A" stroke-width="0.5"'}/>`
    })
    .join('')
  const more = m.items.length > shown.length ? `<text x="${x + 8 + shown.length * 15}" y="${y + h - 8}" font-size="10.5" ${FONT} fill="${INK.on}">+${m.items.length - shown.length}</text>` : ''
  const title = [`${m.label}`, ...m.items.slice(0, 12).map(i => `• ${i.title}: ${STATE_WORD[i.state]}`), ...(m.items.length > 12 ? [`+${m.items.length - 12} more`] : [])].join('\n')
  return (
    `<g><title>${esc(title)}</title><rect x="${x}" y="${y}" width="${BOX_W}" height="${h}" rx="6" fill="${INK.milestone}"/>` +
    names.map((l, k) => `<text x="${x + 8}" y="${y + 17 + k * 14}" font-size="12" font-weight="600" ${FONT} fill="${INK.on}">${esc(l)}</text>`).join('') +
    `${chips}${more}</g>`
  )
}

/**
 * The plan as one SVG, `width` wide: at home the milestones on the two edges with
 * their state strips; for a milestone its stages as coloured boxes (planned ones
 * dashed, the picked one ringed); a legend along the foot. Each box has a hover title.
 */
export function planSvg(v: PlanView, width: number): { source: string; width: number; height: number; alt: string } {
  const W = Math.max(MIN_WIDTH, Math.round(width))
  const cx = W / 2
  const parts: string[] = []
  const isHome = v.kind === 'home'
  const list = isHome ? v.milestones : v.items.slice(0, 10)
  const left = list.filter((_, i) => i % 2 === 0)
  const right = list.filter((_, i) => i % 2 === 1)
  const row = isHome ? 72 : 54
  const bodyH = Math.max(3, left.length, right.length) * row + 16
  const H = bodyH + LEGEND_H
  const cy = bodyH / 2
  const c = center(cx, cy, v.label, isHome ? 'Scrapshift: the milestones with work going on' : v.label)
  for (const [side, xs] of [['left', left], ['right', right]] as const) {
    const step = (bodyH - 16) / Math.max(1, xs.length)
    const bx = side === 'left' ? EDGE : W - EDGE - BOX_W
    const from = side === 'left' ? cx - c.w / 2 : cx + c.w / 2
    const to = side === 'left' ? bx + BOX_W : bx
    xs.forEach((x, k) => {
      const by = 8 + step * (k + 0.5)
      parts.push(curve(from, cy, to, by))
      if (isHome) parts.push(milestoneBox(bx, by, x as PlanMilestone))
      else {
        const it = x as PlanItem
        parts.push(box(bx, by, BOX_W, it.title, STATE_INK[it.state], `${it.title} · ${STATE_WORD[it.state]}${it.fact ? ` · ${it.fact}` : ''}`, v.kind === 'milestone' && v.pick === it.key))
      }
    })
  }
  parts.push(c.svg)
  if (list.length === 0) parts.push(`<text x="${cx}" y="${cy + 44}" font-size="12" ${FONT} text-anchor="middle" fill="${INK.line}">${isHome ? 'no work going on' : 'no stages yet: plan one below'}</text>`)
  parts.push(legend(W, H - 9))
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join('')}</svg>`
  const alt = isHome
    ? `Plan map: ${v.milestones.map(m => `${m.label} (${m.items.length} stages)`).join(', ') || 'no work going on'}`
    : `Plan map of ${v.label}: ${v.items.map(i => `${i.title} ${STATE_WORD[i.state]}`).join(', ') || 'no stages yet'}`
  return { source, width: W, height: H, alt }
}
