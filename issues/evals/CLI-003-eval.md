# Evaluation: CLI-003

**Date**: 2026-07-27
**Sprint**: sprint-007
**Verdict**: PASS

Evaluated black-box against the **built** bin (`node apps/cli/dist/bin/corpus.js`) driving a real
server started by `corpus server start` on port **8985** in a real `corpus init` workspace, plus a
second workspace on 8986 for the scripted `node:http` stub (TEST-117), a third un-inited directory
(TEST-123), and the zero-stub integration workspace on **8997**. The from-source entry point
(`node --import <tsx loader> apps/cli/src/bin/corpus.ts`) was confirmed to run
(`--version` → `0.0.0`). No source file under `apps/cli` was read.

---

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes |
| --------------------------------------- | ------ | ----- |
| Verification log present                | PASS   | Filled, with an explicit "Adjudications applied" block covering Open Conflicts 1, 2, 3, 4, 8, 9, 10, 11. |
| Commands are specific and concrete      | PASS   | Real ids (`doc_yejhzfh7`, `th_pck2yjz5`, `evt_so53kefouomf`), real `git log -1 --format='%an <%ae> %s'` output, real inode numbers, real exit codes, real 423 payloads. |
| Real E2E (not mocked)                   | PASS   | Real workspace, real server, real git. Where a stub is used it is **labelled** and used only for the two claims a real server cannot prove: "zero requests sent" (delete guard, invalid actor) and the `db doctor` drift path — exactly the substitutions Open Conflict 10 and TEST-93 permit. |
| Scenarios cover acceptance criteria     | PASS   | All 9 live ACs evidenced; ACs 5 and 8 marked `STRUCK` with the follow-up chain named (CONTRACT-008 → SERVER-019 → CLI-006). |
| Application restarted after changes     | PASS   | Rebuild-after-registry-change discipline stated; the built bin I tested is the shipped artifact and behaves as the log describes. |
| Actual model recorded (`implemented on:`) | PASS | "**Implemented on: opus** (cli-dev, worktree `.claude/worktrees/cli-003`, 2026-07-27)." |
| Reproduction logged before fix (bugs)   | PASS   | Feature issue, but the one defect found during E2E — the **stdin hang** — carries a pre-fix reproduction ("hung forever and was killed at 5 minutes") with the measured `fstat` of fd 0 that explains it. |

### Claims I re-derived independently

| Log claim | Re-derived? |
| --- | --- |
| Default actor is `user` (Open Conflict 4 adjudication) | **Yes.** No flag, no env → `user <user@corpus.local> \| doc create: … by user`. |
| `--from` > `CORPUS_FROM` > default | **Yes**, all four rows. |
| Invalid actor → exit 2 before any request | **Yes**, and stronger: **with the server stopped it still exits 2, not 4** — proving the validation precedes the request. |
| Lock conflict renders the holder, exit 5, one request | **Yes.** `corpus: 423 locked: doc_5sz3md3n is being edited by user; the lock was acquired at …` + typed `{docId,holder,acquired,ttl}`; file md5 unchanged; the server log shows exactly **one** `PUT … 423` line — no retry. |
| Delete guard: exit 2, nothing sent | **Yes.** Server-running: `.corpus/server.log` line count unchanged 84 → 84 and the file survives. Server-stopped: still exit 2. `CORPUS_FROM=agent` identical. |
| Server 403 backstop | **Yes.** `curl -X DELETE … -H "x-corpus-author: agent"` → `403 {"code":"forbidden","message":"deletion is user-only; the agent archives, never deletes"}`. |
| `db rebuild` swaps the db (inode changes) | **Yes.** `67343938 → 67344111`. |
| `db doctor` clean after an out-of-band edit is CORRECT | **Yes.** Exit 0, `projection is clean — 89 documents from 89 files`. |
| `db doctor` drift → exit 6, report passed through untouched | **Yes**, against my own scripted `node:http` stub; stdout is byte-for-byte the stub's report. |
| Every `docs/cli.md` example runs | **Yes.** All **25** runnable examples in the `doc`/`thread`/`db` sections executed against a live workspace with real ids — **every one exited 0.** |
| `corpus thread reply th_zzzzzzzz` → exit 5 | **Yes**, including the log's own wording, which contains a defect (below). |
| Repo gate green | **Yes** on the merged branch: lint + format:check + typecheck + `vitest run` all clean, **201 files / 3402 tests**; coverage **98.72 % lines / 94.71 % branches**; `npm run e2e` (`CORPUS_UI_PORT=5273`) **13 passed**; `check-generated-artifacts.ts` green **twice in a row** and `git status` clean after. |

### Deviations found in the log

1. **Port deviation (process, not behaviour).** The log ran on **8945**, outside the sprint's
   CLI-003 band **8980–8989**. The log states the orchestrator reassigned it. No reserved band
   was touched.
2. **The log quotes `"404 not_found: no document with id th_zzzzzzzz"` for an unknown *thread*.**
   This reproduces verbatim — the log is honest, and the wrong noun is a real (cosmetic) defect,
   recorded below.

No claim in the log failed to reproduce.

---

## Criteria Results

### The command surface

| #   | Criterion | Result | Evidence |
| --- | --------- | ------ | -------- |
| 59 | Topics registered and self-documenting | PASS | All three levels render for `doc`, `thread`, `db`. Every verb page shows a summary, a prose description, **a description for every flag** (7 local + 8 global on `doc create`) and ≥ 1 example. No undescribed flag found anywhere. |
| 60 | `docs/cli.md` contains the new sections | PASS | Committed `docs/cli.md` Contents index carries `corpus db` (doctor, rebuild), `corpus doc` (archive, create, delete, edit, move), `corpus thread` (reopen, reply, resolve). Regeneration is a no-op: `check-generated-artifacts.ts` green **twice**, `git status` clean. |
| 61 | Drift check blocks a stale doc | NOT RUN | Requires mutating the repo's registry to induce drift. Substitute evidence: the drift check is wired and green twice in a row on an unmodified tree (TEST-151), and the log records that the generator escapes `\|` in table cells so `--from <user\|agent>` round-trips. |
| 62 | Unknown verbs → usage error, no stack trace | PASS | `doc frobnicate x` → exit 2, `unknown verb "frobnicate" for "corpus doc". / Valid: create, edit, move, archive, delete.` `thred reply x` → exit 2, `Did you mean "thread"? Valid: …`. Under `--json`: **stdout 0 bytes**, stderr one `{"error":{"code":"usage_error",…}}` line. |
| 63 | `--json` emits exactly one JSON value | PASS | All 14 verbs: `jq` parses, `jq -s length` = 1, stderr 0 bytes, no human line on stdout. |
| 64 | Human output is one line | PASS | `stdoutLines = 1` for all 10 mutating verbs (e.g. `created doc_djcz4upw — data/docs/inbox/t64new.md`, `replied to th_fczkcnjc — turn 2026-07-27T17:47:59Z`). |

### `--from` attribution

| #   | Criterion | Result | Evidence |
| --- | --------- | ------ | -------- |
| 65 | Default actor per adjudication | PASS | `user <user@corpus.local>`. Open Conflict 4's adjudication (default `user`) is stated in the log and holds. |
| 66 | `--from` overrides | PASS | `agent <agent@corpus.local>` / `user <user@corpus.local>`. |
| 67 | `CORPUS_FROM` honoured, flag wins | PASS | env → agent; env + `--from user` → user. |
| 68 | Invalid actor is a usage error before any request | PASS | `--from robot` → exit 2 `--from must be one of: user, agent — got "robot".`; `CORPUS_FROM=robot` → exit 2 with env-specific wording. **Exit 2 persists with the server down**; the "zero requests" half is additionally pinned against a recording stub in `run.test.ts`. |
| 69 | Every mutating verb accepts and *applies* `--from` | PASS | All 8 actor-capable verbs asserted on the **commit author**, both actors: e.g. `agent <agent@corpus.local> \| doc move: data/docs/inbox/t69ma.md → data/docs/mv-a/t69ma.md (doc_f5mhtbj7) by agent`. No verb accepted the flag and ignored it. |
| 70 | CLI-004's verbs still behave | PASS | `lock acquire` (no `--from`) → `locked … for user` (the adjudicated behaviour change); `lock acquire --from agent` → exit 5 `409 conflict … locked by user`; **`lock break` still succeeds** and commits `user <user@corpus.local> \| lock: force-break on doc_datou6b4 (was user) by user`; `lock release`, `queue claim-all`, `job log <evt> "line"`, `queue complete` all exit 0. |
| 71 | Read-only verbs unaffected | PASS | `health`, `queue status`, `lock list`, `job list` — unchanged output, exit 0. |

### `corpus doc create`

| #   | Criterion | Result | Evidence |
| --- | --------- | ------ | -------- |
| 72 | Minimal create writes a real document | PASS | exit 0, `created doc_ugelzksg — data/docs/inbox/mortgage-options.md`; frontmatter `id`, `type: note`, `title`, `created`, `updated`, `status: open`, `tags: []`; `GET /api/docs/<id>` 200 matching; commit count 1 → 2. |
| 73 | Every documented flag reaches the server | PASS | `data/docs/finance/t73.md`; `tags: [finance, housing]`; `due: 2026-09-01`. Comma-splitting documented ("Comma-separated tags. Blank entries are dropped"). |
| 74 | Body from `--file` | PASS | `cmp` fixture vs on-disk body → identical, both 80 bytes. **Trailing-newline handling: passed through unchanged.** |
| 75 | Body from a heredoc | PASS | 152-byte body with inline backticks, a ```` ```js ```` fence, a ```` ```form ```` block and a `~~~form` block → md5 identical (`88bf0a83920c…`) on both sides. No CLI-side markdown processing. |
| 76 | Omitting both body sources is legal | PASS | `< /dev/null` → exit 0 in **0.23 s**; body is the `note` template's pre-fill. No blocking. |
| 77 | Body-source precedence | PASS | `-m` > `--file` > stdin verified for every pair and the triple. |
| 78 | TTY stdin never read as a body | PASS | Under `script -q /dev/null` (a real TTY): exit 0 in **0.25 s**, document created. No hang, no prompt. This is the fix for the logged stdin-hang defect. |
| 79 | `--json` returns the created document object | PASS | `{doc, warnings}`. Stated and consistent with the rule the CLI follows: **it emits the server's response untouched**. Shapes differ per verb because the *contract* differs per route — independently confirmed against the served OpenAPI (`archive`/`create`/`move` → `DocMutationResponse`; `resolve`/`reopen` → bare `ThreadSummary`). Recorded as an observation, not a CLI defect. |
| 80 | Non-existent folder — the server's answer, verbatim | PASS | `--folder does/not/exist` → **exit 0**, `created doc_sclrdrvk — data/docs/does/not/exist/t80.md`, stderr empty. **The server creates the nested folder chain on demand, with no warning.** The CLI did not pre-validate. First written statement of it (Open Conflict 8). |

### `corpus doc edit`

| #   | Criterion | Result | Evidence |
| --- | --------- | ------ | -------- |
| 81 | Body replacement lands and commits | PASS | Body replaced; `updated` 17:40:09 → 17:40:10; `agent <agent@corpus.local> \| doc edit: T81 (doc_hn2nsy33) by agent`; `GET /api/docs/<id>` agrees. |
| 82 | Frontmatter-only edit sends no body | PASS | Title changed; body md5 `f623111710c85b31…` **identical** before and after. Pinned by a stub-server test that no `body` key was sent. |
| 83 | Frontmatter flags all work | PASS | `--add-tag` ×2 then `--add-tag/--remove-tag` → `tags: [beta, gamma]`; `--status resolved`; `--due 2026-12-31`; **`reviewed: 2026-07-27T17:40:32Z` — an ISO instant, not `true`** (SPEC §5); `--evergreen true\|false`. API matches the file exactly. `--evergreen maybe` → exit 2. |
| 84 | Anchor reconciliation reported | PASS | `edited doc_23bmq7uf — 1 anchor remapped, 1 orphaned (th_ab2a4qg4) — warning: orphaned_anchor (…)`; `GET /api/docs/<id>` shows exactly one `orphaned: true` and one `orphaned: false` with a live `range`. Counts match. Independently re-confirmed in the integration loop (hop 8): `edited doc_ufzxjwcl — 1 anchor remapped`, API `range:{start:36,end:66}, orphaned:false`. |
| 85 | `--json` passes the response through untouched | PASS | `"anchors":{"remapped":["anc_85f3a197"],"orphaned":["anc_da3e8c28"]}` exactly as sent. |
| 86 | Lock conflict rendered, not retried | PASS | exit **5**, message names the **holder** (`is being edited by user`), file md5 unchanged, **exactly one** `PUT … 423` in the server log. Not a crash, not exit 1. |
| 87 | Unknown id is a clean failure | PASS | exit 5, `corpus: 404 not_found: no document with id doc_zzzzzzzz`, no stack trace. |
| 88 | Multi-megabyte body | PASS | 4,608,890 bytes piped in → exit 0 in **0.57 s**, `cmp` identical, no timeout. |

### `corpus doc move` / `archive`

| #   | Criterion | Result | Evidence |
| --- | --------- | ------ | -------- |
| 89 | `move` relocates and reports | PASS | `moved doc_3dgjwuro — data/docs/archive-notes/t89.md`; file present there; **id unchanged**; `GET /api/tree` shows `{"path":"archive-notes","count":1}`. |
| 90 | `archive` flips status | PASS | `archived doc_mufps4be`; `status: archived` on disk; **absent** from the default `GET /api/docs`, present under `?status=archived`. |
| 91 | Archiving an archived doc is a reported no-op | PASS | `doc_mufps4be is already archived`, exit 0, HEAD `fd7a7fad…` identical before/after → **no second commit** (stated). |
| 92 | Moving to the same folder is a reported no-op | PASS | `doc_3dgjwuro is already at data/docs/archive-notes/t89.md`, exit 0, HEAD unchanged → **no commit**. |

### `corpus doc delete` — the user-only guard

| #   | Criterion | Result | Evidence |
| --- | --------- | ------ | -------- |
| 93 | `--from agent` refused client-side, no request | PASS | exit 2, `deletion is user-only — the agent archives, never deletes / Archive it instead: … Nothing was sent to the server.` **Server-running proof:** server-log line count 84 → 84, file intact. **Server-stopped proof:** still exit 2, not 4. Also reproduced in the integration loop. |
| 94 | `CORPUS_FROM=agent` refused identically | PASS | Same message, same exit 2, server log unchanged; still exit 2 with the server down — the env var resolves *before* the guard. |
| 95 | Non-TTY without `--yes` is a usage error, never a hang | PASS | `< /dev/null` → exit 2 in **0.17 s**; `<<< "y"` → exit 2 in **0.16 s**; both `refusing to delete … without --yes.` The piped `y` was **not** read as confirmation; the file survived. |
| 96 | `--yes` deletes for real | PASS | exit 0; file gone; `git log --diff-filter=D` → `user <user@corpus.local> doc delete: T93 (doc_p2okldc4) by user`; `git show HEAD~1:<path>` returns the full content. |
| 97 | Server's 403 is still the backstop | PASS | Direct `DELETE` with `x-corpus-author: agent` → **403** `{"code":"forbidden",…}`; file untouched. |
| 98 | Deleting a doc with threads reports what was orphaned | PASS | Human: `deleted doc_yglnyyyk — orphaned 2 threads (th_4fywivhd, th_atn7vepp)`. `--json`: `"orphanedThreadIds":["th_dai73rq3","th_hpgjwrgd"]`. Both thread files still on disk; `GET /api/threads/<id>` → 200. |

### `corpus thread reply | resolve | reopen`

| #   | Criterion | Result | Evidence |
| --- | --------- | ------ | -------- |
| 99 | `reply` appends a real turn from a heredoc | PASS | `replied to th_tkvdqttv — turn 2026-07-27T17:44:38Z`; file gained `## agent · 2026-07-27T17:44:38Z` with the body verbatim; `agent <agent@corpus.local>` author; API shows the turn. |
| 100 | All three body sources for reply | PASS | `-m`, `--file`, stdin all produce the same turn body; precedence per TEST-77. |
| 101 | Empty body is a usage error | PASS | `-m ""` and empty piped stdin → **exit 2** `no reply body to send.` — not exit 5. The request the contract's `min(1)` would reject is never sent. |
| 102 | Fenced/form block passes through byte-for-byte | PASS | ```` ```form ```` wrapping a nested ```` ````js ```` fence containing a backtick template literal → bytes identical to the input; API round-trip preserves the nesting. |
| 103 | `@agent` enqueues, plain does not | PASS | Thread with `agent: none`: plain reply → `eventId: null`, pending `evt_*` count 0 → 0. Reply containing `@agent` → `eventId: "evt_3op554zcrz7j"`, count 0 → 1, file in `.corpus/queue/pending/`. The server decides; the CLI added no flag. |
| 104 | `resolve` / `reopen` flip status through the server | PASS | `status: resolved` then `open` on disk **and** in `GET /api/threads/<id>`; one line each; commits `thread resolve: … by agent` / `thread reopen: … by user`. |
| 105 | Both idempotent, exit 0 | PASS | `is already resolved` / `is already open`, exit 0, HEAD unchanged both times. |
| 106 | Reply to an unknown thread → clean exit 5 | PASS (defect noted) | exit 5, id named, no stack trace. **Wording defect:** the message reads `no *document* with id th_zzzzzzzz` — wrong noun for a thread id. See Observations. |

### `corpus doc check` / `corpus skill rollback`

| #   | Item | Disposition |
| --- | ---- | ----------- |
| 107–110 | `doc check`, `--staged`, the pre-commit gate | **STRUCK → Open Conflict 1 / 2.** No validation route exists in the contract; independently confirmed against the served OpenAPI (no `/api/check` path). Chain filed: CONTRACT-008 → SERVER-019 → CLI-006. `.githooks/` untouched by design. |
| 111–112 | `skill rollback` | **STRUCK → Open Conflict 3.** No targeted-revert route in the contract. |

### `corpus db rebuild` / `db doctor`

| #   | Criterion | Result | Evidence |
| --- | --------- | ------ | -------- |
| 113 | `db rebuild` triggers a real rebuild and summarises it | PASS | exit 0, `rebuilt the projection in 113ms — 88 documents, 25 threads, 38 turns, 21 anchors, 0 links, 2 events, 0 jobs, 0 locks, 0 seen`; **inode 67343938 → 67344111** (a real swap); `doc create` and `GET /api/docs` still work afterwards (SERVER-017's reopen seam). |
| 114 | `--json` emits the full RebuildResult | PASS | Every count field + `durationMs` + `path` + `skipped: []`. |
| 115 | `db rebuild` does not use the 10 s global timeout | PASS | `db rebuild --help` shows **no local Flags section** — no local `--timeout`. Decisive control: `corpus --timeout 1 db rebuild` → **exit 0** (rebuild took 116 ms ≫ 1 ms) while `corpus --timeout 1 health` → **exit 4** `did not answer within 1ms`. |
| 116 | `db doctor` clean → exit 0 | PASS | `projection is clean — 89 documents from 89 files (2ms)`; `--json` `{"ok":true,"drift":[],"stats":{…}}`. Re-confirmed on the integration workspace after the full twelve-hop loop. |
| 117 | Drift → exit 6, findings one per line, `--json` untouched | PASS | Against a scripted `node:http` stub on 8986 returning `{"ok":false,"drift":[{"kind":"missing_row","path":"x","detail":"y"}],"stats":{}}`: **exit 6**; stdout `missing_row x: y`; stderr `the projection has drifted from the files — 1 finding.`; `--json` stdout byte-for-byte the stub's report. Stub log confirms only `GET /api/db/doctor` was called. This is the evidence Open Conflict 10 requires. |
| 118 | Clean right after an external file edit is CORRECT | PASS | `printf '\nline\n' >> data/docs/inbox/t113.md`, sleep 2, `db doctor` → exit 0, clean. The watcher healed it. **Designed behaviour, not a doctor bug.** (The optional `sqlite3`-surgery drift case also reproduced exit 6 on a real server per the log; not required.) |

### Read-only filesystem constraint and the error surface

| #   | Criterion | Result | Evidence |
| --- | --------- | ------ | -------- |
| 119 | No command module writes to the filesystem | NOT RUN (source-scan) | Outside the evaluator's mandate (no source reading). Substitute behavioural evidence: TEST-121 (git state byte-identical across every read verb), TEST-93/94 (the delete guard sends nothing and writes nothing), and every mutation observed on disk was produced by a **server** commit with the server as writer. Recommend the pr-reviewer confirm the lint rule exists. |
| 120 | No command module spawns a state-changing git command | NOT RUN (source-scan) | Same. Substitute evidence: across the whole run every commit in the workspace carries a structured `Corpus-Doc`/`Corpus-Actor` server subject (`doc create: …`, `comment: turn on …`, `lock: force-break on …`), and `git status --porcelain` was byte-identical across all read verbs. No commit appeared that the server did not author. |
| 121 | Workspace git state untouched by read verbs | PASS | `git status --porcelain -uall` captured byte-exactly before and after `health`, `queue status`, `lock list`, `job list`, `db doctor` and all 14 `--help` invocations → **byte-identical**; HEAD unchanged. |
| 122 | Stopped server → the actionable message | PASS | All 14 verbs → **exit 4**, stdout 0 bytes, stderr `server not running for this workspace — run \`corpus server start\` / Nothing answered at http://127.0.0.1:8985.` No `ECONNREFUSED`, no stack frames, no partial output. `--json` form: stdout empty, stderr `{"error":{"code":"server_unreachable",…}}`. Independently re-confirmed on 8997. |
| 123 | Outside a workspace → exit 3 | PASS | All 11 verbs → exit 3, `not inside a Corpus workspace — run \`corpus init\` here or pass --workspace / Searched upward from … for .corpus/config.json.` |
| 124 | Server errors are exit 5 with the typed problem | PASS | 404 → `corpus: 404 not_found: no document with id doc_zzzzzzzz`; 423 → `corpus: 423 locked: … is being edited by user; …` + typed `{docId,holder,acquired,ttl}`; 400 → `corpus: 400 bad_request: request failed validation` + `[{"path":"json.due","message":"Invalid ISO date"}]`. All exit 5, all drawn from the problem shape, none a `JSON.stringify` of the body. **422 is unprovokable — the served contract declares no 422 anywhere** (`200,201,204,400,401,403,404,409,423`); the 400 is the equivalent validation failure and is asserted instead. |
| 125 | Vitest covers what E2E cannot reach cheaply | PASS | Repo gate: **201 test files / 3402 tests passing**; combined coverage **98.72 % lines, 94.71 % branches, 98.48 % functions** — above the 90 % gate. `apps/cli/src` is at 100 % lines/functions. |
| 126 | Nothing constructs a request by hand | NOT RUN (source-scan) | Outside the evaluator's mandate. Substitute evidence: every observed request/response shape matched the served OpenAPI exactly, including the awkward ones (bare `ThreadSummary` on resolve/reopen, `DocMutationResponse` elsewhere, `{deletedId, orphanedThreadIds, warnings}` on delete) — consistent with a generated typed client rather than hand-built URLs. Recommend the pr-reviewer confirm. |
| 147 | Every `docs/cli.md` example runs | PASS | All **25** runnable examples in the `doc`, `thread` and `db` sections executed against the live workspace with real ids substituted — **every one exited 0**, including both heredoc forms and `corpus db rebuild && corpus db doctor`. |

---

## Cross-Issue (twelve-hop loop) — CLI-003's hops

Port **8997**, one `corpus init` workspace, **zero stubs**, real binary + real HTTP throughout.

| Hop | Command | Observed | Verdict |
| --- | ------- | -------- | ------- |
| 1 | `doc create --type note --title "Mortgage options" --folder finance --from user <<EOF` | exit 0, `created doc_ufzxjwcl — data/docs/finance/mortgage-options.md`; ONE commit `user <user@corpus.local> doc create: … by user`; `GET /api/tree` `finance` absent → count 1; SSE frame `{"keys":[["docs"],["docs","doc_ufzxjwcl"],["tree"]]}`, no data | PASS |
| 3 | `queue claim-all` | exit 0, the event moved `pending/` → `in-progress/` | PASS |
| 4 | `thread reply <th> --from agent <<EOF` | exit 0, ts printed; turn in the file with the fenced ```` ```form ```` block verbatim; ONE commit `agent <agent@corpus.local>`; thread reached `agent: engaged`; **`eventId: null`** — the agent's own reply does not wake the agent | PASS |
| 8 | `doc edit <D> --from agent` | `edited doc_ufzxjwcl — 1 anchor remapped`; `GET /api/docs/<D>` agrees (`range:{start:36,end:66}, orphaned:false`); ONE commit authored `agent` | PASS |
| 9 | `job log <evt> "filed the mortgage note"` then `queue complete <evt>` | line in `.corpus/jobs/<evt>.jsonl`; `GET /api/jobs` row `{status:"processed", lastLine:"filed the mortgage note", originId:"th_afa65myb"}`. **`originTitle` absent — `DEFERRED → CONTRACT-007`** (Open Conflict 6 struck) | PASS (deferred field) |
| 10 | `thread resolve <th>`; `doc archive <D>` | `status: resolved` / `status: archived` on disk and over HTTP; `GET /api/tree` `finance` 2 → 1; the archive frame carried `["tree"]` (Open Conflict 13 taken, not deferred) | PASS |
| 11 | `doc delete <D> --from agent` | exit 2, refused, ZERO requests (still exit 2 with the server stopped), file intact | PASS |
| 12 | `doc delete <D> --from user --yes` | exit 0, `deleted doc_ufzxjwcl — orphaned 1 thread (th_afa65myb)`; file gone; `git log --diff-filter=D` shows it; `git show HEAD~1:<path>` retains content; **the thread was NOT deleted so its attachment bytes remain** (asserted: still on disk and still serving 200); `["tree"]` in the frame | PASS |
| **140** | Parked `queue idle --json` + `thread reply --from user -m …` | With the queue drained first, `idle` sat parked (empty log) for 2 s, then returned **within 1.6 s of the reply** carrying `{"events":[{"id":"evt_vumtzu5hdcet","type":"comment.created","payload":{"threadId":"th_afa65myb",…}}]}` — CLI-003's write path reached CLI-004's read path with no glue | PASS |
| **142** | `git log --format='%an <%ae> %s'` | Every mutation appears with the correct acting party as **author**; every subject structured; the only paths ever committed under `.corpus/` are the **five queue-skeleton `.gitkeep` files** | PASS |
| **145** | `db rebuild && db doctor` at the end of the loop | exit 0, `{"ok":true,"drift":[],…}` — §11's standing invariant holds on a workspace that went through every mutation this sprint added | PASS |
| **151** | Repo-wide gate from a clean tree | lint ✓ · format:check ✓ · typecheck ✓ · `vitest run` **3402/3402** ✓ · coverage **98.72 %** ✓ · `npm run e2e` (`CORPUS_UI_PORT=5273`) **13 passed** ✓ · `check-generated-artifacts.ts` green **twice**, `git status` clean after ✓ | PASS |
| **152** | Adjudications recorded where the next reader will find them | CLI-003's log records Open Conflicts 1, 2, 3, 4, 8, 9, 10, 11 with decision + rationale; ACs 5 and 8 name their follow-up chain; all three logs state the model | PASS |

---

## Failures

None.

## Observations (not failures)

1. **`thread reply` unknown-id message uses the wrong noun** — `404 not_found: no *document* with id th_zzzzzzzz`. The criterion (name the id, no stack trace) is met; the wording will read as a bug to an agent.
2. **`--json` envelope shape varies by verb** — `{doc,warnings}` / `{doc,anchors,warnings}` / `{deletedId,orphanedThreadIds,warnings}` / `{thread,turn,eventId,warnings}`, but `resolve`/`reopen` emit a **bare `ThreadSummary` with no `warnings` key**. Confirmed against the served OpenAPI: this is the *contract's* asymmetry, faithfully passed through. A caller reading `.warnings` uniformly gets `undefined` for those two. Worth a CONTRACT tidy-up, not a CLI fix.
3. **`db doctor --json` on drift writes to BOTH streams** (report on stdout, `{"error":{"code":"check_failed",…}}` on stderr) with exit 6. TEST-117 *requires* the stdout passthrough while the general `--json` rule says failures go to stderr with stdout empty. The two rules genuinely conflict; the implementation satisfies the specific one. Needs an explicit decision recorded.
4. **`thread reply` strips a trailing newline** where `doc create`/`doc edit` preserve it. Structurally sensible for the turn format, but it means `reply` is not byte-transparent the way the other two are.
5. **Whitespace-only reply bodies are accepted** (`"   \n"` → exit 0, a turn is created) while `-m ""` and empty stdin are exit 2. The empty-body check is not whitespace-aware.
6. **`--folder does/not/exist` silently creates the whole nested chain** with no warning (Open Conflict 8's first written statement). A typo becomes a folder. If that is not wanted, it is a **SERVER** issue to file, not a CLI workaround.
7. **`queue claim-all` prints raw JSON on stdout without `--json`** — a CLI-004-era verb, outside TEST-64's scope, but it breaks the one-human-line convention every new verb follows.
8. **`job log` accepted a line for an already-`processed` event** and updated its `lastLine`/`updated`.
9. **`db rebuild --help` still lists the global `--timeout`** with its generic description even though rebuild ignores it; only the prose says so.
10. **Port deviation**: the E2E log ran on 8945 rather than the assigned 8980–8989.

## Summary

**60 of 60 executable acceptance tests PASS**; 6 are `STRUCK → Open Conflict 1/2/3`
(`doc check`, `--staged`, the pre-commit gate, `skill rollback` — the contract genuinely
declares no such routes, independently confirmed), and 4 (TEST-61, 119, 120, 126) are
`NOT RUN` because they require reading source, which the evaluator must not do — each with
substitute behavioural evidence recorded and flagged for the pr-reviewer.

The agent's hands work: `thread reply <id> --from agent` — the literal command SPEC §7's
comment skill is written in — runs, commits as `agent`, wakes a parked `queue idle`, and passes
a ```` ```form ```` block through byte-for-byte. The user-only deletion guard holds client-side
with the server down (exit 2, not 4), and the server's 403 is still the backstop. The actor
default changed to `user` without breaking any CLI-004 verb, `lock break` included.
