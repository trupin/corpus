# [UI-071] A highlight briefly lands on the wrong words while a document re-anchors

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: UI-062
- Blocks: —

## Spec References
- SPEC.md §6 Anchoring, §11 adaptive thread placement

## Summary
Caught by the pre-push gate on 2026-08-05, on the v0.3.0 release commit —
`apps/ui/e2e/todos.spec.ts:607`, "keeps the highlight on the item after the
checkbox is toggled":

```
Locator:  locator('.reader .anchor-hl')
Expected: "Call the plumber"
Received: "ores that landed "
  14 × locator resolved to
       <span class="anchor-hl" data-thread="th_new1" data-anchor="anc_new1">ores that landed </span>
```

**The failure mode is the point.** A highlight that is *missing* while a document
re-renders is ordinary timing. A highlight drawn over **different words** is the
confidently-wrong class the anchor work exists to prevent — the user sees a
comment attached to text it is not about.

**Load-sensitive, not deterministic.** It failed once in a full push gate (with
the unit suite and 270 other specs competing) and then passed **4 out of 4** runs
in isolation. So the window is real but narrow, and the assertion caught an
intermediate state rather than a settled one.

## Hypothesis to test first
The spec toggles a checkbox, which rewrites the document body. Between the new
body arriving and the newly-resolved anchors arriving, the reader plausibly holds
**the old range against the new text** — the offsets still apply cleanly, they
just name different characters now. `"ores that landed "` reads like the interior
of a longer word ("chores that landed"), which is what an offset shifted by a few
characters would produce.

If that is it, the fix is to refuse to draw a placement whose provenance does not
match the body it is being drawn on — the same discipline UI-062 applied to
incomparable offsets, extended to the transient case. **Do not fix it by
debouncing or by hiding the highlight during a refetch**: that narrows the window
without closing it, and the standard here is that a wrong highlight is worse than
no highlight.

Check also whether this predates UI-062 or is newly reachable because of it.
UI-062 made placement *succeed* in cases where it previously gave up, so a
transient that was invisible before may now be drawable. Either answer is useful;
say which.

## Acceptance Criteria
- [ ] A checkbox toggle (or any body edit) never draws a highlight over text the
      anchor does not cover — asserted at the intermediate state, not only after
      it settles
- [ ] Reproduced under load before the fix: run the spec with the machine busy,
      or drive the intermediate state directly, and record the wrong text
- [ ] The settled behaviour is unchanged — the highlight returns to the right
      words after the edit
- [ ] Whichever way it is fixed, no debounce or visibility trick that merely
      shortens the window
- [ ] A test that would fail against today's code, not one that passes because
      the race rarely loses

## Technical Design
### Files to Create/Modify
- `apps/ui/src/anchors/useAnchorLayer.ts`, `anchorPlacement.ts`
- `apps/ui/e2e/todos.spec.ts` (or a new spec closer to the seam)

## Testing Strategy
Drive the intermediate state deterministically — stale anchors against a fresh
body — rather than relying on a race to lose.

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
