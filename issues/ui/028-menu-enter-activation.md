# [UI-028] `↵` does not activate context-menu items (Space does)

## Domain
ui

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-018
- Blocks: —

## Spec References
- SPEC.md §11 context menu: "`esc` dismisses, arrows navigate, `↵` activates"

## Summary
Evaluator finding (2026-07-30, LEDGER-2 — pre-existing since UI-018; TEST-439 only
ever exercised ArrowDown): with roving focus correctly on a menu item, `Enter` and
`NumpadEnter` do nothing — the menu stays open, the action never runs; only `Space`
activates. True of every Corpus menu (row, header, reader, job, selection). Direct
§11 violation. Likely a keydown handler consuming/ignoring Enter on the focused
button (buttons natively activate on Enter — something intercepts). Fix in the shared
menu component, add both Enter variants to its tests, and extend the e2e keyboard
case to actually press `↵`.

## Acceptance Criteria
- [x] `Enter` and `NumpadEnter` activate the focused item in every menu surface; `Space` still works; `esc` still dismisses
- [x] Unit tests cover both variants; the e2e keyboard path asserts an action actually ran via `↵`

## Technical Design
### Files to Create/Modify
- `apps/ui/src/menu/ContextMenu.tsx` / `MenuItems.tsx` (find the interceptor) + tests; e2e context-menu spec keyboard case

## Testing Strategy
apps/ui scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real app: open a row menu via ⇧F10, ArrowDown, `↵` — the action runs.

## E2E Verification Log

**Model: opus** — Opus 5 (`claude-opus-5[1m]`), ui-dev, 2026-07-31.

Same real-app rig as UI-027: workspace
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s018-ui/ui-027-rig/ws`, server `127.0.0.1:8795`
(pid 75139), Vite dev `:5275` (pid 75955), Playwright Chromium 1600×1000. Port 8765 never touched.

### 1 — Reproduction (pre-fix)

Real right-click on a row, real `ArrowDown`, real key presses; `menus` counts `[data-ctx-menu]`,
`focused` is `document.activeElement`'s `data-act`:

```
menu open            menus 1  focused DIV     readers 0
after ArrowDown      menus 1  focused open    readers 0
after Enter          menus 1  focused open    readers 0   ← nothing happened
after NumpadEnter    menus 1  focused open    readers 0   ← nothing happened
after Space          menus 0  focused BODY    readers 1   ← only Space activates
```

LEDGER-2, verbatim.

**Root cause — not in the menu component.** `ContextMenu` never handled `↵` on purpose: a focused
`<button>` activates on `↵` through its **default action**, which the browser performs after every
listener has run. The interceptor is `useShortcuts`' single document-level `keydown` listener
(`apps/ui/src/keyboard/useShortcuts.ts`): `currentScope()` answered `"board"` with a menu open, so
`rows.open` (`↵`) matched, and `event.preventDefault()` cancelled the button's default action. The
menu stayed up and the act never ran. Two consequences that explain the rest of the ledger
exactly: `Space` is bound to nothing, so it survives; and the **arrows** work because
`ContextMenu`'s own React handler calls `preventDefault()` first and the dispatcher skips an
already-defaulted event. `esc` is unaffected — it is `boundBy: "escape-layer"`.

Two spellings, one event: `NumpadEnter` reports `key: "Enter"` with `code: "NumpadEnter"`, and
`matchesChord` matches on `key`, so both were swallowed identically.

**Fix.** A menu, like a modal overlay, takes the board's keys out of scope while it is open:
`currentScope()` now answers `"overlay"` when `document.querySelector('[role="menu"]')` finds one
(`isMenuOpen()` in `apps/ui/src/shell/overlays.ts`). ARIA rather than a private marker, so every
menu surface in the app is covered by a fact it already asserts — the context-menu frame, the
reader's ⋯ sheet, the 💬 popover, the new-list picker, the search overlay's chip pickers. No
`Enter` branch was added to the menu: a second activation path that could disagree with the click
one is exactly what the frame's one-implementation rule forbids, and a narrow `Enter` fix would
have left `c`/`j`/`k`/`f` still acting on the board *behind* an open menu.

### 2 — After the fix, real app, six drills

| # | drill | result |
| --- | --- | --- |
| A | row menu, ArrowDown, **NumpadEnter** alone | `menus 0 · readers 1` — Open ran |
| B | row menu, ArrowDown, **Space** | `menus 0 · readers 1` — unchanged |
| C | row menu, ArrowDown, **Escape** | `menus 0 · readers 0` — dismissed, nothing ran |
| D | row menu, ArrowDown ×2 (`data-act="open-focus"`), **Enter** | `menus 0 · readers 1 · .focus.open 1` |
| E | **column header** menu, ArrowDown (`Rename — edits the view document's title`), **Enter** | `menus 0`, rename input focused (`INPUT`) |
| F | row menu open, press **`c`** | `menus 1 · .overlay.open 0` — the composer no longer opens through the menu |

E is the proof this is the *shared* fix rather than a row-menu patch.

### 3 — Coverage

- Unit, dispatcher (`apps/ui/src/keyboard/useShortcuts.test.tsx`): an open `role="menu"` flips
  `currentScope()` to `overlay` and back when it is removed; a real `keydown` on a focused
  `role="menuitem"` comes back `defaultPrevented === false` for **both** `code: "Enter"` and
  `code: "NumpadEnter"` with no board command called; `c/e/f/r/j/k` do nothing while a menu is up.
- Unit, frame (`apps/ui/src/menu/ContextMenu.test.tsx`): the real `ContextMenu` with the real
  dispatcher mounted — `↵` (both codes) reaches the item unprevented, and the click the browser
  then performs runs the action and closes the menu; `esc` still dismisses and runs nothing.
  14 tests in the file, all passing.
- e2e (`apps/ui/e2e/context-menu.spec.ts`): three new cases, and they press the key for real and
  assert the **act** — "activates the focused item on Enter" / "on NumpadEnter" (menu hidden,
  `.reader[data-reader-doc="doc_note"]` visible), "still activates on Space, and esc still runs
  nothing", "takes the board's keys out of scope while it is open".

Pre-fix / post-fix, `CORPUS_UI_PORT=5276 playwright test e2e/context-menu.spec.ts e2e/anchor-layer.spec.ts`:
pre-fix the three new context-menu cases fail (8 failed overall, the other 5 are UI-027's);
post-fix **26 passed**.

### 4 — Gates

`vitest run apps/ui/src` → 104 files / 1555 tests passing · `tsc --noEmit` clean · `eslint` clean ·
`prettier --check` clean. Full `playwright test`: 146/147 passing bar the two `server unreachable`
cases, which fail because another agent's server holds `127.0.0.1:8765` in this tree (see UI-027's
log, section 6) — environmental, and that port was left alone.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
