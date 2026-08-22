# [UI-153] The Reflect control, and what changed since the agent last looked

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: UI-148, SERVER-137
- Blocks: —

## Spec References
- SPEC.md §7 — rider 9 (reflection; "the board shows what is unreflected")
- SPEC.md §11 — the board bar

## Summary
A Reflect control on the board bar asks for a reflection now and carries the corpus count of unreflected changes; every row whose `updated` is later than the clock is marked, every column counts its own, and a board tab carries a dot while it holds any. When the job lands the marks clear.

## Acceptance Criteria
- [ ] `useReflectStatus()` reads `GET /api/workspace/reflect` and follows the SSE kinds SERVER-137 emits; no polling.
- [ ] Board bar: **Reflect · N changes since <relative time>**; while pending: "reflecting…", disabled; with `changed: 0`: "Reflect" enabled (a person may still ask); a `409` on click shows the pending state, never an error toast.
- [ ] "reflected <relative>" beside the control opens the last digest thread (`lastDigest`) as a loose path on the current board (UI-149's left-edge placement); when `reflected` is null the text reads "never reflected".
- [ ] A row with `updated > reflected` shows a small mark (the prototype's dot vocabulary, a distinct glyph from "open elsewhere"); the column head shows "N changed" when N > 0; a board tab shows a dot when any of its columns' documents are changed (derived from the rows already loaded, never an extra request).
- [ ] A configured `quiet` of `0` changes the control's title to say reflections are manual only.
- [ ] e2e `reflect.spec.ts`: stub clock and counts; marks present; click → pending state; SSE clock move → marks clear and count drops.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/reflect/{useReflectStatus.ts,ReflectControl.tsx}`, tests
- `apps/ui/src/shell/BoardBar.tsx` — mount
- `apps/ui/src/board/ColumnHead.tsx`, `ColumnList.tsx` (row mark), `BoardBar.tsx` (tab dot)
- e2e `reflect.spec.ts`, `stubCorpus.ts`

### Key Implementation Details
- The mark compares two timestamps already on hand; no per-row request. The tab dot derives from the columns the board already fetched.
- The control never grows: the count is a fixed-width tabular number (SPEC §11: nothing resizes because of what it holds).

### Edge Cases
- A document changed by the agent during a reflection is not marked once the clock moves past it (the server's exemption in SERVER-137 keeps the count honest).

## Testing Strategy
Vitest for the hook and derivation; Playwright for the flow.

## E2E Verification Plan
### Verification Steps
1. Real app: edit two documents; the control reads "2 changes"; click; "reflecting…"; run the agent; marks clear; "reflected just now" opens the digest.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[UI-153]` prefix
