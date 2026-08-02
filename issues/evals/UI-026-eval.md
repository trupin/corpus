# Evaluation: UI-026

**Date**: 2026-08-02
**Sprint**: sprint-022
**Verdict**: PARTIAL
**Evaluator model**: Opus 5 (1M context)

Real browser (headless Chromium via Playwright, 1600×1000) against the **real app**: the server on
`8808` serving the freshly built `apps/ui/dist`, over a 273-document workspace with a real semantic
index. Network watched on every interaction.

### Design quality (subjective rubric)

| Dimension     | Score | Note                                                                                            |
| ------------- | ----- | ------------------------------------------------------------------------------------------------- |
| Design        | 4     | Title / highlighted snippet / heading-path subtitle is a clean three-line result row; the degrade note is a genuinely quiet single line |
| Originality   | 4     | The empty state ("Type to search — documents, threads and turns, ranked.") states the contract rather than showing a shrug |
| Craft         | 4     | One request per settled query, no blanking between keystrokes, `<mark>` runs built client-side so no HTML string is trusted |
| Functionality | 3     | Docked one point: the `tag:` chip renders as an affordance and does nothing (FAIL-1)             |

Average 3.75, no dimension at 1 — passes the threshold; the functional defect is scored separately below.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                        |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| Verification log present                | PASS   | `issues/ui/026-search-overlay-unified.md:47-225`                                                  |
| Commands are specific and concrete      | PASS   | md5 hashes of the frozen files, pasted wire traffic, the saved view document verbatim             |
| Real E2E (not mocked)                   | PASS   | Real Chromium against Vite 5287 → server 8810, real `corpus index rebuild` for the degraded case  |
| Scenarios cover acceptance criteria     | PASS   | All four ACs                                                                                      |
| Application restarted after changes     | PASS   | Ports confirmed free before and after; e2e held single-holder                                     |
| Actual model recorded (implemented on:) | PASS   | `implemented on: opus` (2026-08-01, ui-dev)                                                       |
| Reproduction logged before fix (bugs)   | N/A    | Feature                                                                                           |
| Deferrals declared with substitutes     | PASS   | `DEFERRED → no git` for the pre/post-build comparison, with md5 + source-asserted substitutes      |

**The log is candid about the defect this evaluation confirms** — it states the `tag:` chip lost its
options, gives the reasoning, and records the escalation. The proof-of-work is not at fault; the
shipped behaviour is.

## Criteria Results

| #   | Criterion                                                                     | Result | Observed                                                                    |
| --- | ----------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------- |
| 1a  | Overlay results come from `/api/search`, ranked, with heading-path subtitles   | PASS   | `GET /api/search?q=…` is the only search request; `.sr-path` on every row     |
| 1b  | Archived behaviour unchanged                                                   | PASS   | Default sends no `status`; the chip emits `includeArchived=true`               |
| 1c  | **Chips unchanged**                                                            | **FAIL** | All 12 chips render, but the `tag:` chip is inert — see FAIL-1                |
| 2   | Staleness note shown exactly when flagged; absent on `current`                 | PASS   | Present at `state indexing`, absent at `state current`                        |
| 3   | "Save as view" produces an identical view doc; the column stays on `GET /api/docs` | PASS | Frontmatter `query: {q, sort: relevance}`; **0** `/api/search` requests on board load |
| 4   | Result click-through navigation unchanged                                     | PASS   | `↵` closed the overlay and opened the reader in its home column                |

## Evidence

### AC 1a — one endpoint, ranked, with subtitles

```
=== OVERLAY EMPTY, requests: ["/api/tree"]
EMPTY-STATE LINE: "Type to search — documents, threads and turns, ranked."
=== AFTER TYPING "watering seedling tray": ["/api/tree","/api/search?q=watering%20seedling%20tray"]
```

```html
<button type="button" class="sr" data-sr="doc_gt2cvtta">
  <div class="sr-title"><span class="type-glyph">doc</span>Greenhouse plan</div>
  <div class="sr-snippet">…wall. ## <mark>Watering</mark> The drip lines deliver water to each
      <mark>seedling</mark> <mark>tray</mark> every…</div>
  <div class="sr-path">Greenhouse plan › Watering</div></button>
```

No `GET /api/docs?q=` was issued from the overlay at any point. Grouping by kind survives
(`Documents · 4`, `Threads · 6`), and a thread hit's `.sr-path` is the turn's heading
(`user · 2026-08-02T04:12:40Z`) — §7's rule for hits inside turns.

Debounce holds: typing 16 characters one at a time produced **exactly one** request.

### AC 1b — archived by omission

```
default query           → GET /api/search?q=watering
"include archived" on   → GET /api/search?includeArchived=true&q=watering
```

No `status` parameter in either — the default is still expressed by omission, and the chip lifts it
rather than narrowing to archived-only.

### AC 2 — the degrade note, two surfaces one word

Mid-`corpus index rebuild` (`indexed 176 / pending 408`):

```
$ corpus index status →  state  indexing
overlay              →  "Ranked on text alone — the semantic index is still being built."
```

At `state current` the line is absent from the overlay. It is not `#`-prefixed, names no SPEC
section, and does not reuse the CLI's raw state word — a UI voice, not a leaked transcript.

### AC 3 — the lane separation, proven on the wire

`⌘K` → `watering` → `save as view`. The document the real server wrote:

```yaml
id: doc_xh6l6a6g
type: view
title: watering
pinned: true
order: 13
query:
  q: watering
  sort: relevance
```

`sort: relevance` — the **list** grammar, not a `/api/search` parameter set. On a full board reload:

```
BOARD RELOAD REQUESTS:
 /api/docs?pinned=true&sort=order&type=view
 /api/health · /api/queue/status · /api/jobs
 /api/docs?needs=me
 /api/docs?folder=inbox
 /api/docs?status=open&type=thread
 /api/docs?q=watering&sort=relevance      ← the new column
 /api/locks
=== /api/search COUNT ON BOARD LOAD: 0
```

Ranked retrieval is confined to the overlay; the saved column is a filtered list served by
`GET /api/docs`. SPEC.md:409's signed rule holds, observed rather than asserted.

## Failures

### FAIL-1: the `tag:` filter chip is an inert control

**Criterion**: AC 1 — "chips and archived behavior unchanged". SPEC.md §11 lists `tag` among the
filter chips the overlay's query composes with.

**Expected**: clicking `tag: any` offers the corpus's tag vocabulary and applies a `tag` filter to
the query, as every other vocabulary chip does.

**Observed**: clicking it changes nothing. No popover, no state change, `aria-pressed` stays
`false`, the label stays `tag: any`, and no request is issued — even though the workspace has real
tags on real documents (`#garden`, `#irrigation`, visible on the documents' own frontmatter chips in
the reader). The control is indistinguishable from the working chips until you press it.

Side-by-side with the `type:` chip in the same session:

```
before:  <button class="chip" aria-pressed="false">type: any</button>
                 <button class="chip" aria-pressed="false">tag: any</button>
after clicking each:
         <button class="chip on" aria-pressed="true">type: note</button>     ← works
                 <button class="chip" aria-pressed="false">tag: any</button>  ← unchanged
```

**Steps to reproduce**:

1. `corpus init <ws> --port 8808`; seed two notes and tag one:
   `corpus doc edit <id> --add-tag irrigation --add-tag garden --from user`.
2. `corpus server start`; open `http://127.0.0.1:8808/` in a browser.
3. Press `⌘K`, type any query that returns results.
4. Click the `type: any` chip — it cycles to `type: note` and re-queries.
5. Click the `tag: any` chip — nothing happens, in the DOM or on the wire.

**Status**: this is a known, disclosed consequence of the endpoint change (a `SearchHit` carries no
`tags`, so the chip has no vocabulary to offer), it is already **escalated to the orchestrator as a
contract question**, and sprint-022's TEST-1027 explicitly permits it *provided the log states which
chip lost its options and why* — which the log does. It is recorded here as a criterion failure
because the issue's own AC and SPEC §11 both say the chip works, and because a control that renders
as an affordance and does nothing is a user-visible defect regardless of its cause. The adjudication
(fix, waive, or amend §11) belongs to the orchestrator, not to this verdict.

## Observations (not failures)

- **The type glyph is coarser than before.** A hit carries no `type`, so the glyph reads `doc` or
  `thread` off the id prefix; a `view`, `skill` or `template` hit now shows `doc`. Grouping still
  reads "Documents / Threads", which satisfies §11's "grouped by type", but the per-row distinction
  a `GET /api/docs` row used to carry is gone. Disclosed in the log.
- **A chip-only overlay issues no request** and says "Type to search…" rather than claiming nothing
  matched. `q` is required by the endpoint; the wording is honest. Disclosed in the log.

## Summary

5 of 6 sub-criteria passed. The endpoint switch, ranked list, heading-path subtitles, degrade note,
archived semantics, debounce and — most importantly — the save-as-view lane separation (0
`/api/search` requests on board load) are all correct on the real wire. One chip is dead, and it is
a control the spec names.
