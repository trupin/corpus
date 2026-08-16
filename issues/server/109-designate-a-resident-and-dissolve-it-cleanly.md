# [SERVER-109] Designate a resident, and dissolve it cleanly

## Domain
server

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: [CONTRACT-051]
- Blocks: [SERVER-111], [CLI-043]

## Spec References
- SPEC.md §8 as amended by SHARED-043 — designation, dissolution

## Summary
Implement the designation routes. `POST /api/threads/{id}/resident {name}` marks a
**standalone** thread (`parent: null`) as having a resident agent: resolve `name` against
agent-defs the way mentions do (`apps/server/src/threads/mentions.ts:119-127,138-157`),
write `resident: {name, docId}` into the thread's frontmatter, enqueue a
`resident.designated` event on the **orchestrator lane** (that is how the orchestrator
learns to launch the listener, AGENT-026), and invalidate. `DELETE` dissolves: clear the
field, notify the lane's waiters so a parked listener unparks and sees its lane is gone,
and let SERVER-111's claim-time fallback route everything to the orchestrator from then on.
Thread resolution dissolves the same way.

## Acceptance Criteria
- [~] Designation: user actor only (403 for agent — pinning is the person's act); standalone threads only (409 otherwise, per contract); unknown name → 404; an archived agent-def **designates** (never silently ignored, never silently refused). **Its `status` is not surfaced on the response**: CONTRACT-051's `Resident` carries `{name, docId}` and no status, and `ThreadMutationResponse` has nowhere else to put one — no warning code fits either (`WARNING_CODES` is a closed set about commits and anchors). The `docId` names the document, so a caller that cares can read its status. Surfacing it would be a contract change
- [x] `resident` written into the thread's frontmatter (as a new key it lands last, after `origin` — `setFrontmatterFields` appends, and §6's example fixes an order only for the keys a create writes); read back leniently (an unusable value reads as no resident, as `origin` does); on the wire per CONTRACT-051
- [x] `resident.designated` enqueued with payload `{threadId, resident: {name, docId}}` through the ordinary `enqueue` path — it lands on the orchestrator lane per SERVER-111's type-based exception (that rule is SERVER-111's to implement and test; this issue only asserts the event exists and names its payload)
- [~] Dissolution (`DELETE`, **`200` + `ThreadMutationResponse`** per CONTRACT-051, idempotent) and thread `resolve` both clear the field. **The `notify(th_x)` half is not done here**: the waiter registry is lane-blind until SERVER-111 keys it, so there is no per-lane waiter to notify and nothing to fake
- [x] Re-designation with a different name is legal (user-only): one call, field replaced, a fresh `resident.designated` enqueued
- [x] Designation state readable cheaply by the queue: projection carries `resident` so SERVER-111's per-turn lookup is one SQLite read; changes invalidate `["threads", id]` and `["agents"]`

## Technical Design

### Files to Create/Modify
- `apps/server/src/threads/resident.ts` — new: designate/release, validation, event payload
- `apps/server/src/threads/routes` wiring per contract (follow `thread-reattach.ts`'s route shape)
- `apps/server/src/threads/read.ts` / `create.ts` — frontmatter field round-trip
- `apps/server/src/projection/project-document.ts` — project `resident` for thread rows

### Key Implementation Details
Designation is thread state, not a session: it survives restarts in frontmatter and git,
which is what makes the roster's "designated but not live" row possible. The
`resident.designated` event is deliberately ordinary — same store, same settle verbs, shows
in the console like any job — so launching a listener is auditable work, not magic.
Reuse `invocableName`/`targetIndex` rather than duplicating resolution; first row in id
order wins, same tie-break as mentions.

### Edge Cases
- Designating a thread whose scope already has artifacts (origin stamped before designation): nothing to do — scope is computed, the lane simply starts routing; state this in the route's doc comment
- Deleting the agent-def document after designation: designation keeps `{name, docId}`; the roster shows the name; the converse skill handles a gone persona like a gone mention target (do the work, say the persona is missing)
- Dissolving while events sit pending in the lane: they keep their lane stamp; fallback makes them orchestrator-visible immediately since a dissolved lane is never live

## Testing Strategy
Unit: validation matrix (actor, shape, name resolution, archived). Integration: designate →
frontmatter + projection + event on orchestrator lane; dissolve → notify + fallback
visibility; resolve-dissolves; idempotent delete; re-designation.

## E2E Verification Plan

### Verification Steps
1. Real server; create standalone thread, add `.claude/agents/researcher.md`
2. `POST /api/threads/{id}/resident {"name":"researcher"}` as user → 200; `corpus thread show` prints the resident; console shows `resident.designated` pending
3. Same call `--from agent` → 403; on an anchored thread → 409
4. `DELETE` → 204 twice; roster row disappears; a pending scoped event becomes claimable by plain `claim-all`

## E2E Verification Log

Implemented by **server-dev on Opus 5 (1M context)**, 2026-08-16.

### Post-Implementation Verification

Real workspace at `/tmp/corpus-s109-e2e` (`corpus init`, port pinned to **8891** — the user's
server holds 8765), real server started with `corpus server start` (pid 43062, stopped and port
verified free afterwards), driven with `curl` and the real `corpus` CLI.

**1. Designation writes the file, commits it, projects it, announces it, enqueues.**

```
POST /api/threads/th_rntsamxo/resident {"name":"researcher"}  -> 200
{"thread":{…,"resident":{"name":"researcher","docId":"doc_agentdef9aac2cc9"}},"warnings":[]}
```

`data/threads/th_rntsamxo.md` frontmatter gained, after `agent`/`origin`:

```yaml
resident:
  name: researcher
  docId: doc_agentdef9aac2cc9
```

`git log --format='%h %an %s' -3`:

```
f0b96ef user resident designate: researcher on Let us plan the archive migration. (th_rntsamxo) by user
3b37d7b user editing session: 3 documents by user
e835651 user workspace: initialize corpus workspace by user
```

`.corpus/queue/pending/evt_qp5y3az3bw5v.json`:

```json
{"id":"evt_qp5y3az3bw5v","type":"resident.designated","created":"2026-08-16T16:14:19Z",
 "source":"thread","payload":{"threadId":"th_rntsamxo",
 "resident":{"name":"researcher","docId":"doc_agentdef9aac2cc9"}},"status":"pending"}
```

SSE on `GET /events` while designating (two frames — the write's, then the queue's own):

```
data: {"keys":[["docs"],["docs","th_rntsamxo"],["threads","th_rntsamxo"],["agents"]]}
data: {"keys":[["queue"],["jobs"],["docs"]]}
```

The event is ordinary queue vocabulary: `corpus job list` shows it `pending` and
`corpus queue claim-all` claims it with its payload intact.

**2. Refusals, each against the running server.**

| request | answer |
| --- | --- |
| `POST …/resident` with `x-corpus-author: agent` | `403 forbidden` ("designating a resident is user-only…") |
| `DELETE …/resident` with `x-corpus-author: agent` | `403 forbidden` |
| `POST …/resident` on the anchored thread `th_pmh5fq4s` | `409 conflict` ("only a standalone thread may have a resident…") |
| `POST …/resident {"name":"nobody"}` | `404 not_found` ("no agent named nobody in this workspace…") |
| `POST …/resident {"name":""}` | `400 bad_request`, issues on `json.name` |
| `POST`/`DELETE` on `th_zzzzzzzz` | `404 not_found` |

**3. Dissolution.** `DELETE …/resident` → `200`, `resident: null` on the response, and the
**key is gone from the file** (not `resident: null`), one commit
`resident release: … (th_rntsamxo) by user`. A second `DELETE` → `200`, byte-identical file, no
new commit, no frame.

**4. Resolve dissolves; reopen does not restore.** `POST …/resolve` → `200` with
`resident: null`, one commit `thread resolve: …`, key gone. `POST …/reopen` → `200`,
`GET /api/threads/{id}` still `"resident": null`.

**5. Projection.** `sqlite3 .corpus/cache.db`: `schema_version = 16`, `threads` columns end
`… last_ts, resident_name, resident_doc_id`; after a case-insensitive designation
(`{"name":"ReSeArChEr"}`) the row reads `('researcher','doc_agentdef9aac2cc9')` — the resolved
name, not the caller's spelling. `corpus db doctor`: *projection is clean — 13 documents from 13
files (3ms)*.

**6. The id is re-read, the name is durable.** Renaming `.claude/agents/researcher.md` to
`lead-researcher.md` (the file keeps `name: researcher`) moved the answer to the file's new
synthetic id — `docId: doc_agentdef9db30a86` — with nothing rewritten on disk. Deleting the
agent-def entirely left the stored pair standing: `{"name":"researcher","docId":"doc_agentdef9aac2cc9"}`.

**7. Defect found in passing, escalated (not fixed here — it is a contract change).**
`resident` is missing from `RESERVED_FRONTMATTER_KEYS`
(`packages/contract/src/schemas/extra.ts`), so the user-only rule is bypassable through the
`extra` merge patch. Reproduced against the running server:

```
PUT /api/docs/th_rntsamxo  {"extra":{"resident":{"name":"editor","docId":"doc_agentdef773d5bcd"}}}
  with x-corpus-author: agent   -> 200
GET /api/threads/th_rntsamxo   -> "resident":{"name":"editor","docId":"doc_agentdef773d5bcd"}
```

This is exactly the hazard the reserved list's own comments describe for `origin` and
`turnModels`. It also leaks the key into `extra` on `GET /api/docs/{threadId}`. The fix is one
entry in the contract's list; a second list in the server would be the drift that constant
exists to prevent.

**Checks.** `npx vitest run apps/server` — 3855 passed, 1 failed:
`watcher/flush-budget.test.ts` "stops one flush at its budget…" (`expected 101 to be less than
90`), a wall-clock assertion that passes on its own (4/4) and is unrelated to this change.
`npm run typecheck` clean; `eslint apps/server/src` clean; `prettier --check` clean.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0)
- [ ] Committed with `[SERVER-109]` prefix
