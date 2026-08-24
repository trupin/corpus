# [SERVER-149] A signed sentence says the cut is never mid-line, and the code keeps a fallback that is

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-032
- Blocks: —

## Spec References

- SPEC.md **§9.2**, signed rider 2026-08-05 — "The cut is never mid-line, and
  never mid hunk-header: a truncated diff is always something a reader can read."

## Summary

Found by cli-dev while closing CLI-028, and it is the release's own sentence
turned on the spec itself.

`truncateDiff` cuts at the last line boundary at or before the bound, which
obeys the rider. It also keeps a documented **fallback that cuts at `max`** when
no line boundary exists at or before it — a mid-line cut, which the rider says
never happens.

**Today that fallback is unreachable through the route, and only by accident.**
The first newline in a real `git diff` falls at index 90, inside the
`diff --git a/… b/…` header, so `lastIndexOf("\n", max - 1)` never returns `-1`.
That is a property of git's output format, not a guarantee this codebase makes or
controls.

So SPEC.md states a rule unconditionally and the code keeps an escape from it.
Either the sentence is wrong or the code is. **The decision taken is: the code is
wrong.** The rider's stated reason — "a truncated diff is always something a
reader can read" — is a deliberate choice, and a mid-line prefix of a diff is not
readable as a diff. Obeying a signed sentence costs nothing reachable and spends
no signature.

The alternative was drafted and rejected, and is recorded here so it can be
reversed cheaply if this proves wrong:

> "The cut is never mid-line and never mid hunk-header, except where a single
> line is longer than the whole bound — there the diff is cut at the bound,
> because a long line's beginning is worth more than nothing."

## Acceptance Criteria

- [ ] `truncateDiff` never returns a mid-line prefix. Where no line boundary
      exists at or before the bound, it returns what the boundary rule permits —
      not `max` characters of a line
- [ ] `truncated` and `totalChars` still describe the answer honestly in that
      case, so a caller cannot read a short answer as a complete one
- [ ] The docblock stops describing a fallback the function no longer has
- [ ] A test covers the no-boundary input directly, since the real route cannot
      produce one

## Technical Design

**Stop and report rather than guessing if a caller loses real information.**
`truncateDiff`'s only known caller is the diff route, where git's header makes
the case unreachable. If the sweep finds a second caller that can hand it a
newline-free payload and genuinely needs a prefix, do not implement — report it,
because then the drafted rider above is the right answer and it needs the user's
signature.

## Testing Strategy

Falsify by restoring the mid-line fallback and asserting the new test goes red.

## E2E Verification Log

_(to be filled by the implementing agent)_
