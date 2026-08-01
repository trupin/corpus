# [SERVER-046] Index status/rebuild endpoints; rebuild queueing; doctor drift-vs-staleness

## Domain
server

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SERVER-044, CONTRACT-023
- Blocks: CLI-020

## Spec References
- SPEC.md §9.1 verbs bullet (SHARED-006 Edit 6), §9.2 index bullet (Edit 10), §14 doctor bullet (Edit 13), §2.2 rule 1 (Edit 2)

## Summary
Wire Phase B's operational surface:
- `GET /api/index/status` from SERVER-044's counters + recorded identity + rebuild flag.
- `POST /api/index/rebuild`: discard vectors/marks, re-pick the current default
  identity (the one place stickiness resets), queue everything, return immediately.
- `db rebuild` (existing) queues semantic re-indexing after its synchronous work.
- `db doctor` extends per the signed drift-vs-staleness rule: FAIL on drift (chunk
  rows not matching files, mixed identity), stay clean on pending-only; `rebuild &&
  doctor` clean immediately, embeddings still draining.

## Acceptance Criteria
- [x] Status counts live and accurate under a draining worker; rebuild is fire-and-forget and observable
- [x] `index rebuild` re-picks identity; `db rebuild` keeps identity and queues re-index
- [x] Doctor: seeded drift fixture fails with a named reason; pending-only workspace passes; mixed-identity fixture fails
- [x] `rebuild && doctor` green while pending > 0 (the invariant test)

## Technical Design
### Files to Create/Modify
- `apps/server/src/index/routes.ts` (new), `apps/server/src/projection/` doctor pass extension, rebuild hook

## Testing Strategy
apps/server scoped: endpoint tests over stubbed worker state; doctor fixture matrix.

## E2E Verification Plan
Real server: `curl` status mid-drain; `POST rebuild` then watch counts reset and drain; `corpus db doctor` (existing CLI) clean while pending.

## E2E Verification Log

**implemented on: opus** (Opus 5, 1M context). Port `8804` (orchestrator's assignment, superseding
the sprint table's 8808); a slow OpenAI-shaped embedding endpoint on `8805`. `8765` never touched.
Workspace: `~/.claude/jobs/4dd0ddef/tmp/s021-server/046-e2e`, `corpus init` + 200 seeded
three-section documents (209 documents, **660 distinct chunks**). Every procedure below began with
`corpus db rebuild` (the sprint's rebuild-first rule, C1).

### Two wire questions answered (SERVER-043's hand-off)

**(1) A configured-but-broken provider (`resolution.kind === "error"`).** The `state` word is
`disabled`, and it is forced twice over — by the published mapping (`disabled` = "no provider
resolved", `semantic/state.ts`, which this issue consumes and never re-derives) and by the invariant
that `GET /api/index/status`.`state` and `/api/search`.`semanticIndex` are one value from one schema.
What must not happen is the **bare** rendering. Status never zeroes what it knows, so the answer is
distinguishable from a fresh workspace's `disabled / null / 0`, and the error's human detail is
carried by `db doctor`'s report-only warning (open kind space — no contract edit):

```
$ curl .../api/index/status          # endpoint http://127.0.0.1:9/v1/embeddings, index intact
{"indexed":660,"pending":0,"failed":0,"identity":"local/all-MiniLM-L6-v2@384",
 "rebuilding":false,"state":"disabled"}

$ corpus db doctor
semantic_index_unusable (no file): the semantic index holds vectors from local/all-MiniLM-L6-v2@384
  and nothing can embed right now: openai endpoint http://127.0.0.1:9/v1/embeddings is unreachable:
  fetch failed. The vectors are untouched and still valid — search is lexical until an embedding
  provider is available again (`corpus index status`)
projection is clean — 209 documents from 209 files (11ms)          exit=0
```

Read: *the index is here, complete, under this identity, and nothing can use it right now.* A fresh
workspace answers `{indexed:0, pending:660, identity:null, state:"disabled"}` — a different sentence.
No field was invented and no field was lied in; the api key never reached a log line.

**(2) `sticky-model-unavailable`.** Same word, `disabled`, for the same reason (nothing resolved),
and the counts are what make it honest: `pending` stays **0** and `indexed` still reports every
vector, because stickiness discarded nothing. It is explicitly **not** drift — see the doctor matrix.

### The operational loop on a real server

```
POST /api/index/rebuild -> 202 in 40ms
  body: {"indexed":0,"pending":660,"failed":0,"identity":null,"rebuilding":true,"state":"indexing"}
  +  302ms {"indexed":16,"pending":644,...,"identity":"openai/slow-fixture@8","rebuilding":true,"state":"indexing"}
  +  469ms {"indexed":32,"pending":628,...}
  +  721ms {"indexed":48,"pending":612,...}
  +  974ms {"indexed":52,"pending":608,...}
  + 1227ms {"indexed":68,"pending":592,...}
  + 1479ms {"indexed":84,"pending":576,...}
  + 1731ms {"indexed":100,"pending":560,...}
  + 1983ms {"indexed":116,"pending":544,...}
  + 2234ms {"indexed":132,"pending":528,...}
doctor WHILE pending > 0: {"pending":644,"state":"indexing","ok":true,"drift":[],"warnings":[]}
... {"indexed":660,"pending":0,"failed":0,"identity":"openai/slow-fixture@8","rebuilding":false,"state":"current"}
```

`indexed + pending + failed === 660` at every observation; monotone; `rebuilding` true and `state`
`indexing` throughout (OC4: `indexing` outranks `stale`); the identity **re-picked as it goes**, from
`local/all-MiniLM-L6-v2@384` to the configured `openai/slow-fixture@8`. The `202` is 40 ms against a
2.3 s drain — and the verb is synchronous in code, so it cannot have waited on anything.

### The invariant (TEST-901), twice

```
$ corpus db rebuild && corpus db doctor        # 660 chunks pending, nothing able to embed
rebuilt the projection in 65ms — 209 documents, …
projection is clean — 209 documents from 209 files (8ms)           exit=0
$ curl .../api/index/status
{"indexed":0,"pending":660,"failed":0,"identity":null,"rebuilding":false,"state":"disabled"}
```

and again mid-drain, in-process, at `pending: 644` — `ok:true, drift:[], warnings:[]` (above).

### `db rebuild` keeps the identity and queues nothing (TEST-900 / OC5)

```
$ corpus db rebuild            # unchanged corpus
rebuilt the projection in 64ms — 209 documents, …
{"indexed":660,"pending":0,"failed":0,"identity":"local/all-MiniLM-L6-v2@384","rebuilding":false,"state":"current"}
```

`pending: 0` — the ATTACH-copy re-attached every embedding by content-addressed chunk id. Asserted,
not rebuilt.

### Doctor matrix (all seeded with `sqlite3` against the live `cache.db`)

| Fixture | Verdict | Reported |
| --- | --- | --- |
| clean, fully indexed | **exit 0** | `projection is clean — 209 documents from 209 files (16ms)` |
| pending-only (660 queued, nothing embedding) | **exit 0** | no drift, no warnings |
| index intact, nothing can embed (sticky/broken) | **exit 0** | warning `semantic_index_unusable` |
| mixed identity (440 + 220) | **exit 6** | `count_mismatch … more than one model: local/all-MiniLM-L6-v2@384, local/some-other-model@768` |
| **all vectors foreign** (SERVER-044's blindness) | **exit 6** | `count_mismatch … every vector … produced by local/all-MiniLM-L6-v2@768, and the effective model is local/all-MiniLM-L6-v2@384` — status showed the blindness first: `{"indexed":660,"pending":0,…,"state":"disabled"}` |
| chunk id tampered | **exit 6** | `content_mismatch data/docs/note-01.md: chunk doc_note01#0 is recorded as chunk_tampered_by_hand but its chunk_search row says b3d699cf…` |
| chunk heading path tampered | **exit 6** | `content_mismatch data/docs/note-02.md: … recorded under "Somewhere Else" but its chunk_search row says "Ledger"` |
| document row deleted, chunks left | **exit 6** | `orphan_row … 3 chunk row(s) are addressed to document doc_note03` (+ `missing_row` for the file) |
| after `corpus db rebuild` | **exit 0** | every fixture healed |

Auth: `GET /api/index/status` → **401**, `POST /api/index/rebuild` → **401** without the bearer token
(`app.use("/api/*")` covers both by mounting). State agreement, same instant:
`status.state == "current"` and `/api/search?q=harbour` → `semanticIndex: "current"`.

### TEST-906 — the drift-kind decision, stated

**No new `DriftKind`, no contract change** (OC6). Chunk-content and heading-path disagreement reuse
`content_mismatch`; identity drift (mixed *and* foreign) reuses `count_mismatch`, the kind whose
published meaning is "a table the projection keeps no per-item detail for disagrees"; a chunk row
addressed to a vanished document reuses `orphan_row`. `/usr/bin/grep -n "DRIFT_KINDS"
packages/contract/src/schemas/db.ts` is unchanged. Two **warning** kinds are new and server-only —
`semantic_index_failed` (OC9) and `semantic_index_unusable` — which the contract explicitly permits:
`DoctorWarningKindSchema` is an open lowercase snake_case token, "precisely so a new report-only pass
is a server change rather than a contract release".

### Deferred / not executed

- **`failed > 0` on a real server** — `DEFERRED → the retry ladder reaches `failed` only after
  `MAX_CHUNK_FAILURES = 5` rungs (1 s + 5 s + 30 s + 120 s + 600 s), so a live fixture costs
  ~12 minutes of wall clock. Same reason SERVER-044 deferred its own. Substitute evidence: the
  warning is asserted in `semantic-integrity.test.ts` ("stays clean, with a warning, when chunks have
  permanently failed" — `ok: true`, `warnings: ["semantic_index_failed"]`) and the re-queue is
  asserted in `maintenance.test.ts` ("re-queues chunks that had given up").
- **A mid-drain observation against the *embedded* engine** — `DEFERRED → the in-process engine
  starves the event loop`, see the finding below. Substituted with the configured-provider drain
  above, which is real HTTP and yields normally.

### Finding for the orchestrator (NOT this issue's to fix)

**The embedded engine's drain blocks the whole server.** Measured on the real server, `POST
/api/index/rebuild` over 660 chunks with the local MiniLM engine:

```
rebuild -> 202 in 41ms
GET /api/health -> 200 in 13844ms      (during the drain; touches nothing)
GET /api/index/status -> 200 in 2ms    (after it)
```

`/api/health` takes no lock, reads no database and knows nothing about the semantic index, so this is
event-loop starvation: the engine's inference is synchronous and its `await`s resolve as microtasks,
which never yield to the I/O phase. Consequences: `GET /api/index/status` cannot be observed live
during an embedded-engine drain (this issue's TEST-896 was therefore run against a configured HTTP
provider), and — more seriously — SPEC.md §9.1's "**no save ever waits on indexing**" does not hold in
practice for a large backlog: a `PUT /api/docs/{id}` issued during that window waits the same 13.8 s.
It is pre-existing (SERVER-044's worker + SERVER-048's engine), it is invisible to every unit test
because they all stub the provider, and it wants its own issue.

### Suites

```
apps/server/src/semantic/maintenance.test.ts          13 tests, pass   (new)
apps/server/src/semantic/routes.test.ts                6 tests, pass   (new)
apps/server/src/projection/semantic-integrity.test.ts 15 tests, pass   (new)
apps/server (whole workspace, one run)   160 files, 3044 passed
eslint / prettier / tsc --noEmit (server + cli)  clean
```

Note for the next agent: `npm run typecheck` in this repo goes through the `rtk` proxy and printed
"TypeScript compilation completed" over two real `TS2322` errors. Run
`node_modules/.bin/tsc --noEmit` from the workspace directory to get an honest exit code.

### Notes for CLI-020

- `GET /api/index/status` is the whole payload: `indexed`, `pending`, `failed`, `identity`
  (nullable — `null` both for a fresh index *and* for a mixed one, which `db doctor` names),
  `rebuilding`, `state`.
- `POST /api/index/rebuild` answers **202** with the same shape; `identity` is `null` in it by
  construction (nothing has been embedded yet), `rebuilding` is `true`, `state` is `indexing`. The
  acknowledgment line has `pending` to print.
- Neither route takes a header, a body or a query, and neither can 400.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
