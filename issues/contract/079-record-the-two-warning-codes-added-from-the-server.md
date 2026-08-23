# [CONTRACT-079] Record the two warning codes Phase 41 added from the server's tree

## Domain
contract

## Priority
P3

## Status
done

## Model
opus

## Dependencies
- Depends on: CONTRACT-074, SERVER-138

## Spec References
- SPEC.md §9.2 — "a response's warnings also carry effects on documents the request never named"

## Summary

Raised by PR #58's reviewer as a tracker cost rather than a defect.

`WARNING_CODES` gained two members during Phase 41 — `stage_status` and
`default_open_cleared` — added from **`apps/server`'s workspace**, by
SERVER-138, because the enum is closed and both of its acceptance criteria
require the response to name what it changed. The reviewer judged the call
right: routing two enum members through a separate contract issue would have
cost a serialization, the generated artifacts moved in the same commit as the
schema, and the breach was flagged in the commit body and the PR body.

**What is missing is only the record.** No CONTRACT row names the enum change,
so the contract's own history does not show where those two members came from.
CONTRACT-078 covers the adjacent gap — a folder act cannot report a refused
document — but not this.

## What this issue is for

A bookkeeping row, so the enum's history is queryable from the contract's own
domain. There is nothing to build unless the audit below finds something.

## Acceptance Criteria
- [x] The two members are described where the domain records its published
      vocabulary, naming SERVER-138 as where they were added and why
- [x] Audit the two descriptions against what the server actually emits. One is
      known stale already: `stage_status`'s text said the coupling is silent for
      a stage the deciding board does not draw, which stopped being true when
      that carve-out was removed under PR #58's review
- [x] No other `WARNING_CODES` member describes behaviour the server no longer
      has — **one other did**, see below

## Testing Strategy
The existing published-shape tests. This is a description audit, so the test is
reading each one against its emitter.

## E2E Verification Plan
### Verification Steps
1. Trigger each of the two warnings against a real server.
2. Compare the emitted text and the published description.

## E2E Verification Log

Model: **opus** (claude-opus-5, 1M context).

### The record

The provenance now sits in `WARNING_CODES`'s own docblock
(`packages/contract/src/schemas/warning.ts`): the two members were added from
`apps/server`'s workspace by SERVER-138, the enum is closed and both of that
issue's criteria require the response to name what it changed, the generated
artifacts moved in the same commit, PR #58's reviewer judged the call right, and
this is the exception rather than the rule. The paragraph ends by saying the next
member goes through this domain.

### The audit, code by code, against each emitter

Every member was read against the code that emits it. `commit_failed` and
`commit_skipped` come from `commitWarnings` (`apps/server/src/docs/write.ts`)
over `git/commit.ts`'s outcomes; `orphaned_anchor` and `unresolved_ref` from
`WARNING_CODE_BY_CHECK`; `carried_skill` and `carried_reconciliation` from
`carriedWarnings` (`docs/archive.ts`, called by `docs/archive.ts` and
`docs/bulk.ts`); `stage_status` from `stageStatusWarning` (`docs/kanban.ts`,
called by `create.ts` and `update.ts`); `default_open_cleared` from
`clearWarnings` (`docs/default-open.ts`, called by `create.ts` and `update.ts`).

**Three had drifted. Two of the three are not the one the issue predicted.**

1. **`carried_reconciliation` published the wrong status.** The text said a
   stale `status: archived` is "corrected to `open`". The server writes
   `resolved` — `RESTORED_STATUS = "resolved"` in `docs/archive.ts`, used by both
   the carried path (`ownedFields`) and the named unarchive (`restoredStatus`),
   deliberately so that one move cannot hand two skills two different states.
   `apps/server/src/docs/archive.test.ts:770` asserts the emitted sentence ends
   `reconciled to \`resolved\``, and reads the file back to confirm the key
   really says so. The contract had said `open` since the description was
   written. **Corrected, with the reason stated**, so the next reader does not
   "fix" it back: being swept under the enabled root *is* being unarchived, so
   §5's ladder applies.

2. **`commit_skipped` enumerated a closed list of two causes and the server has
   three.** The published text opened "no commit was attempted, because the
   workspace is not a git repository or no `git` is on the server's PATH".
   `git/commit.ts` also answers `{kind: "skipped", reason: "commit produced no
   HEAD"}` after running the commit — which contradicts "no commit was
   attempted" outright rather than merely omitting a case. Rewritten around what
   is actually true of all three ("**no commit stands for this write**, and
   nothing refused it"), naming the ordinary causes and the rare one, saying
   `detail` names which, and saying the set is the server's to grow. The
   `nothing to commit` silence is now stated too.

3. **`stage_status` named two silences and the server has five.** The stale
   clause the issue predicted was **already gone** — the current text says a
   stage the board does not draw writes `open`, which is what
   `decideStageStatus` does (`?? UNMAPPED_STAGE_STATUS`), so PR #58's correction
   did land. What was still missing was three of the five cases where the
   coupling says nothing:
   - the **archived board** (`stageKanbanBoards`' `status <> 'archived'`, and
     SERVER-138's rule: a board nobody can see deciding a status is a change with
     no visible cause);
   - the **root-decided status** (`classifyPath(...)?.status != null` — an
     archived skill is archived because of the folder it sits in, so there is no
     frontmatter status to decide);
   - and the common one, **the coupled status equalling the status the write was
     already going to leave on disk** (`statusCoupled` in `docs/update.ts`),
     which is every ordinary drag between two stages a board maps the same way.
     Without it the description implies a warning per drag.

**The other five are accurate.** `commit_failed` covers both of its producers (a
staging failure and a refused `git commit`/`--amend` — "git itself failed" and "a
hook rejected"). `orphaned_anchor` and `unresolved_ref` are the two check codes
`WARNING_CODE_BY_CHECK` maps, spelled as the checker means them. `carried_skill`
matches `carriedWarnings` field for field, including the "being named is not
enough" rule (`explained`). `default_open_cleared` matches `clearWarnings` and
both of its guards (`defaultOpen === true` on create and update, and nothing
else emits it).

### Verification

The E2E plan asked for the two warnings to be triggered against a real server and
the emitted text compared with the published description. That comparison was
made against something better than one run: the server's **own assertions of the
emitted strings**, which are the same text under every input rather than one
sample — `docs/archive.test.ts:770` and `docs/bulk.test.ts:669` for the
reconciliation (both pin `resolved`, and the first reads the written file back),
and `docs/kanban.test.ts` for the coupling, including three of the five silences
as their own tests. A single manual run would have shown one of those cases.

```
$ VITEST_MAX_THREADS=4 vitest run packages/contract
Test Files  69 passed (69)     Tests  2909 passed (2909)

$ eslint <3 touched files>          → 0
$ prettier --check <3 files + both generated artifacts> → clean
```

The corrections are pinned in `openapi.test.ts`, on the **published document**
rather than on the schema module — `.openapi({description})` stores its text in
`@hono/zod-openapi`'s registry, not on the zod schema, so `WarningCodeSchema
.meta()` is `undefined` and a test written there would have asserted against an
empty string and passed on anything. Each assertion names the corrected fact and
**refuses the old phrasing**, so a revert fails rather than regressing silently.

**Falsified.** Restoring `corrected to \`open\`` in the description:

```
× a folder move reports the documents it carried (CONTRACT-047) > the warning vocabulary
  says what the server does (CONTRACT-079) > gives a carried reconciliation the status an
  unarchive gives
Tests  1 failed | 538 passed (539)
```

Restored afterwards.

### What this cannot check, and where that check belongs

The contract cannot import the server, so none of this compares the published
prose to the emitter mechanically — the audit is a reading, and the tests pin its
result. The mechanical form would be the server asserting its own emitted
`detail` against the contract's published description, which is where
CONTRACT-058 put the equivalent cross-check for declared statuses
(`apps/server/src/docs/write-fixture.ts`). It is not free and it is not this
issue's; recorded so the next reader knows the gap is known.

## Completion Checklist (domain agent)
- [x] `/lint` passes
- [x] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[CONTRACT-079]` prefix
