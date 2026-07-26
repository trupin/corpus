# [INFRA-007] Package build & exports wiring; plugins workspace; type-aware lint

## Domain

infra

## Status

todo

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

- [ ] `packages/contract` and `packages/kit` each build with `tsc` to `dist/` including `.d.ts` declaration files and source maps; `npm run build -w packages/contract` and `npm run build -w packages/kit` succeed independently.
- [ ] Both packages declare `main`, `types`, `exports` (subpath-capable), and `files` in their `package.json`; `packages/contract` exports at least `.` and `./client` per CONTRACT-001's planned surface.
- [ ] A workspace that imports `@corpus/contract` (a temporary import in `apps/server/src` and `apps/cli/src` is acceptable proof) **typechecks** under `npm run typecheck` and **runs** under `tsx` after `npm run build` — verified with actual command output in the E2E log.
- [ ] `apps/cli/package.json` declares `"bin": { "corpus": "./bin/corpus.js" }` and that entry point exists and executes (a stub that prints name + version is acceptable; the real command surface is CLI-001).
- [ ] Root `package.json` has a `build` script that builds in dependency order: `packages/contract` → `packages/kit` → apps; running it from a clean tree succeeds.
- [ ] Root `workspaces` includes `plugins/*`; `plugins/` exists in the repo with a `.gitkeep` (or the first plugin directory) and `npm install` resolves cleanly with the added glob.
- [ ] `eslint.config.js` applies typescript-eslint's type-aware rule set to TypeScript source; `disableTypeChecked` is scoped to JS/config files only. Any violations this surfaces are **fixed in the code**, not suppressed (per CLAUDE.md Lint Discipline).
- [ ] `vitest.config.ts` still enforces the 90% coverage gate across the new layout: `dist/` is excluded from both `include` globs and coverage, `plugins/*/src/**` tests are collected, and `npm run test:coverage` passes.
- [ ] `.githooks/pre-commit` and `.githooks/pre-push` both exit 0 on a clean tree after the change; `.gitignore` still covers the new `dist/` output.
- [ ] `npm install && npm run build && npm test` is green from a clean clone (verified in a fresh `git clone` into a temp dir).
- [ ] CLAUDE.md's Build & Dev Commands section documents `npm run build` and the build topology if commands changed.

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
- [ ] Committed with `[INFRA-007]` prefix
