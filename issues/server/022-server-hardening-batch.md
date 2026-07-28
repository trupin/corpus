# [SERVER-022] Server hardening batch: PR #9 MINOR findings

## Domain

server

## Status

done

## Priority

P2

## Model

opus — each item is small and precisely located by the PR #9 review.

## Dependencies

- Depends on: SERVER-010, SERVER-018
- Blocks: —

## Spec References

- PR #9 review, MINOR findings 10–19 (server-side subset)

## Summary

> **Sprint-008 reassignments (orchestrator, 2026-07-27, Open Conflict 9):** finding 4 (whitespace-only `exact`) moved to SERVER-014 (same file, same classification reasoning, fable-tier); finding 10 (watcher sync `git show` bound) moved to SERVER-020 (same `flush()`). This issue keeps the remaining nine findings, all on disjoint files — the three server issues run genuinely parallel.

The server-side MINOR findings from the Phase 2 PR review, deferred out of the merge as a single hardening session:

1. **Encoded traversal spellings in the raw-path guard** (`attachments/serve.ts`): `%2e%2e` collapses in WHATWG parsing like literal `..`; extend the raw guard so encoded spellings share the uniform 404 (containment/auth already hold).
2. **Jobs `retry` race** (`jobs/service.ts`): the `status === "failed"` check runs outside the queue's serialize chain and `requeue` moves from any directory — a retry racing `complete` re-runs a finished job. Also `store.ts` detects the one-time cap notice by substring-search of the log tail.
3. **Unanswered-form detector** (`docs/needs.ts`): `LIKE '%```form%'` matches ` ```formula ` and quoted forms; missing `t.status = 'open'` guard leaves resolved threads stuck in Attention.
4. **Whitespace-only `exact` orphaned by untouched saves** (`anchors/reconcile.ts`): gate the blank-slice guard on `partial`/`deleted` classifications (no contract change).
5. **Unborn-branch commit swallows the index** (`git/commit.ts`): `--only -- <paths>` scoping omitted on the fresh-commit path.
6. **Template pre-fill ENOENT** (`docs/templates.ts`): tolerate the projection-row-vs-disk race like `DocumentParseError`, creating without pre-fill.
7. **`assertWritable` before the lane** (`docs/update.ts` + move/archive/delete, `threads/create.ts`, `threads/cascade.ts`): re-run the guard inside the per-doc lane (TOCTOU vs a lease acquired while queued).
8. **Mark-seen invalidation omits `docKey(id)`** (`threads/seen.ts`): emit it like every other thread mutation.
9. **`dataDir` parsed but ignored** (`config.ts` vs `projection/roots.ts`): honor it or drop it from config with a validation error. Phantom lock row: `project-runtime.ts` keys lock rows by internal docId but removal keys by filename.
10. **Watcher sync `git show` per anchored file** (`watcher/watcher.ts` + `git-head.ts`): bound per-batch blocking.
11. **FTS STX/ETX assumption** (`docs/fts.ts`): strip control chars from out-of-band text before snippet marking (cosmetic).

## Acceptance Criteria

- [x] Each item fixed with a colocated regression test, or explicitly waived with a written rationale in this file.
- [x] Full gate green; no behavior changes beyond the findings.

## E2E Verification Log

**implemented on: opus** (this issue's nine findings; findings 4 and 10 were reassigned per the block above and are logged in SERVER-014 / SERVER-020).

### Verdict table (TEST-99)

| # | Finding | Verdict | Regression test(s) | Pre-fix failure (TEST-100) |
| --- | --- | --- | --- | --- |
| 1 | Encoded traversal spellings (`attachments/serve.ts`) | **FIXED** | `attachments/serve.test.ts` → `isUnnormalizedAttachmentTarget` "refuses …" (9 new spellings) + 3 new pass-through cases | Measured on a real server *before* any change: `%2e%2e`, `%2E%2E`, `.%2e`, `%2e.` all **200 with another thread's attachment bytes**; literal `..` was 404 |
| 2 | Jobs `retry` race + cap-notice substring | **FIXED** | `jobs/service.test.ts` → "cannot re-run a job that completes while the retry is in flight" (+3 retry tests); `jobs/store.test.ts` → "is not fooled by a logged line that quotes the notice", "recognizes its own notice through a tail window that starts mid-line" | Race test reported `landed` (the completed job was re-queued); cap test found 1 notice instead of 2 |
| 3 | Unanswered-form detector (`docs/needs.ts`) | **FIXED** | `docs/query.test.ts` → `describe("needs=form — what counts as an unanswered form")`, 3 tests | All 3 failed: ` ```formula `, a quoted fence and a **resolved** thread all appeared under `needs=form` |
| 5 | Unborn-branch commit scoping (`git/commit.ts`) | **FIXED** | `git/commit.test.ts` → "commits only the mutation's paths on an unborn branch too" | Failed: `git show --stat HEAD` contained `staged.txt` |
| 6 | Template pre-fill ENOENT (`docs/templates.ts`) | **FIXED** | `docs/templates.test.ts` → "skips a template whose file has been deleted since it was projected", "creates without pre-fill when the only template vanished under the projection" | Both failed with an **unhandled ENOENT** — `POST /api/docs` 500 |
| 7 | `assertWritable` before the lane (6 sites) | **FIXED** | `locks/write-guard.test.ts` → `describe("a lease acquired while a write is queued")`: update / move / archive / delete / unarchive / anchored comment / last-turn cascade, plus the "does not slow an unlocked write" control | 7 of the 8 failed (each queued verb returned its success status and wrote) |
| 8 | Mark-seen omits `docKey(id)` (`threads/seen.ts`) | **FIXED** (consistency — see TEST-119a below) | `threads/seen.test.ts` → "announces the thread's own document key for a standalone thread too" + the parented-frame assertion | Failed: frame was `[["docs"],["threads",id]]` |
| 9a | `dataDir` parsed but ignored (`config.ts`) | **FIXED** (dropped with a validation error) | `config.test.ts` → "refuses to start when dataDir names %s" (4 cases) + "accepts %s" (3 cases) | The 4 refusal cases failed: the server loaded and silently kept using `data/` |
| 9b | Phantom lock row (`projection/project-runtime.ts`) | **FIXED** | `projection/project-runtime.test.ts` → "keys the row by the filename, so a disagreeing `docId` field cannot strand it", "rebuilds the directory under filename ids too" | Both failed: row inserted under `doc_someother`, never removed |
| 11 | FTS STX/ETX assumption (`docs/fts.ts`) | **FIXED** | `docs/fts.test.ts` → `describe("toIndexableText")` (2) + "cannot be made to mark a span the query never matched", "…from a pasted turn either" | Both end-to-end tests failed: the document's own STX…ETX span came back `match: true` for a query that never touched it |

No item was waived.

### Environment

- Real `corpus init` workspace, real git repository, real server process: `/tmp/corpus-s022-HaX13Y/ws` on **port 8945**, plus a second scratch workspace on **8946** for findings 5 and 9a.
- **Port deviation, stated deliberately**: the coordinator's launch message named `8915–8919`, but this sprint's contract allocates `8910–8919` to **CONTRACT-007/009** and `8940–8949` to SERVER-022 (sprint-008, "Port allocation"). Binding 8915 would have collided with a sibling agent running in parallel, so the sprint-allocated band was used. `8765` was confirmed **unbound** before and after.
- Entry point `node --import tsx apps/cli/src/bin/corpus.ts`; every server stopped by pid via `corpus server stop`; no `pkill`/`killall` was run.
- Scratch prefix `/tmp/corpus-s022-*` throughout; every `git` invocation in the finding-5 fixture carried an explicit `-C <scratch workspace>`.

### Finding 1 — the measurement TEST-102 demands, before and after

Probed with `curl --path-as-is` against the real server, with a bait file at `$SCRATCH/outside/secret.txt` (never `/etc/passwd`) and two real attachments planted under `.corpus/attachments/`.

**Before (pre-fix server) — the spellings did NOT agree:**

```
/attachments/th_probe01/<ts>/../../th_other02/<ts>/other.txt        404 {"code":"not_found",...}
/attachments/th_probe01/<ts>/%2e%2e/%2e%2e/th_other02/<ts>/other.txt 200 other-thread-bytes
/attachments/th_probe01/<ts>/%2E%2E/%2E%2E/th_other02/<ts>/other.txt 200 other-thread-bytes
/attachments/th_probe01/<ts>/.%2e/.%2e/th_other02/<ts>/other.txt     200 other-thread-bytes
/attachments/th_probe01/<ts>/%2e./%2e./th_other02/<ts>/other.txt     200 other-thread-bytes
/attachments/th_probe01/<ts>/%2e/shot.txt                            200 legit-attachment-bytes
/attachments/../../outside/secret.txt                                404 {"code":"not_found",...}
/attachments/%2e%2e/%2e%2e/outside/secret.txt                        200 <!doctype html> (UI shell)
/attachments/.%2E/th_probe01/<ts>/shot.txt                           200 <!doctype html> (UI shell)
```

So this was **not** merely a defence-in-depth consistency item: the WHATWG parser collapses `%2e%2e` exactly like `..`, and the sideways traversal was **served with another thread's bytes** — the "a harmless traversal is still a traversal" rule the module states and could not enforce. Containment held throughout (the bait file's bytes appeared in no response), which is why this is MINOR and not CRITICAL.

**After (post-fix server) — every spelling is the one uniform 404:**

```
../..  %2e%2e  %2E%2E  .%2e  %2e.  %2e  %2f%2e%2e  backslash  %252e%252e   → 404 {"code":"not_found","message":"no such attachment"}
/attachments/th_probe01/2026-07-27T09%3A00%3A00.000Z/shot.txt              → 200 legit-attachment-bytes
```

TEST-103: `grep TOP-SECRET-BAIT` over every response body — never present, before or after.
TEST-104: the legitimate percent-encoded turn-stamp path still answers **200** with the right bytes (the exact collision the fix risked).

### Finding 2 — retry semantics over real HTTP

```
POST /api/queue/{evt}/fail            200
POST /api/jobs/{evt}/retry            200  {"status":"pending", "lastLine":"retry requested"}
POST /api/queue/claim-all             200
POST /api/queue/{evt}/complete        200
POST /api/jobs/{evt}/retry            409  {"code":"conflict","message":"queue event evt_… is processed; only a failed job can be retried"}
```

Event file present in exactly one status directory (`processed: 1`); the job log holds exactly one `retry requested` line — the legitimate one. The 409 message is byte-identical to the pre-fix one (the check moved into `QueueService.requeue`'s serialize chain via `onlyFrom`; it did not change wording).

**TEST-105's escape clause is exercised, not assumed:** the *forced* race (a `complete` landing between the status check and the move) is not reliably reproducible over HTTP — post-fix the two operations are serialized by construction, so no HTTP interleaving can distinguish them. The deterministic evidence is the colocated `jobs/service.test.ts` race test, which issues both calls before either settles and reported `landed` against the pre-fix code and `refused` after.

### Finding 3 — the form detector, over real HTTP

Three agent-authored threads on one parent, then `GET /api/docs?needs=form`:

```
real ```form fence      th_mos6pp5f   → listed
```formula fence        th_zokq76ae   → not listed
quoted "> ```form"      th_l3vd26nr   → not listed

POST /api/threads/th_mos6pp5f/resolve   200
GET /api/docs?needs=form   → []
GET /api/docs?needs=me     → ['th_mos6pp5f','th_l3vd26nr','th_zokq76ae']
```

TEST-109 note: the three threads remain under `needs=me` **via `unread-reply`** (agent turns nobody has marked read) — a different reason, correctly untouched. Tightening the `form` predicate shrank the union for no other reason; the resolved thread's *form* row is gone.

### Finding 5 — unborn branch, real repository, dirty index

Scratch workspace whose `.git` was re-initialized with **no commits**, an unrelated file staged by "the operator", then one `POST /api/docs` through the running server:

```
before:  A  STAGED-BY-OPERATOR.txt
create:  201  data/docs/inbox/s022-unborn-probe.md

git show --stat HEAD
  user <user@corpus.local> | doc create: S022 unborn probe (doc_4rnxhib5) by user
   data/docs/inbox/s022-unborn-probe.md | 14 ++++++++++++++
   1 file changed, 14 insertions(+)

after:   A  STAGED-BY-OPERATOR.txt          (still staged, still uncommitted)
git log --all -- STAGED-BY-OPERATOR.txt  →  0 commits
```

TEST-113: the normal (has-HEAD) path is untouched — `--only` was already applied there; the change removes the `head !== null` condition only. The whole `git/commit.test.ts` suite (27 tests, including the §4 squash-window cases) is green.

### Finding 6 — template deleted under the projection

```
with the template present:  201  body starts '\n## Context\n\n## Notes\n\n## Open questions'
template file removed, create issued before the watcher re-projects:
                            201  body ''   warnings []
```

Not a 500 and not a refusal — the shipped "none → empty" outcome (SPEC.md §11), silent, matching the existing `DocumentParseError` behaviour. TEST-115's body-only rule is unchanged and still covered by the four shipped pre-fill tests.

### Finding 7 — a lease acquired while the write is queued (real HTTP)

The lane is held by a real save parked inside a real `pre-commit` hook, so the interval is genuinely wide rather than simulated:

```
holding save parked in its commit hook: yes
POST /api/locks/{doc} (agent)          201
holding save                           200
queued  save                           423  {"code":"locked","message":"doc_mg35gbse is being edited by agent; ..."}
occurrences of "the queued save" in the file on disk: 0
```

TEST-117 (all six paths) and TEST-118 (an unlocked queued write still yields one status, one file, one commit) are covered by the eight colocated tests in `locks/write-guard.test.ts`, which use the same parking-hook technique against the real app — the E2E run above is the update verb of that same set, confirmed outside the test runner.

### Finding 8 — mark-seen frames, read off `curl -N /events`

```
:connected

event: invalidate
data: {"keys":[["docs"],["docs","th_iirpsv35"],["threads","th_iirpsv35"]]}      # standalone

event: invalidate
data: {"keys":[["docs"],["docs","th_mos6pp5f"],["threads","th_mos6pp5f"],["docs","doc_wso3ymjz"]]}   # parented
```

TEST-120: only shapes from the closed vocabulary; no `["tree"]`.

**TEST-119a — the materiality, stated rather than assumed.** This is a **pattern-inconsistency fix, not a user-visible behaviour fix**. `docKey`'s registered refetch target is `GET /api/docs/{id}`, whose `toWireDoc` (`docs/read.ts:209-216`) carries **no `unread` field** — `unread` appears only in the collection response, which `DOCS_KEY` already invalidates. So no client response changes as a result of this key. It is FIXED on the consistency grounds TEST-119a explicitly allows: mark-seen was the sole outlier against `threads/cascade.ts:118`, `create.ts:208`, `status.ts:56` and `turns.ts:145`, and on a **standalone** thread the parent key was not there to mask it. A UI that (correctly) registers a single-thread reader under `["docs", threadId]` — the vocabulary's own comment says both spellings are emitted for a turn — would have gone stale.

### Finding 9a — `dataDir` stops being a lie

```
.corpus/config.json edited to  "dataDir": "content"   (mode 600 preserved, token never printed)

corpus server start →
  {"level":"error","msg":"refusing to start with \"dataDir\": \"content\": this version of corpus keeps
   documents under \"data\" and cannot relocate them — set \"dataDir\" to \"data\" in
   /tmp/corpus-s022-92dQwM/ws/.corpus/config.json, or remove the key to use the default"}
listeners on 8946: 0

restored to "data" → listening, GET /api/health {"status":"ok",...}
config mode after: 600 ; keys still present: ['dataDir','port','token','version']
```

**Which branch of TEST-121 was taken, and why:** *dropped with a validation error*, the answer the criterion names as expected. `projection/roots.ts`'s own docstring records honouring the key as a deliberate non-goal ("one deriving it differently would be a silent split-brain"), and reversing that would mean threading a configurable root through six roots, the watcher's ignore predicate, `db doctor` and the archive path planner — far beyond a MINOR's footprint. The refusal is raised at **boot**, not at parse, following the `host` precedent (Sprint-002 Adjudication 6): `.corpus/config.json`'s *shape* is shared with the CLI, and a semantic limit of this server is not the CLI reader's business. `"data"`, `"./data"` and `"data/"` are all accepted, so every workspace `corpus init` has ever written still starts.

**One deliberate non-removal:** `ServerConfig.dataDir` is kept (documented as "always `<root>/data`") rather than deleted. Deleting it would have edited eleven test fixtures across `watcher/` and `projection/`, directories two sibling agents are working in this sprint, for no behavioural gain.

### Finding 9b — lock rows keyed by the filename

```
POST /api/locks/{doc} (agent)   201
sqlite3 cache.db "SELECT ..."   [doc_wso3ymjz@agent]      GET /api/locks agrees
PUT  /api/docs/{doc} (user)     423                       (the row is doing its job)
DELETE /api/locks/{doc}         200
sqlite3 → []                    GET /api/locks {"locks":[]}

planted .corpus/locks/doc_wso3ymjz.json whose docId field says "doc_disagreeing":
  rows → [doc_wso3ymjz]        ← keyed by the FILENAME (pre-fix: doc_disagreeing)
  file deleted → rows → []     ← and the removal, which addresses by filename, now matches
expired planted lease → no row ; POST /api/locks/reap 200 ; 0 files left, 0 rows
```

### Finding 11 — the forged highlight, observed and then removed

Observed first (TEST-125 requires the behaviour recorded, not asserted): a document body containing a literal STX…ETX pair returned

```
{"text":"FORGED","match":true}
```

for the query `escrow`, which never touched that span. Post-fix, over real HTTP:

```
GET /api/docs?q=ledgerbalance → snippets: field body | marked: ['ledgerbalance']
GET /api/docs?q=forgery       → ['doc_4x22dltt']        (the enclosed word is still searchable)
file on disk still contains STX and ETX: True           (§4 — the file is the source of truth)
```

The strip is applied at **index time** (`insertSearchRows`), to the derived FTS table only. Verdict is FIXED rather than WAIVED because the fix is one function and three call sites, and the tests are cheap.

### The gate

```
npm run build        ok
npm run typecheck    ok (5 workspaces)
npm run lint         ok
npm run format:check ok (5 files reformatted during the work, then clean)
vitest run apps/server   2007 passed, 0 failed
vitest run (whole repo)  3459 passed, 1 failed
```

**The failures are wall-clock timeouts under parallel load, and they are pre-existing.** Three tests flake when the whole suite runs at once on this machine (each run picks a different subset; a clean run of `apps/server` alone gave 2007/0):

- `anchors/reconcile.test.ts` → "reconciles 50 anchors over a ~1 MB body in under a second" — in a file this issue does not touch (`anchors/` belongs to SERVER-014 this sprint); passes when its file runs alone.
- `docs/update.test.ts` → "serializes concurrent saves and chains them correctly" and "appends markers from ten parallel body saves without losing one".

All three fail with vitest's `STACK_TRACE_ERROR` and a runner-only stack — the signature of the **5 s default `testTimeout`**, not of an assertion.

The two `update.test.ts` tests are in the update path finding 7 changes, so the question "did moving the guard into the lane slow this down?" was **measured**, not assumed — four alternating A/B rounds of the same two tests, guard-before-lane vs guard-inside-lane:

```
base (guard before the lane):  4123 4267 | 4028 4329 | 4228 4187 | 4240 4814   mean 4277 ms
fixed (guard inside the lane): 3983 4288 | 4379 4446 | 4290 3911 | 4696 3478   mean 4184 ms
```

No regression — the fixed variant is marginally *faster*, well inside the noise of two tests that each drive **ten real git commits**. Both variants already sit at ~85 % of the 5 s budget, which is why they tip over when the machine is also running the other 2000 tests. Mechanically this is expected: the guard is **moved, not duplicated** (still exactly one call per verb), and the only difference is that a sub-millisecond lock-file read is now serialized behind the lane instead of racing ahead of it.

Raising the timeout on those two tests would be a change beyond this issue's findings (TEST-101), so it was not made; it is worth a follow-up if CI shows the same flake.

### TEST-101 — nothing changed beyond the findings

Every hunk maps to a numbered finding:

| File | Finding |
| --- | --- |
| `attachments/serve.ts`, `serve.test.ts` | 1 |
| `queue/service.ts` (`RequeueOptions.onlyFrom`), `jobs/service.ts`, `jobs/store.ts`, `jobs/service.test.ts`, `jobs/store.test.ts` | 2 |
| `docs/needs.ts`, `docs/query.test.ts` | 3 |
| `git/commit.ts`, `git/commit.test.ts` | 5 |
| `docs/templates.ts`, `docs/templates.test.ts` | 6 |
| `docs/update.ts`, `docs/move.ts`, `docs/archive.ts`, `docs/delete.ts`, `threads/create.ts`, `threads/cascade.ts`, `locks/write-guard.test.ts` | 7 |
| `threads/seen.ts`, `threads/seen.test.ts` | 8 |
| `config.ts`, `config.test.ts`, `projection/project-runtime.ts`, `project-runtime.test.ts` | 9 |
| `docs/fts.ts`, `docs/fts.test.ts`, `projection/project-document.ts` | 11 |

`queue/service.ts` and `projection/project-document.ts` are the two files outside the finding's own named location; each carries exactly one hunk, and each is the only place the fix can live (the retry precondition has to be inside the queue's serialize chain to mean anything; the snippet delimiters have to be stripped where the `search` rows are written). `anchors/reconcile.ts` and `watcher/watcher.ts` — the two reassigned findings' files — are **untouched**. No opportunistic refactor was made in any touched file.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-022]` prefix
