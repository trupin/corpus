# [UI-030] Reader ⋯ popover: no keyboard navigation (roving focus never enters)

## Domain
ui

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-005
- Blocks: —

## Spec References
- SPEC.md §11 — context-menu conventions ("adds no exclusive capability"; arrows/↵); reader ⋯ menu

## Summary
Evaluator finding (2026-07-31, Phase 6 LEDGER-P6-1): the reader's ⋯ *button* popover
(`DocMenu`, a different frame from the right-click context menu) has proper
`role=menuitem` buttons but focus never enters — ArrowDown and Tab leave
`activeElement` on the trigger, so Enter re-toggles the trigger and no action ever
runs from the keyboard. This is absent roving focus, NOT UI-028's interception (that
fix is verified working on the right-click frame). Give the popover the same roving
focus/activation model as `ContextMenu` (share the mechanism, don't fork it); check
the 💬 comments popover for the same gap while there.

## Acceptance Criteria
- [x] ⋯ popover: ArrowDown/ArrowUp move focus, Enter/NumpadEnter/Space activate (asserted by effect), esc closes without running
- [x] Shared mechanism with ContextMenu, not a copy; 💬 popover audited and fixed if identical
- [x] e2e keyboard case on the ⋯ popover

## Technical Design
### Files to Create/Modify
- `apps/ui/src/reader/DocMenu.tsx` (+ CommentsPopover if affected), shared roving-focus hook with `menu/ContextMenu.tsx` (+ tests)

### As implemented
- **New**: `apps/ui/src/menu/useRovingMenu.ts` — the extraction. Exports `menuItems(menu)`
  and `useRovingMenu(ref, {autoFocus?, onDismiss})` → `{tabIndex, onKeyDown}`, spread onto the
  `role="menu"` element. It owns item discovery, open-focus (first item when a key opened it,
  the container otherwise), `↑`/`↓`/Home/End, Tab-dismissal and focus restore to the opener.
  It deliberately owns **no `↵`**: a focused `<button>` activates natively, and a handler here
  would double-fire on the frame that already worked. `esc` (each caller's own
  `useEscapeLayer` priority) and outside-click (`ContextMenu` only) stay with the callers.
- `menu/ContextMenu.tsx` **consumes** it — its inline `items()`, focus effect and `onKeyDown`
  are gone, and its 14 existing tests pass with no assertion edited.
- `reader/DocMenu.tsx` and `reader/CommentsPopover.tsx` each gained one `useRovingMenu(pop, …)`
  line and `{...roving}` on the sheet. The 💬 popover was confirmed identical and is fixed.

## Testing Strategy
apps/ui scoped (VITEST_MAX_THREADS=4).

Added: `menu/useRovingMenu.test.tsx` (8 — the mechanism alone, including a disabled item in
the middle and a menu with **no** items); `reader/DocMenu.test.tsx` +8 (`the ⋯ sheet from the
keyboard`); `reader/CommentsPopover.test.tsx` +4 (`the 💬 sheet from the keyboard`, incl. the
`.cp-empty` case). `menu/ContextMenu.test.tsx` and `keyboard/useShortcuts.test.tsx` unmodified.
Workspace run: **105 files, 1585 tests, all green**. Playwright `context-menu.spec.ts`: 28 passed.

## E2E Verification Plan
Real app: open ⋯ with the keyboard, arrow to Archive, Enter — the action runs.

## E2E Verification Log

**Model: opus** (claude-opus-5, 1M). 2026-07-31.

### Playwright, real browser, real app
`apps/ui/e2e/context-menu.spec.ts` → new case **"the ⋯ popover is operable from the keyboard
alone"** (the first e2e that has ever touched the ⋯ button popover; `:411` still exercises the
right-click frame and is untouched). Run: `CORPUS_UI_PORT=5284
CORPUS_SERVER_ORIGIN=http://127.0.0.1:8790 playwright test e2e/context-menu.spec.ts` → **28
passed**. The case focuses `.reader [data-doc-menu]`, opens, `ArrowDown` → `[data-act="review"]`
focused, `Escape` → menu gone / trigger focused / status still `open`, reopen, `ArrowDown`×2 →
`[data-act="archive"]` focused, `Enter` → the stub's doc reaches `archived`.

### Real workspace, real server, real git (port 8806)
Workspace `…/tmp/s020-ui/ui-030-Q7s2Ty` (`corpus init --port 8806`), server started via
`apps/cli/src/bin/corpus.ts server start`, Vite on 5284 proxying to it, driven headless.
Observed, in order:

```
UI-030 focus on trigger: true
UI-030 popover open. activeElement is: { tag: 'DIV', inPopover: true, act: null, role: 'menu' }
UI-030 after ↓ : review
UI-030 after ↓↓: archive
UI-030 after End: delete
UI-030 after esc — popover count: 0   focus back on ⋯: true
UI-030 about to ↵ on: archive
UI-030 after ↵ — popover count: 0
```

and the corpus agreed — `git log` in the workspace:
`6f52660 doc archive: Rates memo (doc_i5hz5xpy) by user`. No pointer touched the menu at any
point: the whole drill is `focus()`, Space, arrows, `esc`, `↵`.

### Finding surfaced, not silently fixed
`↵` on the **⋯ trigger** does not open the popover, and never did: with no menu open the scope
is still the board's, so `rows.open` (`keyboard/shortcuts.ts:151`, `scope: "board"`) matches
`↵` on the document listener and `preventDefault()` cancels the focused button's activation.
Reproduced in the real browser: the first version of the e2e pressed `Enter` on the trigger and
the popover never appeared. Space is unbound, so the trigger's native activation survives, and
that is what the drills use. This is the board preempting a focused control — UI-028's family,
not this sheet's roving focus — and it applies to every chrome button, so it is **escalated
rather than fixed here**: fixing it means changing global shortcut scoping, and `.row` is
itself a `<button>` bound to `↵`, so the obvious rule would break `rows.open`.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
