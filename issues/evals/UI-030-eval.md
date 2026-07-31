# Evaluation: UI-030

**Date**: 2026-07-31
**Sprint**: sprint-020 (TEST-792–800)
**Evaluator model**: Opus 5 (1M context) — `claude-opus-5[1m]`
**Verdict**: PASS

Keyboard-only drill in a real Chromium against the running application (server `8807`, production
bundle). Every step below was performed with `element.focus()` + key presses — **the pointer never
touched either popover**.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                        |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | `issues/ui/030-doc-menu-popover-keyboard.md:66-108`                                                            |
| Commands are specific and concrete      | PASS   | Named Playwright spec + test title, the exact run command, a step-by-step console transcript with `data-act` values |
| Real E2E (not mocked)                   | PASS   | Real workspace on `8806`, real server, real git — and the proof is a **git commit in the workspace**            |
| Scenarios cover acceptance criteria     | PASS   | All three criteria; the `.cp-empty` edge case and TEST-800 non-regression both covered                          |
| Application restarted after changes     | PASS   | `corpus init --port 8806`, server started, Vite proxying to it                                                  |
| Actual model recorded (implemented on:) | PASS   | `**Model: opus** (claude-opus-5, 1M)` at `:68`. Wording differs from the contract's `implemented on:` form — nit |
| Reproduction logged before fix (bugs)   | PASS   | This *is* an evaluator finding (LEDGER-P6-1). The log records the pre-state (focus stuck on the trigger) and, better, surfaces a **second** finding rather than hiding it |

The log's "Finding surfaced, not silently fixed" section — `↵` on the ⋯ *trigger* is swallowed by the
board's `rows.open` shortcut, escalated instead of patched — is exactly the behavior a proof-of-work
should show. It matches what I observed, and it is now UI-032.

## Criteria Results — my own drill

### ⋯ popover, keyboard only

```
1. trigger focused: {tag:"BUTTON", cls:"expand", text:"⋯"}   menus open: 0
2. Space →           menus open: 1
                     activeElement: DIV.comments-pop open  role="menu"  inDocMenu: true
3. ArrowDown  →      BUTTON.cp-item  data-act="review"    role="menuitem"
4. ArrowDown  →      BUTTON.cp-item  data-act="resolve"   role="menuitem"
5. ArrowUp    →      BUTTON.cp-item  data-act="review"
6. End        →      BUTTON.cp-item cp-danger  data-act="delete"
7. Home       →      BUTTON.cp-item  data-act="review"
8. Escape     →      menus open: 0   activeElement: BUTTON.expand "⋯"   ← focus restored to the trigger
9. Space, ArrowDown×n to data-act="archive", then Enter
   items: [review, resolve, archive, delete]  (none disabled)
   about to press Enter on: {cls:"cp-item", act:"archive", text:"Archivereversible — hidden fro…"}
   menus open after Enter: 0
```

**TEST-795 asserted by effect, on disk.** Immediately after that Enter, in the workspace's own git:

```
06b6d8c doc archive: Re: "treasury team has not yet signed off" (th_dz4o6qg7) by user
```

A keyboard-only sequence — focus, Space, arrows, Enter — produced a real server mutation and a real
git commit. Exactly one commit: no double-fire.

### 💬 popover, keyboard only

```
reader open; 💬 button text: "💬 2"
1. trigger focused: BUTTON.comments-btn "💬 2"   menus: 0
2. Space → menus: 1   activeElement: DIV.comments-pop open  role="menu"
   items: ["whole-document thread1 turn · last: user", "“three anomalies in the northern ledger”"]
3. ArrowDown → BUTTON.cp-item role="menuitem"  "whole-document thread…"
4. ArrowDown → BUTTON.cp-item role="menuitem"  "“three anomalies in the northern ledger”…"
5. End       → the anchored-thread item
6. Home      → the whole-document item
7. Escape    → menus: 0   focus restored: BUTTON.comments-btn "💬 2"
```

| #   | Criterion                                             | Result | Notes                                                                                     |
| --- | ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| 1   | ⋯: arrows move focus                                  | PASS   | ↓ ↓ ↑ End Home all land on `role="menuitem"` buttons inside the popover, never on the trigger |
| 2   | ⋯: activation runs the action, asserted by effect     | PASS   | Archive committed to git; menu closed; single fire                                          |
| 3   | ⋯: esc closes without running, focus back to trigger  | PASS   | Menus 0, `activeElement` back on `BUTTON.expand`, and **no** commit was produced by the esc  |
| 4   | 💬: same treatment (TEST-797)                         | PASS   | Identical behavior on the comments popover, including focus restore                          |
| 5   | 💬: activation matches pointer behavior               | PASS   | See the control experiment below                                                            |
| 6   | TEST-800 — UI-028's protection still holds            | PASS   | With the 💬 menu open, `j` and `k` were pressed: readers `1 → 1`, active column unchanged (`doc_seedinbox`), menu still open. Board shortcuts are out of scope, as before |
| 7   | Roving hook handles a menu with items of mixed kinds  | PASS   | The ⋯ menu includes a `cp-danger` delete item; End lands on it and Home returns without error |

### The control experiment that matters

Pressing Enter on the first 💬 item closed the menu without stacking a new reader, which looked
suspicious. So I ran the same activation **with the mouse**:

```
CONTROL A (mouse): click 💬, click the first menu item
  before:     {readers:1, menus:0}
  menu open:  {readers:1, menus:1}   ← the head previews "whole-docume…" while the item is focused
  AFTER CLICK:{readers:1, menus:0}   ← identical outcome

CONTROL B (keyboard): focus 💬, Space, ArrowDown, Enter
  AFTER ENTER:{readers:1, menus:0}   ← identical outcome
```

Keyboard activation is **indistinguishable from pointer activation**, which is precisely what
UI-030 is for. Not a defect.

## Out of scope, correctly

`↵` on the ⋯ **trigger** does not open the popover — the board's `rows.open` shortcut
`preventDefault()`s it before the focused button can activate. I reproduced this and used `Space`
throughout, per the evaluation brief. It is filed as UI-032 and is not counted against UI-030.

## Failures

None.

## Summary

7 of 7 criteria pass. Both popovers take focus on open, move it with ↓ ↑ Home End, restore it to the
opener on Escape, and activate on Enter — with the ⋯ menu's activation proved by a real
`doc archive` commit in the workspace's git rather than by a rendered class. The 💬 popover's
Enter behaves identically to a mouse click on the same item, and UI-028's shortcut suppression is
intact. The browser console was silent throughout.
