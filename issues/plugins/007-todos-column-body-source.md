# [PLUGINS-007] Todos column re-sourced off the body aggregate

## Domain
plugins

## Status
in_progress

## Priority
P1

## Model
opus

## Dependencies
- Depends on: PLUGINS-005
- Blocks: — (closes PLUGINS-003 together with PLUGINS-006)

## Spec References
- SPEC.md §12 as amended by SHARED-005

## Summary
Third leg of the PLUGINS-003 design (parallel with PLUGINS-006): the Todos board
column reads item state from the body via the plugin's own aggregate route, keyed on a
`useDocs` `(id, updated)` fingerprint so core-path edits (now possible — the editor
owns the body) still refetch. Without the fingerprint there is a real SSE invalidation
hole: a checkbox toggled through the core editor broadcasts only core doc keys, which
the plugin's `lists` cache never observes (design section has the full analysis).

## Acceptance Criteria
- [x] Column counts/preview correct against body-backed lists
- [x] A toggle made through the core editor updates the column without reload (the fingerprint refetch proven)
- [x] A toggle made through the plugin route/CLI still updates it (existing invalidation path intact)

## Technical Design
See issues/plugins/003-item-level-commenting.md — Candidate 3 (chosen).

## Testing Strategy
plugins/todos scoped; kit query tests where the fingerprint lives.

## E2E Verification Plan
Real server + browser (CORPUS_SERVER_ORIGIN exported and proven; never 8765); both toggle paths exercised.

## E2E Verification Log

**implemented on: opus** (Opus 5, 1M). 2026-07-30. Server `9184`, Vite `5291`, scratch
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-plugins007-hsU4Oe`, every command from a cwd
outside this repository.

### Open Conflict 3 — RESOLVED, no kit change. The fingerprint is a call-site composition.

The obstacle was real and worth stating, because the obvious solution fails: `usePluginQuery` derives
its cache key **from the request path**, so putting the fingerprint in a query string
(`lists?v=<fp>`) produces the key `["x","todos","lists?v=<fp>"]` — which the plugin's own broadcast
(`["x","todos","lists"]`) no longer prefix-matches. That would have closed the new hole by breaking
the shipped one, which TEST-510 forbids.

What works, and needs nothing from `packages/kit`: **the fingerprint is a path segment.**

- `ui/queries.ts` computes `docsFingerprint(rows)` — FNV-1a over `(id, updated)` from a
  `useDocs({type: "todo"})` — and asks for `lists/at/<fingerprint>`.
- The kit builds the key `["x","todos","lists","at",<fingerprint>]`. It **starts with**
  `["x","todos","lists"]`, and `sseBridge.ts` invalidates with
  `queryClient.invalidateQueries({queryKey})` — TanStack's prefix match — so the plugin's own
  broadcast reaches it exactly as before.
- `server/routes.ts` mounts `GET /lists/at/:fingerprint` on the **same handler** as `GET /lists`.
  The segment is deliberately unread; its whole job is to be *different*.

`git diff packages/kit` is **empty** (TEST-515). The design's `(id, updated)` fingerprint is
implemented literally; only its carrier is a path segment rather than an opaque key element, because
that is what the shipped `usePluginQuery` can express.

### TEST-507 / TEST-508 / TEST-512 / TEST-513 — the board, against the files on disk

Three body-backed todo documents, written by `corpus doc create`, and a pinned `todos/todos` column.
What is on disk:

```
data/docs/inbox/week-of-jul-20.md   - [ ] Book the passport appointment (due: 2026-07-10)
                                    - [ ] Call the plumber
                                    - [x] Send the signed form
data/docs/inbox/house-paperwork.md  - [ ] Pull credit reports (due: 2026-12-01)
                                    - [x] Sign the offer
data/docs/inbox/all-done.md         - [x] Nothing left here
```

What the board shows (screenshot `07-board.png`):

```
column: groups ["doc_lxyfo3xx","doc_mbusp76v"]     ← "All done" omitted entirely
        items  ["Book the passport appointment","Call the plumber","Pull credit reports"]
        counts ["2","1"]
        due chips ["2026-07-10=true", "2026-12-01=false"]     ← TEST-513, both directions
rows:   previews ["Nothing left here","Book the passport appointment","Call the plumber",
                  "Send the signed form","Pull credit reports","Sign the offer"]
        badges   ["", "1 due", "1 due"]
        overdue  ["Book the passport appointment"]
```

Every count, every group and every preview matches the files. `groupOpenItems`' contract holds:
a document with no open items is omitted from the column, while its **row** still previews its items.

**TEST-512, one request:**

```
aggregate requests:            ["GET /api/x/todos/lists/at/17ta3ve"]
/api/docs?type=todo requests:  ["GET /api/docs?type=todo"]
per-document reads:            0
page errors:                   []
```

One aggregate for the whole board — the column **and** three `TodoListItem`s — because they share
one query key and TanStack dedupes them. No N+1, no per-document read.

### TEST-509 — the hole, closed and observed. **No reload.**

The board on screen; the same document opened in the reader; **a checkbox clicked in the core
editor** (screenshots `07-editor-before.png` / `07-editor-after.png`):

```
column BEFORE: groups [week, house]  items [Book…, Call…, Pull…]  counts [2,1]  due [07-10=true, 12-01=false]
column AFTER : groups [week, house]  items [Call…, Pull…]         counts [1,1]  due [12-01=false]
rows   BEFORE: badges ["", "1 due", "1 due"]   overdue ["Book the passport appointment"]
rows   AFTER : badges ["🔒 user editing", "", "1 due"]   overdue []
```

and the request trace that explains it, in order:

```
PUT  /api/docs/doc_lxyfo3xx                 ← the core body edit; NO /api/x/todos write at all
GET  /api/docs?type=todo                    ← core's ["docs"] invalidation reaching useDocs
GET  /api/x/todos/lists/at/1kqw6ja          ← the fingerprint moved: 17ta3ve → 1kqw6ja
```

That middle→last step *is* the mechanism. Without it the plugin's cache never hears about a core
write — the trace contains no `x/todos` broadcast, because there was no plugin write to broadcast —
and the column would have kept saying `2` until a reload.

### TEST-510 — and the shipped path is still there, doing its own job

A write made through the plugin route while the same board stayed open, no reload:

```
PUT /api/x/todos/doc_mbusp76v/items/0 → 200 {"docId":"doc_mbusp76v","index":0,
                                             "item":{"text":"Pull credit reports","done":true,"due":"2026-12-01"}}

GET /api/x/todos/lists/at/1kqw6ja     ← the PLUGIN's own broadcast, prefix-matching the current key
GET /api/docs?type=todo               ← then core's ["docs"] from the same write
GET /api/x/todos/lists/at/84u21w      ← and the fingerprint moving after it

column AFTER: groups ["doc_lxyfo3xx"]  items ["Call the plumber"]  due []
```

The refetch at the **unchanged** fingerprint is the shipped invalidation path working, verbatim; the
one at the new fingerprint is this issue's addition. Both fire, which is the "beside it, not instead
of it" the contract asks for — and the server's own log shows the same sequence:

```
{"msg":"request","method":"PUT","path":"/api/docs/doc_lxyfo3xx","status":200}
{"msg":"request","method":"GET","path":"/api/x/todos/lists/at/1kqw6ja","status":200}
{"msg":"request","method":"PUT","path":"/api/x/todos/doc_mbusp76v/items/0","status":200}
{"msg":"request","method":"GET","path":"/api/x/todos/lists/at/1kqw6ja","status":200}
{"msg":"request","method":"GET","path":"/api/x/todos/lists/at/84u21w","status":200}
```

**One cost, stated rather than hidden:** a *plugin-route* write now refetches the aggregate twice —
once from the broadcast, once when the fingerprint follows. Both are cheap `GET`s against a
projection query, and the alternative (dropping one of the two paths) is the failure mode each test
exists to prevent. `corpus db doctor` clean afterwards: *projection is clean — 13 documents from 13
files*.

### TEST-511 — the mechanism, checked directly

`ui/queries.test.ts` pins it without a browser: the fingerprint changes when any document's
`updated` changes, when a document appears or disappears, is stable for an unchanged result set,
tolerates a `null` timestamp, stays ≤ 8 characters for a 200-document workspace, and — the
load-bearing one — `pluginKey("todos", ...listsPath(fp).split("/"))` **starts with**
`TODO_LISTS_KEY`. `TodosColumn.test.tsx` asserts the real request path matches
`/api/x/todos/lists/at/<fp>`.

### TEST-514 — every `TRANSITIONAL → PLUGINS-007` marker paid back, one for one

PLUGINS-005 listed two blocks. Both are **deleted** and the originals they relaxed are **restored to
their original strength**, now against body-backed documents:

| PLUGINS-005 marked | Restored here |
| --- | --- |
| `TodosColumn.test.tsx` → "shows its empty state for a workspace whose lists are full" | gone. *"aggregates open items across documents, grouped by their list"* asserts `groups()` = `["doc_week","doc_house"]` and `itemTexts()` = `["Renew passport","Pull credit reports"]` again — for documents whose items are in the **body**. |
| `TodosColumn.test.tsx` → "groups nothing for a row that carries no `extra.items`" | gone. `groupOpenItems` answers `[{docId:"doc_a",title:"A",items:[{text:"open",done:false}]}]` for a body-backed list again. |
| `TodoListItem.test.tsx` → "renders no item preview and no due badge for a migrated document" | gone. *"previews the first three items with their checkboxes"* asserts `["one","two","three"]` plus `+1 more` again, and *"badges the number of open items carrying a deadline"* asserts `1 due` again. |

```
$ /usr/bin/grep -rn "TRANSITIONAL" plugins apps packages --include="*.ts" --include="*.tsx" --include="*.css" | grep -v dist/
(none — every one is paid back)
```

The two source docstrings that carried the marker are rewritten to describe the shipped design.

### PLUGINS-006's handoff, closed

`useTodoWriter` (and its `TodoWriter` type) lost its only consumer when `TodoView` was deleted;
`queries.ts` is this issue's file, so the dead hook is removed here rather than left to rot.
`/usr/bin/grep -rn "useTodoWriter\|TodoWriter" plugins apps packages` → **no references anywhere**.
That also closes the coverage hole its deleted tests would otherwise have left at harvest.

### Blast radius (TEST-515, TEST-516)

```
$ git diff --stat -- packages/kit packages/contract SPEC.md apps/ui/src apps/server
(empty)
```

Files this stage touched: `ui/queries.ts`, `ui/queries.test.ts`, `ui/TodosColumn.tsx`,
`ui/TodosColumn.test.tsx`, `ui/TodoListItem.tsx`, `ui/TodoListItem.test.tsx`, `ui/testing.tsx` (a
`lists` option and a `listPayload` helper for the aggregate), `server/routes.ts` (the fingerprint
route) and `server/routes.test.ts` (its tests) — exactly Adjudication 6's list for this side of the
split, and **`items.ts` was not touched** after PLUGINS-005's drill completed.

**One deviation from the staging, reported rather than hidden (Adjudication 3/6/16).** The
orchestrator ran 005 → 006 → 007 as one session in one working tree. Each stage was implemented and
fully verified — scoped suite, lint, typecheck and its own real-server drill — before the next began,
and no stage's drill was run against another's code. But the tree now holds one combined diff, and
several files carry hunks from two stages (`manifest.ts` 005+006, `server/routes.ts` 005+007,
`ui/testing.tsx` 005+007, `parity.test.ts` 005+006, `TodosColumn`/`TodoListItem` 005+007), so **the
diff cannot be split into three commits that each build.** The orchestrator's call; the honest
options are one commit naming all three ids, or three commits where the intermediate ones do not
typecheck.

### Machine hygiene

```
$ lsof -nP -iTCP:9184 → free   9185 → free   5291 → free   8765 → free (untouched, never proxied)
$ ps aux | grep -cE '[p]laywright|[v]itest' → 0
$ ls -d /Users/theophanerupin/code/corpus/.corpus
ls: /Users/theophanerupin/code/corpus/.corpus: No such file or directory
```

The dev proxy was proved before the browser opened:
`curl -s http://localhost:5291/api/health` → `{"status":"ok",…,"workspace":"…/s017-plugins007-hsU4Oe"}`
— this drill's own workspace, from my server on `9184`, with `8765` unbound throughout. No `git`
state-changing command was run in this repository.

### Tests

`VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run plugins/todos` → **9 files, 216 tests**, green.
`npm run build`, `npm run typecheck`, `npm run lint` and Prettier all green. Playwright was not run
again for this issue (PLUGINS-006 owns the batch's single scoped run).

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
