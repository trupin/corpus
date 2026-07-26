# [INFRA-008] npm packaging & release: the installable `corpus` tool

## Domain

infra

## Status

todo

## Priority

P1

## Model

opus — assembly of finished pieces; the packaging shape is already fixed by Architecture Decisions 1 and 6, leaving mechanical wiring with an unambiguous pass/fail test.

## Dependencies

- Depends on: CLI-002, UI-010
- Blocks: —

## Spec References

- CLAUDE.md — Architecture Decision 1 (tool/workspace split: the tool is installed via npm, `corpus` bin = server + CLI + pre-built UI served statically; `corpus init` creates the workspace), Decision 6 (npm-installed CLI for v1; self-contained binary is a later INFRA issue)
- SPEC.md §15 (Milestones and verification) — definition of done for v1: "README documents the operator loop (start server, start `claude`, `/orchestrate`) and the one-time `npm run setup-hooks`"
- SPEC.md §4 (Repository layout)

## Summary

Turn the monorepo into a thing a stranger can install. Today Corpus only runs from a clone: nothing is published, `apps/*` are all `private: true` with version `0.0.0`, there is no `README.md` at all, and the only GitHub Action is `CI / validate`. This issue produces a single published npm package that exposes the `corpus` bin, carries the server, and ships `apps/ui/dist` inside the tarball so the server can serve the board statically per Decision 1 — no separate UI install, no CDN, no build step on the user's machine. It adds a tag-triggered release workflow that builds everything and publishes with provenance, audits the tarball contents so no dev files or workspace data leak, unifies versioning across the repo, and writes the operator-facing README that SPEC.md §15 makes a condition of v1 being done. The acceptance test is deliberately brutal: install the tarball into a temp directory with no access to the repo and run the whole loop.

## Acceptance Criteria

- [ ] Exactly one package is published (the `corpus` tool). Its `package.json` declares `bin: { "corpus": ... }`, `files`, `engines.node: ">=22"`, `license`, `repository`, `description`, and `publishConfig.access: "public"`.
- [ ] `apps/ui/dist` (the Vite production build) is included in the published tarball, and the installed server serves it statically at the server root — verified by loading the board in a real browser from a tarball install.
- [ ] `@corpus/contract` and `@corpus/kit` are resolvable by the installed package — either bundled into the publish artifact or published as dependencies. Whichever is chosen, a clean-machine install must not require the monorepo. Record the choice and its rationale in the issue's design notes.
- [ ] `npm pack` contents are audited and asserted by a check that runs in CI: no `src/**/*.test.ts`, no `node_modules`, no `issues/`, `design/`, `.claude/`, `.githooks/`, no `data/` or `.corpus/` workspace directories, no `.env`.
- [ ] `.github/workflows/release.yml` triggers on a `v*` tag, runs the full validate gate, builds all workspaces, and publishes to npm with `--provenance` (`id-token: write` permission, `NODE_AUTH_TOKEN` from a repo secret).
- [ ] The release workflow refuses to publish if the tag version and the package version disagree.
- [ ] **Version singularity**: one version number describes the tool. A script (e.g. `npm run version:check`, wired into the release workflow and pre-push) verifies every workspace `package.json` version matches the root/published version.
- [ ] `README.md` exists at the repo root and documents (a) the operator loop: `npm install -g corpus`, `corpus init`, `corpus server start`, start `claude`, `/orchestrate`; and (b) contributor setup including the one-time `npm run setup-hooks`.
- [ ] A dry run proves the flow end to end: `npm pack` → install the tarball into a clean temp dir with no repo access → `corpus init` a scratch workspace → `corpus server start` → the UI loads in a browser → a document created via the CLI round-trips (visible on disk and via the CLI/UI).

## Technical Design

### Files to Create/Modify

- `apps/cli/package.json` — becomes the published package: drop `private`, set the public name, add `bin`, `files`, `engines`, `license`, `repository`, `description`, `publishConfig`, and dependencies on the server/contract/kit as chosen.
- `apps/cli/bin/corpus.js` — the published entry point (created as a stub in INFRA-007, real dispatcher from CLI-001/CLI-002); confirm the shebang and executable bit survive packing.
- `apps/server/src/**` — static-serving of the packaged UI assets, if CLI-002/UI-010 did not already land it. If it did, this issue only verifies it works from an installed tarball. Do **not** duplicate the implementation — coordinate rather than reimplement.
- `scripts/check-pack.ts` — runs `npm pack --dry-run --json`, asserts the file list against allow/deny rules, exits non-zero on violation.
- `scripts/check-versions.ts` — asserts version singularity across all workspace `package.json` files.
- `package.json` (root) — `prepack`/`release` helper scripts, `version:check`, `pack:check`.
- `.github/workflows/release.yml` — tag-triggered build + publish with provenance.
- `.github/workflows/ci.yml` — add the pack-contents and version-singularity checks to `validate`.
- `.githooks/pre-push` — add the version-singularity check (cheap; catches drift before it reaches a tag).
- `README.md` — **new file**; operator loop + contributor setup.
- `CLAUDE.md` — Build & Dev Commands: note the release commands if they are developer-facing.
- `.npmignore` — only if `files` proves insufficient; prefer an allow-list `files` field.

### Key Implementation Details

**One package, not five.** Decision 1 says the tool is "server + CLI + pre-built UI served statically". The cleanest shape is to publish `apps/cli` as the single package `corpus`, with the server code and the UI build shipped inside it. Two viable strategies:

1. **Bundle** — a build step (esbuild/tsup) that bundles the CLI + server into `dist/`, with `apps/ui/dist` copied in as static assets. Produces one self-contained tarball, no `@corpus/*` packages on the registry, and matches "one version" trivially. Preferred unless something makes it impractical.
2. **Publish the graph** — publish `@corpus/contract`, `@corpus/kit`, `@corpus/server` alongside and let `corpus` depend on them at pinned exact versions. More registry surface, more version coordination, but keeps the packages consumable by third parties.

Pick one, write the choice and the reason into this issue file before implementing, and be consistent. Do not half-do both.

**UI assets.** `apps/ui/dist` must exist at pack time — the `prepack`/release script must run the full build first, and the pack-contents check must assert `index.html` plus the hashed asset bundle are present. The server resolves its static root relative to its own module location (`import.meta.url`), never relative to `process.cwd()` — the CLI runs from the user's workspace, not from the install directory. This is the single most likely thing to break and be invisible until a real tarball install.

**Provenance publishing.** The workflow needs `permissions: { contents: read, id-token: write }`, `actions/setup-node` with `registry-url: https://registry.npmjs.org`, and `npm publish --provenance --access public` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`. Provenance requires the package to be published from a public repo via GitHub Actions — if that precondition doesn't hold at release time, fail loudly rather than silently dropping the flag.

**Version singularity.** Every workspace shares one version string. Bump with `npm version <x> --workspaces --include-workspace-root` (or a small script), tag `v<x>`, push the tag. `check-versions.ts` reads all workspace manifests and fails on any mismatch, including a mismatch with the `GITHUB_REF` tag when running in the release workflow.

**Pack audit.** `npm pack --dry-run --json` yields the exact file list. Assert positively (the bin, `dist/**`, the UI build, `README.md`, `LICENSE`) and negatively (tests, `issues/`, `.claude/`, `.githooks/`, `design/`, `data/`, `.corpus/`, `*.env`, source maps if undesired). A negative-only check silently passes when the tarball is empty — assert both directions.

**README.** Operator-first: what Corpus is in two sentences, install, `corpus init`, `corpus server start`, open the board, start `claude`, `/orchestrate`. Then a Contributing section: clone, `npm install`, `npm run setup-hooks`, `npm run build`, `npm test`, and the PR/squash-merge policy. It is a spec deliverable (§15), not decoration.

**License.** Corpus is open source; if no `LICENSE` file exists yet, this issue is where it arrives, and the `license` field must match it. Confirm the license choice with the user rather than guessing.

### Edge Cases

- **Publishing a `private: true` package** silently no-ops or errors depending on npm version — removing `private` from the published workspace is a required, easy-to-forget step.
- **Global install path resolution.** `npm install -g` puts the package outside the user's project; any `process.cwd()`-relative asset or config lookup breaks. Test from a directory that is not the workspace and not the install dir.
- **`corpus init` inside the tarball install must not touch the tool directory** — it writes only into the target workspace. Verify the install dir is unchanged after `init`.
- **Dependency vs. devDependency leakage.** `tsx`, `vitest`, `eslint`, `playwright` must never be runtime dependencies of the published package; a global install pulling Playwright would be an immediate red flag.
- **Node version floor.** `engines.node: ">=22"` should be enforced at startup with a clear error, not a cryptic syntax error from a newer language feature.
- **Re-running the release workflow on an existing tag** must fail cleanly (npm rejects republishing a version) rather than half-publishing.
- **Scoped vs. unscoped name.** If `corpus` is taken on the registry, fall back to a scoped name and update the README's install line — check availability early, before the workflow is written.
- **`.gitignore`d files are excluded from packs by default**, which is exactly how `dist/` gets dropped from a tarball. An explicit `files` allow-list overrides this — verify the UI build actually made it in rather than assuming.

## Testing Strategy

- **Unit (Vitest, `scripts/`):** `check-versions.ts` against fixture manifests (matching set passes; one drifted version fails). `check-pack.ts` against a captured `npm pack --dry-run --json` fixture (clean list passes; a list containing `issues/README` or a `.test.ts` fails).
- **Integration:** run `npm run pack:check` and `npm run version:check` in CI on every PR — the checks guard themselves.
- **Workflow syntax:** validate `release.yml` with `actionlint` (or at minimum a YAML parse) before pushing a tag; a broken release workflow is only discovered at the worst possible moment.
- No mock-based test can validate packaging — the real verification is the E2E plan below, and it is the primary evidence for this issue.

## E2E Verification Plan

### Reproduction Steps (bugs only)

Not a bug — packaging work with no prior behavior to reproduce.

### Verification Steps

Run all of this against the real tool, from a directory with no relationship to the repo.

1. In the repo: `npm ci && npm run build && npm run version:check && npm run pack:check` → all green.
2. `npm pack -w apps/cli` → note the tarball path; `tar -tzf <tarball>` and record the full file list. Confirm the UI build (`.../ui/dist/index.html` + assets), the bin, and `README.md` are present; confirm no tests, `issues/`, `.claude/`, or `.githooks/` are present.
3. `mkdir -p "$TMPDIR/corpus-pack-test" && cd "$TMPDIR/corpus-pack-test"` — a directory with no repo access. `npm init -y && npm install /abs/path/to/<tarball>` (or `npm install -g <tarball>`).
4. `npx corpus --version` (or the global `corpus --version`) → prints the expected version. This proves the bin, the shebang, and the exec bit.
5. `mkdir scratch && cd scratch && corpus init` → workspace scaffolded: `data/`, `.corpus/`, config, git repo, `.claude/` skills. `git -C . log --oneline` shows the initial commit. Confirm the install directory itself is untouched.
6. `corpus server start` → server comes up; note the URL and the bearer token from the init output/config.
7. Open the server URL in a real browser (Chrome) → the board renders from the packaged UI assets. Capture what is on screen and confirm zero 404s for JS/CSS in the network panel — a UI that loads `index.html` but 404s its bundle is the exact failure this step exists to catch.
8. Round-trip: create a document via the CLI (`corpus doc create ...` per CLI-002's surface), then confirm (a) the markdown file exists on disk under `data/` with valid frontmatter, (b) `corpus doc list`/`show` returns it, and (c) it appears in the browser UI without a manual refresh.
9. `corpus server stop`; confirm clean shutdown.
10. Cleanup: remove the temp directory; confirm nothing was written outside it.
11. Release workflow: push a prerelease tag (e.g. `v0.0.1-rc.1`) or run the workflow with `--dry-run` publishing enabled, and confirm the tag/version guard and the provenance step behave. Do not publish a real release without the user's go-ahead.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. Must be from real E2E testing — no mocks, no test clients. Real application, real requests, real interfaces. Include specific commands run, actual outputs observed, and pass/fail conclusions. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Reproduction (bugs only)

_[Agent fills: exact commands, observed output, confirmation bug exists]_

### Post-Implementation Verification

_[Agent fills: application restarted, exact commands, observed output, confirmation fix/feature works]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[INFRA-008]` prefix
