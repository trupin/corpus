# [SERVER-017] Mount db rebuild/doctor routes

## Domain

server

## Status

done

## Priority

P1

## Model

opus — two handlers over SERVER-004's shipped `rebuild()`/`doctor()`; the rebuild-reopen requirement is the only care point.

## Dependencies

- Depends on: SERVER-004, CONTRACT-006
- Blocks: CLI-003

## Spec References

- SPEC.md §2.2 rule 1 — `corpus db rebuild` / `db doctor`
- `issues/cli/004-queue-lock-job-verbs.md` — the rebuild-reopen handoff (SERVER-004: after rebuild() atomically replaces cache.db, the running server's handle points at the old inode — the handler must reopen the server's projection handle and rebind the queue mirror)

## Summary

Mount CONTRACT-006's `POST /api/db/rebuild` and `GET /api/db/doctor` over the shipped projection functions, with the in-process handle reopen the SERVER-004 handoff requires.

## Acceptance Criteria

- [x] Both routes mounted, auth required; rebuild reopens the server's own handle + rebinds the queue mirror (subsequent reads hit the new file — proven E2E with sqlite3 against the inode); doctor returns the shipped drift report shape.
- [x] E2E: rebuild over a live server, immediate query correctness, doctor clean/dirty cases.

## Technical Design

Handlers in `apps/server/src/projection/routes.ts`; the reopen seam on the projection handle itself.

**The reopen seam — `ProjectionDb.reopenAround(replaceFile)`** (`projection/db.ts`). `createServer` hands the *one* `ProjectionDb` object to the document routes, the lock service, the job service, the watcher and the queue's mirror at mount time, so a rebuild cannot be followed by handing anyone a *new* handle — the object identity is what every capture site holds. The connection therefore moves and the object stays: `createProjectionDb` keeps its connection in a closure variable read through a `get sqlite()`, and `reopenAround` closes it, runs the replacement, and opens a fresh one at the same path.

Three consequences that decided the shape:

- **Close before, not after.** `rebuild()` deletes the destination's `-wal`/`-shm` after its rename; a connection still open on the unlinked inode would keep a deleted WAL alive and could recreate it, by path, over the database that just replaced it. Taking the replacement as a callback makes that ordering unavailable to get wrong.
- **No window to observe.** `rebuild()` and the reopen are both synchronous, so the whole handler is atomic with respect to the event loop — no request can land while this process has no open connection, and no mutex is needed.
- **`createServer` stays pure and its signature unchanged.** No new dep, no wrapper type, no narrowing: `lifecycle.ts` and `attachProjection` are untouched, because the handle they already open is the reopenable one.

The queue mirror is rebound in the handler (`queue.attachMirror(createProjectionQueueMirror(projection))`) exactly as at boot: the mirror closure follows the handle for free, but the *rebind* re-runs the queue reader's own scan, which is the authority on the `events` table (`projectQueueDir` and the queue reader agree on well-formed workspaces and differ on malformed ones — that difference is drift, and the queue's view is what `claim-all` will actually find).

Wire adaptation: `Drift.path` is absent for `count_mismatch` server-side and always present, `null`-valued, on the wire.

## E2E Verification Log

**implemented on: opus**

### Reproduction (bugs only)

N/A — new surface, not a bug fix. The regression the seam exists to prevent is pinned by two tests that fail without it (verified by stubbing `reopenAround` to a passthrough: `answers from the new file, not the inode the rename unlinked` and `serves the rebuilt rows over the routes that captured the handle at mount time` both fail; the other 15 pass).

### Post-Implementation Verification

Real `corpus init` workspace at `/tmp/corpus-s017-ws`, real server (`tsx apps/server/src/main.ts --workspace …`) on **127.0.0.1:8950** (8765 left free), real `curl`. Server stopped by pid only.

**1. Reopen proof — inode + immediate query.** Baseline `cache.db` inode `64561290`; live server answered `['doc_alpha01','doc_beta002','doc_seed*','doc_skill*']`. After `POST /api/db/rebuild` the inode was `64561435` (the rename is the commit point) and the *immediate* next `GET /api/docs` on the same process answered `['doc_alpha01','doc_gamma03',…]` — `doc_beta002` gone, `doc_gamma03` present. A server still on the old inode could not have produced either change.

**2. Doctor, clean.** `{"ok":true,"drift":[],"stats":{"files":8,"documents":8,"hashed":0,"parsed":0,"durationMs":3}}` — `hashed: 0` on a warm workspace, as §14's pre-commit budget requires.

**3. Doctor, dirty (hand-induced drift in the derived state, which the watcher cannot heal).** Deleting `doc_alpha01`'s row + hash directly out of `cache.db` produced `missing_row` for `data/docs/notes/alpha.md`. Inserting a row for a nonexistent `data/docs/notes/ghost.md` and emptying `events` while a queue file existed produced, in one report:

```
{"kind":"orphan_row","path":"data/docs/notes/ghost.md","detail":"… is projected as doc_ghost99 but no such file exists under any root"}
{"kind":"count_mismatch","path":null,"detail":".corpus/queue holds 1 evt_*.json file(s) but the projection has 0 event row(s)"}
```

The raw body carries `"path":null` — CONTRACT-006's adaptation, present rather than omitted. `POST /api/db/rebuild` healed both; the next `doctor` was `{"ok":true,"drift":[]}` and `doc_ghost99` was gone from `GET /api/docs` while `doc_alpha01` was back.

**4. Queue mirror rebind.** An `evt_*.json` dropped into `pending/` out of band, then a rebuild, then `POST /api/queue/claim-all` over HTTP: the file moved `pending/ → in-progress/` and the events table *in the post-rebuild file* read `[{ id: 'evt_handdropped01', status: 'in-progress' }]`. `GET /api/queue/status` went `pending 1 → inProgress 1`.

**5. SSE.** With a subscriber attached to `GET /events`, one rebuild produced exactly one frame:
`event: invalidate` / `data: {"keys":[["docs"],["tree"],["queue"],["jobs"],["locks"]]}` — the coarse vocabulary once, not one key per row.

**6. Auth + actor.** `GET /api/db/doctor` and `POST /api/db/rebuild` without a token → `401`/`401`. `x-corpus-author: agent`, `x-corpus-author: user` and no header → `200` each (any actor may rebuild). `x-corpus-author: robot` → `400 bad_request`, `header.x-corpus-author: Invalid option: expected one of "user"|"agent"`. Server log line: `{"msg":"projection rebuilt over the API","actor":"user","documents":8,"skipped":0,"durationMs":3}`.

**7. No commit, no leftovers.** `git log` after four rebuilds held only the `init` commit (a rebuild derives state; it authors nothing). `.corpus/` held no `cache.db.rebuild-*` temp files.

**8. The write path survives the swap.** After the rebuilds, `POST /api/docs` (`x-corpus-author: agent`) returned `201`, the file landed at `data/docs/notes/written-after-a-rebuild.md`, git recorded `agent <agent@corpus.local> doc create: … (doc_6ddoxd4u) by agent`, the document was immediately readable over `GET /api/docs`, and `doctor` stayed clean at 9 files / 9 documents. The lock guard, git writer and projector all reached the reopened connection through the handle they captured at mount time.

**Gate.** `npm run lint` clean · `npm run format:check` clean · `npm run typecheck` clean across all five workspaces · full suite **3113 passed / 183 files** · coverage **98.75% lines, 95% branches, 99.37% functions** (projection dir 98.24%), above the 90% gate.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with the issue-ID prefix
