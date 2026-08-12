# [CONTRACT-051] Lanes, designation, and the roster on the wire

## Domain
contract

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: [SHARED-043]
- Blocks: [SERVER-111], [SERVER-109], [CLI-043], [UI-108], [UI-109]

## Spec References
- SPEC.md §7/§8 as amended by SHARED-043 — lanes, designation, recipient, roster

## Summary
The wire shapes for everything lane-related, in one issue so the vocabulary cannot drift
across routes: a `recipient` field on posting requests, scope parameters on the queue
verbs, a designation surface on threads, the `GET /api/agents` roster route, and the
`["agents"]` invalidate key. SERVER-111/112/109 implement against these shapes; the UI and
CLI consume them through the generated client.

## Acceptance Criteria
- [ ] Posting requests (thread create, turn append, form respond) accept `recipient: z.union([z.literal("orchestrator"), z.string().regex(/^th_/)]).optional()` — omitted means "default routing"
- [ ] `POST /api/queue/claim-all` and `GET /api/queue/idle` accept optional `scope: th_… | "orchestrator"`; omitted means the orchestrator lane (backward compatible: today's callers keep today's meaning)
- [ ] Thread wire shape gains `resident: { name, docId } | null`; designation routes exist: `POST /api/threads/{id}/resident` (body `{ name }`) and `DELETE /api/threads/{id}/resident`, declaring 403 for the agent actor (user-only, like `thread-reattach.ts` does), 409 for non-standalone threads, and 404 for an unknown agent-def name
- [ ] `GET /api/agents` returns `{ agents: [{ lane, resident, live, since, summary, origin }] }` where `lane` is `"orchestrator" | th_…`, `resident` is `{name, docId} | null`, `live: boolean`, `since: ISO instant | null`, `summary: string | null`, `origin: { id, title } | null`
- [ ] `AGENTS_QUERY_KEYS` added to `packages/contract/src/query-keys.ts` within the closed vocabulary (`["agents"]`), exported alongside the existing eight shapes
- [ ] Queue event wire shape is **unchanged** — the lane is server-side bookkeeping (like `status`/`attempts` in the store), surfaced only through the scoped verbs and the roster
- [ ] OpenAPI regenerated; generated client exposes the new routes and fields

## Technical Design

### Files to Create/Modify
- `packages/contract/src/schemas/thread.ts` — `recipient` request field (one exported definition, reused; multipart twin included), `resident` on `ThreadSchema`/`ThreadSummarySchema`
- `packages/contract/src/schemas/queue.ts` — `scope` param schema; keep `QUEUE_EVENT_STATUSES` untouched
- `packages/contract/src/schemas/agents.ts` — new: roster shapes
- `packages/contract/src/routes/queue.ts` — `scope` on claim-all/idle
- `packages/contract/src/routes/threads.ts` (or a new `thread-resident.ts` following `thread-reattach.ts`) — designation routes
- `packages/contract/src/routes/agents.ts` — new: `GET /api/agents`
- `packages/contract/src/query-keys.ts` — `["agents"]`

### Key Implementation Details
`recipient` follows the `weight`/`model` pattern: defined once, spread into each posting
request. The roster's `summary` is a plain string the server derives (SERVER-112) — the
contract makes no promise about its source, only its bound (cap at 200 chars, trim
server-side). `since` is when the lane's listener was last seen parked; null when never.
Designation body takes the **invocable name** (the same resolution surface mentions use,
`mentions.ts:119-127`), not a doc id — the response returns the resolved `{name, docId}`.

### Edge Cases
- `recipient` naming a thread that is not a designated root → 422 (the composer only offers real lanes, but the contract must still refuse a stale pick)
- `recipient: "orchestrator"` on a post inside a designated scope — legal, that is the override
- `DELETE .../resident` on a thread with no resident — 204, idempotent (matches flush's discipline)

## Testing Strategy
Schema round-trip tests for every new shape; multipart twin for `recipient`; OpenAPI
snapshot; query-key vocabulary test extended to nine shapes.

## E2E Verification Plan

### Verification Steps
1. Start the real server; `GET /api/agents` → `{ agents: [ { lane: "orchestrator", … } ] }` (the orchestrator row exists even before any designation)
2. `POST /api/threads/{standalone}/resident {"name":"researcher"}` with a `researcher.md` agent-def present → 200 with resolved docId; same call on an anchored thread → 409
3. `POST /api/threads` with `recipient: "th_<undesignated>"` → 422

## E2E Verification Log
_Filled in by the implementing agent as proof-of-work._

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain)
- [ ] Committed with `[CONTRACT-051]` prefix
