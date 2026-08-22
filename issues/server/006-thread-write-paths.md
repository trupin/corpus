# [SERVER-006] Thread write paths: creation, turns, events, cascade

## Domain
server

## Status
done

## Priority
P0

## Model
opus — behavior fully pinned by §6/§8; no open design questions, only careful implementation of a specified write path.

## Dependencies
- Depends on: SERVER-005, CONTRACT-002
- Blocks: SERVER-010, CLI-003

## Spec References
- SPEC.md §6 — "Threads and anchors" (thread document shape, turn format, anchoring, deletion cascade, forms)
- SPEC.md §8 — "Agent participation semantics (opt-in per comment)"
- SPEC.md §9.2 — "HTTP API" (thread endpoints, capture, seen, turn deletion)
- CLAUDE.md — Architecture Decision 2 (server is the sole writer), Decision 3 (contract-first)

## Summary
Implement every write path that produces or mutates a thread: thread creation in its three modes (anchored, whole-document, standalone), turn append with monotonic unique timestamps, mention/invocation parsing that decides whether a `comment.created` event is enqueued, form answers, resolve/reopen, read marks, and user-only deletion with the full cascade (last turn → thread → parent anchor entry). This is the core of the conversational surface: every comment, reply, Ask, and Capture lands here, and it is the only place in the system that writes thread files or parent anchor entries.

## Acceptance Criteria
- [x] `POST /api/threads` supports all three creation modes: **anchored** (`parent` + text-quote selector — the anchor entry is written into the parent's frontmatter and the thread file is created atomically, in one auto-commit), **whole-document** (`parent`, no anchor), **standalone** (`parent: null` — the composer's Ask).
- [x] Thread creation accepts the first turn body, an author (`user` | `agent`), and an agent-request flag; the created thread's frontmatter matches §6 (`id: th_*`, `type: thread`, `parent`, `anchor`, `agent`, `status: open`, derived `title`).
- [x] `POST /api/threads/:id/turns` appends a turn as `## <author> · <ISO ts>` with a timestamp that is **unique and monotonically increasing within the thread** (via the core turn helpers from SERVER-001).
- [x] Mentions and invocations are parsed at post time per §8 (`@agent`, `@<subagent>` matching an `agent-def` document name, `/<skill>` matching a `skill` document name), validated against the projection, and emitted as structured `mentions` / `skills` fields in the event payload.
- [x] A plain comment (no flag, no recognized mention/invocation, thread not `engaged`) appends the turn and enqueues **nothing**.
- [x] A turn that requests the agent — explicit flag, `@agent`, a resolved `@<subagent>`, or a resolved `/<skill>` — enqueues `comment.created`.
- [x] A turn in a thread with `agent: engaged` enqueues `comment.created` **unless** the thread is `resolved` or the request carries the "note only" flag.
- [x] ~~A form answer (`formAnswer` on the turn request) appends a structured answer turn (chosen option + optional note) and enqueues `form.respond`.~~ **Struck** — sprint-006 Adjudication 3: no contract surface exists; CONTRACT-007 + SERVER-016 own it, sequenced before UI-008.
- [x] `POST /api/threads/:id/resolve` and `/reopen` flip `status` (idempotent), auto-commit, re-project, invalidate.
- [x] `POST /api/threads/:id/seen` updates `.corpus/seen.json`, re-projects the `seen` table, and broadcasts an invalidation; it makes **no** git commit (runtime state).
- [x] `DELETE /api/threads/:id/turns/:ts` is **user-only** (agent actor → 403) and cascades: deleting the last remaining turn deletes the thread, and deleting a thread removes its anchor entry from the parent's frontmatter.
- [x] **`DELETE /api/docs/:id` on a `th_*` id** (there is no `DELETE /api/threads/:id` — Open Conflict 6) deletes the thread file and removes its anchor entry from the parent (user-only, same cascade rules). SERVER-005's document branch — threads survive their parent as orphaned records — is unchanged.
- [x] `POST /api/capture` creates the inbox document **and** its agent-requested whole-document filing thread in one call and one commit.
- [x] `GET /api/threads/:id` returns the thread frontmatter plus its ordered turns (**`author`, `ts`, `body`** — `TurnSchema` has no `idx`, and anchor *context* is `GET /api/docs/:parentId`'s `ResolvedAnchor[]`; Open Conflict 7, the contract wins).
- [x] Every mutating endpoint re-projects the affected rows synchronously before responding (read-your-write per §9.1) and emits an invalidation.

## Sprint-006 Adjudications (binding, 2026-07-27)

Orchestrator decisions — implement exactly these; full reasoning in `issues/sprints/sprint-006.md`:

1. **423 splits on whether the parent is written**: anchored creation and anchor-removing cascades hit the lock guard (423); whole-doc/standalone creation, turns, resolve/reopen, seen never do. Correct `locks/guard.ts`'s header comment (it currently claims blanket thread-creation exemption); use the `assertWritable` seam, not the unmounted middleware.
2. **CONTRACT-006 rider runs FIRST** (separate agent, merges before you): warnings on `CreateThreadResponse`/`AppendTurnResponse`/`CaptureResult`/`DeleteTurnResult`, `appended` honesty, db routes. Build your warning serialization against it.
3. **Forms are struck from this issue** (AC 8): zero contract surface exists; CONTRACT-007 + SERVER-016 are filed for Phase 3, sequenced before UI-008.
4. **`agent: engaged` is set by the server** on the first agent-authored turn in a `requested` thread — mechanical, no contract change; this is what makes the enqueue matrix's engaged rows reachable.
5. **Thread deletion extends SERVER-005's shipped `deleteDoc`** (there is no `DELETE /api/threads/:id`); the cascade lives there.

## Technical Design

### Files to Create/Modify
- `apps/server/src/threads/routes.ts` — register the CONTRACT-002 thread route definitions against handlers
- `apps/server/src/threads/create.ts` — three-mode creation + atomic parent-anchor write
- `apps/server/src/threads/turns.ts` — turn append, monotonic ts, ~~form answers~~, multipart parse
- `apps/server/src/threads/status.ts` — resolve / reopen
- `apps/server/src/threads/mentions.ts` — `@`/`/` parsing + projection validation
- `apps/server/src/threads/participation.ts` — the §8 enqueue decision and the `agent` transitions
- `apps/server/src/threads/events.ts` — the one `comment.created` producer
- `apps/server/src/threads/cascade.ts` — turn → thread → anchor-entry deletion cascade
- `apps/server/src/threads/seen.ts` — `.corpus/seen.json` read/write + projection
- `apps/server/src/capture/capture.ts` — `POST /api/capture` composition (inbox doc + filing thread)
- `apps/server/src/threads/*.test.ts` — colocated Vitest specs
- `apps/server/src/app.ts` — mount the thread + capture routes, sharing one document mutex

### Key Implementation Details

- **`.corpus/seen.json` needs watcher coverage** _(sprint-004 evaluator, 2026-07-27)_: every other root re-projects out-of-band edits in ~3 s, but seen.json changes need a restart. When this issue lands the seen write path, add the file to the watcher's roots (or re-project seen on write) so read-state behaves like everything else.


- **`.corpus/seen.json` shape pinned** _(SERVER-004 handoff, 2026-07-26)_: a flat `{threadId: isoInstant}` map — SERVER-004's projector already reads this shape into the `seen` table; write exactly it.


**Atomicity of creation.** Anchored creation touches two files (the parent's frontmatter and a new `data/threads/th_*.md`). Perform both writes under the per-document write mutex established in SERVER-005, then make a **single** auto-commit staging both paths (`comment: new thread on <parentId> by <author>`). On any failure after the first write, restore the parent file from its pre-write content and unlink the thread file before returning 5xx — never leave an anchor pointing at a nonexistent thread.

**Anchor entries.** Generate `anc_<8 lowercase hex>`, unique within the parent's `anchors` map. The entry stores `{exact, prefix, suffix}` exactly as supplied by the client (the selection capture is a UI concern). Do not attempt resolution at write time — resolution is a projection/render-time concern per §6. Reject an empty or whitespace-only `exact` with 422.

**Title derivation.** Anchored → `Re: "<exact truncated to 60 chars>"`; whole-document → `Re: <parent title>`; standalone → first non-empty line of the first turn, truncated to 80 chars (falling back to `Untitled thread`). An explicit `title` in the request always wins. The agent may retitle later through the normal document edit path.

**Turn timestamps.** `ts = max(now, lastTurnTs + 1s)`, truncated to second precision and formatted as `YYYY-MM-DDTHH:MM:SSZ`. Uniqueness is a hard invariant — the ts is the turn's identity in the delete route. Compute it while holding the thread's write mutex.

**Mention/invocation parsing (§8).** Scan the turn body (outside fenced code blocks and inline code) for `@[\w-]+` and `/[\w-]+` tokens at a word boundary. Classify:
- `@agent` → generic request; routing left to the orchestrator's triage.
- `@<name>` matching an `agent-def` document's `name` in the projection (any status) → `mentions: [{name, docId, status}]`.
- `/<name>` matching a `skill` document's `name` (any status) → `skills: [{name, docId, status}]`.
- Tokens matching nothing → collected into `unresolved: [...]` on the payload and **do not by themselves request the agent** (otherwise any stray `@word` would wake the agent). Archived-but-existing targets *do* request the agent and are passed through with their status — that is the "missing or archived" case §8 tells the orchestrator to handle in its reply.

**Enqueue decision.** Compute `requestsAgent = explicitFlag || hasGenericAgentMention || resolvedMentions.length > 0 || resolvedSkills.length > 0`. Then enqueue `comment.created` when `requestsAgent`, or when the thread's `agent === 'engaged'` and the thread is not `resolved` and the request did not set `noteOnly`. On the first agent-requesting turn, set the thread's `agent` field to `requested` if it is currently `none` (the agent itself sets `engaged` on reply, per §7). Payload: `{threadId, parentId, turnTs, mentions, skills, unresolved}`.

**Forms.** A request carrying `formAnswer: {option, note?, formTurnTs?}` appends a normal user turn whose body is the rendered answer (chosen option, then the optional note) and enqueues `form.respond` with `{threadId, parentId, turnTs, formTurnTs, option, note}` instead of `comment.created`.

**Enqueue seam.** Call an injected `enqueue(event)` function (implemented by SERVER-008). Until SERVER-008 lands, wire a minimal file-drop implementation writing `.corpus/queue/pending/<id>.json`; SERVER-008 replaces it with the queue module's exported `enqueue` without touching this code.

**Invalidation seam.** Call an injected `invalidate(keys)` (implemented by SERVER-007's bus); default to a no-op so this issue can land independently. Keys per mutation: the thread, its parent, the docs collection, and `events` when something was enqueued.

**Actor / user-only deletion.** The acting party comes from the request's actor field (`from`, the same field driving the git author). Deletion routes reject `from=agent` with **403** — deletion is user-only per §6/§7, and this must be enforced server-side, not merely in the CLI.

**Cascade.** Deleting a turn rewrites the thread body without that turn. If no turns remain, delete the thread instead. Deleting a thread (directly or by cascade): unlink `data/threads/<id>.md` and, when `parent` and `anchor` are set, remove that key from the parent's `anchors` map. Everything lands in one commit (`delete: thread <id> by user`). Attachment-directory cleanup is a hook consumed by SERVER-010.

**Capture.** Create `data/docs/inbox/<slug>.md` (slug from the first line, deduped with a numeric suffix) holding the captured text, then a whole-document thread on it with `agent: requested` whose first turn asks the agent to file it. One write mutex span, one commit, one `comment.created` enqueue.

**Locks.** Honoring document locks (423 responses) is SERVER-009's scope and is deliberately out of scope here; keep the write helpers lock-check-friendly by routing all parent-frontmatter writes through the SERVER-005 document write helper.

### Edge Cases
- `parent` id not found in the projection → 404; `parent` resolving to a non-document (deleted file) → 404.
- Anchored creation where the selector text is not present in the parent body → still created; the thread is simply orphaned at projection time (§6).
- Rapid successive turn appends within the same second → monotonic bump keeps timestamps unique.
- Deleting a middle turn → thread survives, remaining turns keep their timestamps (no renumbering).
- Deleting the only turn of a standalone thread (no parent) → thread deleted, no anchor work.
- Resolve on an already-resolved thread (and reopen on an open one) → 200, no commit, no invalidation storm.
- `seen` mark older than the current mark → ignored (marks only move forward).
- Turn body containing `@agent` inside a fenced code block → not a mention.
- Concurrent thread creation on the same parent → serialized by the parent's write mutex so both anchor entries survive.
- `formAnswer` on a thread whose last agent turn has no form block → 422.
- Empty turn body with no `formAnswer` and no attachments → 422 (attachment-only turns become valid in SERVER-010).

## Testing Strategy
Vitest in `apps/server`, against a temporary workspace fixture (tmp dir, `git init`, seeded documents) driving the real Hono app via `app.request()`:
- Creation: one spec per mode; assert parent frontmatter gained exactly one anchor entry, the thread file exists with the expected frontmatter, and `git log` shows exactly one new commit touching both paths.
- Atomicity: force a failure on the thread-file write (mock `fs`) → parent frontmatter unchanged, no commit.
- Turn append: 5 appends in a tight loop → 5 strictly increasing unique timestamps.
- Mentions: table-driven cases over `@agent`, known/unknown `@subagent`, known/unknown `/skill`, code-fenced tokens → expected `requestsAgent` + payload shape.
- Enqueue matrix: plain comment / flagged / engaged / engaged+resolved / engaged+noteOnly → pending queue file count.
- Forms: `formAnswer` → answer turn body + `form.respond` payload.
- Cascade: delete middle turn, delete last turn (thread gone + anchor key gone), delete thread directly, agent actor → 403.
- Capture: one call → inbox doc + thread + one pending event + one commit.
- `seen`: mark, re-read projection row, assert no new commit.

## E2E Verification Plan

### Verification Steps
1. Start the real server against a scratch workspace: `corpus init /tmp/corpus-e2e` (or the equivalent scaffold), then run the server (`npm run dev -w apps/server`) bound to `127.0.0.1:8765` with the workspace's bearer token exported.
2. Anchored comment: `curl -X POST localhost:8765/api/threads -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"parent":"<docId>","anchor":{"exact":"...","prefix":"...","suffix":"..."},"body":"@agent is this still right?","from":"user"}'`. Then `cat` the parent markdown (anchor entry present), `cat data/threads/<th>.md` (frontmatter + first turn), `git log -1 --stat` (one commit, both files), `ls .corpus/queue/pending/` (one event; inspect its `mentions`).
3. Whole-document and standalone creation via the same endpoint; verify `anchor: null` / `parent: null` in the created files.
4. Plain reply: POST a turn with no mention and no flag → new turn in the file, **no** new file in `.corpus/queue/pending/`.
5. Engaged re-trigger: set the thread's `agent: engaged` (via the agent reply path or a direct edit + reprojection), POST a plain turn → event enqueued; repeat with `noteOnly` and after `/resolve` → no event.
6. Targeted invocation: POST a turn containing `@<an agent-def name>` and `/<a skill name>` → inspect the pending event JSON for populated `mentions` and `skills`.
7. `POST /api/threads/:id/seen` → `cat .corpus/seen.json`, confirm `git status` is clean (no commit).
8. Deletion cascade: `DELETE /api/threads/:id/turns/:ts` for a middle turn, then for the last turn → thread file gone, parent's `anchors` map no longer has the key; retry with `from=agent` → 403.
9. `POST /api/capture` → new file under `data/docs/inbox/`, a thread on it, one pending event, one commit.
10. `GET /api/threads/:id` → JSON with ordered turns matching the file on disk.

## E2E Verification Log

**implemented on: opus.** Two-agent relay — a first server-dev agent's connection
died mid-issue; this agent inherited its uncommitted work (the multi-lane mutex
and all-or-nothing rollback in `docs/write.ts`, the hex anchor alphabet in
`core/ids.ts`, `core/anchor-entries.ts`, the `deleteDoc` thread branch in
`docs/delete.ts`, the `locks/guard.ts` comment correction, the watcher's
`WATCH_FILES`, and `threads/{mentions,participation,read,title,workspace}.ts`),
verified it, and built the rest on top. The inherited modules carried **no
tests**; every test below is this agent's.

**Environment.** Real `corpus init` workspaces under `/tmp/corpus-s006-*`, real
git repositories, a real server process (`npx tsx apps/server/src/main.ts`) on
**8905** (and **8906** for the fresh-workspace re-verification). Effects read
from four independent surfaces: files on disk, `git log`/`git show`, `sqlite3
.corpus/cache.db`, and `ls .corpus/queue/pending/` (`evt_*.json` only). Both
servers stopped by pid; `lsof -nP -iTCP:8905/8906 -sTCP:LISTEN` empty afterwards;
scratch directories removed.

### Reproduction (bugs only)

Two defects were found **by E2E**, after the unit suites were green. Both are
reproductions in the strict sense — the failing behaviour was observed against
the real running server first.

**BUG-1 — `/comment` did not resolve against the seeded skill.**

```
$ curl -sS -X POST localhost:8905/api/threads/th_tuungucc/turns -H "$A" \
    -d '{"body":"@researcher please dig, then /comment on it — and ask @nobody too"}'
$ cat .corpus/queue/pending/evt_k7uetqiltpo3.json   # payload
  "mentions": [ { "name": "researcher", "docId": "doc_agentdef9aac2cc9", "status": "open" } ],
  "skills": [],
  "unresolved": [ "/comment", "@nobody" ]
```

`sqlite3 … "select id,type,title from documents where type='skill'"` →
`doc_skillcomment|skill|Comment`. The seeded `SKILL.md` carries **both** Claude
Code's `name: comment` and Corpus's `title: Comment` (§7 — "the two sets coexist
in the same YAML block"); the projection keeps the title and has no `name`
column, so a resolver matching `documents.title` answers `/comment` with nothing.
The unit suite had passed because its fixture skill had only a `name`.

**Fix**: `invocableName(path)` derives the name a document is *invocable* by from
its root (`.claude/skills/<name>/SKILL.md`, `.claude/agents/<name>.md`) — the
same name Claude Code discovers it as — and `parseMentions` indexes each type's
documents by invocable name **and** title, case-insensitively, once per sigil.

**BUG-2 — the watcher never saw `.corpus/seen.json` appear.**

```
$ sqlite3 .corpus/cache.db "select count(*) from seen"     # 1, written via the API
$ node -e "…add th_gqs5kplh to .corpus/seen.json…"          # out-of-band, in place
$ sleep 4; sqlite3 .corpus/cache.db "select thread_id,last_seen_ts from seen"
th_45bvy7cx|2026-07-27T11:38:03Z                            # unchanged — the edit was invisible
```

Isolated with a chokidar probe using the watcher's own predicate:

```
parent ignored  : []            # file absent at start, `.corpus` rejected by `isIgnoredEntry`
parent exempted : ["add","change"]
```

To notice a file that does not exist yet, chokidar must watch its **parent** —
and `.corpus` is dot-prefixed, so `ignored: (p) => !rootSet.has(p) &&
isIgnoredEntry(basename(p))` rejected it and the watch was never established.
The inherited `WATCH_FILES` work therefore closed the sprint-004 gap only for a
workspace whose `seen.json` already existed; a fresh one — every real one — never
saw its first mark-seen until a restart. **Fix**: each watched file's directory
joins the exemption set. The regression test (`watcher.test.ts` → "notices read
state appearing for the first time") was confirmed to fail without the fix and
pass with it.

### Post-Implementation Verification

Server restarted after each fix. Ids below are verbatim from the runs.

| # | What | Evidence |
| - | ---- | -------- |
| 1 | **Anchored creation, one commit, two files** | `201 {anchorId:"anc_f1396aae", eventId:"evt_ve44au72sit4"}`; parent gained exactly one `anchors` key whose `{exact,prefix,suffix}` round-trips byte-for-byte; `git log -1 --stat` → `comment: new thread on doc_s23gqi4m (th_45bvy7cx) by user`, 2 files changed |
| 2 | **§6 frontmatter** | `id/type/title/created/updated/tags/status/parent/anchor/agent` in §6's key order; `created == updated`; body is exactly `## user · 2026-07-27T11:33:58Z` + the request body |
| 3 | **Whole-document / standalone** | `anchorId:null`, `anchor:null`; standalone also `parent:null`; parent's `anchors` unchanged (still one key); commit touches only the thread file |
| 4 | **Refusals** | unknown parent → `404`; whitespace-only `exact` → `400 {"issues":[{"path":"selector.exact",…}]}`; neither wrote anything |
| 5 | **Enqueue matrix** | plain turn → `eventId:null`, pending unchanged; agent reply on a `requested` thread → `agent: engaged` (Adjudication 4); plain user turn in the engaged thread → `evt_ed265yzdxpto`; `requestsAgent:false` on `"@agent for the record"` → `null` |
| 6 | **Monotonic stamps** | `## user · …11:33:58Z`, `## agent · …11:34:44Z`, `## user · …11:34:45Z`, `## user · …11:34:46Z` — distinct and increasing inside one wall-clock second |
| 7 | **Mentions/invocations (after BUG-1)** | payload `mentions:[{researcher, doc_agentdef9aac2cc9, open}]`, `skills:[{comment, doc_skillcomment, open}]`, `unresolved:["@nobody"]` — the `agent-def` reached the projection through the **watcher**, ~4 s after the file was written |
| 8 | **Resolve / reopen** | resolve → `200 {status:"resolved"}`, one commit; second resolve → `200`, **no** commit and **no** SSE frame; plain turn in the resolved engaged thread → `eventId:null`; `requestsAgent:true` → `evt_zgtn67vc3mqz` (Adjudication 5); reopen → `200 {status:"open"}` |
| 9 | **Seen** | bare POST → `{"lastSeenTs":"2026-07-27T11:38:03Z","unread":false}`; `.corpus/seen.json` is the flat map; an older mark answers the **recorded** one unchanged; `git status --porcelain` clean of it; `select * from seen` current immediately |
| 10 | **SSE keys** | `curl -N /events` over resolve/turn/turn/reopen/seen → 6 frames, every key from the published vocabulary, none carrying data: `[["docs"],["docs","th_…"],["threads","th_…"],["docs","doc_…"]]` and `[["queue"],["jobs"]]` |
| 11 | **Turn deletion** | agent actor → `403 {"code":"forbidden","message":"turn deletion is user-only; the agent never deletes turns"}`; user → `200 {deletedTurn:true, deletedThread:false, removedAnchor:null, parentId:"doc_s23gqi4m"}`; the other four stamps unchanged. A raw (unencoded) `:` in the path is also accepted (`200`, turn deleted — Hono decodes the segment either way); a malformed segment still `400`s. _(Corrected 2026-07-27: the original log claimed `404` here; the sprint-006 evaluator (DISC-1) showed it returns `200` and deletes the turn.)_ |
| 12 | **Last-turn cascade** | `200 {deletedThread:true, removedAnchor:"anc_5bfc6b58", parentId:"doc_s23gqi4m"}`; thread file gone; the parent's *other* anchor untouched; **one** commit staging both paths; `git show HEAD~1:data/threads/th_d3qd2gcc.md` intact; `threads`/`anchors` rows gone |
| 13 | **`DELETE /api/docs/<th_*>`** | agent → `403`; user → `200`, thread file gone, parent's anchor key gone, one commit staging both paths |
| 14 | **Capture, via the generated typed client** | `client.capture(...)` (real multipart, `uploadCapture`) → `{docId:"doc_tgkddufu", threadId:"th_hv22c35h", eventId:"evt_slxsheuhnsmd"}`; `data/docs/inbox/call-the-bank-about-the-rate-lock.md`; filing thread `agent: requested`, one `## user` turn carrying the text **and** the filing ask; one pending event; one commit staging both files |
| 15 | **Capture: dedupe + note-only** | the same text again → different `docId`, `…-2.md`, first file untouched; `requestsAgent:"false"` → `eventId:null`, both files still created, thread `agent: none` |
| 16 | **Attachments refused honestly** | `client.uploadTurn({files:[File]})` → `400 [{"path":"files","message":"attachments are not accepted yet: ingest and serving land in SERVER-010"}]`, nothing written. `DEFERRED → SERVER-010` |
| 17 | **Typed client round-trip** | `client.api.GET("/api/threads/{id}")` → `{id, title:"Re: call the bank about the rate lock", agent:"requested", parent:"doc_tgkddufu", turns:2}` |
| 18 | **Anchor context** | `GET /api/docs/doc_s23gqi4m` → `ResolvedAnchor` `{anchorId, selector, threadId, threadStatus, range:{start:13,end:43}, orphaned:false}` |
| 19 | **A parked long-poll wakes** | `GET /api/queue/idle?timeout=30` held open; an `@agent` turn on another connection returned it `200` with `comment.created` — `total=2.16s` against a 2 s sleep, so ~0.16 s wake. Proves the thread path went through `server.queue.enqueue`, not a file drop |
| 20 | **§11 hook rejection** | `.git/hooks/pre-commit` exiting 1 → `201` with `warnings:[{"code":"commit_failed","detail":"git commit failed: doc check: refusing"}]`, file **stands** on disk, 0 commits added, and the log line `"mutation completed with a warning" … "the file mutation stands; a §11 warning never fails a write"` |
| 21 | **Read state out of band (after BUG-2)** | fresh workspace on 8906, `seen.json` absent at boot; API mark → row present; out-of-band append → both rows within ~3 s, **no restart** |
| 22 | **Latency (TEST-76)** | 27 documents projected, 10 iterations each, wall clock: create `median 76 ms / p95 114 ms`, turn append `median 107 ms / p95 110 ms`, turn delete `median 105 ms / p95 110 ms`. No call above 1 s |

**Event payload shape produced (the Integration Points contract with AGENT-002),
verbatim:**

```json
{
  "id": "evt_ve44au72sit4",
  "type": "comment.created",
  "created": "2026-07-27T11:33:58Z",
  "source": "thread",
  "payload": {
    "threadId": "th_45bvy7cx",
    "parentId": "doc_s23gqi4m",
    "turnTs": "2026-07-27T11:33:58Z",
    "mentions": [{ "name": "researcher", "docId": "doc_agentdef9aac2cc9", "status": "open" }],
    "skills": [{ "name": "comment", "docId": "doc_skillcomment", "status": "open" }],
    "unresolved": ["@nobody"]
  },
  "status": "pending",
  "updated": "2026-07-27T11:33:58Z"
}
```

`source` is `thread` for the thread endpoints and `capture` for `POST
/api/capture`; the server cannot honestly say "ui" or "cli" (both are HTTP
clients of the same route and neither identifies itself).

**Title truncation constants**: `ANCHOR_TITLE_QUOTE_LENGTH = 60`
(`Re: "<first 60 chars>"`), `STANDALONE_TITLE_LENGTH = 80`,
`UNTITLED_THREAD = "Untitled thread"`, `CAPTURE_TITLE_LENGTH = 80`.

**Deferrals recorded**: attachments on turns and captures → `DEFERRED →
SERVER-010` (multipart parse path implemented, `files` refused with a `400`
naming it). Forms → struck (Adjudication 3), not stubbed. `deferredEventId` is
untouched (Open Conflict 14).

**Gate**: `npm run build`, `npm run lint`, `npm run format:check`, `npm run
typecheck` all clean; `vitest run --coverage` → **3005 tests, 169 files, all
passing**, 98.69 % lines / 94.88 % branches / 99.44 % functions (gate 90 %).

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain surface)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-006]` prefix
