# [SERVER-074] Write the deciding model onto the agent's turn

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-043
- Blocks: UI-090

## Spec References

- SPEC.md §11 Thread view — "An agent turn says which model wrote it" (rider signed 2026-08-07)
- SPEC.md §7 — the amended console line

## Summary

The persistence half of SHARED-027. CONTRACT-043 decides *where* the model is
recorded; this writes it, projects it, and keeps it honest.

## Acceptance Criteria

- [ ] An agent turn written through the server carries the model that produced it
- [ ] **The server records and never invents.** If the writer did not say which
      model it was, the turn says nothing — the server must not substitute a
      default, a "current model", or the weight it dispatched at. §11 requires an
      unknown to say so rather than show a plausible attribution nobody can check
- [ ] A **person's** turn never carries one, on any path
- [ ] Where a request ran in stages, what lands is the **deciding** stage's model
      (§7). Whatever AGENT-018 records for a staged job and this must agree —
      check that before choosing, not after
- [ ] It reaches the projection so the board can show it without reparsing files
- [ ] Existing threads are untouched: no backfill, no guessing. A `SCHEMA_VERSION`
      bump follows the note convention in `projection/schema.ts`, which records
      why a bump changes verdicts for bytes already on disk
- [ ] `corpus doc check` and `db doctor` stay clean on a thread mixing turns with
      and without the field

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/` (the turn write path), `apps/server/src/core/turns.ts`
  if the chosen shape touches parsing, and `apps/server/src/projection/`.

### Notes

- **The queue event is where the model becomes knowable.** Check what the
  dispatch actually has in hand at write time; if nothing carries it, this issue
  is blocked on that rather than on invention, and saying so is the right answer.
- Do not reuse the weight field. A weight is what was asked for; a model is what
  ran. Conflating them makes §7's "honoured, not weighed again" unverifiable.

## Testing Strategy

Turns written with and without the model; a person's turn asserted to carry none;
a staged job recording the deciding stage; round-trip through parse and
projection; doctor clean on a mixed thread.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
