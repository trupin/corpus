# [SERVER-101] Starting a thread is not one of §4's acts, so its commit gets renamed

## Domain

server

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Related: SERVER-092 (wired the act closers), SHARED-040 held item (c) (the
  signed change that made this visible)

## Spec References

- SPEC.md **§4** — "What closes a window", whose first entry is "a turn posted to
  a thread"
- SPEC.md **§4** — "A window that closes with no act to name says so"

## Summary

Raised by PR #42's review as a MINOR, twice, and left unfixed both times because
it is pre-existing and does not block. Filed so it stops being rediscovered.

§4's closer list begins "a turn posted to a thread" — since the user struck the
word `agent` on 2026-08-10, that covers either party. But the turn that
**creates** a thread does not go through `commitTurnAppend`: `threads/create.ts`
sets no `act`, so `POST /api/threads` neither closes the window nor keeps its
subject.

The observable cost: a person who comments on a document mid-edit has their
`comment: new thread on doc_… by user` subject overwritten by whatever save folds
in next, and relabelled `editing session: N documents by user` when the window
closes — which §4 says an act's commit should not be. And starting a thread is
the canonical UI flow for commenting.

## The question, which is small but real

Is a thread's **first** turn a turn? §4's list says "a turn posted to a thread",
and the first one is posted *with* the thread rather than to it. Reading it as
"yes, obviously" is probably right — the reviewer's argument is that the delta's
own justification in `turns.ts` ("a person's comment is the clearest case of §4's
own definition — under §8 it is what wakes the agent") applies verbatim to the
comment that creates the thread.

But it is a one-word spec question, so if the answer turns out to need §4's list
to say "a thread started or a turn posted to one", that is a rider and not a
diff. Escalate rather than widening the list in code.

## Acceptance Criteria

- [ ] The question above is answered, and the answer is recorded
- [ ] If a thread creation is an act: `threads/create.ts` declares it, the
      commit's subject survives the window closing, and there is a test for a
      person commenting mid-edit
- [ ] The parent document's frontmatter write, which an anchored thread creation
      also performs, still lands in the same commit — this act touches two files
      and must not become two commits
- [ ] `docs/acts.test.ts`'s "does not close a window" list is unaffected

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/create.ts`

## Testing Strategy

Beside `docs/acts.test.ts`'s existing per-act cases: a body save, then a thread
creation on that document, inside the idle window — one commit, subject names the
thread, and the next save opens a fresh one.

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
