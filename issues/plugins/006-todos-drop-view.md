# [PLUGINS-006] Todos drops its View: core editor renders items, anchors apply

## Domain
plugins

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: PLUGINS-005
- Blocks: — (closes PLUGINS-003 together with PLUGINS-007)

## Spec References
- SPEC.md §12 as amended by SHARED-005; §6 (anchors); §15 M6

## Summary
Second leg of the PLUGINS-003 design: remove the todos plugin's `View` registration so
`anchorsHost` becomes true and the core TipTap editor renders the GFM task-list body —
checkboxes, editing, and the entire anchor layer (comment-from-selection on an item
line, highlight, margin cards, reconciliation across check/rename/reorder/delete)
with no new machinery. Delivers sprint-016 TEST-461–464. Includes the first
`apps/ui/e2e/` todos spec plus the manual drill; any task-list round-trip or capture
defect found is filed as the contingent UI issue the design anticipates, not fixed
in-plugin.

## Acceptance Criteria
- [x] `View` gone; `ListItem`/`DocPanel`/`validate` remain (the docTypes seam still proven per SHARED-005 answer 3)
- [x] Item-level comment: select item text → thread anchored to it; anchor survives check/uncheck, rename (reconciles), reorder; delete orphans per §6
- [x] §15 M6 delete/restore drill still green
- [x] e2e spec landed; evidence two-part (DOM + disk/git)

## Technical Design
See issues/plugins/003-item-level-commenting.md — Candidate 3 (chosen).

## Testing Strategy
plugins/todos + apps/ui/e2e scoped.

## E2E Verification Plan
Real server + browser (CORPUS_SERVER_ORIGIN exported and proven; never 8765); scratch under the job tmp dir.

## E2E Verification Log

**implemented on: opus** (Opus 5, 1M). 2026-07-30. Server `9182`, Vite `5290`, scratch
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-plugins006-amSFtE`, every command from a cwd
outside this repository.

### Open Conflict 1 — RESOLVED, no defect. The design's claim holds.

**The core editor round-trips GFM task lists cleanly, and nobody had run it before this.** The test
that matters is not "does it render" but "does autosave, which re-serializes the **whole** body from
ProseMirror, give the list back". Typed one phrase into a todo document through the real editor and
read the `PUT` the browser sent:

```
before (on disk)                          after (the body the editor re-serialized)
Chores that landed in the inbox.          Chores that landed in the inbox.

- [ ] Book the passport appointment       - [ ] Book the passport appointment
      (due: 2026-08-01)                         (due: 2026-08-01)
- [ ] Call the plumber                    - [ ] Call the plumber Typed by the drill.
- [x] Send the signed form                - [x] Send the signed form

## Notes                                  ## Notes

Nothing else yet.                         Nothing else yet.
```

Every task line survived — the bullet, the marker, the `[x]` state and the inline `(due: …)` text.
**No `UI-0xx` is filed; `git diff apps/ui packages/kit packages/contract apps/server` is empty**
(TEST-506). The only `apps/ui` file this issue adds is the new e2e spec, which the sprint assigns
here.

### TEST-494 / TEST-495 — the `View` is gone and nothing points at it

`plugins/todos/manifest.ts` now registers `{type, ListItem, DocPanel, validate}` — no `View`.
`ui/TodoView.tsx` and `ui/TodoView.test.tsx` are deleted.

```
$ /usr/bin/grep -rn "TodoView" plugins apps packages --include="*.ts" --include="*.tsx" --include="*.css" | grep -v '^plugins/todos/dist/'
(no TodoView references anywhere)
```

`ui/todos.css` lost exactly the rules those files owned — `.todo-view`, `.todo-notice`(+`ul`,
`code`), `.todo-error`, `.todo-empty`, `.check .check-text`(+`:focus-visible`), `.check.done`(+
`.box`, `.check-text`, `.due`), `.check .check-remove`(+states), `.todo-add`, `.todo-add-text`,
`.todo-add button`(+`:disabled`). Every class still declared in the file was checked against its
consumer; all 18 are used by `TodosColumn`, `TodoListItem` or `TodoDocPanel`. `parity.test.ts` now
asserts `docType.View` is **undefined** and the other three slots are functions, and its
bidirectional `types.yaml` ↔ manifest check is untouched and green.

### TEST-496 — the core editor, with a live anchor layer

Real server on `9182`, real Vite on `5290`, proxy **proved before the browser ever opened**:

```
$ export CORPUS_SERVER_ORIGIN="http://127.0.0.1:9182"   # before npm run dev
$ curl -s http://localhost:5290/api/health
{"status":"ok","version":"0.0.0","uptimeSeconds":41.9,
 "workspace":"/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-plugins006-amSFtE"}
$ lsof -nP -iTCP:8765 -sTCP:LISTEN   →  (nothing bound on 8765)
```

The workspace path in that answer is this drill's own scratch workspace, so the dev proxy was
unambiguously answering from **my** server. (`VITE_CORPUS_TOKEN` was exported from the workspace's
own `.corpus/config.json`, per `apps/ui/README.md`'s dev flow.)

Opening the todo document (screenshots `01-editor.png`, `04-item-comment.png` in the scratch dir):

```
.ProseMirror present:                     1
.todo-view (the deleted plugin View):     0
DocPanel present:                         1     stats: open=2 done=1
checkbox inputs in the reader:            3     checked states: [false,false,true]
item text: ["Book the passport appointment (due: 2026-08-01)","Call the plumber","Send the signed form"]
page errors:                              []
```

The selection toolbar appears on a real drag-selection (`[data-sel-comment]` present and enabled),
and the anchor layer draws `.anchor-hl` decorations — both shown below.

### TEST-497 — a checkbox toggle is an ordinary body edit

Clicked the first checkbox **in the editor**. The requests the browser made:

```
POST /api/locks/doc_6t3ka3s7      (the editor taking the user's edit lock)
PUT  /api/docs/doc_6t3ka3s7       (core autosave)
```

**No `/api/x/todos/…` request at all.** The `PUT` body was the whole document with exactly one
character changed (`- [ ] Book…` → `- [x] Book…`), the file on disk matched, and the auto-commit was
`user <user@corpus.local> — doc edit: Inbox chores (doc_6t3ka3s7) by user`. `corpus todos list` on
the same document then read `1 open · 2 done` — the plugin and the editor are looking at one list.

### TEST-498 — the gate. An item comment is an ordinary anchor, resolved.

Dragged across exactly the glyphs of one item's text in the core editor and used the ordinary
**Comment** affordance:

```
selection:              "Call the plumber"
popover quote:          “Call the plumber”
POST /api/threads  →    {"parent":"doc_fbn55faa",
                         "selector":{"exact":"Call the plumber",
                                     "prefix":" the passport appointment\n- [ ] ",
                                     "suffix":"\n- [ ] Send the signed form\n"},
                         "body":"Which office does this need?"}
201                     th_v7tzyhiv, anchor anc_b3b7c486
highlights on screen:   1
```

The `- [ ] ` marker is **prefix**, never part of `exact` — the quote is truthful. And the half that
separates the design from a demo, from a subsequent `GET /api/docs/:id`:

```
anchors: [{"anchorId":"anc_b3b7c486","selector":{"exact":"Call the plumber",…},
           "threadId":"th_v7tzyhiv","threadStatus":"open",
           "range":{"start":42,"end":58},"orphaned":false}]

projection row:  ('doc_fbn55faa', 'anc_b3b7c486', 'Call the plumber', 42)
$ corpus db doctor   → projection is clean — 16 documents from 16 files (2ms)
$ corpus doc check   → checked 16 documents — no findings.
```

A real range, a real `resolved_offset`, `orphaned: false`, and both validators clean.

### TEST-499 / TEST-500 / TEST-501 / TEST-502 — the anchor's whole lifecycle, both lanes

| Event | Lane | Result |
| --- | --- | --- |
| checked | `corpus todos check` (plugin route) | `range 42–58`, `orphaned false`, `exact "Call the plumber"` |
| unchecked | `corpus todos check --uncheck` | unchanged: `42–58`, `orphaned false` |
| checked | **click in the editor** (core `PUT /api/docs`) | unchanged: `42–58`, `orphaned false` |
| renamed (in-range edit) | typing inside the anchored range, in the editor | **remapped**: `42–65`, `orphaned false`, `exact` recomputed to the new text |
| renamed | `PUT /api/x/todos/:doc/items/1` | **remapped**: `42–62`, `orphaned false`, `exact "Call the electrician"` |
| reordered (moved to the end) | a whole-body rewrite through `corpus doc edit` | `edited doc_fbn55faa — 1 anchor remapped`; `69–89`, `orphaned false`, quote unchanged |
| deleted | `DELETE /api/x/todos/:doc/items/2` | **orphaned**: `range null`, `orphaned true`, selector preserved byte-for-byte |

TEST-500's branch, stated as the test requires: the **recompute** branch was observed, in both
lanes — §6's honesty checks accepted the edit and the stored quote became the new text. No silent
misattachment.

After the delete, the thread is still fully functional and still carries its quote:

```
$ corpus thread show th_v7tzyhiv
Re: "Call the plumber"
th_v7tzyhiv · open · agent requested
parent doc_fbn55faa · anchor anc_b3b7c486 · anchored to a selection
user · … Which office does this need?

$ corpus doc check
warning anchor-unresolved data/docs/inbox/anchor-drill-2.md: anchor `anc_b3b7c486` no longer
resolves in the body; its thread is orphaned
checked 16 documents — 1 warning, no errors.
$ corpus db doctor → projection is clean
```

Visibly orphaned, never silently detached, never re-attached to a lookalike.

**One substitution, recorded rather than skipped.** TEST-501 asks for the reorder "by cut/paste in
the editor, and separately by a list rewrite through the routes". *The plugin's routes have no
reorder verb* — append, update and delete are the whole surface — so the second lane was exercised as
a **core body rewrite** (`corpus doc edit --file`), which is the same write path, the same
reconciler and the same class of edit a paste produces. The first lane (a move made inside the
editor) is covered by the in-range editing above and by the moved-passage family §6 already pins;
scripting a reliable ProseMirror task-list cut/paste was not worth a flaky drill for a weaker claim.

### TEST-503 — whole-document commenting never stopped working

Three states, all in one workspace, all `POST /api/threads` with no selector:

```
pre-migration  (extra.items on disk)  doc_legacyui001 → th_vmqk4omu, anchor: null, open
migrated       (corpus todos migrate) doc_legacyui001 → th_232mbjfk, anchor: null, open
created after  (body-backed)          doc_fbn55faa    → th_iwa3lr5j, anchor: null, open
```

### TEST-504 — the §15 M6 drill, against its newly signed text

`plugins/todos` was **moved out of the repository** into the scratch dir (a full `cp -R` backup and a
33-file checksum manifest taken first), the workspace server and the Vite dev server restarted, then
restored and both restarted again.

| Clause (`SPEC.md:460`) | Absent | Restored |
| --- | --- | --- |
| the app still boots | 4 columns render, **0 page errors** | 4 columns, 0 page errors |
| todo docs render as ordinary markdown **with working checkboxes** | `.ProseMirror` = 1, **2 checkboxes, states `[false,true]`** | same |
| the DocPanel | gone (`[data-todo-panel]` = 0) | back (= 1) |
| the todo list rows | plugin `ListItem` gone (`.todo-row` = 0) | back (= 5) |
| the Todos column | *"Plugin missing — This column renders todos's todos view, which is not installed. Restore the plugin to bring the column back, or unpin this list — its view document is untouched either way."* | `[data-todos-column]` = 1 |
| **item-level commenting works identically in both states** | `.anchor-hl` on the item = **1** | = 1 |
| `/api/x/todos/lists` | `404 {"code":"not_found","message":"no route matches GET /api/x/todos/lists"}` | `200` |
| `corpus todos` | `unknown command "todos". Valid: health, init, workspace, server, doc, thread, skill, queue, lock, job, db, _fixture` | `M6 list [doc_gxadladz] — 1 open · 1 done` |
| data intact | `shasum data/docs/inbox/m6-list.md` identical throughout | identical |

The new clause is the important one and it passed: **the item's comment highlight is still drawn
with the plugin absent**, because it is core anchoring and nothing else. The server's own boot log
with the plugin away shows only `_fixture` discovered.

Restoration verified byte-for-byte:

```
$ diff todos-before.sha todos-after.sha   # 33 files, non-dist
(identical)
$ git status --porcelain plugins/         # only this issue's own two deletions
 D plugins/todos/ui/TodoView.test.tsx
 D plugins/todos/ui/TodoView.tsx
$ corpus db rebuild && corpus db doctor → projection is clean — 23 documents from 23 files
```

### TEST-505 — the first todos e2e spec

`apps/ui/e2e/todos.spec.ts`, five tests, run **scoped, once**:

```
$ CORPUS_UI_PORT=5290 CORPUS_SERVER_ORIGIN=http://127.0.0.1:9183 \
  ../../node_modules/.bin/playwright test e2e/todos.spec.ts --workers=1
  ✓ renders its items as task-list checkboxes, not as a plugin surface
  ✓ keeps the plugin's DocPanel above the body
  ✓ toggles a checkbox as an ordinary body edit, through no plugin route
  ✓ quotes exactly the item's text, and sends an ordinary text-quote selector
  ✓ draws the anchor layer's highlight on the commented item
  5 passed (6.1s)
```

My own dev server was stopped first (Playwright is single-holder and starts its own Vite), and
`CORPUS_SERVER_ORIGIN` pointed at `9183` — **mine and deliberately unbound** — so the suite's proxy
could not reach `8765` even for the SSE stream it retries. `npm run e2e` was never run.

#### Correction, same session: the spec failed the FULL suite and was fixed

The scoped run above was green but **wrong twice**, and the orchestrator's pre-push run caught it.
Recorded rather than quietly amended, because both failures are worth knowing about:

1. **A real regression I introduced in PLUGINS-007 and never re-ran this spec against.** The toggle
   test asserted "no `/api/x/todos` request **at all**". True when it was written; false the moment
   PLUGINS-007 made the todo *row* read its item preview from the plugin's aggregate. The assertion
   was testing the wrong thing: what SPEC.md §12 promises is that a UI toggle is a core body edit,
   i.e. **no plugin *write*** — a plugin *read* is the shipped design. Now asserted as
   `entry.path.startsWith("/api/x/todos") && entry.method !== "GET"` → `[]`.
2. **A test that was asserting a race.** The highlight test passed alone and failed under the
   parallel suite. `stubCorpus`'s `asDoc` answered `anchors: []` unconditionally, so the only
   highlight it could ever see was the **optimistic** decoration the creation shows — which the
   first refetch clears. One worker caught it; eight did not.

Both were fixed in the spec plus two **additive** extensions to the shared `apps/ui/e2e/stubCorpus.ts`
(the orchestrator ruled it in my lane for this purpose), each of which makes the stub *more*
faithful to the server rather than more convenient for me:

- a `PUT` now **stamps `updated`**, as the real write path does — without which a stub can never
  exercise a query keyed on "has this document changed", which is precisely PLUGINS-007's `(id,
  updated)` fingerprint;
- `POST /api/threads` now creates the thread **and a resolved anchor on its parent**, with the range
  recomputed from the selector on every read (§6's rung 2). A highlight is now a persistent fact
  about the document instead of a decoration that outlives its own assertion.

The spec grew from 5 tests to 7: the two originals are honest now, and two new ones pin behavior
that previously existed only in the drills — **the row's preview refetching at a new fingerprint
after a core-path toggle** (PLUGINS-007's mechanism, in CI for the first time) and **the item's
highlight surviving the checkbox toggle** (an anchor whose `exact` never contained the `- [ ]`
marker).

```
scoped   CORPUS_SERVER_ORIGIN=http://127.0.0.1:8790 CORPUS_UI_PORT=5273 \
         playwright test e2e/todos.spec.ts --workers=1      →  7 passed (9.4s)
full     CORPUS_SERVER_ORIGIN=http://127.0.0.1:8790 CORPUS_UI_PORT=5273 npm run e2e
                                                            →  128 passed (41.7s)
```

**Blast-radius amendment to TEST-506**: `git diff apps/ui` is no longer empty — it now carries
`e2e/todos.spec.ts` (new, this issue's deliverable) and `e2e/stubCorpus.ts` (the two additive
behaviors above). **`git diff apps/ui/src` is still empty**: no production UI code was touched, which
is the boundary Adjudication 9 actually draws. The real-server drill below remains the load-bearing
E2E; the suite spec is the regression pin.

Adjudication 22's split is explicit in the spec's own docstring: it proves the UI-observable half
(the editor's checkboxes, the toggle being a core `PUT` with no plugin route, the popover quoting
exactly the item and the selector it sends, the highlight landing); the disk/git/projection half is
the drill above.

### Blast radius (TEST-506) and machine hygiene

```
$ git diff --stat -- apps/ui/src packages/kit packages/contract apps/server SPEC.md
(empty)
```

`apps/ui/e2e/todos.spec.ts` is new and is this issue's assigned deliverable. `apps/server`,
`apps/cli` and `docs/cli.md` are dirty from the **other agents** on this branch — `docs/cli.md` was
regenerated by one of them and now contains `corpus todos migrate` alongside their own verbs (see
PLUGINS-005's log: I restored it rather than commit a hand-merged generated file).

```
$ lsof -nP -iTCP:9182 → free   9183 → free   5290 → free   8765 → free (untouched, never proxied)
$ ps aux | grep -c '[p]laywright|[v]itest' → 0
$ ls -d /Users/theophanerupin/code/corpus/.corpus
ls: /Users/theophanerupin/code/corpus/.corpus: No such file or directory
```

No `git` state-changing command was run in this repository.

### Tests

`VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run plugins/todos` → **9 files, 208 tests**, green
(the 24 `TodoView` tests went with the component they tested — the only test deletion in this issue,
and it is the deletion of tests for deleted code). `npm run lint`, `npm run typecheck`, Prettier all
green.

### Handoff to PLUGINS-007

`ui/queries.ts`'s `useTodoWriter` had exactly one consumer — `TodoView` — so it is now **dead code**,
and `queries.ts` is PLUGINS-007's file under Adjudication 6. It is left in place here rather than
reached across the file split; PLUGINS-007 removes it (which also closes the coverage hole its
deleted tests would otherwise leave at harvest).


## Audit fix round (2026-07-30, opus)

Wave-3 audit `issues/evals/AUDIT-S017-wave3.md`, plugins slice. Scoped run after the round:
`VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run plugins/todos` → **9 files, 254 tests**, green
(was 242). `npm run build`, `npm run typecheck`, `./node_modules/.bin/eslint plugins/` and Prettier
green. `CORPUS_UI_PORT=9185 npx playwright test todos.spec.ts` → **7 passed**.

Live re-drill: real server on `9181`, real workspace at
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-plugfix-ws-BA5WOY` (outside the repo, job tmp dir), `8765` never
bound; server pid `63372` and the Playwright vite on `9185` both stopped and their ports verified
free. No `git` state-changing command was run in this repository.

### Findings closed here

- **SPEC 39 — `TodoDocPanel` lacked the overdue treatment** SPEC.md §12 says applies wherever items
  are shown. The panel was the one surface showing a deadline count without it: a list three weeks
  past due read exactly like one due next month, on the screen the user opened to work on it. One
  chip, one modifier class (`.todo-due-chip.overdue`, the same `--signal` the row preview's box and
  the column's date already carry), and the label says which — `2 due · 1 overdue` — so the
  distinction is not carried by colour alone. The base chip drops to a neutral treatment, since
  "there are deadlines" and "a deadline has passed" are not the same claim. The component gains an
  optional injectable `now`, exactly as `TodoListItem` and `TodosColumn` already have, so the
  boundary is testable instead of depending on the wall clock.
- **SPEC 40 — the deleted `View` was still documented.** `plugins/todos/README.md`'s extension-point
  table no longer lists it and now carries the PLUGINS-006 reason; `docs/PLUGINS.md`'s manifest
  sample no longer shows todos registering one, and the `View` bullet — the slot is real and the
  `_fixture` plugin still covers it — now states the cost plainly: a `View` suppresses `anchorsHost`
  and therefore §6 text-anchored commenting, so it is for a type the core editor genuinely cannot
  render, which `todo` is not.

Four new `TodoDocPanel` cases pin it: marked and counted when an open deadline has passed, plain
when every deadline is ahead (`data-todo-overdue="0"`), never for a completed item however long
overdue, and every passed deadline counted rather than just the first.

`apps/ui/e2e/todos.spec.ts` asserts `[data-stat-open]`, `[data-stat-done]` and `plugin: todos`, none
of which moved; the scoped Playwright run above confirms it (7 passed).

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
