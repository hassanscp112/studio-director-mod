// Studio Director, stage 4: auto model (docs/STUDIO_DIRECTOR.md §5.9).
// Pure functions, no engine calls: the model families and their full ids, the
// policy file's turn-layer table, the subagent routing, and the director's
// consent gate (D7). The chat's own model and effort are never changed (S9).
export type Family = 'haiku' | 'sonnet' | 'opus' | 'fable'

/** Full ids, always: the user settings map the short names `opus` and `sonnet` to glm-5.5. */
export const FULL_IDS: Record<Family, string> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  fable: 'claude-fable-5-2',
}
const RANK: Record<Family, number> = { haiku: 1, sonnet: 2, opus: 3, fable: 4 }
const NAMES: Record<Family, string> = { haiku: 'Haiku 5.5', sonnet: 'Sonnet 5.5', opus: 'Opus 5.5', fable: 'Fable 5.2' }

/** The turn classes the classifier picks from (§5.9). */
export const TURN_CLASSES = ['chore', 'build', 'hard', 'design-3d', 'risky'] as const
/** The classifier's model, by full id (the engine's default small model could be mapped elsewhere). */
export const CLASSIFY_MODEL = FULL_IDS.haiku
/**
 * The most a subagent's spawn waits for the turn's class (§5.9: failing safe); a
 * class not in by then leaves that spawn to the rules alone. The prompt itself never
 * waits for it.
 */
export const CLASSIFY_MS = 800
/** The classifier's own cap: an answer later than this counts as none. */
export const CLASSIFY_MAX_MS = 10_000
/** Characters of the prompt the classifier sees. */
export const CLASSIFY_CHARS = 4000
/** Routings kept in a report. */
export const ROUTINGS_KEPT = 5
export const POLICY_FILE = 'model_policy.md'

/**
 * A model's family: a short name (`opus`) or a Claude id (`claude-opus-5-5`,
 * `claude-opus-5-5[1m]`). Null for anything else (`glm-5.5`, `inherit`).
 */
export function family(model: string | null | undefined): Family | null {
  const m = (model ?? '').trim().toLowerCase()
  const short = /^(haiku|sonnet|opus|fable)$/.exec(m)
  if (short) return short[1] as Family
  const id = /^claude-(haiku|sonnet|opus|fable)-/.exec(m)
  return id ? (id[1] as Family) : null
}

/** `claude-opus-5-5` → `Opus 5.5`; anything else as it is. */
export function prettyModel(model: string): string {
  const f = family(model)
  if (f === null || !/^claude-/.test(model)) return model
  const v = /^claude-[a-z]+-(\d+)-(\d+)/.exec(model)
  return v ? `${NAMES[f].split(' ')[0]} ${v[1]}.${v[2]}` : NAMES[f]
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
/** An effort level's place (low 0 … max 4); -1 for anything else. */
export const effortRank = (e: string | null | undefined): number => EFFORTS.indexOf((e ?? '') as (typeof EFFORTS)[number])

// ---------------------------------------------------------------- the policy table

export type RuleKind = 'class' | 'down' | 'keep' | 'up' | 'floor'
export type Rule = { kind: RuleKind; name: string; model: Family | null; words: string[]; types: string[] }
export type Policy = { rules: Rule[] }

const KINDS = new Set<string>(['class', 'down', 'keep', 'up', 'floor'])
const HEAD = /^\|\s*Kind\s*\|\s*Name\s*\|\s*Model\s*\|\s*Words\s*\|/i

/**
 * The turn-layer table of model_policy.md (`| Kind | Name | Model | Words |`).
 * Null when the table is missing or no row parses: the caller falls back to
 * the built-in copy.
 */
export function parsePolicy(text: string): Policy | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex(l => HEAD.test(l.trim()))
  if (start < 0) return null
  const rules: Rule[] = []
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim()
    if (!line.startsWith('|')) break
    const cells = line.split('|').slice(1, -1).map(c => c.trim())
    const [kindCell = '', name = '', modelCell = '', wordsCell = ''] = cells
    const kind = kindCell.toLowerCase()
    if (!KINDS.has(kind) || name === '') continue // the |---| line, or a stray row
    const model = family(modelCell.replace(/`/g, ''))
    const isTypes = /^type\s*:/i.test(wordsCell)
    const items = wordsCell
      .replace(/^type\s*:/i, '')
      .split(',')
      .map(w => w.trim())
      .filter(w => w !== '')
    rules.push({ kind: kind as RuleKind, name, model, words: isTypes ? [] : items.map(w => w.toLowerCase()), types: isTypes ? items : [] })
  }
  return rules.length > 0 ? { rules } : null
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A policy word in `text`: whole words, any case; a trailing `*` matches any ending. */
export function hasWord(text: string, word: string): boolean {
  const isPrefix = word.endsWith('*')
  const base = escape((isPrefix ? word.slice(0, -1) : word).trim()).replace(/\s+/g, '\\s+')
  if (base === '') return false
  return new RegExp(`(?<![a-z0-9])${base}${isPrefix ? '' : '(?![a-z0-9])'}`, 'i').test(text)
}

const firstWord = (text: string, words: readonly string[]): string | undefined => words.find(w => hasWord(text, w))

// ---------------------------------------------------------------- routing a subagent

export type SpawnFacts = {
  /** The resolved agent type (`general-purpose`, `Explore`, …). */
  type: string
  prompt: string
  description: string
  /** The Agent call's `model`, as given; undefined: the agent's own default. */
  asked: string | undefined
  /** The chat's (the parent loop's) model: the ceiling. */
  parent: string
  /** This turn's class, or null (none, failed, late). */
  turnClass: string | null
  isFork: boolean
  isWorkflow: boolean
}

export type RoutePick = {
  /** The model to send: a full id, or undefined to leave the agent's own default. */
  model: string | undefined
  /** Why, for the report: the rules that fired. */
  why: string
  /** A floor or hunch wanted more than the chat runs on. */
  isCapped: boolean
}

/**
 * The subagent's model (§5.9, the turn-layer table): start from what was asked
 * (a short name → its full id), up on a hunch (the turn's class, `up` words),
 * down only by rule (`down`), floors last, never above the chat's own model.
 */
export function routeSubagent(f: SpawnFacts, policy: Policy): RoutePick {
  if (f.isFork) return { model: f.asked, why: "fork: inherits the chat's model", isCapped: false }
  if (f.isWorkflow) return { model: f.asked, why: 'workflow agent: left alone', isCapped: false }
  const ceiling = family(f.parent)
  if (ceiling === null) return { model: f.asked, why: `chat model ${f.parent || '?'} unknown: left alone`, isCapped: false }
  const askedFam = f.asked === undefined ? null : family(f.asked)
  if (f.asked !== undefined && f.asked.trim() !== '' && askedFam === null) {
    return { model: f.asked, why: `asked ${f.asked}: not a Claude model, left alone`, isCapped: false }
  }
  const rules = policy.rules
  const text = `${f.description}\n${f.prompt}`
  const why: string[] = []
  let cur: Family | null = askedFam
  if (f.asked !== undefined && askedFam !== null && f.asked !== FULL_IDS[askedFam]) why.push(`asked ${f.asked} → ${FULL_IDS[askedFam]}`)
  let wanted: Family | null = null // the most any up or floor rule asked for
  const raise = (m: Family, reason: string) => {
    if (wanted === null || RANK[m] > RANK[wanted]) wanted = m
    if (cur === null || RANK[m] > RANK[cur]) {
      cur = m
      why.push(reason)
    }
  }
  // up on a hunch: the turn's class, then `up` words
  const cls = f.turnClass === null ? undefined : rules.find(r => r.kind === 'class' && r.name === f.turnClass)
  if (cls?.model) raise(cls.model, `turn: ${f.turnClass}`)
  const ups = rules.filter(r => r.kind === 'up' && r.model !== null && firstWord(text, r.words) !== undefined)
  for (const r of ups) raise(r.model as Family, `up: ${r.name} ("${firstWord(text, r.words)}")`)
  // down only by rule
  const readOnly = rules.find(r => r.kind === 'down' && r.model !== null && r.types.includes(f.type))
  const keep = rules.find(r => r.kind === 'keep' && firstWord(text, r.words) !== undefined)
  const chore =
    readOnly ??
    (ups.length === 0 && keep === undefined
      ? rules.find(r => r.kind === 'down' && r.model !== null && r.words.length > 0 && firstWord(text, r.words) !== undefined)
      : undefined)
  if (chore?.model) {
    cur = chore.model
    why.push(readOnly ? `down: ${chore.name} (${f.type})` : `down: ${chore.name} ("${firstWord(text, chore.words)}")`)
  }
  // floors last; read-only types can't build, push or delete, so they skip them
  if (readOnly === undefined) {
    for (const r of rules) {
      if (r.kind !== 'floor' || r.model === null) continue
      const w = firstWord(text, r.words)
      if (w !== undefined) raise(r.model, `floor: ${r.name} ("${w}")`)
    }
  }
  // never above the chat's own model
  let isCapped = false
  const c = cur as Family | null
  if (c !== null && RANK[c] > RANK[ceiling]) {
    const w = wanted as Family | null
    isCapped = w !== null && RANK[w] > RANK[ceiling]
    why.push(isCapped ? `floor capped by the chat (wanted ${NAMES[w as Family]}, chat on ${NAMES[ceiling]})` : `capped at the chat's model (${NAMES[ceiling]})`)
    cur = ceiling
  }
  const out = cur as Family | null
  if (out === null) return { model: f.asked, why: why.length > 0 ? why.join('; ') : "no rule: the agent's own default", isCapped }
  if (why.length === 0) why.push(`asked ${FULL_IDS[out]}`)
  return { model: FULL_IDS[out], why: why.join('; '), isCapped }
}

/** The classifier's answer as a class, or null. */
export function readClass(label: string | undefined): string | null {
  return label !== undefined && (TURN_CLASSES as readonly string[]).includes(label) ? label : null
}

// ---------------------------------------------------------------- the director's consent gate (D7)

const START = /^mcp__.*ccd_session__start_session$/
const SET_MODEL = /^mcp__.*ccd_session_mgmt__set_session_model$/
const SET_EFFORT = /^mcp__.*ccd_session_mgmt__set_session_effort$/

export type ConsentContext = {
  /** The director's own effort level ('' when unknown). */
  ownEffort: string
  /** An AskUserQuestion was answered earlier in this turn. */
  hasConsent: boolean
}

/**
 * Why the director may not make this start or switch yet, or null (D7): Fable,
 * or an effort above the director's own, waits for the user's answer to an
 * AskUserQuestion in the same turn. A short model name is refused outright.
 */
export function consentRefusal(tool: string, input: Record<string, unknown>, ctx: ConsentContext): string | null {
  const isStart = START.test(tool)
  const isModel = SET_MODEL.test(tool)
  const isEffort = SET_EFFORT.test(tool)
  if (!isStart && !isModel && !isEffort) return null
  const model = typeof input.model === 'string' ? input.model.trim() : ''
  const effort = typeof input.effort === 'string' ? input.effort.trim() : ''
  if ((isStart || isModel) && model !== '' && !/^claude-/i.test(model)) {
    return `studio: use a full model id, not "${model}": the user settings map the short names to glm-5.5 (${Object.values(FULL_IDS).join(', ')}).`
  }
  const needs: string[] = []
  if ((isStart || isModel) && family(model) === 'fable') needs.push('Fable')
  if ((isStart || isEffort) && effort !== '') {
    const own = effortRank(ctx.ownEffort)
    const isAbove = own < 0 ? effortRank(effort) >= effortRank('xhigh') : effortRank(effort) > own
    if (isAbove) needs.push(`effort ${effort}, above yours (${ctx.ownEffort || 'unknown'})`)
  }
  if (needs.length === 0 || ctx.hasConsent) return null
  return (
    `studio (D7): ask the user first. ${needs.join(' and ')} needs the user's yes: ask one AskUserQuestion ` +
    'in this turn, then make this call again on their yes (docs/studio/model_policy.md).'
  )
}
