# [SERVER-166] The server keeps the cost ledger

## Domain

server

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-097; the SHARED-079 rider signed
- Blocks: CLI-085, UI-190

## Spec References

- SPEC.md §9 — the drafted telemetry rider (SHARED-079)

## Summary

Implement CONTRACT-097's routes over a telemetry table in the projection
database (`.corpus/`, beside the queue):

- **Ingestion**: append rows `(at, command, wroteBytes, readBytes, subject)`
  — one row per subject, zero-subject invocations kept with a null subject so
  workspace-wide cost is still answerable later. Cheap by construction: one
  INSERT batch, no reads on the write path.
- **The series**: bucket server-side (recommendation: daily; state it),
  derive tokens as bytes ÷ 4 in one place, include the document's current
  size, cap buckets per CONTRACT-097.
- **Retention**: decide and record — recommendation: raw rows kept 90 days,
  bucketed aggregates kept indefinitely (the panel's question is long-term,
  the row detail is not).
- **Posture**: telemetry is runtime state. `db rebuild` does not reconstruct
  it and starts it empty; `db doctor` never reports its absence or content as
  drift (INFRA-033's staleness-vs-drift line). SCHEMA_VERSION bump.

## Acceptance Criteria

- [ ] Ingestion adds no read and no commit; measured cost per report stated
      in the log
- [ ] Series correct against hand-computed fixtures; buckets, truncation,
      size line all per contract
- [ ] `rebuild && doctor` clean with and without telemetry present
- [ ] Retention implemented as recorded
- [ ] `npm test -w apps/server` green; E2E with real reports via curl

## E2E Verification Log

_Implementing agent fills; state the model._
