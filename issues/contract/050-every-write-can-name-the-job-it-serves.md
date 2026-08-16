# [CONTRACT-050] Every write can name the job it serves

## Domain
contract

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: [SHARED-043]
- Blocks: [SERVER-110], [CLI-044]

## Spec References
- SPEC.md §7 as amended by SHARED-043 — provenance, `origin`, job attribution

## Summary
Add job attribution and provenance to the wire. Mutating requests gain an optional `job`
field naming the queue event the work serves (`evt_…`); documents gain a read-only
`origin` field naming the thread their creating job came from (`th_…` or null). This is
the contract half of provenance stamping: the server resolves `job → event → origin
thread` at write time (SERVER-110), and everything downstream — scope membership, the
verifiable trace line, richer job console rows — reads `origin`.

## Acceptance Criteria
- [x] `job: z.string().regex(/^evt_/).optional()` accepted on every mutating request body that creates or edits a document or thread: doc create/edit/patch/move/archive/unarchive, thread create, turn append, form respond
- [x] `DocumentSchema` (and the summary shape if it carries frontmatter-derived fields) gains `origin: z.string().regex(/^th_/).nullable()`
- [x] `origin` is server-assigned: no request shape accepts it directly; the one exception is the detach affordance — doc edit accepts `origin: null` (clear only, never set), user actor only, enforced server-side
- [x] An unknown or settled `job` id is defined as a 422 in the route contract, not silently ignored
- [x] OpenAPI regenerated; generated client exposes the new fields; UI and CLI compile untouched (fields optional everywhere)

## Technical Design

### Files to Create/Modify
- `packages/contract/src/schemas/doc.ts` — `origin` on the document wire shape; `origin: null` on the edit request (clear-only)
- `packages/contract/src/schemas/queue.ts` — no change to `QueueEventSchema`; export the `evt_`/`th_` id patterns if not already shared
- `packages/contract/src/routes/*.ts` — add `job` to the mutating request bodies listed above (multipart twins included, same `z.stringbool()` discipline as `requestsAgent` where applicable); declare the 422
- `packages/contract/src/schemas/thread.ts` — threads are documents: `origin` travels on the thread wire shape too (a subthread created by a resident's work carries the scope root)

### Key Implementation Details
Follow the pattern `weight` set: one exported field definition (like `requestedWeightField`
/ `turnModelRequestField` in `schemas/thread.ts`) reused across every mutating route, so
the flag cannot drift between routes. `origin` is frontmatter-backed (server writes it into
the document's frontmatter like `agent`/`turnModels`), so add it to the frontmatter key
order the projector reads — coordinate the key name with SERVER-110.

### Edge Cases
- `job` on a request whose actor is `user` — legal (the UI could attribute a form answer), but origin stamping still derives from the *event's* origin, never the actor
- A `job` naming a `doc.edited` event resolves through the edited document's own `origin` — the scope the document belongs to — and null when it has none (SERVER-110 owns the rule)

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
**Model: Opus 5 (1M context)**, orchestrator, on `phase-34-resident-rider`. No
server started, no port bound.

```
$ npx vitest run apps packages scripts plugins  → 12288 passed, 0 failed
$ npm run typecheck                             → 0 errors
$ npm run lint / prettier --check .             → clean
```

**One design change from the issue's stated shape, and why.** The issue asked for
`origin: null` on the doc edit as a `z.null()` — clear-only expressed in the type
so `origin: "th_…"` would be a compile error. **That does not survive the
toolchain**: a JSON Schema `{"type":"null"}` reaches `openapi-fetch` as
`origin?: never`, so the generated client rejects the one value the field exists
to accept (`Type 'null' is not assignable to type 'never'`). The wire type is now
the ordinary nullable id and clear-only is enforced in the write path — which is
what the same acceptance criterion already asked for ("clear only, never set,
user actor only, **enforced server-side**"). The docblock that claimed a
type-level guarantee was corrected rather than left standing.

**`origin` is a reserved frontmatter key.** Not in the issue's list, and
required: `extra` is a client-supplied merge patch, so an origin stored there
could be rewritten by an ordinary `PUT /api/docs/{id}` — exactly the
caller-asserted scope membership the job/origin split makes unexpressible. Same
reasoning `turnModels` is reserved under.

**`delete` deliberately takes no `job`.** §9.2 says any write may name one, and
deletion is the one mutation an agent may never perform, so a job there would
name work that cannot exist. Archive and unarchive gained an entirely optional
body for it (they previously took none), and both say so — the census test that
pins every request body in the surface required them to be declared and to tell
the caller that omitting the body is a real call.

**Nine routes declare the `422`**, and no route that cannot carry a job does.

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain)
- [ ] Committed with `[CONTRACT-050]` prefix
