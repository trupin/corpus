# Corpus — Specification

A minimalist, single-user webapp for conversations around documents, driven by an AI agent. This spec is self-contained: it is written for a builder agent starting from an empty repository. It distills proven patterns from a prior system (`personal-assistant`) into one primitive — the document — plus a small plugin surface.

## 1. Context and goals

The prior system grew five parallel domain-specific conversation stores (issues, todos, decision sessions, research threads, per-listing threads), each with its own file format, CLI helpers, and projection code. Corpus replaces them with a single canonical model:

- **Everything is a document** — a markdown file with YAML frontmatter.
- **Documents can be commented on.** A comment on a document opens a **thread**.
- **Threads are themselves documents**, so they can be listed, filtered, and commented on recursively.
- **Comments are anchored inline** (to a quoted text range), so the context a thread started from is never lost.
- **The agent addresses comments** when explicitly invoked (opt-in per comment).
- **The corpus is the agent's memory, and the agent is its steward.** The agent doesn't just answer in threads — it creates, edits, moves, and archives documents on its own initiative as part of any work. The system self-maintains and learns: knowledge worth keeping becomes a document; stale documents get updated or archived; organization improves over time.
- The core is deliberately small; every domain feature (todos, schedules, domain agents, …) is a **plugin**.

Non-goals for v1: sandboxing/container walls (the deployment environment already provides one), multi-user auth, token streaming from the agent, external service gateways, schedules/cron, mobile.

## 2. Architecture overview

Four cooperating runtimes over one source of truth, identical in shape to the proven prior system:

```
React UI  ──HTTP JSON──▶  Hono server  ──reads──▶  files + cache.db
   ▲                          │
   └──SSE invalidate──────────┤ chokidar watcher: file change → re-project → SSE
                              ▼
                    .corpus/queue/pending/*.json
                              │  fs.watch
                              ▼
              parked Claude Code orchestrator (the agent)
                              │  mutates files via the `corpus` CLI
                              └──▶ files change → watcher → SSE → UI updates
```

Rules that make this work:

1. **Files on disk are the source of truth.** SQLite (`.corpus/cache.db`) is a derived, rebuildable projection used for lists, filters, and search. `corpus db rebuild` reconstructs it from files; `corpus db doctor` fails when files and rows drift.
2. **The UI never talks to the agent directly.** UI actions POST events; events become queue files; the parked agent wakes on queue files; the agent replies by mutating files through the CLI; the watcher projects and broadcasts; the UI refetches. Target round-trip for a plain file mutation: ~250 ms.
3. **The server never pushes data over SSE** — only `invalidate` events carrying query keys. The UI refetches over plain HTTP.
4. **All mechanical mutations go through the CLI** (used by both the server and the agent), so file formats are parsed/serialized in exactly one place.

## 3. Tech stack (fixed)

- **UI**: Vite, React 18, TypeScript strict, TanStack Query v5, React Router v6, `react-markdown` + `remark-gfm` for read surfaces, **TipTap (ProseMirror) for document editing** — WYSIWYG over markdown, serializing to clean markdown on save. Vanilla CSS with design tokens. Dev server on `:5173` proxying `/api` and `/events` to the server.
- **Server**: Hono 4 on `@hono/node-server`, run with `tsx` (no build step), `better-sqlite3`, `chokidar`. Port `8765`, bind `127.0.0.1`.
- **CLI**: plain Node ESM `.mjs`, zero runtime deps in command files. Entry `cli/corpus.mjs`, auto-discovering `cli/commands/<topic>/<verb>.mjs`.
- **Agent**: Claude Code (the `claude` CLI) run by the operator in the repo; behavior defined by `.claude/skills/*/SKILL.md` and `.claude/agents/*.md`.
- **Monorepo**: npm workspaces (`ui`, `server`). `npm run watch` runs server + UI dev concurrently. Node test runner for unit tests; Playwright for e2e.

## 4. Repository layout

```
corpus/
  data/                     # document root (configurable via CORPUS_DATA, default ./data)
    docs/                   # user documents, arbitrary nesting allowed
    threads/                # thread documents, flat, named <thread-id>.md
  .corpus/                  # runtime state (gitignored except queue tooling needs)
    cache.db                # derived SQLite projection (gitignored)
    queue/
      pending/  in-progress/  processed/  failed/  abandoned/
    attachments/<thread-id>/<turn-ts>/   # attachment bytes (gitignored)
    locks/<docId>.json      # per-document edit locks (§7)
    jobs/<eventId>.jsonl    # per-job log streams for the console (§7)
    seen.json               # read-state marks (§7)
    HALT                    # kill-switch sentinel (§7)
  ui/                       # React app (workspace)
  server/                   # Hono app (workspace)
  cli/                      # corpus CLI
  plugins/<name>/           # drop-in plugins (see §10)
  .claude/
    skills/                 # orchestrate, comment (+ plugin skills) — indexed as documents (§7)
    skills-archived/        # archived (disabled) skills, still indexed
    agents/                 # subagent personas — indexed as documents (§7)
  SPEC.md                   # this file
```

`data/` is part of the same git repository. **Every mutation performed through the CLI auto-commits** the affected files under `data/` with a structured message (e.g. `comment: reply on th_a1b2 by agent`) and with the acting party (`user` or `agent`) as git author — `git log` doubles as the audit trail of who changed what. Git is the history mechanism; there is no separate versioning system. Anchor drift (see §6) is recoverable from git history.

## 5. The document model

A document is a markdown file with YAML frontmatter. Canonical frontmatter (core fields; plugins may add fields under their own keys):

```yaml
---
id: doc_a1b2c3          # immutable, unique; generated on creation (docs: doc_*, threads: th_*)
type: note              # "note" | "thread" | "view" | "template" | "skill" | "agent-def" | plugin types (e.g. "todo")
title: Mortgage options
created: 2026-07-19T10:00:00Z
updated: 2026-07-19T10:42:00Z
tags: [finance]
status: open            # open | resolved | archived (meaning per type; threads use it heavily)
anchors: {}             # text-quote selectors for threads on this doc, keyed by anchor id (see §6)
due: null               # optional deadline (ISO date) on ANY type — surfaces in Attention and filters
reviewed: null          # last explicit "still current" confirmation (see staleness below)
evergreen: false        # true = never considered stale (reference material)
---
Body is plain markdown.
```

- `id` is the stable reference used everywhere (routes, anchors, links). File path is presentation, not identity; the projection maps id → path.
- Frontmatter parsing: use a real YAML library (e.g. `yaml`) — do not hand-roll.
- A document with `type: thread` additionally carries the thread fields in §6.
- **Staleness is core.** A document's age runs from `max(updated, reviewed)` against global thresholds (defaults: 30/90/180 days → fresh, aging, stale, very stale). The UI renders this as a gradual ramp (age rail → dimming → age chip → archive-or-act quick actions); stale documents enter the Attention view for triage. "**Still current**" sets `reviewed: <now>` — a committed act distinct from editing; `evergreen: true` opts a document out entirely.
- **Inline references** are id-based: `[[doc_a1b2c3]]` (or `[[th_x9y8]]` — any document id, threads and skills included) in any body. Nobody types ids by hand — `[[` autocompletes by title search in every composer/editor and inserts the id. A ref renders as a link showing the target's **current** title (rename/move-proof); the alias form `[[doc_a1b2c3|as text]]` overrides the display. Refs are extracted into the projection's `links` table at projection time, powering backlinks (§9, §11). An unresolved ref renders visibly broken and is a `doc check` warning, not a failure (referencing a not-yet-created document is legitimate).

## 6. Threads and anchors

A **comment** on a document creates a thread — a first-class document in `data/threads/`:

```yaml
---
id: th_x9y8
type: thread
title: "Re: 30-year fixed assumption"     # derived from anchor quote or first turn
created: ...
updated: ...
tags: []
status: open              # open | resolved; resolved threads collapse in the doc view
parent: doc_a1b2c3        # the commented document (may itself be a thread); null = standalone thread
anchor: anc_k4f7          # id of an anchor entry in the parent's frontmatter; null = whole-document comment
agent: requested          # none | requested | engaged — whether the agent participates (see §8)
---
## user · 2026-07-19T10:05:00Z
@agent is 6.1% still the right assumption?

## agent · 2026-07-19T10:07:12Z
Checked current averages; 6.4% is more representative. Updated the doc.
```

**Turn format.** The thread body is a sequence of turns. Each turn is delimited by an H2 heading `## <author> · <ISO timestamp>`, where `<author>` is `user` or `agent` (single-user system). Everything until the next turn heading is the turn body (markdown, may contain attachments and `[[refs]]`). The CLI is the only writer of this format, and it guarantees turn timestamps are unique (monotonic) within a thread — they are the turn's identity. **Individual turns can be deleted — user-only** (like all deletion): a hover-revealed action on each turn with an inline confirm, via `DELETE /api/threads/:id/turns/:ts`; git retains the deleted turn, and the agent never deletes turns. **Deletion cascades**: deleting a thread's last turn deletes the thread itself, and deleting a thread (either way) removes its anchor entry from the parent's frontmatter — no highlight is ever left pointing at an empty conversation.

**Forms in turns.** An agent turn may contain a fenced ```` ```form ```` block (YAML: a prompt + options, written only via the CLI). The UI renders it as live controls; submitting appends a structured answer turn (chosen option + optional note) and enqueues a `form.respond` event — re-triggering the agent like any engaged-thread reply. Threads with an unanswered form surface in Attention as "awaiting your answer".

**Anchoring.** Anchors are text-quote selectors (W3C Web Annotation style) stored **in the frontmatter of the commented document**, keyed by anchor id. The body stays clean — no inline markers:

```yaml
---
id: doc_a1b2c3
type: note
# ...core fields...
anchors:
  anc_k4f7:
    exact: "assume a 30-year fixed at 6.1%"
    prefix: "the model we "
    suffix: " which may be stale"
---
```

- Anchor ids (`anc_*`) are unique within their document; a thread references its anchor as `parent` (document id) + `anchor` (anchor id). One anchor per thread.
- An anchor entry is added when a comment is created (the create-thread endpoint writes the selector into the parent's frontmatter and creates the thread file atomically) and removed when its thread is deleted.
- **Resolution** happens at projection/render time against the current body:
  1. Exact match of `prefix + exact + suffix`.
  2. Fallback: exact match of `exact` alone (unique occurrence).
  3. Fallback: fuzzy match (highest-similarity window above a threshold).
  4. If unresolved, the thread is **orphaned**: still fully functional and listed, shown in a "detached threads" section of the document view rather than inline. Git history preserves what the anchor pointed at.
- **Anchor reconciliation (automatic).** Keeping selectors fresh is a mechanical guarantee of the write path, not a discipline anyone has to remember. Every document save goes through `reconcileAnchors(oldBody, newBody, anchors)` (in `cli/lib/anchors.mjs`, shared by the server and CLI):
  1. Resolve each anchor against `oldBody` (its ranges are known-good there).
  2. Diff `oldBody` → `newBody` and map each anchor's character range through the diff.
  3. Range untouched by the edit → keep `exact`, recompute `prefix`/`suffix` from the new surroundings.
  4. Range partially edited → the new text spanned by the mapped range becomes the new `exact`; recompute context.
  5. Range entirely deleted → the anchor keeps its last selector (for history/git) and its thread becomes orphaned.

  The updated `anchors` map is written in the same save (and same auto-commit) as the body change. Reconciliation runs on every save path: `PUT /api/docs/:id`, `corpus doc edit`, and agent edits (which go through the CLI). As a catch-all for out-of-band edits (external editor, direct file writes), the watcher runs the same reconciliation using the last committed version (git HEAD) as `oldBody` before projecting. The CLI additionally validates anchor entries on save (well-formed selectors, unique ids) and reports which anchors were remapped or orphaned.

**Recursion.** Because a thread is a document, commenting on a thread turn creates a child thread whose `parent` is the thread's id. The UI must handle at least two levels gracefully; deeper nesting just works through the same model.

**Standalone threads.** A thread may have `parent: null` (and no anchor): a free-standing conversation, typically a question asked to the agent from nowhere. The conversation simply *is* the document — it appears in Home, is filterable, titleable (the agent should set a good title after the first exchange), and can itself be commented on or later linked to documents the agent creates from it.

**Attachments.** A turn may include attachments (images, files). Bytes live in `.corpus/attachments/<thread-id>/<turn-ts>/`; the turn body references them with relative markdown links/images, which the server serves and the UI resolves. Attachments are gitignored (bytes don't belong in git); the references remain in the committed markdown. **Capture must be frictionless — three ways into any composer, including the global Ask/Capture composer**: a 📎 file picker, **pasting** directly (an image or file on the clipboard becomes an attachment, not garbage text), and **drag-and-drop** onto the composer (visible dropzone highlight). Composer attachments land on the created thread's first turn (Ask) or the capture's filing thread (Capture) — screenshot + one line is a first-class capture. Pending attachments preview as removable chips (image thumbnails) before sending; a turn may be attachment-only (no text). Posted turns render images inline and other files as download chips.

## 7. Event queue and agent loop

**Queue contract.** An event is one JSON file in `.corpus/queue/<status>/<id>.json`:

```json
{
  "id": "evt_...",
  "type": "comment.created",
  "created": "2026-07-19T10:05:01Z",
  "source": "ui",
  "payload": { "threadId": "th_x9y8", "parentId": "doc_a1b2c3" }
}
```

Core event types: `comment.created` (a turn that requests the agent), `form.respond` (a form answer, §6), `agent.done` (background subagent wake-back). Plugins may define their own types. Statuses: `pending → in-progress → processed | failed`; `abandoned` via UI/CLI.

**CLI queue verbs** (mirroring the proven prior design):

- `corpus queue idle` — blocks on `fs.watch` of `pending/`; returns the instant a file lands (zero-token parking for the agent). Rearm window ~8 minutes, then exits so the skill loop re-invokes it.
- `corpus queue claim-all` — atomically moves all `pending/*` to `in-progress/` and prints them as one JSON batch.
- `corpus queue complete|fail <id>`, `corpus queue abandon <id>`, `corpus queue reap-stale` (recover stuck in-progress), `corpus queue halt|resume` (a `.corpus/HALT` sentinel; while halted, `idle` parks and `claim-all` returns empty).

**Orchestrator skill** (`.claude/skills/orchestrate/SKILL.md`). The operator starts `claude` in the repo and invokes `/orchestrate`. Loop: `claim-all` → for each event, handle it (directly or by delegating to a skill/subagent) → `complete`/`fail` → `idle` → repeat. Events touching the same document run serially; independent documents may be parallelized. The skill must state: reply and mutate **only via the `corpus` CLI**, never by hand-editing thread files.

**Comment skill** (`.claude/skills/comment/SKILL.md`). Handles `comment.created`: read the thread, plus the parent document and anchor context when present (standalone threads have neither — the thread is the whole context; give it a good title after the first exchange). Do whatever the comment asks — answer, edit the parent document, create documents, spawn a subagent for large work; for inbox captures: retitle, move out of `inbox/`, expand, tag. Then reply with `corpus thread reply <id> --from agent <<'EOF' … EOF`. If the work changed any document, say so in the reply. Close the loop by setting `agent: engaged` on first reply.

**Document locks.** Editing is coordinated by a per-document edit lock — one holder at a time, file-backed like everything else (`.corpus/locks/<docId>.json` → `{holder: "agent" | "user", acquired, ttl}`):

- The **agent acquires the lock before editing a document** (the CLI's edit verbs do this implicitly) and releases it after; while it holds the lock, the UI renders that document **read-only** with a banner ("agent is editing — <what it's doing>") and live-updates as the agent's saves land via SSE.
- The **user's editor session holds the lock** while actively editing (acquired via the server on first keystroke, released on idle/close); the orchestrator defers edits to user-locked documents — the work stays queued and applies when the lock clears.
- **Force unlock** is the human escape hatch for a stuck agent lock: a button on the banner (and `corpus lock break <docId>`) that breaks the lock immediately. Breaks are recorded in the audit trail (commit message), and the agent's deferred edit re-enters the queue rather than being lost. Locks carry a TTL and `corpus lock reap` clears expired ones (same pattern as `queue reap-stale`), so a crashed editor can't wedge a document.
- Lock state is projected and broadcast over SSE like any other state, so lock banners appear/clear live everywhere the document is visible.

**Job logs (the console feed).** Every queue event is a **job**. While working a job, the agent emits progress lines that all converge on one file: `.corpus/jobs/<eventId>.jsonl` (runtime state, gitignored, reaped with its event). `corpus job log <eventId> "<line>"` appends directly; `POST /api/jobs/:id/log` (localhost-only, for Claude Code hooks like PostToolUse) appends to the same file. The server tails these files and broadcasts over SSE, so the UI's bottom console shows each job's status (from the queue) with its live log stream — where the agent is, step by step, per job.

**Read state.** A thread is **unread** when its last turn is newer than your last-seen mark. Marks live server-side in `.corpus/seen.json` (runtime state, gitignored — not part of the corpus), projected into SQLite, updated via `POST /api/threads/:id/seen`, and broadcast over SSE so unread badges clear everywhere at once. **What counts as read: displayed content only** — opening the thread, expanding its collapsed chip, or its turns being visible in focus-mode margin. Opening a parent document does *not* mark its collapsed-chip threads seen; a document row's aggregate unread indicator clears when all of its threads have actually been seen. Read state survives browser changes; it powers unread indicators and the Attention view.

**Agent stewardship.** The agent has the full document lifecycle at its disposal — `corpus doc create|edit|move|archive` (plus template and view documents like any other) — and uses it **autonomously**, both when a task calls for it and opportunistically while working ("leave the corpus better than you found it"). This is how the system self-maintains and learns:

- Durable knowledge learned in a thread (a preference, a decision, a fact) gets written into a document — created or updated — not left buried in conversation.
- Stale content is updated; obsolete documents are archived; misfiled ones are moved; near-duplicates are merged; overgrown ones are split.
- **Every change leaves a visible trace.** All mutations go through the CLI, which auto-commits with the acting party as git author (`--from agent|user`), so `git log` is a complete audit trail; anchor reconciliation (§6) keeps threads attached through edits; and when stewardship happens in service of a thread, the agent's reply states what it changed. Nothing is silently destructive: archiving is a reversible `status: archived` flip, and **deletion is user-only** — the agent archives, never deletes.

The stewardship rules live in the skills (orchestrate/comment), not in code — the mechanism is just the CLI + auto-commit + SSE, which the UI reflects live.

**Skills and agent definitions are documents.** A `SKILL.md` is already markdown with YAML frontmatter — Corpus's canonical format — so skills are not a separate subsystem; they are documents indexed in place:

- The projection and watcher cover `.claude/skills/**/SKILL.md` (as `type: skill`) and `.claude/agents/*.md` (as `type: agent-def`) as **additional document roots** alongside `data/`. One copy of each file; Claude Code and Corpus read the same files, no sync. Corpus's frontmatter fields (`id`, `type`, `title`, `tags`, `status`, `anchors`) coexist with Claude Code's (`name`, `description`) in the same YAML block; `corpus doc check` validates both sets. On the board, they surface like any documents — via search, `type: skill` / `type: agent-def` filters, and a pinnable "Skills & agents" seed view.
- **UI management falls out of the document model**: skills are listed, searched, and edited in the normal editor — and **commented on with anchors**. Selecting an instruction in a skill and posting "@agent this keeps causing X — fix it" is the system's behavioral feedback loop: the agent revises its own skill, traced like any stewardship.
- **Skill genesis is part of stewardship**: when the agent notices a recurring pattern, preference, or repeated correction across threads, it codifies it — creating a new skill or extending an existing one — and announces it in its reply.
- **Loop safety (validate + rollback)**: skill frontmatter is validated on every save, and `corpus skill rollback <name>` (a targeted git revert) restores a skill's last-known-good version. The orchestrate skill documents this recovery path for the operator, since a bad edit to a core-loop skill (orchestrate/comment) can break the loop that would otherwise fix it.
- **Archiving a skill disables it**: `corpus doc archive` on a skill moves its folder to `.claude/skills-archived/` — still indexed as a document (visible with the archived chip, restorable), no longer discovered by Claude Code.

## 8. Agent participation semantics (opt-in per comment)

- A plain comment is a passive note: it appends a turn and does **not** enqueue an event. Human-only threads are normal.
- A comment **requests the agent** by any of: an `@agent` mention, a targeted `@<subagent>` mention, a `/<skill>` invocation, or an explicit toggle in the composer (which the UI translates to the same flag on the POST). Only then is `comment.created` enqueued.
- **Targeted invocation is a directive, not a hint.** `@<subagent-name>` (a `type: agent-def` document's name) routes the work to that subagent; `/<skill-name>` applies that skill to the thread/document context; both can combine. The server parses mentions and invocations at post time, validates them against the projection, and puts structured `mentions`/`skills` fields in the event payload — the orchestrator dispatches accordingly, deviating only when the target is missing or archived (and then says so in its reply). Generic `@agent` leaves routing to the orchestrator's triage.
- Every later turn in a thread where the agent is `engaged` re-triggers the agent unless the user marks the thread `resolved` or posts with the "note only" toggle. (Rationale: once you've pulled the agent into a conversation, replying to it should just work.)
- The UI shows an honest, time-aware pending indicator while an agent response is outstanding ("working…" → "still working…" with escalating thresholds like 45 s / 3 m / 15 m). **No fake progress, no token streaming.**

## 9. Server

### 9.1 Projection (SQLite)

`schema.sql` defines derived tables only; `db-projections.mjs` (in `cli/lib/`, imported by the server through a typed bridge) maps files → rows.

- `documents(id, type, title, path, status, tags_json, created, updated, due, reviewed, evergreen, body_excerpt)`
- `threads(id, parent_id, status, agent, anchor_id, title, created, updated, turn_count, last_author, last_ts)`
- `anchors(doc_id, anchor_id, exact_text, prefix, suffix, resolved_offset)` — extracted from parent frontmatter at projection time; `resolved_offset` is NULL when the selector no longer resolves (its thread is orphaned)
- `turns(thread_id, idx, author, ts, body_md)`
- `events(id, type, status, created, payload_json)` — queue mirror
- `seen(thread_id, last_seen_ts)` — read state, from `.corpus/seen.json`
- `jobs(event_id, status, started, updated, last_line)` — console rows; full log lines stay in `.corpus/jobs/*.jsonl` (tailed, not projected)
- `locks(doc_id, holder, acquired, ttl)` — from `.corpus/locks/`, powering live lock banners
- `links(from_id, to_id)` — inline `[[refs]]` extracted from bodies/turns at projection time; powers backlinks and the `references:` filter
- `search` — FTS5 over document titles + bodies + turn bodies
- `meta(key, value)`

Chokidar watches `data/`, the skill/agent document roots (`.claude/skills/`, `.claude/skills-archived/`, `.claude/agents/`), `.corpus/queue/`, `.corpus/locks/`, and `.corpus/jobs/`; on change it re-projects the affected file(s) and broadcasts `invalidate` with the affected query keys. Write endpoints that need read-your-write consistency re-project synchronously before responding (avoids the refetch race).

### 9.2 HTTP API

- `GET /api/docs?q=&type=&status=&tag=&folder=&parent=&references=&agent=&author=&since=&due=&stale=&unread=&needs=&sort=` — **the single collection query endpoint** behind every list: structured filters compose with optional FTS (`q`, matching titles/bodies/turns, returning snippet highlights). Thread-specific filters (`parent`, `agent`, `unread`, awaiting-reply) no-op for non-thread types. `needs=me` is the Attention union: unread agent replies ∪ unanswered forms ∪ due/overdue ∪ stale-for-review ∪ failed jobs.
- `GET /api/tree` — the `data/docs/` folder tree (names + doc counts), for folder pickers and filter chips
- `GET /api/docs/:id` — frontmatter + body + this doc's anchors (id, resolved range or orphaned, thread id, thread status)
- `POST /api/docs` — create (frontmatter subset + body; body pre-filled from the type's `template` document when one exists and no body is given) · `PUT /api/docs/:id` — edit body/frontmatter (runs anchor reconciliation per §6; response reports remapped and orphaned anchors)
- `GET /api/threads/:id` — thread with turns (thread *lists* go through `GET /api/docs` with `type=thread`)
- `POST /api/threads` — create a thread: on a selection (parent + text-quote selector captured from the selection; the server writes the anchor entry into the parent's frontmatter and creates the thread file atomically), on a whole document (parent, no anchor), or standalone (no parent — the composer's Ask action). Plus first turn + agent flag.
- `POST /api/capture` — thin composition for the composer's Capture action: creates the inbox doc + its filing thread in one call
- `POST /api/threads/:id/turns` — append a turn (agent flag; multipart for attachments)
- `POST /api/threads/:id/resolve` · `/reopen` · `POST /api/threads/:id/seen` (mark read) · `DELETE /api/threads/:id/turns/:ts` (**user-only** turn deletion)
- `DELETE /api/docs/:id` — **user-only** deletion (UI: ⋯ menu with explicit confirm; CLI: `corpus doc delete`); its threads become orphaned records, git preserves history
- `GET /api/jobs?recent=` — console rows (queue mirror + last log line) · `GET /api/jobs/:id/log` — full log · `POST /api/jobs/:id/log` — hook ingest (localhost-only) · `DELETE /api/queue/:id` (abandon)
- `GET /events` — SSE invalidation stream (25 s heartbeat, dead-subscriber pruning)
- `GET /attachments/...` — attachment bytes
- Plugin routes mount under `/api/x/<plugin>/...`

All writes flow through the same `cli/lib/*` helpers the CLI uses, then auto-commit.

## 10. Plugin system

A plugin is a directory `plugins/<name>/` discovered by convention — no central registration. All four extension points are optional:

```
plugins/todos/
  manifest.ts               # UI: registers doc type renderers and/or board column types
  ui/                       # React components referenced by the manifest
  server/routes.ts          # mounted at /api/x/todos
  cli/commands/<verb>.mjs   # exposed as `corpus todos <verb>`
  skills/<name>/SKILL.md    # symlinked/loaded into .claude/skills at dev time
  types.yaml                # doc types this plugin owns (e.g. `todo`) — exists alongside the
                            # manifest because the server/CLI can't import a TS manifest;
                            # UI reads manifest.ts, server/CLI read types.yaml
```

1. **Document types + renderers**: `manifest.ts` exports `{ id, name, icon?, order?, docTypes: [...], columns: [...] }`. The UI discovers manifests with `import.meta.glob('../../plugins/*/manifest.ts')` — build-time compilation, no runtime loading machinery; the dev server picks up a dropped-in plugin on rebuild. Each `docTypes` entry is `{ type, ListItem?, View?, DocPanel?, validate? }`: a doc whose `type` has a registered `View` renders with it (falling back to the standard markdown view); `ListItem` customizes its Home rows; `DocPanel` is the **one core slot in v1** — a panel injected into the document view for doc types the plugin owns (e.g. todo stats above a todo doc). Commenting/threads work identically on every type.
2. **Agent skills**: dropped into `.claude/skills/`; the orchestrate skill routes plugin event types (`<plugin>.*`) to them by convention.
3. **Server routes + CLI verbs**: auto-discovered from the plugin directory (server: dynamic import of `plugins/*/server/routes.ts` at boot; CLI: the dispatcher already scans `plugins/*/cli/commands/`).
4. **UI columns (plugin "pages" are board columns)**: each `columns` entry is `{ type, label, icon?, Component, defaultQuery? }` — a plugin registers **column types** for the board rather than standalone pages. Adding an instance (via the new-list picker) creates a pinned **view document** referencing the column type (`column: "<plugin>/<type>"` in its frontmatter), so plugin columns are ordered, persisted, and agent-stewarded exactly like any other column. The Component renders the column body (dashboard, map, aggregation…) with the kit's reader/focus affordances — wide content belongs in focus mode. Every plugin column renders inside an **error boundary** — a crashing column shows an error card in place, never takes down the board; a manifest that fails to load is skipped with a visible warning. A plugin whose column would be just a filtered list shouldn't write React at all — it ships a view document.

**The UI contract is `@corpus/kit`.** Plugin UI imports *only* from the kit (importing `ui/src` internals is lint-forbidden), so core can refactor freely behind it. The kit exposes: the API client and query hooks (`useDocs(query)`, `useDoc(id)`, `useThread(id)` — SSE invalidation transparently included), shared components (MarkdownView, ConversationThread, doc list rows, the composer with `@`/`/`/`[[` autocompletes), layout primitives, and the CSS design tokens. This is what makes plugin columns feel native and conversational — a custom map column can mount a `ConversationThread` beside a listing because threads-on-anything is core. Convention: plugin TanStack query keys are namespaced `x/<plugin>/…`, and plugin server routes broadcast SSE invalidations with those keys — the live-update loop works identically for plugin columns.

The core must not import from any plugin except through these discovery mechanisms. Deleting a plugin directory must leave the core fully functional (its documents remain, rendered as plain markdown).

## 11. UI — the board

> **Visual reference:** `design/index.html` is the living interactive mockup and is authoritative for look & feel; this section defines the structural contract.

**Shell.** A top bar (wordmark · centered search bar · Ask/Capture composer button), the **board**, and the **console** drawer at the bottom. All agent/system status lives in the console strip, not the top bar. No sidebar. Vanilla CSS tokens, light/dark.

**The board.** The main surface is a horizontally scrolling strip of **columns** — independent list+reader modules — with snap scrolling. The model is identical at every width: a 13″ laptop simply shows fewer columns (mobile remains a non-goal). A trailing ghost column ("＋ New list") opens the picker: a folder, a library/preset view, a plugin column type, or "from current search" — all of which create pinned view documents.

- **Columns are pinned view documents.** A column IS a `type: view` document with `pinned: true`; its frontmatter holds the query (filters, search text, sort) and `order` (board position). Adding, removing, reordering (drag by header, browser-tab style), or reconfiguring a column edits that document — auto-committed and agent-stewardable ("@agent pin me a view of unresolved finance threads" just works). Only browser-local state stays local: scroll positions, open readers, and per-reader navigation stacks. The seed data ships starter columns (Attention, Inbox, Open threads) — deletable like any document, nothing hardwired.
- **Per-column reader.** Clicking a row opens the document *in that column* (column widens); each reader keeps its own navigation stack and offers **focus mode** (⤢): a full-viewport reading/editing surface with margin threads. Multiple columns can have documents open side by side — the wide-screen workflow.
- **Folder scoping**: folder columns scope by directory (the hierarchy remains the primary organization, agent-reorganizable by moving files); threads inherit their parent document's folder, so a folder column surfaces both documents and their conversations. Tags cross-cut as chips.
- **Attention** is a built-in seed view (`needs=me`): unread agent replies, unanswered forms, due/overdue documents, stale-for-review, failed jobs — each row carrying a reason chip. Handling the reason (reading the reply, answering the form, reviewing/archiving, retrying) clears the row live via SSE.
- **Search overlay.** The top-bar search bar expands (click or ⌘K) into the full search module: one query input (FTS across titles, bodies, turns; snippet-highlighted results grouped by type) composing with filter chips: type, tag, status, folder, date, due, unread, `references:`, and — for threads — agent participation / awaiting-reply / parent. Default state excludes `status: archived`; an "archived" chip brings them back (archiving is organizational, not deletion). **"Save as view"** pins the current query as a new board column. All through the single `GET /api/docs` endpoint.
- **Type-aware rows.** Rows adapt to document type: thread rows show anchor quote, last-turn preview, **unread** and pending-agent indicators; plugin doc types render via their registered `ListItem`; everything else gets title/excerpt/tags/updated. The **staleness ramp** (§5) renders per row: age rail → dimming → age chip → archive / still-current / @agent-triage quick actions at the stale tier.
- **Creating documents — zero-form, inbox-first.** Quick creation always lands in `data/docs/inbox/`: omnibox create (no exact title match → **Create "<query>"**), the composer's Capture, and ＋ on non-folder columns. A folder column's ＋ creates into its folder; a plugin column's ＋ creates its doc type. The new document opens immediately in its column, title selected, ready to type — the agent files inbox arrivals per its skill.
- **Templates are documents.** A `type: template` document with `for: <doc-type>` in its frontmatter provides the starting frontmatter/body for new documents of that type (first match wins; none → empty). Seeded under `data/docs/templates/`; plugins ship templates for their types as seed documents; the agent can edit them like anything else.
- **Global composer: Ask / Capture.** A global composer (keyboard shortcut + a prominent Home affordance) is the "blank page" entry point to the agent, with two submit actions:
  - **Ask** — creates a **standalone thread** (`parent: null`, agent-requested) whose first turn is your text: the conversation is the document. For questions and open-ended requests.
  - **Capture** — creates a small document in `data/docs/inbox/` holding your text, plus an agent-requested whole-document thread asking the agent to file it properly (retitle, move out of inbox, expand, tag — per its skill). For thoughts that should live on as documents.

  Both are built entirely from existing primitives — a doc and/or a thread plus a `comment.created` event, no new machinery — and both appear on the board immediately with a pending-agent indicator. Keyboard: `c` opens the composer (the shortcut is shown on the button); inside it, `↵` submits Ask, `⌘↵` submits Capture, `⇧↵` inserts a newline.
- **Smart input everywhere.** Every composer (thread reply, global composer) and the document editor share three autocompletes, all backed by the projection via `GET /api/docs`: `@` → agent + subagents (agent-def documents; name + description), `/` → skills (skill documents), `[[` → documents by title (inserts the id ref). Creating a new skill or subagent document instantly makes it autocompletable — there is no separate registry.
- **Document view — always editable, Google-Docs-like.** There is no edit mode: the document renders as rich text (TipTap over markdown) and you click anywhere and type. Markdown shortcuts apply as you type (`##` → heading, `**` → bold, `[[` → ref autocomplete); the editor serializes to clean markdown. **Autosave, no save button**: debounced writes through the same `PUT` path (anchors reconciled per §6 on every write), with auto-commits squashed on idle so git history stays meaningful. **Commenting**: selecting text pops a floating toolbar (formatting + **Comment**); commenting captures the text-quote selector and opens a thread composer (with "ask agent" toggle). **Adaptive thread placement**: in focus mode and wide layouts, threads sit Docs-style in the right margin, aligned to their anchors with connectors; in narrow columns they collapse to chips at the anchor that expand inline. Clicking an anchored highlight opens its thread; typing inside one just edits (reconciliation keeps the anchor attached). Whole-document comments and orphaned threads listed below the body, along with a **backlinks panel** ("referenced by", via the `links` table). **Navigation history**: each reader keeps its own stack — following `[[refs]]`, backlinks, or thread-context links pushes; Back pops with scroll position restored; the reader exits to its list only when the stack empties (with a shortcut to jump straight back to the list). Frontmatter editable as a small form (title, tags, status, due). A reader **⋯ menu** offers Archive, **Delete** (user-only, explicit confirm per §9), and Resolve/Reopen for threads; resolve/reopen also sits on every thread card. If the document is **locked** (see §7 locks), it renders read-only with a banner naming the holder and a **Force unlock** action.
- **Thread view** — turns markdown-rendered with author/timestamp, attachments inline (images) or as chips, added via picker/paste/drag-drop with chip previews (§6); forms render as live controls (§6); composer at bottom with "ask agent" toggle; resolve/reopen; the anchor quote pinned at top with a link back to the parent at the anchor position. Opening a thread marks it seen (`POST /api/threads/:id/seen`) — unread badges clear everywhere via SSE. Child threads shown per-turn.
- **Console** — the bottom drawer, and the single home of agent/queue status. Collapsed: a one-line strip (agent-status pill with working/idle/halted dot · queue depth · running/done/failed job counts · HALT toggle). Expanded (click), it **pushes the board up — never overlays content** — and its **height is resizable** by dragging its top edge. Layout is **master-detail**: a job list on the left (status dot, event, one-line state); selecting a job shows its **live log stream in the right panel** (agent hooks, §7 job logs; auto-scrolled, newest job auto-selected). Failed jobs offer retry/abandon in the detail header, and every job's detail header **links to its originating document/thread** — click-through opens it in its home column. Expanded state and height, like all navigation, are sticky.
- **Keyboard scheme (v1)**: ⌘K search · `c` compose · `↑`/`↓` (or `j`/`k`) move rows in the active column · `↵` open the highlighted document in its column · `⇧↵` open it **directly in full screen** · `esc`/`⌫` close/back (overlays and focus mode take precedence, then the column reader) · `←`/`→` (or `[` `]`) switch active column · `⇧←`/`⇧→` **move** the active column (keyboard drag; writes the view doc's `order`) · `f` focus mode on the open document · `e` archive the open (or highlighted) document · `r` focus the reply composer of the open document's visible thread · `?` toggles a **keyboard cheat-sheet overlay** listing all bindings. The active column follows focus/hover with a visible cue.
- Live updates: single resilient SSE connection; `invalidate` events map to TanStack Query key invalidations. Optimistic append of the user's own turn, reconciled on refetch; honest time-escalating pending indicator per §8.

## 12. Reference plugin: todos (part of v1)

Proves all four extension points with real utility:

- **Doc type** `todo`: frontmatter gains `items: [{ text, done, ts }]` (or items as markdown checkboxes in the body — builder's choice, but the CLI must own the format).
- **Renderer**: checkbox list view; toggling a box PUTs through a plugin route; each item can be commented on (anchored to the item text — the core anchor mechanism, unchanged).
- **CLI**: `corpus todos add|check|list`.
- **Skill**: a `SKILL.md` letting the agent manage todo documents when asked in threads ("add a todo to follow up on X").
- **Column**: a "Todos" column type aggregating open items across all `todo` documents, built exclusively on `@corpus/kit`.
- **DocPanel**: a small stats panel (open/done counts) injected above rendered todo documents — proving the v1 slot.

## 13. Publish plugin — Google Docs and other targets (first plugin after todos)

Publishing Corpus documents to external destinations — Google Docs first — as `plugins/publish/`. Three principles: **the agent never touches the destination**, **updates are incremental so destination comments survive**, and **one style map drives every target**.

**Trust boundary — a separate localhost bridge.** A tiny standalone process (`publish-bridge`, modeled on the prior system's host gateway) holds the Google OAuth token and exposes only publish/pull endpoints on localhost. The Corpus server proxies **user-clicked UI actions** to it; there is deliberately **no CLI verb**, so the agent has no path to Google. The agent's reach ends at editing the Corpus document and optionally setting `publish.ready: true` in frontmatter — which surfaces as "pending publish" in Attention for the human to act on. (Publishing is user-only in the same way deletion is.)

**Per-target state** lives under the plugin's frontmatter key:

```yaml
publish:
  gdoc: { docId: "1AbC…", lastSyncedHash: "…", lastPushed: 2026-07-24T… }
```

**Style map.** A `type: publish-style` document defines the rendered look (per-element font family/size/weight, spacing, colors). All targets render markdown through it: Google-Docs-friendly HTML, PDF, DOCX, static HTML. One layout definition, N destinations.

**Transport A — "Copy for Google Docs" (zero connection).** Renders the document to deliberately Docs-friendly HTML (inline styles from the style map) and writes it to the clipboard as rich `text/html` (async Clipboard API, with a plain-text fallback item). Pasting into a Doc preserves headings/fonts/lists/tables because we control the HTML — this is the creation path and works with no Google account connected.

**Transport B — diff sync (the update path, user-only).** "Push update" reads the live Doc via the API, normalizes, diffs against the Corpus document's rendered form, and applies **only changed ranges** as a minimal `batchUpdate` — like a careful collaborator. Google comments anchored in untouched text survive; comments inside a changed range detach exactly as if a human had edited that sentence. Before pushing, a **diff preview** shows the changed sections and names the Doc comments that sit inside them. If the Doc changed remotely since `lastSyncedHash`, the push **blocks**: the remote diff is shown, and reconciliation happens on the Corpus side (where the agent may help) before pushing again.

**Comments flow in.** Google Doc comments carry a quoted text range — the same text-quote anchor model as Corpus. On sync (or manual "Pull comments"), Doc comments import as **threads anchored on the Corpus document** (quote → anchor selector; author + `via: gdoc` recorded). They behave like any thread — filterable, agent-addressable — but agent replies reach the Doc only when the human next pushes (and in v1, thread replies are not written back to Doc comments at all; the reply lives in Corpus).

**UI.** The reader shows a publish-state chip (`never published · in sync · local changes · remote changed`); the ⋯ menu gains Copy for Google Docs, Push update… (with diff preview), Pull comments, and Link existing Doc. Failed pushes and remote-drift blocks surface in the console like any job.

**Corporate environments (admin-controlled Google auth).** The bridge's Google-facing half is **auth-pluggable**; the user-only gate and diff principle are invariant across all of these:

- *Internal OAuth app* — an app marked Internal in the org's Google Cloud (or an admin-allowlisted client ID). The "ask IT once" path; Drive/Docs scopes are restricted-class, so locked-down orgs block unverified apps by default.
- *Apps Script web app* — deployed from the user's own corporate account (runs as the user), exposing push/pull endpoints; the bridge holds only the script URL + secret. Covers ranged Docs edits and comment reads; commonly available where third-party OAuth apps are blocked.
- *IT-provisioned Drive MCP server* — an already-approved access path. Typical connector surface (verify per deployment): search/read incl. comments, create, copy — **no ranged updates, no comment writes**. If so, it can carry the pull side (live-doc reads, comment import) and initial creation, but the comment-preserving diff update still needs a Docs-API path (OAuth/Apps Script). If mounted for the agent, mount it **read-only** — reading the live Doc to help reconcile drift is safe and useful; pushes remain user-only through the bridge regardless.
- *Rich clipboard (Transport A)* is the floor that works under any policy — no connection at all.

## 14. Validation and git hooks

Hooks are part of the build, not an afterthought. They live versioned in `.githooks/` and are wired once per clone with `npm run setup-hooks` (`git config core.hooksPath .githooks`). Both hooks print exactly what failed and how to fix it; `--no-verify` is the documented escape hatch.

**pre-commit — fast, scoped to what's staged (target < 1 s):**

- When staged paths touch `data/` or `.corpus/queue/`: run `corpus db doctor` (projection drift check — file counts vs. row counts; must be cheap enough to run on every commit).
- When staged paths touch `data/`: run `corpus doc check --staged` — validates every staged document: frontmatter parses and has required fields, ids are unique, anchor entries are well-formed selectors with unique ids, every anchor belongs to an existing thread, every thread's `parent`/`anchor` resolve to a document and an anchor entry. Unresolvable-but-well-formed anchors (orphaned threads) and unresolved `[[refs]]` are warnings, not failures. (This is the same validator the server uses on `PUT`; the CLI exposes it so hooks and API share one implementation.)
- When staged paths touch `ui/`, `server/`, `cli/`, or `plugins/`: run lint on staged files only.

**pre-push — the slower full gate:**

- `tsc --noEmit` across both workspaces (and plugin manifests).
- Unit tests (`npm test`, node test runner).
- Full `corpus db rebuild` into a temp path + doctor against it (proves the projection is reconstructible from files alone, not just undrifted).

Playwright e2e stays out of the hooks (too slow); it runs on demand (`npm run e2e`) and is part of the milestone checks below.

**Interaction with auto-commit (§4):** the CLI's auto-commits go through the same pre-commit hook — this is deliberate, as it makes every mutation self-checking. If a hook fails during an auto-commit, the file mutation still stands (files are the source of truth); the CLI surfaces the failed commit loudly (non-zero exit / server log + SSE-visible queue event) rather than silently leaving uncommitted drift.

## 15. Milestones and verification

Build in this order; each milestone has an executable check:

1. **M1 — data model + CLI + hooks**: document/thread formats, `corpus doc|thread|queue|db` verbs (the full lifecycle: `create|edit|move|archive|check`), projection, auto-commit with author attribution, `.githooks/` + `setup-hooks`. *Check*: unit tests (node test runner) for parse/serialize round-trips, projection rebuild idempotence, `db doctor` drift detection, and anchor reconciliation (edits before/after an anchored range keep it resolved; edits inside the range update `exact`; deleting the range orphans the thread; surrounding-context changes refresh `prefix`/`suffix`); a commit staging a document with a malformed anchor entry (or a thread pointing at a missing anchor) is rejected by pre-commit, and passes after fixing.
2. **M2 — server + SSE**: routes, watcher, invalidation. *Check*: `curl` a doc create → file exists on disk with valid frontmatter → appears in `GET /api/docs`; touch a file on disk → SSE `invalidate` observed.
3. **M3 — UI core**: the board (columns from pinned view documents, drag reorder writing `order`, snap scroll), search overlay + save-as-view, always-editable document view (TipTap, autosave, anchored highlights, adaptive thread placement, ⋯ menu), thread view with read-state, Attention view, console shell, comment flow, keyboard scheme. *Check*: Playwright — omnibox-create a doc (lands in `inbox/`, opens title-selected) → type (file updates via autosave; anchors survive; squashed auto-commit on idle) → select text → comment ("note only") → highlight + chip appear without reload → thread appears in an Open-threads column; save a search as a view → new column appears AND its view document exists on disk; drag a column → its `order` frontmatter updates; open an unread thread → unread badge clears everywhere (expanding a chip counts; opening the parent alone does not); resolve it → it leaves Attention; expand the console → job list + selected job's log detail render and the drawer height persists after drag-resize; `[[` autocomplete inserts a ref that renders as the target's title and the target's backlinks panel lists the referrer.
4. **M4 — agent loop + skills-as-documents**: queue idle/claim, orchestrate + comment skills, skill/agent document roots indexed. *Check*: end-to-end — post an `@agent` comment in the UI, run the orchestrator (or simulate with `corpus thread reply --from agent`), agent turn appears in the panel via SSE; pending indicator shows meanwhile; lines emitted via `corpus job log` stream into the console row for that job. Skills appear in Home under the Skills virtual folder; edit one in the UI editor (save validates frontmatter), then `corpus skill rollback <name>` restores it; archiving a skill moves it out of Claude Code discovery while staying indexed. Locks: an agent-held lock renders the doc read-only with the banner; force unlock breaks it, logs the break, and re-queues the agent's deferred edit.
5. **M5 — plugin system + todos plugin**: discovery, `@corpus/kit`, todos end-to-end. *Check*: delete `plugins/todos` → app still boots and renders todo docs as plain markdown (its column shows a "plugin missing" card); restore → custom renderer, DocPanel, and Todos column return; the kit-only import rule is lint-enforced (a direct `ui/src` import from a plugin fails lint); a deliberately throwing plugin column shows an error card while the rest of the board keeps working.

Definition of done for v1: all five checks pass; `npm run watch` boots the whole system; `corpus db rebuild && corpus db doctor` is clean; pre-commit and pre-push hooks are wired and demonstrably block the failures they exist to catch; README documents the operator loop (start server, start `claude`, `/orchestrate`) and the one-time `npm run setup-hooks`.
