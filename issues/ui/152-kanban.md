# [UI-152] Kanban boards: derived stage columns, a drag follows the transition graph, stage and status chips, the graph drawn

## Domain
ui

## Status
done

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
- [x] `useColumns(boardId)` returns derived `BoardColumn`s for a kanban board: one per stage, `kind: "stage"`, `filter` = scope query + `{ [field]: stage }`, plus `{ status: "archived" }` for a stage mapped to `archived`; the first stage's column also lists documents in scope with **no value** for the field (two requests OR'd client-side, or a server `stage=` that accepts an empty sentinel — pick the server form if CONTRACT-074 offers `stage=` with a null sentinel, else two requests; document the choice).
- [x] Column head: `STAGE` kind label, `field: value` chip, "or no stage" on the first, `→ <status>` chip on a mapped stage, and the outgoing edges as dashed chips (`→ offer` `→ dropped`, or `→ ∅`).
- [x] Rows are draggable on a kanban board. On drag start every column that is not reachable from the source stage dims (`.no-drop`), reachable ones outline (`.can-drop`); drop on a reachable column → `PATCH` the field (`updateDocById` with `{ stage }` or `{ status }`); the toast names every field the response reports changed; drop elsewhere → refused with "`<from>` does not lead to `<to>` on this board. Set <field> in the document to override, or add the transition to the board."; `transitions` absent → neighbours both ways.
- [x] The reader's frontmatter form (`FrontmatterForm.tsx`) shows a `status ▾` control (the three, as today's status control already does — reuse it) and a `stage ▾` control listing, per kanban whose scope holds the document, that board's stages, plus "Clear the stage"; both write through the normal update path; the status line of the toast reports the coupled change the server made.
- [x] The board bar's `＋` offers Empty board and Kanban; Kanban asks title, stages, transitions (one-line form `a > b, c; b > d`, blank = linear), scope (`folder:`/`tag:`/`type:` or blank) and creates the board document.
- [x] The kanban column's `⋯`: Edit the stages…, Edit/Add the transitions…, Move left/right (reorders `stages`), Open the board document; no Remove and no Edit query (the scope is the board's).
- [x] The board document's reader draws the graph (`graphSVG` ported: nodes in a row, forward edges above, backward edges dashed below, mapped nodes outlined) above its frontmatter, and shows the explanation paragraphs from the prototype.
- [x] The status line / board hint says whether a drag follows transitions or the funnel.
- [x] A kanban over `status` has the three statuses as its stages and no coupling to run. ~~A row whose status is derived is not draggable on it.~~ **Struck 2026-08-22 (Phase 41 prep):** derived status went with the plugin surface (SHARED-067), so every row on a status kanban drags. On a kanban over `stage` a drag moves the stage, and the status map decides the status.
- [x] e2e `kanban.spec.ts`: derived columns match the seed `by-status` board; a stage kanban fixture with transitions and a status map: lit/dim on drag, refused drop, accepted drop shows both fields changed, chip override, first column holds unstaged.

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

**ui-dev, 2026-08-23, running on opus.**

### The real app against a real server

A scratch workspace was created with `corpus init`, its server started on
**8766** (the user's own server on 8765 was never touched), and the Vite dev
server run on **5375** with `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8766` and
`VITE_CORPUS_TOKEN` read from `.corpus/config.json`. The browser was driven with
Playwright against that pair. Seeded through the CLI: three notes in
`data/docs/housing/` (`Maple Street` unstaged, `Oak Lane` in `visiting`,
`Elm Court` in `offer`) and one board document —

```
corpus doc create --type board --title "House hunt" --folder boards --order 4 \
  --query folder=housing \
  --kanban '{"field":"stage","stages":["candidates","visiting","offer","done"],
             "transitions":{"candidates":["visiting"],"visiting":["offer","candidates"],
                            "offer":["done"],"done":[]},"status":{"done":"resolved"}}'
```

Observed in the browser, verbatim:

1. **The seed `by-status` board** (AGENT-042's, `transitions` absent). Its three
   columns were `open`, `resolved`, `archived`, drawn with no view document.
   `type: note` came from the board's own scope, `status: open` from the column,
   and the outgoing edge chip read `→ resolved`:
   `SEED CHIPS open: ['type: note', 'status: open', '→ resolved']`.
   The bar said `kanban over status · a drag moves one stage left or right` —
   **absent read as the funnel, not as `{}`**, which is what makes this board
   draggable at all.
2. **The stage board.** `HOUSE HINT: kanban over stage · a drag follows the
   board's transitions`. `done chips: ['folder: housing/', 'stage: done',
   '→ resolved', '→ ∅']`. Rows landed one per column: candidates `Maple Street`
   (which carries no `stage` at all — the first column's `stage=,candidates`),
   visiting `Oak Lane`, offer `Elm Court`.
3. **A refused drag.** Dragging `Oak Lane` out of `visiting`:
   `offer class: col qcol can-drop`, `done class: col qcol no-drop`. Dropping on
   `done` produced
   `“visiting” does not lead to “done” on this board. Set stage in the document
   to override, or add the transition to the board.`
   and `data/docs/housing/oak-lane.md` still reads `stage: visiting`,
   `status: open` — nothing was written.
4. **An accepted drag.** `Elm Court` from `offer` to `done`:
   `“Elm Court” — stage → done, status → resolved. One commit. The board's
   \`kanban.status\` map decided the status.` The card moved to the `done`
   column, and the file reads `status: resolved`, `stage: done`. The client sent
   `stage` alone; the status is the server's, per SERVER-138.
5. **The chip override.** `Maple Street` was opened in a path and its
   `stage ▾` set to `done` — two columns past what `candidates` leads to.
   Options were `['Clear the stage', 'candidates', 'visiting', 'offer', 'done']`
   under the `House hunt` group. The toast was the server's own sentence:
   `stage \`done\` set status to \`resolved\`: this document is in the kanban
   House hunt (doc_q2eoonix), whose \`kanban.status\` map decides a status on
   entry (SPEC.md §5).` The file reads `status: resolved`, `stage: done`.
6. **The board document's graph.** Opened from a stage column's
   ⋯ → Open the board document: `NODES: 4  MAPPED: 1  BACK EDGES: 1`, and the
   explanation read *"Its columns are its stages, one per value of stage. A drag
   follows the transitions drawn above and nothing else…"*.
7. `PAGE ERRORS: []` — no uncaught exception through the whole drill.
   `git log` showed the writes committed by the server.

The workspace was removed and both processes stopped (`corpus server stop`,
`pkill vite`); 5375 and 8766 are free and 8765 was never signalled.

### Checks

- `npm run build` — clean.
- `npx tsc --noEmit -p apps/ui` — clean for every file this issue touches.
- `vitest run apps/ui/src packages/kit/src` — **237 files, 4576 tests, all
  passing** (shared working tree with UI-150 and UI-151).
- `playwright test kanban.spec.ts` — **15 passing**; `boards.spec.ts`,
  `column-header.spec.ts`, `reflect.spec.ts` — 22 passing.
- `eslint` and `prettier --check` clean over every file touched.

### Falsification — each rule broken, each test watched go red

| Mutation | What went red |
| --- | --- |
| `canMove` → `return true` (the drag restriction removed) | 6 of `kanbanDrag.test.ts` (incl. *REFUSES a drop… and sends nothing at all*), 3 of `kanban.test.ts`, **and both drag e2e specs** — the refusal spec then observed `“Oak Lane” — stage → done, status → resolved` on the wire, which is exactly the write it exists to prove does not happen |
| `leadsTo`: `transitions ?? {}` (absent read as empty — the AGENT-042 trap) | 7 tests, including *is the linear funnel when `transitions` is absent* |
| `leadsTo`: `{}` read as the funnel | 2 tests, including *is empty when `transitions` is `{}` — absent is not empty* |
| First column asks `stage=<first>` instead of `stage=,<first>` | *asks for the first stage and the unstaged in ONE request* |
| A stage mapped to `archived` loses its `status=archived` filter | *adds `status=archived` to a stage the board maps to archived* |

The restriction test is the one the issue warned about, and it is the one that
was checked hardest: it asserts **no `PUT` and no `POST` reached the wire** and
that the stored document did not move, not merely that a toast appeared. With
the restriction deleted it fails on both counts.

**No test was found that cannot fail.**

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[UI-152]` prefix
