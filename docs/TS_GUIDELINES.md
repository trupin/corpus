# TypeScript Guidelines

Shared conventions for **all** Corpus workspaces (`apps/server`, `apps/cli`, `apps/ui`, `packages/contract`, `packages/kit`). Every domain agent must read this file before writing code. Domain agents point here instead of duplicating rules — if a rule needs changing, change it here (orchestrator approval required, since it affects every domain).

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
- **Respect the dependency direction** (see CLAUDE.md): `packages/contract` ← `apps/server` / `apps/cli` / `packages/kit`; `packages/kit` ← `apps/ui`. Never import upstream; never deep-import another workspace's `src/` (use its package entry points). `apps/ui` reaches the server only through `@corpus/kit` — never `@corpus/contract/client`, which builds a transport that bypasses the kit's cache. ESLint enforces that last one.
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

### When a test goes red and you suspect the machine (INFRA-020)

**Establish the cause before touching a timeout.** A longer number is the last step, never the first, and three of the four things that look like load are not load. Work down this list in order and stop at the first that matches.

1. **Did it fail on an uncontended run?** Then it is not load-sensitive. It is racy, and the product may be too. UI-033 was filed as a race for two releases and was a product defect that failed _every_ run once the transition it raced was waited out. SERVER-060 was the same shape and was a torn read in the queue.
2. **Did the run itself take an abnormal wall-clock time?** A normal `apps/server` run on the maintainer's machine is ~140 s. At 450–475 s the suite is not measuring the code. Sets of failures that are **disjoint between two runs of the same tree** are the signature of contention — a single stable failure is not.
3. **Is it slow rather than load-sensitive?** These are different faults with different fixes, and `--repeat-each` on a busy box cannot tell them apart. Measured here: two `apps/server` tests sat at 87% and 81% of their budget and moved less than 250 ms between load average 6 and load average 45. A repeat sweep would have called them stable. The question that separates them is **what fraction of its budget does it use, and does that fraction move when the machine gets busy.**
4. **Only then size a budget** — and only when the time is genuine work that is the point of the test.

**The rule for the budget itself.** A test at or above **50% of its own timeout, measured under contention, is a gate risk.** The threshold is derived, not picked: the worst load multiplier measured in this repository is ~1.7× (`docs/bulk.test.ts`, 2338 ms idle → 4056 ms at load average 45), a test survives that at any fraction below 1/1.7 = 0.588, and 50% is the round number under it. Size a new budget at **at least twice the measured-under-contention time**, and round up rather than sitting on the line. INFRA-020 originally proposed ">20% when idle". Measured over a real 4675-test `apps/server` run under a load average of 19–25, that threshold flags **33 tests** and 50% flags **one** — and a rule nobody follows is worse than none.

**Write the measurement and the reason beside the number.** `apps/server/src/docs/bulk.test.ts:141` is the model answer: what it measured, why the work is the point of the test, and why it was given room rather than trimmed. A bare `}, 20_000)` is not a diagnosis — it is the diagnosis being skipped, and the next reader cannot tell which.

**Where the slow time is not the test's own work, say so and name the real remedy.** A 4 s test is a gate risk whether the 4 s is its own wait, its neighbours' one-time warm-up, or genuine load-sensitive cost — and only the third wants a bigger number. The first two want the wait removed or the warm-up moved into a `beforeAll`, and a budget is a stopgap until then.

`npm run test:slow` measures the whole suite and lists every test at or above the threshold **of its own declared budget**, so a diagnosed test reports clean. It reports and does not block: the numerator is wall-clock time on a shared machine, and a blocking form would go red because a runner was busy — the exact failure this section exists to stop. Do not hand-roll the sweep with grep: `[0-9]{4,}` does not match `20_000` across the numeric separator, which is how the model answer above was missed once already.

### Two tests that never failed are not two tests that work

- **A stabilisation that changes the gesture rather than the wait is a bug report.** If a test only passes once you give the user a second click, the product needs the first one to work (UI-033).
- **A claim in a test's prose that the test does not assert is an untested claim.** `comments-tab.spec.ts` said "expanded and flashing" and asserted only the expansion (UI-046). The prose is where to look for these.
- **A test that has never failed is not evidence either.** UI-080's clipboard assertion — "both flavours are present" — stayed true while the copy carried the whole page's chrome. Where you are about to add a wait, first **force the condition the wait would hide**: blur the surface, park the pointer, render under `StrictMode`. If the suite still passes, it is not watching, and the wait would make that permanent.

## Lint & format

- ESLint (flat config, typescript-eslint) + Prettier, configured at the repo root. `npm run lint` and `npm run format:check` must pass. Since INFRA-025 the hooks run them **scoped to the diff** — the whole-repo run is CI's — so a violation in a file you did not touch surfaces in CI, not locally.
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
