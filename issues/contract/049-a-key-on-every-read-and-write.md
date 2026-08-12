# [CONTRACT-049] A key on every read, and on every write that overwrites

## Domain

contract

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-041 (applied to §7, 2026-08-11)
- Blocks: SERVER-098, SERVER-099, CLI-038, UI-107, AGENT-022

## Spec References

- SPEC.md **§7** "A key, not a lock" — the whole section
- SPEC.md **§9.2** — the Keys bullet that replaced the Locks bullet
- SPEC.md **§9.3** — `lock` struck from the resources the contract models

## Summary

The wire shape for SHARED-041. Everything else in the chain consumes this, so it
lands first and alone.

Three things go **in**: a **key** on every document read, an optional key on the
write requests that need one, and a **`409`** refusal that carries the document
as it now stands plus a fresh key. One thing comes **out**: the lock routes and
every `423`.

## The derivation is yours to choose, and the spec deliberately does not fix it

SHARED-041's orchestrator adjudications say the key is **derived from the
document's current content**, not issued — so there is no registry, nothing to
expire, and an out-of-band edit invalidates it for free. What the spec guarantees
is only the behaviour: a key names the version you read and changes when the
document does.

Choosing the derivation is this issue's job. Constraints, in order:

1. It must change whenever the stored bytes change, and not otherwise.
2. It must be stable across a server restart — no in-memory state.
3. A **move** must not invalidate it (§9.2: the id never changes, and a move
   rewrites the path, not the content).
4. It must be cheap on every read; a document read is the hottest path here.
5. It must be opaque to the client. Nobody may parse it, and nothing about its
   shape may leak into a caller's logic. Prior art in this repo:
   `packages/contract/src/schemas/weight.ts` models an opaque shape-validated
   string exactly this way — read it before inventing a second pattern.

A content hash is the obvious answer, and the obvious answer is probably right.
Say what you chose and why in the E2E log, including what you rejected.

## Acceptance Criteria

- [ ] Every document read carries its key: `GET /api/docs/{id}` at least, and any
      other route that returns a whole document body
- [ ] Every read that carries a key also says whether **a person has an edit
      session open** on that document (§7's advisory signal). It is a fact, never
      a gate, and the schema should make that hard to misread
- [ ] Writes that **replace a block** accept a key: `PUT /api/docs/{id}` when it
      carries a body or a whole-frontmatter rewrite. Writes that **name a delta**
      do not — tag add/remove, folder, archive/unarchive, status, `reviewed`,
      move — and the contract should make that distinction legible rather than
      leaving it to a server comment
- [ ] `POST /api/docs/{id}/patch` (§9.2, SHARED-037) takes **no key**. Its
      expected text is the same check by another route
- [ ] A stale key answers **`409`** carrying (a) the document as it now stands and
      (b) a fresh key for it. Never a bare refusal
- [ ] `423` is gone from every route, and the `LOCKED_RESPONSE` helper with it
- [ ] The lock routes are gone: `packages/contract/src/routes/locks.ts` and its
      re-exports, the lock schemas, and the `locks` query key if one exists
- [ ] `openapi.json` regenerates and the drift check passes
- [ ] The generated typed client compiles for both consumers — **build `apps/cli`
      and `apps/ui` against it and expect them to fail**, since they still call
      the routes you removed. Record what broke; that list is CLI-038's and
      UI-107's work, and it is cheaper to hand it over than to have them find it
- [ ] The **key is required, not optional, where it applies**. A body-replacing
      `PUT` with no key must be refusable — that is the whole point, and an
      optional field that servers may ignore reproduces the lock

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/key.ts` (new) — the opaque key, modelled on
  `weight.ts`
- `packages/contract/src/schemas/doc.ts`, `query.ts` — the key and the editing
  signal on reads; the key on `UpdateDocRequest`
- `packages/contract/src/routes/docs.ts` — the `409`, and `423` removed
- `packages/contract/src/routes/responses.ts` — `CONFLICT_RESPONSE` shaped for
  this; `LOCKED_RESPONSE` deleted
- **Delete** `packages/contract/src/routes/locks.ts` and its tests
- `packages/contract/src/routes/index.ts` — the re-exports

### Edge Cases

- **A refusal's payload is a whole document.** That is deliberate (SHARED-041
  decision 5: one round trip, not two), but it means an error response carries a
  body. Check that nothing in the error-handling path assumes errors are small,
  and that `isApiError` still classifies it.
- **`409` is already used** by the reattach route (`ReattachConflictError`).
  Two different conflicts on one status code need distinguishable `code` values;
  do not overload one shape for both.
- **A `PUT` that names no change at all** (§9.2: an omitted body is a `{}` body).
  It replaces nothing, so it needs no key. Confirm that reading of §7 holds.

## Testing Strategy

Schema-level: a key round-trips, an empty or malformed one is refused, the `409`
shape validates with a document inside it. Plus the OpenAPI drift check.

## E2E Verification Plan

Contract-only, so the E2E is the generated artifacts: `openapi.json` regenerates
clean, the typed client builds, and the two consumers' breakage list is recorded.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
