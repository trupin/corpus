# [SERVER-110] Stamp a document with the thread it came from

## Domain
server

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: [CONTRACT-050]
- Blocks: [SERVER-111], [CLI-044]

## Spec References
- SPEC.md §7 as amended by SHARED-043 — provenance and `origin`

## Summary
Implement provenance stamping. When a mutating request carries `job: evt_…`, resolve the
event, walk its payload to an origin thread (the same first-of `threadId, parentId, docId`
resolution the held-report already uses, `apps/server/src/jobs/project.ts:30-35`), and
stamp the created or edited document's frontmatter with `origin: th_…`. Origin is recorded
**unconditionally** — whether or not the thread is designated — because scope membership is
computed at enqueue time from the origin chain (SERVER-111), never stored. This also makes
the `↳` trace line verifiable and gives the job console a real artifact list.

## Acceptance Criteria
- [ ] `job` on a mutating request resolves the event from the store; unknown id or a settled event (`processed/failed/abandoned`) → 422 naming the id and its state; `pending/in-progress/deferred` are all legal (a resident stamps while holding)
- [ ] Origin resolution: event payload `threadId` → that thread; `parentId`/`docId` only → the *document's own* origin if it has one, else null — and `doc.edited` events carry only a `docId`, so they fall under exactly that rule (the edited document's origin, else null); reflection work and its artifacts thereby stay in the document's scope
- [ ] On **create** (doc or thread), `origin` is written into frontmatter in §6 key order; on **edit**, an existing `origin` is never overwritten (first writer wins)
- [ ] Detach: doc edit with `origin: null` from the `user` actor clears the field; the same body from `agent` → 403 (deletion-shaped act, user-only, same doctrine as `doc delete`)
- [ ] `origin` round-trips through the projection (`project-document.ts`) onto the wire shape, and invalidates `["docs", id]` like any frontmatter change
- [ ] Threads created with `job` carry `origin` too — that is how subthreads join the scope

## Technical Design

### Files to Create/Modify
- `apps/server/src/core/provenance.ts` — new: `resolveOrigin(event): th_… | null`, shared with SERVER-111's lane resolution
- `apps/server/src/docs/*` (create/edit paths) and `apps/server/src/threads/create.ts` — accept `job`, stamp frontmatter
- `apps/server/src/projection/project-document.ts` — read `origin` field-by-field like the rest
- `apps/server/src/queue/store.ts` — a read-by-id that does not move the event (exists as the transition read; expose it)

### Key Implementation Details
Frontmatter key order comes from §6; slot `origin` after `parent`/`anchor` in
`threads/create.ts:182-212` and the doc equivalent. The stamp happens inside the same
write the server was already making — no second commit, no second invalidation. Keep
`resolveOrigin` pure and synchronous; it reads the event object it is handed, not the
filesystem, so the request path stays one store read.

### Edge Cases
- `job` naming an event whose thread has since been deleted: stamp anyway (`th_…` ids stay meaningful in git history); scope walks treat a missing root as undesignated
- A capture (`source: "capture"`) event carries a threadId like any comment — inbox artifacts join scopes too, which is correct
- Two writes racing with the same `job`: both stamp the same origin; idempotent

## Testing Strategy
Unit: `resolveOrigin` across the three payload shapes and `doc.edited`. Integration: create
doc with job → frontmatter + wire `origin`; edit never overwrites; user clears, agent 403;
422 on settled/unknown events.

## E2E Verification Plan

### Verification Steps
1. Real server, real workspace: post a comment mentioning `@agent` → event enqueues
2. `corpus queue claim-all`; `corpus doc create --job <evt> …` (lands with CLI-044; until then, generated-client call) → `corpus doc show` prints `origin: th_…`
3. Edit the doc with a different job → origin unchanged
4. `corpus doc edit <id> --from user` clearing origin → cleared; same `--from agent` → refused

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
- [ ] `/audit` run (P0)
- [ ] Committed with `[SERVER-110]` prefix
