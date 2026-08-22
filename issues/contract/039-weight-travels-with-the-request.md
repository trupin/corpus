# [CONTRACT-039] A chosen weight has no way to reach the work it governs

## Domain

contract

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SHARED-022 (signed, applied)
- Blocks: SERVER-069, UI-082

## Spec References

- SPEC.md §7 — the orchestrator-skill paragraph: a stated weight is "honoured,
  not weighed again", and travels with the work
- SPEC.md §10 "Smart input everywhere" — the composer offers the weight
- SPEC.md §7 console bullet — a dispatch names the weight it ran at

## Summary

Found while writing UI-082's issue file, by an agent checking the rider's own
decomposition against what exists. **SHARED-022's chain is missing its middle.**

The rider names agent-runtime, **contract + server**, and ui. Only the
agent-runtime and ui halves were filed. So today:

- §10 says the composer offers the weight and it **"rides with the request to
  whatever does the work"** — but no request schema carries it.
- §7 says a stated weight is honoured by the dispatch — but nothing transports it
  from the post to the queue event the dispatch reads.

Without this, UI-082 cannot satisfy the sentence it implements, and an evaluator
reading §7's console bullet will look for the weight on a dispatch line and not
find it. The feature would be a picker that changes nothing.

## The shape, and the one decision worth making carefully

A weight is **request-time instruction**, not a property of the turn — the same
class as `requestsAgent`, which §8 establishes and which
`apps/ui/src/thread/outstandingAgentRequest.ts` documents the consequence of:
*"That a given turn enqueued is recorded nowhere a later reader can find it."*

SHARED-022 chose that class deliberately (its own Q2), so a weight belongs on the
**request** and in the **queue event payload**, not written into the turn on disk.
Do not quietly promote it to a stored field to make it easier to display — that
is a different decision and it needs sign-off.

**The level vocabulary is not the contract's to define.** §7 keeps model names in
the skill, and SHARED-022 goes further: the levels offered are read from the
workspace's own guidance, so the picker and the routing move together. So the
wire carries a **level name as an opaque string**, validated for shape rather
than against an enumerated set. An enum here would freeze in the contract exactly
what the rider took pains to keep editable, and would drift the first time a
workspace edited its table.

## Acceptance Criteria

- [x] Every composer that can request the agent can carry a chosen level —
      stated once for the set, the way attachments and snippets are (§10), not
      per surface. **One field**, `requestedWeightField`
      (`schemas/weight.ts`), spelled `weight` on all five composer request
      bodies: `CreateThreadRequest`, `MultipartCreateThreadRequest`,
      `AppendTurnRequest`, `MultipartAppendTurnRequest`, `CaptureRequest`. The
      enumeration lives in the tests (`weight.test.ts`'s `it.each` over the five,
      and `openapi.test.ts`'s sweep asserting *exactly* those five bodies in the
      published document), not only in prose — SHARED-012's lesson
- [x] Absent means **the orchestrator decides**, never a default level. Closed on
      four fronts: `.optional()` with **no** `.default()`, **not** nullable,
      `min(1)` so `""` is a `400` rather than a synonym for silence, and
      `requestedWeightPayload(undefined) === {}` so the key cannot even be
      constructed onto an event as `undefined`/`null`. `openapi.test.ts` asserts
      no request body makes it required and none carries a `default`
- [x] The level reaches the queue event, since that is what the dispatch reads —
      `REQUESTED_WEIGHT_PAYLOAD_KEY` (`"weight"`, the same spelling as the
      request field), written with `requestedWeightPayload` and read with
      `readRequestedWeight`. Deliberately **event-type-agnostic**: it rides
      beside whatever payload the producing feature declares, so neither core
      payload schema grows a variant and a plugin event carries it with no
      contract change. `QueueEvent.payload`'s published description documents it
- [x] The wire does **not** enumerate the levels, and the contract says why —
      `schemas/weight.ts`'s docblock gives the three reasons in descending
      strength (§7's standing "model names live in the skill"; the levels are a
      *workspace's* vocabulary read from its own guidance; an enum would reject a
      workspace for agreeing with the document that governs it) and names the
      cost it accepts (a typo is caught by the orchestrator's unhonourable path,
      not by a list this contract must not hold). Asserted on the generated
      document: `type: "string"`, no `enum`
- [x] `openapi.json` and the typed client regenerated, not hand-edited —
      `npm run generate -w packages/contract`, idempotent across two runs (hashes
      in the log below)
- [x] The descriptions say what the field is *for* — a directive, honoured and
      never silently substituted **in either direction**, what happens when it
      cannot be honoured, and that absence means the orchestrator decides.
      Pinned by `openapi.test.ts` against the published description so a later
      edit that drops the reasoning fails a test

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/` (the agent-requesting request shapes and the
  queue event payload), plus regenerated artifacts.

### Notes

- Check whether §9.2's route inventory needs a line for the changed request
  shape. It has needed one three times on this project, was caught by review
  twice, and pre-empted once. **A SPEC edit needs user sign-off** — draft it in
  this issue and hold it rather than applying it.

### What shipped

| File | Change |
| --- | --- |
| `packages/contract/src/schemas/weight.ts` | **New.** The value schema, the request field, the payload key, and the two payload helpers — with the decision docblock |
| `packages/contract/src/schemas/weight.test.ts` | **New.** 34 tests |
| `packages/contract/src/schemas/thread.ts` | `weight` on the four thread request bodies |
| `packages/contract/src/schemas/capture.ts` | `weight` on `CaptureRequest` |
| `packages/contract/src/schemas/queue.ts` | `QueueEvent.payload` documents the cross-type `weight` key |
| `packages/contract/src/schemas/index.ts` | Export |
| `packages/contract/src/client/upload.ts` | `weight?` on the three multipart uploads; appended only when stated |
| `packages/contract/src/openapi.test.ts` | Published-document assertions (no enum, no default, never required, the five surfaces, the prose) |
| `packages/contract/openapi.json`, `src/client/schema.generated.ts` | Regenerated |

### Deliberately not done

- **`POST /api/threads/{id}/forms/{ts}/answer` does not carry a weight.** §10's
  amendment enumerates *composers*; a form answer is a reply to a question the
  agent asked inside work already dispatched, not a composer writing a new
  request, and UI-082's surface table does not list it. Whether answering may
  re-weight the continuation is a real question the rider does not answer — a
  spec question, not a contract one. The cost of deciding it later is one field,
  because the payload key is event-type-agnostic. Recorded in `weight.ts`
- **No CLI flag** — SHARED-022's Q5 leaves the CLI's writing verbs out by name
- **Nothing stored on the turn.** The issue's own instruction, and SHARED-022's
  Q2, which the user signed with the weight left request-time. Not revisited
  here; doing it needs sign-off, and `turn-model.ts` already says from its side
  why the instruction and the outcome must stay separate fields
- **No level-discovery route.** SHARED-022's chain also names "a way for a
  composer to learn what levels this workspace defines". That is not in this
  issue's acceptance criteria, and UI-082 flags it as an open design question
  (the orchestrate skill is already a projected document reachable through
  `GET /api/docs`). Left for the orchestrator to route rather than invented here

## SPEC draft — §9.2, HELD for user sign-off (not applied)

**Answer: yes, §9.2 needs a line.** The test is the inventory's own habit: it
already records the **`agent flag`** on both thread-writing routes, which is a
request-shape fact of exactly this class — an optional instruction the body
carries that changes what the agent does. A second one of the same class, which
§10 promises rides "with the request to whatever does the work", is invisible in
§9.2 today, and an evaluator reading the inventory alone would not know which
routes accept it.

**One bullet, not three clauses**, mirroring §10's own construction: the rule is
stated once for the set of composers, which is what SHARED-012 says stops a
surface being forgotten.

INSERT a new bullet **immediately after** this existing bullet (verified unique
in SPEC.md):

> - `POST /api/threads/:id/turns` — append a turn (agent flag; multipart for attachments)

the following:

> - **A request that can reach the agent may state the weight its work should be
>   done at** (§7, §10): `POST /api/threads`, `POST /api/capture` and
>   `POST /api/threads/:id/turns` each take an optional level name, in their JSON
>   and multipart forms alike. The value is a level from the **workspace's own
>   agent guidance** and is never an enumerated set on the wire — §7 keeps model
>   tiers in the skill and §2.4 lets a workspace edit it on its own schedule — so
>   it is validated for shape only and recorded verbatim, never interpreted.
>   **Omitting it means the orchestrator decides**, exactly as it does today:
>   there is no default level, and no second spelling of absence. A stated weight
>   rides onto the queue event the request enqueues, which is what the dispatch
>   reads and what the job log names (§7). _(Rider signed 2026-08-06; route line
>   added <DATE>.)_

**SIGNED by the user 2026-08-08 and APPLIED to SPEC.md §9.2.** One wording
correction was made on the way in: the draft said the routes take "an optional
level name", written before AGENT-015 declared a Key column. The applied text
says the level is named by its **key**, because the label is prose a person may
reword and a choice made yesterday must still resolve afterwards.

## Testing Strategy

Contract tests over presence, absence (meaning "orchestrator decides"), and
shape rejection; the OpenAPI drift check as usual.

## E2E Verification Log

**Implemented on: Opus 5 (1M context)** (`claude-opus-5[1m]`), as the issue
recommends.

Not a bug, so no pre-fix reproduction.

### Generation is idempotent, and the artifacts were never hand-edited

`npm run generate -w packages/contract` → exit 0. Ran again and compared:

```
IDEMPOTENT
7e5dcb7aa8018dcca5750f50c0285b0778843609  packages/contract/openapi.json
16df7f06f8d89a111fdfb5f2688c68018337aa50  packages/contract/src/client/schema.generated.ts
```

`node --import tsx scripts/check-generated-artifacts.ts` → exit 1, reporting
`openapi.json` and `schema.generated.ts` as differing from `HEAD` by
`+32 / +16` lines, and `✓ CLI reference is up to date`. That is the check working
as designed: it diffs the regenerated tree against the **committed** one, so an
uncommitted regeneration necessarily reads as stale. The check is what CI runs
after the commit; the evidence that nothing was hand-edited is the idempotence
above plus the fact that the whole diff is the five `weight` properties and the
`QueueEvent.payload` description.

### The published shape is what was intended

Walked `openapi.json` and printed the property from every request body that
carries it:

```
POST /api/capture (multipart/form-data)
   type="string" maxLength=100 minLength=1 enum=undefined default=undefined required=false
POST /api/threads (application/json)
   type="string" maxLength=100 minLength=1 enum=undefined default=undefined required=false
POST /api/threads (multipart/form-data)
   type="string" maxLength=100 minLength=1 enum=undefined default=undefined required=false
POST /api/threads/{id}/turns (application/json)
   type="string" maxLength=100 minLength=1 enum=undefined default=undefined required=false
POST /api/threads/{id}/turns (multipart/form-data)
   type="string" maxLength=100 minLength=1 enum=undefined default=undefined required=false
QueueEvent.payload mentions weight: true
```

Five bodies, no more and no fewer; **no `enum`**, **no `default`**, **never
required**. The generated client agrees — `weight?: string` at five sites in
`schema.generated.ts`.

### The whole journey, over real HTTP

A scratch Hono app (port **8791** — never 8765 or 5173) mounting the contract's
own definitions with `mountCreateThread` / `mountAppendTurn` /
`app.openapi(contractRoutes.capture)`, driven by the **shipped** clients
(`createCorpusClient().api` for JSON, `uploadTurn` / `uploadCreateThread` /
`uploadCapture` for multipart), with each handler building its event payload
through `requestedWeightPayload` — i.e. exactly the seam SERVER-069 will fill.
Scratch file deleted after the run; port confirmed free afterwards.

```
1  JSON turn, weight stated  → payload: {"threadId":"th_x9y8","parentId":null,"weight":"Heavy or judgment-laden"}
1  readRequestedWeight: "Heavy or judgment-laden"
2  JSON turn, nothing stated → payload: {"threadId":"th_x9y8","parentId":null}
2  key present at all: false
2  readRequestedWeight: undefined
3  JSON Ask, weight stated   → payload: {"threadId":"th_x9y8","parentId":null,"weight":"quick"}
4  multipart turn            → payload: {"threadId":"th_x9y8","parentId":null,"weight":"deep"}
5  multipart Ask             → payload: {"threadId":"th_x9y8","parentId":null,"weight":"réfléchi"}
6  capture                   → payload: {"threadId":"th_cap1","parentId":"doc_cap1","weight":"Small and mechanical"}
7  capture, nothing stated   → payload: {"threadId":"th_cap1","parentId":"doc_cap1"}
8  invented level            → payload: {"threadId":"th_x9y8","parentId":null,"weight":"ponderous-mk2"}
10 note-only + weight        → status: 201
11 from a JSON event file: "Heavy or judgment-laden"
12 hand-edited weight=2: undefined
```

Reading the numbered lines against the acceptance criteria:

- **1, 3–6** — all five composer surfaces carry it, JSON and multipart alike,
  and a level with an accent survives the multipart round trip unmangled.
- **2, 7** — absence is absence. The key is not merely `undefined`, it is
  **not present** (`Object.hasOwn` → `false`), so `JSON.stringify` cannot turn
  it into a `null` on the way to `.corpus/queue/`.
- **8** — `ponderous-mk2` is a level no shipped guidance defines. It type-checks
  (the field is a string) and the wire takes it, which is the whole point of not
  publishing an enum: a workspace that renames its levels is not rejected by its
  own server.
- **10** — a weight beside an explicit `requestsAgent: false` is a `201`, not a
  `400`. §8 alone decides what reaches the agent; a weight there is inert, not
  invalid.
- **11, 12** — the value survives a real JSON round trip off "disk", and a
  payload no server of ours wrote (`weight: 2`) reads as *no weight* rather than
  throwing — the state that means "the orchestrator decides", which is the only
  reading that cannot run work at something nobody asked for.

Shape rejections, same run, real `400`s from the route's own validation:

```
9  weight=""                    → 400  "Too small: expected string to have >=1 characters" + "must not be blank"
9  weight="  "                  → 400  "must not be blank"
9  weight="deep\ndispatched at:…"→ 400  "must be a single line: it is recorded verbatim in a queue event and a job log line"
9  weight="xxx…"(101 chars)     → 400  "Too big: expected string to have <=100 characters"
```

The blank cases are the ones that matter: an untouched picker submitting an
empty part is a `400`, never a second spelling of "no choice".

### Checks

| Command | Result |
| --- | --- |
| `npm run build` | exit 0 |
| `vitest run packages/contract` (`VITEST_MAX_THREADS=4`) | **58 files, 2187 tests, all passing** |
| `vitest run packages/contract/src/schemas/weight.test.ts` | 34 tests passing |
| `vitest run packages/contract/src/openapi.test.ts` | 338 tests passing |
| `npx eslint` over the 8 touched files | No issues found |
| `npx tsc --noEmit` in `packages/contract` | exit 0 |
| `npm run typecheck -w apps/ui -w packages/kit` | exit 0 (consumers unaffected) |
| `npx prettier --check` over touched + generated files | All formatted correctly |

### Self-review

- The `exactOptionalPropertyTypes` asymmetry recorded in this domain's notes
  applies as usual — Zod infers `weight?: string \| undefined`, the generated
  client emits `weight?: string`. Nothing assigns one to the other; the repo-wide
  build and both consumer typechecks are clean.
- CONTRACT-017 holds: the four bodies touched are still `z.strictObject`, and
  `openapi.test.ts`'s `additionalProperties: false` sweep still passes over ≥15
  bodies.
- CONTRACT-003 holds: the field is optional-in with no `.default()`, so
  `openapi-typescript` does not promote it to required — asserted directly.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
