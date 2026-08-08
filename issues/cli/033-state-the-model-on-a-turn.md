# [CLI-033] Nothing can state a model, so every turn shows blank

## Domain

cli

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-043, SERVER-074 (both done — the field and the write path exist)
- Blocks: the SHARED-027 feature being visible at all
- Sibling of: AGENT-021 (which decides *what* to state)

## Spec References

- SPEC.md **§11** Thread view — "An agent turn says which model wrote it"
- SPEC.md **§7** — the deciding stage's weight governs

## Summary

**Found by SERVER-074, reported rather than papered over.** The contract carries
`model`, the server writes it into `turnModels` and projects it, and the UI shows
a chip for it. **Nothing sets it.** SERVER-074 checked every candidate source
before concluding this: the queue event carries no model, the job log has the
tier only as free prose in a dispatch line that §7 reaps with the event, and
`apps/cli/src/commands/thread/reply.ts` posts `{ body }` alone.

So the user's request — *"on each comment posted by the agent, I want to be able
to quickly identify which model worked on it"* — currently renders an empty space
on every turn. The mechanism is complete and **inert**.

The agent reaches the system only through the CLI (Architecture Decision 2), so
the CLI is where the value has to enter.

## Acceptance Criteria

- [ ] `corpus thread reply` and `corpus thread create` can state the model that
      wrote the turn, and it reaches `turnModels` on disk
- [ ] **Absent stays absent.** Omitting it must post no `model` at all, not an
      empty string — §11 requires a turn with no record to show nothing rather
      than a guess, and SERVER-074 refuses a blank so absence has one spelling
- [ ] A **person's** turn cannot carry one. The server already refuses it with a
      `400`; the CLI should not make that reachable by accident, and its help
      should say so rather than leaving the refusal to be discovered
- [ ] It is a **display string**, not a validated set — §7 keeps model names in
      the skill, and CONTRACT-043 kept the wire free of an enum for the same
      reason. A CLI that validated against a list would freeze what the rider
      took pains to keep editable
- [ ] The help says what it is for — a fact about what ran, never a request for
      what should run. CONTRACT-039's weight is the other thing and they must
      not be conflated
- [ ] `docs/cli.md` regenerated, never hand-edited

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/thread/reply.ts`, `apps/cli/src/commands/thread/create.ts`,
  and whichever flag module they share.

### Notes

- Check `capture` too. SERVER-075 found three write doors when the issue named
  one, and SERVER-070 found a second door for forms; assuming this one has fewer
  would be the third time.
- **Do not have the CLI guess.** It cannot know which model is running it, and a
  plausible default is exactly what §11's "nothing rather than a guess" forbids.
  The value comes from the caller.

## Testing Strategy

Stated model reaches the request; omitted sends no field; a blank is refused; a
person's turn with a model is refused with a message that explains rather than
just failing. Plus the generated-docs drift check.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CLI-033]` prefix
