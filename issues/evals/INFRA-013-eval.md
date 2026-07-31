# Evaluation: INFRA-013

**Date**: 2026-07-31
**Sprint**: sprint-020 (TEST-759–774)
**Evaluator model**: Opus 5 (1M context) — `claude-opus-5[1m]`
**Verdict**: PASS

I drilled the gate **differently from the implementer** — a different vulnerable package
(`lodash@4.17.20`, five advisories, not the router), pinned into the **root** manifest rather than
`apps/ui`, driven through both invocation forms, with byte-identical restore proven by shasum.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                  |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | `issues/infra/013-npm-audit-gate.md:58-371`                                                              |
| Commands are specific and concrete      | PASS   | Exact invocations for both forms, both payload shapes, latency samples, the vulnerable-pin drill          |
| Real E2E (not mocked)                   | PASS   | The gate is a CLI check — the real E2E interface *is* the command line, and it is exercised as such       |
| Scenarios cover acceptance criteria     | PASS   | TEST-759–774 addressed; the real-CI half correctly marked `DEFERRED → orchestrator, on the batch PR`      |
| Application restarted after changes     | N/A    | No server; the scripts are invoked fresh each run                                                        |
| Actual model recorded (implemented on:) | PASS   | `**implemented on: opus** (Opus 5, 1M context)` at `:60`                                                  |
| Reproduction logged before fix (bugs)   | N/A    | New gate, not a bug fix. The pin-and-revert drill is the substitute and it is logged                      |

## Criteria Results — my own drill, from scratch

### Wiring, read from the artifacts

```
$ /usr/bin/grep -rn "audit" .githooks/ .github/workflows/
.githooks/pre-commit:30:step "npm audit"  node --import tsx scripts/check-audit.ts --tolerate-unreachable-registry
.github/workflows/ci.yml:35:  - name: npm audit (zero findings, any severity)
.github/workflows/ci.yml:36:    run: node --import tsx scripts/check-audit.ts
```

CI form = no flag (fail-closed). Pre-commit form = `--tolerate-unreachable-registry`. The
warn-and-proceed branch is selected by an **explicit flag the workflow never passes** — not by
sniffing `CI` (TEST-764). `/usr/bin/grep -n "process.env" scripts/check-audit.ts scripts/audit-report.ts`
returns **nothing**: there is no environment override at all.

| #   | Criterion                                         | Result | Observed                                                                                                                                                                   |
| --- | ------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | TEST-759 — total-zero, no severity floor          | PASS   | Clean tree: `audit:check ✓ npm audit reports 0 vulnerabilities, all severities`, exit 0. No `--audit-level` is used as a gate                                                 |
| 2   | TEST-760 — the failure names every advisory       | PASS   | Five advisories, one line each, with package, severity, affected range, title and GHSA URL — see transcript                                                                    |
| 3   | TEST-765 — vulnerable pin fails the pre-commit form | PASS  | Exit **1** with the same five named advisories                                                                                                                              |
| 4   | TEST-766 — vulnerable pin fails the CI form       | PASS   | Exit **1**, identical output. Real-CI half remains the orchestrator's (TEST-819/821)                                                                                          |
| 5   | TEST-761/762 — unreachable detected by payload    | PASS   | Dead registry: the pre-commit form exits **0** with an unmissable banner; the CI form exits **1**. Neither ever prints "clean" — the two paths are visibly different messages   |
| 6   | TEST-763 — pre-commit warns loudly, proceeds      | PASS   | Six-line banner, box-ruled, naming the ECONNREFUSED reason. Exit 0                                                                                                            |
| 7   | TEST-767 — clean tree passes both gates           | PASS   | Both exit 0, `total: 0`                                                                                                                                                       |
| 8   | TEST-771 — `validate` job not renamed             | PASS   | `.github/workflows/ci.yml:13` → `  validate:`                                                                                                                                |
| 9   | TEST-772 — **no allowlist mechanism**             | PASS   | See negative-evidence grep below                                                                                                                                             |
| 10  | TEST-774 — workspaces covered by the root audit   | PASS   | Proven live: my pin went into the **root** manifest and the root audit caught it; conversely the two contract-time findings were `apps/ui` deps found by the same root audit    |

### The drill, verbatim

```
$ /usr/bin/shasum -a 256 package.json package-lock.json          # BEFORE
3990775ac851e27e6ea437bb119fa51cda1543533f4e9e18f362a7f080946afd  package.json
f2acbee334fa870d197337b4aba67d3da4aee292aa4e040892e17ef552389e86  package-lock.json

# pin lodash 4.17.20 into root devDependencies, then:
$ npm install --package-lock-only --no-audit --no-fund
up to date in 740ms
lockfile lodash: "4.17.20"

########## CI FORM ##########
audit:check ✗ high     lodash@<4.17.21 — Command Injection in lodash — https://github.com/advisories/GHSA-35jh-r3h4-6jhm
audit:check ✗ moderate lodash@>=4.0.0 <4.17.21 — Regular Expression Denial of Service (ReDoS) in lodash — https://github.com/advisories/GHSA-29mw-wpgm-hmr9
audit:check ✗ high     lodash@>=4.0.0 <=4.17.23 — lodash vulnerable to Code Injection via `_.template` imports key names — https://github.com/advisories/GHSA-r5fr-rjxr-66jc
audit:check ✗ moderate lodash@<=4.17.23 — lodash vulnerable to Prototype Pollution via array path bypass in `_.unset` and `_.omit` — https://github.com/advisories/GHSA-f23m-r3pf-42rh
audit:check ✗ moderate lodash@>=4.0.0 <=4.17.22 — Lodash has Prototype Pollution Vulnerability in `_.unset` and `_.omit` functions — https://github.com/advisories/GHSA-xxjr-mmjv-4gpg
audit:check ✗ 1 vulnerable package(s), 5 advisory(ies). The gate is zero of any severity and there
              is no allowlist: upgrade, replace, or override the transitive dependency.
CI-form exit: 1

########## PRE-COMMIT FORM (--tolerate-unreachable-registry) ##########
[same five advisories, same summary]
precommit-form exit: 1

$ /usr/bin/shasum -a 256 package.json package-lock.json          # AFTER restore
3990775ac851e27e6ea437bb119fa51cda1543533f4e9e18f362a7f080946afd  package.json
f2acbee334fa870d197337b4aba67d3da4aee292aa4e040892e17ef552389e86  package-lock.json
```

**Byte-identical.** `git status --porcelain` afterwards shows only a pre-existing untracked handoff
file. No git command was used to restore — the backup was copied back.

Note both gate forms fail on findings; the flag only governs the *unreachable* case, which is
exactly the design the contract asked for.

### Offline — the case that matters most

```
$ npm_config_registry=http://127.0.0.1:9 node --import tsx scripts/check-audit.ts --tolerate-unreachable-registry
audit:check ⚠ ════════════════════════════════════════════════════════════════════════
audit:check ⚠   THE SUPPLY-CHAIN GATE DID NOT RUN.
audit:check ⚠   The npm registry did not answer: request to http://127.0.0.1:9/-/npm/v1/security/advisories/bulk failed, reason: connect ECONNREFUSED 127.0.0.1:9
audit:check ⚠   Your dependencies were NOT checked against any advisory database.
audit:check ⚠   Proceeding anyway — a network outage must not block a local commit.
audit:check ⚠   CI runs this same check fail-closed, so anything missed here fails there.
audit:check ⚠ ════════════════════════════════════════════════════════════════════════
exit: 0

$ npm_config_registry=http://127.0.0.1:9 node --import tsx scripts/check-audit.ts
audit:check ⚠   THE SUPPLY-CHAIN GATE DID NOT RUN.
audit:check ⚠   …
audit:check ⚠   Failing closed. This gate does not report success it did not measure.
exit: 1
```

"Failing closed. This gate does not report success it did not measure." — the discriminator is the
payload, never the exit code, exactly as C6 requires, and the unreachable path can never print
"clean".

### TEST-772 — the absence, proved

```
$ /usr/bin/grep -rniE "allowlist|allow-list|ignore|exception|waiver|--omit|audit-level|skip|except" \
    scripts/check-audit.ts scripts/audit-report.ts .githooks/pre-commit .github/workflows/ci.yml
scripts/check-audit.ts:12: * environment variable, no `CI` detection, and no allowlist anywhere in the path.
scripts/check-audit.ts:59:   "and there is no allowlist: upgrade, replace, or override the transitive dependency.\n",
scripts/audit-report.ts:4:  * The directive is "zero vulnerabilities of **any** severity — no allowlist, no
scripts/audit-report.ts:8-11: [why the verdict is total===0 and not --audit-level]
.github/workflows/ci.yml:27,29: [same policy, as comments]
```

Every hit is prose asserting the absence. **No mechanism exists**: no per-package skip, no waiver
file, no severity floor, no env override (`process.env` appears nowhere in either script), and
`ls .npmrc` → *No such file or directory*.

## Failures

None.

## Summary

10 of 10 independently-checked criteria pass, drilled with a package the implementer never used and
pinned in a manifest they never touched. The gate blocks on findings from both entry points and
names every advisory with its GHSA URL; it distinguishes an unreachable registry from a clean tree
by payload shape and refuses to report success it did not measure; the tolerate-branch is reachable
only via an explicit flag the CI workflow does not pass; there is no allowlist mechanism of any kind;
and the drill restored the tree byte-for-byte.
