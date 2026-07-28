# [UI-005] Reader, navigation stacks, doc menu, focus shell, lock banner

## Domain

ui

## Status

done

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

- [x] Clicking a row opens that document in **its own column**: the column gets the `.reading` state (width `560px` with the `0.25s` width transition), the list and the header chip row hide, and the reader shows.
- [x] Multiple columns can have different documents open simultaneously and independently (the wide-screen workflow in SPEC.md §11).
- [x] Reader head matches the prototype: `.back` accent button, `.reader-id` mono `<docId> · git ✓` pushed right, a `.save-chip` slot (empty here; wired by UI-006), a `.comments-btn` (`💬 n`, hidden when the doc has no threads), a `⋯` document-menu button, and a `⤢` focus button.
- [x] The back button is labeled with the **previous document's title** when the nav stack has depth (`‹ Mortgage options`) and with the **column's title** when it does not (`‹ Finance`); its `title` attribute documents the shift-click behavior.
- [x] Shift-clicking Back (and the documented keyboard shortcut) clears the stack and returns straight to the list.
- [x] The 💬 popover lists the document's threads as a serif-italic quote line plus a mono meta line (`n turns · <last author/time> · <status>`); selecting one expands that thread's slot in the body, smooth-scrolls to it, and flashes a `--signal` border on it for ~1.2 s.
- [x] The ⋯ menu renders, in order: **Still current** (sets `reviewed: now`), **Resolve/Reopen** (thread documents only, label reflecting current status), **Archive**, **Copy for Google Docs** (rendered but explicitly marked out of scope for v1 — inert with an explanatory sub-label), **Delete** (rendered in `--signal`, labeled user-only, requiring two clicks: the item re-labels to "Really delete? Click again" before firing `DELETE /api/docs/:id`).
- [x] Frontmatter renders as the `.fm-chips` strip (type · folder · `#tags` · status · `updated` and author) **and** is editable through a small form covering title, tags, status, and due, persisting via `PUT /api/docs/:id`.
- [x] The body renders with `react-markdown` + `remark-gfm` in the prototype's serif `.doc-body` treatment (15px/1.62, max 62ch) — read-only in this issue; UI-006 replaces this path with TipTap.
- [x] `[[doc_id]]` refs render as `.ref` links showing the target's **current title**; the alias form `[[doc_id|as text]]` renders the alias; an unresolved ref renders visibly broken (distinct, non-clickable treatment) rather than as raw text or a dead link.
- [x] A "Referenced by" backlinks panel renders below the body from the `references:` query, each entry showing the referrer's type glyph and title and being clickable.
- [x] Each column keeps its own navigation stack of `{ docId, scrollY }`: following a `[[ref]]`, a backlink, or a thread-context link **pushes**; Back **pops** and restores the previous scroll position exactly; popping the last entry exits to the list.
- [x] Nav stacks and open readers persist in browser-local state (the localStorage owned by UI-003) and are restored on reload — including scroll positions.
- [x] Focus mode (`⤢`) opens a full-viewport overlay with its own head (back/close, an "esc closes" mono hint, doc id, save chip, 💬, ⋯), a 66–76ch measure (`.focus-inner` max 76ch, `.focus .doc-body` max 66ch at 16.5px/1.7), and **its own navigation stack** independent of the column's.
- [x] Escape precedence is explicit and correct: an open popover/menu closes first, then focus mode, then the column reader — matching SPEC.md §11's keyboard scheme.
- [x] Thread-type documents render their conversation as the document body (turns with author/timestamp), so a thread opened from a column is readable; the full thread UI (composer, forms, attachments, per-turn actions) is UI-008's.
- [x] A locked document renders the sepia `.lock-banner` — pulsing sepia dot, "**agent is editing** — `<note>` · document is read-only", and a **Force unlock** button — and its editable surfaces (title, frontmatter form) are disabled while locked.
- [x] Force unlock calls the server's lock-break endpoint; on success the banner clears, the document becomes editable, and a toast states the break was recorded in the audit trail and the agent's deferred edit was re-queued.
- [x] Lock banners appear and clear **live** via the SSE-driven lock projection, in every column showing that document, with no reload.

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

**Implemented on: opus.** Model recommendation confirmed correct — the open
questions were all answered by SPEC.md §11, `design/index.html` and sprint-010's
Orchestrator Adjudications; the two judgement calls that came up (a `Lock.note`
field that does not exist on the wire, and the reader's own ⇧esc binding) are
recorded below as escalations rather than guessed at.

### Reproduction (bugs only)

Not applicable — UI-005 is a feature, not a bug. Three defects **found during
verification** are recorded in place below (unstable `MarkdownView` callback
identity, a clamped scroll restore on a cold reload, an unimplemented `⇧esc`),
each with its pre-fix observation.

### Post-Implementation Verification

#### The real application

- Workspace: `corpus init /tmp/corpus-s010-ui005-XOkIoL --port 8962` — a real
  workspace, real git repository, 29 commits by the end of the session.
- Server: `corpus server start` → `corpus 0.0.0 listening on http://127.0.0.1:8962 (pid 42257)`;
  `corpus health` → `ok — corpus 0.0.0, up 1s, workspace /tmp/corpus-s010-ui005-XOkIoL`.
- UI: `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8962 VITE_CORPUS_TOKEN=<workspace token> npm run dev -w apps/ui -- --port 5274 --strictPort`.
- Browser: real Chromium via Playwright's `chromium.launch()`, 1500×900 (and
  900×800 for the popover-clamping case). Scripts under
  `/tmp/corpus-s010-ui005-drive/`; every mutation is checked on disk **and** in
  `git log`.
- Seed: `Mortgage options` (`doc_53v3ng24`) with `[[doc_g6cpr76g]]`,
  `[[doc_4dgjyyqk|amortization schedule]]`, `[[doc_notyet]]` (unresolved),
  `[[doc_53v3ng24]]` (self-referential), a GFM table, a task list, literal
  `<script>alert(1)</script>` / `<img src=x onerror=alert(1)>`, 60 filler
  paragraphs and a trailing `[[doc_g6cpr76g]]`; `Rates`/`Weekly rates`
  (`doc_g6cpr76g`), `Payoff table` (`doc_4dgjyyqk`), `Doomed note`
  (`doc_6mpqme7t`); an anchored thread `th_2nt7e3fd`, a whole-document thread
  `th_un46ii3u`, a standalone thread `th_hk72x4v6`; two pinned view documents
  (`Finance`, `All notes`) so two columns can read the same document at once.
- `8765` verified UNBOUND before, during and after; `5273` never held.

#### The reader in its column

- **TEST-1** — clicking a row: `col width 336 -> 560`, the sibling column
  unchanged at `336`; `transition: width 0.25s, border-color 0.3s`;
  `list hidden: true | chips hidden: true | reader visible: true`. The scaffold's
  `.reader-note` copy is gone from the tree (`ColumnReaderScaffold.tsx` deleted;
  `expect(await page.content()).not.toContain("arrives with the reader")` in
  `apps/ui/e2e/reader.spec.ts`).
- **TEST-2** — `finance reader: doc_53v3ng24 | all-notes reader: doc_4dgjyyqk`;
  scrolling one to `400` left the other at `0`; their stacks are separate keys in
  `corpus.board`.
- **TEST-3** — `.reader-head` children, in order:
  `["back","reader-id","save-chip","comments-btn","expand|data-doc-menu","expand|data-expand"]`;
  `reader-id` = `doc_53v3ng24 · git ✓`; `save-chip` text `""` (present, empty —
  UI-006's slot); `comments-btn` = `💬 2`, and absent entirely for a document
  with no threads; `aria-label`s `Document actions` / `Read full screen`; both ⋯
  and ⤢ carry class `expand`.
- **TEST-4** — empty stack: `‹ Finance`, `title="Back to list"`. With depth:
  `‹ Mortgage options` (the PREVIOUS document), `title="Back (shift-click, or ⇧esc: straight to list)"`.
- **TEST-5** — shift-click Back from a 3-deep stack: `reader count = 0 | list visible: true`,
  and the persisted stack went `["doc_53v3ng24","doc_g6cpr76g","doc_53v3ng24"] → []`
  in **one** state change (unit test `Reader.test.tsx` asserts `stacks` is exactly
  `[[]]`, so no intermediate document rendered).
  **DEFECT FOUND AND FIXED**: `⇧esc` was documented on the button but not
  implemented — pressing it popped one entry (`after ⇧esc — reader: 1`). The
  escape registry now passes the `KeyboardEvent` to the layer and `Reader` maps
  `shiftKey → toList()`. Re-verified: `after ⇧esc — reader: 0 | list: true`.
- **TEST-6** — `.reader-scroll overflowY: auto`, `.board overflowY: hidden`,
  `document.body.scrollHeight === clientHeight → true`.

#### The body, refs and backlinks

- **TEST-7** — `.doc-body` computes to `"Iowan Old Style" / 15px / 24.3px / 517.22px`
  (15 × 1.62 = 24.3; 517px = 62ch at that font — asserted as `62` exactly by
  `reader.spec.ts`'s `measureCh`). Focus mode: `16.5px / 28.05px`, `.focus-inner`
  76ch and `.focus .doc-body` 66ch. GFM: `tables= 2 th, tasklist= 2 checkboxes`.
  `react-markdown` + `remark-gfm` are dependencies of **`packages/kit`**, not of
  `apps/ui`.
- **TEST-8** — `script= 0 img= 0`, the markup visible as literal text
  (`textContent` contains `alert(1)`), `PAGE ERRORS: []`. `rehype-raw` is
  deliberately absent, so there is no sanitizer to misconfigure; `grep -rn
  dangerouslySetInnerHTML apps/ui/src packages/kit/src` → **(none)**.
- **TEST-9** — `ref text before rename: Rates`; then
  `corpus doc edit doc_g6cpr76g --title "Weekly rates" --from agent` out of band
  →`ref text after, no reload: Weekly rates`. No stored copy anywhere.
- **TEST-10** — `[[doc_4dgjyyqk|amortization schedule]]` renders
  `amortization schedule` and navigates to `doc_4dgjyyqk`.
- **TEST-11** — `[[doc_notyet]]` renders `<span class="ref-broken">`, `tag: SPAN`,
  not a link, `title="doc_notyet does not exist yet — this reference is unresolved."`.
  Nothing is logged by the app and no toast fires. (The browser itself logs
  `Failed to load resource: 404` for the probe request — a network-layer message,
  not an application log; `pageerror` stayed `[]` throughout.)
- **TEST-12 — the strategy, stated for UI-006/UI-007.** `GET /api/docs` has no
  `ids=` filter (Open Conflict 6), so ref titles resolve through **one
  cache-deduped `useDoc(id)` per distinct id**, exactly as adjudicated. Measured:
  a body with 5 ref occurrences over 4 distinct ids issued
  `GET /api/docs/doc_53v3ng24`, `/doc_g6cpr76g`, `/doc_4dgjyyqk`, `/doc_notyet`
  — 4 requests, and the second occurrence of `doc_g6cpr76g` cost nothing. A
  document already open in another reader costs nothing at all.
  **DEFECT FOUND AND FIXED**: the unresolved id was fetched **twice** (the kit's
  `retry: 1`). `createCorpusQueryClient` now never retries a `4xx` — a `404` is a
  normal answer for a legitimate unresolved ref (SPEC.md §5), not a transient
  failure. Re-measured: one request per distinct id.
- **TEST-13** — `.backlinks h3` = `Referenced by`, entry `note` + `Mortgage options`
  with `data-backlink="doc_53v3ng24"`, `max-width: 527px` (62ch). Sourced from
  **one** request: `GET /api/docs?references=doc_g6cpr76g`. Clicking it pushed
  (`back label: ‹ Weekly rates`).

#### The ⋯ menu, and the two-click delete

- **TEST-14 — the unit, named.** `DocMenu.tsx:82` calls the kit's
  `useRowActions({ id, title }, { onNotify })` for both Archive and Still
  current. `useRowActions`' subject was widened from `DocRow` to
  `Pick<DocRow,"id"|"title">` (`RowActionSubject`) so a `Doc` can be its subject;
  nothing was reimplemented.
- **TEST-15 — the invisible-failure criterion, isolated.**
  before `{"updated":"2026-07-28T06:38:54Z","reviewed":"2026-07-28T06:38:55.275Z"}`;
  after  `{"updated":"2026-07-28T06:38:54Z","reviewed":"2026-07-28T06:39:45.988Z"}`;
  `updated byte-identical: true | reviewed changed: true`. Wire:
  `PUT /api/docs/doc_53v3ng24 {"reviewed":"2026-07-28T06:39:45.988Z"}` — that key
  and no other. `git log -1` → `user|doc edit: Mortgage options v3 (doc_53v3ng24) by user`.
- **TEST-16** — note: `["Still current","Archive","Delete…"]`. Thread document:
  `["Still current","Resolve","Archive","Delete…"]`; Resolve issued
  `POST /api/threads/th_2nt7e3fd/resolve` (**no** `PUT`), disk
  `status: resolved`, `git log -1` → `user|thread resolve: Rate assumption (th_2nt7e3fd) by user`,
  and the menu relabelled to `Reopen` live.
  **Adjudication 8 applied**: the publish-plugin items are absent — the menu text
  contains no "Google".
- **TEST-17** — first click: `Really delete? Click again` /
  `permanent · git keeps history · its threads become orphaned records`, and
  `DELETE requests so far: 0` (network log).
- **TEST-18** — unarmed sub-label `user-only · click twice to confirm`, rendered
  in `--signal` (`rgb(196, 85, 46)`). Server half verified independently:
  `curl -X DELETE /api/docs/doc_g6cpr76g -H "x-corpus-author: agent"` → **403**
  `{"code":"forbidden","message":"deletion is user-only; the agent archives, never deletes"}`,
  file untouched.
- **TEST-19** — second click: `DELETE /api/docs/doc_6mpqme7t`; file gone from
  `data/docs/finance/`; `git log -1` → `user|doc delete: Doomed note (doc_6mpqme7t) by user`;
  `git log -- data/docs/finance/doomed-note.md` still lists **3 commits**; the
  reader left the document; toast: *"Deleted "Doomed note" — user-only act; git
  retains its history. 1 thread became an orphaned record."*
- **TEST-20** — 900px viewport, board scrolled so the reading column's head sat
  at `x: -261`: both popovers measured `x: 8, width: 300`, `inside viewport: true`,
  `transform: matrix(1,0,0,1,23,0)`. `popoverShift` now clamps **both** edges
  (it originally handled only right overflow — found here, fixed, unit-tested).
  Both reuse `.comments-pop`/`.cp-item` with the bold `.cp-quote` + mono
  `.cp-meta` anatomy.

#### The 💬 popover

- **TEST-21** — `💬 2`; items
  `["“a 30-year fixed at 6.1%” || 2 turns · last: agent · open",
    "whole-document thread || 1 turn · last: user · open"]`;
  `.cp-quote` computes `font-style: italic` (serif), `.cp-meta` `ui-monospace`.
  Zero threads → the button is absent entirely and the popover's empty copy is
  the prototype's (unit-tested in `CommentsPopover.test.tsx`).
- **TEST-22** — selecting an item: `expanded: 1 | flashing: 1`,
  `border-left-color: rgb(196, 85, 46)` (`--signal`), and after 1.5 s
  `flash: 0`. The reduced-motion guard was **extended in
  `apps/ui/src/app/global.css`'s existing block** — `reader.spec.ts` asserts
  `.thread-card.flash` appears in exactly **one** `prefers-reduced-motion` rule
  in the shipped stylesheet.

#### Frontmatter

- **TEST-23** — `.fm-chips` = `["note","finance/","#finance","open","updated 2026-07-02","edit"]`
  (type · folder · #tags · status · updated), read from the document's own
  frontmatter. **Divergence, recorded**: the AC also asks for an *author* chip;
  `DocFrontmatter` carries no author field — git is the audit trail — so no
  author chip is rendered rather than an invented one.
- **TEST-24** — title, a tag, status and due edited, then Save: **one** request,
  `PUT /api/docs/doc_53v3ng24 {"tags":["finance","mortgage","rates"],"status":"resolved","due":"2026-11-15"}`.
  On disk those three changed; `id`, `type`, `created`, `evergreen` and
  `reviewed` byte-identical. `git log -1` → `user|doc edit: … by user`. Toast:
  *"Saved — tags, status, due updated and committed."*
- **TEST-25** — with an agent lock held: `title read-only in both columns: true / true`;
  every `.fm-form` control `disabled: [true, true, true]`. Lock landing
  mid-edit: the draft is **kept**, Save is disabled, and the banner reads
  *"unsaved — the document was locked while you were editing; your changes are
  kept here"* (unit-tested in `FrontmatterForm.test.tsx`).

#### Navigation stack and persistence

- **TEST-26** — scrolled to `844` (the bottom), followed a tail `[[ref]]`
  (`scroll now: 0`), pressed Back → `restored: 844 | exact: true`. After the
  backlinks and thread chips resolved 1.2 s later: `still at 844`.
- **TEST-27** — refs, backlinks (`data-backlink`) and the thread-context link all
  call the one `onNavigate` seam in `DocView`; popping the last entry closed the
  reader and revealed the list.
- **TEST-28** — the self-referential `[[doc_53v3ng24]]`: back label became
  `‹ Mortgage options` (an entry was pushed), Back returned to the same document,
  a second Back exited.
- **TEST-29** — `[[th_2nt7e3fd]]` in `Weekly rates`' body opened the thread:
  `reader: th_2nt7e3fd | conversation turns: 2 | authors: ["user","agent"]`, and
  its ⋯ menu showed `["Still current","Resolve","Archive","Delete…"]`.
- **TEST-30** — stored blob, verbatim:
  `{"version":2,"columns":{"doc_6miwp53k":{"scroll":0,"nav":[{"docId":"doc_53v3ng24","scrollY":844},{"docId":"doc_g6cpr76g","scrollY":0}]},"doc_bsd3refz":{"scroll":0,"nav":[{"docId":"doc_4dgjyyqk","scrollY":0}]}}}`
  — `BOARD_STATE_VERSION` 1 → 2 (Open Conflict 8's accepted discard), and **no**
  query, order, column identity, title or document content. After reload both
  readers, both stacks and, on popping, the scroll offset `844` were restored.
  **DEFECT FOUND AND FIXED**: on a cold reload the restore clamped to `694`,
  because the backlinks panel and thread chips arrive after the body and the
  container was ~150px shorter than when the offset was recorded. Restoration now
  **converges** — it re-applies while the target is still out of reach and stops
  the instant the reader moves on its own, which is what "do not re-restore and
  yank the user" actually requires. Re-verified: `popped to: doc_53v3ng24 scroll: 844`.
- **TEST-31** — a restored stack `[doc_53v3ng24, doc_deletedmeanwhile, doc_g6cpr76g]`:
  Back from the top went straight to `doc_53v3ng24`, `gone-card: 0`, and the
  stored stack afterwards was `doc_53v3ng24`. No error card, no throw,
  `PAGE ERRORS: []`.

#### Focus mode and escape precedence

- **TEST-32** — `.focus` computes `position: fixed | inset 0px | z-index 35 |
  background rgb(247,246,243)` (`--bg`); `.focus-inner` 646px = **76ch**,
  `.focus .doc-body` 606px = **66ch** at `16.5px / 28.05px`. Head:
  `["back:✕ Close","back:‹ Finance","focus-hint:esc closes","reader-id:doc_53v3ng24 · git ✓","save-chip:","comments-btn:💬 2","expand:⋯"]`,
  `role="dialog"`. **Open Conflict 11 applied**: the hint is `esc closes` alone —
  the prototype's "· click anywhere to edit" arrives with UI-006.
- **TEST-33 — one DocView, two hosts.** `grep -rn "<DocView" apps/ui/src` →
  `Reader.tsx:115` and `FocusMode.tsx:100`, nothing else.
  `grep -rn MarkdownView apps/ui/src` → **one** document-body call site,
  `DocView.tsx:102`, plus `Turns.tsx:47` for turn bodies. UI-006 replaces the
  document body in exactly one place.
- **TEST-34** — column stack before focus `doc_53v3ng24`; entered focus, followed
  a ref inside it (`focus now shows: Weekly rates`, focus back `‹ Mortgage options v3`);
  column stack after: **`doc_53v3ng24`, unchanged**, and the column reader still
  showed `doc_53v3ng24`. Back past the bottom of the focus stack closes focus
  (unit-tested) rather than stranding an empty overlay.
- **TEST-35 — a registry, not a chain of ifs.** With a column reader, focus mode
  over it and a ⋯ menu open inside focus:
  esc#1 → `menu: 0, focus: 1, reader: 1`;
  esc#2 → `focus: 0, reader: 1` (column reader unchanged, still `doc_53v3ng24`);
  esc#3 → `reader: 0, list visible: true`.
  `useEscapeStack.ts` is a module-level registry keyed on
  `EscapeLayerPriority` (Reader 0 · Focus 10 · Overlay 20 · Popover 30) then
  mount order; UI-009's overlay and UI-010's composer join by calling
  `useEscapeLayer` — no conditional to edit. The listener is on the **capture**
  phase and skips editable targets, so a field's own Escape (revert draft) still
  wins and `⌫` never eats a character.

#### Locks

- **TEST-36** — the same document open in two columns, then
  `corpus lock acquire doc_53v3ng24 --from agent` out of band: **2 banners**
  appeared live with no reload, text *"agent is editing — holding the edit lock,
  started just now · document is read-only"*, dot `rgb(169,131,75)` (`--sepia`),
  banner `rgba(169,131,75,0.08)` (`--sepia-wash`). An out-of-band `lock break`
  cleared both live (`banners: 0`); a re-acquire brought both back.
  **ESCALATION (contract gap)**: the prototype's banner names *what the agent is
  doing*, but `Lock` on the wire is `{docId, holder, acquired, ttl}` — **there is
  no `note` field**. Rather than invent a sentence, the banner states the two
  facts it has (who, and since when). A `Lock.note` rider — same shape as
  CONTRACT-012's `Job.type` — would make the prototype's copy true.
- **TEST-37 — both of the toast's claims, verified independently.**
  Response: `200 {"docId":"doc_53v3ng24","released":true,"holder":"agent"}`.
  `.corpus/locks/doc_53v3ng24.json` gone. Banners cleared in **both** columns
  live. Title editable again. Toast: *"Lock broken — agent's lock on
  doc_53v3ng24 was force-released. The break is recorded in the audit trail and
  the agent's deferred edit was re-queued."*
  Claim 1 — `git log -1` → `user|lock: force-break on doc_53v3ng24 (was agent) by user`.
  Claim 2 — with a deferred edit registered on the lock:
  `queue before Force unlock: {"pending":[],"inProgress":["evt_3tr246onzkc4.json"]}`;
  `queue after  Force unlock: {"pending":["evt_3tr246onzkc4.json"],"inProgress":[]}`.
- **TEST-38** — lock released behind the UI's back and the break answered `404`:
  toast *"Force unlock failed — POST /api/locks/{docId}/break failed (HTTP 404):
  no lock on that document. The lock state has been refreshed."*, tone `error`,
  and the UI never claimed a break.

#### Read state, live changes, and thread bodies

- **TEST-39 — SPEC.md §7's asymmetry, both halves.** Parent document open, both
  its threads unread: `seen calls with the parent open: 0`, and the wire still
  said `[["th_2nt7e3fd",true],["th_un46ii3u",true]]`. Expanding one chip:
  `POST /api/threads/th_2nt7e3fd/seen`, and the wire became
  `[["th_2nt7e3fd",false],["th_un46ii3u",true]]` — that thread only. Opening a
  thread *document* in the reader also posts `seen` once
  (`["POST /api/threads/th_2nt7e3fd/seen"]`).
- **TEST-40** — a thread opened from a column renders its conversation as the
  body: `2 turns`, authors `["user","agent"]` with timestamps. No composer, no
  per-turn delete, no attachment controls — UI-008's, absent rather than
  half-built.
- **TEST-41** — `corpus doc archive` on the open document → `.archived-banner`
  appeared live: *"This document is archived — it is hidden from default lists.
  Archiving is reversible…"*. Then `corpus doc delete` → `.reader-gone`:
  *"This document no longer exists — doc_4dgjyyqk was deleted. Its history is
  still in git…"*, with Back still offered. `PAGE ERRORS: []` throughout.
- **TEST-42** — `corpus doc edit --title "Mortgage options (agent-edited)" --from agent`
  out of band while the reader was open at scroll `300`:
  `title now: Mortgage options (agent-edited) | scroll kept: 300`, no reload.

#### Defects found by this verification (all fixed, all covered by new tests)

1. **`MarkdownView` re-rendered its whole tree on every host re-render.** An
   inline `onOpenRef` (every host passes one) changed `components`' identity, so
   `react-markdown` replaced every `<a>` in the body — and a click already in
   flight landed on a detached node. Observed as a ref click that simply did
   nothing whenever a second column was also open. The callback now lives in a
   ref and `components`/`remarkPlugins` are built once; regression test
   *"keeps the rendered body's DOM nodes across a host re-render with a new callback"*.
2. **Scroll restoration clamped on a cold reload** (TEST-30 above).
3. **`⇧esc` was documented and not implemented** (TEST-5 above).
4. **A pending debounced scroll capture could stamp the previous document's
   offset onto the new one** after a navigation; the restore now cancels it.
5. **`popoverShift` handled only right overflow** (TEST-20 above).
6. **A `404` cost two requests** (TEST-12 above).

#### Checks

- `npm run lint` — clean (ESLint, 0 errors, 0 warnings).
- `npm run format` — clean.
- `npm run typecheck` — clean in every workspace.
- `VITEST_MAX_THREADS=4 node node_modules/.bin/vitest run apps/ui packages/kit` —
  **56 files / 697 tests, all passing** (baseline for these two workspaces at the
  branch tip: 42 files / 562 tests → **+14 files, +135 tests**).
- `CORPUS_UI_PORT=5274 npm run e2e` — **25 passed** (baseline 20; `reader.spec.ts`
  adds 5), with `8765` unbound throughout so `smoke.spec.ts`'s
  `"server unreachable"` assertion holds unmodified.
- Cleanup: `corpus server stop` (pid 42257); dev server killed by pid;
  `8765, 8960–8964, 5273, 5274` all verified `free`; no orphaned vitest,
  Playwright or Vite children.

#### What UI-006 / UI-007 / UI-008 / UI-009 inherit

- **Kit surface added** (`packages/kit/src/index.ts`): `MarkdownView` (+
  `@corpus/kit/markdown.css`), `parseRefs`, `refIds`, `remarkCorpusRefs`,
  `splitTextNode`, `REF_PATTERN`/`REF_ID_ATTRIBUTE`/`REF_ALIAS_ATTRIBUTE`/`REF_NODE_TYPE`,
  `useDeleteDoc`, `useSetThreadStatus`, `useMarkThreadSeen`, `useBreakLock`,
  and the `RowActionSubject` widening of `useRowActions`. `CorpusClient` gained
  `deleteDoc`, `resolveThread`, `reopenThread`, `markThreadSeen`, `breakLock`.
- **The body-render seam**: `apps/ui/src/reader/DocView.tsx:102` — the single
  `MarkdownView` call site for a document body, rendered by both hosts.
- **The escape registry**: `apps/ui/src/reader/useEscapeStack.ts` —
  `useEscapeLayer({ active, priority, onEscape })` with `EscapeLayerPriority`;
  UI-009's overlay registers at `Overlay` (20) and needs no conditional.
- **Board local state**: `ColumnLocalState` is now `{ scroll, nav: NavEntry[] }`
  with `openDocId(state)`; `BOARD_STATE_VERSION = 2`.
- **Ref-resolution strategy** (for UI-006/UI-007): one cache-deduped `useDoc`
  per distinct id, no retry on `4xx`.

### Addendum — sprint-010 evaluator fixes (2026-07-28)

**Implemented on: opus.**

Six items from `issues/evals/sprint-010-cross-issue-eval.md` (FAIL-1, FIND-2)
and `issues/evals/UI-005-eval.md` (FAIL-1, FIND-2/3/4). Verified against a real
`corpus init` workspace on **8960**, the **production-served** board
(`corpus server start` → `http://127.0.0.1:8960/`, SERVER-024's injected token,
no Vite), real headless Chromium at 1440×900, with every mutation issued through
the real UI or the real CLI/HTTP API. Scratch: `/tmp/corpus-s010fix-*`.

1. **TEST-116 — the aggregate unread pill (the FAIL).** `Row` gated its badge on
   `row.unread === true`, which is `null` on a document row by contract, so
   `unreadThreads` rode every row and drew nothing. The decision now lives in
   `unreadBadgeProps(row, override)` (`packages/kit/src/row/badges.tsx`, exported
   from the kit so a plugin's `ListItem` cannot re-create the bug): a thread row
   keeps its `unread`-flag badge, a document row draws `unreadThreads > 0` with
   the count, and the two branches are exclusive — **never both**. No call site
   changed; every host that renders a `Row` gets the aggregate.

   **The observable, end to end.** Note `doc_hdnfod6p` with 2 unread threads:

   ```
   wire  GET /api/docs?folder=finance → doc_hdnfod6p  unread=null  unreadThreads=2
   DOM   <span class="unread" aria-label="2 unread threads" title="2 unread threads">2</span>
   ```

   Clicked one of its threads' rows (`th_iihrss3v`) → exactly one write,
   `POST /api/threads/th_iihrss3v/seen`; back to the list:

   ```
   wire  unreadThreads=1
   DOM   <span class="unread" aria-label="1 unread thread" title="1 unread thread">1</span>
   ```

   `performance.getEntriesByType("navigation").length` **unchanged across the
   whole act (0 reloads)**, `pageerror` list `[]` — the invalidation on `["docs"]`
   + the parent's docKey repaints it. Thread rows in the same columns: the two
   still-unread ones carry exactly **1** pill each (`new`), the two seen ones
   carry **0**. The singular label is real: "1 unread thread", not "1 unread
   threads".

2. **TEST-18 — Delete's sub-label.** `.cp-danger .cp-meta { color: var(--signal) }`
   (`apps/ui/src/reader/Reader.css`). The prototype colours only the item's label
   because there the sub-label is decoration; here it carries the two facts that
   make Delete different from every other item, and `--ink-3` read as the same
   muted footnote as "reversible — hidden from default lists". Measured in the
   browser: `--signal` `#c4552e`; delete `.cp-quote` **rgb(196, 85, 46)**, delete
   `.cp-meta` **rgb(196, 85, 46)**, Archive's `.cp-meta` still
   **rgb(155, 161, 168)** (`--ink-3`). jsdom applies no stylesheet, so the rule
   itself is asserted in `DocMenu.test.tsx` the way `theme.test.ts` asserts
   `index.html`.

3. **FIND-2 — the force-unlock toast's requeue claim.** `ReleaseLockResult` is
   `{docId, released, holder}` — there is no field to make the clause conditional
   *on*, so the claim is gone rather than guessed. Observed verbatim in the
   browser after `corpus lock acquire doc_hdnfod6p --from agent` → Force unlock:
   *"Lock broken — agent's lock on doc_hdnfod6p was force-released. The break is
   recorded in the audit trail."* Both banners cleared, no reload. Restoring the
   clause needs a response field, not a sentence in the UI.

4. **UI-009 FIND-1 — omnibox create omits `folder`.** `creationRequest` now
   always sends it, using the contract's own `DEFAULT_DOC_FOLDER` (so the
   decision is *named* at the call site, not copied). ⌘K → typed a title →
   clicked the create row, whose copy reads *"＋ Create "…" — opens ready to
   edit, in inbox/"*; the request body was
   `{"type":"note","title":"…","folder":"inbox"}`.

5. **FIND-3 — a non-id `[[token]]` rendered as a live link.** Kit's `REF_PATTERN`
   is now the server's candidate grammar character for character, and each
   candidate is validated against the contract's `DocumentIdSchema` — the same
   two-step `apps/server/src/core/refs.ts` uses, so no client recognises more
   tokens than the corpus records. A rejected candidate does not move the split
   cursor, so it stays inside its text run. Body
   `"A mortgage overview. See [[not-a-real-doc]] and [[doc_notyet]] and [[not an id]]."`
   renders: `a.ref` count **0**, `.ref-broken` = `["doc_notyet"]` (unchanged), and
   the literal text `[[not-a-real-doc]]` and `[[not an id]]` in the body. Zero
   `GET /api/docs/{id}` for the non-ids.

6. **FIND-4 — "every toast renders as two identical DOM nodes".** Measured with
   one toast up: `.toast` → **1**, `.toast-wrap` → **1**, `[class*="toast"]` →
   **2**, and node A `contains` node B. The finding's two nodes are the wrapper
   and its single child — a `[class*=…]` probe matches both, and their
   `textContent` is identical whenever exactly one toast is up. A `MutationObserver`
   over `document.body` recorded **no** repeated insertion, and with two distinct
   notices up the counts were `.toast` 2 / `[class*="toast"]` 3 (N notices → N+1
   matches). **There was no double mount.** There *was* a real duplicate one layer
   down: each `.toast` carried `role="status"` inside the wrapper's
   `aria-live="polite"` — a live region nested in a live region, announced by its
   own region and again by its ancestor. The wrapper is now the only live region
   (`aria-live="polite" aria-atomic="false"`, no `role`, so the console strip's
   `role="status"` stays unambiguous); measured in the browser:
   `.toast-wrap [aria-live], [role=status], [role=alert]` → **0**. Pinned by
   `Toasts.test.tsx` → *"one notice, one node"*, including under `StrictMode`.

**Checks.** `npm run lint` clean · `npm run format:check` clean ·
`npm run typecheck` clean across all workspaces ·
`VITEST_MAX_THREADS=4 vitest run apps/ui packages/kit` → **71 files / 963 tests,
all passing** (from 68 files / 940 tests before these fixes: +23 tests). Repo-wide
suite, coverage and e2e left to the orchestrator's harvest gate.

**Not fixed — found while verifying, needs its own issue.** The ⋯ menu's
**Still current**, **Archive** and **Resolve** perform their mutation and then
call `onClose()` synchronously, which unmounts `DocMenu` before the request
settles; TanStack v5 drops a `mutate()` call's `onSuccess`/`onError` when the
observer is torn down, so **none of those three ever reaches the toast surface**.
Observed: clicking "Still current" issued
`PUT /api/docs/doc_hdnfod6p {"reviewed":"2026-07-28T16:23:36.536Z"}` and produced
**zero** toasts over 3 s (`.toast` → 0 throughout). Delete is unaffected because
it closes *inside* `onSuccess`. This is a silent committed write, which
`Toasts.tsx` names as the one interaction that must never be silent — but the fix
changes menu-close timing, so it is reported rather than folded into this batch.

**Cleanup.** Server stopped by pid (58288, and 47745 before the rebuild);
`/tmp/corpus-s010fix-*` removed by name; `8960` free; `8765` unbound throughout;
no orphaned Chromium, vitest or Vite children.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (P0, large surface, includes a destructive user-only action)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-005]` prefix
