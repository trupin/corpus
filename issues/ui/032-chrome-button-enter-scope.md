# [UI-032] Board's ↵ shortcut preempts focused chrome buttons (⋯ trigger can't open by keyboard)

## Domain
ui

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-028, UI-030
- Blocks: —

## Spec References
- SPEC.md §11 — keyboard scheme (`↵` open the highlighted document); menu conventions ("adds no exclusive capability")

## Summary
UI-030 escalation (2026-07-31, reproduced in a real browser): with focus on the
reader's ⋯ trigger (or any focused chrome `<button>` outside an open menu), `↵` never
activates it — the board scope's `rows.open` binding matches on the document listener
and `preventDefault()` cancels native activation. UI-028 fixed this for OPEN menus
(`role="menu"` scope-out); this is the closed-menu case: focused chrome controls.
The naive fix (skip when a button has focus) is unsafe — `.row` is itself a `<button>`
deliberately bound to `↵`.

**Further evidence (UI-041, 2026-08-02):** the fence copy button hit the same
theft — `↵` on the focused button copied nothing until CodeFence added a local
stopPropagation guard on its own Enter/Space keydown. That local pattern (stop,
never prevent) works but each new interactive control must remember it; the
UI-041 agent's proposed general rule — `resolveShortcut` yields when
`document.activeElement` is a non-row button/link — is a candidate design for
this issue, with the same `.row`-is-a-button caveat above. Design the scoping rule: e.g. `rows.open` matches only
when the focused element is a row or nothing focusable holds focus; a
`data-board-shortcut-exempt` marker on chrome controls; or scope shortcut matching by
focus target generally. Prove the rule against BOTH cases: row-↵ still opens the
highlighted document; trigger-↵ opens the popover (then UI-030's roving focus takes
over). Space currently works on triggers (unbound) — must keep working.

**Third instance (UI-139, 2026-08-21):** the console's own `role="tab"` buttons
had been unpressable by keyboard since UI-125, and nobody noticed for weeks.
UI-139 added an `Enter`/`Space` branch to its tablist keydown handler — the
third local patch for one cause. That is what settled the scope of this issue:
the fix is one mechanism, and the local patches stay in place until a separate
cleanup removes them.

## Acceptance Criteria
- [x] Focused ⋯ / 💬 / any chrome button: `↵` activates it natively; board shortcut does not fire
- [x] Highlighted row: `↵` still opens the document (regression pinned)
- [x] The rule is one mechanism, not per-button patches; documented in shortcuts.ts
- [x] e2e keyboard case: focus ⋯ via keyboard → ↵ → popover opens → arrows/↵ run an action (completing the §11 no-pointer path end-to-end)

## Technical Design
### Files to Create/Modify
- `apps/ui/src/keyboard/shortcuts.ts` — `Shortcut.yieldsToFocusedControl`, set on
  `rows.open` and `rows.openFullScreen`; carries the rule and the rejected
  alternatives.
- `apps/ui/src/keyboard/useShortcuts.ts` — `BOARD_ROW`, `ACTIVATION_CONTROL`,
  `ownsActivationKeys`; `resolveShortcut` takes `controlFocused`; the dispatcher
  reads `document.activeElement` once and answers both questions from it.
- `apps/ui/src/keyboard/shortcuts.test.ts`, `apps/ui/src/keyboard/useShortcuts.test.tsx`
- `apps/ui/e2e/chrome-keys.spec.ts` (new), `apps/ui/e2e/context-menu.spec.ts`

### The rule chosen
**A shortcut whose chord is a key a focused control presses itself with yields
that key to the control — declared per entry in the registry, exempting the
board's own row by name.**

Three parts, and each is load-bearing:

1. **Per entry, not per scope.** `yieldsToFocusedControl` is set on `rows.open`
   and `rows.openFullScreen` — the only two board bindings on `↵`. `j`, `c`, `f`,
   `e` and the arrows are not keys a button presses itself with, so a focused ⋯
   has no claim on them and they keep acting on the board.
2. **Read off `document.activeElement`, matched on the element itself.**
   `ownsActivationKeys` matches native activators (`button`, `summary`,
   `a[href]`, `area[href]`) and the button-like ARIA roles. It uses `matches`,
   never `closest`: a quick-action `<button>` *inside* a row must keep its own
   `↵`, and climbing would hand it to the row.
3. **The board's row is exempt, by name.** `.row[data-row-doc]` — the same pair
   of attributes the row cursor already reads (`useRowCursor.columnRows`), so
   the exemption is written in the terms the board already uses for a row rather
   than in a marker a row could be written without. Pinned from both sides: a
   `.row` with a document is not a control, a `.row` without one is.

Registry integrity now asserts that **every** board-scope `↵` carries the flag,
and that **nothing** binds Space — the key every trigger fell back on while `↵`
was being stolen.

### Alternatives rejected
- **`event.stopPropagation()` in each control's own keydown** — the shipped
  pattern (CodeFence, `changelogClip`, the console's tablist). It works, and it
  is opt-in: every new control has to remember it, and three in a row did not.
- **A `data-board-shortcut-exempt` marker on chrome controls** — the same opt-in
  failure mode, plus a private attribute where ARIA already says the same thing.
- **"Skip when a button has focus"** — the trap named in this issue. `.row` is a
  control and `↵` on the highlighted row is §11's own binding.
- **A `control` scope that suspends every board key while a control has focus** —
  too wide. It would silently stop `j`, `c`, `f` and `e` from working next to any
  control that happened to hold focus.
- **Extending the rule to the arrows a roving widget owns** — a real gap: a
  `role="tablist"` still has to handle its own arrows, and the console does. It
  is a different key with a different default action, and belongs to its own
  issue rather than to this one.

### What this makes redundant, and is deliberately NOT removed here
The three local patches all become belt-and-braces for `↵`, and are left in
place so the guarantee is double-covered while this lands (user directive):
- `apps/ui/src/console/Console.tsx` — the `Enter`/`" "` entries in the tablist's
  `step` map. **Its arrows, `Home` and `End` are not redundant** and must stay.
- `packages/kit/src/markdown/CodeFence.tsx` — `claimActivationKeys`.
- `apps/ui/src/editor/changelogClip.ts` — the clip button's keydown listener.

`@corpus/kit`'s `Row.onKeyDown` is **not** redundant: a `role="button"` div has
no native activation, so that handler is what opens a focused row, and the
exemption above is what guarantees the cursor row opens when nothing is focused.

## Testing Strategy
apps/ui scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real app, keyboard only: tab/focus the ⋯ trigger, ↵, arrow, ↵ — action runs; row ↵ unchanged.

## E2E Verification Log
**Model: Opus 5 (1M context).** Branch `phase-38-comments-have-a-place`.
Playwright/Chromium against the real Vite dev server, isolated from any
workspace server (INFRA-028), on `CORPUS_UI_PORT=5373` — port 5173 was held by
an unrelated ssh tunnel.

**1. Reproduction, before any source change.** Wrote
`apps/ui/e2e/chrome-keys.spec.ts` and ran it against the unmodified tree:

```
npx playwright test --config apps/ui/playwright.config.ts chrome-keys --workers=1
→ 4 passed, 2 failed
   ✘ the reader's ⋯ trigger opens on ↵, exactly as it does on Space
     expect(getByRole('menu', {name: 'Document actions'})).toBeVisible() — not visible
   ✘ a column header's ⋯ trigger opens on ↵
     expect(getByRole('menu')).toBeVisible() — not visible
```

Both triggers are focused (`.focus()`), `Enter` is pressed, and no menu ever
opens. The three tests that passed pre-fix are the ones the fix must not break —
the highlighted row on `↵`, a focused row on `↵`, and `j`/`c` while a control
holds focus — plus the console tab, which passed only because UI-139 patched its
tablist locally.

**2. After the fix**, same command: `6 passed`.

**3. The AC-4 path, `↵` only, in `context-menu.spec.ts`** ("the ⋯ popover opens
and runs an action on ↵ alone"): focus ⋯ → `Enter` → popover visible and focus
has left the trigger → arrows walk to Archive → `Enter` → the **corpus changes**
(`corpus.doc("doc_note").status === "archived"`) and the popover closes. Passing.

**4. Focus probe in the live browser**, to characterise the popover's roving
focus rather than assume it:
```
before open:     BUTTON.expand  (the ⋯ trigger)
after open:      DIV.comments-pop open  tabindex=-1
after ArrowDown: BUTTON.cp-item  data-act="comments"
```
So `↵` opens the sheet and the arrows enter it. The two arrow-count assertions
that failed on the way there were **stale, not broken**: the concurrent UI-067
work added a `Comments` entry as the ⋯ set's first item, moving every other item
down by one. Confirmed pre-existing by neutralising this fix at the call site
(`controlFocused: false && …`) and re-running — identical failure. Both tests now
walk the arrows to the item they want (`arrowTo`) instead of counting keystrokes
at a menu other issues keep adding to.

**5. Falsification, both halves of the rule.**
- Neutralised `ownsActivationKeys` (`return false` after the row exemption):
  `4 failed | 63 passed` — including "lets the press reach the control's own
  default action", which went red on `board.calls` gaining two
  `openRowAtCursor:false` entries. That is the defect, reproduced in jsdom.
- Removed `yieldsToFocusedControl` from `rows.open` only: `3 failed | 64 passed`,
  including the registry-integrity test "makes every board ↵ yield to a focused
  control", which is the guard against the next `↵` binding forgetting.
- Both restored; `apps/ui/src/keyboard` back to `67 passed`.

**6. Regression runs.**
- `apps/ui/src/keyboard` — 6 files, 67 tests, passed.
- `apps/ui/src` — 3262 passed, 1 failed. The one failure,
  `abandon/useAbandonEmpty.test.tsx:242`, expects a button named
  `/threads on this document/`; the concurrent comments work renamed that label
  to `… comments on this document` (`comments/CommentsSwitch.tsx`,
  `commentsSwitchLabel`). Unrelated to this issue and outside this issue's
  ownership — reported to the orchestrator, not touched.
- e2e `context-menu` — 25 passed.
- e2e `chrome-keys console board smoke reader fences` — 90 passed.
- e2e `forms todos-menu compose-keyboard search notices` — 68 passed.
- `eslint` and `prettier --check` on every touched path: clean, no suppressions.
- `tsc --noEmit` in `apps/ui` (which typechecks `e2e/` too): exit 0.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
