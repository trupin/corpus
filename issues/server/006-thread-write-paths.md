# [SERVER-006] Thread write paths: creation, turns, events, cascade

## Domain
server

## Status
todo

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
- [ ] `POST /api/threads` supports all three creation modes: **anchored** (`parent` + text-quote selector — the anchor entry is written into the parent's frontmatter and the thread file is created atomically, in one auto-commit), **whole-document** (`parent`, no anchor), **standalone** (`parent: null` — the composer's Ask).
- [ ] Thread creation accepts the first turn body, an author (`user` | `agent`), and an agent-request flag; the created thread's frontmatter matches §6 (`id: th_*`, `type: thread`, `parent`, `anchor`, `agent`, `status: open`, derived `title`).
- [ ] `POST /api/threads/:id/turns` appends a turn as `## <author> · <ISO ts>` with a timestamp that is **unique and monotonically increasing within the thread** (via the core turn helpers from SERVER-001).
- [ ] Mentions and invocations are parsed at post time per §8 (`@agent`, `@<subagent>` matching an `agent-def` document name, `/<skill>` matching a `skill` document name), validated against the projection, and emitted as structured `mentions` / `skills` fields in the event payload.
- [ ] A plain comment (no flag, no recognized mention/invocation, thread not `engaged`) appends the turn and enqueues **nothing**.
- [ ] A turn that requests the agent — explicit flag, `@agent`, a resolved `@<subagent>`, or a resolved `/<skill>` — enqueues `comment.created`.
- [ ] A turn in a thread with `agent: engaged` enqueues `comment.created` **unless** the thread is `resolved` or the request carries the "note only" flag.
- [ ] A form answer (`formAnswer` on the turn request) appends a structured answer turn (chosen option + optional note) and enqueues `form.respond`.
- [ ] `POST /api/threads/:id/resolve` and `/reopen` flip `status` (idempotent), auto-commit, re-project, invalidate.
- [ ] `POST /api/threads/:id/seen` updates `.corpus/seen.json`, re-projects the `seen` table, and broadcasts an invalidation; it makes **no** git commit (runtime state).
- [ ] `DELETE /api/threads/:id/turns/:ts` is **user-only** (agent actor → 403) and cascades: deleting the last remaining turn deletes the thread, and deleting a thread removes its anchor entry from the parent's frontmatter.
- [ ] `DELETE /api/threads/:id` deletes the thread file and removes its anchor entry from the parent (user-only, same cascade rules).
- [ ] `POST /api/capture` creates the inbox document **and** its agent-requested whole-document filing thread in one call and one commit.
- [ ] `GET /api/threads/:id` returns the thread frontmatter plus its ordered turns (idx, author, ts, body) and anchor context when anchored.
- [ ] Every mutating endpoint re-projects the affected rows synchronously before responding (read-your-write per §9.1) and emits an invalidation.

## Technical Design

### Files to Create/Modify
- `apps/server/src/threads/routes.ts` — register the CONTRACT-002 thread route definitions against handlers
- `apps/server/src/threads/create.ts` — three-mode creation + atomic parent-anchor write
- `apps/server/src/threads/turns.ts` — turn append, monotonic ts, form answers, turn deletion
- `apps/server/src/threads/mentions.ts` — `@`/`/` parsing + projection validation
- `apps/server/src/threads/cascade.ts` — turn → thread → anchor-entry deletion cascade
- `apps/server/src/threads/seen.ts` — `.corpus/seen.json` read/write + projection
- `apps/server/src/capture/capture.ts` — `POST /api/capture` composition (inbox doc + filing thread)
- `apps/server/src/threads/*.test.ts` — colocated Vitest specs
- `apps/server/src/app.ts` — mount the thread + capture routes

### Key Implementation Details

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
- [ ] Committed with `[SERVER-006]` prefix
