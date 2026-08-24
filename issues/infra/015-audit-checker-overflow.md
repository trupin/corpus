# [INFRA-015] Audit checker: output overflow / spawn failure must not select the fail-open branch

## Domain
infra

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: INFRA-013
- Blocks: —

## Spec References
- None product-behavioral — dev-harness (PR #16 review finding 3, 2026-07-31)

## Summary
`check-audit.ts` spawns `npm audit --json` without `maxBuffer` (1 MiB default) and
never consults `spawnSync().error`. A tree with more than ~1 MiB of advisories gets
truncated stdout → JSON.parse fails → classified `unreachable` → pre-commit (which
passes the tolerate flag) warns and PROCEEDS on exactly the trees with the most
findings, misattributing the cause to the registry. Same path if npm fails to spawn.
CI runs flag-less and fails closed, so the backstop holds — but the local fail-open
branch must be selectable only by genuine unreachability. Fix: generous `maxBuffer`
(e.g. 64 MiB); consult `error`/null `status` and classify spawn failure as its own
fail-closed verdict distinct from `unreachable`; add fixtures for truncated-JSON and
spawn-error. Also worth folding in: strip control chars/ANSI from registry-controlled
advisory text before rendering (review finding 2 — human-facing spoofing only).

## Acceptance Criteria
- [x] Truncated/oversized audit output fails closed in BOTH forms with an honest cause message (test with a fixture > buffer)
- [x] Spawn failure (npm absent) fails closed in both forms
- [x] Genuine unreachable payload still warns-and-proceeds locally, fails CI (existing tests untouched)
- [x] Advisory text sanitized (newlines/ANSI stripped) in the human report

## Technical Design
### Files to Create/Modify
- `scripts/audit-report.ts` — new `unusable` verdict kind with an `AuditRunFailure`
  cause, `classifyAuditRun` (the whole-run classifier), `sanitizeRegistryText`,
  and `formatFinding` sanitizing at the render
- `scripts/check-audit.ts` — `maxBuffer: 64 MiB`, classifies the run rather than
  bare stdout, prints the `unusable` block and exits 1 regardless of the flag
- `scripts/audit-report.test.ts` — 20 new cases (existing 36 untouched)
- `scripts/check-audit.test.ts` — **new**: runs the real script as a process
- `.githooks/pre-commit`, `.github/workflows/ci.yml` — comments only, recording
  what the tolerate flag does and does not cover

## Testing Strategy
scripts-level (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Fixture-driven; the offline and pin drills from INFRA-013's log re-run unchanged.

## E2E Verification Log

**Model: opus** (`claude-opus-5[1m]`). Branch `phase-45-not-so`, main working tree.
Every command below is a real invocation. `npx` was avoided throughout; runs used
`./node_modules/.bin/*` and absolute binary paths.

### 1. Reproduction — the fail-open branch, before the fix

The pre-fix runner is `spawnSync` with no `maxBuffer` and
`classifyAuditReport(audited.stdout ?? "")` with `error` never consulted. Both
were re-created verbatim in a scratch script against the **unchanged**
`classifyAuditReport`, then driven by two purpose-built `npm` shims on `PATH`:
one writing 70 MiB to stdout, one absent entirely.

```
$ PATH=<shim-overflow> node --import tsx prefix-runner.ts --tolerate-unreachable-registry
PREFIX spawn.error=ENOBUFS stdout.len=1114112 verdict=unreachable
EXIT=0

$ PATH=<empty dir> node --import tsx prefix-runner.ts --tolerate-unreachable-registry
PREFIX spawn.error=ENOENT stdout.len=undefined verdict=unreachable
EXIT=0
```

Both defects confirmed, both silent. Note `stdout.len=1114112` — npm's output was
truncated at ~1 MiB and the truncated bytes were handed to `JSON.parse`, which is
exactly how a tree with many advisories became "the registry did not answer".

Node's three signals were measured first, because the fix depends on them being
distinguishable (Node v25.2.1, macOS):

```
OVERFLOW: status=null signal=SIGTERM error=Error:ENOBUFS  stdout.length=1114112
ENOENT:   status=null signal=null    error=Error:ENOENT   stdout=undefined
SIGKILL:  status=null signal=SIGKILL error=undefined      stdout=""
```

The third is the nastiest: no `error` at all, and stdout is an ordinary empty
string — indistinguishable from "npm audit produced no output" unless `status`
is read.

### 2. The fixed checker — overflow, both callers' forms

Real `scripts/check-audit.ts`, unmodified, with an `npm` shim writing 70 MiB.

```
$ PATH=<shim-overflow> node --import tsx scripts/check-audit.ts --tolerate-unreachable-registry
audit:check ✗   THE SUPPLY-CHAIN GATE COULD NOT RUN, AND THIS IS NOT A NETWORK PROBLEM.
audit:check ✗   npm audit's output was truncated before anything could read it.
audit:check ✗   npm audit wrote more output than the capture buffer holds (ENOBUFS); the
audit:check ✗   payload was truncated and no verdict can be read from it
audit:check ✗   Failing closed in every caller: --tolerate-unreachable-registry covers an
audit:check ✗   unanswering registry, never a check that did not run.
EXIT=1

$ PATH=<shim-overflow> node --import tsx scripts/check-audit.ts          # CI form
EXIT=1
```

### 3. The fixed checker — spawn failure, both forms

```
$ PATH=<empty dir> node --import tsx scripts/check-audit.ts --tolerate-unreachable-registry
audit:check ✗   npm could not be started — is it on PATH, and executable?
audit:check ✗   npm audit could not be started (ENOENT): spawnSync npm ENOENT
EXIT=1

$ PATH=<empty dir> node --import tsx scripts/check-audit.ts             # CI form
EXIT=1
```

### 4. The fixed checker — killed mid-run

```
$ PATH=<shim that SIGKILLs itself> node --import tsx scripts/check-audit.ts --tolerate-unreachable-registry
audit:check ✗   npm audit was killed before it produced a report.
audit:check ✗   npm audit was killed by SIGKILL and never exited, so it produced no verdict
EXIT=1
```

### 5. Non-regression — the one branch the flag is actually for

Recorded `ECONNREFUSED` payload, replayed by a shim that exits 1 like npm does.

```
$ PATH=<shim-unreachable> … check-audit.ts --tolerate-unreachable-registry
audit:check ⚠   THE SUPPLY-CHAIN GATE DID NOT RUN.
audit:check ⚠   The npm registry did not answer: request to http://127.0.0.1:9/… ECONNREFUSED
audit:check ⚠   Proceeding anyway — a network outage must not block a local commit.
EXIT=0

$ PATH=<shim-unreachable> … check-audit.ts                              # CI form
audit:check ⚠   Failing closed. This gate does not report success it did not measure.
EXIT=1
```

### 6. Non-regression — the real registry

```
$ node --import tsx scripts/check-audit.ts --tolerate-unreachable-registry
audit:check ⚠   THIS GATE IS CARRYING 1 DOCUMENTED EXCEPTION. IT IS NOT CLEAN.
audit:check ⚠   GHSA-5p4m-2wfm-xmqj — expires 2026-10-01 (37 day(s) left)
audit:check ✓ npm audit: 0 untolerated vulnerabilities — but 2 finding(s) are tolerated
              by 1 documented exception above. This is NOT a clean tree.
EXIT=0

$ node --import tsx scripts/check-audit.ts                              # CI form
EXIT=0
```

The INFRA-021 exception still matches on the raw advisory URL and the lockfile
route — sanitization is applied at the render only, and a test pins that.

### 7. Advisory-text sanitization, against a hostile payload

A shim emitting an advisory whose `title` carries `LF + "audit:check ✓ npm audit
reports 0 vulnerabilities, all severities" + LF`, a CSI erase-screen, a coloured
"REPAINTED", an OSC window-title sequence, and a `range` carrying `CRLF` plus a
second forged line.

```
$ PATH=<shim-spoof> node --import tsx scripts/check-audit.ts > out 2>&1
EXIT=1
lines beginning a forged gate verdict: 0
ESC bytes in output:  0
CR bytes in output:   0
total output lines:   2
```

One advisory renders as exactly one line. No escape byte survives. The forged
text is still shown — it is evidence — but only as inert mid-line characters.

### 8. The real hook, blocking

`.githooks/pre-commit` run directly (read-only: `git rev-parse`, `git diff
--cached`; nothing staged, so only the audit step runs). No git state changed.

```
$ PATH=<node,git,tr,grep,sed,cat — no npm> /bin/bash .githooks/pre-commit
pre-commit ▶ npm audit
audit:check ✗   THE SUPPLY-CHAIN GATE COULD NOT RUN, AND THIS IS NOT A NETWORK PROBLEM.
pre-commit ✗ npm audit failed — fix the errors above …
pre-commit: blocked. Nothing was committed.
HOOK_EXIT=1

$ PATH=<same + overflowing npm> /bin/bash .githooks/pre-commit
pre-commit: blocked. Nothing was committed.
HOOK_EXIT=1

$ /bin/bash .githooks/pre-commit                    # real npm, real registry
pre-commit ✓ (build, lint, typecheck and tests run in CI — INFRA-025)
HOOK_EXIT=0
```

### 9. Tests, lint, typecheck

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run --reporter=verbose \
    scripts/audit-report.test.ts scripts/check-audit.test.ts
 Test Files  2 passed (2)
      Tests  56 passed (56)
EXIT=0

$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run --reporter=verbose scripts
 Test Files  20 passed (20)
      Tests  1032 passed (1032)
EXIT=0

$ ./node_modules/.bin/eslint scripts/{audit-report,check-audit}{,.test}.ts    → 0
$ ./node_modules/.bin/prettier --check <the five changed files>               → 0
$ ./node_modules/.bin/tsc --noEmit -p scripts/tsconfig.json                   → 0
```

`scripts/check-audit.test.ts` is new and runs the real script as a process, so
the branch that never ran now runs on every CI head — overflow and spawn failure,
each in both callers' forms, plus the two unreachable-registry forms.

One test failed on the first run and found a real defect in my own code: the
escape-sequence scanner treated `ESC ( 0` as two characters, so the charset
designator's final byte leaked back into the rendered line as `0`. The scanner
now follows the actual grammar — ESC, zero or more intermediates (0x20–0x2F),
one final byte (0x30–0x7E).

### What was decided, and what was rejected

- **The new verdict lives in the runner's input, not in `classifyAuditReport`.**
  Overflow and spawn failure are only observable at the spawn, so `classifyAuditRun`
  wraps the pure classifier and hands it a payload only when npm actually produced
  one. `classifyAuditReport` keeps its exact contract and every one of its existing
  tests is untouched.
- **Rejected: reclassifying unparseable stdout as `unusable`.** Tempting — npm with
  `--json` always emits JSON, so unreadable bytes smell like truncation. But a
  completed npm that wrote garbage is a fact about npm's answer, not an observed
  truncation, and guessing would misreport a broken-but-answering registry as a
  broken gate. `ENOBUFS` is the real signal and it is now read. A test pins the
  unchanged behaviour.
- **Rejected: making `maxBuffer` configurable.** This gate's whole design forbids
  knobs (no env var, no `CI` detection). 64 MiB is a constant, and raising it does
  not make overflow safe — `ENOBUFS` still fails closed. It only makes overflow rare
  enough to be believable as an alarm.
- **Sanitization at the render, never at the match.** `coversLeaf` matches the GHSA
  id against the **raw** advisory URL. Sanitizing the stored `AuditFinding` would have
  risked silently breaking exception matching, so `sanitizeRegistryText` is applied
  inside `formatFinding` and at the one `verdict.reason` print site. A test asserts
  the stored `title` keeps its newline while the rendered line does not.
- **No lint rule was disabled.** The first sanitizer draft used regexes over control
  characters, which needs `no-control-regex` suppressions and put raw control bytes
  in the source. It was replaced by an explicit character-code scanner: no
  suppressions, no invisible bytes.
- **The hook gained no work.** The audit step already ran there; only its honesty
  changed. Nothing whole-repo was added to any hook.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
