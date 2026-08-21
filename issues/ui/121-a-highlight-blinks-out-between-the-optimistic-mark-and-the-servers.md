# [UI-121] A highlight blinks out between the optimistic mark and the server's

## Domain

ui

## Status

done

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

- [x] A document with an anchor never renders zero highlights across a
      successful send, measured **per frame**, not asserted at two instants
- [x] Verified against a **real server**, where the gap is a round trip — the
      stub's millisecond window is not the case that matters
- [x] A refused send still leaves no mark (UI-112's criterion, unbroken)
- [x] No double-paint during handover: one mark over those words throughout
- [x] A failed refetch does not strand the provisional mark forever

## Technical Design

### Files to Create/Modify

- `apps/ui/src/anchors/useAnchorLayer.ts`
- `apps/ui/src/anchors/anchorDecorations.ts`
- `apps/ui/src/anchors/anchorDecorations.test.ts` — the handover, at the plugin
- `apps/ui/src/anchors/useAnchorLayer.test.tsx` — the per-transaction recorder
- `apps/ui/e2e/anchor-layer.spec.ts` — the per-frame spec

### Notes

`anchorDecorations.ts` paints `.anchor-hl` from two independent sources —
`data-provisional="true"` with no thread id, and `data-thread`. That the two are
distinguishable in the DOM is what let UI-117 diagnose this, and it is probably
also what the fix should key on.

## Testing Strategy

A per-frame probe is the honest test, since the defect is a transient. Assert
over samples, not at two points — that is exactly the mistake UI-117 found in a
spec asserting this same area.

## The decision, and what it rejects

**Reconcile.** The arriving anchor is the same mark acquiring an owner, not a
replacement for it.

Mechanically it is two things, and neither works alone:

1. **The mark gains an owner.** `post`'s `onSuccess` no longer drops the
   provisional. It writes the thread id the server just assigned onto the mark
   that is already up (`claimProvisionalTransaction`).
2. **The plugin ends the mark in the transaction that draws the anchor.**
   `handOver` runs on every `apply`, and an owned mark whose thread now has a
   drawable placement is dropped in that same transaction.

Because the two are one transaction, there is no state between them: no frame
with no mark, and none with two. "One mark throughout" is true by construction
rather than by two clocks agreeing.

The owner is matched by **thread id, never by range**. The server's anchor is
frequently not the shape of the selection it came from — a quote crossing `**`
arrives in two segments where the selection was one — so a range comparison
would fail exactly where the split makes the handover most visible.

**Rejected: hold the provisional until the server's anchor is drawn.** It covers
the window instead of removing it, and it has to answer two questions this does
not. *Whose* anchor ends the hold — a refetch carrying another thread's anchor
would end it early, and the mark would go dark with its own anchor still on the
way. And *what stops the double paint* during the overlap, which then needs a
second rule about painting, in a different place from the rule about holding.
Two rules that must agree is how the original gap got in.

**What did not change.** A refusal claims nothing: the composer re-opens on the
same words, still lit (UI-112, UI-111). Abandoning still leaves nothing behind.
Both were re-checked against the real server, below.

**The deadline, and why it is not the mechanism.** `HANDOVER_TIMEOUT_MS`
(10 s) exists only for the branch that produces no transaction to hand over in:
a document read that fails, or an anchor the server could not place. Without it
a mark would sit on words nothing owns for as long as the reader stayed open —
which is the failure that "hold until the anchor arrives" invites. It is
guarded on the plugin still holding a mark, so a completed handover costs
nothing.

## E2E Verification Log

Model: **Opus 5 (1M context)** (`claude-opus-5[1m]`), ui-dev.

### Real app: real server, real workspace, real browser

`corpus init /tmp/ui121-ws --port 8843` (never 8765 — the user's live server),
`corpus server start` (pid 66523), documents created through `POST /api/docs`,
Vite on **5573** with `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8843` and
`VITE_CORPUS_TOKEN`, driven by a real Chrome at 1400×900. A fresh document per
run, so no run inherits the previous run's anchors.

Latency is emulated with CDP `Network.emulateNetworkConditions`, enabled
**after** the reader is open. It is not a stub: every request still goes to the
real server on 8843. It is what makes the server one round trip away instead of
on this machine's loopback, which is the case the issue is about.

The probe samples `.reader .doc-body .anchor-hl` — total, `[data-provisional]`
and `[data-thread]` — on **every animation frame**, through the whole flow.

### Reproduction — BEFORE the fix

At 0 ms of added latency the hole is sub-frame and the probe cannot see it:
`1 (provisional) → 1 (server)` across 17 frames, 0 dark. That is the reading
that makes this look fine on this machine, and it is why the issue insists on a
real round trip.

With the server one round trip away, it is plain, and it scales with the trip:

```
LATENCY=250ms                          LATENCY=500ms
t=  128ms  all 1  provisional 1        t=  126ms  all 1  provisional 1
t=  135ms  -- about to click send --   t=  132ms  -- about to click send --
t=  160ms  -- send clicked --          t=  158ms  -- send clicked --
t=  423ms  all 0  provisional 0   <--  t=  686ms  all 0  provisional 0   <--
t=  704ms  all 1  server 1             t= 1206ms  all 1  server 1

frames sampled: 53                     frames sampled: 83
frames with ZERO highlight: 16         frames with ZERO highlight: 30
  dark window: 423ms .. 671ms            dark window: 686ms .. 1168ms
```

**16 consecutive frames — 248 ms — of a passage with an anchor showing no
highlight at all**, and 30 frames (482 ms) at 500 ms. The dark window is one
round trip, exactly as predicted: the mark was dropped in `onSuccess` and the
server's ranges arrive only with the read that `onSuccess` invalidated. A third
run at 250 ms reproduced it identically (16 dark frames, 447–691 ms).

### AFTER the fix — same workspace, same server, same probe

```
LATENCY=250ms                          LATENCY=500ms
t=  127ms  all 1  provisional 1        t=  141ms  all 1  provisional 1
t=  175ms  -- send clicked --          t=  188ms  -- send clicked --
t=  703ms  all 1  provisional 0        t= 1237ms  all 1  provisional 0
           server 1                               server 1

frames sampled: 53                     frames sampled: 83
frames with ZERO highlight:  0         frames with ZERO highlight:  0
frames with BOTH painted:    0         frames with BOTH painted:    0
```

One transition, one frame, one mark. No sample anywhere in either run has zero
highlights, and none has two.

### A refused send, against the real server

A document carrying `The disputed sentence.` twice between identical 32-character
contexts, so §6's rung 1 matches twice and `POST /api/threads` answers **400**
(SERVER-071) — a real refusal from the real server, not an injected one.

```
marks with the composer open: 1
POST /api/threads → 400
marks after the refusal:      1
composer text restored:       "Which one is this?"
marks after escape:           0
composer still open:          0
marks 12s later:              0
```

The refusal claims nothing, so the words stay lit and the composer comes back
holding what it held (UI-112, UI-111). Escape leaves **no** mark. And 12 s
later — past `HANDOVER_TIMEOUT_MS` — still none: nothing this change adds can
resurrect an abandoned mark.

### A read that never brings the anchor

`GET /api/docs/{id}` intercepted, fetched from the real server, and answered
with its `anchors` emptied — so the read comes back and never carries the
anchor. (Aborting it outright is a different case: the reader loses its
document and the editor with it, so there is no surface left for a mark to be
stranded on. Measured: `doc-body: 0` at every sample.)

```
POST /api/threads → 201
t=  1000ms after send   marks: 1  doc-body: 2
t=  4000ms after send   marks: 1  doc-body: 2
t=  8000ms after send   marks: 1  doc-body: 2
t=  9500ms after send   marks: 1  doc-body: 2
t= 11000ms after send   marks: 0  doc-body: 2
t= 14000ms after send   marks: 0  doc-body: 2
```

The mark holds while its anchor might still come, and goes out between 9.5 s and
11 s — the deadline. Not stranded.

### Playwright, against the app

`apps/ui/e2e/anchor-layer.spec.ts`, new describe "the handover from the
composer's mark to the server's anchor". It samples the same three counts per
animation frame and asserts over the samples, never at two instants.

The window is a **held response**, not a sleep: the document read carrying the
anchor is not answered until 20 frames have gone by with it outstanding, so the
apparatus is a condition and not a duration (INFRA-020). The spec also asserts
the window existed — at least 20 sampled frames with no server anchor — so it
cannot pass vacuously on a stub that answers in a millisecond.

- `anchor-layer.spec.ts` → **13 passed**
- with `anchor-layer` + `comment-move` + `turn-comment` + `context-menu` →
  **50 passed**, which is what proves the change did not disturb the composer,
  the turn surface or the context menu.

**Checked red before green.** Restoring the old
`setProvisional(… null)` in `post`'s `onSuccess` fails the new spec on the
per-frame assertion, with three consecutive `{all: 0}` samples in the diff — not
on a timeout and not on a locator.

### Unit

`VITEST_MAX_THREADS=4 vitest run apps/ui/src/anchors` → **386 passed**
(16 files). `vitest run apps/ui` → 3252 passed, 1 failed, and the failure is
**not this work**: `apps/ui/src/abandon/useAbandonEmpty.test.tsx` looks for a
button named `/threads on this document/i`, and that accessible name exists
nowhere in `apps/ui/src` or `packages/kit/src` any more — a rename in
`reader/` or `thread/`, both of which another agent holds this session.
Reported to the orchestrator rather than touched.

`useAnchorLayer.test.tsx` grew a **per-transaction recorder** for the same
reason the e2e grew a per-frame probe: a ProseMirror state is only ever reached
by applying a transaction, so recording the highlight population on every
`apply` is every intermediate the surface actually passed through — exact rather
than sampled, and the unit-test equivalent of the frame probe. Reading at two
instants is what could not see this defect, and is the mistake UI-117 found in a
spec covering this same handover.

**Both falsifications land:**

- old `onSuccess` clear restored → **5 red** in `useAnchorLayer.test.tsx`; with
  the instant assertion removed so the history assertion is reached first, it
  fails as `{dark: 1, double: 0}` — the recorder catches the transient on its
  own.
- `handOver` neutered (`drawn ? mark : mark`) → **4 red**, including the
  double-paint assertion and two plugin-level handover tests.

### Checks

`prettier --check` clean on all five touched files, `eslint` clean,
`tsc --noEmit -p apps/ui/tsconfig.json` exit 0 with zero `error TS`.

### Not fixed, and deliberately

- **A wholesale document replacement while a comment is in flight still ends
  the mark.** `mapProvisional` collapses it, as UI-112 decided, and a claim
  landing afterwards has nothing to own. The words are then dark until the
  anchor arrives. That is unchanged, and it is the right outcome for a
  replacement — those offsets describe a document no longer on screen.
- **`comment-move.spec.ts:277` flaked once** ("lights the words on open and puts
  them out when abandoned", the *turn* surface, which this work does not touch).
  It passed alone and passed on an immediate re-run of the same pair — 21
  passed. Recorded rather than chased.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-121]` prefix
