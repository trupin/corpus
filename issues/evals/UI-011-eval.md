# Evaluation: UI-011 — Console drawer: jobs master-detail, live logs, HALT

**Date**: 2026-07-28
**Sprint**: sprint-010 (TEST-85…112)
**Verdict**: **PASS** — 28 of 28 criteria met. TEST-107, recorded as PARTIAL during
implementation, now passes **in full** with SERVER-028 landed.

Environment: the production-served board on `http://127.0.0.1:8982/` (no Vite), a real
`corpus init` workspace, real jobs driven from a terminal (`corpus queue claim-all|fail|halt|resume`,
`corpus job log`), a parallel `/events` capture, real headless Chromium, and a second empty
workspace on 8985 for the no-jobs state. No source file was read.

## E2E Proof-of-Work Audit

| Check                                    | Result | Notes |
| ---------------------------------------- | ------ | ----- |
| Verification log present                 | PASS   | Per-criterion with quoted browser measurements, request lists, SSE capture statistics and the five-to-four dot mapping table. |
| Commands are specific and concrete       | PASS   | Real event ids, cursor values per refetch, scroll geometry, localStorage blobs, `.corpus/HALT` contents. |
| Real E2E (not mocked)                    | PASS   | Real workspace on 8977, real server (pid 70103), real CLI, real browser, real `curl -N` SSE capture running alongside. |
| Scenarios cover acceptance criteria      | PASS   | Every criterion addressed. |
| Application restarted after changes      | PASS   | Server lifecycle with pids; the log also records what was *not* exercised (the 4 MB file cap). |
| Actual model recorded (`implemented on:`)| PASS   | Stated. |
| Reproduction logged before fix (bugs)    | PASS   | TEST-107's shortfall is logged as a **pre-fix reproduction** (zero `/api/docs` requests after `corpus queue fail`, Attention rows only after a reload) and escalated rather than papered over — this is the behaviour SERVER-028 then fixed. |

**Honesty audit — claims sampled and re-derived:**

| Log claim | Re-derived? |
| --- | --- |
| The strip is mono 11px, `7px 18px`, `user-select: none`, caret + `console` + pill + counts + spacer + `.halt-btn` | **YES** — computed `{ff: ui-monospace, fs: 11px, pad: "7px 18px", us: none, role: button, tabindex: 0}`; children `c-caret ▴, console, agent-pill, c-counts, spacer, c-status, halt-btn`. |
| `.c-failed` is **not** reused for the failed-job count | **YES** — `.console-strip .c-failed` count = **0** with the server reachable; the failed count is `.c-failed-jobs`, colour `rgb(196,85,46)`. `smoke.spec.ts:244`'s strict-mode assertion is intact and unmodified. |
| Expanding shrinks the board by the drawer's height; nothing is `fixed`/`absolute` | **YES** — board `802.5 → 587.5`, console box `y:644 h:255.9`; `position: static` for both `.console` and `.console-body`; flex-grow `{topbar:0, board:1, console:0}`; `elementFromPoint` at the board's top-left is inside `.board`. |
| Job rows read `<type> · <originTitle>` from the new `Job.type` | **YES** — `comment.created · Re: Mortgage options`, dot `job-dot pending`, `.job-list` `380px / flex: 0 0 auto`. |
| Log lines arrive by **cursored HTTP refetch**, never over SSE | **YES** — `GET …/log?cursor=1` then `?cursor=2` after two CLI appends; the parallel `/events` capture contained **only** `event: invalidate` frames and greps for `"reading thread context"`, `"ERR subagent"`, `"a line nobody"` and `"Mortgage"` all came back empty. |
| Drag clamps at 120 / 60vh, arrow keys resize, height survives a reload under `corpus.console` | **YES** — drag to top → `540px` (60vh of 900), to bottom → `120px`, settle `257.062px`, 2×ArrowUp → `289.062px`; `localStorage["corpus.console"] = {"version":1,"open":true,"height":289.0625}`; `corpus.board` contains no console state; after reload `class="console open"`, height `289.062px`; shrinking the window to 400px re-clamps to `240px`. |
| Collapsed drawer issues no log request | **YES** — with the drawer collapsed, a CLI `job log` append produced only `GET /api/jobs` in the next 3 s; 0 log requests; `.console-body` and `.console-resizer` counts both 0. |
| **TEST-107 "the Attention row does not appear without a reload"** | **SUPERSEDED — now passes.** With SERVER-028 landed, `corpus queue fail` from the CLI triggers `GET /api/docs?needs=me` and the Attention row appears live. |

No contradictions found.

## Criteria Results

| #   | Criterion | Result | Notes |
| --- | --------- | ------ | ----- |
| 85  | Health notice and failed count coexist | PASS | Distinct classes (`.c-failed` vs `.c-failed-jobs`); the shipped `smoke.spec.ts` assertion passes unmodified. Adjudication 5 honoured. |
| 86  | Strip is the prototype's; clicking it toggles | PASS | Measurements above; clicking the strip toggles; the HALT button inside it does not toggle the drawer. |
| 87  | Counts formatted exactly | PASS | `0 running · 1 queued · 0 done · 0 failed` with jobs; **`0 running · 0 done · 0 failed`** on an empty workspace — the queued segment is omitted when zero. Failed count in `--signal`. |
| 88  | Agent pill is derived, not polled | PASS | `agent: idle · queue 1`, `agent: halted · queue 1` when halted. First-load network shows only `GET /api/queue/status` + `GET /api/jobs` — no extra poller, no new endpoint. |
| 89  | HALT is server state, both ways | PASS | Click → `POST /api/queue/halt`, `.corpus/HALT` = `{"at":"2026-07-28T15:45:13Z"}`, button `HALT ●` + `.halted` (`rgba(196,85,46,0.1)` / `rgb(196,85,46)` / transparent border), pill `halted`, `corpus queue claim-all` → `{"events":[]}`. Click again → sentinel gone. `corpus queue halt` **from the CLI** → UI shows `HALT ●` and `agent: halted` with **no reload**; `corpus queue resume` → back to `HALT ○`. |
| 90  | Expanding pushes the board, never overlays | PASS | See audit. `.console-body` defaults to `height: 210px`, `display: flex`. |
| 91  | Drag resize clamps at both ends and survives a window resize | PASS | 540 / 120 / arrow keys / re-clamp to 240 at a 400px window, board still laid out (58px) rather than squeezed to zero. Resizer: `5px`, `ns-resize`, `role="separator"`, `aria-label="Resize console"`, `aria-valuenow/min/max = 210/120/540`, absent while collapsed. |
| 92  | Expanded state and height sticky and isolated | PASS | Own key `corpus.console`; survives a reload; `corpus.board` untouched. |
| 93  | Job list is the prototype's; dot mapping written down | PASS | `380px`, `flex: 0 0 auto`; `.job-dot` + `.job-title` + `.job-meta`. Observed all five treatments: `job-dot pending`, `job-dot running`, `job-dot done`, `job-dot failed`, and neutral `job-dot` for `abandoned` (adjudication 8). |
| 94  | Job title derivable from the wire | PASS | `comment.created · Re: Mortgage options` — the `Job.type` CONTRACT-012 added. No invented type, no `undefined ·`. |
| 95  | Selection policy | PASS | Newest auto-selected, exactly one `.job.sel`; after clicking row 2, a **newer** job arriving did not steal the selection (the same job stayed selected as indices shifted). |
| 96  | Detail header: status, title, link, failed-only actions | PASS | `comment.created · Re: Mortgage options ↗ open pending · started 08:43 · evt_uehma6cyqfos`. On a **pending** job the buttons are `[↗ open]`; the moment it is `failed` they become `[↗ open, Retry, Abandon]`. |
| 97  | `↗ open` reuses `useOpenInColumn`, degrades | PASS | Click → `.col.flash` on the resolved column + `.col.reading` with `th_qo3k4m7t · git ✓`; flash removed after 2 s. Falls through to the first-column rule because a job carries an id and no subject. Disabled-with-tooltip case accepted from log. |
| 98  | With no jobs, the detail pane says so | PASS | Empty workspace on 8985: 0 job rows, `.job-empty` reading exactly `No jobs yet — agent activity will stream here.`, colour `rgb(155,161,168)` (`--ink-3`), padding `20px`. |
| 99  | Log fetched over HTTP, refetched on invalidation | PASS | Mechanism verified, not just the outcome — see audit. |
| 100 | The cursor prevents duplicates | PASS | Every refetch carried the previous `nextCursor` (`cursor=1`, `2`, `3`, `4`, … `56`); no line rendered twice across ~60 appends. |
| 101 | ERR lines classified at render time | PASS | `["", "err"]` for the two lines; `.err` colour `rgb(196,85,46)`; pane `11px / 19.8px (1.8) / 10px 16px / --ink-2`. |
| 102 | Auto-scroll pins without yanking | PASS | Pinned: `dist from bottom = 0` after 50 appends. Scrolled to top, one more append → `scrollTop` stayed `0`. Scrolled back to the bottom, one more append → `dist = 0` again. |
| 103 | A chatty job does not melt the pane | PASS | 50 rapid CLI appends → 55 rendered lines, pane responsive; a 600-char line and an 8 KB line both wrap (`overflow-wrap: anywhere`); `document.scrollWidth > clientWidth` is **false** — the drawer and the page never widen. |
| 104 | The log's own caps surfaced honestly | PASS | 9 000-char append → `{"eventId":"…","appended":true}`; the rendered line is **8 190** chars ending `…[truncated]` — the server's own marker, verbatim. The 4 MB file cap was not exercised and the log says so. |
| 105 | A collapsed drawer consumes nothing | PASS | See audit; expanding starts the query. |
| 106 | A job completing while selected updates in place | PASS (partial re-derivation) | `corpus queue complete` on a running job flipped its dot to `job-dot done` **live**, the selection did not move, and the selected job's log kept its final lines (including the 8 KB truncated one). The exact "the *selected* job completes" framing accepted from log. |
| 107 | A failed job turns red in three places at once | **PASS (full)** | `corpus queue fail evt_uehma6cyqfos --from agent` with the drawer open and **no reload**: strip → `0 running · 0 done · 1 failed`; job row → `job-dot failed`; `GET /api/docs?needs=me` refetched; the Attention column gained `threadRe: Mortgage options … failed job` with its reason chip. The console-initiated half already passed; SERVER-028 closes the CLI-initiated half. |
| 108 | Retry clears the Attention row live | PASS | `POST /api/jobs/{id}/retry`, then explicitly `GET /api/jobs` **and** `GET /api/docs?needs=me` (asserted, not assumed); Attention rows returned to their baseline with no reload; `.corpus/queue/pending/evt_uehma6cyqfos.json` present again. |
| 109 | Abandon does the same; the pane recovers | PASS | `POST /api/jobs/{id}/abandon` + `GET /api/docs?needs=me` ×2; the event moved to `.corpus/queue/abandoned/`; the row took the neutral dot with meta `abandoned`; `.job-empty` count 0 — the detail pane kept showing the job. |
| 110 | Retrying a reaped job surfaces the server's error | PASS (server boundary) | `POST /api/jobs/evt_nosuchjob/retry` → `404 {"code":"not_found","message":"no queue event evt_nosuchjob"}`; `POST …/retry` on an abandoned job → `409 {"code":"conflict","message":"queue event … is abandoned; only a failed job can be retried"}`. The UI does not offer Retry on a non-failed job, so the toast path is not reachable that way; accepted from log for the reachable case. |
| 111 | The console is keyboard-reachable | PASS | Strip `role="button" tabindex="0" aria-expanded`; Enter and Space both toggle; job rows are `BUTTON` with `aria-current="true"` on the selected one; resizer is a focusable `role="separator"` with arrow-key resizing. |
| 112 | Pulsing dots respect reduced motion | PASS | Default context: `.job-dot.running` → `animation-name: pulse`. `reducedMotion: "reduce"` context: `.job-dot.running` → **`none`** and `.agent-pill .dot.busy` → **`none`**, from the one existing guard. |

## Failures

None.

## Additional findings (for the phase PR reviewer)

- **`.c-status` in the strip.** The strip renders `corpus 0.0.0` between the spacer and `HALT`.
  TEST-86 does not list it, and it predates UI-011 — flagging only so the "single home of
  agent/system status" reading in SPEC.md §11 is a deliberate choice rather than an accretion.
- **Duplicate toast nodes** (same observation as UI-005 / UI-009).
- **`↗ open` resolution.** With no subject, a job opens into the *first* column — in this workspace,
  Attention. Correct per the documented fallback, but a job whose origin lives in a specific folder
  still opens somewhere generic. Worth revisiting when UI-010 inherits `useOpenInColumn`.

## Summary

28 of 28 criteria met. The drawer pushes rather than overlays and keeps the shipped flex-grow and
collapsed-height assertions true; the height survives a drag and a reload under its own key
(SPEC.md §15 M3); log lines arrive by cursored HTTP refetch announced by keys-only `invalidate`
frames, with the SSE capture proving no log text ever crosses the wire (SPEC.md §15 M4); HALT is
server state in both directions including a CLI-initiated halt reflected live; and TEST-107 — the
one criterion this issue could not finish — now passes end to end. **PASS.**
