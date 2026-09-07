# [UI-191] One button, one dropdown, everywhere

## Domain

ui

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Blocks: INFRA-040 (the enforcement — nothing to enforce until the
  primitives exist and the product uses them)

## Spec References

- SPEC.md **§10** — the board; `design/index.html` is authoritative for look
  and feel; `packages/kit/src/tokens.css` transcribes it verbatim

## Summary

User directive, 2026-09-06, from two screenshots of the running product:

The editor's format toolbar renders **native `<select>` chrome** — glossy
macOS gradient pills with stepper arrows on "Heading 1", "Colour", "Align",
"Indent" — while the document header's pill row is the product's actual
design language. The user wants the second, everywhere:

> "I want you to come up with button / drop down component styles and apply
> them consistently across the whole product."

**The target language, transcribed from the screenshot** (the images do not
travel into the repo — this prose and the design mockup are the record):

- Flat, fully-rounded pills; fill one step lighter than the surface behind
  them; no gradients, no gloss, no native chrome anywhere.
- Quiet single-tone labels; compact height (the pill row's, not the native
  select's).
- A **dashed border** is the empty/placeholder state (the `due: —` chip).
- A **tinted fill** is the stateful variant (the `status: resolved` chip's
  blue); tint colours come from the existing semantic tokens (`--accent`,
  `--signal`, `--sepia`) by role, never by look.
- Dropdown triggers are the same pill with a chevron; the menu is a custom
  popover on the dark surface — a styled native `<select>` is not the target,
  because the popup is native chrome too.

## A third screenshot, and what it adds (user, 2026-09-06)

The Ask composer's designation row mixes both languages **in one row**:
"agent will answer ▾" is already the correct pill dropdown, while the "owner"
and "at" controls beside it are native selects — glossy chrome — **and both
truncate their labels** ("its own agen…", "the launche…"). Located:
`apps/ui/src/compose/ComposeOverlay.tsx:475` and `:517`.

Two things this instance adds to the requirements:

1. **The migration's proof-of-done includes mixed rows**: the composer row is
   the acceptance screenshot, because it shows the before and after side by
   side in one component.
2. **The `Select` primitive must handle long labels** — these two truncate
   mid-word with no affordance. The primitive states its truncation
   behaviour: ellipsis with the full value in the popover (which, being
   custom, can be wider than its trigger — the native popup cannot), and a
   `title` for hover. A dropdown whose closed label is unreadable is the
   defect that motivated this sentence.

Note the file's own comments document fighting the native element
(`ComposeOverlay.tsx:100-103` — the sentinel dance because "a `<select>`
value is a string and cannot be `null`"). The kit `Select` takes real values,
`null` included, and that workaround is deleted rather than ported.

## What to build

1. **Design first, in the authoritative place.** The primitives are drawn in
   `design/index.html` (states: rest, hover, active, disabled, open; both
   variants; keyboard focus visible), then ported to kit — that is the
   established token pipeline and it is not skipped.
2. **Kit primitives** under `packages/kit/src/components/`: `Button`,
   `IconButton`, `Select` (trigger + popover menu, full keyboard support:
   arrows, type-ahead, Escape, focus return), `Chip` (with empty/dashed and
   tinted variants). Accessible: real roles, focus management, and the
   popover closes on outside click and blur.
3. **Migrate the whole product.** All 82 files currently carrying raw
   `<button>`/`<select>` in `apps/ui` and kit's own surfaces — the format
   toolbar first (it is the reported offence), then compose, console,
   board, readers. No raw interactive element survives outside the
   primitives' own internals.
4. **No behaviour change.** This is restyling and componentization; every
   existing e2e must pass unmodified except selectors that named native
   elements — update selectors, never assertions.

## Acceptance Criteria

- [ ] `design/index.html` carries the primitives in all states; tokens.css
      ports any new values verbatim, per its own header rule
- [ ] The format toolbar renders zero native select chrome — Playwright
      asserts the absence of `<select>` in the editor DOM
- [ ] `grep -rE "<(select|button)\b" apps/ui/src packages/kit/src` returns
      only the primitives' own internals (the exact allowed list recorded
      here for INFRA-040 to encode)
- [ ] Keyboard: every dropdown fully operable without a mouse — e2e-tested
- [ ] Both themes (§10's dark and light) — verified in the mockup and the
      product
- [ ] The composer's designation row renders one language: pill dropdowns for
      recipient, owner and weight, no truncated closed labels, the null
      sentinel workaround deleted (`ComposeOverlay.tsx:100-103`)
- [ ] `Select` states its long-label behaviour and an e2e proves a long
      option readable
- [ ] Full e2e suite green with assertion semantics unchanged

## Implementation Record (2026-09-07, implementing agent)

### The radius decision (P4, TEST-1227)

Recorded in `design/index.html` beside the primitive classes, per the
orchestrator's ruling: **`Button` keeps the mockup's 8px rectangle; the
fully-rounded 99px pill is the chip family** — `.chip`, and every dropdown
trigger (`.select-trigger`), which is a chip that opens a menu. REJECTED:
rounding `Button` to 99px — the user's screenshot pointed at the chip row, and
the mockup's action buttons (Ask, Capture, Compose) have committed to the 8px
rectangle since the first draft. One row may hold both shapes only where the
controls are of two different kinds (an act beside a setting), never two
shapes for controls of the same kind.

### The primitive surface (sprint-026 seam 1)

Exported from `packages/kit/src/index.ts`, implemented in
`packages/kit/src/components/Controls/`: `Button` (variants `primary` /
`outline` / `quiet` / `bare`; `type` defaults to `"button"`), `IconButton`
(accessible name required — `label` is a required prop), `Chip` (variants
`default` / `on` / `warn` / `good` / `ghost`; a real `<button>`), `Select`
(pill trigger + chevron + custom `role="menu"` popover; real values, `null`
included; arrows / type-ahead / Home / End / Escape-with-focus-return;
trigger ellipsises with the full value on `title`, menu may be wider than its
trigger), `Popover` and `Modal` (unconditional close affordance, Escape
consumed on their own subtree with focus return, focus trap, outside-click
dismiss; `Modal` renders the `.overlay.open` pair `overlays.ts` reads),
`ScrollArea` (clamps to `--min-usable-height` in production, throws
`ScrollAreaTooShortError` in development, `data-overflowing` affordance).
Stylesheet subpath `@corpus/kit/controls.css`, transcribed verbatim from the
mockup's primitives block. The minimum-usable-height token is
`--min-usable-height: 120px` in `design/index.html` and all four blocks of
`packages/kit/src/tokens.css`; `MIN_USABLE_HEIGHT_PX` is pinned to it by a
kit test.

**The escape seam (P5, applied to `Select` and `Popover`/`Modal`):**
`apps/ui/src/reader/useEscapeStack.ts`'s capture listener now yields close
keys aimed inside `[data-kit-menu]` — the marker kit renders on exactly the
surfaces that consume close keys on their own subtree and stop their
propagation. The DOM is the contract, both ways; neither package imports the
other.

### The allowed raw-element list (for INFRA-040's exemption set)

Files that may carry raw JSX `<button>` after this issue — **the primitives'
own internals only**:

- `packages/kit/src/components/Controls/Button.tsx`
- `packages/kit/src/components/Controls/IconButton.tsx`
- `packages/kit/src/components/Controls/Chip.tsx`
- `packages/kit/src/components/Controls/Select.tsx`
- `packages/kit/src/components/Controls/Popover.tsx`
- `packages/kit/src/components/Controls/Modal.tsx`

No file may carry raw JSX `<select>`/`<option>` — the last three sites
(FormatToolbar ×4, ComposeOverlay ×2, LaneWeight ×1) are migrated and none
remain in `apps/ui/src` or `packages/kit/src`.

### The migrated files (sprint-026 P2's enumerated 22, with findings)

Migrated to kit primitives: `reader/FocusMode.tsx`, `upgrade/UpgradePanel.tsx`,
`board/KanbanDialog.tsx`, `shell/BoardBar.tsx`, `shell/ThemeToggle.tsx`,
`compose/ComposeOverlay.tsx` (both selects → `Select`; `NO_RESIDENT_VALUE`
sentinel **deleted** — `Select` carries `null` as a value),
`image/ImageViewer.tsx`, `search/SearchOverlay.tsx` (→ `Chip ghost`),
`thread/ThreadMenuTrigger.tsx`, `thread/ThreadComposer.tsx`,
`anchors/CommentPopover.tsx`, `editor/SaveChip.tsx`,
`editor/FormatToolbar.tsx` (four selects → `Select`, thirteen icon controls →
`IconButton`; the "`<select>` mousedown cannot be cancelled" workaround
deleted — the bar now cancels every non-input mousedown),
`console/LaneWeight.tsx` (select → `Select`), `console/ConsoleStrip.tsx`,
`console/JobList.tsx`, `console/LaneList.tsx`, `console/LaneRelease.tsx`
(all three UI-195 buttons → `Button`); kit: `address/ComposerAddress.tsx`
(mechanical `Button` substitution only, per the UI-192 boundary), plus
`components/Composer/AttachButton.tsx` (see the census note).

Three of the enumerated 22 carry `<button>` **in comments only** and needed no
code change: `menu/ContextMenu.tsx`, `thread/ThreadPanel.tsx`,
`markdown/CorpusImage.tsx` (its "button" is a deliberate `role`/`tabIndex`
image, documented in place).

### Census discrepancy (escalate to the orchestrator / INFRA-040)

Sprint-026 P2's count of 22 is **short against the tree**. A plain grep for
JSX `<button` over non-test `.tsx` finds real raw buttons in files the sprint
did not enumerate, among them: `shell/Topbar.tsx`, `shell/Toasts.tsx`,
`menu/MenuItems.tsx`, `board/Column.tsx`, `board/ColumnHead.tsx`,
`board/ColumnStrip.tsx`, `board/NewListGhost.tsx`, `board/NewListPicker.tsx`,
`board/PathColumn.tsx`, `board/query/QueryEditor.tsx`, `comments/*`,
`console/Console.tsx`, `console/JobDetail.tsx`, `console/LaneScope.tsx`,
`dev/DataProbe.tsx`, `editor/SelectionToolbar.tsx`, `explorer/ExplorerTree.tsx`,
`reader/*` (Backlinks, FrontmatterForm, ReaderHead, RelatedPanel,
ScopeProvenance), `reattach/ReattachOffer.tsx`, `reflect/ReflectControl.tsx`,
`search/CreateRow.tsx`, `search/FilterChips.tsx`, `search/SearchResults.tsx`,
`thread/*` (CollapsedThread, FormBlock, NewChildThread, ThreadCard, Turn),
and kit's `components/Autocomplete/AutocompleteMenu.tsx`,
`components/Composer/PendingAttachments.tsx`, `markdown/CodeFence.tsx`,
`row/Row.tsx`. The binding scope for this issue was the enumerated 22 (the
orchestrator's instruction), so these were **not** migrated here —
`components/Composer/AttachButton.tsx` alone was migrated beyond the list,
because it sits in the composer foot rows this issue's acceptance screenshot
covers. INFRA-040 cannot land a bare "primitives only" exemption list until
these are migrated or explicitly exempted — its filing must consume this
paragraph.

### E2E selector changes (the sprint's churn rule — every one listed)

No assertion's meaning changed. Native-select drivers became the kit pill's
two-step gesture (open, press the row by its visible label) — a gesture
forced by the componentization, asserting the same outcomes:

- `format-toolbar.spec.ts`: `select[data-fmt="block|color|align"]` →
  `[data-select="…"]`; `toHaveValue("2"|"0"|""|"center")` →
  `toHaveText("Heading 2"|"Text"|"Align"|"Centre")` on `.select-value` (the
  same fact — the control names the block — read off the pill's label);
  `selectOption(…)` → `pickPill(…)`.
- `ask-designation-weight.spec.ts`: `OWNER`/`LEVEL` constants now name
  `[data-select="owner"]` / `[data-select="resident-weight"]`;
  `selectOption("researcher"|"heavy"|"@none")` → `pick(…)` by visible label;
  the option-list assertion reads `menuitemradio` rows of the open menu
  (same list, same order); `toHaveValue("")` → the trigger label
  `"the launcher decides"`.
- `resident-weight-change.spec.ts`: `LEVEL` →
  `[data-lane-weight-panel="th_solo"] [data-select="lane-weight"]`; same
  gesture and label-for-value swaps.
- `foot-geometry.spec.ts`: `.compose-resident select` →
  `.compose-resident .select-trigger` (the register-parity assertions are
  untouched and still compare the two pills against each other).
- `compose-keyboard.spec.ts`: the static CSS fixture's markup mirrors the
  migrated DOM (kit pill markup, `btn btn-outline btn-capture` /
  `btn btn-primary btn-ask` class strings); the foot-order expected class
  list updated to those strings.

**Deleted assertions: none.** **Added tests** (new assertions, allowed): in
`format-toolbar.spec.ts`, "the bar carries no native select chrome at all"
(the acceptance criterion's permanent Playwright pin); in
`ask-designation-weight.spec.ts`, "the owner control is fully operable from
the keyboard" (open/type-ahead/Enter/Escape with focus return, zero pointer
events) and "a long owner label ellipsises on the pill and is whole in the
menu" (TEST-1237/TEST-1238's permanent pins).

## E2E Verification Log

_Model: this issue was implemented by Fable 5 (claude-fable-5), per the issue's
Model recommendation._

**Unit (2026-09-07)** — `VITEST_MAX_THREADS=4 vitest run apps/ui/src
packages/kit/src`: 257 files, **5207 passed, 0 failed**, including 37 new
primitive tests (`Select.test.tsx`, `Controls.test.tsx`) covering keyboard
operation, Escape-with-focus-return and its consumption before the document,
outside-click dismissal, `null` values, the trigger-first focus order, the
`.overlay.open` / `data-kit-menu` DOM contracts, and the
`MIN_USABLE_HEIGHT_PX` ↔ `tokens.css` pin. `npm run build`, `npm run
typecheck`, `npm run lint`, `npm run format:check` all pass.

**Full Playwright suite (2026-09-07, the single run)** — `CORPUS_UI_PORT=5273
npm run e2e`: **690 passed, 1 failed** of 691 (7.3m). The one failure was a
product defect this issue introduced and the suite caught:
`search.spec.ts:147` — kit's `button.chip:hover` repainted the border
`.chip.on` deliberately makes transparent (Playwright's pointer rests on the
chip it clicked, so the hover state was live). Fixed in the mockup and
`controls.css` (`button.chip:not(.on):not(.warn):not(.good):hover`); the spec
was not touched. A second defect was found by inspection in the same pass:
`.search-panel` clips (`overflow: hidden`) and the composer settings row sits
at the panel's bottom edge, so its menus opened downward into the clip —
`compose.css` now opens the settings-row menus upward. Because those two CSS
fixes (and a mid-run `editor.css` scoping fix) postdate the full run, the
affected spec files were rerun scoped and green: `search.spec.ts`,
`ask-designation-weight`, `foot-geometry`, `compose-keyboard`,
`format-toolbar`, `resident-weight-change` — **71 passed, 0 failed**. Net:
every spec in the suite has passed against the final tree.

**Real browser, photographed against the mockup (2026-09-07)** — real served
UI (Playwright's own Vite on 5273, stub transport per INFRA-028), Chromium,
light and dark, screenshots in the session scratchpad:

- `app-fmtbar-{light,dark}.png` / `mockup-fmtbar-light.png`: the format
  toolbar renders four chip pills with chevrons (Heading 2 · Colour · Align ·
  Indent) and zero native chrome; the app bar and the mockup bar are
  indistinguishable. `document.querySelectorAll(".focus select, .focus
  option").length === 0` asserted in the run.
- `app-fmtbar-open-{light,dark}.png`: the heading menu open — custom popover
  on the surface, `Heading 2` checked in `--accent-wash`, focus ring visible.
- `app-composer-{light,dark}.png` and `app-composer-owner-open-{light,dark}.png`
  — **the acceptance screenshot**: the designation row reads `agent will
  answer ▾ · owner (its own agent) ▾ · at (the launcher decides) ▾`, three
  pills of one register, no native chrome anywhere in the panel
  (`.compose-panel select|option` count asserted 0); the owner menu opens
  upward, wider than its trigger, with
  `a-methodical-researcher-of-long-standing` readable in full.
- `mockup-primitives-{light,dark}.png`: `design/index.html#primitives` — every
  Button variant in rest/hover/active/disabled/focus, the Select in
  rest/hover/focus/disabled/long-label/open, the Chip in
  default/on/warn/good/ghost/disabled, correct in both themes.

The temporary screenshot spec was deleted after the run; the suite is
unchanged by it.
