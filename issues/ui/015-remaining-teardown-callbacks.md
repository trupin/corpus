# [UI-015] Remaining per-call mutation callbacks vulnerable to observer teardown

## Domain

ui

## Status

in_progress

## Priority

P2

## Model

opus — apply UI-012's shipped pattern to two named call sites.

## Dependencies

- Depends on: UI-012
- Blocks: —

## Spec References

- issues/ui/012-docmenu-toast-teardown.md — the mechanism (TanStack v5 drops per-call
  onSuccess/onError on observer teardown) and the shipped fix (`SettledCallbacks` hook-level
  callbacks in @corpus/kit)
- UI-012 implementing agent's report (2026-07-29)

## Summary

Found while fixing UI-012, out of its scope: two more call sites report outcomes through per-call
callbacks that die with the observer — `useAnchorLayer.post` (thread-creation warnings) and
`ThreadCard`'s own resolve button. Both are safe today only because their surfaces happen to stay
mounted; both go silent if the reader closes mid-flight. Apply the `SettledCallbacks` pattern to
each; a teardown-path test per site (settle after unmount ⇒ feedback still surfaces).

## Acceptance Criteria

- [x] Both sites surface success/error after their component unmounts mid-flight; tests pin the
      teardown path.
- [x] No behavior change while mounted.

## E2E Verification Log

**Implemented on: opus** (ui-dev, 2026-07-30). Sprint contract: `issues/sprints/sprint-017.md`
(TEST-566–571).

### What changed, and the split the contract asked for

UI-012's shipped `SettledCallbacks` applied to the two named call sites. **No new mechanism**; both
kit hooks already took the argument (`useCreateThread`, `useSetThreadStatus`), so `git diff
packages/kit` is empty (TEST-571).

- **`apps/ui/src/anchors/useAnchorLayer.ts`** — the closure was doing two jobs and only one of them
  moved. `useCreateThread({ onSuccess, onError })` now carries the **notification** half (a toast
  per `result.warnings` entry, `code — detail`; `Comment failed — <message>` on refusal). The
  **optimistic-chip cleanup** stays on `mutate` as a `forget` callback keyed on the comment's
  `key` — it is a state update on this layer, it means nothing once the layer is gone, and it is
  correct for it to be skipped after teardown (TEST-568). `onNotify` therefore drops out of `post`'s
  dependency list.
- **`apps/ui/src/thread/ThreadCard.tsx`** — notification-only, so it migrated wholesale.
  `useSetThreadStatus({ onSuccess, onError })`; `mutate` is now bare. The direction is read off
  `variables.resolved` (what was **sent**) rather than the render's `resolved`, because the
  callbacks now outlive the render that started the write — the same correction UI-012 made for
  `useRowActions`. All four wordings are byte-identical to what shipped (TEST-569): "Thread
  resolved — committed. Replying reopens it." / "Thread reopened — committed." / `Resolve failed — …`
  / `Reopen failed — …`.
- **`apps/ui/src/testing/readerFixture.ts`** — extended **additively** with `holdWrites` (UI-012's
  gate: every non-`GET` awaits it, recorded *before* it waits so a held write is observable on the
  wire) and `threadWarnings` (so `POST /api/threads` can answer with real §14 warnings). No existing
  option or behaviour changed.

### Ports — a deviation, stated

The orchestrator's launch message said `9186`–`9187`; the sprint contract's table assigns those to
**CLI-012** and gives UI-015 **server `9196`, Vite `5293`**. I used the contract's ports, because a
concurrent `apps/cli` agent binding 9186 would have collided. `8765` was never bound, never killed,
and never proxied to.

### Environment

Real stack, no mocks. Workspace `…/s017-ui015-mnxuYC/ws`, created **from a cwd outside this
repository** (`pwd` → `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-ui015-mnxuYC/ws`) with
the from-source CLI and an explicit `--port`:

```
$ node --import …/node_modules/tsx/dist/loader.mjs …/apps/cli/src/bin/corpus.ts init --port 9196
Initialized Corpus workspace at …/s017-ui015-mnxuYC/ws
  port 9196, token in .corpus/config.json (mode 600)
```

Workspace server on `9196` (pid 46690), Vite dev on `5293 --strictPort` (pids 58974/58990),
Chromium via Playwright 1.62.

**`CORPUS_SERVER_ORIGIN` exported before the dev server, and the proxy proved mine:**

```
$ export CORPUS_SERVER_ORIGIN="http://127.0.0.1:9196"   # + VITE_CORPUS_TOKEN from .corpus/config.json
$ curl -s http://localhost:5293/api/health
{"status":"ok","version":"0.0.0","uptimeSeconds":231.569,"workspace":"…/s017-ui015-mnxuYC/ws"}
$ lsof -nP -iTCP:8765 -sTCP:LISTEN
(nothing bound on 8765)
```

The request through `5293` was answered by **my** workspace (its path is in the response) and
appeared in my server's log (`GET /api/health 200`).

### Reproduction (pre-fix), in a real browser

Each site reverted to its per-call shape, HMR reloaded, same drill, same workspace. The drill clicks
the control and pops the surface **in the same task**, then polls for `.toast` for 8 s.

```
resolve: button "✓ resolve" | card detached +3ms (still in DOM: false) | toast +null "(NO TOAST after 8000ms)" | writes ["POST /api/threads/th_ty6l3wlz/resolve"]
reopen : button "reopen"    | card detached +2ms (still in DOM: false) | toast +null "(NO TOAST after 8000ms)" | writes ["POST /api/threads/th_ty6l3wlz/reopen"]
fail   : reader detached +6ms (reader in DOM: false)                   | toast +null "(NO TOAST after 8000ms)" | writes ["POST /api/threads"]
```

The write commits every time and **nothing is ever said about it** — the exact failure UI-012
documented, at two more call sites.

### After the fix — same drills, same workspace

**TEST-569 (`ThreadCard`, both directions, card unmounted mid-flight):**

```
resolve: button "✓ resolve" | card detached +2ms (still in DOM: false) | toast +125ms "✓Thread resolved — committed. Replying reopens it.✕" | writes ["POST /api/threads/th_ty6l3wlz/resolve"]
reopen : button "reopen"    | card detached +2ms (still in DOM: false) | toast +129ms "✓Thread reopened — committed.✕"                      | writes ["POST /api/threads/th_ty6l3wlz/reopen"]
```

The card detaches at +2 ms — i.e. it is **gone** long before the request answers ~125 ms later — and
the toast still arrives, with the shipped wording unchanged. `th_ty6l3wlz` reads `status: resolved`
on disk afterwards, so the flip that toasted is the flip that committed.

**TEST-567 (`useAnchorLayer` failure, reader closed mid-flight).** A genuine 423: the agent takes
the parent's lock while the comment composer is open (a real race, not a stub).

```
lock acquired: 201
fail: reader detached +4ms (reader still in DOM: false) | toast +22ms "!Comment failed — POST /api/threads failed (HTTP 423): doc_4pupb25f is being edited by agent; the lock was acquired at 2026-07-30T23:20:49Z✕" | writes ["POST /api/threads"]
```

The server's message survives intact. This is the case the contract calls the worst of the three —
the user believing a comment was posted — and it now speaks.

**TEST-570 (nothing changes while mounted).** Same two acts with the surfaces left on screen:

```
mounted ✓ resolve: card still mounted=true | toasts ["✓Thread resolved — committed. Replying reopens it.✕"]
mounted comment refusal: reader open=true | toasts ["!Comment failed — POST /api/threads failed (HTTP 423): …✕"]
optimistic chip (mounted success, sampled every 10ms): {"peak":1,"sawChip":true,"clearedAfter":true,"finalCount":0,"toasts":[]}
```

Exactly **one** toast per act — no duplicate from a callback left in both places — and a clean
success still says nothing, which is the shipped behaviour. The last line is the per-call half still
working: the optimistic highlight appears while the request is in flight and is cleared by the
response.

**Corpus health after the drills:**

```
$ corpus db doctor      → projection is clean — 16 documents from 16 files (2ms)
$ corpus doc check doc_4pupb25f → checked 1 document — no findings.
$ corpus lock list --json → {"locks":[]}
```

### TEST-566 — `DEFERRED → the server emits no warning this flow can trigger`

The warning path could not be driven end-to-end in the browser: `POST /api/threads` returned
`warnings: []` for every case I could provoke against the real server, including an unresolved
`[[ref]]` in the first turn's body —

```
$ curl -s -X POST /api/threads -d '{… "body":"See [[no-such-document]] for the source."}'
warnings: []   thread: th_7bvv7dou
```

so there is no user-reachable way to make a *successful* thread creation carry one today. Substitute
evidence: (a) the unit test pins it directly against a transport that answers with two real §14
warnings, asserting both toasts in order after unmount; (b) the *same* hook-level `onSuccess`/
`onError` pair is what produced the observed `Comment failed` toast above, so the delivery path is
demonstrated in a real browser even though this particular payload is not. Not a code gap — a gap in
what the server currently warns about, and out of this issue's scope.

### Tests

- `apps/ui/src/anchors/useAnchorLayer.test.tsx` → "a comment whose reader closed before it settled":
  warnings after unmount (two, in order), failure after unmount, "attempts no cleanup on the layer it
  no longer has" (console.error spy clean + the painted decoration untouched by the response), and
  two mounted controls.
- `apps/ui/src/thread/ThreadCard.test.tsx` → "a flip whose card went away before it settled": all
  four paths (resolve/reopen × success/refusal) with the write held open and `cleanup()` mid-flight,
  plus two mounted "reports … once" controls. Each asserts the **whole** notice array, so a
  double-fire fails.
- Both suites use UI-012's `gate()` technique verbatim (TEST-571) rather than a second one.
- **Red-bar proof**: with both sites reverted to per-call callbacks, the 6 new teardown tests fail
  and the other 39 pass (`Tests 6 failed | 39 passed (45)`); restored, `45 passed`.
- Scoped runs: `apps/ui/src/anchors apps/ui/src/thread apps/ui/src/reader` → 29 files, **406
  passing**. Final workspace-scoped `apps/ui/src` → 98 files, **1460 passing**. `packages/kit`
  untouched, so not re-run.
- eslint, prettier and `tsc --noEmit` clean on every touched file (the one repo-wide eslint error is
  in `apps/server/src/docs/performance.test.ts`, another agent's in-flight work — not mine).

### Blast radius (TEST-571 / cross-issue)

Changed: `apps/ui/src/anchors/useAnchorLayer.ts`, `apps/ui/src/thread/ThreadCard.tsx`,
`apps/ui/src/testing/readerFixture.ts` (test fixture, additive), and the two colocated test files.
Nothing under `packages/kit`, `packages/contract`, `apps/server`, `apps/cli`, `plugins/` or
`SPEC.md` was edited. No git command was run. Scratch lived only under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-ui015-mnxuYC`.

**Cleanup**: pids 58990, 58974, 46690 killed by pid; `5293` and `9196` verified free; **`8765`
verified untouched and unbound**; `/Users/theophanerupin/code/corpus/.corpus` verified **absent**.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
