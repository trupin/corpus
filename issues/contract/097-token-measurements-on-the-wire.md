# [CONTRACT-097] Token measurements on the wire

## Domain

contract

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-079 (design constants + the rider, which signs first)
- Blocks: SERVER-166, CLI-085, UI-190

## Spec References

- SPEC.md §9 — the drafted telemetry rider (SHARED-079)

## Summary

Two routes:

1. **`POST /api/telemetry/invocations`** — the CLI's fire-and-forget report.
   Body: `{ command: string (the resolved path, e.g. "thread show"),
   wroteBytes: int, readBytes: int, subjects: string[] (doc/thread ids the
   invocation named, may be empty), at: ISO }`. Response 204. Deliberately
   minimal: no per-flag detail, no payload echo. Accepts batches
   (`invocations: [...]`) so a future buffering CLI needs no new route.
2. **`GET /api/docs/{id}/cost`** — the panel's series. Returns bucketed
   totals over time (bucket granularity the server's choice, stated in the
   response), each bucket `{ from, to, wroteTokens, readTokens, invocations,
   byCommand: {path: tokens} }`, plus the document's byte size at read time
   for the reference line. Bounded: a `limit` on buckets with the newest
   kept, stated truncation.

Tokens on the wire are the house estimate (bytes ÷ 4) computed server-side —
the CLI reports bytes, the server derives, one definition.

## Acceptance Criteria

- [ ] Both routes defined per the package's transcription pattern; artifacts
      regenerate byte-identical twice
- [ ] Telemetry ingestion is explicitly fire-and-forget in the description:
      idempotency not promised, loss acceptable, never load-bearing
- [ ] `npm test -w packages/contract` green
- [ ] Consumer typecheck window (server) noted in the report, per the
      CONTRACT-096 precedent

## E2E Verification Log

_Implementing agent fills; state the model._
