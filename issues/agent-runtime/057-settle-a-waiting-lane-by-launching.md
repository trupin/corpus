# [AGENT-057] The orchestrator settles a waiting lane by launching, never by answering

## Domain

agent-runtime

## Status

done

## Priority

P0

## Model

fable

## Dependencies

- Depends on: SERVER-161

## Spec References

- SPEC.md §7 — **A lane that cannot be worked says so** (rider signed 2026-08-27)

## Summary

The orchestrate skill has to know what a `lane.waiting` is and — more
importantly — what it is not.

Its loop dispatches what it claims. `lane.waiting` is the one event type it will
claim that must **never** be dispatched: it is a report that somebody else's
conversation is unattended, and answering it would be the orchestrator writing in
a resident's name, which the rider signed 2026-08-25 removed the fallback to
prevent.

The payload gives it nothing to answer with (CONTRACT-093), so the failure is
already impossible rather than merely forbidden. The skill still has to say so,
because a reader who meets an unfamiliar event type and no rule will reach for
the general one.

## Acceptance Criteria

- [x] The event-type table names `lane.waiting` and what settles it
- [x] The skill states plainly that it is **not** dispatched, and why — a
      sentence about writing in a resident's name, not a sentence about payloads
- [x] Settling it is: make sure a listener is running for the lane it names, then
      settle the event. The existing once-per-pass-per-lane launch rule applies
      unchanged — several notices for one lane launch one listener
- [x] A notice for a lane that is already live settles with no launch, and that
      is an ordinary outcome rather than a discrepancy to log
- [x] `scripts/workspace-template.test.ts` pins all of it

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md`
- `scripts/workspace-template.test.ts`

### Key Implementation Details

It belongs beside `resident.designated` in the routing section, because it is the
same act arriving for a different reason: one says a lane *was given* a listener,
this says a lane *is owed* one. The launch rule they both feed is already
written and must not be duplicated.

## Testing Strategy

The template test, over the skill's prose.

## E2E Verification Log

**Implemented on: opus.** Prose, so the verification is the pinned assertions
and one falsification.

The rule the skill now carries, in its own words: *"Everything else in the table
above is work; this is a report that work exists somewhere you may not touch.
Answering it would be you writing in a resident's name… There is no thread to
read, no turn to reply to, no author, no text: an instruction to answer it could
not be followed even if you took one."*

Two consequences that are easy to leave out and easy to misread as faults are
stated: a notice for a lane that has since gone live settles with **no launch**
and that is ordinary, and several notices for one lane are **one** launch under
the existing once-per-pass-per-lane rule.

It also names the case that prompted the report — *"which is most of the time
after you restart, since restarting you ends every listener you launched while
their conversations keep accepting messages"* — because a rule whose triggering
situation is unnamed is a rule a reader does not connect to what they are
seeing.

### Falsification

```
$ # "**Do not dispatch it.**" -> "It is fine to dispatch."
      Tests  1 failed | 505 passed (506)
   × launches once per lane per pass, and stops when a launch does not take
```

## Completion Checklist (domain agent)

- [x] Tests pass
- [x] Lint clean
