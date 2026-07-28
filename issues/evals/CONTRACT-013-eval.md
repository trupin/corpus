# Evaluation: CONTRACT-013

**Date**: 2026-07-28
**Sprint**: sprint-011 (rider)
**Verdict**: PASS

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes |
| --------------------------------------- | ------ | ----- |
| Verification log present                | PASS   | |
| Commands are specific and concrete      | PASS   | Real greps with file:line output; a runtime script driving the **published** `dist/client/index.js` through the `exports` map against a real `OpenAPIHono` app mounting the real route definition |
| Real E2E (not mocked)                   | PASS   | The point of this issue is the published barrel, and the proof exercises the built artifact rather than the source tree |
| Scenarios cover acceptance criteria     | PASS   | All three ACs |
| Application restarted after changes     | PASS   | Rebuilt before the barrel run |
| Actual model recorded (implemented on:) | PASS   | "Implemented on: opus (contract-dev, main tree, branch `phase-3-ui`, base `aec0b21`)." |
| Reproduction logged before fix (bugs)   | N/A    | |

**Honesty audit — clean, and notably careful.** The log does not claim the `FORM_ANSWER_LABEL`
de-duplication was finished. It states plainly that `apps/ui/src/thread/parseFormBlock.ts` still
carried UI-008's copy, that reaching it was out of the contract domain's scope, and it files an
explicit follow-up for ui-dev. That follow-up became Wave-B Addendum rider chore 3, and UI-010 did
it — so the end state is correct and the log's snapshot of its own moment was accurate.

## Criteria Results

| # | Criterion | Result | Notes |
| - | --------- | ------ | ----- |
| 1 | `uploadCreateThread`, `buildThreadFormData`, `ThreadUpload` exported from the client barrel | PASS | Verified through the built package: no file under `apps/ui/src` needs `@corpus/contract/client`, and the kit's `createThreadWithFiles` wraps it (TEST-166 holds — see the cross-issue eval) |
| 2 | `FORM_ANSWER_LABEL` defined in the contract; server imports it; grep proves one definition | PASS | Re-derived independently: `git grep '"\*\*Answered:\*\*"'` over `packages/*/src apps/*/src` returns **no non-test match outside** `packages/contract/src/schemas/form.ts:86`. `apps/server/src/threads/forms.ts` imports it; `apps/ui/src/thread/parseFormBlock.ts:1` now imports it from `@corpus/contract` and re-exports it, its local copy deleted (Wave-B rider chore 3, done by UI-010) |
| 3 | Regeneration idempotent; drift check green | PASS | `node --import tsx scripts/check-generated-artifacts.ts` ran **twice in a row**, exit 0 both times: `✓ API contract is up to date (packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts)` and `✓ CLI reference is up to date (docs/cli.md)`. `git status` clean after both runs |

## Behavioral confirmation

The constant is not merely defined — it is the marker the running system actually writes and reads.
Answering a form through the browser produced, on disk:

```
## user · 2026-07-28T19:20:44Z
**Answered:** 15-year fixed
```

and the UI rendered that same turn as an inert answered form reading `Answered — 15-year fixed`.
Server writer and UI reader agree because they now share one definition.

## Summary

**3 of 3 criteria PASS.** A small, well-scoped rider that did exactly what it said, declined to
reach into another domain's tree, and named the follow-up that closed the remaining duplicate. The
single-definition invariant holds at the branch tip and the generated artifacts are idempotent.
