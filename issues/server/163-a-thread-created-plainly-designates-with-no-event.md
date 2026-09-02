# [SERVER-163] A plainly created thread gets a resident with no designation event, so its lane can never say what it launched at

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Related: `UI-186` (which found it), `AGENT-059` (the launch record that never
  gets written here), SHARED-073 (Rider A — a new standalone thread designates a
  general resident)

## Spec References

- SPEC.md **§7** — *"A dispatch says what weight it went out at, and where that
  weight came from"*
- SPEC.md **§7**, rider signed 2026-08-25 — a new standalone thread designates a
  general resident

## Summary

Found in `UI-186`'s running-app drill, 2026-09-02, by the implementing agent —
recorded here because it was not anticipated and it is not an edge case:

> a plain `corpus thread create` gives a general resident **with no designation
> event at all**, so a very common lane has never had a launch record

**This is the ordinary path.** Rider A makes every new standalone thread
designate a general resident. If that designation enqueues no
`resident.designated`, then `AGENT-059`'s launch record — the weight the listener
went out at, and whether it was stated or judged — is never written for it, and
there is nothing for any surface to read.

It is the row in the screenshot that prompted `UI-186`: a lane whose weight
column says *"weight set at launch"* and whose launch nobody can name.

## Why it matters

- **It undercuts a promise this release is named for.** v0.32.0 is *"you can find
  out what model did the work"*. For the commonest lane you cannot — not because
  the record was reaped, but because it was never written.
- **The two absences look identical and are not.** A job log is runtime state
  reaped with its event (§7), so "no record" is an expected state for an old
  lane. "No record was ever written" is a different fact, and `UI-186`'s pane
  cannot distinguish them — it reports both as unknown, which is honest and
  unhelpful.
- **A turn still names its model** (§10), so this is not a total blackout. What is
  missing is the *lane's* account of itself, which is what the Residents tab is
  for.

## Acceptance Criteria

- [ ] A thread created through the ordinary path either enqueues a
      `resident.designated` for the general resident it designates, **or** the
      absence is deliberate and documented, and the surfaces are told which so
      they can say something truer than "unknown"
- [ ] Whichever it is, `UI-186`'s pane can tell "never recorded" from "reaped",
      because they mean different things to the person reading
- [ ] No duplicate designation events for a thread that already designates
      explicitly — an event per creation path, not per code path

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/create.ts` and `apps/server/src/threads/resident.ts` —
  where a creation designates and what it enqueues
- Whatever `UI-186`'s `launchRecord.ts` needs to tell the two absences apart

### Notes

- **Check before changing.** It may be deliberate: enqueueing a designation event
  for every new thread is a queue item per thread, and someone may have decided
  that cost was not worth paying. If so the fix is on the reading side, not the
  writing side, and this issue becomes a documentation and surface change.
- `resident.ts` already guards against churn — `sameResident` deliberately
  excludes `designationId` so a no-op re-designation does not displace a
  listener. Whatever is added must not defeat that.

## Testing Strategy

A server test that the ordinary creation path produces (or documentedly does not
produce) the event, and a `UI-186` component test for the two distinguishable
absences. `INFRA-034` story 2 already reads launch records and would catch a
regression that stopped writing them.

## E2E Verification Log

_Filled by the implementing agent; state the model._

**Pre-fix observation, 2026-09-02 (ui-dev, Opus 5, during UI-186's drill):** a
real workspace, a plain `corpus thread create`, a general resident in the
thread's frontmatter, and no `resident.designated` on the queue for it.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
