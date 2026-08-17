# [UI-098] The console says `agent: idle` when no agent exists

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-033 part 2 (rider must be signed first), CONTRACT-045, SERVER-086
- Blocks: —

## Spec References

- SPEC.md §11 line 469 — the console strip's agent pill, as amended by SHARED-033
- SPEC.md §11 — "All agent/system status lives in the console strip"

## Summary

With no agent running anywhere, the console strip reads `agent: idle · queue 3`.
`idle` reads as "the agent is connected and has nothing to do"; the truth is
"nobody is listening and three requests are waiting". This issue adds the
`disconnected` state, fed by the contact SERVER-086 records and CONTRACT-045
puts on the wire.

## Reproduction (confirmed by inspection)

`apps/ui/src/console/consoleModel.ts:133`:

```ts
export function agentState(status: QueueStatus): AgentState {
  if (status.halted) return "halted";
  return status.inProgress > 0 ? "working" : "idle";
}
```

`idle` is the else-branch. Nothing consults whether an agent has ever contacted
the server.

## Acceptance Criteria

- [x] `agentState` returns `disconnected` when the last agent contact is older
      than the window, or when there has been none at all
- [x] The window is **derived from `DEFAULT_IDLE_TIMEOUT_SECONDS`** as CONTRACT-045
      exports it — no literal `10 * 60_000` in the UI. A parked agent re-contacts
      the server at least every 480 s, and the threshold must follow that constant
      if it ever changes
- [x] `idle` now means what it says: an agent is connected and has nothing to do
- [x] `halted` keeps precedence over everything, as today
- [x] The pill text reads naturally — `agent: disconnected · queue 3` — and the
      queue depth stays beside it, since it matters most in this state
- [x] The dot is **not** styled as a failure: per the rider, disconnected is the
      plain truth on a machine with no agent running, not an error. It must be
      visually distinct from both `idle` and the `working` pulse, and must not
      pulse — "nothing else pulses, which is why the pulse means something"
      (`consoleModel.ts:153`)
- [x] The state **re-evaluates as time passes**, not only when a new status
      arrives: an agent that stops contacting must flip the pill without a
      further poll to prompt it
- [ ] It flips back to `idle` promptly once an agent parks again — **partially,
      and the remainder is not the UI's to close.** It flips on the next read of
      `["queue"]`, which any queue transition triggers (measured: enqueuing a
      request flipped the pill live). It does **not** flip on the park itself,
      because `apps/server/src/app.ts`'s `onPresenceChanged` invalidates
      `[AGENTS_KEY]` only, while presence now also lives on
      `GET /api/queue/status`. Measured at 150 s of a stale `disconnected` under
      a live server. Escalated to the orchestrator; see the E2E log
- [x] The index pill's dot vocabulary (which borrows the agent pill's states —
      `consoleModel.ts:143`) is unaffected, or is updated deliberately rather
      than by accident

## Technical Design

### Files to Create/Modify

- `apps/ui/src/console/consoleModel.ts` — `agentState`, `agentPillText`, and the
  `AgentState` union
- `apps/ui/src/console/AgentPill.tsx` — the dot class for the new state; its
  docblock lists the three states and their meanings and must be rewritten, not
  appended to
- the console strip's CSS — a dot treatment for `disconnected`

### Key Implementation Details

**The state is time-dependent, which nothing in this component currently is.**
`agentState` is a pure function of a status object today; with a window it also
depends on now. Either the component ticks (the pending indicator's
`TICK_MS = 15_000` is the existing precedent for a coarse clock that costs
nothing) or the query refetches often enough to carry the transition. Pick one
and say why — a pill that only updates when something else happens will sit on
`idle` for an hour after the agent leaves, which is the bug again with extra
steps.

Keep `agentState` pure by passing the clock in, as the reveal and pending code
already do for testability.

### Edge Cases

- **Contact absent entirely** (fresh server) — disconnected, not "unknown"
- **`inProgress > 0` with stale contact** — an agent that claimed work and died.
  SHARED-033's edge-case list flags this for decision; implement what the rider
  settled. Do not invent a rule here
- **Halted and disconnected at once** — `halted` wins, per the existing precedence
- A clock jump (laptop wake) — the window is evaluated against the server's
  timestamp, so the pill corrects itself on the next status rather than asserting
  something from a skewed local clock

## Testing Strategy

Vitest over `agentState` with an injected clock: just inside the window → `idle`;
just outside → `disconnected`; never-contacted → `disconnected`; `inProgress > 0`
→ `working`; `halted` → `halted` regardless. Component tests that the dot class
and pill text follow, and that the state changes on a tick with no new data.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. `corpus server start` with **no** agent running
2. Post two `@agent` comments so the queue has depth
3. Expand the console strip
4. Expected: something saying no agent is connected
5. Actual: `agent: idle · queue 2`

### Verification Steps

1. Restart the app with no agent running — confirm the strip reads
   `agent: disconnected` with the queue depth beside it
2. Start `corpus queue idle` — confirm the pill flips to `idle` promptly
3. Let the agent claim an event — confirm `working` and the pulse
4. Kill the agent mid-park; wait past the window **without touching the UI** —
   confirm the pill flips to `disconnected` on its own
5. Restart the agent — confirm it flips back
6. Toggle HALT — confirm `halted` wins in every combination
7. Confirm the index pill is unchanged throughout

## E2E Verification Log

**Model:** Opus 5 (1M context), ui-dev. **Date:** 2026-08-16.

**Environment.** Real `corpus server start` on **127.0.0.1:8791** over a throwaway
workspace (`/tmp/ui098-ws`, removed afterwards), real Vite dev server on **5291**
with `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8791` — never 8765 or 5173, which are
the user's live server and an ssh tunnel. Real headless Chromium via Playwright,
driving the running app. Every line below is the pill's own DOM as the browser
computed it. The `corpus queue` verbs were unusable (`apps/cli/src/commands/queue/poll.ts`
is mid-edit by another agent and fails to transform), so the agent was parked the
way `corpus queue idle` parks it — a held `GET /api/queue/idle`. §7 defines
presence as *the parked request and nothing else*, so this is the same agent by
the server's own definition, and `GET /api/agents` agreed each time.

### Pre-fix reproduction

Server up, **no agent**, one `@agent` request pending. With `agentState`'s body
temporarily restored to `halted ? … : inProgress > 0 ? "working" : "idle"`:

```
{"text":"agent: idle · queue 1","state":"idle","dotClass":"dot",
 "counts":"0 running · 1 queued · 3 done · 0 failed"}
```

`GET /api/queue/status` at that instant: `{"agent":{"live":false,"since":null},
"halted":false,"pending":1,"inProgress":0,…}`. The server said nobody was there;
the console said `idle`. Fix restored, **same server state, no reload of anything
but the page**:

```
{"text":"agent: disconnected · queue 1","state":"disconnected","dotClass":"dot away",
 "background":"rgb(155, 161, 168)","animation":"none"}
```

### Verification steps

1. **No agent running** → `agent: disconnected · queue 3`, dot `dot away`,
   `rgb(155,161,168)` = `--ink-3`, `animation-name: none`. Counts beside it
   `0 running · 3 queued · 0 done · 0 failed`. No page errors.
2. **Agent parks** → `agent: idle · queue 0`, dot `dot`, `rgb(78,122,70)` =
   `--good`, no pulse. `idle` now has evidence behind it.
3. **Agent claims an event** → `agent: working · queue 0`, dot `dot busy`,
   `rgb(59,95,151)` = `--accent`, `animation-name: pulse`.
4. **Killed mid-park, UI untouched.** Page left open on `idle` at 00:21:02Z; the
   park was released at 00:20:55Z. The pill flipped by itself at **00:37:02.675Z**
   — 960 s later, exactly `AGENT_PRESENCE_WINDOW_SECONDS` — to
   `agent: disconnected · queue 0`, `dot away`. **`/api/queue/status` was
   requested once in the whole 16 minutes** (instrumented on the page): the flip
   came from the tick re-evaluating cached data, not from a poll. The server's own
   verdict flipped to `live:false` at the same instant, from the same window
   applied to the same `since`.
5. **Server restarted with HALT set and no agent** → `agent: halted · queue 1`,
   `dot halted`, `rgb(196,85,46)` = `--signal`. Resume → `agent: disconnected ·
   queue 1`. Halted outranks disconnected, as it outranks working.
6. **Server stopped entirely** → `agent: unknown`, dot `dot unknown`
   (`background: rgba(0,0,0,0)`, `box-shadow: rgb(155,161,168) 0 0 0 1px inset`),
   beside `server unreachable` and the counts' honest zeroes. Not `disconnected`:
   nothing had answered.
7. **Index pill unchanged throughout** — `index: current · 129 indexed`, dot
   `dot`, in every state above.

### Tick vs. refetch — and the one thing this issue could not fix

**Tick.** `useQueueStatus` is cached with `staleTime: Infinity`,
`refetchOnWindowFocus: false`, `refetchOnReconnect: false`, so the *only* thing
that refetches `["queue"]` is an SSE `invalidate` frame naming it. An agent
walking away produces no queue transition and therefore no frame — step 4 above
would never have happened on a refetch. `AgentPill` holds a 15 s `setInterval`
(the pending indicator's coarse clock, `TICK_MS`), re-reads `Date.now()`, and
passes it to the pure `agentState`. It costs no request, and because
`isAgentPresent` can only ever *withdraw* a presence, a skewed local clock cannot
make the pill claim more than the server did.

**The gap, and it is server-side.** Presence *arriving* does not reach the pill.
Measured: page open showing `disconnected`, an agent parked underneath it at
00:37:56Z, `GET /api/queue/status` served `{"agent":{"live":true,…}}` from that
second on — and the pill still read `agent: disconnected` **150 s later**, with
`/api/queue/status` requested exactly once the whole time. It corrected on the
next read (reload, or any queue transition: enqueuing a request flipped it to
`agent: idle · queue 1` live, and HALT to `agent: halted · queue 1` live).

The cause is `apps/server/src/app.ts:378` — `onPresenceChanged` invalidates
`[AGENTS_KEY]` only. Since CONTRACT-045, `QueueStatus.agent` *is* part of the
queue-status resource, and CONTRACT-045's own rationale for putting presence there
is that "the strip already reads this resource on load and on every `["queue"]`
invalidation" — a premise the emitter does not honour. Escalated to the
orchestrator rather than fixed here (server domain); the fix looks like
`invalidate([AGENTS_KEY, QUEUE_KEY])`. A UI workaround was deliberately not
built: reading presence from the roster instead would put `QueueStatus.agent` and
`GET /api/agents` on one surface, which CONTRACT-053 warns can legitimately
disagree for a grace window, and a poller would be a second poller for a resource
that already has an invalidation channel.

### The unknown-vs-absent distinction, and how it is held

`UNKNOWN_QUEUE_STATUS.agent` is `{live: false, since: null}` — a required field
with nothing behind it, not a report. It now **cannot reach the pill**: `Console`
passes `queue.data` down unsubstituted, `ConsoleStrip` substitutes the placeholder
for the *counts and the HALT button only*, and `AgentPill` takes
`QueueStatus | undefined` and answers `unknown` for the `undefined`. Both unit
tests for it were checked red against the obvious wrong implementation
(`agentActivity(status ?? UNKNOWN_QUEUE_STATUS, now)`), and step 6 above is the
same claim against a real dead server.

### Falsification

Every new assertion was checked red before being trusted green:

- `agentState` reverted to the old else-branch ladder → 3 red (disconnected,
  disconnected-outranks-working, window expiry). Halted and edge-of-window
  correctly stayed green.
- `agentActivity(status ?? UNKNOWN_QUEUE_STATUS, now)` → both unknown tests red.
- `disconnected: "dot halted"`, `unknown: "dot away"` → 3 red.
- `AgentPill`'s interval disabled → the tick test red, and **only** it — the exact
  "passes trivially against a component that never re-renders" trap.
- `.dot.away { background: var(--signal) }` → the new Playwright dot spec red with
  `Expected rgb(155,161,168), Received rgb(196,85,46)`.

### Checks

- `vitest run apps/ui/src/console/` — 137 passed (4 files).
- `tsc --noEmit -p apps/ui` — exit 0.
- `eslint apps/ui/src/console apps/ui/e2e/console*.spec.ts` — clean.
- `playwright test e2e/console.spec.ts e2e/console-index.spec.ts` (on 5292, proxy
  pointed at a dead 8799 to reproduce CI's no-server condition) — 24 passed.

## Completion Checklist (domain agent)

- [x] Pre-fix reproduction logged
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Acceptance criteria verified — with one caveat the UI cannot close: "flips
      back to `idle` promptly once an agent parks again" holds on the next read
      of `["queue"]` and not on the park itself, because the server invalidates
      only `[AGENTS_KEY]` when presence changes. Measured and escalated; see the
      E2E log.

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[UI-098]` prefix
