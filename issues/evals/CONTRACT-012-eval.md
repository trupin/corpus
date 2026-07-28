# Evaluation: CONTRACT-012 + SERVER-027 (coupled unit)

**Date**: 2026-07-28
**Sprint**: sprint-010 (TEST-71…84 + the two adjudicated riders)
**Verdict**: **PASS**

Evaluated as one unit, matching how they were built and committed (`9e4cc9e`).
All evidence below was produced by this evaluator against a **fresh `corpus init` workspace on
8982** (`/tmp/corpus-eval-s010-int-8hgjwB`), a real server, the real CLI and raw HTTP. No source
file was read; contract facts were read from the **served** `GET /api/openapi.json`.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                              |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Both issues carry substantial logs.                                                                                                |
| Commands are specific and concrete       | PASS   | Ports, pids, scratch paths, verbatim `EXPLAIN QUERY PLAN`, verbatim SSE frames, request/response bodies.                            |
| Real E2E (not mocked)                    | PASS   | Two real `corpus init` workspaces (8972 small, 8973 with 500 docs/1000 threads), real servers, real `curl`/CLI. No test clients.    |
| Scenarios cover acceptance criteria      | PASS   | Every TEST-71…84 addressed; CONTRACT-012 explicitly records `DEFERRED → SERVER-027` for the runtime half rather than omitting it.   |
| Application restarted after changes      | PASS   | SERVER-027's before/after timing run states the server was restarted between the neutralised and restored subquery.                 |
| Actual model recorded (`implemented on:`)| PASS   | Both say "Implemented on: opus."                                                                                                   |
| Reproduction logged before fix (bugs)    | N/A    | Feature/rider work.                                                                                                                |

**Honesty audit — claims re-derived independently:**

| Log claim | Re-derived? |
| --- | --- |
| `unreadThreads` = 3 for a doc with 2 unread + 1 fully seen + 1 partially seen | **YES.** Built the identical four-thread case; `GET /api/docs` → `doc_affs5ced unreadThreads=3`; `?parent=…&type=thread&unread=true` → 3 items. |
| Aggregate equals the per-thread query for every row | **YES.** 19 documents checked in one run, **0 mismatches**, one row non-zero so not vacuous. |
| Thread rows and childless docs report `0`, never null/absent | **YES.** 19/19 rows numeric; 0 thread rows with a non-zero value. |
| Moves live in both directions; SSE carries keys only | **YES.** 3 → 4 (agent reply) → 3 (seen). `curl`-equivalent capture: two `event: invalidate` frames, `{"keys":[…]}` only. |
| `Job.type` is the projection's `events.type`, not re-derived | **YES.** Event file `evt_uehma6cyqfos.json` → `"type": "comment.created"`; `GET /api/jobs` → `"type":"comment.created"`; survives `db rebuild`. |
| `includeArchived` is a union; no-op beside explicit `status` | **YES.** All seven combinations re-run — see table below. |
| `db rebuild && db doctor` stays clean, values survive | **YES.** `rebuilt … 19 documents, 7 threads, 12 turns, 1 anchor, 2 links, 1 event, 2 seen`; `projection is clean — 19 documents from 19 files`; `unreadThreads` and `Job.type` unchanged after. |
| Endpoint inventory unchanged at 42 | **YES.** Served `openapi.json` → 42 operations. |
| Generated artifacts green twice in a row | **YES.** `node --import tsx scripts/check-generated-artifacts.ts` × 2 → identical `✓ API contract is up to date` / `✓ CLI reference is up to date`, exit 0 both times. |
| One commit containing both halves | **YES.** `9e4cc9e [CONTRACT-012][SERVER-027] …` — `packages/contract` + `apps/server` + `packages/kit` in one commit. |

No contradictions found.

## Criteria Results

| #  | Criterion | Result | Notes |
| -- | --------- | ------ | ----- |
| 71 | Field declared with semantics | PASS | Served schema: `DocRow.unreadThreads` in `required`, `{"type":"integer","minimum":0}`. Description names §7, the `?parent=…&unread=true` equality, the partial-read rule, **`0` on a thread row**, **`0` on a childless document**, and "never null and never absent, so `0` always means 'nothing unread' and never 'unknown'". |
| 72 | `parentTitle` rider corrected | PASS | Description now ends: *"An orphaned thread — `parent` set, title gone — renders an **empty** context cell rather than a raw `doc_*` id, which is not the same as a standalone thread (no `parent` at all) and must not be labelled as one."* The word "standalone" as an instruction is gone. |
| 73 | Standing contract invariants | PASS | 42 operations in the served document; artifact drift check green twice in a row. |
| 74 | Break list measured | PASS (log) | Two `TS2741`s quoted with file:line; both call sites appear in the same commit's diff. Not re-derivable post-merge. |
| 75 | Reuses `UNREAD_SQL`, no second definition | ACCEPTED (log) | Source-level; not verifiable black-box. Behavioural corollary re-derived: aggregate and per-thread flag agree on all 19 rows **including the partial-read case**, which a hand-written second copy would be free to get wrong. |
| 76 | Correct across the cases that matter | PASS | See honesty audit. Partial read counts as unread in both. |
| 77 | Thread rows / childless docs report 0 | PASS | Independently re-derived. |
| 78 | Consistent with per-thread `unread`, as a property | PASS | 19 documents, 0 mismatches. |
| 79 | Moves live in both directions; keys-only SSE | PASS | Frames quoted below. |
| 80 | No N+1, no per-row explosion | ACCEPTED (log) | Statement counts and `EXPLAIN QUERY PLAN` are not observable through the public interface. Log quotes `SEARCH t USING INDEX threads_parent_id (parent_id=?)` and "statements prepared for one GET /api/docs: 2". |
| 81 | Cost measured on a real corpus | ACCEPTED (log) | Requires a code edit (neutralised subquery) to reproduce a BEFORE; out of bounds for this evaluator. The log's method (two clean AFTER runs bracketing BEFORE, then statement-level timing: +19.7 µs p50 for a 50-row page) is sound and self-critical. |
| 82 | `db rebuild && db doctor` stays clean | PASS | Re-derived. Query-time aggregate confirmed: values recomputed correctly after a rebuild. |
| 83 | UI-004's deferral discharged | PASS | `issues/ui/004-type-aware-rows.md` carries `CLOSED → CONTRACT-012 (2026-07-28)` with the original entry struck through. Docblock half is source-level; accepted from log. |
| 84 | One commit, green at that commit | PASS | `9e4cc9e` contains both halves. |
| R1 | `Job.type` rider | PASS | See honesty audit. Console rows read `comment.created · Re: Mortgage options`. |
| R2 | `includeArchived` rider | PASS | Table below. |

### TEST-79 — the frames, verbatim

```
:connected

event: invalidate
data: {"keys":[["docs"],["docs","th_qkd3fyfe"],["threads","th_qkd3fyfe"],["docs","doc_affs5ced"]]}

event: invalidate
data: {"keys":[["docs"],["docs","th_qkd3fyfe"],["threads","th_qkd3fyfe"],["docs","doc_affs5ced"]]}
```

`unreadThreads` before / after the agent reply / after the seen mark: **3 → 4 → 3**. No count on the wire.

### `includeArchived`, all seven combinations (archived document `doc_h5aaztjt`)

| Request | total | archived row present |
| --- | --- | --- |
| *(default)* | 18 | no |
| `includeArchived=true` | **19** | **yes, alongside the open ones** |
| `includeArchived=false` | 18 | no |
| `status=archived` | 1 | yes — and nothing else |
| `status=archived&includeArchived=true` | 1 | yes (no-op) |
| `status=open&includeArchived=true` | 18 | no (no-op) |
| `status=open` | 18 | no |
| `includeArchived=maybe` | **400** | validated at the boundary |

A union, exactly as adjudicated. `page.total` moves with the page (18 → 19).

## Failures

None.

## Notes for the phase PR reviewer

- TEST-80 and TEST-81 are the only criteria this evaluator could not re-derive through a public
  interface (they need statement instrumentation and a code edit). They rest on the implementer's
  log, which is specific and internally consistent.
- The consumer side of this pair is **not** wired: `DocRow.unreadThreads` is populated on the wire
  and correct, but no document row renders an aggregate pill. That is TEST-116 and is failed in
  `issues/evals/sprint-010-cross-issue-eval.md` — against UI-005's call site, not against this pair.

## Summary

14 of 14 sprint criteria plus both riders are met. Two (TEST-80, TEST-81) are accepted on the
implementer's evidence because they are not observable from outside the process; every other claim
sampled from both logs was independently re-derived and matched. **PASS.**
