# [UI-192] The designation popover is broken four ways

## Domain

ui

## Status

done

## Priority

P0

## Model

fable

## Dependencies

- Depends on: UI-191 (the Select/Chip primitives this rebuild uses),
  UI-193 (the overlay primitives — Popover/ScrollArea — this rebuilds on)
- Related: UI-185/SHARED-011 (the designation controls this popover carries)

## Spec References

- SPEC.md **§6** — the composer chooses who owns the conversation; **§10**

## Summary

User report, 2026-09-06, two screenshots of the Ask composer's
"agent will answer" popover (`packages/kit/src/address/ComposerAddress.tsx`,
opened from `apps/ui/src/compose/ComposeOverlay.tsx`): *"this whole modal
looks broken."* Four defects, each independently real:

1. **The scroll region is unusable.** "4 lanes · scroll for the rest" sits in
   a region so short it is nearly impossible to scroll — or to see that it
   scrolls at all. The file's own comments document the fight (a "nine-lane
   roster behind a scrollbar with 502px of window") and lost it.
2. **No exit affordance.** No close button, and the file states "Escape is
   deliberately not handled" (line 66) — the user has to *guess* that
   clicking outside dismisses. Whatever argument earned that deliberate
   choice, the outcome is a modal the user cannot see how to leave, and the
   choice is reversed.
3. **The popover duplicates its parent's controls.** It carries a WEIGHT
   picker while the composer row beside it carries the "at" dropdown asking
   the same thing — and the same for the owner agent. Two controls, one
   meaning, adjacent.
4. **The help text documents the confusion instead of fixing it.** The
   trigger's tooltip reads "…the resident being designated takes its own
   level from the owner control, not from here. Open to change either." A
   tooltip that has to disambiguate two same-meaning controls is the defect
   stating itself.

## What to build

Redesign, not patch:

- **One control per meaning.** Decide the single home for weight and for
  owner — recommendation: the composer row's controls (UI-191's pill
  dropdowns) are the single source, and the popover shrinks to the one thing
  the row cannot do: choosing the recipient lane from the roster. If the
  popover keeps a summary of weight/owner, it is read-only text linking
  focus to the row control, never a second editor. Record the decision and
  the rejected direction.
- **The roster gets room.** Size the popover to its content up to a sane
  viewport fraction; the scroll region, where one is still needed, meets
  UI-193's minimum-usable-height rule and shows its affordance (the "N more"
  line stays, the invisible scrollbar does not).
- **A visible close button, and Escape closes.** Focus returns to the
  trigger. Click-outside stays as a *third* path, not the only one.
- The tooltip is rewritten to describe one control doing one thing — if it
  still needs a disambiguating clause, the redesign is not done.

## Decision record (2026-09-07, implementing agent)

**One editor per meaning, per state — and every state has exactly one.**

- **Owner**: the composer row's owner `Select` is the only owner editor. The
  popover's roster stays — it answers the one question the row cannot
  ("who does this *message* route to"), which is the issue's own
  recommendation — and the popover never edits or restates the owner.
- **Weight, while the Ask designates** (owner ≠ "no owner" — the default):
  the row's "at" `Select` is the only weight editor. The popover offers no
  level rows and the request carries **no** top-level weight: nothing offered,
  nothing sent (§10's own rule, already applied to resident recipients). The
  boundary sentence (`designationWeightSentence`) and the reconciling tooltip
  (`ADDRESS_DESIGNATING_TITLE`) are deleted with the second editor they
  apologised for.
- **Weight, with "no owner" picked**: the "at" pill leaves (pinned behaviour,
  TEST-1235) and the popover's level rows return as the surface's only weight
  editor — for Ask and for Capture, exactly as on every thread composer.
- **No read-only summary inside the popover** (TEST-1272 passes vacuously):
  the row controls sit beside the trigger in the same settings row, so a
  summary would restate the visible screen to itself.

**Rejected directions, recorded:**

1. *The shipped UI-185 pairing* — level rows live while designating, with a
   boundary sentence and a disambiguating tooltip. Rejected: it is the
   reported defect (two adjacent editors offering the same three levels).
2. *Roster-only popover in every state, "at" as the sole weight always* (the
   issue's recommendation read strictly). Rejected: under "no owner" the "at"
   pill would have to survive without a designation to weigh — reversing
   TEST-1235's pinned behaviour, outside this issue's scope — or no-owner Asks
   and Captures would lose §10's "every composer can choose how much thought
   the work gets".
3. *A third row pill for the message weight.* Rejected: it re-creates the
   adjacency ("at" and "weight" pills side by side) — the defect in new
   clothes.

**Known narrowing, escalated to the orchestrator**: in the default
(designating) state Capture has no weight control — the popover rows are its
editor and they return only under "no owner". §10's weight sentence names
"the global composer's Ask and its Capture"; the pre-UI-192 surface satisfied
it for Capture in that state at the price of the reported duplication. The Ask
half stays satisfied (the "at" pill *is* the choice of how much thought the
work gets). If a capture-scoped weight affordance is wanted, it is a follow-up
issue, not a reason to restore the duplicate.

## Acceptance Criteria

- [x] One editor per meaning across composer row + popover — asserted by an
      e2e that changes weight in the single place and finds no second editor
      (`ask-designation-weight.spec.ts`, `ComposeOverlay.test.tsx`)
- [x] Close button present, Escape closes, focus returns — e2e (the battery's
      designation-popover exit/escape checks; kit `ComposerAddress.test.tsx`)
- [x] The roster shows ≥ the UI-193 minimum of usable scroll height with 9
      lanes seeded, and its overflow affordance is visible — e2e (the battery
      scroll check over `crowdedLanes()`; `address-room-geometry.spec.ts`)
- [x] The trigger tooltip contains no cross-control disambiguation
      (`ADDRESS_DESIGNATING_TITLE` deleted; `ADDRESS_RECIPIENT_TITLE` names
      one control doing one thing, pinned in kit and overlay tests)
- [x] Full e2e suite green (see the E2E log's final run)

## E2E Verification Log

**Model**: Fable 5 (`claude-fable-5`), per the issue's recommendation.

### Reproduction (pre-fix)

The reproduction is UI-193's battery, run 2026-09-07 against the pre-rebuild
popover: three `expectedFailures` pinned in `overlayRegistry.ts` with recorded
failure text — no close control (`no visible exit control`), Escape closing
the whole reader out from under the card (`toBeFocused found no
button[data-address-line="th_host"]`), and the roster sliver
(`.recipient-lanes overflows at 25px — below --min-usable-height (120px)`).

### What was verified, in a real browser (Vite dev server, Chromium, 1280×720)

- **The battery over the crowded fixture** (`CORPUS_UI_PORT=5473`,
  `overlay-battery.spec.ts`): **46/46 PASS**, `expectedFailures` block
  removed — TEST-1269's three pins flipped to ordinary passes. The
  designation-popover entry's exit is the kit `Popover`'s ✕
  (`.kit-popover-close`), Escape dismisses with focus returned to the line,
  nothing interactive is clipped, and `.recipient-lanes` overflows at ≥ the
  `--min-usable-height` token with the "11 lanes · scroll for the rest" note
  visible.
- **Screenshots** (scratchpad, `ui192-popover-crowded.png`,
  `ui192-popover-card.png`, `ui192-compose-designating.png`,
  `ui192-compose-popover-open.png`): the card over ten long-named lanes shows
  a ~120px roster (three full lane rows visible, honest scroll cut), the cap
  note, the ✕ in the top-right corner, the statement line, and — on the
  thread composer, its legitimate home — the weight rows. The Ask composer's
  settings row reads `agent will answer ▾ · owner [its own agent ▾] · at
  [the launcher decides ▾]`, and its popover opens to the roster alone: no
  weight rows, no boundary sentence, no second owner editor.
- **The four address specs + neighbours**: `address-geometry` (24),
  `address-room-geometry`, `ask-designation-weight`, `recipient`, plus
  `weight`, `resident`, `composer-press`, `foot-geometry` — **123/123 PASS**
  in one run.
- **Unit**: all `packages/kit` + `apps/ui` suites — 257 files, 5214 tests,
  green (plus the rewritten suites after; see below). Lint, Prettier,
  `tsc --noEmit` across every workspace: clean. Kit `dist/` rebuilt before
  every e2e run (the falsification trap).

### Two primitive defects the rebuild flushed out (fixed in kit)

1. **`Popover` returned focus to its opener the instant it opened**, dev
   builds only: StrictMode replays a newly mounted component's effects, and
   the mount-effect *cleanup* ran the focus-return with the surface still in
   the document. Cleanup now returns focus only once the surface is actually
   disconnected, and the opener is recorded once (a replay re-read would have
   captured the row the consumer had just focused).
2. **`ScrollArea`'s overflow border ate a pixel of the guarantee**: with the
   app's `box-sizing: border-box`, an overflowing region measured 119px of
   `clientHeight` against the 120px token. Overflowing regions now clamp at
   `calc(--min-usable-height + 1px)` — the border pays for itself.

Also added to `Popover`: rest-prop pass-through (spread *before* the
guaranteed contract, so no caller can overwrite it) and an `anchor` prop — the
outside-press dismissal ignores the control that toggles the popover, the
`Select`-trigger precedent, because otherwise the dismissal and the toggle
race on one mousedown/click pair (observed: the line could not close its own
card in Chromium while it could in jsdom).

### The P7 renegotiation — every deleted assertion, with its reason

**`ask-designation-weight.spec.ts`**

- Deleted test *"keeps the two weights apart on the wire, and says which is
  which first"* — it pinned the rejected design end to end. Specifically:
  - `pop.locator("[data-designation-boundary]")` text — the boundary sentence
    is deleted with the second editor it qualified;
  - `body.weight === "light"` beside `resident: {weight: "heavy"}` — a
    designating Ask offers no message weight, so §10 forbids it sending one.
  - Replaced by *"offers no second weight editor while designating, and the
    choice stays put"* (TEST-1271's wire half: a standing choice made in the
    no-owner state does **not** ride a designating Ask; the designation's
    level arrives intact inside `resident`) and *"states the message weight
    from the address when no owner stands"* (the surviving claim, at the
    single editor's new home).

**`address-geometry.spec.ts`**

- *"the card clears the reader's head"*: deleted the floor branch
  `list.client <= row + 1` — it asserted the **one-row floor**, which is the
  25px sliver written down as a test. Replaced by
  `list.client >= MIN_USABLE_HEIGHT_PX - 1`: the card exceeds its room only
  while holding a usable list.
- *"tabbing through the lanes"*: migrated — the first Tab from the line now
  reaches the ✕ (asserted), the rows follow; the arrow-free keyboard path and
  the never-under-the-head assertions are unchanged.
- *"the global composer's line has the same slot"*: the close gesture changed
  from a second press on the line to **Escape** — the old comment's reason
  ("the app's escape chain would close the whole panel") expired with the
  rebuild, and in the cramped compose panel the usable-minimum floor makes
  the card cover its own line (✕, Escape and an outside press are the exits).
  Gained assertions: the popover closes and the compose panel survives the
  key (the stopPropagation guarantee).

**`address-room-geometry.spec.ts`** — zero deletions. All fifteen geometry
claims (room-derived width and height, read-not-scrolled, the reserve rules,
content-independence) pinned real guarantees and pass against the rebuilt
card unmodified. One test extended: *"a roster that outruns even the room
says so"* now also asserts the scrolling region is at least the token.

**`recipient.spec.ts`** — untouched, green.

**`weight.spec.ts`** — *"is offered by the global composer, live, with
nothing preselected"*: fixture moved to the no-owner state (assertions kept
verbatim), because that is now the state in which the address is this
surface's weight editor; the designating state's wire is
`ask-designation-weight.spec.ts`'s.

**`overlayRegistry.ts` / `overlay-battery.spec.ts`** — the three
`expectedFailures` pins removed (they now pass as ordinary checks); the exit
selector updated from the declared-owed `[data-address-close]` to the
control the kit primitive actually renders (`.kit-popover-close`).

**Unit suites** (same renegotiation, jsdom): kit `ComposerAddress.test.tsx`
designating describe rewritten (no rows, no boundary, no reconciling title) +
a new exits describe (✕, Escape with focus return and stopPropagation, the
`data-kit-menu` contract) + the anchor-toggle press-sequence pin; kit
`addressModel.test.ts` designating describe rewritten (unweighed, nothing
sent); `ComposeOverlay.test.tsx` "two weights together" test replaced by the
two one-editor tests; `everyComposer.test.tsx` compose probes moved to the
no-owner state with a new designating describe so the enumeration cannot
forget the default; `startingPoint.test.tsx` compose-liveness test likewise;
kit `index.test.ts` export census (deleted `designationWeightSentence`,
`ADDRESS_DESIGNATING_TITLE`; added `ADDRESS_RECIPIENT_TITLE`,
`ADDRESS_POP_LABEL`).

### Full suite

- `CORPUS_UI_PORT=5473 npm run e2e` — full Playwright suite, 2026-09-07:
  **741 passed, 0 failed (8.0m)**, kit `dist/` rebuilt first.
- One earlier full run had a single failure outside this issue's surface:
  `list-blocks.spec.ts › an empty sublist opened with Enter then Tab does not
  underline the text above it` — an **intermittent** editor/serializer
  failure (its received body showed blank lines degraded to trailing-space
  joins document-wide, and the whole list nested under an empty first item).
  It then passed 9 consecutive isolated runs on this exact tree and passed in
  the final full run. Not caused by this change (no UI-192 code loads on that
  page; a one-sample kit-swap comparison that first suggested otherwise did
  not reproduce). Flagged to the orchestrator as a suspected TipTap-3-era
  flake worth its own issue — the failure text above is the reproduction to
  file it with.

## E2E Verification Log — second pass: the phase-60 evaluation's FAIL-1

**Model**: Fable 5 (`claude-fable-5`). **Date**: 2026-09-07.

### The defect (reproduced by the evaluator, geometry taken from its log)

Composer → owner "no owner — the main agent" → open the popover: the card
laid out 229px inside `.search-panel.compose-panel` (a fixed ~192px
`overflow: hidden` box); the WEIGHT rows — this state's **only** weight
editor by this issue's own decision record — painted at y 291–312 past the
clip at y 280, hit-tested to the scrim, and a real click at their coordinates
dismissed the popover instead of choosing. Identical at 1280×720, 1440×900
and 1600×1000, and identical with 3 lanes and no roster overflow, because
the `ScrollArea` clamped the roster at the 120px token even when its content
needed less — the token was spent as a tax, not a guarantee.

### The fix — reachability, in kit, two mechanisms

1. **`ScrollArea`'s floor is `min(content, token)`, measured.** The
   component collapses its floor, reads the content's own height, and writes
   the floor as an inline `min-height` (a *layout* effect, so a consumer's
   own layout effect — React runs children's first — reads settled geometry,
   never the CSS token fallback). Content shorter than the token takes its
   own height and no more; the token still guarantees an overflowing region
   (plus the affordance border's pixel). `ScrollAreaTooShortError` stays
   meaningful: it fires only below the *measured* floor and names both
   heights ("rendered 80px tall against 300px of content").
2. **The fit measures the room's floor as well as its ceiling.** `roomFor`
   returns the clipping ancestor's bottom (clamped by the viewport);
   the card's height is capped at the clip's whole height less the margins
   (`available`), and the statement's line budget is capped by it too. Where
   even the floored parts outrun the whole clip, the fit sets
   `data-address-pop-scrolls` and the card scrolls **as one piece** — in that
   state the roster caps at the token (it still scrolls internally and still
   says "N lanes · scroll for the rest") and `.address-recipient` floors at
   `min-content`, so no section can paint over another. A card that fits
   keeps `overflow: visible` and byte-identical geometry.

### Verified in real Chromium (Vite dev server, `CORPUS_UI_PORT=5573`, kit `dist/` rebuilt before every run)

- **The battery**: 51/51, including the new `designation-popover [no-owner]`
  state (all four checks in the 192px panel over the crowded fixture) and
  the dedicated weight-editor probe — a real wheel moves the card
  (`scrollTop > 0`), `elementFromPoint` at each of the three row centres
  answers the row, and a real `page.mouse.click` on the heavy row chooses
  (`aria-pressed="true"`, popover still open).
- **The address specs**: `address-geometry` + `address-room-geometry` +
  `ask-designation-weight` + `recipient` + `weight` + the battery in one
  run — **112/112 PASS** (1.2m). All fifteen room-geometry claims hold
  against the capped card unmodified.
- **The probe caught two intermediate defects before the final shape** —
  evidence it can fail: (a) with the section's resting `min-height: 0`, the
  flex column shrank the section's box and its lane rows painted over the
  weight rows (probe red: `weight row 0 hit-tests to <button
  .recipient-opt>`); (b) letting the roster lay out whole inside the
  scrolling card broke the cap contract (`address-room-geometry`'s "a taller
  window shows more of the same roster" and "a roster that outruns even the
  room says so" both red, list at 275px unscrolled). The shipped shape —
  roster capped at the token, section floored at `min-content` — holds all
  three suites at once.
- **The 3-lane acceptance** rides `weight.spec.ts` "is offered by the global
  composer, live, with nothing preselected": small fixture, no-owner state,
  a real click on the `light` row in the compose panel, the wire asserts
  `weight: "light"`. Green — with the new floor the 3-lane card fits the
  panel whole, no scroll.
- **Unit**: kit + `apps/ui` compose suites 1192/1192; new `ScrollArea` floor
  tests falsified by mutation (`floor = token + 1` sent the short-content
  test red, restore sent it green). `eslint`, `prettier --check`,
  `tsc --noEmit` clean in `packages/kit` and `apps/ui`.
- **Not run**: a `corpus init` workspace server (the evaluator's 8791 rig).
  The prescribed verification for this pass was the battery + the address
  specs against the suite's standing Vite + Chromium arrangement; the panel
  geometry the defect lives in is the same markup in both.

---

## Follow-up fix: OBS-A and OBS-B of the phase-60 re-check (2026-09-07)

**Model**: Opus 5 (`claude-opus-5[1m]`).

The re-check (`issues/evals/sprint-026-phase-60-eval.md`) recorded two items
against the scrolling repair above. Neither failed a stated criterion, and
both are paid here — CSS-level, in the kit address popover only, with no
change to the fit's arithmetic or to any measured bound.

### OBS-A — the card gives no visual cue that it scrolls

Recorded: *"`mask-image: none`, `::before` and `::after` `content: none`, no
gradient at the cut … The only scroll wording on the surface is `"14 lanes ·
scroll for the rest"`, which names the **roster**, not the card."*

**The mechanism.** `ComposerAddress.tsx` now writes a second marker beside
`data-address-pop-scrolls`: `data-address-pop-more`, set from `scrollTop`
on the card's own `scroll` event and at the end of every fit. `address.css`
hangs a bottom fade on the pair —

```css
.composer-address .address-pop[data-address-pop-scrolls="true"][data-address-pop-more="true"] {
  mask-image: linear-gradient(to bottom, #000 calc(100% - 22px), transparent 100%);
}
```

A mask rather than an overlay element, because the card **is** the scroll
container: a mask is painted in the element's border box and does not move
with the content, so one declaration fades whatever is at the edge and no
new child enters the flex column the fit measures. The ramp is the mockup's
own language for a cut edge (`markdown.css`'s collapsed fence paints the
same transparent-to-surface gradient). 22px is shorter than a lane row, so
it never hides a whole one.

The fade is present **exactly** while content remains below, and gone at the
bottom, where the last line really is the last line.

### OBS-B — the visible ✕ scrolls out of the clip

Recorded: *"With the card scrolled to its bottom the close button sits at
y 49–67, above the panel's top edge at 86, clipped and not hit-testable."*

**The cause.** `.kit-popover-close` is absolutely positioned, and inside a
scroll container its containing block is the padding box — whose origin is
the top of the *scrolled content*, not the top of the visible card. Every
pixel of scroll carried it up past the clip.

**The mechanism.** The same tracker writes `--address-pop-scroll` (the card's
`scrollTop`), and the stylesheet translates the button back down by exactly
it, in the scrolling state only:

```css
.composer-address .address-pop[data-address-pop-scrolls="true"] > .kit-popover-close {
  transform: translateY(var(--address-pop-scroll, 0px));
  background: var(--surface);
}
```

A transform rather than a `top`, so a scroll re-lays out nothing and the
button's hit rectangle follows it. Sticky was rejected: the ✕ is out of flow
and putting it back would cost the card a row of height the fit has spent.
The opaque background is new and scoped to this state — content now scrolls
beneath the button.

Neither the fade nor the pin fires at rest: a card that fits keeps
`overflow: visible`, `mask-image: none` and an untranslated ✕.

### The two assertions (`apps/ui/e2e/overlay-battery.spec.ts`)

A new describe over the `designation-popover [no-owner]` state, beside the
weight-editor probe — the state where the crowded card really scrolls:

1. **"the bottom fade is present exactly while content remains below"** —
   asserts the card overflows at all, reads the computed mask at scroll 0
   (must be a `linear-gradient`), wheels to the card's own bottom (must be
   `none`), then scrolls back up (must return). The third step is what stops
   a one-way flag passing.
2. **"the ✕ is hit-testable at the bottom of the scroll"** — wheels to the
   bottom, then checks the button's rect against its clip's top edge, that
   `elementFromPoint` at its centre answers the button, and that a real
   `page.mouse.click` at those coordinates dismisses the card. The battery's
   standing exit check presses the ✕ at scroll 0, which is the one offset
   where OBS-B is invisible — so it stays meaningful and this adds the offset
   it never reached.

### E2E verification (real Chromium, Vite dev server, `CORPUS_UI_PORT=5673`, kit `dist/` rebuilt first)

**Measured in the running app**, crowded fixture, no-owner state, 1280×720
(`.search-panel` clip top = 86, card `scrollHeight` 281 / `clientHeight` 180):

| offset            | `data-address-pop-more` | computed `mask-image`                    | ✕ rect (top/bottom) |
| ----------------- | ----------------------- | ---------------------------------------- | ------------------- |
| `scrollTop` 0     | `true`                  | `linear-gradient(rgb(0,0,0) calc(100% - 22px), rgba(0,0,0,0) 100%)` | 97 / 115 |
| `scrollTop` 101   | `false`                 | `none`                                   | 97 / 115            |

The ✕ does not move: 11px inside the clip at both ends. Screenshots in the
scratchpad (`obs-top.png`, `obs-bottom.png`) show the faded cut over the
statement line at the top, and the three WEIGHT rows crisp to the edge with
the ✕ still in the corner at the bottom.

**Both assertions falsified by mutation** (each reverted in source, kit
`dist/` rebuilt, spec re-run — the dist trap):

- `mask-image: none` in place of the gradient → *"the card is cut and
  announces nothing (OBS-A) … Expected substring: `linear-gradient`,
  Received: `none`"*.
- The fade made permanent (`data-address-pop-more` dropped from the
  selector) → red at the bottom: *"the fade survives the bottom of the
  scroll … Received: `linear-gradient(...)`"*. So the assertion bites in
  both directions.
- `transform: none` in place of the pin → *"at the bottom of the scroll, the
  ✕ is at y -4, above its clip's top edge 86 (OBS-B)"* — the re-check's own
  measurement class, reproduced.

**Runs (all green):**

- `overlay-battery` + `address-geometry` + `address-room-geometry` +
  `ask-designation-weight` + `recipient` in one run — **106/106 PASS**
  (73s). The battery alone is 53 (51 before, plus the two added here).
- `packages/kit` unit suites — **1126/1126 PASS**.
- `eslint` on the two touched TypeScript files, `prettier --check` on all
  three touched files, `tsc --noEmit` in `packages/kit` and `apps/ui` —
  clean.

---

## Follow-up: PR #77's review, finding 2 — the Capture narrowing closed, and a citation corrected

**Model**: Fable 5 (`claude-fable-5`). **Date**: 2026-09-07.

### The decision (resolves UI-196, which the Known narrowing above filed)

The review declined the waiver and asked for the design's completion, and the
completion is this issue's own principle extended: **one editor, its meaning
set by what the surface sends.** While a designation stands, the composer
row's "at" `Select` is the surface's one weight editor — and a Capture, which
designates nothing (CONTRACT-088: `POST /api/capture` carries no `resident`),
now rides that same choice as **the capture's own top-level `weight`**. The
wire half already existed: `CaptureRequestSchema` has carried
`weight: requestedWeightField` since the §10 rider's plumbing, and
`useCompose`'s capture branch already spreads `input.weight` — so the whole
change is `ComposeOverlay.tsx` choosing the field per submit
(`captureWeight`), plus the honest tooltip. No contract or server change; no
second editor anywhere (the one-editor e2e still passes untouched).

- Ask, designating: the choice rides inside `resident` (unchanged).
- Capture, designating: the same choice rides as the capture's `weight` (new).
- Either submit, no owner: the address's rows ride the top-level `weight`
  (unchanged).
- "The launcher decides", anywhere: nothing is sent (unchanged).

Rejected: a capture-scoped second control (the duplication again, aimed at
the other submit), and a rider narrowing §10's "its Capture" (the review's
instruction was to complete the design, and completing it cost one
conditional).

Verified: `ComposeOverlay.test.tsx` — the "leaves Capture exactly as it was"
pin, which asserted the dropped choice, rewritten to assert the ride, plus a
launcher-decides absence pin (55/55; the ride falsified by mutation — reverting
the submit's field choice sent it red). E2E `ask-designation-weight.spec.ts`
grew "the weight a Capture states (UI-196)": the multipart `weight` part is
`"heavy"` after picking the at pill, absent when left alone, and `"light"`
from the address in the no-owner state — **12/12 PASS** in real Chromium
(`CORPUS_UI_PORT=5773`).

### The citation, corrected

This issue's record and its tests cited *"a value the surface no longer shows
must not act"* with a bare “(§10)”, as though quoting spec. It is an
**inference** from §10's resident-recipient rider (the composer *"names that
resident's designation-time weight instead of offering a choice it would
discard"* — nothing offered, nothing sent), not spec text. Reworded wherever
it wore quotation's clothes: `ComposeOverlay.tsx` (the `designationRequest`
contract note and the at-pill comment) and `ask-designation-weight.spec.ts`
(two comments). Test titles that state the maxim without a citation were left
— a maxim is not a quote.
