export type ChatState = 'working' | 'waiting-you' | 'idle' | 'stopped'

export type Ask = { question: string; buttons: string[] }

export type Commit = { hash: string; subject: string; at: string }

/** One subagent routing by the turn layer (stage 4, §5.9). */
export type Routing = {
  /** ISO time of the spawn. */
  at: string
  /** The agent type (`general-purpose`, `Explore`, …). */
  agentType: string
  /** The Agent call's model as given; null: none asked. */
  asked: string | null
  /** The model the turn layer sent (a full id); null: left to the agent's default. */
  sent: string | null
  /** The model the subagent runs on, as the engine resolved it. */
  ranOn: string
  /** The rules that fired. */
  why: string
  /** A floor wanted more than the chat runs on. */
  isCapped: boolean
}

/** One chat's report: docs/studio/sessions/<appId or cli-<cliId>>.json. Keys always in this order. */
export type Report = {
  /** 2 since stage 4 (turnClass, routings); a schema 1 file still reads. */
  schema: 1 | 2
  /** The app's session id (local_…); null for a chat outside the desktop app. */
  appId: string | null
  /** The engine's session id; a /clear changes it. */
  cliId: string
  title: string
  tag: string | null
  tagSource: 'title' | 'manual' | null
  state: ChatState
  /** ISO time the state last changed. */
  stateSince: string
  /** ISO time of the last write. */
  updatedAt: string
  turns: number
  recap: string
  ask: Ask | null
  lastCommit: Commit | null
  context: { tokens: number; pct: number } | null
  model: string
  effort: string
  /** The class of the chat's last prompt (stage 4): chore, build, hard, design-3d, risky; null when none. */
  turnClass: string | null
  /** How long the classifier took for it, in ms; null when it failed, named no class or passed 10 s. */
  classMs: number | null
  /** The last subagent routings, oldest first (stage 4). */
  routings: Routing[]
  cwd: string
}

/** One chat as the board shows it (stage 2). */
export type BoardRow = {
  /** The app id, or cli-<cliId>. */
  id: string
  tag: string | null
  title: string
  state: ChatState
  /** ISO: when the state began (a wait's start). */
  since: string
  /** ISO: the report's last write. */
  updatedAt: string
  ask: Ask | null
  recap: string
  lastCommit: Commit | null
  context: { tokens: number; pct: number } | null
  /** A `working` row with no write for over 2 h: the chat likely died mid-turn. */
  isStalled: boolean
  /** Context at or over the fresh-chat line (400k tokens). */
  isFresh: boolean
  /** The chat drawing the board. */
  isSelf: boolean
  /** An app chat of this project that has written no report yet (it hasn't run a turn since the reporter): from `list_sessions`. */
  isUnreported: boolean
  /** The chat's model id and effort ('' when unknown). */
  model: string
  effort: string
  /** The class of its last prompt (stage 4), or null. */
  turnClass: string | null
  /** Its last routing had a floor capped by the chat's model (stage 4). */
  isCapped: boolean
}

/** One row of the app's `list_sessions`. */
export type AppSession = {
  id: string
  title: string
  cwd: string
  isRunning: boolean
  lastActivityAt: string
  /** The chat that started this one (a linked session), or null (stage 11). */
  startedBy?: string | null
}

/** One lead of docs/studio/leads.md (stage 11): its part's name, slug, chat id and the chats §8 gives it. */
export type Lead = { name: string; slug: string | null; id: string; adopted: string[] }

/** A lead on the board: its own row (null: no report and not listed) and its chats in the four groups. */
export type LeadGroup = { lead: Lead; row: BoardRow | null; chats: BoardGroups }

/** The board by lead (stage 11): the leads, waiting first, then working, then the rest; then the chats under no lead. */
export type LeadBoard = { leads: LeadGroup[]; rest: BoardGroups }

export type BoardGroups = { waiting: BoardRow[]; working: BoardRow[]; recent: BoardRow[]; quiet: BoardRow[] }

export type UsageWindow = { label: string; pct: number; resetsIn: string }

export type BoardHeader = {
  /** `get_usage`'s plan windows; null when unreadable, [] where no plan limits apply. */
  usage: UsageWindow[] | null
  /** `git status` entries outside docs/studio/ (a new folder is one entry); null when git could not be read. */
  uncommitted: { changed: number; untracked: number } | null
  lastCommit: Commit | null
}

export type BoardView = {
  at: number
  header: BoardHeader
  groups: BoardGroups
  /** The same rows by lead (stage 11); absent or null without docs/studio/leads.md. */
  leads?: LeadBoard | null
}

/** This chat is the Studio director (stage 3): set by `/director`. */
export type DirectorMark = { since: string }

/** The board as the director's last snapshot saw it: row fingerprints, for the next snapshot's changes. */
export type SnapshotSeen = { cliId: string; seen: Record<string, string> }

/** A decision the director took with no note written yet (stage 5's notes check). */
export type NoteOwed = { why: string; since: string }

/** The director chat's last reset (stage 5). */
export type ResetRecord = {
  /** ISO time it was queued. */
  at: string
  kind: 'size' | 'idle'
  method: 'clear' | 'compact'
  tokensBefore: number | null
  tokensAfter: number | null
}

/**
 * The director's thread at a reset (§5.5, the carry-over; user, 2026-11-18): its last
 * requests and the end of its last reply, handed to the first prompt after the reset,
 * so work spread over several prompts carries on.
 */
export type Carry = {
  /** ISO time of the reset. */
  at: string
  kind: 'size' | 'idle'
  /** The user's last prompts to the director, oldest first (a pane press counts). */
  asks: string[]
  /** The end of the director's last reply. */
  reply: string
  /** Its last wrap-up recap, or ''. */
  recap: string
}

/** One question and answer in the board pane's ask box (stage 6). */
export type AskTurn = {
  /** The question as sent. */
  q: string
  /** The answer, or why there is none. */
  a: string
  /** Epoch ms the board was read for it. */
  at: number
  /** False: `a` says why there is no answer (it is not sent with a follow-up). */
  ok: boolean
  tokensIn: number | null
  tokensOut: number | null
}

/** The ask box's state (stage 6): the last turns, and the question on its way. */
export type AskLog = {
  turns: AskTurn[]
  pending: { q: string; since: number } | null
  /** Counts questions sent: the field's key, so it comes back empty after each. */
  seq: number
}

/** A kanban column (stage 7). */
export type Column = 'planned' | 'building' | 'waiting' | 'review' | 'done'

/** One kanban card on disk: docs/studio/cards/<id>.json. A hand-made card, or a chat pinned to a column. Keys always in this order. */
export type CardFile = {
  schema: 1
  id: string
  title: string
  /** The chat this card stands for (its board row id); null for a card added by hand. */
  rowId: string | null
  /** The column it is pinned to; null: the chat's own state decides. */
  pin: Column | null
  createdAt: string
  updatedAt: string
  /** The milestone code a planned stage sits under on the plan map (stage 10); absent on older cards. */
  under?: string | null
}

export type PaneTab = 'board' | 'kanban' | 'notes' | 'models' | 'ask' | 'map'

export type BoardFilter = 'all' | 'needs-me' | 'working' | 'fresh'

/** What the pane shows (stage 7): its tab, its board filter, what is unfolded, where the Ask field sends. */
export type PaneUi = {
  tab: PaneTab
  filter: BoardFilter
  /** The Board tab by lead (stage 11) or by state (stages 2-10). */
  boardBy: 'lead' | 'state'
  /** Leads whose idle chats are unfolded. */
  openLeads: string[]
  /** Board row ids whose recap is shown whole. */
  openRecaps: string[]
  /** The board's Recent group shows every chat, not only its newest few. */
  allRecent: boolean
  /** Kanban columns unfolded in a narrow pane. */
  openColumns: Column[]
  /** The director chat's Ask field: the chat itself (a turn, every tool) or the quick board-only ask. */
  askMode: 'director' | 'quick'
  /** Counts cards and notes added from the pane: the fields' keys, so they come back empty. */
  seq: number
  /** The prompt the pane last sent to the director chat and when (epoch ms), until its turn ends; null when none is on its way. */
  sent: { text: string; at: number } | null
  /** The Map tab's focus (stage 9): a graph node id, or 'home' (the clusters). */
  mapFocus: string
  /** The nodes the Map tab moved through, oldest first: its breadcrumb and Back. */
  mapTrail: string[]
  /** Where map.html was last written, or null. */
  mapFile: string | null
  /** The Map tab's view (stage 10): the plan (milestones and their stages) or the memory graph. */
  mapMode: 'plan' | 'memory'
  /** The plan's focus: 'home' or a milestone code. */
  planFocus: string
  /** The stage picked on the plan (its key), or null. */
  planPick: string | null
}

/** What the pane reads beside the board (stage 7): the notes' last lines, the kanban's card files, and the app ids of the director chats (the mod's store). */
export type PaneExtras = { notes: string[]; cards: CardFile[]; directors: string[] }

declare module 'claude-code' {
  interface PluginState {
    studio: {
      /** The last report written, so a reload carries on from it. */
      report: Report | null
      /** A tag set with /studio tag; wins over the title's. */
      manualTag: string | null
      /** /studio allow-commit: epoch ms until which one docs/studio/ commit may pass. */
      allowCommitUntil: number
      /** The board as last read (stage 2); the pane draws from it. */
      board: Shaped<BoardView | null>
      /** The board pane was opened in this chat and not closed by hand: reopen it on attach. */
      boardOpen: boolean
      /** The Quiet group is unfolded. */
      quietOpen: boolean
      /** This chat is the director (stage 3); null in every other chat. */
      director: DirectorMark | null
      /** What the last snapshot sent (stage 3); null: the next one is full. */
      snapSeen: SnapshotSeen | null
      /** What a lead chat's own snapshot last sent (stage 11); null: the next one is full. */
      leadSnapSeen: SnapshotSeen | null
      /** The notes check (stage 5): a note owed before the next reset; null when none. */
      noteOwed: NoteOwed | null
      /** The director chat's last reset (stage 5); null before the first. */
      lastReset: ResetRecord | null
      /** The thread at the last reset, until the first prompt after it carries it; null otherwise. */
      carry: Shaped<Carry | null>
      /** The board pane's ask box (stage 6): its last turns, kept for follow-ups. */
      askLog: Shaped<AskLog>
      /** The pane's tab, filter and folds (stage 7). */
      paneUi: Shaped<PaneUi>
      /** The notes' tail and the kanban's cards as last read (stage 7). */
      paneExtras: Shaped<PaneExtras>
      /** `/director` was typed in a used chat: its output row offers the clear-and-become button (stage 7). */
      directorOffer: boolean
    }
  }
}
