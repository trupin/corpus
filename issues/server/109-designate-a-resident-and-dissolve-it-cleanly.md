# [SERVER-109] Designate a resident, and dissolve it cleanly

## Domain
server

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: [CONTRACT-051]
- Blocks: [SERVER-107], [CLI-043]

## Spec References
- SPEC.md §8 as amended by SHARED-043 — designation, dissolution

## Summary
Implement the designation routes. `POST /api/threads/{id}/resident {name}` marks a
**standalone** thread (`parent: null`) as having a resident agent: resolve `name` against
agent-defs the way mentions do (`apps/server/src/threads/mentions.ts:119-127,138-157`),
write `resident: {name, docId}` into the thread's frontmatter, enqueue a
`resident.designated` event on the **orchestrator lane** (that is how the orchestrator
learns to launch the listener, AGENT-026), and invalidate. `DELETE` dissolves: clear the
field, notify the lane's waiters so a parked listener unparks and sees its lane is gone,
and let SERVER-107's claim-time fallback route everything to the orchestrator from then on.
Thread resolution dissolves the same way.

## Acceptance Criteria
- [ ] Designation: user actor only (403 for agent — pinning is the person's act); standalone threads only (409 otherwise, per contract); unknown name → 404; archived agent-def → designates with `status: "archived"` surfaced in the response (consistent with mention doctrine: never silently ignore, never silently refuse)
- [ ] `resident` written in §6 frontmatter key order beside `agent`/`turnModels` (`threads/create.ts:182-212` region); read back leniently (`threads/read.ts:93-128`); on the wire per CONTRACT-051
- [ ] `resident.designated` enqueued with payload `{threadId, resident: {name, docId}}` through the ordinary `enqueue` path — lane-stamped orchestrator (SERVER-107 must special-case: designation events about a scope never route *to* that scope)
- [ ] Dissolution (`DELETE`, idempotent 204) and thread `resolve` both: clear/ignore the field, `notify(th_x)` so a parked scoped idle returns promptly (it re-parks against a lane that no longer routes, and its next scoped claim is legitimately empty forever — the converse skill reads the roster and exits, AGENT-025)
- [ ] Re-designation with a different name is legal (user-only): one call, field replaced, a fresh `resident.designated` enqueued
- [ ] Designation state readable cheaply by the queue: projection carries `resident` so SERVER-107's per-turn lookup is one SQLite read; changes invalidate `["threads", id]` and `["agents"]`

## Technical Design

### Files to Create/Modify
- `apps/server/src/threads/resident.ts` — new: designate/release, validation, event payload
- `apps/server/src/threads/routes` wiring per contract (follow `thread-reattach.ts`'s route shape)
- `apps/server/src/threads/read.ts` / `create.ts` — frontmatter field round-trip
- `apps/server/src/projection/project-document.ts` — project `resident` for thread rows

### Key Implementation Details
Designation is thread state, not a session: it survives restarts in frontmatter and git,
which is what makes the roster's "designated but not live" row possible. The
`resident.designated` event is deliberately ordinary — same store, same settle verbs, shows
in the console like any job — so launching a listener is auditable work, not magic.
Reuse `invocableName`/`targetIndex` rather than duplicating resolution; first row in id
order wins, same tie-break as mentions.

### Edge Cases
- Designating a thread whose scope already has artifacts (origin stamped before designation): nothing to do — scope is computed, the lane simply starts routing; state this in the route's doc comment
- Deleting the agent-def document after designation: designation keeps `{name, docId}`; the roster shows the name; the converse skill handles a gone persona like a gone mention target (do the work, say the persona is missing)
- Dissolving while events sit pending in the lane: they keep their lane stamp; fallback makes them orchestrator-visible immediately since a dissolved lane is never live

## Testing Strategy
Unit: validation matrix (actor, shape, name resolution, archived). Integration: designate →
frontmatter + projection + event on orchestrator lane; dissolve → notify + fallback
visibility; resolve-dissolves; idempotent delete; re-designation.

## E2E Verification Plan

### Verification Steps
1. Real server; create standalone thread, add `.claude/agents/researcher.md`
2. `POST /api/threads/{id}/resident {"name":"researcher"}` as user → 200; `corpus thread show` prints the resident; console shows `resident.designated` pending
3. Same call `--from agent` → 403; on an anchored thread → 409
4. `DELETE` → 204 twice; roster row disappears; a pending scoped event becomes claimable by plain `claim-all`

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
- [ ] Committed with `[SERVER-109]` prefix
