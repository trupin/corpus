# [UI-124] The board badge's resident note truncates, and always has

## Domain

ui

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: UI-123, SHARED-053 (which lengthened the note this measured)

## Spec References

- SPEC.md **§10** — the board

## Summary

The board badge's one-line resident note **truncates**, and the resident's name
already wraps mid-word. Measured in a real browser during PR #50's third review
response:

| | `scrollWidth` | `clientWidth` |
| --- | --- | --- |
| the note before SHARED-053's correction | 310 | 227 |
| after | 499 | 263 |

**Pre-existing, not introduced.** The old string overflowed by 83px and the name
wrapped mid-word already. Correcting the note's text made an existing overflow
larger; it did not create one.

The composer statement — the surface the note is actually written for — carries
the whole corrected sentence cleanly. Only the badge clips it.

## Why it was not fixed in PR #50

The measurement arrived at the end of a three-round review, from an agent that
had already done its work twice over. A layout change to the board badge is not a
loose end of the profile arc, and taking it then would have meant a fourth review
round for a defect that predates the release.

Filed instead of fixed, with the measurement attached so the next person does not
have to take it again.

## What has to be decided

1. **Whether the badge should carry the note at all.** The composer statement
   already says it in full, and a badge that clips a sentence teaches less than a
   badge that shows a state and points elsewhere.
2. If it keeps the note: whether it wraps, truncates with a title attribute, or
   shortens. Shortening means a second wording of a claim that this release spent
   ten sites reducing to one — see SHARED-053 — so prefer wrapping or a tooltip
   over a new short form.
3. The name wrapping mid-word is a separate defect in the same element and should
   be fixed with it.

## Acceptance Criteria

- [ ] The badge shows the whole note, or shows a state and does not pretend to
      show the note
- [ ] The resident's name does not wrap mid-word
- [ ] If a shorter wording is introduced, it is composed from
      `MISSING_PROFILE_CAUSES` rather than typed — that constant exists because
      the claim was typed ten times and four of them were false
- [ ] Measured after, in a real browser, the way it was measured here

## Technical Design

### Files to Create/Modify

- the board badge component and its styles
- `packages/kit/src/recipient/laneRows.ts` only if a short form is needed

### Key Implementation Details

Read SHARED-053 and `MISSING_PROFILE_CAUSES` first. The note is composed from a
constant precisely so that no surface types its own version of the claim.

## Testing Strategy

A layout assertion is weak here; the check is the measurement in a real browser.
If a short form is added, pin it to the constant.

## E2E Verification Plan

### Verification Steps

1. Real app, real workspace, port **not 8765** and **not 5173**
2. A thread whose resident's profile has been renamed, so the note renders
3. Measure `scrollWidth` against `clientWidth` on the badge
4. Confirm the composer statement still carries the full sentence

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-124]` prefix
