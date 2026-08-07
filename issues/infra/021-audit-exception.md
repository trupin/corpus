# [INFRA-021] npm audit gate: a narrow, expiring, loud exception for GHSA-5p4m-2wfm-xmqj

## Domain

infra

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: INFRA-013
- Blocks: —

## Spec References

- None product-behavioral — dev harness. Amends the INFRA-013 policy ("zero
  vulnerabilities of any severity — no allowlist, no severity floor") by explicit
  user decision, 2026-08-06.

## Summary

A new advisory, **GHSA-5p4m-2wfm-xmqj** (js-yaml ≤ 4.3.0, **high**, quadratic CPU
consumption in `!!omap` resolution, CVE-2026-59870 not backported), fails the
`npm audit` gate and therefore blocks every commit and every PR. The path is
`packages/contract` (devDependency) → `openapi-typescript` → `@redocly/openapi-core`
→ `js-yaml`, and it is unfixable from here: `openapi-typescript@7.13.0` is the
latest published version, `@redocly/openapi-core` pins `js-yaml: "4.3.0"`
**exactly**, and scoped overrides, global overrides, forced lock re-resolution and
a from-scratch lockfile regeneration all left js-yaml at 4.3.0 with zero churn and
no npm warning. Replacing `openapi-typescript` is its own project.

The user was offered three options and **chose option 1**: ship with a documented,
time-boxed exception. This issue implements that exception so that it is **narrow**
(keyed on the advisory id _and_ the dependency route), **expiring** (hard date,
fails closed after it), **loud** (printed on every run; "clean" and "clean apart
from a tolerated exception" are different verdicts), and **justified in place**
(the reasoning lives next to the rule, in `scripts/audit-report.ts`).

This is a policy amendment, not a config tweak. The docblocks of
`scripts/check-audit.ts` and `scripts/audit-report.ts` previously said "no
allowlist anywhere in the path" / "no allowlist, no severity floor". They are
rewritten to _argue_ the amendment — a reader in six months finds the reasoning
where the rule is, not in a commit message.

### The user's decision (2026-08-06)

Three options were offered:

1. **Ship with a documented, time-boxed exception.** — **CHOSEN.**
2. Hold the release until the fix propagates through Redocly and
   `openapi-typescript`. **Rejected**: the fix is not in our hands. Redocly must
   cut a release that moves an exact pin, then `openapi-typescript` must pick it
   up. Blocking all development on a third party's release cadence, for a
   build-time-only DoS advisory, is disproportionate.
3. Replace `openapi-typescript` with a different OpenAPI→TS generator.
   **Rejected**: that changes the generated client consumed by both the UI and the
   CLI (Architecture Decision 3, contract-first), so it is a contract-domain
   project with its own drift risk — not a supply-chain hotfix.

Also rejected, explicitly and permanently: a severity floor (`--audit-level`), an
environment variable, `CI` detection, and any package-name or severity allowlist.
Each of those would tolerate the _next_ advisory as well. This exception cannot.

### What happens at expiry (2026-10-01)

On 2026-10-01 the gate starts failing again and says so in those words — it
reports an **expired exception**, not a new advisory, so nobody re-diagnoses a
known problem. At that point exactly one of:

- `openapi-typescript` (or `@redocly/openapi-core`) has shipped a js-yaml ≥ 4.3.1
  → upgrade, delete the exception, delete its tests.
- It has not → re-examine from scratch and either write a **new** exception with a
  fresh justification and a fresh date, or take option 3. Bumping the date on the
  existing record without re-arguing it is the failure mode this design exists to
  prevent, and is called out in the code comment.

## Acceptance Criteria

- [x] `node --import tsx scripts/check-audit.ts --tolerate-unreachable-registry`
      exits 0 with the exception in place, and prints it
- [x] The exception is keyed on the GHSA id **and** the dependency route; a
      different advisory on `js-yaml` still fails
- [x] The same advisory reached by a different route still fails
- [x] The route is verified against `package-lock.json` at run time, including that
      every hop is `dev: true` — so the tool moving into the shipped runtime tree
      invalidates the exception automatically
- [x] The exception has a hard expiry date; after it the gate fails **closed** and
      the message says the exception expired
- [x] A tolerated finding is printed on every run, with what/why/when-it-expires
- [x] The success line for "clean" is textually distinct from "clean apart from a
      tolerated exception"
- [x] No severity floor, no environment variable, no `CI` detection, no blanket
      ignore introduced
- [x] Both docblocks argue the amendment rather than merely stopping contradicting it
- [x] Every new behaviour has a test that fails without the change

## Technical Design

### Files to Create/Modify

- `scripts/audit-report.ts` — the exception record (`AUDIT_EXCEPTIONS`), the
  matching rules, lockfile route resolution, expiry, and the rewritten docblock
- `scripts/check-audit.ts` — reads `package-lock.json`, passes it and `now` in;
  prints tolerated / expired exceptions; rewritten docblock
- `scripts/audit-report.test.ts` — recorded payloads and the new cases

### Key Implementation Details

**The record.** `AUDIT_EXCEPTIONS` is a frozen array of `AuditException`:
advisory id, vulnerable package, the full `route` (workspace path first, leaf
last), `expires`, `reason`, and `invalidatedBy`. The record carries its own
justification as data, not as a comment that can drift away from it.

**Narrow, in three independent conjuncts.** An exception applies to a finding only
when all hold:

1. the finding's advisory URL contains the exception's GHSA id, and the package
   name matches — so a _different_ advisory on js-yaml matches nothing;
2. `package-lock.json` says the excepted package is reachable by **exactly** the
   declared route and no other — so the same advisory arriving another way matches
   nothing;
3. every `node_modules` hop of that route is `dev: true` in the lockfile — so the
   moment `openapi-typescript` (or js-yaml) enters the production tree, the
   exception evaporates on its own.

Route resolution is declaration-based reverse traversal of the lockfile's
`packages` map (who _declares_ a dependency on X, transitively up to a workspace
or root manifest). Over-approximating (two physical copies ⇒ two routes) fails
closed, which is the correct direction.

**Carriers.** npm reports `@redocly/openapi-core` as vulnerable too, with no
advisory of its own (`via: ["js-yaml"]`). Such a transitive-only finding is
tolerated only when its package is an interior node of the excepted route _and_
every parent in its `via` list is on that route. A carrier that becomes vulnerable
via anything else fails.

**Expiring.** `expires` is an ISO date; the exception is invalid from
`00:00:00Z` on that day. An expired exception is not silently dropped — it lands
in its own `expired` bucket so the runner can say "the exception expired on …",
never "new advisory".

**Loud.** `AuditVerdict` grows a fourth kind, `tolerated`, distinct from `clean`.
Both `tolerated` and `findings` carry the tolerated list, so a run that is failing
for another reason still prints what it is carrying. The tolerated block goes to
stderr with a ⚠ marker and states the advisory, the route, why it is tolerated,
what invalidates it, and the days remaining.

**Fail closed everywhere.** Unreadable/unparseable lockfile ⇒ routes cannot be
verified ⇒ nothing is tolerated. Route mismatch ⇒ not tolerated. Non-dev hop ⇒ not
tolerated. Expired ⇒ not tolerated. There is no input that turns a finding into
`clean`.

### Edge Cases

- Exception present but the advisory has gone away (upgrade landed): verdict is
  plain `clean`; the record is inert and the tests still pin its shape.
- Registry unreachable: unchanged — exceptions are never consulted, because there
  is no report to apply them to.
- Both a tolerated and an untolerated finding: verdict `findings`, exit 1, and the
  tolerated one is still printed.

## Testing Strategy

`scripts/audit-report.test.ts`, extended with the **recorded** `npm audit --json`
payload for this advisory (captured from this repo, npm 11.6.2) and a trimmed but
real `package-lock.json` fixture. Cases, each of which fails without the change:

- exact advisory + exact route ⇒ tolerated, and the carrier is tolerated with it
- a different GHSA id on `js-yaml` ⇒ findings
- the same GHSA id with the lockfile showing another route (or an extra one) ⇒ findings
- a route hop that is not `dev: true` ⇒ findings
- a carrier vulnerable via something off-route ⇒ findings
- `now` past `expires` ⇒ findings, reported through the `expired` bucket
- unreadable lockfile ⇒ findings
- `tolerated` is a different verdict kind from `clean`
- the shipped `AUDIT_EXCEPTIONS` record itself: one entry, this GHSA, non-empty
  reason and invalidation conditions, expiry in ISO form

## E2E Verification Plan

Run the real gate script against the real tree, both callers' forms, before and
after; then run the real hook step.

### Reproduction Steps (bugs only)

1. `npm audit --json` at the repo root
2. `node --import tsx scripts/check-audit.ts --tolerate-unreachable-registry`
3. Expected (post-fix): exit 0, exception printed
4. Actual (pre-fix): exit 1, two findings

### Verification Steps

1. `node --import tsx scripts/check-audit.ts --tolerate-unreachable-registry` ⇒ 0
2. `node --import tsx scripts/check-audit.ts` (CI form) ⇒ 0
3. Simulate expiry by clock, confirm exit 1 and the "expired" wording
4. `VITEST_MAX_THREADS=4 npx vitest run scripts`

## E2E Verification Log

_implemented on: opus_

### Reproduction (bugs only)

`npm audit --json` at the repo root (npm 11.6.2, 2026-08-06) reports
`metadata.vulnerabilities.total: 2`, both **high**:

```
js-yaml 4.3.0        via GHSA-5p4m-2wfm-xmqj, range >=4.0.0 <4.3.1
@redocly/openapi-core 1.34.18   via ["js-yaml"] (no advisory of its own)
```

Pre-fix gate run:

```
$ node --import tsx scripts/check-audit.ts --tolerate-unreachable-registry
audit:check ✗ high     @redocly/openapi-core@<=0.0.0-snapshot.1782825774 || 1.34.8 - 1.34.18 — vulnerable via js-yaml
audit:check ✗ high     js-yaml@>=4.0.0 <4.3.1 — JS-YAML: Quadratic CPU consumption in !!omap resolution … — https://github.com/advisories/GHSA-5p4m-2wfm-xmqj
audit:check ✗ 2 vulnerable package(s), 2 advisory(ies). …
exit 1
```

Route confirmed from `package-lock.json` (declaration scan): `js-yaml` is declared
only by `node_modules/@redocly/openapi-core`; `@redocly/openapi-core` only by
`node_modules/openapi-typescript`; `openapi-typescript` only by
`packages/contract` **devDependencies**. All three lock entries carry `dev: true`.

### Post-Implementation Verification

```
$ node --import tsx scripts/check-audit.ts --tolerate-unreachable-registry
audit:check ⚠ ════════════════════════════════════════════════════════════════════════
audit:check ⚠   THIS GATE IS CARRYING 1 DOCUMENTED EXCEPTION. IT IS NOT CLEAN.
audit:check ⚠ ────────────────────────────────────────────────────────────────────────
audit:check ⚠   GHSA-5p4m-2wfm-xmqj — expires 2026-10-01 (55 day(s) left)
audit:check ⚠     high     @redocly/openapi-core@<=0.0.0-snapshot.1782825774 || 1.34.8 - 1.34.18 — vulnerable via js-yaml
audit:check ⚠     high     js-yaml@>=4.0.0 <4.3.1 — JS-YAML: Quadratic CPU consumption in !!omap resolution (3.x and 4.x) — CVE-2026-59870 fix not backported — https://github.com/advisories/GHSA-5p4m-2wfm-xmqj
audit:check ⚠     route    packages/contract (devDependency) → openapi-typescript → @redocly/openapi-core → js-yaml
audit:check ⚠     why      Build-time only, and not shipped. `openapi-typescript` is a
audit:check ⚠              devDependency of packages/contract, run once by the
audit:check ⚠              client-generation step; `package:build` leaves third-party
audit:check ⚠              dependencies external … (13 wrapped lines, printed in full)
audit:check ⚠     void if  openapi-typescript (or @redocly/openapi-core) enters the
audit:check ⚠              runtime dependency tree — checked automatically: every hop
audit:check ⚠              of the route must be `dev: true` in package-lock.json
audit:check ⚠     void if  js-yaml becomes reachable by any other route — checked
audit:check ⚠              automatically against the lockfile
audit:check ⚠     void if  a different advisory is filed against js-yaml — this
audit:check ⚠              exception names one GHSA id only
audit:check ⚠     void if  the generated client stops being produced by
audit:check ⚠              openapi-typescript, in which case delete this entry rather
audit:check ⚠              than re-point it
audit:check ⚠ ════════════════════════════════════════════════════════════════════════
audit:check ✓ npm audit: 0 untolerated vulnerabilities — but 2 finding(s) are tolerated by 1 documented exception above. This is NOT a clean tree.
EXIT=0
```

CI form (`node --import tsx scripts/check-audit.ts`, no flag) — byte-identical
output, `EXIT=0`. The warning block goes to stderr, so it is visible in the CI log;
only the final line is stdout.

**Fail-closed drills, run against the real script and the real
`package-lock.json`.** Each temporarily mutates one field of the shipped
`AUDIT_EXCEPTIONS` record, runs the real gate, then restores the file (verified by
`cmp` against a backup afterwards — no injection point was added to production
code for this).

1. _Route changed_ (`openapi-typescript` → `some-other-tool` in `route`): the
   lockfile disagrees, nothing is tolerated, both findings print as ordinary
   failures. `EXIT=1`.
2. _Different GHSA id_ in the record: leaf not covered, and the carrier
   `@redocly/openapi-core` is not covered either (a carrier rides on its leaf).
   Both print as ordinary failures. `EXIT=1`.
3. _Expired_ (`expires: "2026-07-07"`):

```
audit:check ✗ THE DOCUMENTED EXCEPTION FOR GHSA-5p4m-2wfm-xmqj EXPIRED ON 2026-07-07 (30 day(s) ago).
audit:check ✗   This is the advisory the gate was knowingly carrying — not a new one.
audit:check ✗   high     @redocly/openapi-core@… — vulnerable via js-yaml
audit:check ✗   high     js-yaml@>=4.0.0 <4.3.1 — JS-YAML: Quadratic CPU consumption …
audit:check ✗   Fix it, or write a NEW exception with a fresh justification and a fresh date.
audit:check ✗   Do not just move the date: re-argue it in scripts/audit-report.ts or delete it.
EXIT=1
```

**Mutation testing of the new logic** (patch implementation, run tests, restore).
Every guard is load-bearing — each mutation is caught:

| Mutation                                          | Tests failed |
| ------------------------------------------------- | ------------ |
| route check bypassed (route assumed to hold)      | 2            |
| expiry never enforced (`live = true`)             | 4            |
| GHSA id not matched in `coversLeaf`               | 1            |
| `everyHopIsDevOnly` bypassed                      | 1            |
| carrier tolerated without its leaf being covered  | 1            |
| `declaredDev` ignored (prod declaration accepted) | 1            |

Suites: `VITEST_MAX_THREADS=4 npx vitest run scripts` → **362 passed, 0 failed**
(36 in `audit-report.test.ts`, 20 of them new). `npx eslint` → 0;
`npx prettier --check` → clean; `npx tsc --noEmit -p scripts/tsconfig.json` → 0.

No environment variable, no `CI` detection, no severity floor and no blanket
ignore was introduced — `grep -nE "process\.env|audit-level"` over both scripts
returns only the docblock prose explaining why those are forbidden.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier on touched files)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: policy amendment argued in place, no other relaxation
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (security-sensitive — supply-chain gate policy change)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
