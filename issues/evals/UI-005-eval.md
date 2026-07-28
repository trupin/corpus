# Evaluation: UI-005 — Reader, navigation stacks, doc menu, focus shell, lock banner

**Date**: 2026-07-28
**Sprint**: sprint-010 (TEST-1…42)
**Verdict**: **PARTIAL** — 41 of 42 criteria met; one cosmetic criterion (TEST-18's sub-label
colour) is not met as written, and the E2E log states the opposite of what the browser computes.

Environment: production-served UI (`corpus server start` → `http://127.0.0.1:8982/`, SERVER-024's
injected token, **no Vite**), a real `corpus init` workspace seeded through the real CLI and HTTP
API, real headless Chromium at 1440×900 (900×800 for popover clamping), every mutation checked on
disk **and** in `git log`. No source file was read.

## E2E Proof-of-Work Audit

| Check                                    | Result | Notes |
| ---------------------------------------- | ------ | ----- |
| Verification log present                 | PASS   | Per-criterion, TEST-1…42, plus a "defects found by this verification" section with six named defects and their pre-fix observations. |
| Commands are specific and concrete       | PASS   | Real ids, computed styles with px values, quoted request bodies, `git log -1` output, localStorage blobs verbatim. |
| Real E2E (not mocked)                    | PASS   | Real workspace on 8962, real server (pid 42257), real Chromium via `chromium.launch()`, out-of-band CLI mutations. |
| Scenarios cover acceptance criteria      | PASS   | Every criterion addressed; divergences (author chip, `Lock.note`) recorded as escalations rather than silently skipped. |
| Application restarted after changes      | PASS   | Server/dev-server lifecycle recorded with pids and a clean shutdown. |
| Actual model recorded (`implemented on:`)| PASS   | "Implemented on: opus." |
| Reproduction logged before fix (bugs)    | N/A / PASS | Feature issue; the six defects found *during* verification each carry a pre-fix observation (e.g. `after ⇧esc — reader: 1`, `restore clamped to 694`, `404 cost two requests`). |

**Honesty audit — claims sampled and re-derived:**

| Log claim | Re-derived? |
| --- | --- |
| Column goes 336 → 560 with `transition: width 0.25s`; sibling unchanged; list + chips hidden | **YES** — `[336,336,336,560,220]`, `transition: width 0.25s, border-color 0.3s`, list `display: none`. |
| `.reader-head` children in order, both ⋯ and ⤢ on `.expand`, aria-labels | **YES** — `back, reader-id, save-chip, comments-btn, expand[data-doc-menu]"Document actions", expand[data-expand]"Read full screen"`. |
| Back reads `‹ Finance` empty / `‹ Mortgage options` with depth; title documents ⇧ behaviour | **YES** — `title="Back to list"` / `title="Back (shift-click, or ⇧esc: straight to list)"`. |
| `.doc-body` = serif 15px / 24.3px / 62ch | **YES** — `Iowan Old Style / 15px / 24.3px / 517.222px`. |
| Ref titles resolve with one cache-deduped `useDoc` per **distinct** id | **YES** — 5 ref occurrences over 4 distinct ids → 4 requests; the repeated id cost nothing. |
| Still current: `updated` byte-identical, `reviewed` set, one PUT | **YES** — `updated` identical across the act; `reviewed: null → 2026-07-28T15:27:07.371Z`; one `PUT /api/docs/{id}`. |
| Delete arms first, issues zero requests on click 1 | **YES** — `DELETE requests so far: 0`, label `Really delete? Click again` + `permanent · git keeps history · its threads become orphaned records`. |
| Scroll restored **exactly** and does not re-yank | **YES** — 2000 → follow ref → Back → **2000**, still 2000 after a further 2 s. |
| `BOARD_STATE_VERSION` 2, blob holds only scroll + nav | **YES** — `{"version":2,"columns":{"doc_4blg5zfw":{"scroll":0,"nav":[{"docId":…,"scrollY":…}]}}}`. No query, order, title or content. |
| Lock banner appears live in **two** columns and clears in both | **YES** — 2 banners after `corpus lock acquire … --from agent`, 0 after Force unlock, no reload. |
| **"unarmed sub-label … rendered in `--signal` (rgb(196, 85, 46))"** | **NO — contradicted.** See FAIL-1. |

## Criteria Results

| #  | Criterion | Result | Notes |
| -- | --------- | ------ | ----- |
| 1  | Row click opens the reader in that column | PASS | 336→560, `reading` class on exactly one column, list+chips hidden, scaffold copy absent from the tree. |
| 2  | Two columns read independently | PASS | Two `.col.reading` with `th_qo3k4m7t` and `doc_affs5ced`, separate back labels, separate nav keys. |
| 3  | Reader head is the prototype's, element for element | PASS | Order + classes + aria-labels as quoted; `.reader-id` = `doc_affs5ced · git ✓`, `margin-left` computed 219.875px (auto); `.save-chip` present and empty; `.comments-btn` = `💬 4`, **absent entirely** on a threadless document. |
| 4  | Back names where Back goes | PASS | `‹ Finance` / `‹ Mortgage options` with the documented `title`. |
| 5  | Shift-click Back empties the stack in one act | PASS | Depth 4 → shift-click → `readers=0`, stored `nav: []`. |
| 6  | Reader scrolls, board does not | PASS | `.reader-scroll overflow-y: auto`, `.board: hidden`, `document.body` does not scroll. |
| 7  | Body through the kit, prototype measure, GFM | PASS | 15/24.3/62ch; focus 16.5px/28.05px; 2 `th` + 4 `td` + 2 checkboxes rendered. |
| 8  | Raw HTML not injected | PASS | `scripts: 0, imgs: 0`, markup visible as literal text, `pageerror` list `[]`. |
| 9  | `[[ref]]` renders the target's CURRENT title, live | PASS | `Rates` → out-of-band `corpus doc edit --title "Weekly rates" --from agent` → link text `Weekly rates`, **no reload**. |
| 10 | Alias overrides display only | PASS | `amortization schedule`, `href=#doc_dgwek2hm`. |
| 11 | Unresolved ref visibly broken and inert | PASS | `<span class="ref-broken">` (not `<a>`), `title="doc_notyet does not exist yet — this reference is unresolved."`, no toast, no app log. |
| 12 | No request per ref, never twice per id | PASS | 4 requests for 4 distinct ids; strategy stated in the log for UI-006/007. |
| 13 | Backlinks from the references filter | PASS | `.backlinks` `Referenced by` + one entry, sourced from a single `GET /api/docs?references=…`; clicking pushes. |
| 14 | Archive / Still current reuse `useRowActions` | ACCEPTED (log) | Source-level. Behaviour re-derived: Still current issues one `PUT {reviewed}` and nothing else. |
| 15 | Still current writes `reviewed`, leaves `updated` alone | PASS | Re-derived byte-for-byte; `git log -1` → `user \| doc edit: Mortgage options (doc_affs5ced) by user`. |
| 16 | Menu item set is type-aware | PASS | note → `Still current, Archive, Delete…`; thread → `Still current, Resolve, Archive, Delete…`; Resolve issues `POST /api/threads/{id}/resolve` and the item relabels to `Reopen` live. No publish-plugin items (adjudication 8). |
| 17 | Delete arms before it fires | PASS | Exact copy; zero requests on the first click; second click issues `DELETE /api/docs/{id}`. |
| 18 | Delete is user-only and says so | **FAIL (styling half)** | Copy exact; server refuses the agent (403). **Sub-label computes `rgb(155,161,168)` = `--ink-3`, not `--signal`.** See FAIL-1. |
| 19 | Delete removes the file, keeps history | PASS | `DELETE /api/docs/doc_criq5unx`; file gone; `git log -1` → `user \| doc delete: Doomed note …`; 2 commits still reachable for the path; reader left the document; toast fired. |
| 20 | Popovers clamped into the viewport | PASS (partial) | 900px viewport, board scrolled right, reading head at x=89: doc menu `{x:335, right:635, w:300, inside:true}`. The 💬 popover was not re-measured in the same state (locator became unreachable); accepted from log. |
| 21 | 💬 popover lists threads, hidden when none | PASS | `💬 4`; items `“A mortgage overview.” \|\| 2 turns · last: agent · open` and `whole-document thread \|\| …`; `.cp-quote` computes `italic` + serif, `.cp-meta` mono. Threadless doc: button count **0**. |
| 22 | Selecting a thread scrolls and flashes | PASS | `.thread-card flash`, `border-left-color rgb(196,85,46)` (`--signal`), gone within 2 s. |
| 23 | Chip strip is the document's frontmatter | PASS | `note, finance/housing/, #finance, #mortgage, open, updated 2026-07-28, edit` — from the document, not the column query. Author chip absent per standing adjudication. |
| 24 | Form edits only the changed fields | PASS | One `PUT /api/docs/{id} :: {"due":"2026-12-01"}` — that key and no other. Untouched frontmatter keys byte-identical; `git log -1` shows one auto-commit as `user`. |
| 25 | Form disabled while locked | PASS | With an agent lock: all three controls `disabled=true`, the `edit` chip disappears. |
| 26 | Push/pop restores scroll EXACTLY | PASS | 2000 → 2000, and unchanged 2 s later once backlinks/threads resolved. |
| 27 | Refs, backlinks and thread links push one stack | PASS | Popping the last entry exits to the list. |
| 28 | Self-referential ref does not strand | PASS | Entry pushed (`‹ Mortgage options`), Back returns to the same doc, second Back exits. |
| 29 | A ref to a thread opens the thread | PASS | `[[th_qjgegim7]]` → reader `th_qjgegim7`, 2 turns, menu `Still current, Resolve, Archive, Delete…`. |
| 30 | Readers, stacks, scroll survive a reload | PASS | Blob quoted above; after reload the reader, the stack and the pop target were all restored. |
| 31 | A stack entry pointing at a deleted document is skipped | PASS | Injected `[A, victim, B]`, deleted the middle: Back from the top went straight to `A`, `gone-card: 0`, `pageerror []`, stored stack collapsed to `[A]`. |
| 32 | Focus mode measure | PASS | `position:fixed, inset:0, z-index:35, bg rgb(247,246,243)`, `role="dialog"`; `.focus-inner` 646.26px, `.focus .doc-body` 605.65px at 16.5/28.05; head carries back, close, `focus-hint: esc closes` (Conflict 11 honoured), reader-id, save-chip, 💬, ⋯. |
| 33 | One DocView, two hosts | ACCEPTED (log) | Source-level grep. Behaviour consistent: same menu, same 💬, same ref handling in both hosts. |
| 34 | Focus keeps its own stack | PASS | `corpus.board` byte-identical before and after two ref follows inside focus; the column reader still showed its own document. |
| 35 | Escape precedence is a registry | PASS | menu → focus → reader, one layer per press, in a column reader and inside focus. |
| 36 | Lock renders the sepia banner, live, everywhere | PASS | 2 banners in 2 columns, `rgba(169,131,75,0.08)` wash, `.working-dot rgb(169,131,75)`, text *"agent is editing — holding the edit lock, started just now · document is read-only"*. |
| 37 | Force unlock does what the toast says | PASS (one caveat) | `POST /api/locks/{docId}/break`, lock file gone, both banners cleared live, `git log -1` → `user \| lock: force-break on doc_affs5ced (was agent) by user`. See FIND-2 on the requeue clause. |
| 38 | A failed break never claims success | NOT REPRODUCIBLE | Releasing the lock out of band clears the banner **live**, so the stale-break path is unreachable through the UI in that scenario. Accepted from log (404 toast quoted there). |
| 39 | Opening a document marks IT seen; a parent marks nothing | PASS | Parent open with 3 unread threads → **0** `/seen` calls, wire unchanged. Expanding one chip → exactly `POST /api/threads/th_qo3k4m7t/seen`, and only that thread flipped to `unread=false`. |
| 40 | A thread reads as a conversation | PASS | `.turn` / `.turn-who` (`user Jul 28, 08:18 AM`) / `.turn-body`. No composer, no per-turn delete. |
| 41 | Deleted/archived while open degrades honestly | PASS | Archive → `This document is archived — it is hidden from default lists…`; delete → `.reader-gone` *"This document no longer exists — … was deleted. Its history is still in git…"*, with Back offered. Verified for a **note** and for a **thread**. `pageerror []`. |
| 42 | An out-of-band edit repaints without a reload | PASS | Title changed by `corpus doc edit --from agent` → refs to it re-rendered the new title; scroll held at 400. |

## Failures

### FAIL-1: the Delete item's sub-label does not render in `--signal`

**Criterion**: TEST-18 — *"The unarmed item's sub-label reads `user-only · click twice to confirm`
and renders in `--signal`."*
**Expected**: computed `color` of the sub-label = `--signal` = `#c4552e` = `rgb(196, 85, 46)`.
**Observed**: `rgb(155, 161, 168)` = `--ink-3`. The `--signal` treatment sits on the item's
**action line** (`.cp-quote`), not on the sub-label.

```html
<button type="button" class="cp-item cp-danger" role="menuitem" data-dm-act="delete">
  <div class="cp-quote">Delete…</div>          <!-- color: rgb(196, 85, 46)  = --signal -->
  <div class="cp-meta">user-only · click twice to confirm</div>  <!-- color: rgb(155,161,168) = --ink-3 -->
</button>
```

**Steps to reproduce**:
1. `corpus init <ws> --port 8982`, seed one note, `corpus server start`, open the printed URL.
2. Click the note's row to open the reader; click the ⋯ (`[data-doc-menu]`) button.
3. In devtools, select the `.cp-item` whose text starts `Delete…` and read
   `getComputedStyle(item.querySelector('.cp-meta')).color`.
4. Observed `rgb(155, 161, 168)`; `--signal` is `#c4552e`.

**Aggravating factor (honesty)**: UI-005's E2E log asserts the opposite —
*"unarmed sub-label `user-only · click twice to confirm`, rendered in `--signal` (`rgb(196, 85, 46)`)"*.
The measured value belongs to the sibling `.cp-quote`. This is the one sampled claim in the log
that did not reproduce.

**Note on scope**: this is cosmetic. Everything load-bearing about the destructive act — the copy,
the two-click arming, the zero-request first click, the server's 403 for the agent, and the
git-history retention — passed.

## Additional findings (not criterion failures — for the phase PR reviewer)

### FIND-2: the force-unlock toast claims a requeue it has no evidence for

`POST /api/locks/{docId}/break` answers `{docId, released, holder}` — nothing about deferred work.
The toast nevertheless always reads *"…and the agent's deferred edit was re-queued."* Observed
firing verbatim on a lock that had **no** deferred event registered, so nothing was requeued.
TEST-37 demands the toast's claims be independently true; here one of them is unconditional copy.
Suggest making the clause conditional (or dropping it) rather than asserting an unobservable.

### FIND-3: a non-id `[[token]]` renders as a live link into a dead reader

SPEC.md §5 says references are **id-based** (`[[doc_…]]` / `[[th_…]]`). The server agrees — it
raises `unresolved_ref` for `[[doc_notyet]]` and ignores `[[not-a-real-doc]]` entirely. The reader
renders `[[not-a-real-doc]]` as an enabled `<a class="ref">`; clicking it pushes a nav entry and
lands on a reader whose id is `not-a-real-doc` (the ⋯ menu renders disabled; no throw, no page
error). `[[doc_notyet]]` is correctly `.ref-broken` and inert. Recommend the broken treatment (or
literal text) for anything that is not an id.

### FIND-4: duplicate toast nodes

Every toast was observed twice in the DOM (`[class*=toast]` returns two identical nodes). Harmless
if one is an `aria-live` mirror, but worth confirming it is not a double render.

## Summary

41 of 42 criteria met (with TEST-14/33 accepted from the log as source-level and TEST-38
unreproducible by design). The reader is genuinely a reader: it opens per column, renames propagate
into refs live over SSE, backlinks come from one request, the nav stack restores scroll to the
exact pixel and survives a reload at version 2, focus mode keeps its own stack, the escape registry
resolves menu → focus → reader one layer at a time, and both destructive acts (Delete, Still
current) are correct on disk and in git. **PARTIAL** on the strength of FAIL-1 alone.
