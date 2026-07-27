# [CONTRACT-009] Multipart `createThread` + declared 413 (attachments rider)

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus — mirrors the multipart shape Capture already declares.

## Dependencies

- Depends on: CONTRACT-002
- Blocks: UI-008

## Spec References

- SPEC.md §6 — attachments; §8 — Ask with attachments
- `issues/server/010-attachments.md` — E2E Verification Log (adjudications 5b and AC-2 strike)

## Summary

SERVER-010 discovered `POST /api/threads` is JSON-only in the contract, so *Ask*-with-attachments has no wire path — only Capture (which already declares multipart) ships attachment ingest today. This rider: (1) adds the multipart variant to `createThread`, mirroring Capture's declared shape; (2) declares **413** for over-cap uploads on both multipart routes (SERVER-010 ships the adjudicated interim 400 because 413 was undeclared — the server flips to 413 when this lands).

Reference format UI-008 must resolve (byte string pinned by SERVER-010's E2E): `![shot.png](attachments/th_x/2026-07-27T16%3A14%3A46Z/shot.png)` — each path segment percent-encoded (colons), display text human-readable.

## Acceptance Criteria

- [ ] `createThread` accepts the multipart variant with the same file-part shape as Capture; JSON-only requests unchanged.
- [ ] 413 declared on both multipart routes; the ApiError union extended if needed; server flip noted for a small SERVER follow-up.
- [ ] All standing invariants; artifacts regenerated; round-trips.

## Technical Design

To be refined when scheduled (Phase 3, before UI-008).

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Post-Implementation Verification

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with the issue-ID prefix
