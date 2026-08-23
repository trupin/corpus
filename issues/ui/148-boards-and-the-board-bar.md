# [UI-148] Boards: the board bar, columns read from the board document, order and pin writes go to the board, one board always open

## Domain
ui

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: CONTRACT-074, SERVER-138
- Blocks: UI-149, UI-152, UI-153

## Spec References
- SPEC.md §10 — "UI — the board" (rider 2: boards as documents; rider 1's last sentence: a board document in the explorer is the board)
- `design/navigation.html` — the board bar, tab reorder, the board document's reader

## Summary
Today `useColumns` asks for `GET /api/docs?pinned=true&type=view&sort=order` and the strip is the answer. After this issue the strip is one board's `columns`, the board bar above the board lists every board, and every write that used to touch a view's `order` or `pinned` touches the board document instead. The prototype is the reference for every control named here.

## Acceptance Criteria
- [x] `useBoards()` reads `GET /api/docs?type=board&sort=order` (archived excluded by default) and `useColumns(boardId)` resolves the board's `columns` against `GET /api/docs?type=view` by id, in the board's order; an id that resolves to nothing renders an error column card naming the id (the §10 "error card" pattern), never a crash.
- [x] The board bar: one tab per board in `order`, the showing board marked, `＋` creates an empty board document (`type: board`, `folder: boards`, `columns: []`, `order` = last + 1) and switches to it, `×` archives the board document (present only when more than one board shows; archiving the last is refused with a toast), right-click offers Rename, Move left/right, Make it the default open target, Archive, Delete (asks first).
- [x] Tabs drag to reorder; the drop writes `order` on every board, one `updateDocById` batch (or the server's multi-write if SERVER-138 exposes one), one toast. `⌘1`…`⌘9` switch boards in bar order.
- [x] Which board shows is browser-local and survives reload; a browser that remembers no board shows the `default-open` board, else the first in `order` (§10 amendment, 2026-08-22); a remembered board that is archived or deleted falls back the same way.
- [x] Column reorder (`columnOrder.ts`, `useColumnOrder.ts`, `⇧←/⇧→`) rewrites the board's `columns`; `newList.ts`/`useSaveAsView.ts`/`useCreateInColumn.ts` create the view **without** `pinned`/`order` and append its id to the current board; "Remove from this board" filters `columns` and leaves the view document alone.
- [x] Column width keeps riding the view's `extra` (unchanged).
- [x] The board document's reader shows its frontmatter and a one-line explanation (prototype: "A board is a document. Edit columns here…"); the explorer hook `openBoard(id)` (restore if archived, then show) is exported for UI-150.
- [x] Board-local state moves to version 3: `corpus.board` becomes `{ version: 3, board: id, boards: { [id]: { columns: {...} } } }`; a v2 blob is discarded (one lost scroll position per column, the v2 precedent).
- [x] e2e: `board.spec.ts`'s "ghost column with nothing pinned" becomes "a board with no columns shows the empty state and the ghost column"; `stubCorpus.ts` serves `type: board` documents; a new `boards.spec.ts` covers create, archive-refused-at-one, reorder-writes-order.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/board/useBoards.ts` (new), `useColumns.ts`, `viewDoc.ts` (drop `order`/`pinned` reads)
- `apps/ui/src/shell/BoardBar.tsx` (new), `shell/Shell.tsx` (mount between Topbar and Board), `shell/Board.tsx` (take `boardId`)
- `apps/ui/src/board/columnOrder.ts`, `useColumnOrder.ts`, `newList.ts`, `useSaveAsView.ts`, `useCreateInColumn.ts`, `NewListPicker.tsx`
- `apps/ui/src/board/useBoardLocalState.ts` — v3
- `apps/ui/src/reader/DocView.tsx` — board frontmatter rendering (small)
- `apps/ui/e2e/stubCorpus.ts`, `board.spec.ts`, `boards.spec.ts` (new)

### Key Implementation Details
- Keep `BoardColumn` as the rendered shape; only its source changes. `compareColumns` goes; order is the board's array order.
- The bar is chrome like the topbar: `flex: none`, fixed height, tab titles truncate (SPEC §10: nothing resizes because of what it holds).
- One board always open: compute from the non-archived list length, both for hiding `×` and for refusing the act.

### Edge Cases
- Two boards with the same `order`: title, then id, as `sort=order` already does.
- A board whose `columns` lists the same view twice: render it twice (the file says so), no dedupe.
- No boards at all (a workspace that never ran the migration): the bar shows one disabled tab "No boards — run `corpus upgrade`" and the board is empty; nothing is invented.

## Testing Strategy
Vitest for `useBoards`, column resolution, v3 migration, the one-board rule; Playwright for the bar.

## E2E Verification Plan
### Verification Steps
1. Real app on a fresh `corpus init` (AGENT-042 seeds): three tabs in order; drag Files first; reload; order holds; `corpus doc show` on each board shows the rewritten `order`.
2. Archive Attention and Files → `×` gone on the last; archive via menu refused.

## E2E Verification Log

**ui-dev, 2026-08-22, on opus.** Real `corpus` server (`corpus init` + `corpus
server start`, port 8766), real Vite dev server proxying to it (`5373`,
`CORPUS_SERVER_ORIGIN` + `VITE_CORPUS_TOKEN`), real Chromium at 1440×900 driven
by Playwright. `page.on("pageerror")` was collected on every drill and was empty
throughout.

### 1. The bar is the board documents, in `order`

The seed workspace ships three boards. Read back from the server before touching
the UI:

```
doc_seedboardattention | Attention  | order 1 | columns ["doc_seedattention","doc_seedinbox","doc_seedopenthreads"] | kanban null
doc_seedboardbystatus  | By status  | order 2 | columns null                                                        | kanban status
doc_seedboardfiles     | Files      | order 3 | columns []                                                          | kanban null
```

In the browser:

```
TABS: ["Attention","By status","Files"]      SHOWING: doc_seedboardattention
TAGS: ["kanban"]                             (the By status tab, and no `default` — no seed board carries the flag)
COLUMNS ON ATTENTION: ["Attention","Inbox","Open threads"]     ROWS: 3
```

The columns are the board's `columns` resolved against `type: view` documents,
in the board's order. Two requests, not four: `?type=board&sort=order` and
`?type=view`.

**Two boards at the same `order`** (edge case 1) was exercised by accident and
kept as evidence: three duplicate boards created by hand landed at orders 1, 2, 3
beside the seed's, and the bar drew all six in title-then-id order —
`Attention`(seed) · `Attention`(mine) · `By status` · `Notes by status` ·
`Files`(mine) · `Files`(seed). The duplicates were then deleted.

### 2. The bar is chrome

`BAR HEIGHT: 38  flex: 0/0`. Renaming a tab to a 76-character title left the bar
at 38px and the board's top edge unmoved, at 1280px and again at 420px, where the
title truncated and gave its whole self to the tab's `title` attribute
(`boards.spec.ts`, "holds its height and the board's place whatever a board is
called"). Falsified — see F6 below.

### 3. Which board shows, and where it is remembered

```
click Files      → SHOWING doc_seedboardfiles
                   EMPTY:  "Files is empty · Add columns to boards/doc_seedboardfiles.md — …"
                   GHOST:  1
reload           → SHOWING doc_seedboardfiles
localStorage     → {"version":3,"board":"doc_seedboardfiles","boards":{}}
Ctrl+1           → doc_seedboardattention
Ctrl+3           → doc_seedboardfiles
```

Nothing about the choice reached a document. `⌘n` is pressed with Control in the
suites because Chromium claims `⌘2` for its own tab switching before the page
sees it; the registry accepts either (`metaKey || ctrlKey`).

### 4. Reordering boards writes `order` on every board that moved

Dragging Files to the front:

```
TABS AFTER DRAG: ["Files","Attention","By status"]
TOAST:           "Board order written — 3 board documents updated and committed."
AFTER RELOAD:    ["Files","Attention","By status"]
```

On disk afterwards — `files.md order: 1`, `attention.md order: 2`,
`by-status.md order: 3`. In the workspace's git log the three writes arrived as
one `editing session: 3 documents by user` commit, which is §4's window
delivering rider 2's "in one commit" without a multi-document route.

### 5. Create · rename · default-open · archive

```
＋            → TABS ["Files","Attention","By status","New board"], showing it,
                POST /api/docs {type:"board",title:"New board",folder:"boards",columns:[],order:4}
Rename        → TABS [… ,"Reading"]                       (PUT title on the board document)
Make default  → the tab gained the `default` tag; one PUT, on that board only
✕             → TABS ["Files","Attention","By status"]
                TOAST "Archived — “Reading” left the bar; it is still in the corpus, under boards/."
```

### 6. One board is always showing

Archived down to a single board:

```
TABS: ["Attention"]     ✕ COUNT ON LAST BOARD: 0
menu → Archive board:   disabled, "refused — one board is always showing"
menu → Delete board:    disabled
after pressing it:      TABS ["Attention"]   (no request left the page)
```

### 7. Column acts write the board and leave the view alone

```
COLUMNS:  ["Attention","Inbox","Open threads"]
⇧→        ["Inbox","Attention","Open threads"]
Remove from this board (on Inbox)
COLUMNS:  ["Attention","Open threads"]
```

`corpus doc show doc_seedboardattention` → `columns doc_seedattention,
doc_seedopenthreads`. `data/docs/views/inbox.md` is still on disk, still
`status: open`, and carries no `pinned` key. Neither a `DELETE` nor an `/archive`
was issued.

### 8. The ghost column, and the board document's reader

```
PICKER OFFERS: 📁 boards · 📁 inbox · 📁 templates · 📁 views · four presets
choose boards/ → COLUMNS ["Attention","Open threads","boards"]
                 TOAST "Added to “Attention” — a view document was created for “boards” and listed on the board."
open doc_seedboardattention from that column:
  FM BLOCK: --- type: board  order: 2  columns:  - doc_seedattention  - doc_seedopenthreads  - doc_sc5o4ofg ---
  NOTE:     "A board is a document. Edit columns here, or ask the agent to — the board bar follows."
```

Two writes, in that order: the view document, then the board's `columns`.

### 9. A workspace with no boards (edge case 3)

The last board was archived out of band (`corpus doc archive`), which the server
permits and the UI refuses:

```
TABS WITH A BOARD: 0
DISABLED TAB:      "No boards — run `corpus upgrade`"
  title:           "This workspace holds no `type: board` document. `corpus upgrade` reports the
                    migration that creates them, as commands to run (SPEC.md §2.4)."
COLUMNS: 0   GHOST: 0
EMPTY:   "No board is showing · This workspace holds no type: board document. Run corpus upgrade, …"
```

No ghost column, because a new list would have nowhere to land. Nothing invented.

### 10. Edge case 2 — a board listing the same view twice

Not reachable through the seed, so it is pinned in
`useColumns.test.tsx`: `["doc_1","doc_2","doc_1"]` renders three columns with
`viewId` `doc_1, doc_2, doc_1` and slot ids `doc_1, doc_2, doc_1#1`. The slot id
is what keeps the two copies addressable in the DOM and separately scrolled.

### Automated suites

- `apps/ui` + `packages/kit` unit: **216 files, 4299 tests, 0 failures.**
- Playwright, whole suite: **505 tests, 0 failures** (`CORPUS_UI_PORT=5273`).
- `tsc --noEmit`, `eslint --max-warnings=0`, `prettier --check`: clean.

### Falsification — every rule broken, and the test that caught it

| # | Rule broken | What was mutated | Result |
| --- | --- | --- | --- |
| F1 | Columns render in the **board's** order | `useColumns` sorts the ids | `useColumns.test.tsx` 2 failed |
| F2 | One board is always showing | the `boards.length <= 1` guards removed | provider + bar suites, 2 failed |
| F3 | A column write edits the **board** document | `useColumnOrder` writes the first view instead | `useColumnOrder` + `Board`, 8 failed |
| F4 | A v2 blob is **discarded**, never migrated | the reader migrates v2's `columns` under a board key | `useBoardLocalState.test.ts` 1 failed |
| F5 | An unresolved id is a card, not a gap | `useColumns` filters missing ids out | `useColumns.test.tsx` 4 failed |
| F6 | The bar is chrome | `height` → `min-height`, tabs `flex-wrap: wrap` | `boards.spec.ts` red: bar 44.7px against 38 |
| F7 | The server clears `default-open` | the client clears the other boards too | `BoardBar.test.tsx` 1 failed |

Every mutation was reverted and the suite re-run green in the same step.

**One test that could not fail, and what was done about it.** F4's first mutation
— accepting `version: 2` without reading anything out of it — left
`useBoardLocalState.test.ts` green, because a v2 blob has no `boards` key and so
degrades to the empty state either way. The test pins the *behaviour* (a v2 blob
yields no column state) rather than the version number, which is the right
claim; the mutation that a careless migration would actually be — reading v2's
`columns` across — does turn it red, and that is F4 as recorded.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[UI-148]` prefix
