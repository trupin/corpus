# [PLUGINS-001] Plugin extension points: discovery across UI, server, CLI, and skills

## Domain
plugins

## Status
in_progress

## Priority
P1

## Model
fable — API-boundary design across four surfaces; the kit contract is a long-lived commitment.

## Dependencies
- Depends on: UI-003, CLI-001, SERVER-003
- Blocks: PLUGINS-002

## Spec References
- SPEC.md §10 — "Plugin system" (the four extension points, discovery by convention, `@corpus/kit` as the UI contract)
- SPEC.md §11 — "UI — the board" (columns are pinned view documents; plugin column types in the new-list picker)
- SPEC.md §15 M5 — "plugin system + todos plugin" (the executable check this issue's machinery must satisfy)
- CLAUDE.md — Repository Structure (dependency direction: `plugins/*` import **only** `@corpus/kit` + `@corpus/contract`)

## Summary
Build the plugin substrate: four independent discovery mechanisms (UI manifests, server routes, CLI verbs, agent skills) that find `plugins/<name>/` **by convention with no central registration**, plus the enforcement that keeps the boundary honest — a lint rule forbidding plugin imports of `apps/ui/src` internals, and the guarantee that core never imports a plugin except through these mechanisms. This issue ships the extension points and their failure modes (missing plugin, crashing column, unloadable manifest) with a throwaway fixture plugin for testing; PLUGINS-002 ships the real reference plugin (`todos`) on top of it. The success condition is subtractive: deleting any plugin directory must leave the core fully functional, with that plugin's documents rendering as plain markdown.

## Acceptance Criteria
- [ ] **UI discovery**: `apps/ui` discovers plugin manifests via `import.meta.glob('../../../plugins/*/manifest.ts', { eager: true })`; adding or removing a plugin directory changes the registry on the next build/dev-server rebuild, with zero edits to core files.
- [ ] **Manifest contract** is typed in `@corpus/kit` and exported for plugin authors: `{ id, name, icon?, order?, docTypes: [{ type, ListItem?, View?, DocPanel?, validate? }], columns: [{ type, label, icon?, Component, defaultQuery? }] }`. Every field except `id`, `name`, `docTypes`, `columns` is optional; `docTypes` and `columns` may be empty arrays.
- [ ] **Doc type renderers**: a document whose frontmatter `type` matches a registered `docTypes[].type` with a `View` renders with that `View`; with no `View` (or no plugin) it falls back to the standard markdown document view. `ListItem` replaces the default row renderer for that type in every column list.
- [ ] **DocPanel** is the single core injection slot in v1: for a doc type a plugin owns, its `DocPanel` renders in a fixed slot **above** the document body in both the column reader and focus mode. No other injection slots exist.
- [ ] **Plugin columns are column types**: registered `columns` entries appear in the board's "＋ New list" picker; choosing one creates a **pinned view document** with `column: "<plugin>/<type>"` in its frontmatter (merged with `defaultQuery` if provided). The column is then ordered, persisted, reordered, and stewarded exactly like any other column (SPEC.md §11), with the plugin `Component` rendering the column body.
- [ ] **Error boundary**: every plugin column and every plugin-supplied renderer (`View`, `ListItem`, `DocPanel`) renders inside an error boundary; a throwing component shows an error card **in place** naming the plugin, and the rest of the board keeps working (no white screen, no lost columns).
- [ ] **Missing/broken plugin**: a manifest that throws or fails validation at load is skipped with a visible warning surfaced in the UI (console strip notice) and `console.error`; the rest of the plugins still load. A pinned view document whose `column:` references an unregistered plugin/type renders a **"plugin missing"** card in that column's body, and the column itself remains present, reorderable, and deletable.
- [ ] **Server discovery**: at boot the server dynamically imports `plugins/*/server/routes.ts` (compiled/loaded per the server's existing module strategy) and mounts each plugin's exported Hono router at `/api/x/<plugin>`. A plugin with no `server/` directory is skipped silently; a plugin whose routes module throws is skipped with a logged warning and **does not prevent server boot**.
- [ ] **Plugin SSE invalidations**: plugin routes receive a broadcast helper that emits `invalidate` events whose keys are namespaced `x/<plugin>/…`; the kit's query hooks subscribe to the same namespace, so plugin columns live-update through the core SSE connection with no extra machinery.
- [ ] **CLI discovery**: the CLI dispatcher scans `plugins/*/cli/commands/` and registers each command as a topic/verb pair in CLI-001's declarative registry, exposed as `corpus <plugin> <verb>`. Plugin commands appear in `corpus --help`, `corpus <plugin> --help`, and the generated `docs/cli.md` exactly like core commands, and are subject to the same registry validation (description + ≥1 example required).
- [ ] **Skills discovery**: `plugins/<name>/skills/` are loaded into the workspace's `.claude/skills/` at `corpus init` and in dev, and the orchestrate skill routes `<plugin>.*` event types to them by convention (no per-plugin wiring in the orchestrate skill).
- [ ] **`types.yaml`**: each plugin may declare the doc types it owns in `plugins/<name>/types.yaml` (the server and CLI cannot import a TS manifest). The server reads it to validate/route owned types; the UI reads `manifest.ts`. A mismatch between the two (a `docTypes[].type` absent from `types.yaml` or vice versa) fails a test and is reported at boot as a warning.
- [ ] **Lint enforcement**: a lint rule fails any import from `plugins/**` that resolves into `apps/ui/src` (or any workspace other than `@corpus/kit` / `@corpus/contract`), with an error message naming the allowed imports. A fixture proving the rule fires is part of the test suite.
- [ ] **No core → plugin imports**: a lint rule (or equivalent check) fails any static import of `plugins/**` from `apps/**` or `packages/**` outside the three discovery entry points.
- [ ] **Deletion is safe**: with all plugin directories removed, `npm run build`, the server boot, `corpus --help`, and the board all work; documents of previously-plugin-owned types render as plain markdown.

## Technical Design

### Files to Create/Modify
- `packages/kit/src/plugin/types.ts` — `PluginManifest`, `PluginDocType`, `PluginColumnType`, and the props contracts (`DocViewProps`, `ListItemProps`, `DocPanelProps`, `ColumnComponentProps`) that plugin components receive
- `packages/kit/src/plugin/index.ts` — public re-exports; `definePlugin(manifest)` identity helper for type inference in plugin manifests
- `packages/kit/package.json` — add `./plugin` to the exports map
- `apps/ui/src/plugins/registry.ts` — `import.meta.glob` discovery, manifest validation, indexes by doc type and column type
- `apps/ui/src/plugins/validate.ts` — runtime shape validation of a discovered manifest (Zod), returning `{ ok, manifest } | { ok: false, error }`
- `apps/ui/src/plugins/PluginErrorBoundary.tsx` — reusable boundary rendering the in-place error card (plugin id, component role, message, "reload" affordance)
- `apps/ui/src/plugins/PluginMissingCard.tsx` — the "plugin missing" card for unresolvable `column:` references
- `apps/ui/src/plugins/slots.tsx` — the resolution helpers core calls: `resolveDocView(type)`, `resolveListItem(type)`, `resolveDocPanel(type)`, `resolveColumnType(key)` — each already wrapped in the boundary
- `apps/ui/src/board/…` (modify) — new-list picker gains plugin column types; column renderer dispatches through `resolveColumnType`
- `apps/ui/src/document/…` (modify) — document view dispatches through `resolveDocView` / `resolveDocPanel`; list rows through `resolveListItem`
- `apps/server/src/plugins/discover.ts` — enumerate `plugins/*`, dynamic-import `server/routes.ts`, mount routers at `/api/x/<plugin>`, read `types.yaml`
- `apps/server/src/plugins/context.ts` — the object handed to plugin routers: typed doc read/write services and `broadcastInvalidate(keys)` constrained to the `x/<plugin>/` namespace
- `apps/server/src/app.ts` (modify) — call plugin discovery after core routes are mounted
- `apps/cli/src/registry/plugins.ts` — scan `plugins/*/cli/commands/`, build `TopicSpec`s, merge into the root registry
- `apps/cli/src/registry/index.ts` (modify) — include discovered plugin topics
- `apps/cli/src/commands/init/` (modify — a directory: `index.ts`, `scaffold.ts`, `template.ts`, …) — copy/link `plugins/*/skills/` into the workspace `.claude/skills/`; record plugin-sourced skills in `.corpus/template-manifest.json` with `source: "plugin:<name>"` (sprint-012 Adjudication 11)
- ~~`assets/workspace/.claude/skills/orchestrate/SKILL.md`~~ — STRUCK (sprint-012 Adjudication 1: AGENT-002 owns the orchestrate skill exclusively; the `<plugin>.*` routing convention is part of its required routing table — do not touch that file)
- `eslint.config.js` (root — `packages/eslint-config` does not exist) — the two boundary rules (`no-restricted-imports` overrides scoped to `plugins/**`, and the core→plugin ban)
- `plugins/_fixture/` — a test-only fixture plugin (manifest with one doc type + one column, one server route, one CLI verb, one skill) used by the E2E and unit tests; explicitly excluded from packaging
- `docs/PLUGINS.md` — the plugin author guide: directory layout, manifest contract, the kit-only rule, the `types.yaml` requirement

### Key Implementation Details

- **Template frontmatter carry-over is a plugin-design question** _(SERVER-005 template-bleed fix, 2026-07-27)_: SPEC §9.2 pins pre-fill as body-only and the server now enforces it (template frontmatter shadowing documented defaults was a bug — evergreen:true silently opted every templated note out of staleness). SPEC §11's looser "starting frontmatter/body" phrasing survives only as this open question: should plugins be able to declare SCOPED template keys (e.g. `column: research`) that carry to instances — never fields with documented server defaults? If yes, this issue designs the declaration mechanism and proposes the §11/§9.2 reconciliation as a spec clarification (user sign-off).


**Discovery is convention, not registration.** Nothing in core enumerates plugin names. The UI globs, the server reads the directory, the CLI scans, `init` copies. Adding a plugin is `mkdir plugins/foo` plus files; removing it is `rm -rf`. Any design that requires editing a core file to add a plugin is wrong.

**Why `import.meta.glob` and not runtime loading.** Vite compiles the glob at build time, so plugin code is type-checked, bundled, and tree-shaken with the app — no runtime module loader, no dynamic `import()` of untrusted paths, no separate build step per plugin. The trade-off is that a dropped-in plugin appears on the next dev-server rebuild rather than instantly; that is the accepted behavior per §10.

**Manifest validation is defensive.** `import.meta.glob` eagerly evaluates every manifest module, so a manifest that throws at module scope would take down the app bundle's init. Wrap each module access in try/catch and validate the exported shape with Zod before indexing it. Invalid or throwing manifests are collected into a `pluginLoadWarnings` array exposed through a context/hook so the console strip can render them; they never throw upward.

**Slot resolution is the only coupling.** Core components never import plugin code. They call `resolveDocView(doc.type)` and get back either a plugin component already wrapped in a boundary, or `null` (meaning: use the core default). This keeps the fallback path — "renders as plain markdown" — a natural consequence of the resolution returning `null`, not a special case that could rot.

**Plugin columns are view documents, not routes.** A plugin registering a column type contributes a picker entry only. Selecting it goes through the same create-pinned-view-document path as folder/search columns (SPEC.md §11), writing `column: "<plugin>/<type>"` plus any `defaultQuery` fields into frontmatter. The board then renders it by looking that key up in the registry. Consequence: reorder, delete, and agent stewardship come for free, and an uninstalled plugin degrades to a missing-renderer problem in one column rather than a broken board.

**Error boundaries are per-slot, not per-board.** A single boundary around the board would let one crash blank everything. Each resolved plugin component gets its own boundary instance keyed by `<plugin>/<role>/<type>` so a reset happens when the user navigates away and back.

**Server mounting.** Discovery runs after core routes so a plugin can never shadow `/api/docs`; the mount prefix `/api/x/<plugin>` is derived from the directory name, not from anything the plugin declares — a plugin cannot mount itself elsewhere. Each router receives a `PluginServerContext` rather than raw filesystem or database access; the server remains the sole writer (Architecture Decision 2) and plugin routes mutate documents only through the same internal write path core uses (git auto-commit, projection update, anchor reconciliation all preserved).

**Namespaced invalidation.** `broadcastInvalidate` prefixes every key with `x/<plugin>/` and rejects keys that already contain a `/` prefix belonging to core, so a plugin cannot invalidate core query keys. The kit's `useDocs`/`useDoc` hooks and any plugin-defined query key share one SSE connection.

**CLI registration reuses CLI-001's shapes.** Plugin command modules export the same `CommandSpec` object shape as core commands (description, args, flags, ≥1 example, handler). `registry/plugins.ts` wraps them in a `TopicSpec` named after the plugin directory and appends it to the root registry before validation runs — so a plugin command missing an example fails registry validation loudly, and `docs/cli.md` documents plugin verbs automatically. Plugin handlers receive the same `CommandContext` and are thin HTTP clients like every other verb.

**`types.yaml` is the non-TS mirror.** Shape: `types: [{ type: todo, label: Todo, seedTemplate?: path }]`. The server and CLI parse YAML; the UI keeps using the manifest. A parity test asserts the two agree so the duplication cannot silently drift.

**Skills loading.** `corpus init` copies `plugins/*/skills/*` into `<workspace>/.claude/skills/`; the dev flow does the same (copy, or symlink in dev for live editing — copy is the safe default and what `init` ships). Orchestrate routes by convention: an event of type `todos.something` looks for a skill under the `todos` plugin's contributed skills. No plugin names appear in the orchestrate skill text.

### Edge Cases
- **Two plugins claiming the same doc type** — first by `order` then by directory name wins; the loser is reported as a warning. Deterministic, never a silent coin flip.
- **Two plugins registering the same column type key** — impossible, since keys are namespaced `<plugin>/<type>`; a plugin registering the same `type` twice within its own manifest fails validation.
- **Manifest module throws at import time** — caught per-module; the plugin is skipped, others load.
- **Plugin component throws during render, and again on retry** — the boundary must not loop; the error card is terminal until remount.
- **Column doc references a plugin that exists but whose column type was renamed** — same "plugin missing" card; the frontmatter is left untouched so restoring the type restores the column.
- **Plugin server route throws at import** — logged, skipped, server still boots; requests to `/api/x/<plugin>/*` then 404 like any unknown path.
- **Plugin CLI command file with a syntax error** — the scan reports it and skips it; `corpus --help` still renders. It must not break core verbs.
- **`types.yaml` missing while `manifest.ts` declares doc types** — the UI still renders, but the server cannot validate the type; report a boot warning and fail the parity test in CI.
- **Empty `plugins/` directory (or none at all)** — every discovery mechanism returns empty; the app behaves as if the plugin system did not exist.
- **Plugin importing `@corpus/contract` types** — allowed and expected (it needs the doc schema). Only `apps/ui/src` and other workspaces are forbidden.
- **Nested/hidden directories under `plugins/`** — only direct children with a recognizable entry point count; `_fixture` is excluded from production builds via a name convention (leading underscore) documented in `docs/PLUGINS.md`.

## Testing Strategy
Vitest, colocated per surface.

- `packages/kit/src/plugin/types.test.ts` — type-level tests (`expectTypeOf`) that a minimal manifest and a fully-populated manifest both satisfy `PluginManifest`, and that a manifest with an unknown key is rejected.
- `apps/ui/src/plugins/validate.test.ts` — valid manifest passes; missing `id`, non-array `docTypes`, duplicate `type` within one manifest, and a component field that isn't a function all fail with a readable error.
- `apps/ui/src/plugins/registry.test.ts` — with a stubbed glob result: indexes by doc type and column key; duplicate doc-type claim resolves deterministically by `order` then name and records a warning; a throwing module is skipped and recorded; an empty glob yields an empty registry.
- `apps/ui/src/plugins/slots.test.tsx` — React Testing Library: `resolveDocView` returns `null` for an unowned type (core falls back to markdown); a registered `View` renders; a throwing `View` renders the error card and does not propagate; `DocPanel` renders above the body; `ListItem` replaces the default row.
- `apps/ui/src/board/…test.tsx` — the picker lists plugin column types; selecting one issues the create-view-document call with `column: "<plugin>/<type>"` and merged `defaultQuery`; a view doc with an unknown `column:` renders `PluginMissingCard` while the column header/controls remain.
- `apps/server/src/plugins/discover.test.ts` — against a temp directory of fixture plugins: routers mount at the right prefixes; a plugin without `server/` is skipped; a throwing routes module is skipped and boot completes; a plugin cannot mount outside `/api/x/<name>`.
- `apps/server/src/plugins/context.test.ts` — `broadcastInvalidate` namespaces keys and rejects un-namespaced/core keys; writes go through the core write path (assert git commit + projection update happened).
- `apps/cli/src/registry/plugins.test.ts` — a fixture plugin command appears in the registry, in all three help levels, and in generated docs; a command missing an example fails registry validation; a syntactically broken command file is skipped without breaking the rest.
- `plugins/_fixture/` parity test — `types.yaml` and `manifest.ts` declare the same doc types (the check that runs for every plugin, applied to the fixture).
- Lint-rule test — run ESLint programmatically over a fixture file that imports from `apps/ui/src` and assert the rule reports; and over one importing `@corpus/kit` and assert it does not.

## E2E Verification Plan
Real app only: real server process, real Vite build/dev server, real browser (Playwright), real `corpus` binary. SPEC.md §15 M5 is the gold standard this plan instantiates — PLUGINS-002 runs M5 verbatim against `plugins/todos`; here we run the same shape against `plugins/_fixture`.

### Verification Steps
1. **Baseline boot** — `npm run watch`; browser loads the board; server log lists discovered plugins; `corpus --help` shows the fixture topic.
2. **Doc type + DocPanel** — create a document of the fixture's owned type through the real UI (or `corpus doc create`); confirm it renders with the fixture `View` and that the `DocPanel` appears above the body in both the column reader and focus mode.
3. **ListItem** — confirm that document's row in a column uses the fixture `ListItem`, not the default row.
4. **Plugin column** — open "＋ New list", pick the fixture column type; confirm (a) the column appears, (b) a pinned view document exists **on disk** with `column: "_fixture/<type>"` in its frontmatter, (c) drag-reordering it updates that document's `order`, (d) it survives a page reload.
5. **Server route + SSE** — `curl` the fixture's `/api/x/_fixture/...` route with the workspace bearer token; observe a 200, the file change on disk, and the corresponding `x/_fixture/...` `invalidate` event on the SSE stream; confirm the open plugin column updates live without reload.
6. **CLI verb** — run `corpus _fixture <verb>` against the running server; observe the effect on disk and in the UI. Confirm the verb appears in `docs/cli.md` after `npm run docs:cli -w apps/cli` with no other diff.
7. **Skill loading** — `corpus init` into a temp workspace; confirm the fixture's skill file exists under `<workspace>/.claude/skills/`.
8. **§15 M5 — deletion** — `rm -rf plugins/_fixture`, restart: the app boots, the server logs no plugin, its documents render as **plain markdown**, its column shows the **"plugin missing"** card while the board otherwise works, and `corpus --help` no longer lists the topic. Restore the directory, restart: renderer, DocPanel, column, route, and verb all return.
9. **§15 M5 — lint rule** — add `import { something } from "../../apps/ui/src/board/Board"` to a fixture plugin file; `npm run lint` fails naming the kit-only rule. Remove it; lint passes.
10. **§15 M5 — error boundary** — temporarily make the fixture column `Component` throw on render; reload: an error card appears in that column naming the plugin, every other column still renders and scrolls, and the console strip has no unhandled error. Repeat for a throwing `View` (error card in the reader, board intact). Revert.
11. **Broken manifest** — introduce a syntax/shape error in the fixture manifest; rebuild: the plugin is skipped, a visible warning appears, and the rest of the app is unaffected. Revert.
12. Capture command output, server log lines, SSE frames, and screenshots for the log.

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
- [ ] `/audit` run (cross-domain: UI, server, CLI, agent-runtime)
- [ ] `/evaluate` passes
- [ ] Committed with `[PLUGINS-001]` prefix
