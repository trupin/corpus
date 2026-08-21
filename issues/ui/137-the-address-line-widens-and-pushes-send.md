# [UI-137] The address line widens when its weight arrives, and pushes Send

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-057 (signed 2026-08-20)
- Blocks: —
- Related: UI-127, UI-130 (the same control), UI-131 (which measured this)

## Spec References

- SPEC.md **§11** — *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)
- SPEC.md **§11** — the composer, its recipient statement and its submit control

## Summary

Measured by UI-131's implementer, 2026-08-20, while fixing the same shape one
surface over:

```
address line  x=95 w=124.83 → w=170.97   (+46.14)
send button   x=350.5       → x=386.80   (+36.30)
```

The composer's address line reads `<who> · <weight>`. The weight clause arrives
on a **second** request — the roster names a level key and the workspace's own
orchestrate skill turns it into words — and when it lands the pill widens and
**pushes the Send button 36px to the right.**

**This is the release's own headline defect, on the control the release started
from, and it moves a control rather than a label.** UI-127 stopped the popover
oscillating and UI-130 gave it a ceiling; neither touched the line itself.

## Why UI-131's answer does not transfer

Stated by its implementer rather than rediscovered here. The console's fix
reserves a `ch` box because its content is a weight label drawn from a **fixed
vocabulary**. Here the weight clause lives inside one `.address-line-text` string
built by `addressLine()`, and the line reads `<who> · <weight>` where *who* is an
arbitrary-length name. There is no vocabulary to size a reservation against.

## The two candidates, and the one to take

**Take: the line's width is a property of its slot in the footer, not of its
text.** That is SHARED-057's first clause applied literally, and the whole value
is already reachable — UI-127 put the full statement on the line's `title`.

**Rejected: reserve only the weight clause.** It leaves the name variable, so the
line still resizes whenever the name arrives, changes, or a different lane is
picked. It fixes the trigger this issue measured and not the defect.

## Acceptance Criteria

- [ ] The address line's width does not change when the weight label arrives, when
      the recipient changes, or when the name is long or short
- [ ] **The Send button does not move**, at any composer host, in any of those
      cases — this is the acceptance test, measured
- [ ] The full statement stays reachable; truncation reveals rather than hides
      (SHARED-057 clause 2)
- [ ] The slot is sized against real content (clause 3) — state the measurement
- [ ] UI-127's and UI-130's specs stay green, unmodified
- [ ] `design/index.html` is the reference for how the pill reads at a fixed
      width. If this changes the pill's look, say so and say why it is still the
      mockup's intent
- [ ] Falsified: restore the content-driven width, watch Send move by ~36px

## Technical Design

### Files to Create/Modify

- `packages/kit/src/address/ComposerAddress.tsx`, `address.css`
- `apps/ui/e2e/address-geometry.spec.ts` — the Send-button assertion

### Key Implementation Details

Read UI-127's and UI-130's E2E logs first — three issues have now worked this
component and each records why its mechanism is shaped as it is. `addressLine()`
composes the string; the `title` already carries the whole of it.

### Edge Cases

- The floor state (`Nobody is asked`), which is shorter than every other
- A resident lane, whose line carries the resident's weight rather than a picked one
- A very narrow composer, where the slot and the text area compete
- The comment popover host, whose footer differs from the thread composer's

## Testing Strategy

A browser geometry test. The reflow is driven by a second network response, so
the spec must delay it — an already-resolved label reproduces nothing.

## E2E Verification Plan

### Verification Steps

1. Real Vite dev server, ports not 5173 / not 8765
2. Delay the skill-document request; measure the line and the Send button before
   and after it resolves
3. Repeat with a long recipient name and a short one
4. Repeat at every composer host

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-137]` prefix
