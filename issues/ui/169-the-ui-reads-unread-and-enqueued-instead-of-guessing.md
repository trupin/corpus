# [UI-169] The UI reads `unread` and `enqueued` instead of guessing them

## Domain

ui

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-029, CONTRACT-036, SERVER-148
- Blocks: —

## Spec References

- SPEC.md **§10** — the thread view, and the unread interlock: a conversation
  carrying a turn you have not seen is never collapsed by the rule
- SPEC.md **§6** — a resolved thread is collapsed by default wherever it is shown

## Summary

The UI half of CONTRACT-036 and CONTRACT-029. Both replace a derivation with a
value the server now publishes.

**The bug this actually fixes.** `DocView`'s `openThreadReadState` falls back to
`hasSeenMark`, a module-level `Map` with a page session's lifetime. It can
confirm a read and can never deny one, so it answers `read` or `unknown` and
never `unread` — and `unknown` stands the by-rule fold down. The behaviour that
leaves: **a resolved standalone thread opens expanded on its first visit after
every reload**, even when it was read weeks ago and the server knows it. §6 says
"collapsed by default wherever it is shown". For that placement it was collapsed
by default only from the second visit of a browser session.

## Acceptance Criteria

- [x] `openThreadReadState` becomes `readStateOf(thread.unread)`. The
      `hasSeenMark` import, the `useDocs({parent, type: thread})` row lookup and
      the `"unknown"` branch all go
- [x] `ThreadReadState` stays — `summaryFromAnchor` still uses it
- [x] A resolved standalone thread read in an earlier session opens **collapsed**
      after a full reload. This is the acceptance test, and it must be exercised
      in a real browser, not only in jsdom
- [x] `outstandingAgentRequest.ts`: `startedAt()` sorts by `job.enqueued`, and
      `agentWaitSince()` loses its entire body and docblock — it becomes
      `job.enqueued`
- [x] `JobDetail.tsx` says *queued*, not a start time, when `started` is null
- [x] `readerFixture.ts` carries `enqueued` and `unread`

### The full breakage list, enumerated by ui-dev 2026-08-24

The contract landing (`373b07b7`) turned `apps/ui` and `packages/kit` red in
about twenty places and failed six unit tests. All of it belongs here.

**Six failing unit tests, one cause.** `packages/kit/src/query/useCapture.test.tsx`
(3), `packages/kit/src/weight/weightTransport.test.tsx` (2),
`apps/ui/src/thread/turnSelectionComment.test.tsx` (1) — every one a `ZodError`,
`thread.unread` expected boolean and received undefined, thrown from
`packages/contract/src/client/upload.ts`. **This is the multipart-validates-and-
JSON-does-not trap**: only the upload paths fail, so a fixture missing a required
field is invisible everywhere else. Fix the fixtures, not the validator.

**Type errors**: `apps/ui/e2e/stubCorpus.ts`, `console.spec.ts`,
`clipboard.spec.ts`, `fences.spec.ts`, `images.spec.ts`, `render-fixes.spec.ts`,
`turn-breaks.spec.ts`, `apps/ui/src/testing/readerFixture.ts`,
`console/Console.test.tsx`, `console/JobDetail.tsx`, `menu/JobMenuItems.test.tsx`,
and `thread/outstandingAgentRequest.ts` (`startedAt` and `agentWaitSince`, both
pre-existing, now that `started` is `string | null`).

All 90 Playwright specs were green under the new dist. This is types and
multipart fixtures, not runtime.

## Testing Strategy

The reload case is the one that matters and the one a unit test cannot reach.
Verify it in Chromium: read a resolved standalone thread, hard-reload, and watch
it stay collapsed.

## E2E Verification Log

**Implemented on: opus** (Opus 5, 1M context), 2026-08-24.

### Reproduction — the standalone-thread reload bug, in Chromium

The pre-UI-169 answer was restored in `openThreadReadState` (both branches: the
row path for a thread with a parent, the `hasSeenMark` fallback for a standalone
one) and the new specs run against it. Command:

```
CORPUS_UI_PORT=5391 ./node_modules/.bin/playwright test --config=apps/ui/playwright.config.ts \
  --workers=1 -g "a thread opened as its own document"
```

```
✓ is placed collapsed when it is resolved, and expands where it stands
✓ collapses when it is resolved while it is open on screen
✓ stays open when it holds a turn nobody has seen
✘ is placed collapsed on a first visit, though it has no row to read
✘ is still collapsed on the visit after a reload
✓ leaves a standalone conversation open when the server says it is unread
    Locator: locator('[data-thread-panel="th_alone"]').locator('> [data-thread-expand]')
    Expected: 1   Received: 0
```

The two failures are exactly the standalone placement, and only that placement:
the anchored thread with a parent still folds, because it had a row to read. The
resolved standalone conversation rendered **expanded** — no collapsed line at
all — on a fresh page and again after `page.reload()`. That is §6's "collapsed by
default wherever it is shown" being false for that placement on every first visit
of a browser session. Restored to the fix; all six pass in 10.5 s.

### The stub had to be made honest first

`stubCorpus` already stored `doc.unread` and cleared it on `POST …/seen`, but
`GET /api/threads/{id}` did not report it — nothing read the field. The read now
returns `doc.unread`, and `POST /api/threads` reports `unread: false` for a
conversation the caller just wrote. Without that the specs above would have been
green against a constant.

### Fixtures — more than the six that failed

A brace-walking scan over every `Thread`-shaped literal in `apps/ui` and
`packages/kit` found **eighteen** sites, against the six the multipart paths
happened to throw on. Twelve were invisible because their path is JSON, which
`openapi-fetch` does not validate. Every one now carries `unread`, and the kit's
own fixtures carry `satisfies Thread` / `satisfies ThreadSummary` so the next gap
is a compile error rather than a `ZodError` on one branch. The same scan over
`Job`-shaped literals drove the `enqueued` work.

`StubJob.started` was renamed to `enqueued` — which is what its own docblock
already said it meant — and a nullable `started?` added beside it. `JobList` now
answers `total` and `truncated`.

### The console's meta line

`JobDetail` said `started 09:12` for a job that had never started, because
`started` used to carry the enqueue instant while a job was queued. It now reads
`queued 09:12` when `started` is null and `started 09:40` when it is not, from
`jobClockLabel`. Pinned in `Console.test.tsx` (`pending · queued …`, and
`not.toContain("started")`) and in `consoleModel.test.ts`.

### The pending indicator

`agentWaitSince` and `TurnInstant` are deleted; `ThreadCard` passes
`outstanding.job.enqueued`. `startedAt` became `enqueuedAt`. Two browser specs
moved with it, and both moved **towards** the honest instant:

- `forms.spec.ts` "asks its question while the agent is still working":
  `2026-07-19T10:07:00Z` (the agent's form turn, which the clamp reached back to)
  → `10:07:30Z`, the seeded enqueue.
- `forms.spec.ts` "counts the wait from the buried ask": `10:05:00Z` (the user's
  turn) → `10:06:00Z`, which is the instant that seed's own docblock already
  called the enqueue. What the test distinguishes is untouched: a windowed answer
  would report an 11:xx row, an hour away.

A new component test pins the invariant the deleted heuristic used to buy —
`ThreadCard.test.tsx`, "does not restart the wait when the job writes its first
log line": a job enqueued at the ask and first logging at 10:20 still reports the
ask.

### Checks

- `npm run typecheck` in `packages/kit` and `apps/ui`: clean.
- `vitest run packages/kit apps/ui`: **243 files, 4712 tests, 0 failures** (the
  six `ZodError` failures this issue inherited are gone).
- `npm run lint`, `npm run format:check`: clean.
- Full Playwright suite, `--workers=2`: **640 passed, 0 failed** (9.1 min).

### Left for someone else

`hasSeenMark` is now unused by `apps/ui`. It is still a `@corpus/kit` export with
its own tests, and removing it is a breaking export change — escalated rather
than done here.
