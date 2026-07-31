# [INFRA-014] CI packaging: tarball on every PR, releases on deliberate `v*` tags

## Domain
infra

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: — (INFRA-013 lands in the same batch; keep the workflow edits conflict-free)
- Blocks: —

## Spec References
- None product-behavioral — dev-harness/CI (user request 2026-07-31). Standing decision unchanged: NO npm publish, ever — distribution is repo-hosted artifacts.

## Summary
User directive: CI packages the CLI and publishes the artifact — on PRs, "attached"
to the PR; on main, as a new repository release.

Design:
- **Build step** (both triggers): `npm run build && npm run package:build && npm run
  pack:check`, then `npm pack` from `dist-package/` → the installable `corpus-<v>.tgz`.
  The tarball IS the artifact (it's what `npm install <file>` consumes). If the user
  wants a literal .zip alongside, it's one extra step — flag in the report, default
  to tgz-only.
- **PR trigger**: upload the tarball as a workflow artifact; maintain ONE sticky PR
  comment (create-or-update, not append) linking the artifact download + recording
  version, head sha, and size. Note artifact downloads require a logged-in GitHub
  user — acceptable, this is the repo's own workflow.
- **Releases are DELIBERATE, not per-merge** _(user amendment, 2026-07-31)_: no
  workflow runs on main pushes. A release happens only when the orchestrator judges
  a change significant (user-visible feature phases, notable milestones) or the user
  asks explicitly. Mechanism: the existing `v*` tag flow — the orchestrator bumps
  the version (`npm version <x.y.z> --workspaces --include-workspace-root`), tags,
  pushes the tag; this issue builds the tag-triggered workflow that packages
  (build → package:build → pack:check → npm pack) and creates the GitHub release
  with the tarball attached and generated notes since the previous tag.
  `version:check`'s GITHUB_REF guard already protects against tag/manifest mismatch.
- **CLAUDE.md**: add the release-decision rule to the Git Workflow section (one
  bullet: releases are orchestrator-judged or user-requested, via version bump +
  `v*` tag; never automatic).
- Permissions: workflow needs `contents: write` (releases) and `pull-requests: write`
  (sticky comment) — scope them per-job, not workflow-wide.
- Keep the packaging job parallel to validate, but gate release creation on validate
  success (a broken main merge must not publish an artifact).

## Acceptance Criteria
- [x] PR push: tarball artifact uploaded; sticky comment on the PR links it with version/sha/size; second push updates the same comment — implemented in `.github/workflows/package.yml`; **live proof DEFERRED → orchestrator on this batch's PR (TEST-819)**
- [x] Main merges create NO release and run NO packaging publish — structural via trigger blocks (`package.yml` is `pull_request`-only, `release.yml` is `v*`-tag-only); **observation on the merge DEFERRED → orchestrator (TEST-820)**
- [x] Pushing a `v*` tag runs package + pack:check and creates the release with the installable tarball attached; a tag mismatching the manifest version fails first (`version:check` guard exercised both directions, output in the log)
- [x] CLAUDE.md carries the release-decision rule (Git Workflow rule 12)
- [x] `pack:check` failure fails the job before any publish/comment — ordering is structural (no `if: always()`), and the gate's non-zero exit is proven in the log
- [x] Real `v*` tag release flow demonstrably unchanged — same trigger, same guard, same validate sequence; only the terminal step differs (`npm publish` → `gh release create`)
- [x] Installable proof in the log: `npm install -g --prefix <scratch>` of the packed tarball, `corpus --version` → `0.0.0`; the *download-the-PR-artifact* half is substitute evidence per TEST-788, **DEFERRED → orchestrator**

## Technical Design
### Files to Create/Modify
- `.github/workflows/` (new packaging workflow or jobs in the existing one), minor `scripts/` support if needed

## Testing Strategy
Workflow-level: exercised on the implementing PR itself (its own sticky comment + artifact is the live test); the main-trigger path verified on the merge.

## E2E Verification Plan
The implementing PR shows its own comment+artifact; post-merge, the first prerelease appears with an installable tarball.

## E2E Verification Log

**implemented on: opus** (infra-dev, 2026-07-31). Sprint contract: `issues/sprints/sprint-020.md`
(TEST-775 – TEST-791, premise corrections C10–C14, Orchestrator Adjudication 1).

### What changed

| File | Change |
| --- | --- |
| `.github/workflows/release.yml` | `publish` job **repurposed** into `release`. Trigger (`push: tags: v*`), `version:check` tag guard, and the full validate sequence are unchanged. Workflow-level `permissions` block deleted; job-level `contents: write` added. `id-token: write`, `registry-url`, `NODE_AUTH_TOKEN`/`NPM_TOKEN` and `npm publish --provenance --access public` **removed**. New terminal steps: `npm pack` (in `dist-package/`) → `gh release create <tag> <tarball> --generate-notes`. |
| `.github/workflows/package.yml` | **New.** `on: pull_request` only. One job `tarball`, `permissions: {contents: read, pull-requests: write}`: `npm ci` → `npm run build` → `package:build` → `pack:check` → `npm pack` (in `dist-package/`) → root-tarball assertion → `actions/upload-artifact@v4` → one sticky `gh pr comment --edit-last --create-if-none`. |
| `.github/workflows/ci.yml` | **Untouched.** The `validate` job keeps its name (C11: it is the sole required status check) and its `push: branches: [main]` trigger (C12). |
| `CLAUDE.md` | Git Workflow rule 12: releases are deliberate — orchestrator-judged or user-requested, via version bump + `v*` tag; never automatic. |
| `issues/shared/003-pr11-review-followups.md` | Finding 6 struck through and marked CLOSED by INFRA-014 (TEST-790). |

Adjudication 1 implemented as ruled: the publish capability is not disabled, it is **removed**. The
no-npm-publish decision is now structural — there is no token to withhold and no step to re-enable.

### TEST-782 / TEST-779 / TEST-780 — negative evidence (pasted)

```
$ /usr/bin/grep -rn "npm publish" .github/
$ echo $?
1
$ /usr/bin/grep -rn "NPM_TOKEN\|registry-url\|provenance" .github/
.github/workflows/release.yml:16:# `id-token: write` used to live here for npm provenance. It is gone with the
$ /usr/bin/grep -rn "id-token" .github/
.github/workflows/release.yml:16:# `id-token: write` used to live here for npm provenance. It is gone with the
```

The only surviving hits are the explanatory comment recording *why* the grant is gone. Root
`package.json`'s `publish:dry-run` is out of scope and stays (TEST-782).

```
$ /usr/bin/grep -rn "uses:" .github/workflows/
.github/workflows/release.yml:31:      - uses: actions/checkout@v4
.github/workflows/release.yml:32:      - uses: actions/setup-node@v4
.github/workflows/ci.yml:16:      - uses: actions/checkout@v4
.github/workflows/ci.yml:17:      - uses: actions/setup-node@v4
.github/workflows/ci.yml:61:        uses: actions/upload-artifact@v4
.github/workflows/package.yml:29:      - uses: actions/checkout@v4
.github/workflows/package.yml:30:      - uses: actions/setup-node@v4
.github/workflows/package.yml:96:        uses: actions/upload-artifact@v4
```

First-party `actions/*` only — no marketplace action introduced (TEST-779). The sticky comment is
`gh` on the run's own `GITHUB_TOKEN`; `--edit-last --create-if-none` confirmed present in the local
`gh 2.83.2` (`gh pr comment --help`), and `ubuntu-latest` ships ≥ that version, so the
`actions/github-script` fallback was not needed.

```
$ /usr/bin/grep -rn -A3 "permissions:" .github/workflows/
.github/workflows/release.yml:28:    permissions:
.github/workflows/release.yml-29-      contents: write
.github/workflows/package.yml:25:    permissions:
.github/workflows/package.yml-26-      contents: read
.github/workflows/package.yml-27-      pull-requests: write
```

Both grants are job-level; no workflow-level blanket grant survives anywhere (TEST-780).

### TEST-784 — triggers make "no packaging or release on main" structural

```
$ /usr/bin/grep -n -A4 "^on:" .github/workflows/*.yml
ci.yml:3:on:
ci.yml-4-  pull_request:
ci.yml-5-  push:
ci.yml-6-    branches: [main]
package.yml:8:on:
package.yml-9-  pull_request:
release.yml:8:on:
release.yml-9-  push:
release.yml-10-    tags:
release.yml-11-      - "v*"
```

`CI / validate` still runs on `main` pushes (unchanged, as C12 requires). Packaging is
`pull_request`-only; release is `v*`-tag-only. No workflow in the repository can package or release
on a main push. The live negative test is the merge of this batch's PR — **DEFERRED → orchestrator
(TEST-820)**.

### TEST-783 — the tag guard, exercised both directions

```
$ GITHUB_REF=refs/tags/v9.9.9 npm run version:check
version:check ✗ the release tag names 9.9.9 but the package is 0.0.0 — tag and manifest must agree before anything is published
Fix with: npm version <x.y.z> --workspaces --include-workspace-root --no-git-tag-version
exit=1

$ GITHUB_REF=refs/tags/v0.0.0 npm run version:check
version:check ✓ every manifest is 0.0.0
exit=0
```

Intact and unweakened; it remains the release job's first step, before any build.

### TEST-781 — `pack:check` failure stops the job before upload or comment

Ordering is structural: `pack:check` is a step above `upload-artifact` and the comment step, and
**no step in `package.yml` carries `if: always()`**. Proven that the gate actually exits non-zero by
breaking the staged package:

```
$ mv dist-package/ui/index.html <scratch>/index.html.bak
$ npm run pack:check
pack:check ✗ missing the board's entry document, `resolveUiDistDir`: expected at least 1 match of "ui/index.html", found 0
pack:check: 1 violation(s) in corpus@0.0.0
$ (npm run pack:check >/dev/null 2>&1); echo $?
1
$ mv <scratch>/index.html.bak dist-package/ui/index.html   # restored
$ npm run pack:check
pack:check ✓ corpus@0.0.0 — 30 files, 0.84 MB packed / 2.92 MB unpacked
```

**Stale-comment handling:** a failed run leaves the previous run's comment in place (the alternative
— an `if: always()` comment step — would be a comment that outlives the check it reports). That
comment names the head sha it was built from, so a stale one is identifiable at a glance: its sha is
not the PR's head. This is documented in the workflow next to the step.

### TEST-775 / TEST-776 / TEST-777 / TEST-778 — the artifact and the comment

- Artifact name `corpus-<version>-<short sha>` (`steps.pack.outputs.sha_short`), so two runs on one
  PR are distinguishable. `if-no-files-found: error` — a packaging job that uploads nothing fails.
  `retention-days: 14`, justified in a comment (outlives a review cycle and a re-review after a
  force-push; the repository default of 90 is storage spent on tarballs nobody downloads).
- `npm pack` runs with `working-directory: dist-package` and writes there. A dedicated step then
  fails the job if any `*.tgz` appears at the repository root — necessary because `.gitignore:32`
  (`/*.tgz`) would otherwise hide it from `git status` (C14). The stray root `corpus-0.0.0.tgz` that
  the contract observed is gone from the tree as of this session; `git status --porcelain` shows no
  tarball at the root.
- Sticky comment: `gh pr comment "$PR" --edit-last --create-if-none --body-file comment.md` — a
  create-or-update of a single comment, never an append. The body was rendered locally with the exact
  heredoc from the workflow and dummy values:

```
### 📦 Packaged CLI

| | |
| --- | --- |
| Tarball | `corpus-0.0.0.tgz` |
| Version | `0.0.0` |
| Head commit | `abc1234def5678` |
| Size | 802 KB (821975 bytes) |
| Download | [corpus-0.0.0.tgz](https://example/artifact) |

Install it with `npm install -g <path-to-tgz>`. Downloading a workflow
artifact requires being signed in to GitHub.

<sub>Built by [this run](https://example/run) after `pack:check` passed. Updated in
place on every push — this comment always describes the head commit named above.</sub>
```

Version, head sha, size (KB and bytes) and the artifact download link (`upload-artifact@v4`'s
`artifact-url` output) are all present, and the sign-in requirement is stated rather than glossed
(TEST-778). **Live proof that exactly one comment appears and is edited in place across two pushes
is DEFERRED → orchestrator, on this batch's PR (TEST-819).**

### TEST-789 — how the release is gated

The release job is a single job of ordered steps: `version:check` → build → drift → lint → format →
typecheck → unit → e2e → merged coverage gate → `package:build` → `pack:check` → `npm pack` →
`gh release create`. A failure anywhere aborts before the release exists — the strongest form of
"gated on validation", and it needs no `needs:` edge or duplicated setup. On the PR trigger, the
packaging job is a separate workflow and therefore runs in parallel with `CI / validate`, as the
issue asked. It is deliberately **not** a required status check (C11: `validate` is the only
required context and must not be renamed or joined); that is why its failure has to be loud, and why
the sticky comment carries the report.

### TEST-787 / TEST-788 — the installable proof (local tarball, marked as substitute)

Acted out the workflow's own step sequence with real commands, then installed the result.

```
$ npm run build                       # ok (contract → kit → plugins → cli → server + ui)
$ npm run package:build
package:build ✓ corpus@0.0.0 staged in dist-package/
  dist/corpus.js      391 kB
  server/main.js      489 kB
  ui/                 5 files
  assets/workspace/   11 files
  plugins/            todos
  dependencies        @hono/node-server, @hono/zod-openapi, better-sqlite3, chokidar,
                      diff-match-patch, hono, openapi-fetch, yaml, zod
$ npm run pack:check
pack:check ✓ corpus@0.0.0 — 30 files, 0.84 MB packed / 2.92 MB unpacked

$ cd dist-package && tarball=$(npm pack --silent)
$ echo "$tarball"; stat -f%z "$tarball"
corpus-0.0.0.tgz
885232
$ ls /Users/theophanerupin/code/corpus/*.tgz
zsh: no matches found          # nothing written to the repository root

$ npm install -g --prefix "$SCRATCH/prefix" "$SCRATCH/corpus-0.0.0.tgz"
added 52 packages in 2s
$ ls -l "$SCRATCH/prefix/bin"
corpus -> ../lib/node_modules/corpus/dist/corpus.js

$ "$SCRATCH/prefix/bin/corpus" --version
0.0.0
$ "$SCRATCH/prefix/bin/corpus" --help
corpus — conversations around documents, driven by an agent.

Usage:
  corpus <command> [args] [flags]
  corpus <topic> <verb> [args] [flags]

Commands:
  health  Check that this workspace's server is up and answering.
  init    Create a Corpus workspace here (document tree, config, git repository, agent skills).
  search  Find where something is said in the corpus, without reading the corpus.
...
```

The install went into a scratch prefix under `…/tmp/s020-infra/infra-014-Pt0HKp/prefix`, never the
machine's global prefix, and the prefix was removed by captured path at the end of the session. The
bin symlink resolving to `dist/corpus.js` is the one-level-below-package-root invariant holding in a
real install (a bundle at `dist/bin/corpus.js` would break every packaged-asset resolver).

Per TEST-788 this is **substitute evidence**: the tarball is the one this machine packed, not one
downloaded from a workflow run. **The download half is DEFERRED → orchestrator, on the batch PR
(TEST-819).**

### TEST-786 — tgz only

Shipped tgz-only, deliberately. The `.tgz` *is* the installable artifact (`npm install -g <file>`
consumes it directly); a `.zip` alongside would be a second copy of the same bytes in a format
nothing in the install path reads. One extra step if the user wants it — flagged in the report, not
taken silently.

### TEST-791 — diff scope

`.github/workflows/release.yml`, `.github/workflows/package.yml` (new), `CLAUDE.md`, this issue file,
and `issues/shared/003-pr11-review-followups.md` (finding 6 struck, required by TEST-790). No
`scripts/` module was needed — the pack/comment logic is a dozen lines of shell in the workflow and a
module would have added an untested indirection. No `package.json`, no `package-lock.json`, no
`.gitignore`, no `scripts/coverage-config.ts` change.

### Checks

`npx prettier --check .github/workflows/*.yml CLAUDE.md` → clean (Prettier's YAML parser doubles as
the syntax check; `issues/` is prettier-ignored). The diff is YAML and markdown only — it adds no
TypeScript, so `eslint`/`tsc` surface is unchanged; the repo-wide gate is the orchestrator's at
harvest, and the tree was mid-React-upgrade (another agent's `package.json`/lock edits) throughout
this session.

### Machine hygiene

No long-running process was started (no server, no dev server, no Playwright); ports `8765`, `8809`
and `5173` were never bound. Scratch: `…/tmp/s020-infra/infra-014-Pt0HKp`, removed by captured path.

## Completion Checklist (domain agent)
- [x] Tests written and passing — n/a as unit tests (the diff is workflow YAML + markdown, no TypeScript); the workflows were exercised by acting their steps out with the real commands, and `pack:check`'s failure path was proven by breaking the staged package
- [x] `/lint` passes — Prettier clean on every touched non-ignored file; no ESLint/tsc surface added
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified (two halves DEFERRED to the batch PR, marked as such)

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
