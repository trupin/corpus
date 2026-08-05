# [UI-073] A plugin panel loading late moves the document under the pointer

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §11 Document view (plugin `DocPanel`, plugin `View`)
- SPEC.md §12 plugins (discovery)

## Summary
Escalated by UI-071 (2026-08-05), which went looking for a stale-anchor bug and
found this instead.

Plugin discovery is a dynamic `import()` started at bootstrap
(`apps/ui/src/plugins/registry.ts`), and a registered `DocPanel` renders **above**
the document body (`DocView.tsx`). When discovery settles *after* the editor has
painted, everything below the panel drops by the panel's height — **measured at
77.9px** in the todos workspace.

**Why this is a product defect and not only a test hazard.** The reader is where
you select text to comment. If the panel arrives mid-gesture, the words move out
from under the pointer between mousedown and mouseup, and the selection lands on
different text — silently, because the selection that results is perfectly valid.
UI-071's evidence is exactly this, driven deterministically:

| | x | y |
| --- | --- | --- |
| `Call the plumber`, panel absent | 54 | 306.7 |
| `Call the plumber`, panel present | 54 | 384.5 |
| `Chores that landed in the inbox.`, panel present | 33 | 315.95 |

A drag aimed at the item at y=306.7 released at y=317.2 — by then the *first
paragraph* — and selected `ores that landed `, two characters into a word. That
string then travelled all the way to a comment quote and a highlight.

A plugin `View` swapping in late is the same defect with a bigger jump, since it
replaces the body wholesale.

**Possible connection to a live report, worth checking rather than assuming:**
the user reported comments anchoring at the wrong place on 2026-08-03 (UI-062),
which was diagnosed and fixed as an offsets problem. Some of those may have been
this instead — a mis-selection rather than a mis-placement. The two are
indistinguishable after the fact from a screenshot, because both end with a
comment quoting words the user did not choose.

## The decision this issue has to make
Two shapes, and they trade differently:

1. **Reserve the slot's space.** The reader lays out as though a panel may
   appear, so nothing moves when it does. Cheap and total, but it costs vertical
   space on every document whether or not a plugin ever fills it, and the height
   is not known before the panel renders.
2. **Hold first paint until discovery settles.** Nothing moves because nothing is
   drawn early. Costs time-to-first-paint on every reader open, for a
   registration that is usually empty — and discovery is a network-ish import, so
   the wait is unbounded in the bad case.

A third, weaker option is to let it move but suppress the *consequence* — e.g.
cancel an in-flight selection when the layout shifts. That does not fix a click
landing on the wrong row, so it is a partial answer at best.

Whichever is chosen, say why in the code where the layout decision lives.

## Acceptance Criteria
- [ ] A plugin panel arriving after first paint does not move content that is
      already on screen
- [ ] Reproduced first, deterministically — hold the plugin manifest module at
      the route level until the reader has painted (UI-071's `todos.spec.ts`
      helper shows the technique) and record the shift before the fix
- [ ] A drag started before discovery settles selects the words it was aimed at
- [ ] A plugin `View` (which replaces the body) is covered too, not just a panel
- [ ] No regression to time-to-first-paint that a user would notice, or if
      option 2 is chosen, a stated bound on the wait and what happens when
      discovery never settles
- [ ] A document with no plugin panel looks unchanged — this must not cost
      vertical space on every reader for a slot nothing fills

## Technical Design
### Files to Create/Modify
- `apps/ui/src/plugins/registry.ts`, `apps/ui/src/reader/DocView.tsx`
- tests, plus an e2e that drives the late arrival deterministically

## Testing Strategy
Deterministic late arrival (module held at the route level), asserting geometry
before and after; a drag across the shift asserting the selected text.

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
