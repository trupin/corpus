# [SERVER-025] Emit an invalidate when the boot projection completes

## Domain

server

## Status

done

## Priority

P2

## Model

opus — one broadcast at a known point in the boot sequence.

## Dependencies

- Depends on: SERVER-007
- Blocks: —

## Spec References

- SPEC.md §9 — SSE invalidation; §2 — live updates
- `issues/ui/002-kit-data-layer.md` — E2E log (discovery record)

## Summary

Found by UI-002's E2E: a client that reconnects quickly after a server restart can refetch **before** the boot-time projection scan has processed files written while the server was down — and since the boot scan emits no `invalidate` frame, the missed rows never appear until something else invalidates. The kit refetches once at the only moment it knows about (reconnect); the durable fix is server-side: broadcast one coarse `invalidate` (the five coarse keys) when the boot projection completes, so late-arriving rows reach every connected client.

## Acceptance Criteria

- [x] After the boot scan finishes, one invalidate frame with the coarse keys is broadcast to connected SSE subscribers. **Amended by evidence**: the frame fires at **watcher-ready**, not at scan completion, and **only when the catch-up repaired something** — at scan completion there is nothing to announce (the socket is not open yet and the rows are correct), while at watcher-ready there can be rows that changed underneath an already-connected client.
- [x] Reproduction of UI-002's race (file written while server down; client reconnects fast) becomes a regression test; post-fix the row appears without any other mutation. **The race did not reproduce in 11 attempts and is impossible by construction**; the regression test pins the ordering that makes it impossible (`lifecycle.test.ts`).
- [x] No frame when there are no subscribers yet and nothing to announce is acceptable — decide and document. **Decided below.**

## Outcome — what is guaranteed at boot, and by whom

> **At the moment the server accepts its first request, the projection describes every file that
> existed when the boot scan ran** — `runServerProcess` populates synchronously at `lifecycle.ts:134`
> and binds the socket at `:150`, so no client can observe a pre-scan projection. **Files written
> after that scan are the watcher's responsibility, and the watcher only becomes responsible once
> chokidar's initial walk finishes.** The gap between those two moments used to belong to nobody;
> it now belongs to the boot catch-up (`watcher/catch-up.ts`), which — once the watcher is live —
> compares the files against the rows and repopulates if they disagree, announcing one coarse
> invalidate when and only when it repaired something.

Two halves, two outcomes:

| Half                                             | Verdict                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| The reported race (client refetches before boot projection completes) | **Not reproducible, no code change.** 11/11 runs served the row on the first request. Pinned by a regression test. |
| The boot-scan → watcher-ready window             | **Real, reproduced, fixed.** 30 documents lost in a 290 ms band, still missing a minute later. |

**The no-subscribers case**: nothing is needed and nothing was added. `createSseHub` already returns
early when `subscribers.size === 0`, so a boot nobody is watching costs nothing; and the catch-up
does not reach the bus at all unless it actually repaired drift, so the common case is not "a frame
into the void" but no frame at all.

## Technical Design

Shipped footprint:

- `apps/server/src/watcher/catch-up.ts` (new) — `catchUpOnWatcherReady`: await the watcher's `ready`,
  ask `inspectProjection` whether the files and the rows still agree, and if they disagree in a way a
  repopulate can repair, run `populateFromFiles`, rebind the queue mirror, and broadcast
  `REBUILD_QUERY_KEYS` once.
- `apps/server/src/watcher/attach.ts` — registers it (never awaits it) and cancels it at shutdown.
- `apps/server/src/projection/doctor.ts` — extracted `inspectProjection(db)`, `doctor`'s in-process
  form, so the catch-up uses the server's own handle instead of opening a second connection.

Deliberately **not** done: reordering boot so the watcher starts before the scan. It would close the
window with one scan instead of a scan plus a check, but it puts chokidar's initial walk on the
critical path to the bind, makes the boot hang if `ready` never resolves, and reshuffles the
disposer-registration order that guarantees the watcher stops before the database closes. A 17 ms
question asked after the socket is already open buys the same correctness at none of that risk.

## E2E Verification Log

implemented on: opus

Environment: worktree `.claude/worktrees/server-025`; real `corpus init` workspace at
`/tmp/corpus-s025-Kztm3L` on port **8945** (sprint-009's SERVER-025 allocation); real daemon via
`corpus server start`; real `curl -N /events`; 8765 verified unbound throughout
(`lsof -nP -iTCP:8765 -sTCP:LISTEN` → 0 listeners at the end).

### Reproduction (bugs only)

**Half 1 — the reported race (TEST-113): NOT REPRODUCED, 11/11.**

Sequence per run: server up → `corpus server stop` → a **well-formed** document written on disk
(`id`, `type`, `title`, `created`, `updated`, `tags`, `status`, `anchors`) → `corpus server start`
→ a client hammering `GET /api/docs` from **before** the process exists, reporting what its *first
successful* response contained.

```
run b1 (doc_offlineb1): {"attempts":4271,"status":200,"total":13,"items":13,"row":"PRESENT"}
run b2 (doc_offlineb2): {"attempts":4163,"status":200,"total":14,"items":14,"row":"PRESENT"}
run b3 (doc_offlineb3): {"attempts":4255,"status":200,"total":15,"items":15,"row":"PRESENT"}
run b4 (doc_offlineb4): {"attempts":4155,"status":200,"total":16,"items":16,"row":"PRESENT"}
run b5 (doc_offlineb5): {"attempts":4294,"status":200,"total":17,"items":17,"row":"PRESENT"}
run b6 (doc_offlineb6): {"attempts":3972,"status":200,"total":18,"items":18,"row":"PRESENT"}
```

`attempts` is the number of connection attempts the racer burned against a closed port before one
succeeded — i.e. the client really was first in the queue. Re-run 5× after the fix (`c1`…`c5`, on
the by-then 816-document workspace): **PRESENT 5/5**. Total **11/11 PRESENT**.

**A fixture error was caught and corrected mid-attempt, and it is worth recording**: the first six
runs reported `MISSING` 6/6 — because the racer read `body.results` while `GET /api/docs` returns
`body.items`. That is the same family of mistake the UI-002 evaluator made (a fixture that could
never have shown the row) and it would have produced a **fabricated reproduction**. The tell was
`total` being constant across runs that should have grown it. The corrected racer asserts
`Array.isArray(body.items)` and retries rather than reporting a negative on an unexpected shape.

**TEST-114 — the ordering, stated as fact.** A client **cannot** connect before the boot projection
completes. `runServerProcess` calls `openWorkspaceProjection` at `lifecycle.ts:134` — whose
`populateFromFiles` is fully synchronous, wrapped in one `db.transaction` — `createServer` at `:135`,
and `await server.start()`, the HTTP bind, at `:150`. There is nothing to connect to until the scan
has returned. The race as reported is therefore impossible, and the issue's first AC is answered by
that sentence rather than by a broadcast.

**Half 2 — the boot-scan → watcher-ready window (TEST-116): REPRODUCED.**

A writer wrote a well-formed document into `data/docs/window/` every 10 ms for 4 s, logging each
write's wall clock, while `corpus server start` was invoked 300 ms in. After the writer stopped,
3 s of quiet, then every page of `GET /api/docs` was diffed against the writer's ledger:

```json
{ "wrote": 398, "projected": 368, "missing": 30,
  "missingSpan": { "first": 208, "last": 237 },
  "windowMs": 290, "firstMissingAtMs": 2070, "lastMissingAtMs": 2360,
  "contiguous": true }
```

**30 documents, a single contiguous 290 ms band**, bounded on one side by the boot scan and on the
other by the watcher going live — exactly the shape predicted. Everything written before the band
was projected by the scan; everything after it was projected by the watcher.

The loss is **durable, not late**. Re-checked >60 s later: still `missing: 30`, same span. And
`corpus db doctor` names every one of them:

```
missing_row data/docs/window/w1-0208.md: … is a document under a root but has no `documents` row
missing_row data/docs/window/w1-0209.md: … is a document under a root but has no `documents` row
…                                                          (30 rows, w1-0208 … w1-0237)
```

Nothing heals it but an unrelated edit to the same file or a restart that happens to miss the window.
Per TEST-116 this is "a strictly better find than the one the issue was opened for", so it was fixed
here rather than filed.

### Post-Implementation Verification

**The window is closed (TEST-116).** Same reproduction, same workspace, same 10 ms × 4 s writer,
post-fix:

```json
{ "wrote": 400, "projected": 400, "missing": 0, "missingSpan": null, "windowMs": 0 }
```

**Exactly one coarse frame, and it carries no content (TEST-118, TEST-119).** A `curl -N /events`
client attached as early as the socket allowed, across the same boot. Head of the capture:

```
:connected

event: invalidate
data: {"keys":[["docs"],["tree"],["queue"],["jobs"],["locks"]]}
```

That frame is line 4 of the stream — the **first** thing after `:connected` — and it is the **only**
one of the capture's 22 `invalidate` frames carrying the coarse set (`grep -c` = 22 frames,
`grep -n` of the coarse payload = 1 hit, at line 4). The other 21 are the watcher's ordinary
per-document frames for files written after it went live. No title, body, path or id appears in the
boot frame; it is `keys` and nothing else.

**It reuses the existing constant (TEST-117).** The payload above is `REBUILD_QUERY_KEYS` from
`apps/server/src/projection/routes.ts`, imported — not a second list.

**Idempotent with the rebuild path (TEST-121).** `POST /api/db/rebuild` on an already-booted server,
with SSE attached:

```
{"documents":816,"threads":0,…,"durationMs":145,"skipped":[]}
:connected

event: invalidate
data: {"keys":[["docs"],["tree"],["queue"],["jobs"],["locks"]]}
```

One frame, rebuild's own, unchanged; the boot path did not fire a second time (it had run minutes
earlier, at that boot's watcher-ready). Sprint-008's blessing of rebuild's coarseness is undisturbed.

**Boot is not measurably slowed (TEST-122).** Wall clock from invoking `corpus server start` to the
first successful `GET /api/docs`, 5 runs each, on the 816-document workspace, A/B'd by disabling
only the `catchUpOnWatcherReady` call:

| Run  | with catch-up | control (call disabled) |
| ---- | -------------- | ----------------------- |
| 1    | 863 ms         | 888 ms                  |
| 2    | 784 ms         | 814 ms                  |
| 3    | 826 ms         | 781 ms                  |
| 4    | 905 ms         | 841 ms                  |
| 5    | 826 ms         | 771 ms                  |
| mean | **841 ms**     | **819 ms**              |

+22 ms on the mean, inside the run-to-run spread of either column (control 771–888, treated
784–905). Expected: the catch-up is registered, never awaited, and does its work after the socket is
already open. The control edit was reverted immediately (`attach.ts` re-read to confirm).

**The cost of the question vs. the cost of the answer.** On the same 816-document workspace,
`corpus db doctor` — the same comparison the catch-up runs — reports
`projection is clean — 816 documents from 816 files (17ms)`, while a full `populateFromFiles` takes
`durationMs: 145` (from the rebuild above). The catch-up pays the 17 ms every boot and the 145 ms
only when there is real data loss to repair. `db doctor` is clean over all 816 files afterwards.

**The no-subscribers case (TEST-120).** Decided by the shipped hub and not re-litigated:
`createSseHub` returns early when `subscribers.size === 0`. The boot catch-up relies on that rather
than guarding separately — but the common case never reaches the hub at all, because a boot whose
files and rows agree does not call `bus.invalidate`. Unit-covered by "does nothing at all when the
files and the rows already agree" (zero bus batches, `attachMirror` never called).

**Tests (TEST-115, TEST-123).**

- `apps/server/src/watcher/catch-up.test.ts` (new, 7 tests) — real temp workspace, real
  `.corpus/cache.db`, real `inspectProjection`/`populateFromFiles`; only the watcher's `ready`
  promise is stubbed, because the subject is what happens after it resolves. Covers: a file written
  into the window (row appears, exactly one coarse frame, mirror rebound), a file deleted in it, a
  file edited in it, the no-drift case (silent), **unrepairable drift stays silent** (an unparseable
  document must not buy a rescan on every boot forever), cancellation after shutdown, and that the
  work waits for `ready` rather than running at attach time.
- `apps/server/src/watcher/attach.test.ts` — a wiring test through **real chokidar**: the file is
  written between the boot scan and `attachWatcher`, which is the window's exact shape, and the row
  plus its single coarse frame are asserted after `ready`.
- `apps/server/src/lifecycle.test.ts` — **TEST-115's ordering pin**: with the real `createServer`
  wrapped so that `start()` records the projection's rows at the instant of the bind, a document
  written "while the server was down" is already projected *before* the socket opens, and the very
  first HTTP request confirms it from the outside. A refactor that moves projection off the boot
  path, or makes it asynchronous, now fails here rather than in a browser three phases later.

**Suite.** `npx vitest run apps/server` → **479/479 suites, 2055/2055 tests**. Full monorepo
`npx vitest run` → **928/928 suites, 3827/3827 tests**. `npm run lint`, `npm run format:check`,
`npm run typecheck` → all exit 0. (One intermediate run failed
`flush-budget.test.ts › stops one flush at its budget` under machine load from the concurrent
E2E servers; it passed 3/3 in isolation and 2055/2055 with the E2E server stopped. That test drives
`startWatcher` directly and never touches `attachWatcher`, so the catch-up cannot reach it.)

**Cleanup.** Scratch confined to `/tmp/corpus-s025-*`; the E2E server stopped by pid via
`corpus server stop`; no `pkill -f`/`killall` used; `lsof` at the end reports **0 listeners on 8765**
and 0 on 8945.

## Completion Checklist (domain agent)

- [x] Tests written and passing — 928/928 suites, 3827/3827 tests across the monorepo
- [x] `/lint` passes — eslint, prettier `--check`, `tsc --noEmit` all exit 0
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-025]` prefix
