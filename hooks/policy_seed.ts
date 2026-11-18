// docs/studio/model_policy.md as first written (stage 4): the seed the mod writes when
// the file is missing, and the built-in turn-layer table it falls back on. Generated
// from the file; regenerate it when the seed's rules change.
export const POLICY_SEED = `# Model policy

Which model and effort each kind of Scrapshift work runs on (docs/STUDIO_DIRECTOR.md §5.9). Both
layers read this file: the director when it starts or switches a chat (layer 1), and the studio
mod when a chat starts a subagent (layer 2, the "Turn layer" table below). When the user overrides
a pick, the director adds a dated line under Corrections, and changes a row when the user says so.

## Chats (layer 1: the director picks)

| Row | Kind of work | Chat model | Effort band (start) | Subagents |
|---|---|---|---|---|
| design | Concepts, milestone breakdowns, enemy and place design, plan reviews | \`claude-opus-5-5\` (floor) | medium–xhigh (high) | Haiku for searches and reads |
| 3d-art | Blender models, textures, looks, shaders | \`claude-opus-5-5\` (floor); \`claude-fable-5-2\` for a hero piece when it's needed | high–xhigh (high) | Haiku for file chores; modelling never below Opus |
| hard-code | Networking, physics, AI brains, Rust extensions, a failing gate's root cause | \`claude-fable-5-2\`, or \`claude-opus-5-5\` at xhigh | high–max (high) | Opus for analysis; Haiku for log digests |
| building | Gameplay scripts, Fennara scene wiring, UI, bots | \`claude-opus-5-5\` | low–high (medium) | Sonnet for one-file chores; Haiku for searches |
| marketing | Marketing scripts and fact-checks | \`claude-opus-5-5\` | low–high (medium) | Haiku for searches |
| routine | Doc upkeep, data tables, renames, log digests, small one-file fixes | \`claude-sonnet-5-5\` | low–high (medium) | Haiku |
| shooter | Screenshot-only shooter chats | \`claude-haiku-5-5\` | low–medium (low) | none |
| qa | Judging shots and reports | \`claude-opus-5-5\` (judges stay on Opus) | medium–high (medium) | none |
| standby | A chat waiting on the user | unchanged | low | none |
| director | The director | \`claude-opus-5-5\` (the user sets it in the model menu) | high | Haiku for board chores |

**Floors**, applied after every other choice:
- design and 3D are never below Opus 5.5 (user, 2026-11-14);
- networking, physics and AI stay on Opus or better (CLAUDE.md);
- a turn that touches risk (git push, deleting files, credentials) gets Opus or better.

**How the director picks:**
- When it starts a chat (on the user's word), it picks the row, the model and the starting effort
  from the band, and says so in one line: "G5 stage 5, sounds: Opus 5.5, medium, row 'building'".
  The user can override it.
- Models by full id (\`claude-haiku-5-5\`, \`claude-sonnet-5-5\`, \`claude-opus-5-5\`,
  \`claude-fable-5-2\`): the user settings map the short names \`opus\` and \`sonnet\` to glm-5.5.
- It switches a running chat's model or effort only at a stage boundary, while the chat is idle
  (its cache is cold by then), and says so in one line. A switch mid-stage re-reads the whole chat.
- \`start_session\` silently caps the model at the director's own (S7): a Fable chat is started on
  Opus, then switched with \`set_session_model\`.
- Before it starts or switches any chat to Fable, or to an effort above its own, it asks the user
  with one \`AskUserQuestion\`, in every permission mode (D7). The studio mod refuses those calls
  until a question was answered in the same turn.
- If the weekly usage of the row's model is near its limit (the snapshot's usage line), it takes
  the next row down and says so.

## Turn layer (layer 2: the studio mod reads this table)

The mod never changes a chat's own model or effort: a change re-sends the whole chat uncached
(S9). It sets each subagent's model, by full id, in this order:

1. **Start** from the model the Agent call asked for (a short name becomes its full id), or else
   the subagent's own default.
2. **Up on a hunch:** the turn's class (one small-model call on the prompt's text, which the
   prompt never waits for; a spawn waits at most 800 ms for it, then goes on without) raises the
   subagent to its \`class\` row's model, and an \`up\` row's words in the subagent's task raise it
   to that row's model.
3. **Down only by rule:** a \`down\` row lowers it to that row's model: a read-only agent type, or
   chore words in a task that has no \`up\` or \`keep\` words (a chore that also implements or fixes
   something is not a chore).
4. **Floors last:** a \`floor\` row's words raise it to at least that model. Read-only agent types
   can't build, push or delete anything, so the floors skip them.
5. **Ceiling:** never above the chat's own model, so the turn layer never reaches for Fable. When a
   floor wants more than the chat runs on, the chat's model stands and the routing says "floor
   capped by the chat": the chat itself is on the wrong row.

Forks (they inherit the chat's model) and workflow agents are left alone. Words match whole
words in the subagent's task and description, any case; a \`*\` at the end matches any ending
(\`textur*\`). Edit the rows to change the routing; the mod re-reads this file within
a minute, and falls back to its built-in copy of this table when the file is missing or no row
parses.

| Kind | Name | Model | Words |
|---|---|---|---|
| class | chore | – | |
| class | build | – | |
| class | hard | \`claude-opus-5-5\` | |
| class | design-3d | \`claude-opus-5-5\` | |
| class | risky | \`claude-opus-5-5\` | |
| down | read-only | \`claude-haiku-5-5\` | type: Explore, claude-code-guide, web-fetch, statusline-setup |
| down | chore | \`claude-haiku-5-5\` | search*, find, grep, list, locate, look up, count, inventory, rename*, digest*, data table*, tabulate |
| down | one-file | \`claude-sonnet-5-5\` | one file, one-file, single file, this file only |
| keep | builds | – | implement*, fix*, edit*, refactor*, build*, create*, write the code, wire*, patch*, port |
| up | analysis | \`claude-opus-5-5\` | analy*, root cause, diagnos*, debug*, review*, audit*, judge*, critique* |
| floor | design-3d | \`claude-opus-5-5\` | blender, 3d, model the, modelling, modeling, mesh*, textur*, uv*, shader*, material*, rig, rigging, look dev, concept*, art pass, level design |
| floor | hard | \`claude-opus-5-5\` | network*, multiplayer, rpc*, netcode, physics, jolt, navmesh*, pathfind*, ai brain*, state machine*, rust, gdextension* |
| floor | risky | \`claude-opus-5-5\` | git push, push --force, force-push, rm -rf, remove-item, delet*, credential*, password*, api key*, auth token*, secret* |

## Corrections

The director adds a line here when the user overrides a pick: \`- YYYY-MM-DD: <the correction>\`.
`
