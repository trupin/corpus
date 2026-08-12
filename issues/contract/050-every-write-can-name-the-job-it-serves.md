# [CONTRACT-050] Every write can name the job it serves

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
- Blocks: [SERVER-106], [CLI-042]

## Spec References
- SPEC.md §7 as amended by SHARED-043 — provenance, `origin`, job attribution

## Summary
Add job attribution and provenance to the wire. Mutating requests gain an optional `job`
field naming the queue event the work serves (`evt_…`); documents gain a read-only
`origin` field naming the thread their creating job came from (`th_…` or null). This is
the contract half of provenance stamping: the server resolves `job → event → origin
thread` at write time (SERVER-106), and everything downstream — scope membership, the
verifiable trace line, richer job console rows — reads `origin`.

## Acceptance Criteria
- [ ] `job: z.string().regex(/^evt_/).optional()` accepted on every mutating request body that creates or edits a document or thread: doc create/edit/patch/move/archive, thread create, turn append, form respond
- [ ] `DocumentSchema` (and the summary shape if it carries frontmatter-derived fields) gains `origin: z.string().regex(/^th_/).nullable()`
- [ ] `origin` is server-assigned: no request shape accepts it directly; the one exception is the detach affordance — doc edit accepts `origin: null` (clear only, never set), user actor only, enforced server-side
- [ ] An unknown or settled `job` id is defined as a 422 in the route contract, not silently ignored
- [ ] OpenAPI regenerated; generated client exposes the new fields; UI and CLI compile untouched (fields optional everywhere)

## Technical Design

### Files to Create/Modify
- `packages/contract/src/schemas/doc.ts` — `origin` on the document wire shape; `origin: null` on the edit request (clear-only)
- `packages/contract/src/schemas/queue.ts` — no change to `QueueEventSchema`; export the `evt_`/`th_` id patterns if not already shared
- `packages/contract/src/routes/*.ts` — add `job` to the mutating request bodies listed above (multipart twins included, same `z.stringbool()` discipline as `requestsAgent` where applicable); declare the 422
- `packages/contract/src/schemas/thread.ts` — threads are documents: `origin` travels on the thread wire shape too (a subthread created by a resident's work carries the scope root)

### Key Implementation Details
Follow the pattern `weight` set: one exported field definition (like `requestedWeightField`
/ `turnModelRequestField` in `schemas/thread.ts:…`) reused across every mutating route, so
the flag cannot drift between routes. `origin` is frontmatter-backed (server writes it into
the document's frontmatter like `agent`/`turnModels`), so add it to the frontmatter key
order the projector reads — coordinate the key name with SERVER-106.

### Edge Cases
- `job` on a request whose actor is `user` — legal (the UI could attribute a form answer), but origin stamping still derives from the *event's* origin, never the actor
- A `job` naming a `doc.edited` event: its origin is a document, not a thread — origin stamps null; the contract text should say the field is "the origin *thread*"

## Testing Strategy
Contract tests: schema round-trips for `job` and `origin`; multipart twin parses `"false"`
distinguishably where relevant; OpenAPI snapshot updated; 422 declared on the routes.

## E2E Verification Plan

### Verification Steps
1. Start the real server (`corpus serve` in a scratch workspace)
2. `POST /api/docs` with `job: "evt_nonexistent"` → 422 with a reason naming the id
3. Create a thread, let an event enqueue, claim it, then create a doc with that `job` → `GET /api/docs/{id}` shows `origin: "th_…"`
4. `corpus doc show <id> --json` (generated client) round-trips `origin`

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
- [ ] Committed with `[CONTRACT-050]` prefix
