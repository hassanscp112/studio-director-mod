import { expect, test } from 'claude-code/testing'

import type { BoardGroups, BoardRow, BoardView } from '../types'
import { NOTES_MAX, NOTES_SEED, addNote, appendArchive, capNotes, isUsedChat, snapshotText } from '../hooks/director'
import { directorCommitRefusal, guardTool, isAllowedPath, isLaunchExe, normPath, projectSlug, shellProblems } from '../hooks/guard'
import { planCommit } from '../hooks/parse'

// Pure rules of director mode: the guard's paths and shell reading, the board
// commit, the snapshot and the notes.
const ROOT = 'E:/Godot Games/scrap-shift'
const CTX = { root: ROOT, cwd: ROOT, cliId: 'd7d3dcfc-aaaa' }
const allowed = (p: string) => isAllowedPath(p, ROOT, CTX)

test('the guard allows docs markdown, docs/studio, CLAUDE.md, memory, scratchpad, notes and plans', () => {
  expect(allowed('docs/plan/status_09.md')).toBe(true)
  expect(allowed('E:\\Godot Games\\scrap-shift\\docs\\STUDIO_DIRECTOR.md')).toBe(true)
  expect(allowed('docs/studio/notes.md')).toBe(true)
  expect(allowed('docs/studio/sessions/local_x.json')).toBe(true)
  expect(allowed('CLAUDE.md')).toBe(true)
  // memory, by the old path and by the junction's target on E:
  expect(projectSlug(ROOT)).toBe('E--Godot-Games-scrap-shift')
  expect(allowed('C:\\Users\\user\\.claude\\projects\\E--Godot-Games-scrap-shift\\memory\\feedback-x.md')).toBe(true)
  expect(allowed('E:/Claude/projects/E--Godot-Games-scrap-shift/memory/MEMORY.md')).toBe(true)
  expect(allowed('E:/claude_tmp/claude/0883/d7d3dcfc-aaaa/scratchpad/brief.txt')).toBe(true)
  expect(allowed('C:/Users/user/AppData/Local/Claude-Data/x/side-session-notes/local_1/stage3.md')).toBe(true)
  expect(allowed('~/.claude/plans/plan.md')).toBe(true)
  expect(allowed('/dev/null')).toBe(true)
  expect(allowed('$null')).toBe(true)
})

test('the guard refuses code, scenes, assets, other docs files and other scratchpads', () => {
  expect(allowed('scripts/world/slip7/room.gd')).toBe(false)
  expect(allowed('scenes/world/slip7/room.tscn')).toBe(false)
  expect(allowed('docs/g3_shots/a.png')).toBe(false)
  expect(allowed('docs/../scripts/a.md')).toBe(false)
  expect(allowed('tools/claude-mods/studio/hooks/register.tsx')).toBe(false)
  expect(allowed('E:/Claude/projects/E--Godot-Games-scrap-shift/memory/x.gd')).toBe(false)
  expect(allowed('E:/claude_tmp/claude/0883/other-session/scratchpad/x.py')).toBe(false)
  expect(allowed('C:/Users/user/AppData/Local/Claude-Data/x/side-session-notes/local_1/run.py')).toBe(false)
  expect(allowed('E:/Godot Games/Other Games/docs/a.md')).toBe(false)
  expect(normPath('/e/Godot Games/scrap-shift/./docs/../CLAUDE.md', '/')).toBe('e:/godot games/scrap-shift/claude.md')
})

test('a worktree chat writes docs in its own tree', () => {
  const wt = { ...CTX, cwd: `${ROOT}/.claude/worktrees/dir` }
  expect(isAllowedPath('docs/plan/a.md', wt.cwd, wt)).toBe(true)
  expect(isAllowedPath('scripts/a.gd', wt.cwd, wt)).toBe(false)
})

test('Edit, Write, Fennara writes and Blender code are refused with the rule', () => {
  const gd = guardTool('Edit', { file_path: `${ROOT}/scripts/player.gd`, old_string: 'a', new_string: 'b' }, CTX)
  expect(gd).toContain('studio guard: refused in the director chat: Edit')
  expect(gd).toContain('The director plans; a milestone chat builds.')
  expect(guardTool('Write', { file_path: 'docs/plan/x.md', content: '' }, CTX)).toBe(null)
  expect(guardTool('NotebookEdit', { notebook_path: 'a.ipynb' }, CTX)).toContain('NotebookEdit a.ipynb')
  expect(guardTool('mcp__fennara__write_or_update_file', { path: 'res://a.gd' }, CTX)).toContain('Fennara')
  expect(guardTool('mcp__fennara__run_scene_edit_script', {}, CTX)).toContain('Fennara')
  expect(guardTool('mcp__fennara__runtime_session', {}, CTX)).toContain('Fennara')
  expect(guardTool('mcp__fennara__get_scene_tree', {}, CTX)).toBe(null)
  expect(guardTool('mcp__blender__execute_blender_code', { code: 'x' }, CTX)).toContain('Blender code')
  expect(guardTool('mcp__blender__get_objects_summary', {}, CTX)).toBe(null)
  expect(guardTool('Read', { file_path: 'scripts/a.gd' }, CTX)).toBe(null)
  expect(guardTool('Agent', { prompt: 'x' }, CTX)).toBe(null)
})

test('shell lines: launches, writes and tree-changing git are refused; reading and committing pass', () => {
  const p = (line: string) => shellProblems(line, CTX)
  expect(isLaunchExe('E:\\Godot\\Godot_v4.4-stable_win64.exe')).toBe(true)
  expect(isLaunchExe('blender')).toBe(true)
  expect(isLaunchExe('docs/godot.md')).toBe(false)
  expect(p('"E:/Godot/Godot_v4.4-stable_win64.exe" --path . --log-file x.log')[0]).toContain('launches godot_v4.4-stable_win64.exe')
  expect(p('Start-Process -FilePath "C:\\Program Files\\Blender\\blender.exe" -ArgumentList "-b"')[0]).toContain('launches blender.exe')
  expect(p("& 'E:\\Godot\\Godot_v4.4-stable_win64_console.exe' --headless")[0]).toContain('launches')
  expect(p('bash -c "blender -b x.blend --python y.py"')[0]).toContain('launches blender')

  expect(p("sed -i 's/a/b/' scripts/player.gd")[0]).toContain('`sed -i` writes scripts/player.gd')
  expect(p('echo x > scripts/a.gd')[0]).toContain('redirects into scripts/a.gd')
  expect(p('echo x >> docs/plan/a.md')).toEqual([])
  expect(p('cat > docs/studio/notes.md <<EOF\n- a\nEOF')).toEqual([])
  expect(p('Set-Content -Path scenes/a.tscn -Value "x"')[0]).toContain('`set-content` writes scenes/a.tscn')
  expect(p('Set-Content docs/plan/a.md "text with spaces"')).toEqual([])
  expect(p('rm -rf assets/models/copper_v2')[0]).toContain('`rm` writes assets/models/copper_v2')
  expect(p('cp docs/plan/a.md scripts/b.gd')[0]).toContain('`cp` writes scripts/b.gd')
  expect(p('cp scripts/a.gd docs/plan/a.md')).toEqual([])
  expect(p('cd scripts && touch a.gd')[0]).toContain('`touch` writes a.gd')
  expect(p('git checkout -- scripts/a.gd')[0]).toContain('`git checkout` changes files')
  expect(p('git reset --hard')[0]).toContain('`git reset`')
  expect(p('git stash')[0]).toContain('`git stash`')
  expect(p('python -c "open(\'scripts/a.gd\',\'w\').write(\'x\')"')[0]).toContain('inline python code writes scripts/a.gd')
  expect(p("python - <<'EOF'\nimport pathlib\npathlib.Path('scripts/a.gd').write_text('x')\nEOF")[0]).toContain('scripts/a.gd')
  expect(p('echo x > "$OUT"')[0]).toContain("a path the guard can't read")

  // reading, git reads, commits and sinks pass
  expect(p('git status --porcelain && git log --oneline -10 2>/dev/null')).toEqual([])
  expect(p('git add docs/studio && git commit -m "Studio: board and notes, 2026-11-15" -- docs/studio')).toEqual([])
  expect(p('git restore --staged docs/studio')).toEqual([])
  expect(p('grep -rn "godot" scripts | head -5')).toEqual([])
  expect(p('Get-Content scripts/a.gd 2>$null')).toEqual([])
  expect(p('ls scripts > /dev/null 2>&1')).toEqual([])
  expect(p('python tools/check.py')).toEqual([]) // a script file is not read (known gap)
})

test('the board commit holds docs/studio/ alone', () => {
  const ok = (line: string, staged: string[] = [], tracked: string[] = [], changed: string[] = []) =>
    directorCommitRefusal(planCommit(line), staged, tracked, changed)
  const many = ['scripts/a.gd', 'docs/studio/notes.md']
  expect(ok('git commit -m "Studio: board" -- docs/studio', ['scripts/a.gd'], [], many)).toBe(null)
  expect(ok('git add docs/studio && git commit -m "Studio: board"', [], [], many)).toBe(null)
  expect(ok('git commit -m "Studio: board"', ['docs/studio/notes.md'], [], many)).toBe(null)
  // a commit without docs/studio/ is the director's own business
  expect(ok('git commit -m "Plan: status" -- docs/plan/status_09.md', [], [], many)).toBe(null)
  expect(ok('git commit -m "x"', ['docs/studio/notes.md', 'scripts/a.gd'], [], many)).toContain('would also take in scripts/a.gd')
  expect(ok('git add -A && git commit -m x', [], [], many)).toContain('scripts/a.gd')
  expect(ok('git add . && git commit -m x', [], [], many)).toContain('scripts/a.gd')
  expect(ok('git commit -am x', [], ['scripts/a.gd', 'docs/studio/notes.md'], many)).toContain('scripts/a.gd')
  expect(ok('git commit -m x -- docs/studio docs/plan/a.md', [], [], many)).toContain('docs/plan/a.md')
  // redirections are never paths (stage 5's false refusal: "would also take in 2>")
  expect(ok('git commit -m "Studio: board" -- docs/studio 2>&1 | tail -3', ['scripts/a.gd'], [], many)).toBe(null)
  expect(ok('git commit -m "Studio: board" -- docs/studio > out.txt 2>/dev/null', ['scripts/a.gd'], [], many)).toBe(null)
  expect(ok('git add docs/studio 2>$null; git commit -m "Studio: board" -- docs/studio *> $null', ['scripts/a.gd'], [], many)).toBe(null)
  // a path after a redirection's target is still a path
  expect(ok('git commit -m x -- docs/studio > log.txt docs/plan/a.md', [], [], many)).toContain('docs/plan/a.md')
})

// ---- the snapshot ----

const NOW = Date.parse('2026-11-15T10:00:00Z')
const hAgo = (n: number) => new Date(NOW - n * 3_600_000).toISOString()
const row = (over: Partial<BoardRow>): BoardRow => ({
  id: 'local_x', tag: null, title: 'A chat', state: 'idle', since: hAgo(1), updatedAt: hAgo(1), ask: null, recap: '',
  lastCommit: null, context: { tokens: 50_000, pct: 5 }, isStalled: false, isFresh: false, isSelf: false, isUnreported: false,
  model: '', effort: '', turnClass: null, isCapped: false, ...over,
})
const view = (g: Partial<BoardGroups>): BoardView => ({
  at: NOW,
  header: { usage: [{ label: 'Weekly · all models', pct: 31, resetsIn: '2d' }], uncommitted: { changed: 70, untracked: 300 }, lastCommit: null },
  groups: { waiting: [], working: [], recent: [], quiet: [], ...g },
})
const G3E = row({ id: 'local_g3e', tag: 'G3e', title: "G3e: the Warden's sounds", state: 'waiting-you', since: hAgo(19), ask: { question: 'Build G3e?', buttons: ['Yes'] } })
const VAULT = row({ id: 'local_vault', title: 'Vault v2', recap: 'Sorting is on the way to the vault.', lastCommit: { hash: 'abc1234def', subject: 'Vault: belts', at: hAgo(3) } })
const SELF = row({ id: 'local_me', title: 'Director', isSelf: true })
const OLD = row({ id: 'local_old', title: 'Old metro chat', updatedAt: hAgo(100) })

test('the first snapshot is the full board with ids, git, usage and notes; the director is left out', () => {
  const s = snapshotText({ view: view({ waiting: [G3E], recent: [VAULT, SELF], quiet: [OLD] }), seen: null, log: 'cf89356 Plan: status_09\n8579024 N1c room 12\n', notes: '# Studio notes\n\n- 2026-11-15 09:00: G5 waits.\n' })
  expect(s.text).toContain('<studio-snapshot kind="full"')
  expect(s.text).toContain('every Scrapshift chat but this one (3)')
  expect(s.text).toContain("  G3e: the Warden's sounds [local_g3e] · waiting 19h")
  expect(s.text).toContain('    ask: Build G3e?  [Yes]')
  expect(s.text).toContain('  Vault v2 [local_vault] · idle 1h · 5 % (50k) · commit abc1234 Vault: belts')
  expect(s.text).toContain('    recap: Sorting is on the way to the vault.')
  expect(s.text).toContain('  Old metro chat [local_old] · idle 4d 4h')
  expect(s.text).not.toContain('local_me')
  expect(s.text).toContain('Working now (0)\n  none')
  expect(s.text).toContain('7-day usage: all models 31 %')
  expect(s.text).toContain('370 uncommitted: 70 changed, 300 new')
  expect(s.text).toContain('  cf89356 Plan: status_09')
  expect(s.text).toContain('- 2026-11-15 09:00: G5 waits.')
  expect(Object.keys(s.seen).sort()).toEqual(['local_g3e', 'local_old', 'local_vault'])
})

test('later snapshots list only changes, always the waits, and chats that went away', () => {
  const first = snapshotText({ view: view({ waiting: [G3E], recent: [VAULT], quiet: [OLD] }), seen: null, log: '', notes: null })
  const same = snapshotText({ view: view({ waiting: [G3E], recent: [VAULT], quiet: [OLD] }), seen: first.seen, log: '', notes: null })
  expect(same.text).toContain('kind="changes"')
  expect(same.text).toContain('0 of 3 chats changed')
  expect(same.text).toContain('[local_g3e]') // the wait is always there
  expect(same.text).not.toContain('[local_vault]')
  expect(same.text).toContain('No other board changes.')
  expect(same.text).toContain('(no notes yet)')

  const moved = row({ ...VAULT, state: 'working', since: hAgo(0.1) })
  const next = snapshotText({ view: view({ waiting: [G3E], working: [moved] }), seen: same.seen, log: '', notes: null })
  expect(next.text).toContain('1 of 2 chats changed, 1 gone')
  expect(next.text).toContain('Working now: changed\n  Vault v2 [local_vault] · working 6m')
  expect(next.text).toContain('Gone (archived or deleted)\n  [local_old]')
  // a small context move is no change; ten points is
  const ctx = snapshotText({ view: view({ waiting: [G3E], working: [row({ ...moved, context: { tokens: 90_000, pct: 9 } })] }), seen: next.seen, log: '', notes: null })
  expect(ctx.text).toContain('0 of 2 chats changed')
  const ctx2 = snapshotText({ view: view({ waiting: [G3E], working: [row({ ...moved, context: { tokens: 160_000, pct: 16 } })] }), seen: next.seen, log: '', notes: null })
  expect(ctx2.text).toContain('1 of 2 chats changed')
})

// ---- notes ----

test('notes: a dated line is added; past the cap the oldest move to the archive', () => {
  const at = new Date(2026, 10, 15, 9, 5).getTime()
  const one = addNote(null, 'G5 stage 5 goes first.', at)
  expect(one.startsWith(NOTES_SEED.trimEnd())).toBe(true)
  expect(one.endsWith('\n\n- 2026-11-15 09:05: G5 stage 5 goes first.\n')).toBe(true)
  const two = addNote(one, 'Then N1d-C.', at)
  expect(two.endsWith('- 2026-11-15 09:05: G5 stage 5 goes first.\n- 2026-11-15 09:05: Then N1d-C.\n')).toBe(true)

  expect(capNotes(two)).toBe(null)
  let big = '# Studio notes\n\nheader text\n\n'
  for (let i = 1; i <= NOTES_MAX + 3; i++) big += `- note ${i}\n`
  const cut = capNotes(big)
  expect(cut?.moved).toEqual(['- note 1', '- note 2', '- note 3'])
  expect(cut?.notes.startsWith('# Studio notes\n\nheader text\n\n- note 4\n')).toBe(true)
  expect(cut?.notes.split('\n').filter(l => l.startsWith('- ')).length).toBe(NOTES_MAX)
  const archive = appendArchive(null, cut?.moved ?? [])
  expect(archive).toContain('# Studio notes archive')
  expect(archive.endsWith('- note 1\n- note 2\n- note 3\n')).toBe(true)
  expect(appendArchive(archive, ['- note 4']).endsWith('- note 3\n- note 4\n')).toBe(true)
})

test('a chat with a model reply is too late for /director', () => {
  expect(isUsedChat([])).toBe(false)
  expect(isUsedChat([{ role: 'user' }])).toBe(false)
  expect(isUsedChat([{ role: 'user' }, { role: 'assistant' }])).toBe(true)
})
