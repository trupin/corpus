# [SERVER-007] Watcher + SSE invalidation

## Domain
server

## Status
todo

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
- [ ] Chokidar watches `data/`, `.claude/skills/`, `.claude/skills-archived/`, `.claude/agents/`, `.corpus/queue/`, `.corpus/locks/`, and `.corpus/jobs/`.
- [ ] Changes are debounced and coalesced; each batch re-projects only the affected files (add/change → upsert rows, unlink → delete rows) and emits one invalidation carrying the union of affected keys.
- [ ] Out-of-band changes to a document under a document root run `reconcileAnchors(oldBody, newBody, anchors)` with the **git HEAD version of the file** as `oldBody` before projecting; remapped anchors are written back to the file's frontmatter and auto-committed.
- [ ] Writes performed by the server itself do not trigger a redundant watcher re-projection (self-write suppression) — the write path already projected synchronously and broadcast.
- [ ] `GET /events` streams `text/event-stream`, emits only events of type `invalidate` whose payload is `{keys: string[]}`, and never carries document, thread, or job data.
- [ ] A 25 s heartbeat keeps connections alive; subscribers that error on write are pruned from the registry.
- [ ] An internal event bus is exported so server write paths broadcast invalidations directly, without a watcher round-trip; the watcher is the catch-all for out-of-band changes only.
- [ ] Measured E2E: touching a file on disk produces an observable SSE `invalidate` in well under 250 ms.

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

### Reproduction (bugs only)
_[Agent fills: exact commands, observed output, confirmation bug exists]_

### Post-Implementation Verification
_[Agent fills: application restarted, exact commands, observed output, confirmation fix/feature works]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain surface)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-007]` prefix
