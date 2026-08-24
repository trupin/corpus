# [SHARED-054] The missing-profile causes are typed again, one layer out

## Domain

shared

## Status

in_progress

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

- [~] One home for the causes, respecting the contract → kit dependency
      direction — **done for `apps/cli`**, whose four sites now compose from
      `apps/cli/src/commands/resident.ts`. The contract's two sites are
      untouched, so there is not yet *one* home
- [~] Every site that enumerates them either composes from that home or is held
      to it by a test — **the five `apps/cli` sites do**; the two in
      `packages/contract/src/schemas/agents.ts` are still hand-typed, and are
      held only by `resident.test.ts`'s literal comparison
- [x] The test survives a smuggled restatement worded to avoid the vocabulary —
      the new cases compare against the **composed** string, which only
      interpolation produces, and measure the CLI's array against the same
      workspace acts the existing pin uses
- [ ] `laneRows.ts`'s claim about which text is canonical is true afterwards, or
      is removed — **not done**, `packages/kit` is out of this agent's scope

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

_Filled by the implementing agent (cli-dev, **Opus 5 (1M context)**), 2026-08-24._

**Scope: the five `apps/cli` sites only.** `packages/contract` was being edited
concurrently in another worktree, so its two sites were left alone by instruction.
`packages/kit`'s `laneRows.ts` was likewise untouched. **This issue stays
`in-progress`.**

### Where the causes live now, for this package

`apps/cli/src/commands/resident.ts` exports:

- `MISSING_PROFILE_CAUSES` — `["renamed", "deleted", "moved out of
  .claude/agents/"]`, **byte-identical** to the kit's array, so the comparison
  between them is an equality rather than a translation
- `MISSING_PROFILE_CAUSES_PHRASE` — the same list as one English enumeration,
  with the root code-quoted because help text is markdown and `docs/cli.md` is
  generated from these strings
- `ARCHIVING_IS_NOT_A_CAUSE` — the true half SHARED-053 put in place of the false
  one, kept beside the list so a reader just told three ways a profile can vanish
  is not left to assume archiving is a fourth
- `AGENT_DEF_ROOT` — the one path, typed once

### Which of the two designs, and why the array is not shared

Decision 1 offered "move the array to the contract" or "pin two independent
statements". Neither is fully available here: I may not edit `packages/contract`,
and `apps/cli` must not import `@corpus/kit` — the dependency direction is fixed
(CLAUDE.md). So this half takes the second design: the CLI declares its own
array, and `scripts/missing-profile-parity.test.ts` holds it to the **same
workspace acts** the kit's array is held to. That is the standard the file
already sets, applied to a third statement rather than a second.

Decision 2, whether prose that *mentions* the causes must compose: only prose
that **enumerates** them does. The two prose sites that merely refer to the
concept — the module comment in `resident.ts` and the inline comment in
`designate.ts` — now point at `MISSING_PROFILE_CAUSES` by name instead of
restating it. Interpolating every noun would have made these paragraphs
unreadable, which the issue names as its own defect.

### The five sites

| Site | Was | Now |
| --- | --- | --- |
| `commands/agents.ts` | typed prose | `${MISSING_PROFILE_CAUSES_PHRASE}` + `${ARCHIVING_IS_NOT_A_CAUSE}` + `${PROFILE_MISSING}` |
| `commands/thread/designate.ts` (help) | typed prose | composed |
| `commands/thread/designate.ts` (`--json` example) | typed prose | composed |
| `commands/thread/show.ts` | typed prose | composed, plus `${GENERAL_RESIDENT}` |
| `commands/resident.ts` (module comment) | typed prose | `{@link MISSING_PROFILE_CAUSES}` |

### The pin

`scripts/missing-profile-parity.test.ts` gains a describe with six cases:

```
✓ names exactly the acts that empty the resident's docId
✓ is the same list the kit holds, spelled the same way
✓ composes the phrase from that list and adds nothing to it
✓ reaches every help block that used to type the causes
✓ keeps the true half beside the corrected one at every block
✓ never names archiving inside the causes themselves
```

The first compares the CLI's array to the causes **measured** by applying four
real acts to a real workspace and asking `currentResident` — not to the kit's
array — so both copies edited the same wrong way would still fail. The fourth and
fifth assert containment of the composed strings in the real command specs, which
a smuggled restatement cannot satisfy.

`apps/cli/src/commands/resident.test.ts`'s existing pin was rewritten to derive
its literal from `MISSING_PROFILE_CAUSES_PHRASE`, and now records in prose why it
still compares a literal at all: the contract's copy has nothing to compose from
yet.

### E2E — the help still reads as English, and the behaviour still matches

Real server on port 8891, throwaway workspace.

```
$ corpus thread designate th_32apsx67 --agent bookkeeper
designated bookkeeper (doc_leimqmem) on th_32apsx67
$ rm .claude/agents/bookkeeper.md
$ corpus thread show th_32apsx67 | grep -i resident
resident bookkeeper (profile missing)
$ corpus agents | grep -i bookkeeper
th_32apsx67 "A standalone" · bookkeeper (profile missing) · waiting for a listener
```

The deletion cause, observed end to end, rendering exactly what the composed help
predicts. And the composed prose is byte-identical to what it replaced —
`git diff docs/cli.md` shows **no change** to any of these four paragraphs, which
is the point: the reader sees the same sentence, and it can no longer drift.

```
$ corpus agents --help
… `researcher (profile missing)` is a designation whose profile has since been
renamed, deleted, or moved out of `.claude/agents/`, which changes nothing about
who owns the lane and is reported rather than silently substituted. **Archiving
is not one of those**: an archived `agent-def` still under that root resolves
exactly as before, and is still designatable, so the cell keeps printing its id.
```

### Outstanding, and it is the reason this issue is not `done`

1. `packages/contract/src/schemas/agents.ts:118` and `:165-167` still type the
   causes. Until they compose, there are two homes rather than one, and
   acceptance criteria 1 and 2 are only half met.
2. `packages/kit/src/recipient/laneRows.ts:155-159` still calls the contract's
   `docId` description canonical while the kit holds the array. Criterion 4 is
   untouched.

Both are outside this agent's scope by instruction and are the orchestrator's to
place.

### Checks

typecheck clean, eslint clean, prettier clean, `docs/cli.md` regenerated,
`vitest run apps/cli scripts/missing-profile-parity.test.ts
scripts/retrieval-exclusion-parity.test.ts` — 109 files, 2148 tests, exit 0.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [~] Acceptance criteria verified — the `apps/cli` half only

## Completion Checklist (orchestrator)

- [ ] Committed with `[SHARED-054]` prefix
