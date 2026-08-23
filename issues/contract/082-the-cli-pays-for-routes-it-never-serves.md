# [CONTRACT-082] The CLI pays 23ms a call for routes it never serves

## Domain
contract

## Status
todo

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

- [ ] `@corpus/contract` declares `"sideEffects": false`, and nothing in it
      relies on an import for its effect.
- [ ] `packages/contract/src/schemas/*.ts` import `z` from `zod`.
- [ ] `.openapi()` is applied only where routes are built, so a consumer that
      builds no routes never loads the extension.
- [ ] **No wire shape changes.** `packages/contract/openapi.json` regenerates
      byte-identical, and the drift check proves it rather than a reading of the
      diff.
- [ ] The saving is **measured, not assumed**: `npm run bench:startup -w apps/cli`
      before and after, interleaved runs, minimum reported. CLI-058's method is
      the standard — a figure taken under machine load is worthless, and that
      issue measured 341 ms for the same call at load average 71.
- [ ] `apps/cli/src/startup-cost.test.ts` — CLI-058's pin on eager third-party
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
_[Agent fills: the two benchmark runs with their minima, and the regeneration]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
