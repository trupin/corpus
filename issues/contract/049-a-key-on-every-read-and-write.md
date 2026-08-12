# [CONTRACT-049] A key on every read, and on every write that overwrites

## Domain

contract

## Status

done

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

- [x] Every document read carries its key: `GET /api/docs/{id}` at least, and any
      other route that returns a whole document body
- [x] Every read that carries a key also says whether **a person has an edit
      session open** on that document (§7's advisory signal). It is a fact, never
      a gate, and the schema should make that hard to misread
- [x] Writes that **replace a block** accept a key: `PUT /api/docs/{id}` when it
      carries a body or a whole-frontmatter rewrite. Writes that **name a delta**
      do not — tag add/remove, folder, archive/unarchive, status, `reviewed`,
      move — and the contract should make that distinction legible rather than
      leaving it to a server comment
- [x] `POST /api/docs/{id}/patch` (§9.2, SHARED-037) takes **no key**. Its
      expected text is the same check by another route
- [x] A stale key answers **`409`** carrying (a) the document as it now stands and
      (b) a fresh key for it. Never a bare refusal
- [x] `423` is gone from every route, and the `LOCKED_RESPONSE` helper with it
- [x] The lock routes are gone: `packages/contract/src/routes/locks.ts` and its
      re-exports, the lock schemas, and the `locks` query key if one exists
- [x] `openapi.json` regenerates and the drift check passes
- [x] The generated typed client compiles for both consumers — **build `apps/cli`
      and `apps/ui` against it and expect them to fail**, since they still call
      the routes you removed. Record what broke; that list is CLI-038's and
      UI-107's work, and it is cheaper to hand it over than to have them find it
- [x] The **key is required, not optional, where it applies**. A body-replacing
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

**Model: opus** (contract-dev, 2026-08-12). Contract-only issue, so the E2E is
the generated artifacts, the mounted app, and the two consumers' compilers.

### The derivation chosen — and what was rejected

**A key is the lowercase hexadecimal SHA-256 digest of the document file's stored
bytes, exactly as they sit on disk** — frontmatter block and body together,
un-normalised and un-re-serialised. Validated on the wire as `^[0-9a-f]{64}$`;
the derivation itself is stated in `schemas/key.ts`'s docblock (which is
SERVER-098's obligation) and deliberately **not** published in the OpenAPI
description — a caller that knows the algorithm is a caller that will eventually
compute one, and a computed key is evidence of a read that never happened.

Against the issue's five constraints, in its order:

1. **Changes iff the bytes change** — it is a function of those bytes and
   nothing else: not the request, the clock, the reader or the path.
2. **Survives a restart** — nothing is stored; it is recomputed per read.
3. **A move does not invalidate it** — the path is not an input, and a move
   rewrites the path rather than the content.
4. **Cheap** — a read already loads the file's bytes to answer with them, so the
   key is one hash pass over bytes in hand. No extra read, query or process.
5. **Opaque** — a bare digest has no substructure to branch on.

Rejected, each against a constraint rather than on taste:

| Rejected | Fails |
| --- | --- |
| mtime / size | (1) both ways: two writes in one timestamp tick are identical; a restore moves the timestamp without moving a byte |
| git blob hash of `HEAD` | (1) and (4): the working tree legitimately differs from `HEAD` when a hook rejects the auto-commit (§14), so the version you read may have no blob at all; and it puts a git call on the hottest read |
| a version counter / ETag registry / any issued token | (2), and the property SHARED-041 fixed: it is state to persist, migrate and invalidate, and an out-of-band edit would **not** invalidate it — the case with no other guard |
| frontmatter `updated` | (1) and (5): one-second granularity, unchanged by a hand edit that does not touch it, and predictable — a key a writer can forge is not evidence |
| hashing the body alone | (1) for §7's second keyed write: a whole-frontmatter rewrite would not move the key |
| a shorter digest, or a `k1_` version prefix | (5): a prefix is substructure, and substructure is the first thing a client parses. A key is good for at most one write, so a derivation change needs no generation marker |

**Also rejected: `ETag`/`If-Match`/`412`.** Three reasons, in `schemas/key.ts`:
the signed spec fixes `409` carrying the document; required-where-it-applies is
not expressible across a header/body boundary (a refinement sees one schema, so
the enforcement would decay into a server comment); and `ETag` implies a
conditional-`GET` cache contract this server does not offer and intermediaries
may act on.

### How "required where it applies" is actually enforced

`UpdateDocRequest` is one body carrying both the keyed write and the delta
writes, so `key` cannot be a plain required field. It is enforced twice over:

- a `.refine()` on the `z.strictObject` — so `@hono/zod-openapi` answers `400`
  **before any handler runs**. Nothing in the server has to remember to check,
  which is exactly what the lock relied on and did not get;
- published as JSON Schema: `"dependentRequired": {"body": ["key"]}` in
  `openapi.json`, derived from `KEYED_UPDATE_FIELDS`. A reader of the document
  alone learns the rule instead of taking a description's word for it.

`KEYED_UPDATE_FIELDS = ["body"]` — the one field that replaces a block without
saying what it changes. Every frontmatter field on this request names its own
delta, so §7's "whole-frontmatter rewrite" is not a shape this API offers; if one
is ever added it joins that list. `tags` is deliberately excluded and the
residual is recorded at the constant: §7 and this issue both name tag add/remove
as the canonical keyless write, though `PUT`'s `tags` is a whole-set replacement,
so §7's *What a key does not do* governs it. A key sent on a delta write is
accepted **and still checked**, so a caller that always presents what it read
needs no rule about which fields are which.

### `409` and the whole-document refusal — both checks from the prompt re-run

- **Distinguishable codes.** `stale_key` is its own `ERROR_CODES` member, taking
  the seat `locked` vacated (still seven, so every `switch` stays exhaustive).
  `ReattachConflictError` keeps `code: "conflict"`. Pinned by
  `openapi.test.ts` → "gives the two 409s distinguishable codes".
- **`isApiError` still classifies it**, including a 200 000-character body:
  `schemas/error.test.ts` → "classifies a refusal carrying a large document".
  Nothing in the error path caps, samples or truncates.
- **The fresh key is `doc.key`, not a sibling field** — one place, so two copies
  cannot disagree. Pinned: `StaleKeyError.required === ["code","message","doc"]`
  and `properties.key === undefined`.

### Commands run, and what they said

```
npm run build -w packages/contract                 → exit 0
npx tsc --noEmit (packages/contract)               → 0 errors
VITEST_MAX_THREADS=4 vitest run packages/contract  → 59 files, 2362 tests, all passed
npx eslint packages/contract                       → exit 0, no issues
npx prettier --check packages/contract/**/*.ts     → all formatted
npm run generate -w packages/contract              → exit 0
```

**Generation is idempotent** — `md5 openapi.json` identical across two
consecutive `npm run generate` runs (`8aa895094ca38fddf76cd71529ae664f` both
times), likewise `schema.generated.ts`.

**The drift check fires, and its two failures are the expected ones**
(`node --import tsx scripts/check-generated-artifacts.ts`):

1. `✗ API contract is stale` — it diffs the regenerated artifacts against
   **HEAD**, and the change is uncommitted. `199 insertions, 1227 deletions`
   across `openapi.json` and `schema.generated.ts`. It goes green on the
   orchestrator's commit; the property that matters here is idempotence, above.
2. `✗ CLI reference: regeneration failed` —
   `apps/cli/src/commands/lock/manage.ts:1 SyntaxError: The requested module
   '@corpus/contract' does not provide an export named 'DEFAULT_LOCK_TTL_SECONDS'`.
   **`docs/cli.md` cannot regenerate until CLI-038 removes the `lock` verb** —
   worth flagging to whoever runs the harvest gate, because it will fail there
   for this reason and not for a contract fault.

**The published surface moved as intended:** 52 → **48** endpoints (the five lock
routes out, none added), 103 → **97** components. Removed: `Lock`,
`LockList`, `AcquireLockRequest`, `ReleaseLockResult`, `LockReapResult`,
`LockedError`, `LockConflictError`. Added: `StaleKeyError`. No operation declares
`423` anywhere (asserted globally), and the only bare word "lock" left in
`openapi.json` is §7's own sentence quoted in the editing signal's description —
*"Neither is a lock in the other direction."*

**Every whole-document response carries a key**, verified from both directions:
the six operations that answer with one, and the closed set of components that
embed `Doc` (`DocMutationResponse`, `UpdateDocResponse`, `StaleKeyError` — and
nothing else). `POST /api/capture` answers with ids only, so it needs none.
`DocRow` deliberately carries neither key nor signal: a row has no body, so there
is no version of one to have read.

`POST /api/docs/{id}/patch` **does not exist in this contract yet** — SHARED-037
is filed but unimplemented, and §9.2 has no bullet for it. The criterion is
therefore vacuous today; the rule ("no key — it names the text it expects, which
is the same check by another route") is recorded at `KEYED_UPDATE_FIELDS` so
whoever adds the route does not add a key to it out of symmetry.

### The key path, exercised against a mounted app

`routes/index.test.ts` → "the key on the write path", against every real route
definition registered on an `OpenAPIHono` app, over `app.request`:

| Request | Answer |
| --- | --- |
| `PUT {body}` with no key | **400** before any handler runs; the body names `key` and says "send back the ..." |
| `PUT {body, key: "doc_a1b2c3"}` | **400** — an id is not a key |
| `PUT {body, key}` | **200**, and `doc.key` is a **different** key from the one presented |
| `PUT {tags}` / `{status}` / `{}` with no key | **200** — a named delta needs none |
| `PUT {body, key}` on a moved document | **409**, `code: "stale_key"`, carrying `doc.body` as it now stands, a fresh `doc.key`, and `doc.userEditing: true` |
| `GET /api/docs/{id}` | carries `key` and `userEditing` |

And through the **generated typed client** (`client/index.test.ts`): read a key,
write with it, get a fresh one back; and a `409` narrowed to `stale_key` whose
`doc` is reachable without a cast.

### Consumer breakage — handed over rather than rediscovered

Compilers run against the built contract. **None of this is a contract fault;
all of it is the removal landing.**

**`apps/cli` — 21 errors (CLI-038).**

- `src/commands/lock/` — the whole verb family, to be **deleted**: `manage.ts`
  (15 errors: `DEFAULT_LOCK_TTL_SECONDS`, `/api/locks`, `/api/locks/{docId}`),
  `break.ts` (4: `/api/locks/{docId}/break`), plus `index.ts` and the three
  colocated test files.
- `src/registry/index.ts:7,55` — imports and registers `lockTopic`; the topic
  must go or `corpus --help` advertises a verb that cannot run.
- `src/client.ts:221` — `if ("lock" in body) return { details: body.lock }` in
  the error-detail extractor.
- `src/client.ts:231` — the `423` hint ("the other party holds this document's
  edit lock — defer and come back"). Its replacement is the `409` hint, and the
  refusal now carries the document, so the hint can say what changed.
- `src/commands/doc/fixtures.ts:9` and `src/commands/skill/create.test.ts:23` —
  `Doc` fixtures missing `key`/`userEditing`.
- Not a compile error but the feature half: `corpus doc read` must **print** the
  key (SHARED-041 decision 1 — carried explicitly, never cached by the CLI, since
  one agent's read must not satisfy another agent's write), and the write verbs
  must demand one. `docs/cli.md` regeneration is blocked until the verb is gone.

**`apps/ui` — 10 errors, `packages/kit` — 18, `plugins/todos` — 4 (UI-107).**

- Type imports of removed schemas: `Lock` (kit `query/useEditLock.ts`,
  `row/useRowSignals.ts`; ui `reader/LockBanner.tsx` + test,
  `reader/DocView.tsx`, `reader/useReaderDoc.ts`, `editor/DocEditor.test.tsx`,
  `src/testing/readerFixture.ts`; todos `ui/testing.tsx`,
  `ui/TodoListItem.test.tsx`), `LockList` (kit `query/useLocks.ts`, ui
  `e2e/stubCorpus.ts:27`), `ReleaseLockResult` (kit `query/useBreakLock.ts`,
  `useEditLock.ts`).
- `packages/kit/src/client/createCorpusClient.ts` — four lock methods against
  `/api/locks`, `/api/locks/{docId}` (×2) and `/api/locks/{docId}/break`.
- `packages/kit/src/query/keys.ts:5,10` (+ `keys.test.ts:36,40`) — `LOCKS_KEY`
  and `lockKey` are gone from the published vocabulary, which is now **eight**
  shapes, three of them parameterised.
- `Doc` fixtures missing `key`/`userEditing`: ui `src/testing/readerFixture.ts:83`,
  `e2e/stubCorpus.ts:716`, `e2e/todos-menu.spec.ts:162`, kit
  `markdown/MarkdownView.test.tsx:11`, todos `server/routes.test.ts:96`,
  `ui/testing.tsx:45`.
- Feature half: `editor/useUserLock.ts` goes entirely; the board **never renders
  read-only** and `LockBanner`/force-unlock go with it (§11, rider edit 9); the
  editor presents the key and adopts-then-retries on `409`, reusing the
  external-change handling it already has (decision 2). SHARED-041's one open
  question — what a bulk Save presents — is still open and is UI-107's to settle;
  the contract declares the `stale` refusal class because §11's sentence requires
  the report to be able to say it, not because an implementation must produce it.

**`apps/server` — 48 errors (SERVER-098/099)**, concentrated in
`src/locks/` (5 files), `src/docs/bulk.ts` (10) and its test (6), plus
`src/errors.ts`, `src/events/keys.ts`, `src/docs/archive.ts`, `src/docs/read.ts`,
`src/projection/project-runtime.ts`, `src/skills/rollback.test.ts`,
`src/plugins/mutate.test.ts`. Note for SERVER-099: `PROJECTION_COUNT_FIELDS` no
longer contains `locks`, so the projection's table list and `DbStats` follow
(rider consequential edit 8).

### Judgement calls worth a reviewer's eye

- **`BulkActionRefusal` lost its `lock` field and its `locked` reason; `stale`
  replaced it**, transcribing §11's rewritten sentence ("a document whose content
  moved under the staged Save is refused exactly as a single edit to it would be,
  saying so (§7)"). The alternative — dropping the class to four reasons — would
  have left that sentence with no code to carry it.
- **The rollback and skill-create routes lost `423` and gained no key.** A
  rollback restores a *named revision* rather than composing a block against a
  version it read, so there is nothing a key could be evidence of; a creation's
  document does not exist until the call succeeds. Both say so in their published
  descriptions, so the omission reads as a decision rather than an oversight.
- **Historical prose about the lock was re-marked, not deleted**, where it
  carries live reasoning: `routes/edit-session.ts`, `schemas/edit.ts` and
  `routes/inventory.ts` explain why the flush route exists, and that argument is
  still the reason it does. Each now says the lock is gone and that this session
  is what `Doc.userEditing` reports.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
