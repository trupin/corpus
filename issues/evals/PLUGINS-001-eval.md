# Evaluation: PLUGINS-001

**Date**: 2026-07-28
**Sprint**: sprint-012 (`issues/sprints/sprint-012.md`)
**Commit under test**: `93be4ac [PLUGINS-001] Plugin extension points: discovery across UI, server, CLI, skills`
**Verdict**: **PASS** (61/61 tests have a verdict: 61 PASS, 0 FAIL, 0 STRUCK, 0 DEFERRED)

Evaluator environment: real `corpus init` workspace `/tmp/corpus-s012-eval-ws/ws` on **9080**, real
server, real Vite dev server on **5282**, real Chromium via the Playwright library, real `curl` on
the SSE stream. The implementing agent's scratch `/tmp/corpus-s012-plugins001-BT5zCp` was treated
as a claimed-evidence source only. Every drill below was run by me; every scratch plugin I created
was removed and `git status` verified clean at the end.

---

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                     |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Eleven numbered phases mapped to the issue's E2E steps, plus deviations, two open design questions, and screenshots.        |
| Commands are specific and concrete       | PASS   | Real doc ids, raw SSE frames, a sha256, exact lint output, exact server log lines, exact frontmatter of the created view.  |
| Real E2E (not mocked)                    | PASS   | Real server process, real Vite on 5281, real Chromium, real curl SSE, real `corpus` binary from source. Unit suites are named separately and never substituted for the drills. |
| Scenarios cover acceptance criteria      | PASS   | Every TEST-75…135 addressed.                                                                                               |
| Application restarted after changes      | PASS   | Server and dev server stopped/restarted across the deletion drill; the log even records the negative result that a reload alone does not re-glob a restored plugin. |
| Actual model recorded (`implemented on:`)| PASS   | "implemented on: fable" — matches the issue's recommendation.                                                              |
| Reproduction logged before fix (bugs)    | N/A    | Feature issue.                                                                                                             |

**Deviations were disclosed, not buried**, and all four are covered by post-implementation
adjudications: the lazy glob (16), the narrowed boot warning (17), the three out-of-surface test
files (18), and the relaxed `TOPIC_NAME_PATTERN` (19). The log also volunteers the React 18
dev-mode `pageerror` re-throw — which I reproduced and confirm is a caught error re-reported to
`window`, not an escaped one.

---

## Honesty Audit — claims re-derived from scratch

| #  | Claim (log)                                                              | Re-derivation                                                                    | Result       |
| -- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------ |
| 1  | `corpus init` prints "installed 1 plugin skill file into .claude/skills/" | my own init on 9080                                                              | EXACT        |
| 2  | Boot log: `plugin discovered … routes:true, types:["fixture-note"]` and `plugin routes mounted … prefix:/api/x/_fixture` | my own server log | EXACT        |
| 3  | `corpus --help` lists `_fixture` (count 1)                               | grep                                                                             | EXACT        |
| 4  | All three help levels render like core verbs                             | ran all three; `_fixture add --help` shows Arguments, Global flags, Examples      | CONFIRMED    |
| 5  | Skill byte-identical to `plugins/_fixture/skills/fixture-notes/SKILL.md`  | `cmp`                                                                            | EXACT        |
| 6  | `orchestrate` and `comment` present and unmodified                       | `cmp` against `assets/workspace/...` — both identical                            | EXACT        |
| 7  | Manifest entry `sha256: 15568d0a…`, `source: "plugin:_fixture"`          | read `.corpus/template-manifest.json` from my own init                           | EXACT        |
| 8  | Template entries keep the two-key shape                                  | all 8 template entries are `{path, sha256}`                                      | EXACT        |
| 9  | Created view doc: `pinned: true`, `order: 13`, `query: {type: fixture-note}`, `column: _fixture/sample` | created it in the browser, `cat` the file        | EXACT (incl. `order: 13`) |
| 10 | Reorder rewrites `order: 13 → 30` (renumber pass)                        | ⇧← in the browser, then read the files: 10/20/30/40/50/60/70                     | EXACT        |
| 11 | Picker entry `data-newlist="plugin:_fixture/sample"`, label "Fixture notes" | opened the picker in Chromium                                                  | EXACT        |
| 12 | SSE frames `{"keys":[["docs"],…,["tree"]]}` then `{"keys":[["x","_fixture","notes"]]}` | my own `curl -N` capture during `corpus _fixture add`               | EXACT        |
| 13 | Requests without the bearer token get 401 on `/api/x/*`                  | `curl` without a token → 401                                                     | EXACT        |
| 14 | Agent-attributed plugin write → `agent doc create: …` in `git log`        | `POST /api/x/_fixture/notes` with `x-corpus-author: agent`                        | EXACT        |
| 15 | `docs/cli.md` never documents `_fixture`; regeneration produces no diff   | `grep -c` → 0; `npm run docs:cli` → `git status docs/cli.md` empty               | EXACT        |
| 16 | `check-generated-artifacts.ts` green twice                               | ran twice post-commit, exit 0 both                                               | CONFIRMED    |
| 17 | Error card: `Plugin error — _fixture` / `Its column crashed: <message>`  | injected the throw myself; card text identical                                    | EXACT        |
| 18 | Two React dev-mode `pageerror` re-throws, not an escaped error            | reproduced exactly 2; board fully rendered, boundary contained it                 | EXACT        |
| 19 | "Try again" re-throws and the card stays terminal                        | clicked it; card still present                                                    | CONFIRMED    |
| 20 | Broken manifest → `.c-plugin-warn`, title carries the Zod detail          | set `id: 42`; title = `_evalthrow: its manifest is invalid — id: Invalid input: expected string, received number` | EXACT (same shape) |
| 21 | Lint message "Plugins may import only @corpus/kit and @corpus/contract (SPEC.md §10) — never a workspace's internals by path" | added the violating import; `npm run lint` exit 1 | EXACT |
| 22 | Removing it → lint exit 0                                                | re-ran                                                                            | CONFIRMED    |
| 23 | Production bundle: `grep -c "_fixture\|fixture-note" dist/assets/index-*.js` → 0 | rebuilt and grepped                                                       | EXACT (0)    |
| 24 | Deletion: build succeeds, no plugin line, `/api/x/_fixture` 404, help drops the topic | ran the whole drill                                                  | CONFIRMED    |
| 25 | Restore returns renderer, DocPanel, ListItem, column, route and verb      | restored and re-verified all six                                                  | CONFIRMED    |
| 26 | `db rebuild && db doctor` clean after plugin writes                       | `{"ok":true,"drift":[]}` on 14 documents                                          | CONFIRMED    |
| 27 | `broadcastInvalidate` is namespaced                                       | my `_evalinv` plugin's `[["mine"]]` reached the wire as `[["x","_evalinv","mine"]]` | CONFIRMED  |
| 28 | Core keys are rejected                                                    | **the log only asserted namespacing; I proved the rejection**: `plugin _evalinv may not invalidate "docs" — plugin keys are namespaced x/_evalinv/…` | STRONGER THAN CLAIMED |
| 29 | A fixture registering `/api/docs` lands at `/api/x/<plugin>/api/docs`     | **the log cited a server test; I proved it live** — core `/api/docs` intact, plugin's copy answers only at `/api/x/_evalshadow/api/docs` | STRONGER THAN CLAIMED |
| 30 | Collision rule "core wins with a warning" was unit-verified               | **I proved it end-to-end**: a plugin shipping `skills/orchestrate/` → `warning: plugin _evalcollide ships a skill named "orchestrate" … skipped; a plugin can never replace a core skill`; core skill byte-identical afterwards | STRONGER THAN CLAIMED |
| 31 | `plugins/*/**` in `COVERAGE_INCLUDE` with `plugins/_*/**` excluded         | read `scripts/coverage-config.ts`                                                 | EXACT        |
| 32 | Registry validation applies to plugin commands                            | emptied `examples` in the loaded `dist` module → `RegistryValidationError: Invalid command registry: - corpus _fixture add has no examples`, exit 1 at module load | CONFIRMED |

**Overclaims found: one, immaterial.**

- **TEST-79's "grep core for `_fixture` → zero hits outside test fixtures"** is not literally true.
  There are **two** hits in core source, both **doc comments**: `apps/ui/src/plugins/registry.ts:87`
  (a JSDoc example of the key→name transform) and `apps/cli/src/registry/validate.ts:28` (a comment
  explaining the underscore convention). Neither is code; no code path enumerates a plugin name. The
  criterion's stated purpose — "Nothing in core enumerates plugin names" — holds, and I proved it
  behaviourally by adding three plugins with zero core edits. Recorded, not scored as a failure.

Three claims came back **stronger than the log asserted** (#28, #29, #30) — the agent under-sold
unit-verified behaviour that in fact holds end to end.

**One evaluator error, recorded for transparency:** my first TEST-111 drill edited
`plugins/_fixture/cli/commands/add.ts` and saw no validation error. The CLI prefers the compiled
`plugins/_fixture/dist/cli/commands/add.js` (Adjudication 12 iii), so my edit was inert. Re-run
against the loaded module, the error fires correctly. The implementing agent's claim was right and
mine was wrong.

---

## Criteria Results

### The kit contract

| #  | Criterion                          | Result | Evidence                                                                                                                       |
| -- | ---------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 75 | `@corpus/kit/plugin` is a real subpath export | PASS | `exports` gains `./plugin` (types + import + default → `dist/plugin/`); `.` and `./testing` byte-unchanged; `files: ["dist", …4 CSS]` still covers everything shipped. `plugins/_fixture/*` import from it and type-check (`npm run typecheck` exit 0). |
| 76 | `PluginManifest` is the §10 shape with the stated optionality | PASS | `types.test.ts`: `accepts a minimal manifest — id, name, empty arrays`, `accepts a fully-populated manifest`, `rejects a manifest with an unknown key`, `requires id, name, docTypes and columns` — 5/5 green. |
| 77 | `definePlugin` is an identity helper       | PASS   | `returns its argument by reference — an identity for type inference only` (asserted with `toBe`). No runtime behaviour. |
| 78 | Props contracts exported and consumed without casts | PASS | All four exported from `@corpus/kit/plugin` and each consumed by exactly one fixture component (`DocViewProps`→FixtureView, `ListItemProps`→FixtureListItem, `DocPanelProps`→FixtureDocPanel, `ColumnComponentProps`→FixtureColumn). `grep -c "as any\|@ts-expect-error"` across all fixture UI files + manifest → **0**. |

### UI discovery and the registry

| #  | Criterion                             | Result | Evidence                                                                                                                    |
| -- | ------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 79 | Discovery is the glob; core names no plugin | PASS | `registry.ts` composes `import.meta.glob([...,"!../../../../plugins/_*/manifest.ts"])` plus a dev-only `_*` glob behind `import.meta.env.DEV`. **Lazy rather than eager per Adjudication 16** — and I confirmed why that ruling was necessary (see TEST-82). Core enumerates no plugin name; the only `_fixture` occurrences in core are two doc comments (see the honesty audit). Proven behaviourally by TEST-80. |
| 80 | Adding a plugin costs zero core edits | PASS   | I created **three** plugins during this evaluation (`_evalshadow`, `_evalinv`, `_evalquiet`, plus `_evalthrow`/`_evalzdup`/`_evalcollide`). In every case `git status --porcelain` showed changes **only** under `plugins/`, the server picked them up on restart and the UI on dev-server restart. `rm -rf` had the same property. |
| 81 | Manifest validation is Zod, errors readable | PASS | Live: `id: 42` → skipped, `console.error` and strip title both read `its manifest is invalid — id: Invalid input: expected string, received number` — naming the offending field. Unit suite covers missing `id`, non-array `docTypes`, duplicate types within `docTypes` and within `columns`, and a non-function component; `validate()` returns the result union and never throws. |
| 82 | A throwing manifest is contained         | PASS   | **Verified in the browser, not only in a unit test.** A manifest throwing at module scope: the app initialised normally (7 columns), every other plugin still loaded (fixture rows present), **zero pageerrors**. This is precisely what an eager glob would have made impossible — Adjudication 16 is vindicated by observation. |
| 83 | Duplicate doc-type claims resolve deterministically | PASS | Live: a second plugin claiming `fixture-note` with `order: 99` won; `_fixture` was skipped with `it also claims the doc type "fixture-note", already owned by _evalzdup — _evalzdup wins`. Determinism pinned by `duplicate doc-type claims resolve by order, then name — and record the loser` and `ties on order fall back to directory name, deterministically`. |
| 84 | An empty glob is an empty registry       | PASS   | `an empty module list is an empty registry — no warnings, no error` + `EMPTY_REGISTRY … is the app-behaves-as-if-no-plugin-system state`. Confirmed live under TEST-130. |
| 85 | Load warnings are visible to a human     | PASS   | Both required channels: `console.error` (`[corpus] plugin _evalthrow skipped: its manifest failed to load: module-scope explosion in _evalthrow`) **and** a `.c-plugin-warn` node in the console strip reading `plugin _evalthrow skipped`, whose `title` carries the reason. With two bad plugins the strip aggregates to `2 plugin warnings` and the title lists both. Not an array nobody reads. |

### Slots, renderers, error boundaries

| #  | Criterion                                | Result | Evidence                                                                                                                  |
| -- | ---------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| 86 | Slot resolution is the only coupling; null is the fallback | PASS | Exactly the four helpers in `slots.tsx`, each returning a boundary-wrapped component or `null`. Core imports no plugin code: grep for any `plugins/` import outside `apps/ui/src/plugins/` → zero. |
| 87 | "Plain markdown" is the standard document view | PASS (with a recorded deviation) | **The substantive requirement is met**: there is exactly **one** document-body call site — `reader/DocView.tsx` lines 195/208, a single `DocEditor`/`MarkdownView` ternary — and PLUGINS-001 added no second renderer (its only reader change is +34/−2 in `DocView.tsx`; `apps/ui/src/editor/` is untouched). **Deviation**: for a plugin-owned type the null-resolution falls to the `MarkdownView` branch, not `DocEditor`, because the pre-existing `editorHandlesType` gates on `CORE_DOC_TYPES` and has done since Phase 3 (`e6ce966`) — the contract's premise that "the editor owns the document body ALWAYS" is not true of the shipped tree for non-core types. Verified live: a plain `note` opens with `.ProseMirror` mounted; a `fixture-note` with the plugin deleted renders through `.doc-body` with an `edit` affordance. The agent disclosed exactly this. **No second body renderer was introduced, which is what the Done Criteria asks.** Flagged for the orchestrator below. |
| 88 | A registered `View` renders, and gets no editor | PASS | Opened a `fixture-note` in Chromium: `[data-fixture-view]` present, `.ProseMirror`/`[contenteditable]` absent. Sprint-011's TEST-5 stays true. |
| 89 | `DocPanel` renders above the body in both surfaces | PASS | Column reader: `panel.compareDocumentPosition(view) & DOCUMENT_POSITION_FOLLOWING` → **PANEL BEFORE VIEW**. Focus mode (`f`): `.focus-inner [data-fixture-panel]` and `.focus-inner [data-fixture-view]` both present. Verified at both measures in a real browser. |
| 90 | `ListItem` replaces the default row in every column list | PASS | I added a **second** column over the same folder. Both `doc_seedinbox` and `doc_tqy5b2zq` render the same two documents as `[data-fixture-row]` — the plugin row in both, not just one. |
| 91 | `DocPanel` is the only injection slot in v1 | PASS | Exactly four `resolve*` plugin helpers, all in `slots.tsx`. The other `resolve*` functions in `apps/ui/src` (`resolveColumn`, `resolveShortcut`, `resolveSelectedJob`) are unrelated core code and call nothing in the registry. |
| 92 | Every plugin component gets its own boundary, keyed per role | PASS | `slots.tsx:37` — `const key = \`${plugin}/${role}/${type}\``, one `PluginErrorBoundary` per slot, memoised by that key; `displayName = PluginSlot(<key>)`. The boundary's docblock says "One boundary instance per `<plugin>/<role>/<type>` slot — never one around…". **Proven live**: with the `View` throwing, the plugin `DocPanel` and the plugin `Column` both kept rendering — three independent boundaries. Not a board-level boundary. |
| 93 | A throwing component shows an in-place card, board survives | PASS | **Both roles drilled by me.** Column: `Plugin error — _fixture` / `Its column crashed: deliberate crash for the boundary drill`, in place, with all 7 columns still present and siblings still rendering rows; no white screen; no lost column; the console strip shows the ordinary job counts and no unhandled error. View: card in the reader naming `_fixture`, board and plugin column unaffected. The two `pageerror` events are React 18 dev-mode re-throws of the *caught* error — the boundary demonstrably contained rendering. Both reverted; screenshots at `/tmp/corpus-s012-eval-crash.png`, `/tmp/corpus-s012-eval-viewcrash.png`. |
| 94 | The boundary does not loop                | PASS   | Clicked "Try again": the component re-threw and the card stayed — terminal, no loop. Navigating away and back reset it (7 columns rendering), which is what the per-slot key makes true. |

### Plugin columns

| #  | Criterion                                | Result | Evidence                                                                                                                    |
| -- | ---------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 95 | Registered column types appear in the picker | PASS | Opened "＋ New list": the plugin entry sits alongside the three folder and five preset entries as `data-newlist="plugin:_fixture/sample"`, label `▣ Fixture notes`. Uses the **already-existing** `NewListSource = "plugin"` member; the union is not widened and `NewListPicker.tsx` is not redesigned. |
| 96 | Choosing one creates a pinned view document on disk | PASS | Clicked it → `data/docs/views/fixture-notes.md` on disk with `type: view`, `pinned: true`, `order: 13`, `query: {type: fixture-note}` merged from `defaultQuery`, and `column: _fixture/sample`. Verified by `cat` **and** `git -C <ws> log` (`user doc create: Fixture notes (doc_cuoxznmj) by user`) — not from the DOM. |
| 97 | An ordinary column in every respect       | PASS   | Ordered and rendered like the others; ⇧← reorder rewrote `order: 13 → 30` **in the file** (full renumber pass 10…70) with `doc edit` commits for the affected views; the new position survived a full page reload; the ⋯ menu offers the same Rename / Edit query / Unpin path folder and preset columns use. No plugin special case in ordering or persistence. |
| 98 | The plugin `Component` renders the column body with its props | PASS | The column's `.col-list` contains `<div class="fixture-column" data-fixture-column="doc_cuoxznmj">` with a head and a list of the two notes — the plugin's own markup, mounted with `ColumnComponentProps` (`viewDocId`, `title`), inside the kit's column affordances. |
| 99 | An unresolvable `column:` shows the missing card and keeps the column | PASS | I created **both** required cases: a view naming an unregistered plugin (`_nosuch/sample`) and one naming a registered plugin with a renamed type (`_fixture/renamed`). Both render `Plugin missing` in the column **body** — "This column renders _nosuch's sample view, which is not installed. Restore the plugin to bring the column back, or unpin this list — its view document is untouched either way." — while the header, ＋ and ⋯ remain, and both stayed reorderable/deletable. Frontmatter untouched: `column:` unchanged on both after all interactions. |

### Server discovery, context, SSE

| #  | Criterion                                | Result | Evidence                                                                                                                  |
| -- | ---------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| 100| Routers mount at `/api/x/<plugin>`, verified by curl | PASS | Boot: `plugin routes mounted … prefix:/api/x/_fixture`. `curl -H "Authorization: Bearer $TOK" http://127.0.0.1:9080/api/x/_fixture/notes` → `HTTP/1.1 200` `{"notes":[]}`, later listing real docs. Without a token → 401 (the `/api/*` guard covers `/api/x/*`). |
| 101| The prefix comes from the directory, not the plugin | PASS | I built `plugins/_evalshadow/` whose manifest declares `id: "totally-different-id"`. `/api/x/_evalshadow/ping` → `{"pong":"_evalshadow"}`; `/api/x/totally-different-id/ping` → **404**. A plugin cannot choose or escape its prefix. |
| 102| Discovery runs after core and cannot shadow it | PASS | My `_evalshadow` routes module registered `/api/docs`. `GET /api/docs` still returns the **core** document list; the plugin's copy is reachable only at `/api/x/_evalshadow/api/docs` (`{"hijacked":true}`). Call site quoted: `mountPluginRoutes(app, …)` at `app.ts:385`, after all nine core `mount*` calls (271–373). *Note*: it precedes `mountAttachmentRoutes` (396) and `mountStaticUi` (404); the latter is a catch-all, so mounting plugins before it is **required** for plugin routes to resolve at all. The criterion's intent — cannot shadow core routes — is met and proven. |
| 103| No `server/` directory is skipped silently | PASS   | I booted with `plugins/_evalquiet/` (manifest + types.yaml, no `server/`): `plugin discovered … routes:false, types:[]` and **zero** warnings in the whole boot log. Absence is normal. |
| 104| A throwing routes module does not prevent boot | PASS | My first `_evalshadow` exported a Hono instance instead of a factory: `warning: plugin _evalshadow — its server/routes module has no default-exported factory function`, the plugin skipped by name, the server booted and served every core route, and `/api/x/_evalshadow/*` 404'd like any unknown path. Server log quoted. |
| 105| Plugin routes get a context, never raw fs/db | PASS  | `plugins/_fixture/server/routes.ts` imports only `@corpus/contract` types, `hono`, `zod` and a local `shared.js` — **zero** `node:fs`, `better-sqlite3`, `simple-git` or `child_process` anywhere under `plugins/_fixture/` except `parity.test.ts` (a test reading its own `types.yaml`). The context exposes typed doc services and `broadcastInvalidate`. |
| 106| A plugin write goes through the core write path | PASS | `corpus _fixture add "Eval fixture note"` → file at `data/docs/inbox/eval-fixture-note.md`, commit `user doc create: Eval fixture note (doc_bve6bjpf) by user`; with `x-corpus-author: agent`, commit `agent doc create: … by agent`. Projection row visible via `GET /api/docs?type=fixture-note`. `corpus db rebuild && corpus db doctor` → `{"ok":true,"drift":[]}` over 14 documents. Architecture Decision 2 holds: the server is still the sole writer. |
| 107| `broadcastInvalidate` is namespaced and cannot touch core keys | PASS | I wrote `plugins/_evalinv/` with two routes. `[["mine"]]` reached the wire as `{"keys":[["x","_evalinv","mine"]]}` — auto-namespaced. `[["docs"]]` was **rejected**: `plugin _evalinv may not invalidate "docs" — plugin keys are namespaced x/_evalinv/…; core keys are broadcast by the core write path itself`, and **no frame was emitted**. The division the criterion asks to be stated is stated in the error message itself and in `docs/PLUGINS.md`; and it is observable — a plugin write still refreshes the board because the core write path emits `["docs"]`/`["tree"]` itself. |
| 108| Live update through the core SSE connection | PASS | Raw capture on `curl -N "http://127.0.0.1:9080/events?token=$TOK"` during `corpus _fixture add`: `event: invalidate` `data: {"keys":[["docs"],["docs","doc_bve6bjpf"],["tree"]]}` **then** `event: invalidate` `data: {"keys":[["x","_fixture","notes"]]}` — same core stream. **And in the browser**: with the plugin column open, an external `POST /api/x/_fixture/notes` took the column from 4 notes to 5 **without a reload**. |

### CLI discovery

| #  | Criterion                                   | Result | Evidence                                                                                                                 |
| -- | ------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 109| Plugin topics merge before validation        | PASS   | Proven by where the failure lands: with an invalid plugin command the throw comes from `validateRegistry (apps/cli/src/registry/validate.ts:59)` called at `apps/cli/src/registry/index.ts:37` — i.e. the plugin topic was already in `topics` when validation ran, at module load. The topic is named after the **directory** (`_fixture`), not the manifest id. |
| 110| Plugin verbs appear at all three help levels | PASS   | `corpus --help` → `_fixture  Commands contributed by the _fixture plugin.`; `corpus _fixture --help` → Usage, Verbs, Global flags; `corpus _fixture add --help` → summary, description, Usage, Arguments, Examples, and the full global-flag block. Indistinguishable in shape from a core verb. |
| 111| Registry validation applies to plugin commands | PASS | Emptied `examples` in the module the CLI actually loads: `RegistryValidationError: Invalid command registry:` / `  - corpus _fixture add has no examples`, thrown at module load, exit 1 — naming the plugin topic and the command. Restored → exit 0. A core command with the same defect fails identically, so plugin commands genuinely get the same enforcement. (My first attempt edited the `.ts` while the CLI loads the compiled `dist/` — evaluator error, recorded above.) |
| 112| A broken command file is skipped, not fatal  | PASS   | Dropped a syntactically invalid `broken.ts` into `plugins/_fixture/cli/commands/`: `warning: plugin _fixture: broken.ts failed to load — skipped (Transform failed with 1 error: … Expected ";" but found "is")`. `corpus --help` still rendered and `corpus health` still worked. Removed and re-verified. |
| 113| Plugin handlers are thin HTTP clients        | PASS   | `add.ts` imports `ACTOR_HEADER` from `@corpus/contract` and `zod`; performs its effect with `fetch(\`${context.workspace.baseUrl}/api/x/_fixture/notes\`)` carrying the bearer token and `context.actor`; emits through `context.out`. Zero `fs`/`git`/direct file touches. Running it against 9080 changed state on disk **and** in the open UI column. |
| 114| `docs/cli.md`'s story is decided and consistent | PASS | **Adjudication 9 implemented**: `grep -c "_fixture" docs/cli.md` → 0; `npm run docs:cli -w apps/cli` leaves `git status --porcelain docs/cli.md` empty; `check-generated-artifacts.ts` green **twice** with no manual edit. The docs-side filter lives in exactly one place (`apps/cli/src/docs/generate.ts:27`, `.filter(topic => !topic.name.startsWith("_"))`) with a comment saying so, and a unit test proves a non-underscore plugin's verbs *would* reach the generator. |

### Skills loading

| #  | Criterion                                    | Result | Evidence                                                                                                                 |
| -- | -------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 115| `corpus init` installs plugin skills          | PASS   | My own fresh init: `.claude/skills/` contains `comment`, `fixture-notes`, `orchestrate`. `cmp` says `fixture-notes/SKILL.md` is byte-identical to the plugin's copy, and `orchestrate`/`comment` are byte-identical to the template's. |
| 116| The three install-rule implementations still agree | PASS | `apps/cli/src/commands/init/template.test.ts` + `scaffold-plugins.test.ts` → 18 passed; `scripts/workspace-template.test.ts`'s 13-test install-contract suite green inside its 61. **Open Conflict 7 decided and stated** per Adjudication 11: plugin skills **are** recorded in `.corpus/template-manifest.json` with `source: "plugin:_fixture"`, while the 8 template entries keep the bare `{path, sha256}` shape. Verified in my own workspace. |
| 117| A collision cannot disable the loop           | PASS   | I built `plugins/_evalcollide/` shipping `skills/orchestrate/SKILL.md` (body `PLUGIN OVERRIDE OF THE LOOP.`) plus a benign second skill, then ran a fresh `corpus init`. Output: `warning: plugin _evalcollide ships a skill named "orchestrate", which collides with a workspace template skill — skipped; a plugin can never replace a core skill`. The installed `orchestrate` is byte-identical to the template's; `grep -c "PLUGIN OVERRIDE"` → 0; the benign skill installed normally (`installed 2 plugin skill files`). **Core wins, exactly as adjudicated.** |
| 118| PLUGINS-001 does not touch the orchestrate skill | PASS | `git diff --stat 93be4ac^ 93be4ac -- assets/workspace/` is **empty**. The `<plugin>.*` routing convention is AGENT-002's text, cited in the log as sprint-012 TEST-14 — which I verified independently in the AGENT-002 evaluation. Adjudication 1 held. |
| 119| The dev flow loads plugin skills, documented   | PASS   | Same mechanism (copy at `corpus init`); `docs/PLUGINS.md` §`skills/` documents the copy, the `source: "plugin:<name>"` manifest marker, the core-wins collision rule naming `orchestrate`/`comment`, and "The dev flow is the same mechanism: run `corpus init` from the repo." |

### types.yaml parity

| #  | Criterion                                    | Result | Evidence                                                                                                                 |
| -- | -------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 120| The non-TS mirror exists; server/CLI never import the manifest | PASS | `plugins/_fixture/types.yaml` is `types: [{type, label}]` with `seedTemplate?` in the schema, parsed with the `yaml` library; the server's boot log proves it reads it (`types:["fixture-note"]`). **No `import` of any manifest module exists in `apps/server/src` or `apps/cli/src`** — grep for import statements → zero. The literal "zero hits for `manifest.ts`" cannot hold, because **Adjudication 17** requires the server to detect *"manifest.ts present with types.yaml missing"*, which is an `existsSync` on that filename. The intent (never load UI code) is met; the amendment is the orchestrator's own. |
| 121| Parity enforced in both directions            | PASS   | **Both halves drilled by me.** Direction A (manifest type missing from YAML): `AssertionError: manifest declares "fixture-note" but types.yaml does not`. Direction B (YAML type missing from manifest): `AssertionError: types.yaml declares "ghost-type" but the manifest does not`. Reverted → 2 passed. Boot warning **narrowed per Adjudication 17** to what the server can honestly see, and I confirmed both narrow cases fire: missing `types.yaml` → `it has a manifest.ts but no types.yaml — the server cannot validate or route its doc types (SPEC.md §10)`; malformed → `its types.yaml is unreadable: Block collections are not allowed within flow collections at line 1, column 20`. |
| 122| A missing types.yaml is a warning, not a crash | PASS   | With `types.yaml` removed: server logged the warning, **booted normally**, mounted the plugin's routes (`routes:true`) with `types:[]`, the UI still rendered the plugin's doc types (the UI reads the manifest), and the parity test failed. The app did not break. |

### Lint boundaries

| #  | Criterion                                     | Result | Evidence                                                                                                                |
| -- | --------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| 123| The kit-only rule fires, proven programmatically | PASS | Both a real `npm run lint` (see TEST-126) and the programmatic suite `scripts/eslint-boundaries.test.ts` (5 tests, green, running ESLint over violating and compliant fixtures). Message names the allowed imports. |
| 124| `@corpus/contract` imports from a plugin are allowed | PASS | I added `import type { Actor } from "@corpus/contract"` to `plugins/_fixture/manifest.ts` and ran ESLint on it: **exit 0**. Expected and documented in `docs/PLUGINS.md` §"The kit-only rule (lint-enforced)", not merely tolerated. |
| 125| The core → plugin ban has allowlisted entry points | PASS | I added `import "../../../../plugins/_fixture/manifest"` to `apps/ui/src/board/newList.ts` (a non-allowlisted core file): `error  '…/plugins/_fixture/manifest' import is restricted … Core never imports from plugins/ — plugins are discovered, not imported (SPEC.md §10). The only entry points are the UI registry, the server discoverer, and the CLI scanner`. The three are allowlisted **by exact path** in `eslint.config.js` (`apps/ui/src/plugins/registry.ts`, `apps/server/src/plugins/discover.ts`, `apps/cli/src/registry/plugins.ts`) under a comment naming §10. |
| 126| §15 M6's lint check passes for real            | PASS   | Added `import "../../apps/ui/src/board/newList";` to `plugins/_fixture/manifest.ts` → `npm run lint` **exit 1** with `'../../apps/ui/src/board/newList' import is restricted from being used by a pattern. Plugins may import only @corpus/kit and @corpus/contract (SPEC.md §10) — never a workspace's internals by path  no-restricted-imports` / `✖ 1 problem`. Removed → **exit 0**. Both outputs above. |

### Deletion — the subtractive success condition

| #  | Criterion                                | Result | Evidence                                                                                                                    |
| -- | ---------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 127| Deleting the plugin leaves the core fully functional | PASS | `rm -rf plugins/_fixture` (backed up), everything restarted: `npm run build` **exit 0**; server booted with **no** plugin line; `corpus --help \| grep -c _fixture` → **0**; the board loaded in Chromium with all 7 columns. |
| 128| Its documents render, its column degrades, the board works | PASS | Fixture-note documents render through the **default** row (0 `[data-fixture-row]`, 2 ordinary rows) and open in the standard document view (`.reader`/`.doc-body`, no `data-fixture-view`, no panel) — see the TEST-87 note. The fixture column shows `Plugin missing` with header and ⋯ intact. Every other column rendered and scrolled. `GET /api/x/_fixture/notes` → **404**. **Zero** page errors and **zero** plugin warnings — absence is a normal state, not a warning. |
| 129| Restoring brings everything back, with no core change | PASS | Restored from the tarball and restarted: boot log shows discovery and mount again; the route returns real data; `corpus --help` lists the topic; `corpus _fixture add "Post-restore note"` succeeded; in the browser the ListItem (8 fixture rows), the `View`, the `DocPanel` and the plugin column body all returned, with 0 plugin warnings. **`git status --porcelain` is empty** — the diff between the two states is empty outside `plugins/`. |
| 130| No plugins at all is a supported state    | PASS   | With `plugins/` holding only `.gitkeep`: server boot log contains **zero** occurrences of "plugin" or "warning"; `corpus health` → `ok — corpus 0.0.0, up 2s`; the UI registry is `EMPTY_REGISTRY` (unit-asserted) and the board rendered. The app behaves as if the plugin system did not exist. |

### Fixture hygiene, docs, and the deferred question

| #  | Criterion                                | Result | Evidence                                                                                                                    |
| -- | ---------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 131| The fixture is test-only and the exclusion is ENFORCED | PASS | `grep -c "_fixture\|fixture-note" apps/ui/dist/assets/index-*.js` → **0** in the bundle I built myself. Enforcement is implemented in exactly one named place per surface: the glob composition in `apps/ui/src/plugins/registry.ts` (`"!…/plugins/_*/manifest.ts"` plus a dev-only glob behind `import.meta.env.DEV`, so Rollup emits no chunk), `excludedInProduction` in `apps/cli/src/registry/plugins.ts:32`, `excludedInProduction` in `apps/server/src/plugins/discover.ts:95`, and the underscore filter in `apps/cli/src/docs/generate.ts:27` (docs filtered in every environment). INFRA-008 inherits a clean surface. |
| 132| The fixture's layout satisfies the coverage gate's globs | PASS | **Adjudication 10 implemented as ruled**: `COVERAGE_INCLUDE = ["apps/*/src/**", "packages/*/src/**", "plugins/*/**"]` with `"plugins/_*/**"` in the exclude list, documented in the config's docblock. §10's root-level layout stands. The merged gate itself is the orchestrator's harvest run, already green at 97.19/97.19/94.81/93.06. |
| 133| The discovery root is pinned              | PASS   | Both halves verified against a real workspace. `corpus init` created **no** `plugins/` directory in the workspace. I then placed a complete, valid plugin at `<workspace>/plugins/_wslocal/` and restarted the server: **not discovered** (zero log lines), `/api/x/_wslocal/ping` → **404**. Discovery resolves against the tool's install directory, per Adjudication 12(i). |
| 134| `docs/PLUGINS.md` is the author's guide   | PASS   | Sections: Directory layout · The kit-only rule (lint-enforced) · manifest.ts · types.yaml — the non-TS mirror · server/routes.ts · cli/commands/ · skills/ · Testing and coverage. Covers the manifest contract, the kit-only rule, `types.yaml` and its parity check, the underscore convention, the `/api/x/` prefix rule, and the `x/<name>/…` invalidation namespace ("prefixes every key with `x/<name>/` and rejects…"). |
| 135| The scoped-template-keys question is filed, not answered | PASS | Quoted **verbatim** in the log as an open question for user sign-off, framed against the SERVER-005 template-bleed fix and the §11-vs-§9.2 tension. **No mechanism was built**: `seedTemplate` is documented as supplying a **BODY only** (`docs/PLUGINS.md:87`, "optional, a BODY-only template (§9.2)") and appears only in the YAML schema and the parity test — no code path moves template frontmatter onto instances. Adjudication 3 held in both directions. |

---

## Failures

None.

## Observations for the orchestrator (not failures)

1. **TEST-87's premise needs correcting for the record.** The contract asserts that sprint-011
   adjudication 7 makes the editor own the document body *always*. It does not: `editorHandlesType`
   has gated on `CORE_DOC_TYPES` since Phase 3, so a plugin-owned type — with or without its plugin
   installed — renders through `MarkdownView` at the single body call site, not through `DocEditor`.
   PLUGINS-001 introduced no second renderer and changed nothing in `apps/ui/src/editor/`, so the
   substantive criterion holds; but if the intent really is "the editor owns every document body",
   that is a **separate UI issue**, not something this sprint failed to do.
2. **TEST-120's literal grep is unsatisfiable under Adjudication 17.** Requiring the server to warn
   when `manifest.ts` exists without `types.yaml` necessarily means the server names that filename.
   The substantive rule (never *import* the manifest) holds. Worth wording the criterion as
   "never imports" in future contracts.
3. **TEST-79's "zero hits" is two doc comments off.** Immaterial — no code path enumerates a plugin
   name, which I proved by adding six throwaway plugins with zero core edits.
4. **`mountPluginRoutes` is not literally last** in `app.ts` (it precedes `mountAttachmentRoutes`
   and `mountStaticUi`). It *cannot* be last: `mountStaticUi` is a catch-all that would swallow
   `/api/x/*`. The anti-shadowing intent is met and proven live.
5. **The second open design question is worth scheduling** before PLUGINS-002: plugin server
   contexts and CLI command specs are currently typed *structurally* because `PluginServerContext`
   lives in `apps/server` and `CommandSpec` in `apps/cli`, neither importable under the kit-only
   rule. The fixture works, but the todos plugin will harden against whatever is decided.

## Summary

**61 of 61 criteria PASS. No FAILs, no strikes, no deferrals.**

The subtractive success condition — the one the contract calls the whole point — holds completely:
I deleted `plugins/_fixture`, rebuilt, restarted server and dev server, and found a working build, a
silent boot, a `corpus --help` with no plugin topic, a board with every column rendering, documents
of the previously-plugin-owned type falling back to the standard document view, a "Plugin missing"
card that keeps its column's header and controls, a 404 on `/api/x/_fixture/*`, and zero page
errors. Restoring brought all six surfaces back with `git status` clean.

Discovery is genuinely convention, not configuration. I proved it by writing six throwaway plugins
of my own — a route-shadowing one, an invalidation one, a silent one, a crashing one, a
type-stealing one, and a loop-hijacking one — and in every case the only tree change was under
`plugins/`. Along the way three behaviours the log had only unit-verified turned out to hold end to
end: a plugin cannot invalidate a core key, a plugin cannot shadow `/api/docs`, and a plugin cannot
replace the `orchestrate` skill.

The two hardest UI criteria were verified in a real browser rather than asserted: per-slot error
boundaries (I crashed the column and the view separately and watched the other two slots keep
rendering) and per-module manifest containment (a module-scope throw skipped one plugin, loaded the
rest, surfaced a named warning in the console strip and in `console.error`, and produced zero page
errors) — which is also the observation that justifies Adjudication 16's lazy glob.

The four disclosed deviations are all covered by post-implementation adjudications and all
implemented as ruled. The only inaccuracies I found anywhere were two stray doc comments and one
criterion the contract itself made unsatisfiable.
