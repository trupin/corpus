# [INFRA-032] A tampered generated artifact survives a green local run

## Domain
infra

## Status
done

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

## What was actually found, 2026-08-23 — the premise is half true

**The check the user chose already exists**, and it fires.
`packages/contract/src/generation/artifacts.test.ts` has read both committed
artifacts and compared them against freshly generated ones since the package was
written. Falsified before writing any code: the `409` was deleted from
`POST /api/queue/{id}/complete` in the committed `openapi.json`, and
`./node_modules/.bin/vitest run packages/contract` failed on it — with a diff
naming the missing block.

**What the issue reports is nonetheless real, and it is about scope rather than
coverage.** `openapi.test.ts` and every other test in the package read
`buildOpenApiDocument()`, so none of them can see the committed files at all.
CONTRACT-083's implementer deleted a `409` and watched **eleven new tests stay
green** — that sentence is exactly true. Its E2E plan then records
`vitest run packages/contract` as green over "174 files"; the contract workspace
has 70 test files and 174 is `packages/contract apps/server`, which is the run
this repo's agents are told to make. That run does include
`generation/artifacts.test.ts`, and the tamper reproduced here fails it. So the
"all green" line could not be reproduced, and the most likely reading is that
the wider run was recorded from before the tamper.

**Conclusion, and what this issue therefore did.** Option 2 was already
implemented. Adding a second file-reading test would have been a duplicate
assertion, not a fix. What was missing is the half the user was most explicit
about — **the failure message** — and the half the acceptance criteria name: a
statement where an agent will read it. Both were done. INFRA-025 is untouched:
no build returned to any hook, and nothing moved out of CI.

## Acceptance Criteria

- [x] The choice is made and written down with the rejected options and why —
      the user's, at the top; and the finding that option 2 was already built,
      above.
- [x] The check is falsified — three ways, below, one per branch of its new
      failure message.
- [x] The gap is stated where an agent will read it — `.claude/agents/contract-dev.md`,
      Domain Knowledge, dated 2026-08-23, stating that the check is real, that
      it lives in exactly one file, and that a narrow `vitest` filter skips it.
- [x] INFRA-025's rule is not reopened. Nothing was added to any hook, and no
      whole-codebase work moved out of CI.

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

**Model: opus** (`claude-opus-5[1m]`).

### Reproduction (bugs only)
2026-08-23, during CONTRACT-083: the 409 was deleted from the committed
`openapi.json` and all 11 new tests stayed green.

**Re-run 2026-08-23, before writing any code.** The same tamper, at the
workspace scope the issue names:

```
$ node -e "... delete d.paths['/api/queue/{id}/complete'].post.responses['409'] ..."
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run packages/contract
 FAIL  packages/contract/src/generation/artifacts.test.ts > contract artifact generation
       > has openapi.json committed in sync with the route definitions
 Test Files  1 failed | 69 passed (70)
      Tests  1 failed | 2933 passed (2934)
```

So the artifact-reading check is there and it fires. What was missing is the
message it fires with, and any statement an agent would meet before hitting it.

### Post-Implementation Verification

**The claim about a stale build, proved rather than assumed.** The message now
says a build cannot change the answer. Verified by removing the build entirely:

```
$ mv packages/contract/dist <scratch>/contract-dist-away
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run packages/contract/src/generation/artifacts.test.ts
 Test Files  1 passed (1)
      Tests  7 passed (7)
$ mv <scratch>/contract-dist-away packages/contract/dist
```

Nothing that comparison reads resolves through the package's `exports` map: the
committed files come off disk and the expected contents come from route
definitions imported relatively. `dist/` stale, current or absent gives the same
verdict.

**Falsification, one per branch.**

1. **The committed document, hand-edited** — the `409` deleted from
   `POST /api/queue/{id}/complete`:

```
AssertionError: openapi.json is out of date and src/client/schema.generated.ts is current.
Cause: the committed document was edited by hand, or half a regeneration was committed —
the client types still describe the document the routes produce.
Fix: npm run generate -w packages/contract
This is not a stale `dist/`: both sides are built from `packages/contract/src`, so
`npm run build` cannot change this result.
```

2. **The committed client types, hand-edited** — one comment line inserted into
   `schema.generated.ts`. The document is byte-identical, which rules the routes
   out and names the real cause:

```
AssertionError: src/client/schema.generated.ts is out of date and openapi.json is current.
Cause: the document the routes produce is byte-identical, so the routes did not move —
the generator did. openapi-typescript is at a different version than the one that wrote
the committed file, or the committed client types were edited by hand.
Fix: npm install, then npm run generate -w packages/contract
This is not a stale `dist/`: ...
```

   The fix ordering is the point: regenerating first would commit the wrong
   generator's output and call it fixed.

3. **A source edit that was never regenerated** — `getHealth`'s `summary`
   changed in `src/routes/health.ts`, artifacts left alone. Both move, and both
   cases fail:

```
AssertionError: Both committed artifacts are out of date (openapi.json, src/client/schema.generated.ts).
Cause: the route definitions under packages/contract/src changed and nothing regenerated,
or a committed artifact was edited by hand.
Fix: npm run generate -w packages/contract
This is not a stale `dist/`: ...
 Test Files  1 failed | ... Tests  2 failed | 9 passed (11)
```

Every tamper was reverted and the file is green:

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run packages/contract/src/generation/artifacts.test.ts
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

Two of the three branches cannot be produced by an ordinary mistake — the
client-types-only branch needs a dependency at the wrong version — so all three
are pinned as unit tests over `staleArtifactDiagnosis`, rather than left to be
discovered in the one session that meets them.

### What was deliberately not done

No second file-reading test was added: one already exists, and a duplicate
assertion would have looked like a fix while changing nothing. No hook was
touched.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
