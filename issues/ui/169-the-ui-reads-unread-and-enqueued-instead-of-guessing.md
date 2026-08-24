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

## Testing Strategy

The reload case is the one that matters and the one a unit test cannot reach.
Verify it in Chromium: read a resolved standalone thread, hard-reload, and watch
it stay collapsed.

## E2E Verification Log

_(to be filled by the implementing agent)_
