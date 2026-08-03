# Evaluation: SERVER-051

**Date**: 2026-08-02
**Sprint**: sprint-023
**Verdict**: PASS

## Test environment

Real `corpus init` workspace at `/tmp/eval-dogfood` (explicit path, never
cwd-derived), real server on **:8791** (8765 untouched), the **real embedded
embedding engine** (`local/all-MiniLM-L6-v2@384`) — no provider stub, so the
throttle is exercised against the shipped drain rather than a synthetic one.
SSE consumed by a raw `fetch` body reader that splits on `\n\n` and timestamps
every frame; no client library, no summarisation.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                                          |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Filled, with four numbered scenarios.                                                                                                                                          |
| Commands are specific and concrete      | PASS   | Names the port, the provider stub and its latency, `POST /api/docs` × 40, `corpus index rebuild`, `GET /api/index/status`, and gives ms-stamped frame listings.                 |
| Real E2E (not mocked)                   | PASS   | Real server + real workspace + raw SSE reader. The embedding *provider* is a local OpenAI-compatible stub, which is a legitimate way to slow a drain enough to observe a throttle — the server, the worker, the bus and the wire are all real. I re-ran with the real embedded engine and reproduced every property. |
| Scenarios cover acceptance criteria     | PASS   | AC 1 (transition/throttle/final), AC 2 (idle silence), AC 4 (worker-side only) all exercised; AC 3 is an export-surface claim, checked separately below.                        |
| Application restarted after changes     | PASS   | §4 records a re-run "on the fixed build" of the exact scenario that failed before.                                                                                              |
| Actual model recorded (implemented on:) | PASS   | "**Model: Opus 5** (server-dev)".                                                                                                                                              |
| Reproduction logged before fix (bugs)   | PASS   | §4 is a genuine pre-fix reproduction of a defect the E2E itself found: two identical frames on every rung of the retry ladder (1 s / 5 s / 30 s) with `indexed/pending/failed/state/detail` byte-identical, then one frame and 70 s of silence after the fix. |

§4 is the strongest part of the log: it reports a bug the agent's own E2E
discovered *after* an initial implementation, with before/after frame listings
and the reasoning (announce by measurement, not by eligibility edge). That is the
shape of a log written while running the thing.

## Criteria Results

| #   | Criterion                                                                                   | Result | Notes                                                                                               |
| --- | ---------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| 1   | Transitions announce immediately; drain announces throttled; the final `current` is never absorbed | PASS   | Progress frames ~1.40 s apart; final frame 312 ms after the previous — inside the throttle window.  |
| 2   | No announcements when nothing changes (idle steady state is silent)                          | PASS   | 35 s cold idle → 0 index frames; ~130 s post-rebuild idle → 0; a metadata-only edit → 0.            |
| 3   | Key documented/exported where the other invalidation keys live                                | PASS   | `INDEX_KEY` exported from `@corpus/kit`'s public surface beside `DOCS_KEY`/`TREE_KEY`/`HEALTH_KEY`. |
| 4   | No write-path latency added (worker-side emission only)                                      | PASS   | 12 writes → 12 `["docs"]` frames, **0** index frames; first index frame 504 ms later; latency flat. |

## Evidence

### AC 2 — idle silence (tested first, before anything else touched the corpus)

35 s with a connected SSE client on a fully-indexed corpus:

```
# connected status=200 ct=text/event-stream
     38ms :connected
  25038ms :hb
```

A connect comment and one heartbeat. **Zero** `invalidate` frames. Repeated after
the rebuild below: from 44 534 ms to 175 046 ms — **130 seconds** — nothing but
heartbeats.

Sharper probe, a metadata-only edit that moves no indexed content:

```
  43275ms event: invalidate | data: {"keys":[["docs"],["docs","doc_6jqbvm3v"]]}
  (no index frame — end of stream)
```

`corpus doc edit <id> --add-tag evalprobe` announced the document and said
nothing about the index. The "announce by measurement" fix is doing real work.

### AC 1 — the drain, throttled, with the caught-up frame preserved

40 documents created over `POST /api/docs`, then `corpus index rebuild` over 103
chunks, one continuous SSE listener:

```
  21378ms … 23199ms   [["docs"],["docs","doc_…"],["tree"]] × 40   ← the 40 writes; no index frame
  23704ms INDEX [["index"]]     ← backlog noticed, 505 ms after the last write
  25162ms INDEX
  25482ms INDEX                 ← caught up, 320 ms after the previous frame
  …
  39985ms INDEX ×2 / 39989ms INDEX   ← rebuild start burst (transitions, immediate)
  41406ms INDEX
  42808ms INDEX                 ← 1.402 s
  44222ms INDEX                 ← 1.414 s   } throttled progress
  44534ms INDEX ×2              ← caught up + rebuild-end, 312 ms after the previous
  (then 130 s of heartbeats only)
```

Three properties are visible and each is a distinct criterion:

- **Throttled during the drain**: consecutive progress frames are 1.402 s and
  1.414 s apart, for a drain that processed 103 chunks — far more chunk events
  than frames. The rate is bounded.
- **The final transition is not absorbed**: the caught-up pair fired **312 ms**
  after the previous frame, well inside the throttle window. Same shape in the
  first drain (320 ms) and in the single-document case below (23 ms).
- **Transitions are immediate**: the rebuild's start burst is 3 frames inside
  4 ms, and a single body edit produces its pair 23 ms apart:

```
  22886ms event: invalidate | data: {"keys":[["docs"],["docs","doc_6jqbvm3v"]]}
  23389ms event: invalidate | data: {"keys":[["index"]]}     ← stale
  23412ms event: invalidate | data: {"keys":[["index"]]}     ← current, 23 ms later
```

Status corroboration: `GET /api/index/status` read
`{"indexed":63,"pending":40,…,"state":"stale"}` immediately after the bulk write,
`{"indexed":64,"pending":73,"rebuilding":true,"state":"indexing"}` mid-rebuild,
and `{"indexed":103,"pending":0,"failed":0,…,"state":"current"}` after the
caught-up frame.

### AC 3 — the key lives with the others

The published `@corpus/kit` surface:

```
export { canonicalFilter, docKey, docsListKey, DOCS_KEY, HEALTH_KEY, INDEX_KEY,
         jobKey, jobsListKey, JOBS_KEY, lockKey, LOCKS_KEY, PLUGIN_KEY_PREFIX,
         pluginKey, QUEUE_KEY, relatedKey, searchKey, threadKey, TREE_KEY, … }
  from "./query/keys.js";
```

`INDEX_KEY` is exported from the same module and the same barrel as every other
invalidation key, and the wire spelling `["index"]` is a single-segment key
matching the `["docs"]` / `["tree"]` vocabulary. A UI consumer can subscribe by
the exported constant rather than by a literal.

### AC 4 — emission is worker-side, not write-path

The decisive test: attach a listener, then write 12 documents while the index is
already behind.

```
   3119ms … 3669ms   [["docs"],["docs","doc_…"],["tree"]] × 12   ← the 12 writes
   4173ms INDEX [["index"]]      ← 504 ms after the last write
   4729ms INDEX [["index"]]
```

**Twelve writes, twelve document frames, zero index frames.** If the announcement
were on the write path, each write would have carried one. Instead the index
frames arrive half a second later, on the worker's own schedule.

Latency, `POST /api/docs` × 12 each time:

```
index current/stale, worker quiet : median 50 ms  (47 … 113)
index current/stale, worker quiet : median 49 ms  (47 … 104)
```

Unchanged. (During an active *rebuild* the median rises to ~91 ms, but that is
the local embedding engine competing for CPU on the same machine — a pre-existing
property of the embedded provider, not of the invalidation, as the frame listing
above proves: no index frame is produced on the write path at all.)

Raw logs: `/tmp/eval-dogfood/sse-idle.txt`, `sse-bulk.txt`, `sse-single.txt`,
`sse-writepath.txt`.

## Failures

None.

## Summary

**4 of 4 criteria passed.** `["index"]` frames appear immediately on state
transitions, at a bounded ~1.4 s rate through a drain, always including a final
caught-up frame that the throttle does not absorb; the stream is completely
silent when nothing on the wire has moved — including through a metadata-only
edit and 130 s of idle; the key is exported alongside the rest of the
vocabulary; and no index frame is ever emitted on the write path. Verified with
the real embedded engine and a raw SSE reader, not the implementation's provider
stub.
