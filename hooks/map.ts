// Studio Director, stage 9: the map (docs/STUDIO_DIRECTOR.md §5.12). Pure
// functions, no engine calls: a mind map around one node of the memory graph
// (work on the left; topics, rules, decisions, ideas and docs on the right), as
// branches and as an SVG the pane draws; the home view (the clusters); the
// buttons that move the focus. "A graph map like MindMeister" (the user).
import { clip } from './graph'
import type { GEdge, GNode, Graph, NodeKind } from './graph'
import { around, ruleRank, sourceOf } from './recall'

/** The home view's id: the clusters around "Studio". */
export const HOME = 'home'

export type MapItem = { id: string; label: string; kind: NodeKind; conf: GEdge['conf']; score: number; source: string; title: string }
export type MapBranch = { key: string; label: string; side: 'left' | 'right'; items: MapItem[]; total: number }
export type MapView = { id: string; label: string; kind: NodeKind | 'home'; source: string; branches: MapBranch[] }

type BranchDef = { key: string; label: string; one: string; side: 'left' | 'right'; kinds: readonly NodeKind[]; order: 'newest' | 'surest' }

/** Work branches on the left; rules, docs and decisions on the right (§5.12). */
export const BRANCHES: readonly BranchDef[] = [
  { key: 'milestones', one: 'Milestone', label: 'Milestones', side: 'left', kinds: ['milestone', 'workstream'], order: 'surest' },
  { key: 'chats', one: 'Chat:', label: 'Chats', side: 'left', kinds: ['chat'], order: 'newest' },
  { key: 'asks', one: 'Ask:', label: 'Open asks', side: 'left', kinds: ['ask', 'card'], order: 'newest' },
  { key: 'commits', one: 'Commit', label: 'Commits', side: 'left', kinds: ['commit'], order: 'newest' },
  { key: 'topics', one: 'Topic:', label: 'Topics', side: 'right', kinds: ['topic'], order: 'surest' },
  { key: 'rules', one: 'Rule:', label: 'Rules', side: 'right', kinds: ['rule'], order: 'surest' },
  { key: 'decisions', one: 'Decision:', label: 'Decisions', side: 'right', kinds: ['decision'], order: 'newest' },
  { key: 'ideas', one: 'Idea:', label: 'Ideas (brain)', side: 'right', kinds: ['concept'], order: 'surest' },
  { key: 'docs', one: 'Doc', label: 'Docs', side: 'right', kinds: ['doc', 'section'], order: 'surest' },
]

const AROUND_KINDS: ReadonlySet<NodeKind> = new Set(['topic', 'milestone', 'workstream'])

const confWord = (e: Pick<GEdge, 'conf' | 'score'>) => (e.conf === 'extracted' ? 'stated by a file' : e.conf === 'ambiguous' ? 'unsure' : `guessed ${e.score.toFixed(2)}`)

function itemOf(n: GNode, e: GEdge): MapItem {
  const label = n.kind === 'section' ? `${n.source.split('/').pop() ?? ''} §${n.label}` : n.label
  return {
    id: n.id,
    label,
    kind: n.kind,
    conf: e.conf,
    score: e.score,
    source: sourceOf(n),
    title: `${label} (${n.kind}) · ${sourceOf(n)} · ${e.label ? `"${e.label}", ` : ''}${confWord(e)}`,
  }
}

/** The mind map around one node: its neighbours sorted into branches, `per` items each. */
export function mapView(g: Graph, id: string, per = 4): MapView | null {
  if (id === HOME) return homeView(g, per)
  const n = g.nodes.get(id)
  if (!n) return null
  const near = AROUND_KINDS.has(n.kind) ? around(g, id) : (g.adj.get(id) ?? []).flatMap(e => {
      const other = g.nodes.get(e.from === id ? e.to : e.from)
      return other ? [{ node: other, edge: e }] : []
    })
  const seen = new Set<string>()
  const branches: MapBranch[] = []
  for (const b of BRANCHES) {
    const list = near
      .filter(l => b.kinds.includes(l.node.kind) && !seen.has(l.node.id))
      .sort((x, y) =>
        b.order === 'newest'
          ? (y.node.at ?? '').localeCompare(x.node.at ?? '') || y.edge.score - x.edge.score
          : // rules as recall lists them: the user's own first (memory feedback), then CLAUDE.md's
            y.edge.score - x.edge.score || (b.key === 'rules' ? ruleRank(x.node) - ruleRank(y.node) : 0) || (y.node.at ?? '').localeCompare(x.node.at ?? ''),
      )
    if (list.length === 0) continue
    for (const l of list) seen.add(l.node.id)
    branches.push({ key: b.key, label: b.label, side: b.side, items: list.slice(0, per).map(l => itemOf(l.node, l.edge)), total: list.length })
  }
  return { id, label: n.label, kind: n.kind, source: sourceOf(n), branches }
}

/** Home: "Studio" in the middle, the biggest clusters as branches, their most-linked members as leaves. */
export function homeView(g: Graph, per = 4): MapView {
  const branches: MapBranch[] = g.clusters.slice(0, 8).map((c, i) => {
    const members = c.top.map(id => g.nodes.get(id)).filter((n): n is GNode => n !== undefined)
    return {
      key: `cluster-${i}`,
      label: c.name,
      side: i % 2 === 0 ? 'left' : 'right',
      items: members.slice(0, per).map(n => itemOf(n, { from: '', to: n.id, rel: 'part-of', conf: 'extracted', score: 1, source: 'cluster' })),
      total: c.size,
    }
  })
  return { id: HOME, label: 'Studio', kind: 'home', source: `${g.nodes.size} nodes, ${g.edges.length} links`, branches }
}

/** A name without its leading date and who ("2026-11-15 (G5's building chat): stage 4…" → "stage 4…"). */
export const shortName = (label: string): string => label.replace(/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?(?: \([^)]*\))?:\s*/, '') || label

/** The nodes the buttons under the map move to: each branch's first items, then the rest, `max` at most (6 and "more", as the sketch). */
export function moves(v: MapView, max = v.kind === 'home' ? 8 : 6): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = []
  const rounds = Math.max(0, ...v.branches.map(b => b.items.length))
  for (let r = 0; r < rounds && out.length < max; r++) {
    for (const b of v.branches) {
      const it = b.items[r]
      if (it && !out.some(o => o.id === it.id) && out.length < max) out.push({ id: it.id, label: clip(shortName(it.label), 26) })
    }
  }
  return out
}

/** The jump picker: home, the topics, milestones and workstreams, then the hubs. */
export function jumpOptions(g: Graph): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [{ value: HOME, label: 'Studio (the clusters)' }]
  const kinds: NodeKind[] = ['milestone', 'workstream', 'topic']
  for (const k of kinds) {
    const list = [...g.nodes.values()].filter(n => n.kind === k && (g.adj.get(n.id) ?? []).length > 0).sort((a, b) => a.label.localeCompare(b.label))
    for (const n of list) out.push({ value: n.id, label: `${n.label} (${k})` })
  }
  for (const id of g.hubs) {
    const n = g.nodes.get(id)
    if (n && !out.some(o => o.value === id)) out.push({ value: id, label: `${clip(n.label, 40)} (${n.kind})` })
  }
  return out
}

/** The focus trail after moving to `id`: back to a node already on it cuts it there; home clears it. */
export function nextTrail(trail: readonly string[], id: string, max = 12): string[] {
  if (id === HOME) return []
  const at = trail.indexOf(id)
  if (at >= 0) return trail.slice(0, at + 1)
  return [...trail, id].slice(-max)
}

// ---------------------------------------------------------------- the SVG

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Colours that read on any background, with nothing that depends on the frame's
 * colour scheme (a sandboxed frame can be white while the app is dark): the
 * focus a purple pill, work branches teal, the rest coral, white text on each,
 * as the approved sketch drew them (2026-11-16).
 */
const INK = {
  line: '#888780',
  center: '#6A61CF',
  left: '#1D9E75',
  right: '#D2582E',
  on: '#FFFFFF',
} as const

/** The drawing's widest: the map card's share of a wide pane, the reminder beside it (the sketch). */
export const MAP_WIDTH = 560
/** Narrower than this the boxes and the focus would meet: the frame scales it down instead. */
const MIN_MAP_WIDTH = 440
/** About how many CSS px the desktop draws per cell of the pane's body (a guess: the API gives cells only). */
export const PX_PER_CELL = 10

/**
 * The Map tab's layout for a pane `columns` cells wide: the reminder beside the
 * map when there is room for both (the sketch), else under it; the drawing as
 * wide as its card, so the frame never shrinks its text (the user's shot of a
 * narrow pane, 2026-11-17: the map drew a third of its size, unreadable).
 */
export function mapLayout(columns: number): { isSide: boolean; width: number } {
  const px = columns * PX_PER_CELL
  const isSide = px >= 940
  return { isSide, width: Math.max(MIN_MAP_WIDTH, isSide ? Math.min(MAP_WIDTH, Math.round(px * 0.62) - 24) : Math.min(680, px - 28)) }
}
/** Vertical room per branch box. */
const ROW = 62
const BOX_W = 142
const BOX_H = 36
const EDGE = 8

/** About how wide `text` draws at `size` px in a sans face: capitals and digits wider than small letters. */
export function textWidth(text: string, size: number): number {
  let em = 0
  for (const ch of text) {
    if (/[A-Z0-9_#%&@MW]/.test(ch)) em += /[MW@%]/.test(ch) ? 0.86 : 0.66
    else if (/[a-z]/.test(ch)) em += /[mw]/.test(ch) ? 0.8 : /[iljtfr]/.test(ch) ? 0.3 : 0.55
    else if (ch === ' ') em += 0.28
    else if (/[.,:;'!|()[\]·§-]/.test(ch)) em += 0.32
    else em += 0.6
  }
  return em * size
}

/** `text` cut (with an ellipsis) until it draws within `room` px. */
export function fitText(text: string, room: number, size: number): string {
  const t = clip(text, 80)
  if (textWidth(t, size) <= room) return t
  let n = t.length
  while (n > 4 && textWidth(`${t.slice(0, n).trimEnd()}…`, size) > room) n--
  return `${t.slice(0, n).trimEnd()}…`
}

/** A branch's box text: its name and count, or its one item's name ("Milestone N3"). */
export function branchText(b: MapBranch): string {
  const one = b.total === 1 ? b.items[0] : undefined
  if (one === undefined || b.key.startsWith('cluster-')) return `${b.label} (${b.total})`
  const singular = BRANCHES.find(d => d.key === b.key)?.one ?? b.label
  const named = `${singular} ${one.label}`
  // Its name only when it fits whole: a cut name says less than a count.
  return textWidth(named, 13) <= BOX_W - 16 ? named : `${b.label} (${b.total})`
}

/** The focus's name on one line, or two at a word break when it is long; each fitted to `room`. */
export function centerLines(label: string, room: number, size: number): string[] {
  if (textWidth(label, size) <= room) return [label]
  const words = label.split(' ')
  let best: [string, string] | null = null
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(' ')
    const b = words.slice(k).join(' ')
    const worst = Math.max(textWidth(a, size), textWidth(b, size))
    if (best === null || worst < Math.max(textWidth(best[0], size), textWidth(best[1], size))) best = [a, b]
  }
  return best === null ? [fitText(label, room, size)] : [fitText(best[0], room, size), fitText(best[1], room, size)]
}

/** A box's font size: 13, or a little smaller when that keeps its text whole. */
const boxSize = (b: MapBranch): number => [13, 12, 11].find(z => textWidth(branchText(b), z) <= BOX_W - 16) ?? 11

/** How a branch's line is drawn: solid when a file states any of its links, dotted when all are unsure, else dashed. */
function branchDash(b: MapBranch): string {
  if (b.key.startsWith('cluster-') || b.items.some(i => i.conf === 'extracted')) return ''
  return b.items.every(i => i.conf === 'ambiguous') ? ' stroke-dasharray="1.5 3"' : ' stroke-dasharray="5 3"'
}

/**
 * The mind map as one SVG, as the approved sketch drew it: the focus a pill in
 * the middle, its branches as boxes on the two outer edges (work on the left,
 * the rest on the right), each joined by a curve; a solid line is a link a file
 * states, dashed a guessed one, dotted an unsure one. The names are the buttons
 * under the map; each box's `<title>` lists them with their sources (an
 * interactive frame shows it on hover). No background: the card's shows through.
 */
export function mapSvg(v: MapView, width = MAP_WIDTH): { source: string; width: number; height: number; alt: string } {
  const W = Math.max(MIN_MAP_WIDTH, Math.round(width))
  const cx = W / 2
  const sides = { left: v.branches.filter(b => b.side === 'left'), right: v.branches.filter(b => b.side === 'right') }
  const H = Math.max(3, sides.left.length, sides.right.length) * ROW + 16
  const cy = H / 2
  const font = 'font-family="system-ui, Segoe UI, sans-serif"'
  const parts: string[] = []
  const CENTER_ROOM = 160
  const lines = centerLines(v.label, CENTER_ROOM, 14)
  const centerW = Math.max(84, Math.max(...lines.map(l => textWidth(l, 14))) + 30)
  const centerH = lines.length === 1 ? 38 : 54
  for (const side of ['left', 'right'] as const) {
    const bs = sides[side]
    const step = (H - 16) / Math.max(1, bs.length)
    const bx = side === 'left' ? EDGE : W - EDGE - BOX_W
    const colour = side === 'left' ? INK.left : INK.right
    const from = side === 'left' ? cx - centerW / 2 : cx + centerW / 2
    const to = side === 'left' ? bx + BOX_W : bx
    const mid = (from + to) / 2
    bs.forEach((b, k) => {
      const by = 8 + step * (k + 0.5)
      parts.push(`<path d="M${from} ${cy} C ${mid} ${cy}, ${mid} ${by}, ${to} ${by}" fill="none" stroke="${INK.line}" stroke-width="1.4"${branchDash(b)}/>`)
      const title = [`${b.label}: ${b.total}`, ...b.items.map(i => `• ${i.title}`), ...(b.total > b.items.length ? [`+${b.total - b.items.length} more`] : [])].join('\n')
      parts.push(
        `<g><title>${esc(title)}</title><rect x="${bx}" y="${by - BOX_H / 2}" width="${BOX_W}" height="${BOX_H}" rx="5" fill="${colour}"/>` +
          `<text x="${bx + BOX_W / 2}" y="${by + 4.5}" font-size="${boxSize(b)}" font-weight="600" ${font} text-anchor="middle" fill="${INK.on}">${esc(fitText(branchText(b), BOX_W - 16, boxSize(b)))}</text></g>`,
      )
    })
  }
  parts.push(
    `<g><title>${esc(`${v.label} (${v.kind}) · ${v.source}`)}</title><rect x="${cx - centerW / 2}" y="${cy - centerH / 2}" width="${centerW}" height="${centerH}" rx="19" fill="${INK.center}"/>` +
      lines.map((l, k) => `<text x="${cx}" y="${cy + 5 + (k - (lines.length - 1) / 2) * 17}" font-size="14" font-weight="700" ${font} text-anchor="middle" fill="${INK.on}">${esc(l)}</text>`).join('') +
      '</g>',
  )
  if (v.branches.length === 0) parts.push(`<text x="${cx}" y="${cy + 42}" font-size="12" ${font} text-anchor="middle" fill="${INK.line}">no links yet</text>`)
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join('')}</svg>`
  const alt = `Mind map around ${v.label}: ${v.branches.map(b => `${b.label} ${b.total}`).join(', ') || 'no links'}`
  return { source, width: W, height: H, alt }
}

/**
 * The reminder beside the map, short (the sketch): one line per kind of what
 * recall brings for the focus, its first names and a count of the rest.
 */
export function reminderBrief(v: MapView, status: string | null, per = 2): string[] {
  if (v.kind === 'home') return ['Pick a cluster or a name under the map: this shows what the director is reminded of for it.']
  // The map itself shows the topics, ideas and milestones; the card keeps what a brief needs.
  const order = ['rules', 'decisions', 'asks', 'docs', 'chats', 'commits']
  const out: string[] = status ? [`status: ${clip(shortName(status), 90)}`] : []
  for (const key of order) {
    const b = v.branches.find(x => x.key === key)
    if (!b) continue
    const names = b.items.slice(0, per).map(i => clip(shortName(i.label), 44)).join(' · ')
    out.push(`${b.label.toLowerCase()}: ${names}${b.total > per ? ` · +${b.total - per}` : ''}`)
  }
  return out.length > 0 ? out : ['Nothing is linked to this yet.']
}
