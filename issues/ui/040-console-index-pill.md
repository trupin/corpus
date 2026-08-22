# [UI-040] Console strip: semantic-index pill with live progress

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SERVER-051
- Blocks: —

## Spec References
- SPEC.md §10 console index pill (rider signed 2026-08-02)

## Summary
User request (2026-08-02): surface background indexing in the UI like the
agent pill. Add an index pill to the collapsed console strip beside the agent
pill: state dot (reuse the agent pill's dot vocabulary) + text —
`index: current · 273 indexed` when caught up; `index: indexing · 41/68`
(indexed / indexed+pending) while draining or rebuilding; `index: stale · …`
same count shape; `index: disabled`. Expanded console shows the status row
with the server's `detail` sentence verbatim (never parsed) and the `failed`
count when non-zero. Data: `GET /api/index/status` via a kit method + hook,
refetched on the SERVER-051 invalidation key.

## Acceptance Criteria
- [x] Pill matches the agent pill's visual conventions; all four states render
- [x] Counts live-update during a drain without reload (SSE-driven)
- [x] `detail` rendered verbatim in the expanded view when present; `failed`
      shown only when non-zero
- [x] No polling loop — refetch on invalidation only
- [x] Kit: method + hook + query key follow the retrievalHooks patterns

## Technical Design
### Files to Create/Modify
- Console strip/expanded components; `packages/kit` client method + hook +
  query key

## Testing Strategy
Component tests for all states + count formatting; kit hook tests; e2e with a
stubbed status sequence.

## E2E Verification Plan
Real app: trigger a rebuild via `corpus index rebuild`; watch the pill go
indexing → counts climb → current.

## E2E Verification Log
_Model: Opus 5 (ui-dev), 2026-08-02._

### Half 1 — the real app: real server, real embed worker, real rebuild
Scratch workspace (`/tmp/ui040-ws`, `corpus init --port 8866`, its own server —
the fleet's 8765 was never touched), Vite dev on 5573 with
`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8866` and the workspace's own token, real
Chromium via Playwright, no request interception at all. Timeline as logged:

```
[20:41:25.009] pill  → "index: current · 63 indexed"        (63 chunks already embedded)
[20:41:25.011] row   → "<absent>"                            (nothing to add, drawer expanded)
[20:41:31.125] after 6s idle: 0 reads of /api/index/status   (no poller)
[20:41:31.125] running: corpus index rebuild --workspace /tmp/ui040-ws
[20:41:32.619] rebuild says: {"indexed":0,"pending":63,"failed":0,"identity":null,
                              "rebuilding":true,"state":"indexing"}
[20:41:32.620] GET /api/index/status  (#1)   ← SSE ["index"] frame, not a timer
[20:41:32.639] pill  → "index: indexing · 0/63"
[20:41:32.639] row   → "local/all-MiniLM-L6-v2@384 is ready; the index has no vectors
                        yet, so ranking is lexical until the first ones land"
[20:41:34.044] GET /api/index/status  (#2)
[20:41:34.118] pill  → "index: indexing · 16/63"
[20:41:35.523] GET /api/index/status  (#3)
[20:41:35.556] pill  → "index: indexing · 48/63"
[20:41:36.211] GET /api/index/status  (#4)
[20:41:36.376] pill  → "index: current · 63 indexed"
[20:41:36.379] total reads during the drill: 4  (one per invalidation; 0 while idle)
```

`detail` verbatim, checked by comparing the DOM against the CLI's own JSON during
a second rebuild rather than by eye:

```
DOM  : "local/all-MiniLM-L6-v2@384 is ready; the index has no vectors yet, so ranking is lexical until the first ones land"
wire : "local/all-MiniLM-L6-v2@384 is ready; the index has no vectors yet, so ranking is lexical until the first ones land"
identical: true
```

Screenshots taken in the same run: the collapsed strip reads
`● agent: idle · queue 0   ● index: current · 63 indexed   0 running · 0 done · 0 failed`
— the two pills identical in shape and height, the index dot green; and the
expanded drawer shows the sentence as a full-width row above the master-detail
body, with the pill on `index: indexing · 0/63` and its dot on `--accent`. The
row vanished again the moment the index caught up.

### Half 2 — Playwright, `apps/ui/e2e/console-index.spec.ts` (9 specs, all green)
`CORPUS_UI_PORT=5573`, then 5673 after an edit. Only `/api/index/status` and
`/events` are answered from the spec — everything above the transport is the
shipped app. It covers what one real worker cannot show in one run: all four
states (`current` `273 indexed`, `indexing` `41/68`, `stale` `41/68`,
`disabled`), each dot's colour read out of `tokens.css` (`--good`, `--accent`
pulsing, `--sepia` and explicitly *not* `--signal`, `--ink-3`), the pill's
geometry against the agent pill's (same y, same height, `border-radius: 99px`),
a real `EventSource` receiving one `invalidate` frame naming `["index"]` and the
counts climbing with no reload (exactly two reads), 4 s of silence producing
exactly one read, the pill absent rather than guessing when the read fails, and
the expanded row's sentence compared character-for-character plus `4 failed` in
`--signal`.

### Unit
`packages/kit` (useIndexStatus, client, surface) 45 tests green;
`apps/ui/src/console` 117 tests green. `tsc --noEmit` clean in both workspaces;
eslint and prettier clean on every touched file.

### Follow-up (2026-08-02) — flake in `counts climb on an ['index'] frame`
Green in isolation, failed the full-suite pre-push run twice: `expect(stub.calls()).toBe(2)`
received `3`. **Spec defect, not a product race** — the pill reached the right
end state every time.

Cause: `route.fulfill` can only send a *complete* body, so the stubbed event
stream ended the instant the frame landed. The bridge correctly read that as a
dropped stream, backed off, reconnected — and a reconnect is exactly when it
blanket-refetches active queries, because nothing told it what changed while it
was away (`sseBridge.ts`, `handleOpen`). That third read is right behaviour; the
spec had merely been winning a race against the backoff timer when the machine
was idle.

Two fixes, both at the cause:
- the events stub now serves the frame **once** and refuses every reconnect, so
  exactly one stream ever opens in the page's life — no reconnect recovery, no
  re-delivered frame;
- the assertions are durable rather than incidental: the end state, `calls() >= 2`
  (the frame caused a re-read), and a real no-reload proof — a `window` mark
  stamped before the frame that a navigation could not survive. The exact-count
  claim now lives only in the "never polls" test, where no stream opens at all
  and it is deterministic.

While fixing it, a second latent bug surfaced and is worth remembering: the
`**/events*` glob matches Playwright's *whole URL*, so it also captured Vite's
dev module URL for `…/packages/kit/dist/events/sseBridge.js`. Refusing that took
the whole app down before first paint — an empty strip and a locator that never
resolves, with nothing in the failure naming the cause. Both routes now anchor on
a regex for the endpoint itself (`^https?://[^/]+/events(\?|$)`).

Proof: `--repeat-each=10 --workers=4` in isolation → **90/90 green**; alongside
`console`, `reveal`, `fences` and `clipboard` at `--workers=4 --repeat-each=3` →
all 27 runs of this spec green (135 passed overall).

Not mine, but seen in that same run: `console.spec.ts:62` ("keeps the failed-job
count off the health notice's class") failed 3/3 — and also fails alone, on one
worker, with this spec out of the run. It asserts "server unreachable", and a
workspace server (another agent's, pid 92431) is listening on 8765, which the dev
proxy reaches. Environmental; untouched deliberately, since its point is the
strict-mode single match on `.c-failed` and that needs a genuinely absent server.

### Note for the record
The Playwright run initially failed one spec that assumed "server unreachable":
a *different* agent's workspace server was answering on 8765 and the dev proxy
reached it (401s, not silence). The spec now asserts the behaviour directly
(abort the index read, pill absent) instead of depending on the suite's standing
condition, so it is correct with or without a server on 8765.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
