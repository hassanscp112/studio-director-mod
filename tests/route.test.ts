import { expect, test } from 'claude-code/testing'

import type { BoardRow, BoardView, Report } from '../types'
import { modelText } from '../hooks/board'
import { selfLine, snapshotText } from '../hooks/director'
import { applyPatch } from '../hooks/parse'
import { POLICY_SEED } from '../hooks/policy_seed'
import { consentRefusal, effortRank, family, hasWord, parsePolicy, prettyModel, readClass, routeSubagent } from '../hooks/route'
import type { SpawnFacts } from '../hooks/route'

// Auto model's pure rules (stage 4, §5.9): the policy table, the subagent
// routing, the consent gate (D7) and the board's model lines.
const POLICY = parsePolicy(POLICY_SEED) ?? { rules: [] }
const spawn = (over: Partial<SpawnFacts>): SpawnFacts => ({
  type: 'general-purpose',
  prompt: '',
  description: '',
  asked: undefined,
  parent: 'claude-opus-5-5',
  turnClass: null,
  isFork: false,
  isWorkflow: false,
  ...over,
})
const route = (over: Partial<SpawnFacts>) => routeSubagent(spawn(over), POLICY)

test('model families, full ids and names', () => {
  expect(family('opus')).toBe('opus')
  expect(family('claude-haiku-5-5')).toBe('haiku')
  expect(family('claude-opus-5-5[1m]')).toBe('opus')
  expect(family('glm-5.5')).toBe(null)
  expect(family('inherit')).toBe(null)
  expect(prettyModel('claude-fable-5-2')).toBe('Fable 5.2')
  expect(prettyModel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(prettyModel('glm-5.5')).toBe('glm-5.5')
  expect(effortRank('xhigh')).toBeGreaterThan(effortRank('high'))
  expect(effortRank('')).toBe(-1)
})

test("the seed's turn-layer table parses: classes, down, keep, up and floor rows", () => {
  const kinds = POLICY.rules.map(r => `${r.kind}:${r.name}`)
  expect(kinds).toEqual([
    'class:chore', 'class:build', 'class:hard', 'class:design-3d', 'class:risky',
    'down:read-only', 'down:chore', 'down:one-file', 'keep:builds', 'up:analysis',
    'floor:design-3d', 'floor:hard', 'floor:risky',
  ])
  const ro = POLICY.rules.find(r => r.name === 'read-only')
  expect(ro?.types).toEqual(['Explore', 'claude-code-guide', 'web-fetch', 'statusline-setup'])
  expect(ro?.model).toBe('haiku')
  expect(POLICY.rules.find(r => r.kind === 'class' && r.name === 'chore')?.model).toBe(null)
  // a file with no table (or none that parses) falls back to the built-in copy
  expect(parsePolicy('# Model policy\n\nno table here\n')).toBe(null)
  expect(parsePolicy('| Kind | Name | Model | Words |\n|---|---|---|---|\n| bogus | x | opus | y |\n')).toBe(null)
})

test('policy words: whole words, any case; a trailing * matches any ending', () => {
  expect(hasWord('Rig the arm', 'rig')).toBe(true)
  expect(hasWord('the right answer', 'rig')).toBe(false)
  expect(hasWord('bake the TEXTURES', 'textur*')).toBe(true)
  expect(hasWord('then git  push --force it', 'push --force')).toBe(true)
  expect(hasWord('a 3D crate', '3d')).toBe(true)
  expect(hasWord('', 'x*')).toBe(false)
})

test('a chore subagent goes to Haiku by rule, by full id', () => {
  const explore = route({ type: 'Explore', prompt: 'Find every caller of NetworkManager.is_remote_peer' })
  expect(explore.model).toBe('claude-haiku-5-5')
  expect(explore.why).toBe('down: read-only (Explore)')
  // read-only types skip the floors: an Explore search can't build or delete
  expect(route({ type: 'Explore', prompt: 'list the deleted Blender textures' }).model).toBe('claude-haiku-5-5')
  const search = route({ prompt: 'Search the repo for uses of FRESH_TOKENS and list the files' })
  expect(search.model).toBe('claude-haiku-5-5')
  expect(search.why).toBe('down: chore ("search*")')
  expect(route({ prompt: 'Make the change in one file: docs/plan/status_09.md' }).model).toBe('claude-sonnet-5-5')
  // a chore that also fixes something is not a chore: the agent keeps its own default
  const mixed = route({ prompt: 'Find the bug in the parser and fix it' })
  expect(mixed.model).toBe(undefined)
  expect(mixed.why).toBe("no rule: the agent's own default")
})

test('a Blender subagent stays on Opus, even when asked for Haiku', () => {
  const r = route({ prompt: 'In Blender, model the crate (≤1,500 tris) and export the GLB', asked: 'haiku' })
  expect(r.model).toBe('claude-opus-5-5')
  expect(r.why).toBe('asked haiku → claude-haiku-5-5; floor: design-3d ("blender")')
  expect(r.isCapped).toBe(false)
  // networking and risk floors too
  expect(route({ prompt: 'Rewrite the rpc sync', asked: 'claude-sonnet-5-5' }).model).toBe('claude-opus-5-5')
  expect(route({ prompt: 'git push the branch', asked: 'claude-haiku-5-5' }).model).toBe('claude-opus-5-5')
})

test('up on a hunch: the turn class and analysis words raise; a down rule still wins', () => {
  const hard = route({ prompt: 'Write the patch for the lobby', asked: 'claude-haiku-5-5', turnClass: 'hard' })
  expect(hard.model).toBe('claude-opus-5-5')
  expect(hard.why).toBe('turn: hard')
  expect(route({ prompt: 'Diagnose why the gate fails', asked: 'claude-sonnet-5-5' }).model).toBe('claude-opus-5-5')
  // the class hunch doesn't keep a read-only search off Haiku (the policy's subagent column)
  expect(route({ type: 'Explore', prompt: 'look up the spawn code', turnClass: 'hard' }).model).toBe('claude-haiku-5-5')
  // chore and build classes raise nothing
  expect(route({ prompt: 'Write the patch', asked: 'claude-sonnet-5-5', turnClass: 'build' }).model).toBe('claude-sonnet-5-5')
})

test('never above the chat: Fable is capped, a floor above a Sonnet chat is flagged', () => {
  const fable = route({ prompt: 'Write the patch', asked: 'fable' })
  expect(fable.model).toBe('claude-opus-5-5')
  expect(fable.why).toBe("asked fable → claude-fable-5-2; capped at the chat's model (Opus 5.5)")
  expect(fable.isCapped).toBe(false)
  const sonnet = route({ prompt: 'Texture the crate in Blender', parent: 'claude-sonnet-5-5' })
  expect(sonnet.model).toBe('claude-sonnet-5-5')
  expect(sonnet.isCapped).toBe(true)
  expect(sonnet.why).toBe('floor: design-3d ("blender"); floor capped by the chat (wanted Opus 5.5, chat on Sonnet 5.5)')
})

test('short names become full ids; forks, workflows and unknown models are left alone', () => {
  const s = route({ prompt: 'Write the patch', asked: 'sonnet' })
  expect(s.model).toBe('claude-sonnet-5-5')
  expect(s.why).toBe('asked sonnet → claude-sonnet-5-5')
  expect(route({ prompt: 'Write the patch', asked: 'claude-sonnet-5-5' }).why).toBe('asked claude-sonnet-5-5')
  expect(route({ isFork: true, prompt: 'Blender model' }).model).toBe(undefined)
  expect(route({ isWorkflow: true, asked: 'opus', prompt: 'x' }).model).toBe('opus')
  expect(route({ parent: 'glm-5.5', prompt: 'Blender' }).model).toBe(undefined)
  expect(route({ asked: 'glm-5.5', prompt: 'Blender' }).model).toBe('glm-5.5')
  expect(readClass('design-3d')).toBe('design-3d')
  expect(readClass('poetry')).toBe(null)
  expect(readClass(undefined)).toBe(null)
})

test('D7: Fable or an effort above the director waits for an answered question; short names are refused', () => {
  const START = 'mcp__ccd_session__start_session'
  const MODEL = 'mcp__ccd_session_mgmt__set_session_model'
  const EFFORT = 'mcp__ccd_session_mgmt__set_session_effort'
  const no = { ownEffort: 'high', hasConsent: false }
  const yes = { ownEffort: 'high', hasConsent: true }
  expect(consentRefusal(START, { model: 'claude-fable-5-2', title: 'x' }, no)).toContain('studio (D7): ask the user first. Fable needs')
  expect(consentRefusal(START, { model: 'claude-fable-5-2', title: 'x' }, yes)).toBe(null)
  expect(consentRefusal(MODEL, { session_id: 'local_x', model: 'claude-fable-5-2' }, no)).toContain('Fable')
  expect(consentRefusal(EFFORT, { session_id: 'local_x', effort: 'xhigh' }, no)).toContain('effort xhigh, above yours (high)')
  expect(consentRefusal(EFFORT, { session_id: 'local_x', effort: 'high' }, no)).toBe(null)
  expect(consentRefusal(START, { model: 'claude-opus-5-5', effort: 'medium' }, no)).toBe(null)
  expect(consentRefusal(START, { model: 'opus' }, yes)).toContain('use a full model id, not "opus"')
  expect(consentRefusal(MODEL, { model: 'sonnet', session_id: 'x' }, yes)).toContain('glm-5.5')
  // own effort unknown: xhigh and max ask, the rest pass
  expect(consentRefusal(EFFORT, { effort: 'high' }, { ownEffort: '', hasConsent: false })).toBe(null)
  expect(consentRefusal(EFFORT, { effort: 'max' }, { ownEffort: '', hasConsent: false })).toContain('effort max')
  expect(consentRefusal('Bash', { command: 'ls' }, no)).toBe(null)
  expect(consentRefusal(START, { proposal_id: 'task_1' }, no)).toBe(null)
})

test('the board and the snapshot show model, effort and turn class; a capped floor is flagged', () => {
  expect(modelText({ model: 'claude-opus-5-5', effort: 'high', turnClass: 'hard' })).toBe('Opus 5.5 high · turn: hard')
  expect(modelText({ model: '', effort: '', turnClass: null })).toBe('')
  const NOW = Date.parse('2026-11-15T10:00:00Z')
  const row: BoardRow = {
    id: 'local_g5', tag: 'G5', title: 'G5 stage 5', state: 'idle', since: new Date(NOW - 3_600_000).toISOString(),
    updatedAt: new Date(NOW - 3_600_000).toISOString(), ask: null, recap: '', lastCommit: null, context: { tokens: 50_000, pct: 5 },
    isStalled: false, isFresh: false, isSelf: false, isUnreported: false, model: 'claude-sonnet-5-5', effort: 'medium', turnClass: 'design-3d', isCapped: true,
  }
  const view: BoardView = { at: NOW, header: { usage: [], uncommitted: null, lastCommit: null }, groups: { waiting: [], working: [], recent: [row], quiet: [] } }
  const snap = snapshotText({ view, seen: null, log: null, notes: null, self: { model: 'claude-opus-5-5', effort: 'high' } }).text
  expect(snap).toContain('  G5 stage 5 [local_g5] · idle 1h · 5 % (50k) · Sonnet 5.5 medium · turn: design-3d')
  expect(snap).toContain("floor capped: a subagent's floor is above this chat's model (wrong row?)")
  expect(snap).toContain('You: Opus 5.5 high. Before you start or switch a chat, read docs/studio/model_policy.md, pick its row, model (full id) and effort, and say all three in one line')
  expect(selfLine(null)).toContain('You: unknown.')
  // a model change counts as a changed row; a class change does not
  const first = snapshotText({ view, seen: null, log: null, notes: null })
  const sameClassless = { ...view, groups: { ...view.groups, recent: [{ ...row, turnClass: 'chore' }] } }
  expect(snapshotText({ view: sameClassless, seen: first.seen, log: null, notes: null }).text).toContain('0 of 1 chats changed')
  const switched = { ...view, groups: { ...view.groups, recent: [{ ...row, model: 'claude-opus-5-5' }] } }
  expect(snapshotText({ view: switched, seen: first.seen, log: null, notes: null }).text).toContain('1 of 1 chats changed')
})

test('a schema 1 report becomes schema 2 with no class and no routings', () => {
  const old = {
    schema: 1, appId: 'local_x', cliId: 'c', title: 't', tag: null, tagSource: null, state: 'idle', stateSince: 'a', updatedAt: 'a',
    turns: 1, recap: '', ask: null, lastCommit: null, context: null, model: 'm', effort: 'e', cwd: 'x',
  } as unknown as Report
  const r = applyPatch(old, {}, 'b')
  expect(r.schema).toBe(2)
  expect(r.turnClass).toBe(null)
  expect(r.routings).toEqual([])
  expect(r.classMs).toBe(null)
  expect(Object.keys(r).slice(-4)).toEqual(['turnClass', 'classMs', 'routings', 'cwd'])
})
