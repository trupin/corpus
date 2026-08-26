# [CONTRACT-087] A roster row cannot say a lane has work waiting

## Domain

contract

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-072
- Blocks: SERVER-155, AGENT-053, UI-174

## Spec References

- SPEC.md §7 — the Orchestrator skill paragraph, rider signed 2026-08-25:
  _"a roster row says whether its lane is live and how much work is pending on
  it, so 'somebody is waiting and nobody is listening' is a fact the
  orchestrator reads rather than a state it infers from absence"_

## Summary

`AgentLane` (`packages/contract/src/schemas/agents.ts`) carries `lane`,
`resident`, `live`, `since`, `summary` and `origin`. **There is no pending
count.** The only field that could carry the fact is `summary`, and its own
description forbids deciding from it: _"it is for display only — a client must
never parse it, key on it, or decide anything from it, and everything a client
needs to decide from is a field of its own on this row."_

So today a caller can see that a lane is not live. It cannot see whether anyone
is waiting on it.

**That gap is invisible until SERVER-152 lands.** The fallback hands the
orchestrator a lapsed lane's work, so the work itself is the signal. Rider C
removes the work, and the signal has to exist instead. Without it, rider D
degrades into launching a listener for every non-live lane on every pass —
wasteful, and the shape `orchestrate/SKILL.md` already warns against: _"a
conversation that queued eight messages while it was unattended gets eight
listeners."_

## Acceptance Criteria

- [x] `AgentLane` carries `pending`, a non-negative integer: how many events are
      **pending** on this lane
- [x] Its description states what it counts and what it does not — `pending`
      only, never `in-progress` or `deferred`, because the question it answers is
      "is anyone waiting", and an event already being worked is not waiting
- [x] The description names the decision it exists for, citing §7: a lane with
      `pending > 0` and `live: false` is a conversation nobody is answering, and
      that pair is what the orchestrator launches from
- [x] It says outright that this replaces reading `summary`, so a reader of the
      schema does not have to work out which field to trust
- [x] `openapi.json` and the generated client regenerate cleanly
- [x] No new route. The field rides the roster the orchestrator already reads

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/agents.ts` — the field, beside
  `presenceLiveField`
- `packages/contract/openapi.json`, `src/client/schema.generated.ts` — regenerate

### Key Implementation Details

Declare it as a shared field constant next to `presenceLiveField`, in the same
style, so the prose lives once and the pairing of the two fields is visible where
both are declared.

**A count, not a boolean.** "Is anything waiting" is what the orchestrator
decides from, but a count is what a person reads on the board (UI-174), and a
boolean would have to be widened later. The extra cost is zero — the server is
counting rows either way.

### Edge Cases

- The orchestrator's own lane carries a count like any other. It is not special,
  and a reader that special-cased it would be re-deriving a rule the field does
  not have.
- A lane with no resident cannot appear on the roster at all, so there is no
  "pending on a lane nobody owns" case here.

## Testing Strategy

Schema tests: the field is required, refuses a negative, refuses a non-integer.
A description assertion that it names the `pending > 0 && !live` decision —
falsify by deleting that sentence and watching it fail, the way
`openapi.test.ts` already pins load-bearing prose.

## E2E Verification Plan

Through the **generated client** against the real server once SERVER-155 lands,
never a hand-written fetch. A contract test that called a hand-rolled helper
rather than `corpus.api.*` passed while the contract was wrong in v0.22.0.

## E2E Verification Log

Implemented by the orchestrator on opus, 2026-08-25.

### Where it sits, and why that is the whole point

`pending` goes **between `since` and `summary`**, immediately after `live`,
because the two are one decision read together. A reader meeting `live` alone
would most likely invent the missing half as *"not live means launch"*, which
gives a workspace one background agent per conversation that has ever existed.
The field's own prose states the pair — `pending > 0 && live: false` — and a
test pins that sentence.

### What the description had to carry

Three things a reader must not have to derive:

- **Why the field is new.** Until the rider signed 2026-08-25, a lane whose
  listener was absent had its work folded into the orchestrator's claim, so the
  work arriving *was* the signal. It no longer arrives.
- **Why `in-progress` and `deferred` are excluded.** Counting in-progress would
  keep a lane looking unattended for exactly as long as it is being attended to.
- **That this replaces reading `summary`**, which is display-only and says so.
  This is the field of its own that sentence already promised.

### Falsification

Cutting the pair sentence out of the description and regenerating:

```
× names the decision it exists for, as a pair with `live`
  Tests  1 failed | 3 passed
```

### The fixtures say something on purpose

`residentLane` carries `pending: 2` with `live: false` — the pair, in the
fixture, so the shape a reader meets first is the one the field exists for.
The orchestrator's row carries a real `0` rather than a null, because it is not
special and special-casing it would re-derive a rule the field does not have.

### Checks

```
vitest run packages/contract      70 files, 2993 tests passed   exit 0
eslint packages/contract/src                                     exit 0
tsc -p tsconfig.build.json                                       exit 0
generate (openapi.json + client)                                 clean
```


## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[CONTRACT-087]` prefix
