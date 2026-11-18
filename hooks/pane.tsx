// Studio Director, stage 7: what the pane draws (docs/STUDIO_DIRECTOR.md §5.2, §5.10).
// Trees only: plain values and handlers in, a tree out. No engine calls, no state:
// register.tsx reads the state, hands it over as a PaneModel, and owns every handler.
import type { Elements } from 'claude-code'

import type { AskLog, BoardRow, BoardView, Column, LeadGroup, PaneExtras, PaneTab, PaneUi, Routing } from '../types'
import { turnLine } from './ask'
import { CAPPED_LINE, ago, clip, contextText, msOf, plain, quietLine, rowName, tokens, usageLine } from './board'
import {
  COLUMNS,
  COLUMN_TITLES,
  DONE_SHOWN,
  FILTERS,
  NARROW_COLUMNS,
  RECENT_SHOWN,
  WIDE_COLUMNS,
  cardAge,
  cardFacts,
  filterGroups,
  gitFacts,
  glance,
  kanban,
  modelGroups,
  recapLines,
  shift,
  usageBars,
} from './cards'
import type { KanbanItem } from './cards'
import { chatsLine, filterLeads, leadsLine } from './leads'
import { stamp } from './director'
import { prettyModel } from './route'
import type { MapView } from './map'
import { STATE_WORD } from './plan'
import type { PlanItem, PlanState, PlanView } from './plan'

/** The elements every surface here draws, typed alike on each. */
export type Ui = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button' | 'Input' | 'Select' | 'Markdown' | 'Progress'>

export const TABS: ReadonlyArray<{ value: PaneTab; label: string }> = [
  { value: 'board', label: 'Board' },
  { value: 'kanban', label: 'Kanban' },
  { value: 'notes', label: 'Notes' },
  { value: 'models', label: 'Models' },
  { value: 'ask', label: 'Ask' },
  { value: 'map', label: 'Map' },
]

/** The desktop's vector leaf; the terminal has none (the map draws as text there). */
export type SvgEl = Elements['desktop']['Svg']

/** What the Map tab draws (stage 9), worked out in register.tsx from the memory graph. */
export type MapPane = {
  focus: string
  view: MapView
  svg: { source: string; width: number; height: number; alt: string }
  /** The reminder card beside the map (a wide pane), or under it. */
  isSide: boolean
  /** The breadcrumb: home first, then the trail. */
  crumbs: Array<{ id: string; label: string }>
  /** The buttons under the map. */
  moves: Array<{ id: string; label: string }>
  jump: Array<{ value: string; label: string }>
  /** What the director is reminded of for the focus, short: one line per kind (the sketch). */
  brief: string[]
  /** More names are linked than the buttons show (a "more" button opens the full map). */
  hasMore: boolean
  /** One line on the graph (its size, how sure its links are). */
  graphLine: string
  /** Where map.html was last written, or null. */
  file: string | null
}

/** What the Map tab's Plan view draws (stage 10), worked out in register.tsx from the board, the cards and the plan's milestones. */
export type PlanPane = {
  view: PlanView
  svg: { source: string; width: number; height: number; alt: string }
  isSide: boolean
  /** Scrapshift, then the milestone, then the picked stage (`pick`: a press picks it). */
  crumbs: Array<{ id: string; label: string; pick?: boolean }>
  /** The buttons under the map: milestones at home, a milestone's stages in its view. */
  moves: Array<{ id: string; label: string }>
  jump: Array<{ value: string; label: string }>
  /** The card beside the map: where things stand (home), or what the director recalls for the milestone. */
  side: string[]
  /** The milestone's name, in its view. */
  milestone: string | null
  picked: PlanItem | null
  /** The picked stage's chat, for Answer and Brief me. */
  pickedRow: BoardRow | null
}

export type PaneModel = {
  view: BoardView
  /** Cells across the pane's body. */
  w: number
  isDirector: boolean
  /** The director chat's row, when another chat is the director (by its tag, or by the app ids the mod's store holds). */
  director: BoardRow | null
  /** This chat is unused and not the director: it may become one from the pane. */
  canBecome: boolean
  ui: PaneUi
  ask: AskLog
  extras: PaneExtras
  isQuietOpen: boolean
  /** This chat's own context in tokens, and its last subagent routings. */
  selfTokens: number | null
  routings: readonly Routing[]
  /** What the director chat is answering now (director chat only): the pane sends nothing more until it is null. */
  busy: string | null
  /** A note the director owes (stage 5), or null. */
  owed: string | null
  /** The director's reset line in tokens. */
  resetTokens: number
  /** The Map tab (stage 9); null while the graph is being built. */
  map: MapPane | null
  /** The Map tab's Plan view (stage 10); null while the graph is being built. */
  plan: PlanPane | null
}

/** Each handler may hand back its work's promise, so a caller that waits (a test) sees it settle. */
export type PaneActions = {
  tab: (t: PaneTab) => unknown
  filter: (value: string) => unknown
  /** The Board tab by lead or by state (stage 11). */
  boardBy: (by: 'lead' | 'state') => unknown
  /** Unfolds or folds a lead's idle chats. */
  toggleLead: (leadId: string) => unknown
  toggleRecap: (rowId: string) => unknown
  toggleQuiet: () => unknown
  toggleRecent: () => unknown
  toggleColumn: (c: Column) => unknown
  refresh: () => unknown
  ask: (text: string) => unknown
  askCancel: () => unknown
  askClear: () => unknown
  askMode: (value: string) => unknown
  /** Sends a prompt to the director chat itself (director chat only). */
  send: (text: string) => unknown
  brief: (r: BoardRow) => unknown
  answer: (r: BoardRow, label: string) => unknown
  addNote: (text: string) => unknown
  addCard: (text: string) => unknown
  move: (item: KanbanItem, to: Column) => unknown
  become: () => unknown
  /** The Map tab (stage 9): put a node in the middle ('home' for the clusters), step back, write and open map.html. */
  mapGo: (id: string) => unknown
  mapBack: () => unknown
  mapOpen: () => unknown
  /** The Map tab's view (stage 10): the plan or the memory graph. */
  mapMode: (mode: 'plan' | 'memory') => unknown
  /** The plan's focus: 'home' or a milestone code; picking a stage (null: none). */
  planGo: (code: string) => unknown
  planPick: (key: string | null) => unknown
  /** "Start this stage": the director prepares its breakdown for the user's OK. */
  planStart: (item: PlanItem, milestone: string) => unknown
  /** A new planned stage under the milestone in view. */
  planAdd: (text: string) => unknown
  planDone: (item: PlanItem) => unknown
}

type Border = 'warning' | 'success' | 'subtle'

const selfMark = (r: BoardRow) => (r.isSelf ? ' (this chat)' : '')

// ---------------------------------------------------------------- the header

function header(ui: Ui, m: PaneModel, on: PaneActions) {
  const { Box, Text, Button, Progress } = ui
  const head = m.view.header
  const bars = usageBars(head)
  const git = gitFacts(head)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text weight="bold" size="heading">
          Studio board
        </Text>
        <Button key="refresh" plain dimColor onPress={on.refresh}>
          {`read ${stamp(m.view.at).slice(11)} · refresh`}
        </Button>
      </Box>
      {m.isDirector ? <Text color="success">This chat is the Director</Text> : null}
      {m.isDirector && m.busy !== null ? <Progress label="The director is answering" valueText={clip(m.busy, Math.max(12, m.w - 30))} /> : null}
      {!m.isDirector && m.director !== null ? (
        <Text dimColor wrap="truncate-end">{clip(`The Director is "${rowName(m.director)}" · ${cardAge(m.director, m.view.at)}`, m.w)}</Text>
      ) : null}
      {m.canBecome && m.director === null ? (
        <Button key="become" onPress={on.become}>
          Make this chat the Director
        </Button>
      ) : null}
      {bars.length === 0 ? <Text dimColor wrap="truncate-end">{clip(usageLine(head), m.w)}</Text> : null}
      {bars.map(b => (
        <Progress label={b.label} value={b.pct} max={100} valueText={b.valueText} {...(b.tone ? { color: b.tone } : {})} />
      ))}
      {m.isDirector && m.selfTokens !== null ? (
        <Progress
          label="Director context"
          value={m.selfTokens}
          max={m.resetTokens}
          valueText={`${tokens(m.selfTokens)} of ${tokens(m.resetTokens)} (it clears itself past the line)`}
        />
      ) : null}
      <Text dimColor wrap="truncate-end">{clip(git.counts, m.w)}</Text>
      <Text dimColor wrap="truncate-end">{clip(git.last, m.w)}</Text>
    </Box>
  )
}

function tabs(ui: Ui, m: PaneModel, on: PaneActions) {
  const { Box, Button } = ui
  const waits = m.view.groups.waiting.length
  return (
    <Box flexDirection="row" gap={1} flexWrap="wrap">
      {TABS.map(t => (
        <Button key={`tab-${t.value}`} variant={m.ui.tab === t.value ? 'primary' : 'secondary'} onPress={() => on.tab(t.value)}>
          {t.value === 'board' && waits > 0 ? `${t.label} (${waits})` : t.label}
        </Button>
      ))}
    </Box>
  )
}

// ---------------------------------------------------------------- the board

const heading = (ui: Ui, text: string, n: number, color?: 'warning' | 'success') => {
  const { Text } = ui
  return (
    <Text weight="bold" {...(n > 0 && color ? { color } : {})}>
      {`${text} (${n})`}
    </Text>
  )
}

function contextBar(ui: Ui, r: BoardRow) {
  const { Progress } = ui
  if (r.context === null) return null
  return <Progress label="Context" value={r.context.pct} max={100} valueText={contextText(r, false)} {...(r.isFresh ? { color: 'warning' as const } : {})} />
}

/**
 * "Open chat": a link to that chat in the app, the same `#local_…` link the director
 * writes in its answers (user, 2026-11-18: answer a chat there, with no director turn).
 * Only chats the app knows (an app id), never the chat the pane sits in.
 */
export const chatHref = (r: BoardRow): string | null => (r.id.startsWith('local_') && !r.isSelf ? `#${r.id}` : null)

function chatLink(ui: Ui, r: BoardRow, key: string) {
  const { Markdown } = ui
  const href = chatHref(r)
  return href === null ? null : <Markdown key={key} text={`[Open chat](${href})`} />
}

function chatCard(ui: Ui, m: PaneModel, on: PaneActions, r: BoardRow, border: Border) {
  const { Box, Text, Button } = ui
  const now = m.view.at
  const inner = Math.max(16, m.w - 4)
  const isWaiting = r.state === 'waiting-you'
  const age = cardAge(r, now)
  const facts = cardFacts(r)
  const all = recapLines(r.recap, 0)
  const isOpen = m.ui.openRecaps.includes(r.id)
  const lines = isWaiting ? [] : isOpen ? all : all.slice(0, r.state === 'working' ? 1 : 2)
  const buttons = r.ask?.buttons ?? []
  // One send at a time: while the director answers, a card has nothing to press that sends.
  const canSend = m.isDirector && !r.isSelf && m.busy === null
  // A border costs a row above and below on every surface, so a card says each thing once:
  // the name with its state and age beside it, then only the lines this state needs.
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={border} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Text weight="semibold" wrap="truncate-end">
          {clip(`${rowName(r)}${selfMark(r)}`, Math.max(8, inner - age.length - 2))}
        </Text>
        <Text dimColor>{age}</Text>
      </Box>
      {isWaiting ? (
        <Text color="warning" wrap="wrap">
          {r.ask ? plain(r.ask.question) : '(no ask recorded)'}
        </Text>
      ) : null}
      {isWaiting && !canSend && buttons.length > 0 ? <Text dimColor wrap="wrap">{`[${buttons.join(' | ')}]`}</Text> : null}
      {!isWaiting && facts !== '' ? (
        <Text dimColor wrap="wrap">
          {facts}
        </Text>
      ) : null}
      {lines.map(l => (
        <Text dimColor wrap="wrap">
          {l}
        </Text>
      ))}
      {isWaiting ? null : contextBar(ui, r)}
      {r.isFresh && !isWaiting ? <Text color="warning">time for a fresh chat</Text> : null}
      {r.isCapped ? (
        <Text color="warning" wrap="wrap">
          {CAPPED_LINE}
        </Text>
      ) : null}
      {canSend || all.length > lines.length || isOpen || chatHref(r) !== null ? (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {chatLink(ui, r, `open-${r.id}`)}
          {canSend && isWaiting
            ? buttons.map((label, i) => (
                <Button key={`answer-${r.id}-${i}`} onPress={() => on.answer(r, label)}>
                  {`Answer: ${label}`}
                </Button>
              ))
            : null}
          {canSend ? (
            <Button key={`brief-${r.id}`} onPress={() => on.brief(r)}>
              Brief me
            </Button>
          ) : null}
          {!isWaiting && (all.length > lines.length || isOpen) ? (
            <Button key={`recap-${r.id}`} plain dimColor onPress={() => on.toggleRecap(r.id)}>
              {isOpen ? 'less' : 'more'}
            </Button>
          ) : null}
        </Box>
      ) : null}
    </Box>
  )
}

/** A lead's chat as one line under its card: state, name, age (and the ask under a wait). */
function leadChatLine(ui: Ui, m: PaneModel, r: BoardRow) {
  const { Box, Text } = ui
  const isWaiting = r.state === 'waiting-you'
  const word = r.isUnreported ? 'no report' : r.isStalled ? 'stalled' : r.state === 'waiting-you' ? 'waiting' : r.state
  const line = `${word} · ${rowName(r)}${selfMark(r)} · ${cardAge(r, m.view.at)}`
  const color = isWaiting ? ('warning' as const) : r.state === 'working' && !r.isStalled ? ('success' as const) : undefined
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box flexDirection="row" gap={1}>
        <Text {...(color ? { color } : { dimColor: true })} wrap="truncate-end">
          {clip(line, Math.max(12, m.w - 16))}
        </Text>
        {chatLink(ui, r, `lead-open-${r.id}`)}
      </Box>
      {isWaiting && r.ask ? (
        <Text color="warning" wrap="wrap">
          {`  ${plain(r.ask.question)}`}
        </Text>
      ) : null}
    </Box>
  )
}

/** One lead: its own card (as any chat's), then its waiting and working chats, its idle ones folded. */
function leadBlock(ui: Ui, m: PaneModel, on: PaneActions, g: LeadGroup) {
  const { Box, Text, Button } = ui
  const r = g.row
  const border: Border = r?.state === 'waiting-you' ? 'warning' : r?.state === 'working' && !r.isStalled ? 'success' : 'subtle'
  const live = [...g.chats.waiting, ...g.chats.working]
  const idle = [...g.chats.recent, ...g.chats.quiet]
  const isOpen = m.ui.openLeads.includes(g.lead.id)
  return (
    <Box flexDirection="column" gap="xs">
      {r !== null ? (
        chatCard(ui, m, on, r, border)
      ) : (
        <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
          <Text weight="semibold">{g.lead.name}</Text>
          <Text dimColor>no report yet</Text>
        </Box>
      )}
      <Text dimColor>{`  ${g.lead.name}: ${chatsLine(g.chats)}`}</Text>
      {live.map(c => leadChatLine(ui, m, c))}
      {idle.length > 0 ? (
        <Button key={`lead-idle-${g.lead.id}`} plain dimColor onPress={() => on.toggleLead(g.lead.id)}>
          {`  ${isOpen ? '▾' : '▸'} ${idle.length} idle chat${idle.length === 1 ? '' : 's'}`}
        </Button>
      ) : null}
      {isOpen ? idle.map(c => leadChatLine(ui, m, c)) : null}
    </Box>
  )
}

/** The By lead | By state switch (stage 11); null without leads. */
function boardSwitch(ui: Ui, m: PaneModel, on: PaneActions) {
  const { Box, Button } = ui
  if (!m.view.leads) return null
  const by = m.ui.boardBy ?? 'lead'
  return (
    <Box flexDirection="row" gap={1}>
      <Button key="by-lead" variant={by === 'lead' ? 'primary' : 'secondary'} onPress={() => on.boardBy('lead')}>
        By lead
      </Button>
      <Button key="by-state" variant={by === 'state' ? 'primary' : 'secondary'} onPress={() => on.boardBy('state')}>
        By state
      </Button>
    </Box>
  )
}

function boardTab(ui: Ui, m: PaneModel, on: PaneActions) {
  const { Box, Text, Select } = ui
  const leads = m.view.leads ?? null
  if (leads === null || (m.ui.boardBy ?? 'lead') === 'state') return stateBoard(ui, m, on, m.view.groups, null)
  const b = filterLeads(leads, m.ui.filter, filterGroups)
  return (
    <Box flexDirection="column" gap="xs">
      {boardSwitch(ui, m, on)}
      <Select key="filter" label="Show" options={FILTERS} value={m.ui.filter} onSelect={on.filter} />
      <Text weight="bold" {...(b.leads.some(g => g.row?.state === 'waiting-you') ? { color: 'warning' as const } : {})}>
        {`Leads (${leadsLine(leads)})`}
      </Text>
      {b.leads.length === 0 ? <Text dimColor>  none</Text> : null}
      {b.leads.map(g => leadBlock(ui, m, on, g))}
      <Text weight="bold">{`Under no lead (${b.rest.waiting.length + b.rest.working.length + b.rest.recent.length + b.rest.quiet.length})`}</Text>
      {stateBoard(ui, m, on, b.rest, 'rest')}
    </Box>
  )
}

/**
 * The board by state (stages 2-10): waiting, working, recent, quiet. `groups` is
 * the whole board, or the chats under no lead (`part` 'rest', drawn under the
 * leads with no switch or filter of its own).
 */
function stateBoard(ui: Ui, m: PaneModel, on: PaneActions, groups: BoardView['groups'], part: 'rest' | null) {
  const { Box, Text, Button, Select } = ui
  const g = part === 'rest' ? groups : filterGroups(groups, m.ui.filter)
  const now = m.view.at
  const none = (n: number) => (n === 0 ? <Text dimColor>  none</Text> : null)
  const recent = m.ui.allRecent ? g.recent : g.recent.slice(0, RECENT_SHOWN)
  return (
    <Box flexDirection="column" gap="xs">
      {part === null ? boardSwitch(ui, m, on) : null}
      {part === null ? <Select key="filter" label="Show" options={FILTERS} value={m.ui.filter} onSelect={on.filter} /> : null}
      <Box flexDirection="column" gap="xs">
        {heading(ui, 'Waiting on you', g.waiting.length, 'warning')}
        {none(g.waiting.length)}
        {g.waiting.map(r => chatCard(ui, m, on, r, 'warning'))}
      </Box>
      <Box flexDirection="column" gap="xs">
        {heading(ui, 'Working now', g.working.length, 'success')}
        {none(g.working.length)}
        {g.working.map(r => chatCard(ui, m, on, r, 'success'))}
      </Box>
      <Box flexDirection="column" gap="xs">
        {heading(ui, 'Recent, last 72 h', g.recent.length)}
        {none(g.recent.length)}
        {recent.map(r =>
          r.isUnreported ? (
            <Text dimColor wrap="truncate-end">
              {clip(quietLine(r, now), m.w)}
            </Text>
          ) : (
            chatCard(ui, m, on, r, 'subtle')
          ),
        )}
      </Box>
      {g.recent.length > RECENT_SHOWN ? (
        <Button key="recent-more" plain onPress={on.toggleRecent}>
          {m.ui.allRecent ? '▾ Show the newest only' : `▸ ${g.recent.length - RECENT_SHOWN} older`}
        </Button>
      ) : null}
      <Button key="quiet" plain onPress={on.toggleQuiet}>
        {`${m.isQuietOpen ? '▾' : '▸'} Quiet (${g.quiet.length})`}
      </Button>
      {m.isQuietOpen
        ? g.quiet.map(r => (
            <Text dimColor wrap="truncate-end">
              {clip(quietLine(r, now), m.w)}
            </Text>
          ))
        : null}
    </Box>
  )
}

// ---------------------------------------------------------------- the kanban

const COLUMN_BORDER: Record<Column, Border> = { planned: 'subtle', building: 'success', waiting: 'warning', review: 'subtle', done: 'subtle' }

function kanbanCard(ui: Ui, on: PaneActions, item: KanbanItem) {
  const { Box, Text, Button } = ui
  const left = shift(item.column, -1)
  const right = shift(item.column, 1)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLUMN_BORDER[item.column]} paddingX={1}>
      <Text wrap="wrap">{item.title}</Text>
      {item.fact !== '' ? (
        <Text dimColor wrap="wrap">
          {item.fact}
        </Text>
      ) : null}
      {item.isLive ? null : (
        <Box flexDirection="row" gap={1}>
          {left !== null ? (
            <Button key={`kb-left-${item.key}`} plain dimColor onPress={() => on.move(item, left)}>
              ←
            </Button>
          ) : null}
          {right !== null ? (
            <Button key={`kb-right-${item.key}`} plain dimColor onPress={() => on.move(item, right)}>
              →
            </Button>
          ) : null}
          {item.column !== 'done' ? (
            <Button key={`kb-done-${item.key}`} plain dimColor onPress={() => on.move(item, 'done')}>
              done
            </Button>
          ) : null}
        </Box>
      )}
    </Box>
  )
}

function kanbanTab(ui: Ui, m: PaneModel, on: PaneActions) {
  const { Box, Text, Button, Input } = ui
  const k = kanban(m.view, m.extras.cards)
  const isWide = m.w >= WIDE_COLUMNS
  const side = isWide ? COLUMNS : NARROW_COLUMNS
  const folded = isWide ? [] : COLUMNS.filter(c => !NARROW_COLUMNS.includes(c))
  const colW = Math.max(12, Math.floor((m.w - (side.length - 1)) / side.length))
  const shown = (c: Column) => (c === 'done' ? k[c].slice(0, DONE_SHOWN) : k[c])
  const more = (c: Column) => (c === 'done' && k[c].length > DONE_SHOWN ? <Text dimColor>{`${k[c].length - DONE_SHOWN} more`}</Text> : null)
  const title = (c: Column) => (
    <Text weight="bold" {...(k[c].length > 0 && c === 'waiting' ? { color: 'warning' as const } : k[c].length > 0 && c === 'building' ? { color: 'success' as const } : {})}>
      {`${COLUMN_TITLES[c]} (${k[c].length})`}
    </Text>
  )
  return (
    <Box flexDirection="column" gap="xs">
      <Input key={`card-${m.ui.seq}`} placeholder="Add a card to Planned…" submitLabel="add" onSubmit={on.addCard} />
      <Box flexDirection="row" gap={1}>
        {side.map(c => (
          <Box flexDirection="column" width={colW} gap="xs">
            {title(c)}
            {k[c].length === 0 ? <Text dimColor>none</Text> : null}
            {shown(c).map(item => kanbanCard(ui, on, item))}
            {more(c)}
          </Box>
        ))}
      </Box>
      {folded.map(c => {
        const isOpen = m.ui.openColumns.includes(c)
        return (
          <Box flexDirection="column" gap="xs">
            <Button key={`kb-fold-${c}`} plain onPress={() => on.toggleColumn(c)}>
              {`${isOpen ? '▾' : '▸'} ${COLUMN_TITLES[c]} (${k[c].length})`}
            </Button>
            {isOpen ? shown(c).map(item => kanbanCard(ui, on, item)) : null}
            {isOpen ? more(c) : null}
          </Box>
        )
      })}
      <Text dimColor wrap="wrap">
        A working or waiting chat holds its own column. Move the others with ← → and done.
      </Text>
    </Box>
  )
}

// ---------------------------------------------------------------- notes, models, ask

function notesTab(ui: Ui, m: PaneModel, on: PaneActions) {
  const { Box, Text, Input, Markdown } = ui
  return (
    <Box flexDirection="column">
      <Text weight="bold">Director's notes</Text>
      {m.owed !== null ? (
        <Text color="warning" wrap="wrap">
          {`A note is owed: ${m.owed}`}
        </Text>
      ) : null}
      {m.extras.notes.length === 0 ? <Text dimColor>No notes yet.</Text> : <Markdown text={m.extras.notes.join('\n')} />}
      <Input key={`note-${m.ui.seq}`} placeholder="Add a note…" submitLabel="note" onSubmit={on.addNote} />
      <Text dimColor wrap="wrap">
        docs/studio/notes.md, its last 15 lines. The director reads it with every prompt.
      </Text>
    </Box>
  )
}

function modelsTab(ui: Ui, m: PaneModel) {
  const { Box, Text } = ui
  const groups = modelGroups(m.view.groups)
  return (
    <Box flexDirection="column" gap="xs">
      {groups.length === 0 ? <Text dimColor>No chat has reported its model yet.</Text> : null}
      {groups.map(grp => (
        <Box flexDirection="column">
          <Text weight="bold">{`${grp.model} (${grp.rows.length})`}</Text>
          {grp.rows.map(l => (
            <Box flexDirection="column">
              <Box flexDirection="row" justifyContent="space-between" gap={1}>
                <Text wrap="truncate-end">{clip(l.name, Math.max(8, m.w - l.facts.length - 2))}</Text>
                <Text dimColor>{l.facts}</Text>
              </Box>
              {l.isCapped ? (
                <Text color="warning" wrap="wrap">
                  {`  ${CAPPED_LINE}`}
                </Text>
              ) : null}
            </Box>
          ))}
        </Box>
      ))}
      <Box flexDirection="column">
        <Text weight="bold">{`This chat's subagents (${m.routings.length})`}</Text>
        {m.routings.length === 0 ? <Text dimColor>  none routed yet</Text> : null}
        {m.routings.map(x => (
          <Text dimColor wrap="wrap">
            {`  ${x.agentType}: ${x.ranOn ? prettyModel(x.ranOn) : '?'} · ${x.why}`}
          </Text>
        ))}
      </Box>
      <Text dimColor wrap="wrap">
        The policy is docs/studio/model_policy.md.
      </Text>
    </Box>
  )
}

function askTab(ui: Ui, m: PaneModel, on: PaneActions) {
  const { Box, Text, Button, Input, Select, Markdown } = ui
  const ask = m.ask
  const toDirector = m.isDirector && m.ui.askMode === 'director'
  const turns = [...ask.turns].reverse()
  const line = (text: string) => clip(text, m.w)
  return (
    <Box flexDirection="column">
      <Text weight="bold">{toDirector ? 'Message the Director' : 'Ask the board'}</Text>
      {m.isDirector ? (
        <Select
          key="ask-mode"
          label="Send to"
          options={[
            { value: 'director', label: 'This chat (a turn, every tool)' },
            { value: 'quick', label: 'Quick ask (board only, no turn)' },
          ]}
          value={m.ui.askMode}
          onSelect={on.askMode}
        />
      ) : null}
      {toDirector && m.busy !== null ? (
        <Text dimColor wrap="wrap">
          {`The director is answering: ${m.busy}. The field comes back when it has.`}
        </Text>
      ) : toDirector ? (
        <Input key={`send-${m.ui.seq}`} placeholder="Message the Director…" submitLabel="send" onSubmit={on.send} />
      ) : ask.pending === null ? (
        <Input key={`ask-${ask.seq}`} placeholder={ask.turns.some(t => t.ok) ? 'Ask, or follow up…' : "What's waiting on me?"} submitLabel="ask" onSubmit={on.ask} />
      ) : (
        <Box flexDirection="column">
          <Text wrap="truncate-end">{line(`> ${ask.pending.q}`)}</Text>
          <Text dimColor>Reading the board and asking…</Text>
          <Button key="ask-cancel" plain onPress={on.askCancel}>
            Cancel
          </Button>
        </Box>
      )}
      {toDirector ? (
        <Text dimColor wrap="wrap">
          It goes to this chat with a fresh board snapshot. The director answers in the conversation.
        </Text>
      ) : null}
      {ask.pending === null
        ? turns.map(t => (
            <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
              <Text weight="bold" wrap="truncate-end">
                {clip(`> ${t.q}`, Math.max(16, m.w - 4))}
              </Text>
              {t.ok ? <Markdown text={t.a} /> : <Text color="warning">{t.a}</Text>}
              <Text dimColor wrap="truncate-end">
                {clip(turnLine(t), Math.max(16, m.w - 4))}
              </Text>
            </Box>
          ))
        : null}
      {ask.pending === null && ask.turns.length > 0 ? (
        <Button key="ask-clear" plain onPress={on.askClear}>
          Clear
        </Button>
      ) : null}
      {toDirector ? null : (
        <Text dimColor wrap="wrap">
          Answered from the board alone: no tools, no turn. What needs files or actions goes to the Director chat.
        </Text>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------- the map (stage 9)

/**
 * The Map tab, as the approved sketch drew it (2026-11-16): the breadcrumb with
 * the jump picker and "Open the full map" on its row; the mind map in a card
 * (an Svg, which takes hover but not clicks) with the buttons that move the
 * focus under it; beside it, a short card of what the director is reminded of.
 */
/** The Map tab: the Plan view (stage 10, first) or the memory graph (stage 9), with a switch on top. */
function mapTab(ui: Ui, m: PaneModel, on: PaneActions, Svg: SvgEl | null) {
  const { Box, Button } = ui
  const isPlan = m.ui.mapMode === 'plan'
  return (
    <Box flexDirection="column" gap="xs">
      <Box flexDirection="row" gap="xs">
        <Button key="map-mode-plan" variant={isPlan ? 'primary' : 'secondary'} onPress={() => on.mapMode('plan')}>
          Plan
        </Button>
        <Button key="map-mode-memory" variant={isPlan ? 'secondary' : 'primary'} onPress={() => on.mapMode('memory')}>
          Memory
        </Button>
      </Box>
      {isPlan ? planBody(ui, m, on, Svg) : memoryBody(ui, m, on, Svg)}
    </Box>
  )
}

function memoryBody(ui: Ui, m: PaneModel, on: PaneActions, Svg: SvgEl | null) {
  const { Box, Text, Button, Select } = ui
  const map = m.map
  if (map === null) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Building the memory graph from the files…</Text>
        <Button key="map-retry" onPress={() => on.mapGo(m.ui.mapFocus)}>
          Show the map
        </Button>
      </Box>
    )
  }
  const drawing =
    Svg !== null ? (
      // At its own size: left to the slot, the interactive frame drew it as a thumbnail (the user's shot, 2026-11-16).
      <Svg source={map.svg.source} alt={map.svg.alt} width={map.svg.width} height={map.svg.height} isInteractive />
    ) : (
      <Box flexDirection="column">
        <Text weight="bold">{map.view.label}</Text>
        {map.view.branches.map(b => (
          <Text wrap="wrap">{`${b.side === 'left' ? '◂' : '▸'} ${b.label} (${b.total}): ${b.items.map(i => i.label).join(' · ')}`}</Text>
        ))}
      </Box>
    )
  const nav = (
    <Box flexDirection="row" gap={1} flexWrap="wrap">
      {m.ui.mapTrail.length > 0 ? (
        <Button key="map-back" onPress={on.mapBack}>
          ← Back
        </Button>
      ) : null}
      {map.moves.map(x => (
        <Button key={`map-go-${x.id}`} onPress={() => on.mapGo(x.id)}>
          {x.label}
        </Button>
      ))}
      {map.hasMore ? (
        <Button key="map-more" onPress={on.mapOpen}>
          more…
        </Button>
      ) : null}
    </Box>
  )
  return (
    <Box flexDirection="column" gap="xs">
      <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center" justifyContent="space-between">
        <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
          {map.crumbs.map((c, k) => (
            <Button key={`map-crumb-${k}`} plain {...(k === map.crumbs.length - 1 ? {} : { dimColor: true })} onPress={() => on.mapGo(c.id)}>
              {k === 0 ? c.label : `› ${c.label}`}
            </Button>
          ))}
        </Box>
        <Box flexDirection="row" gap={1} alignItems="center">
          <Select key="map-jump" label="Jump to" options={map.jump} value={map.focus} onSelect={on.mapGo} />
          <Button key="map-open" onPress={on.mapOpen}>
            ↗ Open the full map
          </Button>
        </Box>
      </Box>
      <Box flexDirection={map.isSide ? 'row' : 'column'} gap={1} alignItems={map.isSide ? 'flex-start' : 'stretch'}>
        <Box flexDirection="column" gap="xs" {...(map.isSide ? { width: '62%' } : {})} borderStyle="round" borderColor="subtle" padding="xs">
          {drawing}
          {nav}
        </Box>
        <Box flexDirection="column" gap="xs" flexGrow={1} flexShrink={1} borderStyle="round" borderColor="subtle" paddingX={1} paddingY="xs">
          <Text weight="semibold">What the director is reminded of</Text>
          {map.brief.map(line => (
            <Text mono size="footnote" dimColor wrap="wrap">
              {line}
            </Text>
          ))}
        </Box>
      </Box>
      <Text dimColor size="footnote" wrap="wrap">
        {`Solid line: a file says it · dashed: guessed from names · dotted: unsure · hover a box for its sources. ${map.graphLine}.`}
      </Text>
    </Box>
  )
}

// ---------------------------------------------------------------- the plan (stage 10)

/**
 * The Plan view, as the approved sketch drew it (2026-11-17): the milestones and
 * their stages as a mind map coloured by state; buttons under it move the focus or
 * pick a stage; the picked stage's card with what can be done with it; a field to
 * plan a new stage under the milestone; beside it, what the director recalls.
 */
function planBody(ui: Ui, m: PaneModel, on: PaneActions, Svg: SvgEl | null) {
  const { Box, Text, Button, Select, Input } = ui
  const p = m.plan
  if (p === null) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Reading the plan…</Text>
        <Button key="plan-retry" onPress={() => on.planGo(m.ui.planFocus)}>
          Show the plan
        </Button>
      </Box>
    )
  }
  const v = p.view
  const drawing =
    Svg !== null ? (
      <Svg source={p.svg.source} alt={p.svg.alt} width={p.svg.width} height={p.svg.height} isInteractive />
    ) : (
      <Box flexDirection="column">
        <Text weight="bold">{v.label}</Text>
        {v.kind === 'home'
          ? v.milestones.map(ms => <Text wrap="wrap">{`${ms.label}: ${countLine(ms.items)}`}</Text>)
          : v.items.map(i => <Text wrap="wrap">{`[${STATE_WORD[i.state]}] ${i.title}`}</Text>)}
      </Box>
    )
  const canSend = m.isDirector && m.busy === null
  const it = p.picked
  const row = p.pickedRow
  const details =
    it !== null ? (
      <Box flexDirection="column" gap="xs" borderStyle="round" borderColor={it.state === 'waiting' ? 'warning' : it.state === 'building' ? 'success' : 'subtle'} paddingX={1}>
        <Text weight="semibold" wrap="wrap">
          {it.title}
        </Text>
        <Text dimColor wrap="wrap">
          {`${STATE_WORD[it.state]}${it.fact ? ` · ${it.fact}` : ''}`}
        </Text>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {row === null ? null : chatLink(ui, row, 'plan-open')}
          {canSend && row !== null && it.state === 'waiting'
            ? (row.ask?.buttons ?? []).map((label, i) => (
                <Button key={`plan-answer-${i}`} onPress={() => on.answer(row, label)}>
                  {`Answer: ${label}`}
                </Button>
              ))
            : null}
          {canSend && row !== null && !row.isSelf ? (
            <Button key="plan-brief" onPress={() => on.brief(row)}>
              Brief me
            </Button>
          ) : null}
          {canSend && it.state === 'planned' && it.cardId !== null ? (
            <Button key="plan-start" variant="primary" onPress={() => on.planStart(it, p.milestone ?? it.under)}>
              Start this stage
            </Button>
          ) : null}
          {it.kanban !== null && !it.kanban.isLive && it.state !== 'done' ? (
            <Button key="plan-done" onPress={() => on.planDone(it)}>
              Mark done
            </Button>
          ) : null}
          <Button key="plan-unpick" plain dimColor onPress={() => on.planPick(null)}>
            close
          </Button>
        </Box>
        {!m.isDirector ? <Text dimColor>The director chat's pane can brief, answer and start from here.</Text> : null}
      </Box>
    ) : null
  const nav = (
    <Box flexDirection="row" gap={1} flexWrap="wrap">
      {v.kind !== 'home' ? (
        <Button key="plan-back" onPress={() => on.planGo('home')}>
          ← All milestones
        </Button>
      ) : null}
      {p.moves.map(x => (
        <Button
          key={`plan-${v.kind === 'home' ? 'go' : 'pick'}-${x.id}`}
          {...(v.kind !== 'home' && v.pick === x.id ? { variant: 'primary' as const } : {})}
          onPress={() => (v.kind === 'home' ? on.planGo(x.id) : on.planPick(x.id))}
        >
          {x.label}
        </Button>
      ))}
    </Box>
  )
  const side = (
    <Box flexDirection="column" gap="xs" {...(p.isSide ? { flexGrow: 1, flexShrink: 1 } : {})} borderStyle="round" borderColor="subtle" paddingX={1} paddingY="xs">
      <Text weight="semibold">{v.kind === 'home' ? 'Where things stand' : 'What the director is reminded of'}</Text>
      {p.side.map(line => (
        <Text mono size="footnote" dimColor wrap="wrap">
          {line}
        </Text>
      ))}
    </Box>
  )
  return (
    <Box flexDirection="column" gap="xs">
      <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center" justifyContent="space-between">
        <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
          {p.crumbs.map((c, k) => (
            <Button key={`plan-crumb-${k}`} plain {...(k === p.crumbs.length - 1 ? {} : { dimColor: true })} onPress={() => (c.pick ? on.planPick(c.id) : on.planGo(c.id))}>
              {k === 0 ? c.label : `› ${c.label}`}
            </Button>
          ))}
        </Box>
        <Select key="plan-jump" label="Jump to" options={p.jump} value={v.kind === 'home' ? 'home' : v.code} onSelect={on.planGo} />
      </Box>
      <Box flexDirection={p.isSide ? 'row' : 'column'} gap={1} alignItems={p.isSide ? 'flex-start' : 'stretch'}>
        <Box flexDirection="column" gap="xs" {...(p.isSide ? { width: '62%' } : {})} borderStyle="round" borderColor="subtle" padding="xs">
          {drawing}
          {nav}
        </Box>
        {side}
      </Box>
      {details}
      {v.kind === 'milestone' ? <Input key={`plan-add-${m.ui.seq}`} placeholder={`Plan a new stage under ${v.label}…`} submitLabel="plan" onSubmit={on.planAdd} /> : null}
      <Text dimColor size="footnote" wrap="wrap">
        {v.kind === 'home'
          ? `Each box is a milestone with work going on; its squares are its stages, most urgent first.${v.hidden > 0 ? ` ${v.hidden} more in Jump to.` : ''} Hover a box for its stages.`
          : 'Pick a stage for what can be done with it. Type a new stage above, or tell the director "plan a stage under G5: …"; a planned stage is dashed until its chat starts.'}
      </Text>
    </Box>
  )
}

/** "2 waiting on you · 1 building": a milestone's stages by state, for the terminal. */
function countLine(items: readonly PlanItem[]): string {
  const states: PlanState[] = ['waiting', 'building', 'review', 'planned', 'done']
  return states
    .map(s => [s, items.filter(i => i.state === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${STATE_WORD[s]}`)
    .join(' · ')
}

// ---------------------------------------------------------------- the three trees

/** The docked or inline pane. `Svg` is the surface's vector leaf, where it has one (the Map tab). */
export function paneTree(ui: Ui, m: PaneModel, on: PaneActions, Svg: SvgEl | null = null) {
  const { Box, Text } = ui
  const tab = m.ui.tab
  return (
    <Box flexDirection="column" gap={1}>
      {header(ui, m, on)}
      {tabs(ui, m, on)}
      {tab === 'board' ? boardTab(ui, m, on) : null}
      {tab === 'kanban' ? kanbanTab(ui, m, on) : null}
      {tab === 'notes' ? notesTab(ui, m, on) : null}
      {tab === 'models' ? modelsTab(ui, m) : null}
      {tab === 'ask' ? askTab(ui, m, on) : null}
      {tab === 'map' ? mapTab(ui, m, on, Svg) : null}
      <Text dimColor wrap="wrap">
        Reads every 15 s while this chat is on screen.
      </Text>
    </Box>
  )
}

/** The pane minimized to a widget: what reads at a glance (clicks may not reach it). */
export function glanceTree(ui: Ui, v: BoardView | null) {
  const { Box, Text } = ui
  const first = v?.groups.waiting[0] ?? null
  return (
    <Box flexDirection="column">
      <Text weight="bold">{v === null ? 'Studio' : `Studio · ${glance(v)}`}</Text>
      {first !== null ? (
        <Text color="warning" wrap="truncate-end">
          {clip(`${rowName(first)}: ${first.ask ? plain(first.ask.question) : 'needs you'}`, 60)}
        </Text>
      ) : null}
    </Box>
  )
}

/** `/studio`'s row in the transcript: the header and the waits as cards, the rest as counts. */
export function commandTree(ui: Ui, v: BoardView, w: number, where: string) {
  const { Box, Text, Progress } = ui
  const g = v.groups
  const bars = usageBars(v.header)
  const inner = Math.max(16, w - 4)
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text weight="bold" size="heading">
          Studio board
        </Text>
        {bars.length === 0 ? <Text dimColor>{usageLine(v.header)}</Text> : null}
        {bars.map(b => (
          <Progress label={b.label} value={b.pct} max={100} valueText={b.valueText} {...(b.tone ? { color: b.tone } : {})} />
        ))}
        <Text dimColor wrap="wrap">
          {gitFacts(v.header).counts}
        </Text>
        <Text dimColor wrap="wrap">
          {gitFacts(v.header).last}
        </Text>
      </Box>
      <Box flexDirection="column" gap="xs">
        <Text weight="bold" {...(g.waiting.length > 0 ? { color: 'warning' as const } : {})}>
          {`Waiting on you (${g.waiting.length})`}
        </Text>
        {g.waiting.map(r => (
          <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
            <Text weight="semibold" wrap="truncate-end">
              {clip(`${rowName(r)}${selfMark(r)} · waiting ${ago(v.at - msOf(r.since))}`, inner)}
            </Text>
            <Text color="warning" wrap="wrap">
              {r.ask ? plain(r.ask.question) : '(no ask recorded)'}
            </Text>
          </Box>
        ))}
        <Text wrap="wrap">{`Working now (${g.working.length}) · Recent, last 72 h (${g.recent.length}) · Quiet (${g.quiet.length})`}</Text>
        {v.leads ? <Text wrap="wrap">{`Leads (${leadsLine(v.leads)}) · the text below lists each lead's chats`}</Text> : null}
      </Box>
      <Text dimColor wrap="wrap">
        {where}
      </Text>
    </Box>
  )
}
