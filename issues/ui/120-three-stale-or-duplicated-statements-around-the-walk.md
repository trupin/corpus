# [UI-120] A stale statement of the walk's order, and a hand-copied server message that drifted

## Domain

ui

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Related: UI-119, SERVER-117, UI-118

## Summary

Two MINOR findings from PR #48's third review, both in `apps/ui`.

**1. `apps/ui/src/reader/ScopeProvenance.tsx:21` states the pre-SERVER-117
order**: *"§7 makes membership computed by climbing `origin` then `parent`"*.
The canonical order is parent first (the user's decision of 2026-08-17), and
every implementation now agrees — contract `scope.ts`, server `scope.ts`, kit
`scopeWalk.ts`. Written by UI-109, missed by SERVER-117's sweep and by UI-119's.

No runtime effect. It matters because **UI-119's whole thesis is that a docblock
claiming the wrong order is how the divergence survived a release** — and the
reviewer confirmed this is the *only* remaining stale statement, every other
`origin ?? parent` hit describing the deleted chain correctly and historically.

**2. The server's `422 unknown_recipient` message is hand-copied into three UI
test doubles and two have drifted**: `apps/ui/src/testing/readerFixture.ts:313`
drops the recovery sentence, and `apps/ui/src/compose/composeFixture.ts:153` is
a wholly different sentence. Every assertion matches on the substring
`"names no lane"`, and `scripts/stub-server-parity.test.ts` covers only anchors
and turn parsing, so nothing catches it.

Test-only, but the fixtures are what UI-118's refusal path is verified against —
a double that words the refusal differently from the server is a double that can
certify a message a person will never see.

## Acceptance Criteria

- [ ] `ScopeProvenance.tsx:21` states the parent-first order, or stops stating an
      order it does not implement
- [ ] The three doubles carry one message. Prefer deriving it from one place
      over copying it correctly three times — the copies are the defect, not
      their current contents
- [ ] If `stub-server-parity.test.ts` can cover this class, extend it; if not,
      say why, since that file exists to stop exactly this

## Testing Strategy

Unit. For the message, the check is that a change to the server's wording breaks
the doubles rather than silently diverging from them.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-120]` prefix
