# [CONTRACT-058] `GET /api/queue/idle` does not declare the 422 it now returns

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-118 (which added the refusal)
- Related: CONTRACT-052, CONTRACT-055 (the same drift, in descriptions)

## Spec References

- SPEC.md **§9.2** — the HTTP API

## Summary

`SERVER-118` made `GET /api/queue/idle` refuse a `scope` that names no lane,
with a `422`. **`contractRoutes.idleQueue` declares `200/204/400/401` and no
`422`.**

Nothing breaks — the body stays inside the published `ApiError` union — but the
OpenAPI document and the generated client are one refusal behind the server. A
consumer generating handlers from the contract has no branch for a response the
server will now send.

This is the same drift `CONTRACT-052` and `CONTRACT-055` each spent a pass
cleaning up, arriving a third way: not a stale description this time, but a
**missing** one.

## A second question to settle while there

The refusal reuses the published `unknown_recipient` error code, because its
carried field is described as "the value that named no lane" without naming a
parameter — so it fits. But the **code is spelled `recipient`** and this refusal
is about `scope`.

Decide deliberately: either the code's name is general enough and its
description should say so plainly, or a `scope` refusal deserves its own code.
Reusing a name that says `recipient` for a `scope` failure is the kind of thing
that reads fine to whoever wrote it and confusingly to everyone else.

## Acceptance Criteria

- [ ] `idleQueue` declares the `422`, with a description saying what makes a
      scope invalid and how to recover — the server's message already names the
      recovery ("omit `scope`… designate a resident… or pick a lane from
      `GET /api/agents`") and the contract should not say less
- [ ] The `unknown_recipient` naming question is answered, with reasoning, and
      whichever way it goes the description matches the name
- [ ] `openapi.json` regenerated and **swept structurally** per CONTRACT-052's
      discipline — while there, check whether any *other* route returns a status
      it does not declare. This one was found by an implementer noticing, which
      is not a search, and the sweep is the only thing that makes "no others"
      mean anything
- [ ] No behavioural change

## Testing Strategy

Generation and drift check. If the declared-status sweep is expressible as a
test comparing declared responses against the server's handlers, say where it
would have to live — `packages/contract` cannot import `apps/server`, and
CONTRACT-055 already established that a cross-check of that kind belongs in the
consumer that owns the emitter.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-058]` prefix
