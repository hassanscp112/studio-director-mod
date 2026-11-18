// Studio Director, stage 3: the guard (docs/STUDIO_DIRECTOR.md §5.6) and the
// director's board commit (§5.8). Pure functions, no engine calls: a tool call
// in, the reason it is refused (or null) out. The guard runs in the director
// chat only: "the director plans; a milestone chat builds".
import { coversStudio, splitCommands, wrapped, type CommitPlan } from './parse'

/** What the guard knows about the chat: where the project is, its memory folder's name, its own id. */
export type GuardContext = {
  /** The main checkout's root. */
  root: string
  /** The chat's working directory (the root, or a worktree inside it). */
  cwd: string
  /** The engine session id: this chat's scratchpad sits under a folder of that name. */
  cliId: string
}

export const RULE = 'the director plans; a milestone chat builds'

export const ALLOWED_TEXT =
  'docs/**/*.md, docs/studio/**, CLAUDE.md, the project memory folder, this chat\'s scratchpad, side-session notes (.md) and plan files (.md)'

/** The refusal the model reads: what was refused, the rule, and what is allowed. */
export function guardRefusal(what: string): string {
  return (
    `studio guard: refused in the director chat: ${what}. ${RULE[0]?.toUpperCase()}${RULE.slice(1)}. ` +
    `Allowed writes here: ${ALLOWED_TEXT}. Put the work in a brief for a milestone chat instead.`
  )
}

// ---------------------------------------------------------------- paths

/** The memory folder's name under ~/.claude/projects: the root with every other character a dash. */
export const projectSlug = (root: string): string => root.replace(/[\\/]+$/, '').replace(/[^A-Za-z0-9]/g, '-')

const isAbs = (p: string) => /^[A-Za-z]:\//.test(p) || p.startsWith('/') || p.startsWith('~')

/**
 * A path made absolute against `base`, forward slashes, `.` and `..` folded,
 * lower case (Windows paths compare without case). Git Bash's `/e/x` reads as `e:/x`.
 */
export function normPath(path: string, base: string): string {
  let p = path.trim().replace(/\\/g, '/')
  const m = /^\/([A-Za-z])(\/|$)/.exec(p)
  if (m) p = `${m[1]}:/${p.slice(3)}`
  if (!isAbs(p)) p = `${base.replace(/\\/g, '/').replace(/\/+$/, '')}/${p}`
  const drive = /^[A-Za-z]:/.exec(p)?.[0] ?? ''
  const rest = p.slice(drive.length)
  const out: string[] = []
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  const lead = p.startsWith('~') ? '' : '/'
  return `${drive}${lead}${out.join('/')}`.toLowerCase()
}

const SINKS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', 'nul', 'nul:', '$null', 'con'])

/** Whether the director may write `path` (already absolute or relative to `base`). */
export function isAllowedPath(path: string, base: string, ctx: GuardContext): boolean {
  const raw = path.trim().replace(/^["']|["']$/g, '')
  if (SINKS.has(raw.toLowerCase())) return true
  const p = normPath(raw, base)
  const bases = [normPath(ctx.root, '/'), normPath(ctx.cwd, '/')].sort((a, b) => b.length - a.length)
  const isMd = p.endsWith('.md')
  for (const b of bases) {
    if (b === '/' || !p.startsWith(`${b}/`)) continue
    const rel = p.slice(b.length + 1)
    if (rel === 'claude.md') return true
    if (rel.startsWith('docs/studio/')) return true
    if (rel.startsWith('docs/') && isMd) return true
    return false
  }
  if (isMd && p.includes(`/projects/${projectSlug(ctx.root).toLowerCase()}/memory/`)) return true
  if (ctx.cliId !== '' && p.includes(`/${ctx.cliId.toLowerCase()}/scratchpad/`)) return true
  if (isMd && p.includes('/side-session-notes/')) return true
  if (/\/\.claude\/plans\/[^/]+\.md$/.test(p)) return true
  return false
}

// ---------------------------------------------------------------- tool calls

const FILE_TOOLS: Record<string, string> = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' }

/** Fennara's tools that write or run code in the project or the game. */
const FENNARA_WRITES = /^mcp__.*fennara.*__(write_or_update_file|run_scene_edit_script|run_asset_import_script|runtime_script|runtime_session)$/i
const BLENDER_CODE = /^mcp__.*blender.*__execute_blender_code/i

/**
 * Why the director chat may not make this tool call, or null. `input` is the
 * call's input (the tool.call event's fields beside `tool`).
 */
export function guardTool(tool: string, input: Record<string, unknown>, ctx: GuardContext): string | null {
  const key = FILE_TOOLS[tool]
  if (key !== undefined) {
    const path = typeof input[key] === 'string' ? (input[key] as string) : ''
    if (path === '') return guardRefusal(`${tool} with no path`)
    return isAllowedPath(path, ctx.cwd, ctx) ? null : guardRefusal(`${tool} ${path}`)
  }
  if (FENNARA_WRITES.test(tool)) return guardRefusal(`${tool} (Fennara writes and scene, import or runtime scripts)`)
  if (BLENDER_CODE.test(tool)) return guardRefusal(`${tool} (Blender code)`)
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = typeof input.command === 'string' ? input.command : ''
    const why = shellProblems(command, ctx)
    return why.length === 0 ? null : guardRefusal(why.join('; '))
  }
  return null
}

// ---------------------------------------------------------------- shell lines

const base = (w: string) => (w.replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase()

/** A Godot or Blender executable. */
export function isLaunchExe(word: string): boolean {
  const b = base(word.replace(/^["']|["']$/g, ''))
  return /^godot.*\.exe$/.test(b) || /^godot[\d._-]*$/.test(b) || /^blender(\.exe)?$/.test(b)
}

const LAUNCHERS = new Set(['start-process', 'saps', 'start', 'invoke-item', 'ii', 'open', 'xdg-open', 'nohup', 'setsid'])
const CD = new Set(['cd', 'pushd', 'set-location', 'sl', 'chdir'])

/** Commands that write every path they name. */
const WRITE_ALL = new Set([
  'rm', 'del', 'erase', 'rd', 'rmdir', 'remove-item', 'ri', 'mv', 'move', 'mi', 'move-item', 'mkdir', 'md', 'new-item', 'ni',
  'touch', 'truncate', 'tee', 'tee-object', 'unlink', 'shred', 'rename-item', 'rni', 'ren', 'clear-content', 'clc',
])
/** Commands that write their first path only (the rest is the value). */
const WRITE_FIRST = new Set(['set-content', 'sc', 'add-content', 'ac', 'out-file'])
/** Commands that write their last path only (the destination). */
const WRITE_LAST = new Set(['cp', 'copy', 'cpi', 'copy-item', 'install', 'ln', 'robocopy', 'xcopy', 'rsync', 'scp'])
/** PowerShell flags whose value is the path written. */
const PATH_FLAGS = new Set(['-path', '-literalpath', '-filepath', '-destination', '-target'])

const INTERPRETERS = /^(python[\d.]*|py|node|deno|bun|ruby|php|perl)(\.exe)?$/
const CODE_FLAGS = new Set(['-c', '-e', '--eval', '-E', '-r'])
const WRITE_CODE =
  /open\([^)]*['"][wax]\+?b?['"]|write_text|write_bytes|writeFile|appendFile|createWriteStream|shutil\.(copy|move|rmtree)|os\.(remove|unlink|rename|replace|makedirs|mkdir|rmdir)|\.unlink\(|\.rename\(|\.mkdir\(|rmSync|unlinkSync|renameSync|copyFileSync|mkdirSync|File\.(Write|Append|Copy|Move|Delete)|\.save\(/i

/** Git subcommands that change files in the working tree (the director only commits). */
function gitChangesTree(sub: string, args: string[]): boolean {
  const has = (...f: string[]) => args.some(a => f.includes(a))
  switch (sub) {
    case 'checkout': case 'switch': case 'clean': case 'merge': case 'rebase': case 'pull': case 'cherry-pick':
    case 'revert': case 'am': case 'mv': case 'checkout-index':
      return true
    case 'restore':
      return !has('--staged', '-S') || has('--worktree', '-W')
    case 'reset':
      return has('--hard', '--merge', '--keep')
    case 'stash':
      return !['list', 'show'].includes(args[0] ?? '')
    case 'apply':
      return !has('--cached', '--check', '--stat', '--numstat')
    case 'rm':
      return !has('--cached')
    case 'worktree':
      return ['add', 'remove', 'move'].includes(args[0] ?? '')
    default:
      return false
  }
}

/** Quoted path-like strings in inline code: what it would write, when it writes. */
function codePaths(code: string): string[] {
  const out: string[] = []
  for (const m of code.matchAll(/(['"])((?:(?!\1).){2,})\1/g)) {
    const s = m[2] as string
    if (/[\\/]/.test(s) || /\.[A-Za-z0-9]{1,6}$/.test(s)) out.push(s)
  }
  return out
}

/**
 * What a shell line does that the director may not: launch Godot or Blender,
 * write a path outside the allowed ones, change the working tree through git,
 * or write through inline code. Wrappers (`bash -c`, `powershell -Command`,
 * `cmd /c`) are read inside, and a `cd` moves the base for relative paths. A
 * script file run by an interpreter is not read (a known gap).
 */
export function shellProblems(line: string, ctx: GuardContext, depth = 0, startDir: string | null = null): string[] {
  const out: string[] = []
  const add = (s: string) => {
    if (!out.includes(s)) out.push(s)
  }
  let dir = startDir ?? ctx.cwd
  const at = (d: string) => (isAbs(d.replace(/\\/g, '/')) ? d : `${dir.replace(/[\\/]+$/, '')}/${d}`)
  const target = (path: string, how: string) => {
    if (path === '' || path.startsWith('&')) return
    if (/\$/.test(path) && !SINKS.has(path.toLowerCase())) add(`${how} a path the guard can't read (${path})`)
    else if (!isAllowedPath(path, dir, ctx)) add(`${how} ${path}`)
  }
  // A heredoc fed to an interpreter (`python - <<'EOF'`): the body is in the line.
  const isHeredoc = /<<-?\s*['"]?\w+/.test(line)

  for (const words of splitCommands(line)) {
    let i = 0
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i] as string)) i++
    while (i < words.length && ['command', 'exec', 'sudo', 'time', 'env'].includes((words[i] as string).toLowerCase())) i++
    const head = words[i]
    if (head === undefined) continue
    const rest = words.slice(i + 1)
    const name = base(head).replace(/\.exe$/, '')

    // redirections, anywhere in the command
    for (let k = i; k < words.length; k++) {
      const m = /^(\d|&|\*)?>>?(.*)$/.exec(words[k] as string)
      if (!m) continue
      target(m[2] !== '' ? (m[2] as string) : (words[k + 1] ?? ''), 'redirects into')
    }
    const positional = rest.filter(w => !/^(\d|&|\*)?>>?/.test(w))

    const inner = depth < 3 ? wrapped(head, rest) : null
    if (inner !== null) {
      for (const p of shellProblems(inner, ctx, depth + 1, dir)) add(p)
      continue
    }
    if (CD.has(name)) {
      const d = rest.filter(w => !/^-(Path|LiteralPath)$/i.test(w))[0]
      if (d !== undefined) dir = at(d)
      continue
    }
    if (isLaunchExe(head)) {
      add(`launches ${base(head)} (Godot and Blender run in milestone chats)`)
      continue
    }
    if (LAUNCHERS.has(name)) {
      const fp = rest.findIndex(w => /^-filepath$/i.test(w))
      const exe = fp >= 0 ? rest[fp + 1] : rest.find(w => !w.startsWith('-'))
      if (exe !== undefined && isLaunchExe(exe)) add(`launches ${base(exe)} (Godot and Blender run in milestone chats)`)
      continue
    }
    if (name === 'git') {
      let k = 0
      while (k < rest.length && (rest[k] as string).startsWith('-')) k += rest[k] === '-C' || rest[k] === '-c' ? 2 : 1
      const sub = rest[k]
      if (sub !== undefined && gitChangesTree(sub, rest.slice(k + 1))) add(`\`git ${sub}\` changes files in the working tree`)
      continue
    }

    // PowerShell path flags name the target outright
    const flagged: string[] = []
    const plain: string[] = []
    for (let k = 0; k < positional.length; k++) {
      const w = positional[k] as string
      if (PATH_FLAGS.has(w.toLowerCase())) {
        if (positional[k + 1] !== undefined) flagged.push(positional[++k] as string)
      } else if (/^-[A-Za-z][\w-]*$/.test(w) && /-/.test(name)) {
        // another cmdlet flag: its value (if any) is not a path
        const next = positional[k + 1]
        if (next !== undefined && !next.startsWith('-') && !/^-(force|recurse|append|confirm(:\$\w+)?|whatif|nonewline|passthru)$/i.test(w)) k++
      } else if (!w.startsWith('-')) plain.push(w)
    }
    if (WRITE_ALL.has(name)) {
      for (const p of [...flagged, ...plain]) target(p, `\`${name}\` writes`)
      continue
    }
    if (WRITE_FIRST.has(name)) {
      for (const p of flagged.length > 0 ? flagged : plain.slice(0, 1)) target(p, `\`${name}\` writes`)
      continue
    }
    if (WRITE_LAST.has(name)) {
      const dest = flagged.length > 0 ? flagged : plain.slice(-1)
      for (const p of plain.length > 1 || flagged.length > 0 ? dest : []) target(p, `\`${name}\` writes`)
      continue
    }
    if (name === 'dd') {
      for (const w of rest) if (w.startsWith('of=')) target(w.slice(3), '`dd` writes')
      continue
    }
    if ((name === 'sed' || name === 'perl') && rest.some(w => /^-[A-Za-z]*i/.test(w) || w.startsWith('--in-place'))) {
      const hasScript = rest.some(w => w === '-e' || w === '-f' || w.startsWith('--expression'))
      const files: string[] = []
      for (let k = 0; k < rest.length; k++) {
        const w = rest[k] as string
        if (w === '-e' || w === '-f') k++
        else if (!w.startsWith('-')) files.push(w)
      }
      for (const p of hasScript ? files : files.slice(1)) target(p, `\`${name} -i\` writes`)
      continue
    }
    if (INTERPRETERS.test(name)) {
      const ci = rest.findIndex(w => CODE_FLAGS.has(w))
      const code = ci >= 0 ? (rest[ci + 1] ?? '') : isHeredoc ? line : ''
      if (code === '' || !WRITE_CODE.test(code)) continue
      const paths = codePaths(code)
      if (paths.length === 0) add(`inline ${name} code writes files the guard can't place`)
      for (const p of paths) target(p, `inline ${name} code writes`)
    }
  }
  return out
}

// ---------------------------------------------------------------- the board commit (§5.8)

const underStudio = (spec: string): boolean => {
  const p = spec.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').toLowerCase()
  return p === 'docs/studio' || p.startsWith('docs/studio/')
}

/**
 * Why the director's commit is refused, or null. The board commit holds
 * docs/studio/ alone (§5.8): one that takes in docs/studio/ and anything else
 * is refused; a commit without docs/studio/ is the director's own business.
 * `staged`: every staged path; `tracked`: every tracked path with unstaged
 * changes; `changed`: every changed path, new ones too (all from the root).
 */
export function directorCommitRefusal(plan: CommitPlan, staged: string[], tracked: string[], changed: string[]): string | null {
  if (!plan.isCommit || !plan.isParsed) return null
  const included = new Set<string>()
  if (plan.commitPaths.length > 0) {
    // `git commit -- <paths>` commits those paths alone
    for (const spec of plan.commitPaths) {
      if (underStudio(spec)) included.add('docs/studio/')
      else included.add(spec)
    }
  } else {
    for (const p of staged) included.add(underStudio(p) ? 'docs/studio/' : p)
    if (plan.isCommitAll) for (const p of tracked) included.add(underStudio(p) ? 'docs/studio/' : p)
    if (plan.isAddAll) for (const p of changed) included.add(underStudio(p) ? 'docs/studio/' : p)
    for (const spec of plan.addPaths) {
      if (underStudio(spec)) included.add('docs/studio/')
      else if (coversStudio(spec)) {
        // `.`, `docs`, `:/`: docs/studio/ and whatever else it reaches
        for (const p of changed) if (!underStudio(p)) included.add(p)
        included.add('docs/studio/')
      } else included.add(spec)
    }
  }
  if (!included.has('docs/studio/')) return null
  const others = [...included].filter(p => p !== 'docs/studio/')
  if (others.length === 0) return null
  const head = others.slice(0, 3).join(', ')
  const list = others.length > 3 ? `${head} and ${others.length - 3} more` : head
  return (
    `studio: commit refused. The director's board commit holds docs/studio/ alone (§5.8); this one would also take in ${list}. ` +
    'Commit docs/studio/ by itself (`git commit -m "Studio: board and notes, <date>" -- docs/studio`), and anything else apart.'
  )
}
