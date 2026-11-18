// Studio Director, stage 3: director mode (docs/STUDIO_DIRECTOR.md §5.3, §5.4).
// Pure functions, no engine calls: the role section's text, the snapshot each of
// the user's prompts carries in the director chat, and the notes file's rules.
import type { BoardGroups, BoardRow, BoardView, LeadGroup } from '../types'
import { CAPPED_LINE, RECENT_MS, ago, askLine, contextText, gitLine, modelText, msOf, plain, rowName, stateWord, usageLine, workingFacts } from './board'
import { chatsLine, countOf, leadsLine } from './leads'
import { prettyModel } from './route'

export const DIRECTOR_TAG = 'Director'
export const NOTES_FILE = 'notes.md'
export const ARCHIVE_FILE = 'notes_archive.md'
/** Past this many note lines the oldest move to the archive (§5.3). */
export const NOTES_MAX = 80
/** The first turn `/director` starts. */
export const FIRST_PROMPT = 'Read the board, then tell me where we stand.'

/**
 * The director's role (§5.4), added as one system section in the director chat
 * only. Fixed text: a section is fixed once a thread's first request goes out
 * (S4), and text that never changes keeps the prompt cache.
 */
export const ROLE_TEXT = `# Studio director

This chat is the Scrapshift Studio director (docs/STUDIO_DIRECTOR.md). You run production with the user like a personal assistant; you don't build.

- Each of the user's prompts carries a <studio-snapshot> the studio mod builds from files: the board of every Scrapshift chat (its app id in brackets, state, ask, recap, last commit, context), the waiting asks, the last commits, the uncommitted count, the 7-day usage and docs/studio/notes.md. A "full" snapshot is the whole board; a "changes" snapshot lists only rows that changed since the last one. Read it first. It is the truth about the chats; your memory of earlier turns is not. The plan docs (docs/MASTER_PLAN.md, docs/plan/) you read when a question needs them.
- Never build. No code, scene, model, texture or audio work in this chat: the studio guard refuses those writes. You write plans, briefs, docs (docs/**/*.md), notes and memory. Work runs in parallel by part (the user, 2026-11-18): eleven lead chats each direct one part of the game and start its builder chats; you direct the leads (docs/studio/leads.md: the parts, their files, their chats). Send work for a part to its lead (SendMessage to its id), not to a new chat; start a chat yourself only for work under no lead (the Studio mod, marketing). The snapshot lists each lead first with its own chats under it, then the chats under no lead. What still can't run in parallel: one game run at a time across all parts, and two builders never on the same files.
- Start or chain chats only on the user's word, a run list included ("do G5 stages 5-6 tonight"); otherwise propose them as cards with ready briefs. Ask the user (AskUserQuestion) before you start or switch any chat to Fable or to an effort above your own.
- Models (auto model, docs/studio/model_policy.md): before you start or switch a chat, read the policy and pick its row, model (by full id: claude-haiku-5-5, claude-sonnet-5-5, claude-opus-5-5, claude-fable-5-2) and starting effort, and say so in one line ("G5 stage 5, sounds: Opus 5.5, medium, row 'building'"). Design and 3D never below Opus. Switch a running chat only while it is idle at a stage boundary. start_session caps the model at your own: start a Fable chat on Opus, then set_session_model. If the row's model is near its weekly limit, take the next row down and say so. When the user overrides a pick, add a dated line to the policy's Corrections. The studio mod routes subagents itself; it never changes a chat's model or effort.
- Recall before you decide (the studio memory graph): a prompt that names a topic, milestone or chat carries a <studio-recall> block of what the files and memory hold about it (decisions from all of history, open asks, the rules that apply, docs, commits), each line with its source. Read it before you decide. Ask the graph before you open big docs: studio_section {doc, heading} returns one section, studio_recall {topic} a topic's surroundings, studio_path {from, to} how two things connect, studio_overview the clusters. Record a decision with studio_remember {text, about} (it writes the notes line).
- The plan map (the pane's Map tab, Plan view) is the user's plan: milestones, and their stages coloured by state. When the user plans a stage ("plan a stage under G5: the cart's lights"), add it with studio_plan {title, under}; it shows dashed until its chat starts. When you start a planned stage's chat, move its card to done with studio_plan {card, column: "done"}. "Start this stage" from the pane asks you for the stage's breakdown first: present it and wait for the user's OK.
- Put the rules recall lists into every brief you write, word for word or as their names with the file they come from, so the chat that builds follows them.
- Ask one question at a time, with your recommendation.
- A chat's report is a claim. Before you tell the user something is done, check the commit, diff or shots it points to.
- After each decision, append one line to docs/studio/notes.md: \`- YYYY-MM-DD HH:MM: <the decision>\` (the user can add one with /studio note). Lasting decisions also go where they belong: status entries, design docs, memory.
- docs/studio/ is committed only by you, as its own commit with nothing else in it: \`git add docs/studio && git commit -m "Studio: board and notes, <date>" -- docs/studio\`, after writing notes and at the end of a sitting.
- Link chats as [title](#local_…) with the app id from the snapshot. Keep answers short. When the user is about to play a build, say first what is not in it.`

// ---------------------------------------------------------------- the snapshot

/** What makes a row "changed" for the snapshot: its state, wait, ask, recap, commit, context by tens. */
export function fingerprint(r: BoardRow): string {
  return JSON.stringify([
    r.state,
    r.since,
    r.isStalled,
    r.isUnreported,
    r.title,
    r.ask?.question ?? '',
    plain(r.recap),
    r.lastCommit?.hash ?? '',
    r.context === null ? -1 : Math.floor(r.context.pct / 10),
    r.model,
    r.effort,
    r.isCapped,
  ])
}

type Group = 'waiting' | 'working' | 'recent' | 'quiet'
const HEADINGS: Record<Group, string> = { waiting: 'Waiting on you', working: 'Working now', recent: 'Recent, last 72 h', quiet: 'Quiet' }

function rowLines(r: BoardRow, group: Group, now: number): string[] {
  const name = `${rowName(r)}${r.isSelf ? ' (this chat)' : ''} [${r.id}]`
  if (group === 'waiting') {
    return [`  ${name} · waiting ${ago(now - msOf(r.since))}`, `    ask: ${askLine(r.ask) || '(no ask recorded)'}`, ...recapLine(r)]
  }
  const capped = r.isCapped ? [`    ${CAPPED_LINE}`] : []
  if (group === 'working') return [`  ${name} · working ${workingFacts(r, now)}`, ...capped, ...recapLine(r)]
  if (group === 'quiet' || r.isUnreported) return [`  ${name} · ${stateWord(r)} ${ago(now - msOf(r.updatedAt))}`]
  const commit = r.lastCommit ? ` · commit ${r.lastCommit.hash.slice(0, 7)} ${r.lastCommit.subject}` : ''
  const m = modelText(r)
  return [`  ${name} · ${stateWord(r)} ${ago(now - msOf(r.updatedAt))} · ${contextText(r)}${m ? ` · ${m}` : ''}${commit}`, ...capped, ...recapLine(r)]
}

function recapLine(r: BoardRow): string[] {
  const t = plain(r.recap)
  return t === '' ? [] : [`    recap: ${t}`]
}

/** Local `YYYY-MM-DD HH:MM`. */
export function stamp(ms: number): string {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

export type SnapshotInput = {
  view: BoardView
  /** Row fingerprints at the last snapshot; null: send the full board (a new thread, a reset). */
  seen: Readonly<Record<string, string>> | null
  /** `git log --oneline -10`, or null when git could not be read. */
  log: string | null
  /** docs/studio/notes.md, or null when there is none yet. */
  notes: string | null
  /** The director's own model and effort (stage 4: D7 compares against them); null when unknown. */
  self?: { model: string; effort: string } | null
  /**
   * The ask box's snapshot (stage 6): the chat's own row too, marked "(this chat)",
   * and no director lines. Always full: give `seen: null`.
   */
  forAsk?: boolean
}

/** The fixed policy line each snapshot carries (stage 4): it reaches a director whose role predates auto model (S4). */
export function selfLine(self: { model: string; effort: string } | null | undefined): string {
  const you = self && (self.model || self.effort) ? `${self.model ? prettyModel(self.model) : '?'} ${self.effort || '?'}` : 'unknown'
  return `You: ${you}. Before you start or switch a chat, read docs/studio/model_policy.md, pick its row, model (full id) and effort, and say all three in one line as you start or switch it; ask the user before Fable or an effort above yours (D7). Recall (stage 8): read any <studio-recall> block before you decide; ask studio_section, studio_recall, studio_path or studio_overview before opening big docs; put the rules recall lists into every brief; record decisions with studio_remember. Plan (stage 10): add planned stages with studio_plan. Leads (stage 11): work runs in parallel by part under eleven leads (docs/studio/leads.md); send a part's work to its lead; "one builder at a time" is gone, one game run at a time stays.`
}

/**
 * The snapshot one prompt carries (§5.3) and the fingerprints to keep for the
 * next. The director's own row is left out. Waiting asks are always listed;
 * other rows only when they changed, unless the snapshot is full.
 */
export function snapshotText(s: SnapshotInput): { text: string; seen: Record<string, string> } {
  const { view, log, notes } = s
  const now = view.at
  const isFull = s.seen === null
  const prev = s.seen ?? {}
  const seen: Record<string, string> = {}
  const keep = (rows: readonly BoardRow[]) => (s.forAsk === true ? [...rows] : rows.filter(r => !r.isSelf))
  const pick = (g: BoardGroups): BoardGroups => ({ waiting: keep(g.waiting), working: keep(g.working), recent: keep(g.recent), quiet: keep(g.quiet) })
  const tally = { total: 0, changed: 0 }
  const walk: Walk = { isFull, prev, seen, now, tally }
  const body: string[] = []
  const leads = view.leads ?? null
  if (leads !== null) {
    // Stage 11: the leads first, each with its own chats; then the chats under no lead.
    const lines: string[] = []
    for (const g of leads.leads) {
      const row = g.row !== null && keep([g.row]).length === 1 ? g.row : null
      lines.push(...leadLines({ ...g, row, chats: pick(g.chats) }, walk))
    }
    if (isFull) body.push(`Leads (${leadsLine(leads)}), each with its own chats under it (docs/studio/leads.md)`, ...lines)
    else if (lines.length > 0) body.push('Leads: changed or waiting', ...lines)
    const rest = pick(leads.rest)
    body.push(isFull ? `Under no lead (${countOf(rest)})` : 'Under no lead', ...groupLines(rest, walk, '  '))
  } else {
    body.push(...groupLines(pick(view.groups), walk, ''))
  }
  const { total, changed } = tally
  const gone = isFull ? [] : Object.keys(prev).filter(id => seen[id] === undefined)
  const out: string[] = [
    `<studio-snapshot kind="${isFull ? 'full' : 'changes'}" at="${stamp(now)}">`,
    s.forAsk === true
      ? `The board: every Scrapshift chat (${total}); the one marked "(this chat)" is where this pane is open. Ids in brackets are app session ids.`
      : isFull
      ? `The board: every Scrapshift chat but this one (${total}). Ids in brackets are app session ids: link [title](#id).`
      : `Board changes since the last snapshot: ${changed} of ${total} chats changed${gone.length > 0 ? `, ${gone.length} gone` : ''}. Waiting asks are always listed.`,
    '',
    ...body,
  ]
  if (gone.length > 0) out.push('Gone (archived or deleted)', ...gone.map(id => `  [${id}]`))
  if (!isFull && changed === 0 && gone.length === 0) out.push('No other board changes.')
  out.push('', ...(s.forAsk === true ? [] : [selfLine(s.self)]), usageLine(view.header), gitLine(view.header), 'Last 10 commits:')
  out.push(...(log === null ? ['  (git could not be read)'] : log.trim().split(/\r?\n/).filter(l => l.trim() !== '').map(l => `  ${l.trim()}`)))
  out.push('', 'docs/studio/notes.md:')
  out.push(notes === null || notes.trim() === '' ? '  (no notes yet)' : notes.trimEnd())
  out.push('</studio-snapshot>')
  return { text: out.join('\n'), seen }
}

type Walk = {
  isFull: boolean
  prev: Readonly<Record<string, string>>
  /** Filled with every walked row's fingerprint. */
  seen: Record<string, string>
  now: number
  /** Counted as rows are walked. */
  tally: { total: number; changed: number }
}

/** Records a row's fingerprint; true when it changed since the last snapshot. */
function mark(r: BoardRow, w: Walk): boolean {
  w.tally.total++
  const fp = fingerprint(r)
  w.seen[r.id] = fp
  const isChanged = w.prev[r.id] !== fp
  if (isChanged) w.tally.changed++
  return isChanged
}

/** The four groups as the snapshot lists them: every row when full, else the waits and the rows that changed. */
function groupLines(g: BoardGroups, w: Walk, indent: string): string[] {
  const body: string[] = []
  for (const k of GROUPS) {
    const shown: string[] = []
    for (const r of g[k]) if (mark(r, w) || w.isFull || k === 'waiting') shown.push(...rowLines(r, k, w.now))
    if (w.isFull || k === 'waiting') body.push(`${HEADINGS[k]} (${g[k].length})`, ...(shown.length > 0 ? shown : ['  none']))
    else if (shown.length > 0) body.push(`${HEADINGS[k]}: changed`, ...shown)
  }
  return body.map(l => `${indent}${l}`)
}

const GROUPS: readonly Group[] = ['waiting', 'working', 'recent', 'quiet']

const groupOfRow = (r: BoardRow, now: number): Group =>
  r.state === 'waiting-you' ? 'waiting' : r.state === 'working' && !r.isStalled ? 'working' : now - msOf(r.updatedAt) <= RECENT_MS ? 'recent' : 'quiet'

/**
 * One lead in the snapshot: its own row, a count of its chats, then the chats
 * (waits with their asks, working, idle ones one line each). In a "changes"
 * snapshot a lead is listed only when its row or a chat changed or waits, with
 * only those rows.
 */
function leadLines(g: LeadGroup, w: Walk): string[] {
  const head = g.row
  const isHeadChanged = head !== null && mark(head, w)
  const kids: string[] = []
  for (const k of GROUPS) {
    for (const r of g.chats[k]) {
      const isChanged = mark(r, w)
      if (w.isFull || isChanged || k === 'waiting') kids.push(...rowLines(r, k, w.now).map(l => `    ${l}`))
    }
  }
  const isHeadShown = w.isFull || isHeadChanged || head?.state === 'waiting-you'
  if (!w.isFull && !isHeadShown && kids.length === 0) return []
  const name = `  ${g.lead.name}${g.lead.slug ? ` (${g.lead.slug})` : ''}`
  const out: string[] = []
  if (head === null) out.push(`${name} [${g.lead.id}] · no report yet`)
  else if (isHeadShown) out.push(...rowLines(head, groupOfRow(head, w.now), w.now).map((l, i) => (i === 0 ? `${name}: ${l.trim()}` : `  ${l}`)))
  else out.push(`${name} [${g.lead.id}] · unchanged`)
  out.push(`    its ${chatsLine(g.chats)}`, ...kids)
  return out
}

/**
 * A lead chat's own snapshot (stage 11, §5.14): only its own chats, full the
 * first time in a thread, then the waits and the changes. No notes, git or usage.
 */
export function leadSnapshotText(g: LeadGroup, at: number, prevSeen: Readonly<Record<string, string>> | null): { text: string; seen: Record<string, string> } {
  const isFull = prevSeen === null
  const prev = prevSeen ?? {}
  const seen: Record<string, string> = {}
  const tally = { total: 0, changed: 0 }
  const body = groupLines(g.chats, { isFull, prev, seen, now: at, tally }, '')
  const gone = isFull ? [] : Object.keys(prev).filter(id => seen[id] === undefined)
  const out = [
    `<studio-lead-snapshot kind="${isFull ? 'full' : 'changes'}" at="${stamp(at)}" lead="${g.lead.name}">`,
    isFull
      ? `Your chats as the lead for ${g.lead.name} (${tally.total}): the ones you started, the ones they started, and the ones docs/studio/leads.md section 8 gives you. Ids in brackets are app session ids: link [title](#id), message with SendMessage.`
      : `Changes in your chats since the last snapshot: ${tally.changed} of ${tally.total} changed${gone.length > 0 ? `, ${gone.length} gone` : ''}. Waiting asks are always listed.`,
    '',
    ...body,
  ]
  if (gone.length > 0) out.push('Gone (archived, deleted or now under another lead)', ...gone.map(id => `  [${id}]`))
  if (!isFull && tally.changed === 0 && gone.length === 0) out.push('No other changes.')
  out.push('</studio-lead-snapshot>')
  return { text: out.join('\n'), seen }
}

// ---------------------------------------------------------------- notes

export const NOTES_SEED = `# Studio notes

The director's rolling notes (docs/STUDIO_DIRECTOR.md §5.3): decisions, the director's own open
threads, what's next. One line each, oldest first: \`- YYYY-MM-DD HH:MM: text\`. Past ${NOTES_MAX}
lines the mod moves the oldest to notes_archive.md. Lasting decisions also go where they belong:
status entries, design docs, memory.

`

export const ARCHIVE_SEED = `# Studio notes archive

Older lines of notes.md, moved here by the studio mod once notes.md passes ${NOTES_MAX} lines.

`

const isNote = (line: string) => /^\s*[-*] /.test(line)

/** The notes with one line added. */
export function addNote(notes: string | null, text: string, at: number): string {
  const body = (notes === null || notes.trim() === '' ? NOTES_SEED : notes).replace(/\r\n/g, '\n')
  const line = `- ${stamp(at)}: ${text.replace(/\s+/g, ' ').trim()}`
  return `${body.replace(/\n*$/, '\n')}${isNote(body.trimEnd().split('\n').at(-1) ?? '') ? '' : '\n'}${line}\n`
}

/**
 * Notes past NOTES_MAX note lines: the oldest move out. Returns null when
 * nothing has to move. The header (every line before the first note) stays.
 */
export function capNotes(notes: string, max = NOTES_MAX): { notes: string; moved: string[] } | null {
  const lines = notes.replace(/\r\n/g, '\n').split('\n')
  const idx = lines.map((l, i) => (isNote(l) ? i : -1)).filter(i => i >= 0)
  if (idx.length <= max) return null
  const cut = new Set(idx.slice(0, idx.length - max))
  const moved = lines.filter((_, i) => cut.has(i))
  const kept = lines.filter((_, i) => !cut.has(i))
  return { notes: kept.join('\n'), moved }
}

/** The archive with `moved` appended. */
export function appendArchive(archive: string | null, moved: readonly string[]): string {
  const body = (archive === null || archive.trim() === '' ? ARCHIVE_SEED : archive).replace(/\r\n/g, '\n')
  return `${body.replace(/\n*$/, '\n')}${moved.join('\n')}\n`
}

/** A transcript that already holds a model reply: too late for `/director` (the role would not reach it, S4). */
export function isUsedChat(messages: ReadonlyArray<{ role?: unknown }>): boolean {
  return messages.some(m => m?.role === 'assistant')
}
