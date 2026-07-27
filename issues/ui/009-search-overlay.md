# [UI-009] Search overlay, omnibox create, save-as-view

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus — a single-endpoint composition problem with the UX fully pinned by the prototype; no architectural ambiguity.

## Dependencies

- Depends on: UI-003
- Blocks: UI-010

> **Spec refresh (SHARED-002, 2026-07-27):** the `awaiting-reply` filter/chip was dropped in favor of `needs=form` (SPEC.md §9.2/§11 amended with PR #9). The quotes below are updated to match.

## Spec References

- SPEC.md §11 — **Search overlay** (one query input composing FTS with filter chips: type, tag, status, folder, date, due, unread, `references:`, and for threads agent participation / awaiting a form answer (`needs=form`) / parent; default excludes `status: archived`, an "archived" chip brings them back; snippet-highlighted results grouped by type; **"Save as view"** pins the current query as a new board column; **all through the single `GET /api/docs` endpoint**)
- SPEC.md §11 — **Creating documents — zero-form, inbox-first** (omnibox create: no exact title match → **Create "\<query\>"**; lands in `data/docs/inbox/`; the new document opens immediately in its column, title selected, ready to type)
- SPEC.md §11 — **Columns are pinned view documents** (save-as-view creates a `type: view` document with `pinned: true` holding the query and `order`)
- SPEC.md §9.2 — `GET /api/docs?q=&type=&status=&tag=&folder=&parent=&references=&agent=&author=&since=&due=&stale=&unread=&needs=&sort=`, `GET /api/tree`, `POST /api/docs`
- SPEC.md §15 M3 — Playwright check: "omnibox-create a doc (lands in `inbox/`, opens title-selected)"; "save a search as a view → new column appears AND its view document exists on disk"
- `design/index.html` — **authoritative look & feel** (`.overlay` blurred scrim, `.search-panel`, `.search-input-row` with serif 19px input, `#save-view-chip` (`.chip.ghost`), `.search-filters` chip row incl. `.chip.on` and `.chip.warn` for "include archived", `.search-results`/`.sr-group`/`.sr`/`.sr-title`/`.sr-snippet mark`/`.sr-path`, `.sr.kbd` outline, `.sr-create`, `.search-foot` kbd legend, `.col.flash`)

## Summary

Build the search overlay: the top-bar search bar (click or ⌘K) expands into a 760px panel over a blurred scrim, with one serif query input, a filter-chip row, snippet-highlighted results grouped by type, and a footer kbd legend. Every result set comes from **one** `GET /api/docs` call — filters and FTS compose as query parameters, never as client-side post-filtering. Three actions hang off it: `↵` opens the highlighted result in its home column (board scrolls it into view with a 1.5 s border flash), `⇧↵` creates a new list from the current search, and the **save as view** chip pins the current query as a board column by creating its pinned view document. When the query matches no document title exactly, a `＋ Create "<query>"` row appears at the top — the zero-form creation path that lands the document in `data/docs/inbox/` and opens it with its title selected.

## Acceptance Criteria

- [ ] Clicking the top-bar `.searchbar` or pressing ⌘K opens the overlay: `.overlay.open` (blurred scrim, `backdrop-filter: blur(3px)`, `color-mix(in srgb, var(--ink) 18%, transparent)`) with the `.search-panel` (`min(760px, 100vw - 48px)`, `7vh` top margin, `max-height: 78vh`), and focus lands in the query input.
- [ ] The query input is serif 19px, borderless, on `.search-input-row`; the `save as view` ghost chip sits at its right.
- [ ] Typing issues a **single** debounced (~200 ms) `GET /api/docs` request combining `q` with every active filter. There is **no** client-side filtering of the result set and **no** second request for a second group.
- [ ] Filter chips render in `.search-filters` and toggle query parameters: `type`, `tag`, `status`, `folder` (options sourced from `GET /api/tree`), date (`since`), `due`, `unread`, `references:`; plus thread-only chips for agent participation (`agent`), awaiting a form answer (`needs=form`), and `parent`. Active chips take `.chip.on`.
- [ ] **Archived default**: with no status chip set, the request excludes `status: archived`. An `include archived` chip (`.chip.warn`) adds them back. Toggling it re-queries.
- [ ] Results render **grouped by type** with `.sr-group` headers formatted `Documents · 3` / `Threads · 2` (label + count), each `.sr` row showing a `.type-glyph`, a serif `.sr-title`, a `.sr-snippet` carrying the server's `<mark>` highlights, and a mono `.sr-path` (folder + updated, or thread context like `on Mortgage options · open`).
- [ ] Snippet HTML from the server is rendered with **only** `<mark>` permitted — sanitize before injecting; never `dangerouslySetInnerHTML` on raw server text without the allowlist.
- [ ] `↑`/`↓` move a cursor across results (including the create row), showing `.sr.kbd` (2px accent outline, inset). The list scrolls the cursor into view.
- [ ] `↵` on a highlighted result closes the overlay and **opens the document in its home column**: the board `scrollIntoView({ behavior: "smooth", inline: "center" })`s that column, applies `.col.flash` (accent border) for 1.5 s, and opens the document in that column's reader. A document with no home column opens in the nearest column that would match it, falling back to the first column.
- [ ] `⇧↵` creates a **new list from the current search** — the same effect as `save as view`, executed from the keyboard.
- [ ] **Save as view** creates a `type: view` document with `pinned: true` whose frontmatter holds the current query (filters + search text + sort) and an `order` placing it at the end of the board; the overlay closes and the new column appears (and is scrolled to). The view document is verifiable on disk.
- [ ] **Omnibox create**: when the query is ≥2 characters and **no** document title matches it exactly (case-insensitive), a `.sr-create` row renders first reading `＋ Create "<query>" — opens ready to edit, in inbox/` (query in serif bold). Activating it `POST /api/docs` into `data/docs/inbox/` with the query as title and an empty body (or the type's template body per §11), closes the overlay, scrolls the inbox column into view with the flash, and opens the new document in that column **with its title field focused and selected**, ready to type. No form, no dialog.
- [ ] The `.search-foot` legend renders `↑↓ navigate`, `↵ open in its list`, `⇧↵ new list from search`, and right-aligned `@ agents · / skills · [[ refs`.
- [ ] `esc` closes the overlay and restores focus to the search bar; clicking the scrim closes it; clicking inside the panel does not.
- [ ] The overlay is a `role="dialog"` with an accessible label, traps Tab focus, and returns focus on close.

## Technical Design

### Files to Create/Modify

- `apps/ui/src/features/search/SearchOverlay.tsx` — panel, scrim, focus trap, keyboard handling
- `apps/ui/src/features/search/SearchInput.tsx` — serif input + `save as view` chip
- `apps/ui/src/features/search/FilterChips.tsx` — the chip row and its query-state reducer
- `apps/ui/src/features/search/searchQuery.ts` — the canonical `SearchQuery` type + serialization to `GET /api/docs` params and to view-document frontmatter (one shared shape — this is what makes save-as-view trivial)
- `apps/ui/src/features/search/SearchResults.tsx` — grouping, cursor, `.sr` rows
- `apps/ui/src/features/search/Snippet.tsx` — `<mark>`-allowlisted snippet rendering
- `apps/ui/src/features/search/CreateRow.tsx` — the `＋ Create "<query>"` row
- `apps/ui/src/features/search/useSearch.ts` — debounced single-call query hook over the kit's `useDocs`
- `apps/ui/src/features/search/search.css` — styles lifted from `design/index.html`
- `packages/kit/src/hooks/useTree.ts` — `GET /api/tree` for folder chip options
- `packages/kit/src/hooks/useCreateDoc.ts` — `POST /api/docs` (inbox default)
- `apps/ui/src/features/board/useOpenInColumn.ts` — resolve a document to its home column, scroll + flash + open (shared with UI-010 and UI-011)
- `apps/ui/src/features/board/useSaveAsView.ts` — create the pinned view document from a `SearchQuery` and append it to the board
- `apps/ui/src/app/TopBar.tsx` — wire the search bar click + ⌘K (modify)

### Key Implementation Details

**One query shape, three consumers.** `searchQuery.ts` defines `SearchQuery` and two pure serializers: `toApiParams(q)` → the `GET /api/docs` query string, and `toViewFrontmatter(q)` → the `type: view` document's frontmatter. Save-as-view is then literally "write the current `SearchQuery` to a document", and a column re-reads the same shape on load — no translation layer, no drift. Both serializers are unit-tested against each other (`toViewFrontmatter` → parse back → `toApiParams` equals the original params).

**Archived default** lives in `toApiParams`: when the query carries no explicit `status`, emit `status=!archived` (or whatever exclusion the contract defines — follow `packages/contract`, do not invent). The `include archived` chip sets an explicit flag that suppresses the exclusion. Because this is in the serializer, columns saved from a search inherit the same default.

**Grouping** is derived from the single response by partitioning on document `type` into ordered buckets (`Documents` = everything that is not a thread, then `Threads`, then any plugin types in manifest order). Counts come from the bucket lengths of the returned page — if the server paginates, show the server's total. Do not issue a second request per group.

**Exact-title detection** for the create row uses the returned results (case-insensitive compare of `title` against the trimmed query) — no extra request. Requiring ≥2 characters matches the prototype.

**`useOpenInColumn`** is shared infrastructure: given a document id, find the board column whose query would contain it (folder match first, then type/status match, then the document's own home folder column), scroll the board to it, add `.col.flash` for 1.5 s, and push the document into that column's reader stack. UI-010 (`↵` from the board) and UI-011 (job `↗ open`) both use it — build it here with that reuse in mind.

**Create flow.** `POST /api/docs` with `{ title, folder: "inbox" }`. On success, open in the inbox column via `useOpenInColumn`, then signal the reader to focus + select the title field (a one-shot `focusTitle` flag on the reader's open call, consumed on mount so a later re-render does not re-select).

**Keyboard.** All overlay keys are handled on the panel, not globally; while the overlay is open it takes precedence over every board shortcut (UI-010 will formalize the precedence chain — expose a simple "an overlay is open" signal from here so UI-010 can consume it).

**Styling** verbatim from `design/index.html`: `.search-panel` (surface, 1px `--line`, 14px radius, `var(--shadow)`), `.search-input-row` (15/18px padding, bottom hairline), `.search-filters` (5px gap, 10/18px padding, bottom hairline), `.sr-group` (mono 10px uppercase, `.08em` tracking, `--ink-3`), `.sr-title` (serif 14.5px/600), `.sr-snippet mark` (accent wash background, `--accent-ink`, 2px radius), `.sr-path` (mono 10.5px `--ink-3`), `.search-foot` (surface-2, mono 10.5px, `.right` pushed with `margin-left: auto`), `.sr-create` (`--accent-ink` 600 with a serif `<b>` for the query).

### Edge Cases

- Empty query with active filters → still a valid search (filters compose without `q`); the create row is hidden.
- Query shorter than 2 characters → no create row; results may still render from filters.
- Zero results and no exact title → the create row is the only row and starts highlighted.
- Rapid typing → the debounce plus TanStack Query's `keepPreviousData` avoids flicker; out-of-order responses are discarded by query key.
- Query containing `[[`/`@`/`/` — these are literal search text here (the footer legend hints at composer autocompletes, not overlay behavior); do not open an autocomplete inside the search input.
- `references:` chip requires a target document — picking it opens a small title picker (reuse the kit autocomplete) rather than expecting a typed id.
- Save-as-view when a pinned view with an identical query already exists → still create (views are documents; duplicates are the user's business) but toast that a matching column exists.
- Save-as-view failure (write error) → overlay stays open with an error toast; no phantom column.
- Omnibox create colliding with an existing inbox document of the same title → the server generates a unique id; the UI does not dedupe titles.
- A result whose home column was deleted → falls back per `useOpenInColumn`'s chain.
- Server snippet containing HTML-looking text → sanitizer strips everything but `<mark>`; assert this in a test.
- ⌘K while the compose overlay (UI-010) is open → search takes over; only one overlay is visible at a time.

## Testing Strategy

Vitest + Testing Library in `apps/ui`:

- `searchQuery.test.ts` — `toApiParams` for each chip combination; archived exclusion by default and its suppression; `toViewFrontmatter` → parse → `toApiParams` round-trip equality.
- `useSearch.test.ts` — debounce coalesces keystrokes into one request; exactly one request per query change (assert the fetch mock's call count); out-of-order responses discarded.
- `SearchResults.test.tsx` — grouping headers and counts (`Documents · 3`, `Threads · 2`), cursor movement with ↑↓ including wrap/clamp behavior and the create row's position, `.sr.kbd` applied to exactly one row.
- `Snippet.test.tsx` — `<mark>` preserved; `<script>`, `<img onerror>`, and attribute injection stripped.
- `CreateRow.test.tsx` — hidden for <2 chars, hidden on exact title match (case-insensitive), visible otherwise; label text exactness.
- `SearchOverlay.test.tsx` — ⌘K opens and focuses the input; esc closes and restores focus; scrim click closes, panel click does not; focus trap keeps Tab inside.
- `useSaveAsView.test.ts` — builds the expected `type: view` frontmatter with `pinned: true` and a trailing `order`.
- `useOpenInColumn.test.ts` — column resolution precedence (folder → type/status → fallback), flash class applied and removed after 1.5 s.

## E2E Verification Plan

### Verification Steps

1. Start the real stack (`npm run watch`) against a `corpus init` workspace with seeded documents and threads.
2. Press ⌘K → the overlay opens over a blurred board, focus in the input. Compare the panel against `design/index.html` open in a second tab.
3. Type a term present in both a document body and a thread turn → results appear grouped `Documents · N` / `Threads · M` with `<mark>`ed snippets and mono paths. Open devtools Network and confirm **exactly one** `GET /api/docs` request per debounced keystroke burst, carrying `q` and the active filters.
4. Toggle `folder:` (options sourced from `GET /api/tree`), `type`, and `status` chips → each toggle produces one new request with the corresponding parameter; results narrow accordingly.
5. Archive a document (`corpus doc archive <id>`), search for it → absent by default; toggle `include archived` → it appears with its archived chip.
6. Press ↓↓ then ↵ → the overlay closes, the board smooth-scrolls that document's column into view, the column border flashes accent for ~1.5 s, and the document opens in that column's reader.
7. Press ⌘K again, refine the query, click **save as view** → a new column appears at the end of the board **and** the view document exists on disk: `ls <workspace>/data/docs/**/*.md` shows it, `cat` confirms `type: view`, `pinned: true`, the query fields, and an `order`. Reload the browser → the column persists (it is a document, not local state). This is the §15 M3 save-as-view check.
8. Press ⌘K, type a title that exists exactly → the create row is **absent**. Change one character → `＋ Create "<query>" — opens ready to edit, in inbox/` appears at the top.
9. Activate the create row → the overlay closes, the Inbox column flashes and scrolls into view, and the new document opens **with its title selected**. Type immediately and confirm the typed text replaces the title. On disk: the file is under `data/docs/inbox/` with the query as its title and an auto-commit in `git log`. This is the §15 M3 omnibox-create check.
10. Press ⌘K, then `⇧↵` → a new list is created from the current search (same verification as step 7).
11. Press esc → overlay closes and focus returns to the search bar; press ⌘K while a document is open in a reader → the overlay opens above it and board shortcuts do not fire.
12. Playwright: `apps/ui/e2e/search.spec.ts` automating steps 3, 6, 7, and 9 against the real app.

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
- [ ] Committed with `[UI-009]` prefix
