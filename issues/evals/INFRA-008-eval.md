# Evaluation: INFRA-008

**Date**: 2026-07-28
**Sprint**: sprint-013 (commit `4516fd9`, branch `phase-4-agent-loop`)
**Verdict**: **PASS** (35 of 35 numbered criteria — 31 PASS, 4 DEFERRED exactly as the sprint's
adjudications prescribe; plus cross-issue TEST-162, 166, 167)

The core E2E was re-run end to end by the evaluator, not merely audited: `npm run package:build` →
`npm pack` → install the tarball into a fresh prefix with no path to the repo → drive the **installed**
binary through `init`, `server start`, a real headless-Chromium board load, a document round-trip and
`server stop`. Scratch `/tmp/corpus-s013-eval-infra-KaGzsG`, port `9129`.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                     |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | The longest and most specific log in the batch — file lists, byte counts, network tables, workflow parse output, hook stub transcripts.   |
| Commands are specific and concrete      | PASS   | Real tarball listing, real `npm publish --dry-run` output including npm's own error text, real `shasum` diffs of the tool directory.      |
| Real E2E (not mocked)                   | PASS   | Real tarball, real `npm install` into `$(mktemp -d)`, real installed binary, real browser, real server. No test client anywhere.          |
| Scenarios cover acceptance criteria     | PASS   | TEST-51…85 all addressed; every deferral is named with its adjudication.                                                                  |
| Application restarted after changes     | PASS   | The whole point: a freshly packed artifact was installed and started from scratch.                                                        |
| Actual model recorded (implemented on:) | PASS   | "**implemented on: opus** (sprint-013 stage A, worktree `agent-a7a066af726871568`)".                                                       |
| Reproduction logged before fix (bugs)   | N/A    | Packaging work; the *before* state (`files: ["dist"]`, `resolveTemplateRoot` would throw) is recorded for contrast.                       |

## Criteria Results

| #   | Criterion                                        | Result                        | Notes                                                                                                                                                       |
| --- | ------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 51  | One strategy chosen, recorded, applied           | PASS                          | Design Notes in the issue file (written before code) choose strategy 1 (bundle into `dist-package/`) with the rejected alternative and its reasons. Implementation matches: one generated manifest, no `@corpus/*` on the registry. |
| 52  | Version singularity defined before it is checked | PASS                          | Root `package.json` now carries `version: "0.0.0"` and is named as the single source; `scripts/check-versions.ts` enforces it and doubles as the tag guard. |
| 53  | Exactly one publishable package                  | PASS                          | Re-derived across all 8 manifests: 7 `private`, only `dist-package/package.json` (`corpus@0.0.0`) publishable.                                              |
| 54  | The manifest carries every required field        | PASS                          | `name`, `version`, `description`, `license: "MIT"`, `repository` → `git+https://github.com/trupin/corpus.git`, `engines.node: ">=22"`, `bin.corpus`, `files`, `publishConfig.access: "public"`; `private` absent. |
| 55  | `license` matches the `LICENSE` file             | PASS                          | `LICENSE` = "MIT License / Copyright (c) 2026 Theophane RUPIN"; manifest = `"MIT"`.                                                                          |
| 56  | No `tsx`/`vitest`/`eslint`/`playwright` deps     | PASS                          | All four absent (and `@playwright/test`); the 9 runtime deps are exactly the bundle's externals. The packaged layout takes the `server/main.js` branch, so `daemon.ts`'s tsx path is never reached — proven by the installed server starting. |
| 57  | Tarball carries the workspace template           | PASS                          | 11 files under `assets/workspace/` at `resolveTemplateRoot`'s packaged candidate, including both `claude/skills/*/SKILL.md`, `gitignore`, `README.md`, the seed views and `data/docs/templates/note.md`. |
| 58  | Tarball carries the UI build                     | PASS                          | `ui/index.html` **and** the hashed `ui/assets/index-DHKRTlIK.js` + `ui/assets/index-DxfOQDDq.css`.                                                           |
| 59  | Tarball carries the server                       | PASS                          | `server/main.js` (445.7 kB) at `serverEntryCandidates()`'s packaged path.                                                                                    |
| 60  | Bin has its shebang and exec bit                 | PASS                          | `head -1 dist/corpus.js` → `#!/usr/bin/env node`; `tar -tvzf` shows `-rwxr-xr-x … package/dist/corpus.js`.                                                   |
| 61  | Tarball carries `README.md` and `LICENSE`        | PASS                          | Both present.                                                                                                                                               |
| 62  | Tarball excludes everything it must              | PASS                          | Grepped the 19-entry list: **0** matches for `.test.`, `node_modules/`, `issues/`, `design/`, `.claude/`, `.githooks/`, `.github/`, `.corpus/`, `.env`, `coverage`, `*.map`, `*.ts`. |
| 63  | Underscore-prefixed plugins excluded             | PASS                          | **0** matches for `_fixture`.                                                                                                                               |
| 64  | Non-underscore plugin `dist` WOULD be included   | PASS (unit) + DEFERRED → PLUGINS-002 (live) | `scripts/package-staging.test.ts` + `pack-audit.test.ts` prove both directions against a synthetic `plugins/todos/**` fabricated in a temp dir (Adjudication 15); the live proof against a shipped plugin is correctly deferred. All 203 `scripts/` tests green. |
| 65  | The pack check asserts both directions, in CI    | PASS                          | `npm run pack:check` → `✓ corpus@0.0.0 — 19 files`. **Made to fire**: injecting `dist-package/server/lifecycle.test.js` → `✗ "server/lifecycle.test.js" must not ship …`, exit 1; removing it → green. A second injected `dist-package/issues/README.md` never reached the audit because the manifest's `files` allow-list dropped it first — both layers confirmed. Wired into `.github/workflows/ci.yml`'s `validate` job (line 36). |
| 66  | Pack-check unit tests over fixtures              | PASS                          | `vitest run scripts` → 8 files, **203 tests** green, including the empty-listing case.                                                                       |
| 67  | `check-versions.ts` exists and fails on drift    | PASS                          | Green at parity; hand-drifting `apps/ui` to `0.0.1` → `✗ apps/ui/package.json is 0.0.1, expected 0.0.0`, exit 1; reverted → exit 0. Manifest restored, `git status` clean. |
| 68  | The tag/version guard refuses a mismatch         | PASS                          | `GITHUB_REF=refs/tags/v9.9.9` → `✗ the release tag names 9.9.9 but the package is 0.0.0`, exit 1; `v0.0.0` → exit 0; `refs/heads/main` → exit 0.            |
| 69  | Version check wired into pre-push and CI         | PASS                          | `.githooks/pre-push:32` (`step "version singularity"`, the first step) and `.github/workflows/ci.yml:25`. `pack:check` is CI-only, with the reason commented in the hook. |
| 70  | The installed binary runs with no path to the repo | PASS                        | `npm install ./corpus-0.0.0.tgz` into a fresh prefix; `node_modules/.bin/corpus -> ../corpus/dist/corpus.js`; `corpus --version` → `0.0.0`, exit 0. `better-sqlite3` installed from prebuilt binaries. |
| 71  | `corpus init` scaffolds from the packaged template | PASS                        | `resolveTemplateRoot` did **not** throw. Workspace holds `data/docs/{templates,views}`, `.claude/skills/{orchestrate,comment}/SKILL.md`, `.gitignore`, `README.md`, `.corpus/{config.json,queue/*,template-manifest.json}`; config mode `-rw-------`; `git log --oneline` → exactly one commit `2231a7f workspace: initialize corpus workspace by user`. |
| 72  | `corpus init` does not touch the tool directory  | PASS                          | `find node_modules/corpus -type f | xargs shasum -a 256` (19 files) before and after → `diff` empty: **TOOL DIR BYTE-IDENTICAL**.                            |
| 73  | Board renders with zero asset 404s               | PASS                          | Real headless Chromium via Playwright (driven directly, not `npm run e2e`): **0 responses ≥ 400, 0 failed requests, 0 console errors**, title `Corpus`. On screen: `Corpus WORKBENCH`, search box, three columns (Attention / Inbox / Open threads) each with filter chips, the "New list" affordance and the console strip `agent: idle · queue 0 · … · corpus 0.0.0 · HALT`. Not a blank page. `/events?token=…` authenticated (token provisioned into `index.html`). |
| 74  | A document round-trips through the installed tool | PASS                         | With the board still open, the **installed** CLI created `doc_4zaed6lc`; (a) `data/docs/inbox/evaluator-round-trip.md` on disk with valid frontmatter, (b) `corpus doc show doc_4zaed6lc` returns it, (c) the title appeared on the board **without a manual refresh** (`title visible without reload: true`), still 0 responses ≥ 400. Workspace `git log`: `4ed7acc doc create: Evaluator round-trip (doc_4zaed6lc) by user`. |
| 75  | Plugin discovery in the packaged layout          | PASS                          | Installed `corpus --help` lists topics `workspace, server, doc, thread, skill, queue, lock, job, db` — **no plugin topics, no `_fixture`**; `grep -ci plugin .corpus/server.log` → `0`.                              |
| 76  | `corpus server stop` shuts down cleanly          | PASS                          | Stopped via the **installed** lifecycle verb (`stopped (pid 10662)`); `.corpus/server.pid` gone; `lsof -nP -iTCP:9129 -sTCP:LISTEN` empty. Not pid-killed.  |
| 77  | Nothing written outside the prefix               | PASS                          | Everything lived under the captured `$D`, removed by path; `git -C <repo> status --porcelain` shows only the pre-existing `issues/sprints/sprint-013.md`; `8765` unbound throughout. `dist-package/` is gitignored. |
| 78  | `release.yml` exists, tag-triggered, parses      | PASS                          | Real YAML parse: `on: {"push":{"tags":["v*"]}}`, `permissions: {"contents":"read","id-token":"write"}`, job `publish`, 14 steps, `actions/setup-node@v4` with `registry-url: https://registry.npmjs.org`; the version/tag guard runs **first**, then the full validate gate, then `package:build` + `pack:check`, then publish. |
| 79  | Fails loudly if provenance is impossible         | PASS                          | Publish step is `npm publish --provenance --access public` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` in `working-directory: dist-package` — **unconditional**, no fallback that could silently drop the flag. |
| 80  | Re-running on an existing tag fails cleanly      | PASS (mechanism named)        | The guard passes (tag and manifest agree) and `npm publish` rejects a republished version; nothing mutates before the publish call because the tarball is assembled in a staging directory. Independently corroborated: the live dry-run against the real registry failed at npm's own version check, not half-way. |
| 81  | No real publish attempted                        | DEFERRED → user provisions `NPM_TOKEN` and the package name (Adjudication 9/10) | Preconditions re-verified by the evaluator: `npm whoami` → `need auth … ENEEDAUTH`; `gh secret list --repo trupin/corpus` → empty. Adjudication 10's substitute executed: `npm publish --dry-run --access public` from `dist-package` → npm's own `Cannot implicitly apply the "latest" tag because previously published version 0.0.1 is higher than the new version 0.0.0` (independent confirmation that `corpus` is taken), and `--tag next` → `+ corpus@0.0.0`. No publish, no tag pushed. |
| 82  | `README.md` documents the operator loop          | PASS                          | New at the repo root: what Corpus is, then install → `corpus init` → `corpus server start` → open the board → `claude` → `/orchestrate`, plus an everyday-commands table. The install line `npm install -g corpus` is **explicitly marked provisional** in the file, with the conflict and the run-from-a-clone fallback named — not a silent placeholder (Adjudication 9). |
| 83  | `README.md` documents contributor setup          | PASS                          | Contributing section: clone → `npm install` → **`npm run setup-hooks`** (called out as the required one-time step, §12) → `npm run build` → `npm test`, plus the per-phase-PR / green-CI / **squash-only** policy. |
| 84  | `.githooks/pre-push` blocks a failing step       | PASS (premise corrected — Adjudication 20) | Independently re-derived: `git show 6e7e709:.githooks/pre-push | tail -8` already contains `if [ "$fail" -ne 0 ]; then … exit 1; fi`. The contract's "never blocked" premise was wrong and no fix was invented. Blocking re-proved against the **real** hook with stubbed `npm`/`node` on `PATH`: all-green → exit 0; `FAILING_STEP=version:check` (first step) → `pre-push: blocked.` exit 1; `FAILING_STEP=e2e` (last step) → `pre-push: blocked.` exit 1. The only change to the hook is the new first step. |
| 85  | `CLAUDE.md` names the new scripts                | PASS                          | `version:check`, `package:build`, `pack:check`, `publish:dry-run` documented in Build & Dev Commands in the `coverage`/`coverage:merge` style; `clean` now names `dist-package/`.                                     |
| 162 | The packaged tool carries the wave-2 verbs (cross) | PASS                        | Tarball packed at evaluation time (after all of stage B): installed `corpus doc --help` → `show`, `check`; `corpus skill --help` → `rollback`; `corpus workspace --help` → `upgrade`; `corpus thread --help` → `show`. `_fixture` absent. |
| 166 | The harvest gate is green, once (cross)           | PASS (orchestrator evidence)  | Per the task statement the repo-wide gate already passed (coverage exit 0, e2e green on 5281, `8765` unbound). Not re-run by the evaluator, per machine-load discipline. The evaluator independently re-ran `lint`, `format:check`, `typecheck` (all exit 0) and `check-generated-artifacts.ts` (green, twice). |
| 167 | No stray processes or scratch leakage (cross)     | PASS                          | After the session: `9120`–`9129` → 0 listeners, `8765` → 0, `5284` → 0, `5173`/`5174` still only the `ssh` process (pid 16094), 0 vitest/vite/playwright processes, `git status` clean except the pre-existing `sprint-013.md`, `git worktree list` shows only the main checkout, and every scratch directory was removed **by captured path** (105 pre-existing `/tmp/corpus-*` entries untouched). |

## Honesty Audit (claims re-derived by the evaluator)

| #   | Claim in the log                                                     | Re-derived?      | Finding                                                                                                                     |
| --- | -------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| I1  | Exactly one publishable manifest, 7 private                          | Yes              | Exact match, same names and versions.                                                                                        |
| I2  | The generated manifest's full contents                               | Yes              | Field-for-field identical, including the 9 dependencies.                                                                     |
| I3  | Tarball has 19 files with the listed layout                          | Yes              | Exact (bundle byte sizes differ slightly — 297 kB vs 260 kB CLI, 1.2 MB UI with a different hash — because the tree was rebuilt at evaluation time after stage B landed. Expected, not an overclaim.) |
| I4  | Zero `_fixture`, zero tests/maps/ts/etc. in the tarball              | Yes              | Exact.                                                                                                                       |
| I5  | Shebang + exec bit survive the pack                                  | Yes              | Exact.                                                                                                                       |
| I6  | `pack:check` fires on an injected test file                          | Yes              | Reproduced verbatim, including the message text and exit 1.                                                                  |
| I7  | The injected `issues/README.md` never reaches the audit              | Yes              | Reproduced: the violation list still named only the test file.                                                               |
| I8  | `version:check` drift + tag-guard matrix                             | Yes              | All five outcomes reproduced verbatim.                                                                                       |
| I9  | Installed binary prints `0.0.0` from a pathless prefix               | Yes              | Exact.                                                                                                                       |
| I10 | `corpus init` from the tarball scaffolds and commits once            | Yes              | Exact (my run's sha differs, naturally).                                                                                     |
| I11 | Tool directory byte-identical across `init` (19 files)               | Yes              | Exact, same file count.                                                                                                      |
| I12 | Board loads with 0 ≥400, 0 failed, 0 console errors                  | Yes              | Reproduced in headless Chromium; same three columns, same console strip, same title.                                         |
| I13 | Round-trip visible without a manual refresh                          | Yes              | Reproduced.                                                                                                                  |
| I14 | No plugin topics, `grep -ci plugin server.log` → 0                   | Yes              | Exact.                                                                                                                       |
| I15 | `corpus server stop` removes the pidfile and frees the port          | Yes              | Exact.                                                                                                                       |
| I16 | `release.yml` shape (trigger, permissions, registry, publish step)   | Yes              | Exact, via a real YAML parse of the committed file.                                                                          |
| I17 | `npm whoami` → ENEEDAUTH; `gh secret list` → empty                   | Yes              | Exact.                                                                                                                       |
| I18 | Both `npm publish --dry-run` outcomes                                | Yes              | Reproduced verbatim, including npm's "previously published version 0.0.1 is higher" error.                                    |
| I19 | Open Conflict 7's premise is false (epilogue since INFRA-001)        | Yes              | `git show 6e7e709:.githooks/pre-push` confirms. Adjudication 20 is correct.                                                   |
| I20 | The hook blocks on a first-step and a last-step failure              | Yes              | Reproduced with my own stub `PATH`; both exit 1, all-green exits 0.                                                          |
| I21 | `scripts/` tests: 8 files, 199 tests                                 | Yes (now 203)    | 203 today; the +4 are stage-B additions to `workspace-template.test.ts`. Consistent, not inflated.                            |
| I22 | TEST-74's transcript                                                 | **Partially — see below** | The block splices two different runs.                                                                              |
| I23 | `check-generated-artifacts.ts` green at commit time                  | Yes              | Green twice today.                                                                                                           |

**One evidence-quality finding (I22, not a behavioural failure).** The TEST-74 block in the issue log
shows a CLI invocation creating `"Final artifact round-trip"` returning `doc_5y5tibse`, but the file
quoted on disk immediately below is `data/docs/inbox/packaged-tool-round-trip.md` with
`id: doc_5yulqueg` / `title: Packaged tool round-trip`, and the board excerpt shows the second title
too. Two separate runs have been pasted into one narrative. The *behaviour* is real — I reproduced
the whole round-trip independently — but a reader cannot follow a single document through the log.
Future logs should transcribe one run, not merge two. Recorded, not scored as a criterion failure.

## Failures

None.

## Summary

35 of 35 numbered criteria: 31 PASS, 4 correctly DEFERRED (the live plugin-packaging proof →
PLUGINS-002; the real publish, the `NPM_TOKEN` and the package name → the user), plus cross-issue
TEST-162/166/167. The single most important line in the batch is true and was re-proved from
scratch: **a stranger could install this.** A tarball packed from the current tree, installed into a
temp directory with no path to the repository, scaffolded a workspace, started a server, rendered the
board in a real browser with zero failed requests, round-tripped a document that appeared without a
refresh, and stopped cleanly — with the tool directory byte-identical afterwards.

The pack audit asserts in both directions and was seen to fire; version singularity fails on drift
and on a mismatched tag; the release workflow is unconditional about provenance; the README's
install line is honestly marked provisional; and Open Conflict 7's false premise was corrected with
proof rather than "fixed" with an invented change. **PASS.**
