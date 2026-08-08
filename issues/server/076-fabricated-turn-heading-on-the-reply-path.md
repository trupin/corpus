# [SERVER-076] A turn body can still fabricate a turn heading on the reply path

## Domain

server

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SERVER-075 (which closed the fence half through the same doors)
- Blocks: —

## Spec References

- SPEC.md §6 — the turn format `## <author> · <ISO instant>`

## Summary

Reported by the SERVER-075 agent, scoped out deliberately rather than smuggled in.

`assertAppendableAnswer` guards two shapes on the **form-answer** route: an
unterminated fence, and a body carrying a line that reads as a turn heading.
SERVER-075 closed the fence half across all four write surfaces. **The
fabricated-heading half is still unguarded on the reply path**, so a person can
post a turn whose body contains a literal `## user · 2026-01-01T00:00:00Z` line
and split their own message into two turns.

## Why it is P2 and not P0 like its sibling

The two failures are different in kind, and that difference is the whole
justification for shipping one without the other:

- A swallowed turn is **silent**. The turns are on disk, every reader sees fewer,
  and nothing anywhere says so.
- A fabricated heading is **visible when it happens**. The extra turn appears in
  the thread immediately, attributed and timestamped, where the person who wrote
  it is looking.

Nothing is lost, and the damage announces itself.

## Acceptance Criteria

- [ ] A turn whose body contains a line matching the turn-heading grammar is
      refused on the reply path, and on thread creation and capture — the three
      doors SERVER-075 found, since there is no reason to expect this one to have
      fewer
- [ ] The refusal names the offending line, as the fence refusal does
- [ ] A body that **quotes** a turn heading inside a fence, block quote, or
      inline code is **not** refused — that is ordinary content, and the skills
      themselves have to be able to write the format down
- [ ] Pre-existing threads containing such a line still load, still save, and
      still parse exactly as they do today. This is a write-time guard only
- [ ] It reuses `parseTurns`' own notion of a heading rather than a second
      regex — a private copy would drift from the parser it is protecting, which
      is the failure this repo has fixed four times

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/fences.ts` is the natural home — SERVER-075 built it
  as the shared guard for exactly this class, called from all four surfaces.

### Notes

- The quoting exemption is the hard part, and it is the reason this is not a
  five-minute change: `core/turns.ts` already excludes fenced regions when
  finding delimiters, so the guard must ask that same code rather than scanning
  lines itself.
- Check whether the agent should be exempt. The skills post multi-line bodies
  and one of them documents the turn format; refusing an agent turn that quotes
  a heading correctly would break the workspace template's own examples.

## Testing Strategy

Fixtures for a bare fabricated heading (refused on all three doors), a heading
inside a fence, inside a block quote, and in an inline code span (all accepted),
and a pre-existing thread carrying one (still loads and saves).

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-076]` prefix
