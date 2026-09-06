# [UI-195] A resident can be stopped where it is shown

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SERVER-165 (release semantics under designation-engages —
  landed 2026-09-06)
- Related: UI-186 (the Residents pane this control lands in)

## Spec References

- SPEC.md **§7** — dissolution returns the scope to ordinary routing
- SPEC.md **§9.2** — `DELETE /api/threads/:id/resident` releases, idempotent,
  takes effect at once: *"'stop this agent' is an act with an observable
  end"*
- SPEC.md **§8**, rider signed 2026-09-06 — release keeps the thread
  engaged; the ordinary agent answers from then on

## Summary

**User directive, 2026-09-06: "I want to be able to stop a resident agent
from the console pannel."** The Residents pane shows every lane and what it
runs at, but stopping one means leaving the console for the thread's own
menu. The place that shows a running agent is the place a person reaches to
stop it.

## What to build

A stop control on each resident row in the console's Residents pane:

- It calls the existing release route (`DELETE /api/threads/:id/resident`)
  through the kit's mutation — no new contract or server surface.
- "Stop" is release, the one spec-backed stop with an observable end. The
  control says what it does before it does it: the resident is released, the
  conversation stays open and engaged, and the ordinary agent answers it
  from now on (the §8 rider's semantics — quote the consequence, not the
  mechanism).
- The row reflects the release when the server confirms it (SSE
  `resident.released` reaches the pane's model) — no optimistic pretending
  an agent stopped before it did, because §9.2 makes the release's effect
  observable and the pane's honesty is its point.
- Idempotence per §9.2: a row whose resident is already gone offers nothing.

## Acceptance Criteria

- [ ] Each resident row offers the stop control, worded as release with its
      consequence stated before the act
- [ ] Releasing from the pane updates the row on the server's confirmation,
      and the lane returns to ordinary routing (E2E: a parked listener's
      park returns, the next plain turn goes to the orchestrator's lane)
- [ ] The thread's own menu and the pane agree afterwards — one state, two
      surfaces
- [ ] No new contract surface; the kit mutation is reused or added in
      packages/kit only

## E2E Verification Log

**Model: opus (claude-opus-5).** 2026-09-06.

Real workspace, real server, real browser. Not the Playwright e2e suite — that
suite starts Vite with no proxy target and cannot reach a workspace server
(INFRA-028), so the app was driven against the server that serves it.

**Setup.** `corpus init … --port 8791`, `corpus server start` (pid 85651,
`corpus 0.33.0 listening on http://127.0.0.1:8791`). The server serves
`apps/ui/dist` itself and injects the bearer token into the shell it hands out,
so the browser talked to the same origin the installed tool would.

### 1 — a designated conversation with a parked listener

```
corpus thread create --title "Rent planning" -m "…"
→ th_mynrqwyd, "agent":"engaged", resident {name:null, designationId:"des_rrsfgaakebri"}
corpus queue idle --thread th_mynrqwyd --wait 480        (backgrounded, parked)
corpus agents --json
→ th_mynrqwyd … "live":true,"since":"2026-09-06T17:18:13Z","summary":"idle — last active just now"
```

### 2 — the pane offers the act, and states it before taking it

Browser at `http://127.0.0.1:8791/`, console drawer open, **Residents** tab.

- `[data-lane="th_mynrqwyd"]` present, `data-lane-liveness="live"`.
- Orchestrator's row selected first: `[data-lane-release-panel]` count **0** —
  a lane with no resident offers nothing.
- Row selected: resting button reads **"Release the resident"**, `title` carries
  the whole sentence, `[data-lane-release-consequence]` count **0**.
- First press: consequence rendered — *"Releasing stops this lane's agent. The
  conversation stays open and engaged, so the ordinary agent answers it from now
  on."* — with **Confirm release** and **Keep the resident**. No request was
  sent by that press.

### 3 — the act, and the server confirming it

- Confirm → `DELETE /api/threads/th_mynrqwyd/resident → 200` (observed on the
  wire, not inferred).
- The parked `corpus queue idle` **returned**: its poll ended the moment the
  release landed and its re-arm was refused —
  `422 unknown_recipient: 'th_mynrqwyd' names no lane to consume`. The listener
  is not merely told to stop, it has stopped.
- The row left the list with no reload: `[data-lane]` → `['orchestrator']`,
  `[data-lane-release-panel]` → 0, toast *"Resident released — this conversation
  is back on the agent's own lane."* (the conversation menu's own wording).
- `corpus agents` → the orchestrator's lane alone.
  `corpus job list` → `resident.released`, `lane:"orchestrator"`.

### 4 — the lane returned to ordinary routing (§7, §8's 2026-09-06 rider)

```
corpus thread show th_mynrqwyd   → "agent":"engaged","resident":null,"status":"open"
corpus thread reply th_mynrqwyd -m "And what about the deposit?"   (plain: no mention, no toggle)
corpus job list  → evt_znhhgdfm7oi2  comment.created  lane:"orchestrator"
```

The thread stayed open and engaged, and the next plain turn went to the
orchestrator's lane. That is the rider, observed rather than argued.

### 5 — the thread's own menu agrees

Opened `th_mynrqwyd` from the Attention board and opened its `⋯` menu:

```
["Collapse…", "Resolve…", "Designate a resident — no profile — owns this
 conversation and everything that grows out of it", "No profiles yet…"]
```

No release item: the menu and the pane report one state.

### 6 — a release made elsewhere reaches the pane

Second conversation `th_d4ikcoua`, pane open on its row showing
"Release the resident". Released from the **CLI** against the same server
(`corpus thread release th_d4ikcoua`). With no click and no reload in the
browser, the row left the roster — the `resident.released` invalidation reaches
the pane's model on its own.

### 7 — a defect found and fixed by looking at the real thing

The first pass was tested green and **was not usable**: at the drawer's default
210 px, arming pushed `Confirm release` 27 px below the drawer's own edge, with
`.lane-scope` not scrollable — an act a person could start and not finish. Two
fixes, both measured against the running app: `.lane-scope` scrolls and
`.scope-list` may shrink (`min-height: 0`), so nothing is unreachable at any
height; and the section scrolls itself to the pane's bottom edge when it arms.
The consequence lost a redundant clause in the same pass. Re-measured:
`Confirm release` now lands at y 917–939 in a 950 px viewport, with no gesture of
the person's needed. Screenshots kept for the resting and armed states.

### Tests

- `apps/ui/src/console/Residents.test.tsx` — 43 pass, 9 of them new.
- `apps/ui/src/console` + `packages/kit/src/query` — 428 pass.
- `apps/ui` + `packages/kit` — 252 files, 5137 pass.
- lint, `tsc --noEmit` across every workspace, and `prettier --check` clean.
- **Falsified twice.** Sending `designate: null` instead of `release: true` →
  5 of the new tests fail. Hiding the row on click instead of on the server's
  answer → the "keeps the row on the screen until the server has answered" test
  fails. The stub was given a real `DELETE` handler that removes the lane from
  its roster, so the untyped `json({})` fallback could not have carried a green
  run for a release nobody performed.
