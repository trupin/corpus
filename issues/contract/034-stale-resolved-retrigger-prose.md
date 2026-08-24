# [CONTRACT-034] Stale prose: a resolved thread no longer stops re-triggering

## Domain

contract

## Status

done

## Priority

P2 (nice-to-have)

## Model

opus

## Dependencies

- Depends on: **SERVER-062** (done) — the behaviour change that falsified this
  text
- Blocks: —
- Related: **SHARED-019** Amendment 1 (signed 2026-08-05, applied to SPEC §8) —
  the rule the prose is now out of step with

## Spec References

- SPEC.md **§8** — the re-trigger bullet as amended: "**Resolved is a closed door,
  not a locked one: a person's reply reopens it.** A turn written by a person on a
  `resolved` thread sets the thread back to `open`, and from there §8's ordinary
  rules apply unchanged… A turn written by the **agent** never reopens a thread."
- SPEC.md **§6** — forms in turns; the answer is a turn a person wrote

## Summary

SERVER-062 made a person's turn on a resolved thread reopen it, so the resolved
guard can no longer fire for a person's turn — the participation decision is
taken against the status *after* the turn. The server's own docblock was updated
to match and is now correct: `apps/server/src/threads/forms.ts:145-149` says, in
so many words, that "**A resolved thread** is *reopened* by a person's answer,
which then re-triggers on §8's ordinary terms".

The contract's transcription of the same fact was not updated.
`packages/contract/src/schemas/form.ts:253-257` still describes
`FormAnswerResponseSchema.eventId` as:

> "The enqueued `form.respond` event, which re-triggers the agent like any
> engaged-thread reply (SPEC.md §6). Null when the answer does not re-trigger it —
> **a resolved thread stops re-triggering the agent even while it is engaged
> (SPEC.md §8).**"

The bolded clause is false, and it is false in the one direction that matters:
the commonest reason a reader would expect `null` is now a reason it will be
**non-null**. A person answering a form on a resolved thread reopens it and *does*
enqueue.

This is a **description-only** change. The field stays nullable — there are
surviving reasons, they are just not the one named — so no schema shape, no
required/optional change, no route change. But `describe()` text is generated into
`openapi.json` and into the typed client's JSDoc, so it is what every consumer
reads, and a wrong sentence there is worse than no sentence: it tells a CLI or UI
author to expect `null` on a path that returns an id.

## What actually leaves `eventId` null now

Read off `apps/server/src/threads/forms.ts:139-160`, which is the authority (the
form path calls `decideParticipation` with the tri-state omitted, so every corner
falls out of §8's automatic clause rather than a rule written locally):

1. **A thread the agent is not `engaged` in** — the already-detached
   conversation. Waking the agent for it would contradict §8's opt-in premise.
2. **The agent answering its own form** — it would hand the agent its own reply
   to answer, forever. This is also the one case where a resolved thread stays
   resolved, since an agent turn never reopens.

**Correct the brief on a third**: "note-only" is *not* a reason on this path.
`FormAnswerRequestSchema` carries exactly `option` and `note` and nothing else
(pinned by `packages/contract/src/openapi.test.ts:2411-2415`), so a form answer has
no note-only toggle to set. The note-only exclusion is real for §8 generally and
for the *reply* path; it does not apply to `FormAnswerResponse`. The replacement
text must not import it, or it will be a second wrong sentence replacing the
first.

## The nearby comment is stale too — the previous reader was wrong

The brief asks whether `openapi.test.ts`'s nullability comment is still accurate,
noting a previous reader thought it was. **It is not.**
`packages/contract/src/openapi.test.ts:2418` reads:

> `/** Nullable, not optional — a resolved thread stops re-triggering the agent (§8). */`

That is the same false clause, in the same words, one file over. The *assertion*
it decorates is fine — it pins `FormAnswerResponse`'s required keys and has
nothing to do with why the value may be null — which is presumably why a reader
skimming it concluded it was accurate. The comment's job is to say **why** the
field is nullable-and-required rather than optional, and the reason it gives is
the one reason that no longer holds. Both sites move together or the repo keeps a
copy of the mistake next to its own drift guard.

## Acceptance Criteria

- [ ] `FormAnswerResponseSchema.eventId`'s `describe()` no longer claims a
      resolved thread stops re-triggering
- [ ] It names the reasons that **do** survive — non-engaged thread, and the agent
      answering its own form — and does not name note-only
- [ ] It states the reopen rule positively, so a reader learns the current
      behaviour rather than merely losing the wrong one: a person's answer on a
      resolved thread reopens it and re-triggers on §8's ordinary terms
- [ ] `packages/contract/src/openapi.test.ts:2418`'s comment is corrected in the
      same change
- [ ] **No shape change**: `eventId` stays required-and-nullable; no property
      added, removed or reordered; no route touched
- [ ] `packages/contract/openapi.json` and
      `packages/contract/src/client/schema.generated.ts` are regenerated, and the
      regeneration is the only reason they change
- [ ] The pre-push OpenAPI drift check passes
- [ ] A sweep for the same stale claim elsewhere: grep the repo for "stops
      re-triggering" / "resolved thread" prose in `packages/contract/src`,
      `apps/cli/src` and `apps/ui/src`, and correct anything else carrying it —
      one wrong sentence copied twice is the pattern this issue exists to close

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/form.ts` — the `eventId` `describe()` at
  lines 253–257.
- `packages/contract/src/openapi.test.ts` — the comment at line 2418.
- `packages/contract/openapi.json`,
  `packages/contract/src/client/schema.generated.ts` — regenerated, not
  hand-edited.

### Key Implementation Details

**Keep the source of truth one-directional.** The server's docblock
(`apps/server/src/threads/forms.ts:139-160`) is already correct and is the richer
statement; the contract's `describe()` is a wire-facing summary of it. Write the
new text *from* that docblock rather than from SPEC, so the two cannot drift
again on a detail the server has already reasoned about — in particular the
author rule (an agent answering its own form on a resolved thread does not reopen
it, and is therefore still the silent case).

**Length discipline.** `describe()` text lands in generated JSDoc that consumers
read at a call site. The current sentence is two clauses; the replacement should
be too. The exhaustive account belongs in the server docblock, which is where it
already is — do not transcribe all twenty lines of it.

**Why this is not a `CHECK_CODES`-style transcription problem.** There is no drift
guard over `describe()` strings, and this issue should not invent one: prose is
prose, and a test asserting an exact sentence would fail on every wording
improvement. The durable protection is that the *behavioural* claim lives in the
server's docblock beside the code that implements it, with the contract's copy
kept short enough to be obviously derivative.

### Edge Cases

- **Answering twice.** Allowed, and appends a second turn with a second event
  (`forms.ts:172-180`). Not a null case; do not mention it.
- **A resolved thread the agent is not engaged in.** Both conditions at once: the
  answer reopens the thread *and* enqueues nothing, because the engagement gate
  is what fires. The replacement text should not imply reopening alone guarantees
  an event.
- **A form on a standalone thread.** No parent document; irrelevant to this field.

## Testing Strategy

- `packages/contract` unit tests still pass unchanged — a description edit must
  not move any assertion except the corrected comment.
- The generated-artefact drift check (`openapi.json` + typed client) passes after
  regeneration.
- If any test asserts on the description string itself, update it; if none does,
  do not add one (see above).
- Worth adding *if it does not exist*: a server-side test that a **person's** form
  answer on a resolved, engaged thread returns a non-null `eventId` and leaves the
  thread `open`. That is the behaviour the corrected prose now promises, and a
  promise on the wire with no test behind it is how this drift happened.

## E2E Verification Plan

This is description-only, so the verification is that the wire text is right and
the behaviour it describes is real.

### Verification Steps

1. `corpus init` a scratch workspace on a non-default port; start the real server.
2. Create a document, comment on it, and have the agent post a turn carrying a
   form. Resolve the thread.
3. `POST /api/threads/{id}/forms/{formTs}/answer` as the **person**. Expected:
   `eventId` is **non-null**, the thread reads back `open`, and the event is in
   the queue (`corpus queue claim-all --json`). This is the case the old sentence
   said would be null.
4. Detach the agent (a thread it is not `engaged` in) and answer a form there.
   Expected: `eventId` is `null` — a surviving reason, now correctly named.
5. Answer a form as the **agent** on a resolved thread. Expected: `eventId` is
   `null` **and** the thread stays `resolved` — the author rule.
6. `GET /api/openapi.json` from the running server and confirm the served
   description is the corrected one, not just the file on disk.
7. Confirm the generated client's JSDoc carries the same text.

## E2E Verification Log

### Implemented on

opus.

### What was already fixed, and what was not

`FormAnswerResponseSchema.eventId`'s `describe()` had **already** been corrected
before this issue ran — it reads *"Null when the answer does not re-trigger it —
which, since only the person answers a form, is exactly the thread the agent is
not engaged in. A **resolved** thread does not stay silent: a person's answer
reopens it and then re-triggers on §8's ordinary terms"*. Every acceptance
criterion about the description is satisfied by that text, and it was left alone.

**The brief's second surviving reason no longer exists.** It listed "the agent
answering its own form" as a case that still leaves `eventId` null.
`answerThreadForm` now refuses an agent actor with a **`403`** before the lane
(`apps/server/src/threads/forms.ts`), so an agent answer never produces a
response at all. The published sentence is right to name **one** reason, and the
brief is the thing that is out of date. Recorded here rather than "fixed" into
the wire.

### What this change actually did

The two stale *comments* the issue names, both still carrying the falsified
clause verbatim:

- `packages/contract/src/openapi.test.ts` — `/** Nullable, not optional — a
  resolved thread stops re-triggering the agent (§8). */`
- `packages/contract/src/schemas/form.test.ts` — `/** A resolved thread stops
  re-triggering the agent (SPEC.md §8), so null is legal. */`

Both now give the surviving reason and name SERVER-062 as what falsified the old
one. The `form.test.ts` **fixture** was misleading in the same way — it built its
null-`eventId` example on a `status: "resolved"` thread, which is now the case
that returns an id — so it was rebuilt on `status: "open", agent: "none"`, the
reason that does survive.

### Sweep

`grep -rn "stops re-triggering"` over `packages/contract/src`, `apps/cli/src`,
`apps/ui/src`, `packages/kit/src`: the only two hits were the two comments above.
`grep -rn "resolved thread"` over the same trees returns 33 hits, all describing
the corrected behaviour (`apps/cli/src/commands/thread/status.ts` and `reply.ts`,
`apps/ui/src/thread/resolveNotice.ts`, `threadCollapse.ts`). Nothing else carries
the claim.

### The behaviour the corrected prose promises, on a real server

Port **8838**, real workspace, `corpus` from source. Thread `th_j7xzwa3j`:
`@agent` ask, an agent turn carrying a ```` ```form ```` fence, then resolved.

```
thread status before: resolved   formTs: 2026-08-24T17:43:26Z
POST /api/threads/th_j7xzwa3j/turns/2026-08-24T17%3A43%3A26Z/form
  {"answers":[{"question":"Which rate?","option":"Fixed"}]}
answer HTTP 201
eventId: evt_xesebs4qkukd
thread status after: open
```

**Non-null `eventId` and a reopened thread** — precisely the case the deleted
sentence said would be null. The served `openapi.json`, fetched from that running
server, carries the corrected description (checked: no `stops re-triggering`).

### Shape

No shape change. `eventId` stays required-and-nullable, no property added,
removed or reordered, no route touched. `openapi.json` and
`schema.generated.ts` were regenerated in the same batch as the other issues in
this phase; the only reason they differ here is regeneration.

### Gates

`vitest run packages/contract` — 2972 tests, exit 0. Typecheck, ESLint, Prettier
clean.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[CONTRACT-034]` prefix
