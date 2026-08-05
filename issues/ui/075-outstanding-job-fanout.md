# [UI-075] UI-069's per-thread jobs query fans out once per thread card

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: UI-069 (which introduced this)
- Blocks: merging PR #24

## Spec References

- SPEC.md §8 (the honest pending indicator), §11 (adaptive thread placement —
  margin cards in focus mode and wide layouts)

## Summary

Found by the Fable review of PR #24. **A regression this issue's own predecessor
introduced, on the reasoning that its docblock got wrong.**

UI-069 moved `useOutstandingAgentJob` from the shared console query
`["jobs", {}]` to a filtered `["jobs", {originId}]` per thread, and justified the
cost with this claim, now in `apps/ui/src/thread/outstandingAgentRequest.ts`:

> "This hook runs in an open thread reader, of which there are as many as the
> user has columns open"

That is **false**, and `packages/kit/src/row/useRowSignals.ts` leans on the same
false claim to justify sparing the row hook. The hook is called from
`ThreadCard.tsx:216`, and `ThreadCard` is mounted **once per thread**, not once
per reader:

- `apps/ui/src/anchors/AnchoredThreads.tsx:93` — `MarginColumn` maps
  `threads.map(...)` to one `ThreadCard` each, ungated. This is the Docs-style
  margin placement §11 mandates for focus mode and wide layouts, i.e. the common
  case, not an edge one.
- `apps/ui/src/thread/ThreadCard.tsx:418` — child threads mount `ThreadCard`
  recursively.
- Also mounted from `reader/ThreadSlot.tsx:66` and `reader/DocView.tsx:308`.

**The cost.** A document with 30 anchored comments, opened in focus mode: before
UI-069 all 30 cards shared one `["jobs", {}]` entry → **one** request. After it,
30 distinct keys → **30 concurrent `/api/jobs` requests**, each an unindexed scan
(the `WHERE` is over a `json_extract` CASE, so no index can serve it) with up to
four point queries per returned row — and all 30 refetch on **every** `["jobs"]`
SSE invalidation, which the queue emits on every transition.

SHARED-010, applied in the same PR, adds a comments list holding *every* thread
on the document with reply-in-place, which multiplies this again.

## Also in scope (review MINOR 3)

`apps/server/src/jobs/project.ts` drops `LIMIT` entirely on the filtered path, so
`?originId=X` with no `status` returns every job that document ever produced.
"One document's jobs are bounded by its own history" is true but is not a bound —
processed events are retained under `.corpus/queue/processed/`. Latent today
because both shipped callers pass the non-terminal status set. A
`MAX_RECENT_JOBS`-style ceiling **with an explicit overflow signal** would keep
the completeness guarantee honest without being open-ended; a silent cap would
reintroduce exactly the dishonesty UI-069 removed.

## Acceptance Criteria

- [ ] A document with N anchored threads issues a number of jobs requests that
      does **not** grow with N — proven by a test that counts requests at the
      transport, not by inspection
- [ ] The completeness UI-069 bought is not given back: a job buried behind more
      than `DEFAULT_RECENT_JOBS` newer rows is still found for every thread on
      the document, margin cards included
- [ ] Both docblocks' economics arguments are corrected — the current text in
      `outstandingAgentRequest.ts` and `useRowSignals.ts` contradicts the call
      site, and a reader trusting either will make this mistake again
- [ ] The unbounded filtered response is bounded, or the contract states why it
      is safe to leave open-ended

## Technical Design

### Notes — options, none chosen

1. **One query per document rather than per thread.** The natural shape, and the
   one that matches how the data is used: a reader knows its document's threads.
   Needs the wire to accept more than one origin (a repeated or comma-separated
   `originId`), which is a CONTRACT change — file it if this is the route.
2. **Host-dependent behaviour.** `ThreadCard` already takes a `host` prop
   (`margin`, `nested`, …). The focused thread view could keep the complete
   filtered answer while margin and nested cards ride the shared console query.
   Cheaper, but it makes correctness depend on where a card is rendered, which is
   the kind of rule that is right when written and wrong six months later.
3. **Lift the query to the surface that owns the set** — `AnchoredThreads` /
   `DocView` fetch once and pass results down. Contradicts the stated reason
   neither row signal is a prop (a plugin can render a row anywhere), so it needs
   an answer to that.

Option 1 is the most honest and the most work. Decide deliberately.

## Testing Strategy

Transport-level request counting over a document with many anchored threads
(`readerFixture` already records every call and now emulates the server's
filtering), plus the existing buried-match assertions kept intact.

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
