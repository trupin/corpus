# [CONTRACT-006] Thread-response warnings, appended honesty, db routes

## Domain

contract

## Status

in_progress

## Priority

P0

## Model

opus — a ~5-line rider plus two small routes; every shape is pinned by shipped precedent.

## Dependencies

- Depends on: CONTRACT-005
- Blocks: SERVER-006 (warning serialization), SERVER-017/CLI-003 (db routes)

## Spec References

- SPEC.md §14 — warnings on API responses; §2.2 — `corpus db rebuild` / `db doctor`
- `issues/sprints/sprint-006.md` — Open Conflict 2 (rationale; the anchored-creation hook-rejection case)

## Summary

Sprint-006 rider, run first: (1) spread the shipped `warningsField` into `CreateThreadResponse`, `AppendTurnResponse`, `CaptureResult`, `DeleteTurnResult` — anchored thread creation writes the parent document's frontmatter, so a hook rejection currently leaves the commenter told nothing; (2) `JobLogAppendResponse.appended` becomes `boolean` (SERVER-009's 4 MiB cap refuses the line but must answer honestly — `appended: false`); (3) declare `POST /api/db/rebuild` and `GET /api/db/doctor` (shapes from SERVER-004's shipped `rebuild()`/`doctor()` returns), user-reachable, mounted by SERVER-017.

## Acceptance Criteria

- [ ] The four thread/capture shapes carry the always-present `warnings` array (same `warningsField`, one definition).
- [ ] `appended: boolean` with the cap-refusal semantics in the description; round-trip + a type-level probe that `false` is representable.
- [ ] `POST /api/db/rebuild` (bodiless, required per the CONTRACT-004 rule = no body at all) and `GET /api/db/doctor` declared with response schemas matching SERVER-004's shipped return shapes; added to the pinned inventory; auth required.
- [ ] All standing invariants hold; artifacts byte-deterministic; drift green; consumer typecheck clean (SERVER-009's `appended: true` literal is the one expected server-side adjustment — report it, one line).

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/{thread,capture,job}.ts`, `routes/{jobs,db}.ts` (new db file), inventory, tests, regenerated artifacts.

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
