# [SHARED-056] §7 enumerates the core events, §9.2 the routes, and §10 the console — Phase 36 added one of each

## Domain

shared

## Status

done — signed by the user 2026-08-20 (as drafted, in the v0.15.0 go-ahead). All five edits applied verbatim to SPEC.md on 2026-08-20. This rider is SPEC text only and has no code half.

## Priority

P1

## Model

fable

## Dependencies

- Depends on: CONTRACT-068, CONTRACT-069 (done)
- Related: SHARED-055 (signed 2026-08-19), SERVER-128, SERVER-130

## Spec References

- SPEC.md **§7** — *"Core event types: …"* and *"Two kinds of event do not take the lane of the scope they fall in"*
- SPEC.md **§9.2** — the route list, `POST/DELETE /api/threads/:id/resident`

## Summary

Phase 36 added a core event type (`resident.released`, CONTRACT-069) and a route (`GET /api/threads/:id/scope`, CONTRACT-068). Both are behaviour the user asked for on 2026-08-19 and both are built. It also added a **console tab** (UI-125), and §10's console paragraph describes that drawer's contents in closed detail — the strip, the jobs master-detail, the index pill — and mentions no tabs at all.

All three are enumerations, and an enumeration that omits a member is false rather than incomplete. The contract's docblocks record the first two as pending amendments. The third was found by the PR #52 review on 2026-08-19. This issue is the amendment for all three.

## The drafted text — read back verbatim before applying

**Edit 1 — §7, the "Core event types" sentence.** After *"`resident.designated` (a standalone thread was given a resident, §7 — enqueued on the orchestrator's lane whoever is designated)"*, insert:

> , `resident.released` (a resident was released — by a person, by resolution, or by a new designation replacing it, and the payload says which; enqueued on the orchestrator's lane for the same reason, so the orchestrator learns a lane returned to it. A lapse is not a release and enqueues nothing)

**Edit 2 — §7, the lanes paragraph.** Replace *"and a `resident.designated` takes the **orchestrator's** lane whoever is designated, since a resident does not announce itself to itself"* with:

> and a `resident.designated` — and its counterpart `resident.released` — takes the **orchestrator's** lane whoever is designated, since a resident does not announce itself to itself

**Edit 3 — §9.2, the resident bullet.** After *"releasing a thread that has none is the state the caller asked for, not an error."*, insert:

> A release that releases somebody enqueues `resident.released` on the orchestrator's lane, and **takes effect at once**: a resident parked on that lane has its park returned immediately and its next park refused, so "stop this agent" is an act with an observable end rather than a request that lands within the next rearm.

**Edit 4 — §9.2, a new bullet after the `GET /api/agents` bullet:**

> - `GET /api/threads/:id/scope` — **what a resident owns**: the thread, its subthreads, and every artifact whose provenance walks back to it, derived by the same walk the queue routes with, one frugal line per member and never a body, bounded to one page with a stated `truncated` flag. Refused for a thread with no resident — the orchestrator's lane is not a scope.

**Edit 5 — §10, the console paragraph.** After *"Expanded (click), it **pushes the board up — never overlays content** — and its **height is resizable** by dragging its top edge."*, insert:

> The expanded drawer holds **two tabs**, and both are the agent's own machinery rather than the corpus, which is what puts them here: **Jobs**, described below, and **Residents** — §7's roster, showing every lane with the resident that owns it, the weight that resident works at, and whether it is live, with the selected lane's **scope** beside it: the conversation, its subthreads, and the artifacts whose provenance walks back to it. A scope is read for the lane a person selects and never for every lane at once, and a listing that reached its bound says so rather than ending quietly — §7 forbids an enumeration of the corpus, and a silent cap is worse than a stated one.

## Acceptance Criteria

- [x] The user has signed the drafted text, verbatim, on its own
- [x] §10 describes the console's two tabs and what the Residents tab shows
- [x] `npm run spec:check` passes

## Completion Checklist (orchestrator)

- [x] Committed with `[SHARED-056]` prefix after sign-off
