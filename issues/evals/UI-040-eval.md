# Evaluation: UI-040

**Date**: 2026-08-02
**Sprint**: N/A (dogfood-todos-polish batch)
**Verdict**: PASS

## Environment

Production UI served by the real server at `http://127.0.0.1:8891/`, workspace
`/tmp/eval-dogfood-ws`, real in-process embed worker. **No request
interception** — every number below came off the real wire. Rebuilds triggered
with `corpus index rebuild --workspace /tmp/eval-dogfood-ws`.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                              |
| --------------------------------------- | ------ | ------------------------------------------------------------------ |
| Verification log present                | PASS   | Two halves: a real-workspace run and a stub run for the rare states |
| Commands are specific and concrete      | PASS   | Millisecond-stamped timeline, wire-vs-DOM comparison                |
| Real E2E (not mocked)                   | PASS   | Half 1 is a real server + real worker with zero interception        |
| Scenarios cover acceptance criteria     | PASS   | All five                                                            |
| Application restarted after changes     | PASS   | Fresh workspace + fresh Vite per run                                |
| Actual model recorded (implemented on:) | PASS   | "Model: Opus 5 (ui-dev)"                                           |
| Reproduction logged before fix (bugs)   | PASS   | The flake follow-up carries the received-vs-expected numbers        |

## Criteria Results

| #   | Criterion                                            | Result | Notes                                                                    |
| --- | ---------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| 1   | Matches the agent pill; all four states render       | PASS\* | Geometry identical; `current` + `indexing` reproduced live, see note      |
| 2   | Counts live-update during a drain, no reload         | PASS   | 0/74 → 32/74 → 64/74 → current · 74 indexed, 0 navigations               |
| 3   | `detail` verbatim when present; `failed` only if ≠ 0 | PASS\* | Byte-identical to the wire; the row appears and disappears with `detail`  |
| 4   | No polling loop — refetch on invalidation only       | PASS   | **0** reads across 35 s of idle                                          |
| 5   | Kit: method + hook + query key per retrievalHooks    | PASS   | Not source-readable; the observable contract (one read per invalidation) holds |

### Live rebuild, timed (t = seconds from board load)

```
  0.00  pill  "index: current · 74 indexed"   dot rgb(78,122,70)  animation none
  8.03  IDLE 8s → /api/index/status reads = 0
  8.41  corpus index rebuild → {"indexed":0,"pending":74,"failed":0,"identity":null,
                                "rebuilding":true,"state":"indexing"}
  8.82  pill  "index: indexing · 0/74"        dot rgb(59,95,151)  animation pulse
 10.03  pill  "index: indexing · 32/74"
 11.64  pill  "index: indexing · 64/74"
 12.05  pill  "index: current · 74 indexed"   dot rgb(78,122,70)  animation none
 read timeline (s): -1.53, 8.45, 9.88, 11.30, 11.74   ← 4 reads, one per state change
```

Zero page navigations during the drain — the counts climb in place.

### Pill vs. agent pill (same frame, live DOM)

```
index: { y 867, h 26, borderRadius 99px, bg rgb(239,237,232) }
agent: { y 867, h 26, borderRadius 99px, bg rgb(239,237,232) }
```

Identical baseline, height, radius and chrome. Dot vocabulary is shared: green
`rgb(78,122,70)` at rest, accent `rgb(59,95,151)` with `animation-name: pulse`
while indexing.

### `detail` verbatim

Compared character-for-character against `GET /api/index/status` fetched
independently in the same instant:

```
wire.detail = "local/all-MiniLM-L6-v2@384 is ready; the index has no vectors yet,
               so ranking is lexical until the first ones land"
DOM contains it VERBATIM: true
```

Before the rebuild: the sentence is **absent** from the DOM (`false`). After the
index catches up: **absent** again. The expanded drawer renders it as a
full-width row above the master-detail body (screenshot
`/tmp/eval-drive/console-indexing.png`), with the pill on `index: indexing · 0/74`.

### No polling

```
reads during 35 s of idle: 0   (total since page load: 1)
```

One read at mount, none thereafter. Decisive against any poll interval.

## Failures

None.

## Notes (not failures)

- **`stale` and `disabled` were not reproducible in the browser here.** A fresh
  workspace with an isolated `HOME`/`XDG_CACHE_HOME` did produce a genuine
  `"state":"disabled"` on the wire
  (`{"indexed":0,"pending":66,...,"state":"disabled","detail":"…"}`), but the
  index drained to `current` before the page could paint it, so only two of the
  four states were observed rendering live. The remaining two are covered by the
  implementer's stubbed spec, which is the right tool for a state the real
  system will not hold still in. Scored PASS with this caveat recorded.
- **`failed` non-zero** could not be produced (no chunk failed in any run). The
  observable half — no failed row while `failed` is 0 — holds.

## Summary

5 of 5 criteria passed. The pill is shape-identical to the agent pill, its
counts climb through a real embed drain with no reload, the server's `detail`
sentence is reproduced byte for byte and disappears with it, and 35 seconds of
idle produced not a single read.
