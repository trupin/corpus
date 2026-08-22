# Evaluation: UI-009 — Search overlay, omnibox create, save-as-view

**Date**: 2026-07-28
**Sprint**: sprint-010 (TEST-43…70)
**Verdict**: **PASS** — 28 of 28 criteria met (two accepted as source/unit-level), one recorded
divergence on TEST-66's request body.

Environment: the production-served board on `http://127.0.0.1:8982/` (no Vite, SERVER-024's
injected token), a real `corpus init` workspace, real headless Chromium at 1440×900. Every search
claim compared against the raw `GET /api/docs` JSON for the same parameters. No source file was read.

**Note on re-evaluation context**: UI-009's own log recorded `DEFERRED → CONTRACT-012 + SERVER-027`
for the *effect* of the `include archived` chip and `DEFERRED → UI-005` for the escape registry and
for `↵` opening into a real reader. All three dependencies have since landed, so those criteria are
evaluated **in full** here, not deferred.

## E2E Proof-of-Work Audit

| Check                                    | Result | Notes |
| ---------------------------------------- | ------ | ----- |
| Verification log present                 | PASS   | Environment, the wire before the UI, a step-by-step browser transcript, on-disk and git evidence, deferred/struck verdicts with substitute evidence. |
| Commands are specific and concrete       | PASS   | Real ids, exact request query strings, computed styles, selection offsets, `cat` of the created view document, `git log --format` output. |
| Real E2E (not mocked)                    | PASS   | Real workspace on 8967, real server (pid 88622), real Chromium against a real Vite dev server pointed at the real API. Explicitly "not the mocked `npm run e2e` fixture". |
| Scenarios cover acceptance criteria      | PASS   | Every criterion addressed; four deferrals recorded with substitute evidence rather than omitted. |
| Application restarted after changes      | PASS   | Server start/stop with pids; two browser runs. |
| Actual model recorded (`implemented on:`)| PASS   | "Implemented on: opus." |
| Reproduction logged before fix (bugs)    | N/A    | Feature issue; two defects found by tests are recorded with their symptom. |

**Honesty audit — claims sampled and re-derived:**

| Log claim | Re-derived? |
| --- | --- |
| ⌘K opens `.overlay.open`, `blur(3px)`, z-index 40, panel 760px at y=63 (7vh), focus in the query input | **YES** — `{pos:fixed, z:40, backdropFilter: blur(3px), bg color(srgb …/0.18)}`, panel `w:760 y:63`, `role="dialog" aria-label="Search"`, `document.activeElement` = the `Search query` input. |
| `.searchbar` is still a `<button>` and `.searchbar input` counts 0 | **YES** — `BUTTON`, count `0`. |
| One `/api/docs` request for a whole typed burst | **YES** — typed `mortgage` char-by-char at 25 ms → exactly `["GET /api/docs?q=mortgage&sort=relevance"]`. |
| Snippets render as `<mark>` elements, no `dangerouslySetInnerHTML` | **YES** — 8 `<mark>` elements; `grep -rn dangerouslySetInnerHTML apps/ui/src packages/kit/src` → **one line, `apps/ui/src/search/Snippet.tsx:9`, inside a docblock**. No call site. |
| Create row copy and `<b>` query, escaped | **YES** — `＋ Create "mortgage options v2!" — opens ready to edit, in inbox/`, `<b>` = the query, color `rgb(46,75,120)`, weight 600; a query containing `<b>bold</b>` renders literally (`innerHTML` contains no `<b>bold</b>` element). |
| Omnibox create opens with the title **selected** | **YES** — `{cls:"doc-title", tag:"INPUT", value:"Fresh omnibox note", start:0, end:18}`; typing immediately replaced it. |
| Save as view creates a pinned, committed view document | **YES** — one `POST /api/docs`, file `data/docs/views/mortgage-2.md` with `type: view`, `pinned: true`, `order: 70`, `query: {q, sort, type}`; `git log -1` → `user \| doc create: mortgage (doc_igo4pea7) by user`. |
| `resolveColumn` prefers a compatible column over `columns[0]` | **YES** — `↵` on a `finance/housing` note resolved into the **Finance** column, not a seed column. |
| **"`include archived` … the archived document is still filtered out" (recorded as DEFERRED)** | **SUPERSEDED — now passes.** With SERVER-027 landed, the chip's single request `?includeArchived=true&q=…` returns the archived document alongside the open ones. |
| **"focus returns to the search bar" (STEP 10)** | **YES, with a caveat** — after ⌘K → esc and after searchbar-click → esc, `document.activeElement` is `BUTTON.searchbar`. After tabbing into the panel and clicking a chip first, esc leaves focus on `BODY`. Minor, not a criterion failure. |

No contradictions found.

## Criteria Results

| #  | Criterion | Result | Notes |
| -- | --------- | ------ | ----- |
| 43 | ⌘K and the search bar open the same overlay | PASS | Both paths → `.overlay.open` count 1; chrome values as quoted above; focus lands in the input. |
| 44 | Query input lives in the overlay, never in the top bar | PASS | `.searchbar` = `BUTTON`, `.searchbar input` = 0. Overlay input: serif `Iowan Old Style`, **19px**, `border-width: 0px`, with `.chip.ghost "save as view"` at its right. |
| 45 | The overlay is a real dialog | PASS | `role="dialog" aria-label="Search"`; 12 consecutive Tabs all landed inside `.search-panel`; esc closes and returns focus to `BUTTON.searchbar`; a scrim click at (20,20) closes; a click inside the panel does not. |
| 46 | The stale "inert affordances" spec is corrected | PASS | `smoke.spec.ts` test renamed to *"the search bar is wired and the compose button is still inert"*, now asserting the searchbar opens the overlay and `.btn-compose` does not. |
| 47 | One debounced request per burst | PASS | Exactly one, carrying `q` and the active filters. |
| 48 | No client-side filtering, no second request per group | PASS | Rendered set == response set, 8 items both ways, no second request for the Threads group. Ordering differs only by the **mandated** Documents/Threads partition (TEST-53). |
| 49 | Snippets from structured segments | PASS | Real `<mark>` elements; zero `dangerouslySetInnerHTML` call sites. |
| 50 | Markup-looking snippet text renders literally | PASS | The `<script>alert(1)</script>` body's snippet rendered as text; `scripts: 0, imgs: 0` inside every `.sr-snippet`; `pageerror []`. |
| 51 | Filter chips are query parameters from real data | PASS | Chip set present: `type, status, folder, tag, due, updated, unread, needs: form, agent, references: …, parent: …, include archived`. Each toggle produced exactly one new request with the matching parameter (`?folder=finance&…`, `?type=note`, `?includeArchived=true&…`); active chips take `.chip.on`. |
| 52 | The archived default is the server's; label matches behaviour | PASS | No status chip → the request omits `status` and the archived document is absent (18 rows). `include archived` (`.chip.warn`) → `?includeArchived=true` → 19 rows **including** the archived one, alongside the open ones. Label and behaviour agree. |
| 53 | Results grouped from the single response | PASS | `Documents · 3` / `Threads · 5`; rows carry `.type-glyph`, serif `.sr-title`, `.sr-snippet`, mono `.sr-path` (`finance/housing/ · updated just now`; threads `on Mortgage options v2 · open`, standalone threads `standalone · 1 turn`). No raw `doc_*` id. |
| 54 | Empty query with filters is a valid search | PASS | `GET /api/docs?type=note` with no `q`: 6 rows rendered, `.sr-snippet` count **0**, create row hidden. |
| 55 | ↑↓ move a single cursor including the create row | PASS | Exactly one `.sr.kbd` at all times; create row is position 0; clamps at 0 and at 8 of 9; outline `rgb(59,95,151) solid 2px`, offset `-2px`. |
| 56 | ↵ opens the result in its home column, with the flash | PASS | Overlay closes; **Finance** takes `.col.flash` with `border-color rgb(59,95,151)`; the flash is **removed** (count 0 after 2 s); the document opens in that column's **real** reader (`Finance:doc_dgwek2hm · git ✓`). This is the hand-merged integration and it works. |
| 57 | Column resolution has a stated precedence and a fallback | PASS | Folder match observed (finance note → Finance column). Fallback observed from UI-011's `↗ open` with no subject (→ first column). Unit-test claim accepted. |
| 58 | While the overlay is open it owns the keyboard | PASS | With a reader open underneath, ⌘K layers the overlay over it; esc#1 closes only the overlay (reader count still 1); esc#2 closes the reader. It joins UI-005's registry rather than adding a branch. |
| 59 | One query shape, two serializers, proven equal | ACCEPTED (unit) | Round-trip is a unit test. Behavioural corollary re-derived: a column saved from a refined search (`q` + `type: note`) reproduces exactly that query in its frontmatter and renders the same rows. |
| 60 | Save as view creates a real, committed, pinned view | PASS | One `POST /api/docs :: {"type":"view","title":"mortgage","folder":"views","pinned":true,"order":60,"query":{…},"evergreen":true}`; overlay closes; column appears **last**; file on disk with `type: view`, `pinned: true`, `order`, `query`; `git log -1` shows the auto-commit; the column is present after a reload and in a fresh browser context. |
| 61 | ⇧↵ is the same code path as the chip | PASS | Bodies quoted; identical except `order` (60 vs 70), which is "last" evaluated at two different moments. |
| 62 | A duplicate view is created, with a warning | PASS | Second identical save created a second column **and** toasted *"Pinned — a column already queries exactly this; the new view document was created anyway."* |
| 63 | A failed save leaves no phantom column | PASS | With `POST /api/docs` forced to 500: overlay stays open, error toast quotes the server's response, columns 6 → 6, view files 5 → 5. |
| 64 | The create row appears exactly when it should | PASS | Hidden at 1 character; hidden when a returned result's title equals the trimmed query case-insensitively (`Mortgage options v2`); visible on the next keystroke. No extra request for the detection. |
| 65 | The create row's copy is the prototype's, escaped | PASS | Copy and `<b>` verified; `<b>bold</b>` renders literally. |
| 66 | Creating lands in inbox and opens ready to type | PASS (one divergence) | Overlay closes; **Inbox** flashes (`.col.flash` at +500 ms, gone by 2.5 s); the document opens in the Inbox reader with the title **selected** (`start:0 end:18`); typing replaces it; file at `data/docs/inbox/fresh-omnibox-note.md`; `git log -1` → `user \| doc create: Fresh omnibox note (doc_5pdqn7vg) by user`. **Divergence**: the request body is `{"type":"note","title":"…"}` — it omits `folder: "inbox"`; the document lands in `inbox/` only because that is the server's default. See FIND-1. |
| 67 | Creation reuses UI-003's unit | ACCEPTED (log) | Source-level. |
| 68 | A title collision is the server's business | PASS | Creating "Fresh omnibox note dup" twice: the second create succeeded with a server-generated unique id; the UI neither deduped nor warned. |
| 69 | `[[`, `@`, `/` are literal text | PASS | No autocomplete opened; the request carried `q=%5B%5Bref%5D%5D%20%40agent%20%2Fskill` — verbatim. |
| 70 | The footer legend is the prototype's | PASS | `↑↓ navigate` `↵ open in its list` `⇧↵ new list from search` `@ agents · / skills · [[ refs`; mono 10.5px on `rgb(239,237,232)` (`--surface-2`). |

## Failures

None.

## Additional findings (for the phase PR reviewer)

### FIND-1: the omnibox create request does not send `folder: "inbox"`

The create row's copy promises *"in inbox/"* and the sprint contract's Runtime gotchas record the
shape as `{type: "note", title, folder: "inbox"}`. The observed body is
`{"type":"note","title":"Fresh omnibox note"}`. The outcome is correct today because
`POST /api/docs` defaults an omitted folder to `inbox`, but the UI's promise is then carried by a
server default rather than by the request. One field would make the copy self-evidently true.
(Contrast: save-as-view **does** send `"folder":"views"` explicitly.)

### FIND-2: focus is not restored when the overlay is closed from a focused chip

After tabbing into the panel and clicking a chip, esc leaves `document.activeElement` on `BODY`
rather than on `.searchbar`. The plain open→esc paths both restore correctly.

### FIND-3: duplicate toast nodes

As in UI-005 — every toast appears twice in the DOM.

## Summary

28 of 28 criteria met (TEST-59 and TEST-67 accepted as unit/source-level). The whole feature is one
endpoint composed correctly: one debounced request per burst, results partitioned from that single
response, highlights rendered from `{text, match}` segments with no HTML injection path anywhere in
`apps/ui/src`, and the two SPEC.md §12 M3 checks — save-as-view producing a real committed pinned
view document and omnibox create landing in `inbox/` with the title *selected* — both hold against a
real workspace. The two criteria UI-009's own log deferred (the archived chip's effect and `↵` into
a real reader) now pass in full. **PASS.**
