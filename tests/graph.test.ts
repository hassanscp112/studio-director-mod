import { expect, test } from 'claude-code/testing'

import { brainPart, chunkDoc, emptyBrain, hash, parseFragment, pendingChunks, pruneBrain } from '../hooks/brain'
import {
  bestPath,
  buildGraph,
  claudePart,
  commitsPart,
  docPart,
  linked,
  masterPlanPart,
  matchPrompt,
  memoryPart,
  memoryTitles,
  notesPart,
  reportsPart,
  snapScore,
  statusPart,
  topicsPart,
} from '../hooks/graph'
import type { Report } from '../types'

// The memory graph's pure side (stage 8): each file's part, the merge, the
// guessed links and their scores, clusters, hubs, paths, and the brain's chunks.
const PLAN = `# Scrapshift — Master Plan

### The plan

- [milestones_g](plan/milestones_g.md) — Milestones G1–G4, and parked
  - G3 — The Warden overhaul and player ragdoll (14–15 sessions)
  - G5 — The shopping cart (9–12 sessions; gameplay change)
- [milestones_n](plan/milestones_n.md) — Milestones N0–N9
  - N1 — The home base, built (14–18 sessions)
`
const CART = `# The shopping cart (G5)

Intro text. See [the plan](plan/milestones_g.md).

## Stage 5 — sound, and noise the Warden hears

The cart's wheels rattle; takes are CC0 recordings.

### Takes

Sixteen ffmpeg edits.

## Stage 6 — the Warden and the cart

\`\`\`
## not a heading (in a fence)
\`\`\`
The Warden hears a loud cart.
`
const NOTES = `# Studio notes

- 2026-11-15 17:51: SD5 test: the code word is HERON-5.
- 2026-11-16 09:00: G5 carts never roll on their own on slopes [about: G5, the shopping cart]
- 2026-11-16 09:05: Hold all METRO 9 art until the kit audit [about: Kit audit]
`
const STATUS = `## 6. Status

- **2026-11-15 (G5's building chat): stage 5, the cart's sounds, built.**
  - The takes: 16 ffmpeg edits.
- **2026-11-16 (SLIP 7's tool rack): the rack built.**
  - Hooks empty.
`
const SFX = `---
name: feedback-no-synth-sfx
description: No code-synthesized sound effects; real recordings or ElevenLabs only
metadata:
  type: feedback
---

The user rejected tone-generated sounds. See [[feedback-sounds-must-fit]].
`
const FIT = `---
name: feedback-sounds-must-fit
description: Every sound must make physical sense for where it plays
metadata:
  type: feedback
---

Body. Links back to [[feedback-no-synth-sfx]].
`
const CLAUDE = `# Scrapshift

## Workflow rules
- Claude builds everything.

## Game rules
- **No code-synthesized sounds** (user rule): Stable Audio Open and ElevenLabs takes.

## Layout
- \`scenes/\` and \`scripts/\`.
`
const report = (over: Partial<Report>): Report => ({
  schema: 2, appId: 'local_x', cliId: 'c', title: 'A chat', tag: null, tagSource: null, state: 'idle', stateSince: '2026-11-16T08:00:00Z',
  updatedAt: '2026-11-16T08:00:00Z', turns: 1, recap: '', ask: null, lastCommit: null, context: null, model: '', effort: '', turnClass: null,
  classMs: null, routings: [], cwd: '', ...over,
})
const REPORTS: Report[] = [
  report({ appId: 'local_g5', title: 'G5 stage 6: the Warden and the cart', tag: 'G5', state: 'working', lastCommit: { hash: '9460a2d000', subject: 'G5 stages 3-6b: the cart', at: '2026-11-16T07:00:00Z' } }),
  report({ appId: 'local_g3e', title: "G3e: the Warden's sounds", tag: 'G3e', state: 'waiting-you', ask: { question: 'Play G3e yourself now?', buttons: ['Play it', 'Keep bots'] } }),
  report({ appId: 'local_dir', title: 'Director', tag: 'Director' }),
]

function graph() {
  return buildGraph(
    [
      topicsPart(),
      masterPlanPart('docs/MASTER_PLAN.md', PLAN),
      docPart('docs/MASTER_PLAN.md', PLAN),
      docPart('docs/CART.md', CART),
      docPart('docs/plan/milestones_g.md', '# G\n\n## G5 — The shopping cart\n\ncart text\n'),
      notesPart('docs/studio/notes.md', NOTES),
      statusPart('docs/plan/status_09.md', STATUS),
      memoryPart('feedback-no-synth-sfx.md', SFX, 'No synthesized SFX'),
      memoryPart('feedback-sounds-must-fit.md', FIT, 'Sounds must fit'),
      claudePart('CLAUDE.md', CLAUDE),
      reportsPart(REPORTS),
      commitsPart('9460a2d\x1fG5 stages 3-6b: the cart\x1f2026-11-16T07:00:00+03:00\nabc1234\x1fSLIP 7: the tool rack\x1f2026-11-15T07:00:00+03:00\n'),
    ],
    1,
  )
}

test('each file becomes its nodes: milestones, sections, decisions, rules, chats, asks, commits', () => {
  const plan = masterPlanPart('docs/MASTER_PLAN.md', PLAN)
  expect(plan.nodes.map(n => n.id)).toEqual(['milestone:G3', 'milestone:G5', 'milestone:N1'])
  expect(plan.edges[1]).toEqual({ from: 'milestone:G5', to: 'doc:docs/plan/milestones_g.md', rel: 'documented-in', conf: 'extracted', score: 1, source: 'docs/MASTER_PLAN.md' })

  const cart = docPart('docs/CART.md', CART)
  const sections = cart.nodes.filter(n => n.kind === 'section')
  expect(sections.map(s => [s.label, s.line, s.endLine])).toEqual([
    ['Stage 5 — sound, and noise the Warden hears', 5, 12],
    ['Takes', 9, 12],
    ['Stage 6 — the Warden and the cart', 13, 19],
  ])
  expect(cart.edges.some(e => e.rel === 'links-to' && e.to === 'doc:docs/plan/milestones_g.md')).toBe(true)

  const notes = notesPart('docs/studio/notes.md', NOTES)
  expect(notes.nodes.length).toBe(3)
  expect(notes.nodes[1]?.text).toBe('G5 carts never roll on their own on slopes')
  expect(notes.edges.map(e => e.to)).toEqual(['?G5', '?the shopping cart', '?Kit audit'])

  expect(statusPart('docs/plan/status_09.md', STATUS).nodes.map(n => [n.label, n.line, n.at])).toEqual([
    ["2026-11-15 (G5's building chat): stage 5, the cart's sounds, built.", 3, '2026-11-15T23:59'],
    ["2026-11-16 (SLIP 7's tool rack): the rack built.", 5, '2026-11-16T23:59'],
  ])

  const sfx = memoryPart('feedback-no-synth-sfx.md', SFX, 'No synthesized SFX')
  expect(sfx.nodes[0]).toMatchObject({ id: 'rule:mem:feedback-no-synth-sfx', label: 'No synthesized SFX', source: 'memory/feedback-no-synth-sfx.md', status: 'feedback' })
  expect(sfx.edges[0]).toMatchObject({ to: 'rule:mem:feedback-sounds-must-fit', rel: 'links-to', conf: 'extracted' })
  expect(memoryTitles('- [Sounds must fit](feedback-sounds-must-fit.md) — hook')).toEqual({ 'feedback-sounds-must-fit.md': 'Sounds must fit' })

  // CLAUDE.md: only bullets under a heading that names rules
  expect(claudePart('CLAUDE.md', CLAUDE).nodes.map(n => n.line)).toEqual([4, 7])

  const r = reportsPart(REPORTS)
  expect(r.nodes.map(n => n.id).sort()).toEqual(
    ['ask:local_g3e', 'chat:local_dir', 'chat:local_g3e', 'chat:local_g5', 'commit:9460a2d', 'workstream:G3e', 'workstream:G5'].sort(),
  )
  expect(r.edges.find(e => e.from === 'workstream:G3e')).toMatchObject({ to: 'milestone:G3', rel: 'part-of', conf: 'inferred', score: 0.85 })
})

test('the merge: stated links are 1.0; guessed ones carry a score; unknown "about" names become topics', () => {
  const g = graph()
  const audio = linked(g, 'topic:audio')
  const rules = audio.filter(l => l.node.kind === 'rule').map(l => [l.node.id, l.edge.score])
  // a rule whose own name says sound is scored higher than one that only mentions it
  expect(rules).toContainEqual(['rule:mem:feedback-sounds-must-fit', 0.85])
  expect(rules).toContainEqual(['rule:mem:feedback-no-synth-sfx', 0.85])
  expect(rules.some(([id]) => id === 'rule:claude#L7')).toBe(true)
  expect(rules.some(([id]) => id === 'rule:claude#L4')).toBe(false)

  // [about: G5, the shopping cart] are stated links; an unknown name is made a topic
  const decision = 'decision:docs/studio/notes.md#L4'
  expect(linked(g, decision).filter(l => l.edge.conf === 'extracted').map(l => l.node.id).sort()).toEqual(['milestone:G5', 'topic:cart'])
  expect(g.nodes.get('topic:kitaudit')?.label).toBe('Kit audit')

  // the doc's name and a heading are guessed (.85); the G5 chat's commit is stated
  expect(linked(g, 'topic:cart').find(l => l.node.id === 'doc:docs/CART.md')?.edge).toMatchObject({ rel: 'documented-in', score: 0.85 })
  expect(linked(g, 'chat:local_g5').find(l => l.node.id === 'commit:9460a2d')?.edge).toMatchObject({ rel: 'produced', conf: 'extracted' })
  expect(g.counts.extracted).toBeGreaterThan(0)
  expect(g.counts.inferred).toBeGreaterThan(0)

  // a status entry gives its topic a status
  expect(g.nodes.get('topic:slip7')?.status).toBe("2026-11-16 (SLIP 7's tool rack): the rack built.")
  // clusters and hubs exist and are named
  expect(g.clusters.length).toBeGreaterThan(0)
  expect(g.hubs.length).toBeGreaterThan(0)
  expect(snapScore(0.9)).toBe(0.95)
  expect(snapScore(0.62)).toBe(0.65)
})

test('a prompt names its topics; a workstream wins over its own milestone; paths are as sure as their weakest link', () => {
  const g = graph()
  expect(matchPrompt(g, 'how do the cart sounds work?').map(f => f.id).sort()).toEqual(['topic:audio', 'topic:cart'])
  expect(matchPrompt(g, "where's G3e at?").map(f => f.id)).toEqual(['workstream:G3e'])
  expect(matchPrompt(g, 'what about local_g5abcdef?').length).toBe(0)
  expect(matchPrompt(g, 'thanks').length).toBe(0)

  const p = bestPath(g, 'rule:mem:feedback-no-synth-sfx', 'rule:mem:feedback-sounds-must-fit')
  expect(p?.edges.length).toBe(1)
  expect(p?.weakest).toBe(1)
  const q = bestPath(g, 'chat:local_g5', 'rule:mem:feedback-no-synth-sfx')
  expect(q).not.toBeNull()
  expect(q?.weakest).toBeLessThan(1)
})

test('the brain: docs cut at headings under the limit, answers cleaned, cached by hash, merged as guessed links', () => {
  const big = `# Doc\n\n## A\n${'line of text\n'.repeat(30)}## B\n${'more text\n'.repeat(30)}`
  const chunks = chunkDoc('docs/X.md', big, 400)
  expect(chunks.length).toBeGreaterThan(1)
  expect(chunks.every(c => c.text.length <= 400)).toBe(true)
  expect(chunks[0]?.key).toBe('docs/X.md#0')
  expect(chunks.find(c => c.heading === 'B')?.sectionId).toMatch(/^section:docs\/X\.md#L\d+$/)
  expect(chunkDoc('docs/X.md', big)).toHaveLength(1)
  expect(hash('abc')).toBe(hash('abc'))
  expect(hash('abc')).not.toBe(hash('abd'))

  const f = parseFragment('Here: ```json\n{"concepts":[{"name":"crane","is":"lifts the pit"},{"name":"x"}],"links":[{"a":"crane","rel":"lifts","b":"the Warden","sure":0.9},{"a":"crane","rel":"is","b":"crane","sure":1}]}\n```')
  expect(f?.concepts).toEqual([{ name: 'crane', is: 'lifts the pit' }])
  expect(f?.links).toEqual([{ a: 'crane', rel: 'lifts', b: 'the Warden', sure: 0.95 }])
  expect(parseFragment('no json here')).toBeNull()

  const cache = emptyBrain()
  cache.entries['docs/CART.md#0'] = { hash: 'h', at: '', fragment: { concepts: [{ name: 'Warden', is: 'the monster' }, { name: 'rattle', is: 'the wheels' }], links: [{ a: 'rattle', rel: 'draws', b: 'Warden', sure: 0.85 }] }, sectionId: 'section:docs/CART.md#L5', heading: 'Stage 5' }
  const g = buildGraph([topicsPart(), docPart('docs/CART.md', CART), brainPart(cache)], 1)
  // a concept the topics already name is that topic, not a twin
  expect(g.nodes.has('concept:warden')).toBe(false)
  // "the Lantern", "Lantern", "LanternBrain" and "Lantern brain" make two concepts, not four (the user's shot, 2026-11-16)
  const twins = emptyBrain()
  twins.entries['docs/X.md#0'] = {
    hash: 'h', at: '', sectionId: 'doc:docs/X.md', heading: '',
    fragment: { concepts: [{ name: 'the Lantern', is: 'an enemy' }, { name: 'Lantern', is: 'an enemy' }, { name: 'LanternBrain', is: 'its brain' }, { name: 'Lantern brain', is: 'its brain' }], links: [{ a: 'Lantern brain', rel: 'drives', b: 'the Lantern', sure: 0.95 }] },
  }
  const tg = buildGraph([topicsPart(), brainPart(twins)], 1)
  expect([...tg.nodes.values()].filter(n => n.kind === 'concept').map(n => n.id).sort()).toEqual(['concept:lantern', 'concept:lanternbrain'])
  expect(linked(tg, 'concept:lanternbrain').find(l => l.edge.rel === 'related')?.node.id).toBe('concept:lantern')
  const link = linked(g, 'concept:rattle').find(l => l.edge.rel === 'related')
  expect(link?.edge).toMatchObject({ to: 'topic:warden', label: 'draws', score: 0.85, conf: 'inferred' })
  expect(linked(g, 'concept:rattle').some(l => l.node.id === 'section:docs/CART.md#L5')).toBe(true)

  const cs = chunkDoc('docs/CART.md', CART)
  expect(pendingChunks(cs, cache).length).toBe(cs.length) // hash differs: read again
  expect(Object.keys(pruneBrain(cache, []).entries)).toEqual([])
})
