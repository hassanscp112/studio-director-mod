import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// The hooks here stand for the engine and the app beneath the mod: git answers
// from a table, the app's session tools from fixed JSON, and every file write
// is kept so the test can read the report back.
const ROOT = 'E:/Godot Games/scrap-shift'
const SELF = JSON.stringify({ sessionId: 'local_t1', title: 'G5 stage 4: sounds', model: 'claude-opus-5-5', effort: 'high' })
const USAGE = JSON.stringify({ context: { tokensUsed: 81234, percentUsed: 8 } })

type World = { status: string; head: string[]; writes: Array<{ path: string; text: string }>; ran: string[][]; show?: string }

function engine(on: On, w: World) {
  mock.env(on, {})
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'cli-a' }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.turns', () => ({ value: 3 }))
  on('command.register', () => ({ value: { command: 'studio' } }))
  on('mcp.call', (_, e) => {
    const text = e.tool === 'get_session' ? SELF : USAGE
    return { value: { isError: false, content: [{ type: 'text' as const, text }] } }
  })
  on('fs.write', (_, e) => {
    w.writes.push({ path: e.path.split('\\').join('/'), text: e.text })
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    w.ran.push(argv)
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[1] === 'rev-parse' && argv.includes('--git-common-dir')) return ok(`${ROOT}/.git\n`)
    if (argv[1] === 'status') return ok(w.status)
    if (argv[1] === 'rev-parse') return ok(`${w.head[0]}\n`)
    if (argv[1] === 'log') return ok(`${w.head[0]}\x1fG5: the sounds\x1f2026-11-14T12:00:00+01:00\n`)
    if (argv[1] === 'show') return ok(w.show ?? '')
    return ok('')
  })
  on('tool.call', () => {
    // the commit "runs": HEAD moves
    w.head.unshift(`h${w.head.length}`)
    return { result: { stdout: 'ok' } }
  })
}

/** A refused call's reason, however the kit hands it back. */
const why = (r: unknown): string => {
  const x = r as { text?: unknown; deny?: unknown }
  return String(x.deny ?? x.text ?? '')
}

const lastReport = (w: World) => {
  const last = w.writes.filter(x => x.path.includes('/docs/studio/sessions/')).at(-1)
  return last ? (JSON.parse(last.text) as Record<string, unknown>) : null
}

test('a turn with a wrap-up ask leaves the chat waiting on the user', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-11-14T10:00:00Z') })
  const w: World = { status: '', head: ['h0'], writes: [], ran: [] }
  engine(on, w)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  await $.turn.start({ text: 'build it', turnId: 't1' })
  await clock.advance(50)
  expect(lastReport(w)?.state).toBe('working')

  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Built the band.', ask: 'Commit it?', actions: [{ action: 'commit' }, { label: 'Not now' }] })
  await $.turn.complete({ answer: 'Done.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(50)

  const r = lastReport(w)
  expect(w.writes.at(-1)?.path).toBe(`${ROOT}/docs/studio/sessions/local_t1.json`)
  expect(r).toMatchObject({
    appId: 'local_t1',
    cliId: 'cli-a',
    title: 'G5 stage 4: sounds',
    tag: 'G5',
    tagSource: 'title',
    state: 'waiting-you',
    recap: 'Built the band.',
    ask: { question: 'Commit it?', buttons: ['commit', 'Not now'] },
    context: { tokens: 81234, pct: 8 },
    model: 'claude-opus-5-5',
    effort: 'high',
    turns: 3,
  })

  // the next turn clears the ask; a turn with no wrap-up recaps from its answer
  await $.turn.start({ text: 'yes', turnId: 't2' })
  await $.turn.complete({ answer: 'Committed as abc.', durationMs: 5, isAborted: false, turnId: 't2', reason: 'answer' })
  await clock.advance(50)
  expect(lastReport(w)).toMatchObject({ state: 'idle', ask: null, recap: 'Committed as abc.' })
})

test('a commit with docs/studio/ staged is refused; a clean one is recorded', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-11-14T10:00:00Z') })
  const w: World = { status: 'A  docs/studio/sessions/local_t1.json\0', head: ['h0'], writes: [], ran: [] }
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)

  const refused = await $.tool.call({ tool: 'Bash', command: 'git add docs/studio && git commit -m "G5: x"' })
  expect(why(refused)).toContain('Unstage docs/studio/: the director commits it')
  expect(w.head).toEqual(['h0'])

  w.status = '?? docs/studio/sessions/local_t1.json\0'
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "G5: the sounds" -- scripts/a.gd' })
  await clock.advance(50)
  expect(lastReport(w)?.lastCommit).toEqual({ hash: 'h1', subject: 'G5: the sounds', at: '2026-11-14T12:00:00+01:00' })

  // PowerShell commits are checked the same way
  w.status = ' M docs/studio/sessions/local_t1.json\0'
  const all = await $.tool.call({ tool: 'PowerShell', command: 'git commit -am "G5: y"' })
  expect(why(all)).toContain('commit -a')
})

test('a docs/studio/ commit the check could not see is reported to the model, never undone', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-11-14T10:00:00Z') })
  const w: World = { status: '', head: ['h0'], writes: [], ran: [], show: 'docs/studio/sessions/local_t1.json' }
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  const r = await $.tool.call({ tool: 'Bash', command: 'python tools/commit.py --git' })
  // the note rides as context, which the kit leaves off a plugin's own $.tool.call: the commit still lands and is recorded
  expect(JSON.stringify(r)).toContain('ok')
  await clock.advance(50)
  expect((lastReport(w)?.lastCommit as { hash?: string } | null)?.hash).toBe('h1')
  expect(w.head[0]).toBe('h1')
})

test('/studio allow-commit typed by the user lets one docs/studio/ commit through', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-11-14T10:00:00Z') })
  const w: World = { status: 'M  docs/studio/README.md\0', head: ['h0'], writes: [], ran: [] }
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })

  const byPlugin = await $.command.run({ command: 'studio', args: 'allow-commit', origin: { kind: 'plugin', name: 'other' } } as never)
  expect(byPlugin.text).toContain('nothing changed')

  const ok = await $.command.run({ command: 'studio', args: 'allow-commit', origin: { kind: 'sdk' } } as never)
  expect(ok.text).toContain('next commit')
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "Studio stage 1"' })
  expect(w.head[0]).toBe('h1')

  await clock.advance(11 * 60_000)
  const late = await $.tool.call({ tool: 'Bash', command: 'git commit -m "again"' })
  expect(why(late)).toContain('commit refused')
})

test('/studio tag sets a tag that wins over the title', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-11-14T10:00:00Z') })
  const w: World = { status: '', head: ['h0'], writes: [], ran: [] }
  engine(on, w)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  const r = await $.command.run({ command: 'studio', args: 'tag SD1', origin: { kind: 'sdk' } } as never)
  expect(r.text).toContain('SD1')
  expect(lastReport(w)).toMatchObject({ tag: 'SD1', tagSource: 'manual' })
  await $.command.run({ command: 'studio', args: 'tag', origin: { kind: 'sdk' } } as never)
  expect(lastReport(w)).toMatchObject({ tag: 'G5', tagSource: 'title' })
})

test('session end marks the chat stopped, but a /clear does not', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-11-14T10:00:00Z') })
  const w: World = { status: '', head: ['h0'], writes: [], ran: [] }
  engine(on, w)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  const n = w.writes.length
  await $.session.end({ reason: 'clear', sessionId: 'cli-a', resume: {} } as never)
  expect(w.writes.length).toBe(n)
  await $.session.end({ reason: 'other', sessionId: 'cli-a', resume: {} } as never)
  expect(lastReport(w)?.state).toBe('stopped')
  // started again (a resume, or the mod's new copy after /reload-plugins): alive, idle
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  expect(lastReport(w)?.state).toBe('idle')
})

test('a chat that ends while waiting on the user still waits, ask and all', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-11-14T10:00:00Z') })
  const w: World = { status: '', head: ['h0'], writes: [], ran: [] }
  engine(on, w)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'Board built.', ask: 'Does it match?', actions: [{ label: 'It matches' }] })
  await $.turn.complete({ answer: 'Done.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(50)
  await $.session.end({ reason: 'other', sessionId: 'cli-a', resume: {} } as never)
  await clock.advance(50)
  expect(lastReport(w)).toMatchObject({ state: 'waiting-you', recap: 'Board built.', ask: { question: 'Does it match?', buttons: ['It matches'] } })
})

test('with the session state gone, the chat carries on from its own file', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-11-14T10:00:00Z') })
  const w: World = { status: '', head: ['h0'], writes: [], ran: [] }
  engine(on, w)
  const file = JSON.stringify({ schema: 1, appId: 'local_t1', cliId: 'cli-a', title: 'G5 stage 4: sounds', tag: 'G5', tagSource: 'title', state: 'waiting-you', stateSince: '2026-11-14T09:00:00.000Z', updatedAt: '2026-11-14T09:00:00.000Z', turns: 3, recap: 'Sounds in.', ask: { question: 'Commit?', buttons: ['Yes'] }, lastCommit: null, context: null, model: 'm', effort: 'high', cwd: ROOT })
  on('fs.read', (_, e) => {
    if (e.path.split('\\').join('/').endsWith('/docs/studio/sessions/local_t1.json')) return { value: file }
    throw new Error('ENOENT')
  })
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: false })
  await clock.advance(50)
  expect(lastReport(w)).toMatchObject({ state: 'waiting-you', recap: 'Sounds in.', ask: { question: 'Commit?' }, stateSince: '2026-11-14T09:00:00.000Z' })
})
