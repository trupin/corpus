# [CONTRACT-096] A thread's digest on the wire

## Domain

contract

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-077 (the signed §6 rider — read it before designing)
- Blocks: SERVER-164, CLI-077

## Spec References

- SPEC.md **§6** — the digest rider (signed 2026-09-05): one digest per thread,
  resident-written, watermarked, stale-markable, never server-generated
- SPEC.md **§9.3** — contract-first via code

## Summary

The wire shape for the §6 digest. Two pieces:

1. **`digest` on `ThreadSchema`** — nullable object beside `resident`:
   `{ body: string, watermark: string (ISO turn ts), stale: boolean }`. Null is
   the ordinary no-digest state per the rider. Carried by `GET /api/threads/{id}`
   and anywhere `ThreadSchema` already travels.
2. **`PUT /api/threads/{id}/digest`** — body `{ body: string }`. The server
   stamps the watermark itself (the newest turn's ts at write time — the writer
   cannot state a watermark, because the server is the only party that knows
   what the newest turn is at the instant of the write) and clears `stale`.
   Errors: 404 unknown thread, 422 when the thread has no resident designation
   (the rider says the resident writes it), 422 on an empty body — clearing a
   digest is `DELETE /api/threads/{id}/digest`, not an empty PUT.

Decide and record: whether the digest also joins the context pack
(`schemas/context.ts`). Recommendation: yes, as a nullable field the pack
carries when present — `thread context` is the rehydration read and the digest
is rehydration's first line. Bound it with the pack's existing discipline (a
max length is the contract's to state; take 2,000 characters and record it).

## Acceptance Criteria

- [ ] `ThreadSchema.digest` as above; openapi.json regenerates; typed client
      carries it
- [ ] PUT and DELETE routes with the three error cases stated
- [ ] Context pack decision made and recorded here
- [ ] `npm run build && npm test -w packages/contract` green
- [ ] Drift check green (`scripts/check-generated-artifacts.ts`)

## Technical Design

`packages/contract/src/schemas/thread.ts` (field + routes beside the existing
thread routes), `schemas/context.ts` if the pack carries it, regenerate
`openapi.json` + client. Follow the transcription/test pattern the file's own
header describes.

## E2E Verification Plan

Contract-only: the built client's types name the field and routes; the drift
check passes. Consumer E2E lands with SERVER-164/CLI-077.

## E2E Verification Log

_Implementing agent fills; state the model._
