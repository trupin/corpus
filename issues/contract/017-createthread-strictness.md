# [CONTRACT-017] `CreateThreadRequest` accepts unknown keys — silent unanchored threads

## Domain

contract

## Status

done

## Priority

P2

## Model

opus — schema strictness with a consumer-impact sweep.

## Dependencies

- Depends on: CONTRACT-009
- Blocks: —

## Spec References

- issues/evals/SERVER-019-eval.md — orchestrator-adjudication note 3 (2026-07-28)

## Summary

Found by the sprint-013 evaluator (pre-existing): `CreateThreadRequest` is not strict — sending
`anchor: {quote: …}` instead of the declared `selector: {exact: …}` yields `200` with a silently
unanchored thread (`anchorId: null`). A typoed key should be a 400, not a silently different
outcome. Evaluate making the request schema strict (or at minimum rejecting unknown top-level
keys), sweep the other request schemas for the same class, and check the multipart path
(CONTRACT-009) still round-trips. Consumer impact expected to be nil (UI/CLI send declared keys),
but the generated-client round-trip and e2e must prove it.

## Acceptance Criteria

- [x] Unknown top-level keys on `CreateThreadRequest` are rejected 400; other request schemas
      audited with the chosen policy stated.
- [x] Artifacts regenerated idempotently; consumers unaffected (typecheck + e2e green).

## E2E Verification Log

Implemented on: **fable** (contract-dev, same session as CONTRACT-014, worktree
`agent-a19316a653ad13254`, base `c48a4c6`).

**Policy: strict bodies, tolerant reads** — stated in `packages/contract/src/schemas/index.ts`.
Every request *body* schema (JSON and multipart) is `z.strictObject`: an unknown top-level key is a
`400` naming the key, because a body is an instruction and an unknown key in one is either a typo
of a declared key or a semantic the server would silently drop — acceptance means performing a
different mutation than asked. Openness stays where openness *is* the contract, one level down
(`extra`, `ViewQuery`, queue event `payload` — open values of closed keys). Query/path/header
schemas stay tolerant (headers are an open set; an unknown query key on a read yields a visible,
recoverable result, not a wrong write). Responses unchanged. Precedent: `CheckRequestSchema` was
already `z.strictObject` (both XOR branches).

**Sweep (15 request bodies made/confirmed strict):** `CreateThreadRequest`,
`MultipartCreateThreadRequest`, `AppendTurnRequest`, `MultipartAppendTurnRequest`,
`MarkSeenRequest`, `FormAnswerRequest`, `CreateDocRequest`, `UpdateDocRequest` (the sharpest case:
all-optional, so a typoed `pinnned` used to validate as the empty update), `MoveDocRequest`,
`CaptureRequest`, `AcquireLockRequest`, `HaltQueueRequest`, `FailEventRequest`,
`AppendLogRequest`, `SkillRollbackRequest`; `CheckRequest` already strict. Enforced forever by a
new `openapi.test.ts` sweep: every request body in the published document must carry
`additionalProperties: false` (resolves `$ref`s, requires every `anyOf` branch strict, and asserts
≥15 bodies seen so the sweep cannot pass vacuously).

**Multipart path still round-trips:** contract `upload.test.ts` + `thread-create.test.ts` green,
including new tests — unknown JSON key (`anchor: {quote: …}`, the eval's exact typo) → 400 through
the mounted dual-media route; unknown multipart part → 400; all CONTRACT-009 accept cases
unchanged.

**Consumer impact:** typecheck green across all six workspaces (UI/CLI send declared keys — no
code change needed anywhere). **One server test pinned the loose behavior — updating it was in
scope and is flagged here:** `apps/server/src/threads/forms.test.ts` "records the acting party
from the header, never from the body" proved header-wins by sending `author`/`actor`/`from` in the
body and expecting 201-with-keys-dropped. Split into two tests: header attribution with a clean
body (201), and a new "rejects a body carrying attribution-shaped keys, writing nothing" (400,
turn count unchanged) — strictly stronger than the old guarantee. No other server/UI/CLI/kit test
sent undeclared keys (full `apps/server` suite green after the one update).

**Evidence**

- Contract suite: 39 files, **1211 tests passed** (includes the strictness sweep + the two new
  route tests).
- `apps/server`: 120 files / 2361 tests → 1 failure (the pinned-loose test above) → fixed → file
  re-run 44/44 green. `apps/cli` thread+input 47 passed; `packages/kit/src/events` 31 passed;
  `apps/ui/src/thread` 87 passed.
- E2E (real listening stub on **port 9165**, GENERATED client from built dist):
  `POST /api/threads` JSON with declared keys → 201, `anchorId` echoed;
  `anchor: {quote: …}` instead of `selector` → **400** with
  `issues: [{path: "", message: 'Unrecognized key: "anchor"'}]`;
  `uploadCreateThread` multipart with a `File` → 201, text echoed; multipart with an unknown
  `anchor` part → 400. Port freed on exit.
- Artifacts: `npm run generate -w packages/contract` re-run idempotent — drift check
  (`node --import tsx scripts/check-generated-artifacts.ts`) twice, identical output, regeneration
  arm a no-op both times; only the diff-against-HEAD arm fires (expected on an uncommitted tree).
  `openapi.json` gains `"additionalProperties": false` on the request bodies;
  `schema.generated.ts` delta is 2 lines (description churn — `additionalProperties: false`
  doesn't change the generated TS shape, which is why consumers compile untouched).
- Gates: `npm run lint` ✓, `npm run format:check` ✓, `npm run typecheck` ✓.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
