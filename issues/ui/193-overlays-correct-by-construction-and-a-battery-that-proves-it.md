# [UI-193] Overlays correct by construction, and a battery that proves it

## Domain

ui

## Status

done

## Priority

P0

## Model

fable

## Dependencies

- Depends on: UI-191 (joins its primitive set), INFRA-040 (rides its
  enforcement mechanism)
- Blocks: UI-192 (rebuilds on these primitives)

## Spec References

- SPEC.md **§10**; CLAUDE.md → Verification Is On Demand

## Summary

The second half of the 2026-09-06 report: *"find checks that can catch those
types of things before they land."* The types, from the broken designation
popover: a cramped modal, a scroll region too small to use or notice, no
exit affordance, and duplicated controls.

**What a static check can catch, it catches by construction; what needs a
running browser, a Playwright battery catches; what needs judgment is named
honestly as review territory.** Three tiers:

### 1. Primitives that cannot be built wrong (kit)

- **`Popover` / `Modal`**: always render a close affordance, always handle
  Escape (with focus return), always trap focus while open, always dismiss
  on outside click. These are not props — they are unconditional, so an
  overlay without an exit cannot be expressed.
- **`ScrollArea`**: when content overflows, the affordance is visible
  (indicator + optional "N more" line) and the visible region never drops
  below a stated minimum usable height (a token, recorded — recommendation
  ~120px); a ScrollArea that would render shorter throws in dev and clamps
  in production.
- Enforcement rides INFRA-040's ESLint mechanism: raw
  `role="dialog"`/`position: fixed` overlay implementations outside kit are
  banned the way raw `<select>` is, message naming the primitive.

### 2. The overlay battery (Playwright)

One shared spec helper, run against **every** overlay the product can open
(enumerated in one registry so a new overlay must register or fail a test):

- fits inside the viewport at the default window size, nothing interactive
  clipped;
- close button visible; Escape dismisses; focus returns to the opener;
- every scrollable region inside meets the minimum usable height and shows
  its affordance when overflowing;
- opens over seeded *long* content (9+ lanes, long labels) — the battery
  runs against the crowded case, because the empty case is how these
  shipped.

### 3. Named honestly: what no check catches

**Semantic duplication — two controls meaning the same thing — is not
statically decidable.** The battery cannot know "at" and WEIGHT are one
concept. That class belongs to review: the evaluator's checklist gains one
item ("open every overlay; for each control, name what it edits; two
answers the same is a finding"), and `.claude/agents/evaluator.md` is
amended in this issue. Claiming a lint rule catches this would be the check
lying about its coverage.

## Acceptance Criteria

- [ ] The three primitives exist with the unconditional behaviours above;
      unit + e2e coverage for each guarantee
- [ ] The ESLint extension bans raw overlays outside kit; zero violations,
      zero inline disables
- [ ] The battery runs over the overlay registry; unregistered overlay =
      failing test; the designation popover's pre-UI-192 state would fail
      at least three battery assertions (demonstrated against the old
      component before it is deleted, recorded in the log)
- [ ] The evaluator checklist item lands in `.claude/agents/evaluator.md`
- [ ] The minimum-usable-height token recorded and spent from tokens.css

## E2E Verification Log

**Model**: Fable (claude-fable-5). **Date**: 2026-09-07. All runs against the
real Vite dev server (`CORPUS_UI_PORT=5373`), real Chromium, transport stubbed
in-page by `stubCorpus` per the suite's standing arrangement.

### Lane split, for the record

UI-191 (landed on this base) delivered tier 1 — the `Popover`/`Modal`/
`ScrollArea` primitives, their unit coverage, and `--min-usable-height: 120px`
in `design/index.html:56` and `packages/kit/src/tokens.css:70`. The ESLint
overlay ban rides INFRA-040's rule in that lane (sprint-026 seam 2: syntax is
INFRA-040's). This lane delivered tiers 2 and 3: the registry, the battery,
the crowded fixture, the evaluator checklist item — and fixed what the battery
caught.

### The battery's first contact: 7 failures, 4 of them fixed here

First full run (default 1280×720, ten-lane crowded fixture): **PASS 39 /
FAIL 7**. Every failure was a real finding:

1. `kanban-dialog: Escape dismisses` — `.kanban-dialog` stayed visible after
   Escape. Cause: `useEscapeStack`'s `isEditing` carve-out ignores keys typed
   in a field, and the dialog opens with focus in its first field. **Fixed**:
   the form answers Escape on its own subtree (`KanbanDialog.tsx`), the
   CommentPopover arrangement. Red → green.
2. `query-help: the declared exit affordance works` — clicking the `?` toggle
   again left the panel visible: the panel's capture `mousedown` closed it and
   the toggle's `click` reopened it. **Fixed**: `QueryHelp` takes an `anchor`
   ref and treats presses on its opener as inside. Red → green.
3. `comment-popover: exit` — "no visible exit control": the composer had no
   control that leaves it (Escape and outside-click only). **Fixed**: a ✕
   (`data-comment-cancel`, label "Close this composer" — no "Comment"
   substring, per the file's own locator note) over the grip's right end.
   Red → green.
4. `lane-weight-menu: nothing interactive is clipped` — **UI-191's
   escalation 2, reproduced**: `<button .select-option> "Standard weight…"
   leaves the 1280×720 viewport (top 720, bottom 746)` and `"Heavy…"` at
   746→772. The absolute `.select-menu` extended `.lane-scope`'s scroll
   content inside the 210px drawer instead of overlaying. **Fixed in kit
   `Select`**: the open menu is `position: fixed`, measured from its trigger,
   flipping upward when the room below cannot hold `--min-usable-height`,
   re-measured on scroll/resize. Judgment recorded: fix, not record — the
   defect class (dead options below a clipped edge) is exactly the battery's,
   and the fix lives in the primitive so every squeezed `Select` inherits it.
5.–7. `designation-popover: exit / escape / scroll` — **TEST-1269's proof,
   pinned expected-fail to UI-192**, failure text verbatim:
   - exit: `no visible exit control at [data-address-pop="th_host"]
     [data-address-close]` (element not found — the pre-rebuild popover has no
     close control).
   - escape: `toBeFocused` found no `button[data-address-line="th_host"]` —
     Escape closed the **whole reader** out from under the popover
     (ComposerAddress leaves the key to the app's chain), so the opener itself
     was gone.
   - scroll: `<div .recipient-lanes> overflows at 25px — below
     --min-usable-height (120px)` — the roster the crowded fixture fills is a
     25px sliver.

   Three failures ≥ the required three, demonstrated against the old component
   before UI-192 deletes it. They run under `test.fail()` pinned to UI-192 in
   `overlayRegistry.ts`, so the battery stays this defect's reproduction until
   the rebuild lands — and flips loudly ("passed unexpectedly") the moment it
   does.

### Verification runs (all exit 0)

- Battery after fixes: `PASS 46 / FAIL 0` in 29s — 43 green checks + 3
  UI-192-pinned expected-fails + 2 registry-integrity tests.
- **Falsification of the completeness scan** (TEST-1267): a temporary
  `apps/ui/src/dev/FalsifyOverlay.tsx` with `role="dialog"` and no registry
  entry → the scan failed, exit 1, naming the file: *"These files define an
  overlay … no overlayRegistry.ts entry claims them: —
  apps/ui/src/dev/FalsifyOverlay.tsx"*. Probe removed.
- Falsification of the other three checks: each produced a genuine failure on
  first contact (fits №4, exit №2/№3, escape №1, scroll №6 above) — no check
  in this battery has never failed.
- e2e regression over every touched surface: `format-toolbar`,
  `resident-weight-change`, `residents-tab`, `ask-designation-weight`,
  `weight`, `kanban`, `boards`, `query-editor`, `turn-comment`,
  `comment-move` — **PASS 87 / FAIL 0** in 55s, kit `dist/` rebuilt first
  (the dist trap).
- Unit: kit Controls 37/37; `apps/ui` board+anchors 970/970; console+compose+
  editor 1310/1310; thread+reader 831/831.
- `eslint` and `prettier --check` clean on every changed file; `tsc --noEmit`
  clean in `packages/kit` and `apps/ui`.

### Where things live

- Registry: `apps/ui/e2e/overlayRegistry.ts` — 11 entries (search,
  cheat-sheet, compose, kanban-dialog, query-help, upgrade, image-viewer,
  focus-mode, comment-popover, designation-popover, lane-weight-menu), typed
  exits (`control`/`scrim`/`trigger` — `scrim` only with mockup authority),
  declared scroll regions with affordances, `expectedFailures` pinned by
  issue.
- Battery: `apps/ui/e2e/overlay-battery.spec.ts` — 4 checks × 11 entries + the
  two completeness tests; reads `MIN_USABLE_HEIGHT_PX` from `@corpus/kit`,
  never a literal.
- Crowded fixture: `crowdedLanes()` + `CROWDED_SKILL` + `CROWDED_LEVELS` in
  `apps/ui/e2e/stubCorpus.ts` (seam 3 — UI-192's roster test imports the same
  fixture).
- Evaluator item: `.claude/agents/evaluator.md`, Step 4 — "The overlay sweep":
  open every overlay; for each control, name what it edits; two answers the
  same is a finding.

## E2E Verification Log — second pass: the battery gap phase-60 exposed

**Model**: Fable 5 (`claude-fable-5`). **Date**: 2026-09-07.

The phase-60 evaluation's FAIL-1 went through this battery green: the
designation popover was registered and judged in its designating state only,
and the "no owner" state — a different host, the tightest clip in the
product, and the surface's only weight editor — had never been opened by any
check. Four repairs, all verified against the real Vite dev server in real
Chromium (`CORPUS_UI_PORT=5573`):

1. **States are a forced declaration.** `OverlayEntry` gains a required
   `furtherStates` field: `[]` is the author's written assertion that one
   opener shows everything the surface can offer, and a state may override
   `surface`/`exit`/`opener`/`scrollRegions` beside its own `open`. The
   battery runs all four checks per state — 51 tests now (46 before): the
   `designation-popover [no-owner]` state adds four, its weight-editor probe
   one. Honesty recorded in the registry header: the completeness scan
   forces every overlay definition *site* to be claimed, but it cannot
   enumerate runtime states — no static scan of a `.tsx` can — so the state
   list is a forced declaration whose completeness belongs to review.
2. **The evaluator's probe is now a battery test.** Wheel over the card
   moves it, `elementFromPoint` at each weight-row centre answers the row, a
   real click chooses a level. It is not a never-failed check: it went red
   twice against real intermediate defects during the UI-192 fix (rows
   painted over by lane rows; the cap contract broken) — both recorded with
   failure text in UI-192's log.
3. **The fits exemption is earned, not declared.** An element inside a
   declared scroll region is exempt from the hit-test only while that
   region's `overflow-y` is `auto`/`scroll`. A surface that regresses to
   the FAIL-1 layout — clipped, nothing scrollable — loses the cover the
   declaration was written for and goes red.
4. **The mockup carries the four missing specimens** (the evaluation's
   finding 1b, sprint-026 Done Criteria): `design/index.html#primitives` now
   draws IconButton (rest/hover/on/disabled/focus, in the format toolbar's
   dress it really wears), Popover (the ✕ and the unconditional exits named),
   Modal (scrim + panel + ✕), and ScrollArea (overflowing at the token with
   the affordance border, and short content at its own height) — and the
   stylesheet gains the `.kit-popover`/`.kit-modal-*` values `controls.css`
   claims to transcribe, which until now had no mockup source. Rendered and
   inspected via Playwright screenshot, light theme.

**Finding 1a checked, no fix owed**: the console's act buttons are kit
`Button`s (`LaneRelease.tsx` imports from `@corpus/kit`) and the format
toolbar's icons are kit `IconButton`s — both the documented `bare` contract,
which deliberately contributes no class so the surface's mockup CSS draws
them. `className === ""` in the rendered DOM is that contract working, not a
census gap; DOM-level demonstrability of "every control is a kit primitive"
remains review-by-source, as `Button.tsx`'s own comment records.
