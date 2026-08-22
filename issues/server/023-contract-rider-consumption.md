# [SERVER-023] Consume the CONTRACT-007/009 riders: warnings, reap failed, originTitle, multipart threads, 413

## Domain

server

## Status

done

## Priority

P1

## Model

opus — each half is an established pattern (SERVER-006 warnings carrier, SERVER-010 multipart ingest).

## Dependencies

- Depends on: CONTRACT-007, CONTRACT-009, SERVER-006, SERVER-010
- Blocks: UI-008 (lands with the same commit as the contract changes — the riders break the server compile until consumed; sprint-008 Open Conflicts 5–7)

## Spec References

- SPEC.md §6 (attachments), §8 (Ask with attachments), §11 (warnings carrier)
- `issues/contract/007-forms-surface.md`, `issues/contract/009-thread-multipart-rider.md`
- `issues/sprints/sprint-008.md` — Open Conflicts 5–7 (exact compile-break site: `apps/server/src/queue/routes.ts:35`)

## Summary

The server half of the sprint-008 contract batch, coupled to the contract commit because the riders stop `apps/server` compiling:

1. **`ReapStaleResult.failed`**: `queue/routes.ts` returns the QueueService's `failed: string[]` instead of dropping it.
2. **Resolve/reopen warnings**: both handlers carry §11 warnings in the response (they are log-only today); `corpus thread resolve --json` output gains the field (documented CLI output change — no CLI code change needed if it passes responses through).
3. **`originTitle`**: the jobs listing populates the origin's title for thread- and doc-origin jobs from the projection.
4. **Multipart `createThread`**: the JSON-only route gains the multipart variant, reusing SERVER-010's ingest (bytes-before-markdown, `whileUnreferenced` cleanup scope, same limits) — Ask-with-attachments works end to end.
5. **413 flip**: over-cap uploads on both multipart routes return the now-declared 413 (replacing SERVER-010's adjudicated interim 400).

## Acceptance Criteria

- [x] `apps/server` compiles against the regenerated contract; all five halves implemented with colocated tests.
- [x] Multipart thread creation E2E: real curl multipart → thread with attachment references, served bytes, one commit, correct SSE keys; over-cap → 413 on both routes.
- [x] Reap/resolve/reopen/jobs responses verified E2E against the new shapes.
- [x] Full gate green (the combined contract+server commit is the green unit).

## E2E Verification Log

**implemented on: opus** (main tree, ports 8930–8934 allocated — only 8930 bound; scratch
`/tmp/corpus-s023-e2e`, removed at the end; entry `node --import tsx apps/cli/src/bin/corpus.ts`;
the daemon stopped by pid through `corpus server stop`).

### The pre-state, measured

`tsc --noEmit -p apps/server/tsconfig.json` after a clean `npm run build`: **exit 2, exactly five
errors**, at the five sites CONTRACT-009's blast-radius table names —
`jobs/project.ts:85` (TS2741 `originTitle`), `queue/routes.ts:34` (TS2345 `failed`),
`threads/routes.ts:47` (TS2345, the `CreateThreadBody` union), `:76` and `:84` (TS2345, the
`{thread, warnings}` wrapper). Nothing else in the repo was red.

### Post-Implementation Verification

Every request below is real `curl` against a real daemon on 127.0.0.1:8930, in a workspace created
by `corpus init` with its own git repository.

**1. The break the compiler does not catch — `app.openapi` → `mountCreateThread`.** A JSON
`POST /api/threads` would have answered `400` (both media-type validators in one chain). Observed
after the fix:

```
POST /api/threads  {"body":"Why 6.1%? (json branch)"}  ->  HTTP 201
{"thread":{"id":"th_gy3h7b7w",…,"turns":[{"author":"user","ts":"2026-07-27T23:49:32Z","body":"Why 6.1%? (json branch)"}]},
 "anchorId":null,"eventId":null,"warnings":[]}
```

**2. Multipart thread creation, real `curl -F`, anchored, two files, agent requested.**

```
curl -F parent=doc_exsj2ahd \
     -F 'selector={"exact":"assume a 30-year fixed at 6.1%","prefix":"The model we "}' \
     -F 'text=Is this still right? @agent' -F requestsAgent=true \
     -F files=@shot.png -F files=@notes.pdf   ->  HTTP 201
```

- Turn body, **the pinned reference format byte for byte** (each segment percent-encoded, display
  text human-readable):
  `Is this still right? @agent\n\n![shot.png](attachments/th_jqgeumpp/2026-07-27T23%3A50%3A00Z/shot.png)\n[notes.pdf](attachments/th_jqgeumpp/2026-07-27T23%3A50%3A00Z/notes.pdf)`
- Bytes on disk, before the markdown that quotes them:
  `.corpus/attachments/th_jqgeumpp/2026-07-27T23:50:00Z/{shot.png,notes.pdf}` — contents
  `PNG-BYTES-CANARY-8930` / `PDF-BYTES-CANARY`, directory named with the turn's ts **verbatim**,
  colons included.
- Served: `GET /attachments/th_jqgeumpp/2026-07-27T23%3A50%3A00Z/shot.png` → `HTTP 200`,
  `content-type: image/png`, 21 bytes, body identical to the canary.
- **One commit, both files, no bytes**:
  `59a07fd user <user@corpus.local> comment: new thread on doc_exsj2ahd (th_jqgeumpp) by user`,
  `git show --name-only HEAD` = `data/docs/inbox/mortgage-model-2.md`, `data/threads/th_jqgeumpp.md`.
- Anchor written into the parent's frontmatter: `anchors: anc_8c7fcbcb: {exact: assume a 30-year
  fixed at 6.1%, prefix: "The model we ", suffix: ""}`; the thread's `anchor: anc_8c7fcbcb`.
- Exactly one `evt_*.json` in `.corpus/queue/pending/`, `type: comment.created`, payload naming the
  thread, the parent and the turn ts.
- **SSE**, read live off `GET /events?token=…` while a second multipart creation ran — the same
  frame a JSON creation publishes, no data, keys only:
  `{"keys":[["docs"],["docs","th_ld7hx2fz"],["threads","th_ld7hx2fz"],["docs","doc_exsj2ahd"],["tree"]]}`
- Attachment-only first turn (Ask with just a screenshot): `HTTP 201`, turn body exactly
  `![only.png](attachments/th_rp6apk4w/2026-07-27T23%3A52%3A43Z/only.png)`, title `Untitled thread`
  — derived from the author's own text, never from the reference block, so the board never shows a
  URL as a title.
- Neither text nor files: `HTTP 400`,
  `{"path":"form.text","message":"A thread's first turn needs \`text\`, at least one file, or both."}`.

**3. The 413 flip, on every file-taking route and on both refusal paths** (caps lowered to
64 B / 4096 B in `.corpus/config.json`, server restarted):

| route | post-parse (real 200-byte file) | pre-parse (declared `Content-Length: 1048576`) |
| --- | --- | --- |
| `POST /api/threads` | **413** | **413** |
| `POST /api/threads/{id}/turns` | **413** | **413** |
| `POST /api/capture` | **413** | **413** |

Body in every case is the contract's declared `ValidationError`:
`{"code":"bad_request","message":"attachment huge.bin is 200 bytes, over the per-file limit of 64 bytes","issues":[{"path":"files",…}]}`
(pre-parse: `"the upload totals 1048576 bytes, over the per-request limit of 4096 bytes (4.0 KB)"`).
Commit count unchanged across all six refusals, and no attachment directory appeared.

**4. `ReapStaleResult.failed`, over real HTTP.** A claimed event backdated to 2020 with
`attempts: 3` (the cap):

```
POST /api/queue/reap-stale  ->  {"reaped": [], "failed": ["evt_ceioul5quefj"]}
```

`.corpus/queue/failed/evt_ceioul5quefj.json`, `in-progress/` and `pending/` empty. A second run
against a merely-stale event (`attempts: 0`) answered `{"reaped": ["evt_tlbhzxxbg4dr"], "failed": []}`
— the two arrays are disjoint in both directions, observed, not asserted.

**5. `resolve`/`reopen` carry §11's warnings.** Clean workspace →
`{"thread":{…,"status":"resolved"},"warnings":[]}`. With a `pre-commit` hook that exits 1:

```
POST /api/threads/th_mxxaggux/resolve  ->  200
{"thread":{…,"status":"resolved"},"warnings":[{"code":"commit_failed","detail":"git commit --amend failed: doc check: refusing"}]}
```

commit count unchanged (9 → 9), `status: resolved` on disk, `git status --porcelain` showing the
file modified-and-uncommitted — §11's "the write stands, the drift surfaces loudly". `reopen`
behaves identically (observed with the same hook). **TEST-60 discharged**, both verbs.
`corpus thread resolve --json` passes the new envelope straight through:
`{"thread":{…},"warnings":[]}` — the documented CLI output change, no CLI code needed (`docs/cli.md`
regeneration is CLI-008's).

**6. `Job.originTitle`, populated rather than nulled.**

```
GET /api/jobs -> {"jobs":[{"eventId":"evt_ceioul5quefj","status":"pending",…,
                           "originId":"th_jqgeumpp","originTitle":"Re: \"assume a 30-year fixed at 6.1%\""}]}
```

matching `data/threads/th_jqgeumpp.md`'s own `title:` line. **TEST-64 discharged in its first
branch** (the server populates the field; it is not merely schema-valid-because-nullable). The title
is read at response time from the same `documents` row that proves the id resolves — so it is null
exactly when `originId` is, and a rename shows through on the next read (unit test:
`"follows a rename: the title is read at response time, never stored"`).

**7. Projection integrity afterwards.** `corpus db doctor` →
`projection is clean — 14 documents from 14 files (2ms)`.

### The full gate, exit codes read from the tools

```
npm run build         -> BUILD_EXIT=0
npm run lint          -> LINT_EXIT=0
npm run format:check  -> FORMAT_EXIT=0
npm run typecheck     -> TYPECHECK_EXIT=0   (all five workspaces)
npm test              -> TEST_EXIT=0        214 files / 3818 tests passed
```

`apps/server` alone: **105 files / 2046 tests** (was 2027 before this issue; the new coverage is
the multipart dual-media suite in `threads/create.test.ts`, the thread-creation ingest suite in
`attachments/ingest.test.ts`, the resolve/reopen warning pair in `threads/pipeline.test.ts`, the
`failed[]` reap in `queue/routes.test.ts`, and the origin-title tests in `jobs/project.test.ts`).

### Test-robustness item (adjudicated to this session)

`anchors/reconcile.test.ts`'s "reconciles 50 anchors over a ~1 MB body" asserted `elapsedMs < 1000`
under vitest's 5 s default timeout and flaked under parallel-agent load. It is now an
order-of-magnitude guard: `RECONCILE_BUDGET_MS = 5000` with the per-test timeout raised to
`20_000`, and a comment stating what it catches (a complexity regression, which overshoots by orders
of magnitude on any machine) versus what it must not fail on (a busy machine). **`docs/update.test.ts`
was left alone**: its two concurrency tests have no wall-clock assertion at all
(`grep -nE "elapsed|performance\.now|toBeLessThan|Date\.now"` finds nothing in that file), so they do
not have the hard-bound shape the instruction conditioned on.

### Not done here, deliberately

`POST /api/threads/{id}/turns/{ts}/form` has no handler in this change. The route and both schemas
exist in the contract; **the handler is SERVER-016's**, and TEST-56/57/59 stay deferred to it.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-023]` prefix (combined with the contract commit)
