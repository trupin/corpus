# [SERVER-055] The read path implements two of SPEC §6's three resolution rungs

## Domain
server

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
- SPEC.md §6 Anchoring — the resolution ladder

## Summary
Escalated by UI-062 (2026-08-04) while tracing why a comment landed at the top of
a document.

`apps/server/src/docs/read.ts:252` resolves anchors with `resolveAnchorExact` —
rungs 1 and 2 (literal match, then unique `exact`). SPEC §6 specifies a **third,
fuzzy rung** for when a document has been edited under an anchor. It is not
implemented on this path, so an anchor that the spec says should survive a small
edit is reported `orphaned` instead.

The user-visible consequence: edit a paragraph you have commented on, and the
comment detaches when the spec says it should follow. That is the whole point of
text-quote anchoring over line numbers — it is supposed to survive editing — so
this is a gap in the central promise of §6, not a nicety.

Worth checking before assuming it is simply missing: the anchor **engine** has
had substantial work (SERVER-002, -012, -013, -014 covered truncated selectors,
the substitution class, and duplicate-survivor policy). It is possible the fuzzy
rung exists in the engine and the read path does not call it, which would make
this a wiring fix rather than an implementation. Establish which first — the two
have very different risk.

## Acceptance Criteria
- [ ] The read path resolves through the full §6 ladder, fuzzy rung included
- [ ] An anchor whose surrounding text was edited but whose quote survives is
      resolved, not orphaned — with a test per edit shape (insertion before,
      insertion inside, deletion after, whitespace change)
- [ ] A quote that genuinely no longer exists still orphans — the fuzzy rung must
      not become a "match something nearby" that re-introduces the
      confidently-wrong anchoring the client-side guards exist to prevent
- [ ] Duplicate-survivor policy (SERVER-014) is respected by whatever the fuzzy
      rung does; the two must not disagree about which of two candidates wins
- [ ] If the engine already implements it, say so and make this a wiring change
      with the reasoning recorded rather than a second implementation
- [ ] Reconciliation on write (§6) and resolution on read agree about what
      resolves — a divergence here would show as an anchor that reconciles
      cleanly and then reads as orphaned

## Technical Design
### Files to Create/Modify
- `apps/server/src/docs/read.ts`, the anchor engine, tests

## Testing Strategy
Fixture-driven per edit shape, plus a round-trip test: write an edit through the
real mutation path and assert the anchor reads back resolved.

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
