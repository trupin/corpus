# [SERVER-007] Watcher + SSE invalidation

## Domain
server

## Status
done

## Priority
P0

## Model
opus — the pattern is proven in the prior system and the spec pins the semantics (invalidate-only SSE, watch roots, out-of-band reconciliation).

## Dependencies
- Depends on: SERVER-004
- Blocks: SERVER-009, UI-002

## Spec References
- SPEC.md §2 — "Architecture overview", rules 2 and 3 (~250 ms round-trip; the server never pushes data over SSE, only `invalidate`)
- SPEC.md §6 — "Threads and anchors" (anchor reconciliation, out-of-band catch-all using git HEAD as `oldBody`)
- SPEC.md §9.1 — "Projection (SQLite)" (watch roots, synchronous re-projection for read-your-write)
- SPEC.md §9.2 — `GET /events`

## Summary
Wire the live-update loop: a chokidar watcher over every document and runtime root that debounces and re-projects changed files, an internal event bus that write paths publish to directly, and a `GET /events` SSE endpoint that broadcasts **only** `invalidate` payloads carrying TanStack query keys. Out-of-band document edits (an external editor writing straight to disk) additionally run anchor reconciliation against the git HEAD version before projection, so anchors survive edits Corpus never saw. The end-to-end budget is a file change visible as an SSE event well under the ~250 ms round-trip target of §2.

## Acceptance Criteria
- [x] Chokidar watches `data/`, `.claude/skills/`, `.claude/skills-archived/`, `.claude/agents/`, `.corpus/queue/`, `.corpus/locks/`, and `.corpus/jobs/`.
- [x] Changes are debounced and coalesced; each batch re-projects only the affected files (add/change → upsert rows, unlink → delete rows) and emits one invalidation carrying the union of affected keys.
- [x] Out-of-band changes to a document under a document root run `reconcileAnchors(oldBody, newBody, anchors)` with the **git HEAD version of the file** as `oldBody` before projecting; remapped anchors are written back to the file's frontmatter. _(Auto-commit `DEFERRED → SERVER-005` per Adjudication 3.)_
- [x] Writes performed by the server itself do not trigger a redundant watcher re-projection (self-write suppression) — the write path already projected synchronously and broadcast.
- [x] `GET /events` streams `text/event-stream`, emits only events of type `invalidate` whose payload is `{keys: QueryKey[]}` (Adjudication 1), and never carries document, thread, or job data.
- [x] A 25 s heartbeat keeps connections alive; subscribers that error on write are pruned from the registry.
- [x] An internal event bus is exported so server write paths broadcast invalidations directly, without a watcher round-trip; the watcher is the catch-all for out-of-band changes only.
- [x] Measured E2E: touching a file on disk produces an observable SSE `invalidate` in well under 250 ms (median 132 ms plain, 137 ms anchored).

## Sprint-004 Adjudications (binding, 2026-07-27)

Orchestrator decisions on the sprint-004 Open Conflicts affecting this issue — implement exactly these; full reasoning in `issues/sprints/sprint-004.md`:

1. **SSE payload**: the shipped `InvalidatePayloadSchema` wins — `{keys: QueryKey[]}` where each key is an ARRAY (UI-001's `createEventStream` already validates exactly that). The query-key vocabulary gets published in the contract by CONTRACT-005 before UI-002; use the contract's shapes verbatim meanwhile.
2. **`createServer` stays pure**: the projection is opened in `lifecycle.ts` BEFORE `createServer` and passed as a dep — this issue lands that seam (SERVER-011 consumes it).
3. **Auto-commit is out of reach**: no git writer exists in `apps/server` until SERVER-005. Watcher reconciliation reads `git show HEAD:` for oldBody and writes reconciled frontmatter back; the auto-commit leg is DEFERRED → SERVER-005 (record it, don't fake it).
4. **No subscriber cap**: the 32-subscriber 503 is dropped for v1 — it would need an undeclared response; dead-subscriber pruning is the protection.

## Technical Design

### Files to Create/Modify
- `apps/server/src/events/bus.ts` — in-process emitter: `invalidate(keys)`, `subscribe(fn)`, key coalescing
- `apps/server/src/events/keys.ts` — the invalidation key vocabulary + helpers (`docKey(id)`, `threadKey(id)`, `docsCollection`, `tree`, `jobs`, `queue`, `locks`)
- `apps/server/src/events/sse.ts` — `GET /events` handler, subscriber registry, heartbeat, pruning
- `apps/server/src/watcher/watcher.ts` — chokidar setup, roots, debounce, batch dispatch
- `apps/server/src/watcher/reconcile-out-of-band.ts` — git-HEAD `oldBody` fetch + reconciliation + write-back
- `apps/server/src/watcher/self-writes.ts` — suppression registry for server-originated writes
- `apps/server/src/watcher/*.test.ts`, `apps/server/src/events/*.test.ts` — colocated Vitest specs
- `apps/server/src/app.ts` — mount `/events`, start/stop the watcher with the server lifecycle

### Key Implementation Details

- **Watcher scope includes `.corpus/queue/`** _(mirror-wiring handoff, 2026-07-26)_: an `evt_*.json` dropped out of band while the server runs wakes a parked long-poll (queue's 500 ms poll) but produces no `events` row until a claim or restart — `db doctor` reports that window as `count_mismatch`. The watcher re-projects queue events like any other out-of-band write (`projectEvent`/`removeEvent` in projection/project-runtime.ts are the seam).


**Watcher configuration.** One chokidar instance over the resolved absolute roots with `ignoreInitial: true`, `awaitWriteFinish: {stabilityThreshold: 40, pollInterval: 10}`, and ignores for `.git/`, `node_modules/`, `.corpus/cache.db*`, and `.corpus/attachments/` (bytes are served, never projected). Skill documents are matched as `.claude/skills/**/SKILL.md`; agent definitions as `.claude/agents/*.md`.

**Debounce and batching.** Accumulate `(path, event)` into a map keyed by path; flush on a trailing 50 ms timer (cap the pending window at 250 ms so a stream of writes still flushes within budget). Per batch: classify each path into its root type, re-project, collect keys, emit one `bus.invalidate(keys)`.

**Self-write suppression.** The write paths register `(absolutePath, contentHash)` in a short-lived map (TTL ~2 s) before writing. The watcher drops an event whose path+hash matches a registered entry and removes it. Hash matching (not path alone) means a genuine external edit landing immediately after a server write is still processed.

**Out-of-band reconciliation (§6 catch-all).** For a change to a document under `data/` (or a skill/agent-def root) that was *not* suppressed:
1. Read the current file (frontmatter + body).
2. Fetch `oldBody` via `git show HEAD:<repo-relative-path>` — on failure (untracked/new file, or no commits yet) skip reconciliation and just project.
3. If the parsed old body equals the new body, skip.
4. Run the shared `reconcileAnchors(oldBody, newBody, anchors)` helper from the anchor engine (SERVER-002) — the same one the document write paths use.
5. If any anchor changed, write the updated `anchors` map back through the document write helper and auto-commit (`reconcile: anchors on <docId> after external edit`), registering the write-back as a self-write so it doesn't loop.
6. Project the file.

Guard against reconciliation loops with a per-path re-entrancy flag.

**SSE endpoint.** Manual `ReadableStream` (or Hono's `streamSSE`) writing `event: invalidate\ndata: {"keys":[...]}\n\n`. Keep a `Set` of subscriber write handles; on write error or stream close, delete the entry. Heartbeat every 25 s as an SSE comment line (`:hb\n\n`) — cheap and invisible to `EventSource` consumers. Bound the registry (e.g. 32 subscribers) and reject beyond it with 503. Authentication uses the same bearer middleware as the rest of the API; `EventSource` cannot set headers, so also accept the token as a query parameter on this route only (the UI/kit uses that form) and document it in the contract.

**Rule 3 is a hard constraint.** No handler in this issue may put document, thread, job, or queue *data* on the wire. If a consumer appears to need data over SSE, that is a design change requiring escalation, not a payload extension.

**Key vocabulary.** Start with: `docs` (collection), `docs/<id>`, `threads/<id>`, `tree`, `queue`, `jobs`, `jobs/<eventId>`, `locks`, `locks/<docId>`. Keep the strings in `events/keys.ts`; the UI/kit mirrors them. If the vocabulary needs to be shared as part of the typed contract, file a CONTRACT issue rather than importing across domains.

### Edge Cases
- Editor save patterns (atomic rename, temp files, `.swp`) → `awaitWriteFinish` plus an ignore pattern for `*~`, `.#*`, `*.swp`, `.DS_Store`.
- A directory rename/move under `data/` → chokidar emits unlink+add per file; projection must handle the path change while `id` stays stable.
- Unlink of a document that still has threads → rows removed; threads keep their `parent` (orphaned records per §9.2), no crash.
- Watcher fires before the projection has a row (brand-new file) → upsert, not update.
- Reconciliation when the file has no `anchors` map → skip cheaply.
- Repo with zero commits (fresh `corpus init` before its first commit) → `git show HEAD:` fails; treat as "no old body".
- SSE client disconnecting mid-write → `EPIPE`/`ERR_STREAM_DESTROYED` handled as a prune, not a 500.
- Burst of 100 file changes → one or a few coalesced invalidations, not 100 SSE events.
- Watcher start failure (missing root directory) → create the runtime dirs at boot rather than crashing.

## Testing Strategy
Vitest in `apps/server` against a temp workspace fixture:
- Bus: subscribe, publish, coalescing of duplicate keys, unsubscribe.
- SSE: drive the mounted Hono app, read the response stream, assert `invalidate` framing, assert a heartbeat arrives with fake timers, assert a broken writer is pruned from the registry.
- Watcher: write a file directly with `fs`, await an invalidation from the bus (with a generous test timeout), assert the projection row exists; unlink → row gone.
- Self-write suppression: register a write, touch the file, assert no watcher-originated re-projection occurred (spy on the projection function).
- Out-of-band reconciliation: commit a doc with an anchor, edit the body on disk around the anchored text, wait for the watcher, assert the frontmatter selector was remapped and a `reconcile:` commit exists.
- Rule 3 regression test: capture every SSE frame emitted during a mutation-heavy scenario and assert each payload has only a `keys` array.

## E2E Verification Plan

### Verification Steps
1. Start the real server against a scratch workspace with a token exported.
2. Open the stream: `curl -N "localhost:8765/events?token=$TOKEN"` in one terminal.
3. In another terminal, `echo` an edit into a document under `data/docs/` → observe an `invalidate` frame naming that document's key within a few hundred ms; time it with `date +%s%3N` before the edit and compare against the frame's arrival.
4. Leave the stream idle for 30 s → observe the heartbeat; the connection stays open.
5. Out-of-band anchor drift: commit a document that has an anchor, edit the anchored sentence with a plain editor (`sed -i ''` / an actual editor), wait for the watcher, then `cat` the file → the `exact`/`prefix`/`suffix` were remapped and `git log -1` shows the `reconcile:` commit.
6. Delete a document file on disk → `GET /api/docs` no longer lists it and an invalidation was broadcast.
7. Perform a mutation through the API (e.g. `POST /api/threads`) → exactly one invalidation observed on the stream (broadcast by the write path, not duplicated by the watcher).
8. Kill the `curl` client mid-stream, then perform another mutation → the server logs no error and continues serving.

## E2E Verification Log
_Filled in by the implementing agent as proof-of-work. Must be from real E2E
testing — no mocks, no test clients. Real application, real requests, real
interfaces. Include specific commands run, actual outputs observed, and pass/fail
conclusions. State which model the implementing agent ran on ("implemented on:
opus | fable")._

**implemented on: opus** (sprint-004 recommendation followed; no escalation to fable needed).

### Reproduction (bugs only)
Not applicable — this is a feature, not a bug.

### Post-Implementation Verification

Environment: real `corpus init` workspace at `/tmp/corpus-s007-sGnJU1`, real server process
(`./node_modules/.bin/tsx apps/server/src/main.ts "$WS"`, `CORPUS_LOG_LEVEL=debug`) on the
assigned port **8815**, SSE read by real `curl -sSN` holding real sockets, out-of-band edits by
real `printf >>`, `sed -i ''`, `mv` and `rm`, projection read with the `sqlite3` CLI. Every
process stopped by pid. `8765` never bound. Baseline corpus: the 6 documents `corpus init` seeds
(1 template, 3 views, 2 skills).

**Boot.**
```
{"level":"debug","msg":"projection ready","path":"/tmp/corpus-s007-sGnJU1/.corpus/cache.db",...}
{"level":"info","msg":"listening on http://127.0.0.1:8815",...}
{"level":"debug","msg":"watcher ready","roots":7}
$ curl -sS http://127.0.0.1:8815/api/health
{"status":"ok","version":"0.0.0","uptimeSeconds":7.713,"workspace":"/tmp/corpus-s007-sGnJU1"}
```

**Stream framing and auth (TEST-5/6/7).**
```
$ curl -sSN -D - "http://127.0.0.1:8815/events?token=$TOKEN"
HTTP/1.1 200 OK
cache-control: no-cache
connection: keep-alive
content-type: text/event-stream
transfer-encoding: chunked
:connected
```
`Authorization: Bearer` with no query parameter → `200 text/event-stream`. No token → **401**;
`?token=wrong` → **401**; `GET /api/docs?token=$TOKEN` → **401** (the query exemption is
`/events`-only).

**Every §9.1 root is watched (TEST-13).** One file created out of band in each of the eight
locations produced a single coalesced frame and rows in every table:
```
event: invalidate
data: {"keys":[["queue"],["jobs"],["docs"],["docs","doc_agentdef94386e0e"],["tree"],["locks"],
["locks","doc_r13docs01"],["jobs","evt_r13000000000"],["docs","doc_r13docs01"],
["docs","doc_skill41b10ce6"],["docs","th_r13thread"],["threads","th_r13thread"],
["docs","doc_skillfb157be1"]]}

sqlite3 …/cache.db "select id,type,path from documents order by path"
doc_agentdef94386e0e|agent-def|.claude/agents/librarian.md
doc_skill41b10ce6|skill|.claude/skills-archived/old/SKILL.md
doc_skillfb157be1|skill|.claude/skills/demo/SKILL.md
doc_r13docs01|note|data/docs/finance/r13.md
th_r13thread|thread|data/threads/th_r13thread.md
events: evt_r13000000000|pending · locks: doc_r13docs01|agent · jobs: evt_r13000000000|job started
```

**Ignores, and not over-ignoring (TEST-17).** `.r13.md.swp`, `#r13.md#`, `r13.md~`, `.DS_Store`,
`notes.txt` → SSE log byte count unchanged (`before=320 after=320`), zero rows. An atomic-rename
save (`.tmp-atomic.md` → `atomic.md`) in the same directory produced **exactly one** frame,
`{"keys":[["docs"],["docs","doc_atomic001"],["tree"]]}`, and one row.

**Unlink (TEST-15).** `rm data/docs/finance/r13.md` →
`{"keys":[["docs"],["docs","doc_r13docs01"],["tree"]]}`; `documents`/`search` rows gone; the child
thread survives as an orphaned record with `parent_id=doc_r13docs01` intact; server still serving.

**Directory rename (TEST-16).** `mv data/docs/folder data/docs/renamed` → the three rows keep
`doc_ren0000a|b|c` with new paths, `select count(*) from documents` unchanged at 16, no duplicates.

**Out-of-band anchor reconciliation (TEST-21/22/23), DEFERRED → SERVER-005 for the commit.**
A committed `data/docs/finance/rates.md` carrying `anc_k4f7` was edited with
`sed -i '' 's/6\.1%/6.4%/'`:
```
--- file after reconciliation ---
anchors:
  anc_k4f7:
    exact: assume a 30-year fixed at 6.4%
    prefix: |-
      # Rates
      The model we
    suffix: |2-
       which may be stale.
--- projection ---
doc_rates0001|anc_k4f7|assume a 30-year fixed at 6.4%|23      ← resolved_offset non-NULL, not orphaned
--- frames for the edit ---
event: invalidate
data: {"keys":[["docs"],["docs","doc_rates0001"]]}            ← exactly one
--- fixed point ---
shasum before/after a 3 s wait: identical; `grep -c "reconciled anchors" server.log` → 1
```
- **`DEFERRED → SERVER-005`**: no `reconcile: anchors on <docId> after external edit` commit was
  made and `git log -1` still shows `seed rates`. The log records the deferral explicitly:
  `{"msg":"reconciled anchors after an out-of-band edit","remapped":1,"orphaned":0,"commit":"deferred"}`.
  Substitute evidence for the write-back leg is the reconciled frontmatter on disk plus the
  non-NULL `resolved_offset` above. Consequence, stated honestly: until SERVER-005 lands, `HEAD`
  only advances when someone commits by hand, so a second out-of-band edit reconciles against an
  older `oldBody` — a wider but still valid diff.
- **TEST-22(b)** brand-new *untracked* anchored document → projected normally, `anchors` block on
  disk untouched, `resolved_offset` 12, no error and no stack trace in the log
  (`grep -c '"level":"error"\|"stack"' server.log` → 0).
- **TEST-22(c)** repository with **no commits at all** → `reconcileOutOfBandEdit` returned
  `{"kind":"skipped","reason":"no committed version"}` and left the file byte-identical.

**Self-write suppression (TEST-19).** `POST /api/queue/claim-all` then
`POST /api/queue/{id}/complete` over real HTTP produced **exactly two** frames — one per
transition, both `{"keys":[["queue"],["jobs"]]}` — with the file moves under `.corpus/queue/`
producing none. The `events` row followed the directory: `evt_r13000000000|processed`.

**Out-of-band `evt_*.json` with a parked long-poll (TEST-18).** With
`GET /api/queue/idle?timeout=30` parked, another process dropped `evt_park00000000.json` into
`pending/`: the poll woke with the event, **and** `select id,status from events` showed
`evt_park00000000|pending` *before any claim and without a restart*. `doctor` → `ok: true,
drift: []`; the `.gitkeep` files in the status directories produced no rows and no
`count_mismatch`.

**Latency (TEST-24), 5 runs each, `python3 time.time()*1000` either side of the write, arrival
detected by growth of the `curl -N` output file.**

| scenario | runs (ms) | min | median | max |
| --- | --- | --- | --- | --- |
| plain document, `printf >>` | 118, 131, 132, 132, 132 | **118** | **132** | **132** |
| anchored + committed document (pays `git show` + reconciliation) | 139, 136, 137, 136, 138 | **136** | **137** | **139** |

Both well under the §2 250 ms budget; the anchored path costs ~5 ms more, which is data for
SERVER-005's budget and needs no escalation.

**Rule 3 is absolute (TEST-11).** Every frame captured across the whole session (20 event frames,
7 comment frames) was parsed:
```
event names on the wire: {'event: invalidate'}
comment frames: [':connected', ':hb']
violations: []
```
No payload carried any key but `keys`; no `doc`/`body`/`title`/`thread`/`turn`/`job`/`event`/
`payload`/`excerpt` token appeared at any depth. **Vocabulary emitted verbatim, for UI-002 to
mirror:**
```
["docs"]                 ["docs","<docId|threadId>"]     ["tree"]
["threads","<threadId>"] ["queue"]                       ["jobs"]
["jobs","<eventId>"]     ["locks"]                       ["locks","<docId>"]
```

**Heartbeat and pruning (TEST-8/9/10/12).** Six `:hb` comment frames arrived on the idle stream
over the session (25 s apart) and the connection stayed open and usable. Three concurrent clients
received byte-identical frames (`diff` of the two long-lived logs: identical). Client A was killed
with `kill -9` mid-stream; the two following mutations both reached client B, `GET /api/health`
returned `200`, the server logged **zero** `error`-level lines, and the next attach reported
`{"msg":"sse subscriber attached","subscribers":2}` — the dead one was gone from the registry.

**Shutdown.** `kill -TERM` with a client still attached: `shutting down` → `shutdown complete`,
process exited, the attached `curl` exited on its own, `lsof -nP -iTCP:8815 -sTCP:LISTEN` empty.
Every scratch directory was removed by variable; no stray process, no `8765` binding.

**Observation for SERVER-009 (not a regression).** A queue transition updates `events.status` but
not the `jobs` row's `status` column, which is joined at projection time — after
`claim-all`+`complete` the console row still read `pending`. That gap predates this issue (the
queue mirror has always upserted `events` only) and is the jobs surface's own concern; the
watcher would have papered over it only by re-projecting a write it must suppress.

## Completion Checklist (domain agent)
- [x] Tests written and passing (1131 → 1148 server tests; full repo suite green)
- [x] `/lint` passes (ESLint + Prettier + `tsc --noEmit` across every workspace)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain surface)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-007]` prefix
