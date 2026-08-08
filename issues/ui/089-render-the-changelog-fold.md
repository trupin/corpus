# [UI-089] The changelog's older entries need a fold that reports its size

## Domain

ui

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SHARED-025 (rider), AGENT-020 (which writes the section)
- Blocks: —

## Spec References

- SPEC.md §11 — "Anything that can be shown can be collapsed, and it means the
  same thing everywhere"; a collapse reports **how many** are inside, its whole
  size rather than a remainder
- SPEC.md §5 — the changelog is ordinary body content

## Summary

AGENT-020 gives documents a changelog whose older entries fold (user decision,
2026-08-07). This is the reading half.

**Check before building anything**: the changelog is ordinary markdown in the
body, so the existing renderer may already handle the fold — §11's clipping and
collapse rules exist, and a `<details>`-style fold might need nothing new. If so,
this issue is a test and a docblock rather than a component, and that is the
right outcome. Establish that first rather than writing a component to find out.

## Acceptance Criteria

- [ ] Older changelog entries render folded, and the fold **says how many are
      inside** — its whole size, the way §11 requires of every collapse
- [ ] It expands **in place**, without navigating away
- [ ] Recent entries are visible without expanding anything
- [ ] The section stays ordinary content: selectable, commentable, anchorable,
      and editable in the document editor like any other part of the body. A
      fold that made its contents unselectable would break commenting on an
      older entry
- [ ] Keyboard-reachable like every other affordance (§11 adds no
      exclusive-pointer capability)
- [ ] An anchor into a **folded** entry still resolves, and revealing that thread
      expands the fold rather than silently failing to scroll to it — this is
      the case most likely to be missed
- [ ] If the existing renderer already delivers this, the issue closes with a
      test proving it rather than a new component

## Technical Design

### Files to Create/Modify

- Likely `apps/ui/src/reader/` (the markdown view) — but confirm the gap exists
  before choosing.

### Notes

- Reuse §11's one collapse behaviour rather than inventing a second fold with
  its own rules. The spec is explicit that collapse means the same thing
  everywhere, and a changelog fold that behaved differently from a collapsed
  conversation would be exactly the drift §11 forbids.

## Testing Strategy

A document with more entries than the threshold: recent ones visible, older ones
folded with a count, expanding in place. Plus the anchored-thread-into-a-folded-entry
case.

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
