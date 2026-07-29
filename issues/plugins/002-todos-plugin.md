# [PLUGINS-002] Todos reference plugin: all four extension points with real utility

## Domain
plugins

## Status
todo

## Priority
P1

## Model
opus — reference implementation over a finished extension surface; PLUGINS-001 pins the contracts, this is careful construction against them.

## Dependencies
- Depends on: PLUGINS-001, AGENT-003
- Blocks: —

## Spec References
- SPEC.md §12 — "Reference plugin: todos (part of v1)"
- SPEC.md §10 — "Plugin system" (the extension points this plugin exercises; kit-only UI contract)
- SPEC.md §15 M6 — "plugin system + todos plugin" (the executable check; this issue's E2E plan runs it verbatim; renumbered per sprint-014 Adjudication 15)
- SPEC.md §6 — "Threads and anchors" (item-level commenting uses the core anchor mechanism, unchanged)

## Summary
Ship `plugins/todos` — the v1 reference plugin that proves every extension point PLUGINS-001 built, with enough real utility that it earns its place in the default workspace rather than reading as a demo. It owns the `todo` doc type, renders it as a togglable checkbox list whose writes go through its own server route, injects an open/done stats `DocPanel`, contributes `corpus todos add|check|list`, ships a `SKILL.md` so the agent can manage todos when asked in a thread, and registers a "Todos" board column type that aggregates open items across every `todo` document — built **exclusively** on `@corpus/kit`. It is also the subject of the M6 executable check: deleting the directory must leave the core fully functional.

## Format decision (pinned)
SPEC.md §12 leaves the items format to the builder ("frontmatter `items` … or markdown checkboxes in the body — builder's choice, but the CLI must own the format"). **Decision: frontmatter `items: [{ text, done, ts }]`.**

Rationale: the server and CLI must read and mutate items without a markdown round-trip, and frontmatter is already parsed, validated, and projected by core. Body checkboxes would require every writer (server route, three CLI verbs, the agent skill) to implement identical markdown list parsing and re-serialization, and would make a partial edit anywhere in the body able to corrupt item state. Frontmatter keeps a single structured representation, gives `validate?` something concrete to check, and lets the projection index open counts for the aggregate column cheaply.

Consequence to handle explicitly: item text is not part of the document body, so **item-level comment anchors are anchored to the item text as it appears in the rendered view** via the core text-quote anchor mechanism (§6) — the anchor stores the item's text as `exact` with the neighbouring items as `prefix`/`suffix`. No new anchor machinery; editing an item's text reconciles or orphans its thread exactly like editing body prose does.

Field semantics: `text` (string, required, non-empty), `done` (boolean, required), `ts` (ISO-8601 string, required — creation time; **not** completion time). Optional `due` (ISO date) is supported for the "due count" shown on rows and is the only optional field in v1.

## Acceptance Criteria
- [ ] `plugins/todos/manifest.ts` exports a valid `PluginManifest` (`id: "todos"`, `name: "Todos"`, icon, order) registering the `todo` doc type (`View`, `ListItem`, `DocPanel`, `validate`) and the `todos` column type.
- [ ] `plugins/todos/types.yaml` declares the `todo` type and its seed template path, and agrees with the manifest (the PLUGINS-001 parity check passes).
- [ ] **Doc type + View**: a `type: todo` document renders as a checkbox list — one row per `items[]` entry, done items visually distinguished, an inline "add item" affordance, and a text-editable item label. Clicking a checkbox toggles the item optimistically and persists via the plugin server route.
- [ ] **Server route**: `plugins/todos/server/routes.ts` mounts at `/api/x/todos` with (at minimum) `PUT /api/x/todos/:docId/items/:index` (toggle/edit one item), `POST /api/x/todos/:docId/items` (append), and `DELETE /api/x/todos/:docId/items/:index`. All writes go through the core write path (server is sole writer: file written, git auto-commit, projection updated) and broadcast an `x/todos/…` SSE invalidation.
- [ ] **Item commenting**: selecting an item's text in the rendered view opens the core comment composer and creates a thread anchored to that text through the **unmodified core anchor mechanism**; the anchored highlight and thread chip appear on the item without reload, and the thread behaves like any other (reply, resolve, "ask agent", unread).
- [ ] **ListItem**: a `todo` document's row in any column shows its title, the first items (truncated), and a **due count**, matching the todo rows in `design/index.html`.
- [ ] **DocPanel**: an open/done stats panel renders above the rendered todo document (both column reader and focus mode) — open count, done count, and a completion indicator — updating live as items toggle.
- [ ] **CLI**: `corpus todos add <doc> <text>`, `corpus todos check <doc> <index-or-text>`, and `corpus todos list [<doc>]` work as thin HTTP clients over the plugin routes, support `--json`, appear in all three `--help` levels and in the generated `docs/cli.md`, and each carries ≥1 example (CLI-001 registry validation).
- [ ] **Skill**: `plugins/todos/skills/todos/SKILL.md` lets the agent create and manage todo documents when asked in a thread (e.g. "add a todo to follow up on X"), using only `corpus todos` verbs and core doc verbs. It is loaded into `<workspace>/.claude/skills/` by `corpus init`, and orchestrate routes `todos.*` events to it by convention with no todos-specific text in the orchestrate skill.
- [ ] **Column**: a "Todos" column type aggregating **open** items across all `todo` documents, grouped by source document, each row linking to its document (opening it in the column reader). Implemented **exclusively** on `@corpus/kit` — `useDocs` for the query, kit components for rows/layout/tokens; zero imports from `apps/ui/src` (lint-enforced) and zero hard-coded colors.
- [ ] **Seed template**: a `type: template` document with `for: todo` ships as a seed document (per SPEC.md §11, templates are documents) so creating a todo from the picker or a column's ＋ starts with valid empty `items: []` frontmatter.
- [ ] **`validate`**: the manifest's `validate?` rejects malformed `items` (non-array, missing `text`/`done`/`ts`, wrong types) with a readable message, and the View degrades gracefully rather than crashing on a document that fails it.
- [ ] **§15 M6 passes**: deleting `plugins/todos` leaves the app booting, todo documents rendering as plain markdown, and the Todos column showing a "plugin missing" card; restoring returns the renderer, DocPanel, and column.

## Technical Design

### Files to Create/Modify
- `plugins/todos/manifest.ts` — `definePlugin({...})` with the `todo` doc type and `todos` column type
- `plugins/todos/types.yaml` — `types: [{ type: todo, label: Todo, seedTemplate: seeds/todo-template.md }]`
- `plugins/todos/ui/TodoView.tsx` — checkbox list renderer; optimistic toggle + mutation through the kit's client
- `plugins/todos/ui/TodoListItem.tsx` — row renderer (title, first items, due count)
- `plugins/todos/ui/TodoDocPanel.tsx` — open/done stats panel
- `plugins/todos/ui/TodosColumn.tsx` — aggregate column body (`useDocs({ type: "todo" })`, flatten open items, group by document)
- `plugins/todos/ui/queries.ts` — `x/todos/…`-namespaced query keys and the mutation helpers
- `plugins/todos/ui/todos.css` — component styles using only kit tokens
- `plugins/todos/server/routes.ts` — Hono router over `PluginServerContext`; item append/toggle/edit/delete; SSE invalidation
- `plugins/todos/server/items.ts` — the single shared implementation of item read/mutate over frontmatter (used by the routes; the only place the format is encoded)
- `plugins/todos/cli/commands/add.ts`, `check.ts`, `list.ts` — `CommandSpec` exports, thin clients over `/api/x/todos`
- `plugins/todos/skills/todos/SKILL.md` — agent instructions for managing todos
- `plugins/todos/seeds/todo-template.md` — `type: template`, `for: todo` seed document
- `plugins/todos/README.md` — short author-facing note pointing at `docs/PLUGINS.md`
- `assets/workspace/…` (modify, if seeds are copied at init) — include the todos seed template
- `plugins/todos/*.test.ts(x)` — colocated tests

### Key Implementation Details

**One place owns the format.** `server/items.ts` is the sole module that knows `items: [{ text, done, ts }]`. The routes call it; the CLI never parses frontmatter itself (it goes through the routes); the UI reads items off the already-parsed doc frontmatter and never writes them directly. This is what makes the format decision above enforceable rather than aspirational.

**Toggling.** The View mutates optimistically (immediate checkbox flip via TanStack Query optimistic update), PUTs to `/api/x/todos/:docId/items/:index`, and reconciles on the invalidation. Index-based addressing is fine because the route is given the expected current `text` as a body field and rejects with 409 if it no longer matches — cheap protection against a concurrent edit toggling the wrong item.

**Item commenting is core, untouched.** The View renders each item's text as ordinary selectable text inside the document view; the core selection toolbar and comment flow apply as they do to any prose. The plugin does not implement anchoring, threads, or highlights — if it needs to, something is wrong. Verify this by confirming no thread/anchor code exists in `plugins/todos`.

**The column is the kit-only proof.** `TodosColumn` may import from `@corpus/kit` and `@corpus/contract` and nothing else. It calls `useDocs({ type: "todo" })` (SSE invalidation included transparently per §10), flattens open items client-side, and renders them with kit row components inside the kit's column/reader affordances. Wide content belongs in focus mode (§10) — the column body stays narrow-friendly. It should read as a demonstration that a plugin column can feel native without privileged access.

**DocPanel derives, never stores.** Open/done counts are computed from the same frontmatter the View renders, so the panel updates with the same invalidation and can never disagree with the list.

**CLI verbs are thin.** `add` POSTs, `check` PUTs (accepting either a numeric index or a text match — text match resolves case-insensitively and errors with the candidate list on ambiguity), `list` GETs and renders a table, or JSON under `--json`. They resolve the document by id or title through the core docs API before hitting the plugin route, so the agent can say "the shopping list" rather than an id.

**The skill leans on the CLI.** `SKILL.md` instructs the agent to use `corpus todos …` and core `corpus doc …` verbs only — never direct file writes (Architecture Decision 2). It covers: creating a todo document from the template when none exists, adding items from a thread request, checking items off, and reporting back in the thread. It stays behavioral and short; it is a reference for plugin authors as much as an agent instruction.

**Design fidelity.** Row layout and the stats panel follow `design/index.html`'s todo rows — spacing, type scale, and the due chip come from kit tokens, not from new values.

### Edge Cases
- **Empty `items: []`** — View shows an empty state with the add affordance; DocPanel shows 0/0; the document does not appear in the Todos column (nothing open).
- **Malformed `items`** (hand-edited by the user or the agent) — `validate` fails; the View renders a non-blocking notice plus the raw markdown fallback rather than crashing; the DocPanel hides. The document remains editable so the user can fix it.
- **Duplicate item text within one document** — allowed; `check` by text reports the ambiguity and asks for an index; comment anchors disambiguate via `prefix`/`suffix` per §6.
- **Toggling an item that was deleted concurrently** (index out of range, or text mismatch) — 409 with a clear message; the UI refetches and surfaces a toast rather than silently writing.
- **Very long item text** — truncated with ellipsis in `ListItem` and the column, full text in the View; truncation must not break the anchor (anchoring uses the underlying text, not the rendered truncation).
- **A todo document that is locked** (§7) — the View renders read-only with the core lock banner; toggles are disabled; the plugin does not attempt to bypass the lock.
- **`due` in the past** — the due count on rows and the column highlight it per the design's overdue treatment; no separate notification machinery.
- **Archived todo documents** — excluded from the Todos column by default (matching core's default exclusion of `status: archived`).
- **Plugin deleted while todo documents remain** — documents render as plain markdown showing their frontmatter; no data is lost. This is the M6 contract and must be verified, not assumed.
- **Many todo documents** — the column query is a single `useDocs` call; flattening happens client-side. If item counts grow large, truncate per document with a "+N more" affordance rather than adding a bespoke endpoint.

## Testing Strategy
Vitest, colocated in `plugins/todos`.

- `server/items.test.ts` — append/toggle/edit/delete over fixture frontmatter; `ts` set on creation and never mutated by a toggle; malformed input rejected with readable errors; text-mismatch guard triggers.
- `server/routes.test.ts` — each route against a real temp workspace through the plugin server context: the file on disk changes, a git commit is created, the projection updates, and an `x/todos/…` invalidation is broadcast. 409 on text mismatch; 404 on unknown doc; 400 on out-of-range index.
- `ui/TodoView.test.tsx` — renders items; toggling calls the mutation and flips optimistically; a malformed `items` value renders the fallback notice instead of throwing; a locked document renders read-only.
- `ui/TodoDocPanel.test.tsx` — counts derived correctly for empty / all-open / all-done / mixed; updates when items change.
- `ui/TodoListItem.test.tsx` — shows first items and the due count; overdue treatment applied; long text truncated.
- `ui/TodosColumn.test.tsx` — with a stubbed `useDocs`: aggregates open items only, groups by document, excludes archived, renders an empty state, and clicking a row triggers the kit's open-document affordance.
- `cli/commands/*.test.ts` — each verb's `CommandSpec` passes registry validation (description + example); handlers issue the expected requests against a stub client; `check` by ambiguous text errors with candidates; `--json` output shape is stable.
- **Kit-only import test** — a test (or the shared lint-rule test from PLUGINS-001, extended) asserting no file under `plugins/todos` imports anything outside `@corpus/kit` / `@corpus/contract` / node builtins / its own files.
- **Manifest/types parity test** — `manifest.ts` doc types and `types.yaml` agree (the PLUGINS-001 check, applied to todos).
- Seed template test — the shipped template parses as a valid `type: template`, `for: todo` document with `items: []`.

## E2E Verification Plan
Real running application only — real server, real UI build, real `corpus` binary, real workspace on disk, Playwright for browser steps. **SPEC.md §15 M5 is the gold standard; steps 8–11 below run its check verbatim.**

### Verification Steps
1. **Boot** — `npm run watch`; server log lists `todos` discovered and mounted at `/api/x/todos`; `corpus todos --help` lists `add`, `check`, `list`.
2. **Create from template** — create a todo document through the real UI (＋ on a column, or the picker); confirm the file lands in `data/docs/` with `type: todo` and `items: []` from the seed template, and opens title-selected.
3. **Add + toggle** — add items in the UI, toggle one; confirm the file on disk shows the updated `items` array, a git commit exists (`git log -1`), the DocPanel counts change without reload, and an `x/todos/…` `invalidate` frame appears on the SSE stream.
4. **CLI round-trip** — `corpus todos add "<doc title>" "follow up on X"`, then `corpus todos list --json`, then `corpus todos check "<doc>" "follow up on X"`. Confirm each is reflected on disk **and live in the open browser tab** (no reload).
5. **Item comment** — select an item's text in the rendered todo view, comment ("note only"); confirm an anchored highlight + thread chip appear without reload, the thread shows in an Open-threads column, and `git show` reveals the anchor entry written by core (not by the plugin).
6. **ListItem + column** — confirm the todo document's row shows first items and the due count; add the "Todos" column from "＋ New list"; confirm its pinned view document exists on disk with `column: "todos/todos"`, it aggregates open items across multiple todo documents, clicking a row opens the source document, and checking an item elsewhere removes it from the column live.
7. **Skill** — `corpus init` a temp workspace; confirm `<workspace>/.claude/skills/todos/SKILL.md` exists. Post an `@agent` comment in a thread ("add a todo to follow up on X"), run the orchestrator (or `corpus thread reply --from agent` per M4's pattern); confirm the agent creates/updates a todo document through `corpus todos` and replies in the thread.
8. **§15 M5 — delete** — `rm -rf plugins/todos`, restart the whole system. Confirm: the app **boots**; existing todo documents render as **plain markdown**; the Todos column shows a **"plugin missing"** card while every other column works; `/api/x/todos/*` 404s; `corpus todos` is gone from `--help`.
9. **§15 M5 — restore** — restore the directory, restart. Confirm the custom renderer, the DocPanel, and the Todos column all return, with the todo documents' data intact.
10. **§15 M5 — lint rule** — add a direct `apps/ui/src` import to `plugins/todos/ui/TodosColumn.tsx`; `npm run lint` **fails** naming the kit-only rule. Revert; lint passes.
11. **§15 M5 — error boundary** — make `TodosColumn` throw deliberately on render; reload: an **error card** appears in that column, **the rest of the board keeps working** (other columns render, scroll, and open readers). Revert and confirm recovery.
12. **Cleanliness** — `corpus db rebuild && corpus db doctor` clean after all of the above; `grep -r` over `plugins/todos` shows no imports outside `@corpus/kit` / `@corpus/contract`.
13. Capture commands, outputs, SSE frames, `git log` excerpts, and screenshots for the log.

## E2E Verification Log
_Filled in by the implementing agent as proof-of-work. Must be from real E2E
testing — no mocks, no test clients. Real application, real requests, real
interfaces. Include specific commands run, actual outputs observed, and pass/fail
conclusions. State which model the implementing agent ran on ("implemented on:
opus | fable")._

### Reproduction (bugs only)
_[Agent fills: N/A — feature issue]_

### Post-Implementation Verification
_[Agent fills: application restarted, exact commands, observed output, confirmation feature works]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (cross-domain: UI, server, CLI, agent-runtime; and the M5 milestone check)
- [ ] `/evaluate` passes
- [ ] Committed with `[PLUGINS-002]` prefix
