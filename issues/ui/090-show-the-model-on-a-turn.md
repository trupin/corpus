# [UI-090] Show which model wrote an agent turn

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-043, SERVER-074
- Blocks: —

## Spec References

- SPEC.md §11 Thread view — "An agent turn says which model wrote it" (rider signed 2026-08-07)

## Summary

The reading half of SHARED-027, and the thing the user actually asked for:
*"Anytime an agent takes note... I want to be able to quickly identify which
model worked on it."*

## Acceptance Criteria

- [ ] An agent turn shows the model that wrote it, wherever the turn is read —
      a card in the margin, a chip at its anchor, a thread in a column, in full
      screen, and a child thread nested under a turn
- [ ] **Quickly identifiable** is the requirement, not merely present: it reads
      at a glance beside the author and timestamp, without opening anything
- [ ] A turn with **no recorded model shows nothing** — no "unknown", no dash
      that reads as a value. §11 is explicit that an unknown says so by absence
      rather than by a plausible attribution
- [ ] A person's turn shows nothing
- [ ] A **collapsed** conversation is unaffected: §11 fixes exactly what a
      collapsed line reports, and this is not in that list. Do not add it
- [ ] It survives a revised turn (§11), which changes text without adding a turn

## Technical Design

### Files to Create/Modify

- `apps/ui/src/thread/Turn.tsx` and the turn header, plus `thread.css`.

### Notes

- The turn header is already dense (author, timestamp, revised marker). Adding a
  fourth element risks the header becoming the noisiest part of a conversation —
  weigh placement against how often it is the thing being looked for.
- Check `packages/kit` — if a plugin can render turns, the model belongs to the
  shared surface rather than to `apps/ui` alone.

## Testing Strategy

A thread mixing agent turns with a model, agent turns without, and person turns:
assert exactly which show it. Plus a collapsed conversation asserting it does not
appear there.

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
