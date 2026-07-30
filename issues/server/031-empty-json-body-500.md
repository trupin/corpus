# [SERVER-031] Empty JSON body returns 500 instead of 400

## Domain

server

## Status

done

## Priority

P2

## Model

opus — a validator-wrapper fix with a clear reproduction.

## Dependencies

- Depends on: SERVER-003
- Blocks: —

## Spec References

- issues/evals/SERVER-019-eval.md — orchestrator-adjudication note 2 (2026-07-28)

## Summary

Found by the sprint-013 evaluator (pre-existing, not a regression): a `POST` with
`content-type: application/json` and an **empty body** returns `500 internal_error` (Hono's
validator throws "Malformed JSON in request body") on `/api/check`, `/api/threads`, `/api/docs` —
any JSON route. A malformed request is the caller's error: it should be a `400` with the standard
error envelope. Fix once at the shared validator/defaultHook layer, not per route; add a test that
sweeps every POST/PUT/PATCH route in `ENDPOINT_INVENTORY` with an empty body and asserts 400.

## Acceptance Criteria

- [x] Empty and malformed JSON bodies return 400 with the standard error shape on every JSON
      route; no route 500s.
- [x] One shared fix; inventory-driven sweep test.

## Technical Design (as implemented)

**The fix cannot live in `defaultHook`**, and finding out why is most of the issue. Hono's body
validator (`hono/dist/validator/validator.js:17-22`) calls `c.req.json()` and, on failure, throws
`HTTPException(400, "Malformed JSON in request body")` — **before** it ever calls the validation
function `defaultHook` is attached to. The only shared seam that can see it is `app.onError` →
`toHttpError`, which did not recognise the type and fell through to `internalError()`.

So `errors.ts` grows one arm: `toHttpError` recognises `HTTPException` and re-clothes it in the
contract's envelope via `fromHttpException` — the framework's status, our body, every arm an
existing constructor (`unauthorized`/`forbidden`/`notFound`/`conflict`/`payloadTooLarge`, else a
`bad_request` at the given status). `5xx` collapses to the opaque internal error, so an operator's
message still cannot travel to a client, and a custom `res` on the exception is deliberately not
honoured (sprint-002 Adjudication 2 pins every error body to `ApiError`). One arm; no route
touched. It also closes the same hole for `"Malformed FormData request."`, which 500'd identically
on the multipart routes.

`apps/server/src/json-body.test.ts` sweeps `ALL_CONTRACT_ROUTES` structurally — every `POST`/`PUT`/
`PATCH` that declares an `application/json` request body must answer 400 with `code: bad_request`
for four unreadable bodies, and *no* mutating route may answer ≥ 500 for any of them. A route added
later joins the sweep by existing. `POST /api/jobs/{id}/log` is reached with a synthetic loopback
peer, since its §7 peer-address guard would otherwise refuse it before the body is read.

## E2E Verification Log

**Implemented on: opus.** Real server from source (`corpus server start`), real workspaces under
`/tmp/corpus-s014-serverhard-*`, ports 9155/9156, real `curl` and `fetch`.

### Pre-fix reproduction (2026-07-28, port 9155)

```
$ curl -s -i -X POST http://127.0.0.1:9155/api/check \
    -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" --data-binary ''
HTTP/1.1 500 Internal Server Error
content-type: application/json
{"code":"internal_error","message":"internal error"}
```

`POST /api/docs` (empty) → 500. `PUT /api/docs/{id}` (empty) → 500. `POST /api/threads` with the
malformed body `{oops` → `{"code":"internal_error","message":"internal error"}`.

### Post-fix (fresh workspace, port 9156) — 13 routes × 3 bad bodies

```
POST  /api/check                                    empty=400 bad_request  truncated=400 bad_request  prose=400 bad_request
POST  /api/docs                                     empty=400 bad_request  truncated=400 bad_request  prose=400 bad_request
POST  /api/threads                                  empty=400 bad_request  truncated=400 bad_request  prose=400 bad_request
PUT   /api/docs/doc_aaaaaaaa                        empty=400 bad_request  truncated=400 bad_request  prose=400 bad_request
POST  /api/docs/doc_aaaaaaaa/move                   empty=400 bad_request  truncated=400 bad_request  prose=400 bad_request
POST  /api/threads/th_aaaaaaaa/turns                empty=400 bad_request  truncated=400 bad_request  prose=400 bad_request
POST  /api/threads/th_aaaaaaaa/turns/…/form         empty=400 bad_request  truncated=400 bad_request  prose=400 bad_request
POST  /api/threads/th_aaaaaaaa/seen                 empty=400 bad_request  truncated=400 bad_request  prose=400 bad_request
POST  /api/queue/halt                               empty=400 bad_request  truncated=400 bad_request  prose=400 bad_request
POST  /api/queue/evt_aaaaaaaa/fail                  empty=400 bad_request  truncated=400 bad_request  prose=400 bad_request
POST  /api/locks/doc_aaaaaaaa                       empty=400 bad_request  truncated=400 bad_request  prose=400 bad_request
POST  /api/jobs/evt_aaaaaaaa/log                    empty=400 bad_request  truncated=400 bad_request  prose=400 bad_request
POST  /api/skills/sample/rollback                   empty=400 bad_request  truncated=400 bad_request  prose=400 bad_request
```

`/api/jobs/{id}/log` is included because the requests came over a real loopback socket, which is
what its §7 guard demands.

A readable body still validates normally, so nothing was flattened into a parse error:

```
POST /api/docs {"type":"note"}
400 {"code":"bad_request","message":"request failed validation",
     "issues":[{"path":"json.title","message":"Invalid input: expected string, received undefined"}]}
```

Server log over the whole run: `grep -c "unhandled error"` → **0**, `grep -c '"status":500'` →
**0**, `grep -c '"status":400'` → 42.

### Checks

- `npm run lint`, `npm run format:check`, `npm run typecheck` (all workspaces): clean.
- `vitest run apps/server`: **120 files, 2361 tests, all passing.**
- Negative check: with the `HTTPException` arm removed, 5 of the 7 sweep tests fail (all four
  bad-body cases and the "never 500" case); the two that assert *normal* validation still pass.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
