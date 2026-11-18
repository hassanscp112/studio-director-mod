// Studio Director, stage 8: the memory graph's engine side (docs/STUDIO_DIRECTOR.md
// §5.11). The graph is derived, never stored in git: rebuilt in memory at most once
// a minute, only the files whose mtime changed read again. The brain pass (Haiku,
// in the director chat only) keeps its answers in brain.json in the project's own
// folder under ~/.claude/projects, outside the repo, beside the memory folder.
// Nothing from the memory folder is ever written into the repo.
import type { EngineInterface as Engine } from 'claude-code'

import type { CardFile, Report } from '../types'
import {
  BRAIN_DIRS,
  BRAIN_FILE,
  BRAIN_MAX_TOKENS,
  BRAIN_MODEL,
  BRAIN_PARALLEL,
  BRAIN_SYSTEM,
  BRAIN_TIMEOUT_MS,
  brainLine,
  brainPart,
  brainPrompt,
  chunkDoc,
  emptyBrain,
  parseBrain,
  parseFragment,
  pendingChunks,
  pruneBrain,
} from './brain'
import type { BrainCache, Chunk } from './brain'
import {
  buildGraph,
  cardsPart,
  claudePart,
  commitsPart,
  docPart,
  masterPlanPart,
  matchPrompt,
  memoryPart,
  memoryTitles,
  notesPart,
  reportsPart,
  statusPart,
  topicsPart,
} from './graph'
import type { Graph, Part } from './graph'
import { projectSlug } from './guard'
import { FALLBACK_MS, fallbackLabels, recallBlock, wantsFallback } from './recall'

export const GRAPH_MS = 60_000
const BRAIN_TICK_MS = 4000
const BRAIN_RETRY_MS = 10 * 60_000
const COMMITS = 60

export type GraphCtx = { root: string; home: string }

/** The memory folder: ~/.claude/projects/<slug>/memory (the user's private notes). */
export const memoryDir = (c: GraphCtx): string => `${c.home.replace(/\\/g, '/').replace(/\/+$/, '')}/.claude/projects/${projectSlug(c.root)}/memory`
/** The graph's own folder, outside the repo: brain.json, and map.html from stage 9. */
export const graphDir = (c: GraphCtx): string => `${c.home.replace(/\\/g, '/').replace(/\/+$/, '')}/.claude/projects/${projectSlug(c.root)}/studio-graph`

// Module state: starts over on a reload (the brain's answers live in brain.json).
type Cached = { mtime: number; part: Part; chunks: Chunk[] }
const files = new Map<string, Cached>()
let graph: Graph | null = null
let checkedAt = 0
let inputsKey = ''
let building: Promise<Graph | null> | null = null
let brain: BrainCache | null = null
let brainLoaded = false
let brainEntries = -1 // entries the graph was last built with
const inFlight = new Set<string>()
const failedAt = new Map<string, number>()
let brainTimer: { cancel: () => void } | null = null
let brainPaused = false
let brainCtx: GraphCtx | null = null
let saveChain: Promise<unknown> = Promise.resolve()

/** The user's home folder, from the environment. */
export async function homeDir($: Engine): Promise<string> {
  const v = (await $.env.get('USERPROFILE').catch(() => undefined)) ?? (await $.env.get('HOME').catch(() => undefined))
  return typeof v === 'string' ? v : ''
}

async function readText($: Engine, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

async function listMd($: Engine, dir: string): Promise<Array<{ name: string; mtime: number }>> {
  try {
    return (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.toLowerCase().endsWith('.md')).map(f => ({ name: f.name, mtime: f.mtimeMs }))
  } catch {
    return []
  }
}

/** What one repo file adds: its doc and sections, and what its kind adds (milestones, decisions, rules). */
function partsOf(rel: string, text: string): Part {
  const p: Part[] = []
  if (rel === 'docs/studio/notes.md' || rel === 'docs/studio/notes_archive.md') p.push(notesPart(rel, text))
  else if (rel === 'CLAUDE.md') p.push(claudePart(rel, text), docPart(rel, text))
  else {
    p.push(docPart(rel, text))
    if (rel === 'docs/MASTER_PLAN.md') p.push(masterPlanPart(rel, text))
    if (/^docs\/plan\/status_\d+\.md$/.test(rel)) p.push(statusPart(rel, text))
  }
  return { nodes: p.flatMap(x => x.nodes), edges: p.flatMap(x => x.edges) }
}

const isBrainDoc = (rel: string) => (BRAIN_DIRS as readonly string[]).includes(rel.slice(0, rel.lastIndexOf('/')))

/** Re-reads the files whose mtime changed; drops the ones gone. True when anything changed. */
async function scanFiles($: Engine, c: GraphCtx): Promise<boolean> {
  const seen = new Set<string>()
  let changed = false
  const visit = async (key: string, mtime: number, make: () => Promise<{ part: Part; chunks: Chunk[] } | null>) => {
    seen.add(key)
    const old = files.get(key)
    if (old !== undefined && old.mtime === mtime) return
    const made = await make()
    if (made === null) return
    files.set(key, { mtime, ...made })
    changed = true
  }
  const repo = async (rel: string, mtime: number) =>
    visit(rel, mtime, async () => {
      const text = await readText($, `${c.root}/${rel}`)
      if (text === null) return null
      return { part: partsOf(rel, text), chunks: isBrainDoc(rel) ? chunkDoc(rel, text) : [] }
    })
  for (const dir of [...BRAIN_DIRS, 'docs/studio']) {
    for (const f of await listMd($, `${c.root}/${dir}`)) {
      if (dir === 'docs/studio' && f.name !== 'notes.md' && f.name !== 'notes_archive.md') continue
      await repo(`${dir}/${f.name}`, f.mtime)
    }
  }
  const claude = await $.fs.stat(`${c.root}/CLAUDE.md`).catch(() => null)
  if (claude !== null) await repo('CLAUDE.md', claude.mtimeMs)
  // The memory folder: read, never written into the repo. A new index renames every rule.
  const mem = memoryDir(c)
  const list = await listMd($, mem)
  const index = list.find(f => f.name === 'MEMORY.md')
  let titles: Promise<Record<string, string>> | null = null
  for (const f of list) {
    if (f.name === 'MEMORY.md') continue
    await visit(`memory/${f.name}`, f.mtime + (index?.mtime ?? 0), async () => {
      titles ??= readText($, `${mem}/MEMORY.md`).then(t => memoryTitles(t ?? ''))
      const names = await titles
      const text = await readText($, `${mem}/${f.name}`)
      return text === null ? null : { part: memoryPart(f.name, text, names[f.name]), chunks: [] }
    })
  }
  for (const key of [...files.keys()]) {
    if (!seen.has(key)) {
      files.delete(key)
      changed = true
    }
  }
  return changed
}

async function gitLog($: Engine, root: string): Promise<string> {
  try {
    const r = await $.process.run(['git', 'log', `-${COMMITS}`, '--format=%h%x1f%s%x1f%cI'], { cwd: root, timeoutMs: 10_000 })
    return r.exitCode === 0 ? r.stdout : ''
  } catch {
    return ''
  }
}

export type Live = { reports: readonly Report[]; cards: readonly CardFile[] }

/**
 * The graph, rebuilt at most once a minute (or when forced): changed files
 * re-read, the reports, cards, commits and the brain's answers laid over them.
 * Null outside a git checkout.
 */
export async function loadGraph($: Engine, c: GraphCtx, live: () => Promise<Live>, isForced = false): Promise<Graph | null> {
  if (c.root === '') return null
  const now = await $.clock.now()
  if (!isForced && graph !== null && now - checkedAt < GRAPH_MS) return graph
  if (building !== null) return building
  building = (async () => {
    try {
      checkedAt = now
      await loadBrain($, c)
      const changed = await scanFiles($, c)
      // A doc changed: the brain reads its new chunks (in the director chat, where it runs).
      if (changed && brainCtx !== null && !brainPaused) startBrain($, brainCtx)
      const { reports, cards } = await live()
      const log = await gitLog($, c.root)
      const entries = brain === null ? 0 : Object.keys(brain.entries).length
      const key = JSON.stringify([
        reports.map(r => [r.appId, r.tag, r.state, r.title, r.ask?.question ?? '', r.lastCommit?.hash ?? '', r.updatedAt.slice(0, 15)]),
        cards.map(x => [x.id, x.pin, x.updatedAt]),
        log.length,
        log.slice(0, 200),
      ])
      if (graph !== null && !changed && key === inputsKey && entries === brainEntries) return graph
      inputsKey = key
      brainEntries = entries
      const parts: Part[] = [topicsPart(), ...[...files.values()].map(f => f.part), reportsPart(reports), cardsPart(cards), commitsPart(log)]
      if (brain !== null) parts.push(brainPart(brain))
      graph = buildGraph(parts, now)
      return graph
    } catch {
      return graph
    } finally {
      building = null
    }
  })()
  return building
}

/** The graph as last built, without reading anything. */
export const lastGraph = (): Graph | null => graph

/** Waits `ms` on the engine's clock for `p`, else `fallback`. */
async function within<T, F>($: Engine, p: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  const timer: { t: { cancel: () => void } | null } = { t: null }
  const late = new Promise<F>(resolve => {
    timer.t = $.clock.after(ms, () => resolve(fallback))
  })
  try {
    return await Promise.race([p, late])
  } finally {
    timer.t?.cancel()
  }
}

/**
 * The <studio-recall> block for one prompt, or null when it names nothing the
 * graph knows. When the words match nothing, Haiku picks a topic (3 s at most).
 */
export async function recallFor($: Engine, c: GraphCtx, live: () => Promise<Live>, text: string, withFallback = true): Promise<string | null> {
  const g = await loadGraph($, c, live)
  if (g === null || text.trim() === '') return null
  let focus = matchPrompt(g, text)
  if (focus.length === 0 && withFallback && wantsFallback(text)) {
    const labels = fallbackLabels(g)
    const none = 'none of these'
    const ask = $.model.classify(text.slice(0, 2000), [...labels.keys(), none], { model: BRAIN_MODEL }).catch(() => undefined)
    const label = await within($, ask, FALLBACK_MS, undefined)
    const id = label === undefined || label === none ? undefined : labels.get(label)
    if (id !== undefined) focus = [{ id, score: 1, word: `(Haiku: ${label})` }]
  }
  return recallBlock(g, focus)
}

// ---------------------------------------------------------------- the brain pass

async function loadBrain($: Engine, c: GraphCtx): Promise<void> {
  if (brainLoaded || c.home === '') return
  brain = parseBrain(await readText($, `${graphDir(c)}/${BRAIN_FILE}`))
  brainLoaded = true
}

function saveBrain($: Engine, c: GraphCtx): void {
  const snapshot = brain
  if (snapshot === null || c.home === '') return
  saveChain = saveChain.then(() => $.fs.write(`${graphDir(c)}/${BRAIN_FILE}`, JSON.stringify(snapshot))).catch(() => undefined)
}

/** Every doc chunk the brain reads, from the files as last scanned. */
const allChunks = (): Chunk[] => [...files.values()].flatMap(f => f.chunks)

/** The names the brain is asked to reuse: the topics and milestones. */
function knownNames(): string[] {
  const g = graph
  if (g === null) return []
  return [...g.nodes.values()].filter(n => n.kind === 'topic' || n.kind === 'milestone').map(n => n.label)
}

/** One chunk read by Haiku, its answer kept. */
async function readChunk($: Engine, c: GraphCtx, chunk: Chunk): Promise<void> {
  inFlight.add(chunk.key)
  try {
    const r = await $.model.complete({
      model: BRAIN_MODEL,
      maxTokens: BRAIN_MAX_TOKENS,
      timeoutMs: BRAIN_TIMEOUT_MS,
      system: BRAIN_SYSTEM,
      prompt: brainPrompt(chunk, knownNames()),
    })
    const cache = brain ?? emptyBrain()
    const u = r.usage
    cache.spent.calls++
    cache.spent.in += u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
    cache.spent.out += u.output_tokens
    const fragment = r.isAnswered ? parseFragment(r.text) : null
    if (fragment === null) {
      cache.spent.failed++
      failedAt.set(chunk.key, await $.clock.now())
    } else {
      cache.entries[chunk.key] = { hash: chunk.hash, at: new Date(await $.clock.now()).toISOString(), fragment, sectionId: chunk.sectionId, heading: chunk.heading }
      failedAt.delete(chunk.key)
    }
    brain = cache
    saveBrain($, c)
  } catch {
    failedAt.set(chunk.key, await $.clock.now())
  } finally {
    inFlight.delete(chunk.key)
  }
}

/** One step of the brain pass: start reads up to BRAIN_PARALLEL; stop the timer when nothing is left. */
async function brainStep($: Engine): Promise<void> {
  const c = brainCtx
  if (c === null || brainPaused) return
  await loadBrain($, c)
  if (brain === null) return
  if (files.size === 0) return // the graph hasn't scanned yet
  const now = await $.clock.now()
  const chunks = allChunks()
  const pruned = pruneBrain(brain, chunks)
  if (Object.keys(pruned.entries).length !== Object.keys(brain.entries).length) {
    brain = pruned
    saveBrain($, c)
  }
  const todo = pendingChunks(chunks, brain).filter(x => !inFlight.has(x.key) && now - (failedAt.get(x.key) ?? -Infinity) > BRAIN_RETRY_MS)
  if (todo.length === 0 && inFlight.size === 0) {
    if (pendingChunks(chunks, brain).length === 0) stopBrain()
    return
  }
  for (const chunk of todo.slice(0, Math.max(0, BRAIN_PARALLEL - inFlight.size))) void readChunk($, c, chunk)
}

/** The brain pass runs in the background in the director chat: a timer, a chunk or two at a time. */
export function startBrain($: Engine, c: GraphCtx): void {
  brainCtx = c
  if (brainTimer !== null || c.home === '' || c.root === '') return
  brainTimer = $.clock.every(BRAIN_TICK_MS, () => {
    void brainStep($)
  })
}

export function stopBrain(): void {
  brainTimer?.cancel()
  brainTimer = null
}

export function pauseBrain(isPaused: boolean): void {
  brainPaused = isPaused
}

/** `/studio brain`'s line, and what studio_overview says of the brain. */
export async function brainStatus($: Engine, c: GraphCtx): Promise<string> {
  await loadBrain($, c)
  const chunks = allChunks()
  const cache = brain ?? emptyBrain()
  const done = chunks.length - pendingChunks(chunks, cache).length
  const state = brainPaused ? 'paused' : brainTimer !== null ? (inFlight.size > 0 ? 'reading' : 'running') : chunks.length === 0 ? 'not started' : done === chunks.length ? 'up to date' : 'stopped'
  return brainLine(done, chunks.length, cache.spent, state)
}
