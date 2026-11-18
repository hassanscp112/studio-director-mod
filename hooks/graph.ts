// Studio Director, stage 8: the memory graph (docs/STUDIO_DIRECTOR.md §5.11).
// Pure functions, no engine calls. The idea is graphify's (Graphify-Labs/graphify,
// Apache-2.0): a graph read from files, every link marked as stated by a file
// (`extracted`, 1.0) or guessed from a name (`inferred`, scored 0.95 … 0.55 on
// graphify's rubric) or unsure (`ambiguous`); clusters and hubs; a path is as sure
// as its weakest link. Our own code; graphify is not installed.
//
// Each source file becomes a Part (nodes and links); parts are cached by the
// caller per file and merged here, the guessed links added last. Nothing here
// is ever written into the repo: the memory folder is the user's private notes.
import type { CardFile, Report } from '../types'

export type NodeKind =
  | 'milestone'
  | 'workstream'
  | 'chat'
  | 'decision'
  | 'rule'
  | 'doc'
  | 'section'
  | 'commit'
  | 'ask'
  | 'card'
  | 'topic'
  | 'concept'

export type Relation =
  | 'part-of'
  | 'works-on'
  | 'produced'
  | 'waits-on'
  | 'decided-about'
  | 'applies-to'
  | 'documented-in'
  | 'links-to'
  | 'mentions'
  | 'related'

export type Confidence = 'extracted' | 'inferred' | 'ambiguous'

/** graphify's rubric for a guessed link. */
export const SCORES = [0.95, 0.85, 0.75, 0.65, 0.55] as const

export type GNode = {
  id: string
  kind: NodeKind
  label: string
  /** Lower-case names the node is found by (whole words; a trailing `*` matches any ending). */
  aliases: string[]
  /** Where it came from: a repo path, `memory/<file>`, `git`, `report <id>`, `brain <path>`. */
  source: string
  /** 1-based line in `source`, when it has one. */
  line?: number
  /** Last line of a section (sections only). */
  endLine?: number
  /** ISO date or time, when it has one. */
  at?: string
  /** A short text: a decision, a rule's description, a recap, an ask. */
  text?: string
  /** A chat's state, a milestone's last status head. */
  status?: string
}

export type GEdge = {
  from: string
  to: string
  rel: Relation
  conf: Confidence
  /** 1 for extracted; else one of SCORES. */
  score: number
  source: string
  /** The brain's own words for the link ("travels through"). */
  label?: string
}

/** An edge in a Part: `to` (or `from`) may be `?<name>`, found by name when the graph is built. */
export type PartEdge = GEdge & { make?: NodeKind }

export type Part = { nodes: GNode[]; edges: PartEdge[] }

export type Graph = {
  nodes: Map<string, GNode>
  edges: GEdge[]
  /** Both directions: every edge touching a node. */
  adj: Map<string, GEdge[]>
  /** Node id → cluster index. */
  cluster: Map<string, number>
  clusters: Array<{ name: string; size: number; top: string[] }>
  /** The most-linked nodes ("god nodes"), outside docs, sections and commits. */
  hubs: string[]
  /** How many edges are guessed or unsure. */
  counts: { extracted: number; inferred: number; ambiguous: number }
  builtAt: number
}

// ---------------------------------------------------------------- small helpers

export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)

/** A name without a leading "the", "a" or "an", lower case: "the Lantern" and "Lantern" are one name. */
export const bareName = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '')

/** A name's key: bare, with no spaces, dashes or capitals ("LanternBrain" and "Lantern brain" are one name). */
export const nameKey = (s: string): string => bareName(s).replace(/[^a-z0-9]+/g, '')

const clean = (s: string): string => s.replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim()

export function clip(s: string, n: number): string {
  const t = clean(s)
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`
}

const node = (n: GNode): GNode => n
const extracted = (from: string, to: string, rel: Relation, source: string, make?: NodeKind): PartEdge => ({
  from,
  to,
  rel,
  conf: 'extracted',
  score: 1,
  source,
  ...(make ? { make } : {}),
})

/** The nearest score of graphify's rubric. */
export function snapScore(x: number): number {
  if (!Number.isFinite(x)) return 0.55
  let best: number = SCORES[0]
  for (const s of SCORES) if (Math.abs(s - x) < Math.abs(best - x)) best = s
  return best
}

// ---------------------------------------------------------------- topics

/**
 * Topics: the places, characters and crafts the docs are named after, and a
 * few that cut across them, each with the words that name it. A doc whose
 * name holds a topic's word is documented-in for it.
 */
export const TOPICS: ReadonlyArray<{ key: string; label: string; aliases: string[] }> = [
  { key: 'metro9', label: 'METRO 9', aliases: ['metro 9', 'metro9', 'm9'] },
  { key: 'slip7', label: 'SLIP 7', aliases: ['slip 7', 'slip7'] },
  { key: 'dig4', label: 'DIG 4', aliases: ['dig 4', 'dig4', 'depository 4', 'depository4'] },
  { key: 'vault', label: 'the Vault', aliases: ['vault'] },
  { key: 'warden', label: 'the Warden', aliases: ['warden'] },
  { key: 'copper', label: 'COPPER', aliases: ['copper'] },
  { key: 'kestrel', label: 'KESTREL', aliases: ['kestrel'] },
  { key: 'hyaku', label: 'HYAKU', aliases: ['hyaku'] },
  { key: 'cart', label: 'the shopping cart', aliases: ['shopping cart', 'cart', 'carts'] },
  { key: 'hauler', label: 'the Hauler', aliases: ['hauler', 'skitter-cart', 'skitter cart'] },
  { key: 'haggler', label: 'the Haggler', aliases: ['haggler'] },
  { key: 'reeler', label: 'the Reeler', aliases: ['reeler'] },
  { key: 'sentry', label: 'the Sentry', aliases: ['sentry'] },
  { key: 'spider', label: 'the giant spider', aliases: ['giant spider', 'spider'] },
  { key: 'ticker', label: 'the ticker', aliases: ['ticker'] },
  { key: 'truck', label: 'the truck', aliases: ['truck', 'van'] },
  { key: 'magnet', label: 'the magnet', aliases: ['magnet'] },
  { key: 'audio', label: 'audio', aliases: ['audio', 'sound', 'sounds', 'sfx', 'voice', 'voices', 'music', 'ambience', 'ambient', 'elevenlabs', 'freesound', 'footstep*', 'noisy', 'loud', 'stable audio'] },
  { key: 'art', label: 'art and models', aliases: ['texture*', 'blender', 'psx', 'outline*', 'ink', 'shader*', 'mesh', 'meshes', 'low-poly', 'palette', 'lighting', 'concept art', 'render*'] },
  { key: 'networking', label: 'networking', aliases: ['multiplayer', 'host', 'client', 'clients', 'server', 'enet', 'godotsteam', 'late joiner', 'rpc*', 'replica*', 'netcode'] },
  { key: 'performance', label: 'performance', aliases: ['fps', 'frame time', 'draw call*', 'lag', 'laggy', 'potato*', 'perf', 'performance', 'stutter*'] },
  { key: 'ui', label: 'UI and screens', aliases: ['ui', 'hud', 'menu', 'menus', 'settings screen', 'screen ui'] },
  { key: 'enemies', label: 'enemies and monsters', aliases: ['enemy', 'enemies', 'monster', 'monsters'] },
  { key: 'marketing', label: 'marketing', aliases: ['marketing', 'devlog*', 'trailer*', 'instagram', 'tiktok', 'steam page', 'reels'] },
  { key: 'studio', label: 'the Studio mod', aliases: ['studio director', 'studio mod', 'kanban', 'memory graph'] },
  { key: 'bots', label: 'bots and shots', aliases: ['bot', 'bots', 'shot run*', 'screenshot*'] },
]

/** Topic nodes, from the table. */
export function topicsPart(): Part {
  return {
    nodes: TOPICS.map(t => node({ id: `topic:${t.key}`, kind: 'topic', label: t.label, aliases: [...t.aliases], source: 'studio mod (topic table)' })),
    edges: [],
  }
}

// ---------------------------------------------------------------- milestones (MASTER_PLAN.md's index)

/** A milestone code's parent: N1d → N1, G4g → G4. */
export const parentCode = (code: string): string | null => /^([FNG]\d{1,2})[a-z]/.exec(code)?.[1] ?? null

/** docs/MASTER_PLAN.md: each milestone under its plan part, and the parts as docs. */
export function masterPlanPart(path: string, text: string): Part {
  const nodes: GNode[] = []
  const edges: PartEdge[] = []
  let part: string | null = null
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  lines.forEach((raw, i) => {
    const doc = /^- \[([^\]]+)\]\((plan\/[^)]+\.md)\)/.exec(raw)
    if (doc) {
      part = `docs/${doc[2]}`
      return
    }
    const ms = /^\s+- ([FNG]\d{1,2}[a-z]?) — (.+)$/.exec(raw)
    if (!ms || part === null) return
    const code = ms[1] as string
    const id = `milestone:${code}`
    nodes.push(node({ id, kind: 'milestone', label: `${code}: ${clip((ms[2] as string).replace(/\s*\(.*$/, ''), 70)}`, aliases: [], source: path, line: i + 1, text: clip(ms[2] as string, 200) }))
    edges.push(extracted(id, `doc:${part}`, 'documented-in', path))
  })
  return { nodes, edges }
}

// ---------------------------------------------------------------- docs and sections

/** A doc's own name as words: `PLACE_METRO9.md` → `place metro9`. */
const docWords = (path: string): string =>
  (path.split('/').pop() ?? path)
    .replace(/\.md$/i, '')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()

/**
 * A doc and its sections (headings `#` to `####`, each to the next heading of
 * its level or above), and the docs it links to.
 */
export function docPart(path: string, text: string): Part {
  const id = `doc:${path}`
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const title = lines.find(l => /^# /.test(l))?.replace(/^# /, '') ?? (path.split('/').pop() ?? path)
  const nodes: GNode[] = [node({ id, kind: 'doc', label: path.split('/').pop() ?? path, aliases: [], source: path, line: 1, text: clip(title, 160) })]
  const edges: PartEdge[] = []
  const heads: Array<{ level: number; line: number; title: string }> = []
  let inFence = false
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) inFence = !inFence
    if (inFence) return
    const h = /^(#{1,4}) (.+)$/.exec(l)
    if (h) heads.push({ level: (h[1] as string).length, line: i + 1, title: clean(h[2] as string) })
  })
  heads.forEach((h, k) => {
    if (h.level === 1 && k === 0) return // the doc's own title
    let end = lines.length
    for (let j = k + 1; j < heads.length; j++) {
      if ((heads[j] as { level: number }).level <= h.level) {
        end = (heads[j] as { line: number }).line - 1
        break
      }
    }
    const sid = `section:${path}#L${h.line}`
    nodes.push(node({ id: sid, kind: 'section', label: clip(h.title, 90), aliases: [], source: path, line: h.line, endLine: end }))
    edges.push(extracted(sid, id, 'part-of', path))
  })
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const seen = new Set<string>()
  for (const m of text.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
    const target = resolveRel(dir, m[1] as string)
    if (target === null || target === path || seen.has(target)) continue
    seen.add(target)
    edges.push(extracted(id, `doc:${target}`, 'links-to', path))
  }
  return { nodes, edges }
}

function resolveRel(dir: string, rel: string): string | null {
  if (/^[a-z]+:/i.test(rel)) return null
  const out = dir === '' ? [] : dir.split('/')
  for (const p of rel.split('/')) {
    if (p === '.' || p === '') continue
    if (p === '..') {
      if (out.length === 0) return null
      out.pop()
    } else out.push(p)
  }
  return out.join('/')
}

// ---------------------------------------------------------------- decisions

/** `[about: G5, audio]` at a note's end: what it is about, as studio_remember writes it. */
const ABOUT = /\s*\[about:\s*([^\]]+)\]\s*$/i

/** docs/studio/notes.md and notes_archive.md: one decision per note line. */
export function notesPart(path: string, text: string): Part {
  const nodes: GNode[] = []
  const edges: PartEdge[] = []
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .forEach((raw, i) => {
      const m = /^\s*[-*] (\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?:\s*(.+)$/.exec(raw)
      if (!m) return
      const id = `decision:${path}#L${i + 1}`
      const body = m[3] as string
      const about = ABOUT.exec(body)
      const text = about ? body.slice(0, about.index) : body
      nodes.push(node({ id, kind: 'decision', label: clip(text, 90), aliases: [], source: path, line: i + 1, at: `${m[1]}T${m[2] ?? '00:00'}`, text: clip(text, 400) }))
      if (about) {
        for (const a of (about[1] as string).split(',').map(s => s.trim()).filter(s => s !== '')) {
          edges.push(extracted(id, `?${a}`, 'decided-about', path, 'topic'))
        }
      }
    })
  return { nodes, edges }
}

/**
 * docs/plan/status_*.md: one decision per top-level entry (`- **2026-11-15 (…): …**`),
 * its bold head as the label and the start of its body as the text.
 */
export function statusPart(path: string, text: string): Part {
  const nodes: GNode[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^- \*\*(\d{4}-\d{2}-\d{2})([^*]*)\*\*(.*)$/.exec(lines[i] as string)
    if (!m) continue
    const head = clean(`${m[1]}${m[2]}`)
    const body: string[] = [clean(m[3] as string)]
    for (let j = i + 1; j < lines.length && !/^- /.test(lines[j] as string) && !/^#/.test(lines[j] as string); j++) body.push(clean(lines[j] as string))
    nodes.push(
      node({
        id: `decision:${path}#L${i + 1}`,
        kind: 'decision',
        label: clip(head, 110),
        aliases: [],
        source: path,
        line: i + 1,
        at: `${m[1]}T23:59`,
        text: clip(`${head} ${body.join(' ')}`, 700),
      }),
    )
  }
  return { nodes, edges: [] }
}

// ---------------------------------------------------------------- rules

/** A memory file: its frontmatter's name and description, its `[[links]]`. `title` from MEMORY.md's index. */
export function memoryPart(file: string, text: string, title?: string): Part {
  const t = text.replace(/\r\n/g, '\n')
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(t)
  const head = fm?.[1] ?? ''
  const name = /^name:\s*(.+)$/m.exec(head)?.[1]?.trim() ?? file.replace(/\.md$/, '')
  const description = /^description:\s*(.+)$/m.exec(head)?.[1]?.trim() ?? ''
  const type = /^\s*type:\s*(\S+)/m.exec(head)?.[1]?.trim() ?? ''
  const id = `rule:mem:${name}`
  const source = `memory/${file}`
  const nodes = [
    node({ id, kind: 'rule', label: title ?? name, aliases: [name.toLowerCase()], source, line: 1, text: clip(description, 300), status: type }),
  ]
  const edges: PartEdge[] = []
  const body = fm ? t.slice(fm[0].length) : t
  const seen = new Set<string>()
  for (const m of body.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const to = (m[1] as string).trim()
    if (to === name || seen.has(to)) continue
    seen.add(to)
    edges.push(extracted(id, `rule:mem:${to}`, 'links-to', source))
  }
  return { nodes, edges }
}

/** MEMORY.md's index: file → title. */
export function memoryTitles(index: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of index.matchAll(/^- \[([^\]]+)\]\(([^)]+\.md)\)/gm)) out[m[2] as string] = m[1] as string
  return out
}

/** CLAUDE.md: each bullet under a heading that names rules is a rule. */
export function claudePart(path: string, text: string): Part {
  const nodes: GNode[] = []
  let heading = ''
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .forEach((raw, i) => {
      const h = /^#{1,3} (.+)$/.exec(raw)
      if (h) {
        heading = h[1] as string
        return
      }
      if (!/rules/i.test(heading)) return
      const b = /^- (.+)$/.exec(raw)
      if (!b) return
      nodes.push(node({ id: `rule:claude#L${i + 1}`, kind: 'rule', label: clip(b[1] as string, 80), aliases: [], source: path, line: i + 1, text: clip(b[1] as string, 400), status: heading.toLowerCase() }))
    })
  return { nodes, edges: [] }
}

// ---------------------------------------------------------------- chats, asks, commits, cards

/** The reports: chats, their workstreams (tags), open asks and last commits. */
export function reportsPart(reports: readonly Report[]): Part {
  const nodes: GNode[] = []
  const edges: PartEdge[] = []
  const tags = new Set<string>()
  for (const r of reports) {
    if (r.appId === null) continue
    const id = `chat:${r.appId}`
    const source = `report ${r.appId}`
    nodes.push(
      node({ id, kind: 'chat', label: r.title || r.appId, aliases: [r.appId.toLowerCase()], source, at: r.updatedAt, text: clip(r.recap, 300), status: r.state }),
    )
    if (r.tag && r.tag !== 'Director') {
      tags.add(r.tag)
      edges.push(extracted(id, `workstream:${r.tag}`, 'works-on', source))
    }
    if (r.ask) {
      const aid = `ask:${r.appId}`
      nodes.push(node({ id: aid, kind: 'ask', label: clip(r.ask.question, 90), aliases: [], source, at: r.stateSince, text: clip(`${r.ask.question}${r.ask.buttons.length > 0 ? ` [${r.ask.buttons.join(' / ')}]` : ''}`, 300) }))
      edges.push(extracted(id, aid, 'waits-on', source))
    }
    if (r.lastCommit) {
      const cid = `commit:${r.lastCommit.hash.slice(0, 7)}`
      nodes.push(node({ id: cid, kind: 'commit', label: `${r.lastCommit.hash.slice(0, 7)} ${clip(r.lastCommit.subject, 80)}`, aliases: [], source: 'git', at: r.lastCommit.at, text: r.lastCommit.subject }))
      edges.push(extracted(id, cid, 'produced', source))
    }
  }
  for (const t of tags) {
    // A tag that is a milestone's own code (G5) leaves the name to the milestone, so "G5" is not unsure.
    nodes.push(node({ id: `workstream:${t}`, kind: 'workstream', label: t, aliases: /^[FNG]\d{1,2}$/.test(t) ? [] : [t.toLowerCase()], source: 'reports (chat tags)' }))
    const parent = parentCode(t)
    if (parent !== null) edges.push({ from: `workstream:${t}`, to: `milestone:${parent}`, rel: 'part-of', conf: 'inferred', score: 0.85, source: 'tag name' })
    else if (/^[FNG]\d{1,2}$/.test(t)) edges.push({ from: `workstream:${t}`, to: `milestone:${t}`, rel: 'part-of', conf: 'inferred', score: 0.95, source: 'tag name' })
  }
  return { nodes, edges }
}

/** `git log --format=%h%x1f%s%x1f%cI`: the recent commits. */
export function commitsPart(log: string): Part {
  const nodes: GNode[] = []
  for (const line of log.split(/\r?\n/)) {
    const [hash = '', subject = '', at = ''] = line.split('\x1f')
    if (hash.trim() === '') continue
    const h = hash.trim().slice(0, 7)
    nodes.push(node({ id: `commit:${h}`, kind: 'commit', label: `${h} ${clip(subject, 80)}`, aliases: [], source: 'git', at: at.trim(), text: subject }))
  }
  return { nodes, edges: [] }
}

/** The kanban's card files. */
export function cardsPart(cards: readonly CardFile[]): Part {
  const nodes: GNode[] = []
  const edges: PartEdge[] = []
  for (const c of cards) {
    const id = `card:${c.id}`
    const source = `docs/studio/cards/${c.id}.json`
    nodes.push(node({ id, kind: 'card', label: clip(c.title, 90), aliases: [], source, at: c.updatedAt, status: c.pin ?? 'auto' }))
    if (c.rowId) edges.push(extracted(id, `chat:${c.rowId}`, 'links-to', source))
    if (c.under) edges.push(extracted(id, `milestone:${c.under}`, 'part-of', source))
  }
  return { nodes, edges }
}

// ---------------------------------------------------------------- matching names

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

type Matcher = { re: RegExp; byAlias: Map<string, string[]>; prefixes: Array<{ stem: string; ids: string[] }> }

/** One regex over every alias of `nodes` (whole words, any case; `word*` any ending). */
function matcher(nodes: Iterable<GNode>): Matcher {
  const byAlias = new Map<string, string[]>()
  const prefixes = new Map<string, string[]>()
  for (const n of nodes) {
    for (const a of n.aliases) {
      const isPrefix = a.endsWith('*')
      const key = (isPrefix ? a.slice(0, -1) : a).toLowerCase().trim()
      if (key.length < 2) continue
      const map = isPrefix ? prefixes : byAlias
      const list = map.get(key) ?? []
      if (!list.includes(n.id)) list.push(n.id)
      map.set(key, list)
    }
  }
  const alts = [
    ...[...byAlias.keys()].map(k => `${escape(k).replace(/\s+/g, '\\s+')}(?![a-z0-9])`),
    ...[...prefixes.keys()].map(k => `${escape(k).replace(/\s+/g, '\\s+')}[a-z0-9]*`),
  ].sort((a, b) => b.length - a.length)
  const re = alts.length === 0 ? /(?!)/g : new RegExp(`(?<![a-z0-9])(?:${alts.join('|')})`, 'gi')
  return { re, byAlias, prefixes: [...prefixes.entries()].map(([stem, ids]) => ({ stem, ids })) }
}

/** The node ids a matched word names (an alias, or a `word*` prefix). */
function idsFor(m: Matcher, word: string): string[] {
  const w = word.toLowerCase().replace(/\s+/g, ' ')
  const exact = m.byAlias.get(w)
  if (exact) return exact
  const out: string[] = []
  for (const p of m.prefixes) if (w.startsWith(p.stem)) out.push(...p.ids.filter(id => !out.includes(id)))
  return out
}

export type Hit = { id: string; word: string; isAmbiguous: boolean }

/** Every node `text` names, once each, by the matcher's aliases, plus milestone codes (N1d → N1). */
function hits(m: Matcher, text: string, nodes: ReadonlyMap<string, GNode>): Hit[] {
  const out = new Map<string, Hit>()
  for (const x of text.matchAll(m.re)) {
    const ids = idsFor(m, x[0])
    for (const id of ids) if (!out.has(id)) out.set(id, { id, word: x[0], isAmbiguous: ids.length > 1 })
  }
  for (const x of text.matchAll(/(?<![A-Za-z0-9])([FNG]\d{1,2})([a-z]?)(?:-[A-Z])?(?![A-Za-z0-9])/g)) {
    const code = `${x[1]}${x[2]}`
    const ws = `workstream:${code}`
    const ms = `milestone:${x[1]}`
    if (x[2] !== '' && nodes.has(ws) && !out.has(ws)) out.set(ws, { id: ws, word: x[0], isAmbiguous: false })
    if (nodes.has(ms) && !out.has(ms)) out.set(ms, { id: ms, word: x[0], isAmbiguous: false })
  }
  return [...out.values()]
}

// ---------------------------------------------------------------- building

/** The kinds names are matched against (concepts are linked by the brain alone). */
const NAMED: ReadonlySet<NodeKind> = new Set(['topic', 'milestone', 'workstream'])

const INFER: Partial<Record<NodeKind, Relation>> = {
  decision: 'decided-about',
  rule: 'applies-to',
  chat: 'works-on',
  commit: 'part-of',
  ask: 'mentions',
  card: 'part-of',
  concept: 'mentions',
}

/**
 * Merges the parts: nodes by id (the first wins, aliases joined), `?name` ends
 * found by name (or made, when the part says what to make), links guessed from
 * names, then clusters and hubs.
 */
export function buildGraph(parts: readonly Part[], now: number): Graph {
  const nodes = new Map<string, GNode>()
  for (const p of parts) {
    for (const n of p.nodes) {
      const old = nodes.get(n.id)
      if (old === undefined) nodes.set(n.id, { ...n, aliases: [...n.aliases] })
      else {
        for (const a of n.aliases) if (!old.aliases.includes(a)) old.aliases.push(a)
        if (old.text === undefined && n.text !== undefined) old.text = n.text
        if (n.at !== undefined && (old.at === undefined || n.at > old.at)) old.at = n.at
      }
    }
  }
  const named = matcher([...nodes.values()].filter(n => NAMED.has(n.kind)))
  const edges = new Map<string, GEdge>()
  const put = (e: GEdge) => {
    if (e.from === e.to || !nodes.has(e.from) || !nodes.has(e.to)) return
    const key = `${e.from}\u0000${e.to}\u0000${e.rel}`
    const old = edges.get(key)
    if (old === undefined || e.score > old.score) edges.set(key, e)
  }
  // A brain concept that is a known topic, milestone or workstream is that node.
  const PRIORITY: readonly NodeKind[] = ['topic', 'milestone', 'workstream', 'concept', 'rule']
  const nameIndex = new Map<string, string>()
  for (const kind of PRIORITY) {
    for (const x of nodes.values()) {
      if (x.kind !== kind) continue
      for (const a of [...x.aliases, x.label.toLowerCase()]) {
        if (!nameIndex.has(a)) nameIndex.set(a, x.id)
        if (nameKey(a) !== '' && !nameIndex.has(nameKey(a))) nameIndex.set(nameKey(a), x.id)
      }
    }
  }
  for (const x of [...nodes.values()]) {
    if (x.kind !== 'concept') continue
    const other = [nameIndex.get(x.label.toLowerCase()), nameIndex.get(nameKey(x.label))].find(o => o !== undefined && o !== x.id && nodes.has(o))
    if (other !== undefined) nodes.delete(x.id)
  }
  const findByName = (name: string, make?: NodeKind, source = ''): string | null => {
    const n = name.trim()
    if (n === '') return null
    if (nodes.has(n)) return n
    const lower = n.toLowerCase()
    // A milestone code as written (G5) is the milestone; a sub-code (N1d) its workstream, else its milestone.
    const code = /^([FNG]\d{1,2})([a-z]?)$/.exec(n)
    if (code !== null) {
      if (code[2] === '' && nodes.has(`milestone:${n}`)) return `milestone:${n}`
      if (code[2] !== '' && nodes.has(`workstream:${n}`)) return `workstream:${n}`
      if (nodes.has(`milestone:${code[1]}`)) return `milestone:${code[1]}`
    }
    // "the Lantern" and "Lantern" are one name (the brain wrote 58 such pairs, 2026-11-16).
    const known = [nameIndex.get(lower), nameIndex.get(nameKey(lower))].find(o => o !== undefined && nodes.has(o))
    if (known !== undefined) return known
    if (make === undefined) {
      const h = hits(named, n, nodes)
      return h.length === 1 ? (h[0] as Hit).id : null
    }
    const id = `${make}:${nameKey(n).slice(0, 60)}`
    if (id.endsWith(':')) return null
    if (!nodes.has(id)) nodes.set(id, { id, kind: make, label: clip(n, 60), aliases: [lower], source })
    nameIndex.set(lower, id)
    if (nameKey(lower) !== '') nameIndex.set(nameKey(lower), id)
    return id
  }
  for (const p of parts) {
    for (const e of p.edges) {
      const from = e.from.startsWith('?') ? findByName(e.from.slice(1), e.make, e.source) : e.from
      const to = e.to.startsWith('?') ? findByName(e.to.slice(1), e.make, e.source) : e.to
      if (from === null || to === null) continue
      const { make: _make, ...rest } = e
      put({ ...rest, from, to })
    }
  }
  // Guessed links: what each node's own words name.
  for (const n of nodes.values()) {
    const rel = INFER[n.kind]
    if (n.kind === 'doc') {
      for (const h of hits(named, docWords(n.source), nodes)) {
        put({ from: h.id, to: n.id, rel: 'documented-in', conf: h.isAmbiguous ? 'ambiguous' : 'inferred', score: h.isAmbiguous ? 0.55 : 0.85, source: `the doc's name ("${h.word}")` })
      }
      continue
    }
    if (n.kind === 'section') {
      for (const h of hits(named, n.label, nodes)) {
        put({ from: h.id, to: n.id, rel: 'documented-in', conf: h.isAmbiguous ? 'ambiguous' : 'inferred', score: h.isAmbiguous ? 0.55 : 0.85, source: `the heading ("${h.word}")` })
      }
      continue
    }
    if (rel === undefined) continue
    const words = n.kind === 'rule' ? `${n.label} ${n.aliases.join(' ')} ${n.text ?? ''}` : `${n.label} ${n.text ?? ''}`
    // A rule whose own name says the topic is about it (feedback-sounds-must-fit → audio).
    const own = n.kind === 'rule' ? new Set(hits(named, `${n.label} ${n.aliases.join(' ').replace(/-/g, ' ')}`, nodes).map(h => h.id)) : new Set<string>()
    for (const h of hits(named, words, nodes)) {
      const isCode = /^[FNG]\d/.test(h.word)
      const isShort = h.word.length <= 2 && !isCode
      const score = h.isAmbiguous ? 0.55 : isCode || own.has(h.id) ? 0.85 : isShort ? 0.65 : 0.75
      put({ from: n.id, to: h.id, rel, conf: h.isAmbiguous ? 'ambiguous' : 'inferred', score, source: `its words ("${h.word.toLowerCase()}")` })
    }
  }
  const list = [...edges.values()]
  const adj = new Map<string, GEdge[]>()
  for (const e of list) {
    for (const id of [e.from, e.to]) {
      const a = adj.get(id) ?? []
      a.push(e)
      adj.set(id, a)
    }
  }
  const counts = { extracted: 0, inferred: 0, ambiguous: 0 }
  for (const e of list) counts[e.conf]++
  const g: Graph = { nodes, edges: list, adj, cluster: new Map(), clusters: [], hubs: [], counts, builtAt: now }
  clusterGraph(g)
  g.hubs = hubsOf(g, 10)
  // A milestone's or topic's status: its newest status-log entry.
  for (const n of nodes.values()) {
    if (n.kind !== 'milestone' && n.kind !== 'topic' && n.kind !== 'workstream') continue
    const last = linked(g, n.id)
      .filter(x => x.node.kind === 'decision' && x.node.source.startsWith('docs/plan/status_'))
      .sort((a, b) => (b.node.at ?? '').localeCompare(a.node.at ?? ''))[0]
    if (last) n.status = last.node.label
  }
  return g
}

// ---------------------------------------------------------------- reading the graph

export type Linked = { node: GNode; edge: GEdge }

/** Every node one link away, with the link. */
export function linked(g: Graph, id: string): Linked[] {
  const out: Linked[] = []
  for (const e of g.adj.get(id) ?? []) {
    const other = e.from === id ? e.to : e.from
    const n = g.nodes.get(other)
    if (n) out.push({ node: n, edge: e })
  }
  return out
}

/** The most-linked nodes, leaving out docs, sections, commits and chats (graphify's god nodes). */
export function hubsOf(g: Graph, n: number): string[] {
  const skip: ReadonlySet<NodeKind> = new Set(['doc', 'section', 'commit', 'chat', 'ask'])
  return [...g.nodes.values()]
    .filter(x => !skip.has(x.kind))
    .map(x => ({ id: x.id, d: (g.adj.get(x.id) ?? []).length }))
    .filter(x => x.d > 0)
    .sort((a, b) => b.d - a.d || a.id.localeCompare(b.id))
    .slice(0, n)
    .map(x => x.id)
}

export type Focus = { id: string; score: number; word: string }

/**
 * The nodes a prompt names, best first: topics, milestones and workstreams by
 * their words, chats by app id or title, brain concepts the graph links well.
 */
export function matchPrompt(g: Graph, text: string, max = 3): Focus[] {
  const scored = new Map<string, Focus>()
  const add = (id: string, score: number, word: string) => {
    const old = scored.get(id)
    if (old === undefined || score > old.score) scored.set(id, { id, score, word })
  }
  const named = matcher([...g.nodes.values()].filter(n => NAMED.has(n.kind)))
  for (const h of hits(named, text, g.nodes)) {
    const n = g.nodes.get(h.id)
    if (!n) continue
    const base = n.kind === 'workstream' ? 3.2 : n.kind === 'milestone' ? 3 : 2.5
    add(h.id, h.isAmbiguous ? base - 1 : base, h.word)
  }
  for (const m of text.matchAll(/local_[0-9a-f-]{8,}/gi)) {
    const id = `chat:${m[0].toLowerCase()}`
    if (g.nodes.has(id)) add(id, 3, m[0])
  }
  const concepts = [...g.nodes.values()].filter(n => n.kind === 'concept' && (g.adj.get(n.id) ?? []).length >= 3)
  if (concepts.length > 0) {
    const cm = matcher(concepts.map(c => ({ ...c, aliases: c.aliases.filter(a => a.length >= 5) })))
    for (const h of hits(cm, text, g.nodes)) if (g.nodes.get(h.id)?.kind === 'concept') add(h.id, 1.5, h.word)
  }
  // A workstream beats its own milestone when both are named (N1d over N1).
  const out = [...scored.values()]
  const keep = out.filter(f => {
    if (!f.id.startsWith('milestone:')) return true
    return !out.some(o => o.id.startsWith('workstream:') && parentCode(o.id.slice('workstream:'.length)) === f.id.slice('milestone:'.length))
  })
  return keep.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, max)
}

/** Nodes whose id, alias or label matches `query` best (for the tools). */
export function findNodes(g: Graph, query: string, max = 5): GNode[] {
  const q = query.trim().toLowerCase()
  if (q === '') return []
  const exact = g.nodes.get(query.trim())
  if (exact) return [exact]
  // A whole name first ("No synthesized SFX" is the rule, not the topic its words name).
  const named = [...g.nodes.values()].filter(n => n.label.toLowerCase() === q || n.aliases.includes(q))
  if (named.length > 0) return named.slice(0, max)
  const byPrompt = matchPrompt(g, query, max).map(f => g.nodes.get(f.id)).filter((n): n is GNode => n !== undefined)
  if (byPrompt.length > 0) return byPrompt
  const rank = (n: GNode): number => {
    const l = n.label.toLowerCase()
    if (n.aliases.includes(q) || l === q) return 0
    if (l.startsWith(q)) return 1
    if (l.includes(q)) return 2
    if ((n.text ?? '').toLowerCase().includes(q)) return 3
    return 9
  }
  const kindRank: Partial<Record<NodeKind, number>> = { topic: 0, milestone: 0, workstream: 0, concept: 1, rule: 1, doc: 2, chat: 2, section: 3 }
  return [...g.nodes.values()]
    .map(n => ({ n, r: rank(n) }))
    .filter(x => x.r < 9)
    .sort((a, b) => a.r - b.r || (kindRank[a.n.kind] ?? 4) - (kindRank[b.n.kind] ?? 4) || (g.adj.get(b.n.id)?.length ?? 0) - (g.adj.get(a.n.id)?.length ?? 0))
    .slice(0, max)
    .map(x => x.n)
}

/**
 * The surest path between two nodes (each hop's cost -ln score), at most
 * `maxHops` links; its confidence is its weakest hop (graphify's rule). Hubs
 * cost a little more, so a path doesn't run through "audio" when a direct
 * link exists.
 */
export function bestPath(g: Graph, from: string, to: string, maxHops = 8): { nodes: string[]; edges: GEdge[]; weakest: number } | null {
  if (!g.nodes.has(from) || !g.nodes.has(to)) return null
  const dist = new Map<string, number>([[from, 0]])
  const hops = new Map<string, number>([[from, 0]])
  const prev = new Map<string, { id: string; edge: GEdge }>()
  const done = new Set<string>()
  const queue: string[] = [from]
  while (queue.length > 0) {
    queue.sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity))
    const cur = queue.shift() as string
    if (done.has(cur)) continue
    done.add(cur)
    if (cur === to) break
    if ((hops.get(cur) ?? 0) >= 2 * maxHops) continue // a safety cap; the hop limit holds on the result
    for (const e of g.adj.get(cur) ?? []) {
      const nxt = e.from === cur ? e.to : e.from
      if (done.has(nxt)) continue
      const degree = (g.adj.get(nxt) ?? []).length
      const cost = (dist.get(cur) ?? 0) - Math.log(e.score) + 0.25 + (nxt === to ? 0 : Math.min(0.5, degree / 400))
      if (cost < (dist.get(nxt) ?? Infinity)) {
        dist.set(nxt, cost)
        hops.set(nxt, (hops.get(cur) ?? 0) + 1)
        prev.set(nxt, { id: cur, edge: e })
        queue.push(nxt)
      }
    }
  }
  if (!prev.has(to) || (hops.get(to) ?? Infinity) > maxHops) return null
  const nodes: string[] = [to]
  const es: GEdge[] = []
  let cur = to
  while (cur !== from) {
    const p = prev.get(cur) as { id: string; edge: GEdge }
    es.unshift(p.edge)
    nodes.unshift(p.id)
    cur = p.id
  }
  return { nodes, edges: es, weakest: Math.min(...es.map(e => e.score)) }
}

// ---------------------------------------------------------------- clusters (Louvain)

/**
 * Communities by Louvain (graphify uses Leiden, with Louvain as its fallback):
 * local moves that raise modularity, then the communities folded into nodes,
 * a few levels. Each cluster is named after its most-linked topic or milestone.
 */
export function clusterGraph(g: Graph): void {
  const ids = [...g.nodes.keys()].sort()
  const index = new Map(ids.map((id, i) => [id, i]))
  let n = ids.length
  // weighted adjacency at level 0
  let links: Array<Map<number, number>> = ids.map(() => new Map())
  for (const e of g.edges) {
    const a = index.get(e.from)
    const b = index.get(e.to)
    if (a === undefined || b === undefined || a === b) continue
    links[a]?.set(b, (links[a]?.get(b) ?? 0) + e.score)
    links[b]?.set(a, (links[b]?.get(a) ?? 0) + e.score)
  }
  let member = ids.map((_, i) => i) // level-0 node → current community
  for (let level = 0; level < 4; level++) {
    const deg = links.map(m => [...m.values()].reduce((s, w) => s + w, 0))
    const m2 = deg.reduce((s, d) => s + d, 0)
    if (m2 === 0) break
    const comm = Array.from({ length: n }, (_, i) => i)
    const tot = [...deg]
    let moved = true
    let rounds = 0
    while (moved && rounds < 12) {
      moved = false
      rounds++
      for (let i = 0; i < n; i++) {
        const ci = comm[i] as number
        const ki = deg[i] as number
        const toComm = new Map<number, number>()
        for (const [j, w] of links[i] as Map<number, number>) {
          if (j === i) continue
          const cj = comm[j] as number
          toComm.set(cj, (toComm.get(cj) ?? 0) + w)
        }
        tot[ci] = (tot[ci] as number) - ki
        let best = ci
        let bestGain = (toComm.get(ci) ?? 0) - ((tot[ci] as number) * ki) / m2
        for (const [c, w] of toComm) {
          const gain = w - ((tot[c] as number) * ki) / m2
          if (gain > bestGain + 1e-12) {
            bestGain = gain
            best = c
          }
        }
        tot[best] = (tot[best] as number) + ki
        if (best !== ci) {
          comm[i] = best
          moved = true
        }
      }
    }
    // renumber and fold
    const renum = new Map<number, number>()
    for (const c of comm) if (!renum.has(c)) renum.set(c, renum.size)
    if (renum.size === n) break
    member = member.map(c => renum.get(comm[c] as number) as number)
    const next: Array<Map<number, number>> = Array.from({ length: renum.size }, () => new Map())
    for (let i = 0; i < n; i++) {
      const a = renum.get(comm[i] as number) as number
      for (const [j, w] of links[i] as Map<number, number>) {
        // a community's inside weight stays as its own loop: its degree must not shrink
        const b = renum.get(comm[j] as number) as number
        next[a]?.set(b, (next[a]?.get(b) ?? 0) + w)
      }
    }
    links = next
    n = renum.size
  }
  const groups = new Map<number, string[]>()
  ids.forEach((id, i) => {
    const c = member[i] as number
    const list = groups.get(c) ?? []
    list.push(id)
    groups.set(c, list)
  })
  const degree = (id: string) => (g.adj.get(id) ?? []).length
  const ordered = [...groups.values()].filter(l => l.length >= 3).sort((a, b) => b.length - a.length)
  g.cluster.clear()
  g.clusters = ordered.map((list, k) => {
    for (const id of list) g.cluster.set(id, k)
    const top = [...list].sort((a, b) => degree(b) - degree(a) || a.localeCompare(b))
    const namer = top.find(id => {
      const kind = g.nodes.get(id)?.kind
      return kind === 'topic' || kind === 'milestone' || kind === 'workstream'
    })
    const name = g.nodes.get(namer ?? (top[0] as string))?.label ?? '?'
    return { name, size: list.length, top: top.filter(id => !/^(section|commit|doc):/.test(id)).slice(0, 6) }
  })
}
