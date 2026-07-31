# Evaluation: UI-023

**Date**: 2026-07-30
**Sprint**: N/A (post-Phase-5 polish batch, branch `ui-022-reader-polish`)
**Evaluator model**: Opus 5 (`claude-opus-5[1m]`)
**Verdict**: PASS

## Rig

Same real-app rig as UI-022: workspace `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/eval-polish/ws`, server `127.0.0.1:8802` (pid 25912), Vite dev `:5280` (pid 26432) with `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8802`, Playwright Chromium at 1600×1000. Widths are read off `getBoundingClientRect()` after the width transition settles (2× 700 ms waits). **The column was widened by really dragging `.col-resizer` with the mouse**, not by writing the view document — so the whole path (drag → autosave → frontmatter → render) is exercised.

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | Dated, with a derivation section, a reproduction and a post-fix table |
| Commands are specific and concrete | PASS | Exact `getComputedStyle` readings, exact geometry JSON, named screenshots |
| Real E2E (not mocked) | PASS | Real server, real `PUT /api/docs/doc_seedinbox`, real browser measurements |
| Scenarios cover acceptance criteria | PASS | Wide base, default base, close-and-return, viewport clamp all covered |
| Application restarted after changes | PASS | `renderedWidth` "temporarily reverted" for the repro, then restored and re-measured |
| Actual model recorded (implemented on:) | PASS | "2026-07-30 — ui-dev on opus (claude-opus-5)" |
| Reproduction logged before fix (bug) | PASS | `PRE-FIX base 900 reading: {"column":960,"body":517.21875,"gutterRight":426.78125}` — 427 px of dead gutter observed before the fix |

Independent re-derivation of the log's own measurements on my rig: `.doc-body` computed `max-width: 517.222px`, `.reader-scroll` padding `12px 14px`. Identical to the log. The claimed post-fix geometry `{"column":560,"body":517.21875,"gutterRight":26.78125}` reproduced as `{"column":560,"body":517.22,"gutterRight":27.78,"gutterLeft":15}` — a 1 px difference explained by the log measuring gutter from the column's border box and mine from its outer rect.

## Criteria Results

| # | Criterion | Result | Notes |
| --- | --- | --- | --- |
| 1 | A column with any stored base width renders, while a reader is open, no wider than the content measure (no dead gutter) | PASS | FACT-1, FACT-2 |
| 2 | Default column (no stored width) still widens 336 → 560 on open | PASS | FACT-1 |
| 3 | Closing the reader returns the column to its base width unchanged | PASS | FACT-1 |
| 4 | The ceiling coexists with the existing viewport clamp (min of the two applies) | PASS | FACT-3 |

### FACT-1 — the reported case, end to end

```
default column, list mode          : 336
default column, reader open        : 560     (class "col kactive reading")
geometry                           : {"column":560,"body":517.22,"bodyMaxWidth":"517.222px",
                                      "scrollPad":"12px 14px","gutterLeft":15,"gutterRight":27.78}
esc (close reader)                 : 336

drag .col-resizer +564px           : 900     (aria-valuenow="900", min 240 / max 960)
open reader on the 900px column    : 560     ← was 960 pre-fix
geometry                           : {"column":560,"body":517.22,"gutterRight":27.78}
esc (close reader)                 : 900     ← returns to the dragged width
reopen                             : 560
```

Screenshots `023-wide-reading.png` (text runs the full measure, no dead gutter) and `023-wide-list.png`.
The right-hand gutter went 426.8 px → 27.8 px, of which 14 px is the reader's own padding.

Persistence is real, not local state: after the drags, `data/docs/views/inbox.md` frontmatter carries `width: 960` and the workspace git log shows `doc edit: Inbox (doc_seedinbox) by user` auto-commits.

### FACT-2 — sweep across the whole drag range

Each base set by a real resizer drag, then a row opened:

| base width (dragged) | column width with the reader open |
| --- | --- |
| 240 (MIN) | 400 |
| 400 | 560 |
| 560 | 560 |
| 700 | 560 |
| 960 (MAX) | 560 |

No base produces a reading width above 560; the 336 → 560 relative widening (sprint-016 TEST-450) survives, and bases below the ceiling still widen proportionally rather than snapping.

### FACT-3 — viewport clamp still wins when it is smaller

Fresh browser at viewport 480×900, Inbox base width stored as 900:

```
list width : 432
reader open: {"vw":480,"column":432,"body":402}
```

`min(ceiling 560, viewport clamp 432) = 432` — the clamp applies, the ceiling does not override it.

## Failures

None.

## Ledger (observed on PASS)

### LEDGER-1: 560 sits ~13 px above the strictly-measured content measure on this machine

Derived from the shipped CSS in this browser: `517.22` (`.doc-body` max-width) `+ 28` (reader padding) `+ 2` (column borders) = **547.2 px**, against a rendered reading width of **560 px**. Left gutter 15 px, right gutter 27.8 px — the body is not centered in the reading column, so the asymmetry is visible if you look for it.

Not scored as a failure: `ch` is font-dependent (the issue's own log measured 465–571 px across the `--serif` fallback chain), 560 is the reading width `design/index.html` is authoritative for, and the issue itself requires preserving 336 → 560 exactly. The user-visible harm in the report — 427 px of dead gutter — is gone. Flagging only so the constant's ~13 px of slack is a recorded decision rather than an accident.

## Summary

4 of 4 criteria passed. A column dragged to 900 px opens its reader at 560 px and returns to 900 px on close; the default column still does 336 → 560 → 336; every base width in the 240–960 drag range caps at 560 while reading; and a narrow viewport still clamps below the ceiling.
