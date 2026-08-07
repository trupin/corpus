# [SERVER-070] A malformed form can still reach disk through thread creation

## Domain

server

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SERVER-068, CONTRACT-038
- Blocks: —

## Spec References

- SPEC.md §6 — forms are written only through the server's thread endpoints
- SPEC.md §11 — a malformed form renders as a broken block

## Summary

Scoped out of SERVER-068 deliberately, and reported rather than quietly widened.

CONTRACT-038 declared the write-time refusal for a malformed form fence on
`POST /api/threads/{id}/turns` only, and SERVER-068 enforced it there
(`assertWritableForm`, agent turns only — a person quoting a fence is quoting).

**`POST /api/threads` is the other door.** When the agent authors a thread's
first turn, that turn can carry a form fence, and nothing checks it — so a
malformed form still reaches disk by that route.

The half that catches it afterwards does exist: §11's raw-render rule means the
board shows a broken block rather than half-working controls, and
`unterminated-fence` (SERVER-066) catches the fence-shaped subset. So this is a
narrowing of a hole rather than an open wound. But the asymmetry is arbitrary —
the same bytes are refused on one route and accepted on another — and an
arbitrary rule is one a later reader will "simplify" in whichever direction they
meet first.

## Acceptance Criteria

- [ ] A malformed form fence in a thread-creating agent turn is refused with the
      same status and the same message shape as the turn-append route
- [ ] A **person** creating a thread that quotes a form fence is **not** refused —
      quoting is not authoring, which is the distinction `assertWritableForm`
      already draws
- [ ] The two routes share one implementation, not two that agree today
- [ ] Whether the contract needs a declared `400` on `POST /api/threads` is
      answered explicitly — if it does, that is a CONTRACT issue and a possible
      §9.2 line needing user sign-off, not something to add silently

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/create.ts`, reusing SERVER-068's
  `assertWritableForm` from `apps/server/src/core/form.ts`.

### Notes

- Check the **capture** path too (`apps/server/src/capture/capture.ts`) — it
  creates a filing thread and may be a third door. SERVER-068 did not survey it.
- Do not widen the refusal to person-authored turns. §6 makes forms an agent
  affordance; a person pasting a broken fence into a comment is ordinary content,
  and refusing their message to protect a form they were not writing would be the
  same class of error as blocking a save for a pre-existing condition
  (SERVER-066's non-blocking decision).

## Testing Strategy

The same fixtures the turn-append refusal uses, driven through thread creation
and through capture; plus the person-quoting case asserted as accepted on every
route.

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
