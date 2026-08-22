# [UI-144] A deleted document's reveal names the wrong absence

## Domain
ui

## Status
todo

**Halved 2026-08-22 by SHARED-065 (Phase 41), and kept open.** This issue carried
two independent NITs from PR #54. The second was
`plugins/todos/ui/dismiss.ts:66` — a ref assigned during render — and SHARED-064
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

**MOOT — closed 2026-08-22 by SHARED-065 (Phase 41).** SHARED-064 removed the
plugin surface, and INFRA-031 deletes `plugins/` including `dismiss.ts` and the
`TodoItemComposer.test.tsx` churn test that guarded it. The render-time ref
assignment goes with the file. Nothing generalises: the finding was one line in
one plugin component, not a pattern the reviewer found repeated in core.

## Acceptance Criteria
- [ ] A reveal into a deleted document says the document is gone, not that the
      quote moved
- [ ] The two existing cases keep their wording and their tones
- [ ] No lint rule disabled
- [ ] ~~`dismiss.ts` assigns its ref in an effect~~ — no subject; the file is
      deleted with `plugins/`

## Testing Strategy
Extend UI-140's warm-open tests with the deleted-document case, asserting the
sentence rather than only the tone.

## E2E Verification Log
_[Agent fills — state the model]_
