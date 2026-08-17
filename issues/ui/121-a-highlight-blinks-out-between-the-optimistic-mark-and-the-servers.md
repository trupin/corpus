# [UI-121] A highlight blinks out between the optimistic mark and the server's

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Related: UI-112 (which painted the provisional highlight), UI-117 (which found
  this while proving a spec wrong)

## Spec References

- SPEC.md **§6** — anchors and how a highlight is painted
- SPEC.md **§11** — *"the selection… **is highlighted in the turn** the way an
  anchor is highlighted in a document"*

## Summary

`apps/ui/src/anchors/useAnchorLayer.ts` drops the **provisional** highlight in
the send mutation's `onSuccess`, and the **server's** anchor arrives only when
the invalidated document read resolves. Between the two, a document that
genuinely has an anchor shows **no highlight at all**.

Measured by UI-117 with a per-frame probe while it was diagnosing a spec:
`0 → 2 (provisional) → 0 → 2 (server)`. On the e2e stub that gap is
milliseconds. **Against a real server it is a round trip**, and it is visible.

So the thing a person is looking at — the passage they just commented on —
goes dark at the moment their comment lands, then comes back. UI-112 exists
precisely so that selection stays visible while they work; this is the same
complaint at the other end of the interaction.

**This is a product defect, not a test hazard.** UI-117 flagged it rather than
fixing it, correctly: its issue was a spec, and repairing the surface would have
been a different change smuggled into a test fix.

## What it should do

The mark should not go out. The provisional decoration is *about to become* the
server's anchor over the same words — UI-112 already says so: *"on send it is
replaced by the real anchor, which is the same paint by a different owner."*
Replacement should mean handover, not a gap.

Two shapes worth weighing, and the choice should be stated:

- **Hold the provisional until the server's anchor is drawn** — simple, but it
  must not hold forever if the refetch fails, and it must not double-paint
  during the overlap.
- **Reconcile rather than replace** — treat the arriving anchor as the same mark
  acquiring an owner. Closer to what is actually happening, and it removes the
  window rather than covering it.

Consider what happens when the send is **refused**: UI-112 says the provisional
mark disappears cleanly, leaving nothing behind, and that must survive whatever
is done here.

## Acceptance Criteria

- [ ] A document with an anchor never renders zero highlights across a
      successful send, measured **per frame**, not asserted at two instants
- [ ] Verified against a **real server**, where the gap is a round trip — the
      stub's millisecond window is not the case that matters
- [ ] A refused send still leaves no mark (UI-112's criterion, unbroken)
- [ ] No double-paint during handover: one mark over those words throughout
- [ ] A failed refetch does not strand the provisional mark forever

## Technical Design

### Files to Create/Modify

- `apps/ui/src/anchors/useAnchorLayer.ts`
- `apps/ui/src/anchors/anchorDecorations.ts`

### Notes

`anchorDecorations.ts` paints `.anchor-hl` from two independent sources —
`data-provisional="true"` with no thread id, and `data-thread`. That the two are
distinguishable in the DOM is what let UI-117 diagnose this, and it is probably
also what the fix should key on.

## Testing Strategy

A per-frame probe is the honest test, since the defect is a transient. Assert
over samples, not at two points — that is exactly the mistake UI-117 found in a
spec asserting this same area.

## E2E Verification Log

_Filled by the implementing agent. Reproduce first, against a real server._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-121]` prefix
