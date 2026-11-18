import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// The hooks here stand for the engine and the app beneath the mod: the
// sessions folder is a table of files, git and get_usage answer fixed text,
// and every toast and pane open is kept for the test to read.
const ROOT = 'E:/Godot Games/scrap-shift'
const DIR = `${ROOT}/docs/studio/sessions`
const NOW = Date.parse('2026-11-15T10:00:00Z')
const h = (n: number) => new Date(NOW - n * 3_600_000).toISOString()
const USAGE = JSON.stringify({
  plan: { status: 'ok', windows: [{ label: 'Weekly · all models', percentUsed: 31, resetsIn: '2d 9h' }, { label: 'Weekly · Fable', percentUsed: 23, resetsIn: '2d 9h' }] },
  context: { tokensUsed: 81234, percentUsed: 8 },
})
const listed = (id: string, title: string, ageH: number) => ({ sessionId: id, title, cwd: 'E:\\Godot Games\\scrap-shift', isArchived: false, isRunning: false, lastActivityAt: h(ageH) })
const LIST = JSON.stringify([
  listed('local_g3e', "G3e: the Warden's sounds", 19),
  listed('local_vault', 'Vault v2 (DEPOSITORY 4)', 2),
  listed('local_haggler', 'Haggler: the Dealer', 0.1),
  listed('local_old', 'Old metro chat', 100),
  listed('local_n1c', 'N1c room 12: the last greybox', 18), // no report file
  { ...listed('local_elsewhere', 'Another project chat', 1), cwd: 'E:\\Godot Games\\Other Games' }, // another project
])
const STATUS =[' M scripts/a.gd', ' M scripts/b.gd', '?? docs/studio/sessions/local_g3e.json', ''].join('\0')

const row = (over: Record<string, unknown>) =>
  JSON.stringify({
    schema: 1, appId: 'local_x', cliId: 'cli-x', title: 'A chat', tag: null, tagSource: null, state: 'idle',
    stateSince: h(1), updatedAt: h(1), turns: 1, recap: '', ask: null, lastCommit: null, context: null,
    model: 'claude-opus-5-5', effort: 'high', cwd: ROOT, ...over,
  })

const FILES: Record<string, string> = {
  'local_g3e.json': row({ appId: 'local_g3e', title: "G3e: the Warden's sounds", tag: 'G3e', state: 'waiting-you', stateSince: h(19), updatedAt: h(19), ask: { question: 'Start building G3e on this plan?', buttons: ['Yes, build it'] } }),
  'local_vault.json': row({ appId: 'local_vault', title: 'Vault v2 (DEPOSITORY 4)', state: 'idle', updatedAt: h(2), recap: 'Sorting is now on the only way to the vault.', context: { tokens: 621545, pct: 62 }, lastCommit: { hash: 'abc1234def', subject: 'Vault: belts', at: h(3) } }),
  'local_haggler.json': row({ appId: 'local_haggler', title: 'Haggler: the Dealer', state: 'working', stateSince: h(0.5), updatedAt: h(0.1) }),
  'local_old.json': row({ appId: 'local_old', title: 'Old metro chat', updatedAt: h(100) }),
  'cli-headless.json': row({ appId: null, cliId: 'headless', title: 'headless run' }),
  'local_half.json': '{"schema": 1, "appId": "local_half", "title": "Half wri',
  'notes.txt': 'not a report',
}

type World = { files: Record<string, string>; toasts: string[]; opened: string[]; lists: number; surfaces: Array<'desktop' | 'terminal'> }

function engine(on: On, w: World) {
  mock.env(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  on('session.detach', (_, e) => ({ clientId: e.clientId }))
  on('session.id', () => ({ value: 'cli-self' }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.turns', () => ({ value: 1 }))
  on('command.register', () => ({ value: { command: 'studio' } }))
  on('session.surfaces', () => ({ value: w.surfaces }))
  on('mcp.call', (_, e) => {
    const text = e.tool === 'get_usage' ? USAGE : e.tool === 'list_sessions' ? LIST : '{}'
    return { value: { isError: false, content: [{ type: 'text' as const, text }] } }
  })
  on('fs.write', () => ({ value: undefined }))
  on('fs.list', () => {
    w.lists++
    return { value: Object.entries(w.files).map(([name, text]) => ({ name, kind: 'file' as const, size: text.length, mtimeMs: NOW, isLink: false })) }
  })
  on('fs.read', (_, e) => {
    const path = e.path.split('\\').join('/')
    const name = path.split('/').pop() ?? ''
    const text = w.files[name]
    if (text === undefined || !path.startsWith(DIR)) throw new Error(`ENOENT ${path}`)
    return { value: text }
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[1] === 'rev-parse') return ok(`${ROOT}/.git\n`)
    if (argv[1] === 'status') return ok(STATUS)
    if (argv[1] === 'log') return ok('eefffdd\x1fOld bay: screens\x1f2026-11-14T12:00:00+03:00\n')
    return ok('')
  })
  on('ui.open', (_, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.toast', (_, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
}

const world = (): World => ({ files: { ...FILES }, toasts: [], opened: [], lists: 0, surfaces: [] })

const PANE = {
  plugin: 'studio',
  component: 'Pane',
  requestId: 'studio-board',
  props: { title: 'Studio', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const studio = (args: string) => ({ command: 'studio', args, origin: { kind: 'composer' } }) as never

test('/studio prints the board and opens the pane, which draws it on terminal and desktop', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w = world()
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)

  const out = (await $.command.run(studio(''))) as { text: string }
  expect(w.opened).toEqual(['studio-board'])
  expect(out.text).toContain('The board pane is open beside the chat.')
  expect(out.text).toContain('7-day usage: all models 31 % · Fable 23 % (resets in 2d 9h)')
  expect(out.text).toContain('2 uncommitted: 2 changed, 0 new (docs/studio/ left out) · last commit eefffdd Old bay: screens')
  expect(out.text).toContain('Recent, last 72 h (2)')
  expect(out.text).toContain('  N1c room 12: the last greybox · no report yet, last active 18h')
  expect(out.text).not.toContain('Another project chat')
  expect(out.text).toContain('Waiting on you (1)')
  expect(out.text).toContain('    Start building G3e on this plan?  [Yes, build it]')
  expect(out.text).toContain('Working now (1)')
  expect(out.text).toContain('62 % (622k), time for a fresh chat · Opus 5.5 high · commit abc1234 Vault: belts')
  expect(out.text).toContain('Quiet (1)')
  expect(out.text).not.toContain('headless run')
  expect(out.text).not.toContain('Half wri')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^Waiting on you \(1\)$/ }))?.text).toBe('Waiting on you (1)')
    // stage 7: a waiting chat is a card with the whole ask; its buttons are named, not pressable, outside the director chat
    expect((await ui.find({ type: 'Text', text: /^G3e: the Warden's sounds$/ }))?.text).toBe("G3e: the Warden's sounds")
    expect((await ui.find({ type: 'Text', text: /^Start building G3e/ }))?.text).toBe('Start building G3e on this plan?')
    expect((await ui.find({ type: 'Text', text: /Yes, build it/ }))?.text).toBe('[Yes, build it]')
    expect(await ui.find({ type: 'Button', key: 'brief-local_g3e' })).toBe(undefined)
    expect(await ui.find({ type: 'Button', key: 'answer-local_g3e-0' })).toBe(undefined)
    // "Open chat" (2026-11-18): every app chat links to itself, on any surface, director or not
    expect((await ui.find({ type: 'Markdown', key: 'open-local_g3e' }))?.props.text).toBe('[Open chat](#local_g3e)')
    expect((await ui.find({ type: 'Text', text: /time for a fresh chat/ }))?.text).toBe('time for a fresh chat')
    // a recent card: its facts, its recap, its context as a bar
    expect((await ui.find({ type: 'Text', text: /^idle 2h$/ }))?.text).toBe('idle 2h')
    expect((await ui.find({ type: 'Text', text: /commit abc1234/ }))?.text).toBe('Opus 5.5 high · commit abc1234 Vault: belts')
    expect((await ui.find({ type: 'Text', text: /^waiting 19h$/ }))?.text).toBe('waiting 19h')
    expect((await ui.find({ type: 'Text', text: /^Sorting is now/ }))?.text).toBe('Sorting is now on the only way to the vault.')
    // the header: the 7-day usage as bars, then each card's context
    // (a Progress reads here as its label and figure)
    expect((await ui.findAll({ type: 'Text', text: /^Week · / })).map(t => t.text)).toEqual(['Week · all models 31 % · resets in 2d 9h', 'Week · Fable 23 % · resets in 2d 9h'])
    expect((await ui.find({ type: 'Text', text: /^Context / }))?.text).toBe('Context 62 % (622k)')
    expect((await ui.find({ type: 'Text', text: /uncommitted/ }))?.text).toBe('2 uncommitted · 2 changed · 0 new')
    expect((await ui.find({ type: 'Text', text: /^last commit/ }))?.text).toBe('last commit eefffdd Old bay: screens')
    // a chat with no report is one line
    expect((await ui.find({ type: 'Text', text: /N1c room 12/ }))?.text).toBe('  N1c room 12: the last greybox · no report yet, last active 18h')
    // Quiet is folded until its button is pressed
    expect(await ui.find({ type: 'Text', text: /Old metro chat/ })).toBe(undefined)
    await ui.press({ key: 'quiet' })
    expect((await ui.find({ type: 'Text', text: /Old metro chat/ }))?.text).toBe('  Old metro chat · idle 4d 4h')
    await ui.press({ key: 'quiet' })
    await ui.unmount()
  }
})

test('the pane fits its column: a long title is cut to its card, with room for the age beside it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w = world()
  w.files['local_haggler.json'] = row({ appId: 'local_haggler', title: 'A very long title '.repeat(10), state: 'working', stateSince: h(0.2), updatedAt: h(0.1) })
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  await $.command.run(studio(''))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns: 40 } })
    const long = await ui.find({ type: 'Text', text: /A very long title/ })
    // 40 columns, less the border and padding (4), the age ("working 12m") and a gap of 2
    expect(long?.text.length).toBe(23)
    expect(long?.text.endsWith('…')).toBe(true)
    await ui.unmount()
  }
})

test('an attached chat reopens the pane, polls, and toasts a new wait once', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w = world()
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  await $.command.run(studio('')) // the board pane is now open in this chat
  w.opened.length = 0
  w.toasts.length = 0

  await $.session.attach({ surface: 'desktop', clientId: 'desktop-1', viewport: { columns: 164, rows: 50, isFullscreen: true } })
  await clock.advance(50)
  expect(w.opened).toEqual(['studio-board'])
  expect(w.toasts).toEqual(['G3e waiting: Start building G3e on this plan?'])

  // the next polls toast nothing new
  await clock.advance(15_000)
  await clock.advance(15_000)
  expect(w.toasts.length).toBe(1)

  // a new wait in another chat toasts at the next poll
  w.files['local_vault.json'] = row({ appId: 'local_vault', title: 'Vault v2 (DEPOSITORY 4)', state: 'waiting-you', stateSince: new Date(NOW + 31_000).toISOString(), updatedAt: new Date(NOW + 31_000).toISOString(), ask: { question: 'Start a walk build?', buttons: ['Start a walk build', 'Not now'] } })
  await clock.advance(15_000)
  expect(w.toasts).toEqual(['G3e waiting: Start building G3e on this plan?', 'Vault v2 (DEPOSITORY 4) waiting: Start a walk build?'])

  // detached, the chat stops reading the folder
  await $.session.detach({ surface: 'desktop', clientId: 'desktop-1', reason: 'detach' })
  const lists = w.lists
  await clock.advance(60_000)
  expect(w.lists).toBe(lists)
})

test('a wait another chat already toasted stays quiet here', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, { toasted: { [`local_g3e@${h(19)}`]: NOW - 60_000 } })
  const w = world()
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await $.session.attach({ surface: 'desktop', clientId: 'desktop-1' })
  await clock.advance(50)
  await clock.advance(15_000)
  expect(w.toasts).toEqual([])
  // the pane was never opened in this chat, so attaching opens nothing
  expect(w.opened).toEqual([])
})

test('/studio me keeps the single-chat report', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  engine(on, world())
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  const me = (await $.command.run(studio('me'))) as { text: string }
  expect(me.text.startsWith('(no tag) · ')).toBe(true)
  expect(me.text).toContain('state ')
  const help = (await $.command.run(studio('nonsense'))) as { text: string }
  expect(help.text).toContain('/studio me')
})

test('after a reload with the chat on screen, polling and toasts start with no attach', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w = world()
  w.surfaces = ['desktop'] // already attached: a reload raises no session.attach
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  expect(w.toasts).toEqual(['G3e waiting: Start building G3e on this plan?'])
  const lists = w.lists
  await clock.advance(15_000)
  expect(w.lists > lists).toBe(true)
})
