# [UI-025] Related-documents panel beside backlinks

## Domain
ui

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: CONTRACT-022, SERVER-041
- Blocks: —

## Spec References
- SPEC.md §11 document view (SHARED-006 Edit 12)

## Summary
Below the body, beside the backlinks panel: the ranked related set from
`GET /api/docs/:id/related` — each row title + why it is related (linked / similar /
both; `similar` appears only once Phase B serves it — the UI renders whatever the
route returns, no phase logic client-side). Clicking a row pushes onto the reader's
navigation stack like following a ref. Both hosts (column reader + focus mode) via
the shared DocView; TanStack Query with the standard invalidation keys; empty state
renders nothing (like backlinks).

## Acceptance Criteria
- [x] Panel renders ranked rows with relation labels; click pushes the nav stack (Back returns)
- [x] Present in both hosts; absent (not empty-boxed) when no related docs
- [x] SSE invalidation refreshes it like backlinks

## Technical Design
### Files to Create/Modify
- `apps/ui/src/reader/RelatedPanel.tsx` (new + tests), DocView wiring next to the backlinks panel, kit query hook if the pattern requires one

## Testing Strategy
apps/ui scoped (VITEST_MAX_THREADS=4); e2e case in the reader spec (stubbed related payload).

## E2E Verification Plan
Real app: linked docs show the panel; click navigates with working Back.

## E2E Verification Log

**Implemented on: opus** (ui-dev, 2026-08-01). Sprint-022, TEST-1009–1021. Ports: server
`8807`, Vite `5282`, both confirmed free before and after
(`lsof -nP -iTCP:5282 -sTCP:LISTEN` → no rows).

### Stage 1 — the OC6 shared prep (kit exception, granted for exactly this)

One `CorpusClient` method, one hook, one key builder and one export **per consumer**, landed once
so UI-025 and UI-026 could run concurrently:

| | UI-025 | UI-026 |
| --- | --- | --- |
| client method | `relatedDocs(id, params?)` | `searchCorpus(params)` |
| hook | `useRelatedDocs(id)` | `useCorpusSearch(params)` |
| key builder | `relatedKey(id)` | `searchKey(params)` |
| export | `index.ts` + `index.test.ts` pin | `index.ts` + `index.test.ts` pin |

Plus both `apps/ui/e2e/stubCorpus.ts` branches (`/api/search`, and `/api/docs/{id}/related`
inserted **before** the `startsWith("/api/docs/")` block so `rest = "<id>/related"` no longer
falls through to `store.get(id)` and 404s), `q` support in `matches()`, and the `references`
short-circuit replaced by real `[[ref]]`-graph matching.

**TEST-1010 / Open Conflict 7 — no tenth key name.** `relatedKey(id)` is
`["docs", <id>, "related"]` and `searchKey(params)` is `["docs", "search", {…canonical}]`. Both
sit under the `["docs"]` prefix the server already emits, so `QUERY_KEY_NAMES` is untouched
(still nine), no contract change, no artifact regeneration. Asserted **behaviourally**, not by
inspecting a key: `retrievalHooks.test.tsx` dispatches a real `invalidate(["docs"])` frame through
the SSE bridge and asserts the related query refetches (and `invalidate(["docs","doc_a"])` too,
and that `["tree"]`/`["locks"]`/`["docs","doc_other"]` leave it alone).

**TEST-1032 naming note.** The sprint text says "one `search` method"; the method shipped as
`searchCorpus` (hook `useCorpusSearch`) per the orchestrator's spawn instruction — same count,
same shape, different spelling. Flagged so it does not read as a deviation.

### Stage 2 — the panel

**TEST-1011 — `apps/ui` never touches a transport.**
`/usr/bin/grep -rn "openapi-fetch\|@corpus/contract/client" apps/ui/src` → nothing new; the panel
reads through `useRelatedDocs` alone, via `useReaderDoc`'s aggregator (now five queries).

**TEST-1015 / TEST-1019 — one mount, backlinks untouched.** `RelatedPanel` is the last child of
`.doc-main`, immediately after `<Backlinks/>`, in `DocView.tsx` — one edit, both hosts.
`Backlinks.tsx` is byte-identical; `Reader.test.tsx`'s backlinks case and `DocView.test.tsx` pass
with **no assertion edited** (156/156 in `apps/ui/src/reader`).

**TEST-1016 — styled in both stylesheets.** `Reader.css` gains the `.related` block beside
`.backlinks` (same measure, same rule, same mono uppercase heading) plus the pair rule
`.backlinks + .related { margin-top: 12px }`; `FocusMode.css` adds `.focus .related` to the 66ch
list. The e2e case reads back `getComputedStyle` in focus mode and asserts the two panels share a
measure (observed `561.226px` for both).

### Real app — a real server, a real semantic index, a real browser

Workspace `s022-ui/ui-025-drill` from `corpus init --port 8807`; Vite `5282` with
`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8807`. Warm model cache (sprint-022 authorises it) —
`corpus index status` → `identity local/all-MiniLM-L6-v2@384 · indexed 63 · pending 0 ·
state current`, so the rows below are **genuinely semantic**, not the reference graph twice.

`corpus doc related doc_ni6qzmvb` (the server's own answer, for comparison):

```
doc_wgd5vzlc          both     The 30-year fixed mortgage sits at 6.4% this week; …
doc_ipt3teyg          similar  Closing costs divided by the monthly saving …
doc_skillcomment      similar  ## When this runs …
doc_skillorchestrate  similar  ## Purpose and when to run …
```

The panel in the column reader, extracted from the live DOM — same ids, same order, same words:

```json
{ "heading": "Related", "rows": [
  { "id": "doc_wgd5vzlc", "title": "Rates this week",      "relation": "both" },
  { "id": "doc_ipt3teyg", "title": "Refinance break-even", "relation": "similar" },
  { "id": "doc_skillcomment",     "title": "Comment",   "relation": "similar" },
  { "id": "doc_skillorchestrate", "title": "Orchestrate", "relation": "similar" },
  { "id": "doc_iwz6fao4",         "title": "Finance",   "relation": "similar" } ] }
```

**Beside backlinks (TEST-1015).** On `doc_wgd5vzlc`, which the mortgage note links to:
`doc-main panel order: ["backlinks","related"]`; backlinks `["Mortgage options"]`; related
`[{"Mortgage options","both"}, …]` — the same document in both panels, for two different reasons,
which is the arrangement the pair exists to show.

**Navigation (TEST-1013).** Clicked the `similar` row `doc_ipt3teyg` — a relation the reference
graph could never produce: title became `Refinance break-even`, the back button read
`‹ Mortgage options`, and Back returned to `Mortgage options`. A push onto the reader's own stack,
identical to a `[[ref]]`.

**Focus mode (TEST-1015).** `[data-expand]` → `.focus.open`: the same five rows, same order, same
relations; `.focus .related` count **1** — one mount, two hosts.

**SSE refresh (TEST-1018), the honest version.** With the reader open and untouched, a **second
process** wrote to the workspace (`printf '… [[doc_ni6qzmvb]] …' | corpus doc edit doc_x4zxdn34`):

```
BEFORE the out-of-band write: ["Rates this week","Refinance break-even","Comment","Orchestrate","Finance"]
out-of-band `corpus doc edit` done (no browser action taken)
AFTER  (no reload, no click):  ["Rates this week","Escrow notes","Refinance break-even","Comment","Orchestrate","Finance"]
relations:                     ["both","linked","similar","similar","similar","similar"]
```

A new `linked` row appeared in rank order with no reload and no interaction — the `["docs"]` frame
the server already sends, reaching a key that did not exist when that frame was designed. This is
the assertion that fails if the key is moved out from under the prefix, and it is the one that
proves Open Conflict 7's ruling on real infrastructure. Screenshot:
`s022-ui/related-panel.png` (REFERENCED BY above RELATED, relations right-aligned in mono caps).

### Tests

- `packages/kit` retrieval: `retrievalHooks.test.tsx` (13) + `keys.test.ts` (36) +
  `createCorpusClient.test.ts` (25) + `index.test.ts` (16) — **90 passed**
- `apps/ui/src/reader`: **156 passed**, of which `RelatedPanel.test.tsx` is 10 new
- `apps/ui/e2e/related.spec.ts`: **5 passed** (`CORPUS_UI_PORT=5282`, single-holder honoured —
  no other e2e run was live)
- `npm test -w packages/kit -w apps/ui`, `npm run typecheck`, `eslint`, `prettier --check`: clean

### Out-of-scope files touched, and why

`apps/ui/src/testing/readerFixture.ts` — the reader's shared transport fixture had no
`/api/docs/{id}/related` branch, so `rest = "doc_m/related"` missed the map and 404'd in every
reader suite. Added a `related` option, the route branch, and `relatedPath` / `relatedFixture`.
Disjoint from UI-026's `apps/ui/src/search/**`.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
