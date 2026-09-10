# [UI-200] A search pick lands invisibly behind full screen

## Domain

ui

## Status

done — 2026-09-09, implemented, awaiting the gated commit

## Priority

P1

## Model

fable

## Dependencies

- Depends on: UI-199 (which found it)

## Spec References

- SPEC.md **§10** — search; full screen ("Full screen stays", amendment
  signed 2026-09-09)

## Summary

Found during UI-199's reproduction (2026-09-09): search (⌘K) stacks above
full screen, and choosing a result lands the pick as a loose path BEHIND
the overlay — the mode persists (correct, post-UI-199) but the gesture's
result is unseen. Decide what a search pick means inside full screen —
navigate the excursion (likely, matching "full screen stays"), or something
else — and implement.

## Decision (2026-09-09)

**Ruling: an open dispatched through the board-navigation seam while full
screen is up navigates the excursion.** The pick pushes onto the overlay's
own stack — the same push a followed link makes since UI-199 — so the
gesture's result is on screen where the person is, back walks it (named
after the document the search was made from), and the mode persists. The
loose-path landing at the left edge stays exactly as specced for picks made
**outside** the mode. This is a direct application of §10's signed
amendment: "the mode is a place a person put themselves, and navigation
moves them within it rather than throwing them out." A search pick made
inside the mode is a navigation made inside the mode.

The rule is implemented at the **board's half of the `useOpenInColumn`
seam**, not in the search overlay: the overlay stays mode-agnostic, and the
rule is total over every seam caller rather than per-caller. In practice
the search panel is the only seam surface reachable while the mode is up
(the explorer and the console are pointer-unreachable under the
full-viewport `aria-modal` overlay), so "any seam open while focus is up"
and "a search pick inside full screen" name the same set of events — but a
future overlay caller gets the right behaviour for free. The omnibox
**create** row rides the same seam, so a document created from search
inside full screen also opens in the excursion, with its title selected
("ready to type" — `selectTitleFor` now reaches the full-screen host the
same way it reaches path columns).

**Rejected alternatives:**

1. **Close full screen and land the pick as a loose path** — makes the
   result visible by exiting the mode. Rejected: it re-creates exactly what
   UI-199 removed. Navigation would again be an exit nobody asked for,
   against the amendment's signed text.
2. **Keep the invisible loose-path landing** (the pick is waiting when the
   person leaves the mode) — rejected: a gesture whose result appears only
   later, somewhere else, is indistinguishable from a gesture that did
   nothing. The pre-fix state was this, and it is the defect.
3. **Route inside `SearchOverlay` (the overlay asks "is focus up?")** —
   rejected on placement, not on behaviour: "where does an open land" is
   the board seam's one question, the overlay would need a new context to
   read the mode, and every other seam caller would still land invisibly.

**Considered and left unchanged:** `⇧↵` save-as-view over full screen still
creates the view document and its column behind the overlay (with a toast,
which stacks above everything) — its result is a durable board mutation,
not a navigation, and it is there when the person leaves the mode. The
board-scope `↵` on the row cursor while focus is up likewise still opens a
path behind the overlay — board keys stay live in focus by design
(`shortcuts.ts` scope doc, recorded in UI-199's reproduction), and it does
not go through the seam.

**Flag for the orchestrator (spec wording, user sign-off territory):**
§10's rider-3 enumeration still lists "the search overlay's `↵`" as landing
a loose path, unconditionally. The signed "Full screen stays" amendment
governs the inside-the-mode case, and this fix implements that reading. A
clarifying clause on the enumeration ("outside full screen") would close
the gap in the letter of the text — not edited by this agent.

## Acceptance Criteria

- [x] A search pick made inside full screen has a visible result
- [x] The decision recorded with the rejected alternative
- [x] The battery/spec covers the search-over-full-screen state

## E2E Verification Log

**Model: Fable (claude-fable-5).** All runs: real Chromium via Playwright
against the real Vite-served UI (`CORPUS_UI_PORT=6173`), the repo's e2e
harness (INFRA-028: the suite is the UI domain's real-browser surface).

### Pre-fix reproduction (2026-09-09, before any code change)

Ran the then-shipped `focus-stays.spec.ts` test "the search overlay's ↵
does not drop the mode" — which asserted the defect as behaviour — against
the unmodified tree: **1 passed (8.6s)**. Its assertions are the concrete
evidence: after ⌘K → "Payoff model" → `↵` over full screen, the focus title
still read `"Mortgage options"` (the surface did not navigate) while
`.path.loose .reader[data-reader-doc="doc_gamma"]` was attached — the pick
landed on the board **behind** the full-viewport `aria-modal` overlay,
invisible to the person who made it.

### Fix

- `apps/ui/src/shell/Board.tsx`: the seam's `open` gains a first branch —
  while a focus excursion has registered its navigate (`focusNavigateRef`),
  every seam open routes into it (push, reveal carried, `selectTitleFor`
  honoured); the loose-path resolution below is unchanged for the unmounted
  case. `FocusMode` render passes `onRegisterNavigate` + `selectTitleFor`.
- `apps/ui/src/reader/FocusMode.tsx`: new `FocusNavigate` type; the overlay
  publishes its own `navigate` while mounted (cleared with `null` on
  unmount); `DocView`'s `selectTitle` computed from `selectTitleFor` against
  the excursion's current document instead of hard-coded `false`.
- Comment updates where the old rule was stated: `SearchOverlay.tsx`
  (`openRow`), `openInColumn.tsx` (module header).

### Tests

- Unit, `FocusMode.test.tsx` (15 passed): the `Routed` harness plays the
  board's half — a routed open continues the excursion and back walks it;
  registration is cleared on unmount; the arriving title is selected when
  it is the marked document (and not before).
- Unit, `Board.test.tsx` (43 passed): new describe "the open seam while
  full screen is up" — a seam open routes into the excursion (focus shows
  the picked doc, back chevron present, **no** `.pcol`/`.path` lands) and
  the loose-path landing resumes the moment the mode is left.
  **Falsified**: with the routing branch disabled the routing test fails
  (loose path lands, focus never navigates); restored, all pass.
- E2E `focus-stays.spec.ts` (7 tests): the search test rewritten to assert
  the ruling — pick shows `"Payoff model"` in the focus title, zero
  `.path.loose`, back reads `"‹ Mortgage options"` and walks there, mode
  persists; plus a new test that Escape over full screen closes search only.
- E2E `focus-stays` + `focus-exit` + `paths` + `search`: **39 passed**
  (33.7s) — including paths.spec's untouched "the search overlay's ↵ lands
  as a loose path at the left edge" (the outside-the-mode behaviour,
  unchanged) and its UI-199 full-screen-link test.
- E2E `overlay-battery.spec.ts`: **75 passed** (56.3s) — the search entry
  gained the `over-focus-mode` further state (⌘K stacked over focus in the
  crowded fixture), drivable and driven: all four checks run on it, and the
  closure checks hold the escape-chain order (if Escape or the scrim closed
  focus instead of search, the panel would remain and the check would
  fail). Focus-mode entry (incl. `excursion-depth`) unchanged and green.
- Scoped unit sweep over touched modules — `FocusMode`, `Board`,
  `openInColumn`, `SearchOverlay`, `useNavStack`, `Reader`: **142 passed**.
- `tsc --noEmit -p apps/ui` clean, `eslint` clean, `prettier` clean on all
  touched files.
