# [CLI-047] `corpus doc create` prints no key, so a create-then-edit turn needs a second read

## Domain

cli

## Status

done

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

Implemented on: **opus**.

### The question, answered before the code

**Yes — `doc create` prints a key**, on the line after its confirmation, in the
same shape every other write that lands prints one.

The case against was real and is the one worth answering: printing a key invites
a caller to hold it across an interval in which anything may have changed, which
is the habit §7's key contract exists to break. It loses **on the contract's own
terms**. A key the document has moved past is *refused*, so printing one here can
save a read when nothing intervened and can never cause a wrong write when
something did. The "intermittent failure" the argument fears is the mechanism
working, and its recovery — read the document again — is the read the caller
would otherwise have been making unconditionally, every time, for nothing.

The creating process is also the one party that unambiguously knows the bytes,
and a create-then-edit is the one sequence where no other writer can have
intervened without the edit being refused anyway.

### Post-Implementation Verification

Real server, real workspace, port **8766**:

```
$ corpus doc create --type note --title "No read between" --from agent -m "first"
created doc_t5n2zuem — data/docs/inbox/no-read-between.md
key a73e157f24ffda1b…

$ corpus doc edit doc_t5n2zuem --key a73e157f24ffda1b… --from agent -m "second, …"
edited doc_t5n2zuem
key 083ee12970429e7b6cfc5475807aa3b899e779001bce4f970c872cfe1391d6b8
```

A create, then an edit against the key the create printed, **with no read in
between** — which is the whole of what this issue asked for — and a fresh key
back for whatever comes next.

**Pinned, because the defect this prevents is an example drifting from the real
output.** Three assertions in `create.test.ts` now spell the full two-line output
byte for byte, including the key, for a document, an `agent-def` and a thread.
That is what AGENT-025's worked example got wrong: it printed a key because a
reader expects one there, and nothing checked.

`apps/cli`: 2,217 passed, 109 files. `docs/cli.md` regenerated — the verb's own
description now says it prints the key, so the help and the behaviour cannot
disagree.

## Completion Checklist (orchestrator)

- [ ] Committed with `[CLI-047]` prefix
