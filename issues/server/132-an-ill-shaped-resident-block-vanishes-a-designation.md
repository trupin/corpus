# [SERVER-132] An ill-shaped `resident:` block vanishes a designation, and nothing reports it

## Domain

server

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SERVER-129
- Blocks: —
- Related: SHARED-052 (the `corpus check` rider, unsigned), SERVER-124

## Spec References

- SPEC.md **§7** — designation, lanes, the lapse fallback
- SPEC.md **§11** — what a check reports

## Summary

Found by the PR #52 review, 2026-08-19. `apps/server/src/core/resident.ts` parses a thread's stored `resident:` block as a whole. An ill-shaped `weight` — `weight: 3` from a hand edit, or two lines where one belongs — fails the parse and takes the **whole block** with it, so the thread reads as **undesignated**.

Failing the whole block is the right parse rule, and the reviewer agreed: you cannot honour half a designation, and it matches how a half-written `name`/`docId` pair already reads. The gap is that **nothing reports it**. The designation disappears from the roster, the resident's next park is refused, work reroutes to the orchestrator, and no surface says why.

The docblock's own defence cuts both ways: dropping just the weight would substitute *"none chosen"* for a choice somebody made, and failing the block substitutes *nobody* for that choice. Both are silent, and the second is louder.

## Acceptance Criteria

- [x] An ill-shaped `resident:` block on a standalone thread is **reported** rather than only absorbed — through `corpus db doctor`'s report-only warnings rather than `corpus doc check`; see *The surface* below for why, and why §11 as it stands carries it
- [x] The report names the file and what about the block did not parse
- [x] The parse rule itself is unchanged: a block that does not parse still yields no designation
- [x] Falsified: an ill-shaped block written by hand, the check reporting it, the reporting removed, and the check going quiet

## Technical Design

### Files to Create/Modify

- `apps/server/src/core/resident.ts` — the parse, which currently discards the reason
- wherever `corpus check` gathers its findings

### Key Implementation Details

Read SHARED-052's drafted rider before deciding what a check may report — it is unsigned, and this issue must not assume its outcome. If §11 as it stands cannot carry this finding, say so in the issue rather than inventing a surface.

## Testing Strategy

Unit test over a fixture workspace with an ill-shaped block.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Designate a resident, hand-edit `weight:` to a number, run the check
3. Confirm it is reported, and that the roster still reads the thread as undesignated
4. Stop the server, confirm the port is free

## E2E Verification Log

**Model: Opus 5 (1M context).** 2026-08-24, branch `phase-45-not-so`.

### The surface — the call this issue asked for

**The finding is reported by `corpus db doctor`, as a report-only warning of
kind `resident_unreadable`. It is not reported by `corpus doc check`, and that
is a decision rather than an omission.**

§11 as it stands carries it, in the sentence that carves the family out:

> `corpus db doctor` may also carry **report-only warnings** — findings worth a
> person's attention that are not drift. They never affect its verdict or its
> exit code.

That is this finding exactly. The projection is **correct**: the thread
genuinely has no readable designation, every reader agrees, and no rebuild
changes a byte. It is `unindexable_file`'s situation word for word — the files
are real and the projection is right about them, and a person still needs to be
told.

**Why not `corpus doc check`, which is where a frontmatter fault belongs.** Its
vocabulary is a **closed enum in `packages/contract`** (`CHECK_CODES`, fourteen
values, transcribed from the server and pinned in both directions). Every member
outside §11's two warning codes is an error, and the contract fixes that
partition. So reporting there means one of two things:

- **A new code** (`resident-malformed`), which is a contract change and out of
  this domain. It is also the *right* long-run shape: with its own code it would
  simply join `REPORTED_CHECK_CODES` and be reported-not-refused with no
  predicate at all. **Escalated, not built.**
- **Riding `frontmatter-invalid`**, which is in `LOCAL_CHECK_CODES` and therefore
  **blocks the write**. A thread with a hand-broken `resident:` block would
  refuse its owner's reply, its resolution, and the designation that would repair
  it — and `setFrontmatterFields` splices untouched keys verbatim, so the bad
  block survives every save and the refusal is permanent. That is SERVER-123's
  regression exactly, which `docs/write.ts` already names. The escape hatch that
  exists for it (`isClaudeRootFrontmatter`) is keyed on the path, and this fault
  is under `data/threads/`, so it cannot be reused. Sniffing the `detail` string
  was considered and rejected: the codebase already deleted one such predicate
  (`isSkillFrontmatterException`) for being unable to tell two producers apart.

SHARED-052's rider was read and is **not** assumed: nothing here depends on it.
The doctor warning channel is signed today, and `DoctorWarning.kind` is
deliberately an open token — `unindexable.ts` says so in those words: *"That
openness is what lets a new report-only pass … be a server change rather than a
contract release."*

### Why the fact is a projected column and not a walk

`semantic-integrity.ts` states the constraint a doctor pass inherits: it is SQL
over the projection and nothing else, because `stats.hashed` is doctor's
published promise that a warm workspace re-reads nothing. Re-reading every
standalone thread's frontmatter would break that promise on every run.

So the projector — which already parses the block — records *why* it failed, in
`threads.resident_problem` (schema **v22 → v23**, so existing projections
rebuild), and the pass is one SELECT joined to `documents` for the path. Asked of
standalone threads only, for the same reason `storedResident` filters on
`parentId`: §7 allows a designation nowhere else, so a `resident:` key on a
parented thread has lost nothing and is not a finding.

### Reproduction and verification — real server, real workspace, port 8791

Fresh `corpus init` at `scratchpad/ws45` (never 8765).

```
$ corpus thread designate th_2bsfg2tc --weight high
designated a general resident at high on th_2bsfg2tc

$ corpus agents
orchestrator · waiting for a listener
th_2bsfg2tc "Housing lane" · a general resident at high · waiting for a listener

$ corpus db doctor
projection is clean — 17 documents from 17 files (18ms)
```

Then the PR #52 reviewer's own case, by hand — `weight: high` → `weight: 3`:

```
$ corpus agents
orchestrator · waiting for a listener            # the lane is gone, and nothing says why

$ corpus db doctor
resident_unreadable data/threads/th_2bsfg2tc.md: data/threads/th_2bsfg2tc.md designates a
resident that cannot be read: `weight`: Invalid input: expected string, received number. The
whole `resident:` block is refused rather than half-honoured, so this thread reads as
undesignated — it is absent from the roster, and a listener that parks against it is refused.
Repair the block in the file, or designate the thread again with
`corpus thread designate th_2bsfg2tc`, which rewrites it.
projection is clean — 17 documents from 17 files (4ms)
```

**The file is named, the failing key is named, and the verdict does not move.**
The roster line above it is the pre-fix behaviour still standing, which is
correct: the parse rule is unchanged, so the designation is still gone. What
changed is that the loss is now said out loud.

Repairing the block by hand brings the lane back and takes the finding with it:

```
$ corpus agents
th_2bsfg2tc "Housing lane" · a general resident at high · waiting for a listener
$ corpus db doctor
projection is clean — 17 documents from 17 files (5ms)
```

### Falsification

The projector's one line replaced by `const problem = null;` — the state before
this issue:

```
vitest run apps/server/src/projection/doctor.test.ts
  × an unreadable resident block (SERVER-132) > is reported as a warning that
    names the file and the failing key
  Tests  1 failed | 21 passed (22)     exit 1
```

Restored, green. Nine new unit tests: six on `residentProblem` in
`core/resident.test.ts` — including one that pins the invariant that it and
`residentOrNull` agree, case for case, about which blocks are ill-shaped — and
five in `doctor.test.ts` covering the report, the verdict, the unchanged parse
rule, silence on a good block, and `stats.hashed` staying zero.

### Checks

```
npm run typecheck -w apps/server                exit 0
eslint apps/server/src                          exit 0   (no rule disabled)
VITEST_MAX_THREADS=4 vitest run apps/server
  Test Files 204 passed (204)   Tests 4662 passed (4662)   exit 0
```

### For the orchestrator

A **contract issue** is worth filing: a `resident-malformed` check code would let
this finding move to `corpus doc check`, where a frontmatter fault belongs, with
no predicate — it would join `REPORTED_CHECK_CODES` beside `unterminated-fence`
and be reported-not-refused by the mechanism that already exists. Moving it is a
small change once the code exists, and the doctor pass is what it moves.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-132]` prefix
