# [UI-137] The address line widens when its weight arrives, and pushes Send

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
- Related: UI-127, UI-130 (the same control), UI-131 (which measured this)

## Spec References

- SPEC.md **§11** — *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)
- SPEC.md **§11** — the composer, its recipient statement and its submit control

## Summary

Measured by UI-131's implementer, 2026-08-20, while fixing the same shape one
surface over:

```
address line  x=95 w=124.83 → w=170.97   (+46.14)
send button   x=350.5       → x=386.80   (+36.30)
```

The composer's address line reads `<who> · <weight>`. The weight clause arrives
on a **second** request — the roster names a level key and the workspace's own
orchestrate skill turns it into words — and when it lands the pill widens and
**pushes the Send button 36px to the right.**

**This is the release's own headline defect, on the control the release started
from, and it moves a control rather than a label.** UI-127 stopped the popover
oscillating and UI-130 gave it a ceiling; neither touched the line itself.

## Why UI-131's answer does not transfer

Stated by its implementer rather than rediscovered here. The console's fix
reserves a `ch` box because its content is a weight label drawn from a **fixed
vocabulary**. Here the weight clause lives inside one `.address-line-text` string
built by `addressLine()`, and the line reads `<who> · <weight>` where *who* is an
arbitrary-length name. There is no vocabulary to size a reservation against.

## The two candidates, and the one to take

**Take: the line's width is a property of its slot in the footer, not of its
text.** That is SHARED-057's first clause applied literally, and the whole value
is already reachable — UI-127 put the full statement on the line's `title`.

**Rejected: reserve only the weight clause.** It leaves the name variable, so the
line still resizes whenever the name arrives, changes, or a different lane is
picked. It fixes the trigger this issue measured and not the defect.

## Acceptance Criteria

- [x] The address line's width does not change when the weight label arrives, when
      the recipient changes, or when the name is long or short
- [x] **The Send button does not move**, at any composer host, in any of those
      cases — this is the acceptance test, measured
- [x] The full statement stays reachable; truncation reveals rather than hides
      (SHARED-057 clause 2)
- [x] The slot is sized against real content (clause 3) — state the measurement
- [x] UI-127's and UI-130's specs stay green, unmodified
- [x] `design/index.html` is the reference for how the pill reads at a fixed
      width. If this changes the pill's look, say so and say why it is still the
      mockup's intent
- [x] Falsified: restore the content-driven width, watch Send move by ~36px

## Technical Design

### Files to Create/Modify

- `packages/kit/src/address/ComposerAddress.tsx`, `address.css`
- `apps/ui/e2e/address-geometry.spec.ts` — the Send-button assertion

### Key Implementation Details

Read UI-127's and UI-130's E2E logs first — three issues have now worked this
component and each records why its mechanism is shaped as it is. `addressLine()`
composes the string; the `title` already carries the whole of it.

### Edge Cases

- The floor state (`Nobody is asked`), which is shorter than every other
- A resident lane, whose line carries the resident's weight rather than a picked one
- A very narrow composer, where the slot and the text area compete
- The comment popover host, whose footer differs from the thread composer's

## Testing Strategy

A browser geometry test. The reflow is driven by a second network response, so
the spec must delay it — an already-resolved label reproduces nothing.

## E2E Verification Plan

### Verification Steps

1. Real Vite dev server, ports not 5173 / not 8765
2. Delay the skill-document request; measure the line and the Send button before
   and after it resolves
3. Repeat with a long recipient name and a short one
4. Repeat at every composer host

## E2E Verification Log

### Implementation (ui-dev, 2026-08-20, implemented on: opus)

Real Chromium (Playwright, Desktop Chrome) against the real Vite dev server on
**5290** (`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8900`, never 5173 / 8765),
through the whole app at all three composer hosts: board → row → reader → reply
composer; `c` → the global composer; a document selection → right click →
comment → the comment popover.

UI-127's, UI-130's and UI-131's logs were read first. Nothing here re-derives a
decision one of them made, and the two places this work depends on them are
named where they are used: `settled()` is UI-127's helper and it is what makes
the measurement honest here, and UI-131's escalation is the reproduction.

#### 1. Reproduced first, and the number is bigger than the one handed over

UI-131 measured `send x=350.5 → 386.80` on an **unsettled** first paint. That
number is real but it is not the whole of it: a column that opens a reader grows
to its reading floor over a 0.25s CSS transition (`.col { transition: width }`),
so a measurement taken during it reads a moving column as well as a moving line.
Measured settled, at 1280×720, the roster naming a resident at `weight: heavy`
and `GET /api/docs/doc_orchestrate` held open:

```
                   before the label      after it lands
.composer-address  x=95   w=181.72   →   x=95   w=220.00   (+38.3)
.composer-foot     w=434.16           →   w=434.16
.send              x=453.33 w=41.91  →   x=461.78 w=33.38  (+8.5, and 8.5px narrower)
```

and from the unsettled paint, `send x=350.38 → x=461.78` (+111.4) — which is
UI-131's +36 with a longer resident name and a column caught earlier in its
transition. **The send button does not only move: it shrinks.** Everything in
the foot was already being squeezed, and the arriving label took another 8.5px
off `Reply ⌘↵`. Under the two other reproductions the spec now runs, it is worse:

```
picking a 45-character resident name
  .send  x=458.47 w=36.69 h=34  →  x=471.22 w=23.94 h=51
```

A 24px-wide, three-line-tall send button. That is the defect at its worst, and
it is a control, not a label.

#### 2. The decision, and the measurement behind the number

**The slot is a property of the footer.** `.composer-address` now carries
`--address-slot: 22ch` and `flex: 0 1 var(--address-slot)`. The pill fills that
slot (`.address-line { flex: 1 1 auto }`), the text fills the pill
(`.address-line-text { flex: 1 1 auto }`, already `nowrap` + ellipsis), and the
caret is `flex: none` so the affordance survives a long statement.

Reserving the weight clause alone was **not** revisited: the orchestrator ruled
it out, and the reproduction above confirms why — swapping the recipient between
a two-character name and a forty-five-character one moves the same boxes with no
weight label involved at all.

**The measurement.** Everything below is in the line's own font,
`10.5px ui-monospace/"SF Mono"/Menlo/Consolas`, where `1ch = 6.321875px`. The
pill spends 30px on chrome (9px padding and 1px border each side, a 5px gap, a
4.8px caret), so a slot of `w` shows `w − 30` of text. Real at-rest statements,
measured in that font:

```
  95  Nobody is asked                                             floor
 107  agent will answer                                           ordinary, live
 177  agent will answer · Standard
 190  researcher will answer · heavy
 259  ui-dev will answer · Small and mechanical
 272  agent will answer · Heavy or judgment-laden
 303  claims-review will answer · weight set at launch
 354  release-researcher will answer · Heavy or judgment-laden
```

**And the room the footer actually has, which is what binds.** A column showing
a reader is **560px** — `READING_WIDTH_CEILING` in `apps/ui/src/board/columnWidth.ts`,
and `design/index.html`'s own `.col.reading { width: 560px }`. That gives
`.composer-foot` **434.16px**, and its other four items need **292.6px** at their
natural size:

```
📎 clip           24.00
◉ ask agent       69.55
thread stays open 107.47
Reply ⌘↵          50.58
4 × 10px gap      40.00
                 ------
                 292.60      →  141.56px is left for the address
```

**`22ch` is 139.08px** — the widest whole-`ch` slot that takes nothing from the
send button. It is not a compromise against the footer: today the send button is
squeezed to 41.91px of its natural 50.58px, and after the reserve it is 50.58px
again, so the slot **gives the send label back** rather than costing it anything.
The toggle (57.6 → 69.55) and the hint (89.0 → 107.47) are un-squeezed with it.

What that slot holds whole: `agent will answer` (17 characters, 107px) — the
ordinary live line before anybody picks a weight — and `Nobody is asked` (15,
95px), the floor. What it truncates: a weight clause, and a resident name past
about ten characters. **That is the honest statement of clause 3 and not a
claim to have satisfied it everywhere.** There is no wider number available: the
name is free text from a profile, so the sentence is unbounded from above, and
the footer's room is fixed at 141.56px. Some content must truncate and the only
decision is which — the same shape of decision UI-127 recorded for the
statement's four lines. Truncation is from the right, so **who answers survives
and the weight gives**, which is the right priority: the weight is the shorter
question and the popover states it in full one gesture away.

`.address-pop` is unaffected: its containing block is 139px, its `min-width: 240px`
still wins, and UI-130's `expect(card.width).toBe(240)` is green untouched.

#### 3. The reveal, which did not exist and now does

The issue says UI-127 put the whole statement on the line's `title`. It did not
— UI-127 put it on the popover statement's title and on the lane rows. The
line's own `title` was the generic *"Who answers this message…"*, so a truncated
line revealed nothing. `packages/kit/src/time/elapsed.ts` already **asserted**
in prose that `.address-line-text` "truncate[s] with an ellipsis and hold[s] the
whole sentence on a `title`"; that sentence was false and is now true.

The pill's title is the whole statement, then the explanation
(`lineTitle()`). One title and not two: the text fills the pill, the two boxes
differ by 10px of padding, and nested titles do not merge, so a pointer landing
on that padding must not get the explanation where the sentence should be. The
`.address-said` variant — the line with nothing to open — had no title at all
and now carries the sentence alone, because there is no gesture there to explain.

#### 4. The browser spec — five tests in `apps/ui/e2e/address-geometry.spec.ts`

UI-127's five and UI-130's twelve are **unmodified** and green: **22 passed.**

Every test holds `GET /api/docs/doc_orchestrate` open (UI-131's technique,
registered after `stubCorpus` so it runs first, `route.fallback()` on release),
lets the `?type=skill` scan through, and measures the **line and the Send
button** in one `page.evaluate` pass, unrounded. Sub-pixel values are kept: a
control that moved half a pixel has moved.

- **the weight clause arriving late** — the reproduction, asserted. Also that
  the words really changed (`ui will answer · Heavy or judgment-laden`), that
  the text is clipped, and that the title carries the whole of it.
- **changing the recipient between a long name and a short one** — the popover
  opened over the line moves nothing, then four picks in turn
  (`th_gone` 45 chars → `orchestrator` → `th_host` 2 chars → `th_gone`), three
  distinct statements, the same two boxes each time. It also pins the slot at
  the declared **139.08px** rather than at whatever this footer settled on, and
  pins that `agent will answer` is **not** clipped while the two weighted lines
  are — clause 3, measured rather than claimed.
- **the floor is the short end** — `◉ ask agent` toggled off, the line drops to
  `Nobody is asked`, nothing moves, and the floor line fits its slot whole.
  `◉ ask agent` and `○ note only` are the same length, so the toggle beside it
  cannot be what held still.
- **the global composer** — the same, with `Capture ⇧⌘↵` and `Ask ⌘↵` both
  asserted. Closed with a second press on the line and never `Escape`: the app's
  escape chain owns that key and closes the whole panel (found the hard way).
- **the comment composer** — the same, with `Comment ⌘↵`. It picks the **short**
  name deliberately: at 294px of foot a 45-character name saturates the old
  content-driven width in both states (measured 164.13px before and after), so
  the long name would have made this test pass against the defect. The short one
  moves it: address 134.38 → 157.09, `send x=708.70 → 714.73`, toggle 55.33 →
  38.64.

Unit tests in `ComposerAddress.test.tsx` pin the half jsdom can see (three new):
the title leads with the whole sentence and then explains the gesture, the floor
says the floor's own explanation there, and the said variant reveals the
sentence alone.

#### 5. Falsification — twice, each with the rebuild

**(a) The content-driven width restored.** `--address-slot`, the `flex` basis
and both `flex: 1 1 auto` lines deleted from `address.css`; `npm run build -w
packages/kit`; the five tests re-run. **All five failed**, with the
reproduction's numbers:

```
weight clause arrives   line  157.69 → 205.06     send x 447.94 → 458.47  w 47.22 → 36.69
recipient changes       line  205.06 → 262.44     send x 458.47 → 471.22  w 36.69 → 23.94  h 34 → 51
the floor               line  205.06 → 124.66     send x 458.47 → 444.58  h 34 → 17
global composer         line  242.64 → 265.28     ask  x 881.72 → 885.55  w 61.28 → 57.45
comment composer        line  134.38 → 157.09     send x 708.70 → 714.73
```

Restored, rebuilt, **5 passed**. UI-127's and UI-130's seventeen stayed green
throughout the mutation — they measure the popover, not the line.

**(b) The reveal removed, and the `dist/` trap on purpose.** The line's `title`
put back to the bare `ADDRESS_OPEN_TITLE` and the spec run **without** rebuilding
kit: it **passed**, exactly as this domain's 2026-08-16 note warns — `apps/ui`
resolves `@corpus/kit` through the package's `exports` map into `dist/`. Rebuilt
and run again: two tests failed with
`Expected substring: "ui will answer · Heavy or judgment-laden" / Received:
"Who answers this message, and how much thought the work gets. Open to change
either."`. Restored, rebuilt, green.

One thing worth writing down for the next reader: **`address.css` is exported
from `src/`, not `dist/`** (`"./address.css": "./src/address/address.css"`), so
Vite serves CSS edits live and only the `.tsx` half needs the rebuild. Both
halves were rebuilt anyway rather than reasoned about.

#### 6. `design/index.html`, and whether the pill reads differently

**The mockup has no address pill at all** — `grep -c "will answer"` is 0, and its
`.composer-foot` is `📎 · ◉ ask agent · thread stays open · Reply ↵`. The pill
arrived with UI-126, in the foot's mono register. So there is no mockup drawing
of this control to diverge from, and the honest report is:

- The pill is now a **fixed 139px box** rather than one that hugs its text, so
  a short line (`Nobody is asked`, 95px) leaves about 14px of space before the
  caret, and the caret sits at the pill's right edge instead of one space after
  the words. That is a visible change and it is stated rather than slipped in.
- It is still the mockup's intent. The mockup's foot is a fixed composition —
  its items are static text and `send` is pushed right by `margin-left: auto` —
  and it already reserves a slot the same way where a run of text varies:
  `.kbd-row .keys { min-width: 92px; flex: none }`. A caret pinned to the right
  edge of a fixed box is also how every other opener in this app reads. What the
  mockup would not tolerate is the alternative: a footer whose send button
  changes width and wraps to three lines because a label arrived.

#### 7. Checks

- `apps/ui/e2e/address-geometry.spec.ts`: **22 passed** (UI-127's 5 and UI-130's
  12, unmodified, plus 5 new).
- Neighbouring pins — `recipient.spec.ts`, `weight.spec.ts`,
  `compose-keyboard.spec.ts`, `resident.spec.ts`, `residents-tab.spec.ts`:
  **46 passed**, the same count UI-127 and UI-130 recorded.
- Scoped unit run (`packages/kit apps/ui/src`): **209 files, 4107 tests passed.**
- `tsc --noEmit`: clean in `packages/kit` and in `apps/ui`.
- ESLint and Prettier clean over every file touched. No rule disabled.
- Three scratch specs were written for the measurements above and deleted. The
  ports 5290 / 8900 were used and are free; Playwright starts and stops its own
  Vite (`reuseExistingServer: false`).

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-137]` prefix


### A test defect this issue shipped, found by CI, 2026-08-20

The spec asserted `width === 22ch` as a pixel constant (`139.08`). That failed
CI twice and never failed locally, and both failures were the test's rather than
the product's.

1. **139.08px is 22ch in this repo's mono on macOS.** CI's Linux resolves the
   same declaration to 131.61px. A constant derived from a font pins the machine
   that measured it.
2. **Measuring `22ch` at runtime was still wrong**, because the assertion itself
   was: `address.css` declares `flex: 0 1 var(--address-slot)`, so **shrink is
   permitted on purpose**. CI's wider footer items shrink the pill below its
   basis legitimately. Equality was never the rule.

The rule is a **ceiling**: content can never push the pill wider than the slot
the layout gave it, and the pill is identical across recipients — which the
`toEqual` sweep above it already proved. The assertion is now
`toBeLessThanOrEqual(slot)`, and it is still load-bearing: replacing the fixed
basis with `flex: 0 1 auto` fails five of the twenty-two specs.

Recorded rather than quietly amended, because "the test only fails on CI" is the
shape that gets a real defect waved through, and here it was the opposite —
twice.
