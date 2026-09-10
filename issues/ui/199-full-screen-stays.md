# [UI-199] Full screen stays

## Domain

ui

## Status

done — 2026-09-09, implemented and harvested, awaiting the gated commit

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Related: the 2026-08-22 navigation-rework decisions, which already ruled
  "full screen stays"

## Spec References

- SPEC.md **§10** — the board and its readers

## Summary

**User report, 2026-09-09: "When I open a document in full screen mode, I
want to stay in full screen mode."** Today, opening a document from within
full screen drops the reader back to the normal layout. The navigation
rework's decision record (2026-08-22) already settled the direction: full
screen is a mode the person leaves deliberately, never a side effect of
navigating.

## What to build

1. Reproduce first: enter full screen on a document, follow a link / open
   another document / use whatever in-app navigation exists, and record
   where the mode drops.
2. Full screen persists across every in-app navigation to another document.
   Leaving is explicit only (the existing exit control / Escape semantics —
   respect the overlay battery's contract for the focus-mode entry).
3. Decide and record whether the mode survives a reload (a mode a person
   set is presumably worth remembering — judge against the app's existing
   per-viewer conveniences and record the call either way).

## Acceptance Criteria

- [x] Pre-fix reproduction logged (which navigations drop the mode)
- [x] Every in-app document-to-document navigation keeps full screen — E2E
      in a real browser
- [x] Exit stays explicit and the battery's focus-mode contract still holds
- [x] The reload decision recorded with its reasoning

## E2E Verification Log

**Model: Fable (claude-fable-5).** All runs: real Chromium via Playwright
against the real Vite-served UI (`CORPUS_UI_PORT=6073`), the repo's E2E
harness (INFRA-028: the suite is the UI domain's real-browser surface).

### Pre-fix reproduction (2026-09-09, before any code change)

Enumerated every navigation reachable from inside full screen with a live
probe (temporary `probe-199.spec.ts`, since deleted) plus the then-current
`paths.spec.ts` rider-3 test:

- **Link click in the focus reader body** (`[data-corpus-ref]`):
  `AFTER LINK: {"focusOpen":0,"loosePath":1}` — the overlay closed and the
  target landed as a loose path. **This is the drop.** The then-green test
  "a link followed inside full screen closes it and lands as a loose path"
  (paths.spec.ts) passed, confirming the shipped behavior. Cause:
  `Board.tsx` passed `onFollow` to `FocusMode` per SPEC §10 rider 3
  ("a link inside full screen … lands as a loose path at the left edge"),
  which called `closeFocus()` before landing.
- **Search overlay over full screen** (⌘K): opens above focus (z 40 over
  35). `↵` on a hit: `{"focusOpen":1,"focusDoc":"Rate table","gammaPath":1}`
  — the mode persisted, the pick landed as a loose path behind the overlay.
  No drop (but see Flags below).
- **Board-scope `↵` on the row cursor while focus is up**: opened a path
  behind the overlay, `focusOpen:1`. No drop (board keys stay live in focus
  by design — `shortcuts.ts` scope doc).
- **Board rows / explorer by pointer**: unreachable — the overlay is a
  full-viewport `aria-modal` fixed layer. These navigations do not exist
  from inside the mode.
- **Browser back**: `about:blank` — the app is a single route, so history
  holds no in-app entry. Leaving the page is not an in-app navigation.
- **In-focus back / ⌫ / esc**: back chevron never appeared pre-fix (the
  stack never gained depth on the board host); esc and ⌫ closed the
  overlay.

Conclusion: exactly one in-app navigation dropped the mode — the followed
link (rider 3's `onFollow`).

### Fix

- `apps/ui/src/reader/FocusMode.tsx`: removed the `onFollow` prop (the
  board was its only passer). `navigate` now always pushes onto the
  overlay's own in-memory stack — the machinery (`useMemoryNavStack`,
  `showsBack`, depth-0 auto-close) already existed and was unit-tested.
- `apps/ui/src/shell/Board.tsx`: stopped passing `onFollow`; recorded the
  reload decision on the `focusDoc` state comment; updated the `closeFocus`
  closer list.
- Comment updates where the dead rule was cited: `board/strip.ts`,
  `board/openInColumn.tsx`, `e2e/paths.spec.ts` header,
  `e2e/focus-exit.spec.ts` header.
- `e2e/paths.spec.ts`: the rider-3 test rewritten to assert the inverse —
  the link stays in full screen and **no** loose path lands.
- New `e2e/focus-stays.spec.ts` (6 tests): link navigates the overlay and
  chains; back walks the excursion (named after the previous document, ✕
  alone at the bottom); search-↵ does not drop the mode; esc closes from
  any depth in one press; ✕ closes from depth; a reload does not restore
  the mode (the recorded decision, held).
- `e2e/overlayRegistry.ts`: the focus-mode entry gained the
  `excursion-depth` further state (back chevron present) — reachable only
  since this fix — opened by following a ref in the crowded fixture
  (`doc_pic` gained a `[[th_host]]` ref for it). Exit control, Escape,
  opener and scroll regions unchanged: the battery's focus-mode contract
  holds as it was.

### Reload decision (criterion 3): the mode does NOT survive a reload

Recorded on `Board.tsx`'s `focusDoc` state and held by a test. Reasoning:
(1) the per-viewer conveniences that survive a reload are all board-shaped
— open readers, paths, widths — while no overlay does (search, compose,
dialogs, menus all reset), and the 2026-08-22 decision record classes full
screen as an overlay; (2) the excursion stack is in-memory by design, so a
restored mode would come back amnesiac — root document only, history gone —
worse than an honest close; (3) a reload is the universal recover gesture,
and restoring a full-viewport `aria-modal` overlay on load is how a wedged
overlay would become un-escapable.

### Post-fix verification (2026-09-09)

- `focus-stays.spec.ts` + `focus-exit.spec.ts` + `paths.spec.ts`: **20
  passed** (real Chromium).
- Full `overlay-battery.spec.ts` (the shared crowded fixture changed) +
  `anchor-layer` + `cascade-order` + `comments-tab` + `collapse` +
  `doc-width`: **135 passed**, including all four checks on
  `focus-mode [excursion-depth]`.
- Unit: `FocusMode.test.tsx` + `Board.test.tsx` (53 passed);
  `Reader.test.tsx`, `ReaderHead.test.tsx`, `useNavStack.test.ts`,
  `useShortcuts.test.tsx`, `strip.test.ts` (133 passed).
- `eslint` clean, `prettier` clean, `tsc --noEmit -w apps/ui` clean.

### Flags for the orchestrator

1. **SPEC.md §10 rider text is now stale**: the rider's loose-path list
   still reads "a link inside full screen … lands as a loose path at the
   left edge". This fix implements UI-199's ruling over that clause. The
   spec sentence needs a rider amendment (user sign-off territory — not
   edited by this agent).
2. **Search-↵ while in full screen lands the pick invisibly** behind the
   overlay (specced search behavior, mode persists — not a UI-199 drop).
   Whether search over full screen should instead navigate the overlay is
   a UX decision beyond this issue's scope. Flagged, not changed.

## The §10 amendment, drafted for signature (supersedes rider 3's link clause)

The fix supersedes signed §10 text ("a link inside full screen ... lands as a
loose path at the left edge"), on the user's own 2026-09-09 directive.
Drafted for signature:

> **Full screen stays.** A link followed inside full screen opens inside
> full screen: the mode is a place a person put themselves, and navigation
> moves them within it rather than throwing them out. The excursion keeps a
> way back — the back control walks the chain, and leaving the mode stays a
> deliberate act (the exit control, or Escape), never a side effect of
> reading. The earlier clause that landed a followed link as a loose path at
> the left edge is superseded: it treated navigation as an exit nobody
> asked for. _(Amendment signed — date to be filled at signature.)_
