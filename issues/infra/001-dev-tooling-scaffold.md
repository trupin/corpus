# [INFRA-001] Dev tooling scaffold: monorepo, lint/typecheck/test, git hooks

## Domain

infra

## Status

done

## Priority

P0

## Dependencies

- Depends on: —
- Blocks: all implementation work (the gates exist before the code does)

## Spec References

- SPEC.md §14 (validation and git hooks) — mechanism adopted; commands adapted to the TS monorepo
- CLAUDE.md — Build & Dev Commands, Architecture Decision 7 (Vitest)

## Summary

Stand up the development gates before any product code exists: npm-workspaces monorepo (`apps/server`, `apps/cli`, `apps/ui`, `packages/contract`, `packages/kit`) with strict shared tsconfig, ESLint (flat, typescript-eslint, type-checked) + Prettier, root Vitest, a Playwright config stub, and versioned `.githooks/` wired via `npm run setup-hooks`. Pre-commit runs the full gate (lint + format + typecheck + unit tests) per explicit user decision; pre-push adds Playwright e2e (auto-skipped until specs exist).

## Acceptance Criteria

- [x] `npm install` succeeds; `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test` all pass from a clean tree.
- [x] Each workspace has a placeholder module + test proving the pipeline reaches it (5/5 workspaces tested).
- [x] `.githooks/pre-commit` runs lint + format + typecheck + unit tests; `.githooks/pre-push` additionally runs (or explicitly skips) e2e.
- [x] `npm run setup-hooks` sets `core.hooksPath` to `.githooks`.
- [x] A type error anywhere blocks the pre-commit hook (verified, see log).

## Technical Design

### Files to Create/Modify

- `package.json`, `tsconfig.base.json`, `eslint.config.js`, `vitest.config.ts`, `.prettierrc.json`, `.prettierignore`, `.gitignore`
- `apps/{server,cli,ui}/`, `packages/{contract,kit}/` — package.json, tsconfig.json, placeholder src + test
- `apps/ui/playwright.config.ts`, `apps/ui/e2e/` (empty)
- `.githooks/pre-commit`, `.githooks/pre-push`

### Key Implementation Details

Strictness flags per `docs/TS_GUIDELINES.md` live only in `tsconfig.base.json`. Node workspaces use NodeNext resolution; Vite-built workspaces (ui, kit) use Bundler. ESLint uses `recommendedTypeChecked` with `projectService` (root `*.config.ts` via `allowDefaultProject`). Root Vitest config globs all workspace tests. Hooks run all steps even after a failure so one run reports everything.

### Edge Cases

- No e2e specs yet: pre-push prints an explicit skip line rather than failing on "no tests found".
- Prettier ignores `SPEC.md`, `issues/`, `design/`, and future generated contract files.

## Testing Strategy

The scaffold is its own test: all four gate commands pass; placeholder tests prove each workspace is reached.

## E2E Verification Plan

### Verification Steps

1. `npm install` → clean.
2. Run each gate command; all pass.
3. Execute both hook scripts directly; both exit 0.
4. Introduce a deliberate type error; pre-commit must exit non-zero; remove it; exit 0.

## E2E Verification Log

### Post-Implementation Verification

2026-07-26, real commands against the real repo (no mocks):

- `npm install` — completed (workspaces resolved; only npm audit noise).
- `npm run typecheck` — `tsc --noEmit` ran in all 5 workspaces, exit 0.
- `npm run lint` — exit 0 after adding `allowDefaultProject: ["*.config.ts"]` for root `vitest.config.ts` (initial run failed with "not found by the project service" — fixed the config, not the rule).
- `npm run format:check` — "All matched files use Prettier code style!"
- `npm test` — Vitest: `Test Files 5 passed (5), Tests 5 passed (5)` across apps/server, apps/cli, apps/ui, packages/contract, packages/kit.
- `.githooks/pre-commit` → "pre-commit ✓ all checks passed", exit 0. `.githooks/pre-push` → all steps pass, "playwright e2e skipped (no specs in apps/ui/e2e/ yet)", exit 0.
- Negative test: wrote `apps/server/src/bad.ts` with `export const bad: number = "not a number";` → `.githooks/pre-commit` exit **1**; removed the file → exit **0**.
- `npm run setup-hooks` → `git config core.hooksPath` prints `.githooks`.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[INFRA-001]` prefix (pending — user has staged spec changes; commit ordering is theirs to call)
