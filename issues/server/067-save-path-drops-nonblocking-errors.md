# [SERVER-067] The save path drops non-blocking errors: they reach the log but not the response

## Domain

server

## Status

todo — **re-scoped 2026-08-06.** The log half is done (SERVER-066's review-fix
round, PR #26 finding B). What remains is one contract question that needs the
user, not code. See "What is left" below.

## Priority

P2 (nice-to-have)

## Model

opus — once the question below is answered. The **question itself** is a §14
semantics change and is orchestrator work (CLAUDE.md: preparing SPEC.md changes
for user sign-off is never delegated). If the answer is "no", this issue closes
with no code at all.

## Dependencies

- Depends on: SERVER-066 (which introduced the first non-blocking error code and
  then, in review, closed the log half of this issue)
- Blocks: —
- Related: any future §14 rule that is an **error** the write path does not
  refuse. Today there is exactly one (`unterminated-fence`); this issue is about
  whether the second one has anywhere to go on the wire.

## Spec References

- SPEC.md **§14** — "Validation, drift checks, and hooks": "Every server mutation
  validates before writing", and the warning family it carves out by name —
  "Unresolvable-but-well-formed anchors (orphaned threads) and unresolved
  `[[refs]]` are warnings, not failures"
- SPEC.md **§14** — the auto-commit half: a failure "surfaces loudly — a warning
  on the API response, a server log entry, and console visibility"
- SPEC.md **§6** — the `## <author> · <ts>` turn format, which an unterminated
  fence destroys silently
- SPEC.md **§9.2** — mutation responses carry warnings

## Summary

`checkSave` ran §14's validator over the bytes of every save and then returned
`findings: report.warnings` — so a finding that was an **error** but not a
*blocking* error was computed on every write and thrown away. It reached no
response, no log, and no console. The one rule in that shape,
`unterminated-fence` (SERVER-066), exists precisely so that a swallowed turn
stops being silent, and it was silent on the only path the bug actually happens
on: the agent appending a turn.

**The log half of that is fixed.** SERVER-066's review-fix round (PR #26,
finding B) added `REPORTED_CHECK_CODES`, made `SaveCheck.findings` carry the
tolerated errors alongside the warnings, and split the two families at the log:
`logger.error("document saved with validation errors", …)` beside the existing
`logger.info(… warnings …)`. `logger.error` was chosen deliberately — it is the
one level the logger never gates, so a server run at `--log-level silent` still
says a thread's turns are being eaten as they are written. Verified live: the
turn that reproduced the original bug now writes a `level":"error"` line naming
the file and the finding, while the write is still not refused.

**What is left is one question, and it is not a coding question.** Putting the
same finding on the mutation **response** — where the console and the UI would
see it — requires a third `WarningCode`. §14's wire warning family is a closed
two-member set (`CHECK_WARNING_CODES` = `anchor-unresolved`, `ref-unresolved`),
and both members are *normal outcomes of using the system as designed*, which is
the whole reason they are warnings. `unterminated-fence` is not that; it is an
**error** severity finding. Reporting it as a warning would put an
error-severity §14 finding into the wire's warning channel — a change to what
§14's severity partition *means*, not a transcription of it. `codes.test.ts`
asserts behaviourally that no code appears on both sides of that partition, and
`isSkillFrontmatterException` already refuses to re-grade a finding for exactly
this reason. So the honest options are: leave the response alone (the log is the
operator channel, and `corpus doc check` is the on-demand one), widen the warning
family and accept that "warning" no longer implies "not an error", or introduce a
separate response-side channel for non-blocking errors. All three are §14
decisions and belong with the user.

## Acceptance Criteria

### Already met (SERVER-066 review round — recorded here, not re-done)

- [x] A save carrying a non-blocking §14 **error** is no longer discarded:
      `SaveCheck.findings` carries the tolerated errors as well as the warnings
- [x] `validateBeforeWrite` logs the two families **apart**, errors at
      `logger.error` (ungated) and warnings at `logger.info`
- [x] The write is still **not refused** — the severity decision SERVER-066 made
      is unchanged, and the log announces the consequence rather than preventing
      it
- [x] The reported set is **explicit** (`REPORTED_CHECK_CODES`), not "every error
      the save does not refuse" — see the `anchor-unused` finding below
- [x] Both directions pinned in `apps/server/src/docs/write.test.ts`: the fence
      finding reaches the log, and the parent text `threads/create.ts` produces
      does not

### What this issue is now

- [ ] The question is put to the user, stated as a §14 semantics change and not
      as a bug: **should a non-blocking error appear on the mutation response,
      and if so under what?** With the three options above and their costs.
- [ ] If the answer is **no**: this issue closes with a recorded decision and no
      code. The docblock on `SaveCheck.warnings` already states the rationale;
      it is updated to cite the decision rather than the open question.
- [ ] If the answer is **yes**: a SPEC.md §14 rider is drafted and signed
      *first*, then a contract issue transcribes the new code (with its own
      severity story), then the server maps `REPORTED_CHECK_CODES` onto it. That
      is three issues, filed in that order — not this one growing.
- [ ] Whatever the answer, `REPORTED_CHECK_CODES` stays an explicit allow-list.

## Technical Design

### Files that already carry the fixed half

- `apps/server/src/docs/write.ts` — `REPORTED_CHECK_CODES` (line ~114),
  `SaveCheck.findings` / `SaveCheck.warnings` and their docblocks (~352–377),
  `checkSave` (~388), `validateBeforeWrite` (~403)
- `apps/server/src/docs/write.test.ts` — the log cases, both directions

### Files a "yes" answer would touch

- `SPEC.md` §14 — the rider, first and separately
- `packages/contract/src/schemas/warning.ts` — `WARNING_CODES` is the closed
  four-member response family (`commit_failed`, `commit_skipped`,
  `orphaned_anchor`, `unresolved_ref`); a third *validation* member lands here
  with its own description
- `packages/contract/src/schemas/check.ts` — `CHECK_WARNING_CODES`, and whatever
  the partition means afterwards
- `apps/server/src/docs/write.ts` — `WARNING_CODE_BY_CHECK` gains the mapping
- `apps/server/src/check/codes.test.ts` — the drift guard, whose
  no-code-on-both-sides assertion is exactly what the change would have to be
  reconciled with

### The finding that must not be lost: this does not generalise

The obvious generalisation — log **every** error the save does not refuse —
was tried in SERVER-066's review round and rejected on evidence. It made the
server suite emit 8 log lines reading `anchor-unused: anchor \`anc_…\` has no
thread referencing it`, **all of them false**. `anchor-unused` is a
*cross-document* rule answered on the save path through the projection, and
during a multi-file mutation the projection is one write behind **by
construction**: `threads/create.ts` validates the parent document carrying the
*new* anchor entry immediately before writing the thread that claims it, and
`capture.ts` does the same. So the seam truthfully reports that nothing claims
the anchor *yet* — on every anchored comment, the commonest write in the
product.

That matters for this issue directly, because the same reasoning applies one
level up: **a response-side channel that carried `anchor-unused` would put a
false warning on the commonest mutation in the system**, which teaches a reader
to ignore the channel the fence finding needs them to read. So any "yes" answer
inherits the allow-list, not the generalisation. `corpus doc check`, which has
no such blind spot, stays the place a genuinely dangling anchor is reported.

### Edge cases

- A save producing **both** a tolerated error and a §14 warning — the two
  families stay separate at every surface they reach; neither is folded into the
  other's count.
- A workspace with no git: `commit_skipped` is a *response* warning about the
  commit, not about validation. It is not a precedent for grading a validation
  error as a warning — the two halves of the `WARNING_CODES` enum have different
  subjects.
- A code in **neither** set stays silent on the save path. That is the safe
  default and this issue does not change it.

## Testing Strategy

If the answer is "no": no new tests. The existing `write.test.ts` cases are the
regression guard, and the decision is recorded in the docblock.

If the answer is "yes": the response-side case is asserted at the route level
(a `POST /api/threads/:id/turns` whose body carries an unterminated fence returns
`201` **with** the warning in the response payload), the drift guard in
`check/codes.test.ts` is updated to whatever the new partition asserts, and the
`anchor-unused` negative — an anchored comment produces **no** response warning —
is pinned alongside it, because that is the failure mode the allow-list exists
to prevent.

## E2E Verification Plan

### Reproduction Steps (bugs only)

Already recorded, against the real binary, in
`issues/server/066-unterminated-fence-check.md` → "Review-fix round — PR #26,
findings A / B / C" → finding B. Summarised: an agent turn whose closing fence
sat on the content line was accepted (`201`, `warnings []`), the person's
following reply was swallowed (3 turns written, 2 readable), and **nothing was
reported anywhere**. After the fix, the same `POST` writes a
`{"level":"error","msg":"document saved with validation errors", …}` line to
`.corpus/server.log` while still returning `201` with `warnings []` — the
remaining, deliberate gap this issue is about.

### Verification Steps

1. If "no": no application change to verify. The verification is that
   `corpus doc check` (exit 6) and the server log remain the two channels, and
   the recorded decision says so.
2. If "yes": restart the real server, post the same turn, and confirm the
   response itself carries the finding — then post an ordinary anchored comment
   and confirm its response carries **no** warning, which is the assertion that
   proves the allow-list survived the change.

## E2E Verification Log

### Reproduction (bugs only)

_Done — see `issues/server/066-unterminated-fence-check.md`, review-fix round,
finding B. Real workspace `/tmp/corpus-066r`, real server, real HTTP, real CLI._

### Post-Implementation Verification

_[Agent fills, if and only if the question is answered "yes". The log half's
verification is already recorded in SERVER-066 and is not re-run here.]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] The §14 question put to the user and the answer recorded here
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-067]` prefix
