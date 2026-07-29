# [CONTRACT-015] Graduate plugin-facing types into `@corpus/contract`

## Domain

contract

## Status

done

## Priority

P1

## Model

opus — type relocation along the existing dependency direction; the shapes already exist.

## Dependencies

- Depends on: CONTRACT-002
- Blocks: PLUGINS-002

## Spec References

- SPEC.md §10 — plugin system; plugins import only `@corpus/kit` + `@corpus/contract`
- CLAUDE.md — Repository Structure (dependency direction)
- issues/evals/PLUGINS-001-eval.md — open question 2 (2026-07-28)

## Summary

Filed from PLUGINS-001's evaluation (2026-07-28). A typed plugin currently cannot import the types
its own server routes and CLI commands receive: `PluginServerContext` lives in
`apps/server/src/plugins/context.ts` and `CommandSpec` in the CLI registry — both forbidden imports
for `plugins/**` (kit + contract only). `plugins/_fixture` gets away with structural typing;
PLUGINS-002's todos plugin should not have to.

Move (or re-export) the plugin-facing **type surface** into `@corpus/contract` so a plugin's
`server/routes.ts` and `cli/commands/*.ts` can be fully typed within the allowed imports:

- `PluginServerContext` (doc read/write services + `broadcastInvalidate`) — type only; the
  implementation stays in `apps/server`.
- `CommandSpec` / `CommandContext` (and whatever minimal registry types a plugin command module
  needs) — type only; validation and dispatch stay in `apps/cli`.

Server and CLI implement these imported types (`satisfies`/explicit annotations) so drift is a type
error on the implementing side, keeping the contract package dependency-free of server/cli code.
`@corpus/kit`'s `PluginManifest` stays in kit (it is a React-coupled UI contract).

## Acceptance Criteria

- [x] `@corpus/contract` exports the plugin-facing types; `apps/server` and `apps/cli` consume them
      as their implementation types (no duplicated shapes).
- [x] `plugins/_fixture`'s `server/routes.ts` and `cli/commands/*` are explicitly typed via
      `@corpus/contract` imports, and the boundary lint rules still pass.
- [x] No runtime code moves; generated artifacts unchanged or regenerated idempotently.

## Technical Design

_As implemented (sprint-013 Adjudication 16 — graduate a reduced structural surface)._

**New types-only subpath `@corpus/contract/plugin`** (`packages/contract/src/plugin/`, published as
a third `exports` entry, deliberately off the root barrel — the `@corpus/kit/plugin` precedent):

| Module      | Exports                                                                                                                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server.ts` | `PluginServerContext`, `PluginLogger`, `PluginLogFields`                                                                                                                                                                            |
| `cli.ts`    | `PluginCommandSpec`, `PluginCommandContext`, `PluginCommandArgs`, `PluginCommandFlags`, `PluginCommandOutput`, `PluginCommandWorkspace`, `PluginCommandClient`, `PluginFlagSpec`, `PluginArgSpec`, `PluginExample`, `PluginFlagType` |

- The context types are **narrowed structural views**, not the CLI's internals: `args`/`flags` are
  plain-object views of what `ParsedArgs`/`ParsedFlags` answer (those classes carry `#private`
  fields and are nominally typed), `workspace` is the two-field `{baseUrl, token}`, `out` is the
  two-method `{emit, line}`, and `client` is an injected `{baseUrl}` capability — never the
  generated typed client, which stays lint-forbidden to plugins.
- `Logger` is **not** dragged in: a minimal `PluginLogger` (three methods, no `level`, no sink) is
  declared contract-side, because `apps/server/src/logger.ts` also exports sinks touching
  `process.stdout` and this package is reachable from browser bundles.
- Nothing else moves. `PluginRoutesFactory`, `PluginContextDeps`, `DocsWorkspace`, `DocumentMutex`
  and `createPluginContext` stay in `apps/server`; `CommandContext`, `WorkspaceCommandContext`,
  `TopicSpec`, `Registry`, `validateRegistry`, the dispatcher and the error classes stay in
  `apps/cli`.

**Adapter wiring (type-level only — no runtime adapter exists, because none is needed):**

- `apps/server/src/plugins/context.ts` imports and re-exports `PluginServerContext` and keeps
  `createPluginContext`'s annotated return type; the server's `Logger` satisfies `PluginLogger`
  structurally.
- `apps/cli/src/registry/types.ts` aliases the pure-data types (`FlagType`/`FlagSpec`/`ArgSpec`/
  `Example`), derives `CommandSpecBase` as `Omit<PluginCommandSpec, "handler">`, and carries two
  compile-time assertions: `WorkspaceCommandContext` is assignable to `PluginCommandContext`, and
  `PluginCommandSpec` is assignable to `CommandSpec`.

**Boundary rule**: exactly one negation string added to `eslint.config.js` —
`"!@corpus/contract/plugin"`. `@corpus/contract/client` stays banned.

## E2E Verification Log

**implemented on: opus** (contract-dev, 2026-07-28). Worktree
`.claude/worktrees/agent-a8a54b7d29d68d915` off phase HEAD `01c997d`. Port `9118`, scratch
`/tmp/corpus-s013-contract015-SYIK6d` (deleted at the end, by captured path). `npm install` once,
`npm run build` once (plus two rebuilds forced by the negative controls below).

### Files changed

`packages/contract/package.json` · `packages/contract/src/plugin/{index,cli,server}.ts` (new) ·
`packages/contract/src/plugin/index.test.ts` (new) · `apps/server/src/plugins/context.ts` ·
`apps/cli/src/registry/types.ts` · `apps/cli/src/registry/types.test.ts` (new) ·
`plugins/_fixture/server/routes.ts` · `plugins/_fixture/cli/commands/add.ts` · `eslint.config.js` ·
`scripts/eslint-boundaries.test.ts`. No route, schema or endpoint touched; no logic changed in
`apps/*`; `apps/ui` and `packages/kit` untouched.

### Gates (exit codes read from the tool, never a pipeline)

| Command                                                                             | Exit | Result                                                              |
| ----------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------- |
| `npm run build`                                                                     | 0    | contract → kit → `_fixture` plugin → cli → ui                       |
| `npm run typecheck` (6 workspaces + `scripts/`)                                     | 0    | contract, kit, cli, server, ui, `_fixture` all clean                |
| `npm run lint`                                                                      | 0    | no errors, no new warnings                                          |
| `npm run format:check`                                                              | 0    | (one prettier fix applied to `plugin/index.ts` first)               |
| `vitest run packages/contract`                                                      | 0    | **39 files, 1191 tests** — `openapi`/`request-body-required`/`request-defaults`/`index`/`inventory`/`routes` invariants green and unweakened |
| `vitest run packages/contract/src/plugin apps/cli/src/registry apps/server/src/plugins plugins/_fixture` | 0 | 7 files, 83 tests                                    |
| `vitest run scripts/eslint-boundaries.test.ts`                                      | 0    | **8 tests** (was 5; 3 added)                                        |
| `vitest run apps/cli/src/{docs,help,dispatch,run,parse-args}`                        | 0    | 5 files, 100 tests — registry consumers unaffected by the aliasing  |

### Generated artifacts — no diff at all

`node --import tsx scripts/check-generated-artifacts.ts` run **twice**, both `exit=0`, both arms
(regenerate-and-compare **and** `git diff --stat HEAD`) green — a types-only subpath is not OpenAPI
surface and `_`-prefixed plugin topics are filtered out of `docs/cli.md`, so nothing regenerated:

```
✓ API contract is up to date (packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts).
✓ CLI reference is up to date (docs/cli.md).
```

sha256 after both runs: `39ae2954…8124` `openapi.json` · `99e289e7…e51e6` `schema.generated.ts` ·
`b330d873…3643a` `docs/cli.md`.

### Negative controls — every new guard was seen to fire

1. **The eslint allowlist is load-bearing.** Removed `"!@corpus/contract/plugin"`, re-ran the probe:
   `× admits @corpus/contract/plugin` →
   `'@corpus/contract/plugin' import is restricted from being used by a pattern. Plugins may import only @corpus/kit and @corpus/contract`.
   Restored; 8/8 green again. The `/client` probe rejects in both states.
2. **The type assertions are load-bearing.** Added a required member to each graduated interface
   (`PluginCommandContext.drifted`, `PluginServerContext.driftedMethod`), rebuilt the contract:
   - `apps/cli` typecheck exit **2** — `src/registry/types.ts(119,3): error TS2344: Type 'WorkspaceCommandContext' does not satisfy the constraint 'PluginCommandContext'`
   - `apps/server` typecheck exit **2** — `src/plugins/context.ts(102,3): error TS2741: Property 'driftedMethod' is missing in type '{ plugin: string; logger: Logger; … }' but required in type 'PluginServerContext'`

   Restored, rebuilt, `npm run typecheck` exit 0. Drift is a type error **on the implementing side**,
   as the issue requires.
3. **PLUGINS-002 is unblocked, provably (TEST-156).** Wrote a throwaway
   `plugins/_fixture/contract015-probe.tmp.ts` declaring a fully typed `PluginServerContext` routes
   factory (list + create + `broadcastInvalidate`) and a `satisfies PluginCommandSpec` verb using
   `args`/`flags`/`out`/`workspace`/`client`/`actor`/`cwd`/`version`, importing only
   `@corpus/contract`, `@corpus/contract/plugin` and `hono`. `npm run typecheck -w corpus-plugin-fixture`
   exit 0, `eslint <probe>` exit 0. Deleted afterwards (`ls plugins/_fixture` confirms).

### E2E against a real server on 9118

`9118` and `8765` verified unbound first. Workspace created from source —
`node --import tsx apps/cli/src/bin/corpus.ts init $SCRATCH/ws --port 9118 --json` — server started
with the from-source CLI (pid `86791`), never `npx`.

1. **The retyped plugin route mounts and answers.**
   `curl -sS -H "Authorization: Bearer …" http://127.0.0.1:9118/api/x/_fixture/notes` → `{"notes":[]}`.
2. **The retyped CLI verb round-trips.**
   `corpus _fixture add "Try the fixture" --workspace … --from agent --json` → exit 0,
   `{"id":"doc_7tsrwnl7","title":"Try the fixture"}` (exactly one JSON value). Human mode:
   `created fixture note doc_poxxdte4 — Second fixture note`, exit 0. Note the verb is loaded from
   the plugin's **compiled** `dist/cli/commands/add.js`, so the graduated types are exercised through
   the built artifact, not only the source.
3. **The write went through the core path.** File on disk
   `data/docs/inbox/try-the-fixture.md` with `id: doc_7tsrwnl7`, `type: fixture-note`; projection
   `GET /api/docs/doc_7tsrwnl7` returns the same frontmatter; `git -C <ws> log`:
   ```
   user  | doc create: Third fixture note (doc_extbx5v4) by user
   user  | doc create: Second fixture note (doc_poxxdte4) by user
   agent | doc create: Try the fixture (doc_7tsrwnl7) by agent   ← --from agent, via the graduated context's `actor`
   user  | workspace: initialize corpus workspace by user
   ```
4. **SSE invalidation still fires, namespaced.** Listening on `/events`, a third add produced:
   ```
   event: invalidate
   data: {"keys":[["docs"],["docs","doc_extbx5v4"],["tree"]]}

   event: invalidate
   data: {"keys":[["x","_fixture","notes"]]}
   ```
   — the core write path's keys plus the plugin's own, i.e. `broadcastInvalidate` through the
   graduated `PluginServerContext` is intact.
5. **Listing after the writes** returns the three notes. Server stopped with
   `corpus server stop` (exit 0, `{"stopped":true,…}`); `lsof` shows nothing on `9118` or `8765`.
   The background SSE `curl` processes were killed by recorded pid (`2737`, `3419`).

### Deviations and judgement calls (recorded, not silent)

- **TEST-142, partial by ruling.** `FlagSpec`/`ArgSpec`/`Example`/`FlagType` graduate and are
  **aliased** by `apps/cli` (one declaration, no duplicate). `CommandSpec`'s declarative half
  graduates as `PluginCommandSpec` and the CLI derives `CommandSpecBase` from it with `Omit`. But
  **`TopicSpec` and `Registry` deliberately stay in `apps/cli`**: a plugin declares neither — its
  topic is derived from its directory name by the scanner, and the registry is the whole tool's
  surface — and their `commands` are the CLI's `WorkspaceCommandSpec | StandaloneCommandSpec` union,
  so publishing them would mean publishing a second, plugin-shaped copy: exactly the duplication
  this issue removes. Adjudication 16 ("plugin-facing interfaces, not the CLI's internals") governs.
- **TEST-143, `client` capability.** Adjudication 16 asks for the client as an injected capability.
  It is published as `PluginCommandClient = { readonly baseUrl }` — the largest slice of `CliClient`
  that names no `@corpus/contract/client` type. A richer, pre-authenticated request helper would
  require new runtime wiring in `apps/cli/src/run.ts`, which TEST-153 forbids ("zero behavioural
  changes in … any server/CLI logic"); the docblock says so and names widening it as a CLI change
  with its own issue. `workspace.token` remains how a verb authenticates today, as the fixture does.
- **TEST-141.** `PluginRoutesFactory` was **not** graduated, with the reason recorded in
  `plugin/index.ts`: it is `(context) => unknown` guarded by a runtime duck-type, so publishing it
  types nothing for an author whose own `routes.ts` states its `Hono` return directly.
- **TEST-153, two additions beyond the enumerated file list**, both test-only:
  `packages/contract/src/plugin/index.test.ts` and `apps/cli/src/registry/types.test.ts`. No
  production file outside the list was touched.
- **Log location.** The harness refuses writes outside this agent's worktree, so this log was
  written to the worktree copy of the issue file (`.claude/worktrees/agent-a8a54b7d29d68d915/issues/contract/015-plugin-facing-types.md`)
  for the orchestrator to harvest, not to the shared checkout.

### Cleanup

Scratch `/tmp/corpus-s013-contract015-SYIK6d` removed by captured path (no glob); the pre-existing
`/tmp/corpus-*` directories were not touched. No server, SSE, vitest or Vite process left running;
`9118`, `9115`–`9119` and `8765` unbound.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
