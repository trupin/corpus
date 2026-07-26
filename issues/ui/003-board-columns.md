# [UI-003] Board columns: pinned view docs, reorder, new-list

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus — the model is pinned ("columns ARE documents"), the chrome is pinned by the prototype, and the persistence rule (view doc vs. localStorage) is stated in the spec; the work is disciplined implementation.

## Dependencies

- Depends on: UI-002, SERVER-011
- Blocks: UI-005, UI-009, PLUGINS-001

## Spec References

- SPEC.md §11 — "The board" (horizontally scrolling strip of columns, snap scrolling, trailing ghost column)
- SPEC.md §11 — "Columns are pinned view documents" (a column IS a `type: view` document with `pinned: true`; frontmatter holds the query and `order`; only browser-local state stays local)
- SPEC.md §11 — "Folder scoping" (folder columns scope by directory; threads inherit their parent's folder)
- SPEC.md §11 — "Creating documents — zero-form, inbox-first" (＋ on non-folder columns creates into `data/docs/inbox/`; a folder column's ＋ creates into its folder; the new document opens immediately, title selected)
- SPEC.md §9.2 — `GET /api/docs`, `GET /api/tree`, `POST /api/docs`, `PUT /api/docs/:id`
- SPEC.md §10 — plugin column types (`column: "<plugin>/<type>"` in a view document's frontmatter)
- SPEC.md §15 M3 — the board's executable check (drag a column → its `order` frontmatter updates)
- `design/index.html` — **authoritative look & feel** (`.board`, `.col`, `.col-head`, `.chips`, `.sort`, `.ghost-col`, drag states)

## Summary

Render the board: columns come from `type: view, pinned: true` documents sorted by their `order` frontmatter, each with the prototype's chrome (title, mono kind label, count, ＋, ⋯, filter-chip row, sort label) and a list of rows fetched with `useDocs(column.query)`. Reordering — by dragging the column header or with `⇧←`/`⇧→` — writes the view document's `order` through `PUT /api/docs/:id`, so board layout is corpus state: auto-committed, agent-stewardable, and identical across browsers. A trailing ghost column opens the new-list picker, which creates a pinned view document for a folder, a preset view, a plugin column type, or the current search. Only scroll positions and open readers stay in `localStorage`.

## Acceptance Criteria

- [ ] Columns render from `useDocs({ type: "view", pinned: true })` (or the contract's equivalent filter), sorted ascending by the `order` frontmatter field; nothing about the column set is hardwired in code.
- [ ] Column chrome matches `design/index.html`: `336px` wide card (`--surface`, `1px --line`, `12px` radius, `--shadow-soft`), header with `.col-title` (14px, 600), `.col-kind` mono uppercase label (`VIEW` / `FOLDER` / `PLUGIN`), right-aligned mono `.col-count`, `＋` add button, `⋯` menu button, then a `.chips` row of filter chips with the `.sort` label pushed right.
- [ ] The count reflects the column's live result count from its `useDocs` query.
- [ ] The filter-chip row is derived from the view document's stored query (folder, type, status, tag, `needs`, …), rendering active filters with the `.chip.on` treatment.
- [ ] Rows render through a `Row` component contract (props: the doc record + column context); the row's internals are UI-004's — this issue must not inline row markup beyond a minimal placeholder that UI-004 replaces.
- [ ] Dragging a column by its header reorders it: HTML5 drag-and-drop, the dragged column takes the `.dragging` treatment (`opacity: 0.55`, dashed border), and the insertion point is computed by midpoint (`e.clientX < rect.left + width/2`), matching the prototype.
- [ ] On drop, the affected view documents' `order` values are persisted via `PUT /api/docs/:id`; a page reload (and a second browser) shows the new order.
- [ ] `⇧←` / `⇧→` move the active column one position left/right and persist `order` identically — keyboard drag is not a second, weaker code path.
- [ ] A trailing `.ghost-col` ("＋ New list — a folder, a view, or any filter", dashed, `220px`) opens a picker positioned at the click point offering: **a folder** (options from `GET /api/tree`, with doc counts), **a library/preset view**, **a plugin column type** (from discovered manifests), and **from current search** (when a search query is active).
- [ ] Every picker choice creates a **pinned view document** via `POST /api/docs` with the appropriate query frontmatter (`folder:` for folders, filters for presets, `column: "<plugin>/<type>"` for plugin columns) and `order` set to last; the new column appears and is scrolled into view.
- [ ] Folder columns scope by directory **and include threads whose parent lives in that folder** (threads inherit their parent's folder per SPEC.md §11).
- [ ] `＋` on a **folder** column creates a document into that folder; `＋` on any other column creates into `data/docs/inbox/`; the new document opens immediately in that column with its title selected for typing.
- [ ] The column `⋯` menu (a stub in the prototype — implement it) offers **Rename**, **Edit query**, and **Unpin**; rename and edit-query `PUT` the view document, unpin **archives** it (`status: archived`) rather than deleting it.
- [ ] Browser-local state — per-column scroll position and which document each column has open — persists in `localStorage` under a namespaced key; **no query, order, or column identity is ever stored locally**.
- [ ] The board scrolls horizontally with `scroll-snap-type: x proximity` and columns `scroll-snap-align: start`; the active column carries the `.kactive` cue (`box-shadow: 0 0 0 2px var(--accent-wash), var(--shadow-soft)`) and follows focus/hover.
- [ ] A column whose `useDocs` query fails renders an inline error card in place; the rest of the board keeps working.

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

**Order values.** Use sparse integers (e.g. multiples of 10) so a single insert usually rewrites one document. On drop, compute the target index, then write the minimum set of `order` values that realizes it; if the gap is exhausted, renumber the whole board in one pass. Every write is a `PUT /api/docs/:id` — the server auto-commits, so this is a visible, agent-stewardable act (SPEC.md §11).

**Drag.** Follow the prototype exactly: the header is the drag handle (`cursor: grab` / `grabbing`); `mousedown` on the header (but not on a button) sets `draggable` on the column and `mouseup` clears it, so buttons stay clickable. `dragover` finds the first non-dragging column whose midpoint is right of the pointer and inserts before it (or before the ghost column). Persist on `dragend`, not on every `dragover`.

**Keyboard move.** `⇧←`/`⇧→` on the active column call the same `useColumnOrder` mutation as drag. Keep the DOM reorder driven by the fetched-and-sorted column list (i.e. re-render from state after the mutation), not by imperative `insertBefore` alone — the prototype does the imperative thing because it has no data layer; we do not.

**New-list picker.** A positioned menu (prototype: `.ac-menu` styling, clamped to the viewport) opened from the ghost column. Sources: folders from `useTree()` with their doc counts, presets from a small hard-coded library (Attention `needs=me`, Open threads `type=thread status=open`, Skills & agents `type=skill|agent-def`), plugin column types from the discovered manifests (PLUGINS-001 supplies the registry — until then, render the "plugin column types appear here too" affordance the prototype shows), and "from current search" when UI-009's search state holds a query. Each choice is one `POST /api/docs`.

**Creation semantics (＋).** Resolve from the column's view document: a `folder:` query ⇒ create into that folder; a plugin `column:` ⇒ create that plugin's doc type; everything else ⇒ `data/docs/inbox/`. After creation, open the new document in that column with the title focused and selected. UI-009's omnibox creates the same way — factor the creation call into `useCreateInColumn` so both paths share it, and note in code that the final creation UX is settled with UI-009.

**Local vs. corpus state.** The dividing line is explicit in SPEC.md §11 and is a review-blocking correctness rule: **corpus** = which columns exist, their queries, their order, their titles; **local** = scroll positions, which reader is open, per-reader nav stacks (UI-005). Namespace the localStorage key (e.g. `corpus.board`) and version it so a schema change degrades to defaults rather than throwing.

**Toasts.** Reorder, pin, and unpin narrate themselves per the prototype's convention (bottom-right, max 3, 6 s) — e.g. "Pinned — a view document was created for "Finance" (pinned: true, order: last)." Use the shared toast surface; if it does not exist yet, add a minimal one in `apps/ui/src/shell/` styled per `.toast-wrap`/`.toast` and let UI-011 take it over.

### Edge Cases

- **Zero pinned view documents** — the board shows only the ghost column with inviting copy; never a blank screen.
- **Duplicate or missing `order` values** — sort deterministically (order, then title, then id) and renumber on the next write rather than refusing to render.
- **A view document archived or deleted out-of-band** (the agent stewarding the board) — the column disappears live via SSE; if it had a reader open, close it gracefully and drop its local entry.
- **Drag interrupted** (dropped outside the board, `Esc`) — restore the pre-drag order; persist nothing.
- **Concurrent reorder** (the agent rewrites `order` while the user drags) — last write wins; the board re-renders from the refetched documents, so the user sees the reconciled order rather than a phantom.
- **Plugin column type not installed** (a view doc references `column: "todos/board"` with the plugin removed) — render a "plugin missing" card per SPEC.md §15 M5, keeping the column in place.
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

Against the **real running application**, exercising SPEC.md §15 M3's board checks. Assert both the UI state **and** the on-disk view document.

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

### Reproduction (bugs only)

_[Agent fills: exact commands, observed output, confirmation bug exists]_

### Post-Implementation Verification

_[Agent fills: application restarted, exact commands, observed output, confirmation fix/feature works]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (P0, cross-domain — writes corpus state, consumed by plugins)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-003]` prefix
