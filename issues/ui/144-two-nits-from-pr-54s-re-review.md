# [UI-144] A deleted document's reveal names the wrong absence

## Domain
ui

## Status
done

**Halved 2026-08-22 by SHARED-065 (Phase 41), and kept open.** This issue carried
two independent NITs from PR #54. The second was
`plugins/todos/ui/dismiss.ts:66` — a ref assigned during render — and SHARED-067
removed the plugin surface, so INFRA-031 deletes that file with the rest of
`plugins/`. It is struck below rather than erased, so the PR #54 record still
reads true.

**The first NIT is core and untouched.** `apps/ui/src/reader/reveal.ts`'s
`revealMissNotice` (now :650, filed as :640) is core reader code, has nothing to
do with plugins, and is the whole reason this issue stays open. The title and the
summary drop the second half.

## Priority
P3

## Model
opus

## Dependencies
- Related: UI-140 (whose fix raised both), UI-048

## Spec References
- SPEC.md **§10** — the reveal, and how a surface accounts for a miss

## Summary

One NIT from PR #54's re-review, 2026-08-21 — the surviving half of two. The
reviewer approved the PR and recorded both as not worth blocking. They were filed
rather than fixed in place because neither has an observable consequence and both
would have cost a CI cycle on a release head.

## 1. `apps/ui/src/reader/reveal.ts:640` — the notice names the wrong absence

UI-140's fix extended the settled marker to the `.reader-gone` card, so a reveal
into a **deleted** document now concludes `absent` in ~350ms and toasts *"…is no
longer on this document"*.

That is a large improvement on the old behaviour — error tone at four seconds,
blaming loading — and the extension is right: deletion is a settled fact about
the workspace, not a session fault.

**But the sentence is imprecise.** The quote is not "no longer on this document";
there is no document. The card beside it carries the truth, which is why this is
a NIT rather than a defect.

`revealMissNotice` currently distinguishes two cases — gone-from-here and
did-not-load. A deleted document is a third, and it reads better as its own
sentence than as the nearest of two.

## ~~2. `plugins/todos/ui/dismiss.ts:66` — a ref assigned during render~~

**MOOT — closed 2026-08-22 by SHARED-065 (Phase 41).** SHARED-067 removed the
plugin surface, and INFRA-031 deletes `plugins/` including `dismiss.ts` and the
`TodoItemComposer.test.tsx` churn test that guarded it. The render-time ref
assignment goes with the file. Nothing generalises: the finding was one line in
one plugin component, not a pattern the reviewer found repeated in core.

## Acceptance Criteria
- [x] A reveal into a deleted document says the document is gone, not that the
      quote moved
- [x] The two existing cases keep their wording and their tones
- [x] No lint rule disabled
- [ ] ~~`dismiss.ts` assigns its ref in an effect~~ — no subject; the file is
      deleted with `plugins/`

## Testing Strategy
Extend UI-140's warm-open tests with the deleted-document case, asserting the
sentence rather than only the tone.

## E2E Verification Log

**Model: Opus 5 (1M context).** 2026-08-24.

### What changed

- `apps/ui/src/reader/reveal.ts` — a third word, `RevealMiss = RevealGaveUp |
  "gone"`, and a third sentence in `revealMissNotice`:
  *"Could not show “…” — this document was deleted."*, tone `info`.
  `RevealGaveUp` and `revealPatience` are untouched: the patience machine sees a
  surface and can only conclude `absent` or `unresolved`, and whether there is a
  document behind that surface is not a fact it holds.
- `apps/ui/src/reader/useReaderSurface.ts` — the hook that *does* hold it. A ref
  on `ReaderDoc.isMissing`, read **at the moment of giving up** rather than at
  the start, because a document can be deleted while the reveal is still
  looking. `gone` overrides both other verdicts: a deleted document also cannot
  finish loading, so a reveal that reached the ceiling against one would
  otherwise blame a load that was never going to happen.

### Reproduction, then the fix, in a real browser

`apps/ui/e2e/reveal.spec.ts` — a new spec, `an open that names an item on a
document that is gone`. A navigation entry carrying a reveal is seeded against a
document the corpus does not hold, so `GET /api/docs/doc_deleted` answers `404`,
`ReaderDoc.isMissing` is set, and `DocView` draws the `.reader-gone` card that
carries the settled marker. Observed, `CORPUS_UI_PORT=5373`, chromium:

- `.reader-gone` visible — the card whose truth the toast has to agree with.
- `.toast[data-tone="info"]` — still information, as UI-140 decided.
- `.toast .msg` contains `Book the passport appointment` and
  `this document was deleted`, and contains **neither** `no longer on this
  document` nor `did not finish loading`.

### Falsification

`missing.current ? "gone" : gaveUp` reduced to `gaveUp` in
`useReaderSurface.ts`: `vitest run apps/ui/src/reader/useReaderSurface.test.tsx`
exits **1** on the new case (the toast reads "…is no longer on this document").
Restored, exit 0.

### Tests

- `apps/ui/src/reader/reveal.test.ts` — the third notice: names the quote, says
  the document was deleted, keeps the info tone, and says neither of the other
  two sentences.
- `apps/ui/src/reader/useReaderSurface.test.tsx` — the warm-open deleted case,
  driven through the hook with `isMissing` set (the `Surface` harness gained a
  `missing` prop). 64 tests in the two files, all green.
- `apps/ui/e2e/reveal.spec.ts` — 10 specs green, the new one included.

### Left standing, and reported rather than fixed

**The `.reader-error` card has the same defect one state over.** `DocView`'s
second terminal render — *"This document could not be read"* — also carries the
settled marker, so a reveal into it concludes `absent` and says the quote *"is no
longer on this document"* about a document that may be perfectly intact and
simply failed to load. That is a fourth wording with no issue and no acceptance
criterion here, and this issue's second criterion is that the two existing cases
keep their wording. Escalated to the orchestrator as a candidate follow-up.
