# [INFRA-013] npm-audit gate: zero findings, enforced at pre-commit and CI

## Domain
infra

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: UI-016 (router 8 clears the last known advisories — user decision 2026-07-31: upgrade first, then strict gate)
- Blocks: —

## Spec References
- None product-behavioral — dev-harness validation (user request 2026-07-31)

## Summary
User directive: `npm audit` must report **zero vulnerabilities of any severity** —
no allowlist, no severity floor — enforced in BOTH the pre-commit hook and CI's
validate workflow. Sequenced after UI-016 (the two react-router moderates are the
only current findings; post-router-8 the tree audits clean — verified 2026-07-31).

Design points for the implementing agent:
- Gate command: `npm audit --audit-level=low` (or `--json` + a small checker for an
  exact zero-count assertion — pick whichever gives a crisp failure message naming
  each advisory; document the choice). Workspaces are covered by the root audit.
- **Pre-commit offline behavior (orchestrator default, reviewer may challenge):**
  fail on findings; if the registry is UNREACHABLE, print a loud warning and
  continue — a network outage must not block local commits; CI is the fail-closed
  backstop. CI always fail-closed.
- Keep the hook fast: audit uses the lockfile + one registry round-trip; measure and
  record the added latency. If it exceeds ~5s locally, raise it in the report (the
  user chose pre-commit knowingly; do not silently move it to pre-push).
- CI: a dedicated step in the validate workflow, early (before build), so audit
  failures are cheap and clearly labeled.

## Acceptance Criteria
- [x] A dependency with any-severity advisory fails pre-commit AND CI with the advisory named (drill: temporarily pin a known-vulnerable version in a scratch branch of the tree, prove both gates catch it, revert — never commit the vulnerable pin) — `minimist@1.2.0`, both gates exit 1 naming both GHSAs; restored byte-identically (TEST-765/766)
- [x] Clean tree: both gates pass; pre-commit latency measured and recorded — median 0.82 s (TEST-767/768)
- [x] Registry unreachable: pre-commit warns loudly and proceeds; CI fails closed (TEST-763/764)
- [x] No allowlist mechanism exists anywhere in the implementation — proved by grep (TEST-772)

## Technical Design
### Files to Create/Modify
- `.githooks/pre-commit`, `.github/workflows/` validate workflow (+ any small script under `scripts/` with tests if a checker is written)

## Testing Strategy
Script-level tests if a checker script exists; the drill in the acceptance criteria is the E2E.

## E2E Verification Plan
The vulnerable-pin drill both locally (hook) and on a scratch CI run; clean-state pass; offline simulation (block the registry host) for the pre-commit warn-and-proceed path.

## E2E Verification Log

**implemented on: opus** (Opus 5, 1M context). Date 2026-07-31, branch `phase-7b-upgrades-ci`,
main tree. Sprint contract `issues/sprints/sprint-020.md` (TEST-759–774) governs; its premise
corrections C6–C9 and orchestrator adjudications 4 and 5 **override this issue's design notes**
where they disagree (notably: `--audit-level` is *not* used — see TEST-759 below).

### Precondition (contract Integration Point UI-016 → INFRA-013, TEST-754)

The gate was armed only after measuring this tree, not on UI-016's inference:

```
$ npm audit --json | (metadata.vulnerabilities)
{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}
top-level keys: auditReportVersion,vulnerabilities,metadata
```

Total 0 ⇒ proceed. Had it been non-zero the issue would have stopped and escalated.

### Files

- `scripts/audit-report.ts` — pure verdict module (new)
- `scripts/audit-report.test.ts` — 16 tests, colocated (new)
- `scripts/check-audit.ts` — thin runner, spawns `npm audit --json` (new)
- `.githooks/pre-commit` — new first step, `step "npm audit" … --tolerate-unreachable-registry`
- `.github/workflows/ci.yml` — new step 4 inside `validate`, no flag

No root `package.json` script was added: the hook and CI invoke
`node --import tsx scripts/check-audit.ts` directly, the same way `.githooks/pre-push:46` and
`ci.yml`'s `generated artifacts drift` step already invoke `check-generated-artifacts.ts`.

### TEST-759 — total-zero assertion, no severity floor

`classifyAuditReport` asserts `metadata.vulnerabilities.total === 0`. `--audit-level` is passed
**nowhere**, not even at `info`: the module comment records why (a floor is a silent allowlist for
the buckets below it, and an unused flag is a knob someone can turn into a loophole later). Unit
test `fails on an info-only finding — the severity floor \`--audit-level=low\` would have tolerated`
pins the behaviour `--audit-level=low` would have got wrong.

### TEST-760 — the failure names every advisory

One line per advisory (not per package), from the `vulnerabilities[*].via` array. Real output from
the pin drill below:

```
audit:check ✗ moderate minimist@>=1.0.0 <1.2.3 — Prototype Pollution in minimist — https://github.com/advisories/GHSA-vh95-rmgr-6w4m
audit:check ✗ critical minimist@>=1.0.0 <1.2.6 — Prototype Pollution in minimist — https://github.com/advisories/GHSA-xvch-5gv4-984h
audit:check ✗ 1 vulnerable package(s), 2 advisory(ies). The gate is zero of any severity and there is no allowlist: upgrade, replace, or override the transitive dependency.
```

A purely transitive entry (`via: ["minimist"]`, no advisory object of its own) still produces a
finding line naming the parent — covered by a unit test.

### TEST-761 / TEST-762 — payload-shape discrimination, both fixtures recorded

C6 re-measured in this tree at implementation time (npm 11.6.2). Both cases **exit 1**:

```
$ npm_config_registry=http://127.0.0.1:9/ npm audit --json ; echo exit=$?
{
  "message": "request to http://127.0.0.1:9/-/npm/v1/security/advisories/bulk failed, reason: connect ECONNREFUSED 127.0.0.1:9",
  "error": { "summary": "", "detail": "" }
}
exit=1
stderr: npm warn audit request to … failed … / npm error audit endpoint returned an error
```

and the findings payload (captured from a scratch fixture pinning `minimist@1.2.0`) carries
`auditReportVersion`, `vulnerabilities`, `metadata`, with `metadata.vulnerabilities.total = 1`.
Both are quoted verbatim as fixtures in `scripts/audit-report.test.ts`
(`UNREACHABLE_PAYLOAD`, `FINDINGS_PAYLOAD`, plus `CLEAN_PAYLOAD`).

`scripts/check-audit.ts` never reads `audited.status`; a comment says why. The runner's only
inputs are the stdout string and `process.argv`.

TEST-762 specifically: there is exactly **one** `{ kind: "clean" }` return in `audit-report.ts`
(line 151), guarded by `total === 0 && findings.length === 0`. Seven non-verdict payloads —
empty stdout, whitespace, non-JSON, `42`, no `metadata`, a **string** `"0"` total, and a
hypothetical future schema that moves the total — are each asserted to classify `unreachable`,
never `clean`. A `total: 0` payload with a populated `vulnerabilities` map (self-contradictory)
also classifies `findings`, not `clean`.

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/audit-report.test.ts
 ✓ scripts/audit-report.test.ts (16 tests) 4ms
 Test Files  1 passed (1)      Tests  16 passed (16)
```

### TEST-763 — offline drill, pre-commit warns and proceeds

Run against a dead local port via `npm_config_registry` for the single invocation only — no
`.npmrc` was created, no real network config touched. The **real `.githooks/pre-commit`** was
executed (no `git commit`; this agent runs no state-changing git command). The heavy steps were
stubbed by a `npm` shim on `PATH` that passes `npm audit` through to the real npm and no-ops
`npm run …`/`npm test`, so the hook's real ordering, `step()` reporting and exit epilogue are
exercised without a repo-wide build/test run:

```
$ npm_config_registry=http://127.0.0.1:9/ PATH="$STUB:$PATH" bash .githooks/pre-commit
pre-commit ▶ npm audit
audit:check ⚠ ════════════════════════════════════════════════════════════════════════
audit:check ⚠   THE SUPPLY-CHAIN GATE DID NOT RUN.
audit:check ⚠   The npm registry did not answer: request to http://127.0.0.1:9/-/npm/v1/security/advisories/bulk failed, reason: connect ECONNREFUSED 127.0.0.1:9
audit:check ⚠   Your dependencies were NOT checked against any advisory database.
audit:check ⚠   Proceeding anyway — a network outage must not block a local commit.
audit:check ⚠   CI runs this same check fail-closed, so anything missed here fails there.
audit:check ⚠ ════════════════════════════════════════════════════════════════════════
pre-commit ▶ build
… (stubbed steps) …
pre-commit ✓ all checks passed
HOOK EXIT=0
```

### TEST-764 — CI fail-closed, and the branch is structurally unselectable

```
$ npm_config_registry=http://127.0.0.1:9/ node --import tsx scripts/check-audit.ts
audit:check ⚠ ════════════════════════════════════════════════════════════════════════
audit:check ⚠   THE SUPPLY-CHAIN GATE DID NOT RUN.
audit:check ⚠   The npm registry did not answer: request to http://127.0.0.1:9/… ECONNREFUSED 127.0.0.1:9
audit:check ⚠   Your dependencies were NOT checked against any advisory database.
audit:check ⚠   Failing closed. This gate does not report success it did not measure.
audit:check ⚠ ════════════════════════════════════════════════════════════════════════
exit=1
```

Adjudication 5's structural requirement, proved rather than asserted — the checker reads **no
environment at all**:

```
$ /usr/bin/grep -c "process.env" scripts/check-audit.ts scripts/audit-report.ts
scripts/check-audit.ts:0
scripts/audit-report.ts:0
```

The single selector is the literal CLI flag `--tolerate-unreachable-registry`, consulted in exactly
one place — inside the `case "unreachable"` arm. It cannot affect the `findings` arm (proved
below: the hook passes the flag and still blocks on the pin), and no `CI`/env sniffing exists to
disable the gate quietly. `.githooks/pre-commit` is the only caller that passes it; `ci.yml` passes
nothing.

### TEST-765 — vulnerable-pin drill, pre-commit blocks

Pin: **`minimist@1.2.0`** — GHSA-vh95-rmgr-6w4m (moderate) and GHSA-xvch-5gv4-984h (critical),
prototype pollution. Applied to the working tree with
`npm install --package-lock-only --no-audit --no-fund minimist@1.2.0` (lockfile + manifest only —
`node_modules/` was never mutated, so nothing else in the tree or any sibling was disturbed), and
reverted from byte-exact scratch backups.

```
$ shasum -a 256 package.json package-lock.json          # BEFORE
3990775ac851e27e6ea437bb119fa51cda1543533f4e9e18f362a7f080946afd  package.json
f2acbee334fa870d197337b4aba67d3da4aee292aa4e040892e17ef552389e86  package-lock.json

$ node -e '…' package-lock.json
lockfile node_modules/minimist = {"version":"1.2.0", …}

$ PATH="$STUB:$PATH" bash .githooks/pre-commit
pre-commit ▶ npm audit
audit:check ✗ moderate minimist@>=1.0.0 <1.2.3 — Prototype Pollution in minimist — https://github.com/advisories/GHSA-vh95-rmgr-6w4m
audit:check ✗ critical minimist@>=1.0.0 <1.2.6 — Prototype Pollution in minimist — https://github.com/advisories/GHSA-xvch-5gv4-984h
audit:check ✗ 1 vulnerable package(s), 2 advisory(ies). …
pre-commit ✗ npm audit failed — fix the errors above …
… (remaining stubbed steps still ran — accumulate-don't-exit preserved) …
pre-commit: blocked. Nothing was committed.
HOOK EXIT=1
```

Note the hook passes `--tolerate-unreachable-registry` and blocked anyway: the flag governs only
the unreachable branch.

Restoration:

```
$ shasum -a 256 package.json package-lock.json          # AFTER restore
3990775ac851e27e6ea437bb119fa51cda1543533f4e9e18f362a7f080946afd  package.json
f2acbee334fa870d197337b4aba67d3da4aee292aa4e040892e17ef552389e86  package-lock.json
$ diff before.sha after.sha  →  IDENTICAL
$ git status --short package.json package-lock.json  →  (empty)
```

The vulnerable pin was never committed; this agent ran no state-changing git command.

### TEST-766 — the same drill fails CI

The exact command `ci.yml`'s new step runs, against the pinned tree:

```
$ node --import tsx scripts/check-audit.ts
audit:check ✗ moderate minimist@>=1.0.0 <1.2.3 — Prototype Pollution in minimist — https://github.com/advisories/GHSA-vh95-rmgr-6w4m
audit:check ✗ critical minimist@>=1.0.0 <1.2.6 — Prototype Pollution in minimist — https://github.com/advisories/GHSA-xvch-5gv4-984h
audit:check ✗ 1 vulnerable package(s), 2 advisory(ies). …
CI EXIT=1
```

**DEFERRED → orchestrator, on the batch PR**: the real-CI half (the step running on GitHub
Actions). Substitute evidence above is the byte-identical command line and its output locally, plus
the parsed workflow showing the step present and correctly positioned (TEST-770).

### TEST-767 — clean tree passes both gates

After restoring the pin, `metadata.vulnerabilities.total` is **0** — the number UI-016 established:

```
$ node --import tsx scripts/check-audit.ts                                   # CI form
audit:check ✓ npm audit reports 0 vulnerabilities, all severities
exit=0
$ node --import tsx scripts/check-audit.ts --tolerate-unreachable-registry   # pre-commit form
audit:check ✓ npm audit reports 0 vulnerabilities, all severities
exit=0
```

### TEST-768 — latency

Warm cache, this tree, `/usr/bin/time -p`:

| Run | Gate step (`check-audit.ts`) | Bare `npm audit --json` baseline |
| --- | ---------------------------- | -------------------------------- |
| 1   | 0.83 s                       | 0.65 s                           |
| 2   | 0.69 s                       | 0.55 s                           |
| 3   | 0.87 s                       | 0.68 s                           |
| 4   | 0.69 s                       | —                                |
| 5   | 0.82 s                       | —                                |

Median ≈ **0.82 s**; the delta over a bare audit (≈ 0.15–0.20 s) is `node --import tsx` startup.
Contract baseline was 620/779/656 ms and this is consistent with it. **Well under the ~5 s bar** —
nothing to raise, and the step stays in pre-commit as the user chose.

### TEST-769 — the hook's `step()` shape is preserved

The audit goes through `step()` exactly like the other five, and the drill output above shows the
remaining steps still ran after it failed — the accumulate-don't-exit behaviour is intact and the
epilogue (`pre-commit: blocked.`) still fires. Position is **first**, ahead of `build`, with a
comment giving the reason: it needs no build output, costs one registry round-trip, and a
dependency advisory is not something five minutes of compiling can change.

### TEST-770 / TEST-771 — CI step placement, and `validate` not renamed

Parsed from the YAML (`yaml` package), not eyeballed:

```
jobs: validate
 0 actions/checkout@v4      1 actions/setup-node@v4      2 npm ci
 3 version singularity
 4 npm audit (zero findings, any severity)      ← new, before build
 5 npm run build            6 package build + tarball audit   7 generated artifacts drift
 8 npm run lint             9 npm run format:check           10 npm run typecheck
11 unit tests …            12 e2e …                         13 merged coverage gate …
14 upload merged coverage
```

Job id and name are unchanged — the ruleset's required context is literally `validate` (C11); no
new job and no new required check were added. The step carries a comment recording the zero-total
policy, why there is no allowlist, and why the flag is absent here.

### TEST-772 — no allowlist mechanism exists anywhere

```
$ /usr/bin/grep -rn "allowlist\|allow-list\|ignore\|exception\|waiver\|--omit\|audit-level\|--force\|audit fix" \
    scripts/audit-report.ts scripts/check-audit.ts scripts/audit-report.test.ts \
    .githooks/pre-commit .github/workflows/ci.yml
scripts/audit-report.ts:4:  * … "zero vulnerabilities of **any** severity — no allowlist, no
scripts/audit-report.ts:8:  * 1. **The verdict is `metadata.vulnerabilities.total === 0`, not `--audit-level`.**
scripts/audit-report.ts:9:  *    `npm audit --audit-level=low` exits 0 on `info` findings …
scripts/audit-report.ts:10: *    … so a severity floor is a silent allowlist
scripts/audit-report.ts:11: *    … `--audit-level` is not
scripts/check-audit.ts:12:  * environment variable, no `CI` detection, and no allowlist anywhere in the path.
scripts/check-audit.ts:59:        "and there is no allowlist: upgrade, replace, or override the transitive dependency."
scripts/audit-report.test.ts:170: it("fails on an info-only finding — the severity floor `--audit-level=low` …")
.github/workflows/ci.yml:27:  # Not `--audit-level` — that tolerates the `info` bucket — but a
.github/workflows/ci.yml:29:  # There is no allowlist, no waiver file and no per-package skip, by user
```

Every hit is prose or a test **denying** the mechanism; none is executable exemption logic. No
`--audit-level` is ever passed, no per-package skip exists, no `.npmrc` was added:

```
$ /usr/bin/find . -name ".npmrc" -not -path "*/node_modules/*"   →  (no output)
$ /usr/bin/grep -c "process.env" scripts/check-audit.ts scripts/audit-report.ts   →  0, 0
```

### TEST-773 — `scripts/` convention followed, no coverage exemption

Pure module (`audit-report.ts`) + colocated `audit-report.test.ts` + thin runner
(`check-audit.ts`), matching `pack-audit.ts`/`check-pack.ts` and `versions.ts`/`check-versions.ts`.
`vitest.config.ts:21` already includes `scripts/**/*.test.ts`, so the 16 tests join `npm test` by
existing. **`scripts/coverage-config.ts` was not modified** — `COVERAGE_INCLUDE` never covered
`scripts/`, so there is nothing to exempt.

### TEST-774 — workspace coverage confirmed, not assumed

The two findings measured at contract time were `react-router` and `react-router-dom` — declared in
`apps/ui/package.json`, not the root — and they were reported by a **root-level** `npm audit`,
because npm resolves every workspace into the single root `package-lock.json` that `npm audit`
reads. The runner therefore spawns with `cwd: repoRoot`. Claim retired.

### Gates on the changed files

```
$ ./node_modules/.bin/tsc --noEmit -p scripts/tsconfig.json                 → OK
$ ./node_modules/.bin/eslint scripts/audit-report.ts scripts/check-audit.ts scripts/audit-report.test.ts → OK
$ npm run --silent format:check                                            → All matched files use Prettier code style!
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/audit-report.test.ts → 16 passed
```

Repo-wide `npm test` / `npm run coverage` deliberately not run here (contract's machine rules); the
orchestrator's harvest gate is the single repo-wide run.

### Housekeeping

No server started, no port bound; `8765` was never touched. Scratch confined to
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s020-infra/013-d4A5HE`. No `git` command that
changes state was run.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
