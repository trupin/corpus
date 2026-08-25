# [SERVER-067] The save path drops non-blocking errors: they reach the log but not the response

## Domain

server

## Status

done — **2026-08-24.** The log half landed with SERVER-066's review-fix round
(PR #26, finding B). The response half landed here, against CONTRACT-084's
`validation_error`, after the adjudication below removed the question that was
blocking it.

## Priority

P2 (nice-to-have)

## Model

opus — once the question below is answered. The **question itself** is a §11
semantics change and is orchestrator work (CLAUDE.md: preparing SPEC.md changes
for user sign-off is never delegated). If the answer is "no", this issue closes
with no code at all.

## Dependencies

- Depends on: CONTRACT-084 (the wire code this issue reports through), SERVER-066
  (which introduced the first non-blocking error code and
  then, in review, closed the log half of this issue)
- Blocks: —
- Related: any future §11 rule that is an **error** the write path does not
  refuse. **Correction 2026-08-24:** there are now two tolerated families —
  `unterminated-fence` plus `frontmatter-invalid` on a `.claude/` root, added by
  SERVER-123/124 — and `isSkillFrontmatterException`, which this issue's Summary
  cites, has since been deleted. Two families strengthens the case for a response
  channel rather than weakening it; this issue is about
  whether the second one has anywhere to go on the wire.

## Spec References

- SPEC.md **§11** — "Validation, drift checks, and hooks": "Every server mutation
  validates before writing", and the warning family it carves out by name —
  "Unresolvable-but-well-formed anchors (orphaned threads) and unresolved
  `[[refs]]` are warnings, not failures"
- SPEC.md **§11** — the auto-commit half: a failure "surfaces loudly — a warning
  on the API response, a server log entry, and console visibility"
- SPEC.md **§6** — the `## <author> · <ts>` turn format, which an unterminated
  fence destroys silently
- SPEC.md **§9.2** — mutation responses carry warnings

## Summary

`checkSave` ran §11's validator over the bytes of every save and then returned
`findings: report.warnings` — so a finding that was an **error** but not a
*blocking* error was computed on every write and thrown away. It reached no
response, no log, and no console. `unterminated-fence` (SERVER-066) exists
precisely so that a swallowed turn stops being silent, and it was silent on the
only path the bug actually happens on: the agent appending a turn.

**Two families are tolerated, not one** (corrected 2026-08-24; the earlier text
said "exactly one"). `REPORTED_CHECK_CODES` holds `unterminated-fence`, and
`isClaudeRootFrontmatter` holds every `frontmatter-invalid` raised under one of
§7's `.claude/` roots — added by SERVER-123/124, from two rules (§7's `name` and
`description`, and §5's canonical block where the file wrote a Corpus field down
wrongly). Both are "reported, never refused", so both reach the response.
`isSkillFrontmatterException`, which the original Summary cited, has since been
deleted.

**The log half of that is fixed.** SERVER-066's review-fix round (PR #26,
finding B) added `REPORTED_CHECK_CODES`, made `SaveCheck.findings` carry the
tolerated errors alongside the warnings, and split the two families at the log:
`logger.error("document saved with validation errors", …)` beside the existing
`logger.info(… warnings …)`. `logger.error` was chosen deliberately — it is the
one level the logger never gates, so a server run at `--log-level silent` still
says a thread's turns are being eaten as they are written. Verified live: the
turn that reproduced the original bug now writes a `level":"error"` line naming
the file and the finding, while the write is still not refused.

## Adjudicated 2026-08-24 — no rider needed

The question below was put to spec-writer on Fable, and its premise was wrong.
**The two families this issue treats as one are two.** `CHECK_WARNING_CODES`
(`packages/contract/src/schemas/check.ts`) is the *validator's* severity split —
closed, load-bearing, and what decides `corpus doc check`'s exit 0 versus 6. The
*response* family is `WARNING_CODES` (`packages/contract/src/schemas/warning.ts`),
eight members of mixed severity, `commit_failed` among them. `check.ts`'s own
docblock says so: "**Not the §11 commit warning.** … It is unrelated to
`Warning`".

So §11 already answers the question. Its auto-commit paragraph calls the event a
**failure** and puts it on the response as a **warning**, in one sentence. The
2026-08-10 rider says outright that "a warning is not only a failure". The
response channel already spans `carried_skill` to `commit_failed`, which makes it
a reporting channel and not a severity class.

**Option 2 wins and needs no signature.** Option 1 preserves a purity the wire
never had, and leaves the harmed party — the agent whose turn was eaten, which
reads responses and not `.corpus/server.log` — with no way to learn it. Option 3
would grow every mutation response a field that is empty on almost every call,
and would imply the first channel was severity-pure.

**Implement against `WARNING_CODES`, not `CHECK_WARNING_CODES`.** The contract
half is CONTRACT-084. This issue is the server half: in `checkSave`, emit one
warning under the new code for **every** finding in `tolerated` — both the
`REPORTED_CHECK_CODES` members and the Claude-root frontmatter family, because
"reported, never refused" is one rule. The consequence is chosen, not stumbled
into: every save of a still-faulty `.claude/agents/*.md` warns until the file is
repaired, which is `corpus doc check`'s answer delivered on the path the write
happens on. `WARNING_CODE_BY_CHECK` stays what it is. `REPORTED_CHECK_CODES`
stays an explicit allow-list, so `anchor-unused` still never reaches the
response. `codes.test.ts` passes **unchanged**.

**One optional recording amendment was with the user** and implementation did not
wait on it: §11 permitted this behaviour but did not state it, so nothing in
SPEC.md would have failed if a later change silently removed the response
warning. It was escalated unsigned with v0.22.0 and **signed on 2026-08-25**.
The orchestrator appended it to §11's *"an error a save accepts"* bullet:

> A save that accepts one says so on its own response — as a response warning,
> the channel the auto-commit half below already routes a failure through — and
> in the server log, because the party whose write carried the fault reads the
> response and not the log. _(Rider signed 2026-08-25.)_

### The question, as it stood before the adjudication above answered it

_Kept for the record. The premise in the second sentence — that §11's wire
warning family is `CHECK_WARNING_CODES` — is the error the adjudication
corrected. Read it as history, not as an open question._

Putting the
same finding on the mutation **response** — where the console and the UI would
see it — requires a third `WarningCode`. §11's wire warning family is a closed
two-member set (`CHECK_WARNING_CODES` = `anchor-unresolved`, `ref-unresolved`),
and both members are *normal outcomes of using the system as designed*, which is
the whole reason they are warnings. `unterminated-fence` is not that; it is an
**error** severity finding. Reporting it as a warning would put an
error-severity §11 finding into the wire's warning channel — a change to what
§11's severity partition *means*, not a transcription of it. `codes.test.ts`
asserts behaviourally that no code appears on both sides of that partition, and
`isSkillFrontmatterException` already refuses to re-grade a finding for exactly
this reason. So the honest options are: leave the response alone (the log is the
operator channel, and `corpus doc check` is the on-demand one), widen the warning
family and accept that "warning" no longer implies "not an error", or introduce a
separate response-side channel for non-blocking errors. All three are §11
decisions and belong with the user.

## Acceptance Criteria

### Already met (SERVER-066 review round — recorded here, not re-done)

- [x] A save carrying a non-blocking §11 **error** is no longer discarded:
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

### What this issue delivered

- [x] The question was put to spec-writer on Fable and **adjudicated**, not
      guessed: the premise conflated two families, §11's own auto-commit
      sentence already answers it, and **no rider is needed**. Recorded above.
- [x] `checkSave` emits one `validation_error` warning **per tolerated finding**,
      for **both** halves of `tolerated` — `REPORTED_CHECK_CODES` and
      `isClaudeRootFrontmatter` alike, because "reported, never refused" is one
      rule and the party that reads the response is the same party in both cases
- [x] The warnings go into the **same array** `WARNING_CODE_BY_CHECK` already
      fills, so a save carrying both a tolerated error and a §11 warning reports
      both, each under its own code
- [x] `detail` is `` `${finding.code}: ${finding.detail}` `` — the finding's own
      code rides in prose rather than multiplying `WarningCode`s
- [x] **Nothing is re-graded.** `WARNING_CODE_BY_CHECK` is unchanged,
      `CHECK_WARNING_CODES` is unchanged, no code moved across the validator's
      partition, and `apps/server/src/check/codes.test.ts` passes **with no
      edit at all**
- [x] `REPORTED_CHECK_CODES` stays an explicit allow-list — `anchor-unused` is
      outside it and never reaches the response
- [x] The `logger.error` line stays **beside** the response warning, not instead
      of it: the two surfaces have different readers, and only the log survives a
      caller that discards `warnings`
- [x] The `SaveCheck.warnings` docblock is rewritten. Its old argument — that
      inventing a code "would put an error-severity finding into the wire's
      warning channel" — is refuted in place, citing the decision

### The cost, chosen rather than stumbled into

**Every save of a still-faulty `.claude/agents/*.md` now warns until the file is
repaired.** That is `corpus doc check`'s answer delivered on the path the write
actually happens on, and it is the point rather than a side effect: the whole
reason SERVER-123 stopped refusing those saves is that the fault is in bytes the
server never authored, and silence is what left the fault in place. It is a real
behaviour change and it is bounded in two directions, both measured below —
the warning stops the moment the frontmatter is repaired, and `anchor-unused`
(the finding that would fire on nearly every anchored comment) is still outside
the allow-list.

## Technical Design

### Files that already carry the fixed half

- `apps/server/src/docs/write.ts` — `REPORTED_CHECK_CODES` (line ~114),
  `SaveCheck.findings` / `SaveCheck.warnings` and their docblocks (~352–377),
  `checkSave` (~388), `validateBeforeWrite` (~403)
- `apps/server/src/docs/write.test.ts` — the log cases, both directions

### Files a "yes" answer would touch

- `SPEC.md` §11 — the rider, first and separately
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

- A save producing **both** a tolerated error and a §11 warning — the two
  families stay separate at every surface they reach; neither is folded into the
  other's count.
- A workspace with no git: `commit_skipped` is a *response* warning about the
  commit, not about validation. It is not a precedent for grading a validation
  error as a warning — the two halves of the `WARNING_CODES` enum have different
  subjects.
- A code in **neither** set stays silent on the save path. That is the safe
  default and this issue does not change it.

## Testing Strategy

_As implemented._ The pair lives in `apps/server/src/threads/turns.test.ts`,
under one describe, because neither half reads as an argument on its own:

- `POST /api/threads/:id/turns` against a thread whose file already carries an
  open fence returns `201` **with** the `validation_error` warning on the
  payload. (The fence must be pre-existing: `turnRequestBody` refuses a fence
  the *submitted turn* opens, with a `400`, so that shape never reaches the
  save's validator.)
- An ordinary anchored comment returns `201` with `warnings: []` — the
  `anchor-unused` negative the allow-list exists to prevent.

`check/codes.test.ts` needed **no edit**: no code moved across the validator's
partition.

Four existing assertions changed from `toEqual([])` to naming the warning, and
each is a case that used to be silent by the defect this issue fixes — the two
fence cases and the two Claude-root frontmatter cases in
`apps/server/src/docs/write.test.ts`, plus
`check/routes.test.ts`'s "the check is the only gate", whose title was true
before this issue and is not now. **Every log assertion beside them was kept**:
the response warning is added next to the `logger.error` line, never instead of
it, and `write.test.ts` asserts both in the same test.

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

**2026-08-24 — server-dev on Opus 5 (1M context), branch `phase-45-not-so`.**

Real workspace `…/scratchpad/ws067`, created by the real `corpus init` (port
8766 — the user's server on 8765 was never touched). Real server started with
`tsx apps/server/src/main.ts --workspace …/ws067`. Real HTTP with `curl`, real
CLI, real `git`, real `.claude/agents/` file. Nothing stubbed.

**1. The fence family, on the document route.** `POST /api/docs` with a body
whose fence closes on the content line:

```
HTTP=201
id: doc_wq4ziaoy
warnings: [ { "code": "validation_error",
  "detail": "unterminated-fence: unterminated fenced code block opened at line 17
     with a run of 3 backticks: it closes only on a line holding nothing but 3 or
     more backticks, so everything after it reads as code" } ]
```

**2. The fence family, on the route the issue names.** A thread was created
(`th_tdqjfire`, `warnings: []`), an open fence was appended to its file out of
band, and then `POST /api/threads/th_tdqjfire/turns` as `agent`:

```
HTTP=201
turn ts: 2026-08-24T19:00:13Z
warnings: [ { "code": "validation_error",
  "detail": "unterminated-fence: … so everything after it reads as code — and
     every `## author · timestamp` turn heading after it is invisible, so those
     turns are lost" } ]
```

`201` **with** the finding on the payload — the exact case SERVER-066's
reproduction ended at, where the response said `warnings []`. The turn's own
text is clean, so the request guard has nothing to refuse and the document-level
rule is what notices; that is the only shape in which this route reaches `201`
with the finding present.

**3. The pinned negative.** An ordinary anchored comment on a clean document:

```
POST /api/docs      → HTTP=201  doc_teoc6t5p  warnings: []
POST /api/threads   → HTTP=201  anchorId: anc_66371790  warnings: []
```

`anchor-unused` is true of the instant the parent is validated and false of the
world, and it did not reach the caller. The allow-list survived the change.

**4. The Claude-root frontmatter family, and one warning per finding.** A
hand-authored `.claude/agents/reviewer.md` carrying no `description` and
`status: banana`, saved through `PUT /api/docs/doc_agentdefbe996402`:

```
HTTP=200
warnings: [
  { "code": "validation_error",
    "detail": "frontmatter-invalid: description: missing or empty — Claude Code
       loads a subagent only when its frontmatter carries both `name` and
       `description` …" },
  { "code": "validation_error",
    "detail": "frontmatter-invalid: status: Invalid option: expected one of
       \"open\"|\"resolved\"|\"archived\"" }
]
```

Two findings, two warnings. Not refused: `200`, and the body was written.

**5. The cost is bounded.** The same file repaired
(`description: Reviews sources.`, `status: open`), saved again through the same
route: `HTTP=200`, `warnings: []`. The channel warns until the file is repaired
and goes quiet the moment it is.

**6. The log line survived beside it.** From the running server's own output:

```
error | document saved with validation errors | data/docs/inbox/fenced.md    | ['unterminated-fence: …
error | document saved with validation errors | data/threads/th_tdqjfire.md  | ['unterminated-fence: …
```

Both surfaces carry the finding. Neither replaced the other.

**7. Nothing was re-graded.** `corpus doc check` in that workspace, through the
real CLI:

```
EXIT=6
error unterminated-fence data/threads/th_tdqjfire.md: …
error unterminated-fence data/docs/inbox/fenced.md: …
corpus: 2 errors in 17 documents.
```

Same code, same **error** severity, same exit 6. The validator's partition is
untouched, and `check/codes.test.ts` passes unedited.

**8. A consumer already renders it.** `corpus thread reply th_tdqjfire`
through the real CLI, no CLI change of any kind:

```
EXIT=0
replied to th_tdqjfire — turn 2026-08-24T19:01:29Z — warning: validation_error
  (unterminated-fence: unterminated fenced code block opened at line 17 …)
```

The agent whose turn the fence swallows is now told, on the surface it reads.

**Falsification.** With the emit loop deleted from `checkSave` and nothing else
changed, the new route case fails and is the only thing that fails:

```
× turns.test.ts > a save that tolerates a §11 error says so on the response
  > answers 201 and carries the pre-existing fence as a `validation_error`
Tests  1 failed | 54 skipped (55)      EXIT=1
```

Restored, and the suite is green again.

**Checks.**

- `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run --reporter=verbose apps/server`
  → `EXIT=0`, **Test Files 205 passed (205)**, **Tests 4675 passed (4675)**
- `tsc --noEmit -p apps/server/tsconfig.json` → exit 0
- `eslint` on the four touched files → **0 errors, 0 warnings**. The five
  `no-unsafe-assignment` warnings the first draft raised came from
  `expect.stringContaining(…)` in an object property, and were fixed by asserting
  the codes and the `detail` separately — no rule was disabled.
- `prettier --check` on the four touched files → clean
- Test server stopped, port 8766 free, port 8765 untouched.

## Completion Checklist (domain agent)

- [x] Tests written and passing (4675 in `apps/server`, 205 files, exit 0)
- [x] `/lint` passes (eslint clean, prettier clean, `tsc --noEmit` clean)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] The §11 question put to spec-writer on Fable, adjudicated, and recorded
      here — no rider needed, no signature required
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-067]` prefix
