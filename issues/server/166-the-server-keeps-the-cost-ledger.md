# [SERVER-166] The server keeps the cost ledger

## Domain

server

## Status

done — 2026-09-07, committed on phase-59

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-097; the SHARED-079 rider signed
- Blocks: CLI-085, UI-190

## Spec References

- SPEC.md §9 — the drafted telemetry rider (SHARED-079)

## Summary

Implement CONTRACT-097's routes over a telemetry table in the projection
database (`.corpus/`, beside the queue):

- **Ingestion**: append rows `(at, command, wroteBytes, readBytes, subject)`
  — one row per subject, zero-subject invocations kept with a null subject so
  workspace-wide cost is still answerable later. Cheap by construction: one
  INSERT batch, no reads on the write path.
- **The series**: bucket server-side (recommendation: daily; state it),
  derive tokens as bytes ÷ 4 in one place, include the document's current
  size, cap buckets per CONTRACT-097.
- **Retention**: decide and record — recommendation: raw rows kept 90 days,
  bucketed aggregates kept indefinitely (the panel's question is long-term,
  the row detail is not).
- **Posture**: telemetry is runtime state. `db rebuild` does not reconstruct
  it and starts it empty; `db doctor` never reports its absence or content as
  drift (INFRA-033's staleness-vs-drift line). SCHEMA_VERSION bump.

## Acceptance Criteria

- [x] Ingestion adds no read and no commit; measured cost per report stated
      in the log
- [x] Series correct against hand-computed fixtures; buckets, truncation,
      size line all per contract
- [x] `rebuild && doctor` clean with and without telemetry present
- [x] Retention implemented as recorded
- [x] `npm test -w apps/server` green; E2E with real reports via curl

## Decisions this issue records

**Granularity: daily**, stated on every response (`COST_GRANULARITY` in
`telemetry/series.ts`). §9.4's question is a trend over weeks and months, and an
hourly series would draw a workspace's sleep schedule across it.

**Buckets are contiguous, empty ones included**, running from the document's
oldest surviving measurement to today. An empty bucket is a real answer; a
skipped one reads as a hole in the data. A document nothing has been measured
against answers with **no buckets at all** — never a series of zeros to plot.

**Retention (O3's recommendation, taken): raw rows only, 90 days, bucketed on
read.** No aggregate table — a second table would be a second source of truth
for one number, maintained on the very path §9.4 requires to cost nothing.
Ninety days is enough history for a trend and is what bounds the series: a
document's history is at most 90 daily buckets, which is why the contract's
180-bucket default normally answers `truncated: false`.

**The prune runs at server boot and then on a daily `unref`'d timer**, wired in
`projection/attach.ts` and argued in `telemetry/retention.ts`. Not on ingestion
(§9.4 says that channel costs the command nothing), and not on the read path (a
`GET` that writes is a surprise, and it would prune only for workspaces somebody
opens the panel in). It is safe there because it deletes only `telemetry` rows
strictly older than the window through an index on `at_ms`, `better-sqlite3` is
synchronous so it cannot interleave with a request, and it cannot run during a
rebuild — a rebuild builds a fresh database with no telemetry in it, so no
wall-clock value enters the determinism comparison.

**`measuringSince` (O4's recommendation, taken) is a `meta` stamp, written by
ingestion with `INSERT OR IGNORE`** (`META_TELEMETRY_SINCE`). Chosen over
deriving `MIN(at)` over the ledger, because retention prunes: `MIN(at)` over what
survives would report the workspace as having started measuring on the day the
window opens, and the series would look complete forever. `INSERT OR IGNORE`
keeps the write path free of any `SELECT`. It is `null` after a rebuild and after
a schema bump, which is exactly the honest answer for a ledger that holds
nothing. One accepted edge: if retention ever empties a ledger that was once
written, the stamp remains — "we have been measuring since X, and there is
nothing left in the window" is the true statement.

**`SCHEMA_VERSION` 24 → 25**, and the consequence is accepted rather than
engineered around (sprint-025 P9): a version bump supersedes the database file,
so the cost series restarts on this release and on every future bump.
`measuringSince` is the caption that keeps that honest.

**Storage**: one `telemetry` table in the projection database beside the queue,
**in `PROJECTION_TABLES` and out of `REPOPULATED_TABLES`** (E4's ruling). The
repopulated list also runs at boot, so naming the table there would empty the
user's cost history on every `corpus server stop && start`. "Absent after a
rebuild" then needs no code at all: a rebuild constructs a fresh database and
carries nothing across but the embeddings.

## E2E Verification Log

**Model: Opus 5 (`claude-opus-5[1m]`).**

Real workspace at `…/scratchpad/e2e/ws` (`corpus init`), real server on
127.0.0.1:8767 started with `corpus server start`, every request over curl.

### Ingestion, and the cost of it

`POST /api/telemetry/invocations`, single form → `status=204 body_bytes=0`.
Batch form (one invocation naming the document, one naming nothing) → `204`.
A body that is neither form → `400`:

```
{"code":"bad_request","message":"request failed validation","issues":[{"path":"json",
"message":"Send either one invocation — `{command, wroteBytes, readBytes, subjects, at}` —
or a batch of them under `invocations`. No other key, and never both forms in one body."}]}
```

Unauthenticated → `401` (from the `/api/*` mount, not from this module).

**Measured cost per report**, 500 reports on one keep-alive connection:
**mean 0.162 ms, median 0.144 ms, p95 0.205 ms, max 3.361 ms**. The series read
over the same connection: 0.573 ms for 3 buckets.

**Ingestion adds no read and no commit.** After 100 reports against a clean tree:
`HEAD` unchanged, commit count `2 → 2`, `git status --porcelain` empty, nothing
under `data/` mentions the ledger. Asserted against the code path as well: the
unit sweep proxies `ProjectionDb.prepare`, records the SQL and removes
`get`/`all`/`iterate` from every statement — the path prepares two statements,
both `INSERT`, and completes.

### The series, hand-checked

Reports: `doc show` 21/803 at 2026-09-06T09:15Z, `thread reply` 137/64 at
2026-09-05T14:00Z, `search` 30/2048 naming nothing.

```
{ "granularity": "day", "sizeBytes": 228, "measuringSince": "2026-09-07T03:35:22.799Z",
  "buckets": [
    {"from":"2026-09-05T00:00:00.000Z","to":"2026-09-06T00:00:00.000Z",
     "wroteTokens":35,"readTokens":16,"invocations":1,"byCommand":{"thread reply":51}},
    {"from":"2026-09-06T00:00:00.000Z","to":"2026-09-07T00:00:00.000Z",
     "wroteTokens":6,"readTokens":201,"invocations":1,"byCommand":{"doc show":207}},
    {"from":"2026-09-07T00:00:00.000Z","to":"2026-09-08T00:00:00.000Z",
     "wroteTokens":0,"readTokens":0,"invocations":0,"byCommand":{}} ],
  "total": 3, "truncated": false }
```

`ceil(137/4)=35`, `ceil(64/4)=16`, sum `51` = the `byCommand` value.
`ceil(21/4)=6`, `ceil(803/4)=201`, sum `207`. The `search` invocation named
nothing and appears in no bucket. `sizeBytes` 228 equals `wc -c` on the file
(228), frontmatter included, read from `file_hashes` with no filesystem access.
The trailing bucket is today's, empty and present.

**Threads are documents**: `th_vlbuwdbx` answered `{"thread show": 109}`
(`ceil(24/4)+ceil(412/4)`) with `sizeBytes` 261, and its parent's series stayed
at 0 buckets — no roll-up.

**Truncation**: `?limit=1` → `returned 1 total 2 truncated True`, and the bucket
kept was the newest (`2026-09-07T00:00:00.000Z`).

### The posture: restart, rebuild, doctor

| Step | telemetry rows | `measuringSince` | `db doctor` |
| --- | --- | --- | --- |
| after 604 reports | 604 | `2026-09-07T03:35:22.799Z` | `projection is clean — 15 documents from 15 files (4ms)` |
| after `server stop` + `server start` | **604** | unchanged | clean |
| after `corpus db rebuild` | **0** | `null` | `projection is clean — 15 documents from 15 files (4ms)` |

The rebuild reported `rebuilt the projection in 92ms — 15 documents …`, and the
series afterwards answered `200` with `buckets: []`, `total: 0`,
`measuringSince: null` and `sizeBytes: 228` — the panel is told the workspace has
measured nothing, so it cannot present a short history as a whole one. No drift
entry and no warning mentions telemetry in either state.

### Retention, against a real boot

A row stamped 91 days old was inserted directly into the ledger. Before the
restart: 2 rows, 1 of them past the window. After `server stop && server start`:
**1 row, 0 past the window**. `db doctor` clean, `git status --porcelain` empty,
commit count unchanged.

### Checks

- `npm run typecheck -w apps/server` — clean.
- `npx eslint apps/server/src/telemetry apps/server/src/projection apps/server/src/app.ts` — no issues.
- `npx prettier --write` on every touched file — formatted.
- `npx vitest run apps/server` — **4945 passed, 0 failed** (1108 suites).
- `apps/server/src/json-body.test.ts`'s five previously-red tests are green: the
  ingestion route joins the inventory-driven sweep by being mounted.
