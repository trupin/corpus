# [UI-190] A document shows what it costs

## Domain

ui

## Status

done

## Priority

P0

## Model

fable

## Dependencies

- Depends on: CONTRACT-097, SERVER-166 (series route live); CLI-085 (data
  exists); the SHARED-079 rider signed

## Spec References

- SPEC.md §10 — the drafted telemetry rider (SHARED-079)

## Summary

A **measurements panel on the document/thread view — deliberately not in the
console section** (SHARED-079's recorded placement reading; flag to the user
at review if the document view makes it cramped, do not silently relocate).

The panel answers one question: **is working with this document getting more
expensive as it grows?**

- The series from `GET /api/docs/{id}/cost`: read-tokens and wrote-tokens
  over time, bucketed as served.
- The document's size as the reference line, so flat-cost-against-growing-
  size is visible at a glance — that shape IS the bounded reads working, and
  the panel exists to show it or its absence.
- A by-command breakdown (the contract's `byCommand`) on demand — which verb
  is paying, not just how much.
- Empty state: a document nobody has touched through the CLI shows the panel
  with an honest "no measurements yet", never a fabricated zero series.
- Read-only, poll-or-SSE per the surrounding view's existing pattern — copy
  what the thread view does, do not invent a channel.

## Acceptance Criteria

- [x] The panel renders the series + size line + by-command breakdown from a
      workspace with real CLI-085 data — E2E via Playwright against seeded
      telemetry
- [x] Not in the console section; reachable from the document and thread
      views
- [x] Empty state honest; truncation stated when the server truncated
- [x] Units labelled as the workspace token estimate (bytes ÷ 4), same words
      as the CLI help uses

## E2E Verification Log

**Model: Opus 5 (1M).** Ruling E1 was applied — the chart is hand-rolled SVG in
`packages/kit`, and no charting dependency entered any manifest. E2's split was
not needed: the series, the size line, the empty state **and** the by-command
breakdown all landed together.

### The real workspace, the real server, and a ledger seeded over HTTP

A fresh workspace at `.../scratchpad/ws190` (`corpus init`), server on `:8767`
(pid 60819), three documents created through `POST /api/docs` and
`POST /api/threads`, and seven invocations posted to
`POST /api/telemetry/invocations`. CLI-085 was not waited on, as instructed.
Then Vite on `:5199` with `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8767` and the
workspace token, and Chromium driven against it.

**The numbers, checked by hand.** For the long document `doc_vzfpwigf`:

| figure | server / disk | panel |
| --- | --- | --- |
| size | `wc -c` = **40422**, `sizeBytes` = 40422 | `current size 10,106` = `ceil(40422 / 4)` |
| read | 670 + 463 + 376 | `read 1,509` |
| wrote | 40 + 29 + 25 | `wrote 94` |
| window | 1509 + 94 | `1,603 tokens over 3 daily buckets, ending 2026-09-07` |
| by command | `doc show` 1,256 · `thread show` 174 · `search` 173 | identical, and the table's own `total` row reads **1,603** |

The breakdown sums to the window total exactly, which is the property
`CostBucketSchema` fixes the conversion grain to protect. One bucket checked
against its own invocations: `ceil(60/4) + ceil(1200/4) + ceil(60/4) +
ceil(1180/4) = 625` = the server's `byCommand["doc show"]` for 2026-09-05.

**The shape TEST-1221 exists for, observed.** `domain-max` is 10106 — the size
line, at `y1 = 10`, the top of the plot — and the three daily bars are 7.69,
5.31 and 4.32 units tall at the baseline. Flat cost far under a much larger
document, legible without reading a number. The conversation `th_7xua6bfj`
shows the opposite shape in the same panel: 174 tokens of reads towering over a
65-token conversation, with one zero day drawn as nothing.

**A defect the browser found and the unit tests could not.** `MIN_BAR` was 1
viewBox unit. Measured in Chromium, the `wrote` rect came out **0.68 px** tall —
in the DOM, invisible on screen, which is the exact failure the floor exists to
prevent. The panel renders 140 units as ~96 CSS pixels in a column. `MIN_BAR` is
now **1.5**, re-measured at **1.03 px**, and all three test layers assert 1.5.

**Every state, in the real app.** Series (`doc_vzfpwigf`), honest empty
(`doc_akcwz52f` — *"No measurements for this document. This workspace has been
measuring since 2026-09-07 …"*, no chart drawn), conversation (`th_7xua6bfj`,
its own series, not rolled up into its parent), full screen (1 chart, same call
site), light and dark. Console: three tabs opened, **zero** occurrences of
`.cost` or `.cost-chart` inside `.console-body`, and the reader's panel still
present. **Zero uncaught page errors** across the whole drive.

### Playwright — the rendering half

`apps/ui/e2e/cost.spec.ts`, 8 tests, **8 passed** on `CORPUS_UI_PORT=5299`. Two
were red on their first run and both were spec faults, not product faults: an
open path column survives a reload, so `.reader .cost` matched two panels, and
`boundingBox()` was answering `null` where a rect's own `top` does not.

**Falsified, not assumed.** Moving the call site above the body made
`does not move the body when the series arrives` fail by **206.9 px**
(413.67 → 620.61) — the same class of shift `DocView.tsx` records at 77.86 px.
Restored, the spec is green. Two more falsifications in the unit layer: removing
the `MIN_BAR` floor fails the visibility test (0.00116 against 1.5), and dropping
`sizeTokens` from the y-domain fails `costDomainMax` (1 against 9000). The
DocView ordering assertion was **found vacuous first** — `Backlinks` and
`RelatedPanel` render `null` when empty, so the filtered list held one name and
any order passed. Both are seeded now, and the falsification then goes red
(`['cost','backlinks','related']`).

### A regression the workspace-scoped run caught, and the two fixes it earned

The first full `apps/ui` + `packages/kit` run went **14 red**. One was
bookkeeping — `packages/kit/src/index.test.ts` pins the published surface and
three new symbols had to be declared. The other **thirteen** were a real defect
I had introduced, in `Board.test.tsx` and `Explorer.test.tsx`, files that have
nothing to do with cost.

`boardFixture` answered `GET /api/docs/{id}/cost` from its `json({})` catch-all.
The panel renders on every open document, so it read that `{}` as a
`DocumentCost`, and `cost.buckets.length` threw — in a component where a throw
is a blank board. **This is the trap already recorded twice in this domain**, and
it caught me a third time.

Both halves were fixed, because either alone leaves the hazard:

1. **`seriesOf` in the panel.** An answer that is not a series now reads as
   *nothing was received* — the same note a failed request gets — never as an
   empty ledger, which is a claim about the workspace. Falsified: removing the
   guard turns the new test red.
2. **`boardFixture` answers the route** with an honest empty ledger, and
   `readerFixture` and `stubCorpus` got real handlers too (`404` for a document
   they do not hold, as `series.ts` answers one) plus `satisfies DocumentCost`
   at the call site, so the next contract field is a compile error there.

A third fix rode along, from the same review: `GRANULARITY_WORD` is still a total
`Record` — a fourth span is a compile error — but reading it now falls back to
the server's own word, because a client is routinely older than its server.

### Unit and type gates

Final workspace-scoped run, `apps/ui` + `packages/kit`: **255 files, 5168 tests,
all green** (`VITEST_MAX_THREADS=4`). `npm run typecheck` clean across every
workspace, `npm run lint` clean, `npm run format:check` clean. No rule was
disabled and no test was skipped.

### Left for the orchestrator

- **`TOKEN_UNIT_NOTE` is the panel's half of R1's one wording.** CLI-085 had not
  landed, so there was no help note to copy. The panel says *"Tokens are this
  workspace's estimate: bytes ÷ 4, rounded up."* — cli-dev must match it.
- Ports `5199` and `5299` were released, the `:8767` workspace server was
  stopped, and every one-off driver script was deleted.
