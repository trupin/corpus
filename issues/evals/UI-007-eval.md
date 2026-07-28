# Evaluation: UI-007

**Date**: 2026-07-28 (flagged anomaly re-checked after the fix pass at `85d929a`)
**Sprint**: sprint-011 (TEST-87…122)
**Verdict**: PASS

Production-served board on `9030`, real workspace, real server, real Chromium. Evaluated with the
Orchestrator Adjudications and the Wave-B Addendum treated as binding.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes |
| --------------------------------------- | ------ | ----- |
| Verification log present                | PASS   | |
| Commands are specific and concrete      | PASS   | Real `corpus init`/`server start`/`health` output with pids, real POST bodies, real `git show --stat`, real frontmatter excerpts |
| Real E2E (not mocked)                   | PASS   | Real workspace on 9012, real Chromium via Playwright, documents opened "the way a person opens one: ⌘K omnibox → the result row" |
| Scenarios cover acceptance criteria     | PASS   | TEST-87…122 addressed; two browser-found bugs disclosed and covered by tests; deviations stated in their own section |
| Application restarted after changes     | PASS   | |
| Actual model recorded (implemented on:) | PASS   | "Implemented on: opus." |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue; the two mid-pass bugs are disclosed with their fixes |

**Honesty audit — no contradictions.** I re-derived the log's §15 M3 gold-path claim end to end on
my own workspace and got structurally identical results: the same POST body shape (`parent`,
`selector{exact,prefix,suffix}`, `body`, `requestsAgent:false`), the same one-commit-two-files
`git show --stat`, the same empty queue for note-only, the same frontmatter anchor layout, and the
same "highlight + pip + chip with no reload". The log's own "Deviations, stated" section is
accurate, including the declined-range honesty note.

## Criteria Results

| #   | Criterion                                | Result | Notes |
| --- | ---------------------------------------- | ------ | ----- |
| 87  | Offset map derived from ONE serializer   | PASS   | `git grep` for `export function serialize` across `apps/ui/src` + `packages/kit/src` returns exactly one file: `apps/ui/src/editor/markdown/serialize.ts`. No parallel walk |
| 88  | Trace computed with serialization, cached| PASS (log) | Cache key stated in the log |
| 89  | Highlights are decorations — byte proof  | PASS   | **Independently verified on disk.** After a full session of highlighting, expanding, replying and resolving, `git diff` on the anchored documents shows no `<span>`, no `class=`, no marker character. Serialization is unaffected by rendered highlights |
| 90  | Markdown range → PM range, table-driven  | PASS (log) | Table-driven suite over the shared fixtures |
| 91  | The inverse round-trips                  | PASS (log) | |
| 92  | Added syntax belongs to no text range    | PASS (log) | Snap direction stated |
| 93  | `[[ref]]` is one atomic run              | PASS (log) | |
| 94  | Cross-block range → multiple segments    | PASS   | Observed live: a selection spanning a `**` boundary rendered as **two** `.anchor-hl` segments (`"Bold start"`, `" th"`), never one crossing the markup |
| 95  | Map survives the whole fixture corpus    | PASS (log) | Same fixtures as the round-trip suite |
| 96  | Server ranges become highlights          | PASS   | `.anchor-hl` background `rgba(59,95,151,0.1)` = `--accent-wash`, `border-bottom 2px solid rgb(59,95,151)` = `--accent`; each carries `data-thread="th_…"` |
| 97  | Pip is a widget showing the turn count   | PASS   | `.anchor-pip` `rgb(59,95,151)` background, `99px` radius, text = the thread's turn count. Never serialized (TEST-89) |
| 98  | Resolved threads read as resolved        | PASS   | Resolving flips card and highlight styling live via SSE |
| 99  | The UI never resolves an anchor itself   | PASS   | `git grep indexOf/.search(` under `apps/ui/src/anchors/` → **no matches**; `selector.exact` appears only as a display quote. **Behaviourally confirmed**: with the anchored phrase duplicated in the document, the highlight sat exactly where the server's `range` said (`{start:20,end:38}`), not at the first textual occurrence |
| 100 | Overlapping anchors render and click     | PASS (log) | |
| 101 | Comment popover is a composer            | PASS   | `.comment-pop open` carrying the markdown quote, a textarea placeholdered `Comment — @ route · / skill · [[ link`, a `◉ ask agent`/`○ note only` toggle, and `Comment ↵`. Registers at Popover priority — esc closed it without closing the reader |
| 102 | Selector computed against the MARKDOWN   | PASS   | Wire body: `{"parent":"doc_bcy35lzp","selector":{"exact":"Final paragraph fo","prefix":"aft], https://example.com\n\n---\n\n","suffix":"r anchoring purposes.\n"},"body":"Is this final?","requestsAgent":false}`. The prefix contains `\n\n---\n\n` — **markdown source, not DOM text** — and is untrimmed. Field names match `CreateThreadRequestSchema` |
| 103 | Empty selection cannot create a thread   | PASS   | With no selection the comment affordance is unavailable; with a selection `disabled` is `false` |
| 104 | Disk proof — §15 M3's gold path          | PASS   | Without a reload: highlight + `💬 1 · user` chip. On disk: parent frontmatter gained `anc_dbc5016a` with `exact`/`prefix`/`suffix` matching the wire; `data/threads/th_gzbc6a4x.md` with `parent: doc_bcy35lzp`, `anchor: anc_dbc5016a`, `agent: none`; **one** commit carrying both files (`comment: new thread on doc_bcy35lzp (th_gzbc6a4x) by user`, 2 files changed); `.corpus/queue/pending/` empty |
| 105 | Ask-agent creates the event              | PASS   | Same flow with `◉ ask agent` → `comment.created` naming the new thread: `{"threadId":"th_fbr7ffcy","parentId":"doc_bcy35lzp","turnTs":"2026-07-28T19:14:26Z",…}` |
| 106 | Optimistic highlight paints, rolls back  | PASS   | Sampled 150 ms after submit — the highlight was already painted under the client id; after the response, exactly **one** highlight remained (no flicker, no duplicate) |
| 107 | Comment mid-save queued behind the PUT   | PASS (log) | |
| 108 | Typing near a highlight just edits       | PASS   | Typing before an anchored range: highlights stayed present at 0.2/0.5/1.0/1.5/2.5/4.0/6.0 s — through the local mapping and across the server round trip. No mode, no dialog |
| 109 | Server's report authoritative            | PASS   | Post-PUT decorations match the server's re-resolved ranges |
| 110 | §15 M1's reconciliation semantics        | PASS   | (a) insert before → highlight unchanged, `exact` unchanged (`ntro paragraph`), `prefix` refreshed to `PREFIXED. I` on disk. (b)/(c) analogous. (d) deleting the whole range → **orphans**: server reports `range: null, orphaned: true`, selector preserved byte-for-byte |
| 111 | Delete-then-retype doesn't flicker       | PASS (log) | |
| 112 | Orphaned anchor moves, live, no reload   | PASS   | Deleting the anchored paragraph: the highlight disappeared, **no reload**, and the thread moved into a `Detached threads` section below the body. Chip still functional; stored quote still readable |
| 113 | Deleted thread takes its highlight       | PASS (log) | |
| 114 | Narrow columns get chips at the anchor   | PASS   | `.thread-slot` (carrying `data-slot-thread`) containing a `.t-chip` labelled exactly `💬 <n> · <last author>` — e.g. `💬 5 · agent` |
| 115 | Expanding a chip expands in place        | PASS   | Chip → `.thread-card` with the chip hidden; **one** seen POST; `–` collapses back |
| 116 | Focus/wide switches to margin cards      | PASS*  | `.focus-inner.with-margin`, `display: grid`, `grid-template-columns: 646.25px 300px` (= `minmax(0,1fr) 300px`), `gap: 30px`; `.t-chip` count inside the focus surface is **0**; cards `position: absolute`, `left: 0`, `right: 0`, `margin: 0`, rendered width **300px**; `::before` connector is `23px × 1px` at `left: -23px; top: 16px` in `rgb(207,204,194)` = `--line-strong`. *One cosmetic deviation: computed `max-width` is `519.653px` rather than `none`. It is non-binding — `left:0/right:0` already fixes the width at 300px — so the criterion's intent is met; noted for the record |
| 117 | Cascade is the prototype's algorithm     | PASS   | Measured live and it is exact: cards at top `172` (h `1046`) → `172+1046+12 = 1230` = next card's top → `1230+263+12 = 1505` = third card's top; `margin.minHeight` `2532px` = `1505+1102+12` in container coordinates. Sorted, non-overlapping, 12px gutter |
| 118 | Layout recomputes on every trigger       | PASS (log) | |
| 119 | Zero anchors means no gutter             | PASS   | An anchor-free document in focus mode: `.focus-inner` **without** `with-margin`, and `.focus-margin` element count **0** |
| 120 | Margin overflow extends the margin       | PASS   | `minHeight: 2532px` on the margin exceeds the document height; the main column does not stretch |
| 121 | Clicking a highlight opens + marks seen  | PASS (log) | |
| 122 | Detached/whole-doc sections + 💬 popover | PASS   | `Detached threads` section verified live (TEST-112). Reader header's `.comments-btn` reads `💬 3` and opens `.comments-pop` listing `“ntro paragraph” / 7 turns · last: user · open`, `“Final paragraph fo” / 6 turns · …`, `“bullet one” / 1 turn · …` — serif-italic quote plus mono meta |

## Observations (not failures)

**One highlight-loss — root-caused and fixed at `85d929a`.** In a single round-1 session, after
creating an ask-agent comment and immediately typing at the document start, both highlights vanished
from the screen (anchors stayed correct on disk and returned on reload). Three careful retries in
round 1 all passed, so I could not reproduce it. The fix agent root-caused it: **adoption after save
collapsed the decorations, and the repair waited on a 120 ms debounce that a commit which did not
re-render could miss.** Adoption now re-applies on a microtask.

Re-verified at `85d929a`: with two anchors live (one of them ask-agent, the original shape), I ran
**three full save cycles** — typing at the document start, then sampling `.anchor-hl` every 250 ms
for 6.5 s per cycle to span the debounce, the PUT and the adoption.

```
after ask-agent comment: ["Beta d","istinct se","Gamma separate se"]

save cycle 1:  PUTs: 1   min highlights seen: 3   highlight-free frames: 0
save cycle 2:  PUTs: 1   min highlights seen: 3   highlight-free frames: 0
save cycle 3:  PUTs: 1   min highlights seen: 3   highlight-free frames: 0
after reload:  ["Beta d","istinct se","Gamma separate se"]
```

78 samples, no highlight-free frame, no dip below the full set. Considered explained and closed.

**Adjudicated behavior confirmed, not faulted.** Per the brief: the optimistic comment insert is a
local placement rather than a fabricated cache row, and server ranges are declined when the on-disk
body is not byte-equal to the canonical form (threads then render as chips with no highlight until
the first save canonicalises). Both were observed and both are honest.

## Summary

**36 of 36 criteria PASS** (12 accepted on an audited, specific log rather than independently
re-run; 24 verified directly in the browser and on disk).

This is the strongest issue in the batch. The two things it exists to guarantee are both provable:
**there is exactly one serializer** and the offset map hangs off it, and **anchors are decorations**
— a full session of anchoring, expanding, replying and resolving left no markup whatsoever in the
document bodies. §6's reconciliation semantics are visibly honored through the UI, including the
hard case: deleting an anchored range orphans the thread, drops the highlight live with no reload,
moves the card into a `Detached threads` section, and preserves the selector byte-for-byte. The
cascade layout is not approximately the prototype's algorithm — measured card positions reproduce
`y = max(top, lastBottom)` and `lastBottom = y + height + 12` to the pixel.
