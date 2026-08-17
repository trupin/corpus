# [UI-120] A stale statement of the walk's order, and a hand-copied server message that drifted

## Domain

ui

## Status

done

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

- [x] `ScopeProvenance.tsx:21` states the parent-first order, or stops stating an
      order it does not implement
- [x] The three doubles carry one message. Prefer deriving it from one place
      over copying it correctly three times — the copies are the defect, not
      their current contents
- [x] If `stub-server-parity.test.ts` can cover this class, extend it; if not,
      say why, since that file exists to stop exactly this

## Testing Strategy

Unit. For the message, the check is that a change to the server's wording breaks
the doubles rather than silently diverging from them.

## E2E Verification Log

Model: **opus** (contract-dev, taking this alongside CONTRACT-060).

### 1. The stale order

`apps/ui/src/reader/ScopeProvenance.tsx` said membership is computed *"by
climbing `origin` then `parent`"* — the single chain SERVER-117 deleted, in the
order it deleted. It now states what `walkScope` does: a search over **both**
edges with **the parent branch explored first** (user decision, 2026-08-17). The
correction is made out loud in the docblock rather than silently, because
UI-119's thesis is that a docblock claiming the wrong order is how the
divergence survived a release.

Checked against the implementations rather than from memory:
`packages/contract/src/scope.ts` — `edgesOf` returns `[parent, origin]`, the
frontier is a stack pushed reversed "which puts the parent branch on top", and
the docblock records the decision and its three reasons. No runtime change here;
this file reads the walk through `useResidentLane` and does not implement it.

### 2. Three doubles → one

The three `422 unknown_recipient` copies now all call
**`apps/ui/src/testing/serverRefusals.ts`**'s `unknownRecipientBody(recipient)`,
which returns the whole body (`code`, `message`, `recipient`) rather than only
the prose — `code` and `recipient` are what a composer branches on to drop the
stale roster row, so a double right about the sentence and wrong about the shape
is the same failure one field over.

| double | was | now |
|---|---|---|
| `apps/ui/src/testing/readerFixture.ts` | recovery sentence dropped | `unknownRecipientBody(lane)` |
| `apps/ui/src/compose/composeFixture.ts` | a wholly different sentence | `unknownRecipientBody(lane)` |
| `apps/ui/e2e/stubCorpus.ts` | correct | `unknownRecipientBody(lane)` |

The correct copy went too: three copies is three chances to drift and only one of
them can be the one that is checked.

Not touched, and deliberately: `packages/kit/src/recipient/useComposerRecipient.test.tsx:118`
builds `` `${lane}` names no lane `` inline. It is a test constructing *an* error
to drive the composer's recovery, not a fixture claiming to answer as the server
does, and it is in another workspace. Worth a look if kit ever grows a fixture
that claims parity.

### 3. `stub-server-parity.test.ts` — yes, it covers this class

It can, and it is the only place in the repo that may: `apps/ui` cannot import
`apps/server` (sibling applications), and this file already exists to hold
exactly that cross-application comparison. Added a describe that imports
`unknownRecipient` from `apps/server/src/errors.ts` and asserts
`unknownRecipientBody(lane)` equals `unknownRecipient(lane).body` over three
lane ids, plus a non-vacuity case (the message varies with the value, so an
equality test against a copy that ignored its argument cannot pass).
`unknownLaneScope` is noted as having no double to pin — nothing in `apps/ui`
parks, so nothing answers it — with an instruction to add a case the day one
does.

### Checked red first — both directions

**a. The drift that existed.** Reproduced `readerFixture`'s exact defect in the
shared builder (drop the recovery sentence):

```
FAIL scripts/stub-server-parity.test.ts > the UI fixtures' copy of a server refusal
  > words `422 unknown_recipient` exactly as the server does — th_9k2 / orchestrator / th_a-b_c
Tests  3 failed | 29 passed
```

So the new test would have caught the shipped drift, not merely the shape of it.

**b. The direction the issue asks for.** Changed the *server*'s wording
(`…pick a live agent from the roster, or from anywhere else.`) and left the UI
alone — same three failures. A change to the server's message now breaks the
double instead of silently diverging from it.

Both counterfactuals reverted (`diff` against pre-edit copies: identical) and the
file re-run green — 32 passed, exit 0.

### The e2e stub's answer did not move

`stubCorpus` held the correct copy, and the shared builder is byte-identical to
it — verified by concatenating both literal forms in `node` (`true`); the two
differ only in where the source lines wrap. So no Playwright spec's assertion
changes and no e2e run was needed for this (Playwright is single-holder here and
starts its own Vite).

### Checks

- `scripts/stub-server-parity.test.ts` — **32 passed**, exit 0.
- `apps/ui/src/recipient` + `compose` + `reader` + `weight` — 21 files, 373
  passed, exit 0 (the suites that drive the two refactored fixtures).
- `apps/ui` whole workspace — 148 files, **3116 passed**, exit 0.
- `npm run typecheck` (all workspaces + `scripts/`) — exit 0.
- `eslint` + `prettier --check` on every touched file — exit 0.
- No contract change: `scripts/check-generated-artifacts.ts` — "✓ API contract is
  up to date".

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-120]` prefix
