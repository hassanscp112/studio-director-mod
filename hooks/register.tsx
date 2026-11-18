// Studio Director (docs/STUDIO_DIRECTOR.md).
// Stage 1, the reporter (§5.1, §5.8): every Scrapshift chat writes its own
// docs/studio/sessions/<app-session-id>.json at each turn's start and end; a
// worker's commit that takes in docs/studio/ is refused.
// Stage 2, the board (§5.2): a pane and `/studio` show every chat's report,
// grouped; a new waiting ask in another chat shows as a toast.
// Stage 3, director mode (§5.3, §5.4, §5.6, §5.8): `/director` makes a fresh chat
// the director: its role as a system section, a snapshot of the board on each of
// the user's prompts, the notes file, a guard that refuses building, and the
// board commit (docs/studio/ alone).
// Stage 4, auto model (§5.9): docs/studio/model_policy.md; each prompt's class (one
// small-model call, 800 ms, fails safe); each subagent's model set by full id from
// the policy, never above the chat's own; the chat's model and effort never touched
// (S9); routings in the report and on the board; the director's D7 consent gate.
// Stage 5, the reset (§5.5, D3): the director chat clears itself between turns past
// 600k tokens or after 55 min away, once any decision is in docs/studio/notes.md;
// no ask, a dim line says so; never twice in a row with smart-compact.
// Stage 6, the ask box (§3 shape C, §7): a field in the board pane; each question
// is one $.model.complete (Opus 5.5, low) over a fresh full snapshot and the pane's
// last 3 turns. No tools, no turn, no chat context, nothing written.
// Stage 7, the UI (§5.2, §5.10): the pane is a dashboard (hooks/pane.tsx draws it,
// hooks/cards.ts holds what its cards show): usage bars, tabs, a card per chat, a
// kanban whose hand-made cards and pins are files in docs/studio/cards/, notes,
// models, the ask box. In the director chat the pane's field and card buttons send
// a prompt to the chat itself. `/studio` draws the board in the transcript; the
// footer says `director`; `/director fresh` clears a used chat first, `/director off`
// leaves the mode.
import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type {
  AppSession,
  Lead,
  Ask,
  AskLog,
  AskTurn,
  BoardHeader,
  BoardView,
  CardFile,
  Column,
  Commit,
  DirectorMark,
  PaneExtras,
  PaneUi,
  Report,
  ResetRecord,
  Routing,
} from '../types'
import { boardText, clip, countUncommitted, groupRows, markSeen, newWaits, parseRow, readSessions, readLastCommit, readPlan, toastText, withSessions } from './board'
import { CARDS_DIR, answerPrompt, briefPrompt, busyWith, cardFileName, directorRow, newCard, notesTail, parseCard, pinned, readFilter, serializeCard } from './cards'
import type { KanbanItem } from './cards'
import { LEADS_FILE, byLead, leadGroupOf, parseLeads } from './leads'
import { commandTree, glanceTree, paneTree } from './pane'
import type { PaneActions, PaneModel } from './pane'
import {
  STUDIO_DIR,
  applyPatch,
  emptyReport,
  pickTag,
  planCommit,
  readContext,
  readQuestion,
  readSelf,
  readStatus,
  readWrapUp,
  recapFromAnswer,
  refusal,
  reportName,
  rootFromCommonDir,
  serialize,
  studioCommitNote,
} from './parse'
import {
  ARCHIVE_FILE,
  DIRECTOR_TAG,
  FIRST_PROMPT,
  NOTES_FILE,
  NOTES_SEED,
  ROLE_TEXT,
  addNote,
  appendArchive,
  capNotes,
  isUsedChat,
  snapshotText,
  leadSnapshotText,
} from './director'
import { directorCommitRefusal, guardRefusal, guardTool } from './guard'
import { POLICY_SEED } from './policy_seed'
import {
  CLASSIFY_CHARS,
  CLASSIFY_MAX_MS,
  CLASSIFY_MODEL,
  CLASSIFY_MS,
  POLICY_FILE,
  ROUTINGS_KEPT,
  TURN_CLASSES,
  consentRefusal,
  parsePolicy,
  readClass,
  routeSubagent,
} from './route'
import type { Policy } from './route'
import {
  COMPACT_ARGS,
  DECISION_LABEL,
  DECISION_LABELS,
  DECISION_WAIT_MS,
  IDLE_MS,
  RESET_DELAY_MS,
  RESET_TOKENS,
  SKIP_TWICE,
  decisionTool,
  carryBlock,
  noteLine,
  pushAsk,
  replyTail,
  owedNote,
  readMethod,
  resetDecision,
  resetLine,
} from './reset'
import type { ResetKind, ResetMethod } from './reset'
import {
  ASK_EFFORT,
  ASK_MAX_TOKENS,
  ASK_MODEL,
  ASK_SYSTEM,
  ASK_TIMEOUT_MS,
  addTurn,
  askPrompt,
  cleanQuestion,
  earlierTurns,
  failText,
  askLines,
} from './ask'
import { brainStatus, graphDir, homeDir, lastGraph, loadGraph, pauseBrain, recallFor, startBrain } from './memory'
import type { Graph } from './graph'
import { HOME, homeView, jumpOptions, mapLayout, mapSvg, mapView, moves, nextTrail, reminderBrief } from './map'
import { OTHER, PLAN_HOME, findArea, planAreas, planItems, planJump, planSummary, planSvg, planView, startPrompt } from './plan'
import type { PlanPane } from './pane'
import { mapHtml } from './maphtml'
import type { MapPane } from './pane'
import type { GraphCtx, Live } from './memory'
import {
  NUDGE_CAP,
  NUDGE_TEXT,
  TOOL_NAMES,
  findSection,
  graphLine,
  isDocRead,
  overviewText,
  pathText,
  recallToolText,
  sectionText,
  startRefusal,
} from './recall'

const reportRef = atom({ plugin: 'studio', key: 'report' } as const, null)
const manualTagRef = atom({ plugin: 'studio', key: 'manualTag' } as const, null)
const allowRef = atom({ plugin: 'studio', key: 'allowCommitUntil' } as const, 0)
// Change the tag when BoardView's fields change: it declines what an earlier version stored.
const boardRef = atom({ plugin: 'studio', key: 'board' } as const, null, { shape: 'board-1' })
const boardOpenRef = atom({ plugin: 'studio', key: 'boardOpen' } as const, false)
const quietRef = atom({ plugin: 'studio', key: 'quietOpen' } as const, false)
const directorRef = atom({ plugin: 'studio', key: 'director' } as const, null)
const snapRef = atom({ plugin: 'studio', key: 'snapSeen' } as const, null)
// Stage 11: what a lead chat's own snapshot last sent.
const leadSnapRef = atom({ plugin: 'studio', key: 'leadSnapSeen' } as const, null)
const noteOwedRef = atom({ plugin: 'studio', key: 'noteOwed' } as const, null)
const lastResetRef = atom({ plugin: 'studio', key: 'lastReset' } as const, null)
// The carry-over (user, 2026-11-18). Change the tag when Carry's fields change.
const carryRef = atom({ plugin: 'studio', key: 'carry' } as const, null, { shape: 'carry-1' })
// Change the tag when AskLog's fields change.
const EMPTY_ASK: AskLog = { turns: [], pending: null, seq: 0 }
const askRef = atom({ plugin: 'studio', key: 'askLog' } as const, EMPTY_ASK, { shape: 'ask-1' })
// Stage 7. Change a tag when its type's fields change.
const PANE_UI: PaneUi = {
  tab: 'board',
  filter: 'all',
  boardBy: 'lead',
  openLeads: [],
  openRecaps: [],
  allRecent: false,
  openColumns: [],
  askMode: 'director',
  seq: 0,
  sent: null,
  mapFocus: 'home',
  mapTrail: [],
  mapFile: null,
  mapMode: 'plan',
  planFocus: 'home',
  planPick: null,
}
const paneUiRef = atom({ plugin: 'studio', key: 'paneUi' } as const, PANE_UI, { shape: 'pane-6' })
const EMPTY_EXTRAS: PaneExtras = { notes: [], cards: [], directors: [] }
const extrasRef = atom({ plugin: 'studio', key: 'paneExtras' } as const, EMPTY_EXTRAS, { shape: 'extras-2' })
const offerRef = atom({ plugin: 'studio', key: 'directorOffer' } as const, false)

const PANE = 'studio-board'
const PANE_TITLE = 'Studio'
const POLL_MS = 15_000
const HEADER_MS = 60_000
const TOASTED = 'toasted' // $.store: wait key -> when it was toasted, shared by every chat

const WRAP_UP = 'mcp__ccd_turn__wrap_up'
const ALLOW_MS = 10 * 60_000
const GIT_MS = 10_000

// Module state: starts over on a reload (the report itself lives in $.state).
let root = '' // the main checkout's root ('' until known; the reporter writes nothing without it)
let cwd = ''
let isOptedIn = false // STUDIO_REPORTER=always: write cli-<id> files outside the app too (headless tests)
let appId: string | null = null
let title = ''
let model = ''
let effort = ''
let wrap: { recap: string; ask: Ask | null } | null = null
let chain: Promise<unknown> = Promise.resolve()
// The board's module state.
const attached = new Set<string>() // surfaces drawing this chat now
let poll: { cancel: () => void } | null = null
let header: { at: number; value: BoardHeader } | null = null
let appList: { at: number; value: { rows: AppSession[]; isCut: boolean } } | null = null
let leadsCache: { at: number; value: Lead[] } | null = null // docs/studio/leads.md, read at most once a minute (stage 11)
const LIST_LIMIT = 50
const SEEDED = 'roster' // stands for a surface already attached when this module loaded (a reload)
let isPolling = false
// Director mode's module state (the mark itself lives in $.state).
let isDirector = false
// Auto model's module state (stage 4).
let turnSeq = 0 // main-thread turns since load
let isTurnRunning = false // a main-thread turn is running now
let isSending = false // a prompt from the pane is on its way to the chat (stage 7)
let consentTurn = -1 // the turn in which an AskUserQuestion was last answered (D7)
let turnClass: string | null = null
type ClassOutcome = { cls: string | null; ms: number | null }
let classPending: Promise<ClassOutcome> | null = null
let policyCache: { at: number; value: Policy } | null = null
const POLICY_MS = 60_000
const BUILT_IN: Policy = parsePolicy(POLICY_SEED) ?? { rules: [] }
const ROLE_ID = 'studio:director'
// The ask box's module state (stage 6): the call on its way, so Cancel can stop it.
let askStop: AbortController | null = null
// The reset's module state (stage 5).
const DIRECTORS = 'directors' // $.store: app id -> when it became the director (a mark that outlives a lost $.state)
/** Mod-run /clear in the director chat (§5.5); /compact when a clear is refused, or by STUDIO_RESET. */
const DEFAULT_METHOD: ResetMethod = 'clear'
let resetMethod: ResetMethod | 'off' = DEFAULT_METHOD
let directorMark: DirectorMark | null = null
let lastResetSeq = -1 // turnSeq at the last reset or compaction: equal means no turn since
let isOwnRun = false // the reset's own /clear or /compact is running
let resetTimer: { cancel: () => void } | null = null
let idleTimer: { cancel: () => void } | null = null
/** What the user's prompt brought to the turn it starts: an answer to the director's ask, the decision check. */
type PromptFacts = { answeredAsk: boolean; decided: Promise<boolean> | null }
let nextPrompt: PromptFacts | null = null
/** The director turn in progress: the notes at its start, the decisions it took, its prompt's facts. */
let turnFacts: { notesAtStart: string | null; decisions: string[]; prompt: PromptFacts | null } | null = null
// The carry-over's module state: the user's last prompts to the director, the end of its last reply and recap.
let recentAsks: string[] = []
let lastReply = ''
let lastRecap = ''
// The memory graph's module state (stage 8).
let home = '' // the user's home folder ('' until known: the memory folder and brain.json need it)
let toolsUp = false // the director's graph tools are registered in this session
let nudges = 0 // nudges toward the graph in this thread (NUDGE_CAP at most)
let graphTurn = -1 // the turn in which the director last asked the graph: no nudge then
let isMapLoading = false // the Map tab is waiting for the graph's first build (stage 9)
const START_TOOL = /^mcp__.*ccd_session__start_session$/
const GRAPH_TOOL = /^mcp__studio__studio_(recall|path|remember|section|overview|plan)$/
/**
 * Prompt origins that are the user's own prompts: the terminal, Remote Control,
 * the desktop app (an SDK host), and an unstamped prompt that isn't an engine notice.
 */
const isUserOrigin = (o: { kind: string }, isMeta = false) =>
  o.kind === 'composer' || o.kind === 'bridge' || o.kind === 'sdk' || (o.kind === 'unclassified' && !isMeta)

const iso = async ($: Engine) => new Date(await $.clock.now()).toISOString()

async function git($: Engine, args: string[], dir: string): Promise<string | null> {
  try {
    const r = await $.process.run(['git', ...args], { cwd: dir, timeoutMs: GIT_MS })
    return r.exitCode === 0 ? r.stdout : null
  } catch {
    return null
  }
}

function mcpText(r: unknown): string {
  const x = r as { isError?: boolean; content?: unknown }
  if (x?.isError) return ''
  const blocks = Array.isArray(x?.content) ? (x.content as Array<{ text?: unknown }>) : []
  return blocks.map(b => (typeof b?.text === 'string' ? b.text : '')).join('')
}

/** The app's own facts for this chat (`get_session("self")`); null outside the app. */
async function askSelf($: Engine) {
  try {
    const r = await $.mcp.call('ccd_session_mgmt', 'get_session', { session_id: 'self' })
    return readSelf(mcpText(r))
  } catch {
    return null
  }
}

async function askContext($: Engine) {
  try {
    return readContext(mcpText(await $.mcp.call('ccd_session_mgmt', 'get_usage', {})))
  } catch {
    return null
  }
}

async function findRoot($: Engine, dir: string): Promise<string> {
  const out = await git($, ['rev-parse', '--path-format=absolute', '--git-common-dir'], dir)
  return out === null ? '' : rootFromCommonDir(out)
}

/**
 * This chat's own report on disk, when the session's state holds none (a plugin
 * reload can start the mod afresh): only a file of this same engine session, so a
 * /clear still starts over.
 */
async function readOwnFile($: Engine, cliId: string): Promise<Report | null> {
  if (root === '' || appId === null) return null
  try {
    const r = parseRow(await $.fs.read(`${root}/${STUDIO_DIR}/sessions/${reportName(appId, cliId)}`))
    return r !== null && r.cliId === cliId ? r : null
  } catch {
    return null
  }
}

/**
 * Applies `patch` to this chat's report and writes it, one write at a time.
 * `isFull` also asks the app for the id, title, model, effort and context.
 */
function save($: Engine, patch: (r: Report) => Partial<Report>, isFull = false): Promise<unknown> {
  chain = chain
    .then(async () => {
      if (root === '') return
      const at = await iso($)
      const cliId = await $.session.id()
      const extra: Partial<Report> = { cliId }
      if (isFull || appId === null) {
        const self = await askSelf($)
        if (self) {
          appId = self.appId
          if (self.title) title = self.title
          if (self.model) model = self.model
          if (effort === '' && self.effort) effort = self.effort
        }
      }
      if (isFull) {
        const ctx = await askContext($)
        if (ctx) extra.context = ctx
        extra.turns = await $.session.turns()
      }
      const manual = await read($, manualTagRef)
      const prev = (await read($, reportRef)) ?? (await readOwnFile($, cliId)) ?? emptyReport(cliId, cwd, at)
      const base = applyPatch(prev, { ...extra, appId, title: title || prev.title, model: model || prev.model, effort: effort || prev.effort, cwd }, at)
      const next = applyPatch(base, { ...patch(base), ...pickTag(title || prev.title, manual) }, at)
      await update($, reportRef, () => next)
      if (appId === null && !isOptedIn) return
      await $.fs.write(`${root}/${STUDIO_DIR}/sessions/${reportName(appId, cliId)}`, serialize(next))
    })
    .catch(() => undefined)
  return chain
}

/** Runs `fn` off the hook, once the event has gone on. */
const later = ($: Engine, fn: () => Promise<unknown>) => {
  $.clock.after(10, () => {
    void fn()
  })
}

async function sessionDir($: Engine): Promise<string> {
  return cwd || (await $.session.cwd().catch(() => ''))
}

function resolveDir(base: string, dir: string | null): string {
  if (dir === null || dir === '') return base
  if (/^([A-Za-z]:)?[\\/]/.test(dir)) return dir
  return `${base.replace(/[\\/]+$/, '')}/${dir}`
}

/** Bash and PowerShell: the worker's commit check (§5.8) and the commit record (§5.1). */
async function onShell($: Engine, command: string, run: () => Promise<unknown>): Promise<unknown> {
  const plan = planCommit(command)
  if (!plan.isCommit) return run()
  const dir = resolveDir(await sessionDir($), plan.dir)
  const now = await $.clock.now()
  const isAllowed = ((await read($, allowRef)) ?? 0) > now
  if (isDirector) {
    // §5.8: the director commits docs/studio/, as a commit of its own.
    const z = await git($, ['status', '--porcelain=v1', '-z'], dir)
    if (z !== null) {
      const s = readStatus(z)
      const why = directorCommitRefusal(plan, s.staged, s.tracked, s.all)
      if (why !== null) return { deny: why }
    }
  } else if (!isAllowed) {
    const z = await git($, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', `:/${STUDIO_DIR}`], dir)
    if (z !== null) {
      const s = readStatus(z)
      const why = refusal(plan, s.staged, { tracked: s.tracked, all: s.all })
      if (why !== null) return { deny: why }
    }
  }
  const before = await git($, ['rev-parse', 'HEAD'], dir)
  const r = await run()
  const after = await git($, ['log', '-1', '--format=%H%x1f%s%x1f%cI'], dir)
  if (after === null) return r
  const [hash = '', subject = '', at = ''] = after.trim().split('\x1f')
  if (hash === '' || hash === before?.trim()) return r
  const commit: Commit = { hash, subject, at }
  later($, () => save($, () => ({ lastCommit: commit })))
  const files = await git($, ['show', '--name-only', '--format=', hash, '--', `:/${STUDIO_DIR}`], dir)
  const studioFiles = (files ?? '').split(/\r?\n/).filter(f => f.trim() !== '')
  if (studioFiles.length === 0 || isDirector) return r
  if (isAllowed) {
    await update($, allowRef, () => 0)
    return r
  }
  // The check above missed it (a script, an odd wrapper): say so, never undo it.
  const x = r as { deny?: unknown; isError?: unknown; context?: readonly string[] }
  if (x.deny !== undefined || x.isError !== undefined) return r
  return { ...x, context: [...(x.context ?? []), studioCommitNote(hash, studioFiles)] }
}

// ---- the board (stage 2) ----

/** Every report in docs/studio/sessions/, a half-written file skipped (it is read again next poll). */
async function readReports($: Engine): Promise<Report[]> {
  if (root === '') return []
  const dir = `${root}/${STUDIO_DIR}/sessions`
  let names: string[]
  try {
    names = (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.json')).map(f => f.name)
  } catch {
    return []
  }
  const rows: Report[] = []
  for (const name of names) {
    try {
      const r = parseRow(await $.fs.read(`${dir}/${name}`))
      if (r) rows.push(r)
    } catch {
      // gone or locked mid-write: next poll
    }
  }
  return rows
}

/** Usage, uncommitted count and last commit, cached for a minute (a big tree isn't scanned every poll). */
async function readHeader($: Engine, isForced: boolean): Promise<BoardHeader> {
  const now = await $.clock.now()
  if (!isForced && header !== null && now - header.at < HEADER_MS) return header.value
  let usage: BoardHeader['usage'] = null
  try {
    usage = readPlan(mcpText(await $.mcp.call('ccd_session_mgmt', 'get_usage', {})))
  } catch {
    usage = null
  }
  const z = root ? await git($, ['status', '--porcelain=v1', '-z'], root) : null
  const log = root ? await git($, ['log', '-1', '--format=%h%x1f%s%x1f%cI'], root) : null
  // A status that failed (another chat's git holds the lock, a busy disk) keeps the last count,
  // and is read again at the next poll instead of a minute on.
  const uncommitted = z === null ? (header?.value.uncommitted ?? null) : countUncommitted(z, STUDIO_DIR)
  const value: BoardHeader = { usage, uncommitted, lastCommit: readLastCommit(log) }
  header = { at: z === null && root !== '' ? now - HEADER_MS + POLL_MS : now, value }
  return value
}

/**
 * The app's open chats (`list_sessions`, most recent first), read at most once a
 * minute; null outside the app or when the read failed (tried again next poll).
 * The list stops at LIST_LIMIT rows: all 205 of 2026-11-15 came to 97k characters,
 * over the engine's cap on one MCP result, which then answers a notice, not JSON.
 */
async function readAppSessions($: Engine, isForced = false): Promise<{ rows: AppSession[]; isCut: boolean } | null> {
  const now = await $.clock.now()
  if (!isForced && appList !== null && now - appList.at < HEADER_MS) return appList.value
  let rows: AppSession[] | null = null
  try {
    const r = await $.mcp.call('ccd_session_mgmt', 'list_sessions', { limit: LIST_LIMIT })
    rows = (r as { isError?: boolean }).isError ? null : readSessions(mcpText(r))
  } catch {
    rows = null
  }
  if (rows === null) return null
  const value = { rows, isCut: rows.length >= LIST_LIMIT }
  appList = { at: now, value }
  return value
}

/**
 * The leads in docs/studio/leads.md (stage 11), read at most once a minute; [] when
 * there is no file or it names none (the board stays one list). A failed read keeps
 * the last value.
 */
async function readLeads($: Engine, isForced = false): Promise<Lead[]> {
  if (root === '') return []
  const now = await $.clock.now()
  if (!isForced && leadsCache !== null && now - leadsCache.at < HEADER_MS) return leadsCache.value
  let value: Lead[]
  try {
    value = parseLeads(await $.fs.read(`${root}/${LEADS_FILE}`))
  } catch {
    value = leadsCache?.value ?? []
  }
  leadsCache = { at: now, value }
  return value
}

/**
 * A lead chat's own snapshot (stage 11, §5.14): its chats only, on each of the
 * user's prompts there; null in any other chat. Full in a new thread, then changes.
 */
async function buildLeadSnapshot($: Engine): Promise<string | null> {
  if (appId === null || root === '') return null
  const leads = await readLeads($)
  if (!leads.some(l => l.id === appId)) return null
  const view = await refresh($, { withHeader: false, isForced: true })
  const group = leadGroupOf(view.leads, appId)
  if (group === null) return null
  const cliId = await $.session.id()
  const prev = await read($, leadSnapRef)
  const snap = leadSnapshotText(group, view.at, prev !== null && prev.cliId === cliId ? prev.seen : null)
  await update($, leadSnapRef, () => ({ cliId, seen: snap.seen }))
  return snap.text
}

/** Reads the board; the header too when the pane is open or a command asked. Toasts new waits. */
async function refresh($: Engine, opts: { withHeader: boolean; isForced?: boolean }): Promise<BoardView> {
  const now = await $.clock.now()
  const selfId = await $.session.id().catch(() => '')
  const list = await readAppSessions($, opts.isForced === true)
  const reports = withSessions(await readReports($), list?.rows ?? null, root, selfId, list?.isCut ?? false)
  const groups = groupRows(reports, now, selfId)
  const leads = byLead(groups, list?.rows ?? null, await readLeads($, opts.isForced === true))
  const prev = await read($, boardRef)
  const head = opts.withHeader
    ? await readHeader($, opts.isForced === true)
    : (header?.value ?? prev?.header ?? { usage: null, uncommitted: null, lastCommit: null })
  const view: BoardView = { at: now, header: head, groups, leads }
  if (opts.withHeader) await readExtras($).catch(() => undefined)
  await update($, boardRef, () => view)
  await toastWaits($, view)
  return view
}

/** The kanban's card files (stage 7), a half-written one skipped (it is read again next poll). */
async function readCards($: Engine): Promise<CardFile[]> {
  if (root === '') return []
  const dir = studioPath(CARDS_DIR)
  let names: string[]
  try {
    names = (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.json')).map(f => f.name)
  } catch {
    return []
  }
  const cards: CardFile[] = []
  for (const name of names.sort()) {
    try {
      const c = parseCard(await $.fs.read(`${dir}/${name}`))
      if (c) cards.push(c)
    } catch {
      // gone or locked mid-write: next poll
    }
  }
  return cards
}

/** What the pane reads beside the board: the notes' last lines and the cards. Written only when they changed, so a poll redraws nothing for them. */
async function readExtras($: Engine): Promise<void> {
  if (root === '') return
  const stored = await $.store.get(DIRECTORS).catch(() => undefined)
  const directors = stored !== null && typeof stored === 'object' ? Object.keys(stored as Record<string, unknown>).sort() : []
  const next: PaneExtras = { notes: notesTail(await readText($, studioPath(NOTES_FILE))), cards: await readCards($), directors }
  const prev = await read($, extrasRef)
  if (JSON.stringify(prev) !== JSON.stringify(next)) await update($, extrasRef, () => next)
}

/** A card added by hand, from the pane, `/studio card` or studio_plan: it starts in Planned, under a milestone when planned on the plan map. */
async function addCard($: Engine, text: string, under: string | null = null): Promise<CardFile | null> {
  const title = text.replace(/\s+/g, ' ').trim()
  if (title === '' || root === '') return null
  const card = newCard(title, await $.clock.now(), under)
  await $.fs.write(`${studioPath(CARDS_DIR)}/${cardFileName(card.id)}`, serializeCard(card))
  await update($, extrasRef, x => ({ ...(x ?? EMPTY_EXTRAS), cards: [...(x ?? EMPTY_EXTRAS).cards.filter(c => c.id !== card.id), card] }))
  await update($, paneUiRef, x => ({ ...(x ?? PANE_UI), seq: (x?.seq ?? 0) + 1 }))
  return card
}

/** A card moved by hand: its file pins it to the column (a chat's card is made on its first move). */
async function moveCard($: Engine, item: KanbanItem, to: Column): Promise<void> {
  if (root === '' || item.isLive) return
  const cards = ((await read($, extrasRef)) ?? EMPTY_EXTRAS).cards
  const card = pinned(item, cards, to, await $.clock.now())
  await $.fs.write(`${studioPath(CARDS_DIR)}/${cardFileName(card.id)}`, serializeCard(card))
  await update($, extrasRef, x => ({ ...(x ?? EMPTY_EXTRAS), cards: [...(x ?? EMPTY_EXTRAS).cards.filter(c => c.id !== card.id), card] }))
}

/** One dated line added to docs/studio/notes.md (`/studio note`, the pane's field); it pays a note the director owed. */
async function writeNote($: Engine, text: string): Promise<boolean> {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line === '' || root === '') return false
  const notes = await readText($, studioPath(NOTES_FILE))
  await $.fs.write(studioPath(NOTES_FILE), addNote(notes, line, await $.clock.now()))
  await update($, noteOwedRef, () => null)
  await trimNotes($)
  await readExtras($).catch(() => undefined)
  return true
}

/** A toast for each wait no chat has toasted yet: no model call. */
async function toastWaits($: Engine, view: BoardView): Promise<void> {
  if (attached.size === 0) return
  const stored = await $.store.get(TOASTED).catch(() => undefined)
  const seen = stored !== null && typeof stored === 'object' ? (stored as Record<string, number>) : {}
  const rows = newWaits(view.groups, seen, view.at)
  if (rows.length === 0) return
  await $.store.set(TOASTED, markSeen(seen, rows, view.at))
  for (const r of rows) $.ui.toast(toastText(r))
}

/** One poll; a poll still running when the next is due is skipped. */
async function tick($: Engine): Promise<void> {
  if (isPolling) return
  isPolling = true
  try {
    await refresh($, { withHeader: (await read($, boardOpenRef)) === true })
  } catch {
    // a failed poll waits for the next
  } finally {
    isPolling = false
  }
}

function startPoll($: Engine) {
  if (poll !== null) return
  poll = $.clock.every(POLL_MS, () => {
    void tick($)
  })
  later($, () => tick($))
}

function stopPoll() {
  poll?.cancel()
  poll = null
}

async function openPane($: Engine) {
  await update($, boardOpenRef, () => true)
  return $.ui.open({ id: PANE, title: PANE_TITLE })
}

// ---- director mode (stage 3) ----

const studioPath = (name: string) => `${root}/${STUDIO_DIR}/${name}`

async function readText($: Engine, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

async function ensureNotes($: Engine): Promise<void> {
  if (root === '') return
  if ((await readText($, studioPath(NOTES_FILE))) === null) await $.fs.write(studioPath(NOTES_FILE), NOTES_SEED)
}

/** Once notes.md passes NOTES_MAX note lines, the oldest move to notes_archive.md (§5.3). */
async function trimNotes($: Engine): Promise<void> {
  if (root === '') return
  const notes = await readText($, studioPath(NOTES_FILE))
  if (notes === null) return
  const cut = capNotes(notes)
  if (cut === null) return
  await $.fs.write(studioPath(ARCHIVE_FILE), appendArchive(await readText($, studioPath(ARCHIVE_FILE)), cut.moved))
  await $.fs.write(studioPath(NOTES_FILE), cut.notes)
}

/**
 * The snapshot for one of the user's prompts in the director chat (§5.3): the
 * whole board after a reset or in a new thread (another engine id), else only
 * the rows that changed. The board and the app's list are read fresh.
 */
async function buildSnapshot($: Engine): Promise<string> {
  const view = await refresh($, { withHeader: true, isForced: true })
  const cliId = await $.session.id()
  const prev = await read($, snapRef)
  const seen = prev !== null && prev.cliId === cliId ? prev.seen : null
  const log = root ? await git($, ['log', '--oneline', '-10'], root) : null
  const notes = root ? await readText($, studioPath(NOTES_FILE)) : null
  const snap = snapshotText({ view, seen, log, notes, self: { model, effort } })
  await update($, snapRef, () => ({ cliId, seen: snap.seen }))
  return snap.text
}

/**
 * `/director`: makes this fresh chat the director, opens the board and starts the
 * first turn. The mod's own prompt never passes its own prompt.submit hook, so the
 * first snapshot rides as the command's hidden context, recorded before that prompt.
 */
async function becomeDirector($: Engine, via: 'command' | 'press' = 'command'): Promise<{ text: string; context: string[] }> {
  const at = await iso($)
  const mark: DirectorMark = { since: at }
  await update($, directorRef, () => mark)
  isDirector = true
  directorMark = mark
  await update($, offerRef, () => false)
  await update($, snapRef, () => null)
  await update($, manualTagRef, () => DIRECTOR_TAG)
  await save($, () => ({}))
  await rememberDirector($, mark).catch(() => undefined)
  await ensureNotes($).catch(() => undefined)
  await ensurePolicy($).catch(() => undefined)
  const opened = await openPane($).catch(() => null)
  if (attached.size === 0 && (await $.session.surfaces().catch(() => [])).length > 0) {
    attached.add(SEEDED)
    startPoll($)
  }
  await registerTools($).catch(() => undefined)
  const snapshot = await buildSnapshot($)
  const recall = await withRecall($, FIRST_PROMPT, false)
  later($, async () => {
    // A press has no command row to carry the snapshot: it goes in as a hidden row first.
    if (via === 'press') await appendContext($, [snapshot, ...(recall === null ? [] : [recall])].join('\n\n'))
    await $.prompt.submit({ text: FIRST_PROMPT, asUser: true })
  })
  const pane = opened?.isPlaced ? 'The board pane is open beside the chat. ' : ''
  return {
    text:
      `This chat is now the Studio director. ${pane}Each of your prompts here carries a fresh snapshot of the board and docs/studio/notes.md; ` +
      'the director plans and starts chats on your word, and the studio guard refuses building here. Reading the board now.',
    context: [snapshot, ...(recall === null ? [] : [recall])],
  }
}

// ---- the pane drives the director chat (stage 7) ----

/** A row the model reads and the user does not see as typed: context for the prompt that follows it. */
async function appendContext($: Engine, text: string): Promise<void> {
  await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } }).catch(() => undefined)
}

/**
 * A prompt from the pane (its field, a card's button) to the director chat itself:
 * a real turn, with every tool. The mod's own prompt carries no `context` and may
 * not pass its own prompt.submit hook, so the fresh snapshot (and a note owed) goes
 * in as a hidden row just before it.
 */
async function sendToDirector($: Engine, text: string): Promise<void> {
  const t = text.trim()
  if (!isDirector || t === '') return
  // One at a time: a press shows nothing in the conversation for a moment, and a second
  // press would cost a second director turn (the user's double "Brief me", 2026-11-16).
  if (isSending || isTurnRunning) {
    $.ui.toast('studio: the director is answering. Send this when it has.')
    return
  }
  isSending = true
  try {
    cancelResets()
    const prev = await read($, reportRef)
    nextPrompt = { answeredAsk: prev?.ask != null, decided: null }
    const at = await $.clock.now()
    await update($, paneUiRef, x => ({ ...(x ?? PANE_UI), seq: (x?.seq ?? 0) + 1, sent: { text: t, at } }))
    const owed = await read($, noteOwedRef)
    const snapshot = await buildSnapshot($)
    const recall = await withRecall($, t)
    recentAsks = pushAsk(recentAsks, t)
    const carry = await takeCarry($)
    await appendContext($, [snapshot, ...(recall === null ? [] : [recall]), ...(carry === null ? [] : [carry]), ...(owed === null ? [] : [noteLine(owed.why)])].join('\n\n'))
    await $.prompt.submit({ text: t, asUser: true })
    $.ui.toast('studio: sent to the director chat')
  } catch (error) {
    await update($, paneUiRef, x => ({ ...(x ?? PANE_UI), sent: null })).catch(() => undefined)
    throw error
  } finally {
    isSending = false
  }
}

/** The pane's "Make this chat the Director": the same as `/director` typed first, for a chat with no reply yet. */
async function becomeFromPane($: Engine): Promise<void> {
  if (root === '' || isDirector) return
  const messages = (await $.session.messages().catch(() => [])) as unknown
  if (isUsedChat(Array.isArray(messages) ? (messages as Array<{ role?: unknown }>) : [])) {
    $.ui.toast('studio: this chat already has replies. Type /director to clear it and make it the director.')
    return
  }
  await becomeDirector($, 'press')
}

/**
 * A used chat becomes the director: marked, cleared by the mod's own /clear (the
 * role reaches a thread only before its first reply, S4), then started like a
 * fresh one. Only ever on the user's own press or `/director fresh`.
 */
async function makeDirectorFresh($: Engine): Promise<void> {
  if (root === '' || isDirector) return
  const mark: DirectorMark = { since: await iso($) }
  directorMark = mark
  isDirector = true
  await update($, directorRef, () => mark)
  await update($, offerRef, () => false)
  await update($, snapRef, () => null)
  await update($, manualTagRef, () => DIRECTOR_TAG)
  await rememberDirector($, mark).catch(() => undefined)
  isOwnRun = true
  try {
    await $.command.run({ command: 'clear' })
  } catch (error) {
    await leaveDirector($)
    $.ui.toast(`studio: the chat could not be cleared, so it is not the director (${error instanceof Error ? error.message : String(error)})`)
    return
  } finally {
    isOwnRun = false
  }
  lastResetSeq = turnSeq
  // The mark outlives the clear: put it back where the /clear left none.
  if ((await read($, directorRef)) === null) await update($, directorRef, () => mark)
  if ((await read($, manualTagRef)) !== DIRECTOR_TAG) await update($, manualTagRef, () => DIRECTOR_TAG)
  await update($, snapRef, () => null)
  await ensureNotes($).catch(() => undefined)
  await ensurePolicy($).catch(() => undefined)
  await save($, () => ({}), true)
  await openPane($).catch(() => null)
  nudges = 0
  await registerTools($).catch(() => undefined)
  const recall = await withRecall($, FIRST_PROMPT, false)
  await appendContext($, [await buildSnapshot($), ...(recall === null ? [] : [recall])].join('\n\n'))
  await $.prompt.submit({ text: FIRST_PROMPT, asUser: true })
}

/** `/director off`: the chat stops being the director. The role text stays in its thread until the chat is cleared (S4). */
async function leaveDirector($: Engine): Promise<void> {
  isDirector = false
  directorMark = null
  cancelResets()
  turnFacts = null
  nextPrompt = null
  await update($, directorRef, () => null)
  await update($, snapRef, () => null)
  await update($, noteOwedRef, () => null)
  if ((await read($, manualTagRef)) === DIRECTOR_TAG) await update($, manualTagRef, () => null)
  if (appId !== null) {
    const stored = await $.store.get(DIRECTORS).catch(() => undefined)
    if (stored !== null && typeof stored === 'object' && appId in (stored as Record<string, unknown>)) {
      const { [appId]: _gone, ...rest } = stored as Record<string, string>
      await $.store.set(DIRECTORS, rest).catch(() => undefined)
    }
  }
  await save($, () => ({}))
}

/**
 * `/studio probe`: what this surface lets a mod do (stage 7's spikes S13 and S14),
 * as text the chat can read. Nothing here changes a chat: the fill is one word in
 * the composer, the open names this chat itself.
 */
async function probe($: Engine): Promise<string> {
  const out: string[] = []
  try {
    const f = await $.prompt.fill({ text: 'studio probe', mode: 'append' })
    out.push(`S13 prompt.fill: isFilled ${String(f.isFilled)}${'reason' in f && f.reason ? ` (${String(f.reason)})` : ''}`)
  } catch (error) {
    out.push(`S13 prompt.fill: threw ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    const r = (await $.mcp.call('ccd_window', 'open_session_in', { session_id: 'self', target: 'focus' })) as { isError?: boolean; content?: unknown }
    const said = (Array.isArray(r.content) ? (r.content as Array<{ text?: unknown }>) : []).map(b => (typeof b?.text === 'string' ? b.text : '')).join('')
    out.push(`S14 open_session_in(self, focus): ${r.isError ? 'error: ' : ''}${said.slice(0, 300) || '(no text)'}`)
  } catch (error) {
    out.push(`S14 open_session_in: threw ${error instanceof Error ? error.message : String(error)}`)
  }
  const surfaces = await $.session.surfaces().catch(() => [])
  out.push(`surfaces: ${JSON.stringify(surfaces)}`)
  const panes = await $.ui.panes().catch(() => [])
  out.push(`panes: ${JSON.stringify(panes)}`)
  return out.join('\n')
}

// ---- auto model (stage 4) ----

/** `p`, or `fallback` once `ms` have passed on the engine's clock. */
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
 * The prompt's class: one classify call on the prompt's text alone, on Haiku by
 * full id, and how long it took. None when it fails, names no class, or takes over
 * CLASSIFY_MAX_MS.
 */
async function classifyTurn($: Engine, text: string): Promise<ClassOutcome> {
  const t0 = await $.clock.now()
  const ask = $.model.classify(text.slice(0, CLASSIFY_CHARS), TURN_CLASSES, { model: CLASSIFY_MODEL }).then(
    async (label): Promise<ClassOutcome> => {
      const cls = readClass(label)
      return { cls, ms: cls === null ? null : (await $.clock.now()) - t0 }
    },
    (): ClassOutcome => ({ cls: null, ms: null }),
  )
  return within($, ask, CLASSIFY_MAX_MS, { cls: null, ms: null } as ClassOutcome)
}

/** Starts the prompt's class without waiting for it; the report gets it when it comes. */
function startClass($: Engine, text: string): void {
  const pending = classifyTurn($, text)
  classPending = pending
  void pending.then(o => {
    if (classPending !== pending) return undefined // a newer prompt's class wins
    turnClass = o.cls
    return save($, () => ({ turnClass: o.cls, classMs: o.ms }))
  })
}

/** The turn's class for a spawn: waits at most CLASSIFY_MS for one still on its way (§5.9). */
async function classForSpawn($: Engine): Promise<string | null> {
  if (classPending === null) return turnClass
  const o = await within($, classPending, CLASSIFY_MS, null)
  return o === null ? null : o.cls
}

/** The turn-layer table from docs/studio/model_policy.md, re-read at most once a minute; the built-in copy when it is missing or unreadable. */
async function readPolicy($: Engine): Promise<Policy> {
  const now = await $.clock.now()
  if (policyCache !== null && now - policyCache.at < POLICY_MS) return policyCache.value
  const text = root ? await readText($, studioPath(POLICY_FILE)) : null
  const value = (text === null ? null : parsePolicy(text)) ?? BUILT_IN
  policyCache = { at: now, value }
  return value
}

/** The director seeds model_policy.md when it is missing. */
async function ensurePolicy($: Engine): Promise<void> {
  if (root === '') return
  if ((await readText($, studioPath(POLICY_FILE))) === null) await $.fs.write(studioPath(POLICY_FILE), POLICY_SEED)
}

// ---- the reset (stage 5) ----

/** The director's mark in $.store by app id, so a $.state lost after a /clear or a restart can be found again. */
async function rememberDirector($: Engine, mark: DirectorMark): Promise<void> {
  if (appId === null) return
  const stored = await $.store.get(DIRECTORS)
  const all = stored !== null && typeof stored === 'object' ? (stored as Record<string, string>) : {}
  if (all[appId] !== mark.since) await $.store.set(DIRECTORS, { ...all, [appId]: mark.since })
}

/** A director whose $.state lost its mark (known by app id in $.store): marked again. */
async function recallDirector($: Engine): Promise<void> {
  if (isDirector || appId === null) return
  const stored = await $.store.get(DIRECTORS)
  const since = stored !== null && typeof stored === 'object' ? (stored as Record<string, unknown>)[appId] : undefined
  if (typeof since !== 'string') return
  directorMark = { since }
  isDirector = true
  if ((await read($, directorRef)) === null) await update($, directorRef, () => ({ since }))
  // A /clear can drop the tag with the rest of the state: the board names the director by it.
  if ((await read($, manualTagRef)) === null) {
    await update($, manualTagRef, () => DIRECTOR_TAG)
    await save($, () => ({}))
  }
}

/**
 * The director chat keeps itself known: its app id in the mod's store (a chat made
 * the director before stage 5 was never written there, so no other chat's pane
 * could name it) and its `Director` tag (a /clear can drop it with the state).
 */
async function keepDirectorKnown($: Engine): Promise<void> {
  if (!isDirector || directorMark === null) return
  await rememberDirector($, directorMark).catch(() => undefined)
  if ((await read($, manualTagRef)) === null) {
    await update($, manualTagRef, () => DIRECTOR_TAG)
    await save($, () => ({}))
  }
}

async function tokensNow($: Engine): Promise<number | null> {
  try {
    const t = (await $.session.usage()).context.tokens
    return typeof t === 'number' ? t : null
  } catch {
    return null
  }
}

function cancelResets(): void {
  resetTimer?.cancel()
  resetTimer = null
  idleTimer?.cancel()
  idleTimer = null
}

/**
 * The end of a director turn: the notes check (a decision with no note leaves one
 * owed), then the reset when the context is past the threshold, else the idle timer.
 */
async function afterDirectorTurn($: Engine, hasOpenAsk: boolean): Promise<void> {
  const facts = turnFacts
  turnFacts = null
  const decisions = [...(facts?.decisions ?? [])]
  if (consentTurn === turnSeq) decisions.push('answered a question')
  const prompt = facts?.prompt ?? null
  if (prompt?.answeredAsk) decisions.push("answered the director's ask")
  if (prompt?.decided && (await within($, prompt.decided, DECISION_WAIT_MS, false))) decisions.push('your prompt decided something')
  const notesNow = root ? await readText($, studioPath(NOTES_FILE)) : null
  const owedBefore = await read($, noteOwedRef)
  const owed = owedNote({
    decisions: [...new Set(decisions)],
    notesChanged: facts !== null && notesNow !== facts.notesAtStart,
    pendingWhy: owedBefore?.why ?? null,
  })
  if (owed !== (owedBefore?.why ?? null)) {
    const since = owedBefore?.since ?? (await iso($))
    await update($, noteOwedRef, () => (owed === null ? null : { why: owed, since }))
  }
  const d = resetDecision({ kind: 'size', tokens: await tokensNow($), hasOpenAsk, owed, isFreshThread: lastResetSeq === turnSeq, method: resetMethod })
  cancelResets()
  if (d.isReset) {
    const seq = turnSeq
    resetTimer = $.clock.after(RESET_DELAY_MS, () => {
      resetTimer = null
      // a compaction in between (smart-compact's own) leaves nothing to reset
      if (turnSeq === seq && lastResetSeq !== turnSeq) void runReset($, 'size', d.method)
    })
    return
  }
  const armedAt = await $.clock.now()
  const seq = turnSeq
  idleTimer = $.clock.after(IDLE_MS, () => {
    idleTimer = null
    if (turnSeq === seq) void idleReset($, armedAt, hasOpenAsk)
  })
}

/** The idle timer's moment, judged on the chat as it is then. */
async function idleReset($: Engine, armedAt: number, hasOpenAsk: boolean): Promise<void> {
  const now = await $.clock.now()
  const owed = await read($, noteOwedRef)
  const d = resetDecision({
    kind: 'idle',
    tokens: await tokensNow($),
    hasOpenAsk,
    owed: owed?.why ?? null,
    isFreshThread: lastResetSeq === turnSeq,
    method: resetMethod,
    elapsedMs: now - armedAt,
  })
  if (d.isReset) await runReset($, 'idle', d.method)
}

/** The carry-over, once: the first prompt after a reset carries it, and the store forgets it. */
async function takeCarry($: Engine): Promise<string | null> {
  const c = await read($, carryRef).catch(() => null)
  if (c === null || c === undefined) return null
  await update($, carryRef, () => null)
  return carryBlock(c)
}

/**
 * The reset (§5.5): the mod's own /clear (or /compact with its instructions),
 * queued by the engine until the chat is idle. No ask; a dim line says it happened;
 * the next prompt gets the full board.
 */
async function runReset($: Engine, kind: ResetKind, method: ResetMethod): Promise<void> {
  if (!isDirector) return
  const before = await tokensNow($)
  lastResetSeq = turnSeq
  // The carry-over: the thread as it stands, for the first prompt after the reset.
  if (recentAsks.length > 0) {
    const at = await iso($)
    await update($, carryRef, () => ({ at, kind, asks: recentAsks, reply: replyTail(lastReply), recap: lastRecap }))
  }
  let used: ResetMethod = method
  isOwnRun = true
  try {
    try {
      await $.command.run(method === 'clear' ? { command: 'clear' } : { command: 'compact', args: COMPACT_ARGS })
    } catch (error) {
      if (method !== 'clear') throw error
      used = 'compact' // a /clear refused here: compact instead
      await $.command.run({ command: 'compact', args: COMPACT_ARGS })
    }
  } catch (error) {
    $.ui.toast(`studio: the director's reset did not run (${error instanceof Error ? error.message : String(error)})`)
    return
  } finally {
    isOwnRun = false
  }
  await update($, snapRef, () => null)
  nudges = 0
  // The mark outlives the reset: put it back where a /clear may have left none.
  if (directorMark !== null && (await read($, directorRef)) === null) await update($, directorRef, () => directorMark)
  const after = used === 'clear' ? ((await tokensNow($)) ?? 0) : await tokensNow($)
  const record: ResetRecord = { at: await iso($), kind, method: used, tokensBefore: before, tokensAfter: after }
  await update($, lastResetRef, () => record)
  const line = resetLine(kind, used, before, after)
  await $.session.append({ message: { type: 'system', content: [{ type: 'text', text: line }] } }).catch(() => $.ui.toast(line))
  later($, () => save($, () => ({}), true))
}

// ---- the ask box (stage 6) ----

/**
 * One question from the pane: the board read fresh, the full snapshot (the chat's
 * own row too; the director's `snapSeen` untouched), the pane's last answered
 * turns, one completion. The answer lands in the pane's state; nothing else moves.
 */
async function askBoard($: Engine, text: string): Promise<void> {
  const q = cleanQuestion(text)
  if (q === '') return
  const log = (await read($, askRef)) ?? EMPTY_ASK
  if (log.pending !== null) return // one at a time: the pane shows the one on its way
  const since = await $.clock.now()
  const stop = new AbortController()
  askStop = stop
  await update($, askRef, x => ({ ...(x ?? EMPTY_ASK), pending: { q, since }, seq: (x?.seq ?? 0) + 1 }))
  let turn: AskTurn | null
  try {
    if (root === '') {
      turn = { q, a: 'Not in a git checkout, so there is no board to ask.', at: since, ok: false, tokensIn: null, tokensOut: null }
    } else {
      const view = await refresh($, { withHeader: true, isForced: true })
      const gitLog = await git($, ['log', '--oneline', '-10'], root)
      const notes = await readText($, studioPath(NOTES_FILE))
      const snap = snapshotText({ view, seen: null, log: gitLog, notes, forAsk: true }).text
      const r = await $.model.complete(
        {
          model: ASK_MODEL,
          effort: ASK_EFFORT,
          maxTokens: ASK_MAX_TOKENS,
          timeoutMs: ASK_TIMEOUT_MS,
          system: ASK_SYSTEM,
          prompt: askPrompt(snap, earlierTurns(log.turns), q),
        },
        { signal: stop.signal },
      )
      const u = r.usage
      const used = { tokensIn: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens, tokensOut: u.output_tokens }
      if (r.isAnswered && r.text.trim() !== '') turn = { q, a: r.text.trim(), at: view.at, ok: true, ...used }
      else if (!r.isAnswered && r.reason === 'aborted' && stop.signal.aborted) turn = null // Cancel: nothing kept
      else turn = { q, a: r.isAnswered ? failText({ reason: 'empty-reply' }) : failText(r), at: view.at, ok: false, ...used }
    }
  } catch (error) {
    turn = { q, a: `No answer: ${error instanceof Error ? error.message : String(error)}`, at: since, ok: false, tokensIn: null, tokensOut: null }
  } finally {
    if (askStop === stop) askStop = null
  }
  await update($, askRef, x => {
    const cur = x ?? EMPTY_ASK
    return { ...cur, turns: turn === null ? cur.turns : addTurn(cur.turns, turn), pending: null }
  })
}

// ---- the memory graph (stage 8) ----

const graphCtx = (): GraphCtx => ({ root, home })

/** The reports and cards the graph lays over its files, read when it rebuilds. */
function liveOf($: Engine): () => Promise<Live> {
  return async () => ({ reports: await readReports($), cards: await readCards($) })
}

/** The <studio-recall> block for a director prompt, or null (nothing matched, or anything failed: the prompt goes on). */
async function withRecall($: Engine, text: string, withFallback = true): Promise<string | null> {
  if (root === '') return null
  return recallFor($, graphCtx(), liveOf($), text, withFallback).catch(() => null)
}

/** Every board row, read fresh (the start checks). */
async function boardRows($: Engine) {
  const v = await refresh($, { withHeader: false })
  return [...v.groups.waiting, ...v.groups.working, ...v.groups.recent, ...v.groups.quiet]
}

const STR = { type: 'string' } as const

/** The director's graph tools (§5.11), registered in the director chat only, and the brain pass started there. */
async function registerTools($: Engine): Promise<void> {
  if (root === '') return
  startBrain($, graphCtx())
  if (toolsUp) return
  toolsUp = true
  const specs = [
    {
      name: TOOL_NAMES.recall,
      description:
        "The studio memory graph's view of one topic, milestone, workstream, chat, rule or idea: its status, the chats on it, its decisions from all of history (notes, the archive, the status log), open asks, the rules that apply, docs and sections, commits, and how it connects. Each line names its source; [guess .75] marks a link guessed from names. Cheaper than opening the docs.",
      inputSchema: { type: 'object', properties: { topic: { ...STR, description: 'What to recall: a name (METRO 9, the Warden, G5, audio), a milestone code, a chat id or a few words.' } }, required: ['topic'] },
    },
    {
      name: TOOL_NAMES.path,
      description: 'How two things connect in the studio memory graph (a decision and a rule, a chat and a milestone…): the surest path, hop by hop with sources, as sure as its weakest link.',
      inputSchema: { type: 'object', properties: { from: STR, to: STR }, required: ['from', 'to'] },
    },
    {
      name: TOOL_NAMES.remember,
      description:
        "Record a decision or a fact in docs/studio/notes.md (a dated line, with what it is about as tags), so decisions stay in one place and recall finds them later, even after they move to the archive. Use it after each decision instead of editing notes.md by hand. Don't copy a memory rule's text into it.",
      inputSchema: {
        type: 'object',
        properties: {
          text: { ...STR, description: 'The decision or fact, one line, in plain words.' },
          about: { type: 'array', items: STR, description: 'What it is about: milestones, topics, places, chats (G5, METRO 9, audio, the Warden).' },
        },
        required: ['text', 'about'],
      },
    },
    {
      name: TOOL_NAMES.section,
      description: "One section of a doc by its heading, instead of the whole file (docs/, docs/design/, docs/plan/, docs/slip7/, CLAUDE.md). A heading that doesn't match lists the doc's sections.",
      inputSchema: { type: 'object', properties: { doc: { ...STR, description: 'The doc: a path or its name (milestones_n.md, PLACE_METRO9).' }, heading: { ...STR, description: 'Words of the heading (N1e, Districts).' } }, required: ['doc', 'heading'] },
    },
    {
      name: TOOL_NAMES.plan,
      description:
        "The user's plan map (the pane's Map tab, Plan view): add a planned stage under a milestone ({title, under}: it shows dashed until its chat starts), move a stage's card ({card, column}: planned, building, waiting, review or done), or, with no input, list the planned stages by milestone. Use it when the user plans work, and move a card to done once its chat has started.",
      inputSchema: {
        type: 'object',
        properties: {
          title: { ...STR, description: 'A new stage, in a few words ("Stage 5: the cart\'s lights").' },
          under: { ...STR, description: "The milestone code it sits under, as MASTER_PLAN.md writes it (G5, N1, N3)." },
          card: { ...STR, description: 'A card id (card-…) to move.' },
          column: { ...STR, description: 'Where to move it: planned, building, waiting, review or done.' },
        },
      },
    },
    {
      name: TOOL_NAMES.overview,
      description: "The studio memory graph's overview: what it holds, its clusters (things that belong together), its hubs (the most-linked) and the brain pass's progress.",
      inputSchema: { type: 'object', properties: {} },
    },
  ]
  for (const s of specs) await $.tool.register({ ...s, isDeferred: false }).catch(() => undefined)
}

/** A graph tool's answer (text), or why there is none. */
async function answerGraphTool($: Engine, name: string, input: Record<string, unknown>): Promise<string> {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : '')
  if (root === '') return 'Not in a git checkout: there is no graph.'
  if (name === TOOL_NAMES.plan) return answerPlanTool($, str('title'), str('under'), str('card'), str('column'))
  const isRemember = name === TOOL_NAMES.remember
  if (isRemember) {
    const text = str('text')
    const raw = input.about
    const about = (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []).map(x => String(x).replace(/[[\]]/g, '').trim()).filter(x => x !== '')
    if (text === '') return 'Nothing recorded: give the decision as text.'
    await writeNote($, `${text.replace(/\s*\[about:[^\]]*\]\s*$/i, '')}${about.length > 0 ? ` [about: ${about.join(', ')}]` : ''}`)
  }
  const g = await loadGraph($, graphCtx(), liveOf($), isRemember)
  if (g === null) return 'The graph could not be built.'
  if (isRemember) {
    const notes = await readText($, studioPath(NOTES_FILE))
    const line = (notes ?? '').trimEnd().split('\n').at(-1) ?? ''
    return `Recorded in docs/studio/notes.md: ${line}`
  }
  if (name === TOOL_NAMES.recall) return recallToolText(g, str('topic'))
  if (name === TOOL_NAMES.path) return pathText(g, str('from'), str('to'))
  if (name === TOOL_NAMES.overview) return overviewText(g, await brainStatus($, graphCtx()))
  if (name === TOOL_NAMES.section) {
    const pick = findSection(g, str('doc'), str('heading'))
    if ('candidates' in pick) {
      return pick.candidates.length === 0
        ? `No doc matches "${str('doc')}".`
        : `No heading matches "${str('heading')}". Sections there:\n${pick.candidates.map(c => `- ${c}`).join('\n')}`
    }
    const file = await readText($, `${root}/${pick.path}`)
    if (file === null) return `${pick.path} could not be read.`
    return `${pick.path}, lines ${pick.line}-${pick.endLine} (§"${pick.label}"):\n\n${sectionText(file, pick.line, pick.endLine)}`
  }
  return `Unknown tool ${name}.`
}

// ---- the plan (stage 10) ----

/** studio_plan: add a planned stage, move a card, or list the planned stages. */
async function answerPlanTool($: Engine, title: string, under: string, cardId: string, column: string): Promise<string> {
  const { areas: ms } = planAreas(await loadGraph($, graphCtx(), liveOf($), false).catch(() => lastGraph()))
  if (cardId !== '') {
    const cards = await readCards($)
    const card = cards.find(x => x.id === cardId)
    if (!card) return `No card ${cardId}. studio_plan with no input lists them.`
    const to = (['planned', 'building', 'waiting', 'review', 'done'] as const).find(x => x === column.toLowerCase())
    if (!to) return 'Give column as planned, building, waiting, review or done.'
    const item: KanbanItem = { key: card.id, title: card.title, fact: '', column: card.pin ?? 'planned', isLive: false, isPinned: true, rowId: card.rowId, at: 0 }
    await moveCard($, item, to)
    return `Moved "${card.title}" to ${to}.`
  }
  if (title !== '') {
    const code = findArea(ms, under)
    if (code === null) return `"${under}" is not a milestone or topic. Milestones: ${[...ms.keys()].filter(k => !k.includes(':') && k !== OTHER).join(', ')}; topics by name (METRO 9, the Warden, audio).`
    const card = await addCard($, title, code)
    if (card === null) return 'Nothing planned: give the stage a title.'
    return `Planned "${card.title}" under ${ms.get(code)} (card ${card.id}). It shows dashed on the plan map until its chat starts.`
  }
  const cards = (await readCards($)).filter(x => x.under && x.pin !== 'done')
  if (cards.length === 0) return 'No planned stages. Add one with {title, under}.'
  return cards.map(x => `- ${x.under}: ${x.title} (${x.pin ?? 'planned'}; card ${x.id})`).join('\n')
}

/** What the Plan view draws for its focus and pick. */
function planPaneOf(g: Graph, v: BoardView, cards: readonly CardFile[], ui: PaneUi, columns: number): PlanPane {
  const { areas: ms, areaOf } = planAreas(g)
  const items = planItems(v, cards, ms, areaOf)
  const focus = ui.planFocus !== PLAN_HOME && ms.has(ui.planFocus) ? ui.planFocus : PLAN_HOME
  const view = planView(items, ms, focus, ui.planPick)
  const layout = mapLayout(columns)
  const picked = view.kind === 'milestone' && view.pick !== null ? (view.items.find(i => i.key === view.pick) ?? null) : null
  const rows = [...v.groups.waiting, ...v.groups.working, ...v.groups.recent, ...v.groups.quiet]
  const node = view.kind !== 'milestone' || view.code === OTHER ? null : view.code.includes(':') ? view.code : `milestone:${view.code}`
  const around = node !== null ? mapView(g, node) : null
  return {
    view,
    svg: planSvg(view, layout.width),
    isSide: layout.isSide,
    crumbs: [
      { id: PLAN_HOME, label: 'Scrapshift' },
      ...(view.kind === 'milestone' ? [{ id: view.code, label: clip(view.label, 40) }] : []),
      ...(picked !== null ? [{ id: picked.key, label: clip(picked.title, 40), pick: true }] : []),
    ],
    moves: view.kind === 'home' ? view.milestones.map(x => ({ id: x.code, label: clip(x.label, 30) })) : view.items.slice(0, 14).map(i => ({ id: i.key, label: clip(i.title, 28) })),
    jump: planJump(items, ms),
    side: view.kind === 'home' ? planSummary(items) : around !== null && node !== null ? reminderBrief(around, statusOf(g, node)) : [],
    milestone: view.kind === 'milestone' ? view.label : null,
    picked,
    pickedRow: picked?.rowId ? (rows.find(r => r.id === picked.rowId) ?? null) : null,
  }
}

// ---- the map (stage 9) ----

/** The graph the Map tab draws: built at most once a minute (forced by the pane's refresh). */
async function mapGraph($: Engine, isForced = false): Promise<Graph | null> {
  if (root === '') return null
  return loadGraph($, graphCtx(), liveOf($), isForced).catch(() => lastGraph())
}

/** A topic's, milestone's or workstream's newest status head, for the reminder's first line. */
function statusOf(g: Graph, id: string): string | null {
  const n = g.nodes.get(id)
  return n && (n.kind === 'topic' || n.kind === 'milestone' || n.kind === 'workstream') ? (n.status ?? null) : null
}

/** What the Map tab draws for its focus (home when the focus is gone from the graph). */
function mapPaneOf(g: Graph, ui: PaneUi, columns: number): MapPane {
  const focus = ui.mapFocus === HOME || g.nodes.has(ui.mapFocus) ? ui.mapFocus : HOME
  const view = mapView(g, focus) ?? homeView(g)
  const jump = jumpOptions(g)
  if (!jump.some(o => o.value === focus)) jump.splice(1, 0, { value: focus, label: `${view.label} (here)` })
  const trail = focus === HOME ? [] : ui.mapTrail.filter(id => g.nodes.has(id))
  const moveList = moves(view)
  const layout = mapLayout(columns)
  return {
    focus,
    view,
    svg: mapSvg(view, layout.width),
    isSide: layout.isSide,
    crumbs: [{ id: HOME, label: 'Studio' }, ...trail.map(id => ({ id, label: g.nodes.get(id)?.label ?? id }))],
    moves: moveList,
    jump,
    // Short, beside the map, as the approved sketch drew it (the user, 2026-11-16).
    brief: reminderBrief(view, statusOf(g, focus)),
    hasMore: view.branches.reduce((k, b) => k + b.total, 0) > moveList.length,
    graphLine: graphLine(g),
    file: ui.mapFile,
  }
}

/**
 * "Open the full map": map.html written to the graph's own folder (outside git:
 * it holds rule names from the memory folder), then opened in the default browser.
 */
async function openMap($: Engine): Promise<string> {
  const g = await mapGraph($)
  if (g === null) throw new Error('the graph could not be built')
  if (home === '') throw new Error('the home folder is unknown')
  const path = `${graphDir(graphCtx())}/map.html`
  await $.fs.write(path, mapHtml(g, new Date(g.builtAt).toISOString().slice(0, 16).replace('T', ' ')))
  await update($, paneUiRef, x => ({ ...(x ?? PANE_UI), mapFile: path }))
  // Windows opens an .html with the default browser through explorer (which answers exit code 1 even when it opened).
  const opened = await $.process
    .run(['explorer.exe', path.replace(/\//g, '\\')], { timeoutMs: 15_000 })
    .then(
      () => true,
      () => false,
    )
  $.ui.toast(opened ? `studio: the full map opens in your browser (${path})` : `studio: the full map is written: ${path}`)
  return path
}

/** A card or a note that could not be written says so: a press that changes nothing would look like a dead button. */
function saveFailed($: Engine, what: string, error: unknown): void {
  $.ui.toast(`studio: ${what} did not go through (${error instanceof Error ? error.message : String(error)})`)
}

// Stage 7: the pane is drawn by hooks/pane.tsx from plain values; every handler is here.
function actions($: Engine): PaneActions {
  const ui = (fn: (x: PaneUi) => PaneUi) => update($, paneUiRef, x => fn(x ?? PANE_UI))
  const toggle = <T,>(list: readonly T[], item: T): T[] => (list.includes(item) ? list.filter(x => x !== item) : [...list, item])
  return {
    // The Map tab reads the memory graph: built (at most once a minute) before the tab shows it.
    tab: async tab => {
      if (tab === 'map') await mapGraph($)
      return ui(x => ({ ...x, tab }))
    },
    filter: value => ui(x => ({ ...x, filter: readFilter(value) })),
    boardBy: by => ui(x => ({ ...x, boardBy: by })),
    toggleLead: id => ui(x => ({ ...x, openLeads: toggle(x.openLeads ?? [], id) })),
    toggleRecap: id => ui(x => ({ ...x, openRecaps: toggle(x.openRecaps, id).slice(-50) })),
    toggleQuiet: () => update($, quietRef, x => !x),
    toggleRecent: () => ui(x => ({ ...x, allRecent: !x.allRecent })),
    toggleColumn: c => ui(x => ({ ...x, openColumns: toggle(x.openColumns, c) })),
    refresh: async () => {
      await refresh($, { withHeader: true, isForced: true }).catch(() => undefined)
      if ((await read($, paneUiRef))?.tab === 'map') {
        await mapGraph($, true)
        await ui(x => ({ ...x, seq: x.seq + 1 }))
      }
    },
    ask: text => askBoard($, text),
    askCancel: () => askStop?.abort(),
    askClear: () => update($, askRef, x => ({ ...(x ?? EMPTY_ASK), turns: [] })),
    askMode: value => ui(x => ({ ...x, askMode: value === 'quick' ? 'quick' : 'director' })),
    send: text => sendToDirector($, text).catch(error => saveFailed($, 'the message', error)),
    brief: r => sendToDirector($, briefPrompt(r)).catch(error => saveFailed($, 'the message', error)),
    answer: (r, label) => sendToDirector($, answerPrompt(r, label)).catch(error => saveFailed($, 'the message', error)),
    addNote: text =>
      writeNote($, text)
        .then(() => ui(x => ({ ...x, seq: x.seq + 1 })))
        .catch(error => saveFailed($, 'the note', error)),
    addCard: text => addCard($, text).catch(error => saveFailed($, 'the card', error)),
    move: (item, to) => moveCard($, item, to).catch(error => saveFailed($, 'the move', error)),
    become: () => becomeFromPane($).catch(() => undefined),
    mapGo: async id => {
      const g = await mapGraph($)
      if (g === null || (id !== HOME && !g.nodes.has(id))) return
      return ui(x => ({ ...x, mapFocus: id, mapTrail: nextTrail(x.mapTrail, id), seq: x.seq + 1 }))
    },
    mapBack: () =>
      ui(x => {
        const trail = x.mapTrail.slice(0, -1)
        return { ...x, mapTrail: trail, mapFocus: trail.at(-1) ?? HOME }
      }),
    mapOpen: () => openMap($).catch(error => saveFailed($, 'the full map', error)),
    mapMode: async mode => {
      await mapGraph($)
      return ui(x => ({ ...x, mapMode: mode }))
    },
    planGo: async code => {
      await mapGraph($)
      return ui(x => ({ ...x, planFocus: code, planPick: null }))
    },
    planPick: key => ui(x => ({ ...x, planPick: key })),
    planStart: (item, milestone) => sendToDirector($, startPrompt(item, milestone)).catch(error => saveFailed($, 'the message', error)),
    planAdd: async text => {
      const focus = (await read($, paneUiRef))?.planFocus ?? PLAN_HOME
      if (focus === PLAN_HOME) return
      return addCard($, text, focus).catch(error => saveFailed($, 'the stage', error))
    },
    planDone: item => (item.kanban !== null ? moveCard($, item.kanban, 'done').catch(error => saveFailed($, 'the move', error)) : undefined),
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    cwd = e.cwd
    isOptedIn = (await $.env.get('STUDIO_REPORTER')) === 'always'
    root = await findRoot($, e.cwd)
    home = await homeDir($).catch(() => '')
    const prev = await read($, reportRef)
    if (prev) {
      title = prev.title
      appId = prev.appId
    }
    directorMark = await read($, directorRef)
    isDirector = directorMark !== null
    // A question on its way died with the module's last copy (a reload).
    if ((await read($, askRef))?.pending) await update($, askRef, x => ({ ...(x ?? EMPTY_ASK), pending: null }))
    resetMethod = readMethod(await $.env.get('STUDIO_RESET'), DEFAULT_METHOD)
    await $.command.register({
      name: 'director',
      description: 'Make this new chat the Studio director: the board, a snapshot on each prompt, notes, no building (type it first in a fresh chat; `fresh` clears a used chat first; `off` leaves the mode)',
      argumentHint: '[fresh | off]',
    })
    await $.command.register({
      name: 'studio',
      description: "Studio board: every chat's state, in a pane and as text; `me` this chat's report; `note <text>` adds a line to the director's notes; `card <text>` adds a kanban card; `tag <X>` sets its tag; `allow-commit` lets one docs/studio/ commit through; `recall <words>` shows what the director's memory graph recalls for them; `graph` its overview; `map` opens the full map; `brain` the brain pass",
      argumentHint: '[me | note <text> | card <text> | tag <X> | allow-commit | recall <words> | graph | map | brain]',
    })
    // A chat that starts (or restarts after a reload) is alive: a "stopped" left by its
    // last end goes back to idle.
    // A director whose $.state lost its mark is found again by its app id (stage 5).
    later($, async () => {
      await save($, prev => (prev.state === 'stopped' ? { state: 'idle' } : {}), true)
      await recallDirector($).catch(() => undefined)
      await keepDirectorKnown($).catch(() => undefined)
      // Stage 8: the director's graph tools, and the brain pass in the background.
      if (isDirector) await registerTools($).catch(() => undefined)
    })
    // A reload runs session.start again with a surface already attached, and no
    // session.attach follows: poll from here then.
    later($, async () => {
      if ((await $.session.surfaces().catch(() => [])).length > 0) {
        attached.add(SEEDED)
        startPoll($)
      }
    })
    return r
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const t = (e as { session_title?: string }).session_title
    if (typeof t === 'string' && t.trim() !== '') title = t.trim()
    return next(e)
  }).catch(($, e, next) => next(e)) // fail open

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && isDirector) {
      // Stage 5: a turn stops any reset on its way, and the notes check reads where the notes stood.
      cancelResets()
      const notesAtStart = root ? await readText($, studioPath(NOTES_FILE)) : null
      turnFacts = { notesAtStart, decisions: [], prompt: nextPrompt }
      nextPrompt = null
      later($, () => keepDirectorKnown($).catch(() => undefined))
    }
    const r = await next(e)
    if (e.agentId === undefined) {
      turnSeq++
      isTurnRunning = true
      wrap = null
      later($, () => save($, () => ({ state: 'working', ask: null })))
    }
    return r
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      if (e.effort) effort = String(e.effort)
      if (e.model && model === '') model = e.model
    }
    return yield* next(e)
  })

  on('tool.call', { tool: WRAP_UP }, async ($, e, next) => {
    if (e.agentId === undefined) wrap = readWrapUp(e)
    return next(e)
  }).catch(($, e, next) => next(e)) // fail open

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const ask = readQuestion(e)
    await save($, () => ({ state: 'waiting-you', ask }))
    const r = await next(e)
    const x = r as { deny?: unknown; isError?: unknown }
    if (x.deny === undefined && x.isError !== true) consentTurn = turnSeq // D7: the user answered in this turn
    later($, () => save($, () => ({ state: 'working', ask: null })))
    return r
  }).catch(($, e, next) => next(e)) // fail open

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    return (await onShell($, String((e as { command?: unknown }).command ?? ''), () => next(e))) as Awaited<ReturnType<typeof next>>
  }).catch(($, e, next) => next(e)) // fail open

  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    return (await onShell($, String((e as { command?: unknown }).command ?? ''), () => next(e))) as Awaited<ReturnType<typeof next>>
  }).catch(($, e, next) => next(e)) // fail open

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) return r
    isTurnRunning = false
    // What the pane sent has been answered (or its turn ended some other way): its buttons come back.
    if ((await read($, paneUiRef))?.sent) later($, () => update($, paneUiRef, x => ({ ...(x ?? PANE_UI), sent: null })))
    const w = wrap
    wrap = null
    const isAnswer = e.reason === 'answer'
    const fallback = recapFromAnswer(e.answer)
    if (isDirector) {
      // The carry-over keeps the end of each reply and its recap, for a reset after it.
      lastReply = typeof e.answer === 'string' ? e.answer : ''
      lastRecap = w?.recap ?? ''
      // The notes check and the reset (stage 5) read the notes before the cap moves any line.
      const hasOpenAsk = isAnswer && w?.ask != null
      const isDone = e.reason === 'answer' || e.reason === 'refusal'
      later($, async () => {
        if (isDone) await afterDirectorTurn($, hasOpenAsk).catch(() => undefined)
        else turnFacts = null
        await trimNotes($).catch(() => undefined)
      })
    }
    later($, () =>
      save(
        $,
        prev => ({
          state: isAnswer && w?.ask ? 'waiting-you' : 'idle',
          recap: w?.recap || fallback || prev.recap,
          ask: isAnswer ? (w?.ask ?? null) : null,
        }),
        true,
      ),
    )
    return r
  })

  // ---- director mode (stage 3) ----

  // The role (§5.4): one fixed system section, director chat only (S4: fixed for the thread).
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    // The module's mark too: a thread a /clear started gets the role even if $.state lost it.
    if ((!isDirector && (await read($, directorRef)) === null) || r.sections.some(x => x.id === ROLE_ID)) return r
    return { sections: [...r.sections, { id: ROLE_ID, text: ROLE_TEXT, scope: 'session' as const }] }
  }).catch(($, e, next) => next(e)) // fail open: a prompt never waits on the role

  // Three jobs, one hook (the engine takes one unmatched prompt.submit per module):
  // the turn's class (stage 4, §5.9) in every chat, started with the prompt and never
  // holding it up; and in the director chat the snapshot (§5.3), as context on each
  // of the user's prompts, never on a peer's message, with stage 5's notes check
  // (the decision check started, and the hidden line while a note is owed).
  on('prompt.submit', async ($, e, next) => {
    if (e.command === undefined && e.isMeta !== true && e.text.trim() !== '') startClass($, e.text)
    if (e.command !== undefined || !isUserOrigin(e.origin, e.isMeta === true)) return next(e)
    if (!isDirector) {
      // Stage 11: a lead chat gets its own chats on each of the user's prompts (fails open).
      const lead = await buildLeadSnapshot($).catch(() => null)
      return next(lead === null ? e : { ...e, context: [...(e.context ?? []), lead] })
    }
    cancelResets()
    const prev = await read($, reportRef)
    const decided =
      e.text.trim() === ''
        ? null
        : $.model.classify(e.text.slice(0, CLASSIFY_CHARS), DECISION_LABELS, { model: CLASSIFY_MODEL }).then(
            label => label === DECISION_LABEL,
            () => false,
          )
    nextPrompt = { answeredAsk: prev?.ask != null, decided }
    const owed = await read($, noteOwedRef)
    const text = await buildSnapshot($)
    // Stage 8: what the files and memory hold about what the prompt names, beside the snapshot.
    const recall = await withRecall($, e.text)
    // The carry-over: the thread before a reset, on the first prompt after it.
    recentAsks = pushAsk(recentAsks, e.text)
    const carry = await takeCarry($)
    return next({ ...e, context: [...(e.context ?? []), text, ...(recall === null ? [] : [recall]), ...(carry === null ? [] : [carry]), ...(owed === null ? [] : [noteLine(owed.why)])] })
  }).catch(($, e, next) => next(e)) // fail open: the prompt goes without a snapshot

  // After a compaction the next snapshot is full. Stage 5: in the director chat a
  // plugin's compaction right after the reset, no turn between, is skipped.
  on('session.compact', async ($, e, next) => {
    const isMain = e.agentId === undefined && e.trigger !== 'precompute'
    if (isMain && isDirector && e.trigger === 'plugin' && !isOwnRun && lastResetSeq === turnSeq) return { skip: SKIP_TWICE }
    const r = await next(e)
    if (isMain && r.skip === undefined) {
      await update($, snapRef, () => null)
      nudges = 0
      lastResetSeq = turnSeq
    }
    return r
  }).catch(($, e, next) => next(e))

  // In the desktop smart-compact compacts with a queued /compact: in the director
  // chat, one right after the reset, no turn between, is skipped. The user's own
  // /compact always runs.
  on('command.run', { command: 'compact' }, async ($, e, next) => {
    const o = e.origin as { kind: string; name?: string }
    const isOurs = /^studio(@|$)/.test(o.name ?? '')
    if (isDirector && !isOwnRun && !isOurs && o.kind === 'plugin' && lastResetSeq === turnSeq) return { text: SKIP_TWICE }
    return next(e)
  }).catch(($, e, next) => next(e))

  // ---- auto model (stage 4) ----

  // Each subagent's model (§5.9), by full id, never above the chat's own. Never the
  // chat's own model or effort (S9): turn.step passes both through untouched.
  on('agent.spawn', async ($, e, next) => {
    const cls = await classForSpawn($)
    const pick = routeSubagent(
      {
        type: e.subagentType,
        prompt: e.prompt,
        description: e.description,
        asked: e.model,
        parent: e.parentModel,
        turnClass: cls,
        isFork: e.fork,
        isWorkflow: e.workflow !== undefined,
      },
      await readPolicy($),
    )
    const r = await next(pick.model === e.model ? e : { ...e, model: pick.model })
    if (r.deny !== undefined) return r
    const routing: Routing = {
      at: await iso($),
      agentType: e.subagentType,
      asked: e.model ?? null,
      sent: pick.model ?? null,
      ranOn: typeof r.model === 'string' ? r.model : '',
      why: pick.why,
      isCapped: pick.isCapped,
    }
    later($, () => save($, prev => ({ routings: [...(prev.routings ?? []), routing].slice(-ROUTINGS_KEPT) })))
    return r
  }).catch(($, e, next) => next(e)) // fails safe: the spawn goes as asked

  // The guard (§5.6): in the director chat, building is refused; its subagents too.
  on('tool.call', async ($, e, next) => {
    if (!isDirector) return next(e)
    const { tool, ...input } = e as unknown as { tool: string } & Record<string, unknown>
    const ask = consentRefusal(tool, input, { ownEffort: effort, hasConsent: consentTurn === turnSeq })
    if (ask !== null) return { deny: ask } as Awaited<ReturnType<typeof next>>
    // Stage 8: a live chat with the same tag: refused until the user says so (fails open). Stage 11 dropped the one-builder check.
    if (START_TOOL.test(tool) && input.agentId === undefined) {
      const rows = await boardRows($).catch(() => null)
      const twin = rows === null ? null : startRefusal(tool, input, { rows, hasConsent: consentTurn === turnSeq })
      if (twin !== null) return { deny: twin } as Awaited<ReturnType<typeof next>>
    }
    const why = guardTool(tool, input, { root: root || cwd, cwd: await sessionDir($), cliId: await $.session.id() })
    if (why !== null) return { deny: why } as Awaited<ReturnType<typeof next>>
    if (GRAPH_TOOL.test(tool)) graphTurn = turnSeq
    const r = await next(e)
    // Stage 8, graphify's nudge: a big doc opened while the graph wasn't asked this turn (5 a thread at most).
    const isNudge = toolsUp && input.agentId === undefined && graphTurn !== turnSeq && nudges < NUDGE_CAP && isDocRead(tool, input)
    const y = r as { deny?: unknown; isError?: unknown; context?: readonly string[] }
    if (isNudge && y.deny === undefined && y.isError !== true) {
      nudges++
      return { ...y, context: [...(y.context ?? []), NUDGE_TEXT] } as unknown as Awaited<ReturnType<typeof next>>
    }
    // Stage 5's notes check: a call that acts on a decision (a chat started, switched or messaged).
    const act = decisionTool(tool)
    const x = r as { deny?: unknown; isError?: unknown }
    if (act !== null && input.agentId === undefined && turnFacts !== null && x.deny === undefined && x.isError !== true) turnFacts.decisions.push(act)
    return r
  }).catch(($, e, next) =>
    // fails closed in the director chat
    isDirector ? ({ deny: guardRefusal(`${String(e.tool)} (the guard could not check it)`) } as Awaited<ReturnType<typeof next>>) : next(e),
  )

  // Stage 8: the director's graph tools (studio_recall, _path, _remember, _section, _overview).
  on('tool.call', { tool: GRAPH_TOOL }, async ($, e) => {
    const { tool, ...input } = e as unknown as { tool: string } & Record<string, unknown>
    const name = tool.replace(/^mcp__studio__/, '')
    try {
      return { result: await answerGraphTool($, name, input) }
    } catch (error) {
      return { result: `studio: ${name} failed (${error instanceof Error ? error.message : String(error)}). Read the docs directly.` }
    }
  })

  on('command.run', { command: 'director' }, async ($, e) => {
    const verb = e.args.trim().toLowerCase()
    if (root === '') return { text: 'Not in a git checkout: director mode needs the Scrapshift repo.' }
    const isMarked = isDirector || (await read($, directorRef)) !== null
    if (isMarked && verb !== 'off') return { text: 'This chat is already the Studio director. /studio shows the board; /director off leaves the mode.' }
    if (!isUserOrigin(e.origin)) {
      return { text: "/director is the user's own command; it was not typed by the user, so nothing changed." }
    }
    if (verb === 'off') {
      if (!isMarked) return { text: 'This chat is not the Studio director.' }
      await leaveDirector($)
      return {
        text:
          'This chat is no longer the Studio director: the guard, the board snapshots and the resets stop now. ' +
          'The director role text stays in this thread until the chat is cleared.',
      }
    }
    if (verb !== '' && verb !== 'fresh') return { text: 'Usage: /director (first in a new chat), /director fresh (clears a used chat first), /director off.' }
    const messages = (await $.session.messages().catch(() => [])) as unknown
    const isUsed = isUsedChat(Array.isArray(messages) ? (messages as Array<{ role?: unknown }>) : [])
    if (isUsed && verb === 'fresh') {
      // Stage 7: the clear runs once this command has returned (it waits for an idle chat).
      later($, () => makeDirectorFresh($).catch(() => undefined))
      return { text: 'Clearing this chat and making it the Studio director.' }
    }
    if (isUsed) {
      await update($, offerRef, () => true)
      return {
        text:
          'Director mode starts only as the first thing in a chat: the role reaches a chat only before its first reply. ' +
          'This chat already has replies. Press the button under this line, or type `/director fresh`, to clear this chat and make it the director; ' +
          'nothing is cleared until you do. Or: Start a fresh chat and type /director first.',
      }
    }
    return becomeDirector($)
  })

  on('session.end', async ($, e, next) => {
    // A /clear goes on in the same app chat under a new CLI id: the next turn rewrites the file.
    // A chat that ends while it waits on the user still waits: the ask stands in its
    // transcript, and `/reload-plugins` ends the mod's old copy of a live chat too.
    if (e.reason !== 'clear') await save($, prev => (prev.state === 'waiting-you' ? {} : { state: 'stopped', ask: null }))
    return next(e)
  })

  // The desktop attaches a surface only while the chat is on screen (S1): reopen the
  // pane then, and poll the board (for the pane and the toasts) only while one is attached.
  on('session.attach', async ($, e, next) => {
    const r = await next(e)
    attached.add(e.clientId)
    if ((await read($, boardOpenRef)) === true) await $.ui.open({ id: PANE, title: PANE_TITLE })
    startPoll($)
    return r
  })

  on('session.detach', async ($, e, next) => {
    const r = await next(e)
    attached.delete(e.clientId)
    attached.delete(SEEDED)
    if (attached.size === 0) stopPoll()
    return r
  })

  on('ui.close', async ($, e, next) => {
    const r = await next(e)
    if (e.id === PANE && e.origin.kind === 'person') await update($, boardOpenRef, () => false)
    return r
  }).catch(($, e, next) => next(e)) // never keeps a pane open

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const v = await read($, boardRef)
    // Minimized to a widget, the pane draws what reads at a glance.
    if (e.props.placement === 'widget') return glanceTree(els, v)
    if (v === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Reading docs/studio/sessions/…</Text>
        </Box>
      )
    }
    const report = await read($, reportRef)
    const isDir = isDirector || (await read($, directorRef)) !== null
    const extras = (await read($, extrasRef)) ?? EMPTY_EXTRAS
    const paneUi = (await read($, paneUiRef)) ?? PANE_UI
    const model: PaneModel = {
      view: v,
      w: Math.max(20, e.props.bodyColumns),
      isDirector: isDir,
      director: isDir ? null : directorRow(v.groups, DIRECTOR_TAG, extras.directors),
      canBecome: !isDir && root !== '' && report !== null && report.turns === 0,
      ui: paneUi,
      ask: (await read($, askRef)) ?? EMPTY_ASK,
      extras,
      isQuietOpen: (await read($, quietRef)) === true,
      selfTokens: report?.context?.tokens ?? null,
      routings: report?.routings ?? [],
      busy: isDir ? busyWith(paneUi.sent, isTurnRunning || report?.state === 'working', v.at) : null,
      owed: isDir ? ((await read($, noteOwedRef))?.why ?? null) : null,
      resetTokens: RESET_TOKENS,
      map: null,
      plan: null,
    }
    // Stage 9: the Map tab draws the graph as last built; a pane that opens on it (a reload) builds it first.
    if (paneUi.tab === 'map') {
      const g = lastGraph()
      if (g !== null && paneUi.mapMode === 'memory') model.map = mapPaneOf(g, paneUi, model.w)
      else if (g !== null) model.plan = planPaneOf(g, v, extras.cards, paneUi, model.w)
      else if (!isMapLoading) {
        isMapLoading = true
        later($, async () => {
          await mapGraph($).catch(() => null)
          isMapLoading = false
          await update($, paneUiRef, x => ({ ...(x ?? PANE_UI), seq: (x?.seq ?? 0) + 1 }))
        })
      }
    }
    return paneTree(els, model, actions($), 'Svg' in els ? els.Svg : null)
  })

  // `/studio`'s row in the transcript: the board drawn, where the surface draws trees.
  // The text stays the row the model reads, and what any failure here falls back to.
  on('ui.render', { component: 'CommandOutput', props: { command: 'studio' } }, async ($, e, next) => {
    if (e.props.isErrored || e.props.args.trim() !== '') return next(e)
    const v = await read($, boardRef)
    if (v === null) return next(e)
    const where = e.props.text.split('\n')[0] ?? ''
    return commandTree($.ui.resolve(e), v, Math.max(30, (e.viewport?.columns ?? 84) - 4), where)
  }).catch(($, e, next) => next(e))

  // `/director` typed in a used chat: its row offers the one button that clears the chat
  // and makes it the director. Nothing clears without that press.
  on('ui.render', { component: 'CommandOutput', props: { command: 'director' } }, async ($, e, next) => {
    if (e.props.isErrored || (await read($, offerRef)) !== true || isDirector) return next(e)
    const { Box, Button, Markdown } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" gap={1}>
        <Markdown text={e.props.text} />
        <Button key="director-fresh" variant="primary" onPress={() => makeDirectorFresh($).catch(() => undefined)}>
          Clear this chat and make it the director
        </Button>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // The prompt footer says `director` in the director chat.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!isDirector && (await read($, directorRef)) === null) return next(e)
    if (e.props.modes.includes('director')) return next(e)
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, 'director'] } })
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'studio' }, async ($, e) => {
    const args = e.args.trim()
    const [verb = '', ...rest] = args.split(/\s+/)
    if (verb === '') {
      if (root === '') return { text: 'Not in a git checkout, so there is no board to read.' }
      const view = await refresh($, { withHeader: true, isForced: true })
      const opened = await openPane($).catch(() => null)
      if (attached.size === 0 && (await $.session.surfaces().catch(() => [])).length > 0) {
        attached.add(SEEDED)
        startPoll($)
      }
      const where = opened?.isPlaced ? 'The board pane is open beside the chat.' : 'No surface can show the pane here; the board is below.'
      return { text: `${where}\n\n${boardText(view)}` }
    }
    if (verb === 'tag') {
      const tag = rest.join(' ').trim() || null
      await update($, manualTagRef, () => tag)
      await save($, () => ({}))
      const r = await read($, reportRef)
      return { text: tag ? `Tag set to ${tag}.` : `Manual tag cleared; the title's tag is ${r?.tag ?? 'none'}.` }
    }
    if (verb === 'allow-commit') {
      const kind = e.origin.kind
      if (kind !== 'composer' && kind !== 'bridge' && kind !== 'sdk') {
        return { text: 'allow-commit is the user\'s own command; it was not typed by the user, so nothing changed.' }
      }
      const until = (await $.clock.now()) + ALLOW_MS
      await update($, allowRef, () => until)
      return { text: 'The next commit in this chat may include docs/studio/ (one commit, within 10 minutes).' }
    }
    if (verb === 'note') {
      const text = rest.join(' ').trim()
      if (text === '') return { text: 'Usage: /studio note <text> adds one dated line to docs/studio/notes.md.' }
      if (root === '') return { text: 'Not in a git checkout: no notes file.' }
      await writeNote($, text) // the user's own note pays what the director owed (stage 5)
      return { text: `Noted in ${STUDIO_DIR}/${NOTES_FILE}.` }
    }
    if (verb === 'card') {
      const text = rest.join(' ').trim()
      if (text === '') return { text: 'Usage: /studio card <text> adds a card to the kanban, in Planned.' }
      if (root === '') return { text: 'Not in a git checkout: no kanban.' }
      const card = await addCard($, text)
      return { text: card === null ? 'No card added.' : `Card added to Planned: ${card.title} (${STUDIO_DIR}/${CARDS_DIR}/${cardFileName(card.id)}).` }
    }
    if (verb === 'probe') return { text: await probe($) }
    // Stage 8: what recall would add for some words; the graph's overview; the brain pass.
    if (verb === 'recall') {
      const text = rest.join(' ').trim()
      if (text === '') return { text: 'Usage: /studio recall <words> shows what the director would be reminded of for them.' }
      if (root === '') return { text: 'Not in a git checkout: there is no graph.' }
      const block = await withRecall($, text)
      return { text: block ?? `Nothing in the graph matches "${text}" (and the Haiku fallback named no topic): the director gets no recall for it.` }
    }
    if (verb === 'map') {
      if (root === '') return { text: 'Not in a git checkout: there is no graph.' }
      try {
        const path = await openMap($)
        return { text: `The full map (pan, zoom, fold, search, a node's details on a click) is written to ${path}, outside the repo, and opened in your browser. The pane's Map tab shows the same graph.` }
      } catch (error) {
        return { text: `The full map was not written: ${error instanceof Error ? error.message : String(error)}` }
      }
    }
    if (verb === 'graph') {
      if (root === '') return { text: 'Not in a git checkout: there is no graph.' }
      const g = await loadGraph($, graphCtx(), liveOf($), true)
      return { text: g === null ? 'The graph could not be built.' : overviewText(g, await brainStatus($, graphCtx())) }
    }
    if (verb === 'brain') {
      if (root === '') return { text: 'Not in a git checkout: there is no brain pass.' }
      const how = (rest[0] ?? '').toLowerCase()
      if (how === 'pause') pauseBrain(true)
      if (how === 'resume' || how === 'start') {
        pauseBrain(false)
        if (!isDirector) return { text: 'The brain pass runs in the director chat only.' }
        startBrain($, graphCtx())
      }
      await loadGraph($, graphCtx(), liveOf($)).catch(() => null)
      return { text: `${await brainStatus($, graphCtx())}\nIts answers are kept outside the repo, in ${graphDir(graphCtx())}/brain.json.${isDirector ? '' : ' It runs in the director chat only.'}` }
    }
    if (verb !== 'me') {
      return {
        text: 'Commands: /studio (the board), /studio me, /studio note <text>, /studio card <text>, /studio tag <X>, /studio tag (clear), /studio allow-commit, /studio recall <words>, /studio graph, /studio map, /studio brain [pause | resume]; /director in a fresh chat, /director fresh, /director off.',
      }
    }
    const r = await read($, reportRef)
    if (!r) return { text: 'No report yet for this chat.' }
    const reset = isDirector ? await read($, lastResetRef) : null
    const owed = isDirector ? await read($, noteOwedRef) : null
    const asked = (await read($, askRef)) ?? EMPTY_ASK
    const file = root ? `${STUDIO_DIR}/sessions/${reportName(r.appId, r.cliId)}` : '(not in a git checkout: nothing written)'
    return {
      text: [
        `${r.tag ?? '(no tag)'} · ${r.title || '(untitled)'}`,
        `state ${r.state} since ${r.stateSince} · ${r.turns} turns · ${r.model || '?'} ${r.effort || ''}`.trim(),
        r.context ? `context ${r.context.tokens} tokens (${r.context.pct} %)` : 'context unknown',
        r.lastCommit ? `last commit ${r.lastCommit.hash.slice(0, 9)} ${r.lastCommit.subject}` : 'no commit from this chat yet',
        r.ask ? `waiting on you: ${r.ask.question}` : '',
        `last turn class: ${r.turnClass === null ? 'none' : `${r.turnClass}${r.classMs === null ? '' : ` (${r.classMs} ms)`}`}`,
        ...((r.routings ?? []).length === 0
          ? ['no subagent routed yet']
          : [
              'subagents (oldest first):',
              ...(r.routings ?? []).map(x => `  ${x.agentType}: asked ${x.asked ?? '(none)'} → sent ${x.sent ?? '(left)'} → ran on ${x.ranOn || '?'} · ${x.why}`),
            ]),
        isDirector
          ? `reset: ${resetMethod === 'off' ? 'off' : `/${resetMethod}`} past ${RESET_TOKENS / 1000}k tokens or after ${IDLE_MS / 60_000} min away · last ${reset === null ? 'none yet' : `${reset.at} (${reset.kind}, /${reset.method}, ${reset.tokensBefore ?? '?'} → ${reset.tokensAfter ?? '?'} tokens)`}`
          : '',
        owed !== null ? `note owed since ${owed.since}: ${owed.why}` : '',
        ...askLines(asked),
        `file: ${file}`,
      ]
        .filter(l => l !== '')
        .join('\n'),
    }
  })
}
