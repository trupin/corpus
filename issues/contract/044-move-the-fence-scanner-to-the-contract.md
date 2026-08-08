# [CONTRACT-044] The UI cannot pre-check a fence, because the scanner lives in the server

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: UI-091
- Related: SERVER-075 (which needs the same scanner on the reply path)

## Spec References

- SPEC.md §11 — the form says what is wrong before it is sent
- SPEC.md §6 — the fence rule

## Summary

Reported by ui-dev while implementing PR #28's pre-check, and confirmed by the
final review. `formPreflight.ts` catches the marker-collision refusals before a
person submits, but **not** the unterminated fence or the fabricated turn
heading — because `unterminatedFence` and `parseTurns` live in `apps/server`,
which `apps/ui` cannot import.

The agent that hit this refused to hand-roll a second scanner in the UI, and was
right to: a duplicated fence scanner is exactly the drifting copy that PR #28
spent two findings eliminating elsewhere. It wrote the constraint into the
module docblock instead of guessing.

## Acceptance Criteria

- [ ] The fence scan is callable from `apps/ui` and `apps/server` **as one
      implementation**, not two that agree today
- [ ] Moving it changes no server behaviour — `doc check`'s `unterminated-fence`
      code, its severity, and its non-blocking posture are all unchanged
- [ ] It keeps returning the line the fence opened on; that is what both the
      refusal (SERVER-075) and the pre-check need to name
- [ ] The container-awareness the scanner already has survives the move —
      block-quote and list markers, and tab expansion. That logic was got wrong
      once and fixed; a move is a good way to lose it
- [ ] Whether `parseTurns` should move too is answered explicitly. It is the
      other half the UI cannot pre-check, and it is a bigger piece — a decision,
      not an omission
- [ ] `openapi.json` and the typed client regenerated if the public surface moves

## Technical Design

### Files to Create/Modify

- `apps/server/src/core/code.ts` → `packages/contract/src/`, with the server
  importing it back.

### Notes

- The contract is where the format's rules already live (the form grammar and
  the answer format both moved there in PR #28 for this same reason). A fence
  rule is a format rule.

## Testing Strategy

The existing scanner tests move with it and must pass unchanged — that is the
evidence the move is behaviour-preserving. Plus an import from `apps/ui` proving
it is reachable.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
