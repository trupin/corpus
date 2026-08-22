# [UI-003] Board columns: pinned view docs, reorder, new-list

## Domain

ui

## Status

done

## Priority

P0

## Model

opus — the model is pinned ("columns ARE documents"), the chrome is pinned by the prototype, and the persistence rule (view doc vs. localStorage) is stated in the spec; the work is disciplined implementation.

## Dependencies

- Depends on: UI-002, SERVER-011
- Blocks: UI-005, UI-009, PLUGINS-001

## Spec References

- SPEC.md §10 — "The board" (horizontally scrolling strip of columns, snap scrolling, trailing ghost column)
- SPEC.md §10 — "Columns are pinned view documents" (a column IS a `type: view` document with `pinned: true`; frontmatter holds the query and `order`; only browser-local state stays local)
- SPEC.md §10 — "Folder scoping" (folder columns scope by directory; threads inherit their parent's folder)
- SPEC.md §10 — "Creating documents — zero-form, inbox-first" (＋ on non-folder columns creates into `data/docs/inbox/`; a folder column's ＋ creates into its folder; the new document opens immediately, title selected)
- SPEC.md §9.2 — `GET /api/docs`, `GET /api/tree`, `POST /api/docs`, `PUT /api/docs/:id`
- SPEC.md §10 — plugin column types (`column: "<plugin>/<type>"` in a view document's frontmatter)
- SPEC.md §12 M3 — the board's executable check (drag a column → its `order` frontmatter updates)
- `design/index.html` — **authoritative look & feel** (`.board`, `.col`, `.col-head`, `.chips`, `.sort`, `.ghost-col`, drag states)

## Summary

Render the board: columns come from `type: view, pinned: true` documents sorted by their `order` frontmatter, each with the prototype's chrome (title, mono kind label, count, ＋, ⋯, filter-chip row, sort label) and a list of rows fetched with `useDocs(column.query)`. Reordering — by dragging the column header or with `⇧←`/`⇧→` — writes the view document's `order` through `PUT /api/docs/:id`, so board layout is corpus state: auto-committed, agent-stewardable, and identical across browsers. A trailing ghost column opens the new-list picker, which creates a pinned view document for a folder, a preset view, a plugin column type, or the current search. Only scroll positions and open readers stay in `localStorage`.

## Acceptance Criteria

- [x] Columns render from `useDocs({ type: "view", pinned: true })` (or the contract's equivalent filter), sorted ascending by the `order` frontmatter field; nothing about the column set is hardwired in code.
- [x] Column chrome matches `design/index.html`: `336px` wide card (`--surface`, `1px --line`, `12px` radius, `--shadow-soft`), header with `.col-title` (14px, 600), `.col-kind` mono uppercase label (`VIEW` / `FOLDER` / `PLUGIN`), right-aligned mono `.col-count`, `＋` add button, `⋯` menu button, then a `.chips` row of filter chips with the `.sort` label pushed right.
- [x] The count reflects the column's live result count from its `useDocs` query.
- [x] The filter-chip row is derived from the view document's stored query (folder, type, status, tag, `needs`, …), rendering active filters with the `.chip.on` treatment.
- [x] Rows render through a `Row` component contract (props: the doc record + column context); the row's internals are UI-004's — this issue must not inline row markup beyond a minimal placeholder that UI-004 replaces.
- [x] Dragging a column by its header reorders it: HTML5 drag-and-drop, the dragged column takes the `.dragging` treatment (`opacity: 0.55`, dashed border), and the insertion point is computed by midpoint (`e.clientX < rect.left + width/2`), matching the prototype.
- [x] On drop, the affected view documents' `order` values are persisted via `PUT /api/docs/:id`; a page reload (and a second browser) shows the new order.
- [x] `⇧←` / `⇧→` move the active column one position left/right and persist `order` identically — keyboard drag is not a second, weaker code path.
- [x] A trailing `.ghost-col` ("＋ New list — a folder, a view, or any filter", dashed, `220px`) opens a picker positioned at the click point offering: **a folder** (options from `GET /api/tree`, with doc counts), **a library/preset view**, **a plugin column type** (from discovered manifests), and **from current search** (when a search query is active).
- [x] Every picker choice creates a **pinned view document** via `POST /api/docs` with the appropriate query frontmatter (`folder:` for folders, filters for presets, `column: "<plugin>/<type>"` for plugin columns) and `order` set to last; the new column appears and is scrolled into view.
- [x] Folder columns scope by directory **and include threads whose parent lives in that folder** (threads inherit their parent's folder per SPEC.md §10).
- [x] `＋` on a **folder** column creates a document into that folder; `＋` on any other column creates into `data/docs/inbox/`; the new document opens immediately in that column with its title selected for typing.
- [x] The column `⋯` menu (a stub in the prototype — implement it) offers **Rename**, **Edit query**, and **Unpin**; rename and edit-query `PUT` the view document, unpin **archives** it (`status: archived`) rather than deleting it.
- [x] Browser-local state — per-column scroll position and which document each column has open — persists in `localStorage` under a namespaced key; **no query, order, or column identity is ever stored locally**.
- [x] The board scrolls horizontally with `scroll-snap-type: x proximity` and columns `scroll-snap-align: start`; the active column carries the `.kactive` cue (`box-shadow: 0 0 0 2px var(--accent-wash), var(--shadow-soft)`) and follows focus/hover.
- [x] A column whose `useDocs` query fails renders an inline error card in place; the rest of the board keeps working.

## Technical Design

### Files to Create/Modify

- `apps/ui/src/board/Board.tsx` + `Board.css` — the scroller; owns column ordering, drag state, active-column tracking (replaces UI-001's placeholder)
- `apps/ui/src/board/useColumns.ts` (+ test) — fetches pinned view docs, parses their query frontmatter, sorts by `order`
- `apps/ui/src/board/useColumnOrder.ts` (+ test) — computes new `order` values and issues the `PUT`s (shared by drag and keyboard)
- `apps/ui/src/board/Column.tsx` + `Column.css` — a single column card
- `apps/ui/src/board/ColumnHead.tsx` — title / kind / count / ＋ / ⋯ / chips / sort
- `apps/ui/src/board/ColumnMenu.tsx` (+ test) — rename, edit query, unpin
- `apps/ui/src/board/ColumnList.tsx` — the scrolling row list; renders `Row` (kit) per result
- `apps/ui/src/board/NewListGhost.tsx` + `NewListPicker.tsx` (+ test) — ghost column and positioned picker
- `apps/ui/src/board/useCreateInColumn.ts` (+ test) — ＋ semantics (folder vs. inbox vs. plugin doc type)
- `apps/ui/src/board/useBoardLocalState.ts` (+ test) — localStorage: scroll positions, open readers
- `apps/ui/src/board/viewDoc.ts` (+ test) — parse/serialize the view-document frontmatter contract (query, order, pinned, column)
- `apps/ui/e2e/board.spec.ts` — Playwright

### Key Implementation Details

**The view-document contract.** A column is a document; treat its frontmatter as the schema and validate it with Zod at the boundary:

```yaml
type: view
pinned: true
order: 30 # board position, ascending
title: Finance # the column title
column: todos/board # optional — a plugin column type (SPEC.md §10)
query: # the GET /api/docs filter set
  folder: finance/
  tag: [housing]
  sort: updated_desc
```

An unparseable view document must render an error card naming the document (with a link to open it) — never crash the board, and never silently drop the column.

**Order values.** Use sparse integers (e.g. multiples of 10) so a single insert usually rewrites one document. On drop, compute the target index, then write the minimum set of `order` values that realizes it; if the gap is exhausted, renumber the whole board in one pass. Every write is a `PUT /api/docs/:id` — the server auto-commits, so this is a visible, agent-stewardable act (SPEC.md §10).

**Drag.** Follow the prototype exactly: the header is the drag handle (`cursor: grab` / `grabbing`); `mousedown` on the header (but not on a button) sets `draggable` on the column and `mouseup` clears it, so buttons stay clickable. `dragover` finds the first non-dragging column whose midpoint is right of the pointer and inserts before it (or before the ghost column). Persist on `dragend`, not on every `dragover`.

**Keyboard move.** `⇧←`/`⇧→` on the active column call the same `useColumnOrder` mutation as drag. Keep the DOM reorder driven by the fetched-and-sorted column list (i.e. re-render from state after the mutation), not by imperative `insertBefore` alone — the prototype does the imperative thing because it has no data layer; we do not.

**New-list picker.** A positioned menu (prototype: `.ac-menu` styling, clamped to the viewport) opened from the ghost column. Sources: folders from `useTree()` with their doc counts, presets from a small hard-coded library (Attention `needs=me`, Open threads `type=thread status=open`, Skills & agents `type=skill|agent-def`), plugin column types from the discovered manifests (PLUGINS-001 supplies the registry — until then, render the "plugin column types appear here too" affordance the prototype shows), and "from current search" when UI-009's search state holds a query. Each choice is one `POST /api/docs`.

**Creation semantics (＋).** Resolve from the column's view document: a `folder:` query ⇒ create into that folder; a plugin `column:` ⇒ create that plugin's doc type; everything else ⇒ `data/docs/inbox/`. After creation, open the new document in that column with the title focused and selected. UI-009's omnibox creates the same way — factor the creation call into `useCreateInColumn` so both paths share it, and note in code that the final creation UX is settled with UI-009.

**Local vs. corpus state.** The dividing line is explicit in SPEC.md §10 and is a review-blocking correctness rule: **corpus** = which columns exist, their queries, their order, their titles; **local** = scroll positions, which reader is open, per-reader nav stacks (UI-005). Namespace the localStorage key (e.g. `corpus.board`) and version it so a schema change degrades to defaults rather than throwing.

**Toasts.** Reorder, pin, and unpin narrate themselves per the prototype's convention (bottom-right, max 3, 6 s) — e.g. "Pinned — a view document was created for "Finance" (pinned: true, order: last)." Use the shared toast surface; if it does not exist yet, add a minimal one in `apps/ui/src/shell/` styled per `.toast-wrap`/`.toast` and let UI-011 take it over.

### Edge Cases

- **Zero pinned view documents** — the board shows only the ghost column with inviting copy; never a blank screen.
- **Duplicate or missing `order` values** — sort deterministically (order, then title, then id) and renumber on the next write rather than refusing to render.
- **A view document archived or deleted out-of-band** (the agent stewarding the board) — the column disappears live via SSE; if it had a reader open, close it gracefully and drop its local entry.
- **Drag interrupted** (dropped outside the board, `Esc`) — restore the pre-drag order; persist nothing.
- **Concurrent reorder** (the agent rewrites `order` while the user drags) — last write wins; the board re-renders from the refetched documents, so the user sees the reconciled order rather than a phantom.
- **Plugin column type not installed** (a view doc references `column: "todos/board"` with the plugin removed) — render a "plugin missing" card per SPEC.md §12 M5, keeping the column in place.
- **Folder column and thread inheritance** — verify a thread whose parent is in `finance/` shows in the `finance/` column even though thread files live in `data/threads/`.
- **Very long column titles / many filter chips** — the header must not push the count, ＋, or ⋯ out of the card; truncate the title with ellipsis and wrap the chip row.
- **`⇧←`/`⇧→` at the ends** — no-op silently; do not wrap around and do not write.
- **localStorage unavailable/full** (private mode) — degrade to in-memory state without breaking the board.

## Testing Strategy

Vitest + React Testing Library in `apps/ui` (kit hooks stubbed at the client boundary, not below it):

- `viewDoc` parsing: valid frontmatter round-trips; missing `order` defaults sanely; malformed query yields a typed error the UI can render.
- `useColumns`: sorts by `order`; ties break deterministically; archived view documents are excluded.
- `useColumnOrder`: moving a column to each position produces the expected minimal set of `PUT` calls; a gap-exhausted board triggers a full renumber; end-of-board keyboard moves are no-ops.
- `Column`/`ColumnHead`: renders kind label per view type, live count, chips from the stored query, and the sort label; long titles truncate.
- `ColumnMenu`: rename issues a `PUT` with the new title; edit query issues a `PUT` with the new query; unpin issues a `PUT` setting `status: archived` (never a `DELETE`).
- `NewListPicker`: renders folder options from a stubbed `useTree`, presets, and the from-search entry only when a search query exists; each choice issues a `POST /api/docs` with the expected frontmatter.
- `useCreateInColumn`: folder column → folder path; view/plugin column → `docs/inbox/`; returns the created id so the caller can open it.
- `useBoardLocalState`: persists and restores scroll/open-reader state; a corrupt or version-mismatched blob falls back to defaults.
- Error rendering: a column whose query rejects renders the error card and its siblings still render.

## E2E Verification Plan

Against the **real running application**, exercising SPEC.md §12 M3's board checks. Assert both the UI state **and** the on-disk view document.

### Verification Steps

1. Start the server against a workspace seeded with starter view documents (Attention, Inbox, Open threads) and start the UI dev server.
2. Load the board: assert one column per pinned view document, in `order`, with the correct kind labels, counts, and filter chips.
3. Drag the third column to the first position. Then, on disk, `cat` the affected view documents — assert their `order` frontmatter changed and `git log -1` shows the auto-commit. Reload the page — assert the new order persists. Open a second browser context — assert it shows the same order (proving it is corpus state, not local).
4. Focus a column and press `⇧→` — assert the column moves and the view document's `order` updates the same way.
5. Click the ghost column: assert the picker lists real folders from `GET /api/tree` with counts. Choose a folder — assert a new column appears, a new `type: view, pinned: true` document exists on disk with the `folder:` query, and it is committed.
6. Press `＋` on the folder column — assert a document is created **in that folder** on disk and opens in the column with its title selected. Press `＋` on the Attention column — assert the created file lands in `data/docs/inbox/`.
7. Verify folder/thread inheritance: create a thread on a document inside `finance/` (via CLI), and assert it appears in the `finance/` folder column.
8. Column `⋯` → Rename: assert the title changes on screen and in the view document's frontmatter. `⋯` → Edit query: change a filter and assert both the rendered rows and the stored query change. `⋯` → Unpin: assert the column disappears and the view document is `status: archived` on disk (still present, not deleted).
9. Out-of-band stewardship: `corpus doc edit` a view document's `order` (or create a new pinned view) and assert the board updates live over SSE with no reload.
10. Scroll a column's list, reload the page, and assert the scroll position is restored from local state — while confirming nothing about queries or order was written to `localStorage` (inspect the stored blob).
11. Deliberately corrupt one view document's frontmatter and assert only that column shows an error card while the board stays usable.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. Must be from real E2E
testing — no mocks, no test clients. Real application, real requests, real
interfaces. Include specific commands run, actual outputs observed, and pass/fail
conclusions. State which model the implementing agent ran on ("implemented on:
opus | fable") — the audit trail for recalibrating Model recommendations. The
evaluator will reject issues without credible proof._

**implemented on: opus**

### Reproduction (bugs only)

Not a bug — a feature issue. No reproduction step applies.

### Post-Implementation Verification

**Environment.** A real `corpus init` workspace on port `8905`
(`/tmp/corpus-u003-3s7Q7I`), a real server process, the real Vite dev server on
`CORPUS_UI_PORT=5273` proxying to it (`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8905`,
`VITE_CORPUS_TOKEN` from `.corpus/config.json`), and real Chromium driven by
Playwright. `8765` was verified unbound before, during and after. Every process
was stopped by captured pid at the end; `8765`, `5273` and `8905` all free, and
nothing left listening in `8900`–`8999`.

```
$ corpus init "$WS" --port 8905
Initialized Corpus workspace at /tmp/corpus-u003-3s7Q7I
  port 8905, token in .corpus/config.json (mode 600)
  git: initialized on main, one commit authored as user
$ corpus server start --workspace "$WS"
corpus 0.0.0 listening on http://127.0.0.1:8905 (pid 42378)
```

Seeded with the real CLI: `finance/mortgage-options.md`, `finance/emergency-fund.md`,
`home/wifi-password.md`, `inbox/captured-thought.md`, plus two threads on the
finance document created over HTTP.

---

#### 1. The column set is the corpus, in one bounded request

```
$ curl .../api/docs?pinned=true&type=view&sort=order      →  3 items
   doc_seedattention  order 1  query {needs: me}
   doc_seedinbox      order 2  query {folder: inbox}
   doc_seedopenthreads order 3 query {type: thread, status: open}
```

Board loaded in Chromium:

```
titles : [ 'Attention', 'Inbox', 'Open threads' ]
kinds  : [ 'view', 'folder', 'view' ]          ← derived, not typed
counts : [ '0', '1', '2' ]                     ← live result counts
chips  : [ 'needs: me | last activity ↓',
           'folder: inbox/ | last activity ↓',
           'type: thread · status: open | last activity ↓' ]
ghost  : '＋ New list — a folder, a view, or any filter'
api requests: GET /api/docs?pinned=true&sort=order&type=view   ← exactly ONE for the set
              GET /api/docs?needs=me · ?folder=inbox · ?status=open&type=thread
              (one per column's own results; no GET /api/docs/{id} at all)
```

Nothing about the set is hardwired — grep over the shipped source is empty:

```
$ grep -rn "Attention\|Open threads\|needs=me" apps/ui/src packages/kit/src
(no matches)
```

(`newList.test.ts` asserts the same thing about the preset library, which is
deliberately disjoint from the seed columns — see "Adjudications" below.)

#### 2. Column chrome, both themes

```
light  {"width":"336px","background":"rgb(255,255,255)","border":"1px solid rgb(227,225,218)",
        "radius":"12px","shadow":"… 0 2px 8px","snapAlign":"start","boardSnap":"x",
        "title":"14px/600","kindFont":"ui-monospace","kindTransform":"uppercase",
        "kindSpacing":"0.6px","countFont":"ui-monospace","countMargin":"128.469px"}
dark   {"width":"336px","background":"rgb(29,32,37)","borderTopColor":"rgb(44,47,54)",
        "radius":"12px","--line":"#2c2f36","--surface":"#1d2025"}
kactive shadow (dark): rgba(127,161,212,0.14) 0 0 0 2px, rgba(0,0,0,0.3) 0 2px 8px
.col.dragging          {"opacity":"0.55","borderStyle":"dashed"}
```

`.col-kind` at `0.06em` renders as `0.6px` at 10px. The `.kactive` cue follows
hover: `kactive: doc_seedattention` → after hovering the third column,
`doc_seedopenthreads`.

*(Note for the next reader: reading `border-color` immediately after the theme
toggle returns the light value mid-transition — `.col` carries the prototype's
`transition: border-color 0.3s`. Wait for it to settle before asserting.)*

#### 3. Drag → `order` on disk → committed

Real HTML5 drag in Chromium (Playwright `dragTo` on the header):

```
draggable after mousedown on .col-head: "true"
before: [ 'Attention', 'Inbox', 'Open threads' ]
after : [ 'Open threads', 'Attention', 'Inbox' ]
PUTs  : [ 'PUT /api/docs/doc_seedopenthreads' ]        ← ONE write
toast : 'List moved — “Open threads” reordered; 1 view document updated and committed.'
uncaught: []
```

On disk, and in git:

```
$ git -C "$WS" show HEAD --stat
doc edit: Open threads (doc_seedopenthreads) by user
 data/docs/views/open-threads.md | 4 ++--

-updated: 2026-07-26T00:00:00Z
+updated: 2026-07-28T04:23:14Z
-order: 3
+order: 0
```

`id`, `type`, `title`, `tags`, `status`, `anchors`, `evergreen`, `pinned` and the
whole `query:` block are **byte-identical** — the only changed lines are `order`
and the server's own `updated`. `attention.md` was not touched at all.

#### 4. It is corpus state, not browser state

```
reload           : [ 'Attention', 'Open threads', 'Inbox', 'finance' ]
second context   : [ 'Attention', 'Open threads', 'Inbox', 'finance' ]
its localStorage : {"corpus.theme":"system"}      ← no board state at all
```

A fresh browser profile that has never seen this board renders the same order,
because the order is in the documents.

#### 5. Keyboard move is the same code path

```
hover 'Open threads'  →  Shift+ArrowRight
titles: [ 'Attention', 'Inbox', 'Open threads', 'finance' ]
writes: [ 'PUT /api/docs/doc_seedopenthreads' ]     (order 30 → 35, one document)
```

And on the *tight* seed board (`order: 0,1,2`, no integer between neighbours) the
same gesture correctly renumbers in one pass:

```
writes: PUT doc_seedattention · PUT doc_seedopenthreads · PUT doc_seedinbox
on disk afterwards: attention 10, inbox 30, open-threads 35, finance 40
```

At either end it is silent:

```
active: doc_seedattention → Shift+ArrowLeft
requests issued: 0  []
titles unchanged; git log -1 unchanged
```

#### 6. Interrupted drag persists nothing

```
dragging class present: 1
mid-drag order:  (preview applied)
Escape → order restored to the pre-drag sequence
restored: true
writes  : []            ← no PUT, no POST, no DELETE
```

#### 7. The ghost column and the new-list picker

```
$ click .ghost-col   →  .ac-menu.open at {"x":1000,"y":364,"width":280,"height":200}
📁 finance   4 docs        📁 home   1 doc        📁 inbox  1 doc
📁 templates 1 doc         📁 views  3 docs
🧵 Due this week  due=week            🧵 Unread replies  needs=unread-reply
🧵 Stale for review stale=stale       🧵 Skills & agents type=skill,agent-def
🧵 Archived status=archived
"plugin column types appear here too (e.g. a todos board)"
```

Counts match `GET /api/tree` exactly (`finance 4 4 · home 1 1 · inbox 1 1 ·
templates 1 1 · views 3 3`). "From current search" is **absent** — no search
query exists (`DEFERRED → UI-009`). The plugin entry is the prototype's inert
affordance (`DEFERRED → PLUGINS-001`).

Choosing `finance`:

```
POSTs : [ 'POST /api/docs' ]     ← one request
titles: [ 'Attention', 'Open threads', 'Inbox', 'finance' ]   (scrolled into view)
toast : 'Pinned — a view document was created for “finance” (pinned: true, order: last).'
$ cat data/docs/views/finance.md
type: view · pinned: true · order: 40 · evergreen: true · query: {folder: finance}
$ git log -1  →  "doc create: finance (doc_yrdw64qj) by user"
```

#### 8. Folder scoping includes inherited threads

```
column "finance": count 4, chips "folder: finance/", rows:
  thread: Rate question        (data/threads/th_azmthzuk.md)
  thread: Rate question        (data/threads/th_vz2ekrox.md)
  note:   Emergency fund       (data/docs/finance/emergency-fund.md)
  note:   Mortgage options     (data/docs/finance/mortgage-options.md)
```

Thread files live in `data/threads/` and still appear in the `finance/` column,
per SPEC.md §10.

#### 9. ＋ semantics

```
＋ on "finance"   → POST /api/docs  → data/docs/finance/untitled.md
                    reader opens on doc_vzxerorl
                    title field: "Untitled"
                    {focused: true, selectionStart: 0, selectionEnd: 8, length: 8}  ← SELECTED
                    toast: 'Created in finance/ — committed; the title is selected.'
＋ on "Attention" → POST /api/docs  → data/docs/inbox/untitled.md
                    toast: 'Created in inbox/ — committed; the title is selected.'
```

The `folder` field is **omitted** for a non-folder column so the contract's own
inbox-first default applies; the file landing in `data/docs/inbox/` is the proof.

#### 10. The ⋯ menu

```
Rename     → PUT /api/docs/doc_yrdw64qj  {title:"Money"}
             on screen: 'finance' → 'Money';  order/query/pinned untouched
Edit query → field pre-fills with the stored query in the wire's grammar: "folder=finance"
             typed "folder=finance&type=thread" →
             chips  : "folder: finance/ · type: thread"
             count  : 2
             rows   : [ 'Rate question', 'Rate question' ]    ← rows changed to match
             on disk: query:\n  folder: finance\n  type: thread
Unpin      → PUT /api/docs/doc_yrdw64qj  {status:"archived"}
             writes: no DELETE anywhere in the network log
             on disk: data/docs/views/finance.md STILL EXISTS, status: archived,
                      pinned: true, order: 40, query intact
             toast: 'Unpinned — “Money” was archived, not deleted; it is still in the corpus.'
```

#### 11. Live over SSE, with no reload

```
created out of band (POST /api/docs)  → board went 3 → 4 columns, no reload
renamed + reordered out of band (PUT) → 'Home' → 'Household', moved to first, no reload
archived out of band (PUT)            → column disappeared, no reload
```

Parallel `curl -N /events` capture during a document creation:

```
:connected

event: invalidate
data: {"keys":[["docs"],["docs","doc_pv3tjke6"],["tree"]]}
```

Grepped for the document's title: **0 matches**. Only key shapes cross the
stream (SPEC.md §2.2 rule 3).

#### 12. Failure modes, in place

```
plugin missing  (column: "todos/board", no plugin installed)
  kind: "plugin";  card: "Plugin not installed — This column renders todos’s board
  view. Install the plugin, or edit this list’s query."   Column keeps its position.

malformed column ref (hand-edited `column: todos`)
  card: "This list’s view document is unreadable — “BadCol” (doc_g7lrgkuu) — its
  `column` frontmatter is not a "<plugin>/<type>" reference: todos."
  plus an "Open the view document" affordance.  Siblings unaffected.

refused query (query: {sort: relevance}, which needs `q`)
  card: "This list could not be loaded — GET /api/docs failed (HTTP 400): request
  failed validation".  Siblings still rendering: 6.  uncaught: []
```

**Honest finding on the "unparseable view document" case.** Two of the plan's
step-11 variants do not behave as the plan assumed, and the reason is the server,
not the board:

- Hand-editing `query:` to a scalar (`query: folder=home`) — the **server**
  normalises it and returns `"query": null`. The row is well-formed on the wire,
  so the column renders as an unfiltered list rather than an error card. The
  client-side guard still exists (and is unit-tested) because the wire type is a
  promise about a hand-editable file, but it cannot be reached this way.
- Genuinely corrupting the YAML (`folder: [unclosed` / `: :`) — the projection
  **keeps the last good row**, so the column stays on the board with its previous
  query, the board stays fully interactive (ghost column still clickable), and
  the browser console records no uncaught error. Nothing is silently dropped.

The reachable client-side case is the malformed `column:` reference above, which
does render the named error card with an open affordance.

#### 13. Local state holds scroll and open readers, and nothing else

```
$ localStorage.getItem("corpus.board")
{"version":1,"columns":{"doc_yrdw64qj":{"scroll":0,"open":"th_azmthzuk"},
                        "doc_seedattention":{"scroll":0,"open":null}}}
$ Object.keys(localStorage)   →  ['corpus.board', 'corpus.theme']
reload → reader still open on th_azmthzuk
```

No query, no `order`, no title, no column identity beyond the id whose scroll it
is. A garbage blob and a version-mismatched blob both degrade to defaults, and
`throwingStorage()` (private mode) keeps the board interactive in memory — all
three covered in `useBoardLocalState.test.ts`.

#### 14. Long titles and many chips

```
{"colWidth":"336px","titleOverflow":"ellipsis","titleTruncated":true,
 "chips":6,"chipsWrap":"wrap","countInside":true,"addInside":true,"menuInside":true}
```

#### 15. Automated gates

```
$ npm run build                                   ✓ (contract → kit → cli → server/ui)
$ npm run typecheck                               ✓ all workspaces
$ npm run lint                                    ✓ 0 problems
$ npm run format:check                            ✓
$ vitest run apps/ui/src packages/kit/src         ✓ 42 files, 555 tests
$ CORPUS_UI_PORT=5273 npm run e2e                 ✓ 20 passed (13 shipped + 7 new)
$ lsof 8765 / 5273 / 8905                         all free after cleanup
```

---

### Handoff artifacts the next issues consume

**The kit's added mutation surface (TEST-7), verbatim.** Every board write is a
named `CorpusClient` method and a named hook exported from `packages/kit`; no
file under `apps/ui/src` calls `fetch(` or imports `@corpus/contract/client`
outside `app/apiClient.ts`.

```ts
// packages/kit — CorpusClient
createDoc(input: CreateDocInput): Promise<DocMutationResponse>;   // POST /api/docs   (new)
updateDoc(id: string, changes: UpdateDocChanges): Promise<UpdateDocResponse>;  // (shipped)

// packages/kit — hooks
export function useCreateDoc(): UseMutationResult<DocMutationResponse, Error, CreateDocInput>;
export function useUpdateDoc(docId: string): UseMutationResult<UpdateDocResponse, Error, UpdateDocChanges>;
export function useUpdateDocById(): UseMutationResult<UpdateDocResponse, Error, UpdateDocVariables>;
export interface UpdateDocVariables { readonly id: string; readonly changes: UpdateDocChanges }
export type CreateDocInput = CreateDocRequest;   // the contract's own body type
```

`useUpdateDocById` exists because one gesture (a reorder) writes several
documents and hooks cannot be called in a loop. Both bindings are **non
optimistic** and invalidate `docKey(id)` + `DOCS_KEY`; `useCreateDoc` invalidates
`DOCS_KEY` + `TREE_KEY`.

**The `Row` seam (TEST-33), as `ColumnList` uses it.** A row is told what it is
and who to call, and never which column it is in:

```tsx
<Row key={row.id} row={row} onOpen={(row: DocRow) => void} onNotify={(notice: RowNotice) => void} />
```

**Shared creation path (TEST-21).** UI-009's omnibox creates the same way:

```ts
import { useCreateInColumn, INBOX_TARGET, creationRequest } from "apps/ui/src/board/useCreateInColumn";
const { create } = useCreateInColumn();
await create(INBOX_TARGET, "Whatever the user typed");   // → new document id
```

### Adjudications and deferrals

- **TEST-1 vs TEST-17 (preset library).** TEST-1 greps `apps/ui/src` and
  `packages/kit/src` for `"Attention"`, `"Open threads"` and `needs=me` and
  requires an empty result; TEST-17 offers "Attention / `needs=me`" as an example
  preset. Both cannot hold. TEST-1 wins — it restates the issue's first
  acceptance criterion ("nothing about the column set is hardwired in code") —
  so `PRESET_CHOICES` is deliberately **disjoint from the seed columns**: Due
  this week, Unread replies, Stale for review, Skills & agents, Archived.
  TEST-17's substance (one `POST /api/docs` creating a pinned view carrying the
  preset's query, identical in shape to a folder choice) is verified with those
  presets instead, and `newList.test.ts` pins the disjointness.
- **`DEFERRED → PLUGINS-001`** — the plugin-column registry. The picker renders
  the prototype's inert affordance, and a view referencing an uninstalled plugin
  renders the plugin-missing card. Since there is no registry at all yet, every
  `column:` reference is by definition uninstalled today.
- **`DEFERRED → UI-009`** — "from current search". `NewListPicker` takes a
  `searchQuery` prop; the board passes `""`, so the entry is correctly absent.
- **`DEFERRED → UI-005`** — the reader. `apps/ui/src/board/ColumnReaderScaffold.tsx`
  is **scaffolding** and is labelled as such in its own docblock: it exists only
  to keep SPEC.md §10's creation promise ("opens immediately, title selected").
- **`STRUCK → sprint-009 Open Conflict 12`** — the server-backed Playwright spec.
  `playwright.config.ts` starts one Vite whose proxy target is fixed at
  `CORPUS_SERVER_ORIGIN ?? 127.0.0.1:8765`, and `smoke.spec.ts` asserts the
  console strip reads exactly `"server unreachable"`, which is only true while
  8765 is unbound. Pointing the suite at a spawned server would turn three
  unrelated tests red; giving `board.spec.ts` its own Vite + server would mean
  restructuring the shared config that UI-004's e2e also uses. Per the conflict's
  own instruction ("if it turns into a fight, drop it"), it was dropped and the
  column CRUD was verified against a real server and a real browser as recorded
  above. **INFRA-004's `nodeCoverageEnv()` seam therefore remains unexercised.**
  The reason is written into `apps/ui/e2e/board.spec.ts`'s own header.
- **`shell/Board.tsx` stays in `shell/`** (the issue's file list assumed
  `board/Board.tsx`). `.board` is one of the shell's three regions, and
  `smoke.spec.ts` reads `apps/ui/src/shell/Board.css` directly — TEST-30 requires
  that spec to pass unmodified. Everything a column *is* lives in
  `apps/ui/src/board/`. `apps/ui/src/rows/RowList.tsx` — UI-004's labelled
  scaffolding — was removed, as its own docblock said it would be.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (P0, cross-domain — writes corpus state, consumed by plugins)
- [x] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-003]` prefix
