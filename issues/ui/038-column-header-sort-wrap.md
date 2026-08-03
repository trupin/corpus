# [UI-038] Column header: sort control wraps to its own line in narrow columns

## Domain
ui

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §11 board columns (header row)

## Summary
Live dogfood report (2026-08-02, screenshot): shrinking the window makes the
column header's sort control ("last activity ↓") wrap below the filter chips
instead of sharing their row. User directive: everything stays on one line;
when there is no space, degrade the sort label by dropping the word
"activity" (render "last ↓"), never by wrapping.

## Acceptance Criteria
- [x] Chips row and sort control share one row at all column widths; the row
      never wraps to two lines
- [x] When the full label does not fit, the sort control renders "last ↓"
      (word "activity" dropped); the ↓/↑ direction glyph is always visible
- [x] Degradation is width-driven and reversible (label restores when space
      returns); no truncation ellipsis, no overlap with chips
- [x] Applies to every column type (folder, plugin, views) sharing the header

## Technical Design
### Files to Create/Modify
- The column header component + its css (chips/sort row); container-query or
  measured-width approach — match existing responsive patterns in the board

### Mechanism chosen (measured width, not a container query)
A container query keys on the *column's* width, but what has to fit is the
chips, and a column carries whatever chips its stored query names — one
`folder:` chip needs 217 px where `type=thread&status=open` needs 308 px. A
breakpoint would degrade columns that had room and wrap the ones that did not,
so the header measures instead, the way `anchors/useAnchorLayer.ts` already
decides margin mode (`ResizeObserver` + a measured element).

`apps/ui/src/board/sortFit.ts`:
- `shortSortLabel(label)` — the degraded form: first word + direction glyph.
- `fitsFullSortLabel({ available, required })` — the pure predicate.
- `useSortFit(chips, sortLabel, enabled)` — observes the row and reports
  `compact`.

The chips shrink (`.chips .chip { min-width: 0; overflow: hidden }`, so a row
too narrow for even the short label clips its chips rather than letting anything
cross the label), which means the *visible* row always measures as fitting. So
the header also renders a hidden `width: max-content` copy of the row —
`.chips-probe`, same chips, same gaps, always the full label — and compares
`row.clientWidth` against it. Neither input moves when the visible label
degrades, so the predicate cannot oscillate and restoring is automatic.

## Testing Strategy
Component test for the label degradation predicate; e2e resize assertion.

## E2E Verification Plan
Real app: narrow a column until the full label cannot fit; one row, "last ↓";
widen; label restores.

## E2E Verification Log

**Model: opus** (ui-dev, 2026-08-02). Real Chromium against the real Vite dev
server on `CORPUS_UI_PORT=5873`, real React/DOM/pointer events, API answered by
`e2e/stubCorpus.ts` (`apps/ui/e2e/column-header.spec.ts`, 4 specs, all green).

**Reproduction, before the fix.** Measured in the browser at the board's default
336 px column (`type=thread&status=open`): the chips row offers `clientWidth`
306 px and the two chips plus "last activity ↓" need 308.3 px. Under
`design/index.html`'s `.chips { flex-wrap: wrap }` those 2.3 px are what put the
sort label on a second line — the reported screenshot.

**After the fix**, same 336 px column: one row, chips whole, label "last ↓".

Instrumented run (`page.evaluate` over `.chips` / `.chips-probe`), one column
per query, all at 336 px:

| stored query | row | needs | rendered |
| --- | --- | --- | --- |
| `type=thread&status=open` | 306 | 308.3 | `last ↓` |
| `type=todo` | 306 | 190.6 | `last activity ↓` |
| `folder=inbox` | 306 | 217.1 | `last activity ↓` |
| `type=thread&status=open&tag=finance` | 306 | 412.8 | `last ↓` |

Drill, per acceptance criterion:

1. **One row at every width.** Column at 400 px → `.chips > .sort` reads
   "last activity ↓". Real pointer drag on the `Resize Conversations` handle,
   −400 px → the column clamps to its 240 px floor → the label reads "last ↓"
   and carries `data-sort-compact`. At both widths the row's box height is under
   two label bands, the last chip's band contains the label's, and the row's
   height at 240 px equals its height at 400 px — it never became two lines.
2. **Degraded form and glyph.** Exactly "last ↓" (asserted as text, not a
   substring). The label's right edge stays inside the row at 240 px, where even
   the short form exceeds the row: the chips clip, the glyph never does.
3. **Width-driven and reversible.** From 240 px ("last ↓"), drag +400 → 640 px →
   "last activity ↓", no `data-sort-compact`; drag −400 → "last ↓" again. No
   ellipsis anywhere; the label always starts at or after the last chip's right
   edge (asserted at every width).
4. **Fit, not a breakpoint.** A one-chip column (`type=todo`) at the *same*
   240 px keeps the full label — a width breakpoint would have degraded it.
5. **Every column type.** All three call sites in `Column.tsx` (query column,
   plugin column, broken-view column) render this one `ColumnHead`, so folder,
   plugin and view columns share the rule by construction; the folder case is
   covered by the `folder=inbox` measurement above.
6. **The probe is invisible.** `.chips-probe` is `position: absolute`, hidden to
   Playwright's visibility check, out of the a11y tree (`aria-hidden`), wider
   than the row it sits in (which is why it exists), and no *visible* element on
   the board shows "last activity ↓" while the row is compact.

Screenshots of the real header (`.col-head`, discarded scratch spec) at 240 /
336 / 420 / 520 px confirmed the look: one row at all four, full label from
420 px up, chips clipped only at the 240 px floor.

Checks: `vitest run apps/ui/src` — 113 files, 1767 tests, all pass (37 in
`ColumnHead.test.tsx` + `sortFit.test.ts`). `tsc --noEmit` in `apps/ui` clean.
ESLint and Prettier clean on every touched file.

Not covered here: a real `corpus` server. This issue writes nothing — it is
layout only — so the browser half is the whole of it.

## PR #19 review follow-up (2026-08-03)

**Model: Opus 5 (`claude-opus-5[1m]`).** Agent: ui-dev.

`sortFit.ts` carried two **raw NUL bytes** (0x00) — `join("\0")` written as literal
control characters. Git classified the whole 5.5 KB module as binary
(`Bin 0 -> 5494 bytes` in `git diff` and in GitHub's review UI), `git grep` skipped it,
and a conflict in it could only have been resolved ours/theirs. Replaced with a named
`SEPARATOR = "\u0000"` constant: byte-identical at runtime, and `file` now reports
`Unicode text, UTF-8`. (`git diff` against HEAD still says `Bin` because the *committed*
blob is the binary one; the file is new on this branch, so the PR's diff against `main`
renders it as text once the fix is committed.)

`vitest run apps/ui/src/board/sortFit.test.ts` → 15 passed, unchanged.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
