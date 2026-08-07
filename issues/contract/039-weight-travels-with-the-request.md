# [CONTRACT-039] A chosen weight has no way to reach the work it governs

## Domain

contract

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SHARED-022 (signed, applied)
- Blocks: SERVER-069, UI-082

## Spec References

- SPEC.md §7 — the orchestrator-skill paragraph: a stated weight is "honoured,
  not weighed again", and travels with the work
- SPEC.md §11 "Smart input everywhere" — the composer offers the weight
- SPEC.md §7 console bullet — a dispatch names the weight it ran at

## Summary

Found while writing UI-082's issue file, by an agent checking the rider's own
decomposition against what exists. **SHARED-022's chain is missing its middle.**

The rider names agent-runtime, **contract + server**, and ui. Only the
agent-runtime and ui halves were filed. So today:

- §11 says the composer offers the weight and it **"rides with the request to
  whatever does the work"** — but no request schema carries it.
- §7 says a stated weight is honoured by the dispatch — but nothing transports it
  from the post to the queue event the dispatch reads.

Without this, UI-082 cannot satisfy the sentence it implements, and an evaluator
reading §7's console bullet will look for the weight on a dispatch line and not
find it. The feature would be a picker that changes nothing.

## The shape, and the one decision worth making carefully

A weight is **request-time instruction**, not a property of the turn — the same
class as `requestsAgent`, which §8 establishes and which
`apps/ui/src/thread/outstandingAgentRequest.ts` documents the consequence of:
*"That a given turn enqueued is recorded nowhere a later reader can find it."*

SHARED-022 chose that class deliberately (its own Q2), so a weight belongs on the
**request** and in the **queue event payload**, not written into the turn on disk.
Do not quietly promote it to a stored field to make it easier to display — that
is a different decision and it needs sign-off.

**The level vocabulary is not the contract's to define.** §7 keeps model names in
the skill, and SHARED-022 goes further: the levels offered are read from the
workspace's own guidance, so the picker and the routing move together. So the
wire carries a **level name as an opaque string**, validated for shape rather
than against an enumerated set. An enum here would freeze in the contract exactly
what the rider took pains to keep editable, and would drift the first time a
workspace edited its table.

## Acceptance Criteria

- [ ] Every composer that can request the agent can carry a chosen level —
      stated once for the set, the way attachments and snippets are (§11), not
      per surface
- [ ] Absent means **the orchestrator decides**, never a default level. This is
      protected in all three of SHARED-022's amendments and must survive here
- [ ] The level reaches the queue event, since that is what the dispatch reads
- [ ] The wire does **not** enumerate the levels, and the contract says why
- [ ] `openapi.json` and the typed client regenerated, not hand-edited
- [ ] The descriptions say what the field is *for* — a directive, honoured and
      never silently substituted in either direction — so the next reader does
      not re-derive it

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/` (the agent-requesting request shapes and the
  queue event payload), plus regenerated artifacts.

### Notes

- Check whether §9.2's route inventory needs a line for the changed request
  shape. It has needed one three times on this project, was caught by review
  twice, and pre-empted once. **A SPEC edit needs user sign-off** — draft it in
  this issue and hold it rather than applying it.

## Testing Strategy

Contract tests over presence, absence (meaning "orchestrator decides"), and
shape rejection; the OpenAPI drift check as usual.

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
