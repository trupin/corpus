# Evaluation: PLUGINS-005 · PLUGINS-006 · PLUGINS-007 (the todos body chain)

**Date**: 2026-07-30
**Sprint**: sprint-017 (wave 3), TEST-475–516 + applicable cross-issue TEST-572–580
**Verdict**: **PASS** (42 of 42 applicable criteria)

Everything below was re-derived against a **real running application** — a workspace at
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-eval3/wsP` created by `corpus init --port 9181`
from a cwd outside this repository, the built CLI (`apps/cli/dist/bin/corpus.js`), a real server on
`9181`, and a real Vite dev server on `5293` driven by a headless Chromium. No implementation source
was read; `/usr/bin/grep` was used for every negative claim. The implementing agents' logs were
treated as claims to falsify, not as evidence.

**Dev-proxy proof (Adjudication 2), before any browser opened:**

```
$ export CORPUS_SERVER_ORIGIN="http://127.0.0.1:9181"   # exported before vite started
$ curl -s http://localhost:5293/api/health
{"status":"ok","version":"0.0.0","uptimeSeconds":409.208,
 "workspace":"/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-eval3/wsP"}
$ lsof -nP -iTCP:8765 -sTCP:LISTEN      → (nothing bound; never bound, never killed, never proxied)
```

The workspace in that answer is my own scratch workspace, so the proxy was unambiguously answering
from my server.

---

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Verification log present                | PASS   | All three issues carry a filled `E2E Verification Log`; no placeholders.                                                             |
| Commands are specific and concrete       | PASS   | Exact CLI invocations, curl calls with bodies, request traces, ports, ids, checksums, screenshot filenames.                          |
| Real E2E (not mocked)                    | PASS   | Real server + real CLI + real browser. Unit suites are cited *beside* the drills, never in place of them.                            |
| Scenarios cover acceptance criteria      | PASS   | Every TEST-475–516 has drill evidence; the two substitutions (TEST-501 reorder lane, TEST-506 blast radius) are declared, not hidden. |
| Application restarted after changes      | PASS   | PLUGINS-006's M6 drill restarts server and Vite in both directions; PLUGINS-007 runs its own server/Vite pair.                        |
| Actual model recorded (implemented on:)  | PASS   | All three: `implemented on: opus` (Opus 5, 1M).                                                                                       |
| Reproduction logged before fix (bugs)    | N/A    | Feature chain, not bug issues.                                                                                                       |

Two log claims were checked especially hard because they were the easiest to fake, and both held:
the **fingerprint request trace** (TEST-509) and the **M6 highlight-with-the-plugin-absent** clause
(TEST-504). Both reproduced independently — see below.

---

## Criteria Results

### PLUGINS-005 — storage

| #        | Criterion                                                  | Result | Observed                                                                                                                                                                   |
| -------- | ---------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-475 | Body is standard GFM, spec-shaped                          | PASS   | On disk: `- [ ] First thing to do` / `- [ ] Something with a deadline (due: 2026-12-31)` / `- [ ] Renew passport (due: 2026-08-01)` — marker at line start, `(due: …)` at line end. |
| TEST-476 | Untouched lines byte-identical on a toggle                 | PASS   | See FINDING-A evidence block. One body line changed; trailing spaces, fence, heading, final newline byte-identical.                                                          |
| TEST-477 | A fenced lookalike is not an item                          | PASS   | `todos list --json` on the rich doc returns 6 items; `this is an example, not an item` absent.                                                                              |
| TEST-478 | Due marker tolerant both directions                        | PASS   | `a (due: not-a-date)`, `c (due: 2026-08-01) trailing`, `d` all come back with **no** `due` and their marker text intact as ordinary item text. No error, no warning.        |
| TEST-479 | `--due` round-trips; `ISO_DATE_PATTERN` still refuses      | PASS   | `--due 2026-08-01` → line `- [ ] Renew passport (due: 2026-08-01)`, JSON `"due":"2026-08-01"`. `--due nonsense` → `corpus: item.due: must be an ISO calendar date (YYYY-MM-DD)`, exit 1. |
| TEST-480 | `ts` gone, nothing depends on it                           | PASS   | `/usr/bin/grep -rnE "(^\|[^a-zA-Z])ts:" plugins/todos --include=*.ts*` minus `dist/` and `*.test.*` → **no hits**. `--json` emits no `ts`.                                    |
| TEST-481 | Order is body order; a toggle does not reorder             | PASS   | check → uncheck restored the file byte-identically (mod `updated:`); order unchanged across check/uncheck/rename.                                                            |
| TEST-482 | Five shipped routes behave identically                     | PASS   | `GET /lists` 200, `GET /lists/:doc` 200, `POST /items` **201** `{docId,index,item}`, `PUT /items/:i` 200, `DELETE /items/:i` 200 `{…,removed}` — all against body-backed docs. |
| TEST-483 | `expectedText` 409 guard verbatim                          | PASS   | `PUT …/items/2 {"done":true,"expectedText":"Something else"}` → **409** `{"code":"conflict","message":"item 2 is now “Call the electrician”, not “Something else” — it changed under you; nothing was written"}`. |
| TEST-484 | Lost-update property re-proved concurrently                | PASS   | Live against the server: 4 concurrent `POST /items` → `201@2 201@3 201@4 201@5`, all four present; 2 concurrent toggles → `200 200`, both survive; delete‖toggle on one index → `200 409`, **no resurrection**. |
| TEST-485 | `add\|check\|list` unchanged in shape                      | PASS   | `docs/cli.md` §`corpus todos`: add/check/list arguments and flags unchanged; the only addition is `corpus todos migrate`.                                                     |
| TEST-486 | Migration decision recorded with reasoning                 | PASS   | Log names the chosen policy (bulk verb **+** on-first-write), the rejected one, and the observable consequences. Both halves verified live.                                    |
| TEST-487 | No item lost, any order                                    | PASS   | Three legacy docs migrated: text, `done`, `due`→inline marker and order all preserved; `- [ ] leading lookalike` and `explain - [ ] and - [x] syntax` round-trip unsplit. `db doctor` clean. |
| TEST-488 | Mixed-format workspace reads correctly                     | PASS   | `corpus todos list` showed 2 body-backed + 5 legacy documents side by side with correct counts, no duplication, no empty list.                                                |
| TEST-489 | Residual `extra.items` handled deliberately                | PASS   | After migrate, `/usr/bin/grep -rn "^items:" data/docs/` matches **only** the two documents migrate deliberately refused (left byte-identical). Every migrated doc lost the key in the same commit. Verb is in `docs/cli.md`, reports what it changed, idempotent. |
| TEST-490 | Seed template ships starter items in its body              | PASS   | `plugins/todos/seeds/todo-template.md`: body carries `- [ ] First thing to do` and `- [ ] Something with a deadline (due: 2026-12-31)`; `/usr/bin/grep -n "items"` → exit 1 (no frontmatter key). |
| TEST-491 | `validate` repointed without touching kit                  | PASS   | `manifest.ts:46` reads `validate: (doc) => itemProblems(docSource(doc))`; `git diff cb7825d..HEAD -- packages/kit` empty.                                                     |
| TEST-492 | Anchoring ban green and unmodified                         | PASS   | `TextQuoteSelector`, `resolveAnchor`, `selectorFromSelection` each appear in exactly one plugin file: `plugins/todos/imports.test.ts`. `git diff` of that file across the batch: unmodified. |
| TEST-493 | Blast radius                                               | PASS   | The plugins commits touch `plugins/todos/**`, `apps/ui/e2e/**` (the assigned spec + stub) and one `package-lock.json` line. `SPEC.md`, `packages/contract`, `packages/kit`, `apps/ui/src`, `apps/server` all empty. |

### PLUGINS-006 — the View drops, anchors arrive

| #        | Criterion                                     | Result | Observed                                                                                                                                                                    |
| -------- | --------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-494 | `View` gone, other three slots stay           | PASS   | `manifest.ts` registers `ListItem`, `DocPanel`, `validate`; no `View`. Confirmed at runtime: the browser fetched `TodoDocPanel.tsx`, `TodoListItem.tsx`, `TodosColumn.tsx` and **no** `TodoView`. |
| TEST-495 | `TodoView` deleted, nothing points at it      | PASS   | `/usr/bin/grep -rn "TodoView" plugins apps packages --include=*.ts --include=*.tsx --include=*.css \| grep -v dist/` → **exit 1, no hits**.                                    |
| TEST-496 | Core editor + live anchor layer               | PASS   | Reader DOM: `.ProseMirror` = 1 (`data-doc-editor`), `.todo-view` = 0, `[data-todo-panel]` = 1 showing `4 open / 0 done / 3 due / plugin: todos` above the body, 4 real task-item checkboxes, 0 page errors. Selection toolbar (`[data-sel-toolbar]`, `[data-sel-comment]`) appears on a real drag. |
| TEST-497 | Checkbox toggle is an ordinary body edit      | PASS   | See FINDING-B. `PUT /api/docs/doc_64wupngz` carrying the whole body with one marker char changed; **zero non-GET requests to `/api/x/todos`**; disk `- [ ] ` → `- [x] `; commit `doc edit: Week of Jul 20 (doc_64wupngz) by user`, author `user <user@corpus.local>`. |
| TEST-498 | **The gate** — item comment is a resolved anchor | PASS | See FINDING-C. Popover quote `“First thing to do”`; `POST /api/threads` selector `exact:"First thing to do"`, `prefix:"## What this list is for\n\n- [ ] "` — the marker is **prefix, never `exact`**. `GET /api/docs/:id` → `range {32,49}`, `orphaned:false`; projection row `doc_64wupngz\|anc_c67a695b\|First thing to do\|32`; `db doctor` clean; `doc check` clean. |
| TEST-499 | Anchor survives check/uncheck, both lanes     | PASS   | Plugin lane (`corpus todos check` / `--uncheck`): `range 217–237, orphaned false, exact "Call the electrician"` unchanged through both transitions. Core lane (checkbox click in the editor): `.anchor-hl` still 1 on the commented item after the toggle. |
| TEST-500 | Anchor follows a rename, quote stays honest   | PASS   | **Recompute branch observed**: `PUT …/items/5 {"text":"Phone the electrician urgently"}` → `range {286,307}`, `orphaned false`, `exact` recomputed to `"Phone the electrician"`. See FINDING-D for a nuance the log overstates. |
| TEST-501 | Anchor follows a reorder                      | PASS   | Moving the anchored item to the end via a whole-body `corpus doc edit --file` → `edited doc_6rmjqayk — 1 anchor remapped`; `range 42-ish → {286,306}`, `orphaned false`, quote unchanged. (The routes have no reorder verb; the substitute lane is the one the log declared.) |
| TEST-502 | Deleting the item orphans, quote preserved    | PASS   | `DELETE …/items/5` → 200; anchor `range: null`, `orphaned: true`, selector preserved byte-for-byte; `corpus thread show` still renders the thread with its quote; `doc check` warns `anchor-unresolved`; `db doctor` clean. Never silently detached, never re-attached. |
| TEST-503 | Whole-document commenting never broke         | PASS   | Unanchored `POST /api/threads` on a pre-migration doc (`doc_legacycmnt1`), a migrated doc (`doc_legacydone1`) and a body-backed doc (`doc_64wupngz`) → `th_cm3a7tdj`, `th_57tyyzow`, `th_m2n6yjnw`, all `anchor: None`, `status: open`. |
| TEST-504 | §12 M6 drill against the newly signed text    | PASS   | See FINDING-E — the full absent/restored table, including the new clause.                                                                                                     |
| TEST-505 | First todos e2e spec lands, run scoped        | PASS   | `apps/ui/e2e/todos.spec.ts` present, **7** tests with exactly the corrected titles — including `"toggles a checkbox as an ordinary body edit, through no plugin write"` (the honest assertion) and the two added pins. Not re-run by me (Adjudication 16 gives the harvest run that job). |
| TEST-506 | Core defect filed not fixed; boundary holds   | PASS   | `git diff cb7825d..HEAD -- apps/ui/src packages/kit packages/contract apps/server SPEC.md` → **empty**. No task-list round-trip or capture defect was found by me either: the editor round-trips the list and captures a truthful quote. **Open Conflict 1 resolves to "no defect", confirmed independently.** |

### PLUGINS-007 — the row surfaces off the body

| #        | Criterion                                        | Result | Observed                                                                                                                                                                     |
| -------- | ------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TEST-507 | Column correct against body-backed lists         | PASS   | Column groups/counts matched the files on disk exactly for 8 documents. `groupOpenItems`' contract holds: `doc_brokenlegacy` (0 open) is **omitted entirely** from the column while its row still renders. |
| TEST-508 | The todo list row is correct too                 | PASS   | `.todo-row` previews up to 3 items with `☐`/`☑` glyphs and `+N more`, plus the `N due` badge — sourced from the body. `Week of Jul 20`: `☐ First thing to do / ☐ Something with a deadline / ☐ Renew passport / +1 more`, badge `3 due`. Matches disk. |
| TEST-509 | **The hole** — core-editor toggle updates both surfaces, no reload | PASS | See FINDING-B. Column `3 → 2` and the item vanished; row glyph `☑ → ☐` on a later uncheck — both live. Trace: `PUT /api/docs/…` → `GET /api/docs?type=todo` → `GET /api/x/todos/lists/at/p4p4i8` (fingerprint moved from `ogmm0r`). |
| TEST-510 | Plugin-route/CLI toggle still updates them       | PASS   | `PUT /api/x/todos/doc_64wupngz/items/2` → 200, then in order: `GET /api/x/todos/lists/at/p4p4i8` (the plugin's **own** broadcast, prefix-matching the current key) → `GET /api/docs?type=todo` → `GET /api/x/todos/lists/at/1y8azp`. Column `2 → 1`, row glyph and `2 due → 1 due` both live. **Both paths fire — beside, not instead of.** |
| TEST-511 | Fingerprint real and derived from what moves     | PASS   | Observed four distinct fingerprints (`ogmm0r`, `p4p4i8`, `v13qfz`, `1kqw6ja`→`84u21w` in the log) each moving exactly when a document's `updated` moved, and the key `["x","todos","lists","at",fp]` still prefix-matches the shipped broadcast (TEST-510 proves the match at runtime). `git diff packages/kit` empty — **Open Conflict 3 resolves to "call-site composition", confirmed.** |
| TEST-512 | One aggregate request, not N+1                   | PASS   | Initial board render with 8 todo documents, column + 9 rows: `GET /api/x/todos/lists/at/ogmm0r` × **1**, `GET /api/docs?type=todo` × 1, **0** per-document reads. |
| TEST-513 | Overdue treatment survives the storage change    | PASS   | Column: `<span class="due" data-overdue="true">2026-07-01</span>` on `Overdue thing`, `data-overdue="false"` on `2026-12-31` and `2026-08-01`. Row: `<div class="t overdue">` on the overdue preview item. Both surfaces, both directions. |
| TEST-514 | Every `TRANSITIONAL` assertion restored          | PASS   | `/usr/bin/grep -rn "TRANSITIONAL" plugins apps packages --include=*.ts --include=*.tsx --include=*.css \| grep -v dist/` → **exit 1, no hits**. `useTodoWriter`/`TodoWriter` → no references anywhere. |
| TEST-515 | `packages/kit` untouched                         | PASS   | `git diff cb7825d..HEAD -- packages/kit` → empty across the whole batch.                                                                                                       |
| TEST-516 | File split with PLUGINS-006 held                 | PARTIAL→accepted | The three stages landed as **one commit** (`606e974`), so a per-commit split cannot be checked. PLUGINS-007's log reports this deviation explicitly with its reason (files carry hunks from two stages; three commits would not each typecheck) and leaves the call to the orchestrator. Adjudication 3/6/16 name reporting-not-hiding as the required behaviour; the *substance* of the split (nobody edited outside their assigned surface in a way that shows) is unverifiable post-hoc and I do not treat a declared, ruled deviation as a failure. |

### Cross-issue, as applicable

| #        | Criterion                          | Result | Observed                                                                                                       |
| -------- | ---------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| TEST-572 | No agent edited `SPEC.md`          | PASS   | `git diff cb7825d..HEAD -- SPEC.md` → empty.                                                                    |
| TEST-573 | No workspace scaffolded into repo  | PASS   | `ls -d /Users/theophanerupin/code/corpus/.corpus` → `No such file or directory` (start and end of my session).  |
| TEST-574 | No in-place `packages/contract`    | PASS   | `git diff cb7825d..HEAD -- packages/contract` → empty.                                                          |
| TEST-576 | Repository clean of scratch escape | PASS   | `git status --porcelain` in the repo → empty, after the M6 move-out/move-back and the drift check.               |
| TEST-577 | Ports/processes clean; 8765 intact | PASS   | 9181/9183/9185/9189/9191/9193/5293 all free at the end; 0 stray vitest/playwright/chromium; **8765 unbound throughout, never bound, never killed, never proxied** (proxy target proved at `9181`). |
| TEST-578 | Chain coherent, no `TRANSITIONAL`  | PASS   | One storage format, one manifest with three slots and no `View`, both row surfaces off the body, zero markers.  |
| TEST-579 | Generated artifacts regenerate cleanly | PASS | `node --import tsx scripts/check-generated-artifacts.ts` → `✓ API contract is up to date`, `✓ CLI reference is up to date`, exit 0, working tree clean afterwards. `docs/cli.md` carries `corpus todos migrate`, `corpus doc unarchive` and `--extra` from **one** regeneration on the merged tree. |

---

## Load-bearing evidence

### FINDING-A — TEST-476, byte-stability, proved rather than eyeballed

A todo document with prose carrying trailing spaces, a heading between two groups, a fenced block
containing a task-item lookalike, and trailing prose. One item checked **as `agent`** while the
previous write was `user`, so §4's squash window could not fold the commits:

```
$ node corpus.js todos check "Rich list" 1 --from agent
checked item 1 of Rich list [doc_6rmjqayk] — Book the passport appointment

$ git diff HEAD~1 HEAD -- data/docs/todos/rich-list.md
-updated: 2026-07-30T22:23:36Z
+updated: 2026-07-30T22:23:59Z
-- [ ] Book the passport appointment (due: 2026-08-01)
+- [x] Book the passport appointment (due: 2026-08-01)
```

and byte-exactly, not by eye — the before-file with the single marker substitution applied compared
against the after-file, both with `updated:` stripped:

```
expected==actual (byte-exact, ignoring updated:): True
trailing spaces preserved: True | True
final bytes: 'iling prose with two trailing spaces.  \n'
```

A serializer that re-renders from a parsed model fails this. This one edits the line it owns.

### FINDING-B — TEST-497 + TEST-509, one click, the whole mechanism

A checkbox clicked **in the core editor** with the board visible in the same page. Full `/api` trace,
in order, captured passively:

```
POST   /api/locks/doc_64wupngz   body={"ttl":300}
GET    /api/locks  ×2
GET    /api/docs/doc_64wupngz
PUT    /api/docs/doc_64wupngz    body={"body":"## What this list is for\n\n- [x] First thing to do\n- [x] Something with a deadline (due: 2026-12-31)\n- [ ] Renew passport (due: 2026-08-01)\n- [ ] Overdue thing (due: 2026-07-01)\n\n## Not…
GET    /api/docs?type=todo                  ← core's ["docs"] invalidation reaching useDocs
…
GET    /api/x/todos/lists/at/p4p4i8         ← the fingerprint moved: ogmm0r → p4p4i8
DELETE /api/locks/doc_64wupngz

non-GET requests to /api/x/todos:  []       ← no plugin WRITE at all
```

Column before `["3","4","2",…]` → after `["2","4","2",…]`; the checked item left the column. Disk:
`- [x] Something with a deadline (due: 2026-12-31)`. Commit: `doc edit: Week of Jul 20 (doc_64wupngz) by user`.

The `GET /api/docs?type=todo` → `GET /api/x/todos/lists/at/<new fp>` pair **is** the mechanism. The
trace contains no plugin broadcast, because there was no plugin write to broadcast — which is exactly
the hole the fingerprint exists to close, observed rather than argued. A separate run confirmed the
**row's** preview updates on the same path (`☑ First thing to do` → `☐ First thing to do`, no reload).

### FINDING-C — TEST-498, the gate, captured through the real affordance

Dragged across the glyphs of one item's text in the editor, clicked `[data-sel-comment]`, typed, sent:

```
selection:      "First thing to do"
popover:        <div class="cm-quote">“First thing to do”</div>
POST /api/threads body:
  {"parent":"doc_64wupngz",
   "selector":{"exact":"First thing to do",
               "prefix":"## What this list is for\n\n- [ ] ",
               "suffix":"\n- [x] Something with a deadline"},
   "body":"Which office does this need?","requestsAgent":true}
.anchor-hl on screen: 1  ("First thing to do")

GET /api/docs/doc_64wupngz →
  {"anchorId":"anc_c67a695b","threadId":"th_w2p6lc4w","threadStatus":"open",
   "range":{"start":32,"end":49},"orphaned":false}
projection:  doc_64wupngz|anc_c67a695b|First thing to do|32
$ corpus db doctor  → projection is clean — 25 documents from 25 files
$ corpus doc check  → checked 25 documents — no findings
```

The `- [ ] ` marker lands in **prefix** and never in `exact`, so the stored quote is text the user
actually wrote. A real range, a real `resolved_offset`, `orphaned: false`, both validators clean.
This is the sprint's single gate and it passes on independent re-derivation.

### FINDING-D — TEST-500, a nuance the log overstates (not a failure)

PLUGINS-006's log table claims "the **recompute** branch was observed, in both lanes". Re-derived,
the branch taken depends on the shape of the rename:

- **Appending** rename (`"Call the electrician"` → `"Call the electrician urgently"`): the anchor
  stays at `range {217,237}` with `exact` **unchanged** — the old quote is still literally present, so
  the unique-`exact` rung resolves it. Honest quote, correct position, but *not* a recompute.
- **Replacing** rename (`"Call the electrician urgently"` → `"Phone the electrician urgently"`):
  `exact` **is** recomputed to `"Phone the electrician"`, `range {286,307}`, `orphaned false`.

Both outcomes satisfy TEST-500's actual requirement (attached with an honest quote, or a visible
orphan — never a silent misattachment). The log's "in both lanes" is true for the lanes it drilled;
it should not be read as "every rename recomputes".

### FINDING-E — TEST-504, the §12 M6 drill, run for real

`plugins/todos` was moved **out of the repository** into scratch (33-file checksum manifest taken
first), the server and Vite restarted, the board and reader inspected, then moved back and both
restarted again.

| Clause (`SPEC.md:460`)                              | Absent                                                                                                                                                                                          | Restored                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| the app still boots                                 | board renders, **0 page errors**                                                                                                                                                                | same                              |
| todo docs render as ordinary markdown **with working checkboxes** | `.ProseMirror` = 1, **4 checkboxes, states `[true,true,true,false]`**                                                                                                              | same                              |
| the `DocPanel`                                      | `[data-todo-panel]` = **0**                                                                                                                                                                     | = **1**                           |
| the todo list rows                                  | `.todo-row` = **0** (rows fall back to ordinary excerpt rows)                                                                                                                                    | = **9**                           |
| the Todos column                                    | `<div class="col-card plugin-missing-card">` — *"Plugin missing — This column renders todos's todos view, which is not installed. Restore the plugin to bring the column back, or unpin this list — its view document is untouched either way."* | `[data-todos-column]` = 1         |
| **item-level commenting works identically**         | `.anchor-hl` on the item = **1**                                                                                                                                                                | = **1**                           |
| `/api/x/todos/lists`                                | `404 {"code":"not_found","message":"no route matches GET /api/x/todos/lists"}`                                                                                                                   | `200`                             |
| `corpus todos`                                      | `unknown command "todos". Valid: health, init, workspace, server, doc, thread, skill, queue, lock, job, db, _fixture.`                                                                           | `Week of Jul 20 [doc_64wupngz] — 1 open · 3 done` |
| data intact                                         | `shasum data/docs/todos/week-of-jul-20.md` = `5d990d8f…`                                                                                                                                         | identical                         |

Restoration verified: `diff todos-before.sha todos-after.sha` identical (33 files),
`git status --porcelain plugins/` empty, `corpus db rebuild && corpus db doctor` clean.

**The new clause is the one that proves the design, and it passed**: the item's comment highlight is
still drawn with the plugin absent, because it is core anchoring and nothing else.

### FINDING-F — migration, both halves

**Bulk verb**, against three legacy documents written straight to disk in the pre-PLUGINS-005 shape:

```
$ corpus todos migrate --from user
migrated Legacy with a done item [doc_legacydone1] — 2 items moved into the body
migrated Legacy with a due date [doc_legacydue01] — 2 items moved into the body
migrated Legacy with checkbox-like text [doc_legacytrick] — 2 items moved into the body
skipped Items in both places [doc_bothplaces1] — … carries items in its body *and* in its `items` frontmatter …
skipped Legacy unparseable [doc_brokenlegacy] — … has malformed items … items: must be a list of items; found string
3 migrated · 2 skipped · 2 already migrated
$ corpus todos migrate --from user          # idempotent
0 migrated · 2 skipped · 5 already migrated
```

Refused documents left byte-identical (`grep -c "from frontmatter" both.md` → 1). Both write
refusals also fire on ordinary verbs (`corpus todos check "Items in both places" 1` → exit 1).

**On-first-write convergence**, on a fresh legacy document, in **one** commit and with no half state:

```
before:  items: [alpha(open), beta(done, due 2026-09-09)]   in frontmatter
$ corpus todos add "Legacy converged on write" "gamma" --from agent
after:   frontmatter has NO `items` key;  body:
           Prose that must survive.
           - [ ] alpha
           - [x] beta (due: 2026-09-09)
           - [ ] gamma
commits produced: 1  (doc edit: Legacy converged on write (doc_legacyonwrt) by agent)
```

---

## Refuted / corrected claims (none material)

1. **PLUGINS-005, TEST-489 grep.** The log prints `/usr/bin/grep -rn "^items:" data/docs/` → *"no
   hits — the key is gone everywhere"*, and separately shows a both-places document that by
   construction still carries `items:`. Both are true at different points in its sequence, but the
   sentence as written over-claims. Re-derived: migrated documents carry no residual key; documents
   migrate **refuses** keep theirs, correctly and by design.
2. **PLUGINS-006, TEST-500 "recompute in both lanes."** Narrower than it reads — see FINDING-D.
   No criterion fails.
3. **PLUGINS-007, TEST-516 file split.** Unverifiable post-hoc because the three stages landed as one
   commit. Declared by the agent, ruled by the orchestrator; recorded here as PARTIAL→accepted rather
   than silently marked PASS.

---

## Summary

**42 of 42 applicable criteria pass.** The chain does what the design promised: items are ordinary
GFM task-list lines the core editor owns, a checkbox is a core body edit with no plugin write, an
item comment is an ordinary text-quote anchor that **resolves** with a real range and a truthful
quote (the `- [ ] ` marker is prefix, never quote), the anchor survives check/uncheck/rename/reorder
and orphans visibly on delete, the column and the row both read the body through one aggregate and
both refresh live from **both** write paths, and the whole item-commenting surface keeps working with
`plugins/todos` deleted from the tree.

TEST-498 — the sprint's single gate — passes on independent re-derivation, twice (server-constructed
selector and browser-captured selector). Open Conflicts 1 and 3 both resolve to their defaults and
both resolutions were confirmed against the running app, not accepted on the logs' word.
