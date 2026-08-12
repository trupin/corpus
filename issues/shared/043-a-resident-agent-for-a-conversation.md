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
- Blocks: [CONTRACT-050], [CONTRACT-051], [AGENT-025] (directly; the whole phase transitively)

## Spec References
- SPEC.md §7 — the agent loop, the queue, and the delegated/inline-work doctrine this rider scopes to the orchestrator's lane
- SPEC.md §8 — threads, participation, mentions, and the composer

## Summary
Draft, read aloud for signature, and apply the SPEC rider that introduces **resident
agents**: a top-level (standalone) thread may designate a long-lived agent; that agent owns
the thread's whole **scope** — the thread, its subthreads, and every artifact whose
provenance walks back to it — and runs its own claim → work → settle → park loop on a
**lane** of the queue partitioned to that scope. Users see a live roster and pick a
recipient per message; the default is computed from where they post. This deliberately
revokes three standing doctrines, and the rider must name each where it actually lives:
§7's "every event is delegated — the orchestrator never works a job inline" is scoped to
the orchestrator's lane (a resident works its conversation inline); the orchestrate
skill's "this session is the only process that claims queue events" becomes one consumer
per lane, with §7's concurrent-claims wording amended to match; and orchestrate's "queue
state never crosses the subagent boundary" becomes a lane's owner settles its own lane.

## Acceptance Criteria
- [ ] Rider drafted as real spec text, presented for signature one section at a time (per the standing rider discipline), and applied to SPEC.md only after authorization
- [ ] Defines **designation**: standalone threads only (`parent: null`); designation is user-only state on the thread; dissolution (release, or thread resolution) returns the scope to ordinary routing
- [ ] Defines **scope** by provenance: the root thread, its child threads, documents whose `origin` chain reaches the root, and threads on those documents
- [ ] Defines **lanes**: every event is stamped with its lane at enqueue time (root scope if designated, orchestrator otherwise); scoped verbs consume only their lane; unscoped verbs never see a live lane's events
- [ ] Defines **liveness**: presence is the parked scoped `idle`; a lane whose listener lapses past the grace window falls back to the orchestrator — slower, never silent
- [ ] Defines **recipient**: default computed from posting location; per-message override via the composer; an override routes one message and never rewires a scope; a summoned agent replies where it was asked, not at home
- [ ] Defines **provenance**: mutating requests may name the job (event) they serve; the server stamps the document's origin thread at write time; origin is recorded unconditionally (scoping is computed, not stored) and is user-clearable (detach)
- [ ] States the mention/lane composition rule: `@mention` and `/skill` directives bind whichever lane consumes the event, unchanged
- [ ] Adds `resident.designated` to §7's core event-type vocabulary (today a closed set: `comment.created`, `form.respond`, `doc.edited`, reserved `agent.done`, plus plugin types) — the designation event is ordinary queue vocabulary, not a side channel
- [ ] Reconciles §8's reply-in-parent rule and the queued-vs-working pending-indicator rider (in flight with UI-097) with lane routing
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
the rider agree on vocabulary; confirm no SPEC section asserts a queue-wide
delegation or claiming rule that the per-lane doctrine does not scope.

### Verification Steps
1. `grep -n "resident\|lane\|recipient" SPEC.md` — the vocabulary appears in §7/§8 and nowhere contradicts it
2. `grep -n "works a job inline\|Every event is delegated" SPEC.md` — every hit is inside text that scopes the rule to the orchestrator's lane; none asserts it queue-wide
3. The orchestrate and converse skills' single-claimant language matches the rider's per-lane rule verbatim (checked when AGENT-025/026 land, but the rider's wording is what they quote)

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
