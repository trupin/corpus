# Evaluation: PLUGINS-010

**Date**: 2026-08-02
**Sprint**: N/A (dogfood-todos-polish batch)
**Verdict**: PASS

## Environment

Production UI served by the real server at `http://127.0.0.1:8891/`, workspace
`/tmp/eval-dogfood-ws`, **no stub of any kind** — the plugin's aggregate route,
the documents and the reader are all real. Real Chromium.

Two fixtures built for this issue's hardest case:

- `doc_vyhr4yr2` "House chores" — 17 items, three identical
  "Call the plumber about the boiler" at indices **0, 5, 16**.
- `doc_rp7tlqf4` "Deep backlog" — **25 items, the first 20 checked**, so the
  column's five rows are indices 20–24, i.e. the *bottom* of a long list, with
  indices 20 and 24 identical.

The second fixture exists because the column shows a group's first five open
items; making the only open items the last five is the only honest way to click
"the bottom item of a long list".

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                        |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| Verification log present                | PASS   |                                                                              |
| Commands are specific and concrete      | PASS   | Captured payload, measured scrollTop, frame-by-frame layout dump              |
| Real E2E (not mocked)                   | PASS   | A real-app drill on 8781 plus a stub spec; re-verified here with zero stubs  |
| Scenarios cover acceptance criteria     | PASS   | All four                                                                     |
| Application restarted after changes     | PASS   | Server/Vite started and stopped, ports verified free                          |
| Actual model recorded (implemented on:) | PASS   | "Model: Opus 5 (`claude-opus-5[1m]`)"                                        |
| Reproduction logged before fix (bugs)   | PASS   | The stale-flash defect was found by this drill and escalated with numbers    |

The log also carries a mutation check (dropping `prefix`/`suffix` turns the
duplicate test red while the first-duplicate test stays green) — the right way
to prove an assertion is load-bearing.

**Bookkeeping**: the issue file's **Status is still `todo`** while every
checklist box is ticked. Not a behavioural failure; flagged for the orchestrator.

## Criteria Results

| #   | Criterion                                                    | Result | Notes                                                                     |
| --- | ------------------------------------------------------------ | ------ | ------------------------------------------------------------------------- |
| 1   | Clicking an item row opens the doc scrolled so it is visible | PASS   | Bottom item of 25, 560 px viewport: `scrollTop` 1003 of 1085, on screen    |
| 2   | The clicked item gets the transient `.reveal-flash`          | PASS   | 74 lit frames, **1 px** from the line, and it now *tracks* — see below     |
| 3   | Clicking the group header keeps top-of-doc                   | PASS   | `scrollTop` 0, entry carries no `reveal`, 0 flash layers                   |
| 4   | Works in column reader and full-screen focus                 | PASS   | Column reader end to end; focus half is the ledgered producer gap          |

### The hardest case: bottom item, long list, short viewport

560 px viewport, click `data-todos-item="24"` (last line of a 25-item list):

```
first lit frame: {"t":1751,"fy":275,"ly":274,"n":25,"st":1003,"lay":1}
offset flash−line over 74 lit frames: min 1  max 1   frames >12 px off: 0
scrollTop 1003 (max 1085)   targetOnScreen: true
duplicates in the rendered doc: li[20] y=137, li[24] y=274
entry afterwards: {"docId":"doc_rp7tlqf4","scrollY":951}     ← no reveal
```

The flash sat on li[24] and **137 px away** from li[20], which carries the same
words. Note `scrollTop` drifted 1003 → 951 as the layout settled after the open,
and the flash stayed 1 px from its line throughout — the tracking fix earning
its keep on a real layout shift.

### Duplicate disambiguation, both directions, real documents

House chores has the same words at indices 0, 5 and 16.

```
click item 5 → flash within   1 px of li[5]  (y 270)
                     173 px from li[0]  (y  98)
                     376 px from li[16] (y 647)
               scrollTop 328
click item 0 → flash within   1 px of li[0]  (y 426)
                     171 px from li[5]  (y 598)
                     548 px from li[16] (y 975)
               scrollTop 0
```

It lands on the one that was clicked, both when that is the first occurrence and
when it is not.

### Heading click

```
click .todos-group-head → scrollTop 0, 0 flash layers,
                          entry {"docId":"doc_rp7tlqf4","scrollY":0}   ← no "reveal" key
```

Byte-plain entry, unchanged behaviour.

### Cold-open staleness — the escalated defect, re-probed

This issue is where the stale-flash defect was found, so it got the hardest
probe. `page.route` delaying `/api/docs/doc_*`, three cold opens:

| document fetch delay | lit frames | offset min | offset max | frames >12 px off |
| -------------------- | ---------- | ---------- | ---------- | ----------------- |
| 300 ms               | 74         | 1          | 1          | 0                 |
| 900 ms               | 74         | 1          | 1          | 0                 |
| 2000 ms              | 74         | 1          | 1          | 0                 |

The worst I could produce anywhere was a **single** first frame 25 px off on one
House-chores open, snapping to 1 px on the next frame — 1 of 74 frames, ~16 ms.
The defect this issue reported (box stuck 24 px off for the flash's whole life)
does not reproduce.

### One-shot

Reload after a reveal → 0 flash layers, document restored at scrollY 931; second
reload → still 0. Push (`[[ref]]`) then Back → 0 flash layers over 3.4 s. And a
five-cycle stress that scrolls the reader through the capture debounce window
(the exact race that produced the original resurrection bug):

```
cycle 0..4: entry carries reveal = false | flash layers after reload = 0
BAD CYCLES: 0/5
```

### Full-screen focus

Expanding to full screen after a reveal carries the open with the instruction
already spent (0 flash layers, document intact). That is the reachable half; the
"no producer can put a reveal into focus mode" gap is core's and is ledgered.

## Failures

None.

## Summary

4 of 4 criteria passed against a document built to be the worst case for this
feature: the bottom item of a 25-line list, with a duplicate of it at the top,
opened from a 560 px viewport. The payload picks the clicked occurrence, the
scroll lands it on screen, the flash holds its line through cold opens and
artificially slowed document loads, headings still open at the top, and the
one-shot survived a five-cycle stress of the race that originally broke it.
