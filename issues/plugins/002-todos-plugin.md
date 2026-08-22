# [PLUGINS-002] Todos reference plugin: all four extension points with real utility

## Domain
plugins

## Status
done

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
- SPEC.md §12 M6 — "plugin system + todos plugin" (the executable check; this issue's E2E plan runs it verbatim; renumbered per sprint-014 Adjudication 15)
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
- [ ] **Seed template**: a `type: template` document with `for: todo` ships as a seed document (per SPEC.md §10, templates are documents) so creating a todo from the picker or a column's ＋ starts with valid empty `items: []` frontmatter.
- [ ] **`validate`**: the manifest's `validate?` rejects malformed `items` (non-array, missing `text`/`done`/`ts`, wrong types) with a readable message, and the View degrades gracefully rather than crashing on a document that fails it.
- [ ] **§12 M6 passes**: deleting `plugins/todos` leaves the app booting, todo documents rendering as plain markdown, and the Todos column showing a "plugin missing" card; restoring returns the renderer, DocPanel, and column.

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
Real running application only — real server, real UI build, real `corpus` binary, real workspace on disk, Playwright for browser steps. **SPEC.md §12 M5 is the gold standard; steps 8–11 below run its check verbatim.**

### Verification Steps
1. **Boot** — `npm run watch`; server log lists `todos` discovered and mounted at `/api/x/todos`; `corpus todos --help` lists `add`, `check`, `list`.
2. **Create from template** — create a todo document through the real UI (＋ on a column, or the picker); confirm the file lands in `data/docs/` with `type: todo` and `items: []` from the seed template, and opens title-selected.
3. **Add + toggle** — add items in the UI, toggle one; confirm the file on disk shows the updated `items` array, a git commit exists (`git log -1`), the DocPanel counts change without reload, and an `x/todos/…` `invalidate` frame appears on the SSE stream.
4. **CLI round-trip** — `corpus todos add "<doc title>" "follow up on X"`, then `corpus todos list --json`, then `corpus todos check "<doc>" "follow up on X"`. Confirm each is reflected on disk **and live in the open browser tab** (no reload).
5. **Item comment** — select an item's text in the rendered todo view, comment ("note only"); confirm an anchored highlight + thread chip appear without reload, the thread shows in an Open-threads column, and `git show` reveals the anchor entry written by core (not by the plugin).
6. **ListItem + column** — confirm the todo document's row shows first items and the due count; add the "Todos" column from "＋ New list"; confirm its pinned view document exists on disk with `column: "todos/todos"`, it aggregates open items across multiple todo documents, clicking a row opens the source document, and checking an item elsewhere removes it from the column live.
7. **Skill** — `corpus init` a temp workspace; confirm `<workspace>/.claude/skills/todos/SKILL.md` exists. Post an `@agent` comment in a thread ("add a todo to follow up on X"), run the orchestrator (or `corpus thread reply --from agent` per M4's pattern); confirm the agent creates/updates a todo document through `corpus todos` and replies in the thread.
8. **§12 M5 — delete** — `rm -rf plugins/todos`, restart the whole system. Confirm: the app **boots**; existing todo documents render as **plain markdown**; the Todos column shows a **"plugin missing"** card while every other column works; `/api/x/todos/*` 404s; `corpus todos` is gone from `--help`.
9. **§12 M5 — restore** — restore the directory, restart. Confirm the custom renderer, the DocPanel, and the Todos column all return, with the todo documents' data intact.
10. **§12 M5 — lint rule** — add a direct `apps/ui/src` import to `plugins/todos/ui/TodosColumn.tsx`; `npm run lint` **fails** naming the kit-only rule. Revert; lint passes.
11. **§12 M5 — error boundary** — make `TodosColumn` throw deliberately on render; reload: an **error card** appears in that column, **the rest of the board keeps working** (other columns render, scroll, and open readers). Revert and confirm recovery.
12. **Cleanliness** — `corpus db rebuild && corpus db doctor` clean after all of the above; `grep -r` over `plugins/todos` shows no imports outside `@corpus/kit` / `@corpus/contract`.
13. Capture commands, outputs, SSE frames, `git log` excerpts, and screenshots for the log.

## E2E Verification Log

Implemented on: **opus** _(recorded by the orchestrator from the spawn parameters, 2026-07-29 —
the implementing session omitted the line; its report and this log are the sources. Evaluator
FAIL-1 resolved by this note.)_

**implemented on: opus.**

Environment (sprint-014): scratch `/tmp/corpus-s014-plugins002-tpYTyN`, real workspace
`ws/` on `9142`, real server from source, real Vite dev UI on `5285`
(`CORPUS_SERVER_ORIGIN=http://127.0.0.1:9142`, `VITE_CORPUS_TOKEN` from the workspace
config), real `corpus` from source (`node_modules/.bin/tsx apps/cli/src/bin/corpus.ts`),
and a **real packed tarball** installed into `prefix/` for the two INFRA riders
(workspace `ws-installed/` on `9146`). Browser steps ran a **driven** Chromium
(`playwright-core` directly against the dev server) — not the Playwright runner, and
`npm run e2e` was never invoked. `8765` stayed unbound throughout.

### Reproduction (bugs only)

The feature half needs none. The **two INFRA-008 riders are bug fixes** and were
reproduced first, against the real installed layout.

**Rider (a) — a dist-only packaged plugin exposed zero CLI verbs** (TEST-284).
`discoverPluginTopics` listed `<plugin>/cli/commands/*.ts` and only *remapped* each
name it had already found into `dist/`; a tarball ships built output only, so the
source directory does not exist and the filter yields nothing. Run against the real
`prefix/node_modules/corpus/plugins`:

```
packaged plugin tree: [ 'todos' ]
BEFORE the fix (source-only enumeration): {}
AFTER  the fix (dist-first enumeration):  {"todos":["add.js","check.js","list.js"]}
```

**Rider (b) — a packaged plugin's `dist` could not resolve `@corpus/contract`**
(TEST-287). `stagePlugins` copied `dist/` verbatim, and `@corpus/*` is *inlined* into
the tool's bundles rather than installed. Staging the plugin the old way (a verbatim
copy of its `tsc` output) beside the new one, inside the installed prefix:

```
BEFORE the fix (verbatim tsc copy): FAILED — ERR_MODULE_NOT_FOUND: Cannot find package
  '@corpus/contract' imported from …/plugins/todos-legacy/dist/server/routes.js
AFTER  the fix (staged bundle)    : mounted — default export is a function
```

Discovery contains that failure as a warning, so before the fix the routes silently
never mounted and every `corpus todos` verb (a thin client over them) failed at
request time.

### Post-Implementation Verification

#### A. Discovery, boot and mount (TEST-234–TEST-239)

`corpus init /tmp/…/ws --port 9142` then `corpus server start --workspace …/ws`:

```
{"level":"info","msg":"plugin discovered","plugin":"todos","routes":true,"types":["todo"]}
{"level":"info","msg":"plugin routes mounted","plugin":"todos","prefix":"/api/x/todos"}
```

Unauthenticated `GET /api/x/todos/lists` → `401`, like any `/api/*` route. `corpus todos
--help` lists `add`, `check`, `list`; the topic appears at all three help levels. No core
file names `todos`: the UI picks it up through `import.meta.glob` alone, and `npm run
build` emits its own chunk pair (`manifest-CkHa1Jti.js` + `manifest-CZQJ7cq-.css`).

**TEST-239 — dist-first, drilled.** With `dist/` built, the error string in
`server/routes.ts` was edited and the server restarted **twice**: both times the route
still answered the *old* message (`item index “two” is not a number`). Only after
`npm run build -w plugins/todos` did it answer the edited one. Source reverted, rebuilt,
old message back. The server loads `dist/server/routes.js`, proven rather than assumed.

#### B. Routes, all through the core write path (TEST-241–TEST-248)

Three items added by CLI, one with `--from agent`. On disk:

```yaml
items:
  - text: Renew passport
    done: false
    ts: 2026-07-29T11:08:09.060Z
  - text: Call plumber about garage leak
    done: false
    ts: 2026-07-29T11:08:09.446Z
    due: 2026-07-25
```

`git log` in the workspace attributes each write to its actor — `agent <agent@corpus.local>`
for the `--from agent` one, `user` for the rest. Toggling never moves `ts` (asserted on
disk and in `server/routes.test.ts`). Live refusals, all with the contract's `ApiError`
body and **no write**:

```
PUT …/items/0 {"expectedText":"something else"} → 409 {"code":"conflict","message":"item 0
  is now “Renew passport”, not “something else” — it changed under you; nothing was written"}
PUT …/items/99                                  → 400 {"code":"bad_request","message":"item
  index 99 is out of range — this list has 3 items"}
POST /api/x/todos/doc_nope/items                → 404 {"code":"not_found",…}
POST …/items on an agent-locked document        → 423 {"code":"locked",…}
```

`DELETE …/items/1` removed exactly one item, the others verbatim. There is no `node:fs`
anywhere under `plugins/todos/server/` (asserted by test); every write went through
`PluginServerContext`.

**TEST-247 — SSE, captured live** while one `corpus todos check` ran:

```
event: invalidate
data: {"keys":[["docs"],["docs","doc_jcurwn37"]]}

event: invalidate
data: {"keys":[["x","todos","lists"],["x","todos","lists","doc_jcurwn37"]]}
```

The core write path broadcast `["docs"]` itself; the plugin broadcast only its own
namespace. The refusal half (a plugin naming a core root) is the server context's own
behaviour, mirrored in `server/routes.test.ts`'s fake and asserted there — the plugin
never attempts it.

#### C. The UI, in a real browser (TEST-249–TEST-264)

Board on `5285`, **zero page errors** in every run.

- **ListItem**: 2 `.row.todo-row` rows; preview `["milk","Renew passport","Call plumber
  about garage leak","Send lease renewal notice"]`; due badge `1 due`.
- **DocPanel**: `1 | OPEN | 0 | DONE | plugin: todos`, and after clicking a checkbox the
  open count went `1 → 0` **without a reload**, the row picking up `class="check done"`.
- **View**: checkbox rows, an add affordance; typing "Book dentist (from the browser)"
  and pressing Add produced `["milk","Book dentist (from the browser)"]` live.
- **Column**: groups `["Shopping","Week of Jul 20"]`, open items only — the item checked
  a moment earlier had already left it.
- **TEST-264**: the picker offered `plugin:todos/todos :: ☑ Todos`; choosing it wrote
  `data/docs/views/todos.md` with `pinned: true`, `query: type: todo`, `column: todos/todos`.
- **TEST-258 open**: clicking an aggregated row put that column into `col kactive reading`
  and opened the source document, whose body is the plugin View (2 checkbox rows).
- **TEST-263 error boundary**: `TodosColumn` made to throw → `Plugin error — todos` /
  "Its column crashed: … The rest of the board is unaffected." in **that** column, while
  the other columns kept rendering rows and opening readers. Reverted; recovered.
- **TEST-262 kit-only rule**: a direct `../../../apps/ui/src/plugins/slots.js` import
  made `eslint` fail with *"Plugins may import only @corpus/kit and @corpus/contract
  (SPEC.md §10) — never a workspace's internals by path"*. **No config edit was needed.**
  Reverted; `eslint plugins/todos` clean.

#### D. CLI (TEST-265–TEST-273)

```
corpus todos list "week"
  Week of Jul 20 [doc_jcurwn37] — 2 open · 1 done
     1 ☐ Renew passport
     2 ☐ Call plumber about garage leak  (due 2026-07-25)
     3 ☑ Send lease renewal notice
corpus todos list --json | jq -e '.lists[0].items | length'   → 3   (exactly one JSON value)
corpus todos check "Shopping" "milk"
  corpus: “milk” matches 2 items (1, 2) — pass the number instead     (exit 1, nothing written)
```

Documents resolve by id, by exact title (case-insensitively) and by an unambiguous
fragment; `--from agent` attribution reaches git. **TEST-273**: `npm run docs:cli -w
apps/cli` adds `corpus todos add|check|list` with their examples and does **not**
document `_fixture`. The artifact-drift check is red inside the worktree, as expected
and per the accepted pattern — it diffs against HEAD, which only the orchestrator can
move:

```
✗ CLI reference is stale: docs/cli.md
  Fix: npm run docs:cli -w apps/cli && git add docs/cli.md
 docs/cli.md | 120 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
```

#### E. Skill, template, threads (TEST-274–TEST-280)

`corpus init` installed `<ws>/.claude/skills/todos/SKILL.md`, recorded as
`{"path":".claude/skills/todos/SKILL.md","source":"plugin:todos"}` in
`.corpus/template-manifest.json`. **TEST-277**: `grep -c todos` is `0` in *both* core
skills — routing is the `<plugin>.<action>` convention alone, and neither core skill was
touched (Adjudication 6). The comment skill's plugin-boundary rule is already there
(*"Route into a plugin … Invoke the skill installed at `.claude/skills/<plugin>/`"*).
**TEST-276**'s collision half is the shipped
`apps/cli/src/commands/init/scaffold-plugins.test.ts` (*"skips a skill colliding with a
core template skill, naming the collision"*); this run proves the non-colliding half.

**TEST-280**: `corpus doc create --type todo` lands a document with **no `items` key**,
which `corpus todos list` reports as `0 open · 0 done` and the View renders as an empty
list — Adjudication 17 working as ruled.

**Commenting (Adjudication 16 substitute).** A whole-document thread on a todo document
renders under the plugin View as `💬 1 · user | new` with the View still the body, and
behaves like any other thread: `corpus thread reply --from agent`, engagement flipped by
the server (`agent engaged`), `corpus thread resolve`. `corpus doc check` → *no findings*.

#### F. §12 M6 — the subtractive check (TEST-281–TEST-283)

`rm`'d `plugins/todos` (moved to the scratch dir), restarted server **and** dev UI:

| Claim | Observed |
| --- | --- |
| app boots | 5 columns render, **0 page errors** |
| todo documents render as plain markdown | body reads *"What this list is for \| The week's errands. Items live in frontmatter, this prose is the body."*; 0 checkbox rows, 0 DocPanels |
| data intact | `sha256` of `week-of-jul-20.md` byte-identical before and after |
| Todos column | `Plugin missing` card; `[data-todos-column]` count 0 |
| other columns | all render; a reader still opens |
| `/api/x/todos/*` | `404 {"code":"not_found","message":"no route matches GET /api/x/todos/lists"}` |
| `corpus todos` | gone: *`unknown command "todos"`*; absent from `--help` |

Restored and restarted: `plugin routes mounted … /api/x/todos`, 2 plugin ListItem rows,
`[data-todos-column]` back, DocPanel `2 | OPEN | 1 | DONE | 1 due | plugin: todos`, the
same three items and the resolved thread. `corpus db rebuild && corpus db doctor` →
*"projection is clean — 13 documents from 13 files"*.

#### G. The packaged tool (TEST-284–TEST-290)

`npm run package:build` → `plugins/ todos`; `npm pack`; installed into a scratch prefix.
Tarball contents:

```
package/plugins/todos/dist/{server/routes.js,cli/commands/{add,check,list}.js}
package/plugins/todos/{README.md,types.yaml,seeds/todo-template.md,skills/todos/SKILL.md}
_fixture entries: 0
```

No staged file carries a bare `@corpus/*` import specifier. Through the **installed**
binary: `corpus todos --help` lists all three verbs; `corpus init`/`server start` logs
`plugin routes mounted … /api/x/todos`; `GET /api/x/todos/lists` → `{"lists":[]}`;
`corpus todos add … --from agent` landed on disk with `a469f61 agent doc edit: Packaged
list`. Only the `todos` skill installed (`_fixture` is excluded from the tarball).

### Deferred / struck, with reasons

- **Item-level anchored commenting — STRUCK → sprint-014 Adjudication 16.** Unreachable
  under either format choice (anchors resolve against the body; a plugin `View` replaces
  the selection affordance). PLUGINS-003 is filed. Substitute evidence: §E above —
  document-level commenting on a todo document, end to end.
- **Seeding `items: []` — STRUCK → Adjudication 17.** Template pre-fill is body-only, so
  the seed ships no `items` key and every reader treats absence as empty. **No
  scoped-template-key mechanism was built**, and the question (sprint-012 Adjudication 3)
  is re-filed here verbatim: *whether a plugin may declare frontmatter-carrying template
  keys remains open.*
- **`docs/cli.md` drift check — DEFERRED → the orchestrator's harvest.** Red output
  recorded verbatim in §D with its reason.
- **Plugin seed templates are never installed into a workspace — escalation (see below).**

### Escalations

1. **`corpus init` initialises the current directory when given `--workspace`.** `init`
   takes a *positional* path; the global `--workspace` flag is silently ignored by it.
   Invoked through a wrapper that `cd`s into the repository, `corpus init --workspace
   /tmp/…` therefore scaffolded **this repository's worktree**: it overwrote `.gitignore`
   and `README.md` with the workspace template's, ran `git init`/`git add --all`/`git
   commit` there (the commit was blocked by the pre-commit hook), emptied the worktree's
   index, and set `core.bare = true` in the **main** repository's config. Files on disk
   were never lost. I restored `.gitignore` and `README.md` from `HEAD` and rebuilt the
   index with `git reset` — the one state-changing git command I ran, to repair damage I
   had caused; the orchestrator found and fixed `core.bare`. **Product-side this is a
   real hazard** (a global flag a command ignores, plus "refuses a directory that already
   holds a workspace" not firing on a directory that merely *looks* like a repo), and it
   belongs to cli-dev as its own issue. Every later invocation in this log passes an
   explicit `--workspace`/positional path.
2. **`ColumnComponentProps` had no way to open a document** — so an aggregate plugin
   column could not link a row to its source, and the AC was unreachable. SPEC.md §10 says
   a column `Component` renders its body *"with the kit's reader/focus affordances"*, so I
   added the smallest generic seam: an optional `onOpen?: (docId: string) => void` on
   `ColumnComponentProps` (`packages/kit`), passed from `PluginColumnBody`
   (`apps/ui/src/board/Column.tsx`, ~6 lines, plus a test). It is **cross-domain (ui-dev)
   and needs adjudication.** Nothing about it names todos.
3. **Plugin seed templates are declared but never installed.** `types.yaml`'s
   `seedTemplate` is honoured by nothing: `corpus init` copies `plugins/<dir>/skills/*`
   into the workspace and no seed. So `corpus doc create --type todo` starts from an empty
   body rather than the shipped template. The plugin ships the template and packaging now
   stages `seeds/`, so the missing half is one install rule — cli-dev, next wave.
4. **`plugins/*/dist/**` and `**/*.d.ts` were inside the coverage gate.** `COVERAGE_INCLUDE`
   is `plugins/*/**` (SPEC.md §10 puts a plugin's layout at its root), and naming
   `coverage.exclude` at all replaces Vitest's defaults — so the first *built*
   non-underscore plugin dragged its own compiled output and declaration files into the
   ≥90% gate at 0%. Added both to `COVERAGE_EXCLUDE` with a test. This is **build output,
   not a surface**: every line of `plugins/todos`'s source stays measured, so
   Adjudication 18 is respected rather than sidestepped.
5. **A packaged plugin's third-party dependencies stay external** and resolve from the
   published package's own `dependencies`. A plugin needing something the tool does not
   already depend on would install broken. Nothing in the repo does today; recorded in
   `stagePlugins`'s docblock and `docs/PLUGINS.md`.

### Coverage posture

`plugins/todos/**` scoped run — **99.59% lines · 95.64% branches · 96.51% functions ·
99.59% statements**, every metric clear of the 90% gate, with `dist/` and `.d.ts` out of
scope per escalation 4. 195 tests across 10 colocated files, plus the riders' tests in
`apps/cli/src/registry/plugins.test.ts`, `scripts/package-staging.test.ts` and
`scripts/coverage-gate.test.ts`. `npm run lint`, `npm run typecheck` and
`npm run format:check` all pass.

### Cleanup

Every process started here was stopped by pid; `lsof` reports nothing on `9140`–`9149`,
`5285` or `8765`, and no orphaned vitest workers. Scratch kept at
`/tmp/corpus-s014-plugins002-tpYTyN` (workspaces, tarball, install prefix, screenshots,
driver scripts).

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified (two struck per Adjudications 16/17; see the log)

## Completion Checklist (orchestrator)
- [ ] `/audit` run (cross-domain: UI, server, CLI, agent-runtime; and the M5 milestone check)
- [ ] `/evaluate` passes
- [ ] Committed with `[PLUGINS-002]` prefix
