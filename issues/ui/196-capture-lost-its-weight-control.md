# [UI-196] Capture has no weight control while the Ask designates

## Domain

ui

## Status

done — 2026-09-07, resolved by PR #77's review pass (finding 2), recorded in
UI-192's follow-up log

## Priority

P1

## Model

fable

## Dependencies

- Depends on: UI-192 (whose ownership decision created this)

## Spec References

- SPEC.md **§10** — the weight sentence names "its Capture"

## Summary

UI-192's escalation, accepted 2026-09-07: resolving the duplicated weight
editors gave the composer row's Select sole ownership while the Ask
designates — and Capture, which shares the surface, lost its weight control
in that default state. The duplicate was judged worse than the narrowing,
and §10's "its Capture" wording says the narrowing is a real gap, not a
simplification. Decide a capture-scoped affordance (or a rider narrowing
§10) and implement.

## Resolution (2026-09-07)

No new affordance and no rider: **the existing "at" `Select` is Capture's
weight control too.** UI-192's one-editor principle, extended — one control,
one question ("how much thought does the work get"), and which field carries
the answer is the submit's business:

- **Ask, designating**: the choice rides inside `resident` as the
  designation's level (unchanged).
- **Capture, designating**: the same choice rides as the capture's own
  top-level `weight` (the change — `apps/ui/src/compose/ComposeOverlay.tsx`,
  `captureWeight`). The wire half already existed: `CaptureRequestSchema`
  carries `weight: requestedWeightField`, and `useCompose`'s capture branch
  already spreads `input.weight`, so no contract or server change was needed.
- **Either submit, no owner**: the address's rows stay the single editor
  (unchanged).
- **"The launcher decides"**: nothing is sent (unchanged).

The tooltip (`RESIDENT_WEIGHT_TITLE`) and label (`RESIDENT_WEIGHT_ARIA`) now
describe the one control honestly for both submits — a description of one
control's two destinations, not the cross-control disambiguation UI-192
deleted.

Rejected: a capture-scoped second control (the reported duplication again,
aimed at the other submit), and a rider narrowing §10's "its Capture".

## Acceptance Criteria

- [x] Capture can state a weight in every state the spec grants it one, or
      a signed rider says it cannot — designating: the "at" pill rides the
      capture's `weight`; no owner: the address's rows ride it; a workspace
      declaring no levels offers no control anywhere, which is the tier
      table's own rule (§7), not a Capture gap
- [x] No duplicated editor returns — UI-192's one-editor rule holds (the
      one-editor e2e passes untouched; no new control was added)

## E2E Verification Log

**Model**: Fable 5 (`claude-fable-5`). **Date**: 2026-09-07.

- **Wire verified before implementing** (the review's stop condition):
  `packages/contract/src/schemas/capture.ts` — `CaptureRequestSchema` carries
  `weight: requestedWeightField`; `apps/ui/src/compose/useCompose.ts`'s
  capture branch spreads `input.weight`. The wire half works, so this issue
  closes instead of staying open.
- **E2E, real Chromium** (Playwright's Vite, `CORPUS_UI_PORT=5773`,
  `ask-designation-weight.spec.ts` → "the weight a Capture states (UI-196)"):
  picking `at = Heavy or judgment-laden` and pressing Capture sends the
  multipart `weight` part `"heavy"` with **no** `resident` part; left at
  "the launcher decides", no `weight` part at all; in the no-owner state the
  address's `light` rides the capture unchanged. **12/12 PASS** for the spec.
- **Unit** (`ComposeOverlay.test.tsx`, 55/55): the ride pinned and falsified
  by mutation — reverting the submit's field choice
  (`mode === "capture" ? captureWeight : address.weightRequest`) sent the pin
  red; restore sent it green. The launcher-decides absence pinned beside it.
- `eslint`, `prettier --check`, `npm run typecheck`: clean.
