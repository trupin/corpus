# [CONTRACT-080] A board reorder is one commit: `POST /api/boards/order`

## Domain
contract (cross-domain: contract, server, kit/UI — one vertical, by the orchestrator's decision 2026-08-23)

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SHARED-064 (rider 2 signed), CONTRACT-074, SERVER-138, UI-148
- Blocks: —

## Spec References
- SPEC.md §10 — "UI — the board", rider 2 signed 2026-08-22: "reordering boards writes `order` on every board, **in one commit**"
- SPEC.md §4 — "One action, one commit"; the commit window, and the two acts that commit alone
- SPEC.md §9.2 — the HTTP API (`POST /api/docs/bulk`'s enumerated acts)

## Summary
PR #58's second blocking finding. `moveBoard` in `apps/ui/src/board/BoardsProvider.tsx`
issued one `PUT /api/docs/{id}` per board, sequentially, and a comment in the code
conceded that the rider's "one commit" was unmet. §4's commit window folds a
**party's editing session on one document**, never a multi-document act, so four
board writes were four auto-commits: reverting a drag was four `git revert`s, and a
sequence that failed after the second write left a half-applied order in git. This
adds the one route that can say what the rider says — `POST /api/boards/order`,
taking the bar as an ordered list of board ids — implements it as a single
all-or-nothing write group landing one `commits-alone` auto-commit, and switches the
board bar onto it. The conceding comment is gone because the rule is met.

## Acceptance Criteria
- [x] `POST /api/boards/order` is declared in `packages/contract`, with `{boards: string[]}` (ids, first tab first) and a result naming every board, its position, whether it was written, the one commit sha and §11 warnings.
- [x] The server renumbers the named boards `1 … n`, writes only the ones that moved, and lands exactly **one** commit containing exactly those files.
- [x] An id naming no document (`404`), an id naming a non-board (`400`), a repeated id (`400`) and an empty list (`400`) refuse the whole reorder before anything is written.
- [x] A write that fails partway rolls the whole group back: no half order on disk, no commit.
- [x] `moveBoard` issues one request; the per-`PUT` loop and its conceding comment are deleted.
- [x] `openapi.json` and the typed client are regenerated, byte-stable, and committed.
- [x] A test asserts the one commit against **real git history**, and a falsification (per-document writes restored) turns it red.

## Technical Design

### Files to Create/Modify
- `packages/contract/src/schemas/boards.ts` — `BOARD_ORDER_STEP`, `ReorderBoardsRequestSchema`, `BoardPositionSchema`, `ReorderBoardsResultSchema` (new)
- `packages/contract/src/routes/boards.ts` — the route definition (new)
- `packages/contract/src/routes/{index,inventory}.ts` — registration and the endpoint inventory
- `packages/contract/openapi.json`, `src/client/schema.generated.ts` — regenerated
- `apps/server/src/docs/board-order.ts` — the act (new)
- `apps/server/src/docs/write-routes.ts` — mounted beside the document writes, sharing their mutex
- `packages/kit/src/client/createCorpusClient.ts`, `packages/kit/src/query/useReorderBoards.ts` — the client method and the hook
- `apps/ui/src/board/boardOrder.ts`, `apps/ui/src/board/BoardsProvider.tsx` — the drag produces a sequence; `moveBoard` sends it
- `apps/ui/e2e/stubCorpus.ts`, `apps/ui/src/testing/boardFixture.ts` — the stub answers the route

### Key Implementation Details
**A dedicated route, not an extension of `POST /api/docs/bulk`** (the option weighed
and rejected — the reasoning is in the `schemas/boards.ts` docblock so the next reader
finds it at the definition):

1. *Bulk is a selection act.* §10 gives that route one subject — a column's staged set,
   entered through bulk mode, saved once, reported in three parts. A bar drag stages
   nothing. §9.2's signed rider **enumerates** the acts bulk carries, so a ninth would
   contradict signed spec text and need its own sign-off; a route implementing a
   behaviour §10 already mandates needs none.
2. *Bulk could be misused.* An `order` act on a staged set writes `order` onto any
   document, and rider 2 says a view document has no `order`. The narrow route refuses
   anything that is not `type: board` — a restriction bulk has no place to state.
3. *The arithmetic belongs to the server.* `{id, order}` pairs can spell a contradiction
   (two boards at 3, a gap, a zero) and every client would have to renumber identically.
   A sequence has one reading, and it is the one the drag produced.

Server: `runInLanes` over every named board for the whole act; plan every board's bytes
first (so both refusals happen before any write); one `applyOperations` group (its undo
stack is the all-or-nothing guarantee); one `finishMutation` with `docIds` and
`act: "commits-alone"` — the same two devices the bulk act uses. `mayChangeTree` is
deliberately unset: an `order` write moves no file.

### Edge Cases
- A board already at its number is not written — a no-op `PUT` still stamps `updated` and lands a line in the agent's log — so a bar dragged back where it started commits nothing and answers `commit: null`.
- Boards the request does not name keep their `order`. The bar hides archived boards, so naming "every board in the corpus" is not something a client can do; ties are broken by `sort=order`'s title-then-id rule and the next reorder resolves them.
- A bar whose boards share a number (hand-edited file) is resolved by the renumbering, in one commit like any other.

## Testing Strategy
- Contract: schema round trips and every refusal (`packages/contract/src/schemas/boards.test.ts`); the endpoint inventory, the request-body strictness sweep and the §11 warnings-carrier sweep updated.
- Server: `apps/server/src/docs/board-order.test.ts` — real workspace, real git, real Hono app. Commit counts from `git log`, files from `git show --name-only`, `order` read back off the file.
- Kit: `useReorderBoards.test.tsx` — one request on the wire, and the keys invalidated.
- UI: `boardOrder.test.ts` (the sequence a drag produces), `BoardBar.test.tsx` (one request, no `PUT`), `boards.spec.ts` (the same, in a browser).

## E2E Verification Plan
### Verification Steps
1. `npm run build`, then the four workspaces' scoped suites.
2. `npm run generate -w packages/contract` twice — the document is byte-identical (drift check).
3. The one-commit claim against real git, and its falsification.
4. Playwright `boards.spec.ts` at `--workers=1`, `CORPUS_UI_PORT=5399`.

## E2E Verification Log

### Post-Implementation Verification
Implemented on: **opus**. 2026-08-23.

**1. The one-commit claim, against real git history.** `apps/server/src/docs/board-order.test.ts`
drives the real Hono app over a real `git init` workspace. Three boards created and
settled, then `POST /api/boards/order` with the bar reversed:

```
✓ writes every board that moved, in exactly one commit naming them
   commitCount() === before + 1
   git log -1 --format=%s  → "board reorder: 3 boards by user"
   git log -1 --format=%an → "user"
   git show --name-only    → the three board files, and nothing else
   order: on disk          → 1, 2, 3 in the order asked for
```

18 tests, all passing, including: the reported `commit` equals `git rev-parse HEAD`; a
board already at its number is absent from `git show --name-only`; a bar dragged back
where it started produces `commit: null` and **no** new commit; the act folds in neither
direction (an open editing session's commit stands beside it, and a later save does not
join it); `x-corpus-author: agent` authors the commit.

**2. Falsification.** The per-document write was put back in `renumber()` — one
`applyOperations` group and one `finishMutation` per board, which is exactly what four
sequential `PUT`s do — and the suite re-run:

```
× writes every board that moved, in exactly one commit naming them
  AssertionError: expected 5 to be 3   (before + 3 commits, not before + 1)
× reports that one commit, and the position every board now carries  (expected 4 to be 3)
× leaves a board already at its number out of the commit entirely
× folds in neither direction …
× is authored by the acting party …
× does not touch a board the request did not name
× resolves a bar whose boards all carry the same number
7 failed | 10 passed
```

The three refusal tests stayed green under the falsification, which is the point: they
guard a different property. The real implementation was restored and all 18 pass again.

**3. The half-applied failure case.** Two boards in two folders; the second folder
`chmod 0o500` so its write throws after the first board's has already landed:

```
✓ rolls the whole group back when a write fails partway, leaving no half order
   POST /api/boards/order → 500
   both files byte-for-byte what they were; order: 1 and order: 2 unchanged
   commitCount() unchanged
```

Server log line observed: `EACCES … /data/docs/locked/.tmp-…md` thrown from
`writeFileAtomically` inside `applyOperations`, whose undo stack put the first board back.

**4. Generation and drift.** `npm run generate -w packages/contract` run three times;
`md5 openapi.json` identical across runs (`b73b817da524b79c274c1a318c35268a`), and
`prettier --check` clean on both generated files.

**5. Whole-repo gates.** `npm run build` → 0. `npm run typecheck` → 0. `npm run lint` → 0.
Scoped suites: contract + kit 3049 passed (91 files); `apps/server/src/docs` 714 passed
(31 files); `apps/ui/src` passed; Playwright `boards.spec.ts` at `--workers=1`,
`CORPUS_UI_PORT=5399` — see below.

**6. Browser.** `boards.spec.ts` "dragging a tab writes the whole bar in one request"
asserts against the page's real network traffic: one `POST /api/boards/order` carrying
`{boards: [...]}`, and **zero** `PUT /api/docs/doc_board_*`. The tab order after the drag
is read off the rendered bar, so the assertion covers the render as well as the wire.

**7. Id.** Filed as CONTRACT-079 and renumbered to **CONTRACT-080** in the same session:
another agent claimed 079 concurrently for "Record the two warning codes Phase 41 added".
Every citation in code, tests and `issues/PLAN.md` was moved with it, and 079's own row
was left as it was.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
