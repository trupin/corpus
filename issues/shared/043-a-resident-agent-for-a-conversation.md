# [SHARED-043] A resident agent for a conversation

## Domain
shared

## Status
todo

## Priority
P0

## Model
fable

## Dependencies
- Depends on: —
- Blocks: [CONTRACT-050], [CONTRACT-051], [SERVER-106], [SERVER-107], [SERVER-108], [SERVER-109], [CLI-042], [CLI-043], [AGENT-025], [AGENT-026], [UI-108], [UI-109]

## Spec References
- SPEC.md §7 — the agent loop, the queue, and the single-consumer assumption this rider revokes
- SPEC.md §8 — threads, participation, mentions, and the composer

## Summary
Draft, read aloud for signature, and apply the SPEC rider that introduces **resident
agents**: a top-level (standalone) thread may designate a long-lived agent; that agent owns
the thread's whole **scope** — the thread, its subthreads, and every artifact whose
provenance walks back to it — and runs its own claim → work → settle → park loop on a
**lane** of the queue partitioned to that scope. Users see a live roster and pick a
recipient per message; the default is computed from where they post. This deliberately
revokes two standing doctrines, and the rider must say so in so many words: §7's "one
orchestrating session is the only process that claims queue events", and orchestrate's
"queue state never crosses the subagent boundary" (a resident settles its own lane).

## Acceptance Criteria
- [ ] Rider drafted as real spec text, presented for signature one section at a time (per the standing rider discipline), and applied to SPEC.md only after authorization
- [ ] Defines **designation**: standalone threads only (`parent: null`); designation is user-only state on the thread; dissolution (release, or thread resolution) returns the scope to ordinary routing
- [ ] Defines **scope** by provenance: the root thread, its child threads, documents whose `origin` chain reaches the root, and threads on those documents
- [ ] Defines **lanes**: every event is stamped with its lane at enqueue time (root scope if designated, orchestrator otherwise); scoped verbs consume only their lane; unscoped verbs never see a live lane's events
- [ ] Defines **liveness**: presence is the parked scoped `idle`; a lane whose listener lapses past the grace window falls back to the orchestrator — slower, never silent
- [ ] Defines **recipient**: default computed from posting location; per-message override via the composer; an override routes one message and never rewires a scope; a summoned agent replies where it was asked, not at home
- [ ] Defines **provenance**: mutating requests may name the job (event) they serve; the server stamps the document's origin thread at write time; origin is recorded unconditionally (scoping is computed, not stored) and is user-clearable (detach)
- [ ] States the mention/lane composition rule: `@mention` and `/skill` directives bind whichever lane consumes the event, unchanged
- [ ] Reconciles §8's reply-in-parent rule and the pending-indicator rider (SPEC.md:398) with lane routing
- [ ] PLAN.md Phase 32 narrative updated with "(AUTHORIZED <date>, applied)" once signed

## Technical Design

### Files to Create/Modify
- `SPEC.md` — §7 and §8 amendments (applied only after signature)
- `issues/PLAN.md` — Phase 32 header row status

### Key Implementation Details
The rider is the design authority for every issue in Phase 32; the per-domain issues carry
the mechanics but the rider owns the vocabulary (`resident`, `scope`, `lane`, `recipient`,
`origin`) and the invariants. Name the two revoked doctrines explicitly and replace them
with their successors: *one consumer per lane* (not one consumer per queue), and *a lane's
owner settles its own lane* (the orchestrator settles the unscoped lane, a resident settles
its scope). Keep the SSE rule intact — presence and the roster are reads behind invalidate
keys, never data over SSE.

### Edge Cases
- A document whose origin thread is designated *after* the document was created: origin was stamped unconditionally, so the scope captures it retroactively — the rider must state this is intended
- Two designated threads cannot both claim one artifact: origin is single-valued, first writer wins, detach is the escape hatch
- Designation of a thread with events already pending in the orchestrator lane: pending events keep their stamped lane; only new enqueues route to the resident

## Testing Strategy
Not applicable — this is spec work. The check is the signature.

## E2E Verification Plan
Read the applied §7/§8 text against every acceptance criterion above; confirm PLAN.md and
the rider agree on vocabulary; confirm no other SPEC section still asserts the
single-consumer assumption (grep for "only process that claims").

### Verification Steps
1. `grep -n "resident\|lane\|recipient" SPEC.md` — the vocabulary appears in §7/§8 and nowhere contradicts it
2. `grep -n "only process that claims" SPEC.md` — zero hits, or hits rewritten to the per-lane rule

## E2E Verification Log
_Filled in by the implementing agent as proof-of-work._

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Rider signed by the user before SPEC.md is touched
- [ ] `/lint` passes
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain)
- [ ] Committed with `[SHARED-043]` prefix
