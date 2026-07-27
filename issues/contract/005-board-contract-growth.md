# [CONTRACT-005] Board contract growth: query-key vocabulary, DocRow staleness + thread fields

## Domain

contract

## Status

in_progress

## Priority

P1

## Model

opus — additive schema growth with shapes pinned by SPEC §9.2/§11 and the sprint-004 findings; no open design questions.

## Dependencies

- Depends on: CONTRACT-002
- Blocks: UI-002 (query-key vocabulary), UI-003/UI-004 (DocRow fields), SERVER-006 (turn-append mounting helper)

## Spec References

- SPEC.md §11 — staleness ramp, thread-row affordances, board columns
- SPEC.md §9.2 — collection query row content
- `issues/sprints/sprint-004.md` — Open Conflicts 2 and 7 (discovery record)

## Summary

Two gaps found while sprint-004 pinned SERVER-007/011 to the shipped contract: (1) the SSE query-key **vocabulary** (which key arrays exist, what invalidates what) lives nowhere in the contract, so UI-002 would mirror it by hand and drift; (2) `DocRowSchema` carries no staleness tier and no thread-specific fields (agent participation, awaiting/unread affordances), which UI-003/004's rows and the staleness ramp need — SERVER-011 was adjudicated to implement the contract exactly, so the fields must arrive here before the UI consumes them.

## Acceptance Criteria

- [x] The query-key vocabulary is published in the contract (schemas/sse.ts): the closed set of key shapes (e.g. `["docs"]`, `["docs", {filter-hash}]`, `["doc", id]`, `["thread", id]`, `["tree"]`, `["queue"]`, `["jobs"]`, `["job-log", id]` — derive the actual set from SPEC §11's refetch surfaces and SERVER-007's emitter), each with a description of what emits it and what should refetch on it; exported constants/helpers so server emitter and UI bridge share one source.
- [x] `DocRowSchema` gains the §11 fields: staleness tier (the enum the staleness ramp renders), and for thread rows the agent-participation state and unread/awaiting affordances — nullable/absent for non-thread rows, consistent with the "thread filters no-op on non-threads" convention.
- [x] SERVER-011's projection query can populate every new field from existing tables (verify against the shipped schema; if a field needs data the projection lacks, flag it instead of inventing).
- [x] **Turn-append mounting helper** _(CONTRACT-004 escalation, 2026-07-27)_: `@hono/zod-openapi` registers hard validators for every media type when `required: true`, so the dual-media `POST /api/threads/{id}/turns` body ships as a tested `RULE_EXEMPTIONS` entry (bare call compiles). Provide a contract-owned mounting helper that keeps `required: true` in the document while dispatching validation by content-type itself, remove the exemption, and land before SERVER-006 creates call sites.
- [x] **Nullable timestamps decision** _(SERVER-011 handoff, 2026-07-27)_: `documents.created/updated` are legitimately null (hand-written skill files) but `DocRow` declares both non-nullable — the server currently serializes an epoch sentinel and staleness treats unknown age as fresh. Decide: make the row fields nullable (UI renders "—") or bless the sentinel; either way document it in the schema description.
- [x] All standing invariants hold (400/401, no request defaults, explicit required, component purity); artifacts regenerated, byte-deterministic, drift green.
- [x] Round-trip tests for changed schemas; the vocabulary constants have a test pinning the closed set.

## Sprint-005 Adjudications (binding, 2026-07-27)

Orchestrator decisions — full reasoning in `issues/sprints/sprint-005.md`:

1. **Rider: the §14 `warnings` carrier** — response-side field (e.g. on mutation responses) for validation warnings; additive, no new routes/request bodies, every pinned invariant holds. This issue now hard-blocks SERVER-005's warning ACs — it merges FIRST in the sprint.
2. **The key vocabulary is the emitted nine-shape set** recorded in SERVER-007's E2E log — including both lock keys (`["locks"]`, `["locks",docId]`); the issue's earlier example list is superseded.
3. **DocRow growth breaks merged SERVER-011** (nullable fields it doesn't populate red the server typecheck): SERVER-015 is filed to populate them and merges together with this issue — expect the orchestrator to gate the combined harvest.

## Technical Design

### Files to Create/Modify

_As implemented (the vocabulary moved out of `schemas/` so a browser consumer can import the key
names without bundling Zod — the same constraint that put `ACTOR_HEADER`/`ACTORS` in `src/actor.ts`):_

- `packages/contract/src/query-keys.ts` **(new)** — the closed vocabulary, Zod-free, zero imports
- `packages/contract/src/schemas/sse.ts` — imports the published `QueryKey` type; adds `parseQueryKey`, which pins the two together
- `packages/contract/src/routes/events.ts` — renders the vocabulary into the `GET /events` description, so it reaches `openapi.json`
- `packages/contract/src/schemas/query.ts` — `DocRow` staleness tier + thread affordances
- `packages/contract/src/schemas/doc.ts` — nullable row timestamps; `DocMutationResponse`; `warnings` on update/delete
- `packages/contract/src/schemas/warning.ts` **(new)** — the §14 warnings carrier
- `packages/contract/src/routes/turn-append.ts` **(new)** — the dual-media route definition + `mountAppendTurn`
- `packages/contract/src/routes/threads.ts` — `appendTurn` moved out to its mounting module
- `packages/contract/src/routes/docs.ts` — doc mutations return `DocMutationResponse`
- `packages/contract/src/client/index.ts` — re-exports the vocabulary on the client surface
- `packages/contract/src/openapi.test.ts` — `RULE_EXEMPTIONS` emptied (guard test updated, not deleted)
- Colocated tests + regenerated `openapi.json` / `schema.generated.ts`

## Testing Strategy

Round-trips, vocabulary closed-set pin, invariant suite stays green, consumer typecheck across workspaces.

## E2E Verification Plan

### Verification Steps

1. Regenerate twice — byte-identical; drift green.
2. Repo-wide typecheck; SERVER-011's routes still mount (its handlers may need to populate the new fields — coordinate via report, don't edit apps/server).

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Reproduction (bugs only)

_N/A — additive growth._

### Post-Implementation Verification

**implemented on: opus.** Worktree `.claude/worktrees/contract-005`. Scratch probes under
`/tmp/corpus-c005-wLc0TH`. No server bound (CONTRACT-005 needs none, per sprint-005).

#### Decisions taken, and where they are written down

| Decision                    | Answer                                                                                                                                                                                     | Recorded in                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Nullable timestamps (AC 4)  | **Nullable.** `DocRow.created`/`updated` become `IsoDateTime \| null`; the epoch sentinel is rejected. `DocFrontmatter` stays non-nullable — a document the server writes is always stamped. | `schemas/doc.ts` — `UNDATED_DESCRIPTION` + block note |
| Staleness representation    | **Nullable tier**, no `fresh` member: `null` is fresh, which is why `stale=` takes a tier and never `fresh`.                                                                                | `schemas/query.ts` — `DocRowSchema.stale` description |
| Thread affordances          | **Nullable, not optional** — the key is always present; `null` means "not a thread".                                                                                                        | `schemas/query.ts` — `threadRowShape` block note      |
| §14 warnings codes          | Four: `commit_failed`, `commit_skipped` (the auto-commit half) **plus** `orphaned_anchor`, `unresolved_ref` (§14's validation half, which the sprint recommendation did not enumerate).      | `schemas/warning.ts`                                  |

#### 1. Vocabulary — published, closed, Zod-free (TEST-100…104)

`src/query-keys.ts` publishes the nine emitted shapes as constants + helpers with the same
names `apps/server/src/events/keys.ts` already uses (`DOCS_KEY`, `TREE_KEY`, `QUEUE_KEY`,
`JOBS_KEY`, `LOCKS_KEY`, `docKey`, `threadKey`, `jobKey`, `lockKey`), plus
`QUERY_KEY_VOCABULARY` carrying each shape's emitter and consumer.

The module imports nothing — verified on the built output, not the source:

```
$ grep -c "^import\|require(" packages/contract/dist/query-keys.js
0
$ grep -n "^import" packages/contract/dist/query-keys.d.ts
(none)
```

Vocabulary reaches `openapi.json` through the `GET /events` description (no new component, so
the component-purity and inventory invariants are untouched):

```
$ node -e "console.log(require('./packages/contract/openapi.json').paths['/events'].get.description)"
… The key vocabulary is **closed** — these nine shapes and no others. …
- `["docs"]` — emitted by every document or thread mutation … Refetch: `GET /api/docs` …
- `["docs", "<docId|threadId>"]` — … - `["tree"]` — … - `["threads", "<threadId>"]` — …
- `["queue"]` — … - `["jobs"]` — … - `["jobs", "<eventId>"]` — …
- `["locks"]` — … - `["locks", "<docId>"]` — …
```

Scratch probe importing **only** the vocabulary from the client surface (`tsc`, strict,
`skipLibCheck`, `types: []`):

```
$ cd /tmp/corpus-c005-wLc0TH && npx tsc -p tsconfig.json
PROBE-A (vocabulary import) EXIT=0
```

#### 2. `DocRow` growth (TEST-105…108)

New fields, all nullable: `stale`, `parent`, `agent`, `anchorQuote`, `turnCount`, `lastAuthor`,
`lastTurn`, `unread`, `awaitingAgent`; plus `created`/`updated` made nullable.

Every one traces to a shipped projection column (AC 3 — nothing invented):

| Field           | Source in the shipped projection                                                        |
| --------------- | --------------------------------------------------------------------------------------- |
| `stale`         | `documents.updated` / `documents.reviewed` / `documents.evergreen` via `docs/staleness.ts` (`ACTIVITY_SQL`, `stalenessCutoffs`) |
| `parent`        | `threads.parent_id`                                                                     |
| `agent`         | `threads.agent`                                                                         |
| `anchorQuote`   | `anchors.exact_text`, joined on `(threads.parent_id, threads.anchor_id)`                 |
| `turnCount`     | `threads.turn_count`                                                                    |
| `lastAuthor`    | `threads.last_author`                                                                   |
| `lastTurn`      | `turns.body_md` of the row with `threads.last_ts` (the only field needing the `turns` join) |
| `unread`        | `seen.last_seen_ts` against `threads.last_ts` — the existing `UNREAD_SQL` in `docs/needs.ts` |
| `awaitingAgent` | `threads.agent <> 'none' AND threads.last_author = 'user' AND threads.status = 'open'`   |

Consumer probe over the generated client — every new field, the warnings carrier and a
well-formed turn append (`/tmp/corpus-c005-wLc0TH/src/consumer.ts`):

```
$ npx tsc -p tsconfig.json
PROBE-C (consumer view) EXIT=0
```

#### 3. Turn-append mounting helper (TEST-109…112)

`src/routes/turn-append.ts` owns the route **and** its mounting. `createAppendTurnRoute(required)`
builds the published route with `required: true` and a runtime twin with `required: false`; the
factory parameter is what makes both share one type, so `mountAppendTurn` needs no cast.
`mountAppendTurn` mounts the twin (buying the library's content-type dispatch), rejects a request
declaring neither media type with the contract's own `400`, and points both validation targets at
the body that actually arrived so a handler reading either sees the real turn.

Generated document (TEST-109):

```
$ node -e "const b=require('./packages/contract/openapi.json').paths['/api/threads/{id}/turns'].post.requestBody; console.log(b.required, Object.keys(b.content))"
true [ 'application/json', 'multipart/form-data' ]
```

Both forms validate, dispatched by content-type; the two invalid forms are `400` with `issues`;
a bodiless call is `400` — 25 tests in `src/routes/turn-append.test.ts`, all passing.

**Before/after on the bare call (TEST-111).** The pre-fix state was reconstructed by taking the
regenerated document, flipping that one `required` back to `false`, and running the real
`openapi-typescript` over it:

```
$ node -e "…d.paths['/api/threads/{id}/turns'].post.requestBody.required=false…"
$ npx openapi-typescript openapi.before.json -o src/schema.before.ts
$ npx tsc -p tsconfig.json      # api.POST("/api/threads/{id}/turns", { params: … }) — no body
BEFORE-STATE EXIT=0             # the bare call compiled: the defect CONTRACT-004 escalated
```

```
$ cd /tmp/corpus-c005-wLc0TH/bare && npx tsc -p tsconfig.json
src/bare-call.ts(7,64): error TS2345: … Property 'body' is missing in type
  '{ params: { path: { id: string; }; }; }' but required in type
  '{ body: ({ body: string; requestsAgent?: boolean; } & {}) | ({ text?: string; … files?: string[]; } & {}); }'
BARE-CALL EXIT=2                # closed
```

**TEST-112.** `RULE_EXEMPTIONS` in `openapi.test.ts` is now `{}`; the guard test was *updated*, not
deleted — renamed "earns no exemption from the rule at all", asserting `Object.keys(...)` is `[]`
and carrying the note about why the one exemption it held is gone. The required-body rule test
covers the route with no filter, and the partition map records `"POST /api/threads/{id}/turns": true`.
`client/request-body-required.test.ts` flips the same route's compile-time probe to `true`.

_(Sprint-authorized deferral: `DEFERRED → SERVER-006` for a real product call site — no server
handler for `POST /api/threads/{id}/turns` exists yet. The authorized substitute — the contract's
own mounted-stub tests plus `tsc` probes — is what is recorded above.)_

#### 4. §14 warnings carrier (sprint-005 rider)

`schemas/warning.ts` adds `Warning {code, detail}` and the always-present `warnings` array.
`DocMutationResponse {doc, warnings}` now backs create/move/archive/unarchive;
`UpdateDocResponse` and `DeleteDocResult` gain `warnings`. **No routes and no request bodies were
added** — the endpoint inventory is unchanged and `openapi.test.ts` still pins the request-body
count at 11, both green.

#### 5. Artifacts: idempotent, drift-clean (TEST-114)

```
$ npm run generate -w packages/contract   # twice, diffing between runs
IDEMPOTENT: both artifacts byte-identical across two runs
c4db1841b02bde94dbff7918a72e53de5d5000bc95bc38cf0314a762016b4f06  packages/contract/openapi.json
9e9214a305237bf48c3c764bc5c2b7b54baecc0866096bb61a9326a42f2f2a07  packages/contract/src/client/schema.generated.ts
```

`scripts/check-generated-artifacts.ts` reports the **content-hash half green** (regeneration is a
no-op) and fails only its `git diff HEAD` half, because this work is deliberately uncommitted —
domain agents never commit. Proved separately:

```
$ H1=$(shasum -a 256 <artifacts>); npm run --silent generate -w packages/contract; H2=$(shasum -a 256 <artifacts>)
CONTENT-HASH DRIFT CHECK: GREEN (regeneration is a no-op)
```

#### 6. Gate results

| Gate                                     | Result                                                             |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `npx vitest run packages/contract`        | **681 passed / 30 files** (was 626; +55)                           |
| Coverage (contract, v8)                   | **100 % stmts / 99.06 % branch / 100 % funcs / 100 % lines**        |
| `npm run typecheck -w packages/contract`  | pass                                                               |
| `npm run lint` (repo)                     | pass                                                               |
| `npm run format:check` (repo)             | pass                                                               |
| `npm run build` (repo)                    | pass                                                               |
| `npm run typecheck` (repo-wide)           | **fails in `apps/server` only** — expected, see below              |
| `packages/kit`, `apps/cli`, `apps/ui` tsc | pass (EXIT=0 each)                                                 |

#### 7. The expected server red (Open Conflict 9 → SERVER-015)

Exactly one error, repo-wide:

```
apps/server/src/docs/query.ts(312,3): error TS2740: Type '{ id: string; … excerpt: string; }'
  is missing the following properties from type '{ attention: …; snippets: …; … 20 more …;
  excerpt: string; }': parent, agent, anchorQuote, turnCount, and 5 more.
```

That is `toDocRow` in `queryDocs`. The nine missing fields are `stale`, `parent`, `agent`,
`anchorQuote`, `turnCount`, `lastAuthor`, `lastTurn`, `unread`, `awaitingAgent`.

Four `apps/server` tests fail for the same reason (they validate rows against `DocRowSchema`):
`src/docs/query.test.ts` — "the envelope emits rows the contract can parse, with no extra keys";
`src/docs/routes.test.ts` — "answers a contract-shaped list", "composes filters from the query
string", "ignores an unknown parameter name rather than rejecting it".

**Note for SERVER-015, because the compiler cannot flag it:** the nullable-timestamp decision is
*not* a type error on the producer side — `UNDATED_INSTANT` still satisfies `string | null`. The
epoch sentinel must be deleted deliberately: `toDocRow` should emit `row.created`/`row.updated`
directly (already `string | null` off the projection) and `UNDATED_INSTANT` should go with it.

### Addendum — `DocFrontmatter` timestamps made nullable too (SERVER-005 escalation, 2026-07-27)

**implemented on: opus.** Main tree, branch `phase-2-server-cli`. Real server E2E at
`/tmp/corpus-e2e-nullts` (torn down after).

**The defect.** This issue's own decision table said "`DocFrontmatter` stays non-nullable — a
document the server writes is always stamped". That reasoning only covers documents the server
writes. SPEC.md §7's hand-written `SKILL.md` is not one: it carries no frontmatter timestamps, the
projection stores NULL, and `GET /api/docs` duly reported `null` — while `GET /api/docs/{id}`,
bound by the non-nullable `DocFrontmatter`, substituted an epoch sentinel. **The same file read two
different ages depending on which route you asked.** SERVER-005 escalated it rather than papering
over it; `apps/server/src/docs/read.ts` carried a `UNDATED_INSTANT` constant whose comment named
this exact contract change as the fix.

**The change.** `DocFrontmatterSchema.created`/`updated` are now
`IsoDateTimeSchema.nullable()` carrying the *same* `UNDATED_DESCRIPTION(...)` text as
`docRowBaseShape` — one helper, hoisted above both, so the two response-side shapes cannot drift
apart again. Both keys stay **required** (nullable, never optional); the block comment now says
the rule applies to both response shapes and explicitly disclaims the server's file-parsing
schemas.

**Blast radius, checked honestly.**

| Surface                                        | Effect                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `DocFrontmatter` (get-one + mutation responses) | widened to `string \| null` — the fix                                        |
| `apps/server/src/core/frontmatter.ts` (`FileFrontmatterSchema`, `FileThreadFrontmatterSchema`) | **untouched.** Parse-side/file-side, a different schema; not this contract |
| `apps/server/src/docs/read.ts`                  | local `UNDATED_INSTANT` sentinel **deleted** (the escalation's predicted trivial edit, cross-domain blessed); `wireFrontmatter` passes `null` through |
| Repo-wide typecheck                             | **no `apps/server` breakage.** Widening a response type is not a producer-side error; the sentinel had to be removed deliberately, exactly as this issue's §7 note warned |
| Endpoint / request-body inventory               | unchanged — response-side only, no new components                            |

**Tests.** `schemas/doc.test.ts` +6: undated round-trip, malformed timestamp still rejected,
key still required, both fields' descriptions carry the em-dash/unknown-age-is-fresh wording, and
a pin asserting each description is **identical** to the corresponding `docRowBaseShape` one — the
regression that let the two shapes disagree. `apps/server/src/docs/read.test.ts`: the sentinel
assertion becomes `toBeNull()`, plus a new cross-route agreement test reading one undated skill
through `GET /api/docs` and `GET /api/docs/{id}`.

**Artifacts.** Regenerated twice, byte-identical; content-hash drift check green.

```
$ npm run generate -w packages/contract   # twice, hashes compared
CONTENT-HASH DRIFT CHECK: GREEN (regeneration is a no-op)
111a7d6bdfb8446b5639c2d55598a1cf3c609eb85923e35df4a0ab88879997bc  packages/contract/openapi.json
2d6e44efb178d3a1e18f52c035ea919df4cb5790b2e47806bbb0dbfb738d32d8  packages/contract/src/client/schema.generated.ts

$ node -e "…components.schemas.DocFrontmatter…"
created: { type: ["string","null"], format: "date-time", … }
required includes created/updated: true true      # nullable, still required

$ grep -A2 'DocFrontmatter: {' src/client/schema.generated.ts
created: string | null;
```

**E2E — real server, both routes (the escalation's acceptance test).** `corpus init` →
hand-written `.claude/skills/handwritten/SKILL.md` with no timestamps → `corpus server start` →
both responses validated against the *published* `DocListSchema` / `DocSchema`:

```
LIST  row        : {"id":"doc_skill07d757a3","created":null,"updated":null,"stale":null}
GET   frontmatter: {"created":null,"updated":null}
AGREE            : true
BOTH NULL        : true
NO REGRESSION    : {"createResponse":"2026-07-27T07:00:39Z","getOne":"2026-07-27T07:00:39Z",
                    "listRow":"2026-07-27T07:00:39Z","allNonNullAndEqual":true}
```

The last line is the guard against over-correcting: a server-*created* document still carries real
timestamps, identical across the create response, the single read and the list row.

**Gate:** `npm test` 2716 passed / 154 files · `npm run typecheck` (repo-wide) pass ·
`npm run lint` pass · `npm run format:check` pass · `npm run build` pass ·
`npx vitest run packages/contract` 688 passed.

**Incidental observation, not fixed (out of scope, flagged for the orchestrator).** During the E2E
a `POST /api/docs {"type":"note","title":"…"}` came back with `evergreen: true`. The seed
`data/docs/templates/note.md` carries `evergreen: true` in *its own* frontmatter, and the
template pre-fill appears to copy that field onto the new document — so every templated note opts
itself out of staleness, contradicting `CreateDocRequest`'s documented `false` default. That is a
server/agent-runtime concern (template frontmatter should not bleed into the instance), not a
contract one.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[CONTRACT-005]` prefix
