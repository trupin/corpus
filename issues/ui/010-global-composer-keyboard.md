# [UI-010] Global Ask/Capture composer + keyboard scheme

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus — built entirely from primitives that already exist (composer, attachments, columns, readers); the keyboard scheme is enumerated exhaustively in §11.

## Dependencies

- Depends on: UI-008, UI-009
- Blocks: INFRA-008

## Spec References

- SPEC.md §11 — **Global composer: Ask / Capture** (Ask → standalone thread `parent: null`, agent-requested, first turn is the text, "the conversation is the document"; Capture → small document in `data/docs/inbox/` plus an agent-requested whole-document filing thread; both appear on the board immediately with a pending-agent indicator; `c` opens, `↵` = Ask, `⌘↵` = Capture, `⇧↵` = newline)
- SPEC.md §11 — **Keyboard scheme (v1)**, verbatim: ⌘K search · `c` compose · `↑`/`↓` (or `j`/`k`) rows · `↵` open in column · `⇧↵` open directly in full screen · `esc`/`⌫` close/back (overlays and focus mode take precedence, then the column reader) · `←`/`→` (or `[` `]`) switch active column · `⇧←`/`⇧→` move the active column (writes the view doc's `order`) · `f` focus mode · `e` archive the open (or highlighted) document · `r` focus the reply composer of the open document's visible thread · `?` toggles the keyboard cheat-sheet overlay; **the active column follows focus/hover with a visible cue**
- SPEC.md §6 — **Attachments**: three ways into any composer, **including the global Ask/Capture composer**; composer attachments land on the created thread's first turn (Ask) or the capture's filing thread (Capture)
- SPEC.md §8 — agent participation (both actions are agent-requested; honest pending indicator)
- SPEC.md §9.2 — `POST /api/threads` (standalone: no parent), `POST /api/capture` (inbox doc + filing thread in one call)
- `design/index.html` — **authoritative look & feel** (`.btn-compose` with its `kbd`, `.compose-panel` 640px + serif 16px textarea, `.compose-actions` with `.clip`, hint, `.btn-capture` outlined vs `.btn-ask` accent-filled, `.pending-atts`; `.kbd-panel`/`.kbd-grid`/`.kbd-row`/`kbd`; `.col.kactive` cue, `.row.kbd` outline)

## Summary

Add the two remaining global surfaces: the **Ask/Capture composer** — a 640px overlay with a serif textarea (`Ask the agent anything, or capture a thought…`), full attachment support, an outlined `Capture ⌘↵` and a filled accent `Ask ↵` — and the **complete keyboard scheme** from §11, driven by a **central shortcut registry** so the `?` cheat-sheet is generated from the same source that binds the handlers and can never drift.

Both composer actions are pure compositions of existing primitives: Ask is `POST /api/threads` with no parent, Capture is `POST /api/capture`. Both results land on the board immediately with a pending-agent indicator.

## Acceptance Criteria

- [ ] The top-bar `＋ Ask / Capture` button (with its `c` kbd hint) and the `c` shortcut both open the compose overlay; focus lands in the textarea.
- [ ] The panel matches the prototype: `.overlay` scrim + `.search-panel.compose-panel` (`min(640px, 100vw - 48px)`, `12vh` top margin), a borderless serif 16px/1.55 textarea with `min-height: 110px` and the placeholder `Ask the agent anything, or capture a thought…` plus the second hint line (`@ routes to a subagent · / invokes a skill · [[ links a document · paste/drop files`), a `.pending-atts` strip, and `.compose-actions` carrying 📎, the `@ agents · / skills · [[ refs · ⇧↵ newline` hint, then `Capture ⌘↵` (outlined `.btn-capture`) and `Ask ↵` (filled `.btn-ask`).
- [ ] `↵` submits **Ask**: `POST /api/threads` with `parent: null`, `anchor: null`, `agent: requested`, and the text as the first turn. The resulting standalone thread appears on the board immediately (in the columns whose queries match it) with a pending-agent indicator, and the overlay closes with a narrating toast.
- [ ] `⌘↵` submits **Capture**: `POST /api/capture`, which creates the inbox document **and** its agent-requested whole-document filing thread in one call. Both appear on the board immediately; the document lands in `data/docs/inbox/`.
- [ ] `⇧↵` inserts a newline and never submits.
- [ ] **Attachments** work in the composer by all three routes (📎 picker, clipboard paste, drag-and-drop with the visible dropzone highlight), reusing UI-008's intake hook and `.att-chip` previews. Attachments go to the created standalone thread's first turn (Ask) or to the capture's filing thread (Capture). An attachment-only submit is allowed.
- [ ] The `@` / `/` / `[[` autocompletes from `@corpus/kit` work inside the composer textarea exactly as in the thread composer.
- [ ] A **central shortcut registry** declares every binding once as `{ keys, when, description, group, handler }`. Handlers are bound from the registry, and the `?` cheat-sheet **renders from the same registry** — adding a shortcut requires no cheat-sheet edit. A test asserts every registered shortcut appears in the rendered cheat-sheet.
- [ ] The cheat-sheet overlay (`?`) renders the prototype's `.kbd-panel`: a `Keyboard` header and a two-column `.kbd-grid` of `.kbd-row`s (a `.keys` group of `<kbd>` chips with `min-width: 92px`, then a dim description). `?` toggles it; `esc` closes it.
- [ ] **Full scheme implemented**: ⌘K search (UI-009) · `c` compose · `↑`/`↓` and `j`/`k` move the row cursor in the active column with a visible `.row.kbd` outline, scrolling the cursor into view · `↵` opens the highlighted document in its column · `⇧↵` opens it **directly in focus mode** · `esc`/`⌫` close/back · `←`/`→` and `[`/`]` switch the active column with a smooth `scrollIntoView` · `⇧←`/`⇧→` **move** the active column · `f` toggles focus mode on the open document · `e` archives the open (or highlighted) document · `r` focuses the reply composer of the open document's visible thread · `?` cheat-sheet.
- [ ] **Precedence for `esc`/`⌫`** is exactly: open overlays (search / compose / cheat-sheet) → focus mode → the column reader (pop the navigation stack; exit to the list when the stack empties). Only the topmost layer consumes the key.
- [ ] `⇧←`/`⇧→` moves the active column by **writing the view document's `order`** — reusing UI-003's reorder mechanism (the same code path as drag reorder), not a parallel implementation. The change is verifiable on disk.
- [ ] `r` focuses the reply composer of the open document's **visible** thread, **auto-expanding the first collapsed thread** when none is expanded.
- [ ] The **active column** follows keyboard focus and hover and shows the `.col.kactive` cue (`box-shadow: 0 0 0 2px var(--accent-wash), var(--shadow-soft)`).
- [ ] **Every handler is disabled inside text inputs, textareas, and `contenteditable`** (including the TipTap editor and all composers) — typing `c`, `e`, `f`, `r`, `j`, `k`, or `?` into any writing surface inserts the character. ⌘K remains active everywhere.

## Technical Design

### Files to Create/Modify

- `apps/ui/src/features/compose/ComposeOverlay.tsx` — the Ask/Capture panel
- `apps/ui/src/features/compose/useCompose.ts` — submit routing (Ask vs Capture), attachment handoff, optimistic board placement
- `apps/ui/src/features/compose/compose.css` — styles from `design/index.html`
- `apps/ui/src/features/keyboard/shortcuts.ts` — **the registry**: the single declarative list of bindings with `keys`, `when` (scope predicate), `group`, `description`, `handler` key
- `apps/ui/src/features/keyboard/useShortcuts.ts` — binds the registry to a global keydown listener with scope resolution and input suppression
- `apps/ui/src/features/keyboard/ShortcutScopeProvider.tsx` — layer stack (overlay / focus / reader / board) driving `esc` precedence and `when` predicates
- `apps/ui/src/features/keyboard/CheatSheet.tsx` — `?` overlay generated from the registry
- `apps/ui/src/features/keyboard/useRowCursor.ts` — per-column row cursor (`↑↓`/`jk`, `.row.kbd`, scroll-into-view)
- `apps/ui/src/features/keyboard/useActiveColumn.ts` — active column state from focus/hover/keyboard, `.col.kactive` cue, `←→`/`[]` switching
- `apps/ui/src/features/keyboard/keyboard.css` — `.kbd-panel`, `.kbd-grid`, `.kbd-row`, `.col.kactive`, `.row.kbd`
- `packages/kit/src/hooks/useCapture.ts` — `POST /api/capture`
- `packages/kit/src/hooks/useCreateStandaloneThread.ts` — `POST /api/threads` with `parent: null`
- `apps/ui/src/app/TopBar.tsx` — wire the `＋ Ask / Capture` button (modify)
- `apps/ui/src/features/board/useColumnOrder.ts` — expose UI-003's reorder for keyboard use (modify)
- `apps/ui/src/features/search/SearchOverlay.tsx` — register ⌘K through the registry instead of its own listener (modify)

### Key Implementation Details

**Registry shape.** Each entry: `{ id, keys: string[] (e.g. ["↑", "↓"] display + a matcher), match(e): boolean, scope: "global" | "board" | "reader" | "focus" | "overlay", allowInInput?: boolean, group: string, description: string, run(ctx): void }`. `useShortcuts` resolves the current scope stack from the provider, walks entries from the topmost scope down, and stops at the first match. `allowInInput` defaults to `false`; only ⌘K (and the overlays' own esc) set it true. The cheat-sheet maps entries → `.kbd-row`s grouped by `group`, so the rendered legend is provably complete.

**Input suppression** checks `document.activeElement` for `INPUT`, `TEXTAREA`, `[contenteditable="true"]`, and any ancestor with `[data-shortcuts="off"]` (the TipTap editor root sets this). Do not rely on `e.target` alone — ProseMirror can retarget.

**Esc precedence** falls out of the scope stack: overlays push `overlay`, focus mode pushes `focus`, an open reader pushes `reader`. `esc`/`⌫` is registered once per scope with the scope-appropriate action; the topmost registration wins. `⌫` must be suppressed in inputs (it deletes) — same guard as everything else.

**Compose submit routing.** One `submit(mode)` function; `mode` comes from the pressed key or the clicked button. Ask → `useCreateStandaloneThread` (text as first turn, `agent: requested`, attachments multipart on the first turn). Capture → `useCapture` (text + attachments; the server composes doc + filing thread). Both: close the overlay on success, toast what happened ("Asked the agent — standalone thread created" / "Captured to inbox/ — the agent will file it"), and rely on SSE invalidation to bring the new row onto the board. Optimistically insert the row into the matching columns so it appears **immediately** per §11, reconciled on refetch.

**Pending indicator** on the resulting row/thread is UI-008's component — both flows create agent-requested threads, so it appears for free; verify it does.

**`⇧←`/`⇧→` column move** calls the same `moveColumn(fromIndex, toIndex)` UI-003's drag uses, which writes the view documents' `order` frontmatter. After the move, keep the active column active and scroll it back into view.

**`r`** finds the open reader's document, looks for an expanded thread card in view; if none is expanded, expands the first collapsed thread (which also marks it seen per §7 — that is correct and intended) and focuses its composer input.

**`e`** archives via the existing archive mutation, targeting the open document when a reader is open, otherwise the row under the cursor. It toasts with an undo affordance if one already exists; otherwise it just toasts (archiving is a reversible status flip per §7).

**Styling** verbatim from `design/index.html`: `.compose-panel textarea` (serif 16px/1.55, 16/18px padding, `resize: vertical`), `.compose-actions` (surface-2, top hairline, 10/16px padding), `.btn-ask` (accent fill, `--bg` text, 8px radius, 6/16px padding, 600), `.btn-capture` (1px `--line-strong`, `--ink-2`, accent on hover), `.kbd-row kbd` (mono 10.5px, 1px `--line-strong` with a 2px bottom border, 4px radius), `.kbd-grid` (`1fr 1fr`, `2px 30px` gap).

### Edge Cases

- `c` pressed while a reader's editor has focus → the character types; the composer does not open.
- ⌘↵ inside the compose textarea when the OS/browser claims the chord → also accept `Ctrl+↵` on non-mac.
- Empty submit (no text, no attachments) → both buttons disabled; `↵` does nothing.
- Submit failure → the overlay stays open with the text and attachment chips intact plus an error toast.
- IME composition (`e.isComposing`) → never treat a composing keystroke as a shortcut or a submit.
- Repeated `?` while another overlay is open → `?` is suppressed inside inputs; when a non-input overlay is open, `?` is ignored rather than stacking overlays.
- `↑`/`↓` at the ends of a column's list → clamp (no wrap), and do not scroll the board.
- `←`/`→` at the ends of the board → clamp; `⇧←` on the first column is a no-op.
- `f` with no document open → no-op (do not open focus mode on nothing).
- `e` on a document already archived → no-op with a toast.
- `r` on a document with zero threads → no-op with a toast.
- A shortcut whose target column was removed by an SSE update mid-keystroke → resolve defensively, no crash.
- Compose overlay open + ⌘K → search replaces compose (one overlay at a time, per UI-009).
- Very long capture text (>10 KB) → posts fine; the textarea grows with `resize: vertical` as in the prototype.

## Testing Strategy

Vitest + Testing Library in `apps/ui`:

- `shortcuts.test.ts` — registry integrity: unique ids, no two entries matching the same key in the same scope, every entry has a non-empty `description` and `group`.
- `CheatSheet.test.tsx` — **generated, not hand-maintained**: every registry entry renders exactly one `.kbd-row`; adding a fixture entry makes it appear without touching the component.
- `useShortcuts.test.ts` — input suppression for `INPUT`/`TEXTAREA`/`contenteditable`/`[data-shortcuts="off"]`; ⌘K still fires inside inputs; `isComposing` ignored; scope precedence for `esc` across overlay → focus → reader → board.
- `useRowCursor.test.ts` — ↑↓ and j/k movement, clamping at both ends, `.row.kbd` on exactly one row, scroll-into-view called.
- `useActiveColumn.test.ts` — active follows hover and keyboard, `.col.kactive` applied to exactly one column, `←→`/`[]` clamping.
- `ComposeOverlay.test.tsx` — placeholder text exactness; `↵` calls Ask with `parent: null` + `agent: requested`; `⌘↵` calls Capture; `⇧↵` inserts a newline and does not submit; buttons disabled when empty and enabled with attachments only; failure keeps text and chips.
- `useCompose.test.ts` — attachment payload routes to the first turn (Ask) vs the capture call; optimistic row inserted then reconciled.
- Column-move test: `⇧→` calls the same `moveColumn` as drag reorder (assert the shared function, not a duplicate).

## E2E Verification Plan

### Verification Steps

1. Start the real stack (`npm run watch`) against a `corpus init` workspace.
2. Press `c` → the compose overlay opens; compare against `design/index.html`. Type a question and press `↵`. Expect: a toast, the overlay closes, a **standalone thread** row appears on the board immediately with a pending-agent indicator. On disk: `ls <workspace>/data/threads/` shows the new thread file with `parent: null` and `agent: requested`; `.corpus/queue/pending/` holds a `comment.created` event.
3. Press `c` again, type a thought, press `⌘↵` → Capture. On disk: a new document under `data/docs/inbox/` **and** an agent-requested whole-document thread pointing at it; both rows are on the board; the queue holds the filing event. Confirm the auto-commit in `git log`.
4. Press `c`, type text, press `⇧↵` → a newline is inserted and nothing is submitted.
5. Press `c`, paste a screenshot from the clipboard, drag a file over the panel (dropzone highlight) and drop it, and pick a third via 📎 → three chips. Submit with `↵` → the standalone thread's first turn carries all three; bytes exist under `.corpus/attachments/<threadId>/<ts>/`. Repeat with `⌘↵` and confirm the attachments land on the capture's filing thread.
6. Press `c`, type `@` → the subagent list appears (backed by `type: agent-def` documents); type `/` → skills; type `[[` → documents.
7. Keyboard sweep with no overlay open: `j`/`k` and `↑`/`↓` move the row cursor with a visible outline; `←`/`→` and `[`/`]` switch the active column with a smooth scroll and the `.col.kactive` cue; `↵` opens the highlighted document in its column; `esc` returns to the list; `⇧↵` opens directly in focus mode; `f` toggles focus mode; `e` archives (verify `status: archived` in the file); `r` focuses a thread's reply composer, auto-expanding the first collapsed thread.
8. `⇧→` on a column → the board reorders **and** `cat` the affected view documents shows updated `order` frontmatter with an auto-commit; reload the browser and confirm the new order persists.
9. `esc` precedence: with a reader open, enter focus mode, then open search. `esc` closes search → `esc` exits focus → `esc` pops the reader stack → `esc` returns to the list. Confirm each layer consumes exactly one press.
10. Click into the TipTap editor and type `c e f r j k ?` → all characters appear in the document; no shortcut fires. Repeat in the thread composer and the search input.
11. Press `?` on the board → the cheat-sheet renders every binding in a two-column grid; cross-check the list against §11's enumeration item by item. `esc` closes it.
12. Playwright: `apps/ui/e2e/compose-keyboard.spec.ts` automating steps 2, 3, 7 (subset), 8, and 10 against the real app.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. Must be from real E2E testing — no mocks, no test clients. Real application, real requests, real interfaces. Include specific commands run, actual outputs observed, and pass/fail conclusions. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Reproduction (bugs only)

_[Agent fills: exact commands, observed output, confirmation bug exists]_

### Post-Implementation Verification

_[Agent fills: application restarted, exact commands, observed output, confirmation fix/feature works]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-010]` prefix

## Corrections (orchestrator, 2026-07-28 — sprint-011 adjudications)

Binding; where this contradicts the sections above, this wins. See
`issues/sprints/sprint-011.md` → Orchestrator Adjudications for the full rulings.

- **Paths**: there is no `apps/ui/src/features/` — the domain folders are
  `editor/` (UI-006), `thread/` (UI-008), `anchors/` (UI-007), `compose/` (UI-010).
- **Attachments**: 25 MB/file, 100 MB/request; multipart's text field is `text`; `ts` path
  params are URL-encoded.
- **`requestsAgent` is tri-state**: "note only" sends explicit `false`; omitted means
  "enqueue if the agent is engaged".
- **Lock state** reads via `useLocks`/`useDocLock` + `["locks"]` keys (`DocView.tsx` is the
  example) — never from `GET /api/docs/:id`.
- **UI-010 specific**: no `ShortcutScopeProvider` — register into UI-005's `useEscapeLayer`
  chain (extend `EscapeLayerPriority` additively if needed). Compose panel and cheat sheet carry
  `.overlay.open` (the `isOverlayOpen()` DOM contract) and register at `Overlay` priority.
  `⇧↵` follows the prototype in every scope: newline in the compose textarea, save-as-view in
  search, open-full-screen on the board.
