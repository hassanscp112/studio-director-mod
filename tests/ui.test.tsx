import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { BoardRow, BoardView, CardFile } from '../types'
import { answerPrompt, autoColumn, briefPrompt, busyWith, cardAge, cardFacts, directorRow, filterGroups, gitFacts, glance, kanban, modelGroups, newCard, parseCard, pinned, recapLines, rowCardId, serializeCard, shift, toneOf, usageBars } from '../hooks/cards'

// Stage 7, the UI: the pane as a dashboard, the kanban, and the pane driving the
// director chat. The hooks here stand for the engine and the app beneath the mod:
// files are one table keyed by path, git answers fixed text, and every prompt,
// hidden row, toast and mod-run command that reaches the bottom is kept.
const ROOT = 'E:/Godot Games/scrap-shift'
const STUDIO = `${ROOT}/docs/studio`
const NOW = Date.parse('2026-11-16T10:00:00Z')
const h = (n: number) => new Date(NOW - n * 3_600_000).toISOString()
const SELF = JSON.stringify({ sessionId: 'local_self', title: 'Studio stage 7', model: 'claude-opus-5-5', effort: 'high' })
const USAGE = JSON.stringify({
  plan: { status: 'ok', windows: [{ label: 'Weekly · all models', percentUsed: 78, resetsIn: '2d 9h' }, { label: 'Weekly · Fable', percentUsed: 23, resetsIn: '2d 9h' }] },
  context: { tokensUsed: 140000, percentUsed: 14 },
})
const listed = (id: string, title: string, ageH: number) => ({ sessionId: id, title, cwd: 'E:\\Godot Games\\scrap-shift', isArchived: false, isRunning: false, lastActivityAt: h(ageH) })
const LIST = JSON.stringify([listed('local_g3e', "G3e: the Warden's sounds", 19), listed('local_vault', 'Vault v2', 2), listed('local_quay', 'N1d-C quay', 0.1), listed('local_plan', 'Plan review', 5)])
const report = (over: Record<string, unknown>) =>
  JSON.stringify({
    schema: 2, appId: 'local_x', cliId: 'cli-x', title: 'A chat', tag: null, tagSource: null, state: 'idle', stateSince: h(1), updatedAt: h(1),
    turns: 1, recap: '', ask: null, lastCommit: null, context: null, model: 'claude-opus-5-5', effort: 'high', turnClass: null, classMs: null, routings: [], cwd: ROOT, ...over,
  })

type World = {
  files: Record<string, string>
  messages: Array<{ role: string }>
  turns: number
  prompts: Array<{ text: string; context: readonly string[] }>
  rows: string[]
  toasts: string[]
  cleared: number
  ran: string[]
  /** The app's `list_sessions` answer. */
  list: string
  /** The mod's store, kept here so a test can read and empty it. */
  store: Record<string, unknown>
}

function engine(on: On, w: World) {
  mock.env(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: `cli-self${'+'.repeat(w.cleared)}` }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.turns', () => ({ value: w.turns }))
  on('session.surfaces', () => ({ value: [] }))
  on('session.messages', () => ({ value: w.messages as never }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { tokens: 140_000, window: 1_000_000 }, rateLimits: [] } }))
  on('store.get', (_, e) => ({ value: w.store[e.key] }))
  on('store.set', (_, e) => {
    w.store[e.key] = e.value
    return { value: undefined }
  })
  on('session.append', (_, e, next) => {
    w.rows.push(`${e.message.type}: ${(e.message.content as ReadonlyArray<{ text?: string }>)[0]?.text ?? ''}`)
    return next(e)
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.run', (_, e) => {
    if (e.command === 'clear') {
      w.cleared++
      w.messages = []
    }
    return { text: '' }
  })
  on('mcp.call', (_, e) => {
    const text = e.tool === 'get_session' ? SELF : e.tool === 'get_usage' ? USAGE : e.tool === 'list_sessions' ? w.list : '{}'
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
    if (argv[1] === 'status') return ok([' M scripts/a.gd', ''].join('\0'))
    if (argv[1] === 'log' && argv.includes('--oneline')) return ok('573ecf3 Studio mod 0.6.1\n')
    if (argv[1] === 'log') return ok('573ecf3\x1fStudio mod 0.6.1\x1f2026-11-16T07:18:00+03:00\n')
    return ok('')
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', (_, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_, e) => {
    w.prompts.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text, context: e.context }
  })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
  on('model.classify', () => ({ value: 'chore' }))
  on('tool.call', (_, e) => {
    w.ran.push(String((e as unknown as { tool: string }).tool))
    return { result: { stdout: 'ok' } } as never
  })
}

const world = (): World => ({
  files: {
    [`${STUDIO}/sessions/local_g3e.json`]: report({ appId: 'local_g3e', cliId: 'cli-g3e', title: "G3e: the Warden's sounds", tag: 'G3e', state: 'waiting-you', stateSince: h(19), updatedAt: h(19), ask: { question: 'Start building G3e on this plan?', buttons: ['Yes, build it', 'Not now'] } }),
    [`${STUDIO}/sessions/local_vault.json`]: report({ appId: 'local_vault', cliId: 'cli-vault', title: 'Vault v2', updatedAt: h(2), recap: 'Sorting is on the way to the vault.\nBelts are in.\nThe walk build is next.\nShots are in docs/vault_shots.\nNothing else changed.', lastCommit: { hash: 'abc1234def', subject: 'Vault: belts', at: h(3) }, context: { tokens: 621545, pct: 62 } }),
    [`${STUDIO}/sessions/local_quay.json`]: report({ appId: 'local_quay', cliId: 'cli-quay', title: 'N1d-C quay', tag: 'N1d', state: 'working', stateSince: h(0.25), updatedAt: h(0.1), turnClass: 'build' }),
    [`${STUDIO}/sessions/local_plan.json`]: report({ appId: 'local_plan', cliId: 'cli-plan', title: 'Plan review', updatedAt: h(5), recap: 'Read the plan; nothing to change.' }),
    [`${STUDIO}/notes.md`]: '# Studio notes\n\n- 2026-11-16 09:00: G3e waits for the plan OK.\n',
  },
  messages: [],
  turns: 1,
  prompts: [],
  rows: [],
  toasts: [],
  cleared: 0,
  ran: [],
  list: LIST,
  store: {},
})

const pane = (bodyColumns = 110, placement: 'dock' | 'widget' = 'dock') =>
  ({
    plugin: 'studio',
    component: 'Pane',
    requestId: 'studio-board',
    props: { title: 'Studio', isFocused: false, bodyColumns, placement, scroll: { offset: 0, bodyRows: 60 }, view: {} },
  }) as const
const output = (command: string, args: string, text: string) =>
  ({ plugin: 'studio', component: 'CommandOutput', requestId: `row-${command}`, props: { command, args, text, isErrored: false } }) as const
const cmd = (command: string, args = '', kind = 'composer') => ({ command, args, origin: { kind } }) as never
const typed = (text: string) => ({ text, origin: { kind: 'composer' }, wait: false }) as never
const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] } as never

async function start($: { session: { start: (e: never) => Promise<unknown> } }, on: On, w: World) {
  const clock = mock.clock(on, { now: NOW })
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false } as never)
  await clock.advance(50)
  return clock
}

const boardRow = (over: Partial<BoardRow>): BoardRow => ({
  id: 'local_x', tag: null, title: 'A chat', state: 'idle', since: h(1), updatedAt: h(1), ask: null, recap: '', lastCommit: null, context: null,
  isStalled: false, isFresh: false, isSelf: false, isUnreported: false, model: '', effort: '', turnClass: null, isCapped: false, ...over,
})

test('the kanban: a chat holds the column its state says, a pin holds an idle one, hand cards start in Planned', () => {
  const waiting = boardRow({ id: 'local_g3e', title: 'G3e', state: 'waiting-you', since: h(19), ask: { question: 'Start?', buttons: ['Yes'] } })
  const working = boardRow({ id: 'local_quay', title: 'N1d-C quay', state: 'working', since: h(0.25), model: 'claude-opus-5-5', effort: 'high' })
  const shipped = boardRow({ id: 'local_vault', title: 'Vault v2', lastCommit: { hash: 'abc1234def', subject: 'Vault: belts', at: h(3) } })
  const talked = boardRow({ id: 'local_plan', title: 'Plan review' })
  const stale = boardRow({ id: 'local_old', title: 'Old chat', lastCommit: { hash: 'ffff000', subject: 'old', at: h(200) } })
  expect([waiting, working, shipped, talked, stale].map(r => autoColumn(r, NOW))).toEqual(['waiting', 'building', 'review', null, null])
  expect(autoColumn({ ...working, isStalled: true }, NOW)).toBe(null)

  const view: BoardView = { at: NOW, header: { usage: null, uncommitted: null, lastCommit: null }, groups: { waiting: [waiting], working: [working], recent: [shipped, talked], quiet: [stale] } }
  const hand = newCard('  N2 loot   site concept ', NOW)
  expect([hand.title, hand.pin, hand.rowId]).toEqual(['N2 loot site concept', 'planned', null])
  const pins: CardFile[] = [
    hand,
    { schema: 1, id: rowCardId('local_plan'), title: 'Plan review', rowId: 'local_plan', pin: 'done', createdAt: h(1), updatedAt: h(1) },
    // a pin on a live chat waits: its state wins while it works or waits
    { schema: 1, id: rowCardId('local_g3e'), title: 'G3e', rowId: 'local_g3e', pin: 'done', createdAt: h(1), updatedAt: h(1) },
    // a pinned chat the app no longer lists keeps its card
    { schema: 1, id: rowCardId('local_gone'), title: 'Archived chat', rowId: 'local_gone', pin: 'done', createdAt: h(9), updatedAt: h(9) },
  ]
  const k = kanban(view, pins)
  expect(k.planned.map(i => i.title)).toEqual(['N2 loot site concept'])
  expect(k.building.map(i => [i.title, i.isLive, i.fact])).toEqual([['N1d-C quay', true, '15m · Opus 5.5 high']])
  expect(k.waiting.map(i => [i.title, i.isLive, i.fact])).toEqual([['G3e', true, 'Start?']])
  expect(k.review.map(i => [i.title, i.fact, i.isPinned])).toEqual([['Vault v2', 'abc1234 Vault: belts', false]])
  expect(k.done.map(i => i.title)).toEqual(['Plan review', 'Archived chat'])

  // a move writes the chat's card on its first pin, and rewrites a card that exists
  const moved = pinned(k.review[0]!, pins, 'done', NOW)
  expect([moved.id, moved.rowId, moved.pin, moved.title]).toEqual(['row-local_vault', 'local_vault', 'done', 'Vault v2'])
  expect(pinned(k.planned[0]!, pins, 'building', NOW)).toEqual({ ...hand, pin: 'building' })
  expect([shift('planned', -1), shift('planned', 1), shift('review', 1), shift('done', 1)]).toEqual([null, 'building', 'done', null])
  // a card file reads back as written; a half-written one is skipped
  expect(parseCard(serializeCard(moved))).toEqual(moved)
  expect(parseCard('{"schema": 1, "id": "row-x", "tit')).toBe(null)
  expect(serializeCard(moved).startsWith('{\n  "schema": 1,\n  "id": "row-local_vault",\n  "title": "Vault v2",\n  "rowId": "local_vault",\n  "pin": "done",')).toBe(true)
})

test('what the cards show: bars and their tones, the filter, recap lines, the glance, the prompts the buttons send', () => {
  expect([toneOf(74), toneOf(75), toneOf(90)]).toEqual([undefined, 'warning', 'error'])
  const header = { usage: [{ label: 'Weekly · all models', pct: 78, resetsIn: '2d 9h' }, { label: 'Session', pct: 5, resetsIn: '3h' }], uncommitted: null, lastCommit: null }
  expect(usageBars(header)).toEqual([{ key: 'usage-0', label: 'Week · all models', pct: 78, valueText: '78 % · resets in 2d 9h', tone: 'warning' }])
  expect(usageBars({ ...header, usage: null })).toEqual([])
  const fresh = boardRow({ id: 'a', isFresh: true })
  const wait = boardRow({ id: 'b', title: 'G3e stage 2', tag: 'G3e', state: 'waiting-you', ask: { question: 'Start **building**?', buttons: ['Yes, build it'] } })
  const g = { waiting: [wait], working: [boardRow({ id: 'c', state: 'working' })], recent: [fresh, boardRow({ id: 'd' })], quiet: [] }
  expect(Object.values(filterGroups(g, 'needs-me')).map(x => x.length)).toEqual([1, 0, 0, 0])
  expect(Object.values(filterGroups(g, 'working')).map(x => x.length)).toEqual([0, 1, 0, 0])
  expect(filterGroups(g, 'fresh').recent.map(r => r.id)).toEqual(['a'])
  expect(filterGroups(g, 'all')).toBe(g)
  expect(recapLines('- One.\n\n**Two** is [here](#local_x).\nThree.\nFour.')).toEqual(['One.', 'Two is here.', 'Three.'])
  expect(recapLines('One.\nTwo.', 0)).toEqual(['One.', 'Two.'])
  expect(glance({ at: NOW, header, groups: g })).toBe('1 waiting · 1 working · week 78 %')
  // a card's age stands beside its name; its facts are the model and the last commit
  const shipped = boardRow({ id: 'e', updatedAt: h(2), model: 'claude-opus-5-5', effort: 'high', turnClass: 'build', lastCommit: { hash: 'abc1234def', subject: 'Vault: belts', at: h(3) } })
  expect([cardAge(wait, NOW), cardAge(shipped, NOW), cardFacts(shipped), cardFacts(boardRow({}))]).toEqual(['waiting 1h', 'idle 2h', 'Opus 5.5 high · turn: build · commit abc1234 Vault: belts', ''])
  expect(gitFacts({ usage: null, uncommitted: { changed: 113, untracked: 3232 }, lastCommit: { hash: '33ba9eb', subject: 'SLIP 7: the rack', at: h(1) } })).toEqual({ counts: '3345 uncommitted · 113 changed · 3232 new', last: 'last commit 33ba9eb SLIP 7: the rack' })
  expect(gitFacts({ usage: null, uncommitted: null, lastCommit: null })).toEqual({ counts: 'uncommitted: unknown', last: 'last commit unknown' })
  // what holds the pane's sends: its own prompt until the turn ends (a minute at most with no turn), or any running turn
  const sentNow = { text: 'Brief me on **Vault v2**', at: NOW }
  expect([busyWith(null, false, NOW), busyWith(null, true, NOW), busyWith(sentNow, false, NOW + 59_000), busyWith(sentNow, false, NOW + 61_000), busyWith(sentNow, true, NOW + 300_000)]).toEqual([null, 'a turn in the chat', 'Brief me on Vault v2', null, 'Brief me on Vault v2'])
  // the director is the row `/director` tagged, or one the mod's store names (a /clear can drop the tag)
  expect(directorRow(g, 'Director')).toBe(null)
  expect(directorRow(g, 'Director', ['d'])?.id).toBe('d')
  expect(directorRow({ ...g, quiet: [boardRow({ id: 'q', tag: 'Director' })] }, 'Director')?.id).toBe('q')
  // the Models tab: the dearest model first, quiet chats left out, a chat with no model last
  const onModel = (id: string, model: string, effort: string, turnClass: string | null = null) => boardRow({ id, title: id, model, effort, turnClass })
  const groups = modelGroups({ waiting: [onModel('w1', 'claude-opus-5-5', 'high')], working: [onModel('k1', 'claude-fable-5-2', 'xhigh', 'build')], recent: [onModel('r1', 'claude-sonnet-5-5', 'low', 'chore'), onModel('r2', 'claude-opus-5-5', 'medium'), onModel('r3', '', '')], quiet: [onModel('q1', 'claude-haiku-5-5', 'low')] })
  expect(groups.map(x => `${x.model}: ${x.rows.map(r => `${r.name} ${r.facts}`.trim()).join(', ')}`)).toEqual(['Fable 5.2: k1 xhigh · turn: build', 'Opus 5.5: w1 high, r2 medium', 'Sonnet 5.5: r1 low · turn: chore', 'Model unknown: r3'])
  expect(briefPrompt(wait)).toContain('Brief me on "G3e stage 2" [b]')
  expect(answerPrompt(wait, 'Yes, build it')).toBe('"G3e stage 2" [b] is waiting on me: "Start building?". My answer: "Yes, build it". Pass it on to that chat now, quoting my answer word for word, then write the note.')
})

test('the pane has tabs: the board with a filter, the kanban with moves and hand cards, notes with a field, models', async ($, on) => {
  const w = world()
  await start($ as never, on, w)
  await $.command.run(cmd('studio'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane(), surface })
    // the board is the first tab; its button counts the waits; a worker chat's cards have no director buttons
    expect((await ui.find({ type: 'Button', key: 'tab-board' }))?.text).toBe('Board (1)')
    expect((await ui.find({ type: 'Text', text: /^Working now/ }))?.text).toBe('Working now (1)')
    expect((await ui.find({ type: 'Text', text: /^working 15m$/ }))?.text).toBe('working 15m')
    expect((await ui.find({ type: 'Text', text: /turn: build/ }))?.text).toBe('Opus 5.5 high · turn: build')
    expect(await ui.find({ type: 'Button', key: 'brief-local_vault' })).toBe(undefined)
    expect(await ui.find({ type: 'Button', key: 'become' })).toBe(undefined) // this chat has run a turn
    // a recap shows two lines until "more" is pressed
    expect((await ui.find({ type: 'Text', text: /^Belts are in/ }))?.text).toBe('Belts are in.')
    expect(await ui.find({ type: 'Text', text: /^The walk build/ })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: /^Shots are in/ })).toBe(undefined)
    await ui.press({ key: 'recap-local_vault' })
    expect((await ui.find({ type: 'Text', text: /^Shots are in/ }))?.text).toBe('Shots are in docs/vault_shots.')
    await ui.press({ key: 'recap-local_vault' })
    // the filter
    await ui.select({ key: 'filter', value: 'needs-me' })
    expect((await ui.find({ type: 'Text', text: /^Working now/ }))?.text).toBe('Working now (0)')
    expect((await ui.find({ type: 'Text', text: /^Waiting on you/ }))?.text).toBe('Waiting on you (1)')
    await ui.select({ key: 'filter', value: 'all' })
    await ui.unmount()
  }

  // the kanban, wide: five columns side by side
  const ui = await $.ui.mount({ ...pane(110), surface: 'desktop' })
  await ui.press({ key: 'tab-kanban' })
  const titles = async () => (await ui.findAll({ type: 'Text', text: /^(Planned|Building|Waiting on you|Review|Done) \(\d+\)$/ })).map(t => t.text)
  expect(await titles()).toEqual(['Planned (0)', 'Building (1)', 'Waiting on you (1)', 'Review (1)', 'Done (0)'])
  // a live chat holds its column: nothing to press on it
  expect(await ui.find({ type: 'Button', key: 'kb-done-row-local_g3e' })).toBe(undefined)
  expect(await ui.find({ type: 'Button', key: 'kb-right-row-local_quay' })).toBe(undefined)
  // Vault v2 is up for review (a commit 3 h ago): done moves it, and the move is a file
  await ui.press({ key: 'kb-done-row-local_vault' })
  expect(await titles()).toEqual(['Planned (0)', 'Building (1)', 'Waiting on you (1)', 'Review (0)', 'Done (1)'])
  expect(JSON.parse(w.files[`${STUDIO}/cards/row-local_vault.json`] ?? '{}')).toEqual({ schema: 1, id: 'row-local_vault', title: 'Vault v2', rowId: 'local_vault', pin: 'done', createdAt: new Date(NOW + 50).toISOString(), updatedAt: new Date(NOW + 50).toISOString() })
  await ui.press({ key: 'kb-left-row-local_vault' })
  expect(await titles()).toEqual(['Planned (0)', 'Building (1)', 'Waiting on you (1)', 'Review (1)', 'Done (0)'])
  // a card added by hand starts in Planned and moves by its buttons
  await ui.input({ key: 'card-0', text: 'N2 loot site concept' })
  expect(await titles()).toEqual(['Planned (1)', 'Building (1)', 'Waiting on you (1)', 'Review (1)', 'Done (0)'])
  const file = Object.keys(w.files).find(p => p.startsWith(`${STUDIO}/cards/card-`)) ?? ''
  const card = JSON.parse(w.files[file] ?? '{}') as CardFile
  expect([card.title, card.pin, card.rowId]).toEqual(['N2 loot site concept', 'planned', null])
  expect((await ui.find({ type: 'Input' }))?.key).toBe('card-1') // the field comes back empty
  await ui.press({ key: `kb-right-${card.id}` })
  expect(await titles()).toEqual(['Planned (0)', 'Building (2)', 'Waiting on you (1)', 'Review (1)', 'Done (0)'])
  expect((JSON.parse(w.files[file] ?? '{}') as CardFile).pin).toBe('building')
  // `/studio card` adds one too
  const added = (await $.command.run(cmd('studio', 'card G5 stage 5'))) as { text: string }
  expect(added.text).toContain('Card added to Planned: G5 stage 5 (docs/studio/cards/card-')
  expect(await titles()).toEqual(['Planned (1)', 'Building (2)', 'Waiting on you (1)', 'Review (1)', 'Done (0)'])
  await ui.unmount()

  // narrow: three columns side by side, Planned and Done folded under them
  const narrow = await $.ui.mount({ ...pane(80), surface: 'desktop' })
  expect((await narrow.findAll({ type: 'Text', text: /^(Planned|Building|Waiting on you|Review|Done) \(\d+\)$/ })).map(t => t.text)).toEqual(['Building (2)', 'Waiting on you (1)', 'Review (1)'])
  expect((await narrow.find({ type: 'Button', key: 'kb-fold-planned' }))?.text).toBe('▸ Planned (1)')
  expect(await narrow.find({ type: 'Text', text: /^G5 stage 5$/ })).toBe(undefined)
  await narrow.press({ key: 'kb-fold-planned' })
  expect((await narrow.find({ type: 'Text', text: /^G5 stage 5$/ }))?.text).toBe('G5 stage 5')

  // notes: the last lines, and a field that adds one
  await narrow.press({ key: 'tab-notes' })
  expect((await narrow.find({ type: 'Markdown' }))?.props.text).toBe('- 2026-11-16 09:00: G3e waits for the plan OK.')
  await narrow.input({ key: 'note-2', text: 'Vault v2 walk build   approved.' })
  expect(w.files[`${STUDIO}/notes.md`]).toContain(': Vault v2 walk build approved.\n')
  expect(String((await narrow.find({ type: 'Markdown' }))?.props.text).split('\n').length).toBe(2)
  expect((await narrow.find({ type: 'Input' }))?.key).toBe('note-3')

  // models: the chats under the model they run on, each with its effort and turn class
  await narrow.press({ key: 'tab-models' })
  expect((await narrow.find({ type: 'Text', text: /^Opus 5\.5 \(\d+\)$/ }))?.text).toBe('Opus 5.5 (5)')
  expect((await narrow.find({ type: 'Text', text: /^N1d-C quay$/ }))?.text).toBe('N1d-C quay')
  expect((await narrow.find({ type: 'Text', text: /turn: build/ }))?.text).toBe('high · turn: build')
  await narrow.unmount()
})

test('a long Recent group shows its newest 8 until it is unfolded', async ($, on) => {
  const w = world()
  for (let i = 0; i < 9; i++) {
    w.files[`${STUDIO}/sessions/local_old${i}.json`] = report({ appId: `local_old${i}`, cliId: `cli-old${i}`, title: `Older chat ${i}`, updatedAt: h(10 + i) })
  }
  w.files[`${STUDIO}/sessions/local_g3e.json`] = report({ appId: 'local_g3e', cliId: 'cli-g3e', title: 'G3e', updatedAt: h(30) })
  const sessions = ['local_g3e', 'local_vault', 'local_quay', 'local_plan', ...Array.from({ length: 9 }, (_, i) => `local_old${i}`)]
  w.list = JSON.stringify(sessions.map(id => listed(id, id, 1)))
  await start($ as never, on, w)
  await $.command.run(cmd('studio'))
  const ui = await $.ui.mount({ ...pane(), surface: 'desktop' })
  // 13 recent: this chat, Vault v2, Plan review, G3e and nine older ones
  expect((await ui.find({ type: 'Text', text: /^Recent, last 72 h/ }))?.text).toBe('Recent, last 72 h (13)')
  const older = async () => (await ui.findAll({ type: 'Text', text: /^Older chat \d$/ })).length
  expect(await older()).toBe(5)
  expect((await ui.find({ type: 'Button', key: 'recent-more' }))?.text).toBe('▸ 5 older')
  await ui.press({ key: 'recent-more' })
  expect(await older()).toBe(9)
  expect((await ui.find({ type: 'Button', key: 'recent-more' }))?.text).toBe('▾ Show the newest only')
  await ui.unmount()
})

test('minimized to a widget the pane is a glance; `/studio` draws the board in the transcript', async ($, on) => {
  const w = world()
  await start($ as never, on, w)
  const out = (await $.command.run(cmd('studio'))) as { text: string }
  const widget = await $.ui.mount({ ...pane(40, 'widget'), surface: 'desktop' })
  expect((await widget.findAll({ type: 'Text' })).map(t => t.text)).toEqual(['Studio · 1 waiting · 1 working · week 78 %', "G3e: the Warden's sounds: Start building G3e on this plan?"])
  expect(await widget.find({ type: 'Button' })).toBe(undefined)
  await widget.unmount()

  for (const surface of ['terminal', 'desktop'] as const) {
    const row = await $.ui.mount({ ...output('studio', '', out.text), surface })
    expect((await row.find({ type: 'Text', text: /^Waiting on you/ }))?.text).toBe('Waiting on you (1)')
    expect((await row.find({ type: 'Text', text: /^Start building/ }))?.text).toBe('Start building G3e on this plan?')
    // Recent holds this chat's own row too
    expect((await row.find({ type: 'Text', text: /^Working now/ }))?.text).toBe('Working now (1) · Recent, last 72 h (3) · Quiet (0)')
    // (a Progress reads here as its label and figure)
    expect((await row.findAll({ type: 'Text', text: /^Week · / })).map(t => t.text)).toEqual(['Week · all models 78 % · resets in 2d 9h', 'Week · Fable 23 % · resets in 2d 9h'])
    expect((await row.find({ type: 'Text', text: /board pane/ }))?.text).toBe('The board pane is open beside the chat.')
    await row.unmount()
  }
})

test('in the director chat the pane drives the chat: its cards and its field send a prompt after a fresh snapshot', async ($, on) => {
  const w = world()
  w.turns = 0
  const clock = await start($ as never, on, w)
  // a chat with no turn yet may become the director from the pane
  await $.command.run(cmd('studio'))
  const fresh = await $.ui.mount({ ...pane(), surface: 'desktop' })
  expect((await fresh.find({ type: 'Button', key: 'become' }))?.text).toBe('Make this chat the Director')
  await fresh.press({ key: 'become' })
  await clock.advance(50)
  await fresh.unmount()
  // the first turn: the full snapshot as a hidden row, then the first prompt
  expect(w.rows.length).toBe(1)
  expect(w.rows[0]).toContain('user: <studio-snapshot kind="full"')
  expect(w.prompts.map(p => p.text)).toEqual(['Read the board, then tell me where we stand.'])
  expect((await $.prompt.compose(COMPOSE)).sections.map(s => s.id)).toEqual(['intro', 'studio:director'])

  const ui = await $.ui.mount({ ...pane(), surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^This chat is the Director$/ }))?.text).toBe('This chat is the Director')
  expect(await ui.find({ type: 'Button', key: 'become' })).toBe(undefined)
  expect((await ui.find({ type: 'Text', text: /^Director context / }))?.text).toBe('Director context 140k of 600k (it clears itself past the line)')
  // a waiting card: one button per answer, and Brief me
  expect((await ui.findAll({ type: 'Button', text: /^Answer: / })).map(b => `${b.key}: ${b.text}`)).toEqual(['answer-local_g3e-0: Answer: Yes, build it', 'answer-local_g3e-1: Answer: Not now'])
  await ui.press({ key: 'answer-local_g3e-0' })
  expect(w.rows.length).toBe(2)
  expect(w.rows[1]).toContain('<studio-snapshot kind="changes"')
  expect(w.prompts.at(-1)?.text).toBe(`"G3e: the Warden's sounds" [local_g3e] is waiting on me: "Start building G3e on this plan?". My answer: "Yes, build it". Pass it on to that chat now, quoting my answer word for word, then write the note.`)
  expect(w.toasts.at(-1)).toBe('studio: sent to the director chat')

  // one send at a time (the user's "Brief me" went twice, 2.4 s apart, 2026-11-16): while the
  // director answers, the pane says so, and neither a card nor the Ask field can send
  let turns = 0
  const directorAnswers = async () => {
    const turnId = `b${turns++}`
    await $.turn.start({ text: 'x', turnId } as never)
    await $.turn.complete({ answer: 'Done.', durationMs: 5, isAborted: false, turnId, reason: 'answer' } as never)
    await clock.advance(50)
  }
  expect((await ui.find({ type: 'Text', text: /^The director is answering/ }))?.text).toContain('is waiting on me')
  expect(await ui.find({ type: 'Button', key: 'brief-local_vault' })).toBe(undefined)
  expect(await ui.find({ type: 'Button', key: 'answer-local_g3e-1' })).toBe(undefined)
  expect((await ui.find({ type: 'Text', text: /Yes, build it \| Not now/ }))?.text).toBe('[Yes, build it | Not now]')
  await ui.press({ key: 'tab-ask' })
  expect(await ui.find({ type: 'Input' })).toBe(undefined)
  expect((await ui.find({ type: 'Text', text: /The field comes back/ }))?.text).toContain('The director is answering: "G3e')
  await ui.press({ key: 'tab-board' })
  // its turn ends: the buttons are back
  await directorAnswers()
  expect(await ui.find({ type: 'Text', text: /^The director is answering/ })).toBe(undefined)
  await ui.press({ key: 'brief-local_vault' })
  expect(w.prompts.at(-1)?.text).toContain('Brief me on "Vault v2" [local_vault]')
  expect(w.rows.length).toBe(3)
  await directorAnswers()

  // the Ask tab's field sends to the chat itself; switched to the quick ask it asks the board with no turn
  await ui.press({ key: 'tab-ask' })
  expect((await ui.find({ type: 'Text', text: /^Message the Director$/ }))?.text).toBe('Message the Director')
  const field = (await ui.find({ type: 'Input' }))?.key ?? ''
  expect(field.startsWith('send-')).toBe(true)
  const sent = w.prompts.length
  await ui.input({ key: field, text: '  What should I look at first?  ' })
  expect(w.prompts.length).toBe(sent + 1)
  expect(w.prompts.at(-1)?.text).toBe('What should I look at first?')
  expect(w.rows.at(-1)).toContain('<studio-snapshot')
  await directorAnswers()
  await ui.input({ key: (await ui.find({ type: 'Input' }))?.key ?? '', text: '   ' }) // a blank message sends nothing
  expect(w.prompts.length).toBe(sent + 1)
  await ui.select({ key: 'ask-mode', value: 'quick' })
  expect((await ui.find({ type: 'Text', text: /^Ask the board$/ }))?.text).toBe('Ask the board')
  expect((await ui.find({ type: 'Input' }))?.key).toBe('ask-0')
  await ui.unmount()

  // the user's own prompt still carries its snapshot the usual way, once
  await $.prompt.submit(typed('and now?'))
  expect(w.prompts.at(-1)?.context.length).toBe(1)
  expect(w.prompts.at(-1)?.context[0]).toContain('<studio-snapshot kind="changes"')

  // the director is in the mod's store by its app id, so another chat's pane can name it;
  // one the store doesn't know (a chat made the director before stage 5) is written at its next turn
  expect(Object.keys((w.store.directors ?? {}) as object)).toEqual(['local_self'])
  delete w.store.directors
  await $.turn.start({ text: 'and now?', turnId: 't1' } as never)
  await clock.advance(50)
  expect(Object.keys((w.store.directors ?? {}) as object)).toEqual(['local_self'])
})

test('/director in a used chat offers one button; only the press (or /director fresh) clears the chat and makes it the director', async ($, on) => {
  const w = world()
  w.messages = [{ role: 'user' }, { role: 'assistant' }]
  const clock = await start($ as never, on, w)
  const used = (await $.command.run(cmd('director'))) as { text: string }
  expect(used.text).toContain('Press the button under this line')
  await clock.advance(50)
  expect([w.cleared, w.prompts.length]).toEqual([0, 0])
  // a chat that has replies can't become the director from the pane either
  await $.command.run(cmd('studio'))

  const row = await $.ui.mount({ ...output('director', '', used.text), surface: 'desktop' })
  expect((await row.find({ type: 'Button', key: 'director-fresh' }))?.text).toBe('Clear this chat and make it the director')
  await row.press({ key: 'director-fresh' })
  await clock.advance(50)
  expect(w.cleared).toBe(1)
  expect(w.rows.at(-1)).toContain('user: <studio-snapshot kind="full"')
  expect(w.prompts.map(p => p.text)).toEqual(['Read the board, then tell me where we stand.'])
  expect((await $.prompt.compose(COMPOSE)).sections.map(s => s.id)).toEqual(['intro', 'studio:director'])
  expect((JSON.parse(w.files[`${STUDIO}/sessions/local_self.json`] ?? '{}') as { tag?: string }).tag).toBe('Director')
  // the offer is gone from the row, and the guard is on
  expect(await row.find({ type: 'Button', key: 'director-fresh' })).toBe(undefined)
  await row.unmount()
  expect(String(((await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/scripts/player.gd`, old_string: 'a', new_string: 'b' } as never)) as { deny?: unknown }).deny)).toContain('The director plans; a milestone chat builds')

  // /director off: the mark, the tag, the guard and the snapshots go
  expect(((await $.command.run(cmd('director', 'off', 'plugin'))) as { text: string }).text).toContain("the user's own command")
  const off = (await $.command.run(cmd('director', 'off'))) as { text: string }
  expect(off.text).toContain('no longer the Studio director')
  expect((await $.prompt.compose(COMPOSE)).sections.map(s => s.id)).toEqual(['intro'])
  expect((JSON.parse(w.files[`${STUDIO}/sessions/local_self.json`] ?? '{}') as { tag?: string | null }).tag).not.toBe('Director')
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/scripts/player.gd`, old_string: 'a', new_string: 'b' } as never)
  expect(w.ran).toEqual(['Edit'])
  await $.prompt.submit(typed('hello'))
  expect(w.prompts.at(-1)?.context).toEqual([])
  expect(((await $.command.run(cmd('director', 'off'))) as { text: string }).text).toBe('This chat is not the Studio director.')

  // typed: /director fresh clears a used chat with no button
  w.messages = [{ role: 'user' }, { role: 'assistant' }]
  expect(((await $.command.run(cmd('director', 'fresh'))) as { text: string }).text).toBe('Clearing this chat and making it the Studio director.')
  await clock.advance(50)
  expect(w.cleared).toBe(2)
  expect(w.prompts.at(-1)?.text).toBe('Read the board, then tell me where we stand.')
  expect(((await $.command.run(cmd('director'))) as { text: string }).text).toContain('already the Studio director')
})
