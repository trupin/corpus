# [SERVER-101] Starting a thread is not one of §4's acts, so its commit gets renamed

## Domain

server

## Status

done — 2026-09-06, committed on phase-58, evaluator PASS

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

## The answer, and why (recorded 2026-09-06)

**Yes. A thread's first turn is a turn under §4's existing text, so a thread
creation is an act. No spec change, no rider, no escalation.** The ruling is the
orchestrator's (2026-09-06, recorded as sprint-024 Ruling 2); this section is the
implementing agent's record of it and of the reasoning it rests on.

Four things carry it:

1. **§4's own words already reach it.** The entry reads "a turn posted to a
   thread". A creation posts a turn to a thread — the thread it is posting it to
   is the one it is making, which is a fact about ordering inside one atomic
   write and not about what the turn is. Nothing in §4 distinguishes a first turn
   from a later one, and §6's thread format does not either: the file's body is a
   list of turns, and the first is one of them.
2. **The delta's own justification transfers verbatim.** `threads/turns.ts` says
   a person's comment is "the clearest case of §4's own definition — a change
   someone else can act on — since under §8 it is what wakes the agent". That is
   *more* true of the comment that starts the conversation, not less: it is the
   turn §8 reads for `requestsAgent`, mentions and skill invocations, and the one
   that enqueues `comment.created`.
3. **The alternative makes the rule about the door rather than the change.** A
   person's remark reached §4's list if they typed it into an existing thread and
   did not if they started one — with no way to tell the two apart from `git log`,
   which is the same defect SERVER-106 reports next door.
4. **The observable cost was real and is now measured.** Before this change, a
   person commenting mid-edit had `comment: new thread on doc_… (th_…) by user`
   overwritten by the next save folding into the same window, and relabelled
   `editing session: N documents by user` on close. See the E2E log below: the
   subject now survives, and the next save opens a fresh window.

**Shape: `"names-the-window"`, not `"commits-alone"`.** §4 gives the second shape
to a deletion and a bulk Save and to nothing else. It also matters here for a
reason §4 does not have to state: the anchored mode writes the parent's
frontmatter *and* the thread file, and §6 forbids the intermediate state ("no
highlight is ever left pointing at an empty conversation"). `"names-the-window"`
folds the write into the open window and closes after it, so both files stay in
one commit. `"commits-alone"` would have closed first and split them.

**What was not widened.** §4's list is untouched, in code as in prose: the change
is one `act:` field on the plan `threads/create.ts` already builds. The reading
that would have needed a rider — §4's list saying "a thread started **or** a turn
posted to one" — is not the reading taken, because the existing entry already
covers it.

## Acceptance Criteria

- [x] The question above is answered, and the answer is recorded
- [x] If a thread creation is an act: `threads/create.ts` declares it, the
      commit's subject survives the window closing, and there is a test for a
      person commenting mid-edit
- [x] The parent document's frontmatter write, which an anchored thread creation
      also performs, still lands in the same commit — this act touches two files
      and must not become two commits
- [x] `docs/acts.test.ts`'s "does not close a window" list is unaffected

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/create.ts` — one `act: "names-the-window"` on the
  plan's `commit`, with the ruling written beside it
- `apps/server/src/docs/acts.test.ts` — two cases added to §4's positive list
- `apps/server/src/threads/pipeline.test.ts` — one test rewritten (see below)
- `apps/server/src/edit/acknowledgment.test.ts` — one expectation parameterised
  (see below)

### The two tests that had to change, and why neither is a waiver

Both asserted a fold that §4 no longer permits, and both were asserting it
**incidentally** — neither is about thread creation.

- `threads/pipeline.test.ts` — "folds two same-actor thread writes inside the
  squash window into one commit" created a thread and then appended a turn, and
  expected one commit. A turn append has declared the act since SERVER-092, so
  the pair was only ever one commit because the *creation* did not. Rewritten as
  "gives every thread write its own commit, because every one of them is an act
  (§4)", which is what the pipeline now has to be right about.
- `edit/acknowledgment.test.ts` — SERVER-096's "a commit that opened no session
  does not move the base" runs two edits with an interloping write between them,
  and its shared helper hard-coded `HEAD~2`. A thread creation is now an act, so
  the typing after it lands its own commit and the range is three long instead of
  two. The helper takes the count as a parameter; the invariant it exists for —
  the range starts before the first edit and holds both — is asserted unchanged,
  and the frontmatter-only door (which is still not an act) keeps `2`.

## Testing Strategy

Beside `docs/acts.test.ts`'s existing per-act cases: a body save, then a thread
creation on that document, inside the idle window — one commit, subject names the
thread, and the next save opens a fresh one. Both landed:

- `a thread started mid-edit — the first turn is a turn (SERVER-101)` — the
  mid-edit comment the issue names.
- `an anchored thread creation stays one commit, not two (SERVER-101)` — the
  two-file criterion, asserting the parent's path and the thread's path in one
  `git show --name-only`, and the anchor id on disk in the parent.

## E2E Verification Log

**Model: Opus 5 (`claude-opus-5[1m]`).** Real `corpus init` workspace at
`…/scratchpad/ws101`, real server started with `corpus server start` (pid 66225,
port 8767), driven with `curl` over HTTP, observed with `git log` in the
workspace repository. No mocks, no test client.

### Pre-fix reproduction

Not a bug report against behaviour anyone filed from the outside, so the pre-fix
state is recorded from the code and from the suite rather than from a run: before
this change `threads/create.ts` set no `act`, `docs/acts.test.ts` had no case for
a thread creation, and `threads/pipeline.test.ts` asserted the fold that proves
the window stayed open — a create followed by a same-actor turn was **one**
commit. That test is the pre-fix reproduction, and it now asserts the opposite.

### Post-fix, on the real server

**1. A person comments mid-edit — one commit, and the creation names it.**

```
=== 2. a body save opens a window ===
PUT 200
commits: 3
6322752 user doc edit: Pricing (doc_wakht2p5) by user

=== 3. comment mid-edit — an anchored thread creation, two files ===
thread th_yxlt3exb anchor anc_381b4d69
commits: 3 (delta 0)
ff25aeb user comment: new thread on doc_wakht2p5 (th_yxlt3exb) by user

data/docs/inbox/pricing.md
data/threads/th_yxlt3exb.md
```

The creation added **no** commit — it folded into the open window — and that one
commit holds **both** files: the parent's frontmatter write and the thread. The
two-file criterion, from `git show --name-only` on a real repository.

**2. The subject survives the window closing.**

```
=== 4. the person keeps typing — the subject must survive ===
PUT 200
commits: 4 (delta 1)
5c95ac2 user doc edit: Pricing (doc_wakht2p5) by user
ff25aeb user comment: new thread on doc_wakht2p5 (th_yxlt3exb) by user
0e707f8 user editing session: 1 document by user
```

The next save by the same party, at the same instant, opened a **fresh** window
(delta 1) rather than folding in and relabelling `ff25aeb` an editing session,
which is what happened before the fix.

**3. The anchor entry landed in that same commit.**

```
9:anchors:
10-  anc_381b4d69:
11-    exact: the sentence to quote
```

### Checks run

- `vitest run apps/server/src/docs` — 37 files, **822 passed**
- `vitest run apps/server/src/threads apps/server/src/edit apps/server/src/queue apps/server/src/capture`
  — 39 files, **1123 passed**
- `vitest run apps/server/src/reflect …/agents …/folders …/attachments …/check …/middleware`
  — 23 files, **516 passed**
- `tsc --noEmit -p apps/server/tsconfig.json` — clean
- `eslint` + `prettier --check` on every touched file — clean

Server stopped (`stopped (pid 66225)`), port 8767 verified free.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
