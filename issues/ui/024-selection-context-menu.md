# [UI-024] Selection-aware context menu: comment on selection; selections stop suppressing item menus

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: UI-018 (context menu infra), UI-008 (selection → comment flow)
- Blocks: —

## Spec References
- SPEC.md §11 — right-click context menu bullet (amended 2026-07-30, both riders); document view "Commenting" (floating toolbar)
- SPEC.md §6 — text-quote anchors

## Summary
Two user reports (2026-07-30, screenshots), one root cause: `nativeMenu.ts`'s
`keepsNativeMenu` returns the native menu for **any** non-empty selection, anywhere.

1. **Selection menu.** Right-clicking selected text in the document body shows the
   browser menu; the user wants a Corpus menu there: **Comment on selection** first
   (exactly the floating toolbar's Comment — capture the text-quote selector, open the
   thread composer with ask-agent toggle), then clipboard basics: Copy always; Cut and
   Paste when the selection is in editable content. Losing native Look Up/Translate on
   selections is an accepted trade (user decision recorded in §11).
2. **Item menus win over stray selections.** Right-clicking a non-open document row
   "sometimes" shows the native menu — whenever a selection exists anywhere, including
   the word macOS auto-selects under the right-click itself. A selection must never
   suppress an item's menu: rows, column headers, job rows open their Corpus menu
   regardless of selections elsewhere.

Design: replace the global `selection.trim() !== ""` guard with a target-aware rule —
(a) target is/overlaps the selection inside the document body → selection menu;
(b) target resolves to a Corpus item (row/header/job/reader surface) → that item's
menu, selection ignored; (c) editable host with no selection → native (spellcheck);
(d) nothing Corpus under the cursor → native. Each surface's hook already knows its
items; only the shared halves live in `nativeMenu.ts`.

Clipboard honesty: Copy/Cut via the Clipboard API on the menu activation gesture;
Paste via `navigator.clipboard.readText()` — if the browser denies read permission,
the Paste item must fail visibly (notice), not silently no-op.

## Acceptance Criteria
- [x] Right-click on a selection in the doc body (reader and focus mode): Corpus menu with Comment on selection + Copy (+ Cut/Paste in editable content); Comment opens the same composer as the floating toolbar and produces a §6 anchored thread
- [x] Right-click on a row while any selection exists (incl. auto-selected word under cursor): the row's Corpus menu opens — reproduce report 2's case and prove it fixed
- [x] Right-click in the editor with no selection: native menu (spellcheck) — unchanged
- [x] Right-click on empty/non-item space: native menu — unchanged
- [x] Title field, inputs, plugin surfaces: native behavior unchanged

## Technical Design
### Files to Create/Modify
- `apps/ui/src/menu/nativeMenu.ts` (rule redesign + tests)
- `apps/ui/src/menu/useReaderContextMenu.tsx`, new `SelectionMenuItems` component (+ tests)
- Row/column/job context-menu call sites: pass target context instead of the global selection guard
- Wire Comment to the existing selection-comment flow (DocView/anchors seam)

**As built** — one deviation from the plan above, deliberate: the selection menu is
opened by a new `apps/ui/src/menu/useSelectionContextMenu.tsx`, hosted by **`DocView`**
on `.doc-main`, not by `useReaderContextMenu`. `useReaderContextMenu` is called from
`Reader`/`FocusMode`, which are *above* the anchor layer and cannot reach the editor or
the commenting flow; `DocView` is the one component both hosts render and is where the
two already meet. `useReaderContextMenu` keeps the document's ⋯ set and only loses its
global selection guard; the selection hook stops propagation when it opens, so the two
never both fire. `useAnchorLayer` gained exactly two members for the seam — `editor`
(it is already the only holder) and `captureComment()`, which returns the live
selection as a bound action, so Comment on selection is 💬's own path and not a second
one. Where the selection menu could offer nothing but Copy (a `view`, a foreign lock)
it declines — paying §11's Look-Up trade for nothing would be a straight downgrade.
_Correction (2026-07-30 eval LEDGER-3): a selection in a thread's conversation does
not fall through to the native menu — the reader's own item menu opens there, which
is the correct §11 behavior (the open reader is an item); the original sentence
overclaimed the decline list._

## Testing Strategy
apps/ui scoped (VITEST_MAX_THREADS=4); e2e cases in the context-menu spec (selection menu, row-menu-despite-selection).

## E2E Verification Plan
Real app: select text in an open doc → right-click → Comment on selection → anchored thread created; select a word, right-click a different row → row menu; right-click inside editor with no selection → native menu.

## E2E Verification Log

**Model: opus** (ui-dev, 2026-07-30). Main tree, no worktree. Scratch workspace
`~/.claude/jobs/4dd0ddef/tmp/ui024/ws`, real server on `:8791` (pid 44370),
Vite dev on `:5274` with `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8791` and the
workspace's own `VITE_CORPUS_TOKEN`. Both stopped afterwards; ports verified free.

### 1. Reproduction, before the fix (real browser)

The pre-fix rule was restored in `nativeMenu.ts` (global `selection.trim() !== ""`
guard + `selectionMenuTarget` short-circuited to `null`) and the new e2e cases run
against it — `CORPUS_UI_PORT=5274 npx playwright test apps/ui/e2e/context-menu.spec.ts`:

```
PASS (10) FAIL (4)
1. opens a row's menu on the selected word under the cursor      ← report 2
2. offers the selection's actions in the document body            ← report 1
3. comments on the selection through the same composer 💬 opens   ← report 1
4. copies the selected text to the real clipboard                 ← report 1
```

A capture-phase probe established **which gesture actually carries a selection into
`contextmenu`**: right-clicking *on* the selected text keeps it live
(`row-title :: "Mortgage options"`), while a right-click elsewhere in the same row
clears it first (`row-excerpt :: ""`). So report 2's case is the word under the
cursor — the row test right-clicks the selected title, and asserts the selection is
still `"Mortgage options"` at that moment. Pre-fix: **no Corpus menu at all**.

### 2. After the fix — stubbed Playwright suite

`CORPUS_UI_PORT=5274 npx playwright test apps/ui/e2e/context-menu.spec.ts` → **14/14 PASS**
(6 new: row-menu-on-selected-word, header-menu-on-selected-title, selection menu item
set + order, Comment→composer→`POST /api/threads` with the §6 selector, real-clipboard
Copy, native menu untouched in the editor/field/empty space).

### 3. After the fix — real app, real server, real files

Board at `:5274` against the workspace server on `:8791`, driven with a real Chromium:

| Case | Evidence |
| --- | --- |
| Report 2 — row menu with the row's own text selected | selection at click = the row's text; menu `Actions for Rates memo`, items `[open, open-focus, archive, delete]` |
| Report 2 — thread row, same gesture | menu `Actions for Re: "…"`, items `[open, open-focus, resolve, archive, delete]` |
| Report 1 — selection menu in the doc body | menu `Actions for the selection`, items in order: `💬 Comment on selection`, `Copy`, `Cut`, `Paste` |
| Report 1 — same in **focus mode** | `.focus.open` = 1, menu `Actions for the selection`, `[comment, copy, cut, paste]` |
| Comment on selection → the floating toolbar's flow | composer `New comment` opened quoting the selected text; after send: `.anchor-hl` painted over those words, 1 thread on the document |
| §6 anchor on disk | `data/docs/inbox/mortgage-options.md` frontmatter gained `anchors.anc_010611ca` with `exact/prefix/suffix`; `data/threads/th_qlbfp7sj.md` carries `parent: doc_yljiks3z`, `anchor: anc_010611ca`, body `## user · … Is that the 30-year or the 15?`; auto-commit `db2467a comment: new thread on doc_yljiks3z (th_qlbfp7sj) by user` |
| Editor, nothing selected | 0 Corpus menus — the native menu (spellcheck) is untouched |
| Copy | system clipboard read back = the exact selected text |
| Cut | text removed, autosaved through the normal `PUT`; `rates-memo.md` body now empty, auto-commit `e8ab789 doc edit: Rates memo (doc_bfpklgl3) by user` |
| Paste with clipboard read **denied** (context without `clipboard-read`) | error toast: `Could not paste — Failed to execute 'readText' on 'Clipboard': Read permission denied. Reading the clipboard needs the browser's permission; ⌘V still works.`, `data-tone="error"`, document unchanged |

### 4. Gates

- `vitest run --root apps/ui src` → **103 files / 1516 tests passed** (of which
  `src/menu` = 7 files / 72 tests, incl. 39 new).
- `vitest run packages/kit/src` → 31 files / 477 tests passed (untouched, no regression).
- `npm run typecheck -w apps/ui` → clean. `npm run lint` → clean. `npm run format:check` → clean.

### Known limits

The stubbed e2e does **not** assert the highlight after `POST /api/threads`: the stub
pushes no invalidation, so the parent never refetches its anchors — the same split
`anchors.spec.ts` documents. That half is proved above against the real server instead.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
