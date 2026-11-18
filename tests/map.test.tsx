import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { buildGraph, claudePart, commitsPart, docPart, masterPlanPart, memoryPart, notesPart, reportsPart, statusPart, topicsPart } from '../hooks/graph'
import { HOME, centerLines, homeView, jumpOptions, mapLayout, mapSvg, mapView, moves, nextTrail, reminderBrief } from '../hooks/map'
import { mapHtml } from '../hooks/maphtml'
import { reminderFor } from '../hooks/recall'
import { OTHER, PLAN_HOME, codeOfTag, findArea, planAreas, planItems, planJump, planSummary, planSvg, planView, startPrompt } from '../hooks/plan'
import type { PlanItem } from '../hooks/plan'
import type { BoardRow, BoardView, CardFile, Report } from '../types'

// The map (stage 9): the mind map's branches for three topics hold what their
// files say, the SVG marks guessed links, the pane's Map tab moves its focus by
// buttons, and the full map is one self-contained page written outside the repo.
const ROOT = 'E:/Godot Games/scrap-shift'
const STUDIO = `${ROOT}/docs/studio`
const HOME_DIR = 'C:/Users/test'
const PROJ = `${HOME_DIR}/.claude/projects/E--Godot-Games-scrap-shift`
const MEM = `${PROJ}/memory`
const NOW = Date.parse('2026-11-16T10:00:00Z')
const h = (n: number) => new Date(NOW - n * 3_600_000).toISOString()

const PLAN = '# Master Plan\n\n- [milestones_g](plan/milestones_g.md) — Milestones G\n  - G3 — The Warden overhaul\n  - G5 — The shopping cart (9–12 sessions)\n'
const MILESTONES = '# Milestones G\n\n## G5 — The shopping cart\n\nThe cart is a crew item.\n\n## G3 — The Warden overhaul\n\nRagdolls.\n'
const STATUS = "## 6. Status\n\n- **2026-11-15 (G5's building chat): stage 5, the cart's sounds, accepted by the user.**\n  - Takes are CC0 recordings.\n"
const CART = '# The cart (G5)\n\n## Stage 5 — sound\n\nWheels rattle on the yard.\n\n## Stage 6 — the Warden\n\nThe Warden hears a loud cart.\n'
const CLAUDE = '# Scrapshift\n\n## Game rules\n- **No code-synthesized sounds** (user rule): Stable Audio Open and ElevenLabs takes.\n'
const NOTES = '# Studio notes\n\n- 2026-11-16 09:00: Carts never roll on their own on slopes [about: G5]\n'
const SFX = '---\nname: feedback-no-synth-sfx\ndescription: No code-synthesized sound effects; real recordings or ElevenLabs only\nmetadata:\n  type: feedback\n---\n\nBody. [[feedback-sounds-must-fit]]\n'
const FIT = '---\nname: feedback-sounds-must-fit\ndescription: Every sound must make physical sense for where it plays\nmetadata:\n  type: feedback\n---\n\nBody.\n'
const MEMORY_INDEX = '- [No synthesized SFX](feedback-no-synth-sfx.md) — real takes\n- [Sounds must fit](feedback-sounds-must-fit.md) — fit\n'
const report = (over: Partial<Report>): Report => ({
  schema: 2, appId: 'local_x', cliId: 'c', title: 'A chat', tag: null, tagSource: null, state: 'idle', stateSince: h(1), updatedAt: h(1), turns: 1,
  recap: '', ask: null, lastCommit: null, context: null, model: 'claude-opus-5-5', effort: 'high', turnClass: null, classMs: null, routings: [], cwd: ROOT, ...over,
})
const REPORTS: Report[] = [
  report({ appId: 'local_g5', title: 'G5 stage 6: the Warden and the cart', tag: 'G5', state: 'working', updatedAt: h(0.1), lastCommit: { hash: '9460a2d000', subject: 'G5 stages 3-6b: the cart', at: h(3) } }),
  report({ appId: 'local_g3e', title: "G3e: the Warden's sounds", tag: 'G3e', state: 'waiting-you', ask: { question: 'Play G3e yourself now?', buttons: ['Play it'] } }),
]

function graph() {
  return buildGraph(
    [
      topicsPart(),
      masterPlanPart('docs/MASTER_PLAN.md', PLAN),
      docPart('docs/MASTER_PLAN.md', PLAN),
      docPart('docs/plan/milestones_g.md', MILESTONES),
      docPart('docs/plan/status_09.md', STATUS),
      statusPart('docs/plan/status_09.md', STATUS),
      docPart('docs/CART.md', CART),
      claudePart('CLAUDE.md', CLAUDE),
      notesPart('docs/studio/notes.md', NOTES),
      memoryPart('feedback-no-synth-sfx.md', SFX, 'No synthesized SFX'),
      memoryPart('feedback-sounds-must-fit.md', FIT, 'Sounds must fit'),
      reportsPart(REPORTS),
      commitsPart('9460a2d\x1fG5 stages 3-6b: the cart\x1f2026-11-16T07:00:00+03:00\n'),
    ],
    NOW,
  )
}

const branch = (v: ReturnType<typeof mapView>, key: string) => v?.branches.find(b => b.key === key)
const items = (v: ReturnType<typeof mapView>, key: string) => branch(v, key)?.items.map(i => [i.label, i.source, i.conf]) ?? []

test('three topics: each branch holds what its files say, each item with its source and how sure its link is', () => {
  const g = graph()

  // audio: the rules from the memory folder and CLAUDE.md, the status entry, the CART section, the G3e chat
  const audio = mapView(g, 'topic:audio')
  expect(audio?.label).toBe('audio')
  expect(items(audio, 'rules')).toEqual([
    ['No synthesized SFX', 'memory feedback-no-synth-sfx.md', 'inferred'],
    ['Sounds must fit', 'memory feedback-sounds-must-fit.md', 'inferred'],
    ['No code-synthesized sounds (user rule): Stable Audio Open and ElevenLabs takes.', 'CLAUDE.md:4', 'inferred'],
  ])
  expect(items(audio, 'decisions')).toEqual([["2026-11-15 (G5's building chat): stage 5, the cart's sounds, accepted by the user.", 'docs/plan/status_09.md:3', 'inferred']])
  expect(items(audio, 'docs')).toEqual([['CART.md §Stage 5 — sound', 'docs/CART.md:3', 'inferred']])
  expect(items(audio, 'chats')).toEqual([["G3e: the Warden's sounds", 'report', 'inferred']])
  expect(audio?.branches.filter(b => b.side === 'left').map(b => b.key)).toEqual(['chats', 'asks'])

  // the cart: the doc named after it (stated sections hang off the doc), the G5 chat by its title
  const cart = mapView(g, 'topic:cart')
  expect(items(cart, 'docs').map(x => x[1])).toContain('docs/CART.md:1')
  expect(items(cart, 'chats')).toEqual([['G5 stage 6: the Warden and the cart', 'report', 'inferred']])

  // G5: its workstream's chat and commit come with it; the note tagged [about: G5] is stated; its plan section
  const g5 = mapView(g, 'milestone:G5')
  expect(items(g5, 'milestones')).toEqual([['G5', 'reports (chat tags)', 'inferred']])
  expect(items(g5, 'chats')).toEqual([['G5 stage 6: the Warden and the cart', 'report', 'extracted']]) // its tag G5 states it
  expect(items(g5, 'commits')).toEqual([['9460a2d G5 stages 3-6b: the cart', 'git', 'extracted']]) // the chat's own commit
  expect(items(g5, 'decisions')).toEqual([
    ['Carts never roll on their own on slopes', 'docs/studio/notes.md:3', 'extracted'],
    ["2026-11-15 (G5's building chat): stage 5, the cart's sounds, accepted by the user.", 'docs/plan/status_09.md:3', 'inferred'],
  ])
  expect(items(g5, 'docs').map(x => [x[0], x[2]])).toContainEqual(['milestones_g.md', 'extracted'])

  // the reminder beside the map is recall's own text
  expect(reminderFor(g, 'topic:audio')).toContain('No synthesized SFX: No code-synthesized sound effects')
  expect(reminderFor(g, 'topic:audio')).toContain('**rules that apply:**')
  expect(mapView(g, 'no-such-node')).toBeNull()
})

test("the SVG, as the sketch: the focus in the middle, a box per branch with its count, dashed lines for guessed branches, the names in each box's title", () => {
  const g = graph()
  const v = mapView(g, 'milestone:G5')
  if (v === null) throw new Error('no view')
  const svg = mapSvg(v)
  expect(svg.source.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
  expect(svg.source).toContain('>G5: The shopping cart</text>')
  expect(centerLines('METRO 9 night pass: the far districts', 160, 14)).toEqual(['METRO 9 night', 'pass: the far districts']) // a long one on two lines, uncut
  expect(svg.source).toContain('>Decisions (2)</text>')
  expect(svg.source).toContain('>Milestone G5</text>') // a branch of one shows its name when it fits whole
  expect(svg.source).toContain('>Chats (1)</text>') // ... and its count when it would be cut
  expect(svg.source).toContain('stroke-dasharray="5 3"') // a branch whose links are all guessed
  expect(svg.source).toContain('• Carts never roll on their own on slopes (decision) · docs/studio/notes.md:3 · stated by a file')
  expect(svg.source).not.toContain('…</text>')
  expect(svg.source.length).toBeLessThan(131_072)
  expect(svg.alt).toContain('Mind map around G5: The shopping cart')

  const home = homeView(g)
  expect(home.label).toBe('Studio')
  expect(home.branches.length).toBe(g.clusters.length > 8 ? 8 : g.clusters.length)
  expect(mapView(g, HOME)?.branches.map(b => b.label)).toEqual(home.branches.map(b => b.label))

  // beside the map, short: the sketch's kinds, two names each, no dates
  expect(reminderBrief(v, null)).toEqual([
    "decisions: Carts never roll on their own on slopes · stage 5, the cart's sounds, accepted by the…",
    'docs: milestones_g.md · milestones_g.md §G5 — The shopping cart',
    'chats: G5 stage 6: the Warden and the cart',
    'commits: 9460a2d G5 stages 3-6b: the cart',
  ])

  expect(reminderBrief(home, null)[0]).toContain('Pick a cluster')
  // the drawing as wide as its card: beside the reminder in a wide pane, alone in a narrow one
  expect(mapLayout(120)).toEqual({ isSide: true, width: 560 })
  expect(mapLayout(70)).toEqual({ isSide: false, width: 672 })
  expect(mapLayout(40)).toEqual({ isSide: false, width: 440 })
  expect(mapSvg(v, 612).width).toBe(612)
  expect(moves(v).length).toBeGreaterThan(0)
  expect(moves(v).every(m => g.nodes.has(m.id))).toBe(true)
  expect(jumpOptions(g)[0]).toEqual({ value: HOME, label: 'Studio (the clusters)' })
  expect(jumpOptions(g).map(o => o.value)).toContain('topic:audio')
  expect(nextTrail(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
  expect(nextTrail(['a', 'b', 'c'], 'b')).toEqual(['a', 'b'])
  expect(nextTrail(['a'], HOME)).toEqual([])
})

test('the full map is one page with its data inline and no outside script', () => {
  const page = mapHtml(graph(), '2026-11-16 10:00')
  expect(page.startsWith('<!doctype html>')).toBe(true)
  expect(page).toContain('window.STUDIO_MAP = {"nodes":[')
  expect(page).toContain('No synthesized SFX')
  expect(page).not.toMatch(/<script[^>]+src=/)
  expect(page).not.toMatch(/fetch\(|XMLHttpRequest|<link|import\(/) // nothing loaded from anywhere
  expect(page.match(/https?:\/\/[^'"\s]+/g) ?? []).toEqual(['http://www.w3.org/2000/svg']) // the SVG namespace, a name, not a fetch
  expect(page.split('</script>').length).toBe(3) // the data never closes its own script
})

// ---------------------------------------------------------------- the pane

type World = { files: Record<string, string>; writes: string[]; ran: string[][]; toasts: string[] }

function engine(on: On, w: World) {
  mock.env(on, { USERPROFILE: HOME_DIR })
  const norm = (p: string) => p.split('\\').join('/')
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  on('session.id', () => ({ value: 'cli-me' }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.turns', () => ({ value: 1 }))
  on('session.surfaces', () => ({ value: [] }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('mcp.call', (_, e) => {
    const list = JSON.stringify(['local_g5', 'local_g3e', 'local_me'].map(id => ({ sessionId: id, title: id, cwd: ROOT, isArchived: false, isRunning: true, lastActivityAt: h(0.1) })))
    const text = e.tool === 'get_session' ? JSON.stringify({ sessionId: 'local_me', title: 'A worker', model: 'claude-opus-5-5', effort: 'high' }) : e.tool === 'list_sessions' ? list : '{}'
    return { value: { isError: false, content: [{ type: 'text' as const, text }] } }
  })
  on('fs.write', (_, e) => {
    w.files[norm(e.path)] = e.text
    w.writes.push(norm(e.path))
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    const text = w.files[norm(e.path)]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.stat', (_, e) => {
    if (w.files[norm(e.path)] === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false } }
  })
  on('fs.list', (_, e) => {
    const dir = `${norm(e.path).replace(/\/$/, '')}/`
    const names = Object.keys(w.files).filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/'))
    return { value: names.map(p => ({ name: p.slice(dir.length), kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false })) }
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    w.ran.push(argv)
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'explorer.exe') return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv[1] === 'rev-parse' && argv.includes('--git-common-dir')) return ok(`${ROOT}/.git\n`)
    if (argv[1] === 'log' && argv.includes('-60')) return ok('9460a2d\x1fG5 stages 3-6b: the cart\x1f2026-11-16T07:00:00+03:00\n')
    if (argv[1] === 'log') return ok('h0\x1fsubject\x1f2026-11-15T12:00:00+03:00\n')
    return ok('')
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', (_, e) => {
    w.toasts.push(String((e as { text?: unknown }).text ?? e))
    return { value: undefined }
  })
}

const pane = (bodyColumns = 120) =>
  ({
    plugin: 'studio',
    component: 'Pane',
    requestId: 'studio-board',
    props: { title: 'Studio', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  }) as const

test('the Map tab: a mind map with buttons that move its focus, a jump picker, the reminder, and the full map outside the repo', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w: World = {
    files: {
      [`${ROOT}/docs/MASTER_PLAN.md`]: PLAN,
      [`${ROOT}/docs/plan/milestones_g.md`]: MILESTONES,
      [`${ROOT}/docs/plan/status_09.md`]: STATUS,
      [`${ROOT}/docs/CART.md`]: CART,
      [`${ROOT}/CLAUDE.md`]: CLAUDE,
      [`${STUDIO}/notes.md`]: NOTES,
      [`${MEM}/MEMORY.md`]: MEMORY_INDEX,
      [`${MEM}/feedback-no-synth-sfx.md`]: SFX,
      [`${MEM}/feedback-sounds-must-fit.md`]: FIT,
      ...Object.fromEntries(REPORTS.map(r => [`${STUDIO}/sessions/${r.appId}.json`, JSON.stringify(r)])),
    },
    writes: [],
    ran: [],
    toasts: [],
  }
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false } as never)
  await clock.advance(50)
  await $.command.run({ command: 'studio', args: '', origin: { kind: 'composer' } } as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...pane(), surface })
    await ui.press({ key: 'tab-map' })
    await ui.press({ key: 'map-mode-memory' })
    if (surface === 'desktop') {
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props.alt)).toContain('Mind map around Studio')
      expect(svg?.props.isInteractive).toBe(true)
      expect(svg?.props.width).toBe(560)
    } else {
      expect(await ui.find({ type: 'Svg' })).toBe(undefined)
    }
    expect((await ui.find({ type: 'Button', key: 'map-crumb-0' }))?.text).toBe('Studio')
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...pane(), surface: 'desktop' })
  await ui.select({ key: 'map-jump', value: 'milestone:G5' })
  expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toContain('Mind map around G5: The shopping cart')
  expect((await ui.find({ type: 'Button', key: 'map-crumb-1' }))?.text).toBe('› G5: The shopping cart')
  expect((await ui.find({ type: 'Text', text: /^What the director is reminded of$/ }))).toBeDefined()
  // beside the map, short: one line per kind
  expect((await ui.find({ type: 'Text', text: /^decisions: / }))?.text).toContain('Carts never roll on their own on slopes')

  // a button under the map moves the focus; Back returns
  await ui.press({ key: 'map-go-chat:local_g5' })
  expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toContain('Mind map around G5 stage 6: the Warden and the cart')
  expect((await ui.find({ type: 'Button', key: 'map-crumb-2' }))?.text).toBe('› G5 stage 6: the Warden and the cart')
  await ui.press({ key: 'map-back' })
  expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toContain('Mind map around G5: The shopping cart')
  await ui.press({ key: 'map-crumb-0' })
  expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toContain('Mind map around Studio')

  // the full map: written to the graph's own folder, opened through explorer, nothing in the repo
  await ui.press({ key: 'map-open' })
  const page = `${PROJ}/studio-graph/map.html`
  expect(w.files[page]?.startsWith('<!doctype html>')).toBe(true)
  expect(w.ran.find(a => a[0] === 'explorer.exe')).toEqual(['explorer.exe', page.split('/').join('\\')])
  expect(w.toasts.some(t => t.includes('opens in your browser'))).toBe(true)
  expect(w.writes.filter(p => p.startsWith(ROOT) && !p.startsWith(`${STUDIO}/`))).toEqual([])
  expect(w.writes.filter(p => p.includes('/memory/'))).toEqual([])
  await ui.unmount()
})

// ---------------------------------------------------------------- the plan (stage 10)

const row = (over: Partial<BoardRow>): BoardRow => ({
  id: 'local_x', tag: null, title: 'A chat', state: 'idle', since: h(1), updatedAt: h(1), ask: null, recap: '', lastCommit: null, context: null,
  isStalled: false, isFresh: false, isSelf: false, isUnreported: false, model: '', effort: '', turnClass: null, isCapped: false, ...over,
})

test('the plan: chats sit under their milestone by tag, planned cards under theirs, the most urgent first; the drawing marks each state', () => {
  const ms = new Map([['G5', 'G5: The shopping cart'], ['N1', 'N1: The home base'], ['G3', 'G3: The Warden overhaul']])
  const v: BoardView = {
    at: NOW,
    header: { usage: null, uncommitted: null, lastCommit: null },
    groups: {
      waiting: [row({ id: 'local_a', tag: 'G5', title: 'G5 stage 4: sounds', state: 'waiting-you', since: h(2), ask: { question: 'Which fix first?', buttons: ['fix 1', 'fix 2'] } })],
      working: [row({ id: 'local_b', tag: 'N1d', title: 'N1d-C quay', state: 'working', since: h(0.2) })],
      recent: [row({ id: 'local_c', tag: 'G5', title: 'G5 stage 3: wheels', lastCommit: { hash: 'abc1234000', subject: 'G5 stage 3', at: h(5) } })],
      quiet: [
        row({ id: 'local_d', tag: 'G5', title: 'G5 stage 1: the cart', updatedAt: h(200) }),
        row({ id: 'local_e', tag: 'SD8', title: 'Studio stage 8', updatedAt: h(3) }), // outside the plan
      ],
    },
  }
  const cards: CardFile[] = [
    { schema: 1, id: 'card-x-lights', title: "Stage 5: the cart's lights", rowId: null, pin: 'planned', createdAt: h(1), updatedAt: h(1), under: 'G5' },
    { schema: 1, id: 'card-y-loose', title: 'A loose idea', rowId: null, pin: 'planned', createdAt: h(1), updatedAt: h(1) }, // no milestone: kanban only
  ]
  expect(codeOfTag('N1d', ms)).toBe('N1')
  expect(codeOfTag('G5', ms)).toBe('G5')
  expect(codeOfTag('SD8', ms)).toBe(null)

  const all = planItems(v, cards, ms)
  const g5 = planView(all, ms, 'G5')
  if (g5.kind !== 'milestone') throw new Error('not a milestone view')
  expect(g5.items.map(i => [i.title, i.state])).toEqual([
    ['G5 stage 4: sounds', 'waiting'],
    ['G5 stage 3: wheels', 'review'],
    ["Stage 5: the cart's lights", 'planned'],
    ['G5 stage 1: the cart', 'done'],
  ])
  const home = planView(all, ms, PLAN_HOME)
  if (home.kind !== 'home') throw new Error('not home')
  expect(home.milestones.map(m => m.code)).toEqual(['G5', 'N1']) // G5 waits on the user: first; G3 has nothing going on
  expect(planSummary(all)[0]).toBe('1 waiting on you · 1 building · 1 to review · 1 planned')
  expect(planJump(all, ms).slice(0, 3).map(o => o.value)).toEqual(['home', 'G5', 'N1'])

  const svg = planSvg(planView(all, ms, 'G5', 'card-x-lights'), 560)
  expect(planSvg(planView(all, ms, 'G5'), 560).source).toContain('stroke-dasharray="4 3"') // the planned stage is dashed
  expect(svg.source).toContain(`stroke="#AFA9EC" stroke-width="3"`) // the picked one is ringed
  expect(svg.source).toContain('>waiting on you</text>') // the legend
  expect(svg.alt).toContain('Plan map of G5: The shopping cart: G5 stage 4: sounds waiting on you')
  expect(planSvg(home, 560).source).toContain('>G5: The shopping cart</text>')

  const start = startPrompt(g5.items[2] as PlanItem, 'G5: The shopping cart')
  expect(start).toContain('[card card-x-lights]')
  expect(start).toContain('ask me to OK it')
})

test('the Plan view in the pane: milestones, the stages of one, a picked stage, a stage planned from the field', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w: World = {
    files: {
      [`${ROOT}/docs/MASTER_PLAN.md`]: PLAN,
      [`${ROOT}/docs/plan/milestones_g.md`]: MILESTONES,
      [`${ROOT}/CLAUDE.md`]: CLAUDE,
      [`${STUDIO}/notes.md`]: NOTES,
      [`${MEM}/MEMORY.md`]: MEMORY_INDEX,
      ...Object.fromEntries(REPORTS.map(r => [`${STUDIO}/sessions/${r.appId}.json`, JSON.stringify(r)])),
    },
    writes: [],
    ran: [],
    toasts: [],
  }
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false } as never)
  await clock.advance(50)
  await $.command.run({ command: 'studio', args: '', origin: { kind: 'composer' } } as never)

  const ui = await $.ui.mount({ ...pane(), surface: 'desktop' })
  await ui.press({ key: 'tab-map' })
  // the Plan view is the Map tab's first
  expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toContain('Plan map: G3: The Warden overhaul (1 stages), G5: The shopping cart (1 stages)')
  expect((await ui.find({ type: 'Text', text: /^Where things stand$/ }))).toBeDefined()

  await ui.press({ key: 'plan-go-G5' })
  expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toContain('Plan map of G5: The shopping cart: G5 stage 6: the Warden and the cart building')
  expect((await ui.find({ type: 'Button', key: 'plan-crumb-1' }))?.text).toBe('› G5: The shopping cart')

  // a stage planned from the field: a card under G5, dashed on the map
  await ui.input({ key: 'plan-add-0', text: "Stage 7: the cart's lights" })
  const card = Object.keys(w.files).find(p => p.startsWith(`${STUDIO}/cards/card-`))
  expect(JSON.parse(w.files[card ?? ''] ?? '{}')).toMatchObject({ title: "Stage 7: the cart's lights", pin: 'planned', under: 'G5' })
  expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toContain("Stage 7: the cart's lights planned")

  // picking a stage shows its card; a worker chat's pane has no sends
  await ui.press({ key: 'plan-pick-row-local_g5' })
  expect((await ui.find({ type: 'Button', key: 'plan-crumb-2' }))?.text).toBe('› G5 stage 6: the Warden and the cart')
  expect((await ui.find({ type: 'Text', text: /^building · / }))).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'plan-brief' })).toBe(undefined)
  await ui.press({ key: 'plan-back' })
  expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toContain('Plan map: ')

  // the switch: Memory is the stage 9 map
  await ui.press({ key: 'map-mode-memory' })
  expect(String((await ui.find({ type: 'Svg' }))?.props.alt)).toContain('Mind map around Studio')
  expect(w.writes.filter(p => p.startsWith(ROOT) && !p.startsWith(`${STUDIO}/`))).toEqual([])
  await ui.unmount()
})

test('every chat is on the plan: by its milestone tag, else the milestone or topic its title names, else Other work', () => {
  const { areas, areaOf } = planAreas(graph())
  expect(areaOf(row({ id: 'a', tag: 'G3e', title: "G3e: the Warden's sounds" }))).toBe('G3')
  expect(areaOf(row({ id: 'b', tag: null, title: 'METRO 9 night pass: dark, fog, filled roads' }))).toBe('topic:metro9')
  expect(areaOf(row({ id: 'c', tag: null, title: 'Bay: office stair, single door' }))).toBe(OTHER)
  expect(areas.get(OTHER)).toBe('Other work')
  expect(findArea(areas, 'G5')).toBe('G5')
  expect(findArea(areas, 'metro 9')).toBe('topic:metro9')
  expect(findArea(areas, 'G5: The shopping cart')).toBe('G5') // a milestone by its name
  expect(findArea(areas, 'the shopping cart')).toBe('topic:cart') // a topic by its name
  expect(findArea(areas, 'nowhere')).toBe(null)
})
