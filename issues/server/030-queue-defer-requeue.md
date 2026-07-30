# [SERVER-030] Queue defer/requeue transition for lock-deferred work

## Domain

server

## Status

todo

## Priority

P2

## Model

opus — a new queue transition following the existing event-store patterns.

## Dependencies

- Depends on: SERVER-008, SERVER-009, AGENT-002
- Blocks: —

## Spec References

- SPEC.md §7 — "The orchestrator defers edits to user-locked documents — the work stays queued and
  applies when the lock clears"; force-break: "the agent's deferred edit re-enters the queue rather
  than being lost"
- issues/sprints/sprint-012.md — Open Conflict 2 + Adjudication 6 (the interim protocol this issue
  replaces)

## Summary

Filed from sprint-012 Open Conflict 2 (2026-07-28). §7 promises that agent work deferred on a
user-held lock "stays queued", but the queue surface has no defer/requeue transition — a claimed
event can only reach `processed` or `failed`. The interim protocol (Adjudication 6) has the
orchestrate skill reply to the waiting thread, then `corpus queue fail` with a `deferred:`-prefixed
reason, with `corpus job retry` as the re-entry — honest, but a deferral renders as a **failed** job
in the console, and nothing automatically re-enters the work when the lock clears or is force-broken.

This issue adds the honest transition: a deferred state (or equivalent re-enqueue mechanism) such
that (a) a lock-deferred event is distinguishable from a failure in the queue store, the API, and
the console; (b) the event re-enters `pending` when the blocking lock is released, broken, or
reaped; (c) the orchestrate skill's deferral section can be simplified to use it. Contract (route/
schema) and CLI (verb) riders are expected — split them out as coupled issues when this is
scheduled. §7's wording and the skill text (AGENT-002) are updated to match whichever shape lands;
the §7 amendment goes through spec-writer + user sign-off.

## Acceptance Criteria

- [ ] A claimed event blocked on a user-held lock can be moved to a non-terminal deferred state (or
      re-enqueued) through the CLI, without counting as failed.
- [ ] Release, force-break, or reap of the blocking lock re-enters the deferred event into
      `pending`, and the SSE invalidation keys cover the transition.
- [ ] Console/jobs surface distinguishes deferred from failed.
- [ ] The orchestrate skill's deferral section is updated to the new protocol (AGENT rider), and
      §7's "stays queued" wording is reconciled (spec-writer, user sign-off).

## Technical Design

To be refined when scheduled.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran
on._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
