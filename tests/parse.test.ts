import { expect, test } from 'claude-code/testing'

import {
  applyPatch,
  coversStudio,
  emptyReport,
  gitCalls,
  pickTag,
  planCommit,
  readContext,
  readQuestion,
  readSelf,
  readStatus,
  readWrapUp,
  recapFromAnswer,
  refusal,
  reportName,
  rootFromCommonDir,
  serialize,
  studioCommitNote,
} from '../hooks/parse'

test('the tag is the code at the head of the title', () => {
  expect(pickTag('G5 stage 4: sounds', null)).toEqual({ tag: 'G5', tagSource: 'title' })
  expect(pickTag('N1d-C: the vents', null).tag).toBe('N1d')
  expect(pickTag('M9 3a truck lag', null).tag).toBe('M9')
  expect(pickTag('N1c room 12', null).tag).toBe('N1c')
  expect(pickTag('G4f: voices', null).tag).toBe('G4f')
  expect(pickTag('Studio Director stage 1', null)).toEqual({ tag: null, tagSource: null })
  expect(pickTag('METRO 9 kit', null).tag).toBe(null)
  expect(pickTag('', null).tag).toBe(null)
  expect(pickTag('Studio Director stage 1', 'SD1')).toEqual({ tag: 'SD1', tagSource: 'manual' })
  expect(pickTag('G5 stage 4', 'G6')).toEqual({ tag: 'G6', tagSource: 'manual' })
})

test('the recap falls back to the first 300 characters of the answer', () => {
  expect(recapFromAnswer('  Done.\n\nAll  good. ')).toBe('Done. All good.')
  const long = recapFromAnswer('x'.repeat(500))
  expect(long.length).toBe(300)
  expect(long.endsWith('…')).toBe(true)
})

test('a wrap-up gives the recap, the ask and the button labels', () => {
  const w = readWrapUp({
    recap: 'Built it.',
    ask: 'Commit it?',
    actions: [{ action: 'commit', label: '' }, { label: 'Not now' }, {}],
    blocked: true,
  })
  expect(w).toEqual({ recap: 'Built it.', ask: { question: 'Commit it?', buttons: ['commit', 'Not now'] } })
  expect(readWrapUp({ recap: 'Nothing pending.' })).toEqual({ recap: 'Nothing pending.', ask: null })
  expect(readWrapUp(undefined)).toEqual({ recap: '', ask: null })
})

test('an open question gives its text and option labels', () => {
  const q = readQuestion({
    questions: [
      { question: 'Which fix first?', header: 'Fix', options: [{ label: 'A (Recommended)' }, { label: 'B' }] },
      { question: 'And then?', options: [] },
    ],
  })
  expect(q).toEqual({ question: 'Which fix first? (+1 more)', buttons: ['A (Recommended)', 'B'] })
  expect(readQuestion({ questions: [] })).toBe(null)
})

test('the report keeps its keys in one order and moves stateSince only on a change', () => {
  const r0 = emptyReport('cli-1', 'E:/repo', '2026-11-14T10:00:00.000Z')
  const keys = Object.keys(r0)
  // a patch written with its keys in another order still serializes in the fixed one
  const r1 = applyPatch(r0, { cwd: 'E:/repo', model: 'claude-opus-5-5', state: 'working', title: 'G5 x' }, '2026-11-14T10:01:00.000Z')
  expect(Object.keys(r1)).toEqual(keys)
  expect(r1.stateSince).toBe('2026-11-14T10:01:00.000Z')
  const r2 = applyPatch(r1, { recap: 'still going' }, '2026-11-14T10:02:00.000Z')
  expect(r2.stateSince).toBe('2026-11-14T10:01:00.000Z')
  expect(r2.updatedAt).toBe('2026-11-14T10:02:00.000Z')
  const text = serialize(r2)
  expect(text.endsWith('}\n')).toBe(true)
  expect(text.includes('\r')).toBe(false)
  expect(text.indexOf('"schema"')).toBeLessThan(text.indexOf('"appId"'))
  expect(text.indexOf('"lastCommit"')).toBeLessThan(text.indexOf('"cwd"'))
  expect(reportName('local_abc', 'x')).toBe('local_abc.json')
  expect(reportName(null, 'x')).toBe('cli-x.json')
})

test('the app answers are read from their JSON text', () => {
  expect(readSelf('{"sessionId":"local_1","title":"G5 a","model":"claude-opus-5-5","effort":"high"}')).toEqual({
    appId: 'local_1',
    title: 'G5 a',
    model: 'claude-opus-5-5',
    effort: 'high',
  })
  expect(readSelf('not json')).toBe(null)
  expect(readSelf('{"sessionId":"2c13"}')).toBe(null)
  expect(readContext('{"context":{"tokensUsed":323699,"percentUsed":32}}')).toEqual({ tokens: 323699, pct: 32 })
  expect(readContext('{"plan":{}}')).toBe(null)
  expect(rootFromCommonDir('E:/Godot Games/scrap-shift/.git\n')).toBe('E:/Godot Games/scrap-shift')
  expect(rootFromCommonDir('E:\\Godot Games\\scrap-shift\\.git')).toBe('E:/Godot Games/scrap-shift')
  expect(rootFromCommonDir('/srv/bare.git')).toBe('')
})

test('git calls are found through quotes, chains, -C and cd', () => {
  const calls = gitCalls('cd "E:/Godot Games/scrap-shift" && git add docs/a.md && git -C sub commit -m "fix; it && more"')
  expect(calls.map(c => c.sub)).toEqual(['add', 'commit'])
  expect(calls[1]?.dir).toBe('sub')
  expect(calls[0]?.dir).toBe('E:/Godot Games/scrap-shift')
  expect(gitCalls('git log --grep commit').map(c => c.sub)).toEqual(['log'])
  expect(gitCalls('echo git commit').length).toBe(0)
  expect(gitCalls('GIT_AUTHOR_NAME=x git commit -m a')[0]?.sub).toBe('commit')
  expect(gitCalls("git commit -m 'a' ; git push")[1]?.sub).toBe('push')
  expect(gitCalls('& "C:\\Program Files\\Git\\bin\\git.exe" commit -m x')[0]?.sub).toBe('commit')
  // what a model writes in PowerShell 5.1, which has no &&
  expect(gitCalls('git add docs/studio; if ($?) { git commit -m "try board" }').map(c => c.sub)).toEqual(['add', 'commit'])
  expect(gitCalls('echo a > a.txt; if ($?) { git add a.txt; if ($?) { git commit -m "Add a.txt" } }').map(c => c.sub)).toEqual(['add', 'commit'])
  expect(gitCalls('{ git add -A; git commit -m x; }').map(c => c.sub)).toEqual(['add', 'commit'])
  // shell wrappers are read inside
  expect(gitCalls(`bash -c 'git add docs/studio && git commit -m "try board"'`).map(c => c.sub)).toEqual(['add', 'commit'])
  expect(gitCalls(`bash -lc "cd sub && git commit -m x"`)[0]?.dir).toBe('sub')
  expect(gitCalls('powershell -NoProfile -Command git add -A; git commit -m x').map(c => c.sub)).toEqual(['add', 'commit'])
  expect(gitCalls('cmd /c git commit -am x')[0]?.args).toEqual(['-am', 'x'])
})

test('which pathspecs reach docs/studio/', () => {
  for (const p of ['.', './', '*', ':/', ':(top)docs', 'docs', 'docs/', 'docs/studio', './docs/studio/sessions/x.json', 'docs\\studio', 'docs/*', 'docs/st*', 'E:/Godot Games/scrap-shift/docs/studio/x']) {
    expect([p, coversStudio(p)]).toEqual([p, true])
  }
  for (const p of ['docs/plan/status_08.md', 'scripts/game.gd', 'docs/design', 'docs/p*', 'tools/claude-mods/studio', 'docs/STUDIO_DIRECTOR.md', 'docs/studio_old/x.md']) {
    expect([p, coversStudio(p)]).toEqual([p, false])
  }
})

test('a commit line is read for -a, its paths and a git add before it', () => {
  expect(planCommit('git status')).toMatchObject({ isCommit: false })
  expect(planCommit(`bash -c 'git add docs/studio && git commit -m "try board"'`)).toMatchObject({ isCommit: true, isParsed: true, isAddStudio: true })
  // a line that names git and commit in a way not read still gets the staged check
  expect(planCommit('./tools/do_git.sh commit')).toMatchObject({ isCommit: false })
  expect(planCommit('python tools/commit.py --git')).toMatchObject({ isCommit: true, isParsed: false })
  expect(planCommit('git commit -m "x"')).toMatchObject({ isCommit: true, isCommitAll: false, isCommitPathStudio: false, isAddStudio: false })
  expect(planCommit('git commit -am "x"').isCommitAll).toBe(true)
  expect(planCommit('git commit --all -m x').isCommitAll).toBe(true)
  expect(planCommit('git commit -m "add a thing"').isCommitAll).toBe(false)
  expect(planCommit('git commit -F msg.txt docs/studio/README.md').isCommitPathStudio).toBe(true)
  expect(planCommit('git commit -m x -- scripts/a.gd').isCommitPathStudio).toBe(false)
  expect(planCommit('git add -A && git commit -m x').isAddStudio).toBe(true)
  expect(planCommit('git add . ; git commit -m x').isAddStudio).toBe(true)
  expect(planCommit('git add docs/studio/sessions && git commit -m x').isAddStudio).toBe(true)
  expect(planCommit('git add scripts/a.gd docs/plan/x.md && git commit -m x').isAddStudio).toBe(false)
  expect(planCommit('git commit -m x && git add -A').isAddStudio).toBe(false)
  expect(planCommit('echo b > b.txt; if ($?) { git add -A; if ($?) { git commit -m "everything" } }')).toMatchObject({ isCommit: true, isAddStudio: true })
})

const NONE = { tracked: [], all: [] }

test('a worker commit with docs/studio/ staged is refused, and only then', () => {
  const plain = planCommit('git commit -m "G5: sounds"')
  expect(refusal(plain, [], NONE)).toBe(null)
  expect(refusal(plain, [], { tracked: ['docs/studio/sessions/a.json'], all: ['docs/studio/sessions/a.json'] })).toBe(null)
  const why = refusal(plain, ['docs/studio/sessions/a.json'], NONE)
  expect(why?.includes('Unstage docs/studio/: the director commits it')).toBe(true)
  expect(why?.includes('docs/studio/sessions/a.json')).toBe(true)
  const changed = { tracked: ['docs/studio/sessions/a.json'], all: ['docs/studio/sessions/a.json', 'docs/studio/sessions/b.json'] }
  expect(refusal(planCommit('git commit -am x'), [], changed)).not.toBe(null)
  expect(refusal(planCommit('git commit -am x'), [], { tracked: [], all: ['docs/studio/sessions/b.json'] })).toBe(null)
  expect(refusal(planCommit('git add -A && git commit -m x'), [], changed)).not.toBe(null)
  expect(refusal(planCommit('git commit -m x docs'), [], changed)).not.toBe(null)
  expect(refusal(planCommit('git log'), ['docs/studio/x'], changed)).toBe(null)
})

test('git status -z is split into staged, tracked and all paths', () => {
  const z = ['M  docs/studio/README.md', ' M docs/studio/sessions/a.json', '?? docs/studio/sessions/b.json', 'R  docs/studio/new.md', 'docs/studio/old.md', ''].join('\0')
  expect(readStatus(z)).toEqual({
    staged: ['docs/studio/README.md', 'docs/studio/new.md'],
    tracked: ['docs/studio/sessions/a.json'],
    all: ['docs/studio/README.md', 'docs/studio/sessions/a.json', 'docs/studio/sessions/b.json', 'docs/studio/new.md'],
  })
  expect(readStatus('')).toEqual({ staged: [], tracked: [], all: [] })
})

test('the note after a docs/studio/ commit names it and forbids undoing it', () => {
  const n = studioCommitNote('0123456789abcdef', ['docs/studio/a.json', 'docs/studio/b.json', 'docs/studio/c.json', 'docs/studio/d.json'])
  expect(n).toContain('commit 012345678 includes docs/studio/')
  expect(n).toContain('and 1 more')
  expect(n).toContain('do not rewrite history')
})
