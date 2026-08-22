# [UI-127] The recipient picker oscillates under the pointer

## Domain

ui

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-057 (signed 2026-08-20)
- Blocks: —
- Related: UI-126 (which shipped the control), UI-128 (the audit this is an instance of)

## Spec References

- SPEC.md **§10** — *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)
- SPEC.md **§10** — the composer's recipient statement

## Summary

Reported by the user, 2026-08-20: *"The drop down to pick an agent when
commenting is blinking up and down which makes it impossible to use."*

**A regression shipped in v0.14.0**, by the issue (UI-126) whose whole purpose
was to make that control honest. An honest control a person cannot click is not
an improvement on the one it replaced.

## The mechanism, from reading — to be confirmed by reproduction first

Hovering a lane row calls `onPreview(row.lane)`, which sets `previewed`, which
changes `shown`, which changes the sentence rendered by `.recipient-says`
(`ComposerAddress.tsx:156`). That sentence has **no fixed height** and wraps
inside the popover's `max-width: min(330px, 86vw)`, so a longer statement adds a
line.

`.address-pop` is `position: absolute; bottom: calc(100% + 6px)` — anchored by
its **bottom** edge and growing **upward**. So one extra line of statement moves
**every row in the popover up**. The row under the cursor leaves the cursor,
`onMouseLeave` fires, `previewed` clears, the statement shrinks, the row returns
under the cursor, `onMouseEnter` fires.

That is a closed loop rather than a slow render, which is why it is unusable
rather than merely ugly.

**Reproduce before fixing.** A diagnosis from reading is not a reproduction, and
if a second cause is present — an SSE roster refresh mid-hover, a focus-driven
scroll — a fix aimed only at the statement will look right and leave the blink.

## Acceptance Criteria

- [x] The reproduction is recorded first: what was hovered, what moved, and by
      how much
- [x] Hovering any lane row changes **words only**. The popover's height, and
      every row's position, are unchanged — measured, not asserted by eye
- [x] The full statement is still readable for every row, including the longest
      (a profile name plus §7's missing-profile note). If it is truncated, the
      whole of it is reachable another way per SHARED-057
- [x] The same holds for keyboard preview (`onFocus`/`onBlur`), which drives the
      identical state
- [x] A browser test asserts the geometry: measure a row's bounding box, hover a
      different row, measure again, assert it did not move. **Falsify it** by
      restoring the growing statement and watching it fail
- [x] §10's composer key contract is untouched, and the existing pins stay green

## Technical Design

### Files to Create/Modify

- `packages/kit/src/address/ComposerAddress.tsx`
- `packages/kit/src/address/address.css`
- `apps/ui/e2e/` — the geometry spec

### Key Implementation Details

**The rule to satisfy is SHARED-057**, not "make the blink stop": a component's
size is a property of its place, never of its content. A fix that merely damps
the oscillation — a hover delay, a transition — leaves the rule broken and the
symptom timing-dependent.

Reserve the statement's box. Sizing it to the longest real statement is the
straightforward reading of *"the box is sized for the text people actually
have"*; a hard two-line clamp with the full value revealed on the row's existing
`title` is the fallback where the longest statement is unreasonably long.

**Read `composerReach.ts`'s docblock before touching liveness** — the coupling
runs one way and this fix must not become a path between pressing send and a
request leaving.

### Edge Cases

- One lane only: the rows do not render at all (`showRows` needs two)
- A refused lane, which colours the statement and may change its length
- A missing profile, whose note is the longest statement the control has
- Very narrow viewports, where `86vw` binds before `330px`

## Testing Strategy

Unit tests for the model; a real-browser geometry test for the fix itself,
because this defect is a layout loop and jsdom implements no layout.

## E2E Verification Plan

### Verification Steps

1. Real Vite dev server, ports not 5173 / not 8765
2. A thread with at least two lanes, one with a missing profile
3. Hover each row in turn; measure every row's bounding box before and after
4. Repeat with the keyboard, tabbing between rows
5. Confirm the statement is fully readable for each

## E2E Verification Log

### Reproduction (orchestrator, 2026-08-20, real Chromium on Vite 5283)

Fixture: a standalone thread with a general lane and a **missing-profile**
resident (`{name: "claims-review", docId: null}`), which produces the control's
longest statement. Scratch spec kept at
`scratchpad/ui127-repro.spec.ts`.

**1. Playwright refuses to hover the row at all**, which is the defect in the
tool's own words:

```
Error: locator.hover: Test timeout of 30000ms exceeded.
  - locator resolved to <button … data-recipient-lane="th_solo" …>
  - attempting hover action
    2 × waiting for element to be visible and stable
      - element is not stable
    - retrying hover action
    54 × waiting for element to be visible and stable
      - element is not stable
```

58 stability retries across 30 seconds. Playwright calls an element stable when
its bounding box is unchanged across two consecutive animation frames, so this
is a measurement that the row never stops moving — not an impression.

**2. The amplitude, measured with the pointer parked at coordinates captured
before the popover could move** (so the pointer cannot chase it):

```
pointer away: says_h=85  pop_h=273
on row0     : says_h=34  pop_h=222
away again  : says_h=85  pop_h=273
on row1     : says_h=85  pop_h=273
```

**51 pixels**, and `.recipient-says` accounts for all of it.

**3. What the mechanism actually is — the reading-diagnosis above had the
direction wrong.** The statement does not *grow* on hover; the **resting** state
is the tall one. Effective recipient is the resident lane, whose statement is the
three-line missing-profile note (85px). Previewing the orchestrator lane collapses
it to one line (34px). The popover is bottom-anchored, so 51px vanishes from its
height and its contents shift — the row leaves the cursor, the preview clears,
the statement returns to three lines, the row comes back, and it repeats.

The direction does not change the fix, and the correction is recorded because a
fix aimed at "stop it growing" would have been aimed at the wrong end.

**4. It is content-dependent, which is why it escaped every existing test.** With
two lanes whose statements happen to be the same height, nothing moves — the
first attempt at this reproduction passed for exactly that reason. It takes a
workspace where one lane's statement is longer than another's, which is the
ordinary case with a real profile name and precisely what the user has.

### Implementation (ui-dev, 2026-08-20, implemented on: opus)

Real Chromium against the real Vite dev server on **5283** (server origin
`127.0.0.1:8893`, never 5173 / 8765), through the whole app: board → row →
reader → reply composer → address line → popover.

#### 1. What the sizing decision was, and the measurement behind it

The popover is **240px wide at every composer host**, and that is not a
coincidence to be relied on loosely — it is `min-width: 240px` winning, because
the shrink-to-fit width is bounded by `.composer-address`, which is only as wide
as the address line pill. So the statement wraps in a **218px measure**
everywhere. Every real statement, measured in that box before anything changed:

```
STYLE {"fontSize":"10.5px","lineHeight":"17.01px","width":218,"popWidth":240}
LANE orchestrator h=34  chars=58  :: agent will answer — last seen 4m ago — nobody is listening
LANE th_host      h=34  chars=61  :: claims-review will answer — reading the policy (default here)
LANE th_wait      h=34  chars=65  :: A conversation nobody has parked on will answer — no listener yet
LANE th_lapsed    h=68  chars=98  :: release-researcher will answer — last seen 17m ago — the orchestrator will answer until it returns
LANE th_gone      h=102 chars=173 :: claims-review will answer — its profile is gone — renamed, deleted, or moved out of .claude/agents/ since — last seen 17m ago — the orchestrator will answer until it returns
```

**2, 4 and 6 lines.** Decision 2's escape hatch was taken, and the number is
stated: **the box reserves four lines and clamps at four.**

- Sizing to the longest real statement is **not available**, and not because six
  lines is ugly. `AgentLane.summary` is free text the agent writes, so the
  sentence is unbounded from above: there is no longest one to measure. Some
  content must truncate, and the only decision is which.
- **Four is where the ordinary case stops.** A lapsed lane is ordinary — every
  agent that is not parked right now reads that way — and it is four lines. §7's
  missing-profile report is the one statement that overflows, and §7 itself
  calls that news rather than the reading path. Three lines would have truncated
  the lapsed fallback (*"the orchestrator will answer until it returns"* is the
  whole point of that sentence), which is the common case, not the rare one.
- The reserve is `4 × 1.6em = 67.2px`. At rest with a two-line statement that
  leaves two blank lines under it, which is the price of the rule and was looked
  at in a screenshot rather than assumed.

**Revealed, not accommodated.** The full sentence is on the statement's **own**
`title` *and* on the row's, which has carried `name — note — line` since UI-126.
The row's title was the orchestrator's nominated path; the statement's own was
added because truncation happens *there*, and a person whose pointer is on the
clipped sentence should not have to guess that the answer is on a different
element.

After the fix, the same five lanes:

```
LANE orchestrator h=67 :: agent will answer — last seen 4m ago — nobody is listening
LANE th_host      h=67 :: claims-review will answer — reading the policy (default here)
LANE th_lapsed    h=67 :: release-researcher will answer — last seen 17m ago — …
LANE th_gone      h=67 :: claims-review will answer — its profile is gone — …
LANE th_wait      h=67 :: A conversation nobody has parked on will answer — no listener yet
REST              h=67
```

#### 2. The browser spec, and what it measures

`apps/ui/e2e/address-geometry.spec.ts`, five tests, all green. The fixture is
three rows whose statements are **2, 4 and 6 lines** — the defect is invisible
against a roster whose lanes read alike, which is exactly why it survived
v0.14.0.

- **Fixed coordinates.** Row centres are captured with the pointer parked away,
  *before* anything can move, so the pointer never chases the row. Then every
  row's box, the popover's box and the statement's box are compared across a
  preview of each lane in turn, and across leaving it again. A final assertion
  checks the control was **alive** — three distinct sentences — so the geometry
  held across real changes and not across none.
- **Playwright's stability engine.** `locator.hover({timeout: 5000})` on every
  row. Playwright calls an element stable when its box is unchanged across two
  consecutive animation frames, so a passing `hover()` *is* the regression test,
  in the tool's own terms — the ones the reproduction failed in.
- **Keyboard.** The identical sweep driven by `focus`/`blur`, which drive the
  identical `previewed` state.
- **Truncation and reveal.** With the missing-profile row previewed,
  `scrollHeight > clientHeight` (truncated in place, box did not grow) and the
  title carries the whole sentence; with the ordinary rows previewed —
  orchestrator and the four-line lapsed one — `scrollHeight <= clientHeight`, so
  revealing is the uncommon case and not the reading path.
- **A second host.** The global composer (`c` → `.compose-panel`, surface
  `compose`) gets the same keyboard sweep. It is the same component from
  `@corpus/kit`, but its popover sits in a different place, so it was measured
  rather than reasoned about.

Unit tests in `ComposerAddress.test.tsx` pin the half jsdom can see: the title
equals the whole rendered sentence, default note included, and it changes with
the words under both `mouseEnter/mouseLeave` and `focus/blur`.

#### 3. Falsification — three mutations, each rebuilt

**(a) Restore the variable-height statement.** Removed the reserve from
`.recipient-says`, rebuilt kit, ran the spec. **All 5 failed**, with the defect's
own signature:

```
TimeoutError: locator.hover: Timeout 5000ms exceeded.
  - locator resolved to <button … data-recipient-lane="th_host" …>
  - attempting hover action
    2 × waiting for element to be visible and stable
      - element is not stable
    - retrying hover action
    9 × waiting for element to be visible and stable
      - element is not stable
```

and the amplitude, from the fixed-coordinate test:

```
Error: previewing orchestrator moved something
  pop.height  256 → 222      pop.y   239 → 273
  rows[0].y   270 → 304      rows[1].y  270 → 304      rows[2].y  298 → 332
  says.height  68 → 34
```

Restored, rebuilt, **5 passed**.

**(b) The same mutation against the global composer** — to answer whether any
other host swung. It did: `pop.height 136 → 152`, `pop.y 82 → 67`, every row up
15px. Same defect, same fix, one component.

**(c) The reveal, and the `dist/` trap, on purpose.** Deleted the statement's
`title` from `ComposerAddress.tsx` and ran the spec **without rebuilding**: it
**passed** — `apps/ui` was still running the last built copy, exactly as this
domain's 2026-08-16 note warns. Rebuilt kit and ran again: failed with
`Expected: "claims-review will answer — its profile is gone — …" / Received: ""`.
Restored, rebuilt, green.

#### 4. Neighbouring pins, unchanged

`recipient.spec.ts`, `weight.spec.ts`, `compose-keyboard.spec.ts`,
`resident.spec.ts`, `residents-tab.spec.ts` — **46 passed**. §10's composer key
contract is untouched: nothing here binds a key, and `composerReach.ts` was read
and not modified.

Scoped unit run (`packages/kit apps/ui/src`): **207 files, 4065 tests passed**.
`tsc --noEmit` clean in both workspaces. ESLint and Prettier clean, no rule
disabled.

#### 5. One thing found and deliberately not fixed here

**The popover has no ceiling over a surface that has one.** With five lanes in
the roster the card is 312px tall and rises to y=112, while the reader's head
ends at y=159 — so its top rows sit *behind* `.reader-head`, which then takes the
pointer events aimed at them. Measured at the suite's 1280×720, and it pre-dates
this fix (a taller viewport does not help: the composer sits under the last turn,
not at the bottom of the reader). This fix adds 33px to the resting card, so it
makes an existing overlap slightly worse without creating it.

It is a different question from a popover that resizes — a card with no maximum
height and no flip — and it is left for UI-128's audit rather than folded in
here. The spec's fixture is three rows, which clears the head by 80px.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in, reproduction first
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-127]` prefix
