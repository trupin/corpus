# [UI-023] Reader-open column widening must cap at the content measure

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: — (UI-019 view width, landed)
- Blocks: —

## Spec References
- SPEC.md §11 — column widens while reading; per-view width in the view doc's frontmatter

## Summary
User report (2026-07-30, screenshot): resize a column wider, open a thread, and the
column widens *further* (`renderedWidth` = base × 560/336, clamped only by
`MAX_COLUMN_WIDTH`/viewport) — but the reader body is capped at `62ch`
(`Reader.css`), so everything past the content measure is dead gutter. User rule:
**the reading width must never exceed the max width of the content** — no point
widening past where the content stops.

Design intent: introduce a reading-width ceiling equal to the reader's content measure
(62ch at the reader's font plus the reader's horizontal padding — derive it from the
actual CSS, don't guess a number) and apply it in `renderedWidth` when `reading` is
true. A base already at/above the ceiling opens the reader at the ceiling ("no need to
resize more than the capped size"). The default 336 → 560 behavior must be preserved
(sprint-016 TEST-450's relative-widening contract) as long as 560 ≤ the ceiling. The
drag range for the *list* (base width, `MIN`/`MAX_COLUMN_WIDTH`) is out of scope —
only the reading-mode rendered width is capped.

## Acceptance Criteria
- [x] A column with any stored base width renders, while a reader is open, no wider than the content measure (no dead gutter like the report's screenshot)
- [x] Default column (no stored width) still widens 336 → 560 on open
- [x] Closing the reader returns the column to its base width unchanged
- [x] The ceiling coexists with the existing viewport clamp (min of the two applies)

## Technical Design
### Files to Create/Modify
- `apps/ui/src/board/columnWidth.ts` — reading ceiling in `renderedWidth` (+ tests)
- `apps/ui/src/board/Column.tsx` / `Reader.css` only if the measure needs to be shared as a constant/CSS var

## Testing Strategy
apps/ui scoped (VITEST_MAX_THREADS=4): renderedWidth unit cases (default, wide base, viewport-narrow); e2e width assertion if the board spec already measures columns.

## E2E Verification Plan
Real app: drag a column to ~900px, open a thread → column snaps to the content measure, no dead gutter; close reader → back to ~900; default column still opens at 560.

## E2E Verification Log

**2026-07-30 — ui-dev on opus (claude-opus-5).** Same real-app rig as UI-022: `corpus init`
workspace at `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/ui022/ws`, server on
`127.0.0.1:8790`, Vite on `:5273`, real Chromium at 1600×1000. The Inbox view document's
`extra.width` was set through the API (`PUT /api/docs/doc_seedinbox`) rather than mocked.

**Deriving the ceiling (measured, not guessed).** With a reader open in a column forced to
900 px, `getComputedStyle` against the *shipped* stylesheet:

```
.doc-body max-width : 517.222px   (= 62ch at 15px in --serif → Iowan Old Style/Charter)
.col .reader-scroll : padding 12px 14px  → 28px horizontal
.col                : border-box, 1px border each side → 2px
                      no scrollbar gutter on macOS (overlay scrollbars: offsetWidth − clientWidth = 0)
⇒ content measure   = 517.2 + 28 + 2 = 547.2px
```

`ch` is font-dependent, so the same CSS was measured across the `--serif` fallback chain in
the same browser: Iowan Old Style / Charter 517.2px, Georgia 570.8px, Palatino / Times /
DejaVu / Liberation 465px → the measure lands between ~495px and ~601px depending on which
family a machine resolves. `560` — the prototype's own reading width — is the design
constant inside that band: it covers the reference-font measure with ~13px of slack (enough
for the 8px classic scrollbar on non-overlay platforms) and keeps `336 × READING_WIDTH_RATIO
= 560` exact. That derivation is recorded in the `READING_WIDTH_CEILING` doc comment.

**Reproduction (pre-fix).** `renderedWidth` temporarily reverted to the uncapped form, view
document at `width: 900`:

```
PRE-FIX base 900 reading: {"column":960,"body":517.21875,"gutterRight":426.78125}
```

960 px of column (the `MAX_COLUMN_WIDTH` clamp) around 517 px of text — 427 px of dead
gutter, exactly the report's screenshot (`repro-width-900.png`).

**After the fix** (widths read off `getBoundingClientRect`, after the 0.25s width
transition settles):

```
base 900, reader open   : 560     (was 960)   ← width-900-reading.png
base 900, reader closed : 900                  ← width-900-list.png
base 900, re-opened     : 560
geometry                : {"column":560,"body":517.21875,"gutterRight":26.78125}
default base, list      : 336
default base, open      : 560     ← the sprint-016 TEST-450 contract, unchanged
default base, closed    : 336
```

The right-hand gutter went from 426.8px to 26.8px — the reader's own 14px padding plus the
~13px of slack in the constant.

**Automated.** `apps/ui` scoped Vitest (`VITEST_MAX_THREADS=4`): `columnWidth.test.ts` 23
tests (new cases for the ceiling, the closed-reader base, and the ceiling-vs-viewport min),
`useColumnWidth.test.tsx` 8 — pass. Playwright single specs on `CORPUS_UI_PORT=5273`:
`column-width.spec.ts` 9/9 (including the new "a column wider than the content measure
opens the reader at the measure": 900 → 560 → back to 900 on close) and `reader.spec.ts`
6/6 (the "still opens to the prototype's 560px" contract). `eslint`, `prettier --check`,
`tsc --noEmit` clean.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
