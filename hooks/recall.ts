// Studio Director, stage 8: recall (docs/STUDIO_DIRECTOR.md §5.11). Pure
// functions, no engine calls: the <studio-recall> block a director prompt
// carries, the director's tools' answers (studio_recall, studio_path,
// studio_section, studio_overview), the nudge toward the graph before a big doc
// is opened, and the checks before the director starts a chat.
import type { BoardRow } from '../types'
import { TOPICS, bestPath, clip, findNodes, linked, matchPrompt } from './graph'
import type { Focus, GEdge, GNode, Graph, Linked, NodeKind } from './graph'
import { tagFromTitle } from './parse'

/** About 1.5k tokens: the most a prompt's recall adds. */
export const RECALL_CHARS = 6000
/** A tool's answer: about 3k tokens. */
export const TOOL_CHARS = 12_000
/** A section from studio_section: about 2.5k tokens. */
export const SECTION_CHARS = 10_000
/** Nudges toward the graph per thread (graphify's GRAPHIFY_HOOK_NUDGE_CAP default). */
export const NUDGE_CAP = 5
/** The Haiku fallback's wait for a prompt's topic. */
export const FALLBACK_MS = 3000
/** No fallback for a prompt shorter than this (an answer, "ok", a button's label). */
export const FALLBACK_MIN_WORDS = 4

export const TOOL_NAMES = {
  recall: 'studio_recall',
  path: 'studio_path',
  remember: 'studio_remember',
  section: 'studio_section',
  overview: 'studio_overview',
  plan: 'studio_plan',
} as const

// ---------------------------------------------------------------- one line's source and certainty

/** Where a node came from, as a line's tail: `docs/plan/status_09.md:12`, `memory feedback-x.md`, `git`. */
export function sourceOf(n: GNode): string {
  if (n.source.startsWith('memory/')) return `memory ${n.source.slice('memory/'.length)}`
  if (n.source.startsWith('report ')) return 'report'
  if (n.line !== undefined && !n.source.includes(' ')) return `${n.source}:${n.line}`
  return n.source
}

/** How sure a link is: nothing for one a file states, `[guess .75]`, `[unsure]`. */
export function markOf(e: GEdge): string {
  if (e.conf === 'extracted') return ''
  if (e.conf === 'ambiguous') return ' [unsure]'
  return ` [guess ${e.score.toFixed(2).replace(/^0/, '')}]`
}

const day = (at: string | undefined) => (at ?? '').slice(0, 10)

// ---------------------------------------------------------------- what surrounds a node

/**
 * A node's surroundings for recall: what links to it, and for a milestone or a
 * workstream what links to its workstreams and chats too (their decisions, asks
 * and commits). Each node once, with its surest link.
 */
export function around(g: Graph, id: string): Linked[] {
  const best = new Map<string, Linked>()
  const add = (l: Linked) => {
    if (l.node.id === id) return
    const old = best.get(l.node.id)
    if (old === undefined || l.edge.score > old.edge.score) best.set(l.node.id, l)
  }
  const direct = linked(g, id)
  direct.forEach(add)
  for (const d of direct) {
    const isChild = d.node.kind === 'workstream' && d.edge.rel === 'part-of' && d.edge.to === id
    if (isChild) linked(g, d.node.id).forEach(add)
  }
  for (const l of [...best.values()]) {
    if (l.node.kind !== 'chat') continue
    for (const c of linked(g, l.node.id)) if (c.node.kind === 'ask' || c.node.kind === 'commit') add({ node: c.node, edge: l.edge })
  }
  return [...best.values()]
}

const byNewest = (a: Linked, b: Linked) => (b.node.at ?? '').localeCompare(a.node.at ?? '')
const bySure = (a: Linked, b: Linked) => b.edge.score - a.edge.score || byNewest(a, b)

function kindOf(list: readonly Linked[], kind: NodeKind): Linked[] {
  return list.filter(l => l.node.kind === kind)
}

/** The user's own rules first (memory feedback and user files), then CLAUDE.md's, then the rest. */
export function ruleRank(n: GNode): number {
  if (n.source.startsWith('memory/')) return n.status === 'feedback' || n.status === 'user' ? 0 : 2
  return n.source === 'CLAUDE.md' ? 1 : 3
}

/** A rule as one line: a memory rule's title and description; a CLAUDE.md line as it stands. */
export function ruleText(n: GNode, max: number): string {
  if (n.source.startsWith('memory/')) return `${clip(n.label, 70)}: ${clip(n.text ?? '', max)}`
  return clip(n.text ?? n.label, max)
}

/** A decision as one line, its date first once (a status entry's head already starts with it). */
export function decisionText(n: GNode, max: number): string {
  const t = n.text ?? n.label
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? clip(t, max) : `${day(n.at)}: ${clip(t, max)}`
}

const stateWord = (s: string | undefined) => (s === 'waiting-you' ? 'waiting on you' : s === 'working' ? 'working' : s ?? '')

/** The lines of one topic, milestone, workstream or concept, within `budget` characters. */
export function topicLines(g: Graph, id: string, budget: number, isLong = false): string[] {
  const n = g.nodes.get(id)
  if (!n) return []
  const near = around(g, id)
  const k = (a: number, b: number) => (isLong ? b : a)
  const cluster = g.cluster.get(id)
  const head = `## ${n.label} (${n.kind}${cluster !== undefined ? `, cluster "${g.clusters[cluster]?.name ?? '?'}"` : ''})`
  const out: string[] = [head]
  if (n.text && n.kind !== 'topic') out.push(`what: ${clip(n.text, 200)} (${sourceOf(n)})`)
  if (n.status) {
    const last = kindOf(near, 'decision').filter(l => l.node.label === n.status)[0]
    out.push(`status: ${clip(n.status, 200)}${last ? ` (${sourceOf(last.node)})` : ''}`)
  }
  const chats = kindOf(near, 'chat').sort((a, b) => {
    const live = (x: Linked) => (x.node.status === 'working' || x.node.status === 'waiting-you' ? 1 : 0)
    return live(b) - live(a) || byNewest(a, b)
  })
  if (chats.length > 0) {
    out.push('chats:')
    for (const c of chats.slice(0, k(3, 8))) {
      const id = c.node.id.slice('chat:'.length)
      out.push(`- [${clip(c.node.label, 70)}](#${id}) ${stateWord(c.node.status)}, ${day(c.node.at)} (report)${markOf(c.edge)}`)
    }
  }
  // Rules first: they are what a brief must carry (the user's own words, then CLAUDE.md, then project lore).
  const rules = kindOf(near, 'rule').sort((a, b) => b.edge.score - a.edge.score || ruleRank(a.node) - ruleRank(b.node) || a.node.label.localeCompare(b.node.label))
  if (rules.length > 0) {
    out.push('rules that apply:')
    for (const r of rules.slice(0, k(7, 16))) out.push(`- ${ruleText(r.node, isLong ? 300 : 160)} (${sourceOf(r.node)})${markOf(r.edge)}`)
  }
  const decisions = kindOf(near, 'decision').sort(byNewest)
  if (decisions.length > 0) {
    out.push('decisions, newest first:')
    for (const d of decisions.slice(0, k(4, 12))) out.push(`- ${decisionText(d.node, isLong ? 400 : 170)} (${sourceOf(d.node)})${markOf(d.edge)}`)
  }
  const asks = kindOf(near, 'ask')
  if (asks.length > 0) {
    out.push('open asks:')
    for (const a of asks.slice(0, k(3, 6))) out.push(`- ${clip(a.node.text ?? a.node.label, 200)} (report)`)
  }
  const docs = [...kindOf(near, 'section'), ...kindOf(near, 'doc')].sort(bySure)
  if (docs.length > 0) {
    out.push('docs (studio_section reads one):')
    for (const d of docs.slice(0, k(3, 10))) {
      const where = d.node.kind === 'section' ? `${d.node.source} §"${clip(d.node.label, 60)}"` : d.node.source
      out.push(`- ${where} (line ${d.node.line ?? 1})${markOf(d.edge)}`)
    }
  }
  const commits = kindOf(near, 'commit').sort(byNewest)
  if (commits.length > 0) {
    out.push('commits:')
    for (const c of commits.slice(0, k(3, 8))) out.push(`- ${clip(c.node.label, 100)}, ${day(c.node.at)} (git)`)
  }
  const brain = linked(g, id)
    .filter(l => l.edge.rel === 'related')
    .sort(bySure)
  if (brain.length > 0) {
    out.push('how it connects (brain):')
    for (const b of brain.slice(0, k(3, 12))) {
      const a = g.nodes.get(b.edge.from)?.label ?? b.edge.from
      const z = g.nodes.get(b.edge.to)?.label ?? b.edge.to
      out.push(`- ${a} → ${b.edge.label ?? 'relates to'} → ${z} (${b.edge.source})${markOf(b.edge)}`)
    }
  }
  return fit(out, budget)
}

/** Lines cut to fit `budget` characters, a last line saying what was left out. */
function fit(lines: readonly string[], budget: number): string[] {
  const out: string[] = []
  let used = 0
  for (const l of lines) {
    if (used + l.length + 1 > budget) {
      out.push('- … (more: studio_recall)')
      break
    }
    out.push(l)
    used += l.length + 1
  }
  return out
}

/** The graph in one line, for a block's head. */
export function graphLine(g: Graph): string {
  const c = g.counts
  const total = Math.max(1, c.extracted + c.inferred + c.ambiguous)
  const pct = (x: number) => Math.round((100 * x) / total)
  return `${g.nodes.size} nodes · ${g.edges.length} links (${pct(c.extracted)}% stated, ${pct(c.inferred)}% guessed, ${pct(c.ambiguous)}% unsure)`
}

/**
 * The block a director prompt carries: up to 3 topics the prompt names, each
 * line with its source, about 1.5k tokens at most. Null when nothing matches.
 */
export function recallBlock(g: Graph, focus: readonly Focus[], budget = RECALL_CHARS): string | null {
  const ids = focus.map(f => f.id).filter(id => g.nodes.has(id))
  if (ids.length === 0) return null
  const head = [
    `<studio-recall about="${ids.map(id => g.nodes.get(id)?.label ?? id).join('; ')}" graph="${graphLine(g)}">`,
    'What your files and memory hold about what this prompt names (the studio memory graph). Each line ends with its source; [guess .75] marks a link guessed from names and [unsure] an unclear one: check before you rely on it. Put the rules listed here into any brief you write. More: studio_recall, studio_section, studio_path.',
  ]
  const share = Math.floor((budget - head.join('\n').length - 20) / ids.length)
  const body = ids.flatMap(id => topicLines(g, id, share))
  return [...head, ...body, '</studio-recall>'].join('\n')
}

/** Labels the Haiku fallback picks from, and the node each stands for. */
export function fallbackLabels(g: Graph): Map<string, string> {
  const out = new Map<string, string>()
  for (const t of TOPICS) if (g.nodes.has(`topic:${t.key}`)) out.set(t.label, `topic:${t.key}`)
  for (const n of g.nodes.values()) if (n.kind === 'milestone') out.set(n.label, n.id)
  return out
}

/** Whether a prompt is worth the Haiku fallback: long enough, and not a slash command. */
export function wantsFallback(text: string): boolean {
  const t = text.trim()
  return !t.startsWith('/') && t.split(/\s+/).filter(w => /[a-z]/i.test(w)).length >= FALLBACK_MIN_WORDS
}

// ---------------------------------------------------------------- the tools' answers

/** A node's neighbourhood, for studio_recall on a rule, decision, doc, chat or section. */
function nodeLines(g: Graph, id: string, budget: number): string[] {
  const n = g.nodes.get(id)
  if (!n) return []
  const out = [`## ${n.label} (${n.kind}, ${sourceOf(n)})`]
  if (n.text) out.push(clip(n.text, 600))
  const near = linked(g, id).sort(bySure)
  const groups = new Map<string, Linked[]>()
  for (const l of near) {
    const key = `${l.edge.rel} ${l.edge.from === id ? '→' : '←'} ${l.node.kind}`
    groups.set(key, [...(groups.get(key) ?? []), l])
  }
  for (const [key, list] of groups) {
    out.push(`${key} (${list.length}):`)
    for (const l of list.slice(0, 8)) out.push(`- ${clip(l.node.label, 110)} (${sourceOf(l.node)})${markOf(l.edge)}${l.edge.label ? ` "${l.edge.label}"` : ''}`)
  }
  return fit(out, budget)
}

const LONG_KINDS: ReadonlySet<NodeKind> = new Set(['topic', 'milestone', 'workstream', 'concept'])

/**
 * What the director is reminded of for one node (the Map tab): recall's own
 * lines, as Markdown (each "rules that apply:" line its own bold paragraph).
 */
export function reminderFor(g: Graph, id: string, budget = RECALL_CHARS): string {
  const n = g.nodes.get(id)
  if (!n) return 'Nothing in the graph has that id.'
  const lines = LONG_KINDS.has(n.kind) ? topicLines(g, id, budget) : nodeLines(g, id, budget)
  const out: string[] = []
  for (const l of lines) {
    if (l.startsWith('## ') || l.startsWith('- ')) out.push(l)
    else {
      const head = /^([a-z][a-z ,()]*:)(.*)$/i.exec(l)
      out.push('', head ? `**${head[1]}**${head[2] ?? ''}` : l, '')
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** studio_recall: the best match's surroundings, and the other matches by name. */
export function recallToolText(g: Graph, query: string): string {
  const found = findNodes(g, query, 5)
  if (found.length === 0) return `Nothing in the graph matches "${query}". studio_overview lists the clusters and hubs.`
  const top = found[0] as GNode
  const lines = LONG_KINDS.has(top.kind) ? topicLines(g, top.id, TOOL_CHARS, true) : nodeLines(g, top.id, TOOL_CHARS)
  const others = found.slice(1).map(n => `${n.label} (${n.kind}, id ${n.id})`)
  return [...lines, ...(others.length > 0 ? ['', `Also matched: ${others.join('; ')}`] : [])].join('\n')
}

/** studio_path: how two things connect, hop by hop, as sure as its weakest link. */
export function pathText(g: Graph, a: string, b: string): string {
  const from = findNodes(g, a, 1)[0]
  const to = findNodes(g, b, 1)[0]
  if (!from) return `Nothing in the graph matches "${a}".`
  if (!to) return `Nothing in the graph matches "${b}".`
  if (from.id === to.id) return `"${a}" and "${b}" are the same node: ${from.label}.`
  const p = bestPath(g, from.id, to.id)
  if (p === null) return `No path of 8 links or fewer joins ${from.label} and ${to.label}.`
  const lines = [`${from.label} → ${to.label}: ${p.edges.length} links, as sure as its weakest (${p.weakest === 1 ? 'all stated by files' : p.weakest.toFixed(2)}).`]
  p.edges.forEach((e, i) => {
    const x = g.nodes.get(p.nodes[i] as string)
    const y = g.nodes.get(p.nodes[i + 1] as string)
    const dir = e.from === p.nodes[i] ? '→' : '←'
    lines.push(`${i + 1}. ${x?.label ?? '?'} ${dir} ${e.label ?? e.rel} ${dir} ${y?.label ?? '?'} (${e.source})${markOf(e)}`)
  })
  return lines.join('\n')
}

/** studio_overview: the clusters, the hubs, what the graph holds, the brain's progress. */
export function overviewText(g: Graph, brain: string): string {
  const kinds = new Map<string, number>()
  for (const n of g.nodes.values()) kinds.set(n.kind, (kinds.get(n.kind) ?? 0) + 1)
  const out = [
    `The studio memory graph: ${graphLine(g)}.`,
    `Holds: ${[...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}s`).join(', ')}.`,
    brain,
    'Clusters (things that belong together), biggest first:',
    ...g.clusters.slice(0, 14).map((c, i) => `${i + 1}. ${c.name} (${c.size}): ${c.top.map(id => g.nodes.get(id)?.label ?? id).filter(l => l !== c.name).slice(0, 5).join(', ')}`),
    'Hubs (the most-linked):',
    ...g.hubs.map(id => `- ${g.nodes.get(id)?.label ?? id} (${g.nodes.get(id)?.kind ?? '?'}, ${(g.adj.get(id) ?? []).length} links)`),
  ]
  return out.join('\n')
}

export type SectionPick = { path: string; line: number; endLine: number; label: string } | { candidates: string[] }

/** studio_section: a doc's section by heading words (or a section id). */
export function findSection(g: Graph, doc: string, heading: string): SectionPick {
  const d = doc.trim().toLowerCase().replace(/\\/g, '/')
  const h = heading.trim().toLowerCase()
  const direct = g.nodes.get(heading.trim()) ?? g.nodes.get(doc.trim())
  if (direct?.kind === 'section') return { path: direct.source, line: direct.line ?? 1, endLine: direct.endLine ?? direct.line ?? 1, label: direct.label }
  const sections = [...g.nodes.values()].filter(n => n.kind === 'section' && (d === '' || n.source.toLowerCase().endsWith(d) || n.source.toLowerCase().includes(d)))
  if (sections.length === 0) return { candidates: [] }
  const words = h.split(/\s+/).filter(w => w.length >= 2)
  const score = (n: GNode) => {
    const l = n.label.toLowerCase()
    if (l === h) return 100
    return words.filter(w => l.includes(w)).length * 10 - Math.abs(l.length - h.length) / 50
  }
  const ranked = sections.map(n => ({ n, s: score(n) })).sort((a, b) => b.s - a.s)
  const best = ranked[0]
  if (!best || (words.length > 0 && best.s <= 0)) {
    // A sub-milestone with no heading of its own (N1e) lives in its milestone's section (N1).
    const parent = /^([fng]\d{1,2})[a-z]$/.exec(h)?.[1]
    if (parent !== undefined) {
      const pick = findSection(g, doc, parent)
      if (!('candidates' in pick)) return pick
    }
    return { candidates: ranked.slice(0, 12).map(x => `${x.n.source} §"${x.n.label}"`) }
  }
  return { path: best.n.source, line: best.n.line ?? 1, endLine: best.n.endLine ?? best.n.line ?? 1, label: best.n.label }
}

/** A section's lines out of its file, cut to SECTION_CHARS. */
export function sectionText(file: string, line: number, endLine: number, max = SECTION_CHARS): string {
  const lines = file.replace(/\r\n/g, '\n').split('\n').slice(line - 1, Math.max(line, endLine))
  const text = lines.join('\n')
  return text.length <= max ? text : `${text.slice(0, max)}\n… (cut at ${max} characters: ask for a subsection)`
}

// ---------------------------------------------------------------- the nudge (graphify's PreToolUse hint)

const DOC_PATH = /(^|[\\/"' ])docs[\\/][^\s"']*\.md/i

/** Whether a tool call opens or searches the docs, so the graph might answer it cheaper. */
export function isDocRead(tool: string, input: Record<string, unknown>): boolean {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  if (tool === 'Read') return DOC_PATH.test(` ${str('file_path')}`) && !/[\\/]docs[\\/]studio[\\/]/i.test(str('file_path'))
  if (tool === 'Grep') return /docs/i.test(str('path')) || str('path') === ''
  if (tool === 'Bash' || tool === 'PowerShell') {
    const c = str('command')
    return /\b(cat|head|tail|sed\s+-n|less|more|grep|rg|get-content|gc|select-string|type)\b/i.test(c) && DOC_PATH.test(` ${c}`) && !/docs[\\/]studio[\\/]/i.test(c)
  }
  return false
}

export const NUDGE_TEXT =
  'studio: the memory graph may answer this for fewer tokens. studio_section {doc, heading} returns one section of a doc; studio_recall {topic} what the files say about a topic (decisions, rules, chats, docs, commits, with sources); studio_path {from, to} how two things connect. Open whole docs when those fall short.'

// ---------------------------------------------------------------- the checks before a chat starts

const START = /^mcp__.*ccd_session__start_session$/

export type StartContext = {
  /** Every board row (the director's own row is `isSelf`). */
  rows: readonly BoardRow[]
  /** The user answered an AskUserQuestion in this turn (D7's gate, reused). */
  hasConsent: boolean
}

/**
 * Why the director may not start this chat yet, or null: a live chat (working
 * or waiting) with the same tag exists. (Stage 11: "a builder is already working"
 * is gone; work runs in parallel by part under the leads.) A proposal card or a started proposal is the user's own
 * press, so only a start the director makes now is checked.
 */
export function startRefusal(tool: string, input: Record<string, unknown>, ctx: StartContext): string | null {
  if (!START.test(tool) || ctx.hasConsent) return null
  const initiation = typeof input.initiation === 'string' ? input.initiation : ''
  if (initiation === 'own_initiative' || initiation === 'offer' || typeof input.proposal_id === 'string') return null
  const title = typeof input.title === 'string' ? input.title : ''
  const tag = tagFromTitle(title)
  const live = ctx.rows.filter(r => !r.isSelf && !r.isStalled && r.tag !== 'Director' && (r.state === 'working' || r.state === 'waiting-you'))
  const name = (r: BoardRow) => `"${clip(r.title, 70)}" [${r.id}]`
  const twin = tag === null ? undefined : live.find(r => r.tag === tag)
  const ask = 'Ask the user first (AskUserQuestion); on their yes in this turn, call start_session again. Or send the work to that chat (send_message).'
  if (twin) return `studio: a live chat already has the tag ${tag}: ${name(twin)}, ${twin.state === 'working' ? 'working' : 'waiting on the user'}. ${ask}`
  return null
}
