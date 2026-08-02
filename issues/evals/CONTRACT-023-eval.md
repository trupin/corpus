# Evaluation: CONTRACT-023

**Date**: 2026-08-01
**Sprint**: sprint-021
**Evaluator model**: Opus 5 (1M context)
**Verdict**: PASS

A contract issue is only behaviourally testable through what the running server and the generated
client actually do. That is what I tested — the wire, the status codes, the header requirements and
the vocabulary, never the schema source.

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | Includes a verbatim §9.2/§9.1 quote and a phrase-by-phrase inventory walk |
| Commands are specific and concrete | PASS | Two `shasum -a 256` runs proving generation idempotence, exact grep output |
| Real E2E (not mocked) | PASS (for this issue's nature) | The sprint assigns CONTRACT-023 **no port**; its E2E is build + generation + the typed client driven against a mounted `OpenAPIHono` app. The wire claims are all now confirmed against the real server by me |
| Scenarios cover acceptance criteria | PASS | All four |
| Application restarted after changes | N/A | Starts no server, by contract |
| Actual model recorded (implemented on:) | PASS | "implemented on: opus (2026-07-31)" |
| Reproduction logged before fix (bugs) | N/A | Feature issue |
| Deferrals recorded | PASS | The absent SSE key for status is flagged as a decision rather than left silent |

The log flatly contradicts its own issue Summary on the state vocabulary (C3) and says so. That is
the correct handling and it matches what shipped.

## Criteria Results

| # | Criterion | Result | Notes |
| --- | --- | --- | --- |
| 1 | Both routes in `ENDPOINT_INVENTORY`; inventory test green | PASS | Both routes are live and reachable on the real server at the §9.2 spelling |
| 2 | Status schema as specified; rebuild fire-and-forget with an honest response type | PASS | Payload is exactly the declared six fields; rebuild answers **202** with the same shape |
| 3 | No breaking change to any CONTRACT-022 shape | PASS | Both retrieval envelopes carry exactly their Phase A keys plus the optional `semanticIndex` |
| 4 | openapi.json + client regenerated, drift check green | PASS | `npm run build` and `npm run package:build` both green from the committed tree in this session |

### Criterion 1/2 — the routes, on the wire

```
$ curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8808/api/index/status
{"indexed":581,"pending":0,"failed":0,"identity":"local/all-MiniLM-L6-v2@384","rebuilding":false,"state":"current"}

$ curl -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8808/api/index/rebuild -w " <- %{http_code} in %{time_total}s"
{"indexed":0,"pending":561,"failed":0,"identity":null,"rebuilding":true,"state":"indexing"} <- 202 in 0.001096s
```

Exactly the declared shape: indexed / pending / failed counts, **nullable** identity (`null` on a
fresh index, a string once recorded), a `rebuilding` flag, and the state word. `202`, not `200` and
not a bare `204` — accepted-not-completed, with a body every field of which was true at the moment of
the call.

**No acting party**: `POST /api/index/rebuild` succeeds with no `X-Corpus-Actor` header, which is the
deliberate divergence from `POST /api/db/rebuild` that §9.2's "no acting party" sentence requires. It
still requires the bearer token (401 without it, and with a bad one).

### Criterion 3 — the frozen vocabulary, on the wire

All four state values were produced and observed **live** on `/api/index/status`,
`/api/search` and `/api/docs/{id}/related`:

```
current   {"indexed":581,"pending":0,  "rebuilding":false,"state":"current"}
indexing  {"indexed":16, "pending":545,"rebuilding":true, "state":"indexing"}
stale     {"indexed":580,"pending":1,  "rebuilding":false,"state":"stale"}
disabled  {"indexed":561,"pending":0,  "rebuilding":false,"state":"disabled"}
```

No fifth value appeared in any condition I could create, including a dead configured provider, an
unparseable provider name, a mixed-identity index and a mid-download cold cache. `catching-up` and
`lexical-only` never appeared on any wire.

`indexing` outranks `stale` (OC4): throughout a 16 s rebuild, `pending` fell 545 → 0 and the word
stayed `indexing` while `rebuilding: true`.

The `SemanticIndexState` vocabulary really is shared rather than duplicated —
`/api/index/status`.`state` and `/api/search`.`semanticIndex` agreed at every instant I compared
them, including mid-rebuild and in three different degraded conditions.

### Criterion 3 — Phase A compatibility, on the wire

```
search  top-level keys: ['hits', 'semanticIndex']
        hit keys      : ['headingPath', 'id', 'snippet', 'title']
related top-level keys: ['related', 'semanticIndex']
        row keys      : ['excerpt', 'id', 'relation', 'title']
```

Every Phase A field present, same names; the only addition is `semanticIndex`. `relation` produced
all three of `linked`, `similar` and `both` live — the enum did not need widening because
CONTRACT-022 already carried them.

### Criterion 4 — generation

`npm run build` (which type-emits every workspace against the generated client) and
`npm run package:build` / `npm run pack:check` were both run in this session from the committed tree
and are green. The generated client is what the CLI uses: `corpus index status` and
`corpus index rebuild` both work, and the *globally installed* older `corpus` answers
`unknown command "index"` — so the verbs are coming through the regenerated client in this tree.

## Failures

None.

## Observations (not failures)

- **O-1.** The `IndexStatus` payload has no field for a reason, a detail or a progress figure. That is
  faithful to what this issue declared and to §9.2's bullet — but it is the structural reason
  SERVER-048's "progress surfaced in index status" criterion cannot be satisfied (see SERVER-048
  FAIL-1). If that criterion is to be honoured rather than amended, the fix starts here, as an
  **optional** additive field so Phase A compatibility is preserved.

## Summary

4 of 4 criteria pass, verified against the running server rather than against the schema. The frozen
four-value enum is intact on every surface, the two envelopes carry exactly their Phase A shape plus
one optional field, `POST /api/index/rebuild` is a token-guarded `202` with no acting party, and all
three surfaces that share the state vocabulary agree with each other at every instant tested.
