# Evaluation: PLUGINS-002 (Todos reference plugin)

**Date**: 2026-07-29
**Sprint**: sprint-014, tests TEST-234–TEST-290 (+ cross-issue TEST-293)
**Commit under test**: `787bf36 [PLUGINS-002] Todos reference plugin + packaged-plugin rider fixes`
**Verdict**: **PASS** — 55 of 57 criteria PASS or EVIDENCE-ACCEPTED, 2 correctly STRUCK, **0 FAIL**.

> **Revision (2026-07-29, round 2).** This eval first returned **PARTIAL** on two counts. Both are now closed:
> FAIL-1 (missing `implemented on:` line) was fixed by the orchestrator in the issue file; FAIL-2 (TEST-278
> unproven) was **resolved by the evaluator driving the live cross-runtime run itself** — see
> "§E revisited: TEST-278" below. No behavioral defect was found in the plugin at any point.

---

## E2E Proof-of-Work Audit

| Check                                   | Result   | Notes                                                                                                                                                                          |
| --------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS     | `issues/plugins/002-todos-plugin.md`, §A–§G plus "Deferred / struck", "Escalations", "Coverage posture", "Cleanup".                                                              |
| Commands are specific and concrete      | PASS     | Real ids (`doc_jcurwn37`), real boot-log JSON, `ApiError` bodies quoted verbatim, real tarball layout, a real commit sha (`a469f61`).                                            |
| Real E2E (not mocked)                   | PASS     | Real server on `9142`, real Vite UI on `5285` with a driven Chromium (not the Playwright runner), real `npm pack` + install into a scratch prefix, real installed binary.        |
| Scenarios cover acceptance criteria     | **FAIL** | TEST-278 — "the agent manages todos from a thread" — has **no evidence of any kind**. See FAIL-2.                                                                                |
| Application restarted after changes     | PASS     | TEST-239's dist-first drill is built on restart-after-change; the M6 drill restarts server and UI twice.                                                                          |
| Actual model recorded (implemented on:) | **FAIL** | No `implemented on:` line anywhere in the issue file. See FAIL-1.                                                                                                                |
| Reproduction logged before fix (bugs)   | PASS     | Both INFRA riders are bug fixes and both carry pre-fix reproductions with the failing output quoted (`BEFORE the fix (source-only enumeration): {}`, `ERR_MODULE_NOT_FOUND: Cannot find package '@corpus/contract'`). |

**Log-shape note:** the log reports narratively per group rather than one row per numbered test. Most tests
are demonstrably covered by the narrative; TEST-278 is the one that is not, and it is a real gap rather than a
formatting quibble.

---

## Evaluator environment

Fresh workspace created with an **explicit** path (never cwd-derived, per the log's own escalation 1):

```
node --import tsx apps/cli/src/bin/corpus.ts init /tmp/corpus-s014-eval3-ws --port 9182
node --import tsx apps/cli/src/bin/corpus.ts server start --workspace /tmp/corpus-s014-eval3-ws
```

Servers on `9182` (from-source) and `9184` (installed tool), both inside the evaluator's allocated range.
UI read through the **server-served build**, plus one short-lived Vite dev instance on `5287`. Browser:
headless Chromium driven through `playwright-core` directly; **`npm run e2e` never invoked**. `8765` stayed
unbound throughout and was re-verified free at the end.

---

## Criteria Results

### A. Manifest, types, discovery, boot (TEST-234–TEST-239)

| #        | Result | Evidence (evaluator-derived)                                                                                                                                                                                                                             |
| -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TEST-234 | PASS   | Every declared piece is observable: a `todo` docType with a custom `View` (checkbox rows), a `ListItem` (todo rows in columns), a `DocPanel` ("2 OPEN 1 DONE plugin: todos"), `validate`, and a `todos` column type offered by the picker as `☑ Todos todos/todos`. |
| TEST-235 | PASS   | Boot log `{"msg":"plugin discovered","plugin":"todos","routes":true,"types":["todo"]}` — the server's declared type set agrees with the single `todo` docType the UI renders.                                                                              |
| TEST-236 | PASS   | **Both directions now proven.** In the **from-source/dev** run both plugins are discovered and mounted (`_fixture` and `todos`) — expected, since the contract scopes the exclusion to production mode. In the **packaged/production** run (§G) the tarball contains `_fixture` entries: **0**, and `corpus init` from the installed binary reported "installed **1** plugin skill file" (todos only) versus "**2**" from source. The filter discriminates, and `todos` is not caught by it. |
| TEST-237 | PASS   | The Todos column appeared in a fresh workspace's picker with no core file naming it — `import.meta.glob` discovery alone.                                                                                                                                  |
| TEST-238 | PASS   | Boot log `{"msg":"plugin routes mounted","plugin":"todos","prefix":"/api/x/todos"}`. `GET /api/x/todos/lists` without a bearer token → **401**; with it → a real payload. Same guard as any `/api/*` route.                                                 |
| TEST-239 | EVIDENCE-ACCEPTED | The dist-first drill is recorded with the exact discriminating string (`item index "two" is not a number`). Re-running it means mutating tracked source, which this evaluator will not do. Strongly corroborated by §G: the **installed** tool ships `dist/` only — no `.ts` anywhere under `plugins/todos/` — and mounts successfully. |

### B. Routes and the items module (TEST-240–TEST-248)

| #        | Result | Evidence (evaluator-derived)                                                                                                                                                                                                              |
| -------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-240 | EVIDENCE-ACCEPTED | Structural ownership is a source-layout claim; this evaluator does not read implementation source. Corroborated behaviorally: the CLI cannot function with the server down, and every write appears as a server-authored commit. |
| TEST-241 | PASS   | `corpus todos add "Week of Jul 29" "renew passport" --from agent` → on disk `- text: renew passport / done: false / ts: 2026-07-29T15:11:38.806Z`. **201**-equivalent success, ISO-8601 creation time, projection updated immediately.       |
| TEST-242 | PASS   | After checking the item and re-issuing `corpus todos check`, `ts` is **byte-identical**: `2026-07-29T15:11:38.806Z` before and after. `done` changed; `ts` never moved.                                                                     |
| TEST-243 | PASS   | `PUT /api/x/todos/doc_rwmjbcvg/items/0 {"expectedText":"something else"}` → **409** `{"code":"conflict","message":"item 0 is now “milk”, not “something else” — it changed under you; nothing was written"}`. Nothing written.               |
| TEST-244 | PASS   | `PUT …/items/99` → **400** `{"code":"bad_request","message":"item index 99 is out of range — this list has 2 items"}`. `POST /api/x/todos/doc_nope/items` → **404** `{"code":"not_found","message":"no document with id doc_nope"}`.        |
| TEST-245 | EVIDENCE-ACCEPTED | Delete-one is exercised in the UI (each row carries `×`) and recorded with the surviving items verbatim.                                                                                                                                    |
| TEST-246 | PASS   | Every write produced a git auto-commit **with the right author**: `agent \| doc edit: Week of Jul 29 (doc_ayktvepg) by agent` for `--from agent`, `user \| doc edit: Shopping (doc_rwmjbcvg) by user` otherwise. Actor propagation through `PluginServerContext` proven end to end. |
| TEST-247 | EVIDENCE-ACCEPTED | The captured frames (`["docs"]` from core, `["x","todos","lists"]` from the plugin) are quoted verbatim; the live UI's refresh-without-reload is the same mechanism seen from the other end. The core-key refusal is the context's behaviour, which the plugin never attempts. |
| TEST-248 | EVIDENCE-ACCEPTED | Corroborated by §F, where the same documents survive the plugin's absence without a crash.                                                                                                                                                  |

### C. UI — View, ListItem, DocPanel, Column (TEST-249–TEST-264)

Live headless browser. **Zero page errors in every pass**, including both M6 states.

| #        | Result | Evidence (evaluator-derived)                                                                                                                                                                                                   |
| -------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-249 | PASS   | Opening `doc_rwmjbcvg` renders the plugin View: **13** `.check` elements, rows reading `☑ × / ☐ × / ☐ ×`, plus an inline **Add** affordance. Done items visually distinguished.                                                 |
| TEST-250 | EVIDENCE-ACCEPTED | Optimistic flip is recorded (open count `1 → 0` without reload). The persistence half is re-derived: CLI-driven checks land on disk and in git, and the open column updated live.                                               |
| TEST-251 | EVIDENCE-ACCEPTED | The 409 path is correct at the API (TEST-243, re-derived); the toast is taken from the log.                                                                                                                                     |
| TEST-252 | EVIDENCE-ACCEPTED | Corroborated by §F: without the plugin the same documents render through the core path with no crash and no DocPanel.                                                                                                           |
| TEST-253 | EVIDENCE-ACCEPTED | Recorded: `POST …/items` on a locked document → `423 {"code":"locked",…}` — the routes honour the core lock rather than bypassing it.                                                                                            |
| TEST-254 | PASS   | `corpus doc create --type todo` wrote a document with **no `items` key**; the View rendered it as an empty list with the add affordance, `corpus todos list` reported `0 open · 0 done`, and it did **not** appear in the Todos column until an item existed. Adjudication 17 working as ruled. |
| TEST-255 | PASS   | Column rows show title + item preview: `SHOPPING | 2 | ☐ bread | ☐ milk`.                                                                                                                                                       |
| TEST-256 | EVIDENCE-ACCEPTED | Overdue treatment and the `1 due` badge are recorded; no past-due item was seeded in the evaluator's workspace.                                                                                                                 |
| TEST-257 | PASS   | DocPanel reads `2 | OPEN | 1 | DONE | plugin: todos` — **arithmetically correct** for Shopping's three items (milk ☑, bread ☐, milk#2 ☐), rendered above the document in the column reader, and it changed in step with the list. |
| TEST-258 | PASS   | The column shows **only open** items grouped by source document; "Week of Jul 29", whose only item was checked off, is correctly **absent**. Clicking `SHOPPING` opened its source document.                                     |
| TEST-259 | EVIDENCE-ACCEPTED | Archived exclusion follows core's default filtering; not separately re-driven.                                                                                                                                                  |
| TEST-260 | EVIDENCE-ACCEPTED | Single-query claim rests on `useDocs({type:"todo"})` + `row.extra`; corroborated by the column rendering item text with no per-document fetch visible.                                                                          |
| TEST-261 | EVIDENCE-ACCEPTED | Import-boundary claim, enforced by the shipped lint rule.                                                                                                                                                                       |
| TEST-262 | EVIDENCE-ACCEPTED | The deliberate-violation drill is recorded with the rule's exact message and "**No config edit was needed**". Re-running it means editing tracked source.                                                                        |
| TEST-263 | EVIDENCE-ACCEPTED | The deliberate-throw drill is recorded (`Plugin error — todos` in that column only, board unaffected, reverted and recovered).                                                                                                   |
| TEST-264 | PASS   | The picker offered `☑ Todos todos/todos`; choosing it wrote `data/docs/views/todos.md` with `type: view`, `pinned: true`, `order: 13`, `query: {type: todo}` and **`column: todos/todos`**, with a toast "Pinned — a view document was created for “Todos”". |

### D. CLI verbs (TEST-265–TEST-273)

| #        | Result | Evidence (evaluator-derived)                                                                                                                                                                          |
| -------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-265 | PASS   | `corpus --help` → `todos    Commands contributed by the todos plugin.`; `corpus todos --help` lists **add / check / list** with summaries; each verb also has its own `--help`.                          |
| TEST-266 | PASS   | All three names kebab-case, each with a non-empty summary; the topic's flag list contains only globals (`--from`, `--json`, `--workspace`, `--timeout`, `--verbose`, `--no-color`, `-h`) — **no plugin flag shadows a global, notably not `--from`**. `validateRegistry` runs at module load and the CLI started clean in both the from-source and installed builds. |
| TEST-267 | PASS   | `corpus todos add "Shopping" "milk"` → `added item 1 to Shopping [doc_rwmjbcvg] — milk`; on disk; `git log` attributes it. With `--from agent`, the commit author is `agent`. The open browser tab's column reflected additions **without a reload**. |
| TEST-268 | PASS   | By index: `corpus todos check "Shopping" 1` → `checked item 1 … — milk`. By text: `corpus todos check "Week" "renew passport" --from agent` → `checked item 1 of Week of Jul 29 … — renew passport`. Case-insensitive (`"Week"` matched "Week of Jul 29"). |
| TEST-269 | PASS   | With two items reading "milk": `corpus: “milk” matches 2 items (1, 3) — pass the number instead`, **exit 1**, nothing written — candidate indices listed exactly as required.                            |
| TEST-270 | PASS   | Human mode prints a table; `corpus todos list --json \| jq -e '.lists \| length'` → `2`, proving **exactly one** JSON value on stdout.                                                                   |
| TEST-271 | PASS   | Every verb above was given a **title or a fragment**, never an id, and all resolved through the core docs API. Unresolvable/ambiguous names error clearly.                                               |
| TEST-272 | EVIDENCE-ACCEPTED | Thin-client structure is a source claim; corroborated by the verbs failing without a server and every write appearing as a server-authored commit.                                                       |
| TEST-273 | PASS   | `docs/cli.md` on the merged tree documents `## corpus todos` with `### corpus todos add`, `### corpus todos check`, `### corpus todos list` and TOC entries (19 `corpus todos` mentions). `_fixture` appears **0** times. The in-worktree drift-check red output was correctly recorded as DEFERRED → harvest; on this merged tree it is moot. |

### E. Skill, template, threads (TEST-274–TEST-280)

| #        | Result   | Evidence (evaluator-derived)                                                                                                                                                                                     |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-274 | PASS     | `plugins/todos/skills/todos/SKILL.md` read in full: CLI-only ("Every write goes through the `corpus` CLI. Never edit a todo document's file, and never hand-write its `items` frontmatter"), covers creating a list when none exists (`corpus doc create --type todo …`), adding from a thread request, checking off, and reporting back with a `[[id]]` and a trace line. Short and behavioral. Bonus: "Do not delete… Archive is the agent's only removal", "an invented deadline is a fact you were not given". |
| TEST-275 | PASS     | Fresh `corpus init` → `<ws>/.claude/skills/todos/SKILL.md` exists and `.corpus/template-manifest.json` records `{"path": ".claude/skills/todos/SKILL.md", "source": "plugin:todos"}`.                              |
| TEST-276 | EVIDENCE-ACCEPTED | The collision half is pinned by the shipped `scaffold-plugins.test.ts`; the non-colliding half is re-derived — `todos` installed alongside `comment` and `orchestrate` without displacing either.                 |
| TEST-277 | PASS     | `grep -i '\btodos\b'` over `comment/SKILL.md` → **0 hits** (independently confirmed during the AGENT-003 evaluation), and `787bf36` touches neither core skill. Routing rides the generic `<plugin>.<action>` → `.claude/skills/<plugin>/` convention. |
| TEST-278 | **PASS — driven live by the evaluator** | See "§E revisited" below. The log had no evidence; the evaluator ran the missing scenario end to end and it works.                                                     |
| TEST-279 | PASS     | `plugins/todos/seeds/todo-template.md` parses as a valid `type: template` document with `for: todo`, full Corpus frontmatter, and a useful **body only** (`## What this list is for`, `## Notes`) — **no `items` key**, exactly as Adjudication 17 rules. |
| TEST-280 | PASS     | `corpus doc create --type todo --title "Shopping" --folder lists` → `created doc_rwmjbcvg — data/docs/lists/shopping.md`, `type: todo`, no `items` key, View rendered it without error.                            |

**Struck criteria, correctly cited:**

- **Item-level anchored commenting — STRUCK → Adjudication 16.** Substitute evidence (document-level
  commenting on a todo document, end to end) is supplied in the log's §E. PLUGINS-003 is filed. Correct.
- **Seeding `items: []` — STRUCK → Adjudication 17.** No scoped-template-key mechanism was built, and the
  open question (sprint-012 Adjudication 3) is re-filed verbatim rather than dropped. Correct, and the
  absent-≡-empty behaviour is independently verified above (TEST-254, TEST-280).

### §E revisited: TEST-278 / TEST-293 — the live cross-runtime run (evaluator-driven)

The log's gap was closed by running the scenario, not by accepting it. Setup, all explicit-path:

```
corpus init /tmp/corpus-s014-eval4-ws --port 9183      # → "installed 2 plugin skill files into .claude/skills/"
corpus server start --workspace /tmp/corpus-s014-eval4-ws
POST /api/threads {"body":"@agent add \"buy milk\" to my todos, please.","requestsAgent":true}
  → 201 {"thread":{"id":"th_ayqcq6xx","agent":"requested",…},"eventId":"evt_d6v4hmh75dul"}
```

The todos skill was verified installed before the run: `.claude/skills/todos/SKILL.md` present, and
`.corpus/template-manifest.json` records it as
`{"path": ".claude/skills/todos/SKILL.md", "sha256": "cf67404b…", "source": "plugin:todos"}`.

Then a **real `claude` session** in the workspace driving `/orchestrate`, with
`--output-format stream-json --verbose --allowedTools "Bash(corpus *)" Read Glob Grep Skill Task TodoWrite`,
transcript retained at `/tmp/corpus-s014-eval4/transcript.stream.json` (101 stream events).

**What the loop did, from the transcript:**

1. `export CORPUS_FROM=agent && corpus queue reap-stale && corpus queue claim-all`
2. `corpus job log evt_d6v4hmh75dul "claimed comment.created on th_ayqcq6xx" && … "routed to the comment skill" && corpus thread show th_ayqcq6xx`
3. **Skill call 1 → `comment`**, args: *"Handle comment.created event evt_d6v4hmh75dul on standalone thread th_ayqcq6xx. The user asks: add \"buy milk\" to my todos. Thread has no parent document. Note: the todos skill is installed and handles todo-domain requests."*
4. **Skill call 2 → `todos`**, args: *"Thread th_ayqcq6xx (standalone, no parent doc) asks: add \"buy milk\" to my todos. … Add the item to the appropriate todo document (create one if none exists), then reply on th_ayqcq6xx per the comment skill's reply rules."*
   — this is **exactly** the AGENT-003 plugin-boundary rule composing with the todos skill: the comment skill
   did not touch `type: todo` documents itself, it delegated.
5. `corpus todos list` (found none) → `ls …/data/docs/` (the sanctioned folder survey)
6. **`corpus doc create --type todo --title "Todos" --from agent && corpus todos add "Todos" "buy milk" --from agent`**
   — the item was added **through the plugin's CLI verb**, not by hand-writing frontmatter.
7. `corpus doc move doc_b5jkt4x2 --folder todos --from agent && corpus doc edit th_ayqcq6xx --title "Add buy milk to todos" --from agent`
8. `corpus job log … && corpus thread reply th_ayqcq6xx --from agent <<'EOF' … EOF`
9. `corpus job log … "completed — replied on th_ayqcq6xx" && corpus queue complete evt_d6v4hmh75dul`

**Observed results, all re-derived:**

| Claim | Observed |
| --- | --- |
| The todo lands in a `type: todo` document | `data/docs/todos/todos.md` → `id: doc_b5jkt4x2`, `type: todo`, `items:` → `- text: buy milk / done: false / ts: 2026-07-29T15:25:52.083Z` |
| Agent-authored commit | `e5c79a7 agent | doc move: data/docs/inbox/todos.md → data/docs/todos/todos.md (doc_b5jkt4x2) by agent`, introducing the file with its items (17 insertions); `7bea721 agent | comment: turn on th_ayqcq6xx by agent` |
| Reply in the thread | `## agent · 2026-07-29T15:26:08Z` — *"Done — added \"buy milk\" to your new [[doc_b5jkt4x2]] list. You didn't have a todo list yet, so I created one (\"Todos\", in `todos/`); it has 1 open item."* |
| …closing with a trace line | Final line is `↳ created [[doc_b5jkt4x2]] in todos/ and added "buy milk"` — **AGENT-004's grammar, produced live by the loop in a fresh workspace** |
| Thread retitled by the agent | `title: 'Add buy milk to todos'` (was the raw first turn) |
| Engagement flipped by the server | `agent: engaged` |
| Event reached terminal state | `.corpus/queue/processed/evt_d6v4hmh75dul.json`; `corpus queue status` → `pending 0, in-progress 0, processed 1, failed 0, abandoned 0` |
| Job log | `claimed comment.created on th_ayqcq6xx` → `routed to the comment skill` → `created [[doc_b5jkt4x2]] (Todos) in todos/ and added item: buy milk` → `completed — replied on th_ayqcq6xx` |
| No hand-edits to workspace data | Transcript tool counts `Bash 13, Skill 2, Read 1, Edit 1`. The single `Edit` targets **`/tmp/corpus-s014-eval4/bin/corpus`** — the evaluator's own `PATH` wrapper, outside the workspace. **Zero** writes under `data/`, `.corpus/` or `.claude/`. |
| No raw HTTP, no git state changes | `grep -E 'curl\|wget\|127.0.0.1\|git (commit\|push\|checkout\|reset\|add\|config)'` over all 13 Bash commands → **NONE** |

**TEST-278: PASS. TEST-293: PASS** — the comment skill's plugin-boundary rule routed into the todos skill,
which used only `corpus todos` and core `corpus doc` verbs, and neither skill named the other's internals.

**Two honest observations from this run (neither a defect in PLUGINS-002):**

1. **Git auto-commits coalesce across rapid successive writes.** `doc create` + `todos add`, chained with
   `&&` in one shell line, produced no individual commits — both were swept into the subsequent `doc move`
   commit (which shows the file arriving with all 17 lines, items included). Likewise the thread's title edit
   folded into the reply commit. Nothing is lost and authorship is correct (`agent`) on every commit; this is
   debounce behaviour, and it is why the evaluator's own earlier §B runs — spaced-apart CLI invocations —
   *did* yield one commit per write. Recorded so nobody later reads it as a missing commit.
2. **Evaluator-harness bug, not a product bug.** The `corpus` wrapper this evaluator put on `PATH` used
   `node --import tsx`, which resolves `tsx` relative to the *current directory*; run from the scratch
   workspace it failed with `ERR_MODULE_NOT_FOUND: tsx`. The session diagnosed this itself and repaired the
   wrapper (the one `Edit`) before proceeding. The sprint contract's wrapper recipe has the same latent
   issue — worth pinning the loader path absolutely in future contracts.

### F. §15 M6 — the subtractive check (TEST-281–TEST-283) — **drilled by this evaluator**

Drill: `mv plugins/todos /tmp/corpus-s014-eval3-todos-backup`, rebuild the UI, restart the server; then
restore, rebuild, restart.

| #        | Result | Evidence (evaluator-derived)                                                                                                                                                                                                                    |
| -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-281 | PASS   | **App boots** — board renders, **zero page errors**. **Todo documents render as plain markdown** — opening `doc_rwmjbcvg` through the omnibox shows `todo | lists/ | open | updated 2026-07-29 | edit` with **0** `.check` rows and **0** DocPanels; **data intact**: `sha256(shopping.md)` = `d7b49514…c69ab4`, byte-identical to the pre-removal baseline. **Todos column shows a "plugin missing" card**: *"Plugin missing — This column renders todos's todos view, which is not installed. Restore the plugin to bring the column back, or unpin this list — its view document is untouched either way."* while all three core columns keep working. **`/api/x/todos/*` 404s**: `{"code":"not_found","message":"no route matches GET /api/x/todos/lists"}` `[404]`. **`corpus todos` is gone**: `corpus: unknown command "todos". Valid: health, init, workspace, server, doc, thread, skill, queue, lock, job, db, _fixture.` and `corpus --help` mentions `todos` **0** times. |
| TEST-282 | PASS   | After restoring: boot log `{"msg":"plugin routes mounted","plugin":"todos","prefix":"/api/x/todos"}`; `corpus --help` lists `todos` again; the **column returns** (`[data-todos-column]` count **1**, `SHOPPING | 2 | ☐ bread | ☐ milk`, "Plugin missing" gone); the **custom renderer returns** (5 `.check` rows); the **DocPanel returns** (`2 | OPEN | 1 | DONE | plugin: todos`). `sha256(shopping.md)` **unchanged** across the whole drill, and `git status --porcelain plugins/` is **clean** — the directory was restored byte-identical. |
| TEST-283 | PASS   | `corpus db rebuild` → `rebuilt the projection in 6ms — 11 documents, …`; `corpus db doctor` → **`projection is clean — 11 documents from 11 files (1ms)`**.                                                                                       |

### G. INFRA riders — the packaged tool (TEST-284–TEST-290) — **drilled by this evaluator**

`npm run package:build` → `npm pack` → install into a **pathless temp prefix** (`/tmp/corpus-s014-eval3-prefix`).

| #        | Result | Evidence (evaluator-derived)                                                                                                                                                                                                                    |
| -------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-284 | PASS   | Pre-fix reproduction recorded verbatim against the real installed prefix: `BEFORE the fix (source-only enumeration): {}` / `AFTER the fix (dist-first enumeration): {"todos":["add.js","check.js","list.js"]}`. The premise is independently confirmed: the tarball contains **only** `dist/cli/commands/{add,check,list}.js` — **no `.ts` sources at all** — so a source-only enumerator would necessarily yield nothing. |
| TEST-285 | PASS (by effect) | The installed, dist-only layout discovers all three verbs (TEST-286), which is only possible with dist-first enumeration. Shipping `.ts` as a name list demonstrably was **not** the fix — no `.ts` is in the tarball.                             |
| TEST-286 | PASS   | From the install prefix: `corpus --help` → `todos    Commands contributed by the todos plugin.`; `corpus todos --help` → **add / check / list**. `corpus todos list` succeeds against a workspace created by the installed binary (`{"lists":[]}` → then populated). |
| TEST-287 | PASS   | Pre-fix reproduction recorded with the exact error: `ERR_MODULE_NOT_FOUND: Cannot find package '@corpus/contract' imported from …/plugins/todos-legacy/dist/server/routes.js`, contrasted against `AFTER the fix (staged bundle): mounted`.        |
| TEST-288 | PASS   | Independently verified on the packed tarball: `package/plugins/todos/dist/server/routes.js` and `package/plugins/todos/dist/cli/commands/add.js` each contain **0** bare `@corpus/*` import specifiers.                                            |
| TEST-289 | PASS   | **The live proof INFRA-008 deferred.** Installed binary: `corpus init /tmp/corpus-s014-eval3-installed-ws --port 9184` → boot log `plugin routes mounted … /api/x/todos`; `GET /api/x/todos/lists` → **200** `{"lists":[]}`; `corpus todos add "Packaged list" "shipped through the tarball" --from agent` → `added item 1 …`, the item on disk, and `git log` → **`agent | doc edit: Packaged list (doc_raimcdqx) by agent`**. |
| TEST-290 | PASS   | Tarball contains `plugins/todos/dist/{server/routes.js,cli/commands/{add,check,list}.js}` plus `README.md`, `types.yaml`, `seeds/todo-template.md`, `skills/todos/SKILL.md`. `_fixture` entries: **0**. And `corpus init` from the installed binary installed **1** plugin skill (todos) versus **2** from source — both directions of Adjudication 9/12 now have a real subject. |

---

## Failures

**Both round-1 failures are now closed. Retained below for the record.**

### FAIL-1 — RESOLVED: No `implemented on:` line in the issue file

**Criterion**: CLAUDE.md's Record-actuals rule and sprint-014's closing paragraph ("Each implementing agent
also states which model it ran on in the E2E log (`implemented on: opus | fable`)") — the same requirement
TEST-215 makes explicit for AGENT-003.
**Expected**: a literal `implemented on: opus` (or `fable`) line in `issues/plugins/002-todos-plugin.md`.
**Observed**: absent.
**Steps to reproduce**:

1. `grep -in "implemented on" issues/plugins/002-todos-plugin.md` → no match.
2. Compare `issues/agent/003-comment-skill.md:154` and `issues/agent-runtime/004-emit-trace-lines.md:47`, which both match.

**Impact**: bookkeeping only, no behavior is wrong — but it is the audit trail the Model Policy recalibrates
from, and the contract names it as a required log element. One line fixes it.

**Resolution (2026-07-29):** the orchestrator added the line to `issues/plugins/002-todos-plugin.md`, sourced
from the spawn record and attributed as such. Closed.

### FAIL-2 — RESOLVED: TEST-278 (the agent manages todos from a thread) had no evidence

**Criterion**: TEST-278 — "Given a running loop and an `@agent` comment 'add a todo to follow up on X', the
comment skill routes into the todos skill, the agent creates or updates a todo document **through
`corpus todos`**, and replies in the thread saying so." Also cross-issue TEST-293.
**Expected**: a live-loop trace — job-log lines showing the route into the todos skill, a `corpus todos …`
invocation made by the loop, the resulting item on disk, and the thread reply.
**Observed**: §E contains **no live-loop run at all**. Its "Commenting (Adjudication 16 substitute)"
paragraph exercises *document-level commenting on a todo document* by hand (`corpus thread reply --from agent`,
engagement flip, resolve). That is the substitute evidence for the **struck item-level anchoring** criterion,
not for TEST-278. The two are different tests: one asks "can a todo document carry a thread", the other asks
"does the comment skill route a todos request into the todos skill and use `corpus todos`". The composition
that PLUGINS-002 was deliberately staged after AGENT-003 to prove (contract: "its plugin-boundary rule is a
real dependency for TEST-278/TEST-293") is therefore unproven.
**Steps to reproduce**:

1. `grep -n "TEST-278\|TEST-293" issues/plugins/002-todos-plugin.md` → no match.
2. Read §E: no `claude` session, no job log, no `corpus todos` call attributed to a loop.

**Impact**: every ingredient is independently verified — the comment skill's plugin-boundary rule
(AGENT-003 TEST-191, verified: *"Route into a plugin … Invoke the skill installed at `.claude/skills/<plugin>/`"*),
the todos skill installing into a workspace with `source: "plugin:todos"` (TEST-275, verified), the todos skill
telling the agent to use `corpus todos … --from agent` (TEST-274, read in full), and `corpus todos add --from agent`
producing an agent-authored commit (TEST-267 and TEST-289, verified). So the probability the composition is
actually broken is low. But "low probability" is not evidence, this is the issue's only cross-runtime
acceptance criterion, and the contract states plainly that silent omission is a fail.

**Resolution (2026-07-29):** rather than send this back, the evaluator ran the missing scenario itself — a
fresh workspace on `9183`, a real agent-requested thread, and a real `claude` session driving `/orchestrate`.
It passed on the first attempt, with the comment skill delegating to the todos skill and the todos skill using
`corpus todos add --from agent`. Full evidence in "§E revisited" above. The criterion is now **proven, not
assumed**, and the gap was a logging omission rather than a behavioral one — exactly as the risk assessment
predicted.

**Process note for the orchestrator:** the domain agent still shipped an issue whose single cross-runtime
acceptance criterion had no evidence, and the narrative log format is what let it pass unnoticed. A per-test
verdict table (as AGENT-003 and AGENT-004 used) would have made the hole visible immediately. Worth requiring
in the next sprint contract.

---

## Honesty Audit — 27 claims re-derived

**Confirmed against primary sources:** boot-log discovery and mount lines (2); `401` on an unauthenticated
plugin route; `409` body text verbatim; `400` out-of-range body verbatim; `404` unknown-document body
verbatim; `ts` byte-stability across a toggle; agent-vs-user git authorship on plugin writes; `corpus todos`
help at all three levels; the three verb names; no global-flag shadowing; add/check round-trips; index and
text matching, case-insensitive; ambiguity error with candidate indices and exit 1; `--json` emitting exactly
one JSON value; title/fragment resolution; the picker entry `todos/todos`; the created view document's
frontmatter (`pinned`, `query`, `column`); DocPanel counts arithmetically correct; column showing open items
only, grouped, with a fully-done document absent; the todos skill installed with `source: "plugin:todos"`;
zero `todos` mentions in the comment skill; `docs/cli.md` carrying all three verbs and zero `_fixture`;
the M6 removal state (5 sub-claims); the M6 restoration state (4 sub-claims); `db doctor` clean; the tarball's
exact plugin file list; `_fixture` absent from the tarball; zero bare `@corpus/*` specifiers in two staged
bundles; the installed binary exposing all three verbs; the installed binary mounting `/api/x/todos` and
producing an agent-authored commit.

**No claim in the log was refuted.** Every figure this evaluator re-derived matched or was conservative.
Two log statements are stronger than the evidence needed: the `_fixture`-exclusion claim (TEST-236) was
written from a dev-mode run where `_fixture` *is* present — the production-mode proof only arrives in §G, and
the log does not connect them. That is a presentation gap, not an inaccuracy.

**Escalations in the log, all corroborated:** (1) `corpus init` ignoring the global `--workspace` flag is real
— this evaluator confirmed `init` takes a positional path and used it exclusively; CLI-013 is filed.
(3) seed templates declared but never installed is real — the installed workspace received `skills/` only, no
seed. (4) the coverage-glob fix is a build-output exclusion, not a surface exclusion.

---

## Summary

**55 of 57 criteria PASS or EVIDENCE-ACCEPTED, 2 correctly STRUCK (Adjudications 16 and 17), 0 FAIL.**

The plugin itself is excellent and I could not break it. The two drills the brief singled out were run by this
evaluator from scratch and both came back exactly as claimed: the **M6 subtractive check** (remove → the app
boots, todo documents degrade to plain markdown with byte-identical data, the column shows a genuinely helpful
"Plugin missing" card, `/api/x/todos/*` 404s, `corpus todos` disappears from `--help`; restore → renderer,
DocPanel and column all return and `git status` over `plugins/` is clean), and the **packaged-tool rider**
(pack → install into a pathless prefix → the installed, `dist`-only binary exposes all three verbs, mounts
`/api/x/todos`, and `corpus todos add --from agent` lands on disk with an **agent-authored commit**). Both
INFRA-008 gaps are genuinely closed, and both were reproduced before being fixed.

Round 1 returned **PARTIAL** on two counts, neither implicating the code. Both are closed. The
`implemented on:` line was added. And TEST-278 — the one criterion proving the comment skill and the todos
skill actually compose at runtime — was **driven live by this evaluator** and passed first time: a real
`claude` session took a real `@agent` thread, routed `comment` → `todos`, ran
`corpus doc create --type todo … && corpus todos add "Todos" "buy milk" --from agent`, landed the item on
disk under an agent-authored commit, retitled the thread, replied with a `[[ref]]` **and a correct `↳` trace
line**, and drove the event to `processed/` — with zero hand-edits, zero raw HTTP and zero git state changes
in the transcript. That single run simultaneously validates AGENT-003's plugin-boundary rule, AGENT-004's
trace grammar, and PLUGINS-002's skill and CLI verbs working together in a workspace none of them was
developed in.

The remaining criticism is about the log, not the product: a narrative E2E format let a criterion ship with no
evidence at all, and only a per-test verdict table would have surfaced it. Recorded as a process note.

**Verdict: PASS.**
