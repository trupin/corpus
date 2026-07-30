# Evaluation: CONTRACT-015

**Date**: 2026-07-28
**Sprint**: sprint-013 (commit `cdc5f4e`, branch `phase-4-agent-loop`)
**Verdict**: **PASS** (22 of 22 numbered criteria)

Verified against the committed generated artifacts, the published type surface
(`packages/contract/dist/plugin/*.d.ts`), the boundary-lint probes, a real server on `9126` running
the retyped `_fixture` plugin, and a throwaway fully-typed plugin probe written and deleted by the
evaluator.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                    |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Gate table with exit codes, three negative controls, a real E2E section, and a deviations section.                       |
| Commands are specific and concrete      | PASS   | Named test counts, exact TS error codes and file:line, exact SSE frames, exact doc ids.                                  |
| Real E2E (not mocked)                   | PASS   | Real workspace + server on `9118`, real plugin route, real CLI verb loaded from the plugin's **compiled** `dist`.        |
| Scenarios cover acceptance criteria     | PASS   | TEST-137…158 all addressed, including the two it deviates on (141, 142) with reasons.                                    |
| Application restarted after changes     | PASS   | `npm run build` before the E2E; server started from source and stopped; two rebuilds forced by the negative controls.    |
| Actual model recorded (implemented on:) | PASS   | "**implemented on: opus** (contract-dev, 2026-07-28)" — TEST-158 satisfied.                                              |
| Reproduction logged before fix (bugs)   | N/A    | Type-graduation issue.                                                                                                   |

## Criteria Results

| #   | Criterion                                            | Result                        | Notes                                                                                                                                                                        |
| --- | ---------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 137 | Graduated types live on a subpath, not the barrel     | PASS                          | `packages/contract/package.json` exports `"."`, `"./client"`, `"./plugin"`, `"./package.json"`. `grep plugin packages/contract/src/index.ts` → nothing: the root barrel is untouched. The `@corpus/kit/plugin` precedent is followed, not reinvented. |
| 138 | `PluginServerContext` is the server's implementation type | PASS                      | Defined once, in `packages/contract/src/plugin/server.ts`; `apps/server/src/plugins/context.ts` imports it and annotates `createPluginContext`. Drift is a type error **on the server side** — the agent's negative control adding `driftedMethod` produced `apps/server` typecheck exit 2 with `TS2741 … missing in type … but required in type 'PluginServerContext'`. |
| 139 | The move drags no server runtime into the contract     | PASS                          | `packages/contract/src` contains **zero** imports from `apps/*`, `@corpus/server`, `@corpus/cli`, `@corpus/kit`, `better-sqlite3`, `chokidar` or `react` (only prose mentions). Its dependencies remain `@hono/zod-openapi`, `hono`, `openapi-fetch`, `zod`. `Logger` was **not** dragged in: the published surface declares a minimal `PluginLogger` with three methods, no level, no sink. The only `node:fs` uses are pre-existing artifact-generation code, not on the plugin surface. |
| 140 | Server-only companions stay in `apps/server`          | PASS                          | The published `plugin/server.d.ts` exports exactly `PluginLogFields`, `PluginLogger`, `PluginServerContext` — no `PluginContextDeps`, no `DocsWorkspace`, no `DocumentMutex`, no `createPluginContext`, no `PluginRoutesFactory`.                     |
| 141 | Hono is not dragged onto the plugin surface            | PASS (deviation recorded)     | `PluginRoutesFactory` was deliberately **not** graduated, with the reason recorded in `plugin/index.ts`: it is `(context) => unknown` guarded by a runtime duck-type, so publishing it types nothing for an author whose `routes.ts` states its own return. The evaluator's probe confirms a plugin can declare a fully typed factory itself. |
| 142 | The pure-data registry types graduate                  | PASS (Adjudication 21)        | `PluginFlagSpec`, `PluginArgSpec`, `PluginExample`, `PluginFlagType`, `PluginCommandSpec` are published and **aliased** by `apps/cli/src/registry/types.ts` (one declaration, no duplicate shape). `TopicSpec`/`Registry` deliberately stay in `apps/cli` — the literal list yields to Adjudication 16's principle, exactly as Adjudication 21 rules. |
| 143 | `CommandContext` graduated as a **narrowed** interface  | PASS                          | Published `PluginCommandContext` is structural: `args {get,optional}`, `flags {boolean,string,number,strings}`, `out {emit,line}`, `workspace {baseUrl,token}`, `client {baseUrl}`, plus `actor`, `cwd`, `env`, `version`. No `#private` classes, no `node:fs`, no `@corpus/contract/client`. `apps/cli`'s `WorkspaceCommandContext` satisfies it — the agent's negative control adding `drifted` produced `apps/cli` typecheck exit 2 (`TS2344 … does not satisfy the constraint 'PluginCommandContext'`). |
| 144 | `_fixture` deletes both hand-maintained duplicates      | PASS                          | `grep -rn "FixtureServerContext\|FixtureCommandContext" plugins/_fixture` → **zero hits**. `server/routes.ts:2` and `cli/commands/add.ts:2` now `import type … from "@corpus/contract/plugin"`.                                                       |
| 145 | The eslint allowlist is widened **narrowly**            | PASS                          | `eslint.config.js:86` adds exactly `"!@corpus/contract/plugin"`. No `"!@corpus/contract/**"`; the `/client` ban stays structural.                                                                                                                    |
| 146 | The boundary rules still demonstrably fire              | PASS                          | `vitest run scripts/eslint-boundaries.test.ts` → **8 tests green** (was 5). Independently re-derived by the evaluator with real probe files under `plugins/`: importing `@corpus/contract/plugin` lints clean (exit 0); importing `@corpus/contract/client` is rejected — *"'@corpus/contract/client' import is restricted … Plugins may import only @corpus/kit and @corpus/contract"* (exit 1). |
| 147 | `PluginManifest` stays in the kit                       | PASS                          | Still declared only in `packages/kit/src/plugin/types.ts`; the contract's only occurrence is a comment explaining why it stays there. `packages/contract` gained no `react` dependency.                                                              |
| 148 | No runtime code moves                                   | PASS                          | The published `plugin/*.d.ts` are pure `interface`/`type` declarations; `dist/plugin/index.js` carries no implementation of `createPluginContext`, `validateRegistry`, the dispatcher or the CLI error classes — all of which remain in their workspaces (confirmed by the diffstat: `apps/cli/src/registry/types.ts` and `apps/server/src/plugins/context.ts` are the only `apps/**` production files touched). |
| 149 | Generated artifacts unchanged or idempotent             | PASS                          | `check-generated-artifacts.ts` run twice by the evaluator → exit 0 both times, both arms green. sha256 today: `openapi.json` `39ae2954924dae3671d2114b58a9b068507483b707e2c5a8146b69e8149f8124`, `schema.generated.ts` `99e289e7488300a4b22fa3ec04f21e7636d9fc183bf83a56ffe3c464227e51e6` — **exactly the values the log quotes**. A types-only subpath is not OpenAPI surface; there is no diff. |
| 150 | Typecheck passes in every consumer                      | PASS                          | `npm run typecheck` (6 workspaces + `scripts/`) → exit 0, zero `error TS`. `npm run build` → exit 0 in dependency order. |
| 151 | The fixture plugin still works at runtime               | PASS                          | Real workspace + server on `9126`: `GET /api/x/_fixture/notes` → `{"notes":[]}` (200); `corpus _fixture add "Try the fixture" --from agent --json` → exit 0, one JSON value `{"id":"doc_kmhv3l7l","title":"Try the fixture"}`; file on disk at `data/docs/inbox/try-the-fixture.md`; projection `GET /api/docs/doc_kmhv3l7l` → `fixture-note`; workspace git log `agent | doc create: Try the fixture (doc_kmhv3l7l) by agent`; the route then lists the note. The verb is loaded from the plugin's compiled `dist`, so the graduated types are exercised through the built artifact. |
| 152 | The contract's invariant suites stay green, unweakened  | PASS                          | `vitest run packages/contract` → **39 files, 1191 tests green** — the log's exact numbers — including `openapi`, `request-body-required`, `request-defaults`, `index`, `inventory` and `routes/index`. No invariant relaxed (the new subpath added a test file; none was edited away). |
| 153 | Scope discipline                                        | PASS                          | `git show --stat cdc5f4e`: `packages/contract/**` (3 new modules + 1 test + manifest), the two annotation-only files, `plugins/_fixture/**`, `eslint.config.js`, `scripts/eslint-boundaries.test.ts`, plus the two disclosed test-only additions. Zero `apps/ui`, zero `packages/kit`, no route added/renamed/removed. |
| 154 | The eslint config change is the minimum                 | PASS                          | Exactly one negation string added; rule B (core→plugin ban) and rule C (three-path discovery carve-out) untouched — both still fire in the 8 green probe tests.                                                                                     |
| 155 | The `_fixture` docblocks are updated, not orphaned      | PASS                          | Both now state the types come from `@corpus/contract/plugin` and cite CONTRACT-015 (`routes.ts:15`, `add.ts:11`). No stale comment claims a forbidden import.                                                                                       |
| 156 | PLUGINS-002 is unblocked, provably                      | PASS (re-derived)             | The evaluator wrote its own throwaway `plugins/_fixture/eval-probe.tmp.ts` importing **only** `@corpus/contract` and `@corpus/contract/plugin`: a routes factory typed on `PluginServerContext` using `logger`, `now`, `listDocs`, `createDoc`, `broadcastInvalidate`, and a command declared `satisfies PluginCommandSpec` using `args`/`flags`/`out`/`workspace`/`client`/`actor`/`cwd`/`version`. `npm run typecheck -w corpus-plugin-fixture` → **exit 0**; `eslint <probe>` → **exit 0**. Deleted afterwards; `git status plugins/` clean. |
| 157 | The naming question is settled once                     | PASS                          | `@corpus/contract/plugin`, symmetric with `@corpus/kit/plugin`.                                                                                                                                                                                     |
| 158 | E2E log states the model                                | PASS                          | "implemented on: opus".                                                                                                                                                                                                                             |

## Honesty Audit (claims re-derived by the evaluator)

| #   | Claim in the log                                             | Re-derived? | Finding                                                                                      |
| --- | ------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| P1  | `npm run build` exit 0                                       | Yes         | Exit 0.                                                                                       |
| P2  | `npm run typecheck` (6 workspaces + scripts) exit 0          | Yes         | Exit 0, zero TS errors.                                                                       |
| P3  | `npm run lint` exit 0                                        | Yes         | Exit 0.                                                                                       |
| P4  | `npm run format:check` exit 0                                | Yes         | "All matched files use Prettier code style!"                                                  |
| P5  | `vitest run packages/contract` → 39 files, 1191 tests        | Yes         | **Exact.**                                                                                    |
| P6  | `vitest run scripts/eslint-boundaries.test.ts` → 8 tests     | Yes         | **Exact** (was 5; 3 added).                                                                   |
| P7  | Artifacts unchanged; drift check green twice                 | Yes         | Exit 0 twice, both arms.                                                                      |
| P8  | Artifact sha256 values                                       | Yes         | **Both exact**, character for character.                                                      |
| P9  | The eslint allowlist is one targeted string                  | Yes         | Confirmed at `eslint.config.js:86`.                                                           |
| P10 | `/client` probe rejects; `/plugin` probe admits              | Yes         | Reproduced with my own probes in both directions.                                             |
| P11 | Both fixture duplicate interfaces are gone                   | Yes         | Zero grep hits; imports come from the subpath.                                                |
| P12 | Contract imports nothing from `apps/*`                       | Yes         | Zero import hits.                                                                             |
| P13 | Contract gained no `react`/`better-sqlite3`/`chokidar` dep    | Yes         | Dependencies are the same four as before.                                                     |
| P14 | The fixture route and CLI verb still round-trip              | Yes         | Reproduced on `9126`: route, verb, disk, projection, git author.                              |
| P15 | The type assertions are load-bearing                         | Partially   | Reproducing the failing half requires mutating the graduated interfaces (implementation source), which the evaluator does not do. The agent's transcript names exact TS codes and file:line for both workspaces, and my own probe independently demonstrates the same constraint direction (a context missing a member fails to compile). |
| P16 | `TopicSpec`/`Registry` stay in `apps/cli`                    | Yes         | Confirmed against the published `.d.ts` — neither is exported.                                |
| P17 | `client` is published as `{baseUrl}` only                    | Yes         | Confirmed: `PluginCommandClient { readonly baseUrl: string }`.                                |

No overclaims found. One usability observation (not a criterion): the published
`PluginServerContext.listDocs(query: DocsQuery)` takes the **post-defaults** query type, so a plugin
author must pass `limit`, `offset` and `sort` explicitly. My first probe failed to compile for that
reason. Harmless, but a `Partial<DocsQuery>`-shaped convenience would be friendlier for PLUGINS-002.

## Failures

None.

## Summary

22 of 22. The graduation is exactly the "reduced structural surface" Adjudication 16 asked for: a
types-only third subpath, off the root barrel, whose context types are plain-object views rather than
the CLI's nominally-typed internals, with the implementations and the `/client` ban untouched. The
contract package still imports nothing from `apps/*` and gained no runtime dependency; both
hand-maintained fixture duplicates are gone and their docblocks now point at the real source; the
allowlist grew by exactly one targeted string and the boundary rules were seen to fire in both
directions; the generated artifacts are byte-identical to the values recorded before the change; and
a fully typed plugin — server routes plus a `satisfies PluginCommandSpec` verb — compiles and lints
using only the two imports a plugin is allowed. PLUGINS-002 is provably unblocked. **PASS.**
