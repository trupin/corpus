# Evaluation: SERVER-028 — Queue transitions must invalidate `["docs"]`

**Date**: 2026-07-28
**Sprint**: sprint-010 (filed mid-sprint from UI-011's TEST-107 partial)
**Verdict**: **PASS**

Environment: a real `corpus init` workspace on 8982, the real server, the real CLI, a parallel
`/events` capture, and the production-served board in a real Chromium — i.e. the exact reproduction
UI-011 recorded, re-run end to end. No source file was read.

## E2E Proof-of-Work Audit

| Check                                    | Result | Notes |
| ---------------------------------------- | ------ | ----- |
| Verification log present                 | PASS   | Environment, the enqueue chain, the emitted frame verbatim, the `needs=me` response, tests. |
| Commands are specific and concrete       | PASS   | Real workspace path, port, pid, event id (`evt_u5fs42wzx3kr`), the frame's exact JSON, the scoped vitest command and its 16-file/272-test result. |
| Real E2E (not mocked)                    | PASS   | Real `corpus init` workspace, real server, real CLI, real `curl -sN /events`. No test client. |
| Scenarios cover acceptance criteria      | PASS   | AC-1 (both key tables) proven by the frame; AC-2 by the browser reproduction; AC-3 by the scoped suite; AC-4 by the explicit "do not remove" note. |
| Application restarted after changes      | PASS   | Fresh server started for the verification run. |
| Actual model recorded (`implemented on:`)| PASS   | "Implemented on: opus (server-dev agent) with orchestrator completion". |
| Reproduction logged before fix           | PASS   | The pre-fix behaviour is recorded in the Summary and, in detail, in UI-011's TEST-107 section (`requests against /api/docs in the following 4 seconds : []`, `Attention rows WITHOUT a reload : 0`, `Attention rows AFTER a reload : 2`) with the two source lines that caused it. That is a genuine, dated, pre-fix observation from a different agent's session — stronger evidence than a self-authored repro. |

### Audit of the orchestrator-completed portion

The log states the agent stalled and the orchestrator wrote the two operative lines and ran the
verification. Applying the same scepticism as to any log:

- The claim is **specific about what was borrowed** — which lines the agent wrote (comments, import,
  four test-suite pins) and which the orchestrator wrote (`DOCS_KEY` in `QUEUE_QUERY_KEYS` and in
  the watcher's `queue-event` push). It does not overstate authorship.
- The **evidence is verifiable independently of authorship**, and I verified it: the frame, the
  `needs=me` answer, and the live browser behaviour all reproduce. Whoever typed the two lines, the
  behaviour is real.
- The recorded frame `{"keys":[["queue"],["jobs"],["docs"]]}` matches byte-for-byte what my own
  capture produced on a different workspace and a different event id.
- The one thing I could not re-derive is the **scoped test run** (16 files / 272 tests); I did not
  re-run it per this sprint's machine-load rules. It is a plausible scope for the four touched
  suites.

**No contradictions found.**

## Criteria Results

| # | Acceptance criterion | Result | Evidence |
| - | -------------------- | ------ | -------- |
| 1 | `QUEUE_QUERY_KEYS` includes `DOCS_KEY`; the watcher's `queue-event` branch emits it too | PASS | Every queue-transition frame in my capture is `data: {"keys":[["queue"],["jobs"],["docs"]]}` — 20 frames over halt/resume/claim/fail/retry/abandon, all three keys, no exceptions. Both code paths (HTTP mutation and CLI-initiated file transition) produced it. |
| 2 | E2E: `corpus queue fail` with a browser attached → the Attention row appears with **no reload** | PASS | Reproduction below. |
| 3 | Colocated tests updated | ACCEPTED (log) | Scoped suite not re-run by this evaluator (machine-load discipline). |
| 4 | The kit-side explicit `DOCS_KEY` invalidation stays | PASS (behavioural) | Console-initiated Retry/Abandon still issue `GET /api/docs?needs=me` explicitly in their request bursts, alongside the server's frame — the belt-and-suspenders coupling is intact. |

### The reproduction, re-run in full (this is UI-011's TEST-107, now passing)

```
# real workspace on 8982, drawer open, browser attached, no reload at any point
$ corpus queue claim-all --from agent --json
  {"events":[{"id":"evt_uehma6cyqfos","type":"comment.created", …}]}
  → strip: "1 running · 0 done · 0 failed"

$ corpus queue fail evt_uehma6cyqfos --from agent
  event evt_uehma6cyqfos is failed.

# observed in the browser within ~4s, WITHOUT a reload:
strip counts                : 0 running · 0 done · 1 failed
job row dot                 : job-dot failed
/api/docs requests that followed the fail:
  GET /api/docs?pinned=true&sort=order&type=view
  GET /api/docs?needs=me                       ← the Attention query (absent pre-fix)
  GET /api/docs?folder=inbox
  GET /api/docs?status=open&type=thread
  GET /api/docs?folder=finance
  GET /api/docs?q=mortgage&sort=relevance&type=note
Attention rows (no reload)  : ["threadRe: Mortgage options … failed job on Mortgage options v2", …]
server GET /api/docs?needs=me : th_qo3k4m7t, doc_affs5ced  (reason chip: failed job)
```

Pre-fix, the same sequence produced `requests against /api/docs …: []` and
`Attention rows WITHOUT a reload : 0`. The delta is exactly the `["docs"]` key.

### Rule 3 is not weakened by the change

The added key is a key. The full `/events` capture over the whole console session (20 frames)
contains one event name only and no payload:

```
distinct SSE event names : ["event: invalidate"]
sample frame             : data: {"keys":[["queue"],["jobs"],["docs"]]}
grep "reading thread context"  → (empty)
grep "ERR subagent"            → (empty)
grep "a line nobody"           → (empty)
grep "Mortgage"                → (empty)
```

## Failures

None.

## Summary

4 of 4 acceptance criteria met. The two-line addition does what it claims: a CLI-initiated queue
transition now announces `["docs"]`, the `needs=me` query refetches on its own, and the Attention
row — the surface UI-011 could not make live from the client side — appears without a reload. The
orchestrator-completed portion of the log was audited like any other and its central claim
reproduced independently on a different workspace and event id. **PASS.**
