# [INFRA-007] Package build & exports wiring; plugins workspace; type-aware lint

## Domain

infra

## Status

in_progress

## Priority

P0

## Model

opus — mechanical config work with clear success criteria; no architectural judgment required beyond the decisions already recorded in CLAUDE.md.

## Dependencies

- Depends on: —
- Blocks: UI-001, CLI-001

## Spec References

- CLAUDE.md — Repository Structure (dependency direction: `packages/contract` ← `apps/*` / `packages/kit`; `packages/kit` ← `apps/ui`; `plugins/*` import only `@corpus/kit` + `@corpus/contract`)
- CLAUDE.md — Architecture Decision 3 (contract-first via code: a generated typed client consumed by both UI and CLI), Decision 6 (npm-installed CLI for v1)
- SPEC.md §10 (Plugin system) — plugins live in `plugins/<name>/` at the repo root
- SPEC.md §4 (Repository layout)

## Summary

INFRA-001 stood up the gates (lint, format, typecheck, test, hooks) but deliberately stopped short of a build story: every workspace tsconfig is `noEmit`, no package declares `main`/`exports`/`types`, `apps/cli` has no `bin`, and the root `workspaces` globs cover only `apps/*` and `packages/*`. The consequence is that **cross-package imports cannot resolve at all** — the moment `apps/server` or `apps/cli` writes `import { ... } from "@corpus/contract"`, Node and `tsc` both fail, because the package points at nothing. This issue gives the monorepo a real build topology: `packages/contract` and `packages/kit` emit `dist/` with declaration files and expose proper `exports` maps; apps stay source-run (tsx for server/cli, Vite for ui) in development while `apps/cli` gains its `bin` wiring; a root `build` script sequences the workspaces correctly; `plugins/*` becomes a workspace so the reference plugin has a home; and ESLint's type-aware rule set is scoped so it actually applies to TypeScript source instead of being switched off. It is the unblocking issue for CLI-001 and UI-001, both of which consume `@corpus/contract`.

## Acceptance Criteria

- [x] `packages/contract` and `packages/kit` each build with `tsc` to `dist/` including `.d.ts` declaration files and source maps; `npm run build -w packages/contract` and `npm run build -w packages/kit` succeed independently.
- [x] Both packages declare `main`, `types`, `exports` (subpath-capable), and `files` in their `package.json`; `packages/contract` exports at least `.` and `./client` per CONTRACT-001's planned surface.
- [x] A workspace that imports `@corpus/contract` (a temporary import in `apps/server/src` and `apps/cli/src` is acceptable proof) **typechecks** under `npm run typecheck` and **runs** under `tsx` after `npm run build` — verified with actual command output in the E2E log.
- [x] `apps/cli/package.json` declares `"bin": { "corpus": "./bin/corpus.js" }` and that entry point exists and executes (a stub that prints name + version is acceptable; the real command surface is CLI-001).
- [x] Root `package.json` has a `build` script that builds in dependency order: `packages/contract` → `packages/kit` → apps; running it from a clean tree succeeds.
- [x] Root `workspaces` includes `plugins/*`; `plugins/` exists in the repo with a `.gitkeep` (or the first plugin directory) and `npm install` resolves cleanly with the added glob.
- [x] `eslint.config.js` applies typescript-eslint's type-aware rule set to TypeScript source; `disableTypeChecked` is scoped to JS/config files only. Any violations this surfaces are **fixed in the code**, not suppressed (per CLAUDE.md Lint Discipline).
- [x] `vitest.config.ts` still enforces the 90% coverage gate across the new layout: `dist/` is excluded from both `include` globs and coverage, `plugins/*/src/**` tests are collected, and `npm run test:coverage` passes.
- [x] `.githooks/pre-commit` and `.githooks/pre-push` both exit 0 on a clean tree after the change; `.gitignore` still covers the new `dist/` output.
- [x] `npm install && npm run build && npm test` is green from a clean clone (verified in a fresh `git clone` into a temp dir).
- [x] CLAUDE.md's Build & Dev Commands section documents `npm run build` and the build topology if commands changed.

## Technical Design

### Files to Create/Modify

- `package.json` (root) — add `plugins/*` to `workspaces`; add `build` script (and `clean` if useful); keep existing gate scripts intact.
- `tsconfig.base.json` — remove `noEmit` from the shared base (it forces every consumer to fight it); move `noEmit: true` down into the app tsconfigs that genuinely don't emit. Add `declaration`, `declarationMap`, `sourceMap` defaults.
- `packages/contract/package.json` — `main`, `types`, `exports` (`.` and `./client`), `files: ["dist"]`, `build` script (`tsc -p tsconfig.build.json`), keep `typecheck` as `tsc --noEmit`.
- `packages/contract/tsconfig.json` — stays `noEmit` for the typecheck gate (includes tests).
- `packages/contract/tsconfig.build.json` — emit config: `outDir: dist`, `rootDir: src`, excludes `**/*.test.ts`.
- `packages/kit/package.json`, `packages/kit/tsconfig.json`, `packages/kit/tsconfig.build.json` — same pattern (Bundler resolution / DOM libs preserved).
- `apps/cli/package.json` — add `bin`, `build`/`dev` scripts, `tsx` devDependency.
- `apps/cli/bin/corpus.js` — executable entry stub (`#!/usr/bin/env node`), resolves and runs the CLI entry.
- `apps/server/package.json`, `apps/ui/package.json` — `dev` scripts (tsx / vite) as applicable; no emit build for server/ui here beyond what already exists.
- `eslint.config.js` — swap `tseslint.configs.recommended` for `recommendedTypeChecked` on TS source; scope `disableTypeChecked` to `**/*.js` **and** config files; add `**/dist/` to ignores (already present — verify).
- `vitest.config.ts` — include `plugins/**/src/**/*.test.ts`; keep `dist` excluded; coverage `include` already lists `plugins/*/src/**`.
- `plugins/.gitkeep` — create the directory so the workspace glob has something to resolve.
- `CLAUDE.md` — Build & Dev Commands: add `npm run build` and a one-line note on build topology.

### Key Implementation Details

**Build topology.** Only the two shared `packages/*` emit. Apps are never consumed as libraries, so they stay source-run: `apps/server` and `apps/cli` run through `tsx` in development, `apps/ui` builds with Vite. This keeps the dev loop fast and confines emit configuration to two places.

**The `noEmit` trap.** `tsconfig.base.json` currently sets `noEmit: true`, which every workspace inherits. Do not try to override it per-invocation with CLI flags — use a separate `tsconfig.build.json` per emitting package that extends the workspace tsconfig and sets `noEmit: false`, `outDir`, `rootDir`, and excludes tests. The plain `tsconfig.json` keeps `noEmit` so `npm run typecheck` stays a pure check that also covers test files.

**Exports maps.** With `"type": "module"` and NodeNext resolution, the `exports` map must point at emitted `.js` with `types` conditions first:

```jsonc
"exports": {
  ".":        { "types": "./dist/index.d.ts",        "import": "./dist/index.js" },
  "./client": { "types": "./dist/client/index.d.ts", "import": "./dist/client/index.js" }
}
```

Keep `main` and `types` as fallbacks for tooling that ignores `exports`. `packages/contract/src/client/index.ts` may not exist yet (CONTRACT-001 creates it) — if so, create a minimal placeholder module so the subpath resolves rather than shipping a broken export map; CONTRACT-001 will fill it in.

**Workspace linking.** npm workspaces symlink `@corpus/contract` into the root `node_modules` automatically once the package is a workspace member; consumers must still declare it as a dependency (`"@corpus/contract": "*"`) in their own `package.json` for resolution to be honest and for the eventual published package to be correct. Add those dependency entries to `apps/server`, `apps/cli`, and `apps/ui` (and `@corpus/kit` to `apps/ui`).

**Build ordering.** npm workspaces do not topologically sort `--workspaces` runs. Sequence explicitly rather than relying on luck:

```
"build": "npm run build -w packages/contract && npm run build -w packages/kit && npm run build --workspaces --if-present --workspace=apps"
```

If that workspace filter syntax proves awkward, an explicit chain of `-w apps/...` invocations is fine — explicit and correct beats clever.

**Type-aware lint.** Today `eslint.config.js` composes `...tseslint.configs.recommended` (the *non*-type-checked preset) and then hand-enables three type-aware rules, with `disableTypeChecked` applied to `**/*.js`. Move to `...tseslint.configs.recommendedTypeChecked` so the full type-aware set applies to `.ts`/`.tsx`, keep the existing severity philosophy from INFRA-001 (only real-bug-risk rules block; taste-level rules stay warnings — downgrade newly-surfaced noisy rules to `warn` rather than deleting them), and apply `disableTypeChecked` to `**/*.js` plus any config files not covered by the project service. Expect new findings such as `no-unsafe-assignment`, `no-unsafe-member-access`, and `require-await`; fix the code or set the rule to `warn` with a comment explaining why — never an inline `eslint-disable` without justification.

**Coverage gate.** The 90% thresholds must survive: emitted `dist/` must not be counted, and adding `plugins/*` must not drop coverage below the bar when the directory is empty (`passWithNoTests` is already set; an empty `plugins/` contributes no files to the coverage `include` result, which is fine).

**Scope discipline.** This issue creates no product code. Stub entry points are acceptable and expected; CLI-001, UI-001, and CONTRACT-001 supply the real implementations.

### Edge Cases

- **`plugins/` empty at install time.** A `workspaces` glob matching zero directories is harmless for npm, but the directory must exist in git — commit a `.gitkeep`.
- **`dist/` polluting the gates.** `dist/` is gitignored but present on disk after a build; verify ESLint ignores it, Prettier ignores it (`.prettierignore` may need `**/dist/`), Vitest excludes it, and `tsc --noEmit` doesn't pick it up via a stale `include`.
- **Stale `dist/` masking a broken source tree.** `npm run build` should be safe to re-run; consider a `clean` script (`rm -rf packages/*/dist`) and verify a clean-clone build, not just an incremental one.
- **`bin` entry permissions.** The `bin/corpus.js` shim needs the shebang and the executable bit committed (`git update-index --chmod=+x`), otherwise a global install produces a non-executable command.
- **`exports` breaks deep imports.** Once an `exports` map exists, `@corpus/contract/src/whatever` stops resolving. Confirm nothing in the tree relies on a deep import before landing.
- **`verbatimModuleSyntax` + emit.** Type-only imports must use `import type`; declaration emit will surface any that don't. Fix at the import site.
- **Prettier reformatting generated output.** `format:check` must not walk `dist/`.

## Testing Strategy

The build wiring is largely verified by the gates themselves, plus targeted checks:

- **Resolution test (the point of the issue):** a Vitest test in `apps/server` (and one in `apps/cli`) that imports a symbol from `@corpus/contract` and asserts on it. This fails today and passing it is the proof the exports map works. Keep the imported symbol trivial (the existing placeholder export) so the test doesn't couple to CONTRACT-001's eventual API.
- **Gate runs:** `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test:coverage` all pass — the coverage run specifically confirming the 90% thresholds still hold under the new layout.
- **Build idempotence:** `npm run build` twice in a row succeeds; `rm -rf` the `dist/` dirs and rebuild succeeds.
- **Lint regression check:** confirm the type-aware set is genuinely active by temporarily introducing a floating promise in a `.ts` file and observing an error, then removing it (record in the E2E log).

## E2E Verification Plan

### Reproduction Steps (bugs only)

Not a bug — this is enabling work. (The failing cross-package import is a known consequence of INFRA-001's deliberate scope, not a regression.)

### Verification Steps

1. From a scratch directory, `git clone` the working branch into a temp dir (e.g. `$TMPDIR/infra-007-clean`) so nothing from the working tree leaks in.
2. `npm install` in the clone → resolves, including the new `plugins/*` workspace glob.
3. `npm run build` → `packages/contract/dist/` and `packages/kit/dist/` contain `.js` and `.d.ts` files (list them).
4. `npm test` and `npm run test:coverage` → green, coverage thresholds satisfied.
5. `npm run lint`, `npm run format:check`, `npm run typecheck` → all exit 0.
6. Cross-package import proof: run the server/cli test that imports `@corpus/contract` (`npm test -w apps/server`) and additionally execute a real script through `tsx` that imports from `@corpus/contract` and prints a value — captures both the type-level and the runtime resolution path.
7. `bin` proof: `npm pack -w apps/cli` is not required here, but run `node apps/cli/bin/corpus.js --version` (or the stub's output) and confirm it executes; confirm the file mode is `100755` via `git ls-files -s apps/cli/bin/corpus.js`.
8. Hook proof: execute `.githooks/pre-commit` and `.githooks/pre-push` directly; both exit 0.
9. Lint-teeth proof: add a floating promise to a `.ts` file, run `npm run lint` → error; remove it → clean.

## E2E Verification Log

### Post-Implementation Verification

**implemented on: opus.** All commands run from the worktree root
`/Users/theophanerupin/code/corpus/.claude/worktrees/agent-a45effabc600786b6`
against the real repo — no mocks, no stubs. Node v25.2.1, npm 11.6.2.

**1. Install (`npm install`)** — `added 221 packages, and audited 227 packages in 2s`.
The `plugins/*` glob was accepted with no package inside it. `node_modules/@corpus/`
contains links for all five workspaces:

```
cli -> ../../apps/cli          contract -> ../../packages/contract
kit -> ../../packages/kit      server -> ../../apps/server
ui  -> ../../apps/ui
```

**2. Build (`npm run build`)** — contract, kit and cli each ran
`tsc -p tsconfig.build.json`; `apps/server` and `apps/ui` were skipped by
`--if-present`. Emit verified on disk:

```
packages/contract/dist/index.{js,js.map,d.ts,d.ts.map}
packages/kit/dist/index.{js,js.map,d.ts,d.ts.map}
apps/cli/dist/index.{js,js.map,d.ts,d.ts.map}
apps/cli/dist/bin/corpus.{js,js.map,d.ts,d.ts.map}
```

`packages/contract/dist/index.d.ts` contains
`export declare const PACKAGE_NAME = "@corpus/contract";` — declarations are real,
and no `*.test.*` file reached any `dist/`.

**3. Bin.** `apps/cli/dist/bin/corpus.js` line 1 is `#!/usr/bin/env node` — tsc
preserves the shebang. Modes after a build:

```
$ stat -f '%Sp %N' apps/cli/dist/bin/corpus.js apps/cli/dist/index.js
-rwxr-xr-x apps/cli/dist/bin/corpus.js
-rw-r--r-- apps/cli/dist/index.js
```

```
$ ls -la node_modules/.bin/corpus
node_modules/.bin/corpus -> ../@corpus/cli/dist/bin/corpus.js
$ ./node_modules/.bin/corpus
corpus: no commands yet — the command surface arrives with CLI-001.
corpus exit=0
$ npm run --silent dev -w apps/cli          # tsx path, no build involved
corpus: no commands yet — the command surface arrives with CLI-001.
exit=0
$ ./node_modules/.bin/tsx apps/server/src/index.ts
tsx server entry exit=0
```

This exposed a real defect mid-implementation: on the first clean rebuild
`./node_modules/.bin/corpus` failed with
`permission denied ... corpus exit=126`, because `tsc` re-emitted the file at
mode 644 and dropped the exec bit npm had set at install time. Fixed by appending
`chmod +x dist/bin/corpus.js` to the cli build; the `-rwxr-xr-x` above is the
post-fix state after `npm run clean && npm run build`.

**4. Gates, from a fully clean tree** (`npm run clean` first, so every `dist/` was
absent — proves the ordered build is self-sufficient and no gate reads stale output):

```
build      exit=0
typecheck  exit=0     (five `tsc --noEmit` runs)
lint       exit=0     (no output)
format     exit=0     "All matched files use Prettier code style!"
```

`npm test`:

```
✓ packages/contract/src/index.test.ts (1 test)
✓ packages/kit/src/index.test.ts (2 tests)
✓ apps/server/src/index.test.ts (2 tests)
✓ apps/cli/src/index.test.ts (3 tests)
✓ apps/ui/src/index.test.ts (2 tests)
Test Files  5 passed (5)   Tests  10 passed (10)
```

The 6 added tests are the cross-package resolution guards — `@corpus/contract`
imported from server, cli, kit and ui, and `@corpus/kit` imported from ui, each
resolving through the package `exports` map into `dist/`. This is the cross-package
import proof, kept permanently as real tests rather than a deleted scratch file.

**5. Coverage gate (`npm run test:coverage`)** — 100% statements / branches /
functions / lines across all **five** covered source files (the bin shim is
excluded by design, so it does not appear); the 90% thresholds pass, exit 0.

**6. Negative test — is the type-checked preset actually active?** Wrote a
temporary probe `apps/server/src/typed-lint-probe.ts` with an `async` function
containing no `await` and a template literal interpolating an `object`.
`npm run lint` exit 1:

```
1:8   error  Async function 'noAwaitHere' has no 'await' expression   @typescript-eslint/require-await
10:13 error  'value' will use Object's default stringification format @typescript-eslint/no-base-to-string
10:13 error  Invalid type "object" of template literal expression     @typescript-eslint/restrict-template-expressions
✖ 3 problems (3 errors, 0 warnings)
```

All three rules require type information, so the preset is genuinely resolving
projects and not silently degrading to the untyped `recommended`. Probe deleted;
lint back to exit 0.

**7. Negative test — broken exports map.** Temporarily repointed
`packages/contract`'s `exports["."]` runtime conditions at `./dist/nope.js`.
`npm test` exit 1, `Test Files 4 failed | 1 passed (5)`:

```
Error: Failed to resolve entry for package "@corpus/contract". The package may
have incorrect main/module/exports specified in its package.json.
  File: apps/cli/src/index.test.ts:2:54
```

The four failures were exactly the four consumers (server, cli, kit, ui); the
contract's own test still passed. **`npm run typecheck` still exited 0** for the
same broken package, because the `types` condition was untouched — so the compiler
alone would not have caught this. That asymmetry is the argument for keeping the
runtime resolution tests permanently. Restored → 10/10 pass.

**8. Negative test — build ordering and fail-fast.** Introduced a real type error
in `packages/contract/src/index.ts` (`export const PACKAGE_NAME: number = "..."`)
after `npm run clean`.

First measured the originally-written `-w packages/contract -w packages/kit -w apps/cli`
list form: it reported the contract error but **still ran kit and cli afterwards**
(exit 2 overall). Non-blocking output noise, but it buries the root cause, so the
script was changed to an `&&` chain. Re-measured:

```
> npm run build -w packages/contract && npm run build -w packages/kit && ...
src/index.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.
npm error ... workspace @corpus/contract@0.0.0
build exit=2

$ ls -d packages/contract/dist packages/kit/dist apps/cli/dist
ls: apps/cli/dist: No such file or directory
ls: packages/kit/dist: No such file or directory
```

Neither downstream workspace ran — ordering and fail-fast both confirmed.
Source restored → build clean.

**9. Hooks**, executed directly against the real repo:

```
$ bash .githooks/pre-commit
pre-commit ▶ build / eslint / prettier check / typecheck / unit tests
  (5 test files, 10 tests passed)
pre-commit ✓ all checks passed        pre-commit exit=0

$ bash .githooks/pre-push
pre-push ▶ build / eslint / prettier check / typecheck / unit tests
  (5 test files, 10 tests passed)
pre-push ▷ playwright e2e skipped (no specs in apps/ui/e2e/ yet)
pre-push ✓ all checks passed          pre-push exit=0
```

Both hooks now run `build` as their first step, so the cross-workspace imports
resolve before lint/typecheck/tests look at them.

**10. Working tree** — `git status --short` shows only the intended files; no
`dist/`, `coverage/` or `*.tsbuildinfo` leaked past `.gitignore`.

**Conclusion: PASS.** All acceptance criteria verified against real command
invocations, including three negative tests that each failed as designed before
being restored, and one genuine defect (the stripped exec bit) found and fixed
during verification.

**Review-fix addendum (orchestrator, post pr-reviewer round 1).** Two MAJOR
findings fixed: `plugins/**/src/**/*.test.ts` added to the vitest `include`
(tests were coverage-only before), and the `@corpus/contract/client` subpath
now resolves via a placeholder module + `exports` entry + a resolution test in
`apps/cli`. Fresh-clone verification (the plan's step 1, previously evidenced
only from a cleaned worktree): `git clone -b phase-0-contract-first` into a
temp dir → `npm install` (221 packages) → `npm run build` → `npm test` →
**5 files / 11 tests passed** — the build needs no untracked files.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[INFRA-007]` prefix
