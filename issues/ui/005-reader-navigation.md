# [UI-005] Reader, navigation stacks, doc menu, focus shell, lock banner

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus — the interaction model is pinned by the prototype and SPEC.md §11 (per-column reader, nav stack semantics, menu contents, lock banner); the open questions are all answered, leaving careful implementation.

## Dependencies

- Depends on: UI-003, UI-004
- Blocks: UI-006, UI-008

## Spec References

- SPEC.md §11 — "Per-column reader" (clicking a row opens the document _in that column_; the column widens; each reader keeps its own navigation stack and offers focus mode)
- SPEC.md §11 — "Document view" (frontmatter editable as a small form; `[[refs]]` render the target's current title; backlinks panel "referenced by"; ⋯ menu with Archive, Delete (user-only, explicit confirm), Resolve/Reopen for threads; locked documents render read-only with a banner and Force unlock)
- SPEC.md §11 — "Navigation history" (following refs, backlinks, or thread-context links pushes; Back pops with scroll position restored; the reader exits to its list only when the stack empties, with a shortcut to jump straight back)
- SPEC.md §5 — inline references (`[[id]]`, alias form `[[id|as text]]`, unresolved refs render visibly broken)
- SPEC.md §7 — "Document locks" (agent-held lock ⇒ read-only + banner naming the holder; Force unlock breaks it, is recorded in the audit trail, and re-queues the agent's deferred edit; lock state is projected and broadcast over SSE)
- SPEC.md §9.2 — `GET /api/docs/:id`, `PUT /api/docs/:id`, `DELETE /api/docs/:id` (user-only), `POST /api/threads/:id/resolve|reopen`, lock-break endpoint
- SPEC.md §15 M3/M4 — the reader's executable checks (⋯ menu, `[[` refs render as titles and backlinks list the referrer; agent-held lock renders read-only, force unlock breaks it)
- `design/index.html` — **authoritative look & feel** (`.col.reading`, `.reader`, `.reader-head`, `.back`, `.reader-id`, `.comments-btn`, `.comments-pop`, `.cp-item`, `.expand`, `.fm-chips`, `.doc-title`, `.doc-body`, `.ref`, `.backlinks`, `.lock-banner`, `.focus`, `.focus-head`, `.focus-inner`)

## Summary

Make columns readable. Clicking a row opens the document **in that column** — the column widens from 336px to 560px and the reader replaces the list — with the prototype's reader head (back button labeled with the previous document's title, mono doc id + "git ✓", save-chip slot, 💬 comments popover, ⋯ menu, ⤢ focus), a frontmatter chip strip plus an editable frontmatter form, a read-only markdown body with working `[[ref]]` links and a "Referenced by" backlinks panel, a per-column navigation stack with scroll restoration, a full-viewport focus-mode shell with its own stack and esc precedence, and the sepia lock banner with Force unlock, driven live by the lock projection over SSE. The rich editor (TipTap, autosave, selection-comment toolbar) is UI-006's; the full thread UI is UI-008's — this issue ships the read path and the shell they slot into.

## Acceptance Criteria

- [ ] Clicking a row opens that document in **its own column**: the column gets the `.reading` state (width `560px` with the `0.25s` width transition), the list and the header chip row hide, and the reader shows.
- [ ] Multiple columns can have different documents open simultaneously and independently (the wide-screen workflow in SPEC.md §11).
- [ ] Reader head matches the prototype: `.back` accent button, `.reader-id` mono `<docId> · git ✓` pushed right, a `.save-chip` slot (empty here; wired by UI-006), a `.comments-btn` (`💬 n`, hidden when the doc has no threads), a `⋯` document-menu button, and a `⤢` focus button.
- [ ] The back button is labeled with the **previous document's title** when the nav stack has depth (`‹ Mortgage options`) and with the **column's title** when it does not (`‹ Finance`); its `title` attribute documents the shift-click behavior.
- [ ] Shift-clicking Back (and the documented keyboard shortcut) clears the stack and returns straight to the list.
- [ ] The 💬 popover lists the document's threads as a serif-italic quote line plus a mono meta line (`n turns · <last author/time> · <status>`); selecting one expands that thread's slot in the body, smooth-scrolls to it, and flashes a `--signal` border on it for ~1.2 s.
- [ ] The ⋯ menu renders, in order: **Still current** (sets `reviewed: now`), **Resolve/Reopen** (thread documents only, label reflecting current status), **Archive**, **Copy for Google Docs** (rendered but explicitly marked out of scope for v1 — inert with an explanatory sub-label), **Delete** (rendered in `--signal`, labeled user-only, requiring two clicks: the item re-labels to "Really delete? Click again" before firing `DELETE /api/docs/:id`).
- [ ] Frontmatter renders as the `.fm-chips` strip (type · folder · `#tags` · status · `updated` and author) **and** is editable through a small form covering title, tags, status, and due, persisting via `PUT /api/docs/:id`.
- [ ] The body renders with `react-markdown` + `remark-gfm` in the prototype's serif `.doc-body` treatment (15px/1.62, max 62ch) — read-only in this issue; UI-006 replaces this path with TipTap.
- [ ] `[[doc_id]]` refs render as `.ref` links showing the target's **current title**; the alias form `[[doc_id|as text]]` renders the alias; an unresolved ref renders visibly broken (distinct, non-clickable treatment) rather than as raw text or a dead link.
- [ ] A "Referenced by" backlinks panel renders below the body from the `references:` query, each entry showing the referrer's type glyph and title and being clickable.
- [ ] Each column keeps its own navigation stack of `{ docId, scrollY }`: following a `[[ref]]`, a backlink, or a thread-context link **pushes**; Back **pops** and restores the previous scroll position exactly; popping the last entry exits to the list.
- [ ] Nav stacks and open readers persist in browser-local state (the localStorage owned by UI-003) and are restored on reload — including scroll positions.
- [ ] Focus mode (`⤢`) opens a full-viewport overlay with its own head (back/close, an "esc closes" mono hint, doc id, save chip, 💬, ⋯), a 66–76ch measure (`.focus-inner` max 76ch, `.focus .doc-body` max 66ch at 16.5px/1.7), and **its own navigation stack** independent of the column's.
- [ ] Escape precedence is explicit and correct: an open popover/menu closes first, then focus mode, then the column reader — matching SPEC.md §11's keyboard scheme.
- [ ] Thread-type documents render their conversation as the document body (turns with author/timestamp), so a thread opened from a column is readable; the full thread UI (composer, forms, attachments, per-turn actions) is UI-008's.
- [ ] A locked document renders the sepia `.lock-banner` — pulsing sepia dot, "**agent is editing** — `<note>` · document is read-only", and a **Force unlock** button — and its editable surfaces (title, frontmatter form) are disabled while locked.
- [ ] Force unlock calls the server's lock-break endpoint; on success the banner clears, the document becomes editable, and a toast states the break was recorded in the audit trail and the agent's deferred edit was re-queued.
- [ ] Lock banners appear and clear **live** via the SSE-driven lock projection, in every column showing that document, with no reload.

## Technical Design

### Files to Create/Modify

- `apps/ui/src/reader/Reader.tsx` + `Reader.css` — the in-column reader (head + scroll area)
- `apps/ui/src/reader/ReaderHead.tsx` — back / id / save-chip slot / 💬 / ⋯ / ⤢
- `apps/ui/src/reader/useNavStack.ts` (+ test) — per-surface `{ docId, scrollY }` stack: push, pop, popToList, scroll capture/restore
- `apps/ui/src/reader/DocView.tsx` — frontmatter chips + title + body + backlinks (shared by column reader and focus mode)
- `apps/ui/src/reader/FrontmatterForm.tsx` (+ test) — title/tags/status/due editing via `PUT`
- `apps/ui/src/reader/CommentsPopover.tsx` (+ test) — thread list, select-and-scroll, flash
- `apps/ui/src/reader/DocMenu.tsx` (+ test) — the ⋯ menu incl. two-click delete arming
- `apps/ui/src/reader/LockBanner.tsx` (+ test) — banner + force unlock
- `apps/ui/src/reader/FocusMode.tsx` + `FocusMode.css` — full-viewport overlay shell with its own stack
- `apps/ui/src/reader/useEscapeStack.ts` (+ test) — layered escape precedence
- `packages/kit/src/markdown/MarkdownView.tsx` (+ test) — `react-markdown` + `remark-gfm` with the `[[ref]]` plugin (kit-owned; SPEC.md §10 names `MarkdownView` as part of the kit contract)
- `packages/kit/src/markdown/refs.ts` (+ test) — parse `[[id]]` / `[[id|alias]]`, resolve titles, mark unresolved
- `packages/kit/src/index.ts` — export `MarkdownView` and the ref helpers
- `apps/ui/src/board/Column.tsx` — mount the reader in the `.reading` state
- `apps/ui/e2e/reader.spec.ts` — Playwright

### Key Implementation Details

**One reader, two hosts.** `DocView` renders the document; the column reader and focus mode are two hosts that differ only in chrome and measure. Do **not** fork the rendering logic — SPEC.md §11 requires them to behave identically (same menu, same 💬, same refs), and UI-006 will replace the body renderer in exactly one place.

**Nav stack.** `useNavStack(surfaceKey)` mirrors the prototype's `state.nav`: an array of `{ docId, scrollY }`. On navigating away, write the current scroll into the top entry, then push. On Back, pop and re-render with `restore: true` so the scroll is applied after content mounts (a layout effect, not a timeout — the content is available synchronously from the query cache in the common case; when it is not, restore once the query resolves). Focus mode holds a **separate** stack (the prototype's `state.focusNav`), because entering focus from a column and navigating there must not rewrite the column's history.

**Ref rendering.** A remark plugin (or a post-render text transformer, but a plugin is cleaner) turns `[[id]]` / `[[id|alias]]` into a link node carrying the id. Title resolution comes from the projection — batch the lookups for a body rather than firing one query per ref. Unresolved refs get a distinct treatment (dotted/struck, `--ink-3`, non-interactive, `title` explaining the target does not exist yet); per SPEC.md §5 this is legitimate, not an error state.

**Backlinks.** `useDocs({ references: docId })` per SPEC.md §9.2, rendered as `.backlinks` with the `Referenced by` mono heading. Clicking a backlink pushes onto the nav stack like any ref.

**Doc menu.** Ported from the prototype's `toggleDocMenu`/`docMenuAction`, reusing the `.comments-pop` popover styling with `.cp-item` rows (bold action line + mono explanation line). Delete arms on first click by rewriting the item's own labels — the same "arm then confirm" idiom the prototype uses for turn deletion — and only the second click issues `DELETE`. Deletion is user-only (SPEC.md §7/§9.2): label it as such. **Copy for Google Docs** appears (the prototype shows it) but is inert with a sub-label naming it a later plugin (SPEC.md §13) — it must not silently do nothing without explanation.

**Lock banner.** Read from `useLocks()`; a lock entry for the open document ⇒ banner + read-only. The banner text uses the lock's note ("what it's doing" per SPEC.md §7). Force unlock hits the lock-break endpoint; the success toast should say the break was recorded and the deferred edit re-queued (matching the prototype's copy) — this is honest only if SERVER's break endpoint does that, so surface the server's response rather than asserting it blindly on failure.

**Focus mode shell.** `position: fixed; inset: 0; z-index: 35`, background `--bg`, its own head. Opening captures the source surface so closing returns there. Margin threads (Docs-style, `.focus-inner.with-margin`) are UI-008's concern; ship the grid seam but render the collapsed/inline path for now.

**Escape precedence.** Implement as a small registry (`useEscapeStack`) where each layer registers a handler on mount and the topmost consumes the key. Hard-coding `if (menuOpen) … else if (focusOpen) …` inside a global handler will not survive UI-008/UI-009/UI-010 adding more layers.

**Read state.** Opening a document marks **it** seen (SPEC.md §7: displayed content only). Opening a parent document must **not** mark its collapsed-chip threads seen — that rule is enforced here and verified by UI-004's aggregate unread badge.

**Scope boundaries.** No TipTap, no autosave, no selection toolbar (UI-006). No thread composer, forms, attachments, or per-turn deletion (UI-008). No search overlay or omnibox (UI-009). Leave the save-chip slot present but empty.

### Edge Cases

- **Document deleted or archived while open** (by the agent, over SSE) — the reader shows a clear "this document no longer exists / was archived" state and offers Back; it must not render stale content indefinitely or throw.
- **Nav stack referencing a deleted document** on restore — drop the entry and continue popping rather than rendering an error.
- **Deep nav stack then Back to list** — shift-click clears the whole stack in one act; verify no intermediate scroll restorations flash.
- **Scroll restoration before content is measured** — restore in a layout effect after the body renders; if the body's height changes (images, backlinks loading), do not re-restore and yank the user.
- **Self-referential ref** (`[[thisDoc]]`) — pushes a stack entry for the same document; Back must still work (do not de-duplicate into a no-op that strands the user).
- **Ref to a thread** (`[[th_…]]`) — legitimate per SPEC.md §5; opens the thread document in the reader.
- **Lock acquired while the user is mid-edit of the frontmatter form** — disable the form and warn; do not silently discard typed values.
- **Force unlock fails** (lock already released, server error) — toast the failure and refresh lock state; never leave the UI claiming a lock was broken when it was not.
- **Same document open in two columns** — both readers show it, both show the lock banner, and both must reflect edits/lock changes live; nav stacks stay independent.
- **Focus mode over a column reader, then Back past the stack bottom** in focus — closes focus and returns to the underlying column, which retains its own position.
- **Thread document opened directly from a column** — the reader shows the conversation as the body, and the ⋯ menu shows Resolve/Reopen instead of nothing.
- **Very long documents** — the reader's scroll container (not the page) scrolls; the board itself must never scroll vertically.
- **Popover positioning near the viewport edge** (a column at the right edge of the board) — clamp the 💬 and ⋯ popovers into the viewport.

## Testing Strategy

Vitest + React Testing Library in `apps/ui` and `packages/kit`:

- `useNavStack`: push/pop/popToList semantics; scroll is captured on push and returned on pop; popping the last entry signals "exit to list"; entries for missing documents are skipped on restore.
- `ReaderHead`: back label is the previous document's title with a deep stack and the column title with an empty one; shift-click triggers pop-to-list; 💬 is hidden when there are no threads and shows the count when there are.
- `refs`: `[[doc_1]]` renders the resolved current title; `[[doc_1|alias]]` renders the alias; `[[doc_missing]]` renders the broken treatment and is not a link; a body with many refs resolves titles in one batched lookup.
- `MarkdownView`: GFM tables/task lists render; raw HTML is not injected (sanitization); ref nodes call the navigation callback with the id.
- `FrontmatterForm`: editing title/tags/status/due issues a `PUT` with only the changed fields; the form is disabled when the document is locked.
- `DocMenu`: item set differs for thread vs. note documents; the Resolve item reflects current status; the first Delete click only re-labels, and the second issues `DELETE`; Copy-for-Google-Docs is inert and labeled out of scope.
- `CommentsPopover`: renders quote + `n turns · last · status` per thread; selecting one invokes the expand+scroll callback for that thread id.
- `LockBanner`: renders the holder's note; Force unlock calls the break endpoint; a failed break surfaces an error and keeps the banner.
- `useEscapeStack`: with a menu, focus mode, and a reader all mounted, successive Escapes close them in that order.
- Read state: opening a document marks it seen; opening a parent does not mark its threads seen.

## E2E Verification Plan

Against the **real running application** — this covers several of SPEC.md §15 M3's and M4's checks.

### Verification Steps

1. Start the server against a seeded workspace (documents with `[[refs]]` between them, at least one thread on a document, one standalone thread, one document with an unresolved ref) and start the UI.
2. Click a row: assert the column widens to `560px`, the list hides, the reader renders, the head shows `<docId> · git ✓`, and the back button reads `‹ <column title>`.
3. Open a document in a **second** column simultaneously; assert both readers are independent (scroll one, the other is unaffected).
4. Click a `[[ref]]` in the body: assert the link text equals the target's **current title** (rename the target via `corpus doc edit` and assert the link text updates live), that the target opens in the same column, and that the back button now reads `‹ <previous doc title>`.
5. Scroll deep in the first document, follow a ref, press Back: assert the scroll position is restored to the exact prior offset.
6. Follow two refs, then shift-click Back: assert the column returns straight to its list.
7. Reload the page: assert every open reader, its nav stack, and its scroll position are restored.
8. Assert the backlinks panel lists the referring document; click it and assert it pushes onto the stack.
9. Assert the unresolved ref renders visibly broken and is not clickable.
10. Open the 💬 popover: assert it lists the document's threads with turn counts and statuses; select one and assert the page smooth-scrolls to that thread and flashes its border.
11. ⋯ menu: click **Still current** and assert `reviewed` is set on disk with `updated` untouched. Click **Archive** on another document and assert `status: archived` on disk. On a thread document, assert **Resolve** flips status on disk and the label becomes **Reopen**.
12. ⋯ → **Delete**: assert the first click only re-labels to "Really delete? Click again"; the second click removes the document (verify the file is gone and `git log` retains history). Confirm no agent path can do this (label check only).
13. Edit the frontmatter form (title, a tag, due): assert the file's frontmatter changes on disk and the change is auto-committed.
14. ⤢ focus mode: assert the overlay covers the viewport, the measure is 66–76ch, the head shows the esc hint, and navigating a ref inside focus does **not** alter the underlying column's stack. Press Escape: assert focus closes and the column reader is unchanged.
15. Escape precedence: open the ⋯ menu inside focus mode; first Escape closes the menu, second closes focus, third closes the column reader.
16. Locks (SPEC.md §15 M4): acquire an agent lock on the open document out-of-band (`corpus lock` / an agent edit). Assert the sepia banner appears **live** with the lock's note, the title/frontmatter form become non-editable, and the same banner appears in a second column showing that document. Click **Force unlock**: assert the lock file is gone, the banner clears live, editing is re-enabled, the toast reports the break, and the break is visible in the audit trail (`git log`) and console.
17. Open an unread thread from a column: assert the thread's turns render as the body and the unread badge clears; then confirm that opening a **parent document** with unseen threads does not clear their unread state.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. Must be from real E2E
testing — no mocks, no test clients. Real application, real requests, real
interfaces. Include specific commands run, actual outputs observed, and pass/fail
conclusions. State which model the implementing agent ran on ("implemented on:
opus | fable") — the audit trail for recalibrating Model recommendations. The
evaluator will reject issues without credible proof._

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

- [ ] `/audit` run (P0, large surface, includes a destructive user-only action)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-005]` prefix
