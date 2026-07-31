# Evaluation: INFRA-014

**Date**: 2026-07-31
**Sprint**: sprint-020 (TEST-775–791)
**Evaluator model**: Opus 5 (1M context) — `claude-opus-5[1m]`
**Verdict**: PASS (with two halves structurally deferred to the live PR — see Deferred)

I read the workflow files myself and parsed their triggers and permissions directly, then ran the
packaging chain those workflows encode, end to end, and installed the result.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| Verification log present                | PASS   | `issues/infra/014-ci-package-publish.md:72-323`                                                        |
| Commands are specific and concrete      | PASS   | The build chain, the tag-guard drill, the scratch-prefix install, the `gh` flag verification            |
| Real E2E (not mocked)                   | PASS   | A real tarball really installed into a real scratch prefix; the workflow halves correctly marked        |
| Scenarios cover acceptance criteria     | PASS   | TEST-775–791 addressed; TEST-788's substitute evidence supplied **as** substitute, not as the real thing |
| Application restarted after changes     | N/A    | Workflow + packaging change; the packaged CLI *is* the restart, and it was run                          |
| Actual model recorded (implemented on:) | PASS   | `**implemented on: opus** (infra-dev, 2026-07-31)` at `:74`                                             |
| Reproduction logged before fix (bugs)   | N/A    | Not a bug                                                                                              |

## Criteria Results

### Trigger and permission semantics — parsed from the files, with my own eyes

| #   | Criterion                                        | Result | Observed                                                                                                                                                     |
| --- | ------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `package.yml` fires only on `pull_request`       | PASS   | `.github/workflows/package.yml:8-9` — `on:` / `  pull_request:` and **nothing else**. No `push`, no `workflow_dispatch`, no `schedule`                            |
| 2   | `release.yml` fires only on `v*` tags            | PASS   | `.github/workflows/release.yml:8-11` — `on: push: tags: - "v*"`. No branch trigger of any kind                                                                    |
| 3   | TEST-782 — **no npm publish anywhere in `.github/`** | PASS | `/usr/bin/grep -rn "npm publish\|NPM_TOKEN\|provenance\|id-token" .github/` → **one hit**, `release.yml:16`, and it is the comment recording the removal: *"`id-token: write` used to live here for npm provenance. It is gone with the publish step it existed for"*. No `npm publish`, no `NPM_TOKEN`, no `id-token` grant survives |
| 4   | TEST-780 — per-job, minimal permissions          | PASS   | `package.yml:25-27` → `contents: read` + `pull-requests: write`; `release.yml:28-29` → `contents: write`. **No workflow-level grant in either file** — `release.yml`'s former workflow-level block is replaced by a comment |
| 5   | TEST-784/C12 — `CI / validate` still runs on main | PASS  | `ci.yml:3-6` unchanged: `on: pull_request:` + `push: branches: [main]`. Packaging and release are structurally unreachable from a main push, because neither workflow declares a branch trigger |
| 6   | TEST-771 — `validate` job not renamed            | PASS   | `ci.yml:13` → `  validate:`                                                                                                                                   |
| 7   | TEST-779 — no third-party actions                | PASS   | `/usr/bin/grep -rn "uses:" .github/workflows/` → 8 hits, all `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`. The sticky comment uses `gh` on `github.token`, not a marketplace action |
| 8   | TEST-775 — artifact upload is fail-loud          | PASS   | `package.yml:94-101` — `if-no-files-found: error`, `retention-days: 14` with the reasoning in a comment, name `corpus-<version>-<sha_short>`                    |
| 9   | TEST-781 — `pack:check` failure precedes upload/comment | PASS | `pack:check` at `:46-49`; upload at `:94`; comment at `:113`. **Neither carries `if: always()`** — I checked; `/usr/bin/grep` for `always()` in the workflows returns nothing. The ordering guard is structural, and the comment at `:41-44` says so |
| 10  | TEST-776 — pack writes to `dist-package/`        | PASS   | `working-directory: dist-package` at `:56`, plus an explicit belt-and-braces assertion step at `:76-83` that fails if any `*.tgz` appears at the repo root. Confirmed locally: after my `npm pack`, `ls /Users/theophanerupin/code/corpus/*.tgz` → *no matches found* |
| 11  | TEST-778 — comment records version/sha/size/link | PASS   | `:127-144` — a table with Tarball, Version, Head commit, Size (KB **and** bytes), Download link, plus the note that downloading needs a signed-in GitHub user   |
| 12  | TEST-789 — release gated on validation           | PASS   | `release.yml` runs version guard → build → drift → lint → format → typecheck → tests → e2e → merged gate → `package:build` → `pack:check` → `npm pack` → release, as **ordered steps of one job**, so the release step is unreachable unless all of them pass |
| 13  | TEST-785 — `CLAUDE.md` carries the release rule  | PASS   | `CLAUDE.md:209`, numbered bullet 12 in Git Workflow: "**Releases are deliberate, never automatic**" with the version-bump + `v*` tag mechanism and the explicit "does **not** publish to npm" |

### TEST-783 — the tag guard, drilled

```
$ GITHUB_REF=refs/tags/v9.9.9 npm run version:check
version:check ✗ the release tag names 9.9.9 but the package is 0.0.0 — tag and manifest must agree
                before anything is published
Fix with: npm version <x.y.z> --workspaces --include-workspace-root --no-git-tag-version

$ GITHUB_REF=refs/tags/v0.0.0 npm run version:check
version:check ✓ every manifest is 0.0.0
```

### TEST-787 — the installable proof, run by me

The exact chain `package.yml` encodes:

```
$ npm run build                       → ok (vite ✓ built in 2.32s)
$ npm run package:build
package:build ✓ corpus@0.0.0 staged in dist-package/
  dist/corpus.js      391 kB
  server/main.js      489 kB
  ui/                 5 files
  assets/workspace/   11 files
  plugins/            todos
$ npm run pack:check
pack:check ✓ corpus@0.0.0 — 30 files, 0.85 MB packed / 2.94 MB unpacked

$ cd dist-package && npm pack --silent
corpus-0.0.0.tgz        (870.1K)
$ ls /Users/theophanerupin/code/corpus/*.tgz
(eval):1: no matches found          ← nothing written to the repo root

$ npm install -g --prefix "$SCRATCH/prefix" "$PWD/corpus-0.0.0.tgz"
added 52 packages in 3s
$ "$SCRATCH/prefix/bin/corpus" --version
0.0.0
$ "$SCRATCH/prefix/bin/corpus" --help
corpus — conversations around documents, driven by an agent.
Usage:
  corpus <command> [args] [flags]
  …
```

The installed tool resolves and runs. The scratch prefix was removed by captured path afterwards.

## Deferred — not failures, structurally impossible before the PR runs

These two are the orchestrator's, exactly as the sprint's Integration Points anticipated:

- **TEST-777 / TEST-819 — the sticky comment.** Whether `gh pr comment --edit-last
  --create-if-none` exists on the runner's `gh`, and whether two pushes produce **one** comment
  updated in place, can only be observed on the live PR. C13's fallback (`actions/github-script`, not
  a third-party action) is recorded should it fail.
- **TEST-820 / TEST-821 — the merge negative test.** That merging the PR creates no release and
  publishes nothing, and that the audit step is green on the merged `main`.

I record these as deferred rather than passed. Everything verifiable without a live PR is verified.

## Failures

None.

## Summary

13 of 13 locally-verifiable criteria pass, plus the full packaging chain executed end to end and the
resulting tarball installed into a scratch prefix where `corpus --version` prints `0.0.0`. The two
triggers are exactly as specified and mutually exclusive from a main push, permissions are per-job
and minimal with `id-token: write` gone, `npm publish` exists nowhere in `.github/`, no third-party
action was introduced, and the ordering that makes `pack:check` a real gate is structural rather than
incidental. Two halves — the sticky comment and the merge negative test — remain for PR babysitting
by construction.
