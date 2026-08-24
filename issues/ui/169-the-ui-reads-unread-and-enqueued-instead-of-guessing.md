# [UI-169] The UI reads `unread` and `enqueued` instead of guessing them

## Domain

ui

## Status

todo

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

- [ ] `openThreadReadState` becomes `readStateOf(thread.unread)`. The
      `hasSeenMark` import, the `useDocs({parent, type: thread})` row lookup and
      the `"unknown"` branch all go
- [ ] `ThreadReadState` stays — `summaryFromAnchor` still uses it
- [ ] A resolved standalone thread read in an earlier session opens **collapsed**
      after a full reload. This is the acceptance test, and it must be exercised
      in a real browser, not only in jsdom
- [ ] `outstandingAgentRequest.ts`: `startedAt()` sorts by `job.enqueued`, and
      `agentWaitSince()` loses its entire body and docblock — it becomes
      `job.enqueued`
- [ ] `JobDetail.tsx` says *queued*, not a start time, when `started` is null
- [ ] `readerFixture.ts` carries `enqueued` and `unread`

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

_(to be filled by the implementing agent)_
