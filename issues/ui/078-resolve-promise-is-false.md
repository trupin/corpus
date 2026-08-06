# [UI-078] The resolve confirmation promises replying reopens the thread; it does not

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: SHARED-019 (whose Amendment 1 is the better fix, if signed)

## Spec References

- SPEC.md §8 — a resolved thread does not re-trigger the agent
- SPEC.md §14 — a mutation's outcome is reported honestly

## Summary

Found while drafting SHARED-019, and **it is true today, independent of that
rider**. The resolve confirmation the UI shows reads, verbatim:

> `Thread resolved — committed. Replying reopens it.`

**Replying does not reopen it.** Verified end to end while drafting:

- `apps/server/src/threads/participation.ts` returns false for the implicit
  re-trigger when `status === "resolved"`.
- `buildTurnAppend` writes only `updated` and `agent` on a reply. **`status` is
  untouched on every reply path** — nothing anywhere sets a resolved thread back
  to open.

So a person who resolves a thread, reads that sentence, and later replies gets
silence: the reply lands in the file, the thread stays resolved, and the agent
is never woken. There is no error, no badge, and no way to tell from the screen
that the message went nowhere.

There **is** an escape hatch and it is invisible: an explicit `@agent` mention or
the composer's ask-agent toggle short-circuits *before* the resolved check, so
those do still enqueue. A person who happens to type `@agent` is fine; a person
who just replies is not — and nothing distinguishes the two cases on screen.

This is the same class of defect as UI-058 and UI-069: **a surface asserting
something the write path does not do.** It is worse than those two because the
false promise is in a confirmation dialog, which is exactly where a person forms
their mental model of what resolving costs them.

## Two possible fixes — pick deliberately

1. **Make the promise true.** A person's reply reopens the thread, then §8's
   ordinary rules apply. This is **SHARED-019's Amendment 1**, drafted and held
   for sign-off, and it is the better fix: it makes *every* resolution
   recoverable, including one the person made themselves by mistake, and it is a
   precondition for letting the agent resolve anything.
2. **Make the copy true.** If Amendment 1 is not signed, the sentence has to go
   or change — something like "Replying will not reach the agent; mention
   `@agent` to ask for more." Less good, but honest, and it can ship today.

**Do not do nothing.** Either the behaviour or the sentence is wrong; leaving
both is the only unacceptable outcome.

## Acceptance Criteria

- [ ] The confirmation's claim and the system's behaviour agree
- [ ] If fix 1: a person's reply to a resolved thread reopens it and wakes the
      agent per §8; an **agent** turn does not reopen (or agent resolution would
      immediately undo itself); a note-only reply reopens without waking
- [ ] If fix 2: the copy states what actually happens, including that an
      `@agent` mention still reaches the agent
- [ ] A test that pins whichever is chosen — the current gap exists because
      nothing asserted the confirmation's claim against the write path

## Technical Design

### Files to Create/Modify

- The resolve confirmation copy (UI), and — for fix 1 —
  `apps/server/src/threads/participation.ts` plus the reply path that writes
  `status`.

### Notes

- The invisible `@agent` escape hatch is worth surfacing to the user whichever
  fix is chosen; today it silently divides replies into two classes.

## Testing Strategy

Server-side: resolve, reply, assert whether an event is enqueued and what
`status` becomes. UI: assert the confirmation's text against that behaviour so
the two cannot drift again.

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
