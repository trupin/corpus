# Evaluation: SERVER-046

**Date**: 2026-08-01
**Sprint**: sprint-021
**Evaluator model**: Opus 5 (1M context)
**Verdict**: PASS

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | Includes a full doctor fixture matrix with verdicts and reasons |
| Commands are specific and concrete | PASS | Timed 202s, poll trajectories with ms offsets, exact drift strings |
| Real E2E (not mocked) | PASS | Real server, real `curl`, real `sqlite3` fixtures against the live `cache.db` |
| Scenarios cover acceptance criteria | PASS | All four |
| Application restarted after changes | PASS | Restarts per fixture |
| Actual model recorded (implemented on:) | PASS | "implemented on: opus (Opus 5, 1M context)" |
| Reproduction logged before fix (bugs) | N/A | Feature issue |
| Deferrals recorded, not skipped | PASS | Two, both with reasons and substitutes |

**Credit where it is due**: this log volunteered the finding that ultimately became SERVER-049 — that
the embedded engine's drain blocked `GET /api/health` for 13,844 ms — including the admission that
its own TEST-896 had to be run against an HTTP provider as a result. An agent papering over its
results does not file the P0 that blocks its own phase PR.

## Criteria Results

| # | Criterion | Result | Notes |
| --- | --- | --- | --- |
| 1 | Status counts live and accurate under a draining worker; rebuild fire-and-forget and observable | PASS | Live against the **embedded** engine now (SERVER-049 removed the substitution) |
| 2 | `index rebuild` re-picks identity; `db rebuild` keeps identity and queues re-index | PASS | Both observed |
| 3 | Doctor: seeded drift fails with a named reason; pending-only passes; mixed identity fails | PASS | Reproduced independently with my own `sqlite3` fixtures |
| 4 | `rebuild && doctor` green while pending > 0 | PASS | The signed §14 invariant, reproduced |

### Criterion 1 — status live under a real embedded-engine drain

```
$ curl -X POST …/api/index/rebuild        →  202 in 0.001096s
   body {"indexed":0,"pending":561,"failed":0,"identity":null,"rebuilding":true,"state":"indexing"}
+  2078ms {"indexed":16, "pending":545,"identity":"local/all-MiniLM-L6-v2@384","rebuilding":true,"state":"indexing"}
+  6140ms {"indexed":176,"pending":385,…}
+ 10213ms {"indexed":304,"pending":257,…}
+ 14284ms {"indexed":495,"pending":66, …}
+ 16320ms {"indexed":561,"pending":0,  "rebuilding":false,"state":"current"}
```

`indexed + pending + failed == 561` at every poll; monotone; identity re-picked as it goes; `202`
returned in **1.1 ms** against a 16 s drain. Read-only confirmed: 100 consecutive polls left the
payload byte-identical.

Auth:

```
GET  /api/index/status  no-token  -> 401
POST /api/index/rebuild no-token  -> 401
GET  /api/index/status  bad-token -> 401
```

### Criterion 4 — the §14 invariant

```
$ corpus index rebuild
queued a full rebuild of the semantic index — 561 chunks to embed, identity not yet recorded, state indexing.
$ corpus db rebuild && corpus db doctor
rebuilt the projection in 55ms — 139 documents, …
projection is clean — 139 documents from 139 files (11ms)
doctor exit=0
$ corpus index status --json
{"indexed":64,"pending":497,"failed":0,"identity":"local/all-MiniLM-L6-v2@384","rebuilding":true,"state":"indexing"}
```

Clean, exit 0, immediately, with **497 pending**. Repeated mid-drain at `pending: 400` — still exit 0.
Pending asynchronous indexing is staleness, not drift.

### Criterion 3 — doctor matrix, reproduced with my own fixtures

```
baseline                                          → exit 0  "projection is clean — 140 documents from 140 files"

UPDATE chunk_embeddings SET identity='eval/other-model@768' … LIMIT 100
  → count_mismatch (no file): the semantic index holds vectors from more than one model:
    eval/other-model@768, local/all-MiniLM-L6-v2@384. Results from different models are never
    mixed (SPEC.md §9.1); re-pick one with `corpus index rebuild`
  → exit 6

UPDATE chunks SET heading_path='Fabricated Heading' WHERE doc_id='doc_evalphys01' AND ord=0
  → content_mismatch data/docs/inbox/phys.md: chunk doc_evalphys01#0 is recorded under
    "Fabricated Heading" but its chunk_search row says "Consultation"
  → exit 6

corpus db rebuild && corpus db doctor                → exit 0, every fixture healed
```

Both drift classes fail by name and both heal by rebuild. Report-only warnings never move the exit
code — the `semantic_index_unusable` warning (dead configured provider, 561 valid vectors) printed
before a **clean** verdict at exit 0, which is §14's stated shape.

### Criterion 2 — identity handling

- `POST /api/index/rebuild` → `identity: null` in the snapshot, re-picked to
  `local/all-MiniLM-L6-v2@384` within 2 s as the drain begins.
- `corpus db rebuild` on an unchanged corpus → identity unchanged, `pending` stayed **0** (OC5's
  ATTACH-copy re-attached every embedding by content address; a rebuild queues nothing).

## Failures

None.

## Observations (not failures)

- **O-1.** `failed > 0` remains unverified on a real server by anyone, including me — the retry ladder
  needs ~12 minutes. Both this issue and SERVER-044 deferred it with unit-test substitutes. Carried
  forward.
- **O-2.** After `index rebuild` against an unreachable configured provider, `rebuilding` drops to
  `false` while `pending` is 561, so the state reported is `disabled` rather than `indexing`. That is
  the published mapping applied correctly (no provider resolved wins), and it is more honest than
  claiming a rebuild is progressing when nothing can embed — recording it because it is the one state
  transition that surprised me.

## Summary

4 of 4 criteria pass, three of them re-derived independently with my own fixtures. The invariant that
the sprint contract calls "the single most important test in this issue" — `corpus db rebuild &&
corpus db doctor` clean at exit 0 with 497 chunks pending — holds.
