import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { BoardRow, BoardView, Report } from '../types'
import { boardText, groupRows } from '../hooks/board'
import { ROLE_TEXT, leadSnapshotText, selfLine, snapshotText } from '../hooks/director'
import { byLead, chatsLine, filterLeads, leadOf, leadsLine, parseLeads } from '../hooks/leads'
import { filterGroups } from '../hooks/cards'

// Stage 11: the leads (docs/STUDIO_DIRECTOR.md §5.14). A leads.md shaped as the real
// one: §7's parts table and chat-id table, §8's adopted chats.
const ROOT = 'E:/Godot Games/scrap-shift'
const STUDIO = `${ROOT}/docs/studio`
const NOW = Date.parse('2026-11-18T18:00:00Z')
const h = (n: number) => new Date(NOW - n * 3_600_000).toISOString()

const L_MON = 'local_00000000-0000-4000-8000-0000000000a1'
const L_HOME = 'local_00000000-0000-4000-8000-0000000000a2'
const L_PLAYER = 'local_00000000-0000-4000-8000-0000000000a3'
const G3E = 'local_00000000-0000-4000-8000-0000000000a4' // adopted by Monsters
const OLDBAY = 'local_00000000-0000-4000-8000-0000000000a5' // adopted by Home base
const DOOR = 'local_00000000-0000-4000-8000-0000000000a6' // started by the old bay chat
const REELER2 = 'local_00000000-0000-4000-8000-000000000001' // started by the Monsters lead
const REELER3 = 'local_00000000-0000-4000-8000-000000000002' // started by REELER2
const STAGE11 = 'local_00000000-0000-4000-8000-000000000003' // started by the director: no lead
const DIRECTOR = 'local_00000000-0000-4000-8000-0000000000a7'

const LEADS_MD = [
  '# The leads',
  '',
  '## 7. The parts',
  '',
  '| Lead | Slug | Its part | Its files |',
  '|---|---|---|---|',
  '| Player and combat | `player` | Movement | `scripts/player/` |',
  '| Monsters and enemies | `monsters` | Every enemy | `scripts/enemies/` |',
  '| Home base | `homebase` | SLIP 7 and the old bay | `scripts/world/slip7/` |',
  '',
  'The lead chats, started 2026-11-18 by the studio director (Opus 5.5, high effort):',
  '',
  '| Lead | Chat id |',
  '|---|---|',
  `| Player and combat | \`${L_PLAYER}\` |`,
  `| Monsters and enemies | \`${L_MON}\` |`,
  `| Home base | \`${L_HOME}\` |`,
  '',
  '## 8. The chats each lead adopts',
  '',
  '- **Player and combat:** none.',
  '- **Monsters and enemies:**',
  `  - G3e: the Warden's sounds \`${G3E}\` (waiting on the user)`,
  '- **Home base:**',
  `  - Old bay improvements \`${OLDBAY}\``,
  '',
  '## 9. Rules each lead passes on',
  '',
  `- **Every lead:** see \`${STAGE11}\` (an id outside §8 is no adoption)`,
  '',
].join('\n')

function report(over: Partial<Report>): Report {
  return {
    schema: 2, appId: 'local_x', cliId: 'cli-x', title: 'A chat', tag: null, tagSource: null, state: 'idle',
    stateSince: h(1), updatedAt: h(1), turns: 1, recap: '', ask: null, lastCommit: null, context: null,
    model: 'claude-opus-5-5', effort: 'high', turnClass: null, classMs: null, routings: [], cwd: ROOT, ...over,
  }
}

const REPORTS: Report[] = [
  report({ appId: L_MON, title: 'Lead: Monsters and enemies', state: 'waiting-you', stateSince: h(0.2), ask: { question: 'Which stage first: the Reeler or the Ticker?', buttons: ['Reeler', 'Ticker'] } }),
  report({ appId: L_HOME, title: 'Lead: Home base', state: 'working', stateSince: h(0.1), updatedAt: h(0.05), recap: 'Stock-take written.' }),
  report({ appId: L_PLAYER, title: 'Lead: Player and combat', state: 'idle', updatedAt: h(3), recap: 'Stock-take done; no chats yet.' }),
  report({ appId: G3E, title: "G3e: the Warden's sounds", tag: 'G3e', state: 'waiting-you', stateSince: h(40), updatedAt: h(40), ask: { question: 'Play G3e now?', buttons: ['Yes'] } }),
  report({ appId: REELER2, title: "The Reeler's look, round 2", state: 'working', stateSince: h(0.3), updatedAt: h(0.1) }),
  report({ appId: REELER3, title: "The Reeler's rig", state: 'idle', updatedAt: h(5) }),
  report({ appId: OLDBAY, title: 'Old bay improvements', state: 'idle', updatedAt: h(2) }),
  report({ appId: DOOR, title: 'Bay: inner doorway as a double door', state: 'idle', updatedAt: h(200) }),
  report({ appId: STAGE11, title: 'Studio Director stage 11', state: 'working', stateSince: h(0.5), updatedAt: h(0.1) }),
]
const startedBy: Record<string, string> = {
  [L_MON]: DIRECTOR, [L_HOME]: DIRECTOR, [L_PLAYER]: DIRECTOR,
  [REELER2]: L_MON, [REELER3]: REELER2, [DOOR]: OLDBAY, [STAGE11]: DIRECTOR,
}
const sessions = REPORTS.map(r => ({ id: r.appId!, title: r.title, cwd: ROOT, isRunning: false, lastActivityAt: r.updatedAt, startedBy: startedBy[r.appId!] ?? null }))
const HEADER = { usage: [], uncommitted: { changed: 0, untracked: 0 }, lastCommit: null }

function view(reports = REPORTS, selfId = ''): BoardView {
  const groups = groupRows(reports, NOW, selfId)
  return { at: NOW, header: HEADER, groups, leads: byLead(groups, sessions, parseLeads(LEADS_MD)) }
}

test('leads.md: §7 gives the leads, their slugs and ids; §8 the adopted chats; nothing else counts', () => {
  const leads = parseLeads(LEADS_MD)
  expect(leads.map(l => [l.name, l.slug, l.id])).toEqual([
    ['Player and combat', 'player', L_PLAYER],
    ['Monsters and enemies', 'monsters', L_MON],
    ['Home base', 'homebase', L_HOME],
  ])
  expect(leads.map(l => l.adopted)).toEqual([[], [G3E], [OLDBAY]])
  expect(parseLeads('# nothing here')).toEqual([])
  expect(parseLeads(LEADS_MD.replace(/\n/g, '\r\n')).length).toBe(3)
})

test('a chat sits under the first lead up its chain of starters, or the lead that adopted it, or under no lead', () => {
  const leads = parseLeads(LEADS_MD)
  const by = new Map(Object.entries(startedBy))
  expect(leadOf(L_MON, by, leads)).toBe(L_MON) // a lead is its own
  expect(leadOf(REELER2, by, leads)).toBe(L_MON) // started by the lead
  expect(leadOf(REELER3, by, leads)).toBe(L_MON) // started by the lead's builder
  expect(leadOf(G3E, by, leads)).toBe(L_MON) // adopted
  expect(leadOf(DOOR, by, leads)).toBe(L_HOME) // started by an adopted chat
  expect(leadOf(STAGE11, by, leads)).toBe(null) // the director's own
  expect(leadOf('local_nobody', by, leads)).toBe(null)
  const loop = new Map([['local_a', 'local_b'], ['local_b', 'local_a']])
  expect(leadOf('local_a', loop, leads)).toBe(null) // a cycle ends
})

test('the board by lead: waiting leads first, then working, then idle; each with its chats; the rest under no lead', () => {
  const b = view().leads!
  expect(b.leads.map(g => g.lead.slug)).toEqual(['monsters', 'homebase', 'player'])
  const mon = b.leads[0]!
  expect(mon.row?.title).toBe('Lead: Monsters and enemies')
  expect(mon.chats.waiting.map(r => r.id)).toEqual([G3E])
  expect(mon.chats.working.map(r => r.id)).toEqual([REELER2])
  expect(mon.chats.recent.map(r => r.id)).toEqual([REELER3])
  expect(chatsLine(mon.chats)).toBe('3 chats: 1 waiting, 1 working, 1 idle')
  expect(b.leads[1]!.chats.quiet.map(r => r.id)).toEqual([DOOR])
  expect(chatsLine(b.leads[2]!.chats)).toBe('no chats')
  expect(b.rest.working.map(r => r.id)).toEqual([STAGE11])
  expect(leadsLine(b)).toBe('3 leads: 1 waiting, 1 working, 1 idle')
  // with no app list, only adoption places a chat
  const groups = groupRows(REPORTS, NOW)
  const bare = byLead(groups, null, parseLeads(LEADS_MD))!
  expect(bare.leads.find(g => g.lead.slug === 'monsters')!.chats.working).toEqual([])
  expect(bare.rest.working.map(r => r.id).sort()).toEqual([REELER2, STAGE11].sort())
  expect(byLead(groups, sessions, [])).toBe(null)
  // a filter keeps a lead when it or one of its chats passes
  const needs = filterLeads(b, 'needs-me', filterGroups)
  expect(needs.leads.map(g => g.lead.slug)).toEqual(['monsters'])
  expect(needs.rest.working).toEqual([])
})

test('the role and the snapshot: work in parallel under leads, no one-builder rule', () => {
  expect(ROLE_TEXT).toContain('docs/studio/leads.md')
  expect(ROLE_TEXT).toContain('eleven lead chats')
  expect(ROLE_TEXT).not.toContain('one builder at a time')
  expect(ROLE_TEXT).toContain('Ask the user (AskUserQuestion) before you start or switch any chat to Fable')
  expect(ROLE_TEXT).toContain("A chat's report is a claim")
  expect(selfLine(null)).toContain('"one builder at a time" is gone')
})

test('the snapshot lists each lead with its chats, then the chats under no lead; a changes snapshot keeps to its lead', () => {
  const full = snapshotText({ view: view(), seen: null, log: '', notes: null })
  const t = full.text
  expect(t).toContain('Leads (3 leads: 1 waiting, 1 working, 1 idle), each with its own chats under it (docs/studio/leads.md)')
  expect(t).toContain(`  Monsters and enemies (monsters): Lead: Monsters and enemies [${L_MON}] · waiting 12m`)
  expect(t).toContain('      ask: Which stage first: the Reeler or the Ticker?  [Reeler | Ticker]')
  expect(t).toContain('    its 3 chats: 1 waiting, 1 working, 1 idle')
  expect(t).toContain(`      G3e: the Warden's sounds [${G3E}] · waiting 1d 16h`)
  expect(t).toContain(`      The Reeler's look, round 2 [${REELER2}] · working 18m`)
  expect(t).toContain('    its no chats')
  expect(t).toContain('Under no lead (1)')
  expect(t).toContain(`    Studio Director stage 11 [${STAGE11}] · working 30m`)
  // the order: monsters before home base before the rest
  expect(t.indexOf('Monsters and enemies (monsters)') < t.indexOf('Home base (homebase)')).toBe(true)
  expect(t.indexOf('Home base (homebase)') < t.indexOf('Under no lead')).toBe(true)
  expect(t).toContain('The board: every Scrapshift chat but this one (9).')

  // nothing changed: the waits are still listed, under their lead
  const same = snapshotText({ view: view(), seen: full.seen, log: '', notes: null })
  expect(same.text).toContain('kind="changes"')
  expect(same.text).toContain('Board changes since the last snapshot: 0 of 9 chats changed.')
  expect(same.text).toContain('Leads: changed or waiting')
  expect(same.text).toContain(`      G3e: the Warden's sounds [${G3E}] · waiting 1d 16h`)
  expect(same.text).not.toContain('Home base (homebase)')
  expect(same.text).not.toContain("The Reeler's look, round 2")

  // a builder of Home base's commits: it shows under Home base, with the lead marked unchanged
  const moved = REPORTS.map(r => (r.appId === DOOR ? { ...r, updatedAt: h(0.01), lastCommit: { hash: 'abc1234', subject: 'Bay: the double door', at: h(0.01) } } : r))
  const ch = snapshotText({ view: view(moved), seen: full.seen, log: '', notes: null }).text
  expect(ch).toContain('1 of 9 chats changed')
  expect(ch).toContain(`  Home base (homebase) [${L_HOME}] · unchanged`)
  expect(ch).toContain('commit abc1234 Bay: the double door')
  expect(ch.indexOf('Home base (homebase)') < ch.indexOf('Bay: inner doorway')).toBe(true)

  // without leads the board is the four groups as before
  const flat = snapshotText({ view: { ...view(), leads: null }, seen: null, log: '', notes: null }).text
  expect(flat).not.toContain('Leads (3 leads')
  expect(flat).not.toContain('Under no lead')
  expect(flat).toContain('Working now (3)')
})

test("a lead's own snapshot holds only its chats: full first, then the changes", () => {
  const mon = view().leads!.leads[0]!
  const first = leadSnapshotText(mon, NOW, null)
  expect(first.text).toContain('<studio-lead-snapshot kind="full"')
  expect(first.text).toContain('Your chats as the lead for Monsters and enemies (3)')
  expect(first.text).toContain(`  G3e: the Warden's sounds [${G3E}] · waiting 1d 16h`)
  expect(first.text).toContain('    ask: Play G3e now?  [Yes]')
  expect(first.text).toContain(`  The Reeler's rig [${REELER3}]`)
  expect(first.text).not.toContain('Studio Director stage 11')
  expect(first.text).not.toContain('Old bay')
  expect(first.text).not.toContain('notes.md')
  const next = leadSnapshotText(mon, NOW, first.seen)
  expect(next.text).toContain('kind="changes"')
  expect(next.text).toContain('0 of 3 changed')
  expect(next.text).toContain("G3e: the Warden's sounds") // a wait is always listed
  expect(next.text).not.toContain("The Reeler's rig")
})

test('/studio text lists the leads, their live chats and a count of the idle ones', () => {
  const t = boardText(view())
  expect(t).toContain('Leads (3)')
  expect(t).toContain('  Monsters and enemies · waiting 12m')
  expect(t).toContain("    waiting · G3e: the Warden's sounds · 1d 16h: Play G3e now?  [Yes]")
  expect(t).toContain("    working · The Reeler's look, round 2 · 18m")
  expect(t).toContain('    and 1 idle chat')
  expect(t).toContain('  Player and combat · idle 3h')
  expect(t).toContain('    no chats')
  expect(t).toContain('Under no lead')
  expect(t).toContain('Working now (1)')
})

// ---------------------------------------------------------------- end to end

const asFile = (r: Report) => JSON.stringify(r)
type World = { files: Record<string, string>; prompts: Array<{ text: string; context: readonly string[] }>; self: string }

function engine(on: On, w: World) {
  mock.env(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  on('session.id', () => ({ value: `cli-${w.self}` }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.turns', () => ({ value: 1 }))
  on('session.surfaces', () => ({ value: [] }))
  on('session.messages', () => ({ value: [] as never }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('mcp.call', (_, e) => {
    const list = REPORTS.filter(r => r.appId !== w.self).map(r => ({
      sessionId: r.appId, title: r.title, cwd: 'E:\\Godot Games\\scrap-shift', isArchived: false, isRunning: false,
      lastActivityAt: r.updatedAt, ...(startedBy[r.appId!] ? { startedBy: startedBy[r.appId!] } : {}),
    }))
    const text =
      e.tool === 'get_session'
        ? JSON.stringify({ sessionId: w.self, title: REPORTS.find(r => r.appId === w.self)?.title ?? 'A worker', model: 'claude-opus-5-5', effort: 'high' })
        : e.tool === 'list_sessions'
        ? JSON.stringify(list)
        : e.tool === 'get_usage'
        ? JSON.stringify({ plan: { status: 'not_applicable' } })
        : '{}'
    return { value: { isError: false, content: [{ type: 'text' as const, text }] } }
  })
  on('fs.write', (_, e) => {
    w.files[e.path.split('\\').join('/')] = e.text
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    const text = w.files[e.path.split('\\').join('/')]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.list', (_, e) => {
    const dir = `${e.path.split('\\').join('/').replace(/\/$/, '')}/`
    const names = Object.keys(w.files).filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/'))
    return { value: names.map(p => ({ name: p.slice(dir.length), kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false })) }
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[1] === 'rev-parse' && argv.includes('--git-common-dir')) return ok(`${ROOT}/.git\n`)
    if (argv[1] === 'rev-parse') return ok('h0\n')
    if (argv[1] === 'log' && argv.includes('--oneline')) return ok('5ff8165f Studio: board and notes\n')
    if (argv[1] === 'log') return ok('5ff8165f\x1fStudio: board and notes\x1f2026-11-18T19:00:00+03:00\n')
    return ok('')
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => {
    w.prompts.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text, context: e.context }
  })
  on('prompt.compose', () => ({ sections: [] }))
}

const world = (self: string): World => {
  const files: Record<string, string> = { [`${STUDIO}/leads.md`]: LEADS_MD }
  for (const r of REPORTS) files[`${STUDIO}/sessions/${r.appId}.json`] = asFile({ ...r, cliId: `cli-${r.appId}` })
  return { files, prompts: [], self }
}
const typed = (text: string) => ({ text, origin: { kind: 'composer' }, wait: false }) as never

test("in a lead chat each of the user's prompts carries its own chats; a worker chat gets none", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w = world(L_MON)
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  await $.prompt.submit(typed('Where do my chats stand?'))
  const ctx = w.prompts.at(-1)?.context ?? []
  const lead = ctx.find(c => c.startsWith('<studio-lead-snapshot'))
  expect(lead).toContain('kind="full"')
  expect(lead).toContain(`G3e: the Warden's sounds [${G3E}] · waiting`)
  expect(lead).toContain(`The Reeler's rig [${REELER3}]`)
  expect(lead).not.toContain('Old bay improvements')
  expect(ctx.some(c => c.startsWith('<studio-snapshot'))).toBe(false)
  await $.prompt.submit(typed('And now?'))
  expect(w.prompts.at(-1)?.context.find(c => c.startsWith('<studio-lead-snapshot'))).toContain('kind="changes"')

  // a peer's message is not the user's prompt: nothing added
  await $.prompt.submit({ text: 'from another chat', origin: { kind: 'peer' }, wait: false } as never)
  expect(w.prompts.at(-1)?.context ?? []).toEqual([])
})

test('a worker chat (under a lead, not one) gets no lead snapshot', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w = world(REELER2)
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  await $.prompt.submit(typed('Build the rig.'))
  expect(w.prompts.at(-1)?.context ?? []).toEqual([])
})

const PANE = {
  plugin: 'studio',
  component: 'Pane',
  requestId: 'studio-board',
  props: { title: 'Studio', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

test('the pane shows the board by lead, folds idle chats, and switches back to the board by state', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w = world(STAGE11)
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  await $.command.run({ command: 'studio', args: '', origin: { kind: 'composer' } } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^Leads \(/ }))?.text).toBe('Leads (3 leads: 1 waiting, 1 working, 1 idle)')
    // the lead's card, as any chat's: name, age, the whole ask
    expect((await ui.find({ type: 'Text', text: /^Lead: Monsters and enemies$/ }))?.text).toBe('Lead: Monsters and enemies')
    expect((await ui.find({ type: 'Text', text: /^Which stage first/ }))?.text).toBe('Which stage first: the Reeler or the Ticker?')
    expect((await ui.find({ type: 'Text', text: /Monsters and enemies: 3 chats/ }))?.text).toBe('  Monsters and enemies: 3 chats: 1 waiting, 1 working, 1 idle')
    // its live chats as lines, with their links; the idle one folded
    expect((await ui.find({ type: 'Text', text: /^waiting · G3e/ }))?.text).toBe("waiting · G3e: the Warden's sounds · waiting 1d 16h")
    expect((await ui.find({ type: 'Text', text: /^  Play G3e now\?$/ }))?.text).toBe('  Play G3e now?')
    expect((await ui.find({ type: 'Markdown', key: `lead-open-${G3E}` }))?.props.text).toBe(`[Open chat](#${G3E})`)
    expect((await ui.find({ type: 'Text', text: /^working · The Reeler's look/ }))?.text).toContain('working · ')
    expect(await ui.find({ type: 'Text', text: /The Reeler's rig/ })).toBe(undefined)
    await ui.press({ key: `lead-idle-${L_MON}` })
    expect((await ui.find({ type: 'Text', text: /The Reeler's rig/ }))?.text).toContain("idle · The Reeler's rig")
    await ui.press({ key: `lead-idle-${L_MON}` })
    // the chats under no lead keep the four groups (this chat is the one there)
    expect((await ui.find({ type: 'Text', text: /^Under no lead/ }))?.text).toBe('Under no lead (1)')
    // By state: the board as before stage 11
    await ui.press({ key: 'by-state' })
    expect(await ui.find({ type: 'Text', text: /^Leads \(/ })).toBe(undefined)
    expect((await ui.find({ type: 'Text', text: /^Waiting on you/ }))?.text).toBe('Waiting on you (2)')
    expect((await ui.find({ type: 'Text', text: /^Working now/ }))?.text).toBe('Working now (3)')
    await ui.press({ key: 'by-lead' })
    expect((await ui.find({ type: 'Text', text: /^Leads \(/ }))?.text).toBe('Leads (3 leads: 1 waiting, 1 working, 1 idle)')
    await ui.unmount()
  }
})

export type _Unused = BoardRow
