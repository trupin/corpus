# [CONTRACT-096] A thread's digest on the wire

## Domain

contract

## Status

done

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

- [x] `ThreadSchema.digest` as above; openapi.json regenerates; typed client
      carries it
- [x] PUT and DELETE routes with the three error cases stated
- [x] Context pack decision made and recorded here
- [x] `npm run build && npm test -w packages/contract` green
- [x] Drift check green (`scripts/check-generated-artifacts.ts`)

## Decisions

### 1. The context pack carries the digest — the recommendation, taken

`digest` sits on `contextPackBase`, so **all five** pack shapes carry it. The
pack is the rehydration read and a digest is rehydration's first line, and a
digest is a fact about the *conversation* rather than about whichever parent the
thread hangs off — putting it on one variant would hide it on exactly the
threads that most often have one, a resident's own standalone thread.

It carries the **whole `ThreadDigest` component**, not just the prose. The
rider's *"a stale digest is shown as stale wherever it is shown"* is only true by
construction if no surface can carry the body without the flag, and a pack
carrying a naked string would be that surface.

### 2. The 2,000-character bound is stated once, and enforced on the write

`DIGEST_MAX_CHARS = 2000` (`schemas/digest.ts`), published as `maxLength` on
`WriteDigestRequest.body` and stated in prose on `ThreadDigest.body`.

It is deliberately **not** a `.max()` on the response. A response-side ceiling is
only honest if something can bring an over-long value back inside it, and the one
repair available is truncation — which the rider forbids (*"the server never
generates, edits, or repairs a digest"*). So a digest hand-written into
frontmatter past the bound travels whole rather than being silently cut or
refused on the way out. That is this package's standing posture — strict bodies,
tolerant reads (CONTRACT-017) — meeting a case where the alternative would break
a signed sentence. One bound also means the pack carries the digest whole and
never needs a truncation flag for it.

### 3. Neither `422` mints a new error code

- **No resident** → `unknown_recipient`, with the thread id in `recipient`. That
  component already publishes *"this workspace holds no such thread, or that
  thread holds no resident and is therefore not a lane at all"* — the second
  clause is this refusal exactly — and its remedy is the one the component names.
  Sameness of *remedy* is this package's test for sharing a code (CONTRACT-058).
- **Blank body** → `bad_request` at `422`, on `PAYLOAD_TOO_LARGE_RESPONSE`'s
  argument: `ERROR_CODES` is a published discriminant, so a new member is a
  four-domain breaking change, and the status is what carries the distinction.

The two are told apart at `code` on the write, which is the arrangement
`UNRESOLVED_REFERENCE_RESPONSE` uses, declared as an inline union so no `oneOf`
gets a component name (CONTRACT-037).

### 4. `422`, not `400`, and why that is consistent with the repo's own rule

The rule is that `400` means *fix the body and retry*. Both refusals are about
the **act**: a thread with no resident may not hold a digest at all, and a caller
that sent an empty body meant to clear, which is a different verb on the same
path. No body sent to this route helps in either case. An over-length body **is**
an ordinary `400`, because a shorter one is exactly what would work.

The request schema therefore carries **no `.min(1)`** — a minimum would move the
blank-body refusal to the `400` that sends a would-be clearer in circles.

### 5. A response envelope of its own, shared by both verbs

`ThreadDigestResponse = {threadId, digest, warnings}`.
`ThreadMutationResponse` was rejected: it carries a `ThreadSummary`, which must
not grow a digest — a summary is every row of `GET /api/docs?type=thread`. The
write **must** answer with the digest, because the writer cannot know the
watermark the server stamped. One shape serves both verbs the way
`ThreadMutationResponse` serves resolve and reopen: `digest` is the digest after
the call, non-null after a write and null after a clear.

### 6. Recorded consequence — a digest can outlive the ability to touch it

Both verbs refuse a thread with no resident, per this issue. Resolving a thread
releases its resident (SPEC.md §7), so a resolved thread's digest can afterwards
be neither rewritten nor removed. The write half of that is the rider's own
consequence (*"corrected only by a resident writing it again"*); this issue
extends it to the clear so the digest surface answers one question about a
thread rather than two. The stranded digest stays honest — it keeps its
watermark and still reports `stale`. **If that stranding matters in use, the fix
is to drop the `DELETE`'s `422`**, which is additive to every client. Recorded in
the route module's docblock so it is a decision rather than a discovery.

## Technical Design

`packages/contract/src/schemas/thread.ts` (field + routes beside the existing
thread routes), `schemas/context.ts` if the pack carries it, regenerate
`openapi.json` + client. Follow the transcription/test pattern the file's own
header describes.

## E2E Verification Plan

Contract-only: the built client's types name the field and routes; the drift
check passes. Consumer E2E lands with SERVER-164/CLI-077.

## E2E Verification Log

**Model: opus** (contract-dev, 2026-09-05). Scope is contract-only, as the plan
above states: the consumer E2E lands with SERVER-164 and CLI-077.

### What was built

- `packages/contract/src/schemas/digest.ts` — `DIGEST_MAX_CHARS`,
  `ThreadDigestSchema` (`ThreadDigest`), `digestField`,
  `WriteDigestRequestSchema`, `ThreadDigestResponseSchema`.
- `Thread.digest` (`schemas/thread.ts`) and `digest` on `contextPackBase`
  (`schemas/context.ts`), both `z.union([ThreadDigestSchema, z.null()])` — never
  `.nullable()` on a registered component (CONTRACT-037).
- `packages/contract/src/routes/thread-digest.ts` — `writeThreadDigest` (`PUT`)
  and `clearThreadDigest` (`DELETE`), registered last in the thread group,
  added to `ENDPOINT_INVENTORY` with a derivation note.
- `query-keys.ts`: the `thread` key's `emittedBy` now names a digest write or
  clear.

### Generation and drift

```
$ npm run generate -w packages/contract
generated ./openapi.json
generated ./src/client/schema.generated.ts
```

Idempotent — two consecutive runs, byte-identical:

```
c6d0077e71c296838016745425246ea8f13332611eba3c3fea9eb87ddad1df75  packages/contract/openapi.json
79edd7e2f3beec384cf3b97f764107049701ce32cf8ccab157f88e1b01084821  packages/contract/src/client/schema.generated.ts
```

Published document, read back out of `openapi.json`:

- `Thread.required` = `[…, "resident", "digest", "unread", "turns"]`.
- `Thread.properties.digest` = `anyOf: [{$ref: ThreadDigest}, {type: "null"}]`,
  and `ThreadDigest.type` stays `"object"` — the component was not rewritten.
- `paths["/api/threads/{id}/digest"]` = `put`, `delete`; both declare
  `200/400/401/404/422`.

Generated client (`src/client/schema.generated.ts`):

- `paths["/api/threads/{id}/digest"]` with `WriteDigestRequest` in and
  `ThreadDigestResponse` out on both verbs.
- `digest: components["schemas"]["ThreadDigest"] | null` on `Thread` **and** on
  all four context-pack variants that name it.

`node --import tsx scripts/check-generated-artifacts.ts` reports the API contract
as differing **from `HEAD`**, which is this issue's own uncommitted work — its
regeneration half is a no-op (the hash across the regeneration is unchanged, as
the two-run comparison above shows), and the diff it prints is exactly the two
artifacts this issue regenerated (+546 lines). The orchestrator's commit closes
it. `CLI reference is up to date` in the same run.

The check that reads the **committed** files locally is
`src/generation/artifacts.test.ts`, and all eleven of its cases pass, including
*"has openapi.json committed in sync with the route definitions"* and *"has
src/client/schema.generated.ts committed in sync"*.

### Tests

```
$ VITEST_MAX_THREADS=4 npx vitest run packages/contract
468/468 files, 3148 passed, 0 failed
```

New coverage:

- `src/schemas/digest.test.ts` (16 cases) — the three required fields, the
  watermark as an instant, the read accepting an over-bound body, the write
  refusing `watermark` and `stale` **by name**, the bound at exactly 2000, and
  the blank body parsing so the route can refuse it with the status that names
  the real remedy.
- `src/schemas/thread.test.ts` — digest required-and-nullable, and a digest
  carrying prose without its watermark or staleness refused.
- `src/openapi.test.ts` — a `describe` pinning the published document: the three
  fields, the union spelling, the pack variants carrying the **same** field
  object as the thread (compared by pointer, not by transcribed prose), the
  request having no watermark and saying why, the bound published on the write
  and absent on the read, both refusals, and the inventory entries.
- `src/routes/index.test.ts` — the pair mounted on a real Hono app: the stub
  stamps a watermark the caller never sent, a body carrying `watermark` is a
  `400` **before any handler runs**, a blank body is a `422` with
  `bad_request`, and both verbs refuse `th_undesignated` with
  `unknown_recipient`.
- `src/client/index.test.ts` — the same three through the real typed client,
  with the `422` read as a **narrowing** (`if (error?.code !== …) throw`) rather
  than an optional-chained property read, so it fails to compile if the response
  is undeclared.
- `src/client/request-body-required.test.ts` — the compile-time probe records
  `PUT /api/threads/{id}/digest` as a mandatory body.

Sweeps updated rather than bypassed: the §11 warnings carrier list gained
`ThreadDigestResponse`, the request-body inventory 26 → 27, and the declared-422
sweep 10 → 12 operations. That last one now also checks each allowed body's
`code` really is a member of `ERROR_CODES` — `ApiError` is deliberately
unpublished (no route answers with the whole union), so the member list stays
transcribed and this is what keeps the transcription honest.

### Checks

- `npx tsc --noEmit -p packages/contract` — clean.
- `npx eslint packages/contract/src` — no issues.
- `npx prettier --check` on the new files — clean.
- `npm run build` — `packages/contract`, `packages/kit` and `apps/cli` build.
  `apps/ui`'s `vite build` fails on `Rollup failed to resolve import
  "react-router"`, which is a **worktree environment** limitation and not this
  change: `react-router` is installed nested at
  `<main checkout>/apps/ui/node_modules`, and this worktree has no
  `node_modules` of its own.

### Known and reported: downstream TypeScript breakage

A required response field is additive on the wire and breaking in TypeScript for
every **constructor** outside this package. Every *reader* compiles unchanged.
The production sites are `toWireThread` (`apps/server/src/threads/read.ts:214`)
and the pack assembly (`apps/server/src/threads/context.ts`), plus fixtures in
the consumer workspaces — SERVER-164 and CLI-077 rewrite those exact lines. The
in-package fixtures were fixed here (`routes/index.test.ts`,
`routes/thread-create.test.ts`, `client/index.test.ts`,
`client/upload.test.ts`, `client/request-defaults.test.ts`,
`schemas/thread.test.ts`, `schemas/context.test.ts`).

**The count is not measurable from this worktree**: the shared
`node_modules/@corpus/contract` symlink points at the **main checkout's**
`packages/contract`, so `tsc -p apps/server` here compiles against the old
contract and reports clean. The repo typecheck is red between this landing and
its consumers.
