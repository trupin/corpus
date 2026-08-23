# [CONTRACT-082] The CLI pays 23ms a call for routes it never serves

## Domain
contract

## Status
done

## Priority
P1 (important)

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md Section 2 — the CLI is the agent's whole surface
- SPEC.md Section 9.2 — the route catalogue and the generated client

## Summary

**Measured by CLI-058, on a packaged build, minimum of 40 runs on a quiet
machine.** The `corpus` binary's fixed cost is ~159 ms per invocation, and
**23.4 ms of it — 15% — is `@corpus/contract` doing work the CLI has no use
for.**

Two causes, both in this package, neither touching a wire shape:

| change | saving |
| --- | ---: |
| `"sideEffects": false` on `@corpus/contract`, so the bundler drops 182 kB of route definitions the CLI never serves | 5.0 ms |
| `schemas/*.ts` import `z` from `zod` rather than from `@hono/zod-openapi`, with `.openapi()` applied only where routes are built | 18.4 ms |

The 18.4 ms is a pure tax. The CLI serves no routes and reads no `.openapi()`
annotation, so it loads the OpenAPI extension of Zod to use plain Zod.

CLI-058 already took the CLI's own 10.1 ms by deferring `yaml`. This is the rest
of what option 1 has left, and it is the largest single item.

## Acceptance Criteria

- [x] `@corpus/contract` declares `"sideEffects": false`, and nothing in it
      relies on an import for its effect.
- [x] `packages/contract/src/schemas/*.ts` import `z` from `zod`.
- [x] `.openapi()` is applied only where routes are built, so a consumer that
      builds no routes never loads the extension.
- [x] **No wire shape changes.** `packages/contract/openapi.json` regenerates
      byte-identical, and the drift check proves it rather than a reading of the
      diff.
- [x] The saving is **measured, not assumed**: `npm run bench:startup -w apps/cli`
      before and after, interleaved runs, minimum reported. CLI-058's method is
      the standard — a figure taken under machine load is worthless, and that
      issue measured 341 ms for the same call at load average 71.
- [x] `apps/cli/src/startup-cost.test.ts` — CLI-058's pin on eager third-party
      imports — still passes, and is extended if this change makes a new import
      eager.

## Technical Design

### Files to Create/Modify
- `packages/contract/package.json` — `sideEffects`
- `packages/contract/src/schemas/*.ts` — the `z` import
- `packages/contract/src/routes/*.ts` — where `.openapi()` is applied
- `packages/contract/openapi.json` — must regenerate identical

### Key Implementation Details

**The generated document is the proof, not the diff.** `.openapi()` carries the
metadata the document is built from. Moving where it is applied is exactly the
change that could silently drop a description, an example or a default, and the
only honest check is that `openapi.json` regenerates byte-identical.

**Do not chase the rest of the floor here.** CLI-058 measured the remaining
~135 ms as over half Node's own — 33.6 ms boot, 18.4 ms undici initialising on
the first `new Headers()`, 18.5 ms zod. Those are not this package's to give.

**A profiler warning worth heeding**, from CLI-058: `--cpu-prof` blamed a
sentence scan for 38 ms that an A/B build measured at 0 ± 1 ms, because profiled
code runs in a lower JIT tier. Trust interleaved A/B timing over a profile.

### Edge Cases
- A schema that genuinely needs `.openapi()` metadata to describe itself rather
  than its route.
- Any module whose import is load-bearing for its effect, which `sideEffects:
  false` would license a bundler to drop.
- The `kit` and `server` consumers, which **do** build routes and must be
  unaffected.

## Testing Strategy

`vitest run packages/contract` in full, plus the generated-artifact drift check.
The behavioural claim is "nothing changed", so the test that matters is the
byte-identical regeneration.

**Falsify the measurement, not the code**: run the benchmark against the
unchanged build in the same interleaved batch. If the two are within noise, the
saving is not there and this issue should say so rather than claim it.

## E2E Verification Plan

### Verification Steps
1. `npm run build`
2. `npm run bench:startup -w apps/cli` on the unchanged tree, then on the changed
   tree, interleaved, machine quiet
3. Regenerate `openapi.json` and confirm no diff
4. `vitest run packages/contract apps/server apps/cli`

## E2E Verification Log

### Post-Implementation Verification

Run on **opus** (claude-opus-5[1m]), 2026-08-23, branch `phase-43-what-you-see-is-true`.

#### What changed

- `packages/contract/package.json` — `"sideEffects": false`.
- `packages/contract/src/schemas/openapi-metadata.ts` (new) — `openapi(schema, …)`,
  a prefix function that says what `.openapi(…)` said, writing the same payload
  into **Zod's own** `globalRegistry` (including the `_internal.refId` envelope the
  component name travels in). `zod-to-openapi`'s `Metadata.getMetadataFromRegistry`
  merges its private registry over Zod's and falls back to Zod's entirely when the
  private one has no entry, so the generator reads the annotation by the same path.
  Imports `zod` types only.
- All 35 `src/schemas/*.ts` — `import { z } from "zod"`, and 128 component
  registrations plus 72 metadata annotations rewritten from `X.openapi(…)` to
  `openapi(X, …)` by an AST codemod (TypeScript compiler API, innermost-first,
  `app.openapi(route, handler)` excluded).
- 14 `src/routes/*.ts` — the same 24 rewrites, so the merge order is one rule
  everywhere. `routes/responses.ts` now takes `z` from `zod` too.
- `packages/contract/src/routes/paths.ts` (new) — `PATCH_DOC_PATH` and
  `KEYLESS_WRITE_PATHS`, imported by `routes/doc-patch.ts` as its own `path`.
- `apps/cli/src/client.ts` — reads `KEYLESS_WRITE_PATHS` instead of `patchDoc.path`.
  **This was not in the issue's file list and it is what makes the saving real**:
  a route *definition* is a value, so no bundler can drop it, and that one property
  read kept `@hono/zod-openapi` in the CLI bundle no matter what the schemas did.
  Same single source of truth — the route is built from the constant.
- `packages/contract/src/schemas/openapi-metadata.test.ts` (new) and the docblock
  of `apps/cli/src/startup-cost.test.ts`, which said these costs were unfixed.

#### The generated document

```
$ npm run generate -w packages/contract
generated ./openapi.json
generated ./src/client/schema.generated.ts
$ diff <before>/openapi.json packages/contract/openapi.json ; echo $?
0
$ diff <before>/schema.generated.ts packages/contract/src/client/schema.generated.ts ; echo $?
0
```

Both artifacts regenerate **byte-identical** (601,586 bytes and 509,966 bytes).

#### The benchmark

`npm run bench:startup -w apps/cli --runs 25/30`, against the two **packaged**
bundles (`npm run package:build`, copied aside), the same scratch workspace and a
warm local server on port 8891, interleaved before/after/before/after over five
rounds. Load average 4.5 and falling; the first "before" round was discarded as
noise (its own `node -e ''` floor came out 61.6 ms against 43 ms everywhere else,
which is the script's stated tell).

| minimum of 25–30 runs | before | after | saved |
| --- | ---: | ---: | ---: |
| Node boot (the floor) | 42.9 ms | 42.9 ms | — |
| module graph (bundle parse + imports) | 82.0 ms | 63.3 ms | **18.7 ms** |
| workspace, client, one round trip | 30.7 ms | 30.3 ms | — |
| **TOTAL, one `corpus health`** | **157.2 ms** | **136.8 ms** | **20.4 ms (13%)** |

The "before" total reproduces CLI-058's ~159 ms. The saving is 20.4 ms against the
23.4 ms the issue projected — the same size, and I am reporting the measurement
rather than the projection.

Bundle: `dist/corpus.js` 851 kB → **662 kB**, and `grep -c '@hono/zod-openapi'
dist-package/dist/corpus.js` goes from 74 to **0**.

#### Falsifications performed

1. **`sideEffects: false` removed, everything else kept.** `dist/corpus.js` goes
   back to 852 kB with 30 `@hono/zod-openapi` imports. So the two changes are
   complementary rather than additive: without the tree-shaking licence the route
   modules stay, and the schemas' plain-`zod` import saves nothing at all.
2. **The `_internal` envelope dropped from `openapi()`.** Two tests fail by name,
   and `npm run generate` **exits 1** — without component names the recursive
   folder-tree schema recurses until `RangeError: Maximum call stack size
   exceeded` in `zod-to-openapi`'s `isNullableSchema`. The artifact cannot be
   produced at all, let alone identically.
3. **`schemas/health.ts` switched back to `import { z } from "@hono/zod-openapi"`.**
   Both sweep tests fail naming the file:
   `expected [ 'schemas/health.ts' ] to deeply equal []`.

No test in this change could pass with the fix absent.

#### Checks

```
npm run build                                    exit 0
npm run lint                                     exit 0
npm run typecheck                                exit 0
./node_modules/.bin/prettier --check …           exit 0
vitest run packages/contract    69 files, 2909 tests passed
vitest run apps/cli            104 files, 2015 tests passed
vitest run apps/server         201 files, 4548 tests passed
```

#### Edge cases from the Technical Design

- **A schema needing `.openapi()` to describe itself** — all 200 keep their
  metadata; the payload moved from a method argument to a function argument and
  nothing was dropped, which the byte-identical document proves.
- **A module load-bearing for its effect** — there is none. The only import in
  this package that was ever load-bearing for an effect was `@hono/zod-openapi`
  patching `ZodType.prototype`, and every module that still imports it takes
  `createRoute` or `OpenAPIHono` as a *value*. A test asserts exactly that, so a
  future side-effect-only import cannot hide.
- **`kit` and `server`, which do build routes** — unaffected: `server/main.js`
  1002 kB → 1003 kB, and both suites pass unchanged.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
