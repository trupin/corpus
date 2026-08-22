# [INFRA-008] npm packaging & release: the installable `corpus` tool

## Domain

infra

## Status

done

## Priority

P1

## Model

opus — assembly of finished pieces; the packaging shape is already fixed by Architecture Decisions 1 and 6, leaving mechanical wiring with an unambiguous pass/fail test.

## Dependencies

- Depends on: CLI-002, UI-010
- Blocks: —

## Spec References

- CLAUDE.md — Architecture Decision 1 (tool/workspace split: the tool is installed via npm, `corpus` bin = server + CLI + pre-built UI served statically; `corpus init` creates the workspace), Decision 6 (npm-installed CLI for v1; self-contained binary is a later INFRA issue)
- SPEC.md §12 (Milestones and verification) — definition of done for v1: "README documents the operator loop (start server, start `claude`, `/orchestrate`) and the one-time `npm run setup-hooks`"
- SPEC.md §4 (Repository layout)

## Summary

Turn the monorepo into a thing a stranger can install. Today Corpus only runs from a clone: nothing is published, `apps/*` are all `private: true` with version `0.0.0`, there is no `README.md` at all, and the only GitHub Action is `CI / validate`. This issue produces a single published npm package that exposes the `corpus` bin, carries the server, and ships `apps/ui/dist` inside the tarball so the server can serve the board statically per Decision 1 — no separate UI install, no CDN, no build step on the user's machine. It adds a tag-triggered release workflow that builds everything and publishes with provenance, audits the tarball contents so no dev files or workspace data leak, unifies versioning across the repo, and writes the operator-facing README that SPEC.md §12 makes a condition of v1 being done. The acceptance test is deliberately brutal: install the tarball into a temp directory with no access to the repo and run the whole loop.

## Acceptance Criteria

- [x] Exactly one package is published (the `corpus` tool). Its `package.json` declares `bin: { "corpus": ... }`, `files`, `engines.node: ">=22"`, `license`, `repository`, `description`, and `publishConfig.access: "public"`. _(Generated into `dist-package/`; every workspace manifest stays `private: true`. Name is PROVISIONAL — Adjudication 9.)_
- [x] `apps/ui/dist` (the Vite production build) is included in the published tarball, and the installed server serves it statically at the server root — verified by loading the board in a real browser from a tarball install.
- [x] `@corpus/contract` and `@corpus/kit` are resolvable by the installed package — either bundled into the publish artifact or published as dependencies. Whichever is chosen, a clean-machine install must not require the monorepo. Record the choice and its rationale in the issue's design notes. _(Bundled: every `@corpus/*` import is inlined by esbuild. `@corpus/kit` is consumed only by the UI and is already inlined into `ui/assets/*.js` by Vite. See Design Notes.)_
- [x] `npm pack` contents are audited and asserted by a check that runs in CI: no `src/**/*.test.ts`, no `node_modules`, no `issues/`, `design/`, `.claude/`, `.githooks/`, no `data/` or `.corpus/` workspace directories, no `.env`.
- [x] `.github/workflows/release.yml` triggers on a `v*` tag, runs the full validate gate, builds all workspaces, and publishes to npm with `--provenance` (`id-token: write` permission, `NODE_AUTH_TOKEN` from a repo secret). _(Authored and YAML-validated; the publish itself is `DEFERRED → user` — no `NPM_TOKEN`, no settled name.)_
- [x] The release workflow refuses to publish if the tag version and the package version disagree.
- [x] **Version singularity**: one version number describes the tool. A script (e.g. `npm run version:check`, wired into the release workflow and pre-push) verifies every workspace `package.json` version matches the root/published version.
- [x] `README.md` exists at the repo root and documents (a) the operator loop: `npm install -g corpus`, `corpus init`, `corpus server start`, start `claude`, `/orchestrate`; and (b) contributor setup including the one-time `npm run setup-hooks`. _(Install line marked provisional pending the name decision.)_
- [x] A dry run proves the flow end to end: `npm pack` → install the tarball into a clean temp dir with no repo access → `corpus init` a scratch workspace → `corpus server start` → the UI loads in a browser → a document created via the CLI round-trips (visible on disk and via the CLI/UI).

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

### Design Notes — packaging strategy (recorded 2026-07-28, before any code; sprint-013 TEST-51/TEST-52)

**Decision: strategy 1 — bundle. One published package, assembled by a build script into a staged
directory (`dist-package/`) and packed from there. No `@corpus/*` package ever reaches the registry.**

**Why 1 and not 2.** Four already-shipped resolvers expect one packaged root holding `server/main.js`,
`ui/`, `assets/workspace/` and `plugins/` side by side (`apps/cli/src/paths.ts`,
`apps/cli/src/commands/server/daemon.ts`, `apps/server/src/config.ts`,
`apps/server/src/plugins/discover.ts`). Strategy 1 satisfies all four with **zero source changes**.
Strategy 2 would require making `apps/server` buildable and publishable, obtaining four public registry
identities instead of one — and the one name we want is already contested (Open Conflict 5) — and
coordinating four version bumps per release. Nothing in v1 asks for the `@corpus/*` packages to be
third-party-consumable: CLAUDE.md Decision 1 and SPEC.md §4 describe a tool, not a library set.

**Why a staged directory rather than publishing `apps/cli` in place.** `apps/cli/package.json` declares
`"@corpus/contract": "*"` — meaningless on the registry — plus dev-only scripts, an `exports` map for a
library entry point nobody installs, and `private: true`. Publishing it in place would mean rewriting the
developer's own manifest during `prepack` and restoring it afterwards, and staging `ui/`, `server/`,
`assets/` and `plugins/` **into the live source tree**, clobbering the tsc output at `apps/cli/dist`. A
generated manifest in a gitignored staging directory has neither failure mode: the published manifest is
purpose-built and no pack ever mutates the dev tree.

**The bundle boundary is first-party vs. third-party**, not "everything". `scripts/build-package.ts`
esbuilds `apps/cli/src/bin/corpus.ts` → `dist-package/dist/corpus.js` and `apps/server/src/main.ts` →
`dist-package/server/main.js`, **inlining every `@corpus/*` import** and marking every other bare
specifier external. Third-party runtime deps stay real npm dependencies, derived from the esbuild
**metafile** (not hand-listed) and version-ranged from whichever workspace manifest declares them. That
is what keeps `better-sqlite3` — a native module that cannot be bundled — working, and it makes `tsx`,
`vitest`, `eslint` and `playwright` structurally impossible to leak: what the bundle does not import
cannot become a dependency.

**Packaged layout, and why each path is what it is.** Every path below is an *existing* resolver's
packaged candidate, read out of the shipped tree rather than invented here:

| Path in the tarball   | Resolved by                                                                  |
| --------------------- | ---------------------------------------------------------------------------- |
| `dist/corpus.js`      | `bin.corpus`; `cliPackageRoot()` = `resolve(dirname, "..")` → the package root |
| `server/main.js`      | `serverEntryCandidates()[0]`; `defaultPackageRoot()` → the package root        |
| `ui/**`               | `resolveUiDistDir`'s packaged candidate `resolve(packageRoot, "ui")`          |
| `assets/workspace/**` | `templateRootCandidates()[0]`                                                 |
| `plugins/**`          | `pluginsRootCandidates()[0]` — both the CLI half and the server half          |

The CLI bundle is `dist/corpus.js` and **not** `dist/bin/corpus.js` precisely because `cliPackageRoot()`
resolves one level up from its own module directory; a single-file bundle two levels deep would make it
return `<pkg>/dist` and every packaged candidate would miss. Honouring that constraint is far cheaper
than changing a resolver that every test in the repo depends on.

**Version singularity rule.** The root `package.json` gains a `version` field and is **the single
source**. `scripts/check-versions.ts` asserts root == every workspace manifest and — when `GITHUB_REF`
names a `refs/tags/v*` tag — that the tag equals it too. Bumping is
`npm version <x> --workspaces --include-workspace-root`. The value stays `0.0.0` (what every workspace
already declares): choosing the first *released* version is a release-strategy decision for the user, not
something a packaging issue mints unilaterally.

**Name.** Provisional, unpublished `corpus` per sprint-013 Adjudication 9 — held for the user, since both
`corpus` and `corpus-cli` are taken on npm. It is read from **one constant** (`PACKAGE_NAME` in
`scripts/package-config.ts`) and every user-visible occurrence is marked provisional. The bin name is
`corpus` regardless of what the package ends up being called.

**UI assets.** `apps/ui/dist` must exist at pack time — the `prepack`/release script must run the full build first, and the pack-contents check must assert `index.html` plus the hashed asset bundle are present. The server resolves its static root relative to its own module location (`import.meta.url`), never relative to `process.cwd()` — the CLI runs from the user's workspace, not from the install directory. This is the single most likely thing to break and be invisible until a real tarball install.

**Provenance publishing.** The workflow needs `permissions: { contents: read, id-token: write }`, `actions/setup-node` with `registry-url: https://registry.npmjs.org`, and `npm publish --provenance --access public` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`. Provenance requires the package to be published from a public repo via GitHub Actions — if that precondition doesn't hold at release time, fail loudly rather than silently dropping the flag.

**Version singularity.** Every workspace shares one version string. Bump with `npm version <x> --workspaces --include-workspace-root` (or a small script), tag `v<x>`, push the tag. `check-versions.ts` reads all workspace manifests and fails on any mismatch, including a mismatch with the `GITHUB_REF` tag when running in the release workflow.

**Pack audit.** `npm pack --dry-run --json` yields the exact file list. Assert positively (the bin, `dist/**`, the UI build, `README.md`, `LICENSE`) and negatively (tests, `issues/`, `.claude/`, `.githooks/`, `design/`, `data/`, `.corpus/`, `*.env`, source maps if undesired). A negative-only check silently passes when the tarball is empty — assert both directions.

**README.** Operator-first: what Corpus is in two sentences, install, `corpus init`, `corpus server start`, open the board, start `claude`, `/orchestrate`. Then a Contributing section: clone, `npm install`, `npm run setup-hooks`, `npm run build`, `npm test`, and the PR/squash-merge policy. It is a spec deliverable (§12), not decoration.

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

**implemented on: opus** (sprint-013 stage A, worktree `agent-a7a066af726871568`, branch base `ffdfa1b`).

### Reproduction (bugs only)

Not a bug — packaging work with no prior behaviour to reproduce. The *before* state is recorded for
contrast: `apps/cli/package.json` had `files: ["dist"]`, so a tarball carried neither the workspace
template, nor the UI build, nor the server, and `resolveTemplateRoot` would have thrown
`"the bundled workspace template is missing from this installation"` on the first `corpus init`.

### Post-Implementation Verification

Scratch prefix `/tmp/corpus-s013-infra008-BcwFCf`, port `9102`, per the sprint contract. Every command
below was run for real; outputs are verbatim.

#### Strategy and version singularity (TEST-51, TEST-52)

Recorded in this file's **Design Notes** section *before any code was written*: strategy 1 (bundle), one
published package assembled into `dist-package/`, with the reasons and the rejected alternative. Version
singularity rule: root `package.json` gains `version` (`0.0.0`, matching every workspace) and is the
single source; `scripts/check-versions.ts` enforces it and doubles as the tag guard.

#### The published manifest (TEST-53, TEST-54, TEST-55, TEST-56)

```
$ node --import tsx -e "…print private/name/version for every manifest…"
private      package.json                       name=corpus-monorepo version=0.0.0
private      apps/cli/package.json              name=@corpus/cli version=0.0.0
private      apps/server/package.json           name=@corpus/server version=0.0.0
private      apps/ui/package.json               name=@corpus/ui version=0.0.0
private      packages/contract/package.json     name=@corpus/contract version=0.0.0
private      packages/kit/package.json          name=@corpus/kit version=0.0.0
private      plugins/_fixture/package.json      name=corpus-plugin-fixture version=0.0.0
PUBLISHABLE  dist-package/package.json          name=corpus version=0.0.0
```

Exactly one publishable manifest. It is generated by `scripts/build-package.ts`; no workspace manifest
is mutated by a pack. Its full contents:

```json
{
  "name": "corpus",            // PROVISIONAL — Adjudication 9, one constant: scripts/package-manifest.ts
  "version": "0.0.0",
  "description": "Conversations around documents, driven by an AI agent — local-first, markdown on disk, one CLI.",
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/trupin/corpus.git" },
  "homepage": "https://github.com/trupin/corpus#readme",
  "type": "module",
  "engines": { "node": ">=22" },
  "bin": { "corpus": "./dist/corpus.js" },
  "files": ["dist", "server", "ui", "assets", "plugins", "README.md", "LICENSE"],
  "publishConfig": { "access": "public" },
  "dependencies": {
    "@hono/node-server": "^1.19.0", "@hono/zod-openapi": "^1.5.1", "better-sqlite3": "^12.4.1",
    "chokidar": "^4.0.3", "diff-match-patch": "^1.0.5", "hono": "^4.12.32",
    "openapi-fetch": "^0.17.0", "yaml": "^2.9.0", "zod": "^4.4.3"
  }
}
```

`private` is absent. `license: "MIT"` matches the `LICENSE` file (MIT, © 2026 Theophane RUPIN) — the
license question was already settled on disk and was not re-asked. **TEST-56**: `tsx`, `vitest`,
`eslint` and `playwright` are absent, and cannot appear — the dependency list is *derived from the
esbuild metafile*, so only what the bundles actually import can become a dependency, and
`assertNoDevDependencyLeak` fails the build if one ever does. The packaged layout takes
`serverEntryCandidates`' **packaged** branch (`server/main.js`), so `daemon.ts`'s `tsx` loader path is
never reached — proven by the real server start below.

#### The tarball (TEST-57 … TEST-63, TEST-65)

```
$ npm run package:build
package:build ✓ corpus@0.0.0 staged in dist-package/
  dist/corpus.js      260 kB
  server/main.js       427 kB
  ui/                 3 files
  assets/workspace/   11 files
  plugins/            none (no built non-underscore plugin)
  dependencies       @hono/node-server, @hono/zod-openapi, better-sqlite3, chokidar, diff-match-patch, hono, openapi-fetch, yaml, zod

$ npm pack   # cwd dist-package
npm notice 1.1kB LICENSE
npm notice 7.0kB README.md
npm notice 0B assets/workspace/claude/agents/.gitkeep
npm notice 1.0kB assets/workspace/claude/skills/comment/SKILL.md
npm notice 17.9kB assets/workspace/claude/skills/orchestrate/SKILL.md
npm notice 0B assets/workspace/data/docs/inbox/.gitkeep
npm notice 230B assets/workspace/data/docs/templates/note.md
npm notice 597B assets/workspace/data/docs/views/attention.md
npm notice 641B assets/workspace/data/docs/views/inbox.md
npm notice 556B assets/workspace/data/docs/views/open-threads.md
npm notice 0B assets/workspace/data/threads/.gitkeep
npm notice 918B assets/workspace/gitignore
npm notice 2.8kB assets/workspace/README.md
npm notice 265.9kB dist/corpus.js
npm notice 894B package.json
npm notice 437.0kB server/main.js
npm notice 1.2MB ui/assets/index-BjxWPzh4.js
npm notice 38.7kB ui/assets/index-DxfOQDDq.css
npm notice 1.4kB ui/index.html
npm notice name: corpus   version: 0.0.0   total files: 19
npm notice package size: 581.8 kB   unpacked size: 2.0 MB
```

- **TEST-57** the eleven template files are at `assets/workspace/`, `resolveTemplateRoot`'s packaged
  candidate. **TEST-58** `ui/index.html` **and** the hashed `ui/assets/index-BjxWPzh4.js` +
  `index-DxfOQDDq.css`. **TEST-59** `server/main.js`. **TEST-61** `README.md` + `LICENSE`.
- **TEST-60** `head -1 dist-package/dist/corpus.js` → `#!/usr/bin/env node`; `ls -l` →
  `-rwxr-xr-x … dist-package/dist/corpus.js`. The build asserts the shebang survived bundling and
  `chmod 0o755`s it; the pack audit re-asserts the executable bit from npm's reported `mode`.
- **TEST-62/63** zero matches for tests, `node_modules/`, `issues/`, `design/`, `.claude/`,
  `.githooks/`, `.github/`, root `data/`, `.corpus/`, `.env`, coverage, `*.map`, `*.ts`, and
  **zero `_fixture`**.
- **TEST-65** `npm run pack:check` → `pack:check ✓ corpus@0.0.0 — 19 files, 0.55 MB packed / 1.89 MB
  unpacked`, exit 0. Added to `.github/workflows/ci.yml`'s `validate` job (with `package:build`).

**The audit was proven to fire, not just to pass.** Two files were injected into the staged package
and the check re-run:

```
$ node --import tsx scripts/check-pack.ts
pack:check ✗ "server/lifecycle.test.js" must not ship — tests are not part of the tool ("**/*.test.{ts,tsx,js,mjs,cjs}")
pack:check: 1 violation(s) in corpus@0.0.0
exit=1
```

(The second injected file, `dist-package/issues/README.md`, was never packed at all — the manifest's
`files` allow-list excluded it before the audit saw it. Both layers hold.) Rebuilding restored
`pack:check ✓ … exit=0`.

**TEST-66** unit tests over the rules: `scripts/pack-audit.test.ts` (32 tests) drives `auditPackedFiles`
with a captured-shape file list — a clean listing passes; an **empty** listing fails with
`"nothing was staged"`; listings containing `issues/README.md`, a `.test.ts`, a `.map`, `node_modules/`,
`data/`, `.corpus/`, `.claude/` each fail naming the offender; a bin packed `0o644`, and a bin packed
with no `mode` at all, both fail.

**TEST-64 — the plugin rule, both directions.** `plugins/_fixture` is the only plugin, so the
non-underscore half is proven against a **synthetic plugin fabricated in a temp directory**
(sprint-013 Adjudication 15) in `scripts/package-staging.test.ts`: a fabricated
`plugins/todos/{dist,skills,types.yaml}` is staged (`dist/**` JS, `skills/**`, `types.yaml`; `.d.ts`,
`.map` and `.tsbuildinfo` dropped), `plugins/_fixture/**` is not staged at all, and a non-underscore
plugin with no `dist/` is skipped rather than shipping sources. `pack-audit.test.ts` mirrors it on the
audit side: `plugins/todos/dist/server/routes.js` produces zero violations,
`plugins/_fixture/dist/server/routes.js` produces one. **The live proof against a real shipped plugin
is `DEFERRED → PLUGINS-002`** — and see *Escalations* below for two gaps that PLUGINS-002 must close.

#### Version singularity (TEST-67, TEST-68, TEST-69)

```
$ npm run version:check
version:check ✓ every manifest is 0.0.0

# drift one workspace by hand:
$ node --import tsx scripts/check-versions.ts
version:check ✗ apps/ui/package.json is 0.0.1, expected 0.0.0
Fix with: npm version <x.y.z> --workspaces --include-workspace-root --no-git-tag-version
exit=1
# reverted:
version:check ✓ every manifest is 0.0.0   exit=0

# the tag guard, with a stubbed GITHUB_REF:
$ GITHUB_REF=refs/tags/v9.9.9 node --import tsx scripts/check-versions.ts
version:check ✗ the release tag names 9.9.9 but the package is 0.0.0 — tag and manifest must agree before anything is published
exit=1
$ GITHUB_REF=refs/tags/v0.0.0 …  exit=0
$ GITHUB_REF=refs/heads/main …   exit=0   (a branch push is not a release)
```

`scripts/versions.test.ts` (13 tests) covers the same matrix as a pure function. **TEST-69**:
`version:check` is now the **first** step of `.githooks/pre-push` (cheapest, needs no build) and an
early step of `CI / validate`; `pack:check` is CI-only on purpose — it bundles and packs, which is too
slow for a push.

#### The real acceptance test — a clean install (TEST-70 … TEST-77)

```
$ D=/tmp/corpus-s013-infra008-BcwFCf
$ cd $D && npm init -y && npm install ./corpus-0.0.0.tgz
added 52 packages, and audited 53 packages in 2s
$ ls -l node_modules/.bin/corpus
node_modules/.bin/corpus -> ../corpus/dist/corpus.js
$ ./node_modules/.bin/corpus --version
0.0.0
```

**TEST-70** — the bin, the shebang, the exec bit, and `cliPackageRoot()`'s `import.meta.dirname` walk all
land correctly in an installed layout with no path back to the repo. `better-sqlite3` installed from its
prebuilt binary without a compiler.

```
$ cd $D/scratch2 && $D/node_modules/.bin/corpus init --port 9102
Initialized Corpus workspace at /private/tmp/corpus-s013-infra008-BcwFCf/scratch2
  port 9102, token in .corpus/config.json (mode 600)
  git: initialized on main, one commit authored as user
  installed 8 template files, recorded in .corpus/template-manifest.json
Next: corpus server start
```

**TEST-71** — `resolveTemplateRoot` did **not** throw; it resolved `assets/workspace` out of the npm
install directory. The workspace holds `data/docs/{inbox,templates,views}`, `data/threads`,
`.claude/skills/{orchestrate,comment}/SKILL.md`, `.claude/skills-archived`, `.claude/agents`,
`.corpus/{config.json,queue/*,locks,jobs,attachments,template-manifest.json}`, `.gitignore` and
`README.md`. `ls -l .corpus/config.json` → `-rw-------`. `git log --oneline` → exactly one commit,
`f54f2cb workspace: initialize corpus workspace by user`.

**TEST-72** — the tool directory is byte-identical across `init`:

```
$ find node_modules/corpus -type f | sort | xargs shasum -a 256 > tool-before.sha256   # 19 files
… corpus init …
$ find node_modules/corpus -type f | sort | xargs shasum -a 256 > tool-after.sha256
$ diff tool-before.sha256 tool-after.sha256 && echo "TOOL DIR BYTE-IDENTICAL"
TOOL DIR BYTE-IDENTICAL
```

```
$ $D/node_modules/.bin/corpus server start
corpus 0.0.0 listening on http://127.0.0.1:9102 (pid 31213)
$ cat .corpus/server.log
{"level":"info","msg":"listening on http://127.0.0.1:9102", … "version":"0.0.0"}
$ curl -sS :9102/api/health
{"status":"ok","version":"0.0.0","uptimeSeconds":5.22,"workspace":"/private/tmp/…/scratch2"}
```

**TEST-73 — the board in a real browser, zero asset 404s.** The Chrome MCP extension was not connected
in this session (`Browser extension is not connected`), so the board was loaded in a **real headless
Chromium via Playwright**, driven directly (not `npm run e2e`, which was not run — no Vite, no port
bound), with every response, every failed request and every console message captured — the programmatic
equivalent of the network panel:

```
=== NETWORK (every request the page made) ===
200  http://127.0.0.1:9102/
200  http://127.0.0.1:9102/assets/index-DxfOQDDq.css
200  http://127.0.0.1:9102/assets/index-BjxWPzh4.js
200  http://127.0.0.1:9102/api/docs?pinned=true&sort=order&type=view
200  http://127.0.0.1:9102/api/health
200  http://127.0.0.1:9102/api/jobs
200  http://127.0.0.1:9102/api/queue/status
200  http://127.0.0.1:9102/events?token=SWOh0LkGjJdbt_uVW0Xy31EpxaCORtt_UqN-WTH8ni8
200  http://127.0.0.1:9102/api/docs?needs=me
200  http://127.0.0.1:9102/api/docs?folder=inbox
200  http://127.0.0.1:9102/api/docs?status=open&type=thread

=== 0 responses with status >= 400 ===
=== 0 failed requests ===
=== 0 console errors ===
=== TITLE === Corpus
```

On screen (`innerText`, and a screenshot at `board-final.png`): the header `Corpus WORKBENCH`, the search
box, and three rendered columns — **Attention** (`needs: me`), **Inbox** (`folder: inbox/`) and
**Open threads** (`type: thread`, `status: open`) — each with its filter chips and `Nothing here.`, the
"New list" affordance, and the console strip reading `agent: idle · queue 0 · 0 running · 0 done ·
0 failed · corpus 0.0.0 · HALT`. Not a blank page. The token was provisioned into `index.html`
(SERVER-024), so `/events` authenticated and every `/api/*` call returned 200. No `sourceMappingURL`
request appears because the staging step strips the annotation along with the `.map` file — that
dangling request would otherwise have been the one 404 in this list.

**TEST-74 — round-trip through the installed tool, no manual refresh.** With the board still open, the
document was created by the **installed CLI** in another process:

```
$ corpus doc create --type note --title "Final artifact round-trip" -m "Created by the packaged CLI." --json
exit=0
{"doc":{"frontmatter":{"id":"doc_5y5tibse","type":"note","title":"Final artifact round-trip", …},
 "body":"Created by the packaged CLI.","path":"data/docs/inbox/final-artifact-round-trip.md","anchors":[]},"warnings":[]}

=== AFTER (no manual refresh): title visible on the board? YES ===
… Inbox FOLDER 1 … NOTE / Packaged tool round-trip / Created by the packaged CLI. / inbox/ / just now …
=== responses >= 400 or page errors: 0 ===
```

(a) on disk with valid frontmatter:

```
$ cat data/docs/inbox/packaged-tool-round-trip.md
---
id: doc_5yulqueg
type: note
title: Packaged tool round-trip
created: 2026-07-29T03:14:20Z
updated: 2026-07-29T03:14:20Z
tags: []
status: open
anchors: {}
due: null
reviewed: null
evergreen: false
---
Created by the packaged CLI.
```

(b) via the API: `GET /api/docs/doc_5yulqueg` returns it. (c) in the browser without a refresh — the
packaged server's SSE `invalidate` drove it, as shown above. `git log --oneline` in the workspace:
`4e7a9a7 doc create: Packaged tool round-trip (doc_5yulqueg) by user` on top of the init commit.

**TEST-75 — plugin discovery in the packaged layout.** `corpus --help` from the installed binary lists
commands `health, init` and topics `server, doc, thread, queue, lock, job, db` — **no plugin topics, no
`_fixture`**. `grep -ci plugin .corpus/server.log` → `0`: the server booted with no plugin warning and no
error. `resolvePluginsRoot()` returning `undefined` is a normal state, and it behaves like one.

**TEST-76 — clean shutdown by the lifecycle verb, not by pid:**

```
$ $D/node_modules/.bin/corpus server stop
stopped (pid 31213)
$ ls .corpus/server.pid   → No such file or directory
$ lsof -nP -iTCP:9102 -sTCP:LISTEN → (empty)   9102 free
$ lsof -nP -iTCP:8765 -sTCP:LISTEN → (empty)   8765 unbound
```

**TEST-77** — `git status --porcelain` in the worktree shows only this issue's own files;
`dist-package/` is gitignored. Everything else lives under the captured `$D`, which is deleted by path.

#### Release workflow (TEST-78 … TEST-81)

**TEST-78** `.github/workflows/release.yml` is new. `actionlint` is not installed on this machine
(`actionlint not found`), so the stated minimum was used — a real YAML parse:

```
.github/workflows/release.yml → parsed OK; on: {"push":{"tags":["v*"]}} ; jobs: publish ; steps: 14
   permissions: {"contents":"read","id-token":"write"}
```

It uses `actions/setup-node@v4` with `registry-url: https://registry.npmjs.org`, runs `version:check`
(the tag guard) **before** anything is built, then the full validate gate (build, artifact drift, lint,
format, typecheck, unit coverage, Playwright e2e, merged coverage gate), then `package:build` +
`pack:check`, then `npm publish --provenance --access public` in `dist-package` with
`NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`.

**TEST-79** — the repo is PUBLIC and MIT, so the provenance precondition holds; the flag is
**unconditional**. A release that silently dropped provenance would be indistinguishable afterwards from
one that never had it, so there is no conditional and no fallback.

**TEST-80** — re-running the workflow on an existing tag: the version guard still passes (tag and
manifest agree — it guards *disagreement*), and `npm publish` then rejects the already-published version
with `E403 … cannot publish over the previously published versions`. Nothing is mutated before that
point: the tarball is assembled into a staging directory, never into the source tree, and no npm state
changes until the publish call itself. It fails cleanly; it cannot half-publish.

**TEST-81 — no real publish. `DEFERRED → user provisions NPM_TOKEN and the package name.`** The two
preconditions quoted from the sprint contract still hold (`npm whoami` → `ENEEDAUTH`;
`gh secret list --repo trupin/corpus` → empty). What *was* executed is Adjudication 10's substitute — a
real `npm publish --dry-run` over the staged package:

```
$ npm publish --dry-run --access public          # cwd dist-package
npm notice name: corpus  version: 0.0.0  filename: corpus-0.0.0.tgz
npm notice package size: 581.8 kB  unpacked size: 2.0 MB  total files: 19
npm warn This command requires you to be logged in to https://registry.npmjs.org/ (dry-run)
npm error Cannot implicitly apply the "latest" tag because previously published version 0.0.1 is higher than the new version 0.0.0.

$ npm publish --dry-run --access public --tag next
npm notice Publishing to https://registry.npmjs.org/ with tag next and public access (dry-run)
+ corpus@0.0.0
```

The first output is **independent confirmation of Open Conflict 5**: the name `corpus` is taken by a
package already at `0.0.1`. The second shows the artifact itself is publishable end to end. `npm run
publish:dry-run` is left in the honest, default-tag form; it will go green the moment the user picks a
free name.

One packaging trap found and avoided while doing this: `npm publish --dry-run ./dist-package` (the
*path* form) emits `npm warn publish "bin[corpus]" script name dist/corpus.js was invalid and removed` —
npm normalises the manifest differently when the package is addressed by path. Run from the package's
own directory (`working-directory: dist-package`, which is what the workflow does) the warning does not
appear and the bin survives. The `publish:dry-run` script was changed to the directory form to match.

#### README and docs (TEST-82, TEST-83, TEST-85)

**TEST-82** `README.md` is new at the repo root: what Corpus is in two sentences and three bullets, then
the operator loop end to end — install, `corpus init`, `corpus server start`, open the board, `claude`,
`/orchestrate` — plus an everyday-commands table pointing at `docs/cli.md`. The install line is
`npm install -g corpus` **marked provisional in the file itself**, with a status callout naming the
conflict and the fallback (run from a clone). Per Adjudication 9 the name decision is surfaced at the
phase PR; it is not a silent placeholder.
**TEST-83** the Contributing section is clone → `npm install` → **`npm run setup-hooks`** (called out as
the required one-time step, §12) → `npm run build` → `npm test`, then the script table, the
per-phase-PR + green-CI + **squash-only** policy, and the release procedure.
**TEST-85** `CLAUDE.md` → Build & Dev Commands documents `version:check`, `package:build`, `pack:check`
and `publish:dry-run` in the same style as `coverage`/`coverage:merge`, and `clean` now names
`dist-package/`.

#### TEST-84 — the pre-push hook: the premise is false, and blocking is proven anyway

Open Conflict 7 and Adjudication 11 state the hook "ends at `step \"unit tests\"` with no epilogue and
cannot block a push". **That is not true of the shipped file, and was not true at `6e7e709` either** —
the commit the sprint contract was written against:

```
$ git show 6e7e709:.githooks/pre-push | tail -12
if compgen -G "apps/ui/e2e/*.spec.ts" > /dev/null; then
  step "playwright e2e" npm run --silent e2e
else
  echo "pre-push ▷ playwright e2e skipped (no specs in apps/ui/e2e/ yet)"
fi

if [ "$fail" -ne 0 ]; then
  echo "pre-push: blocked."
  exit 1
fi
echo "pre-push ✓ all checks passed"
```

Both the epilogue and the Playwright step its header claims have been present since `9190296`
(INFRA-001). No exit-propagation fix was required; none was invented. The `CORPUS_UI_PORT` export is
**used**, not dead — the e2e step reads it.

Adjudication 11's real requirement — *prove it blocks* — was carried out against the **real hook file**,
with `npm`/`node` replaced by stubs on `PATH` so the hook's own control flow (`set -uo pipefail`, the
`step` accumulator, the epilogue) decides the outcome. No git state was changed and no clone was needed:

```
$ env PATH=$D/hookproof/bin:… bash .githooks/pre-push
pre-push ▶ version singularity … ▶ build … ▶ generated artifacts drift … ▶ eslint …
▶ prettier check … ▶ typecheck … ▶ unit tests … ▶ playwright e2e
pre-push ✓ all checks passed                                        exit=0

$ env PATH=… FAILING_STEP=version:check bash .githooks/pre-push
pre-push ▶ version singularity
stub npm: pretending `version:check` failed
pre-push ✗ version singularity failed.
… (every later step still runs, by design) …
pre-push: blocked.                                                  exit=1

$ env PATH=… FAILING_STEP=e2e bash .githooks/pre-push
pre-push ▶ playwright e2e
stub npm: pretending `e2e` failed
pre-push ✗ playwright e2e failed.
pre-push: blocked.                                                  exit=1
```

A failure in the first step and a failure in the last step both propagate to a non-zero exit; an
all-green run exits 0. The hook blocks. The only change this issue makes to it is adding
`step "version singularity" npm run --silent version:check` as the first step, with a comment saying why
`pack:check` stays out.

#### Repo gates

```
$ npm run lint            → clean (eslint ., no output)
$ npm run format:check    → All matched files use Prettier code style!
$ npm run typecheck       → 6 × tsc --noEmit + scripts/tsconfig.json, all clean
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts
  8 test files, 199 tests passed (92 of them new: pack-audit 32, package-manifest 23,
  package-staging 24, versions 13)
$ node --import tsx scripts/check-generated-artifacts.ts
  ✓ API contract is up to date.   ✓ CLI reference is up to date.   exit=0
```

Per the sprint's machine-load discipline, the repo-wide suite, `npm run coverage` and `npm run e2e` were
**not** run from this worktree — the orchestrator's harvest gate is the single repo-wide run. Note
`COVERAGE_INCLUDE` does not cover `scripts/**`, so the four new test files are the only gate on this
code, which is why they are exhaustive in both directions.

#### Escalations and deferrals

1. **`DEFERRED → user` — the npm package name** (Open Conflict 5 / Adjudication 9). Confirmed
   independently above: `corpus` is taken at `0.0.1`. Change `PACKAGE_NAME` in
   `scripts/package-manifest.ts` and the README install line; nothing else moves.
2. **`DEFERRED → user` — the real publish and `NPM_TOKEN`** (Open Conflict 6 / Adjudication 10). The
   workflow is written and its guards are proven locally; the trigger is the user's.
3. **`DEFERRED → PLUGINS-002` — the live plugin-packaging proof** (Open Conflict 11 / Adjudication 15),
   with **two real gaps found in the packaged layout** while implementing the rule, neither of which is
   in this issue's domain:
   - `discoverPluginTopics` (`apps/cli/src/registry/plugins.ts`) enumerates
     `<plugin>/cli/commands/*.ts` — the **TypeScript source** directory — to learn the command file
     names, and only then maps each to `dist/cli/commands/*.js`. A dist-only packaged plugin therefore
     exposes **no CLI commands**. The fix is one enumeration change in `apps/cli` (prefer
     `dist/cli/commands/*.js` when it exists); shipping `.ts` sources purely as a name list would be the
     wrong answer.
   - A packaged plugin's `dist/server/routes.js` imports `@corpus/contract` as a bare specifier, and
     that package is **inlined into the tool's bundles rather than installed**, so it will not resolve
     in an npm install. Discovery contains the failure as a warning, as designed, but the plugin's
     routes will not mount. The natural fix is to bundle each plugin's entry points during staging with
     the same first-party-inlined boundary the tool's own bundles use — the place for it is
     `stagePlugins` in `scripts/package-staging.ts`, and it is noted there in a comment. Building that
     machinery now, with no plugin to test it against, would be speculation.
4. **Open Conflict 7's premise is factually wrong** (see TEST-84). Recorded rather than "fixed": there
   was nothing to fix. Whether pre-push should *also* gate on `pack:check` or on the coverage gate is a
   **gate-policy decision** and belongs to the user/orchestrator, not to this issue.
5. **UI source maps are deliberately not shipped**, and the `sourceMappingURL` annotation is stripped
   with them (`stripSourceMapComment`). Shipping them would have added ~5.8 MB to every global install;
   leaving the annotation behind while dropping the file would have produced exactly the 404 TEST-73
   exists to catch. Stated here because "no `**/*.map`" is now an asserted packaging rule.
6. **`actionlint` is unavailable on this machine**; the workflows were validated by YAML parse, the
   contract's stated minimum. Worth adding an `actionlint` step to CI in a future INFRA issue.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[INFRA-008]` prefix
