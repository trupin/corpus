# [SHARED-054] The missing-profile causes are typed again, one layer out

## Domain

shared

## Status

done

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

- [x] One home for the causes, respecting the contract → kit dependency
      direction — **`packages/contract/src/schemas/agents.ts`.** `packages/kit`
      and `apps/cli` re-export it. It reached three declarations first, held
      equal by a parity test, and that was not the same thing: a test holding
      three lists equal is not one home, it is three homes with a guard
- [x] Every site that enumerates them either composes from that home or is held
      to it by a test — the five `apps/cli` sites and the two contract sites all
      compose, and the parity test measures each array against the same
      **workspace acts**, so two copies edited the same wrong way still fail
- [x] The test survives a smuggled restatement worded to avoid the vocabulary —
      the new cases compare against the **composed** string, which only
      interpolation produces, and measure the CLI's array against the same
      workspace acts the existing pin uses
- [x] `laneRows.ts`'s claim about which text is canonical is true afterwards —
      the docblock now says the list lives in `@corpus/contract` and is
      re-exported, and the contract's own docblock stops describing the kit's
      array as a copy it is pinned against

### How it was closed

`packages/contract` is the dependency-correct home: both `packages/kit` and
`apps/cli` may import it, and it may import neither. So the remaining work is
small and mechanical — the kit's array becomes a re-export of the contract's,
`apps/cli` imports from `@corpus/contract`, `laneRows.ts`'s canonical claim
becomes true, and the two parity blocks holding the copies equal are deleted
because there is nothing left to hold apart.

Done 2026-08-24 by the orchestrator, as a SHARED issue.

**Falsified rather than assumed.** Adding `"archived"` — the one false cause PR
#50 removed — to the contract's array turns **five** tests red in
`scripts/missing-profile-parity.test.ts`, because the acts are still measured
against a real workspace. The file was restored byte-identical.

**What the parity test kept, and what it lost.** It still pairs each cause with
a workspace act and asks the real projector what that act does, so a cause added
without an act still fails. What it no longer does is compare copies against each
other — two blocks and thirteen lines of equality assertions are deleted, along
with the aliased imports that existed only to feed them.

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

### Contract half — 2026-08-24, contract-dev, opus (`claude-opus-5[1m]`)

Scope was restricted to the two `packages/contract/src/schemas/agents.ts` sites.
`apps/cli`, `apps/ui` and `packages/kit` were not touched. Isolated worktree
`.claude/worktrees/agent-ac4ea264a31fc4cc4` with its own `npm install` and its
own `dist/`.

#### Decision 1 — the home is the contract, and the copies are pinned to it

The two sites could not simply *reference* the array: `MISSING_PROFILE_CAUSES`
lives in `packages/kit`, and `packages/contract` ← `packages/kit` is fixed, so
the contract cannot import it. Nor could the kit be moved to consume the
contract, since the kit was out of scope. So the contract now **declares** the
array — the dependency-correct final home — and `scripts/` holds the two
declarations equal:

- `AGENT_DEF_ROOT`, `MISSING_PROFILE_CAUSES`, `MissingProfileCause` and
  `MISSING_PROFILE_CAUSE_CLAUSE` in `packages/contract/src/schemas/agents.ts`.
- The `ResidentSchema` docblock (the first site) now says *"one of
  {@link MISSING_PROFILE_CAUSES} has happened to it since"*. A JSDoc comment
  cannot interpolate, so a reference is the strongest form available there.
- `Resident.docId`'s **published description** (the second site) interpolates
  `MISSING_PROFILE_CAUSE_CLAUSE`. That is the sentence four domains read, and it
  is now composed.
- `scripts/missing-profile-parity.test.ts` gained three cases holding the
  contract's array and the kit's equal — as a set, in order, and against the
  acts the file already measures on a real workspace.

#### Decision 2 — the enumeration is shared, the typography is not

The array's members stay bare (`moved out of .claude/agents/`) because the kit
renders them into a lane's own sentence on the board, where a backtick reaches a
person's eye as a backtick. `MISSING_PROFILE_CAUSE_CLAUSE` code-quotes the root,
because a `description` and `docs/cli.md` are both markdown. cli-dev reached the
same split independently in `apps/cli/src/commands/resident.ts`, and this
implementation matches its spelling **exactly** so its pin survives the harvest
(measured below).

#### What was rejected

- **Leaving the description hand-typed and only referencing the array in prose.**
  That is the fourth copy the issue is about.
- **A second array named differently in the contract** to avoid the duplicate
  export name. The intended end state is one name, and a pin makes the interim
  safe.
- **Deriving the kit from the contract now.** Out of scope, and it is one import
  line once the kit's issue runs.

#### Falsification — all three pins fire

Reworded the contract's third cause to `"moved out of the personas folder"`,
rebuilt, ran:

```
$ vitest run packages/contract/src/schemas/agents.test.ts \
             packages/contract/src/openapi.test.ts \
             scripts/missing-profile-parity.test.ts        → EXIT=1, 5 failed
× agents.test.ts   > lists exactly the three §7 names, and archiving is not among them
× openapi.test.ts  > gates the designation name on `.claude/agents/`, …
× parity           > names the same set, in both directions
× parity           > keeps them in the same order, because both compose a sentence from it
× parity           > publishes only causes an act above actually produces
```

Then the other direction — the array left alone and the description **hand-typed
back with a drifted cause** (`renamed, archived, or moved out of …`):

```
FAIL openapi.test.ts > does not list archiving among the ways a profile stops resolving
  Expected: "has since been renamed, deleted, or moved out of `.claude/agents/`"
FAIL agents.test.ts > publishes that clause on Resident.docId, and mentions archiving only to deny it
  Expected: "has since been renamed, deleted, or moved out of `.claude/agents/`"
```

Two existing pins that transcribed the list by hand were rewritten to derive it
(`openapi.test.ts:5492` and the CONTRACT-051 root check), so no hand-typed copy
was left behind in a test either.

#### cli-dev's pin, measured rather than assumed

`apps/cli/src/commands/resident.test.ts` asserts
`ResidentSchema.shape.docId.description` contains its own composed phrase. Run in
this worktree against the new contract:

```
contract clause : "renamed, deleted, or moved out of `.claude/agents/`"
cli phrase      : "renamed, deleted, or moved out of `.claude/agents/`"
identical       : true
docId ⊇ cli phrase : true
docId ⊇ archiving  : true
```

#### Checks

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run --reporter=verbose \
    packages/contract apps/server/src/check scripts/missing-profile-parity.test.ts
EXIT=0 · Test Files 74 passed (74) · Tests 3048 passed (3048)

$ npm run typecheck -w packages/contract        → 0
$ tsc --noEmit -p scripts/tsconfig.json         → 0
$ eslint packages/contract/src scripts/missing-profile-parity.test.ts → 0
$ prettier --check (every touched file + both generated artifacts)    → clean
$ npm run generate -w packages/contract (twice) → idempotent
```

#### Still open for the CLI/kit half

- Acceptance criterion 4 — `packages/kit/src/recipient/laneRows.ts:155-159`'s
  claim that the **contract's** `docId` description is canonical. It is now true
  in the strong sense (the contract composes the sentence and the kit's array is
  pinned to the contract's), but the kit still declares rather than consumes.
  Nothing compares the two from inside the kit, only from `scripts/`.
- Three declarations of the same list now exist — contract, kit, `apps/cli` —
  all held equal by tests. The follow-up is two import lines: the kit and the CLI
  re-export the contract's, and the `scripts/` pin added here is deleted rather
  than rewritten.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [~] Acceptance criteria verified — the `apps/cli` half only

## Completion Checklist (orchestrator)

- [ ] Committed with `[SHARED-054]` prefix
