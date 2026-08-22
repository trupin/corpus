# [UI-106] A carried effect is not an error, and the UI renders every warning as one

## Domain

ui

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: CONTRACT-047 (added the codes), SERVER-088 (emits them)
- Blocks: —

## Spec References

- SPEC.md **§11** — warnings are the non-fatal channel
- SPEC.md **§7** — a skill folder move is ordinary, specified behaviour

## Summary

Flagged by CONTRACT-047's implementing agent. Several sites in `apps/ui` render
warnings with `tone: "error"`. That was defensible while every `WarningCode`
described something wrong with a document; CONTRACT-047 widened the channel to
carry **effects on documents the request did not name**, and a `carried_skill`
warning describes §7 working exactly as specified.

Rendering "archiving this skill also disabled the nested one" in the same red as
a validation failure teaches people to dismiss the channel — which is how the
one that *is* a problem gets missed.

## Acceptance Criteria

- [ ] `carried_skill` and `carried_reconciliation` render as **information**, not
      as errors
- [ ] The distinction is driven by the code, not by a string match on `detail` —
      the contract forbids parsing `detail`, and a tone chosen from prose is a
      parse
- [ ] Every other `WarningCode` keeps the tone it has today; this is not a
      re-theming of the channel
- [ ] Adding a `WarningCode` later forces a tone decision rather than defaulting
      silently to error. An exhaustive mapping is what makes that true — note
      that no exhaustive `switch` over `WarningCode` exists anywhere today
- [ ] The carried warnings are legible about *which* document they name: a person
      reading one is being told about a document they did not act on

## Technical Design

### Files to Create/Modify

- Wherever `apps/ui` maps a warning to a tone; check `packages/kit` too, because
  the row and notice components live there and render the same channel.
  (**Amended 2026-08-22 by SHARED-065, Phase 41**: the original reason for
  checking the kit was that a plugin surface might render the channel. SHARED-064
  removed plugins, but the kit is kept — SHARED-064 amendment 3 rewords it as
  *"the shared UI kit — the components and data hooks `apps/ui` is built from"* —
  so the instruction survives its cause and keeps its reason restated.)

### Notes

- Do not widen this into a general warnings redesign. The narrow fact is that two
  new codes describe specified behaviour rather than a problem.

## Testing Strategy

A response carrying each new code renders as information; a response carrying an
existing code is unchanged. Plus the exhaustiveness check — a new code with no
tone mapping should fail to typecheck rather than render red.

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
