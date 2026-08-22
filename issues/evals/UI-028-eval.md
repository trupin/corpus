# Evaluation: UI-028

**Date**: 2026-07-31
**Sprint**: sprint-018
**Evaluator model**: Opus 5 (`claude-opus-5[1m]`)
**Verdict**: PASS (with one ledger finding — see below)

## Rig

Workspace `…/tmp/eval-p6/ws`, server `127.0.0.1:8802` (pid 99059), Vite `:5280`,
real Chromium. Every key pressed through `page.keyboard.press` on a real browser;
"the action ran" is asserted by its **effect** (a reader opened, an input focused, a
composer opened), never by the menu merely closing — `esc` also closes it.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                  |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Reproduction table, root cause, six drills, coverage, gates.                                            |
| Commands are specific and concrete      | PASS   | Per-key `menus/focused/readers` counts; drill E names the column-header rename input.                   |
| Real E2E (not mocked)                   | PASS   | Real right-click, real ArrowDown, real keys against a real server; independently reproduced here.        |
| Scenarios cover acceptance criteria     | PASS   | Both Enter variants, Space, esc, and a second surface.                                                   |
| Application restarted after changes     | PASS   | Pre-fix and post-fix runs on the same rig.                                                               |
| Actual model recorded (implemented on:) | PASS   | "**Model: opus** — Opus 5 (`claude-opus-5[1m]`), ui-dev, 2026-07-31."                                    |
| Reproduction logged before fix (bugs)   | PASS   | §1 reproduces LEDGER-2 verbatim — Enter and NumpadEnter no-op, Space activates.                          |

The root-cause account (the board dispatcher's `preventDefault` cancelling the
button's default action) is **corroborated** by drill F's converse and by my own
`c`-through-menu result: if the fix were an added `Enter` branch, `c` would still
reach the board. It does not.

## Criteria Results

| #   | Criterion                                                              | Result | Notes                                                              |
| --- | ---------------------------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| 1   | `Enter`/`NumpadEnter` activate the focused item in every menu surface   | PASS   | Row, column header, reader (right-click), job, selection.          |
| 2   | `Space` still works                                                    | PASS   | Every surface.                                                     |
| 3   | `esc` still dismisses, running nothing                                 | PASS   | Menu closes, effect counters unchanged.                            |
| 4   | e2e keyboard path asserts an action actually ran via `↵`               | PASS   | `apps/ui/e2e/context-menu.spec.ts` present (18K, extended).        |
| 5   | The board's keys yield to an open menu                                 | PASS   | `c` through an open menu opens nothing.                            |

## Evidence

### Row context menu — the full matrix

Each row is an independent page load; `focused` is `document.activeElement`'s
`data-act` after ArrowDown.

```
key            focused      result
Enter          open         menus 0 · readers 1      ← action ran
NumpadEnter    open         menus 0 · readers 1      ← action ran
Space          open         menus 0 · readers 1      ← unchanged
Escape         open         menus 0 · readers 0      ← dismissed, nothing ran
Enter (×2 ↓)   open-focus   menus 0 · readers 1 · .focus 1
```

`c` with the menu open:

```
before  {menus:1, overlays:0}
after c {menus:1, overlays:0}      ← composer did not open through the menu
```

### Column header menu

```
items ["rename","edit-query","unpin"], ArrowDown → rename
Enter        → menus 0, activeElement INPUT.col-title col-title-input
NumpadEnter  → menus 0, activeElement INPUT.col-title col-title-input
Space        → menus 0, activeElement INPUT.col-title col-title-input
Escape       → menus 0, activeElement BUTTON.col-menu   (nothing ran)
```

### The open reader (§10: "the open reader (its ⋯ menu set)")

Right-click on the reader:

```
frame ac-menu open ctx-menu, items ["review","archive","delete"]
ArrowDown → BUTTON.ac-item / review
Enter     → menus 0, toast ✓ "Mortgage options" marked still current — reviewed: now (committed).
```

The action ran, not just the menu closing.

### Console job row menu

```
frame ac-menu open ctx-menu, items ["open"], ArrowDown → open
Enter        → readers 1, reader th_f26tfuzn
NumpadEnter  → readers 1, reader th_f26tfuzn
Space        → readers 1, reader th_f26tfuzn
Escape       → readers 0                       ← nothing ran
```

### Text-selection menu

Real drag over "base case", real right-click on the selection:

```
frame ac-menu open ctx-menu, items ["comment","copy","cut","paste"]
ArrowDown → comment
Enter     → menus 0, textarea.cm-input 1       ← the composer opened
```

## Failures

None against the stated criteria.

## LEDGER-P6-1 — the reader's ⋯ **button** popover has no keyboard navigation at all

Not a UI-028 regression and not the bug UI-028 fixed, but it is the one place the
criterion's phrase "every menu surface" does not hold, so it is recorded rather than
waved past.

The reader's ⋯ *button* opens a **different frame** from the right-click context
menu:

```
reader ⋯ button   → [role="menu"] class "comments-pop open"     (no [data-ctx-menu])
right-click       → [role="menu"] class "ac-menu open ctx-menu"
```

The popover's children are proper `BUTTON[role=menuitem]`, but focus never enters
it — neither by arrows nor by Tab:

```
opened            activeElement = BUTTON.expand      (the trigger)
ArrowDown ×3      activeElement = BUTTON.expand      (unchanged)
Tab               activeElement = BUTTON.expand      (unchanged)
Enter             menus 0, no toast                  ← re-toggled the trigger; no action ran
```

So on that surface no item can hold focus, and `↵` cannot activate one. The gap is
**absence of roving focus**, not the `preventDefault` interception UI-028 fixed —
the pre-fix reproduction ("with roving focus correctly on a menu item") was never
reachable there. §10's `esc`/arrows/`↵` sentence is written about the right-click
context menu, which passes on the reader, and §10 also requires every context-menu
action to stay reachable without a pointer, which it does via right-click / ⇧F10.
Suggest a follow-up UI issue to give `.comments-pop` the same roving focus as
`ContextMenu`; it is an accessibility gap, not a broken behaviour.

## Summary

5 of 5 criteria passed. `↵` and NumpadEnter now activate on every menu surface
where an item can hold focus — row, column header, the reader's right-click menu,
console job rows, and the text-selection menu — Space is unchanged, `esc` still runs
nothing, and the board's keys correctly yield to an open menu. One adjacent
accessibility gap is ledgered above for a separate issue.
