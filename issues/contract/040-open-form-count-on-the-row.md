# [CONTRACT-040] A row says how many unanswered forms a thread still holds

## Domain

contract

## Status

todo

## Priority

P2 (nice to have)

## Model

opus

## Dependencies

- Depends on: CONTRACT-038 (the richer form grammar)
- Blocks: the last acceptance criterion of UI-084
- Related: SERVER-068 computes `needs=form`; UI-084 renders the reason chip

## Spec References

- SPEC.md **§11**, Attention — "a thread holding **more than one** unanswered
  form says how many are still open"
- SPEC.md **§9.1** — the projection is where a row's derived columns come from

## Summary

UI-084 shipped every part of §11's Attention sentence except its last clause.
`DocRow` carries `attention: NeedsReason[]` — a list of reason **codes** and
nothing else — so the reason line can say "awaiting your answer" and cannot say
"2 still open".

**The count is not derivable in the UI, and approximating it is the defect this
repo has filed repeatedly.** A row carries no turns: `lastTurn` is a plain-text
preview of the last turn only, and the forms in question are typically in turns
above it. The only way for a board column to count a thread's open forms today is
to fetch every thread in the column (`GET /api/threads/{id}`) and re-derive it —
an N+1 per column render, for a chip. `unreadThreads` is the precedent for the
opposite choice: an aggregate the server already knows, ridden on the row so no
list ever issues one query per row.

So this is a contract question, filed rather than guessed (UI-084's Technical
Design says exactly that: "if the count is not derivable in the UI, file the
contract issue rather than approximating it — a chip that says '2' by guessing is
the class of defect this codebase has filed repeatedly").

## Acceptance Criteria

- [ ] `DocRow` carries how many **unanswered** forms an open thread holds — the
      same set `needs=form` is computed from, so the count and the reason can
      never disagree
- [ ] It is `0` (never null, never absent) on a thread with no open form, and
      `0` on a non-thread row, so `0` always means "none" and never "unknown" —
      the rule `unreadThreads` already states
- [ ] The count and the `form` reason are computed from **one** derivation in the
      projection, not two
- [ ] Resolving the thread takes the count to `0` along with the reason (§6: a
      resolved thread stops awaiting an answer)
- [ ] The count survives being read: `POST …/seen` does not change it — the
      asymmetry UI-084's e2e guards
- [ ] The board's reason chip reads "2 awaiting your answer" (or the wording the
      mockup settles on) only when the count is greater than one, and stays
      "awaiting your answer" at one — §11 says *more than one* says how many

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/query.ts` — the new field on `docRowBaseShape`
  or `threadRowShape`, with the `unreadThreads` docblock as the template for its
  "never null" contract
- `packages/contract/openapi.json` + `src/client/schema.generated.ts` — regenerated
- `apps/server/src/projection/*` and `apps/server/src/docs/query.ts` — one
  derivation feeding both `needs=form` and the count (a **server** issue to file
  once this lands)
- `packages/kit/src/row/reasons.ts` + `Row.tsx` — `REASON_TABLE` has no shape for
  a number today; the chip's label becomes a function of the row, not of the code
  alone

### Key Implementation Details

**Where the number comes from.** `apps/server/src/core/form.ts`'s
`readThreadForms` already computes the open-form set — that is the count.
Exposing it is cheaper than any alternative and cannot drift from the reason,
which is the whole point.

**Do not widen `attention` into objects.** `attention` is a list of codes that
plugins may extend (SPEC.md §10); turning entries into `{code, count}` would
change every consumer for one reason's sake. A sibling scalar is additive.

## Testing Strategy

Contract: the field's presence, its `0`-not-null rule, and the OpenAPI drift
check. Server: the count agrees with `needs=form` across the same fixtures
`docs/query.test.ts` already uses for the reason, including the resolved case and
the seen case. UI: the chip's wording at zero, one and two.

## E2E Verification Plan

A thread with two unanswered forms shows one row saying how many are still open;
answering one takes it to the single-form wording; answering the second clears
the row.

## E2E Verification Log

_[Agent fills.]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified
