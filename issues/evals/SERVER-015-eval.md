# Evaluation: SERVER-015

**Date**: 2026-07-27
**Sprint**: N/A (filed mid-sprint-005 as CONTRACT-005's coupled half; evaluated against its own ACs)
**Verdict**: PASS

Evaluated against the final merged state of `phase-2-server-cli` (HEAD `879a443`), on a real
`corpus init` workspace with a real server on 127.0.0.1:8890.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                              |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Six numbered sections, filled in, no placeholder text.                                                                                                             |
| Commands are specific and concrete      | PASS   | Real `curl` with byte counts, a real `sqlite3 -header -column` join printed row by row, per-field source table, per-suite test counts.                              |
| Real E2E (not mocked)                   | PASS   | Real `corpus init` workspace, real server process, requests issued **through the generated typed client** (`createCorpusClient(...).api.GET("/api/docs", …)`), ground truth read straight from `.corpus/cache.db`. No fixtures, no test client. |
| Scenarios cover acceptance criteria     | PASS   | All six ACs have evidence, including the one the compiler could not catch (the `UNDATED_INSTANT` sentinel deletion).                                                |
| Application restarted after changes     | PASS   | Server started fresh at 127.0.0.1:8765, stopped and the port freed afterwards. The undated-skill row is explicitly noted as a **live watcher re-projection**, not a cold start. |
| Actual model recorded (implemented on:) | PASS   | "**implemented on: opus.**"                                                                                                                                        |
| Reproduction logged before fix (bugs)   | N/A    | Coupled growth, not a bug. Correctly marked N/A.                                                                                                                   |

**Honesty spot-check.** The log's most load-bearing claim — that the `stale` column a row carries
and the `stale=` filter that selects it agree because they are literally the same SQL — is not
something I can inspect without reading source, so I tested the *consequence* instead: tier ↔
filter agreement for all three tiers, on data I created myself. It held exactly. The claimed
thread-field ↔ filter agreements also reproduced. Nothing overstated.

## Criteria Results

| #   | Acceptance criterion                                                                              | Result | Notes                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Every new DocRow field populated from projection data; non-thread rows carry the null shape exactly | PASS   | Row key set is exactly the contract's **23** keys. All eight thread fields are `null` on every note/skill/view/template row I checked; all populated on thread rows. |
| 2   | Staleness tier agrees with the `stale` filter and the `stale` attention reason                     | PASS   | Reproduced across four hand-seeded ages plus an evergreen twin. See table below.                                                                                    |
| 3   | Thread fields agree with the `agent`/`unread` filters                                              | PASS   | Agreement exact for `agent=engaged\|requested\|none` and `unread=true\|false`, scoped to threads (the filters no-op on non-threads, per SERVER-011's convention).   |
| 4   | Undated-document sentinel follows CONTRACT-005's nullable decision                                 | PASS   | Epoch sentinel is gone from **both** routes. A hand-written `SKILL.md` reads `created: null, updated: null` from the list **and** from get-one; a server-created document keeps real, identical timestamps on both. |
| 5   | Repo-wide typecheck green; SERVER-011's eval-verified behaviors unchanged                          | PASS   | `npm run typecheck` exit 0 across all workspaces; full suite **2725 passed / 0 failed**; filter, FTS, needs, sorting and tree behaviors all still green.            |
| 6   | E2E: one real-workspace query showing a stale doc's tier, a fresh doc, and a thread row's fields   | PASS   | Performed independently below.                                                                                                                                     |

## Probes I ran

Seeded by hand into a live workspace (picked up by the watcher, no restart): four notes at
different ages, one evergreen ancient twin, three threads in different agent states, one
anchored thread, and one hand-written timestamp-free `SKILL.md`.

**Rows off `GET /api/docs` (typed contract shape):**

```
doc_ancient01  updated 2025-06-01  stale "very-stale"  attention ["stale"]   all 8 thread fields null
doc_stale0001  updated 2026-04-17  stale "stale"       attention ["stale"]   all 8 thread fields null
doc_aging0001  updated 2026-06-10  stale "aging"       attention []          all 8 thread fields null
doc_fresh0001  updated 2026-07-26  stale null          attention []          all 8 thread fields null
doc_evergrn01  updated 2025-06-01  stale null          attention []          ← evergreen opts out entirely
doc_skill07d757a3            created null updated null  stale null           ← unknown age is fresh, not ancient

th_engaged1  parent doc_ancient01 agent "engaged"   turnCount 2 lastAuthor "agent"
             lastTurn "Because taxes and insurance are paid annually." unread true awaitingAgent false
             attention ["unread-reply"]
th_awaitng1  parent doc_stale0001 agent "requested" turnCount 1 lastAuthor "user"
             lastTurn "Can you double-check the numbers?" unread true awaitingAgent true
th_nonethr1  parent doc_fresh0001 agent "none"      turnCount 1 lastAuthor "user"  awaitingAgent false
th_eval0001  parent doc_2y44j4hq  agent "requested" anchorQuote "The rate is fixed for eleven years."
```

**Ground truth from `.corpus/cache.db`, same joins:**

```
th_eval0001|doc_2y44j4hq|requested|anc_eval0001|1|user|2026-07-27T07:18:00Z|The rate is fixed for eleven years.
anchors: doc_2y44j4hq|anc_eval0001|The rate is fixed for eleven years.
```

`anchorQuote` matches `anchors.exact_text` column for column — and notably it **tracked an anchor
rewrite**: I had edited the anchored sentence through `PUT` (seven → eleven years) earlier in the
run, and the row's quote followed the reconciled selector rather than a stale copy.

**Tier ↔ filter agreement** (`stale=` is an at-or-beyond filter):

| Query             | Filter returned                                    | Rows whose `stale` field qualifies | Agree |
| ----------------- | -------------------------------------------------- | ---------------------------------- | ----- |
| `stale=aging`     | `doc_aging0001, doc_ancient01, doc_stale0001`      | aging + stale + very-stale         | YES   |
| `stale=stale`     | `doc_ancient01, doc_stale0001`                     | stale + very-stale                 | YES   |
| `stale=very-stale`| `doc_ancient01`                                    | very-stale                         | YES   |

The evergreen ancient twin is absent from all three despite being the same age as `doc_ancient01`
— the `evergreen` opt-out is honoured identically by the field and the filter.

**Thread field ↔ filter agreement** (threads only; the filters pass non-threads through):

```
agent=engaged   filter→[th_engaged1]              field→[th_engaged1]              agree
agent=requested filter→[th_awaitng1,th_eval0001]  field→[th_awaitng1,th_eval0001]  agree
agent=none      filter→[th_nonethr1]              field→[th_nonethr1]              agree
unread=true     filter→[th_awaitng1,th_engaged1,th_eval0001,th_nonethr1]  field→same  agree
unread=false    filter→[]                         field→[]                         agree
```

**Cross-route timestamp agreement (AC 4, the escalation SERVER-005 raised):**

```
undated skill   list row {"created":null,"updated":null}   get-one {"created":null,"updated":null}   AGREE
server-created  list row {"created":"2026-07-27T07:22:45Z",…} get-one same                            AGREE
```

No `1970-01-01` sentinel appears anywhere in either response. The divergence SERVER-005 escalated
is closed.

**Projection integrity.** 30 markdown files under the projection roots, 30 `documents` rows; no
row pointing at a missing file, no file without a row; no `.gitkeep` ever projected as a document
or an event; no `*.tmp` anywhere in the workspace.

## Failures

None.

## Notes for the record

1. **`agent=` and `unread=` return non-thread rows too.** This looks wrong at first glance — the
   filters return the whole corpus plus the matching threads. It is the documented and previously
   evaluated "thread filters no-op on non-threads" convention from SERVER-011, and agreement holds
   exactly once scoped to threads. Recorded so a future reader does not re-litigate it as a bug.
2. **`turnCount` on a thread row counts turns, and `lastTurn` is an excerpt.** Both matched the
   `threads.turn_count` / `turns.body_md` ground truth on every row I checked, including a thread
   I appended a turn to out of band.

## Summary

**6 of 6 acceptance criteria passed.** Every field CONTRACT-005 declared is populated from real
projection data, non-thread rows carry the exact null shape, the staleness tier and the `stale=`
filter cannot disagree (verified by consequence across all three tiers plus the evergreen
opt-out), the thread fields track their filters exactly, and the epoch sentinel is gone from both
response routes — closing the cross-route divergence SERVER-005 escalated rather than papering
over it. The repo typechecks and the whole suite is green.
