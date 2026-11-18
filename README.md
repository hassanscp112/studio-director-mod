# studio

Scrapshift's Studio Director mod (design: `docs/STUDIO_DIRECTOR.md`).

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install studio --marketplace hassanscp112/studio-director-mod
```

Answer `y` to add the marketplace, then pick a scope (the user scope is first). From a shell:

```
claude plugin install studio --marketplace hassanscp112/studio-director-mod
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins,
Add marketplace with `hassanscp112/studio-director-mod`, then Add plugin.

The mod was built for one project's layout: it reads and writes `docs/studio/` in the git checkout
it runs in, and its director role, policy and checks name that project's docs
(`docs/STUDIO_DIRECTOR.md`, `docs/MASTER_PLAN.md`, `docs/studio/leads.md`). In another project the
board and the reporter work; the director's role text and guard still describe that project.

**Stage 1, the reporter:** every chat in the project writes its own report to
`docs/studio/sessions/<app-session-id>.json` at each turn's start and end (state, recap, the open
ask and its buttons, last commit, context, model, effort, workstream tag), and a worker chat's
`git commit` that would take in `docs/studio/` is refused, because only the director commits the
board. The file format is in `docs/studio/README.md`.

**Stage 2, the board:** `/studio` opens a pane beside the chat and prints the same board as text:
Waiting on you, Working now, Recent (72 h) and Quiet (every open chat of the project, from the
reports and the app's own list), under a header with the 7-day usage, the
uncommitted count (without `docs/studio/`) and the last commit. The pane reopens when its chat
comes back on screen, re-reads the folder every 15 s while it is on screen, and another chat's
new waiting ask shows as a toast. The rules are in `hooks/board.ts`; the fresh-chat line is
`FRESH_TOKENS` (400k).

**Stage 3, director mode:** `/director`, typed by the user as the first thing in a new chat,
makes that chat the director:
- its role goes in as one fixed system section (`studio:director`, `ROLE_TEXT` in `hooks/director.ts`);
- the board pane opens, and the chat's row is tagged `Director`;
- each of the user's prompts carries a `<studio-snapshot>` as hidden context: the whole board
  (with app ids) the first time and after a compaction, else only the rows that changed, plus the
  waiting asks, `git log --oneline -10`, the uncommitted count, the 7-day usage and
  `docs/studio/notes.md`. The first turn's snapshot rides with `/director`'s own output, since the
  mod's own prompt doesn't pass its own `prompt.submit` hook;
- the guard (`hooks/guard.ts`) refuses building in that chat and its subagents: Edit/Write outside
  `docs/**/*.md`, `docs/studio/**`, `CLAUDE.md`, the memory folder, the chat's scratchpad,
  side-session notes and plan files; Fennara writes and scripts; Blender code; launching Godot or
  Blender; shell writes outside those paths; git commands that change the working tree. It fails
  closed there. A script file run by an interpreter is not read (a known gap);
- the director may commit `docs/studio/`, in a commit that holds nothing else.

`/studio note <text>` adds a dated line to `docs/studio/notes.md`; past 80 lines the oldest move to
`notes_archive.md`.

**Stage 4, auto model** (`hooks/route.ts`; the idea merged from the published Jev Model Router
mod, MIT, in `davila7/claude-code-templates`, with our own code; Jev itself is not installed):
- `docs/studio/model_policy.md` is the policy both layers read: the rows for chats (the
  director's picks), the floors, and a "Turn layer" table the mod parses (the built-in copy in
  `hooks/policy_seed.ts` when the file is missing or unreadable; the director seeds it).
- **The turn layer, in every chat:** each prompt (not slash commands or engine notices) gets one
  `$.model.classify` on its text alone, on `claude-haiku-5-5`: chore, build, hard, design-3d or
  risky. The prompt never waits for it; the report records the class and its time (none after a
  failure, no label, or 10 s), and a spawn waits at most 800 ms for a class still on its way.
  On `agent.spawn` each subagent's model is set by full id: start from what was asked (a short name
  becomes its full id), up on a hunch (the class, analysis words), down only by rule (read-only
  types, chore words), floors last (design and 3D, networking, physics and AI, risk: Opus), never
  above the chat's own model ("floor capped by the chat" when a floor wants more). Forks and
  workflow agents are left alone. The chat's own model and effort are never changed (S9).
- The turn's class and the last 5 routings go in the chat's report (schema 2); the board shows
  each chat's model, effort and class, and flags a capped floor; `/studio me` lists the routings.
- **The director:** its role reads the policy before starting or switching a chat and says the
  pick in one line; each snapshot carries "You: <model> <effort>" and a pointer to the policy, so a
  director chat started before this stage learns it too. The D7 gate refuses `start_session`,
  `set_session_model` or `set_session_effort` with Fable or an effort above the director's own
  until an `AskUserQuestion` was answered in the same turn, and refuses short model names there.

**Stage 5, the reset** (`hooks/reset.ts`): the director chat clears itself between turns, with no
ask, past `RESET_TOKENS` (600k; a fresh turn here already costs ~116k) or 55 min after its last
turn (past `IDLE_MIN_TOKENS`, 200k), never with an ask open:
- a turn that took a decision (an answered question; starting, switching or messaging a chat; or
  a prompt a Haiku classify marks `user-decides-or-approves`) and left `docs/studio/notes.md`
  unchanged owes a note: the next prompt carries a hidden `<studio-notes-check>` line, and the
  reset waits for the write;
- it runs `/clear` through `$.command.run` from a timer after `turn.complete`, falling back to
  `/compact keep only open questions: …`; a dim line says it happened; the next snapshot is full;
  the director mark is also kept in the module and `$.store` by app id;
- right after a reset, `smart-compact`'s (or any plugin's) `/compact` is skipped; the user's own
  runs. `STUDIO_RESET=clear|compact|off` overrides the method;
- the carry-over (2026-11-18): just before the clear, the user's last 3 prompts, the end of the
  last reply and its recap are kept; the first prompt after the reset carries them once as a
  hidden `<studio-carry>` block, so work spread over several prompts carries on.

**Open chat** (2026-11-18): every app chat's card on the board, and a picked stage on the plan map,
has an "Open chat" link (`#local_…`, the link the director writes) to answer it there yourself,
with no director turn. The chat the pane sits in has none.

**Stage 6, the ask box** (`hooks/ask.ts`): a field at the top of the board pane, in any chat
that opened it. Each question reads the board fresh and sends the director's full snapshot (with
the chat's own row, without the director's lines), the pane's last 3 answered turns (for
follow-ups, under 4,000 characters) and the question to one `$.model.complete` on
`claude-opus-5-5` at low effort (1,500 tokens, 60 s at most). No tools, no turn, no chat context,
nothing written: the answer shows in the pane, with its tokens and the board's time, and the
turns stay in the chat's `$.state`. One question at a time, with Cancel; Clear empties the turns;
`/studio me` prints them whole. What needs tools (plans, transcripts, files) goes to the Director.

**Stage 7, the UI** (`hooks/pane.tsx` draws, `hooks/cards.ts` holds what the cards show; both
take plain values, so `register.tsx` keeps every engine call and handler):
- the pane is a dashboard: the 7-day usage as `Progress` bars, git counts, tabs (Board, Kanban,
  Notes, Models, Ask), a bordered card per chat with the whole ask or a wrapped recap, a filter,
  and a one-line glance when the desktop app minimizes the pane to a widget;
- the kanban: Planned, Building, Waiting on you, Review, Done. A chat's column comes from its
  state (`autoColumn`); ←, → and done pin an idle chat or a hand-made card, one file each in
  `docs/studio/cards/` (`/studio card <text>` adds one);
- in the director chat the pane drives the chat: "Answer: …" and "Brief me" on cards and the Ask
  tab's field send a prompt to the chat itself (`sendToDirector`: a fresh snapshot appended as a
  hidden row, then `$.prompt.submit`), so the director answers with every tool;
- `/studio`'s output row is drawn as a compact board (`CommandOutput`), the prompt footer says
  `director` (`SessionMode`), a fresh chat's pane has "Make this chat the Director";
- `/director` in a used chat offers a button that clears the chat (the mod's own `/clear`) and
  makes it the director; `/director fresh` does the same typed; `/director off` leaves the mode.
A helper that takes `$` is declared at the top of `register.tsx` (the engine refuses one declared
inside `register`). In tests a `Progress` reads as a Text of its label and figure.

**Stage 8, the memory graph** (`hooks/graph.ts`, `hooks/brain.ts`, `hooks/recall.ts`, pure;
`hooks/memory.ts`, the engine side; design §5.11). The idea is graphify's (Apache-2.0, in
`Graphify-Labs/graphify`); the code is ours and graphify itself is not installed:
- **The graph** is read from files with no model call and rebuilt in memory at most once a minute,
  only files whose mtime changed read again: milestones (MASTER_PLAN.md's index), docs and their
  sections, decisions (note lines, the archive, status-log entries), rules (the memory folder's files,
  CLAUDE.md's rule lines), chats, workstreams (tags), open asks, commits, cards, topics (a table in
  `graph.ts`) and the brain's concepts. Each link is `extracted` (a file says it, 1.0), `inferred`
  (scored 0.95 … 0.55) or `ambiguous`. Louvain clusters and hubs. Nothing is stored in git; nothing
  from the memory folder is written anywhere.
- **Recall:** in the director chat each of the user's prompts (typed, or sent from the pane) gets a
  `<studio-recall>` block beside the snapshot: up to 3 topics it names, each with its status, chats,
  the rules that apply, its decisions from all of history, open asks, docs, commits and the brain's
  links, every line with its source, 6,000 characters at most. When no word matches, one Haiku
  classify picks a topic (3 s at most). No block when nothing matches.
- **Tools** (director chat only, `mcp__studio__…`): `studio_recall {topic}`, `studio_path {from, to}`,
  `studio_remember {text, about}` (a notes line ending `[about: …]`), `studio_section {doc, heading}`,
  `studio_overview`.
- **The nudge:** a doc read while the graph wasn't asked that turn gets a hint, 5 a thread at most.
- **The start checks:** the director's `start_session` (`user_asked`) is refused while a live chat
  has the same tag, naming it, until an AskUserQuestion is answered in that turn (D7's gate). It
  fails open. (Until stage 11 a working builder was refused too: "one builder at a time".)
- **The brain pass** (director chat only): Haiku reads `docs/`, `docs/design/`, `docs/plan/` and
  `docs/slip7/` a chunk at a time, two at once, and names ideas and links; the answers are cached by
  content hash in `~/.claude/projects/<project>/studio-graph/brain.json`, outside the repo.
- The role text and the snapshot's pointer line say: recall before deciding, ask the graph before big
  docs, put the rules recall lists into every brief, record decisions with `studio_remember`.

**Stage 9, the map** (`hooks/map.ts` and `hooks/maphtml.ts`, pure; design §5.12):
- **The Map tab** (any chat): an `Svg` mind map around one node, with work on the left (milestones,
  chats, open asks, commits) and topics, rules, decisions, the brain's ideas and docs on the right.
  A solid line is a link a file states, dashed a guessed one, dotted an unsure one; each name has a
  hover title with its source. An `Svg` in a pane takes hover, not clicks, so buttons under it move
  the focus, with a breadcrumb (`Studio › G5 › …`), Back and a "Jump to" picker. Beside it (under it
  in a narrow pane), what the director is reminded of for that node: recall's own text. Home is the
  clusters around "Studio". The terminal draws the branches as text.
- **The full map:** "Open the full map" (or `/studio map`) writes `map.html` to
  `~/.claude/projects/<project>/studio-graph/` (outside the repo: it holds rule names from the memory
  folder) and opens it with `explorer.exe`, which opens the default browser on Windows. One
  self-contained page: pan (drag), zoom (wheel, + and −), fold (click a branch), search, a node's
  details and links on a click, double-click to centre it.

**Stage 10, the plan map** (`hooks/plan.ts`, pure; design §5.13):
- **The Map tab opens on Plan** (a Plan | Memory switch on top; Memory is stage 9's map). Home:
  "Scrapshift" in the middle and up to 10 areas around it, the busiest first. An area is a milestone
  from MASTER_PLAN.md, or a topic, or "Other work". Each box carries a strip of squares, one per stage,
  coloured by state: waiting on you (amber), building (green), to review (blue), done (grey), planned
  (dashed).
- **Stages** are the chats and the planned cards. A chat sits under its tag's milestone (`N1d` → N1),
  else the milestone or topic its title names (the memory graph's matcher), else Other work: every
  chat that waits on the user is on the plan. Its state is its kanban column (an idle chat off the
  kanban is done). A planned stage is a kanban card with `under` (a milestone code or a topic id).
- **An area's view:** its stages as boxes around it, the most urgent first, names on one or two
  lines. Buttons under the map pick a stage: a card under the map with Answer, Brief me (director
  chat), "Start this stage" (a planned stage, director chat: the director writes its breakdown and
  asks for the OK before it starts the chat) and Mark done. A field plans a new stage under the area.
  Beside the map: what the director recalls for it.
- **The director's tool** `studio_plan`: `{title, under}` adds a planned stage, `{card, column}` moves
  one (done once its chat starts), no input lists them. "Plan a stage under G5: …" in the chat uses it.

**Stage 11, the leads** (`hooks/leads.ts`, pure; design §5.14):
- **Who is a lead:** `docs/studio/leads.md`, read at most once a minute: §7's chat-id table names
  the leads (its parts table gives their slugs), §8 the chats each one adopted. No file, or none
  named: the board stays one list, as before.
- **Which chats are a lead's:** followed up the chain of starters (`startedBy` in the app's
  `list_sessions`): the first chat on the way that is a lead, or that a lead adopted, names it. So a
  lead's builders, their builders, and the chats an adopted chat started are all the lead's.
- **The snapshot** (director chat): the leads first, waiting, then working, then idle, each with its
  state, ask and recap and then its chats; then the chats under no lead in the four groups. A
  "changes" snapshot lists a lead only when it or one of its chats changed or waits.
- **The pane's Board tab:** By lead | By state. By lead: each lead's card, its waiting and working
  chats as lines with "Open chat", its idle ones folded; then the chats under no lead. By state is the
  board of stages 2-10. The filter works in both. `/studio`'s text lists the leads too.
- **A lead's own view:** in a lead chat each of the user's prompts carries a
  `<studio-lead-snapshot>` of only its own chats (full in a new thread, then the changes). No notes,
  git or usage; no role section.
- **The role and the checks:** the role says work runs in parallel by part under eleven leads and
  names `docs/studio/leads.md`; the snapshot's pointer line says it too, for a director whose role
  predates this. The "a builder is already working" refusal is gone; the same-tag check stays.

Commands: `/studio`, `/studio me`, `/studio note <text>`, `/studio card <text>`, `/studio tag <X>`, `/studio allow-commit`, `/studio recall <words>`, `/studio graph`, `/studio map`, `/studio brain [pause | resume]`, `/studio probe`, `/director`, `/director fresh`, `/director off`.
Tests: `claude plugin test <this folder>`.

Running the checks:
- Use a `claude` as new as the one that runs the mod (the desktop app bundles its own copy, which
  can be newer than the one on PATH). Then `claude plugin validate <this folder>` and
  `claude plugin test <this folder>` (about 10 s).
- `tsc`: with TypeScript 5.4 or newer, `tsc -p <folder>` on a tsconfig written outside the mod with
  the options the API's types file gives in its header, its `include` naming that types file (the
  plugin-authoring skill says where it is) and the mod's `hooks`, `types` and `tests`.
- A new copy loads in a chat only after the user types `/reload-plugins` there.
