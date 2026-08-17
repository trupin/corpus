# [CONTRACT-055] `QUERY_KEY_VOCABULARY` does not say that queue transitions change the roster

## Domain

contract

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: SERVER-115
- Related: CONTRACT-045, SERVER-114

## Spec References

- SPEC.md **§9.4** — invalidate keys

## Summary

`SERVER-115` needs queue transitions, job-log appends, thread edits, rebuilds
and deletions to name `["agents"]`, because all of them change what
`GET /api/agents` would answer — the roster's `summary` reads the same `events`
and `jobs.last_line` a queue transition writes.

The published `emittedBy` for those keys does not say so. A server that emits a
frame the vocabulary denies is the same drift `CONTRACT-052` spent a pass
cleaning out of the diff descriptions: the artifact ships, someone reads it, and
it is confidently wrong.

Note the one thing the vocabulary already got **right**, which is why SERVER-114
needed no contract change: `QUERY_KEY_VOCABULARY.queue.emittedBy` has said "plus
every change to agent presence" since CONTRACT-045. The server was the only side
out of step there. This issue is the converse — the server is about to become
correct, and the vocabulary is what will be lying.

## Acceptance Criteria

- [ ] `emittedBy` for the affected keys states that the roster changes with
      them, and says **why** (the roster's summary is derived from the same
      rows), so the next reader does not have to rediscover the coupling
- [ ] The published `openapi.json` is regenerated and swept structurally, as
      CONTRACT-052 established — not grepped
- [ ] The vocabulary and `SERVER-115`'s emitters are checked against each other,
      in a test if one can be written: a vocabulary that drifts from the
      emitters is the failure this issue exists to prevent, and it should not be
      prevented only by someone remembering

## Testing Strategy

Generation and drift check. The cross-check against the server's emitters is the
valuable test if it can be expressed — say so if it cannot, rather than leaving
the impression it was covered.

## E2E Verification Log

_Filled by the implementing agent._

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-055]` prefix
