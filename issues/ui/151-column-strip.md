# [UI-151] Column strip: one tab per column, grouped by path, dimmed when off screen, click scrolls, × closes

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: UI-149
- Blocks: —

## Spec References
- SPEC.md §10 — rider 4 (the column strip), "nothing resizes because of what it holds"
- `design/navigation.html` — `renderColbar`, `watchVisibility`, `goTo`

## Summary
A board with several paths is wider than a screen, and the user asked for a way to see and reach every column at once. The strip above the board is the board in miniature: one tab per column, grouped exactly as the board groups them, off-screen tabs dimmed, click to scroll.

## Acceptance Criteria
- [x] `ColumnStrip.tsx` renders above the board (inside the board wrapper, beside the explorer): a `.ctab` per column in strip order; query tabs show kind + title, reader tabs show document type + title in the serif face; a path's tabs sit in a `.cgroup` band (dashed; solid when loose) prefixed with `◂ <origin>` or `◦ path`.
- [x] An `IntersectionObserver` on the board marks a tab `.seen` when its column is at least half in view; unseen tabs are dimmed.
- [x] Click → the column scrolls into view (`inline: "center"`) and becomes the active column; the active tab is outlined and is itself kept in view inside the strip; `←`/`→` and every act that changes the active column move the outline.
- [x] A path tab shows `×` on hover: closes that column and everything after it (UI-149's `closeCol`). Query tabs have no `×`.
- [x] Tabs have a fixed max width and truncate; the strip scrolls horizontally with its scrollbar hidden; it never grows in height.
- [x] e2e `column-strip.spec.ts`: eight columns → eight tabs in order; click the first → board scrolls home and the seen set flips; `×` drops the right tabs.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/board/ColumnStrip.tsx`, `useColumnVisibility.ts`, tests, css
- `apps/ui/src/shell/Board.tsx` — mount, pass the strip and the active key

### Key Implementation Details
- The strip renders from the same strip model UI-149 keeps, so it can never disagree with the board about order or grouping.
- Visibility is an observer, not a scroll listener, so it costs nothing while idle.

### Edge Cases
- A board with no columns: the strip is empty and hidden (`:empty`).
- A query column showing its in-place reader: its tab shows the open document's title, not the view's.

## Testing Strategy
Vitest for tab derivation from a strip; Playwright for scroll and visibility (the observer needs a real viewport).

## E2E Verification Plan
### Verification Steps
1. Real app, build three paths; the strip lists them grouped; scroll the board by hand; dimming follows; click a far tab; it centres.

## E2E Verification Log

**ui-dev, 2026-08-23, on opus (claude-opus-5).**

### What was built

- `apps/ui/src/board/columnTabs.ts` — the strip's model, a pure function over
  the **same** `BoardStrip` the board renders from, so the two cannot disagree
  about order or grouping.
- `apps/ui/src/board/useColumnVisibility.ts` — an `IntersectionObserver` rooted
  at the board scroller, `threshold: [0.5]`, keyed by the tab list so it
  re-observes exactly when a column opens or closes.
- `apps/ui/src/board/ColumnStrip.tsx` + `ColumnStrip.css` — the `.colbar`,
  ported from `design/navigation.html`'s `renderColbar`.
- `apps/ui/src/shell/Board.tsx` — Board's root is now `.board-wrap`, holding the
  strip above the `<main class="board">` scroller; `goToColumn` (pin + scroll)
  and `closeFromStrip` (`closeCol`) are its two acts.

**Where the strip is rendered, and why.** Inside `Board`, not lifted through a
context. Three reasons: the strip is derived from `strip`, `ordered`,
`activeColumnId` — values that change on nearly every board interaction, and a
context would re-render the whole shell on each; the visibility observer's root
*is* `Board`'s `boardEl`; and rendering both from one `strip` value in one pass
is what makes "the strip can never disagree with the board" structural rather
than a convention. `Shell.tsx` was left untouched, which also keeps UI-151 out
of UI-150's way — the explorer becomes `.board-wrap`'s sibling.

### Two deliberate departures from the prototype

1. **The strip's height is fixed at the tallest thing it can hold** (a tab
   inside a path band), derived by `calc()` from the tab's own line box, padding
   and borders — not chosen. `design/navigation.html` lets the colbar grow from
   38px to 46px the moment a path opens, which pushes the board down. §10's
   "nothing resizes because of what it holds" rules that out, so the strip is
   46px always. Measured, and falsified below.
2. **The `✕` keeps its room whether or not the pointer is over the tab**
   (`visibility`, not `display`). The prototype's `display: none → inline` moves
   every tab to its right the moment the cursor lands on one — the
   pointer-driven growth §10 names explicitly.

Also: `.board`'s top padding went 16px → 10px, which is what
`design/navigation.html` cuts it to now that the strip holds that room.

### Checks

- `npm run build` — clean.
- `npm run typecheck -w apps/ui` — clean **for every file this issue touches**
  (`ColumnStrip.tsx`, `columnTabs.ts`, `useColumnVisibility.ts`, `Board.tsx`,
  `Shell.test.tsx`). The workspace as a whole was red at the time of writing from
  UI-150's and UI-152's in-flight edits in the same working tree — see
  "Unresolved" below.
- `eslint` + `prettier --check` — clean on every file this issue touches.
- Vitest, scoped: `columnTabs.test.ts` (7), `useColumnVisibility.test.tsx` (5),
  `ColumnStrip.test.tsx` (9), `Shell.test.tsx` (17), `Board.test.tsx` (41) —
  **79 passed**.
- Playwright, `CORPUS_UI_PORT=5376 --workers=1`: `column-strip.spec.ts` — 8/8,
  then 9/9 once the strip-scrolling test was added. Run together with
  `boards`, `board`, `paths`, `column-open-geometry`, `column-width`: 54 passed,
  1 pre-existing failure not from this issue (below).

### E2E evidence, real browser (Chromium via Playwright, real Vite dev server)

Fixture: eight query columns at 336px in a 1280px viewport — **2822px of board**,
so columns genuinely leave the screen. A fixture that fit would let every
dimming assertion pass with no observer wired at all.

1. **Eight columns → eight tabs in order.** `.colbar .ctab` `data-col` reads
   `[doc_view_0 … doc_view_7]`; `.ct` reads the eight view titles; no `.cx` on
   any query tab; no uncaught page error.
2. **Dimming, both directions.** Asserted first that column 8's left edge is at
   or past the board's right edge (the fixture's own precondition). At rest:
   tab 1 `.seen`, tab 8 not. Board scrolled to `scrollWidth`: tab 8 `.seen`,
   tab 1 not. Click tab 1: board returns to its home `scrollLeft` (18px — the
   scroller's left padding inside the first column's snap), tab 1 `.seen`
   again, tab 8 dimmed, tab 1 `.on`, and `.col[data-col="doc_view_0"]` carries
   `.kactive`.
3. **Click scrolls a far column in.** Clicking tab 8 moves `scrollLeft` past
   home and leaves tab 8 both `.seen` and `.on`.
4. **The keyboard moves the outline.** `→` moves `.on` from tab 1 to tab 2 and
   `←` moves it back.
5. **The active tab is kept in view inside the strip.** Re-seeded with eight
   long titles so the strip itself overflows (asserted: `scrollWidth >
   clientWidth`, and the first title's `.ct` is truncated). From
   `scrollLeft === 0`, seven `→` presses leave tab 8 `.on` and the strip
   scrolled past 0.
6. **A path is grouped and closes from its tab.** Clicking row *Mortgage
   options* in column 1 and following its `[[doc_beta]]` ref gives one
   `.cgroup` labelled `◂ Inbox` holding `["Mortgage options", "Rate table"]`,
   and the tab order becomes `[doc_view_0, path:1:0, path:1:1, doc_view_1 …]` —
   the band sits exactly where its columns sit. Hover + `✕` on `path:1:0`:
   the group, both tabs and both `.pcol`s go, leaving eight tabs.
7. **`✕` on `path:1:1`** leaves one tab in the band (*Mortgage options*) and
   nine tabs overall — this column and everything after it, nothing more.
8. **Chrome.** `.colbar` height and `.board` top are byte-identical before and
   after a path band appears; a path tab's width is unchanged when a second
   path column is added, and its full title is on `title=`.
9. **Empty board.** A board with `columns: []` renders `.board-empty` and the
   `.colbar` is hidden.

Screenshots taken from the same run (scratch spec, since deleted) confirmed the
look against the mockup in **both themes**: `FOLDER Inbox` sans tab, a dashed
band `◂ Inbox` holding two serif `NOTE` tabs with the active one outlined in
accent, `Mortgage option…` truncated, and Attention/Threads/Finance visibly
dimmed while off screen.

### Falsification — every rule broken, and the test that caught it

| Mutation | Test that went red |
| --- | --- |
| `intersectionRatio >= SEEN_RATIO` → `true` | unit: "marks a column seen at half in view and unseen below it"; **e2e: "dims the tabs of columns that are off screen"** (`.ctab q seen` on `doc_view_7`) |
| no-observer fallback `setSeen(live)` → `setSeen(new Set())` | unit: "claims nothing is off screen when there is no observer to ask" |
| path tabs `closable: true` → `false` | unit: "groups a path's columns…" and ColumnStrip's "closes a path column…" |
| `columnTabs` returns its entries reversed | 4 tests across both unit suites |
| `.colbar` `height: calc(…)` → `height: auto` | **e2e: "holds its height and the board's place whatever it holds"** — 38px before a path band, 46px after. This is the prototype's own behaviour, and it is what the fixed height prevents |
| strip `✕` closes index `0` instead of the clicked index | e2e: "closes only the columns after the one whose ✕ was clicked" |
| `.colbar:empty { display: none }` → `display: flex` | e2e: "shows nothing for a board with no columns" |

No test was found that could not be made to fail.

### Unresolved

- **`apps/ui/src/shell/Board.tsx` is unformatted**, from another agent's
  `PATH_KEPT_MESSAGE` addition (prettier wants it on one line). Not corrected
  here: three agents were writing that file in one working tree, and a
  `--write` would have risked clobbering an in-flight edit.
- **The working tree moved under this issue while it ran.** `useColumns.ts` was
  rewritten to take a `Board` rather than a `columnIds` list (UI-152), and
  `Shell.tsx` / `shortcuts.ts` / `Board.tsx` were rewritten mid-suite (UI-150).
  A Playwright run that straddled those writes reported six failures, including
  four of this issue's own specs. **Re-run after the writes settled: 9/9 green**,
  so those were the run reading half-written files, not defects.
- **`boards.spec.ts` "＋ creates a board document and switches to it" fails**,
  reproducibly, on the current tree. It is not from this issue: nothing here
  touches board creation, and `BoardsProvider.tsx`, `BoardBar.tsx` and
  `boardDoc.ts` had all been rewritten in the minutes before. It needs the
  owner of those edits, or a re-run once Phase 41's UI issues have landed
  together.
- **`npm run typecheck -w apps/ui` is red on twelve files**, none of them this
  issue's: `stageChoices.ts`, `useStrayStages.ts`, `ColumnList.tsx` and nine
  test files, all from UI-150's `openFullScreen` and UI-152's `stage` / `Board`
  signature changes.
- The strip carries **no `ChangedMark`**. Rider 9 marks a board tab and a column
  head, and names neither the strip nor a per-tab count; no acceptance criterion
  asks for one. Raising it would be a new rule, not an implementation choice.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[UI-151]` prefix
