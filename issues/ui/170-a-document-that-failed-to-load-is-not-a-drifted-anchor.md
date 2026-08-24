# [UI-170] A document that failed to load is not a drifted anchor

## Domain

ui

## Status

done

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

- [x] A reveal into a document whose load failed says the document could not be
      read, not that the quote is no longer on it
- [x] The three existing `RevealMiss` wordings are unchanged
- [x] A retry that succeeds resolves the reveal normally — the wording describes
      this attempt, not a permanent verdict
- [x] Verified in a real browser against a document whose fetch fails, which is
      the only way to reach the `.reader-error` card

## Technical Design

`RevealMiss` already carries `"gone"` from UI-144. This is a fourth member, not a
re-use of that one — a deleted document and an unreadable one are different
facts, and collapsing them would rebuild the defect this issue is closing.

## Testing Strategy

Unit coverage for the new branch, plus a Chromium check against a failing fetch.
Falsify by removing the branch and watching the drifted-anchor sentence come back.

## E2E Verification Log

**Implemented on: opus** (Opus 5, 1M context), 2026-08-24.

### What changed

`RevealMiss` gains a fourth member, `"unreadable"` — not a re-use of `"gone"`, as
the Technical Design required. `useReaderSurface` reads `ReaderDoc.error` through
a ref beside the `isMissing` one, and settles with a precedence: **gone, then
unreadable, then whatever the search concluded**. A document that is not there
and one that could not be read can neither of them be searched, so the search's
verdict about either is not evidence.

`revealMissNotice` became a `switch` over the four members, so a fifth would be a
compile error rather than falling into `unresolved`'s else-branch. Wording:

> Could not show “…” — this document could not be read.

Error tone, matching `unresolved` and the card's own `role="alert"`: this is a
fault of *this attempt*, not a settled fact about the workspace, which is why
`gone` and `absent` keep the info tone they were given in UI-140/UI-144.

### Browser verification — `reveal.spec.ts`

The only way to reach `.reader-error` is a read that fails while everything
around it answers, so the document's own `GET /api/docs/{id}` is refused with a
`403` (a client error, so the query client does not retry it and the card is the
first thing the reader draws). Two new tests:

```
✓ an open that names an item on a document that could not be read
    › says the read failed rather than that the quote moved (2.0s)
✓ an open that names an item on a document that could not be read
    › reveals normally once the read succeeds (1.4s)
```

The first asserts the card is the read-failure one (`This document could not be
read`, and **not** `no longer exists`), the toast is `data-tone="error"`, its
message names the quote and says the document could not be read, and it contains
none of the three existing wordings — `no longer on this document`, `was
deleted`, `did not finish loading`. The second is the third acceptance criterion:
the same open with the refusal lifted flashes normally and raises no toast at
all, so the sentence describes an attempt rather than a verdict.

### Falsification

Removing the branch — `missing.current ? "gone" : gaveUp` — and re-running the
unit suite:

```
× names the failed read rather than saying the quote moved
  Tests  1 failed | 13 passed (14)
```

The drifted-anchor sentence comes straight back, which is the defect. Restored.

### Unit coverage

`useReaderSurface.test.tsx` grew a `readFailed` prop on its harness and two
tests: the wording and tone above, and **"keeps the deleted wording when the
document is both gone and unread"** — a deleted document is trivially also one
that could not be read, and the precedence has to survive somebody tidying the
fourth member into the third.

### Checks

- `npm run typecheck`, `npm run lint`, `npm run format:check`: clean.
- `vitest run packages/kit apps/ui`: 4712 passed.
- Full Playwright suite `--workers=2`: 640 passed, 0 failed.
