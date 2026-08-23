# [INFRA-032] A tampered generated artifact survives a green local run

## Domain
infra

## Status
todo

## Priority
P2 (nice-to-have)

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- None. This is repository tooling.

## Summary

**Found by CONTRACT-083's implementer while falsifying its own fix, and reported
as a false negative rather than quietly worked around.**

Its first falsification deleted the `409` from the committed
`packages/contract/openapi.json`. **All eleven new tests stayed green.**
`openapi.test.ts` reads `buildOpenApiDocument()` — the document built in memory
from the route definitions — not the committed file. The committed artifact is
checked by the drift check, which since INFRA-025 runs in **CI alone**.

So a hand-edited, stale or corrupted `openapi.json` survives a full green local
run, and the first thing that notices is a pushed CI job.

This is working as designed, and the design has a cost nobody has written down:
**a green local suite is not evidence that the committed contract matches the
code.** Three agents this release read a green local run as exactly that.

## Why it is P2 and not higher

Nothing reaches `main` through it. `CI / validate` runs
`check-generated-artifacts` on every pushed head and a PR cannot merge red. The
cost is a wasted CI cycle and a confusing local signal, not a bad release.

INFRA-025's rule stands and this issue does not reopen it: a check that needs the
whole codebase belongs to CI. **Regenerating and diffing two artifacts is not
whole-codebase work**, though — it is diff-scopable in the sense that matters,
because it only ever needs running when `packages/contract` changed.

## The three candidate answers

1. **A pre-commit check conditioned on the path.** If the commit touches
   `packages/contract/src`, regenerate and refuse on a diff. Cheap, precise, and
   it puts a build in the commit hook — which INFRA-025 deliberately removed.
2. **A unit test that reads the file.** `openapi.test.ts` gains one case
   comparing the committed artifact against `buildOpenApiDocument()`. No hook
   change, and it fails in the workspace suite the contract agent already runs.
   Costs a file read per suite run.
3. **Nothing, but say so.** Document in `docs/TS_GUIDELINES.md` and the
   contract-dev agent definition that a green local run says nothing about the
   committed artifact.

**2 looks right and 1 looks wrong**, but the call belongs with whoever owns the
hook policy, since INFRA-025 was a user decision.

## Decided by the user, 2026-08-23 — a unit test that reads the file

**Chosen: option 2.** `packages/contract`'s suite gains one case comparing the
**committed** `openapi.json` and `schema.generated.ts` against
`buildOpenApiDocument()` and the generator's output.

**INFRA-025 stands untouched.** No build returns to the commit hook, and no
whole-codebase work moves out of CI. This is a file read inside a suite that
already runs.

**Rejected: a pre-commit check conditioned on the path.** It catches the case at
the earliest possible point, and it puts a build back into the commit hook —
which is exactly what INFRA-025 removed, by a decision of the user's that this
issue is not permitted to reopen.

**Rejected: document the gap and change nothing.** It costs no runtime and
relies on every future reader having read it. Three agents in one release read a
green local run as proof the artifact matched, so the record is that reading the
guidance is not what happens.

**One trap the test must avoid.** A contributor who has not run `npm run build`
has a stale `dist/`, and the in-memory document can differ for that reason
instead. The failure message must say which of the two it is, or the check will
be read as flaky and disabled. Four agents this release hit a phantom typecheck
error from exactly that cause.

## Acceptance Criteria

- [ ] The choice is made and written down with the rejected options and why.
- [ ] If a check is added, it is falsified: tamper with the committed artifact
      and watch it fail locally.
- [ ] Whatever is chosen, the gap is stated where an agent will read it — the
      contract-dev agent definition at minimum.
- [ ] INFRA-025's rule is not reopened. No whole-codebase work returns to the
      hooks.

## Technical Design

### Files to Create/Modify
- `packages/contract/src/openapi.test.ts`, under option 2
- `.githooks/pre-commit`, under option 1
- `.claude/agents/contract-dev.md` — the statement, under any option

### Edge Cases
- A contributor who has not run `npm run build`, so `dist/` is stale and the
  in-memory document differs for that reason instead.
- The generated client, `schema.generated.ts`, which has the same exposure.

## Testing Strategy

Tamper and watch. That is the whole test, and it is the one that was missing.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Delete a declaration from the committed `packages/contract/openapi.json`
2. `./node_modules/.bin/vitest run packages/contract`
3. Expected: something fails
4. Actual: 174 files, all green

### Verification Steps
1. Repeat after the change and confirm it fails locally

## E2E Verification Log

### Reproduction (bugs only)
2026-08-23, during CONTRACT-083: the 409 was deleted from the committed
`openapi.json` and all 11 new tests stayed green.

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
