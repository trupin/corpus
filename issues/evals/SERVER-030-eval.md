# Evaluation: SERVER-030

**Date**: 2026-07-30
**Sprint**: sprint-015 (wave 1, stage B)
**Verdict**: **PASS** — _(first pass: PARTIAL; both failures closed in the fix round, see
"Re-evaluation (2026-07-30)" at the end of this file)_

Evaluated against the committed tree (`4613b08 [SERVER-030]` on `phase-5-followups`, plus the
console rendering that landed in `b4aa5b1`), rebuilt once with `npm run build`. Real workspace at
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s015-eval-srv030-6VltMe`, real server on **9197**
(pids 50330 then 52403), real locks, real threads, real SSE, and the **real board read from the live
DOM** in a headless Chromium pointed at the running server. `8765` was never bound, probed or killed.

The server transition itself is excellent and every automatic-re-entry property re-derived cleanly.
Two contracted criteria do not hold, and both are console/CLI-surface criteria that the E2E log does
not address.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                                                       |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Long, well-organised log with a pre-fix red-test capture and a deliberate-changes table.                                                                                                       |
| Commands are specific and concrete      | PASS   | Real `curl` lines, real HTTP codes (423, 409, 404, 204), real event ids, real timings (`idle returned: HTTP 200 after real 3.04s`).                                                             |
| Real E2E (not mocked)                   | PASS   | Real workspace, real server, real `comment.created` from a real thread, real user-held lock producing a real 423.                                                                              |
| Scenarios cover acceptance criteria     | **FAIL** | **TEST-355 and TEST-356 appear nowhere in the log** — `grep -c "TEST-355"` and `"TEST-356"` both return **0**, and section "C. SSE and the console" is missing entirely (the log jumps B → D). The sprint's "Deferred verification is recorded, not skipped" clause makes silent omission a fail in itself; on test, TEST-356 also genuinely fails. |
| Application restarted after changes     | PASS   | TEST-348/353 do a real stop/start cycle; I re-derived it.                                                                                                                                       |
| Actual model recorded (implemented on:) | PASS   | `implemented on: **opus**` (TEST-364).                                                                                                                                                          |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue. (The log does capture a pre-change red — `json-body.test.ts` 4 failed → 7 passed — which is good practice.)                                                                       |

The domain agent's completion checklist is also entirely **unchecked** (all five boxes), while the
log is complete. Bookkeeping, not behaviour, but it should be reconciled.

## Criteria Results

| #   | Criterion                                                                                       | Result  | Notes                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| AC1 | A claimed event blocked on a user-held lock can be deferred **through the CLI**, not counted failed | PARTIAL | The server half is fully live and re-derived. **There is no CLI verb**: `corpus queue --help` lists `idle, claim-all, complete, fail, abandon, reap-stale, halt, resume, status` — no `defer` — and `docs/cli.md` has no `corpus queue defer` entry. The transition is unreachable by the agent, which is the only consumer that matters. Honestly disclosed in the log's Follow-ups, but the criterion is ticked `[x]`. |
| AC2 | Release, force-break or reap re-enters into `pending`; SSE keys cover the transition                | PASS    | All three re-derived, plus the exact invalidation frames.                                                        |
| AC3 | Console/jobs surface distinguishes deferred from failed                                             | PARTIAL | Counts, status label and dot treatment all land and are distinct (TEST-355 PASS). **The console never names the blocking document** (TEST-356 FAIL).  |
| AC4 | Orchestrate-skill rider filed and §7 reconciled — routed, not applied                               | PASS    | `git diff` for `4613b08` touches no `SPEC.md`, no `packages/contract`, no `assets/workspace/`. `issues/agent-runtime/007-orchestrate-defer-verb.md` exists and is at `issues/PLAN.md:179`. |

### Re-derived acceptance tests

| #        | Criterion                                            | Result | Observed                                                                                                                                                                                                                                                          |
| -------- | ---------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-344 | rider boundary settled before code                   | PASS   | No status is smuggled as free text: `deferred` is a first-class enum value served by `GET /api/queue/status` and `GET /api/jobs`, and `packages/contract` was changed only by the orchestrator-sequenced `3717887 [CONTRACT-020][CONTRACT-021]`.                       |
| TEST-345 | claimed event deferred without being failed          | PARTIAL | Server half **PASS**, fully realistic: user acquires the lock (`201`), the agent's `PUT /api/docs/doc_5to6656i` returns **HTTP 423** `doc_5to6656i is being edited by user`, the defer returns 200, the event file moves `in-progress/ → deferred/`, and the counts go `inProgress 3→2, deferred 4→5` with **`failed` unchanged at 5**. CLI half **FAIL** — no `corpus queue defer` verb exists. |
| TEST-346 | blocking document recorded on the event              | PASS   | On disk: `{"id":"evt_tqp7tsjqooj3","status":"deferred","blockedOn":"doc_wykgl5me","deferReason":"the user is editing this document"}`. Supplied at defer time; `blockedOn` is required (`400` when omitted) and pattern-checked (`400` on `"not-an-id"`).             |
| TEST-347 | deferred event not claimable while it waits          | PASS   | With 4 deferred and 1 pending, `POST /api/queue/claim-all` returned exactly the one pending id; `GET /api/queue/idle?timeout=2` returned **HTTP 204** with 4 deferred present.                                                                                       |
| TEST-348 | not a silent drop, in any failure mode               | PASS   | Server stopped by pid (9197 → 0 listeners) and restarted: status identical (`deferred 5`), `GET /api/jobs` still reports `status:"deferred"` with `blockedOn`/`blockedOnTitle`, and `GET /api/db/doctor` → `{"ok":true,"drift":[]}` with deferrals present.           |
| TEST-349 | lock **release** re-enters into `pending`            | PASS   | `DELETE /api/locks/doc_5to6656i` → the event moved to `pending/` **with `blockedOn` and `deferReason` absent from the file**, `GET /api/jobs` reports `"status":"pending","blockedOn":null,"blockedOnTitle":null`, and `claim-all` handed it straight back. No CLI call, no `job retry`. |
| TEST-350 | lock **force-break** re-enters it                    | PASS   | See TEST-352 — the break at t≈4 s unparked a 60-second `corpus queue idle`.                                                                                                                                                                                          |
| TEST-351 | lock **reap** re-enters it                           | PASS   | Lock acquired with `ttl:1`, event deferred (`deferred 1`), slept 3 s, `POST /api/locks/reap` → `{"reaped":["doc_wykgl5me"]}` and the status flipped to `pending 1, deferred 0`; the event file was found under `pending/`.                                             |
| TEST-352 | re-entry idempotent and ordered                      | PASS   | Four events deferred on one document; a parked `corpus queue idle --timeout 60000` returned **exit 0 after 4 s** carrying **all four ids, each once**. Afterwards `pending/` held exactly 4 files, 4 unique ids, `deferred/` empty. A lock acquire+release on an **unrelated** document beforehand was a clean no-op (`deferred 4` before and after). |
| TEST-353 | re-entry survives a restart                          | PASS   | The deferral was created before the stop/start of TEST-348 and released after it; re-entry worked. File-backed, not in process memory.                                                                                                                               |
| TEST-354 | SSE covers both transitions                          | PASS   | Live `GET /events` capture on release: `{"keys":[["locks"],["locks","doc_5to6656i"],["docs","doc_5to6656i"]]}` **then** `{"keys":[["queue"],["jobs"],["docs"]]}` — the lock keys the release touches and the queue/jobs keys the re-entry does.                        |
| TEST-355 | console distinguishes deferred from failed           | PASS   | Read from the **live DOM**. Strip: `5 running · 2 queued · 1 deferred · 4 done · 4 failed` — a separate segment. Row: `<span class="job-dot deferred">` computed `rgb(169,131,75)` (sepia, shared with `pending`, **not** the pulsing `running` dot) with label text `deferred`; the failed row is `job-dot failed`, `rgb(196,85,46)`, label `failed`. It reads as waiting, not broken. |
| TEST-356 | deferred row says what it is waiting for, and clears itself | **FAIL** | Second half **PASS**: releasing the lock out of band while the drawer was open removed the deferred row and changed the strip from `2 queued · 1 deferred` to `3 queued` with `performance.getEntriesByType("navigation").length === 1` — a genuine live update, no reload. First half **FAIL** — see FAIL-1. |
| TEST-357 | interim protocol retired and stated consistently     | PASS with a caveat | `corpus queue fail --help` no longer teaches any `deferred:` prefix, and `docs/cli.md:1104` states the new semantics plainly ("A non-zero `deferred` is **not** breakage… return to `pending` on their own"). But because no `defer` verb ships, the CLI documents the new *state* while offering **no way to enter it** — the outcome is not "two documented ways to defer", it is zero. |
| TEST-358 | `job retry` still works, and its role is stated      | PASS   | Deferred (lock still held) → `{"status":"pending","blockedOn":null,"blockedOnTitle":null,"lastLine":"retry requested"}`; genuinely failed → `{"status":"pending"}`; in-progress → **409** `only a failed or deferred job can be retried`.                              |
| TEST-359 | orchestrate-skill rider filed, SKILL.md untouched    | PASS   | `4613b08` touches no `assets/workspace/`. `issues/agent-runtime/007-orchestrate-defer-verb.md` exists; `issues/PLAN.md:179` carries the row with deps `SERVER-030, AGENT-002`.                                                                                       |
| TEST-360 | template suite green, no allowlist entry             | PASS (behavioural substitute) | Every `corpus …` invocation in `assets/workspace/**` (30 distinct) resolves against `docs/cli.md`; no `corpus queue defer` appears there, correctly, since AGENT-007 is filed and not executed.                                                                |
| TEST-361 | three spent §7 sentences routed, SPEC.md untouched   | PASS   | `4613b08` touches no `SPEC.md`; the three sentences and their replacement wording are recorded verbatim in the log for SHARED-004.                                                                                                                                    |
| TEST-362 | existing queue/lock behaviour unchanged              | PASS (behavioural) | `processed`, `failed`, `abandoned`, `claim-all` atomicity, `halt`/`resume` and `reap-stale` all behaved correctly through 22 real events across all six states. The suite-composition half is source-level and outside the evaluator's remit.                     |
| TEST-363 | on-disk layout reconstructible and gitignored        | PASS   | Fresh `corpus init` → `.corpus/queue/` holds `abandoned deferred failed in-progress pending processed`, and `git ls-files .corpus` shows all **six** `.gitkeep`s tracked by the initial commit.                                                                        |
| TEST-364 | model recorded                                       | PASS   | `implemented on: opus`.                                                                                                                                                                                                                                              |
| TEST-365 | queue skeleton reconciled once, not twice            | PASS   | CLI-013's bundled rider derived the scaffold from `QUEUE_EVENT_STATUSES`; SERVER-030 did not duplicate it, and the merged tree is correct.                                                                                                                            |
| TEST-366/367 | no SPEC.md or in-place contract edit             | PASS   | `git show --stat` over `a689cee`, `8e6f61b`, `4613b08`, `bed3e7d` → none touches `SPEC.md`, `packages/contract` or `assets/workspace/`.                                                                                                                              |

## Failures

### FAIL-1: The console never names the blocking document on a deferred row

**Criterion**: TEST-356 — *"The row shows the blocking document while it waits"*; AC3 *"Console/jobs
surface distinguishes deferred from failed"*.

**Expected**: A deferred row in the console drawer identifies the document whose lock it is waiting
on. `packages/contract`'s own description of the field, served in the OpenAPI document, states the
requirement outright: *"The console needs it to say what a waiting row is waiting for: a deferred job
that names no document is indistinguishable from a stuck one."*

**Observed**: `GET /api/jobs` serves the data correctly —
`{"id":"evt_3iaqutfxejvo","status":"deferred","blockedOn":"doc_tziz3yof","blockedOnTitle":"Unrelated"}`
— but the console drawer never renders it. Read from the live DOM with the deferral deliberately
pointed at a document **different** from the thread's parent:

- row text: `comment.created · Re: Mortgage options | deferred`
- detail pane: `comment.created · Re: Mortgage options | ↗ open | deferred · started 08:10 · evt_3iaqutfxejvo`
- `document.querySelector('.console').innerText.includes('Unrelated')` → **`false`**

The blocking document `Unrelated` appears nowhere in the drawer. A user seeing this row learns that
something is deferred but not what is holding it, which is the exact failure mode the contract text
names. (It reads plausibly only when the blocking document happens to be the thread's own parent —
the common case, which is why it can pass a casual look.) The deferred row also offers no `Retry` /
`Abandon` controls, which the failed row does, so there is no in-console action either.

**Steps to reproduce**:

1. `( cd $WS && corpus init --port 9197 && corpus server start )`
2. Create two documents, `A` (with a thread that requests the agent) and `B` (unrelated).
3. `POST /api/queue/claim-all` to claim the thread's event.
4. `POST /api/locks/<B-id>` as `user`.
5. `POST /api/queue/<event-id>/defer` with `{"blockedOn":"<B-id>","reason":"…"}`.
6. Confirm the API has the data: `GET /api/jobs` shows `blockedOn: "<B-id>"`, `blockedOnTitle: "B"`.
7. Open `http://127.0.0.1:9197/` in a browser, open the console drawer, select the deferred row.
8. Neither the row nor the detail pane mentions `B`.

### FAIL-2: The deferred transition is unreachable from the CLI

**Criterion**: AC1 — *"can be moved to a non-terminal deferred state (or re-enqueued) **through the
CLI**"*; TEST-345 — *"When: The agent defers it **through the CLI**"*.

**Expected**: A CLI verb the agent can call, since the agent interacts with the system only through
the CLI (CLAUDE.md architecture decision 2) and the orchestrate skill has to be rewritten against it.

**Observed**: `corpus queue --help` lists nine verbs — `idle, claim-all, complete, fail, abandon,
reap-stale, halt, resume, status` — and no `defer`. `grep "corpus queue defer" docs/cli.md` → no hits.
The route is live and correct, but the only way to reach it is raw HTTP, which the agent never does.
AGENT-007 is consequently filed-and-blocked. The log discloses this honestly under "Follow-ups and
known gaps", yet AC1 is ticked `[x]`.

**Steps to reproduce**:

1. `corpus queue --help` — no `defer` verb.
2. `corpus queue defer <id> --blocked-on <doc>` → unknown verb.

## Summary

**20 of 23 re-derived criteria pass; TEST-356 fails outright, TEST-345 and TEST-357 pass only on
their server half, and TEST-355/356 were silently omitted from the E2E log** (which the sprint's
"Deferred verification is recorded, not skipped" clause independently makes a fail).

The server transition itself is the strongest work in this wave and nothing in it was refuted. The
single most load-bearing piece of evidence:

```
$ curl /api/queue/status               {"deferred":2, …}
$ corpus queue idle --timeout 60000 --json &      # parked at t=0
$ curl -X POST /api/locks/doc_wykgl5me/break      # at t≈4s
IDLE_EXIT=0 elapsed=4s
  → all four deferred events returned, each exactly once
$ curl /api/queue/status               {"pending":4,"deferred":0, …}
```

— a parked long-poll unparking on a force-break, with four events re-entering exactly once and no
duplicates, which is precisely the property §7 promised and the interim protocol could not provide.
The counts are also keyed correctly now: seeded 1/2/3/4/5/6 across the six states, both
`GET /api/queue/status` and `corpus queue status` report `pending 1, in-progress 2, deferred 3,
processed 4, failed 5, abandoned 6`, matching the on-disk file counts exactly — the positional-
destructure bug CLI-013 escalated is genuinely fixed.

What is missing is the last mile on both user-facing surfaces: the human cannot see *what* a
deferral is waiting for, and the agent cannot *create* one. Both are one small rider each; neither is
a defect in the transition.

---

# Re-evaluation (2026-07-30) — fix round

**Scope**: FAIL-1 and FAIL-2 only, as directed. Commits under evaluation: `8f4ee92 [CLI-015] corpus
queue defer verb (evaluator FAIL-2)` and `5314b48 [SERVER-030] Evaluator fix: console names the
blocking document (FAIL-1)`. `npm run build` re-run first, so the built CLI, server and UI match the
committed tree. Fresh workspace at
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s015-reeval-sJ8h1i`, created with the subshell-`cd`
form from outside the repository, real server on **9198** (pid 48972, stopped by pid). `8765` never
bound, probed or killed; `<repo>/.corpus` absent throughout; no repo-wide test run.

**Re-evaluated verdict: PASS.** Both failures are closed, and nothing in the fixes regressed the
first pass's 20 passing criteria.

## FAIL-2 — CLOSED. `corpus queue defer` exists and the CLI-only cycle works end to end

`corpus queue --help` now lists ten verbs including `defer  Park a claimed event on a document's edit
lock.`, and `docs/cli.md:957` carries a full `### corpus queue defer` entry with two examples.

The complete cycle, **CLI only — no `curl`, no raw HTTP** (blocking document `doc_pzk6kqzk`
"Unrelated", deliberately *not* the deferred event's thread parent `doc_jtrhonvo`):

```
$ corpus lock acquire doc_pzk6kqzk --from user
locked doc_pzk6kqzk for user, lease 300s.
$ corpus queue claim-all --from agent          → evt_2hf2omaigghj evt_nytx4r6rkiv5
$ corpus queue defer evt_2hf2omaigghj --blocked-on doc_pzk6kqzk --reason "…" --from agent
event evt_2hf2omaigghj is deferred on doc_pzk6kqzk.                                   EXIT 0
$ corpus queue status
queue running — pending 0, in-progress 0, deferred 1, processed 0, failed 1, abandoned 0
$ corpus queue claim-all --from agent          → {"events":[]}      # not claimable while it waits
$ corpus lock release doc_pzk6kqzk --from user
released the user lock on doc_pzk6kqzk.
$ corpus queue status
queue running — pending 1, in-progress 0, deferred 0, processed 0, failed 1, abandoned 0
$ corpus queue idle --timeout 8000 --json      → returns evt_2hf2omaigghj promptly
$ corpus queue claim-all --from agent          → evt_2hf2omaigghj
$ corpus queue complete evt_2hf2omaigghj --from agent
event evt_2hf2omaigghj is complete.                                                   EXIT 0
$ corpus queue status
queue running — pending 0, in-progress 0, deferred 0, processed 1, failed 1, abandoned 0
  on disk: pending=0 in-progress=0 deferred=0 processed=1 failed=1 abandoned=0
```

The agent can now reach the transition through its only interface, which is what AC1 and TEST-345
asked for. AGENT-007 is unblocked.

**Both required refusals hold:**

| Refusal                          | Observed                                                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| defer a **pending** event        | `corpus: 409 conflict: queue event evt_2hf2omaigghj is pending; only in-progress work can be deferred` — **exit 5**, the server's own conflict surfaced faithfully.                     |
| missing `--blocked-on`           | ``corpus: `corpus queue defer` requires --blocked-on <doc-id>.`` with the reason (*"that lock clearing is what returns the event to pending"*), an explicit **"Nothing was sent to the server."**, and a `corpus lock list` pointer — **exit 2**. Verified as a genuine no-op: `queue status --json` was byte-identical before and after. |

The help text is also honest about the retirement: it names itself *"the successor to the interim
protocol of failing the event with a `deferred:`-prefixed reason, so no prefix is needed or wanted
here"*, which resolves the TEST-357 caveat from the first pass — the CLI now documents the new state
**and** offers exactly one way to enter it.

## FAIL-1 — CLOSED. The console names the blocking document, and clears itself live

Same probe as the original failure, same trap: the deferral is blocked on `doc_pzk6kqzk`
"**Unrelated**", while the event's thread parent is `doc_jtrhonvo` "Mortgage options" — so a row that
merely echoes its origin cannot pass. Wire state first:

```
GET /api/jobs → {"id":"evt_b7ycv4jx6m2v","status":"deferred","blockedOn":"doc_pzk6kqzk","blockedOnTitle":"Unrelated"}
                {"id":"evt_nytx4r6rkiv5","status":"failed","blockedOn":null,"blockedOnTitle":null}
```

Read from the **live DOM**, headless Chromium at `http://127.0.0.1:9198/`, drawer opened by clicking
the strip:

```
document.querySelector('.console').innerText.includes('Unrelated')  →  TRUE   (was FALSE)

row 1  dot="job-dot deferred" rgb(169,131,75)  "comment.created · Re: Mortgage options | 🔒 Unrelated | deferred"
       .job-blocked  text="🔒 Unrelated"  title="blocked on Unrelated · doc_pzk6kqzk"
row 2  dot="job-dot failed"   rgb(196,85,46)   "comment.created · Re: Mortgage options | failed"     blocked=null
row 3  dot="job-dot done"     rgb(78,122,70)   "… | processed"                                       blocked=null

detail (deferred) "… | deferred · started 08:50 · evt_b7ycv4jx6m2v | blocked on Unrelated · doc_pzk6kqzk | Retry | Abandon"
detail (failed)   "… | failed   · started 08:49 · evt_nytx4r6rkiv5 | Retry | Abandon"   ← no blocker line
strip             "0 running · 1 deferred · 1 done · 1 failed"
```

The row carries the lock glyph plus the blocking document's **title**, with the full sentence and the
**id** in the `title` attribute; the detail pane spells the sentence out inline. Only the waiting row
carries a blocker, so deferred and failed remain distinguishable on three axes at once — dot colour,
status word, and the presence of the blocker line.

**TEST-356 second half, re-derived.** The lock was released from **outside the browser** with the
drawer open and the deferred row on screen:

```
after DELETE /api/locks/doc_pzk6kqzk (out of band):
  .console.innerText.includes('Unrelated')  →  FALSE
  row 1  dot="job-dot pending"  "comment.created · Re: Mortgage options | pending"   blocked=null
  strip  "0 running · 1 queued · 1 done · 1 failed"
  performance.getEntriesByType("navigation").length  →  1 before and 1 after
  page console errors  →  []
```

One page load throughout: the dot class, the status word, the blocker hint and the strip's counts all
followed the SSE invalidation with no reload.

## Log audit (item 3)

`### C. SSE and the console (TEST-355, TEST-356) — added by ui-dev` is now present at
`issues/server/030-queue-defer-requeue.md:260`, and it carries its own `implemented on: opus` line.
It opens by conceding both points of the original finding — that the section's absence was itself a
contract violation, and that it was hiding a real gap. **Every claim in it matches what I observed
independently**, on a different workspace, different port and different ids:

| Log claim                                                                | My observation                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------- |
| `.console.innerText.includes('Unrelated')` → `true` (was `false`)         | Confirmed, `true`.                                       |
| row shows `🔒 <title>`, `title="blocked on <title> · <docId>"`             | Confirmed verbatim in shape.                             |
| detail shows `blocked on <title> · <docId>`                               | Confirmed.                                               |
| deferred dot `rgb(169,131,75)` `--sepia`; failed `rgb(196,85,46)` `--signal` | Confirmed, exact values.                                |
| `Retry`/`Abandon` offered on a deferred job as the manual override        | Confirmed; the failed row offers the same two, and the tooltip frames Retry as an override, not the normal path — consistent with §7 keeping `job retry` manual. |
| after release: row → `pending`, blocker gone, strip counts follow, `navigation.length` 1, no page errors | Confirmed, all five.                    |

Both fix commits are correctly scoped: `8f4ee92` touches `apps/cli/**`, `docs/cli.md`, `issues/**`
only; `5314b48` touches `apps/ui/src/console/**` and `issues/server/030-…` only. Neither touches
`SPEC.md`, `packages/contract`, `apps/server` or `assets/workspace/`, so TEST-366/367 still hold.

**One process note, not a defect**: section C records its drill scratch as `/tmp/corpus-ui-drill-…`,
whereas sprint-015's binding rule is that all scratch lives under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp` and *"not `/tmp` (sprint-014's prefix)"*. Nothing
escaped into the repository and the evidence itself is sound; worth a reminder for the next batch.

## Re-evaluated criteria

| #        | Criterion                                                       | First pass | Now      |
| -------- | ----------------------------------------------------------------- | ---------- | -------- |
| AC1      | deferred state reachable **through the CLI**, not counted failed  | PARTIAL    | **PASS** |
| AC3      | console/jobs surface distinguishes deferred from failed           | PARTIAL    | **PASS** |
| TEST-345 | claimed event deferred without being failed, via the CLI          | PARTIAL    | **PASS** |
| TEST-355 | console distinguishes deferred from failed                        | PASS       | PASS     |
| TEST-356 | row says what it is waiting for, and clears itself                | **FAIL**   | **PASS** |
| TEST-357 | interim protocol retired and stated consistently                  | PASS w/ caveat | **PASS** — the caveat ("documents the state, offers no way in") is gone |
| log audit | TEST-355/356 recorded, not silently omitted                      | **FAIL**   | **PASS** |

Machine state on exit: `9195`–`9199` all free, server stopped by recorded pid 48972, no orphaned
vitest or Chromium processes, `git -C <repo> status --porcelain` showing only this evaluator's four
verdict files, and `<repo>/.corpus` absent. Whatever is on `8765` is exactly as it was.

**Final verdict: PASS.** 23 of 23 criteria hold. No claim in the fix round's log was refuted.
