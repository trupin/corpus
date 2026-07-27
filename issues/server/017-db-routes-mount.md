# [SERVER-017] Mount db rebuild/doctor routes

## Domain

server

## Status

todo

## Priority

P1

## Model

opus — two handlers over SERVER-004's shipped `rebuild()`/`doctor()`; the rebuild-reopen requirement is the only care point.

## Dependencies

- Depends on: SERVER-004, CONTRACT-006
- Blocks: CLI-003

## Spec References

- SPEC.md §2.2 rule 1 — `corpus db rebuild` / `db doctor`
- `issues/cli/004-queue-lock-job-verbs.md` — the rebuild-reopen handoff (SERVER-004: after rebuild() atomically replaces cache.db, the running server's handle points at the old inode — the handler must reopen the server's projection handle and rebind the queue mirror)

## Summary

Mount CONTRACT-006's `POST /api/db/rebuild` and `GET /api/db/doctor` over the shipped projection functions, with the in-process handle reopen the SERVER-004 handoff requires.

## Acceptance Criteria

- [ ] Both routes mounted, auth required; rebuild reopens the server's own handle + rebinds the queue mirror (subsequent reads hit the new file — proven E2E with sqlite3 against the inode); doctor returns the shipped drift report shape.
- [ ] E2E: rebuild over a live server, immediate query correctness, doctor clean/dirty cases.

## Technical Design

Handlers in apps/server (likely projection/routes.ts); the reopen seam through lifecycle's attachProjection.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Reproduction (bugs only)

_[Agent fills if applicable]_

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
