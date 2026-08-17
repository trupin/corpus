# [CLI-047] `corpus doc create` prints no key, so a create-then-edit turn needs a second read

## Domain

cli

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Related: AGENT-025 (which found it by getting it wrong in an example),
  the key contract in SPEC.md §7

## Spec References

- SPEC.md **§7** — keys, not locks: a write carries the key of the bytes it was
  computed from, and a stale key is refused

## Summary

`corpus doc create` prints `created doc_… — data/docs/…` and **no key**. Every
edit verb needs one, so a skill that creates a document and then edits it in the
same turn must issue a second read purely to obtain a key for bytes it just
wrote and already knows.

Found the way these things should be found: `AGENT-025`'s worked example printed
a key after `doc create`, and the drill measured the real output and caught it.
The example was wrong, not the CLI — but the reason the example looked right is
that a key there is what a reader expects, and expects because it would be
useful.

**Neither of the other two skills exposes this**, because neither shows create
output. A create-then-edit turn is a real shape though, and the resident's loop
makes it more common rather than less.

## The question to answer before changing anything

**Should `doc create` print a key at all?** There is a case against: a key is a
statement about bytes on disk at a moment, and printing one invites a caller to
hold it across an interval in which anything may have changed — which is
precisely the habit the key contract exists to break. A key that is *usually*
still valid is a worse affordance than no key, because the failure is
intermittent.

There is a case for: the creating process is the one party that unambiguously
knows the bytes, and a create-then-edit is the one sequence where no other
writer can have intervened without the edit being refused anyway — which is the
contract working, not a hole in it.

If the answer is no, this issue closes by saying so where a skill author will
read it, so the next person does not write the same example.

## Acceptance Criteria

- [ ] The question above is answered explicitly, with reasoning, before any
      code changes
- [ ] If a key is printed, its output is consistent with the other verbs that
      print one — not a third format
- [ ] If it is not, the reason is recorded somewhere a skill author meets it,
      and `docs/cli.md` says plainly that a create is followed by a read

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/doc/create.ts`
- `docs/cli.md` (regenerated)

## Testing Strategy

Unit on the output. Whichever way this goes, pin it: the defect it prevents is
an example drifting from the real output, which is what happened.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (orchestrator)

- [ ] Committed with `[CLI-047]` prefix
