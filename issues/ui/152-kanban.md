# [UI-152] Kanban boards: derived stage columns, a drag follows the transition graph, stage and status chips, the graph drawn

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: UI-148, SERVER-138
- Blocks: —

## Spec References
- SPEC.md §5 — rider 5 (`stage` beside `status`, the coupling)
- SPEC.md §10 — rider 6 (kanban boards)
- `design/navigation.html` — `boardColumns`, `viewRows` (first column holds the unstaged), `leadsTo`/`canMove`, the drag handlers, `stageMenu`/`statusMenu`, `graphSVG`, `newBoard("kanban")`

## Summary

> **Amended 2026-08-22 (Phase 41 prep).** This issue was written before v0.18.0 removed the plugin surface and derived status (SHARED-067). The clauses that named them are struck below, and the §-citations are renumbered to the post-v0.18.0 SPEC.

A board with `kanban` has no view columns: its columns are its stages, derived from its scope query. A drag moves a document along a transition and the server writes the field (and, through the §5 coupling, the status). Everything the graph does not allow is done by setting the field in the reader. The prototype is the reference for every control.

## Acceptance Criteria
- [ ] `useColumns(boardId)` returns derived `BoardColumn`s for a kanban board: one per stage, `kind: "stage"`, `filter` = scope query + `{ [field]: stage }`, plus `{ status: "archived" }` for a stage mapped to `archived`; the first stage's column also lists documents in scope with **no value** for the field (two requests OR'd client-side, or a server `stage=` that accepts an empty sentinel — pick the server form if CONTRACT-074 offers `stage=` with a null sentinel, else two requests; document the choice).
- [ ] Column head: `STAGE` kind label, `field: value` chip, "or no stage" on the first, `→ <status>` chip on a mapped stage, and the outgoing edges as dashed chips (`→ offer` `→ dropped`, or `→ ∅`).
- [ ] Rows are draggable on a kanban board. On drag start every column that is not reachable from the source stage dims (`.no-drop`), reachable ones outline (`.can-drop`); drop on a reachable column → `PATCH` the field (`updateDocById` with `{ stage }` or `{ status }`); the toast names every field the response reports changed; drop elsewhere → refused with "`<from>` does not lead to `<to>` on this board. Set <field> in the document to override, or add the transition to the board."; `transitions` absent → neighbours both ways.
- [ ] The reader's frontmatter form (`FrontmatterForm.tsx`) shows a `status ▾` control (the three, as today's status control already does — reuse it) and a `stage ▾` control listing, per kanban whose scope holds the document, that board's stages, plus "Clear the stage"; both write through the normal update path; the status line of the toast reports the coupled change the server made.
- [ ] The board bar's `＋` offers Empty board and Kanban; Kanban asks title, stages, transitions (one-line form `a > b, c; b > d`, blank = linear), scope (`folder:`/`tag:`/`type:` or blank) and creates the board document.
- [ ] The kanban column's `⋯`: Edit the stages…, Edit/Add the transitions…, Move left/right (reorders `stages`), Open the board document; no Remove and no Edit query (the scope is the board's).
- [ ] The board document's reader draws the graph (`graphSVG` ported: nodes in a row, forward edges above, backward edges dashed below, mapped nodes outlined) above its frontmatter, and shows the explanation paragraphs from the prototype.
- [ ] The status line / board hint says whether a drag follows transitions or the funnel.
- [ ] A kanban over `status` has the three statuses as its stages and no coupling to run. ~~A row whose status is derived is not draggable on it.~~ **Struck 2026-08-22 (Phase 41 prep):** derived status went with the plugin surface (SHARED-067), so every row on a status kanban drags. On a kanban over `stage` a drag moves the stage, and the status map decides the status.
- [ ] e2e `kanban.spec.ts`: derived columns match the seed `by-status` board; a stage kanban fixture with transitions and a status map: lit/dim on drag, refused drop, accepted drop shows both fields changed, chip override, first column holds unstaged.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/board/kanban.ts` (pure: `deriveColumns`, `leadsTo`, `canMove`, `edgesToText`/`textToEdges`), tests
- `apps/ui/src/board/useColumns.ts` — branch on `kanban`
- `apps/ui/src/board/ColumnHead.tsx` — stage chips
- `apps/ui/src/board/ColumnList.tsx`, `kanbanDrag.ts` — HTML5 drag, the lit/dim classes
- `apps/ui/src/reader/FrontmatterForm.tsx` — `stage` control
- `apps/ui/src/shell/BoardBar.tsx` — the Kanban creation flow (a small dialog, not `prompt`)
- `apps/ui/src/reader/KanbanGraph.tsx` — the SVG
- e2e `kanban.spec.ts`, `stubCorpus.ts` (stage filter, the coupling's response shape)

### Key Implementation Details
- The UI never computes the status coupling; it sends the field and renders what the server reports. One rule, one place (SERVER-138).
- Derived columns get stable ids `<boardId>#<stage>` so local state (scroll, in-place reader, paths hanging off them) survives a re-render.
- Drag uses the same pointer-capture pattern `columnDrag.ts` uses, not a library.

### Edge Cases
- A document whose stage is not in `stages`: it is in scope but in no column; the board hint counts them ("3 documents in scope with a stage this board does not list") so nothing silently vanishes.
- Two kanbans over the same documents with different vocabularies: the reader's `stage ▾` lists both boards' stages under their names.
- A mapped-to-archived stage on a kanban whose scope query sets `status` explicitly: the board's own status filter wins; the derived column does not add a second.

## Testing Strategy
Vitest on `kanban.ts` for derivation and the graph rules; component tests for the chips; Playwright for drag.

## E2E Verification Plan
### Verification Steps
1. Real app with a stage kanban created through `＋ Kanban` (stages `a, b, c`, transitions `a > b; b > c, a`); drag `a → b` accepted, `a → c` refused, `b → a` accepted; `corpus doc show` confirms `stage` and `status`.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[UI-152]` prefix
