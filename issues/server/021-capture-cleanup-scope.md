# [SERVER-021] Capture cleanup deletes committed attachment bytes on post-commit failure

## Domain

server

## Status

todo

## Priority

P1

## Model

opus — scoping a catch block; the invariant is already written in the module header.

## Dependencies

- Depends on: SERVER-010
- Blocks: — (PR #9 merge blocker: pr-reviewer MAJOR finding 6)

## Spec References

- SPEC.md §6 — a committed reference must never point to a missing file
- PR #9 review, finding 6

## Summary

`apps/server/src/capture/capture.ts` wraps everything after `storeTurnFiles` in one try/catch whose cleanup runs `removeTurnAttachments` for ANY later failure — including failures after `runMutation` has committed the inbox doc and filing thread (e.g. `enqueueComment` on an unwritable `.corpus/queue/`, or the read-back `loadDocument` throwing). Result: a committed turn permanently references deleted files — the exact state the module's own header forbids. Also fix the same-session contract rider consumer: `MarkSeen` handler must return the real `unread` (see CONTRACT-010) once the schema is a boolean.

## Acceptance Criteria

- [ ] Attachment cleanup runs only for failures BEFORE `runMutation` commits; post-commit failures leave the bytes in place (the reference is committed; the bytes must stay).
- [ ] Regression test: force a post-commit failure (e.g. unwritable queue dir) → 500 to the client, but the attachment files still exist and the committed turn's references resolve.
- [ ] MarkSeen handler returns computed `unread` per the CONTRACT-010 schema; the existing partial-mark logic in `query.ts` is the one source of truth.
- [ ] Full gate green.

## Technical Design

Split the try/catch at the `runMutation` boundary in `capture.ts` (and mirror in the turn-append ingest path if it shares the shape). MarkSeen: reuse the unread computation `GET /api/docs` uses.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Reproduction (bugs only)

_[Agent fills]_

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
- [ ] Committed with `[SERVER-021]` prefix
