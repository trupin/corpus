# [UI-102] The e2e stub's row builder returns `unknown`, so field drift is silent

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
- Related: UI-085 (the same stub answering unhandled routes with `{}`), UI-084
  (found it), SERVER-084

## Spec References

- Not a spec behaviour. This is about whether the e2e suite can be believed.

## Summary

Found while closing UI-084's last criterion. `apps/ui/e2e/stubCorpus.ts`'s row
builder returns `unknown`, and the generated typed client validates nothing at
runtime — so a `DocRow` field the stub **omits entirely** reaches the board as
`undefined` and nothing anywhere complains.

It had already happened. `unansweredForms` was added to `DocRow` by CONTRACT-040
and populated by SERVER-084, and the stub did not carry it, so every stubbed row
would have arrived with `unansweredForms: undefined`. The threshold under test
(`> 1`) is merely *false* against `undefined`, so the spec would have passed
while asserting a row shape the server never sends. It was caught only because
UI-084's author ran a negative control.

This is the same defect class as UI-085 — a stub whose infidelity is invisible —
and it is worth more than UI-085, because UI-085 makes a spec fail confusingly
while this one makes a spec **pass**.

## Acceptance Criteria

- [ ] The stub's row builder is typed as the contract's `DocRow`, so omitting a
      field is a **typecheck error** rather than a runtime `undefined`
- [ ] Adding a required field to `DocRow` breaks the stub at compile time. Prove
      it by adding one temporarily, not by reasoning about it
- [ ] Every other builder in the stub gets the same treatment, or the ones that
      cannot are named with the reason. A partial fix here restores the same
      false confidence for whatever was left out
- [ ] No spec is weakened to accommodate the typing — if a spec was relying on a
      partial row, it was relying on a shape the server never sends, and the spec
      is what is wrong
- [ ] Check whether any **currently passing** spec is asserting against a row the
      server would not produce. That is the sweep this issue is for; the typing
      is only what stops it recurring

## Technical Design

### Files to Create/Modify

- `apps/ui/e2e/stubCorpus.ts`, and whatever specs the sweep turns up.

### Notes

- The stub deliberately answers at the transport boundary, so it will always be
  possible to send bytes the contract forbids. The goal is not to make that
  impossible — it is to make it **deliberate**: a cast with a reason at the one
  place a spec wants a malformed payload, instead of silence everywhere.
- `packages/kit/src/testing/docRow.ts` is the fixture that already models a
  complete row. Check whether the stub should build on it rather than keeping a
  second, weaker idea of what a row is.

## Testing Strategy

The proof is the compile error: add a required field to `DocRow`, confirm the
stub fails to typecheck, remove it. Plus whatever the sweep of existing specs
turns up — each of those is its own assertion to fix.

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
