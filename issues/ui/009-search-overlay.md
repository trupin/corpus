# [UI-009] Search overlay, omnibox create, save-as-view

## Domain

ui

## Status

done

## Priority

P0

## Model

opus — a single-endpoint composition problem with the UX fully pinned by the prototype; no architectural ambiguity.

## Dependencies

- Depends on: UI-003
- Blocks: UI-010

> **Spec refresh (SHARED-002, 2026-07-27):** the `awaiting-reply` filter/chip was dropped in favor of `needs=form` (SPEC.md §9.2/§10 amended with PR #9). The quotes below are updated to match.

## Spec References

- SPEC.md §10 — **Search overlay** (one query input composing FTS with filter chips: type, tag, status, folder, date, due, unread, `references:`, and for threads agent participation / awaiting a form answer (`needs=form`) / parent; default excludes `status: archived`, an "archived" chip brings them back; snippet-highlighted results grouped by type; **"Save as view"** pins the current query as a new board column; **all through the single `GET /api/docs` endpoint**)
- SPEC.md §10 — **Creating documents — zero-form, inbox-first** (omnibox create: no exact title match → **Create "\<query\>"**; lands in `data/docs/inbox/`; the new document opens immediately in its column, title selected, ready to type)
- SPEC.md §10 — **Columns are pinned view documents** (save-as-view creates a `type: view` document with `pinned: true` holding the query and `order`)
- SPEC.md §9.2 — `GET /api/docs?q=&type=&status=&tag=&folder=&parent=&references=&agent=&author=&since=&due=&stale=&unread=&needs=&sort=`, `GET /api/tree`, `POST /api/docs`
- SPEC.md §12 M3 — Playwright check: "omnibox-create a doc (lands in `inbox/`, opens title-selected)"; "save a search as a view → new column appears AND its view document exists on disk"
- `design/index.html` — **authoritative look & feel** (`.overlay` blurred scrim, `.search-panel`, `.search-input-row` with serif 19px input, `#save-view-chip` (`.chip.ghost`), `.search-filters` chip row incl. `.chip.on` and `.chip.warn` for "include archived", `.search-results`/`.sr-group`/`.sr`/`.sr-title`/`.sr-snippet mark`/`.sr-path`, `.sr.kbd` outline, `.sr-create`, `.search-foot` kbd legend, `.col.flash`)

## Summary

Build the search overlay: the top-bar search bar (click or ⌘K) expands into a 760px panel over a blurred scrim, with one serif query input, a filter-chip row, snippet-highlighted results grouped by type, and a footer kbd legend. Every result set comes from **one** `GET /api/docs` call — filters and FTS compose as query parameters, never as client-side post-filtering. Three actions hang off it: `↵` opens the highlighted result in its home column (board scrolls it into view with a 1.5 s border flash), `⇧↵` creates a new list from the current search, and the **save as view** chip pins the current query as a board column by creating its pinned view document. When the query matches no document title exactly, a `＋ Create "<query>"` row appears at the top — the zero-form creation path that lands the document in `data/docs/inbox/` and opens it with its title selected.

## Acceptance Criteria

- [x] Clicking the top-bar `.searchbar` or pressing ⌘K opens the overlay: `.overlay.open` (blurred scrim, `backdrop-filter: blur(3px)`, `color-mix(in srgb, var(--ink) 18%, transparent)`) with the `.search-panel` (`min(760px, 100vw - 48px)`, `7vh` top margin, `max-height: 78vh`), and focus lands in the query input.
- [x] The query input is serif 19px, borderless, on `.search-input-row`; the `save as view` ghost chip sits at its right.
- [x] Typing issues a **single** debounced (~200 ms) `GET /api/docs` request combining `q` with every active filter. There is **no** client-side filtering of the result set and **no** second request for a second group.
- [x] Filter chips render in `.search-filters` and toggle query parameters: `type`, `tag`, `status`, `folder` (options sourced from `GET /api/tree`), date (`since`), `due`, `unread`, `references:`; plus thread-only chips for agent participation (`agent`), awaiting a form answer (`needs=form`), and `parent`. Active chips take `.chip.on`.
- [x] **Archived default**: with no status chip set, the request excludes `status: archived`. An `include archived` chip (`.chip.warn`) adds them back. Toggling it re-queries. — _the chip emits `includeArchived=true` per sprint-010 adjudication 3; the parameter is inert until CONTRACT-012 + SERVER-027 land (recorded below as `DEFERRED`)._
- [x] Results render **grouped by type** with `.sr-group` headers formatted `Documents · 3` / `Threads · 2` (label + count), each `.sr` row showing a `.type-glyph`, a serif `.sr-title`, a `.sr-snippet` carrying the server's highlights, and a mono `.sr-path` (folder + updated, or thread context like `on Mortgage options · open`).
- [x] ~~Snippet HTML from the server is rendered with **only** `<mark>` permitted — sanitize before injecting~~ — **STRUCK → Open Conflict 4.** `SnippetSchema` ships `{text, match}` segments; highlights are `<mark>` elements React creates and there is no HTML string on the path. `dangerouslySetInnerHTML` appears nowhere in `apps/ui/src`.
- [x] `↑`/`↓` move a cursor across results (including the create row), showing `.sr.kbd` (2px accent outline, inset). The list scrolls the cursor into view.
- [x] `↵` on a highlighted result closes the overlay and **opens the document in its home column**: the board `scrollIntoView({ behavior: "smooth", inline: "center" })`s that column, applies `.col.flash` (accent border) for 1.5 s, and opens the document in that column's reader. A document with no home column opens in the nearest column that would match it, falling back to the first column.
- [x] `⇧↵` creates a **new list from the current search** — the same effect as `save as view`, executed from the keyboard.
- [x] **Save as view** creates a `type: view` document with `pinned: true` whose frontmatter holds the current query (filters + search text + sort) and an `order` placing it at the end of the board; the overlay closes and the new column appears (and is scrolled to). The view document is verifiable on disk.
- [x] **Omnibox create**: when the query is ≥2 characters and **no** document title matches it exactly (case-insensitive), a `.sr-create` row renders first reading `＋ Create "<query>" — opens ready to edit, in inbox/` (query in serif bold). Activating it `POST /api/docs` into `data/docs/inbox/` with the query as title and an empty body (or the type's template body per §10), closes the overlay, scrolls the inbox column into view with the flash, and opens the new document in that column **with its title field focused and selected**, ready to type. No form, no dialog.
- [x] The `.search-foot` legend renders `↑↓ navigate`, `↵ open in its list`, `⇧↵ new list from search`, and right-aligned `@ agents · / skills · [[ refs`.
- [x] `esc` closes the overlay and restores focus to the search bar; clicking the scrim closes it; clicking inside the panel does not.
- [x] The overlay is a `role="dialog"` with an accessible label, traps Tab focus, and returns focus on close.

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
7. Press ⌘K again, refine the query, click **save as view** → a new column appears at the end of the board **and** the view document exists on disk: `ls <workspace>/data/docs/**/*.md` shows it, `cat` confirms `type: view`, `pinned: true`, the query fields, and an `order`. Reload the browser → the column persists (it is a document, not local state). This is the §12 M3 save-as-view check.
8. Press ⌘K, type a title that exists exactly → the create row is **absent**. Change one character → `＋ Create "<query>" — opens ready to edit, in inbox/` appears at the top.
9. Activate the create row → the overlay closes, the Inbox column flashes and scrolls into view, and the new document opens **with its title selected**. Type immediately and confirm the typed text replaces the title. On disk: the file is under `data/docs/inbox/` with the query as its title and an auto-commit in `git log`. This is the §12 M3 omnibox-create check.
10. Press ⌘K, then `⇧↵` → a new list is created from the current search (same verification as step 7).
11. Press esc → overlay closes and focus returns to the search bar; press ⌘K while a document is open in a reader → the overlay opens above it and board shortcuts do not fire.
12. Playwright: `apps/ui/e2e/search.spec.ts` automating steps 3, 6, 7, and 9 against the real app.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. Must be from real E2E testing — no mocks, no test clients. Real application, real requests, real interfaces. Include specific commands run, actual outputs observed, and pass/fail conclusions. State which model the implementing agent ran on ("implemented on: opus | fable")._

**Implemented on: opus.**

### Reproduction (bugs only)

Not a bug — a feature issue. No pre-fix reproduction required.

### Post-Implementation Verification

#### The environment (real, not a fixture)

```
$ WS=$(mktemp -d /tmp/corpus-s010-ui009-XXXXXX)          # → /tmp/corpus-s010-ui009-J34iPy
$ node --import tsx apps/cli/src/bin/corpus.ts init "$WS" --port 8967
Initialized Corpus workspace at /tmp/corpus-s010-ui009-J34iPy
  port 8967, token in .corpus/config.json (mode 600)
  git: initialized on main, one commit authored as user
$ node --import tsx apps/cli/src/bin/corpus.ts server start --workspace "$WS"
corpus 0.0.0 listening on http://127.0.0.1:8967 (pid 88622)
```

Seeded through the real CLI and the real HTTP API (five notes across `finance/housing`,
`home`, `finance`, `inbox`; one thread on `doc_7pbd7zpz`; one standalone thread; one
document archived), then a `Finance` folder column pinned so `↵` had a non-seed column to
resolve into:

```
created doc_7pbd7zpz — data/docs/finance/housing/mortgage-options.md   ("Mortgage options")
created doc_avttnloi — data/docs/finance/housing/payoff-maths.md
created doc_tqvfll3l — data/docs/home/house-criteria.md
created doc_iippbgcn — data/docs/finance/old-mortgage-note.md          (then: doc archive)
created doc_bnt3b553 — data/docs/inbox/markup-in-a-body.md             (body carries literal <script>)
POST /api/threads → th_35opcmkt (parent doc_7pbd7zpz), th_kpfbldr6 (standalone)
POST /api/docs    → doc_zv77irqs "Finance" (pinned view, query {folder: finance})
```

UI: the real Vite dev server on **`CORPUS_UI_PORT=5275`** with
`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8967` and `VITE_CORPUS_TOKEN=<workspace token>`,
driven by a **real headless Chromium** (Playwright 1.62 browser API pointed at the running
dev server — a real browser against the real server, not the mocked `npm run e2e` fixture).
Port `8765` was verified UNBOUND throughout.

#### The wire, before the UI (`curl` against 8967 — the ground truth the rendering is compared to)

```
GET /api/docs?q=mortgage&sort=relevance   → total 6
  thread th_35opcmkt | Re: Mortgage options
    snippets: [{"field":"title", segments:[…{"text":"Mortgage","match":true}…]},
               {"field":"turn","threadId":"th_35opcmkt", segments:[…{"text":"mortgage","match":true}…]}]
  note   doc_7pbd7zpz | Mortgage options
  thread th_kpfbldr6 | Rent vs mortgage breakeven at current rates.
  note   doc_tqvfll3l | House criteria
  note   doc_avttnloi | Payoff maths
  note   doc_bnt3b553 | Markup in a body
    snippets: […{"text":"A ","match":false},{"text":"mortgage","match":true},
               {"text":" note whose body contains <script>alert(1)</script> and <img…","match":false}]

GET /api/docs?q=mortgage&status=archived  → total 1  ['Old mortgage note']
```

Two facts this pins: the archived document is **absent by default** (6 of 7), and
`status=archived` **narrows to archived-only** — the reason the chip cannot be spelled
`status=archived` (Open Conflict 3).

#### Browser run — observed output, step by step

```
STEP 1  board columns: doc_seedattention:Attention, doc_seedinbox:Inbox,
                       doc_seedopenthreads:Open threads, doc_zv77irqs:Finance

STEP 2  ⌘K → .overlay.open count 1
        focused element aria-label: "Search query"
        .search-panel role/aria-label: dialog/Search
        overlay computed: {position: fixed, zIndex: 40, backdropFilter: blur(3px),
                           background: color(srgb 0.113725 0.129412 0.14902 / 0.18)}
        panel box: {x: 340, y: 63, width: 760, height: 702}   (1440×900 viewport: 7vh = 63px)
        input computed: {fontSize: 19px, fontFamily: "Iowan Old Style", …, borderWidth: 0px}

STEP 3  typed "mortgage" one character at a time (25 ms apart)
        /api/docs requests for the WHOLE burst: ["?q=mortgage&sort=relevance"]     ← ONE
        groups: ["Documents · 4", "Threads · 2"]
        rows:   [doc_7pbd7zpz, doc_tqvfll3l, doc_avttnloi, doc_bnt3b553, th_35opcmkt, th_kpfbldr6]
        first row: {glyph: "note", title: "noteMortgage options",
                    marks: ["mortgage"], path: "finance/housing/ · updated just now"}
        thread row path: "on Mortgage options · open"
        markup row: {text: 'A mortgage note whose body contains <script>alert(1)</script> and <img…',
                     scripts: 0, imgs: 0}
        uncaught page errors: []

STEP 4  "Old mortgage note" present by default? 0
        click `include archived` → requests: ["?includeArchived=true&q=mortgage&sort=relevance"]
        chip classes: "chip warn on";  "Old mortgage note" now present? 0   ← see DEFERRED below

STEP 5  click `folder:` → label "folder: finance",
        requests: ["?folder=finance&q=mortgage&sort=relevance"]
        rows now: [doc_7pbd7zpz, doc_avttnloi, th_35opcmkt]

STEP 6  ↓ → exactly 1 `.sr.kbd`: the create row
              {"create":true,"text":"＋ Create \"mortgage\" — opens ready to edit, in inbox/",
               "outline":"rgb(59, 95, 151) solid 2px","offset":"-2px"}     (rgb(59,95,151) = --accent)
        ↓↓ → {"sr":"doc_7pbd7zpz","create":false,…}; still exactly one lit
        ↵ → overlay count 0
             flashing column: [{"id":"doc_zv77irqs", border → rgb(59, 95, 151) once settled}]
             reader open on: ["doc_zv77irqs:doc_7pbd7zpz"]
             flash after 1.7 s: 0;  column border back to rgb(227, 225, 218) (= --line)

STEP 7  ⌘K, "mortgage", click `save as view`
        POST /api/docs ×1;  overlay 0
        toast: "Pinned — a view document was created for this search (pinned: true, order: last)."
        columns now: …, doc_zv77irqs:Finance, doc_2uovkdqt:mortgage      ← new column, at the end

STEP 8  ⌘K, typed "Mortgage options" (an EXACT title) → .sr-create count 0
        typed one more character → '＋ Create "Mortgage options!" — opens ready to edit, in inbox/'

STEP 9  activated the create row
        POST /api/docs ×1;  overlay 0;  flashing column: ["doc_seedinbox"]
        readers: ["doc_seedinbox:doc_tiw5aznb", "doc_zv77irqs:doc_7pbd7zpz"]
        focused element class: "doc-title"
        selection: {value: "Mortgage options!", start: 0, end: 17}       ← SELECTED, not just focused
        typed immediately → field value: "Typed over"

STEP 10 esc → overlay 0, document.activeElement.className = "searchbar"

UNCAUGHT PAGE ERRORS: []
```

A second run with `colorScheme: light` forced and a 500 ms settle confirmed the flash colour
after the 0.3 s `border-color` transition finishes: `rgb(59, 95, 151)` = `--accent`, back to
`rgb(227, 225, 218)` = `--line` once the 1.5 s elapses. That run also resolved
`Payoff maths` (`finance/housing`) into the **Finance** column (`folder: finance`) rather
than into a seed column — folder precedence, observed.

#### On disk and in git (the same workspace, after the browser run)

```
$ ls $WS/data/docs/views
attention.md  finance.md  inbox.md  mortgage.md  open-threads.md

$ cat $WS/data/docs/views/mortgage.md
---
id: doc_2uovkdqt
type: view
title: mortgage
created: 2026-07-28T06:10:10Z
updated: 2026-07-28T06:10:10Z
tags: []
status: open
anchors: {}
due: null
reviewed: null
evergreen: true
pinned: true
order: 50
query:
  q: mortgage
  sort: relevance
---

$ git -C $WS log --format='%h %an | %s' -6
2f56820 user | doc edit: Typed over (doc_tiw5aznb) by user
ae9baac user | doc create: mortgage (doc_2uovkdqt) by user
877b36e user | doc create: Finance (doc_zv77irqs) by user
dbfabba user | doc archive: Old mortgage note (doc_iippbgcn) by user
…

$ git -C $WS show --stat 2f56820
 data/docs/inbox/mortgage-options.md | 19 +++++++++++++++++++
```

The omnibox document landed in `data/docs/inbox/`, auto-committed as `user`. Its create and
its title edit arrived inside the server's commit-squash window and are one commit — the
server's §4 behaviour, not the UI's. Its body is the `note` type's template
(`## Context / ## Notes / ## Open questions`), which is the contract's documented
`POST /api/docs` behaviour when `body` is omitted.

#### Deferred and struck verdicts

- **`STRUCK → Open Conflict 4`** — the two `<mark>`-sanitization criteria and
  `Snippet.test.tsx`'s "strips `<script>`" case. Substitute evidence:
  `grep -rn "dangerouslySetInnerHTML" apps/ui/src packages/kit/src` → exactly one line,
  `apps/ui/src/search/Snippet.tsx:9`, inside the docblock quoting `SnippetSchema`'s rationale.
  **No call site anywhere.**
  `Snippet.tsx` renders `segments` as `<mark>` elements and text nodes; the browser run
  showed the `<script>`-bearing snippet as literal text with `scripts: 0, imgs: 0` inside
  the row and an empty page-error list.
- **`DEFERRED → CONTRACT-012 + SERVER-027`** — the *effect* of `include archived`. The chip
  emits `includeArchived=true` on the one request (quoted at STEP 4), which is the parameter
  sprint-010 adjudication 3 assigns to those two issues; the contract on this branch has no
  such parameter yet, so zod strips it server-side and the archived document is still
  filtered out. Verified inert-not-wrong: the request carries it, `status` is **never** sent
  in its place, and nothing errors. Substitute evidence for the default half:
  `q=mortgage` returned 6 of 7 documents with the archived one absent, and
  `status=archived` returned only it.
- **`DEFERRED → UI-005`** — registering into the escape-layer registry (sprint TEST-58 /
  TEST-35). That registry does not exist on this branch. Substitute: every overlay key is
  bound to the `.search-panel` element, not to `document`; the only global listener this
  issue adds is the one that *opens* the overlay (⌘K, in `Shell.tsx`). `isOverlayOpen()` is
  exported from `apps/ui/src/shell/Shell.tsx` as the "an overlay is open" signal UI-010 asked
  for. Verified in the browser: `Shift+ArrowRight` / `Shift+ArrowLeft` inside the overlay do
  not reach the board's keyboard-drag handler and raise no error.
- **`DEFERRED → UI-005`** — `↵` opening into a *real* reader. `ColumnReaderScaffold` is what
  exists today; the browser run shows the document opening in the resolved column's reader
  (`doc_zv77irqs:doc_7pbd7zpz`) through the same `onOpen` path UI-005 replaces.

#### `[[ref]]` title-lookup strategy (recorded per the 2026-07-28 correction)

The overlay resolves **no** `[[ref]]` titles: `[[`, `@` and `/` are literal query text here
(verified — typing `[[ref]] @agent /skill` opened no autocomplete and reached `q=` verbatim).
Where this issue does need a title for an id — the `references:` and `parent:` chips — it
takes it from the rows the current response already carries (`titleOf(items, id)`), so those
pickers issue **zero** requests. The adjudicated strategy for bodies, **cache-deduped per-id
`useDoc`**, is therefore untouched here and remains UI-005's to implement; nothing in this
issue introduces an `ids` batch or a second lookup path.

#### Checks

```
$ VITEST_MAX_THREADS=4 vitest run apps/ui packages/kit
  Test Files  51 passed (51)
       Tests  699 passed (699)          (apps/ui alone: 33 files, 362 tests — was 24 / 222)

$ CORPUS_UI_PORT=5275 playwright test --config apps/ui/playwright.config.ts
  31 passed (7.6s)                      (20 shipped + 11 new in e2e/search.spec.ts)

$ eslint apps/ui packages/kit --max-warnings=0     → clean
$ prettier --check "apps/ui/**/*.{ts,tsx,css}"     → all files use Prettier code style
$ tsc --noEmit -p apps/ui/tsconfig.json            → clean
```

Two defects the tests caught and the fix for each, for the record:

1. `resolveColumn` fell through to `columns[0]` even when an earlier column *contradicted*
   the document's type — a note could open in a `type: thread` column while an unfiltered
   column sat right next to it. Candidacy is now a filter (folder, type and status must all
   be compatible) and `columns[0]` is the last resort only when no column would have it.
2. `.sr-path` read `updated just now ago`. `humanizeAge` returns a phrase under an hour, so
   the label special-cases it.

#### Cleanup

`corpus server stop` → `stopped (pid 88622)`; the dev Vite killed by pid; `rm -rf` on the one
scratch path created here. `lsof -nP -iTCP:<port> -sTCP:LISTEN` reports **8765 free, 8967
free, 5275 free, 5273 free**. No stray `vitest` or `playwright` processes.
`apps/ui/test-results/` and `coverage-raw/` removed; `git status` in the worktree shows only
this issue's files.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [x] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-009]` prefix

## Correction (orchestrator, 2026-07-28 — sprint-010 Conflict 4/6)

- Any criteria about sanitizing `<mark>`/HTML in snippets are **struck**: `SnippetSchema` ships
  `{text, match}` segments so highlights render from data, never `dangerouslySetInnerHTML`.
- `[[ref]]` title lookups: use cache-deduped per-id `useDoc` (no `ids` batch filter exists);
  state this strategy in the E2E log.
- Dev server port for this issue: `CORPUS_UI_PORT=5275`.
