# [SERVER-023] Consume the CONTRACT-007/009 riders: warnings, reap failed, originTitle, multipart threads, 413

## Domain

server

## Status

todo

## Priority

P1

## Model

opus — each half is an established pattern (SERVER-006 warnings carrier, SERVER-010 multipart ingest).

## Dependencies

- Depends on: CONTRACT-007, CONTRACT-009, SERVER-006, SERVER-010
- Blocks: UI-008 (lands with the same commit as the contract changes — the riders break the server compile until consumed; sprint-008 Open Conflicts 5–7)

## Spec References

- SPEC.md §6 (attachments), §8 (Ask with attachments), §14 (warnings carrier)
- `issues/contract/007-forms-surface.md`, `issues/contract/009-thread-multipart-rider.md`
- `issues/sprints/sprint-008.md` — Open Conflicts 5–7 (exact compile-break site: `apps/server/src/queue/routes.ts:35`)

## Summary

The server half of the sprint-008 contract batch, coupled to the contract commit because the riders stop `apps/server` compiling:

1. **`ReapStaleResult.failed`**: `queue/routes.ts` returns the QueueService's `failed: string[]` instead of dropping it.
2. **Resolve/reopen warnings**: both handlers carry §14 warnings in the response (they are log-only today); `corpus thread resolve --json` output gains the field (documented CLI output change — no CLI code change needed if it passes responses through).
3. **`originTitle`**: the jobs listing populates the origin's title for thread- and doc-origin jobs from the projection.
4. **Multipart `createThread`**: the JSON-only route gains the multipart variant, reusing SERVER-010's ingest (bytes-before-markdown, `whileUnreferenced` cleanup scope, same limits) — Ask-with-attachments works end to end.
5. **413 flip**: over-cap uploads on both multipart routes return the now-declared 413 (replacing SERVER-010's adjudicated interim 400).

## Acceptance Criteria

- [ ] `apps/server` compiles against the regenerated contract; all five halves implemented with colocated tests.
- [ ] Multipart thread creation E2E: real curl multipart → thread with attachment references, served bytes, one commit, correct SSE keys; over-cap → 413 on both routes.
- [ ] Reap/resolve/reopen/jobs responses verified E2E against the new shapes.
- [ ] Full gate green (the combined contract+server commit is the green unit).

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
- [ ] Committed with `[SERVER-023]` prefix (combined with the contract commit)
