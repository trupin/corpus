# TypeScript Guidelines

Shared conventions for **all** Corpus workspaces (`apps/server`, `apps/cli`, `apps/ui`, `packages/contract`, `packages/kit`, `plugins/*`). Every domain agent must read this file before writing code. Domain agents point here instead of duplicating rules — if a rule needs changing, change it here (orchestrator approval required, since it affects every domain).

## Language & module system

- **TypeScript everywhere.** No `.js`/`.mjs` source files anywhere, including the CLI and scripts (`scripts/*.ts` run via `tsx`). The only JS files in the repo are config files that tooling requires as JS.
- **ESM only.** `"type": "module"` in every package.json. No `require`, no `__dirname` (use `import.meta.dirname`).
- `moduleResolution: "bundler"` for Vite-built workspaces (`apps/ui`, `packages/kit`), `"nodenext"` for Node workspaces (`apps/server`, `apps/cli`, `packages/contract`). In nodenext workspaces, relative imports include the `.js` extension (TS compiles `.ts` → `.js` specifiers).

## Strictness

- `strict: true` plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `exactOptionalPropertyTypes` (all set in the root `tsconfig.base.json` — never weakened per-workspace).
- **No `any`.** Use `unknown` at trust boundaries and narrow with Zod or type guards. `as` casts are a last resort and require a comment explaining why the type system can't express the truth.
- **No non-null assertions (`!`).** Handle the null case or restructure so it can't occur.
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
- **Never fix a lint warning by disabling the rule.** Fix the code. An inline suppression is a last resort and carries a justification comment.

## Comments

- Comments state constraints the code can't show (invariants, protocol quirks, why-not-the-obvious-way). No narration of what the next line does, no changelog commentary.
