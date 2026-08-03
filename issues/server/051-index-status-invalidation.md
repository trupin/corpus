# [SERVER-051] Embed worker emits SSE invalidations for index status

## Domain
server

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: —
- Blocks: UI-040

## Spec References
- SPEC.md §11 console index pill (rider signed 2026-08-02); §9.1

## Summary
`GET /api/index/status` exists but nothing announces its changes: the embed
worker (apps/server/src/semantic/worker.ts) never touches the invalidation
bus, so a UI consumer can only poll. Emit invalidations on a stable key (fit
the existing key vocabulary — e.g. `["index","status"]`; check how kit's
QUERY_KEY_NAMES/watcher keys are organized and match) at: every state
transition (current/indexing/stale/disabled — including detail-worthy changes
like download progress milestones), rebuild start/end, and throttled backlog
progress while draining (bounded rate — e.g. at most one per second or per
N chunks; the throttle must not delay the final caught-up announcement).

## Acceptance Criteria
- [x] State transitions announce immediately; the drain announces throttled;
      the final transition to `current` is never absorbed by the throttle
- [x] No announcements when nothing changes (idle steady state is silent)
- [x] Key documented/exported where the other invalidation keys live
- [x] No write-path latency added (worker-side emission only)

## Technical Design
### Files to Create/Modify
- `apps/server/src/semantic/worker.ts` (+ maintenance/rebuild path); the
  invalidation bus wiring; possibly a kit/contract key export — escalate if
  the key vocabulary lives in contract

## Testing Strategy
Worker tests with a captured bus: transition/throttle/final-drain assertions
via vi.waitFor on real observables (NOT setImmediate flush loops — CI phase
hazard, see Phase 8 landing notes).

## E2E Verification Plan
Real server: bulk-edit docs; observe SSE events drain-throttled, ending in the
current announcement.

## E2E Verification Log

**Model: Opus 5** (server-dev). Real server, real workspace at `/tmp/server-051-e2e`
(explicit path, never cwd-derived), port **8791** (8765 untouched). Embedding
provider: a local OpenAI-compatible stub on 127.0.0.1:8799 with a configurable
per-batch latency, so a drain is long enough to observe (the embedded engine's
model is not cached on this machine). SSE consumed by a raw `fetch` reader that
timestamps every `invalidate` frame.

### 1. Bulk edit → throttled drain → caught-up frame

40 documents created over `POST /api/docs` (160 chunks, batch 16 → 10 provider
calls at 900 ms each). Frames, ms since the listener attached:

```
103214..104xxx   [["docs"],["docs","doc_…"],["tree"]]   × 40   ← the write path; no index frame
171080 INDEX [["index"]]        ← the backlog, noticed one debounce after the last save
171999 INDEX [["index"]]
173830 / 175645 / 177464 / 179282 / 181089 INDEX [["index"]]   ← ~1 per 1.8 s of drain
182001 INDEX [["index"]]        ← caught up, 912 ms after the previous frame
```

Two properties are visible in that tail. The drain announced **7 frames for 160
chunks** (the throttle collapses the two 900 ms batches that fall inside one
1 000 ms window), and the **final frame fired 912 ms after the previous one —
inside the throttle window** — which is the guarantee that the caught-up
transition is never absorbed. `GET /api/index/status` afterwards:
`{"indexed":504,"pending":0,"failed":1,…,"state":"current"}`.

An earlier run with a 40 ms stub drained 120 chunks in ~360 ms and produced
exactly **two** frames (`25504ms`, `25863ms`): every progress frame absorbed, the
caught-up frame still delivered.

### 2. Rebuild start and end

`corpus index rebuild` over 505 chunks:

```
199546 INDEX ×2   ← the rebuild's start frame (synchronous with the 202) + the discard's counts
200448 … 227681   ← 16 throttled progress frames
229492 INDEX ×2   ← caught up, then the rebuild-end frame once `rebuilding` is down
```

`GET /api/index/status` read `rebuilding:true, state:"indexing"` mid-flight
(`{"indexed":192,"pending":151,…}`) and `state:"current"` after the pair.

### 3. Idle silence

45 s with a connected SSE client, an indexed corpus and nothing happening:
**70 → 70 frames.** Repeated after the rebuild with the same result.

### 4. The bug this E2E found (pre-fix reproduction)

The first implementation announced on an eligibility edge (`hadWork`). Killing
the provider and saving one document produced **two frames on every rung of the
retry ladder** — 1 s, 5 s, 30 s — while `indexed/pending/failed/state/detail`
were byte-identical each time:

```
198242ms       [["docs"],…]          ← the save
198745 / 198746 INDEX                ← backlog edge + the unreachable-provider sentence
199748 / 199749 INDEX                ← rung 1: nothing on the wire changed
204753 / 204755 INDEX                ← rung 2
234758 / 234760 INDEX                ← rung 3
```

A failed chunk stops being *eligible* and becomes eligible again without one
published number moving. Fixed by deciding the announcement **by measurement**
(the SERVER-018/020 lesson): `announceCounts` compares the three published counts
against the ones the last frame described and declines to speak when they agree;
only the uncountable changes (a `detail` sentence, an adopted identity, a
discard, the rebuild flag) announce unconditionally, each already gated by its
own change detection. Re-run on the fixed build, the same scenario:

```
14542ms       [["docs"],["docs","doc_rmqwcqcg"],["tree"]]
15052ms INDEX [["index"]]
```

— one frame for the backlog, then **70 s of retry ladder in complete silence**.
Pinned by `worker.test.ts` → "stays silent through a retry ladder that moves no
number on the wire".

### 5. PR #19 review follow-up (2026-08-03, **Opus 5**, server-dev)

Three MINOR findings from the Fable pr-reviewer on PR #19.

**Finding 1 — the pill froze during an outage.** `runPass` returned at the
backoff guard *before* `announceCounts()`, contradicting the comment directly
above it ("a disabled provider still owes the pill a count that grew"). Fixed by
announcing before the guard; the drain's throttle and the announce-by-measurement
rule are untouched.

_Pre-fix reproduction, real server._ Workspace `/tmp/pr19-e2e`, port **8794**
(8765 and 5173 untouched), `embedding` block pointing at a closed port
(`http://127.0.0.1:8899/v1`) so every pass fails and the ladder climbs. Four
documents created 2.5 s apart, then one more while the worker sat on a high rung:

```
    543ms climbing the ladder
   7155ms INDEX [["index"]]
  10930ms status: pending 82, state "disabled"
  18928ms --- index frames so far: 1; now saving one document ---
  19006ms created doc_33wunaxv
  31001ms index frames after the save: 1 (delta 0)   ← 12 s, not one frame
  31001ms status: pending 86
```

The wire said 82 while the projection said 86, with no frame to correct it and
no `refetchInterval` on `useIndexStatus`.

_Post-fix, same scenario, same workspace:_

```
   1184 / 3771 / 6361 / 8966ms INDEX   ← one frame per document, on skipped passes
  10967ms status: pending 102, state "disabled"
  18979ms --- index frames so far: 4; now saving one document ---
  19090ms created doc_drtd226u
  19592ms INDEX [["index"]]            ← 502 ms after the save: one debounce
  31093ms index frames after the save: 5 (delta 1)   ← exactly one, then silence
```

Eight quiet seconds before the save produced nothing, and the eleven seconds
after the frame produced nothing: the measurement rule still decides.

_The throttle, live._ A stub OpenAI-compatible endpoint (600 ms per batch) was
then started on 8899 and the rung allowed to expire, draining 107 chunks:

```
  77751 / 78964 / 80181 / 81389ms INDEX   ← ~1.2 s apart while draining
  81996ms INDEX                            ← caught up, 607 ms after the previous
  84883ms status: indexed 107, pending 0, state "current"
```

Six frames for 107 chunks, and the caught-up frame still delivered **inside** the
1 s window — the drain's throttle and its exemption both survive the fix. Pinned
by `worker.test.ts` → "announces a backlog that grows while a backoff holds the
pass back", which fails pre-fix on `expect(frames).toHaveLength(outage + 1)`
("expected [ …(3) ] to have a length of 4 but got 3").

**Finding 2 — `CORE_KEY_ROOTS` never learned about `["index"]`.** The guard's
list was hand-written and fell a key behind, so a plugin naming its key `index`
was namespaced instead of refused with the explanatory error. It is now *derived*
from `QUERY_KEY_VOCABULARY` (plus the kit-owned `health`), and
`context.test.ts` pins every vocabulary root — including `index` by name —
against the refusal, so the eleventh shape is protected the moment the contract
declares it.

**Finding 3 — "nine shapes" prose.** All six sites reworded to name the
vocabulary rather than its size, plus the same stale count wherever it argued
from the number (`tree-key.test.ts`, kit's `keys.test.ts`, `sseBridge.test.ts`,
`useRelatedDocs.ts`, `retrievalHooks.test.tsx`, and `QUERY_KEY_NAMES`' own
comment). Numbers were kept only where a test enforces them and would fail
loudly (`query-keys.test.ts`, `routes/events.ts`' OpenAPI description).

Gates: `apps/server` 3182 tests / 164 files green; contract + kit scoped 1833
tests / 64 files green; eslint (`--max-warnings 0`), prettier and `tsc --noEmit`
clean for server, contract and kit.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
