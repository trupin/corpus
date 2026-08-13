# [UI-075] UI-069's per-thread jobs query fans out once per thread card

## Domain

ui

## Status

done — verified 2026-08-13 (INFRA-027): the work landed and PLAN.md has said so; this file was never ticked. Evidence: a commit carrying the id, or the named implementation and its tests in the tree.

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

- [x] A document with N anchored threads issues a number of jobs requests that
      does **not** grow with N — proven by a test that counts requests at the
      transport, not by inspection
      — `apps/ui/src/anchors/marginJobRequests.test.tsx`: 3 threads → 1 request,
      30 threads → 1 request; verified failing at 30 against the old hook.
- [x] The completeness UI-069 bought is not given back: a job buried behind more
      than `DEFAULT_RECENT_JOBS` newer rows is still found for every thread on
      the document, margin cards included
      — the status filter is a `WHERE`, so settled churn cannot bury anything;
      the saturated-queue case escalates to the exact `?originId=` question.
- [x] Both docblocks' economics arguments are corrected — the current text in
      `outstandingAgentRequest.ts` and `useRowSignals.ts` contradicts the call
      site, and a reader trusting either will make this mistake again
      — both now state that `ThreadCard` mounts once per **thread**, name the
      margin column and the recursive child mount, and cost the shared query.
- [ ] The unbounded filtered response is bounded, or the contract states why it
      is safe to leave open-ended
      — **not done here**: `apps/server/src/jobs/project.ts` is server code.
      Specified as a CONTRACT + SERVER follow-up; see Technical Design.

## Technical Design

### Chosen: a fourth option — one shared query for the *outstanding set*

None of the three listed options was taken. All three treat "which jobs?" as a
question about a **document**, and it is not: what both callers want is a
predicate over the queue's *currently unfinished work*, which is one small set
the whole app can share. So the wire question moved from the origin to the
**status**.

`packages/kit/src/query/useOutstandingJobs.ts` (new) issues
`GET /api/jobs?status=pending,in-progress,deferred&recent=200` under a single
cache key. `useOutstandingAgentJob` (thread cards, any host, any depth) and
`useAgentActivity` (board rows) both read it, so a board and a reader full of
margin cards cost **one** jobs request between them — flat in the number of
threads, the number of rows, and the number of columns.

Why this beats the three listed:

- **vs. option 1** (multi-origin `originId`): no contract change, and it is
  cheaper — option 1 is O(documents open), this is O(1). It also serves the
  board row, which option 1 does not.
- **vs. option 2** (host-dependent behaviour): correctness does not depend on
  where a card is rendered. Every card gets the same answer.
- **vs. option 3** (lift to the surface that owns the set): the signal stays a
  hook, so a plugin can still render a row or a card anywhere.

**The completeness UI-069 bought is not given back.** `recent` still applies
when `originId` is absent, but it now bounds *unsettled* rows only, and the
burial UI-069 was filed for was caused by **settled** churn — every processed
job pushing a deferred one down a recency-ordered list, which is unbounded and
inevitable. Filtered to the three non-terminal states nothing finished can crowd
anything out; the only remaining way to overflow is more than `MAX_RECENT_JOBS`
events unfinished at the *same instant*. That case is **detected, not swallowed**
— a response at exactly the cap may be short, fewer than the cap is proof it is
complete — and while it holds, and only while it holds, a thread card escalates
to the exact `?originId=` question, which the server answers with no window.

`useJobs` gained an `enabled` option so the escalation can be parked. The
fallback is read only while the shared answer reports itself truncated, never
merely because TanStack still holds its last value, so a queue that has drained
back under the cap is not answered from a stale snapshot.

### Not done here: the unbounded filtered response (review MINOR 3)

`apps/server/src/jobs/project.ts` still drops `LIMIT` on the `?originId=` path.
That is server code and outside this domain; it is now a **rare** path rather
than the ordinary one, but it is still unbounded. Specified as a follow-up for
CONTRACT + SERVER in the implementing agent's report rather than fixed here.

### Notes — options as filed, superseded by the above

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

**Model: opus** (ui-dev). Branch `phase-13-dogfood-wave3`, in place.

### 1. Real browser, real Vite, real React/TanStack — request counts at the wire

A temporary Playwright spec (deleted after measurement) stubbed the transport
with `e2e/stubCorpus.ts`, opened a document carrying **12 resolved anchors and 12
threads**, entered focus mode so all 12 cards mount in `.focus-margin`, and
counted every `GET /api/jobs` with `page.on("request")`. Chromium,
`CORPUS_UI_PORT=5273`, `--workers=1`.

**Before** (`useOutstandingAgentJob` restored to the UI-069 shape, everything
else unchanged) — 14 requests:

```
UI-075 MEASURED jobs requests=14
["", "?recent=200&status=pending,in-progress,deferred",
 "?originId=th_0&status=pending,in-progress,deferred",
 "?originId=th_1&…",  … "?originId=th_11&…"]      ← 12 of these, one per card
```

**After** — 2 requests, neither naming a thread:

```
UI-075 MEASURED jobs requests=2
["", "?recent=200&status=pending,in-progress,deferred"]
```

The `""` entry is the console strip's own `["jobs", {}]` list, which is unrelated
and unchanged. Per-thread requests: **12 → 0**. Margin cards rendered: 12 in both
runs (`.focus-margin > .thread-card` count asserted), so the saving is not a card
that failed to mount.

### 2. Transport-level regression tests (the acceptance criterion's proof)

`apps/ui/src/anchors/marginJobRequests.test.tsx` renders the real `MarginColumn`
through `readerFixture` and counts `wire.of("GET", "/api/jobs")`.

Run against the **old** hook (temporary revert), the new tests fail with the
numbers the issue describes:

```
× asks the queue once for a document with thirty anchored threads
  → expected […] to have a length of 1 but got 30
× issues the same one request whatever the thread count
  → expected […] to have a length of 3 but got 30
× still lights the pending row for a thread whose job is buried
  → expected […] to have a length of 1 but got 30
```

Against the fix: 30 threads → **1** request; 3 threads → **1** request; the count
is flat, not merely small. `outstandingAgentRequest.test.ts` adds the hook-level
version (three ids, one request) and the saturation case (200 unfinished jobs →
the exact `?originId=` question is issued, and the buried deferral is still
found).

### 3. Completeness, not given back

- Buried-behind-a-window: a `deferred` job behind `DEFAULT_RECENT_JOBS` newer
  **processed** rows is found by the shared query — asserted at the transport in
  both `outstandingAgentRequest.test.ts` and, end to end through a rendered
  margin card, in `marginJobRequests.test.tsx` (`.working` present on exactly the
  one card with an outstanding job).
- Buried behind a saturated queue: with `MAX_RECENT_JOBS` unfinished jobs newer
  than it, the shared list is at the cap, the card escalates, and the deferral is
  still found. Asserted in both files.

### 4. Suites

- `VITEST_MAX_THREADS=4 npx vitest run apps/ui packages/kit plugins` — **3256
  passed, 0 failed**.
- `npx eslint apps/ui/src packages/kit/src` — no issues.
  `npx prettier --check` on every touched file — clean.
- `tsc --noEmit` in `packages/kit` and `apps/ui` — clean.
- Playwright subset (`anchor-layer`, `reveal`, `turn-comment`, `console`,
  `todos`), `CORPUS_UI_PORT=5273`: **54 passed, 1 failed** — `console.spec.ts`
  "keeps the failed-job count off the health notice's class", which asserts the
  strip reads `server unreachable`. That suite documents its precondition as *no
  workspace server on `127.0.0.1:8765`*; this machine has the user's live corpus
  server bound there (`curl … /api/health` → 200), so the strip correctly reports
  a reachable server. Environmental, not a regression — unrelated to this change.
- `npm run build` fails in **`apps/cli`** (`src/commands/workspace/upgrade.ts`:
  `Cannot find name 'context'`, `renderUpgradeReport` undefined). Pre-existing,
  another domain's in-flight work on this branch; `packages/contract` and
  `packages/kit` build clean, which is all this change needs.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier + tsc over the touched workspaces)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified (three of four; the fourth is a server issue)

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
