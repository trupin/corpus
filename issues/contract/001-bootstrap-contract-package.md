# [CONTRACT-001] Bootstrap @corpus/contract: zod-openapi routes, spec generation, typed client

## Domain
contract

## Status
todo

## Priority
P0

## Dependencies
- Depends on: SHARED-001
- Blocks: server scaffold, CLI scaffold, UI data layer (Phase 1 issues, to be filed by /decompose)

## Spec References
- SPEC.md §9.2 (HTTP API) — as revised by SHARED-001
- CLAUDE.md — Architecture Decision 3 (contract-first via code)

## Summary
Create `packages/contract` as the single source of truth for the HTTP API: Zod schemas + `@hono/zod-openapi` route definitions, a generation script that emits a committed `openapi.json`, and a generated typed client (`openapi-typescript` + `openapi-fetch`) exported for the CLI and UI. Include the drift check (regenerate + diff) wired into pre-push.

## Acceptance Criteria
- [ ] `packages/contract/src/schemas/` holds Zod schemas for the core resources (doc frontmatter, thread, turn, queue event, lock, job) per revised SPEC.md.
- [ ] Route definitions built with `createRoute` from `@hono/zod-openapi`, importable by the server to register handlers.
- [ ] `npm run generate -w packages/contract` emits `packages/contract/openapi.json` (committed) and regenerates the typed client.
- [ ] Package exports: `@corpus/contract` (schemas + routes) and `@corpus/contract/client` (typed client factory taking base URL + bearer token).
- [ ] Pre-push drift check fails when `openapi.json` or the generated client is stale relative to route definitions.
- [ ] Unit tests: schema round-trips for each core resource; a route definition compiles into a Hono app and serves `/doc` (the OpenAPI endpoint) in a smoke test.

## Technical Design

### Files to Create/Modify
- `packages/contract/src/schemas/*.ts` — Zod resource schemas
- `packages/contract/src/routes/*.ts` — zod-openapi route definitions grouped by resource
- `packages/contract/scripts/generate.ts` — emit openapi.json + run openapi-typescript
- `packages/contract/src/client/` — generated types + thin openapi-fetch wrapper (hand-written factory, generated types)
- `.githooks/pre-push` — add drift check step
- `packages/contract/package.json` — exports map, generate script

### Key Implementation Details
Start with a deliberately small surface (docs CRUD + threads + queue) matching the revised spec's endpoint list; grow per-issue afterward. Generated files are committed and marked `linguist-generated` in `.gitattributes`. The client wrapper injects `Authorization: Bearer <token>` and surfaces a typed error union.

### Edge Cases
- Multipart endpoints (attachments) — openapi-fetch handles them awkwardly; the wrapper may expose a dedicated upload helper.
- SSE endpoint is documented in the OpenAPI doc but the client exposes it as an EventSource helper, not a fetch call.

## Testing Strategy
Vitest in `packages/contract`: schema parse/serialize round-trips, route smoke test (mount on Hono, hit `/doc`), generation script produces stable output (run twice → identical).

## E2E Verification Plan

### Verification Steps
1. `npm run generate -w packages/contract` from a clean tree → no diff (generation is idempotent).
2. Hand-edit a route (add a field), regenerate → `openapi.json` and client types change; `git push` without regenerating is blocked by the drift check.
3. Node REPL/script: import `@corpus/contract/client`, point it at a stub Hono app mounting the contract routes, make a typed call, observe a typed response.

## E2E Verification Log
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain surface)
- [ ] `/evaluate` passes
- [ ] Committed with `[CONTRACT-001]` prefix
