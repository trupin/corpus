# [CONTRACT-097] Token measurements on the wire

## Domain

contract

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-079 (design constants + the rider, which signs first)
- Blocks: SERVER-166, CLI-085, UI-190

## Spec References

- SPEC.md §9 — the drafted telemetry rider (SHARED-079)

## Summary

Two routes:

1. **`POST /api/telemetry/invocations`** — the CLI's fire-and-forget report.
   Body: `{ command: string (the resolved path, e.g. "thread show"),
   wroteBytes: int, readBytes: int, subjects: string[] (doc/thread ids the
   invocation named, may be empty), at: ISO }`. Response 204. Deliberately
   minimal: no per-flag detail, no payload echo. Accepts batches
   (`invocations: [...]`) so a future buffering CLI needs no new route.
2. **`GET /api/docs/{id}/cost`** — the panel's series. Returns bucketed
   totals over time (bucket granularity the server's choice, stated in the
   response), each bucket `{ from, to, wroteTokens, readTokens, invocations,
   byCommand: {path: tokens} }`, plus the document's byte size at read time
   for the reference line. Bounded: a `limit` on buckets with the newest
   kept, stated truncation.

Tokens on the wire are the house estimate (bytes ÷ 4) computed server-side —
the CLI reports bytes, the server derives, one definition.

## Acceptance Criteria

- [x] Both routes defined per the package's transcription pattern; artifacts
      regenerate byte-identical twice
- [x] Telemetry ingestion is explicitly fire-and-forget in the description:
      idempotency not promised, loss acceptable, never load-bearing
- [x] `npm test -w packages/contract` green
- [x] Consumer typecheck window (server) noted in the report, per the
      CONTRACT-096 precedent

## E2E Verification Log

**Model: Opus 5 (`claude-opus-5[1m]`). Date: 2026-09-06. Worktree:
`.claude/worktrees/agent-ac759737b7b3267f8`, uncommitted.**

### Decisions this issue took, so nobody has to re-derive them

**D1 — the rounding mode is `Math.ceil`.** `BYTES_PER_TOKEN = 4` and
`estimateTokens(bytes) = Math.ceil(bytes / BYTES_PER_TOKEN)`, both in
`packages/contract/src/schemas/telemetry.ts`, with the reasoning in the
function's own docblock. Three reasons, in order of weight:

1. **`estimateTokens(0) === 0` and nothing else is zero.** A zero in the panel
   can then only mean *nothing was measured*, never *measured and rounded
   away*. Floor loses every measurement under four bytes and nearest-rounding
   loses one-byte ones — and UI-190's empty state (TEST-1218) exists precisely
   to tell those two apart.
2. **It errs in one stated direction**, by less than a token.
3. **`wc -c ÷ 4` still reproduces it**, rounded up, and the rule is published
   on the wire as well as in the docblock.

The repo's existing meaning of the number (`scripts/skill-budget.ts`,
`Math.round`) is deliberately **not** inherited — P2 called this a decision
rather than an inheritance, and a total over a large file cannot produce a
misleading zero the way a per-command cell can.

**D2 — the conversion grain is fixed, because rounding is not additive.**
`ceil(1/4) + ceil(1/4) = 2` while `ceil(2/4) = 1`, so a response that converted
at two grains would publish a breakdown that does not sum to its own total.
`CostBucket` therefore declares one grain and makes every coarser figure a plain
sum of it:

> The estimate is taken **once per command per direction** inside a bucket.
> `byCommand[c] = estimateTokens(wroteBytes_c) + estimateTokens(readBytes_c)`;
> `wroteTokens = Σ_c estimateTokens(wroteBytes_c)` and `readTokens` likewise.
> So `Σ_c byCommand[c] === wroteTokens + readTokens`, exactly.

**This is a correction to sprint-025's TEST-1188 as written**, which asks for
both "each bucket's token figures equal the contract's conversion applied to
that bucket's summed bytes" *and* "`byCommand` sums to the bucket total". Those
two are unsatisfiable together under any rounding mode. The contract keeps the
sum identity (a panel whose parts do not add up reads as broken, and the reader
can see it) and gives up bucket-level `estimateTokens(Σ bytes)` (which nobody
can check by hand anyway). The hand check the estimate exists to survive — one
invocation's `readBytes` against `wc -c` — is untouched. **SERVER-166 must
implement this grain**, and the wire says so in `CostBucket`'s docblock and in
`wroteTokens`'s published description.

**D3 — O4 is answered on the wire: `DocumentCost.measuringSince`,** an ISO
instant or `null`. Taken as the sprint recommends. It is the one open question
with a wire consequence, and leaving it out would have made it a contract change
later rather than a field now. SERVER-166 decides *what stamps it* (P9's
consequence: a schema bump supersedes the database, so the series restarts);
the contract only requires that a workspace holding nothing answers `null`.

**D4 — `sizeBytes`, not `size`.** The response mixes bytes and tokens, so the
unit is in the name, matching the report's own `wroteBytes`/`readBytes`.

**D5 — both routes are tagged `telemetry`,** including the document
subresource — the precedent is `GET /api/docs/{id}/related`, tagged `search`
rather than `docs`, because a route's tag names its subject.

### Incidental fix the tag sweep forced

TEST-1180's sweep ("no route uses an unregistered tag") failed on **four
pre-existing tags in use and unregistered**: `folders`, `boards`, `agents`,
`workspace`. Every operation carrying one rendered under a heading with no
description. Registered in `openapi.ts` with descriptions in the existing house
style. Additive only — no operation changed.

### E2E evidence

**1. Generation is idempotent and the artifacts are committed in sync.**
`npm run generate -w packages/contract` run three times; SHA-256 identical every
time:

```
c44ec2eb109d713f1207dfb7d21ca2cc1a120cf905de6a1b29b067e313bf9dc0  packages/contract/openapi.json
786b58a85ba9eaccf741780c5d53a4dc6dd9dca8649e4345eced3bca5974d169  packages/contract/src/client/schema.generated.ts
```

`git diff --stat` on both artifacts: **543 insertions, 0 deletions** — the
change is purely additive, so no existing route, component or description moved.

**2. The drift check fires (falsified, not assumed).** Hand-edited the committed
`openapi.json` to shorten the ingestion route's summary, then ran
`vitest run packages/contract/src/generation/artifacts.test.ts` — exit 1, with
the correct one-sided diagnosis:

```
openapi.json is out of date and src/client/schema.generated.ts is current.
Cause: the committed document was edited by hand, or half a regeneration was committed —
the client types still describe the document the routes produce.
Fix: npm run generate -w packages/contract
```

Restored from backup; hash matches the line above again.

**3. The typed client against a real mounted app.** `packages/contract` built,
then a throwaway ESM script mounted both route definitions on a real
`OpenAPIHono` (with a `defaultHook` shaped like the server's) and drove them
through `createCorpusClient` with the app's own `request` as `fetch` — so every
call passed the real zod-openapi validators. Output:

```
single report status: 204
single report body:                     ← empty, as declared
batch report status: 204
ledger rows: 3
neither-form status: 400
neither-form body: {"code":"bad_request","message":"validation failed","issues":[{"path":"",
  "message":"Send either one invocation — `{command, wroteBytes, readBytes, subjects, at}` —
   or a batch of them under `invocations`. No other key, and never both forms in one body."}]}
malformed id status: 400                ← refused before any handler ran
thread series status: 200               ← a th_* id is legal
doc series: {"granularity":"day","buckets":[{"from":"2026-09-06T00:00:00Z",
  "to":"2026-09-07T00:00:00Z","wroteTokens":13,"readTokens":501,"invocations":2,
  "byCommand":{"thread show":408,"doc show":106}}],"total":1,"truncated":false,
  "sizeBytes":2048,"measuringSince":"2026-09-06T00:00:00Z"}
byCommand sums to wroteTokens+readTokens: true      ← 408 + 106 == 13 + 501
untouched series: {"granularity":"day","buckets":[],"total":0,"truncated":false,
  "sizeBytes":2048,"measuringSince":null}
```

The mixed-form call needed `@ts-expect-error` to compile at all, which is the
generated client refusing the union's non-members before a request is made.

**4. `wc -c` parity, by hand.** A 1601-byte file: `wc -c` reports `1601`, and
`estimateTokens(1601)` is `401` = `Math.ceil(1601/4)`. The `readTokens` figure
in the run above is that number.

**5. One definition, repo-wide (TEST-1168).** In-package: a filesystem sweep in
`schemas/telemetry.test.ts` asserts that exactly one non-test file declares
`BYTES_PER_TOKEN`, one exports `estimateTokens`, and one divides by it.
Repo-wide, by grep — every hit outside `schemas/telemetry.ts` is a test or a
route description, and none is a second definition:

```
$ grep -rn "BYTES_PER_TOKEN|estimateTokens" apps packages --include=*.ts --include=*.tsx
  packages/contract/src/routes/telemetry.test.ts    (2 hits, assertions)
  packages/contract/src/routes/index.test.ts        (2 hits, stub fixture)
  packages/contract/src/routes/telemetry.ts         (2 hits, imports the constant for prose)
$ grep -rn "skill-budget" apps packages
  (only prose in telemetry.ts's own docblock — no import from any product package)
$ grep -rn "/ 4\b" apps/server/src apps/cli/src | grep -v test
  apps/server/src/anchors/fuzzy.ts:134,136   ← quartiles in fuzzy matching, unrelated
```

`scripts/skill-budget.ts` is unchanged and still imported by nothing under
`apps/` or `packages/`.

**6. Checks.**

- `vitest run packages/contract` (`VITEST_MAX_THREADS=4`): **75 files, 3249
  tests, all pass** — `generation/artifacts.test.ts` included, so the run covers
  the committed artifacts and not only the in-memory document (INFRA-032).
- `tsc --noEmit -p packages/contract`: clean.
- `npm run typecheck` (every workspace + scripts + rehearsals): clean.
- `eslint packages/contract/src --max-warnings=0`: clean.
- `prettier --check packages/contract/src packages/contract/openapi.json`: clean.

### Consumer window — one server test file is red until SERVER-166 mounts

Typecheck is **clean in every workspace**: nothing outside this package
constructs `DocumentCost` or `InvocationReport` yet, so the additive routes
break no compile.

What is red is a **test**, measured rather than predicted —
`vitest run apps/server/src/json-body.test.ts`, **5 failed / 2 passed**:

```
POST /api/telemetry/invocations answered 404, which the contract does not
declare (it declares 204, 400, 401).
```

That sweep walks `ALL_CONTRACT_ROUTES` and requires every declared JSON body to
answer `400` on an unreadable body, and CONTRACT-058's declared-vs-emitted
cross-check names the cause exactly. Mounting the route in SERVER-166 clears all
five. `apps/server/src/app.test.ts` — the counterpart sweep, which expects an
unmounted declared path to `404` — stays green (51/51), so the two are consistent
and nothing needs a temporary exclusion here.
