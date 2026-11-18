import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// Director mode end to end: the hooks here stand for the engine and the app
// beneath the mod. Files are one table keyed by path; git answers fixed text;
// every prompt that reaches the bottom is kept with its context.
const ROOT = 'E:/Godot Games/scrap-shift'
const STUDIO = `${ROOT}/docs/studio`
const NOW = Date.parse('2026-11-15T10:00:00Z')
const h = (n: number) => new Date(NOW - n * 3_600_000).toISOString()
const SELF = JSON.stringify({ sessionId: 'local_dir', title: 'Director', model: 'claude-opus-5-5', effort: 'high' })
const USAGE = JSON.stringify({ plan: { status: 'ok', windows: [{ label: 'Weekly · all models', percentUsed: 31, resetsIn: '2d 9h' }] }, context: { tokensUsed: 20000, percentUsed: 2 } })
const LIST = JSON.stringify([
  { sessionId: 'local_g3e', title: "G3e: the Warden's sounds", cwd: 'E:\\Godot Games\\scrap-shift', isArchived: false, isRunning: false, lastActivityAt: h(19) },
  { sessionId: 'local_vault', title: 'Vault v2', cwd: 'E:\\Godot Games\\scrap-shift', isArchived: false, isRunning: false, lastActivityAt: h(2) },
])
const report = (over: Record<string, unknown>) =>
  JSON.stringify({
    schema: 1, appId: 'local_x', cliId: 'cli-x', title: 'A chat', tag: null, tagSource: null, state: 'idle',
    stateSince: h(1), updatedAt: h(1), turns: 1, recap: '', ask: null, lastCommit: null, context: null,
    model: 'claude-opus-5-5', effort: 'high', cwd: ROOT, ...over,
  })

type Prompt = { text: string; context: readonly string[] }
type World = {
  files: Record<string, string>
  messages: Array<{ role: string }>
  prompts: Prompt[]
  opened: string[]
  status: string
  ran: string[]
}

function engine(on: On, w: World) {
  mock.env(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  on('session.id', () => ({ value: 'cli-dir' }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.turns', () => ({ value: 0 }))
  on('session.surfaces', () => ({ value: [] }))
  on('session.messages', () => ({ value: w.messages as never }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('mcp.call', (_, e) => {
    const text = e.tool === 'get_session' ? SELF : e.tool === 'get_usage' ? USAGE : e.tool === 'list_sessions' ? LIST : '{}'
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
    if (argv[1] === 'status') return ok(w.status)
    if (argv[1] === 'log' && argv.includes('--oneline')) return ok('cf89356 Plan: status_09\n8579024 N1c room 12\n')
    if (argv[1] === 'log') return ok('h0\x1fsubject\x1f2026-11-15T12:00:00+03:00\n')
    return ok('')
  })
  on('ui.open', (_, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => {
    w.prompts.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text, context: e.context }
  })
  on('session.compact', (_, e) => ({ messages: e.messages }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' as const }] }))
  on('tool.call', (_, e) => {
    w.ran.push(String((e as unknown as { tool: string }).tool))
    return { result: { stdout: 'ok' } } as never
  })
}

const world = (): World => ({
  files: {
    [`${STUDIO}/sessions/local_g3e.json`]: report({ appId: 'local_g3e', title: "G3e: the Warden's sounds", tag: 'G3e', state: 'waiting-you', stateSince: h(19), updatedAt: h(19), ask: { question: 'Start building G3e on this plan?', buttons: ['Yes, build it'] } }),
    [`${STUDIO}/sessions/local_vault.json`]: report({ appId: 'local_vault', title: 'Vault v2', updatedAt: h(2), recap: 'Sorting is on the way to the vault.' }),
  },
  messages: [],
  prompts: [],
  opened: [],
  status: '',
  ran: [],
})

const cmd = (command: string, args = '', kind = 'composer') => ({ command, args, origin: { kind } }) as never
const typed = (text: string, kind = 'composer') => ({ text, origin: { kind }, wait: false }) as never
const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] } as never
const why = (r: unknown): string => {
  const x = r as { text?: unknown; deny?: unknown }
  return String(x.deny ?? x.text ?? '')
}
const ids = async ($: { prompt: { compose: (e: never) => Promise<{ sections: ReadonlyArray<{ id: string }> }> } }) =>
  (await $.prompt.compose(COMPOSE)).sections.map(s => s.id)

test('/director in a fresh chat: the role, the pane, the notes, and a first turn with the full board', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w = world()
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  expect(await ids($ as never)).toEqual(['intro'])

  const out = (await $.command.run(cmd('director'))) as { text: string; context?: readonly string[] }
  expect(out.text).toContain('This chat is now the Studio director.')
  expect(w.opened).toEqual(['studio-board'])
  expect(w.files[`${STUDIO}/notes.md`]?.startsWith('# Studio notes')).toBe(true)
  await clock.advance(50)

  // the first turn: the mod's own prompt (its own prompt.submit hook never sees it),
  // after the full snapshot, which rides as the command's hidden context
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]?.text).toBe('Read the board, then tell me where we stand.')
  expect(w.prompts[0]?.context).toEqual([])
  const snap = out.context?.[0] ?? ''
  expect(snap).toContain('<studio-snapshot kind="full"')
  expect(snap).toContain("G3e: the Warden's sounds [local_g3e] · waiting 19h")
  expect(snap).toContain('ask: Start building G3e on this plan?  [Yes, build it]')
  expect(snap).toContain('Vault v2 [local_vault]')
  expect(snap).toContain('  cf89356 Plan: status_09')
  expect(snap).toContain('# Studio notes')
  expect(await ids($ as never)).toEqual(['intro', 'studio:director'])

  // the chat's report is tagged Director
  const mine = JSON.parse(w.files[`${STUDIO}/sessions/local_dir.json`] ?? '{}') as { tag?: string }
  expect(mine.tag).toBe('Director')

  // the next prompt carries only the changes; a peer's message carries none
  await $.prompt.submit(typed('and now?'))
  expect(w.prompts[1]?.context[0]).toContain('kind="changes"')
  expect(w.prompts[1]?.context[0]).toContain('0 of 2 chats changed')
  await $.prompt.submit(typed('from another chat', 'peer'))
  expect(w.prompts[2]?.context).toEqual([])

  // after a compaction the board goes in whole again
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'x', toolUses: [] }] } as never)
  await $.prompt.submit(typed('where are we?'))
  expect(w.prompts[3]?.context[0]).toContain('kind="full"')

  // typed again: already the director
  expect(((await $.command.run(cmd('director'))) as { text: string }).text).toContain('already the Studio director')
})

test('/director in a used chat, or not typed by the user, changes nothing', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w = world()
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  const byPlugin = (await $.command.run(cmd('director', '', 'plugin'))) as { text: string }
  expect(byPlugin.text).toContain("the user's own command")
  w.messages = [{ role: 'user' }, { role: 'assistant' }]
  const used = (await $.command.run(cmd('director'))) as { text: string }
  expect(used.text).toContain('Start a fresh chat and type /director first.')
  await clock.advance(50)
  expect(w.prompts).toEqual([])
  expect(await ids($ as never)).toEqual(['intro'])
  // and a worker chat's prompts carry no snapshot, its edits no guard
  await $.prompt.submit(typed('hello'))
  expect(w.prompts[0]?.context).toEqual([])
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/scripts/player.gd`, old_string: 'a', new_string: 'b' } as never)
  expect(w.ran).toEqual(['Edit'])
})

test('the guard refuses a .gd edit and a Godot launch in the director chat, and lets docs through', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w = world()
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  await $.command.run(cmd('director'))
  await clock.advance(50)

  const gd = await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/scripts/player.gd`, old_string: 'a', new_string: 'b' } as never)
  expect(why(gd)).toContain('studio guard: refused in the director chat: Edit')
  expect(why(gd)).toContain('The director plans; a milestone chat builds.')
  const godot = await $.tool.call({ tool: 'PowerShell', command: '& "E:\\Godot\\Godot_v4.4-stable_win64.exe" --path .' } as never)
  expect(why(godot)).toContain('launches')
  const blender = await $.tool.call({ tool: 'mcp__blender__execute_blender_code', code: 'import bpy' } as never)
  expect(why(blender)).toContain('Blender code')
  // a subagent of the director chat is guarded too (the role section doesn't reach it; the guard does)
  const sub = await $.tool.call({ tool: 'Write', file_path: 'scenes/a.tscn', content: 'x', agentId: 'a1' } as never)
  expect(why(sub)).toContain('studio guard: refused in the director chat: Write scenes/a.tscn')
  expect(w.ran).toEqual([])

  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/docs/studio/notes.md`, old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Bash', command: 'git log --oneline -10' } as never)
  expect(w.ran).toEqual(['Edit', 'Bash'])
})

test('the director commits docs/studio/ alone; a mixed commit is refused', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w = world()
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  await $.command.run(cmd('director'))
  await clock.advance(50)

  w.status = ['M  docs/studio/notes.md', 'M  scripts/a.gd', ''].join('\0')
  const mixed = await $.tool.call({ tool: 'Bash', command: 'git commit -m "Studio: board and notes, 2026-11-15"' } as never)
  expect(why(mixed)).toContain("The director's board commit holds docs/studio/ alone")
  expect(why(mixed)).toContain('scripts/a.gd')
  expect(w.ran).toEqual([])

  w.status = ['M  docs/studio/notes.md', '?? docs/studio/sessions/local_dir.json', ' M scripts/a.gd', ''].join('\0')
  await $.tool.call({ tool: 'Bash', command: 'git add docs/studio && git commit -m "Studio: board and notes, 2026-11-15" -- docs/studio' } as never)
  expect(w.ran).toEqual(['Bash'])
})

test('/studio note adds a dated line; past 80 lines the oldest go to the archive', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const w = world()
  let notes = '# Studio notes\n\nheader\n\n'
  for (let i = 1; i <= 80; i++) notes += `- 2026-11-01 10:00: note ${i}\n`
  w.files[`${STUDIO}/notes.md`] = notes
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  const out = (await $.command.run(cmd('studio', 'note G5 stage 5 goes first.'))) as { text: string }
  expect(out.text).toBe('Noted in docs/studio/notes.md.')
  const after = w.files[`${STUDIO}/notes.md`] ?? ''
  expect(after).toContain(': G5 stage 5 goes first.')
  expect(after).not.toContain('note 1\n')
  expect(after.split('\n').filter(l => l.startsWith('- ')).length).toBe(80)
  expect(w.files[`${STUDIO}/notes_archive.md`]).toContain('- 2026-11-01 10:00: note 1\n')
  const empty = (await $.command.run(cmd('studio', 'note'))) as { text: string }
  expect(empty.text).toContain('Usage: /studio note <text>')
})
