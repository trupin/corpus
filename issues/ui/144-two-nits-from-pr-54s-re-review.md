# [UI-144] A deleted document's reveal names the wrong absence, and a ref is written in render

## Domain
ui

## Status
todo

## Priority
P3

## Model
opus

## Dependencies
- Related: UI-140 (whose fix raised both), UI-048

## Spec References
- SPEC.md **§11** — the reveal, and how a surface accounts for a miss

## Summary

Two NITs from PR #54's re-review, 2026-08-21. The reviewer approved the PR and
recorded both as not worth blocking. They are filed rather than fixed in place
because neither has an observable consequence and both would have cost a CI
cycle on a release head.

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

## 2. `plugins/todos/ui/dismiss.ts:66` — a ref assigned during render

`guard.current = options.guard` is written in the render body. The
latest-value-ref idiom is correct here and the listeners read it after commit,
so there is no observable consequence in this component. React's guidance is to
assign in an effect: a discarded concurrent render briefly leaves `current`
pointing at an uncommitted closure.

The test added with the original fix (`TodoItemComposer.test.tsx:335`) is
meaningful and should stay — it counts `mousedown` attachments and fails on
listener churn, which is the defect that fix was for.

## Acceptance Criteria
- [ ] A reveal into a deleted document says the document is gone, not that the
      quote moved
- [ ] The two existing cases keep their wording and their tones
- [ ] `dismiss.ts` assigns its ref in an effect, and the churn test still passes
- [ ] No lint rule disabled

## Testing Strategy
Extend UI-140's warm-open tests with the deleted-document case, asserting the
sentence rather than only the tone.

## E2E Verification Log
_[Agent fills — state the model]_
