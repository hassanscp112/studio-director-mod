// Studio Director, stage 8: the brain pass (docs/STUDIO_DIRECTOR.md §5.11).
// Pure functions, no engine calls. graphify's third pass, ours: a small model
// (Haiku) reads each doc once, a chunk at a time, and names the ideas in it and
// how they connect. Each answer is cached by the chunk's content hash outside the
// repo, so only a changed chunk is read again. The answers become concept nodes
// and guessed links (scored on graphify's rubric).
import { bareName, clip, nameKey, snapScore } from './graph'
import type { Part, PartEdge } from './graph'

/** The docs the brain reads (repo-relative folders; `.md` files directly inside). */
export const BRAIN_DIRS = ['docs', 'docs/design', 'docs/plan', 'docs/slip7'] as const
/** The brain's model, by full id (the user settings map short names elsewhere). */
export const BRAIN_MODEL = 'claude-haiku-5-5'
export const BRAIN_MAX_TOKENS = 1500
export const BRAIN_TIMEOUT_MS = 90_000
/** Characters per chunk (about 4k tokens). */
export const CHUNK_CHARS = 16_000
/** Calls on their way at once. */
export const BRAIN_PARALLEL = 2
export const BRAIN_FILE = 'brain.json'

/** FNV-1a, 32-bit, hex: a chunk's content hash (no crypto in the hooks module). */
export function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${h.toString(16).padStart(8, '0')}${text.length.toString(16)}`
}

export type Chunk = {
  /** `<path>#<n>`. */
  key: string
  path: string
  hash: string
  /** The section the chunk starts in: `section:<path>#L<line>` (or the doc when before any heading). */
  sectionId: string
  heading: string
  text: string
}

/**
 * A doc cut into chunks at headings (`##` first, then `###`), each under
 * CHUNK_CHARS; a section longer than that is cut by lines.
 */
export function chunkDoc(path: string, text: string, max = CHUNK_CHARS): Chunk[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  type Piece = { line: number; heading: string; lines: string[] }
  const pieces: Piece[] = []
  let cur: Piece = { line: 0, heading: '', lines: [] }
  let inFence = false
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) inFence = !inFence
    const h = !inFence ? /^(#{1,4}) (.+)$/.exec(l) : null
    if (h && (h[1] as string).length >= 2) {
      if (cur.lines.length > 0) pieces.push(cur)
      cur = { line: i + 1, heading: (h[2] as string).trim(), lines: [] }
    }
    cur.lines.push(l)
  })
  if (cur.lines.length > 0) pieces.push(cur)
  const chunks: Chunk[] = []
  let acc: Piece | null = null
  const flush = () => {
    if (acc === null) return
    const body = acc.lines.join('\n')
    if (body.trim() !== '') {
      chunks.push({
        key: `${path}#${chunks.length}`,
        path,
        hash: hash(body),
        sectionId: acc.line > 0 ? `section:${path}#L${acc.line}` : `doc:${path}`,
        heading: acc.heading,
        text: body,
      })
    }
    acc = null
  }
  for (const p of pieces) {
    const size = p.lines.join('\n').length
    if (size > max) {
      flush()
      let part: string[] = []
      let len = 0
      for (const l of p.lines) {
        if (len + l.length + 1 > max && part.length > 0) {
          acc = { line: p.line, heading: p.heading, lines: part }
          flush()
          part = []
          len = 0
        }
        part.push(l)
        len += l.length + 1
      }
      acc = { line: p.line, heading: p.heading, lines: part }
      flush()
      continue
    }
    if (acc !== null && acc.lines.join('\n').length + size + 1 > max) flush()
    if (acc === null) acc = { line: p.line, heading: p.heading, lines: [...p.lines] }
    else acc.lines.push(...p.lines)
  }
  flush()
  return chunks
}

export type BrainConcept = { name: string; is: string }
export type BrainLink = { a: string; rel: string; b: string; sure: number }
export type Fragment = { concepts: BrainConcept[]; links: BrainLink[] }

/** One chunk's answer, kept by key. */
export type BrainEntry = { hash: string; at: string; fragment: Fragment; sectionId: string; heading: string }

/** brain.json, outside the repo. */
export type BrainCache = {
  schema: 1
  model: string
  entries: Record<string, BrainEntry>
  /** Tokens spent so far, in and out. */
  spent: { in: number; out: number; calls: number; failed: number }
}

export const emptyBrain = (): BrainCache => ({ schema: 1, model: BRAIN_MODEL, entries: {}, spent: { in: 0, out: 0, calls: 0, failed: 0 } })

export function parseBrain(text: string | null): BrainCache {
  if (text === null) return emptyBrain()
  try {
    const x = JSON.parse(text) as Partial<BrainCache>
    if (x.schema !== 1 || typeof x.entries !== 'object' || x.entries === null) return emptyBrain()
    return {
      schema: 1,
      model: typeof x.model === 'string' ? x.model : BRAIN_MODEL,
      entries: x.entries as Record<string, BrainEntry>,
      spent: { in: 0, out: 0, calls: 0, failed: 0, ...(x.spent ?? {}) },
    }
  } catch {
    return emptyBrain()
  }
}

export const BRAIN_SYSTEM = `You read one part of the design and production docs of Scrapshift, a 1-4 player co-op horror game about robot workers (Godot, built by AI chats). You extract a small knowledge graph from it for the studio's director, who must not forget how things connect.

Answer with JSON only, no prose, no code fence:
{"concepts":[{"name":"...","is":"..."}],"links":[{"a":"...","rel":"...","b":"...","sure":0.85}]}

- concepts: at most 12 things the text is about that a director would ask about later: places, rooms, systems, mechanics, characters, enemies, tools, pipelines, rules, constraints. "name" is short (1-4 words), as the text names it; "is" says what it is in at most 10 words.
- links: at most 15 links between concepts (or between a concept and a known name below), each "rel" a verb phrase of at most 4 words ("travels through", "replaces", "is judged in", "must not use").
- "sure": 0.95 when the text states the link outright, 0.85 strong, 0.75 reasonable, 0.65 weak, 0.55 a guess.
- Reuse a known name exactly when the text means it. Skip trivia, file paths, numbers and dates.`

/** The prompt for one chunk: the known names, the doc and heading, the text. */
export function brainPrompt(chunk: Chunk, known: readonly string[]): string {
  return [
    `Known names: ${known.join(', ')}`,
    `Doc: ${chunk.path}${chunk.heading ? ` · section "${chunk.heading}"` : ''}`,
    '',
    '<text>',
    chunk.text,
    '</text>',
  ].join('\n')
}

/** The model's answer as a fragment; null when it holds no JSON object. Bad items are dropped. */
export function parseFragment(text: string): Fragment | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let x: unknown
  try {
    x = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  const o = x as { concepts?: unknown; links?: unknown }
  const str = (v: unknown, n: number) => (typeof v === 'string' ? clip(v, n) : '')
  const concepts = (Array.isArray(o.concepts) ? o.concepts : [])
    .map(c => ({ name: str((c as { name?: unknown }).name, 60), is: str((c as { is?: unknown }).is, 120) }))
    .filter(c => c.name.length >= 2)
    .slice(0, 12)
  const links = (Array.isArray(o.links) ? o.links : [])
    .map(l => {
      const y = l as { a?: unknown; rel?: unknown; b?: unknown; sure?: unknown }
      return { a: str(y.a, 60), rel: str(y.rel, 40), b: str(y.b, 60), sure: snapScore(typeof y.sure === 'number' ? y.sure : 0.75) }
    })
    .filter(l => l.a.length >= 2 && l.b.length >= 2 && l.rel !== '' && l.a.toLowerCase() !== l.b.toLowerCase())
    .slice(0, 15)
  return { concepts, links }
}

/**
 * The brain's answers as one part: each concept a node (or a known node, found
 * by name when the graph is built), mentioned in its section; each link a guessed
 * edge with the model's score and its own words.
 */
export function brainPart(cache: BrainCache): Part {
  const nodes: Part['nodes'] = []
  const edges: PartEdge[] = []
  for (const [key, entry] of Object.entries(cache.entries)) {
    const path = key.replace(/#\d+$/, '')
    const source = `brain ${path}${entry.heading ? ` §"${clip(entry.heading, 50)}"` : ''}`
    for (const c of entry.fragment.concepts) {
      // "the Lantern" and "Lantern", "LanternBrain" and "Lantern brain": one concept each.
      const id = `concept:${nameKey(c.name).slice(0, 60)}`
      if (id === 'concept:') continue
      nodes.push({ id, kind: 'concept', label: c.name, aliases: [...new Set([c.name.toLowerCase(), bareName(c.name)])], source, text: c.is })
      edges.push({ from: `?${c.name}`, to: entry.sectionId, rel: 'documented-in', conf: 'inferred', score: 0.95, source, make: 'concept' })
    }
    for (const l of entry.fragment.links) {
      edges.push({ from: `?${l.a}`, to: `?${l.b}`, rel: 'related', conf: 'inferred', score: l.sure, source, label: l.rel, make: 'concept' })
    }
  }
  return { nodes, edges }
}

/** What is left to read: chunks whose hash the cache doesn't hold. */
export function pendingChunks(chunks: readonly Chunk[], cache: BrainCache): Chunk[] {
  return chunks.filter(c => cache.entries[c.key]?.hash !== c.hash)
}

/** The cache without entries for chunks that no longer exist. */
export function pruneBrain(cache: BrainCache, chunks: readonly Chunk[]): BrainCache {
  const keys = new Set(chunks.map(c => c.key))
  const entries: Record<string, BrainEntry> = {}
  for (const [k, v] of Object.entries(cache.entries)) if (keys.has(k)) entries[k] = v
  return { ...cache, entries }
}

/** `/studio brain`'s line. */
export function brainLine(done: number, total: number, spent: BrainCache['spent'], state: string): string {
  const k = (n: number) => `${Math.round(n / 1000)}k`
  return `brain: ${done} of ${total} doc chunks read (${state}) · ${spent.calls} Haiku calls, ${k(spent.in)} tokens in, ${k(spent.out)} out${spent.failed > 0 ? ` · ${spent.failed} failed (retried later)` : ''}`
}
