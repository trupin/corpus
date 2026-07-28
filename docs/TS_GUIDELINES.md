# TypeScript Guidelines

Shared conventions for **all** Corpus workspaces (`apps/server`, `apps/cli`, `apps/ui`, `packages/contract`, `packages/kit`, `plugins/*`). Every domain agent must read this file before writing code. Domain agents point here instead of duplicating rules — if a rule needs changing, change it here (orchestrator approval required, since it affects every domain).

## Language & module system

- **TypeScript everywhere.** No `.js`/`.mjs` source files anywhere, including the CLI and scripts (`scripts/*.ts` run via `tsx`). The only JS files in the repo are config files that tooling requires as JS.
- **ESM only.** `"type": "module"` in every package.json. No `require`, no `__dirname` (use `import.meta.dirname`).
- `moduleResolution: "bundler"` for Vite-built workspaces (`apps/ui`, `packages/kit`), `"nodenext"` for Node workspaces (`apps/server`, `apps/cli`, `packages/contract`). In nodenext workspaces, relative imports include the `.js` extension (TS compiles `.ts` → `.js` specifiers).

## Strictness

- `strict: true` plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes` (all set in the root `tsconfig.base.json` — never weakened per-workspace).
- **Avoid `any`.** Use `unknown` at trust boundaries and narrow with Zod or type guards. `as` casts are a last resort and require a comment explaining why the type system can't express the truth. (Lint warns on `any` without blocking — treat warnings as debt to burn down, not noise.)
- **Avoid non-null assertions (`!`).** Handle the null case or restructure so it can't occur.
- No `@ts-ignore` / `@ts-expect-error` without an explanatory comment and no other option.

## Trust boundaries & validation

- **Zod is the validation layer.** Every piece of data crossing a process boundary — HTTP request/response, CLI args, file contents (frontmatter, queue events, config), environment variables — is parsed with a Zod schema before use. Internal function calls trust their types; boundaries never do.
- Schemas that define the HTTP API live in `packages/contract` and nowhere else. Server and CLI import them; they never redeclare shapes.
- Derive types from schemas (`z.infer<typeof X>`), not the other way around. A hand-written type duplicating a schema is a bug.

## Errors & async

- Throw `Error` subclasses with a stable `name`; never throw strings or bare objects.
- Never silently swallow a catch. Either handle it meaningfully, rethrow with context (`new Error("...", { cause: err })`), or let it propagate.
- No floating promises (`@typescript-eslint/no-floating-promises` is an error). `void somePromise` requires a comment.
- Prefer `async/await` over `.then()` chains.

## Code organization

- **Colocate by feature, not by kind.** A feature's implementation, types, helpers, and tests live in the same directory. Ask: "can two agents work on two features without touching the same files?"
- Keep types and constants next to the code that uses them. `utils.ts` grab-bags are forbidden; a shared helper earns a named module (`slug.ts`, `time.ts`).
- **Respect the dependency direction** (see CLAUDE.md): `packages/contract` ← `apps/server` / `apps/cli` / `packages/kit`; `packages/kit` ← `apps/ui`; `plugins/*` import only `@corpus/kit` and `@corpus/contract`. Never import upstream; never deep-import another workspace's `src/` (use its package entry points).
- Named exports only. Default exports are allowed solely where a framework requires them (e.g. config files, React lazy routes).

## Building & cross-workspace imports

- `packages/contract`, `packages/kit` and `apps/cli` are **built** (`tsc -p tsconfig.build.json` → `dist/`, with declarations and source maps). Each workspace keeps two tsconfigs: `tsconfig.json` (typecheck only, includes tests) and `tsconfig.build.json` (emit, tests excluded). `apps/server` and `apps/ui` are still run from source in dev (`tsx` / Vite); their build steps arrive with their scaffolding issues.
- **`@corpus/*` imports resolve through the `exports` map into `dist/`, not into `src/`.** Consequence: `npm run build` must run before `npm run typecheck`, `npm run lint` and `npm test` — the git hooks and CI do this for you; do it by hand when you run a gate directly after editing a package others import.
- Build order is dependency order — `contract` → `kit` → apps — encoded in the root `build` script. A new workspace goes into that list at the right position.
- Adding a cross-workspace import means adding the `@corpus/*` package to that workspace's `dependencies` (`"*"` range) so npm links it. Respect the dependency direction above.

## Naming

- Files: `kebab-case.ts`. React components: `PascalCase.tsx`.
- Types/interfaces/enums: `PascalCase` (no `I` prefix). Values/functions: `camelCase`. Env vars and true constants: `SCREAMING_SNAKE_CASE`.
- Zod schemas: `PascalCase` ending in `Schema` (`DocSchema`), with the inferred type dropping the suffix (`type Doc = z.infer<typeof DocSchema>`).

## Testing

- **Vitest** for unit/integration tests, colocated as `<name>.test.ts` next to the code under test.
- Test through public entry points; don't export internals solely to test them.
- Table-driven tests (`it.each`) for parse/serialize round-trips and edge-case matrices.
- **Playwright** for e2e, in `apps/ui/e2e/*.spec.ts` only — e2e runs against the real app (real server, real files), never mocks.
- A bug fix lands with a regression test that fails before the fix.

## Lint & format

- ESLint (flat config, typescript-eslint) + Prettier, configured at the repo root. `npm run lint` and `npm run format:check` must pass — they run in pre-commit.
- TS source is linted with the **type-checked** preset (`recommendedTypeChecked`, resolved via `projectService`), so rules that need type information — `no-base-to-string`, `only-throw-error`, `unbound-method`, `no-implied-eval` — are live. `disableTypeChecked` applies only to JS config files, which have no tsconfig project.
- **Only critical rules block** (deliberate policy): the curated error set targets real bug risk — async safety (`no-floating-promises`, `no-misused-promises`, `await-thenable`) and unexplained compiler-error suppression (`ban-ts-comment`) — on top of the upstream `recommended`/`recommendedTypeChecked` presets, which are mostly correctness rules (the few stylistic ones they carry, like `prefer-const`/`no-var`, are auto-fixable via `npm run lint:fix` and never require judgment). Anything needing taste or judgment lives in this document and code review; useful-but-not-critical signals (`no-explicit-any`, `no-unused-vars`) are warnings that never block a commit — as is the `no-unsafe-*` family, which is the downstream half of `no-explicit-any` and blocks in the same cases that rule deliberately only warns about.
- **Never fix a lint error by disabling the rule.** Fix the code. An inline suppression is a last resort and carries a justification comment.

## Coverage

- Combined coverage — Vitest **plus** the Playwright suite's browser-side V8 — must stay **≥ 90%** on lines, statements, functions and branches. `npm run coverage` runs the whole chain (unit → e2e → merge → gate) and is what CI enforces; `npm run test:coverage` on its own emits raw coverage and enforces nothing. The thresholds and the include/exclude globs live in `scripts/coverage-config.ts` and nowhere else, so there is exactly one gate and it cannot disagree with itself.
- The merge is `scripts/merge-coverage.ts`. The unit run's istanbul map is the structure — totals never move, so a file no test loads still reports 0% — and the browser run contributes hits onto it: an item counts as covered when every line it spans was fully executed in the browser. Coverage can therefore only rise by adding e2e, never fall. `coverage/merged/e2e-attribution.json` records what the browser actually reached per file, which is how you tell "e2e added nothing because unit already covers it" from "e2e added nothing because the source maps broke".
- Code exercised only through the browser counts. A Node process an e2e spec spawns counts too, once it is spawned with `nodeCoverageEnv()` from `apps/ui/e2e/coverage.ts` (`NODE_V8_COVERAGE`); nothing in the shipped suite spawns one yet.
- Write code to be testable rather than chasing the number after the fact; untestable glue belongs in thin, excluded entry points, not scattered through logic.

## Comments

- Comments state constraints the code can't show (invariants, protocol quirks, why-not-the-obvious-way). No narration of what the next line does, no changelog commentary.
