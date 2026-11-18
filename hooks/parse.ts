// Pure helpers for the studio reporter: the tag rule, the report's fixed shape,
// the wrap-up and question readers, and reading git commands out of shell lines.
import type { Ask, Report, Routing } from '../types'

export const STUDIO_DIR = 'docs/studio'
export const RECAP_MAX = 300

// ---------------------------------------------------------------- tag and recap

/**
 * The workstream tag at the head of a chat's title: `G5 stage 4: …` → `G5`,
 * `N1d-C: …` → `N1d`, `M9 3a` → `M9`. A title with no such code has no tag.
 */
export function tagFromTitle(title: string): string | null {
  const m = /^\s*([A-Z]{1,3}\d{1,2}[a-z]?)(?=$|[\s:\-–—.,/(])/.exec(title)
  return m?.[1] ?? null
}

/** A manual tag wins over the title's. */
export function pickTag(title: string, manual: string | null): Pick<Report, 'tag' | 'tagSource'> {
  if (manual) return { tag: manual, tagSource: 'manual' }
  const t = tagFromTitle(title)
  return t ? { tag: t, tagSource: 'title' } : { tag: null, tagSource: null }
}

/** The first RECAP_MAX characters of an answer, whitespace folded. */
export function recapFromAnswer(answer: string): string {
  const flat = answer.replace(/\s+/g, ' ').trim()
  return flat.length <= RECAP_MAX ? flat : `${flat.slice(0, RECAP_MAX - 1).trimEnd()}…`
}

// ---------------------------------------------------------------- wrap-up and questions

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** What a `mcp__ccd_turn__wrap_up` call says: its recap, and its ask with the buttons' labels. */
export function readWrapUp(input: unknown): { recap: string; ask: Ask | null } {
  const x = (input ?? {}) as Record<string, unknown>
  const question = str(x.ask).trim()
  const actions = Array.isArray(x.actions) ? (x.actions as unknown[]) : []
  const buttons = actions
    .map(a => {
      const o = (a ?? {}) as Record<string, unknown>
      return str(o.label).trim() || str(o.action).trim()
    })
    .filter(b => b !== '')
  return { recap: str(x.recap).trim(), ask: question ? { question, buttons } : null }
}

/** An open `AskUserQuestion`: its first question and that question's option labels. */
export function readQuestion(input: unknown): Ask | null {
  const x = (input ?? {}) as Record<string, unknown>
  const qs = Array.isArray(x.questions) ? (x.questions as unknown[]) : []
  const first = (qs[0] ?? {}) as Record<string, unknown>
  const question = str(first.question).trim()
  if (!question) return null
  const opts = Array.isArray(first.options) ? (first.options as unknown[]) : []
  const buttons = opts.map(o => str(((o ?? {}) as Record<string, unknown>).label).trim()).filter(b => b !== '')
  const more = qs.length > 1 ? ` (+${qs.length - 1} more)` : ''
  return { question: question + more, buttons }
}

// ---------------------------------------------------------------- the report

export function emptyReport(cliId: string, cwd: string, at: string): Report {
  return {
    schema: 2,
    appId: null,
    cliId,
    title: '',
    tag: null,
    tagSource: null,
    state: 'idle',
    stateSince: at,
    updatedAt: at,
    turns: 0,
    recap: '',
    ask: null,
    lastCommit: null,
    context: null,
    model: '',
    effort: '',
    turnClass: null,
    classMs: null,
    routings: [],
    cwd,
  }
}

const copyRouting = (x: Routing): Routing => ({
  at: x.at,
  agentType: x.agentType,
  asked: x.asked,
  sent: x.sent,
  ranOn: x.ranOn,
  why: x.why,
  isCapped: x.isCapped,
})

/**
 * The report with `patch` applied, its keys in the fixed order, `stateSince`
 * moved only when the state changes and `updatedAt` set to `at`.
 */
export function applyPatch(prev: Report, patch: Partial<Report>, at: string): Report {
  const m = { ...prev, ...patch }
  return {
    schema: 2,
    appId: m.appId,
    cliId: m.cliId,
    title: m.title,
    tag: m.tag,
    tagSource: m.tagSource,
    state: m.state,
    stateSince: m.state !== prev.state ? at : prev.stateSince,
    updatedAt: at,
    turns: m.turns,
    recap: m.recap,
    ask: m.ask ? { question: m.ask.question, buttons: [...m.ask.buttons] } : null,
    lastCommit: m.lastCommit ? { hash: m.lastCommit.hash, subject: m.lastCommit.subject, at: m.lastCommit.at } : null,
    context: m.context ? { tokens: m.context.tokens, pct: m.context.pct } : null,
    model: m.model,
    effort: m.effort,
    // a schema 1 report has neither
    turnClass: typeof m.turnClass === 'string' ? m.turnClass : null,
    classMs: typeof m.classMs === 'number' ? m.classMs : null,
    routings: Array.isArray(m.routings) ? m.routings.map(copyRouting) : [],
    cwd: m.cwd,
  }
}

/** Pretty-printed, LF, one trailing newline: git diffs stay readable. */
export const serialize = (r: Report): string => `${JSON.stringify(r, null, 2)}\n`

/** The file's name under docs/studio/sessions/: the app id, else `cli-<id>`. */
export const reportName = (appId: string | null, cliId: string): string => `${appId ?? `cli-${cliId}`}.json`

/** `get_session("self")`'s JSON text: the app id, title, model, effort. */
export function readSelf(text: string): { appId: string; title: string; model: string; effort: string } | null {
  try {
    const x = JSON.parse(text) as Record<string, unknown>
    const appId = str(x.sessionId)
    if (!appId.startsWith('local_')) return null
    return { appId, title: str(x.title), model: str(x.model), effort: str(x.effort) }
  } catch {
    return null
  }
}

/** `get_usage`'s JSON text: this chat's context tokens and percent. */
export function readContext(text: string): { tokens: number; pct: number } | null {
  try {
    const c = ((JSON.parse(text) as Record<string, unknown>).context ?? {}) as Record<string, unknown>
    const tokens = Number(c.tokensUsed)
    const pct = Number(c.percentUsed)
    return Number.isFinite(tokens) && Number.isFinite(pct) ? { tokens, pct } : null
  } catch {
    return null
  }
}

/** `git rev-parse --path-format=absolute --git-common-dir` → the main checkout's root ('' when bare or unknown). */
export function rootFromCommonDir(out: string): string {
  const d = out.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return /\/\.git$/.test(d) ? d.slice(0, -5) : ''
}

// ---------------------------------------------------------------- shell commands

/**
 * A shell line cut into commands (on unquoted `;`, `&`, `|`, brackets, braces and newlines), each
 * a list of words with quotes removed. Good enough for bash and PowerShell
 * lines that run git; a backslash is literal except before a quote or space.
 */
export function splitCommands(line: string): string[][] {
  const out: string[][] = []
  let words: string[] = []
  let word = ''
  let hasWord = false
  let quote: '"' | "'" | null = null
  const endWord = () => {
    if (hasWord) words.push(word)
    word = ''
    hasWord = false
  }
  const endCmd = () => {
    endWord()
    if (words.length > 0) out.push(words)
    words = []
  }
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && (line[i + 1] === '"' || line[i + 1] === '\\')) word += line[++i]
      else word += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      hasWord = true
    } else if (c === '\\' && (line[i + 1] === '"' || line[i + 1] === "'" || line[i + 1] === ' ')) {
      word += line[++i]
      hasWord = true
    } else if (c === ';' || c === '&' || c === '|' || c === '\n' || c === '\r') {
      endCmd()
    } else if (c === ' ' || c === '\t') {
      endWord()
    } else if (c === '(' || c === ')' || c === '{' || c === '}') {
      // subshells, `$(...)`, bash brace groups, PowerShell's `if ($?) { git commit }`
      endCmd()
    } else {
      word += c
      hasWord = true
    }
  }
  endCmd()
  return out
}

export type GitCall = { sub: string; args: string[]; dir: string | null }

const isGitExe = (w: string): boolean => /(^|[\\/])git(\.exe)?$/i.test(w)
const CD = new Set(['cd', 'pushd', 'set-location', 'sl', 'chdir'])

const SH = /(^|[\\/])(bash|sh|zsh|dash)(\.exe)?$/i
const PWSH = /(^|[\\/])(powershell|pwsh)(\.exe)?$/i
const CMD = /(^|[\\/])cmd(\.exe)?$/i

/** The script a shell wrapper runs (`bash -c '…'`, `powershell -Command …`, `cmd /c …`), else null. */
export function wrapped(head: string, rest: string[]): string | null {
  if (SH.test(head)) {
    const at = rest.findIndex(w => /^-[a-z]*c[a-z]*$/.test(w))
    return at >= 0 ? (rest[at + 1] ?? null) : null
  }
  if (PWSH.test(head)) {
    const at = rest.findIndex(w => /^-(c|command)$/i.test(w))
    return at >= 0 ? rest.slice(at + 1).join(' ') : null
  }
  if (CMD.test(head)) {
    const at = rest.findIndex(w => /^\/[ck]$/i.test(w))
    return at >= 0 ? rest.slice(at + 1).join(' ') : null
  }
  return null
}

/** Every git call in a shell line, with the directory it runs in when the line says (`-C`, or a `cd` before it). */
export function gitCalls(line: string, depth = 0, startDir: string | null = null): GitCall[] {
  const calls: GitCall[] = []
  let cdDir: string | null = startDir
  for (const words of splitCommands(line)) {
    let i = 0
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i] as string)) i++
    while (i < words.length && ['command', 'exec', 'sudo', 'time'].includes(words[i] as string)) i++
    const head = words[i]
    if (head === undefined) continue
    const inner = depth < 3 ? wrapped(head, words.slice(i + 1)) : null
    if (inner !== null) {
      calls.push(...gitCalls(inner, depth + 1, cdDir))
      continue
    }
    if (CD.has(head.toLowerCase())) {
      const rest = words.slice(i + 1).filter(w => !/^-(Path|LiteralPath)$/i.test(w))
      if (rest[0] !== undefined) cdDir = rest[0]
      continue
    }
    if (!isGitExe(head)) continue
    let dir = cdDir
    i++
    while (i < words.length) {
      const w = words[i] as string
      if (w === '-C') {
        dir = words[i + 1] ?? dir
        i += 2
      } else if (w === '-c') i += 2
      else if (w.startsWith('-')) i++
      else break
    }
    const sub = words[i]
    if (sub === undefined) continue
    calls.push({ sub, args: words.slice(i + 1), dir })
  }
  return calls
}

const COMMIT_VALUE_SHORT = new Set(['m', 'F', 'C', 'c', 't'])
const COMMIT_VALUE_LONG = new Set([
  '--message',
  '--file',
  '--author',
  '--date',
  '--template',
  '--reuse-message',
  '--reedit-message',
  '--fixup',
  '--squash',
  '--cleanup',
  '--trailer',
  '--pathspec-from-file',
])

/**
 * A command's words without its redirections (`2>&1`, `> log`, `2>/dev/null`, `*>`, `< in`):
 * a redirection is never a path the command takes. The splitter cuts `2>&1` at `&`, so its
 * `2>` comes alone; an operator with no target joined takes the next word as its target.
 */
export function dropRedirects(args: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const m = /^(\d|&|\*)?(>>?|<)(.*)$/.exec(args[i] as string)
    if (m === null) out.push(args[i] as string)
    else if (m[3] === '') i++ // the target is the next word (none after a lone `2>`)
  }
  return out
}

/** A `git commit`'s `-a` and the paths it names. */
export function readCommitArgs(words: string[]): { isAll: boolean; paths: string[] } {
  let isAll = false
  const paths: string[] = []
  const args = dropRedirects(words)
  for (let i = 0; i < args.length; i++) {
    const w = args[i] as string
    if (w === '--') {
      paths.push(...args.slice(i + 1))
      break
    }
    if (w === '--all') isAll = true
    else if (w.startsWith('--')) {
      if (!w.includes('=') && COMMIT_VALUE_LONG.has(w)) i++
    } else if (w.startsWith('-') && w.length > 1) {
      for (let k = 1; k < w.length; k++) {
        const ch = w[k] as string
        if (ch === 'a') isAll = true
        if (COMMIT_VALUE_SHORT.has(ch)) {
          if (k === w.length - 1) i++
          break
        }
      }
    } else paths.push(w)
  }
  return { isAll, paths }
}

/** A `git add`'s "everything" flags and the paths it names. */
export function readAddArgs(args: string[]): { isAll: boolean; paths: string[] } {
  let isAll = false
  const paths: string[] = []
  let isPaths = false
  for (const w of dropRedirects(args)) {
    if (isPaths || !w.startsWith('-')) paths.push(w)
    else if (w === '--') isPaths = true
    else if (w === '-A' || w === '--all' || w === '-u' || w === '--update' || /^-[a-zA-Z]*[Au]/.test(w)) isAll = true
  }
  return { isAll, paths }
}

/** Whether a pathspec (taken from the repo root) can reach docs/studio/. */
export function coversStudio(spec: string): boolean {
  let p = spec.trim().replace(/\\/g, '/')
  if (p === '' || p === '.' || p === './' || p === '*' || p === ':/' || p.startsWith(':')) return true
  p = p.replace(/^(\.\/)+/, '').replace(/\/+$/, '')
  const low = p.toLowerCase()
  // the folder itself, not a sibling that starts the same (docs/STUDIO_DIRECTOR.md)
  if (/(^|\/)docs\/studio(\/|$)/.test(low)) return true
  if (low === 'docs' || low === 'docs/*' || low === 'docs/**') return true
  return /^docs\/[^/]*\*/.test(low) && 'studio'.startsWith(low.slice(5).split('*')[0] ?? '')
}

export type CommitPlan = {
  /** The line runs `git commit`, or names both `git` and `commit` in a way not read (a script, an odd wrapper). */
  isCommit: boolean
  /** The line was read: its `git commit` call was found. */
  isParsed: boolean
  /** Where the commit runs, when the line says; null: the session's directory. */
  dir: string | null
  /** `git commit -a` / `--all`. */
  isCommitAll: boolean
  /** The commit names a path that reaches docs/studio/. */
  isCommitPathStudio: boolean
  /** A `git add` in the same line before the commit reaches docs/studio/ (`-A`, `.`, the folder). */
  isAddStudio: boolean
  /** The paths the line's `git add` calls before the commit name. */
  addPaths: string[]
  /** A `git add` before the commit stages everything (`-A`, `-u`). */
  isAddAll: boolean
  /** The paths the commit itself names (it then commits only those). */
  commitPaths: string[]
}

/** What a shell line's commit would take in, read from the line alone (git is asked separately). */
export function planCommit(line: string): CommitPlan {
  const calls = gitCalls(line)
  const at = calls.findIndex(c => c.sub === 'commit')
  // a git call that was read and isn't a commit (`git log --grep commit`) settles it; no git call read at all doesn't
  const isLoose = calls.length === 0 && /\bgit\b/i.test(line) && /\bcommit\b/i.test(line)
  const plan: CommitPlan = { isCommit: at >= 0 || isLoose, isParsed: at >= 0, dir: null, isCommitAll: false, isCommitPathStudio: false, isAddStudio: false, addPaths: [], isAddAll: false, commitPaths: [] }
  if (at < 0) return plan
  const commit = calls[at] as GitCall
  const c = readCommitArgs(commit.args)
  plan.dir = commit.dir
  plan.isCommitAll = c.isAll
  plan.isCommitPathStudio = c.paths.some(coversStudio)
  plan.commitPaths = c.paths
  for (const call of calls.slice(0, at)) {
    if (call.sub !== 'add' && call.sub !== 'stage') continue
    const a = readAddArgs(call.args)
    if (a.isAll || a.paths.some(coversStudio)) plan.isAddStudio = true
    if (a.isAll) plan.isAddAll = true
    plan.addPaths.push(...a.paths)
  }
  return plan
}

/**
 * Why a worker's commit is refused, or null to let it through.
 * `staged`: docs/studio/ paths already staged. `changed`: docs/studio/ paths
 * with changes not yet staged (tracked or not), which `-a`, `git add -A` or a
 * path naming the folder would take in.
 */
export function refusal(plan: CommitPlan, staged: string[], changed: { tracked: string[]; all: string[] }): string | null {
  if (!plan.isCommit) return null
  const reasons: string[] = []
  if (staged.length > 0) reasons.push(`staged: ${list(staged)}`)
  if (plan.isCommitAll && changed.tracked.length > 0) reasons.push(`\`commit -a\` would take in ${list(changed.tracked)}`)
  if (plan.isAddStudio && changed.all.length > 0) reasons.push(`the \`git add\` in this command would stage ${list(changed.all)}`)
  if (plan.isCommitPathStudio && changed.all.length > 0) reasons.push(`the commit's paths reach ${list(changed.all)}`)
  if (reasons.length === 0) return null
  return (
    `studio: commit refused. Unstage docs/studio/: the director commits it (${reasons.join('; ')}). ` +
    'Run `git restore --staged docs/studio` and commit again, adding only your own files by path. ' +
    'Only the user can let one docs/studio/ commit through, by typing /studio allow-commit.'
  )
}

/** The model's note after a commit that took in docs/studio/ although the check let it through. */
export function studioCommitNote(hash: string, files: string[]): string {
  return (
    `studio: commit ${hash.slice(0, 9)} includes docs/studio/ (${list(files)}), which only the director commits. ` +
    'Tell the user in your reply; do not rewrite history to undo it.'
  )
}

function list(paths: string[]): string {
  const head = paths.slice(0, 3).join(', ')
  return paths.length > 3 ? `${head} and ${paths.length - 3} more` : head
}

/** `git status --porcelain=v1 -z -- docs/studio` → staged paths, tracked-unstaged paths, all changed paths. */
export function readStatus(z: string): { staged: string[]; tracked: string[]; all: string[] } {
  const staged: string[] = []
  const tracked: string[] = []
  const all: string[] = []
  const parts = z.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i] as string
    if (e.length < 4) continue
    const x = e[0] as string
    const y = e[1] as string
    const path = e.slice(3)
    if (x === 'R' || x === 'C') i++ // the rename's source path follows
    all.push(path)
    if (x !== ' ' && x !== '?') staged.push(path)
    if (y !== ' ' && y !== '?') tracked.push(path)
  }
  return { staged, tracked, all }
}
