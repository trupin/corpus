# Evaluation: SERVER-007 — Watcher + SSE invalidation

**Date**: 2026-07-27
**Sprint**: sprint-004
**Verdict**: **PASS** (24 of 24 criteria)

Environment: real `corpus init` workspace `/tmp/eval-s4-int-jpZ9yy/ws`, real server process
(`./node_modules/.bin/tsx apps/server/src/main.ts --workspace $WS`, `CORPUS_LOG_LEVEL=debug`) on
**port 8840** (evaluator range; 8765 never bound, verified free at start and end). SSE observed with
**`/usr/bin/curl -sSN`** holding real sockets. Out-of-band edits by real `printf >>`, `sed -i ''`,
`mv`, `rm`, atomic write+rename. Projection read with the `sqlite3` CLI. Every process stopped by
pid. Baseline corpus: the 6 documents `corpus init` seeds (1 template, 3 views, 2 skills).

> **Harness note.** A shell hook in this environment wraps bare `curl` and buffers its output; SSE
> clients started as plain `curl` receive nothing even though the server logs them as attached. All
> results below use `/usr/bin/curl` explicitly. An evaluator who does not do this will misread the
> silence as a server defect.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                      |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Filled, structured per test group.                                                                          |
| Commands are specific and concrete      | PASS   | Real ports, real scratch paths, real `sqlite3` dumps, real frame bodies.                                     |
| Real E2E (not mocked)                   | PASS   | Real process, real sockets, real filesystem writes. No `app.request()` in the E2E section.                   |
| Scenarios cover acceptance criteria     | PASS   | Every AC has matching evidence; the deferred commit leg is named, not hidden.                                |
| Application restarted after changes     | PASS   | Boot lines with `"watcher ready","roots":7` present.                                                         |
| Actual model recorded (implemented on:) | PASS   | "implemented on: opus".                                                                                      |
| Reproduction logged before fix (bugs)   | N/A    | Feature, not a bug.                                                                                          |

Every numeric claim I re-measured landed in the same band as the log's. Latency medians differ
slightly (mine 146/145 ms vs the log's 132/137 ms) — my measurement includes a poll loop; both are
far under budget. No claim in the log was found to be inflated.

## Criteria Results

| #   | Criterion                                             | Result | Notes                                                                                                                                                 |
| --- | ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Batch of 100 writes → one invalidation, not 100        | PASS   | 100 `printf` writes in a tight loop → **1** `invalidate` frame (bound is ≤5). Key union covers all 100 doc ids (0 missing). `count(*) from documents` = 106 = 6 seed + 100. |
| 2   | Every key is a `QueryKey` array, never a bare string   | PASS   | Every frame parsed with the contract's own `InvalidatePayloadSchema` → 0 failures; every element of `keys` is an array.                                 |
| 3   | Queue broadcasts through the same bus                  | PASS   | `claim-all` and `complete` over HTTP each delivered `{"keys":[["queue"],["jobs"]]}` on the same attached stream.                                        |
| 4   | Unsubscribed subscriber stops receiving                | PASS   | Covered by #9/#12: killed client receives nothing further, remaining client receives everything, publish never throws (0 error lines).                  |
| 5   | `text/event-stream`, only `invalidate` frames          | PASS   | `content-type: text/event-stream`; across the mutation-heavy capture the set of event names on the wire was exactly `{event: invalidate}`; comments only `:connected` / `:hb`. |
| 6   | Both auth forms work, and only on `/events`            | PASS   | `?token=` → 200 stream; `Authorization: Bearer` → 200 stream; `GET /api/docs?token=$TOKEN` → **401**.                                                    |
| 7   | Missing/wrong token rejected before any frame          | PASS   | Both **401**, `content-type: application/json`, contract error body, no frame.                                                                          |
| 8   | Idle stream kept alive by heartbeat                    | PASS   | **6** `:hb` frames over ~65 s idle; measured interval **exactly 25.0 s**; all 3 connections still open; an edit at t=62 s delivered on the same sockets. |
| 9   | Dead subscriber pruned, not 500'd                      | PASS   | Victim `kill -9` mid-burst; survivor received both subsequent mutations (`doc_bulk050`, `doc_bulk051`); **0** `error`-level log lines; `/api/health` 200. Registry dropped from 5 to 1. |
| 10  | Concurrent subscribers see the same invalidation       | PASS   | 3 clients; `diff` of all `data:` lines byte-identical across all three.                                                                                  |
| 11  | **Rule 3 absolute** — no frame ever carries data       | PASS   | Mutation-heavy scenario (10 doc edits incl. a 600-char body and an anchored doc, an unlink, queue claim/complete, a lock file, a job log line): 6 frames, **0 violations**. Every payload's key set is exactly `{"keys"}`; no `doc`/`body`/`title`/`thread`/`turn`/`job`/`event`/`payload`/`excerpt`/`path`/`status`/`author` field at any depth. |
| 12  | Client disconnecting mid-write does not disturb server | PASS   | 30-file burst with a `kill -9` during it; `/api/health` 200, `/api/docs` 200, process alive; later `kill -TERM` → `shutting down` → `shutdown complete`, no pidfile, port free. |
| 13  | Every §9.1 root is watched                             | PASS   | All 8 roots produce a frame **and** a projection row: 5 document roots → `documents`; `.corpus/queue/` → `events`; `.corpus/locks/` → `locks`; `.corpus/jobs/` → `jobs`. See note below.  |
| 14  | Out-of-band add and change both upsert                 | PASS   | Create → exactly 1 row; `sed -i ''` edit → same row, `body_excerpt` shows `6.4%`, row count still 1.                                                     |
| 15  | Unlink deletes rows and invalidates                    | PASS   | `documents`/`search`/`anchors`/`links` rows gone; 1 frame; **both child threads survive** as orphaned records with `parent_id` intact; `GET /api/docs` no longer lists it; health 200. |
| 16  | Directory rename keeps ids stable                      | PASS   | `mv data/docs/finance2 data/docs/money`: same 3 ids, new paths, `count(*)` unchanged at 117, 0 duplicate ids, 0 rows on the old path.                     |
| 17  | Editor noise ignored; atomic rename not over-ignored   | PASS   | `.swp`, `#file#`, `~`, `.DS_Store`, `.txt` → **0** frames, 0 rows, byte count of the SSE log unchanged. Atomic write+rename of a real document → **exactly 1** frame and 1 row. |
| 18  | Out-of-band `evt_*.json` → `events` row, no restart    | PASS   | Parked `GET /api/queue/idle?timeout=30` on an empty queue woke in **493 ms**; `events` row present **before any claim and without a restart**; `.gitkeep` files produced 0 rows; `doctor` → `{"ok":true,"drift":[]}`. |
| 19  | Server-originated write projects once                  | PASS   | `claim-all` → exactly **1** frame; `complete` → exactly **1** frame. The real file moves under `.corpus/queue/` added none.                              |
| 20  | Suppression matches on content, not on path            | PASS   | After `claim-all` registered the self-write, an external `printf` of **different** bytes to the same path within the TTL was **not** suppressed: a second frame fired and the row updated to `type=EXTERNALLY.REWRITTEN`, `payload_json` `{"marker":"external"}`. |
| 21  | External edit around an anchor remaps the selector     | PASS   | Committed `rates.md` + `anc_k4f7`; `sed -i '' s/6.1%/6.4%/` → on-disk `exact: assume a 30-year fixed at 6.4%`, `prefix`/`suffix` recomputed; `resolved_offset` **23** (non-NULL); thread not orphaned; exactly 1 frame. |
| 22  | `git show HEAD:` is `oldBody`; absence handled         | PASS   | (a) committed → reconciles as #21. (b) brand-new untracked anchored doc → projected, frontmatter **byte-identical**, `resolved_offset` 12→9, 0 errors. (c) repo with **zero commits** → frontmatter sha before == after, `resolved_offset` 9, **0** error/stack lines, row carries the new body, health 200. |
| 23  | Anchor write-back does not loop                        | PASS   | 1 frame for the edit (bound ≤3); file reached a fixed point (`shasum` identical after 3 s); exactly **1** `reconciled anchors` log entry for the path.   |
| 24  | External edit visible as SSE well under 250 ms         | PASS   | 5 runs each. Plain document: **min 122.1 / median 145.7 / max 150.3 ms**. Anchored + committed (pays `git show` + reconciliation): **min 139.6 / median 145.3 / max 158.3 ms**. Both under 250 ms; the anchored path costs ~0–10 ms more — no escalation needed. |

## Sanctioned deviations — verified on their merits

**Non-consuming self-write registry.** The issue's Technical Design says the watcher "drops an event
whose path+hash matches a registered entry **and removes it**"; the shipped registry does not consume
the entry. The justification offered was that an anchored atomic-rename edit must still produce
exactly one frame. **Verified**: two consecutive atomic-rename saves (write temp → `mv` over) of the
committed, anchored `rates.md` produced **exactly 1 frame each**, with the anchor correctly remapped
both times (`6.4% → 6.9% → 7.2%`, `resolved_offset` 23 throughout). A consuming registry would let the
second filesystem event of the rename pair through as a spurious second frame. The deviation is
justified, and TEST-20 confirms it does not weaken content-based matching.

**Commit leg `DEFERRED → SERVER-005`.** Confirmed honestly recorded, not faked: the server logs
`{"msg":"reconciled anchors after an out-of-band edit","remapped":1,"orphaned":0,"commit":"deferred"}`
and `git log -1` in the workspace still shows the seed commit. I exercised the documented
consequence directly — two successive out-of-band edits both reconciled against the still-stale
`HEAD` (`6.1%`) and both produced correct selectors. The degradation is graceful, as claimed.

**No subscriber cap** (Adjudication 4). Confirmed: the registry grew to 5 subscribers with no 503,
and pruning is what reclaims them (#9).

## Notes

**`.corpus/jobs/` requires the contract's `.jsonl` extension.** A file written as
`.corpus/jobs/<eventId>.log` produces no frame and no `jobs` row; `.corpus/jobs/<eventId>.jsonl` with
`{"ts","line"}` lines produces both, on create and on append. This is **correct** — `JobLogLine`'s
schema documents the path as `.corpus/jobs/<eventId>.jsonl`, and a stray `.log` is non-corpus noise
of exactly the kind TEST-17 requires be ignored. Recorded because my first pass mis-fixtured it and
briefly looked like a missing watch root; it is not.

**One unreproducible observation.** A single append once appeared to produce 2 identical frames. It
did not reproduce: 3 further trials on the same file and 5 on distinct files each produced exactly 1.
The observation occurred while the buffered-`curl` harness described above was in play, which is the
likely explanation. Not counted as a failure; recorded for completeness.

## Summary

**24 of 24 criteria pass.** The live-update loop is real end to end: a hand outside Corpus writes a
file, the watcher debounces it into one coalesced batch, reconciles anchors against git HEAD, writes
the remapped selector back to disk, re-projects, and announces it as a single data-free `invalidate`
frame in ~145 ms. Rule 3 held under a deliberately hostile capture. Zero `error`-level log lines
across a 25-minute session that included `kill -9` of a mid-stream subscriber, a 100-file burst, a
directory rename, an unlink with orphaned children, and two atomic-rename anchor edits. Both
authorized deviations (non-consuming suppression, deferred commit) were checked against their stated
justifications and hold.
