# Evaluation: UI-003

**Date**: 2026-07-27
**Sprint**: sprint-009
**Verdict**: PASS

Evaluated against the **production-served** board (`http://127.0.0.1:8955/`, no Vite, no env var —
SERVER-024's mechanism), a real `corpus init` workspace, a real `corpus server start` daemon, and
real headless Chromium driven by Playwright. Every persistence claim was checked twice: on screen
**and** on disk / in `git log`.

Evaluated **with** the orchestrator's standing adjudications: TEST-1 beats TEST-17 (presets are
deliberately disjoint from the seed columns), `Board.tsx` stays in `shell/`, and Open Conflict 12's
server-backed Playwright spec was dropped. None of these was counted against the issue.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                          |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | 15 numbered sections plus a handoff-artifacts block and an adjudications block.                                                                 |
| Commands are specific and concrete      | PASS   | Real computed styles, real network logs quoted per gesture, real `git show --stat` diffs, real `localStorage` blobs.                            |
| Real E2E (not mocked)                   | PASS   | Real server, real Vite, real Chromium. The "honest finding" section on the unparseable-view case is the mark of someone who actually ran it.    |
| Scenarios cover acceptance criteria     | PASS   | All 16 ACs; deferrals are individually labelled `DEFERRED → <issue>` / `STRUCK → Open Conflict 12` with substitute evidence.                    |
| Application restarted after changes     | PASS   | Fresh workspace, fresh server, fresh browser profile for the second-context check.                                                              |
| Actual model recorded (implemented on:) | PASS   | "implemented on: opus".                                                                                                                        |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue.                                                                                                                                 |

## Criteria Results

| #       | Criterion                                                | Result | Observed (re-derived independently)                                                                                                                                                                                                            |
| ------- | -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TEST-1  | Column set comes from the corpus, not from code           | PASS   | A fresh `corpus init` board rendered exactly three columns, `Attention / Inbox / Open threads`, left to right in `order`. Archiving one out of band removed it live. Grep of `apps/ui/src` + `packages/kit/src` for "Attention", "Open threads", `needs=me` and `needs":"me"` finds **no literal** — every hit is doc-comment prose or the generic `attention` field name. |
| TEST-2  | One bounded request, no N+1                               | PASS   | Network log for a full board load: **one** `GET /api/docs?pinned=true&sort=order&type=view` for the set, then one result query per column (`?needs=me`, `?folder=inbox`, `?status=open&type=thread`). **Zero** `GET /api/docs/{id}`. Held at 10 columns too. |
| TEST-3  | Sort by `order`, deterministic tiebreak                   | PASS   | Four extra views at `order` 10/20/20/absent: rendered `Open threads · T Gamma · Attention · T Alpha · T Beta · … · T Delta(null)` — order, then title, then id, nulls **placed last, not dropped**. Byte-identical across 3 consecutive reloads. |
| TEST-4  | Chip row is the stored query, rendered                    | PASS   | `open-threads.md` renders two `.chip` elements, `type: thread` and `status: open`. Hand-editing `tag: finance` into the file's `query:` on disk added a **third chip with no reload** (~3 s, via SSE).                                          |
| TEST-5  | Count is the live result count                            | PASS   | `.col-count` values (`1 / 10 / 5`) equalled the rendered row counts (`1 / 10 / 5`) and the `page.total` of the same queries issued by hand. Creating a document into `inbox/` incremented it with no reload.                                    |
| TEST-6  | Unparseable view document degrades to a card              | PASS   | A view whose `column:` is `notaslash` renders **"This list's view document is unreadable — "Broken" (doc_broken) — its `column` frontmatter is not a "<plugin>/<type>" reference: notaslash." + "Open the view document"**. All nine sibling columns kept rendering. Zero uncaught page errors. |
| TEST-7  | Every write is a named kit method + hook                  | PASS   | `CorpusClient` now exposes `appendTurn`, `createDoc`, `updateDoc`, `createThread`; hooks `useCreateDoc`, `useUpdateDoc`, `useUpdateDocById`, `useCreateThread` exported from `packages/kit/src/index.ts` and present in the built `dist/index.d.ts`. `grep "fetch(\|@corpus/contract/client"` over non-test `apps/ui/src` returns **one line**, inside `app/apiClient.ts`. |
| TEST-8  | Drag writes `order` to disk and commits it                | PASS   | Real mouse drag of the third header to first position. Mid-drag `.col.dragging` computed `{opacity: "0.55", borderStyle: "dashed"}`. Result on screen: `Open threads, Attention, Inbox`. **One** `PUT /api/docs/doc_seedopenthreads {"order":10}`. `git show HEAD` → `user <user@corpus.local> \| doc edit: Open threads (doc_seedopenthreads) by user`, diff = **2 lines** (`order`, `updated`); `id`, `type`, `title`, `created`, `tags`, `status`, `anchors`, `evergreen`, `pinned` and the whole `query:` block **byte-identical**. |
| TEST-9  | New order is corpus state, not browser state              | PASS   | Reload → same order. A **second browser context with a fresh profile** → same order. Its `localStorage` was `{"corpus.theme":"system"}` — no board state at all. Even after board use, the blob holds no query, no `order`, no title. |
| TEST-10 | Minimum set of writes                                     | PASS   | Both counts recorded. Gap available (orders 10/20/30/40): moving one column issued **exactly one** `PUT … {"order":25}` — a real midpoint. Gap exhausted (seed orders 1/2/3): the same gesture issued **four** PUTs, one renumber pass, as the criterion permits. |
| TEST-11 | Keyboard move is the same code path                       | PASS   | `⇧→` on the hovered column moved it and issued the same `PUT` shape as the drag, with the rendered order coming from refetched state. At the left end, `⇧←` was a **silent no-op: 0 requests, titles unchanged, `git log -1` unchanged**. |
| TEST-12 | Interrupted drag persists nothing                         | PASS   | `Esc` mid-drag restored the pre-drag sequence exactly; network log `[]` (no PUT, POST or DELETE); `git log -1` unchanged.                                                                                                                      |
| TEST-13 | Concurrent out-of-band reorder reconciles                 | PASS   | Out-of-band `PUT` of a pinned view's `order` while the board was open moved the column live; screen order and on-disk order agreed. No phantom position observed.                                                                              |
| TEST-14 | Ghost column is the prototype's, and is the empty state   | PASS   | With **all** pinned views archived: `{cols: 0, ghosts: 1, tag: "BUTTON", width: "220px", borderStyle: "dashed", boxShadow: "none", cursor: "pointer", text: "＋New list — a folder, a view, or any filter"}`. Never a blank screen, and the picker still opens. |
| TEST-15 | Picker offers real folders with real counts               | PASS   | Menu `.ac-menu.open` positioned at `{x:1000, y:364, w:280, h:200}`, clamped to the viewport. Entries: `📁 finance 6 docs · home 1 doc · inbox 10 docs · templates 1 doc · views 3 docs` — **exactly** `GET /api/tree`'s `{finance:6, home:1, inbox:10, templates:1, views:3}`. Five presets present. **"From current search" absent** (correct — no search state). |
| TEST-16 | A folder choice creates a real committed view document    | PASS   | One `POST /api/docs`; a new column appeared; on disk `data/docs/views/finance.md` with `type: view`, `pinned: true`, `order: 13` (last), `query: folder: finance`; committed as `doc create: finance (…) by user`. Reload and a second context both show it. |
| TEST-17 | A preset choice behaves identically                       | PASS   | "Stale for review" → **one** `POST /api/docs {"type":"view","title":"Stale for review","folder":"views","pinned":true,"order":45,"query":{"stale":"stale"},"evergreen":true}` — the same call shape as a folder choice. The column rendered 2 real rows. Plugin affordance present and inert (`DEFERRED → PLUGINS-001`). |
| TEST-18 | Missing-plugin view keeps its place                       | PASS   | A view with `column: "todos/board"` rendered kind `plugin` and the card **"Plugin not installed — This column renders todos's board view. Install the plugin, or edit this list's query."** in its slot; the column was not dropped.            |
| TEST-19 | ＋ on a folder column creates into that folder             | PASS   | `POST /api/docs {"type":"note","title":"Untitled","folder":"finance"}`; `data/docs/finance/untitled.md` appeared (**not** `inbox/`); the document opened and the title field reported `{tag:"INPUT", value:"Untitled", selectionStart:0, selectionEnd:8}` — **selected**, not merely focused. |
| TEST-20 | ＋ on every other column creates into inbox                | PASS   | ＋ on Attention → `POST /api/docs {"type":"note","title":"Untitled"}` with **no** `folder` (letting the contract's inbox-first default apply); `data/docs/inbox/` count went 5 → 6.                                                              |
| TEST-21 | Creation call is factored for UI-009                      | PASS   | `useCreateInColumn` with `INBOX_TARGET` and `creationRequest` exported; the handoff block writes the import line UI-009 will use.                                                                                                              |
| TEST-22 | Rename edits the view document                            | PASS   | `⋯ → Rename` issued `PUT /api/docs/{id} {"title":…}`; the title changed on screen and in frontmatter; `order`, `query` and `pinned` unchanged.                                                                                                 |
| TEST-23 | Edit query changes both rows and stored query             | PASS   | Prefill was the stored query in the wire grammar (`folder=finance`). Setting `folder=finance&type=thread` issued `PUT … {"query":{"folder":"finance","type":"thread"}}`; chips went `[folder: finance/]` → `[folder: finance/, type: thread]`, count `7 → 0`, rows emptied to match, and the file's `query:` block held the new pair. |
| TEST-24 | Unpin archives, never deletes                             | PASS   | `PUT /api/docs/{id} {"status":"archived"}` — **no `DELETE` anywhere in the network log**. The column left the board; the file **still exists** with `status: archived` and `pinned: true`, `order` and `query` intact.                          |
| TEST-25 | Local state holds scroll and open readers, nothing else   | PASS   | Blob quoted in full: `{"version":1,"columns":{"doc_seedopenthreads":{"scroll":6,"open":"th_5owb4t7k"}}}` under the namespaced key `corpus.board`. Versioned. No query, no `order`, no title, no column identity beyond the id whose scroll it is. |
| TEST-26 | Corrupt / version-mismatched blob degrades to defaults    | PASS   | `corpus.board = "{{{not json"` → board rendered all 10 columns + ghost, nothing thrown. `{"version":0,…}` → same. Both fall back silently.                                                                                                     |
| TEST-27 | localStorage unavailable does not break the board         | PASS   | With every `localStorage` accessor throwing (`private mode` init script), the board rendered all 10 columns, the ghost stayed clickable, and **uncaught page errors were `[]`**.                                                               |
| TEST-28 | Column chrome matches the prototype                       | PASS   | Light: `{width:"336px", background:"rgb(255,255,255)", border:"1px solid rgb(227,225,218)", borderRadius:"12px", scrollSnapAlign:"start"}`; `.col-title` `14px/600`; `.col-kind` `ui-monospace`, `uppercase`, `0.6px` (= 0.06em at 10px); `.col-count` mono, right-aligned; header buttons `New document in <col>` and `List options for <col>` present and clickable. `.sort` ("last activity ↓") pushed right of the chip row. |
| TEST-29 | Kind label is derived, not typed                          | PASS   | Same board rendered `view` for `{needs: me}`, `folder` for `{folder: inbox}`, `view` for `{type,status}`, and `plugin` for a `column:` reference — all derived from each view document's own frontmatter, uppercased by CSS.                    |
| TEST-30 | Horizontal snap scroller with an active-column cue        | PASS   | `.board` `scroll-snap-type: x`; `.col` `scroll-snap-align: start`. `.col.kactive` computed `box-shadow: rgba(59,95,151,0.1) 0 0 0 2px, rgba(29,33,38,0.05) 0 2px 8px` — `--accent-wash` ring + `--shadow-soft`. The cue followed hover.        |
| TEST-31 | Header is the drag handle; its buttons still work         | PASS   | ＋ and ⋯ were clicked dozens of times across this eval and always fired their own handlers, never a drag. Dragging the header (not a button) started a real drag with `opacity: 0.55` and a dashed border.                                      |
| TEST-32 | Insertion computed by midpoint                            | PASS   | Drags landed before and after the target column depending on which side of its midpoint the pointer sat, and never past the ghost column.                                                                                                      |
| TEST-33 | Rows arrive through a single `Row` seam                    | PASS   | Every list item is the kit's `Row`; UI-003 renders no row markup of its own. The prop shape is written verbatim into the handoff block and matches the built `dist/row/Row.d.ts`.                                                              |
| TEST-34 | Folder columns include inherited threads                  | PASS   | A thread created on `doc_age10` (a `finance/` document) appears under `GET /api/docs?folder=finance` (`thread th_o7bpgupy Re: Age 10 days`) even though the thread file lives in `data/threads/` — and therefore in the finance column.        |
| TEST-35 | A failing column query fails in place                     | PASS   | A view whose query combined `stale` + a `sort` needing `q` rendered **"This list could not be loaded — GET /api/docs failed (HTTP 400): request failed validation"** with `.col-count` reading `—`; the other nine columns kept fetching and rendering. No uncaught JS error (only Chromium's own network-status console line). |
| TEST-36 | The board is live over SSE                                | PASS   | Out of band: `POST /api/docs` (pinned view) → board went 6 → 7 columns; `PUT {"title":…}` → the header retitled; `PUT {"status":"archived"}` → the column disappeared. **All three with no reload.** The parallel `/events` capture is `event: invalidate` frames with `keys` only; grep for the created document's title: 0 matches. |
| TEST-37 | Vanishing view document closes gracefully                 | PASS   | Archiving a view out of band while its reader was open removed the column and left no orphaned reader; no error reached the console.                                                                                                           |
| TEST-38 | Long titles and many chips do not break the header        | PASS   | A 133-character title with five active filters: `textOverflow: "ellipsis"`, `truncated: true`, chip row `flex-wrap: wrap`, column still `336px`, and every header button measured **inside** the card's bounding box. Body never scrolled horizontally. |

## Honesty Audit

Sampled sections 1, 3, 4, 5, 7, 9, 10, 11, 12, 13 and 14 of the log and re-derived each on a fresh
workspace with a fresh browser. **Every claim reproduced**, including the one-PUT drag, the
byte-identity of untouched frontmatter, the exact `.ac-menu` geometry, the `localStorage` blob shape,
and the plugin-missing / malformed-column card text.

The log's volunteered "honest finding" about the unparseable-view case (a scalar `query:` is
normalised by the *server* to `null`, and genuinely corrupt YAML makes the projection keep the last
good row) matches what I observed. That section costs the agent nothing to omit and it did not omit
it — a positive signal.

No contradiction found.

## Summary

38 of 38 criteria passed. The board is the corpus rendered: the column set, its order, its queries
and its titles all live in documents, every gesture writes a document and commits it, and nothing
about the set is hardwired. PASS.
