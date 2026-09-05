# [SERVER-164] The digest write path, and staleness on delete and revise

## Domain

server

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-096
- Blocks: CLI-077, AGENT-069

## Spec References

- SPEC.md **§6** — the digest rider (signed 2026-09-05), and §6's turn deletion
  and last-turn revision, which are the two staleness triggers
- SPEC.md **§9** — sole writer; §4 — auto-commit

## Summary

Implement CONTRACT-096's routes and the rider's invariants:

- **PUT** writes `{body, watermark: newest turn ts, stale: false}` into the
  thread file's frontmatter, auto-committed like any mutation. Refused 422 when
  the thread has no resident designation, 422 on empty body, 404 unknown id.
  A thread with no turns: refuse 422 — the rider's watermark points at a turn.
- **DELETE** removes the digest. Same designation gate.
- **Staleness**: `DELETE /threads/:id/turns/:ts` and turn revision, when the
  affected turn's ts ≤ watermark, set `stale: true` in the same write. Turns
  after the watermark change nothing. The server never touches `body`.
- **Projection + doctor**: the digest projects with the thread; `db rebuild`
  reconstructs it from the file; doctor treats file/projection digest drift as
  drift.
- The watcher path (out-of-band edits) reconciles digests like anchors: an
  edit that removes turns at or under the watermark marks stale on projection.

## Acceptance Criteria

- [ ] The rider's every sentence has a test: resident gate, watermark stamped
      server-side, staleness on delete-at-or-before, staleness on revise,
      no-op after watermark, DELETE, empty-PUT refusal, no-turn refusal
- [ ] `rebuild && doctor` clean with digests present
- [ ] Auto-commit carries the digest write with the agent author
- [ ] `npm test -w apps/server` green

## E2E Verification Plan

Real server: designate a resident, write a digest via curl or the CLI once
CLI-077 lands, delete a covered turn, read the thread — `stale: true`, body
untouched. Log the exact requests.

## E2E Verification Log

_Implementing agent fills; state the model._
