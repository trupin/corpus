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
