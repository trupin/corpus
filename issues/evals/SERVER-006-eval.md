# Evaluation: SERVER-006

**Date**: 2026-07-27
**Sprint**: sprint-006 (`issues/sprints/sprint-006.md`)
**Verdict**: PASS

Tested black-box against a real `corpus init` workspace (`/tmp/eval-s6-RB2Qo6`), a real git
repository, a real server process on **8930** (plus **8931** for the no-git case and **8932**
for the integration workspace). Effects read from four independent surfaces every time: files
on disk, `git log`/`git show`, `sqlite3 .corpus/cache.db`, and `ls .corpus/queue/*/evt_*.json`.
SSE observed with `curl -N`. No implementation source was read for any behavioural verdict;
the three structural criteria (TEST-68/69, plus TEST-125's comment clause) are file-path and
comment-level greps, which the sprint states as greps.

Baseline confirmed before testing: 1 template, 3 views, 2 skills, 0 agent-defs, 2 commits.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes |
| --------------------------------------- | ------ | ----- |
| Verification log present                | PASS   | 22-row evidence table, environment, deferrals, payload contract, gate figures. |
| Commands are specific and concrete      | PASS   | Real ids (`th_45bvy7cx`, `anc_f1396aae`, `evt_ve44au72sit4`), real ports, real messages. |
| Real E2E (not mocked)                   | PASS   | `npx tsx apps/server/src/main.ts` on 8905/8906 against a real workspace; the generated typed client used for capture/turn multipart; no test client, no in-memory db. |
| Scenarios cover acceptance criteria     | PASS   | Every AC has a corresponding row; struck AC 8 (forms) correctly recorded as struck, not stubbed. |
| Application restarted after changes     | PASS   | "Server restarted after each fix"; BUG-2 re-verified on a **fresh** workspace on a second port, which is the only way that bug is visible. |
| Actual model recorded (implemented on:) | PASS   | "**implemented on: opus.**" plus an honest two-agent relay note and an explicit statement that the inherited modules carried no tests. |
| Reproduction logged before fix (bugs)   | PASS   | BUG-1 and BUG-2 both show the failing behaviour observed against the real running server *before* the fix, with the chokidar probe output for BUG-2 and a stated failing-then-passing regression test. |

**Independent spot-checks of the log's specific claims** — I reproduced these verbatim and they
matched: the 403 message `turn deletion is user-only; the agent never deletes turns`; the 400
message `attachments are not accepted yet: ingest and serving land in SERVER-010`; the
`commit_failed` warning shape; the `Re: "<60 chars>"` truncation constant; the event payload
shape; the latency band; `agent: engaged` on the first agent turn in a `requested` thread; the
`/comment` → `doc_skillcomment` resolution (BUG-1's fix); out-of-band `seen.json` re-projection
in ~3–4 s with no restart (BUG-2's fix).

**One claim did not reproduce** — see DISC-1. Isolated, not a pattern.

## Criteria Results

| #  | Criterion | Result | Notes |
| -- | --------- | ------ | ----- |
| 1  | Anchored creation writes both files in one commit | PASS | `201 {anchorId:"anc_857e78ea", eventId:null}`; parent gained exactly one key; one commit, 2 files changed. |
| 2  | Thread frontmatter matches §6 | PASS | id/type/title/created/updated/tags/status/parent/anchor/agent; `created == updated`; body is exactly one `## user · <ts>` turn. |
| 3  | Whole-document creation writes no anchor | PASS | `anchorId:null`, `anchor:null`, parent's `anchors` still 1 key, commit touches only the thread file. |
| 4  | Standalone has neither parent nor anchor | PASS | `parent:null`, `anchor:null`, one commit, one path. |
| 5  | Explicit `parent:null`/`selector:null` == omitted | PASS | 201, identical shape. |
| 6  | Unknown parent → 404 | PASS | `404 not_found`; 0 commits, 0 pending delta, no thread file. |
| 7  | A thread may parent a thread | PASS | `parent: th_tzguzlc4`, title `Re: Re: "…"`. |
| 8  | Whitespace-only `exact` → 400 with issues | PASS | `issues[0].path == "selector.exact"`; nothing written. |
| 9  | Empty body rejected before any write | PASS | 400 with `issues`; 0 commits. |
| 10 | Absent selector text still creates, orphaned at read time | PASS | 201; `GET /api/docs/<D>` → `orphaned:true, range:null`. |
| 11 | Failure after first write leaves nothing behind | PASS | Forced with `chmod 555 data/threads`: 500, parent md5 **byte-identical**, no thread file, 0 commits, no projection row. |
| 12 | Ten concurrent creations all survive | PASS | 10×201, 10 distinct `anchorId`s, exactly 10 keys on the parent, 10 thread files, none lost. |
| 13 | Anchored title = `Re: "<first 60>"` | PASS | 120-char `exact` → quote length measured **60**. |
| 14 | Whole-document title from parent | PASS | `Re: Mortgage model`. |
| 15 | Standalone title from first line, ≤80 | PASS | 100-char line → title length **80**. |
| 16 | No usable first line falls back | PASS | ` ```\n``` ` → `Untitled thread`. |
| 17 | Explicit title wins | PASS | `Chosen`. |
| 18 | `anc_` + 8 lowercase hex, unique per parent | PASS | All 10 match `^anc_[0-9a-f]{8}$`, all distinct. |
| 19 | Selector stored verbatim | PASS | `café "quoted" — dash` / trailing-space prefix / tab suffix round-trip byte-identical. |
| 20 | Turn appends in §6 format | PASS | `201 {turn:{author:"agent",ts,body}}`; previous turn byte-identical. |
| 21 | Timestamps unique and monotonic | PASS | 5 rapid appends → 5 strictly increasing `YYYY-MM-DDTHH:MM:SSZ` values. |
| 22 | Turn append returns 201 | PASS | 201 on every variant (json, multipart). |
| 23 | `updated` moves; projection agrees with no wait | PASS | Response, file and `sqlite3 threads` all at the same instant, read immediately. |
| 24 | Turn on unknown thread → 404 | PASS | `no document with id th_zzzz`. |
| 25 | Multipart text-only; `"false"` honoured as false | PASS | 201, body `@agent multipart note`, `eventId:null`, pending unchanged. `"true"` string → event enqueued. |
| 26 | Multipart with `files` refused honestly | PASS | `400 issues[].path=="files"`, message names SERVER-010; nothing written. `DEFERRED → SERVER-010`. |
| 27 | `@agent` is a generic request | PASS | non-null `eventId`; payload has threadId/parentId/turnTs with **empty** mentions and skills. |
| 28 | Resolved `/skill` is structured | PASS | `skills:[{comment, doc_skillcomment, open}]`. |
| 29 | Resolved `@<subagent>` is structured | PASS | Real `.claude/agents/researcher.md` written on disk, projected by the **watcher** in ~5 s, then `mentions:[{researcher, doc_agentresearch, open}]`. |
| 30 | Archived target still requests, with status | PASS | `mentions:[{oldhand, doc_agentoldhand, **archived**}]`, event enqueued. |
| 31 | Unresolved tokens do not wake the agent | PASS | `@nobody` + `/nothing` → `eventId:null`, pending unchanged. |
| 32 | Fenced code is not a mention | PASS | `eventId:null`. |
| 33 | Inline code is not a mention | PASS | `eventId:null`. |
| 34 | Word-boundary discipline | PASS | `me@agent.example`, `path/comment/x`, `a@agentb` → all `eventId:null`. |
| 35 | Plain + omitted + none → nothing | PASS | `eventId:null`, pending +0, `agent` still `none`. |
| 36 | Explicit true always enqueues | PASS | non-null eventId, exactly one new `evt_*.json`. |
| 37 | First agent-requesting turn flips none→requested | PASS | File and sqlite both `requested`; the flip and the turn are in one commit (`+agent: requested` and `+## user · …` in the same diff). |
| 38 | Engaged re-triggers on a plain turn | PASS | non-null eventId. |
| 39 | Explicit false suppresses the engaged re-trigger | PASS | `eventId:null`, pending +0. |
| 40 | Explicit false outranks an explicit mention | PASS | `"@agent hello"` + `requestsAgent:false` → `eventId:null`. |
| 41 | Resolved does not re-trigger | PASS | `eventId:null`. |
| 42 | Explicit true beats resolved | PASS | non-null eventId (Adjudication 5 as stated). |
| 43 | Creation's omitted default is mention-only | PASS | plain create → null; `@agent` create → event + `agent: requested`. |
| 44 | Event's on-disk shape is the contract's | PASS | `{id,type,created,source,payload,status,updated}`; `queue/status` counts it; `events` row present. |
| 45 | Resolve flips status, one commit | PASS | 200, file `resolved`, sqlite agrees, +1 commit (outside the squash window). |
| 46 | Resolve idempotent and quiet | PASS | 200, **0** new commits. |
| 47 | Reopen restores open | PASS | 200, +1 commit outside the squash window; inside it, resolve+reopen amend into one commit and `git status` stays clean with HEAD matching disk. |
| 48 | Resolve/reopen unknown → 404 | PASS | Both 404. |
| 49 | Bare seen mark records the last turn | PASS | `{threadId,lastSeenTs:<last>,unread:false}`; `.corpus/seen.json` is the flat map. |
| 50 | Marks only move forward | PASS | Older mark → recorded mark unchanged; equal mark → no-op. |
| 51 | Seen makes no commit | PASS | 3 marks → 0 commits; `git log --all -- .corpus/seen.json` empty. |
| 52 | Seen re-projects without a restart | PASS | Row present immediately after the API call; an out-of-band append to `seen.json` reached the `seen` table in ~4 s **with the server still running** (BUG-2's fix — a new watch-file exemption for the parent directory). |
| 53 | Middle-turn deletion keeps the rest | PASS | `{deletedTurn:true,deletedThread:false,removedAnchor:null,parentId:<D>}`; t0 and t2 keep original stamps; +1 commit; `turns` rows match. |
| 54 | Turn `ts` URL-encoding | PARTIAL | Encoded form succeeds (the operative half). **The raw form succeeds too (200), not 404 as the E2E log claims** — see DISC-1. |
| 55 | Last-turn deletion cascades thread + anchor | PASS | `{deletedThread:true,removedAnchor:"anc_b9f5a2cf",parentId:<D>}`; file gone; other anchors untouched; ONE commit staging both paths; `threads` row gone. |
| 56 | Standalone last turn does no anchor work | PASS | `removedAnchor:null,parentId:null`; one commit, one path. |
| 57 | Whole-doc thread removes no anchor | PASS | `removedAnchor:null`; parent md5 **identical** before and after. |
| 58 | Turn deletion is user-only | PASS | agent → 403 `forbidden`, turn still in the file, no commit; user → 200. |
| 59 | `DELETE /api/docs/<th_*>` cascades the anchor | PASS | agent → 403; user → 200, file gone, anchor key gone, one commit staging both paths. |
| 60 | Git retains what was deleted | PASS | `git show HEAD~1:data/threads/<T>.md` intact. |
| 61 | Capture: doc + thread + event, one commit | PASS | `201 {docId,threadId,eventId}`; `data/docs/inbox/call-the-bank-about-the-rate-lock.md`; whole-doc thread `anchor:null`, `agent:requested`; +1 pending; ONE commit staging both files. |
| 62 | Filing thread's first turn asks for filing | PASS | "Captured to the inbox. Please file it: give it a real title, move it out of `inbox/`, expand it if it is a stub, and tag it." |
| 63 | Slugs dedupe | PASS | Different `docId`, `…-2.md`, first file untouched. |
| 64 | `requestsAgent:"false"` suppresses the capture event | PASS | `eventId:null`, both files created, thread `agent: none`. |
| 65 | GET returns thread + ordered turns | PASS | Keys exactly `{id,title,created,updated,status,tags,parent,anchor,agent,turns}`; turn keys exactly `{author,ts,body}` — **no `idx`**, contract wins as adjudicated. |
| 66 | Anchor context comes from the parent | PASS | `ResolvedAnchor {anchorId,selector,threadId,threadStatus,range,orphaned}`; `range:{start:10,end:40}` resolves against the current body. |
| 67 | GET unknown thread → 404 | PASS | |
| 68 | One git writer | PASS (operative clause) | No thread/capture module shells out to git. Two child-process sites exist outside `src/git/` — `watcher/git-head.ts` (SERVER-007's, pre-existing) and `docs/write-fixture.ts` (a fixture) — neither is a thread module. |
| 69 | One turn-format writer | PASS | The `·` separator and the `## <author> · <ts>` heading exist only in `core/turns.ts` (plus doc comments in `core/code.ts`/`core/time.ts`); zero literal `"## ` heading construction anywhere in `apps/server/src`. |
| 70 | Every mutation re-projects before responding | PASS | Verified with no sleep for create, turn append, resolve, seen and delete. |
| 71 | Invalidation keys published, never data | PASS | Frames for create/append/resolve/reopen/seen/delete all draw from the nine published shapes (`docs`, `docs/<id>`, `threads/<id>`, `tree`, `queue`, `jobs`); zero frames carry data. |
| 72 | Enqueue wakes a parked long poll | PASS | With a genuinely empty queue: parked `GET /api/queue/idle?timeout=30`, posted an `@agent` turn at t+4.0 s, returned at t+4.165 s → ~0.16 s wake. Proves `server.queue.enqueue`, not a file drop. |
| 73 | Hook rejection surfaces per §14 | PASS | `pre-commit` exiting 1 → 201 with `warnings:[{"code":"commit_failed","detail":"git commit failed: doc check: refusing"}]`, mutation **stands** on disk, 0 commits. Warnings ride **all four** CONTRACT-006 shapes: create, turn append, capture, delete-turn. |
| 74 | No-git workspace stays usable | PASS | Fresh workspace with `.git` removed: create and append both 201 with `warnings:[{"code":"commit_skipped","detail":"the workspace is not a git repository"}]`, both turns on disk. |
| 75 | Squash window folds same-actor writes | PASS | user create + user turn within 30 s → **1** commit; a turn by the other actor → a fresh commit (`agent <agent@corpus.local>`). |
| 76 | Latency budget | PASS | 10 iterations each: create median **58 ms** / p95 64 ms; append median **102 ms** / p95 111 ms; delete median **102 ms** / p95 117 ms. No call above 1 s (max 161 ms). |

## Failures

None. One documentation discrepancy, below.

### DISC-1: The E2E log's TEST-54 claim about an unencoded `:` is false

**Criterion**: TEST-54 — "the raw form's behaviour is stated in the log".
**Expected** (per the log, row 11): "A raw (unencoded) `:` in the path → `404`, so clients must
encode as the route says."
**Observed**: the raw form returns **200 and deletes the turn**.

**Steps to reproduce**:

1. `curl -sS -X POST localhost:8930/api/threads -H "$AUTH" -H 'content-type: application/json' -d '{"body":"raw colon probe A"}'` → note `th_22kavecr`.
2. Append a second turn so the thread survives the delete.
3. `curl -sS localhost:8930/api/threads/th_22kavecr -H "$AUTH" | jq -r '.turns[0].ts'` → `2026-07-27T14:29:43Z`.
4. `curl -sS -w '%{http_code}' -X DELETE "localhost:8930/api/threads/th_22kavecr/turns/2026-07-27T14:29:43Z" -H "$AUTH"`
   → `200 {"deletedTurn":true,"deletedThread":false,…}`; the file drops to one turn.

The *behaviour* is permissive and harmless (a malformed segment such as
`2026-07-27T99:99:99Z` is still a clean `400`), and TEST-54's binding half — "the encoded form
succeeds" — passes. What fails is the accuracy of the record: the log asserts an observation
that does not reproduce. **Required**: correct that line in SERVER-006's E2E Verification Log
to state the shipped behaviour (unencoded `:` is accepted; encoding is required by the contract
but not enforced by the router), or file it as a follow-up if the 404 was the intent.

## Observations (not failures)

- **Thread deletion emits no `["tree"]` key** while thread creation does, though the published
  vocabulary's `tree` entry names "create, move, delete". Within TEST-71's requirement (keys
  drawn from the published nine, no data) so not a failure, but worth a look when UI-008 lands
  the folder-column consumer.
- `GET /api/jobs?recent=5` returns `originTitle: null` for a thread-origin job. Not asserted by
  any sprint criterion; flagged for UI-011.

## Summary

**75 of 76 criteria PASS, 1 PARTIAL (TEST-54, documentation only).** SERVER-006 is the sprint's
producer half and it works: all three creation modes, the atomic two-file commit, the full
tri-state enqueue matrix (every one of TEST-35…43 exact), mention/invocation parsing with real
watcher-projected targets, the deletion cascade in all four shapes, capture, seen with
out-of-band re-projection, §14 warnings on all four thread response shapes, and read-your-write
on every mutation. Atomicity holds under a genuinely forced mid-write failure. Verdict: **PASS**,
with the DISC-1 log line to be corrected.
