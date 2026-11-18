import { expect, test } from 'claude-code/testing'

import type { Report } from '../types'
import {
  FRESH_TOKENS,
  ago,
  boardText,
  contextText,
  countUncommitted,
  firstLine,
  groupRows,
  markSeen,
  newWaits,
  parseRow,
  readLastCommit,
  quietLine,
  readPlan,
  readSessions,
  recentFacts,
  rowName,
  toastText,
  waitKey,
  withSessions,
} from '../hooks/board'

const NOW = Date.parse('2026-11-15T10:00:00Z')
const h = (n: number) => new Date(NOW - n * 3_600_000).toISOString()

function report(over: Partial<Report>): Report {
  return {
    schema: 1,
    appId: 'local_x',
    cliId: 'cli-x',
    title: 'A chat',
    tag: null,
    tagSource: null,
    state: 'idle',
    stateSince: h(1),
    updatedAt: h(1),
    turns: 1,
    recap: '',
    ask: null,
    lastCommit: null,
    context: null,
    model: 'claude-opus-5-5',
    effort: 'high',
    turnClass: null,
    classMs: null,
    routings: [],
    cwd: 'E:/Godot Games/scrap-shift',
    ...over,
  }
}

const ROWS: Report[] = [
  report({ appId: 'local_new', title: 'Vault v2 (DEPOSITORY 4)', state: 'waiting-you', stateSince: h(0.2), updatedAt: h(0.2), ask: { question: 'Start a walk build?', buttons: ['Start a walk build', 'Not now'] }, context: { tokens: 621545, pct: 62 } }),
  report({ appId: 'local_old', title: "G3e: the Warden's sounds", tag: 'G3e', state: 'waiting-you', stateSince: h(19), updatedAt: h(19), ask: { question: 'Start building G3e on this plan?', buttons: ['Yes, build it'] } }),
  report({ appId: 'local_work', title: 'Haggler: the Dealer', state: 'working', stateSince: h(0.5), updatedAt: h(0.1) }),
  report({ appId: 'local_dead', title: 'Died mid-turn', state: 'working', stateSince: h(5), updatedAt: h(4) }),
  report({ appId: 'local_design', title: 'Design a studio director mod', state: 'stopped', stateSince: h(20), updatedAt: h(20), recap: '[Stage 1](#local_a) is testing.\nSecond line.', context: { tokens: 374133, pct: 37 } }),
  report({ appId: 'local_quiet', title: 'Old metro chat', state: 'idle', updatedAt: h(100), stateSince: h(100) }),
  report({ appId: null, cliId: 'cli-headless', title: 'headless run', state: 'idle' }),
  report({ appId: 'local_me', cliId: 'cli-self', title: 'Studio Director stage 2: the board', state: 'working', stateSince: h(0.1), updatedAt: h(0.05) }),
]

test('rows sort into the four groups; headless runs are left out', () => {
  const g = groupRows(ROWS, NOW, 'cli-self')
  expect(g.waiting.map(r => r.id)).toEqual(['local_old', 'local_new']) // oldest wait first
  expect(g.working.map(r => r.id)).toEqual(['local_work', 'local_me'])
  expect(g.recent.map(r => r.id)).toEqual(['local_dead', 'local_design']) // newest first
  expect(g.quiet.map(r => r.id)).toEqual(['local_quiet'])
  const all = [...g.waiting, ...g.working, ...g.recent, ...g.quiet].map(r => r.id)
  expect(all.includes('cli-cli-headless')).toBe(false)
  expect(g.working.find(r => r.id === 'local_me')?.isSelf).toBe(true)
})

test('a working row silent for over 2 h is stalled, in Recent', () => {
  const g = groupRows(ROWS, NOW)
  const dead = g.recent.find(r => r.id === 'local_dead')
  expect(dead?.isStalled).toBe(true)
  expect(recentFacts(dead!, NOW)).toContain('stalled (likely died mid-turn) 4h')
  const fresh = groupRows([report({ state: 'working', updatedAt: h(1.9) })], NOW)
  expect(fresh.working.length).toBe(1)
})

test('Recent is the last 72 h; older rows are Quiet', () => {
  const g = groupRows([report({ appId: 'a', updatedAt: h(71) }), report({ appId: 'b', updatedAt: h(73) })], NOW)
  expect(g.recent.map(r => r.id)).toEqual(['a'])
  expect(g.quiet.map(r => r.id)).toEqual(['b'])
})

test('the fresh-chat flag sits at 400k tokens and the % is shown beside it', () => {
  expect(FRESH_TOKENS).toBe(400_000)
  const [at, under] = groupRows(
    [report({ appId: 'u', updatedAt: h(2), context: { tokens: 399_999, pct: 40 } }), report({ appId: 'a', updatedAt: h(1), context: { tokens: 400_000, pct: 40 } })],
    NOW,
  ).recent.sort((x, y) => x.id.localeCompare(y.id))
  expect(at?.isFresh).toBe(true)
  expect(under?.isFresh).toBe(false)
  expect(contextText(at!)).toBe('40 % (400k), time for a fresh chat')
  expect(contextText(under!)).toBe('40 % (400k)')
  expect(contextText(at!, false)).toBe('40 % (400k)')
})

test('a half-written file is no row', () => {
  expect(parseRow('{"schema": 1, "appId": "loc')).toBe(null)
  expect(parseRow('')).toBe(null)
  expect(parseRow('{"cliId": "x", "state": "dancing", "stateSince": "", "updatedAt": ""}')).toBe(null)
  expect(parseRow(JSON.stringify(report({})))?.cliId).toBe('cli-x')
})

test('names, ages and recap lines read plainly', () => {
  expect(rowName({ tag: 'G3e', title: "G3e: the Warden's sounds" })).toBe("G3e: the Warden's sounds")
  expect(rowName({ tag: 'N1d', title: 'the vents' })).toBe('N1d · the vents')
  expect(rowName({ tag: null, title: '' })).toBe('(untitled)')
  expect(ago(30_000)).toBe('now')
  expect(ago(5 * 60_000)).toBe('5m')
  expect(ago(3 * 3_600_000)).toBe('3h')
  expect(ago(52 * 3_600_000)).toBe('2d 4h')
  expect(firstLine('[Stage 1](#local_a) is **testing**.\nSecond line.')).toBe('Stage 1 is testing.')
})

test('the uncommitted count leaves out docs/studio/ and counts a rename once', () => {
  const z = [' M scripts/a.gd', '?? docs/studio/sessions/local_x.json', ' M docs/studio/README.md', 'R  new.gd', 'old.gd', '?? assets/b.png', '?? docs/studio/', '?? Freesound/', ''].join('\0')
  expect(countUncommitted(z)).toEqual({ changed: 2, untracked: 2 })
  expect(countUncommitted('')).toEqual({ changed: 0, untracked: 0 })
})

test('the plan windows come from get_usage', () => {
  const ok = JSON.stringify({ plan: { status: 'ok', windows: [{ label: 'Weekly · all models', percentUsed: 31, resetsIn: '2d 9h' }, { label: 'Weekly · Fable', percentUsed: 23, resetsIn: '2d 9h' }] } })
  expect(readPlan(ok)).toEqual([
    { label: 'Weekly · all models', pct: 31, resetsIn: '2d 9h' },
    { label: 'Weekly · Fable', pct: 23, resetsIn: '2d 9h' },
  ])
  expect(readPlan(JSON.stringify({ plan: { status: 'not_applicable' } }))).toEqual([])
  expect(readPlan(JSON.stringify({ plan: { status: 'unavailable' } }))).toBe(null)
  expect(readPlan('not json')).toBe(null)
  expect(readLastCommit('eefffdd\x1fOld bay: screens\x1f2026-11-14T12:00:00+03:00\n')).toEqual({ hash: 'eefffdd', subject: 'Old bay: screens', at: '2026-11-14T12:00:00+03:00' })
  expect(readLastCommit(null)).toBe(null)
})

test('the text board lists every group in order', () => {
  const groups = groupRows(ROWS, NOW, 'cli-self')
  const text = boardText({
    at: NOW,
    header: { usage: [{ label: 'Weekly · all models', pct: 31, resetsIn: '2d 9h' }, { label: 'Weekly · Fable', pct: 23, resetsIn: '2d 9h' }], uncommitted: { changed: 73, untracked: 323 }, lastCommit: { hash: 'eefffdd', subject: 'Old bay', at: '' } },
    groups,
  })
  const lines = text.split('\n')
  expect(lines[1]).toBe('7-day usage: all models 31 % · Fable 23 % (resets in 2d 9h)')
  expect(lines[2]).toBe('396 uncommitted: 73 changed, 323 new (docs/studio/ left out) · last commit eefffdd Old bay')
  const at = (s: string) => lines.findIndex(l => l.startsWith(s))
  expect(at('Waiting on you (2)') < at('Working now (2)')).toBe(true)
  expect(at('Working now (2)') < at('Recent, last 72 h (2)')).toBe(true)
  expect(at('Recent, last 72 h (2)') < at('Quiet (1)')).toBe(true)
  expect(text).toContain("  G3e: the Warden's sounds · waiting 19h")
  expect(text).toContain('    Start building G3e on this plan?  [Yes, build it]')
  expect(text).toContain('Studio Director stage 2: the board (this chat)')
  expect(text).toContain('    Stage 1 is testing.')
  expect(text).not.toContain('headless run')
})

test('a wait toasts once, never this chat\u2019s own or one over a day old', () => {
  const rows = [
    ...ROWS,
    report({ appId: 'local_me2', cliId: 'cli-self', state: 'waiting-you', stateSince: h(0.1), updatedAt: h(0.1) }),
    report({ appId: 'local_ancient', state: 'waiting-you', stateSince: h(30), updatedAt: h(30) }),
  ]
  const g = groupRows(rows, NOW, 'cli-self')
  const first = newWaits(g, {}, NOW)
  expect(first.map(r => r.id).sort()).toEqual(['local_new', 'local_old'])
  expect(toastText(first.find(r => r.id === 'local_old')!)).toBe('G3e waiting: Start building G3e on this plan?')
  const seen = markSeen({ 'gone@x': NOW - 8 * 24 * 3_600_000 }, first, NOW)
  expect(Object.keys(seen).sort()).toEqual(first.map(waitKey).sort()) // the week-old record dropped
  expect(newWaits(g, seen, NOW + 15_000)).toEqual([])
  // the same chat waiting again later is a new wait
  const again = groupRows([report({ appId: 'local_old', state: 'waiting-you', stateSince: h(0), updatedAt: h(0) })], NOW)
  expect(newWaits(again, seen, NOW).length).toBe(1)
})

const ROOT = 'E:/Godot Games/scrap-shift'
const session = (id: string, title: string, cwd: string, ageH: number, isArchived = false) => ({ sessionId: id, title, cwd, isArchived, isRunning: false, lastActivityAt: h(ageH) })

test("the app's list adds this project's chats with no report and drops archived ones", () => {
  const listed = readSessions(
    JSON.stringify([
      session('local_old', 'G3e', 'E:/Godot Games/scrap-shift', 19),
      session('local_n1c', 'N1c room 12: the last greybox', 'E:/Godot Games/scrap-shift', 18),
      session('local_wt', 'A worktree chat', 'E:/Godot Games/scrap-shift/.claude/worktrees/x', 200),
      session('local_other', 'Another project chat', 'E:/Godot Games/Other Games', 1),
      session('local_arch', 'archived', 'E:/Godot Games/scrap-shift', 1, true),
    ]),
  )
  expect(listed?.map(s => s.id)).toEqual(['local_old', 'local_n1c', 'local_wt', 'local_other'])
  expect(readSessions('nope')).toBe(null)
  const reports = [
    ROWS[1]!, // local_old, listed
    report({ appId: 'local_gone', title: 'SD1 test A (deleted)', updatedAt: h(3) }), // not listed: dropped
    ROWS[7]!, // this chat: never in the app's list, kept
    ROWS[6]!, // headless: kept here, left out by groupRows
  ]
  const merged = withSessions(reports, listed, ROOT, 'cli-self')
  const g = groupRows(merged, NOW, 'cli-self')
  const all = [...g.waiting, ...g.working, ...g.recent, ...g.quiet]
  expect(all.map(r => r.id).sort()).toEqual(['local_me', 'local_n1c', 'local_old', 'local_wt'])
  const n1c = g.recent.find(r => r.id === 'local_n1c')!
  expect(n1c.isUnreported).toBe(true)
  expect(recentFacts(n1c, NOW)).toBe('no report yet, last active 18h')
  expect(quietLine(g.quiet.find(r => r.id === 'local_wt')!, NOW)).toBe('  A worktree chat · no report yet, last active 8d 8h')
  // outside the app the reports stand alone
  expect(withSessions(reports, null, ROOT, 'cli-self').length).toBe(4)
})

test('a list cut at its limit keeps reports older than its oldest row', () => {
  const listed = [{ id: 'local_new', title: 'New', cwd: ROOT, isRunning: false, lastActivityAt: h(5) }]
  const reports = [
    report({ appId: 'local_ancient', title: 'Past the cut', updatedAt: h(300) }), // older than the list reaches: kept
    report({ appId: 'local_gone', title: 'Archived', updatedAt: h(1) }), // within the list's reach and not in it: dropped
  ]
  const cut = withSessions(reports, listed, ROOT, 'cli-self', true).map(r => r.appId).sort()
  expect(cut).toEqual(['local_ancient', 'local_new'])
  const whole = withSessions(reports, listed, ROOT, 'cli-self', false).map(r => r.appId).sort()
  expect(whole).toEqual(['local_new'])
  // the engine's notice for an oversized result is no list
  expect(readSessions('Error: result (96,978 characters across 2,508 lines) exceeds maximum allowed tokens.')).toBe(null)
})
