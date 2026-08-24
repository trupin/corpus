# [UI-170] A document that failed to load is not a drifted anchor

## Domain

ui

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: UI-144
- Blocks: —

## Spec References

- SPEC.md **§10** — reveal, and what a reader is told when a quote cannot be shown

## Summary

Found by ui-dev while closing UI-144, and left unfiled there on purpose: UI-144's
second acceptance criterion is that the existing cases keep their wordings, and a
fourth wording had no issue to live in.

`DocView`'s `.reader-error` card — *"This document could not be read"* — also
carries the settled marker. So a reveal into a document that merely **failed to
load** is told the quote *"is no longer on this document"*, which describes a
drifted anchor on a document that is intact.

This is UI-144's defect one state over. UI-144 separated *deleted* from *drifted*;
this separates *unreadable* from *drifted*. The anchor may be perfectly sound and
the reader is told it is gone.

## Acceptance Criteria

- [ ] A reveal into a document whose load failed says the document could not be
      read, not that the quote is no longer on it
- [ ] The three existing `RevealMiss` wordings are unchanged
- [ ] A retry that succeeds resolves the reveal normally — the wording describes
      this attempt, not a permanent verdict
- [ ] Verified in a real browser against a document whose fetch fails, which is
      the only way to reach the `.reader-error` card

## Technical Design

`RevealMiss` already carries `"gone"` from UI-144. This is a fourth member, not a
re-use of that one — a deleted document and an unreadable one are different
facts, and collapsing them would rebuild the defect this issue is closing.

## Testing Strategy

Unit coverage for the new branch, plus a Chromium check against a failing fetch.
Falsify by removing the branch and watching the drifted-anchor sentence come back.

## E2E Verification Log

_(to be filled by the implementing agent)_
