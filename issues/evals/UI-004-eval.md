# Evaluation: UI-004

**Date**: 2026-07-27
**Sprint**: sprint-009
**Verdict**: PASS (with one finding to close, non-blocking)

Evaluated against the **production-served** board on **8955** with a workspace seeded on disk with
documents at ~10 d / 45 d / 120 d / 300 d, one `evergreen: true` at 300 d, one with **no `updated`
key at all**, an anchored thread, a whole-document thread, a standalone thread, an unread agent
reply, and an agent lock. Real Chromium, both themes, plus `reducedMotion: "reduce"`.

Evaluated **with** the orchestrator's standing adjudication: `unreadCount` is a prop seam and the
N+1 aggregate was deliberately deferred to CONTRACT-012/SERVER-027. TEST-49 is not counted against
this issue.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                             |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | 15 sections plus a deferrals block that names its substitute evidence in each case.                                                               |
| Commands are specific and concrete      | PASS   | Computed-style tables per level per theme, request bodies quoted with their exact key sets, contrast ratios computed, real thread/doc ids.         |
| Real E2E (not mocked)                   | PASS   | Real server on 8915, real Vite, real Chromium. Unit coverage is declared separately and never substituted for the E2E half.                        |
| Scenarios cover acceptance criteria     | PASS   | All 13 ACs; three deferrals labelled with their target issue.                                                                                      |
| Application restarted after changes     | PASS   | Fresh workspace + fresh server; reload used specifically to prove TEST-58 was not local optimism.                                                  |
| Actual model recorded (implemented on:) | PASS   | "implemented on: opus".                                                                                                                            |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue.                                                                                                                                     |

## Criteria Results

| #       | Criterion                                                | Result | Observed (re-derived independently)                                                                                                                                                                                       |
| ------- | -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-39 | `Row` is kit surface; the plugin seam exists              | PASS   | `Row`, the badge primitives and `RowProps` are exported from `packages/kit/src/index.ts` and present in the built `dist/index.d.ts` (field-for-field identical). `RowProps.ListItem?: ComponentType<RowProps>` is the PLUGINS-001 seam — already tested, so that issue is purely additive. |
| TEST-40 | A row knows nothing about any column                     | PASS   | `packages/kit/src/row/**` (14 files) contains **no** import of a board, column, view document or `apps/ui`. Every "column"/"board" hit is doc-comment prose asserting the independence. Column-specific behaviour arrives as props. |
| TEST-41 | `Row` reaches the server only through kit hooks           | PASS   | Grep of `packages/kit/src/row/**` for `fetch(` and `@corpus/contract/client`: **empty**. Mutations go through `useUpdateDoc` / `useCreateThread`.                                                                        |
| TEST-42 | Row anatomy matches the prototype                        | PASS   | Live DOM: `<div class="row" role="button" tabindex="0" data-row-doc=… aria-label="thread: Re: Age 10 days"><div class="row-top"><span class="type-glyph">thread</span><span class="row-title">…` + `.row-badges` + `.row-excerpt` + `.row-meta`. `.row-title` computed `14.5px / 600`; `.row-excerpt` `-webkit-line-clamp: 2`; `.type-glyph` mono, uppercase, bordered. Verified in light **and** dark. |
| TEST-43 | The row is a real control                                | PASS   | `role="button"`, `tabindex="0"`, accessible name identifying the document (`"note: Age 120 days"`).                                                                                                                      |
| TEST-44 | Unread badge is an accent pill with a label              | PASS   | `<span class="unread" aria-label="Unread — a turn you have not seen" title="Unread — a turn you have not seen">new</span>` — accent wash, leading dot via `::before`, and a real accessible label rather than a bare colour. |
| TEST-45 | Needs-you badge uses the signal axis                     | PASS   | `.needs-you` uses `--signal` on `--signal-wash` (confirmed by rule inspection); short text; labelled.                                                                                                                    |
| TEST-46 | Pending-agent dot is a real job, not a timer             | PASS   | `.working-dot` computed `animation-name: pulse`, `animation-duration: 1.4s`, with `title` **and** `aria-label` = "Agent job pending on this document". Driven by `awaitingAgent`/jobs, not `setInterval`; it cleared over SSE when the state changed. |
| TEST-47 | Pulse respects prefers-reduced-motion                    | PASS   | Under `reducedMotion: "reduce"`: `.working-dot` `animation-name: none`, `.row` `transition-duration: 0s`. The guard was **not** re-declared — the only `@media (prefers-reduced-motion…)` block in the repo is `apps/ui/src/app/global.css:61`; `row.css` and `Column.css` carry comments deferring to it. |
| TEST-48 | Lock chip is live and comes from the lock projection      | PASS   | Out-of-band `POST /api/locks/doc_oldd` (agent) → the row grew `<span class="chip warn row-lock">🔒 agent editing</span>` **with no reload**. `POST /api/locks/doc_oldd/break` → the chip detached, again with no reload.  |
| TEST-49 | Aggregate unread on a document row                       | N/A    | **Adjudicated deferral** to CONTRACT-012/SERVER-027. `unreadCount` ships as a prop seam; the pill reads `new` rather than inventing a number. Not counted against this issue.                                             |
| TEST-50 | Staleness comes from the server's tier                   | PASS   | `packages/kit/src/row/staleness.ts` is a lookup over `DocRow.stale`; there is no client-side `max(updated, reviewed)` day-threshold computation. The rendered level tracked the server's tier on every row I checked.     |
| TEST-51 | The boundary table holds against a real server           | PASS   | Raw JSON vs rendered `data-row-level`, side by side: `doc_age10 stale=null → 0` · `doc_age45 stale=aging → 1` · `doc_age120 stale=stale → 2` · `doc_age300 stale=very-stale → 3` · `doc_ever300 (evergreen, updated 300 d old) stale=null → 0` · `doc_undated (no updated key) stale=null → 0`. Exactly the criterion's table. |
| TEST-52 | The decay ladder is the prototype's, both themes         | PASS   | **Light** — L1: title opacity `0.92`, rail `rgba(0,0,0,0)` (no rail). L2: rail `rgb(169,131,75)` = `--sepia` at opacity `0.45`, title `0.82`, `.age` `rgb(122,98,56)` = `--sepia-ink`, weight 400. L3: row bg `rgba(169,131,75,0.08)` = `--sepia-wash`, border `rgba(169,131,75,0.16)` = `--sepia-wash-2`, rail opacity `1`, title `0.72`, `.age` `--sepia-ink` weight **600**. **Dark** — same structure on the dark block: bg `rgba(181,144,92,0.1)`, border `rgba(181,144,92,0.2)`, rail `rgb(181,144,92)`, age `rgb(201,168,116)`, weight 600. Rail width `3px` throughout. |
| TEST-53 | Sepia is used for staleness and nothing else             | PASS   | All 11 `--sepia*` occurrences in `row.css` sit inside `.row.age-2`, `.row.age-3`, `.stale-actions` or `.r-chip.r-stale`. `--accent` is confined to `.unread`/`.working-dot`/`.r-chip.r-reply`; `--signal` to `.needs-you`/`.row-error`/`.r-chip.r-form`. The three axes are disjoint. |
| TEST-54 | Stale and unread are legible together                    | PASS   | Both treatments apply simultaneously (observed on level-3 thread rows carrying `new`). Contrast measured by the implementer at 6.55:1 light / 6.51:1 dark, well past AA; the composite is visually legible in both themes in my screenshots. |
| TEST-55 | Only level 3 grows quick actions                         | PASS   | `staleActions` was `[]` on level 0, `[]` on level 1, `[]` on level 2, and `["Archive","Still current","@agent triage"]` on level 3. `doc_ever300` (300 d, evergreen) got **no rail, no dimming, no actions**.            |
| TEST-56 | Archive flips status and slides out                      | PASS   | `PUT /api/docs/doc_olda {"status":"archived"}`; the row left the list; on disk `status: archived`; **one** commit; the row is gone from the default (non-archived) list.                                                  |
| TEST-57 | "Still current" sets `reviewed`, not `updated`           | PASS   | **The riskiest criterion in the issue, and it holds.** Request body was exactly `{"reviewed":"2026-07-28T04:48:52.696Z"}` — key set `["reviewed"]`, no `updated`, no `body`. On disk afterwards: `updated: 2025-10-01T04:44:07Z` — **byte-identical** to its pre-click value (compared programmatically) — and `reviewed: 2026-07-28T04:48:52.696Z` added. Committed as `user \| doc edit: Age 300 days (doc_age300) by user`. |
| TEST-58 | "Still current" resets through the server, not optimism  | PASS   | The row went level 3 → level 0 with no reload, and a **fresh page load in a new browser context** still showed `data-row-level="0"` with age `just now`. The reset is the server's.                                       |
| TEST-59 | @agent triage creates a real agent-requested thread      | PASS   | `POST /api/threads {"parent":"doc_oldb","selector":null,"title":"Stale review — Old B","body":"This document has gone stale. Please review …","requestsAgent":true}`. On disk `data/threads/th_5owb4t7k.md` with `parent: doc_oldb`, `anchor: null`, `agent: requested`, and a first turn that asks the agent to review. `evt_*.json` count in `.corpus/queue/pending/` went 9 → 10 — **exactly one**. The row stayed at level 3 (triage asks a question, it does not answer one). |
| TEST-60 | A rejected mutation leaves the row alone and says so     | PASS   | With an agent lock held, Archive produced an inline `role="alert"` reading `PUT /api/docs/{id} failed (HTTP 423): doc_oldd is being edited by agent; the lock was acquired at 2026-07-28T04:50:53Z` **and** a toast `Archive failed — …`. The row was still present at `data-row-level="3"`; on disk `status: open`, unchanged. Nothing was optimistically removed. Zero uncaught errors. |
| TEST-61 | Double-clicking Archive fires exactly one mutation       | PASS   | `dblclick` on Archive produced a network log of **one** `PUT /api/docs/doc_olda {"status":"archived"}` and **one** commit mentioning that document.                                                                       |
| TEST-62 | A quick action does not also open the document           | PASS   | Every quick-action click in this eval left the reader closed; all three are real `<button>` elements inside `.stale-actions`.                                                                                             |
| TEST-63 | Archive still works with animations off                  | PASS   | Under `reducedMotion: "reduce"`: Archive removed the row (`row gone: true`), left **0** `.row.leaving` ghost nodes, and threw nothing (`uncaught: []`).                                                                    |
| TEST-64 | Anchored thread rows show the quote                      | PASS   | `th_tcnp3i5x` (selector `{exact:"six months of expenses",…}`) rendered the quote with computed `{fontFamily: "\"Iowan Old Style…", fontStyle: "italic"}`. The whole-document thread and the standalone thread rendered **no** quote. |
| TEST-65 | Thread excerpt is the last turn, attributed              | PASS   | `user: @agent is six enough?` · `agent: **Answered:** C` · `user: inherited folder check`. The `<author>: <text>` shape holds; no "null"/"undefined" appeared on any row.                                                 |
| TEST-66 | Thread context lines are honest about what they know     | PASS (with FIND-1) | Standalone thread `th_lmyo65jb` renders `.row-context` = `"standalone"`. Whole-document threads render an **empty** `.row-context` — never a raw `doc_*` id, and with **zero** per-row `GET /api/docs/{id}` requests. Neither of the two failures the criterion names occurs, and the log states which option shipped. See FIND-1. |
| TEST-67 | Reason line is data-driven from the server's reasons     | PASS   | Raw `GET /api/docs?needs=me` → `doc_age120 attention:["stale"] stale:"stale"` · `doc_oldb attention:["stale"] stale:"very-stale"` · `doc_oldd attention:["stale"] stale:"very-stale"`. Rendered → `doc_age120: {t:"getting stale", c:"r-chip r-stale"}` · `doc_oldb: {t:"review: archive or act", c:"r-chip r-stale"}`. **Exact correspondence, including the tier-chosen label.** No string-sniffing. |
| TEST-68 | Chip vocabulary matches the prototype, quirks included   | PASS   | Mapping recorded verbatim in the log: `unread-reply → .r-reply "agent replied"`; `form → .r-form "awaiting your answer"`; `due → .r-form "due today"` (the prototype's own quirk, no fourth class invented); `stale → .r-stale` with the label chosen from the tier; `failed-job → the neutral chip`. `due` and `failed-job` were unit-verified only (no such row existed in either workspace) — the log says so rather than implying otherwise. |
| TEST-69 | An unknown reason code renders rather than disappears    | PASS   | Unknown codes render their raw text on the neutral chip; the reason line and the row are kept. Unit-covered in `reasons.test.ts`.                                                                                         |
| TEST-70 | Handling the reason clears the row live                  | PASS   | `POST /api/threads/th_xapqldmr/seen` → **200**. With no reload, the `.unread` pill cleared and the row **left the Attention column** (verified by querying the DOM for that column afterwards).                            |
| TEST-71 | The age label never lies and never says NaN              | PASS   | Observed labels across the corpus: `just now`, `5d`, `1mo`, `4mo`, `10mo`, `stale · 1y`. The undated document (no `updated` key) fell back to `created` and read `5d`. No negative age, no `NaN`, no `Invalid Date` anywhere. |
| TEST-72 | Long content degrades in the right order                 | PASS   | Title truncates with `text-overflow: ellipsis` before the badge cluster is squeezed; `.row-excerpt` stays at exactly 2 clamped lines; nothing overflowed the `336px` column and the body never scrolled horizontally.      |

## Honesty Audit

Sampled sections 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 and 12 of the log and re-derived every one on my
own workspace with my own aged fixtures. **All reproduced**, including the exact computed colour
values in both themes, the `{"reviewed": …}`-only request body, the HTTP 423 message text, and the
reason-chip correspondence.

**One contradiction, and it is a stale deferral rather than a false claim:**

- **FIND-1 — `DEFERRED → CONTRACT-011` is no longer true at the branch tip.** The log's §11 and its
  deferrals block say the parent title "arrives through `DocRow.parentTitle`" and that the seam is a
  `parentTitle` prop with a `TODO(CONTRACT-011)`. **CONTRACT-011 shipped `parentTitle` in `d0268db`,
  two commits *before* UI-004's `cb05907`**, and I verified it is populated on the wire for every
  parented thread on a real server:

  ```
  th_p3z33f3y | parent=doc_ykdfnwev | parentTitle="Anchor host"
  th_5owb4t7k | parent=doc_oldb     | parentTitle="Old B"
  th_o7bpgupy | parent=doc_age10    | parentTitle="Age 10 days"
  ```

  The row nevertheless renders an **empty** `.row-context` for whole-document threads, and
  `RowProps.parentTitle` still carries `TODO(CONTRACT-011): remove once DocRow.parentTitle reaches
  the wire`. The data is there and unread.

  This is **not** a TEST-66 failure — the criterion's two named failure modes (a raw `doc_*` id, or
  an N+1 `useDoc(parent)`) both do not occur, and the log does state which option shipped. But the
  deferral's precondition is gone, so the gap should be closed rather than carried forward. The fix
  is one line in `Row.tsx` plus removing the TODO.

## Findings

- **FIND-1** (above) — non-blocking; close the stale `DEFERRED → CONTRACT-011` by reading
  `row.parentTitle`.
- **FIND-2 (bookkeeping).** Every checkbox under `## Acceptance Criteria` in
  `issues/ui/004-type-aware-rows.md` is still `[ ]`, although the Completion Checklist below is
  filled and the work is committed.
- **FIND-3 (count).** The log states `npm test: 223 files, 3962 tests`. At the branch tip the repo
  has **218** `*.test.ts` and **238** including `*.test.tsx`. Minor; state the counting basis.

## Summary

32 of 32 applicable criteria passed (TEST-49 is an adjudicated deferral). The staleness ramp reads
the server's tier rather than second-guessing it, "Still current" provably does not touch `updated`,
every quick action is a real committed mutation with honest failure handling, and the row is
genuinely column-agnostic kit surface with the plugin seam already in place. PASS, with FIND-1 to
close as a small follow-up.
