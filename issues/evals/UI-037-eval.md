# Evaluation: UI-037

**Date**: 2026-08-02
**Sprint**: N/A (dogfood-todos-polish batch)
**Verdict**: PASS

## Environment

Real `corpus` built from source (`npm run build`), scratch workspace
`/tmp/eval-dogfood-ws` created with `corpus init --port 8891`, real server
(`corpus server start`, pid 60040), **production UI served by the server itself**
at `http://127.0.0.1:8891/` — no Vite, no stubbed transport, no request
interception anywhere in this evaluation. Ports 8765 and 5173 untouched
(both held by other holders, verified with `lsof`). Driver: real Chromium via
Playwright.

Fixtures created through the CLI only: `doc_vyhr4yr2` "House chores" (17 items,
three identical "Call the plumber about the boiler" at indices 0/5/16),
`doc_rp7tlqf4` "Deep backlog" (25 items, 20 checked, the only open ones at
20–24, indices 20 and 24 identical), a pinned `column: todos/todos` view.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                             |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Long, with three dated follow-ups                                                                                                 |
| Commands are specific and concrete      | PASS   | Named specs, ports, exact assertion values, frame-by-frame numbers                                                                |
| Real E2E (not mocked)                   | PASS\* | Playwright against a real Vite server with the transport stubbed. Below the app, so acceptable — and re-verified here with no stub |
| Scenarios cover acceptance criteria     | PASS   | All five criteria addressed                                                                                                       |
| Application restarted after changes     | PASS   | Fresh dev server per port stated per run                                                                                          |
| Actual model recorded (implemented on:) | PASS   | "Model: Opus 5 (`claude-opus-5[1m]`)"                                                                                             |
| Reproduction logged before fix (bugs)   | PASS   | Both follow-up defects carry pre-fix red evidence with the failing numbers                                                        |

The log is unusually honest — it explicitly flags the cold-open alignment
assertions as "end-state guards, not deterministic reproducers". That candour
is what made this evaluation targetable; every claim below was re-derived
independently.

## Criteria Results

| #   | Criterion                                                     | Result | Notes                                                                                                              |
| --- | ------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| 1   | Open seam accepts the payload; plain docId opens unchanged    | PASS   | Group-heading click writes `{docId, scrollY:0}` with no `reveal` key and leaves `scrollTop` 0                       |
| 2   | `kind:"item"` scrolls + flashes, with prefix/suffix disambig. | PASS   | Flash box within **1 px** of the clicked duplicate, 137–173 px from the other occurrences                            |
| 3   | `kind:"thread"` delegates to `jumpToThread`                   | PASS   | Thread slot expands, `.thread-card.flash` present for 72 consecutive frames (~1.2 s)                                |
| 4   | Works in column reader and focus; survives restoration        | PASS   | Column reader verified end to end; focus-mode producer gap is ledgered (see note)                                   |
| 5   | No plugin-facing breaking change                              | PASS   | Plain-id opens produce a byte-plain entry; the todos plugin consumes the widened seam without any core-side special-case |

### The late fix (flash tracks its line) — probed hard, holds

This was the claim I most expected to break, so it was attacked four ways.

**a. Bottom item of a long list, short viewport, cold open.** 560 px viewport,
click item 24 of `doc_rp7tlqf4` (last line of a 25-item list):

```
first lit frame: {"t":1751,"fy":275,"ly":274,"n":25,"st":1003,"lay":1}
last  lit frame: {"t":2978,"fy":..., "ly":...}
offset flash−line across 74 lit frames: min 1  max 1   frames >12 px off: 0
targetOnScreen: true   scrollTop 1003 of a 1085 max
```

**b. Slow document loads** (`page.route` delaying `/api/docs/doc_*`), three
delays, each a genuinely cold open:

| delay   | lit frames | offset min | offset max | frames >12 px off |
| ------- | ---------- | ---------- | ---------- | ----------------- |
| 300 ms  | 74         | 1          | 1          | 0                 |
| 900 ms  | 74         | 1          | 1          | 0                 |
| 2000 ms | 74         | 1          | 1          | 0                 |

**c. The one cold open where I did catch it stale** — House chores item 5,
620 px viewport:

```
first lit frame: flashY 295 / liY 270   ← 25 px off
last  lit frame: flashY 271 / liY 270   ←  1 px
offset min 1, max 25; frames off by >12 px: 1 of 74
```

Exactly **one frame** (~16 ms) of staleness before the tracker re-measured and
snapped onto the line. That is the physical floor for an rAF-based tracker, not
the pre-fix defect (which held the wrong position for the flash's whole life).
Recorded as observed behaviour, not a failure.

**d. Deterministic: move the surface under a lit flash.** Scrolling the reader
−250 px while the flash was up:

```
scrollTops around the jump: 904(off 1) 904(off 1) 654(off -249) 654(off 1) 654(off 1) 654(off 1)
```

One frame at the old position, then back on the line. Tracking is real.

### One-shot

- After the reveal the entry is `{"docId":"doc_rp7tlqf4","scrollY":931}` —
  instruction gone, scroll kept.
- Reload → **0** flash layers, document restored at scrollY 931. Second reload →
  still 0.
- Push (a `[[ref]]` click) then **Back** → 0 flash layers over 3.4 s.
- **Stress on the exact race the follow-up describes** (scrolling the reader in
  7 px steps every 40 ms through the 150 ms capture debounce, five full cycles
  of click → scroll → settle → reload):
  `BAD CYCLES: 0/5` — no cycle put a `reveal` back on the entry and no reload
  re-flashed.

### Thread reveal

Driven through the todos menu's "Open existing thread" (the first real producer):
reader opens `doc_vyhr4yr2` with `.thread-slot.expanded[data-slot-thread="th_7h43q3ag"]`,
`.thread-card.flash` present for 72 of 137 sampled frames, entry left without a
reveal. The dev-only StrictMode defect the implementer reported does **not**
appear in the production build served by the server — as predicted.

## Failures

None.

## Notes (not failures)

- **Focus-mode producer gap** — ledgered by the orchestrator, deliberately not
  scored. Confirmed observationally: expanding to full screen after a reveal
  carries the open with the instruction already spent (0 flash layers), which is
  the behaviour the log describes.

## Summary

5 of 5 criteria passed. The reveal seam is correct in the real, unstubbed
application: the right duplicate, real scroll, a flash that tracks its line
through cold opens, artificially slowed document loads and a mid-flash scroll,
and a one-shot guarantee that survived a five-cycle stress of the exact race
that produced the original bug. The single one-frame stale draw observed on one
cold open is the tracker's inherent floor, not the defect that was fixed.
