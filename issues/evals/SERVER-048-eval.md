# Evaluation: SERVER-048

**Date**: 2026-08-01 (original) · **re-verdict 2026-08-01** against `ed07f54`
**Sprint**: sprint-021
**Evaluator model**: Opus 5 (1M context)
**Verdict**: **PASS** (5/5) — superseding the original FAIL; see the re-verdict section at the end

> The original FAIL text is retained below as history. It was issued against `a806469`; the fix
> landed as `ed07f54 [SERVER-048] Eval-FAIL fix: download progress on the wire; zero blind window`
> and the failing scenario was re-run from scratch. FAIL-1 is closed, and LEDGER-1 (the ~30 s
> "disabled while fully indexed" window) is closed with it — **measured at 0 ms**.

---

# Original evaluation (2026-08-01, against `a806469`) — HISTORY

**Verdict at the time**: FAIL — one acceptance criterion is checked `[x]` and is provably false

Four of five criteria are met, several of them impressively. One is not: **download progress is not
surfaced in `index status`**, and cannot be, because the status payload carries no field that could
hold it. Everything else in this issue stands.

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | The most thorough log in the batch — runtime selection table, hash pins, four E2E legs, a six-point no-exec proof |
| Commands are specific and concrete | PASS | Exact byte counts, exact sha256s, exact `lsof` output, named pids |
| Real E2E (not mocked) | PASS | Real HTTPS download from HuggingFace, real server, real network sabotage, real corruption fixtures |
| Scenarios cover acceptance criteria | **FAIL** | AC 2's "progress surfaced in index status" has no evidence *from index status* — the log's own wording gives it away: "which is what `corpus index status` **will** render (the endpoint itself is SERVER-046's)". That endpoint shipped, and it does not render it |
| Application restarted after changes | PASS | Multiple boots, including a cold-cache boot asserting zero downloads |
| Actual model recorded (implemented on:) | PASS | "Implemented on: opus (Opus 5, 1M context)" |
| Reproduction logged before fix (bugs) | N/A | Feature issue |

## Criteria Results

| # | Criterion | Result | Notes |
| --- | --- | --- | --- |
| 1 | Zero-config with the model cached: embeddings compute in-process, no network syscalls during embed | PASS | Zero outbound sockets across a full 581-chunk drain, six samples |
| 2 | First run without the cache: model downloads **with progress surfaced in index status**, hash-verified | **FAIL** | Hash verification: PASS (both digests match the pins byte for byte). Progress in index status: **refuted** — see FAIL-1 |
| 3 | No model-server, no daemon, no exec of downloaded code | PASS | Independently confirmed: zero `11434`/`api/tags` in the shipped bundle, one listening socket, no spawned process |
| 4 | node_modules delta recorded; wasm-vs-native justified with measurements | PASS | Recorded (+137.4 MiB), corroborated independently by INFRA-012 (+140.2 MiB); throughput ~30 ms/chunk measured by me against the log's 45.6 |
| 5 | Engine reports availability()/identity per SERVER-043's interface; SERVER-044 consumes it unchanged | PASS | `identity: local/all-MiniLM-L6-v2@384` observed end to end through status, search, related and doctor |

### Criterion 2, first half — hash pins, independently verified

Cold cache (`/usr/bin/find …/cache -type f | wc -l` → **0**), real download triggered by the first
index pass:

```
$ /usr/bin/shasum -a 256 …/all-MiniLM-L6-v2@751bff37182d3f1213fa05d7196b954e230abad9/*
afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1  model_quantized.onnx
da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0  tokenizer.json
$ /usr/bin/stat -f '%z'
22972370   model_quantized.onnx
  711661   tokenizer.json
```

Both digests **and** both byte counts equal the pins recorded in this issue's log, exactly. The
download is lazy and boot-free, as claimed:

```
{"info":"semantic index disabled: the all-MiniLM-L6-v2 embedding model (22.6 MiB) has not been
  downloaded yet; it downloads on the first index run and search is lexical until then"}   ← boot
{"info":"semantic index: the all-MiniLM-L6-v2 … not been downloaded yet …"}                ← worker's first pass
{"info":"downloading the all-MiniLM-L6-v2 embedding model (22.6 MiB) into …/eval-p8/cache/… —
  this happens once per machine"}
{"info":"the all-MiniLM-L6-v2 embedding model is cached in …; semantic indexing can start"}
{"info":"semantic index: embedding with local/all-MiniLM-L6-v2@384 (embedded)"}
```

`CORPUS_MODEL_CACHE_DIR` is honoured end to end — the artifacts landed in my scratch directory, not
in `~/Library/Caches/corpus`.

### Criterion 3 — no model server, independently confirmed

```
sockets held by the server process, six samples across a live 581-chunk drain:
  node 81260 … 17u IPv4 … TCP 127.0.0.1:8808 (LISTEN)
  ESTABLISHED outbound: 0   (at indexed = 64, 176, 240, 320, 416, 512)

$ /usr/bin/grep -c 11434         dist-package/server/main.js  → 0
$ /usr/bin/grep -c "api/tags"    dist-package/server/main.js  → 0
$ /usr/bin/grep -c "ollama serve" dist-package/server/main.js → 0
$ /usr/bin/pgrep -f inference-worker (mid-drain and after)    → the worker is a thread, not a process
```

One socket, its own. Nothing listens, nothing is spawned, nothing is installed.

## Failures

### FAIL-1: Model-download progress is not surfaced in `index status`

**Criterion**: AC 2 — "First run without the cache: model downloads with **progress surfaced in
index status**, hash-verified" (checked `[x]`). Also the issue Summary: "Downloads happen lazily on
first index need, **with progress visible in index status**."

**Expected**: while the ~23 MiB model is downloading, `corpus index status` /
`GET /api/index/status` conveys that a download is in flight and how far along it is.

**Observed**: the status payload has no field capable of carrying it, and shows nothing. Sampled
three times across a live download, with the cache directory measured in the same breath so the
download is provably in flight:

```
--- t=1                          --- t=2                          --- t=3
identity  local/all-MiniLM-…@384  identity  local/all-MiniLM-…@384  identity  local/all-MiniLM-…@384
indexed   81                      indexed   81                      indexed   81
pending   0                       pending   0                       pending   0
failed    0                       failed    0                       failed    0
rebuilding no                     rebuilding no                     rebuilding no
state     disabled                state     disabled                state     disabled

du -sk …/cache:  696 KiB          du -sk …/cache: 23,132 KiB        du -sk …/cache: 23,132 KiB

--json (identical at all three samples):
{"indexed":81,"pending":0,"failed":0,"identity":"local/all-MiniLM-L6-v2@384","rebuilding":false,"state":"disabled"}
```

The cache grew from 0.7 MiB to 22.6 MiB between samples 1 and 2 — the download was demonstrably
running — and the status output is byte-identical throughout and says only `disabled`. The
`availability().detail` string the log says would be rendered ("downloading … 32% … semantic ranking
starts once it is cached") exists only in `.corpus/server.log`; the wire payload is six fields and
none of them is a reason, a detail, or a progress figure. An operator running `corpus index status`
during a first-run download sees a workspace that looks permanently disabled.

**Steps to reproduce**:

1. `corpus init <ws> --port 8808`
2. `export CORPUS_MODEL_CACHE_DIR=<empty scratch dir>`
3. `corpus server start --workspace <ws>`
4. Within the next ~30 s, repeatedly: `corpus index status` and `corpus index status --json`, and
   `du -sk $CORPUS_MODEL_CACHE_DIR` alongside them.
5. Observe the cache growing to 22.6 MiB while every status render is identical and mentions no
   download.

**Scope note**: this is an unmet *issue* acceptance criterion, not a SPEC violation. SPEC §9.1's
requirement — "`corpus index status` reports how much content awaits indexing" — is met (`pending`
was correct, 80, on the first cold boot). The download-progress promise is SERVER-048's own, and it
is currently false. It cannot be fixed inside SERVER-048 alone: the payload is CONTRACT-023's shape,
so surfacing it needs a contract addition (an optional detail/progress field) plus SERVER-046 and
CLI-020 rendering it.

## Observations (not failures)

- **O-1.** The engine self-heals from a stale negative resolution only after a cooldown, so a
  first-run workspace can read `indexed: 81, pending: 0, identity: <recorded>, state: disabled` for
  up to ~30 s after the download finishes and the drain completes. Combined with FAIL-1, the first-run
  experience is: "disabled" for the download, then "disabled" for another half minute, with no
  explanation on either surface. Fixing FAIL-1 would largely fix the perception of this too. Recorded
  in full in the SERVER-045 verdict (O-1) since resolution lives there.

## FIXED — addendum (2026-08-01, server-dev; the verdict above is untouched)

FAIL-1 and O-1 are both addressed. The verdict stands as written until the evaluator
re-verdicts; this section only records what changed and the evidence for it.

**What shipped.** The orchestrator granted a bounded contract rider: `IndexStatus` gains one
**optional** `detail?: string` — the state enum did not move (a `downloading` value would be a
migration for every client and still would not carry a percentage). Backward compatibility is
asserted rather than reviewed, in `packages/contract/src/schemas/index-maintenance.compat.test.ts`.
`maintenance.status()` populates it from the same reading of the facts that produces `state`;
`corpus index status` prints it as one unlabelled line under the six labelled ones, and prints
nothing when the server sends nothing.

**FAIL-1 — the sentence now reaches the wire, and it moves.** Your reproduction, re-run on a
real server against a cold `CORPUS_MODEL_CACHE_DIR` (port 8805, 60 chunks, 250 ms sampling,
`--json` payloads unedited):

```
11.44s  cache= 0.0MiB  "state":"disabled","detail":"the all-MiniLM-L6-v2 embedding model (22.6 MiB) has not been downloaded yet; …"
11.96s  cache= 0.7MiB  "state":"disabled","detail":"downloading … (0.7 MiB of 22.6 MiB, 3%) — semantic ranking starts once it is cached"
12.96s  cache= 3.5MiB  "state":"disabled","detail":"downloading … (3.5 MiB of 22.6 MiB, 15%) …"
13.22s  cache=14.4MiB  "state":"disabled","detail":"downloading … (14.4 MiB of 22.6 MiB, 63%) …"
```

Your FAIL-1 note that "the status output is byte-identical throughout" was the exact symptom
under test: the payload now changes between samples because a status read re-asks the engine's
`availability()` (two `stat`s — no network, no model load) for as long as the cached resolution
is waiting on a download. `corpus index status` renders it:

```
identity    none recorded yet
indexed     0
pending     60
failed      0
rebuilding  no
state       disabled
downloading the all-MiniLM-L6-v2 embedding model (21.4 MiB of 22.6 MiB, 94%) — semantic ranking starts once it is cached
```

**O-1 / LEDGER-1 — the ~30 s cooldown window is gone.** Same run, and a "before" run of the
same build with the new behaviour switched off at its seams (port 8804, temporary flag since
removed — no `CORPUS_RIDER_OFF` remains in the tree):

| | before | after |
| --- | --- | --- |
| download completed | 3.11 s | 13.47 s |
| `indexed == total`, identity recorded | 9.24 s | 20.23 s |
| first `state: current` | never within a 30.6 s observation | 20.23 s — the same sample |
| blind window after the index completed | **≥ 21.3 s** | **0.00 s** |

The mechanism is an explicit invalidation rather than a shorter cooldown: the engine announces
a completed download (`onModelReady`, wired in `lifecycle.ts`) and a status read that finds the
model present ends the wait itself. The cooldown is unchanged for what it exists for — a
configured endpoint that is down still costs one timeout per cooldown, and now says so:
`ollama endpoint http://127.0.0.1:19999/api/embed is unreachable: fetch failed`, on the second
render as well as the first.

Also visible in the after-run and worth noting for the re-verdict: between the first vector and
the last, the workspace now reports `stale` (16/60, 32/60, 48/60) instead of `disabled` — the
draining state your LEDGER-1 was looking at.

**Not changed**: the `state` enum, the six existing fields, `--json`'s shape when there is
nothing to say (byte-identical to what you sampled), and the `semanticIndex` word on
`/api/search` and `/api/docs/{id}/related`.

## Summary

4 of 5 criteria pass, and the ones that pass are strong: the hash pins verify byte for byte against a
real HTTPS download into a cold scratch cache, the download is lazy rather than boot-time, and the
in-process posture is confirmed by zero outbound sockets across a full drain plus zero daemon-probe
strings in the shipped bundle. AC 2 is half-met — hash verification yes, progress-in-status no — and
is checked `[x]` in the issue file. The issue should not carry a completed AC that the shipped status
endpoint structurally cannot satisfy: either the criterion is amended (with the ruling recorded, as
this batch has done elsewhere) or the field is added across contract → server → CLI.

---

# RE-VERDICT — 2026-08-01, against `ed07f54`

**Verdict**: **PASS** — 5 of 5 criteria. FAIL-1 closed, LEDGER-1 closed.

Re-run from a clean slate, not a patched-up rig: `npm run build` on `ed07f54`, a **new** workspace
`…/eval-p8/ws2` from `corpus init`, a **new** cold cache `…/eval-p8/cache2`
(`/usr/bin/find … -type f | wc -l` → **0**), 16 seeded documents / 92 chunks, port 8808, 8765 never
bound. Sampled two ways at once: `GET /api/index/status` every 250 ms from a separate process
(351 samples) and `corpus index status` through the real bin every ~3 s, with `du -sk` on the cache
beside each human sample so the download is provably in flight.

## FAIL-1 — closed

The `detail` field is on the wire and it moves. Every distinct value, in order:

```
+  1291ms  disabled  the all-MiniLM-L6-v2 embedding model (22.6 MiB) has not been downloaded yet;
                     it downloads on the first index run and search is lexical until then
+  1808ms  disabled  downloading the all-MiniLM-L6-v2 embedding model (0.7 MiB of 22.6 MiB, 3%) — semantic ranking starts once it is cached
+  2577ms  disabled  downloading … (1.5 MiB of 22.6 MiB, 6%) …
+  2829ms  disabled  downloading … (6.2 MiB of 22.6 MiB, 27%) …
+  3080ms  disabled  downloading … (13.6 MiB of 22.6 MiB, 60%) …
+  3334ms  disabled  downloading … (21.7 MiB of 22.6 MiB, 96%) …
+  3592ms  disabled  local/all-MiniLM-L6-v2@384 is ready; the index has no vectors yet, so ranking is lexical until the first ones land
+  7127ms  stale     (detail absent)
```

Monotone percentages tracking the real transfer, then a distinct ready-but-no-vectors sentence — the
state the old build could not distinguish at all. Rendered by the CLI too, with the cache size
measured in the same breath:

```
--- human sample 2 (t≈6s, cache=1056KiB) ---        --- human sample 3 (t≈9s, cache=23280KiB) ---
identity    none recorded yet                        identity    none recorded yet
indexed     0                                        indexed     0
pending     92                                       pending     92
failed      0                                        failed      0
rebuilding  no                                       rebuilding  no
state       disabled                                 state       disabled
downloading the all-MiniLM-L6-v2 embedding           local/all-MiniLM-L6-v2@384 is ready; the index
model (6.9 MiB of 22.6 MiB, 30%) — semantic          has no vectors yet, so ranking is lexical
ranking starts once it is cached                     until the first ones land
```

Compare the original FAIL-1: three samples, byte-identical, cache growing 696 KiB → 23,132 KiB,
nothing on either surface. The blind window is gone.

## LEDGER-1 — closed, measured at 0 ms

```
first sample with indexed==total & identity recorded : +10669ms  (state=current)
first sample reporting state=current                 : +10669ms
MEASURED WINDOW = 0 ms
samples that were caught-up-with-identity but NOT current: 0   (was 12+ consecutive before the fix)
```

The whole cold-start trajectory is now continuous — no dead interval anywhere:

```
+  1291ms disabled  indexed=0  pending=92  identity=None                        ← model absent, detail explains
+  7127ms stale     indexed=16 pending=76  identity=local/all-MiniLM-L6-v2@384  ← first vectors land
+  7636ms stale     indexed=32 pending=60
+  8648ms stale     indexed=48 pending=44
+  9406ms stale     indexed=64 pending=28
+ 10163ms stale     indexed=80 pending=12
+ 10669ms current   indexed=92 pending=0
```

`disabled → stale → current`, with `stale` correctly appearing the moment the identity is recorded —
where the old build reported `disabled` for ~30 s with a complete index behind it.

## Byte-compatibility — `detail` is present only when it has something to say

| state | samples | with `detail` | without |
| --- | --- | --- | --- |
| `disabled` | 21 | 21 | 0 |
| `stale` | 14 | 0 | 14 |
| `current` | 311 | 0 | 311 |

The caught-up payload is byte-identical to the pre-fix contract — the original six keys, nothing
added:

```
$ corpus index status --json
{"indexed":92,"pending":0,"failed":0,"identity":"local/all-MiniLM-L6-v2@384","rebuilding":false,"state":"current"}
keys: ['failed', 'identity', 'indexed', 'pending', 'rebuilding', 'state']
```

Optional and absent-by-default, so CONTRACT-023's Phase A compatibility is untouched. The retrieval
envelopes did not gain the field either: `search keys: ['hits','semanticIndex']`,
`related keys: ['related','semanticIndex']`.

## Configured-dead-port — the detail names the endpoint

Nothing listening on 8899, against a complete 92-vector index:

```
$ corpus index status
identity    local/all-MiniLM-L6-v2@384      ← preserved
indexed     92                              ← preserved
pending     0
failed      0
rebuilding  no
state       disabled
ollama endpoint http://127.0.0.1:8899/api/embed is unreachable: fetch failed

$ corpus index status --json
{"indexed":92,"pending":0,"failed":0,"identity":"local/all-MiniLM-L6-v2@384","rebuilding":false,
 "state":"disabled","detail":"ollama endpoint http://127.0.0.1:8899/api/embed is unreachable: fetch failed"}

detail present: True   names 127.0.0.1:8899: True   leaks the api key: False
$ /usr/bin/grep -c "sk-eval-SECRET-xyz789" .corpus/server.log   → 0
```

The operator now gets the endpoint from `corpus index status` itself rather than only from
`db doctor`'s warning, and the API key still never reaches a log line or the wire.

## Regression check

The fix touched three workspaces, so the payoff was re-verified on the new workspace:

```
corpus search "physician prescribed antibiotics" → ['doc_evalphys01','doc_evaldoct01']  current
corpus search "doctor gave medicine illness"     → ['doc_evaldoct01','doc_evalphys01']  current
corpus doc related doc_evalphys01                → top: doc_evaldoct01 similar | current
corpus db doctor                                 → projection is clean — 25 documents from 25 files, exit=0
```

Both directions of the keyword-disjoint paraphrase pair still resolve; envelopes unchanged; doctor
clean.

## Re-verdict criteria table

| # | Criterion | Result |
| --- | --- | --- |
| 1 | Zero-config with the model cached: in-process, no network during embed | PASS (unchanged) |
| 2 | First run without the cache: downloads with **progress surfaced in index status**, hash-verified | **PASS** — moving percentages on wire and CLI; hashes unchanged and still pinned |
| 3 | No model-server, no daemon, no exec of downloaded code | PASS (unchanged) |
| 4 | node_modules delta recorded; wasm-vs-native justified | PASS (unchanged) |
| 5 | availability()/identity per SERVER-043's interface; SERVER-044 consumes unchanged | PASS (unchanged) |

**5 of 5.** The fix does the honest thing rather than the cheap one: an optional field that is absent
whenever there is nothing to report, so the caught-up payload stays byte-identical, and a state
machine that no longer has a blind interval between "model ready" and "ranking semantic".
