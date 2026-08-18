# [SHARED-054] The missing-profile causes are typed again, one layer out

## Domain

shared

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: SHARED-053 (the false half these all now state correctly), CONTRACT-064

## Spec References

- SPEC.md **§7** line 323 — the resident rider

## Summary

PR #50 corrected ten typed copies of *what makes a resident's profile go missing*
and removed the ability to type it in the kit: `MISSING_PROFILE_CAUSES` is an
exported array, the note is composed from it, and
`scripts/missing-profile-parity.test.ts` pairs each cause with a workspace act by
type identity.

**Five sites outside that reach still carry the causes as hand-typed prose**, with
nothing tying them to the array. Found by PR #50's fourth review:

- `apps/cli/src/commands/agents.ts:205-208`
- `apps/cli/src/commands/thread/designate.ts:120-141` and `:188-190`
- `apps/cli/src/commands/thread/show.ts:93-97`
- `apps/cli/src/commands/resident.ts:15-21`
- `packages/contract/src/schemas/agents.ts:118` and `:165-167`

**All five agree today** — the reviewer read each one. This is not a bug report;
it is the same shape the original issue was about, one layer out, and the reason
that shape produced four false statements was that nothing held the copies
together.

There is a second-order oddity worth naming: `laneRows.ts:155-159` calls the
**contract's** `docId` description canonical, while the kit holds the actual
array. Nothing compares them.

## Why it was not fixed in PR #50

Round four of a three-round review, on a release already four issues wider than
agreed. The MAJOR in that round was a one-clause edit; this is a cross-package
pin spanning `packages/contract`, `apps/cli` and `packages/kit`, and building it
under time pressure at the end of a long release is how the last rushed
abstraction got written.

## What has to be decided

1. **Where the causes live.** The kit's array cannot be the source for the
   contract — `packages/contract` is upstream of `packages/kit`, and the
   dependency direction is fixed (CLAUDE.md). So either the array moves to the
   contract and the kit consumes it, or the pin compares two independent
   statements rather than deriving one from the other.
2. Whether prose that *mentions* the causes must be composed, or only prose that
   *enumerates* them. A help paragraph reads badly if every noun is interpolated,
   and an unreadable help text is its own defect.
3. Whether a pin comparing sentences is enough, given the smuggling test
   SHARED-053's pin survived (*"or shelved since"*, dodging every word in the
   vocabulary).

## Acceptance Criteria

- [ ] One home for the causes, respecting the contract → kit dependency direction
- [ ] Every site that enumerates them either composes from that home or is held
      to it by a test
- [ ] The test survives a smuggled restatement worded to avoid the vocabulary —
      the standard `scripts/missing-profile-parity.test.ts` already meets
- [ ] `laneRows.ts`'s claim about which text is canonical is true afterwards, or
      is removed

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/agents.ts` — likely the new home
- `packages/kit/src/recipient/laneRows.ts` — consume rather than declare
- the four `apps/cli` sites
- a pin, probably in `scripts/`, since it is the only tree allowed to see several
  applications at once

### Key Implementation Details

Read `scripts/missing-profile-parity.test.ts` first. It pairs a cause with an act
**by type identity**, applies it to a real workspace, and asserts set-equality in
both directions. That is the standard to hold, not string matching.

## Testing Strategy

Extend the existing parity test rather than adding a second one. Falsify by
restating a cause in different words at one site and confirming it fires.

## E2E Verification Plan

### Verification Steps

1. Change the causes at their new home and confirm every dependent surface
   follows, or fails
2. Confirm the CLI's `--help` still reads as English

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SHARED-054]` prefix
