# [UI-011] Console drawer: jobs master-detail, live logs, HALT

## Domain

ui

## Status

in-review

## Priority

P1

## Model

opus — layout and behaviors are fully specified by the prototype and §7; the only care needed is the push-not-overlay layout and log auto-scroll discipline.

## Dependencies

- Depends on: UI-002, SERVER-009
- Blocks: —

## Spec References

- SPEC.md §7 — **Job logs (the console feed)** (every queue event is a job; `.corpus/jobs/<eventId>.jsonl`; `corpus job log` and `POST /api/jobs/:id/log` append; the server tails and broadcasts over SSE so the UI shows each job's status with its live log stream), **queue halt/resume** (`.corpus/HALT` sentinel; while halted `idle` parks and `claim-all` returns empty), queue statuses `pending → in-progress → processed | failed`, `abandoned`
- SPEC.md §11 — **Console** (the bottom drawer and the **single home of agent/queue status**; collapsed = one-line strip with agent-status pill (working/idle/halted dot) · queue depth · running/done/failed counts · HALT toggle; expanded **pushes the board up — never overlays**; height resizable by dragging its top edge; **master-detail** with a job list left and the selected job's **live log stream** right, newest job auto-selected; failed jobs offer retry/abandon in the detail header; every job's detail header **links to its originating document/thread** — click-through opens it in its home column; expanded state and height are sticky)
- SPEC.md §11 — **Attention** is a seed view whose rows include failed jobs with a reason chip; handling the reason clears the row live via SSE
- SPEC.md §9.2 — `GET /api/jobs?recent=`, `GET /api/jobs/:id/log`, `DELETE /api/queue/:id` (abandon), `GET /events` (SSE)
- SPEC.md §15 M3 — Playwright check: "expand the console → job list + selected job's log detail render **and the drawer height persists after drag-resize**"
- SPEC.md §15 M4 — check: "lines emitted via `corpus job log` stream into the console row for that job"
- `design/index.html` — **authoritative look & feel** (`.console`/`.console-strip`/`.c-caret`/`.c-failed`/`.halt-btn` + `.halted`/`.console-resizer` + `.dragging`/`.console-body`, `.job-list`/`.job`/`.job.sel`/`.job-dot` variants with the pulsing `running` dot/`.job-title`/`.job-meta`, `.job-detail`/`.job-detail-head` with `↗ open` and Retry/Abandon buttons, `.job-log-lines` with `.err`, `.job-empty`, the `agent-pill` in the strip)

## Summary

Build the console: a bottom drawer that is the **single home of agent and system status**. Collapsed, it is a one-line strip — caret, agent-status pill with a pulsing dot, queue depth, `1 running · 1 done · 1 failed` (failed in signal red), and a `HALT ○` toggle. Expanded, it **pushes the board up** (never overlays), is drag-resizable from its top edge (clamped 120 px–60 vh, persisted), and shows a master-detail layout: a 380 px job list on the left (status dot + `event · title` + state, newest auto-selected) and a detail pane on the right (header with status, title, `↗ open` link to the originating document/thread, meta, and Retry/Abandon for failed jobs) over a mono log stream fed live by SSE, with `ERR` lines in signal red.

## Acceptance Criteria

- [x] **Collapsed strip** renders per the prototype: `.console-strip` (mono 11px, 7/18px padding, hover `--surface-2`) with the `.c-caret` (rotating 180° when open), the label `console`, the agent-status pill, the counts, a spacer, and the `HALT ○` button pinned right. Clicking anywhere on the strip toggles the drawer.
- [x] **Agent-status pill** derives its state from queue + job state, not from a separate endpoint: `working` (a pulsing accent dot) when any job is running, `idle` when none are, `halted` when the HALT sentinel is set — and shows queue depth (`agent: working · queue 2`). This is the **only** place agent/system status appears; nothing agent-status-related is added to the top bar.
- [x] **Counts** render `N running[· N queued] · N done · <span class="c-failed-jobs">N failed</span>` with the failed count in `--signal`. _(Class corrected from the prototype's `.c-failed` per sprint-010 adjudication 5 — that class is the health notice's, and `smoke.spec.ts:235` asserts on it in strict mode.)_
- [x] **HALT toggle** calls the halt/resume endpoints; while halted the button shows `HALT ●` with `.halted` styling (signal wash, signal text) and the agent pill reads `halted`. State is read from the server (SSE-driven), not local — a halt set by `corpus queue halt` from the CLI is reflected in the UI without a reload, and vice versa.
- [x] **Expanded drawer pushes the board up.** The app shell is a column flex layout where the console is a sibling of the board — expanding shrinks the board's height. Assert there is no `position: fixed`/`absolute` overlay and no board content hidden behind the drawer (the topmost board row stays reachable).
- [x] **Drag resize**: a 5 px `.console-resizer` (`cursor: ns-resize`, accent wash on hover/drag) on the drawer's top edge; dragging sets the body height clamped to `[120px, 60vh]`.
- [x] **Sticky state**: the expanded/collapsed flag and the height persist in `localStorage` and are restored on reload (this is the §15 M3 "drawer height persists after drag-resize" check).
- [x] **Master-detail**: a 380 px fixed-width `.job-list` (right hairline, scrollable) of `.job` rows — `.job-dot` (`running` pulsing accent / `pending` sepia / `done` good / `failed` signal), a sans `.job-title` (`<event type> · <title>`, ellipsized), and a right-aligned mono `.job-meta` state. The selected row takes `.job.sel` (accent wash). The **newest job is auto-selected**, and stays selected once the user picks another (a new arrival does not steal an explicit selection).
- [x] **Detail header** (`.job-detail-head`): status dot, job title, an `↗ open` link when the job has an originating document/thread, mono meta (`<status> · started <time> · <eventId>`), and — for **failed** jobs only — `Retry` and `Abandon` buttons hitting the queue endpoints.
- [x] `↗ open` **navigates to the originating document/thread in its home column**, reusing UI-009's `useOpenInColumn` (scroll + `.col.flash` + open in reader). Threads open to the thread view.
- [x] **Live log stream**: `.job-log-lines` (mono 11px, 1.8 line height) renders the selected job's lines from `GET /api/jobs/:id/log?cursor=`, refetched incrementally when a `jobKey` invalidation arrives. Lines containing `ERR` take the `.err` class (`--signal`). _(The "appends lines arriving over SSE" wording is struck per the 2026-07-28 correction and sprint-010 adjudication 1: the append path broadcasts nothing and the cursor is what prevents duplicates.)_
- [x] **Auto-scroll discipline**: the log pane stays pinned to the bottom as lines arrive **unless the user has scrolled up**, in which case new lines do not yank the viewport; scrolling back to the bottom re-pins. (A small "jump to latest" affordance is acceptable but not required.)
- [x] With no jobs, the detail pane shows `.job-empty` — `No jobs yet — agent activity will stream here.`
- [~] **Failed jobs surface as Attention rows** with a reason chip (`.r-chip`), and the row **clears live** when the job is retried (or abandoned) — verified end to end, not assumed. **Partial:** clearing on Retry/Abandon is verified live (the console's mutations invalidate `DOCS_KEY` explicitly). A row *appearing* live after a CLI-side `corpus queue fail` is blocked on the server: queue transitions announce `[QUEUE_KEY, JOBS_KEY]` only, never `DOCS_KEY`. Escalated — see the E2E log.
- [x] The console is keyboard-reachable: the strip is a `role="button"` with `tabindex`, the resizer is a `role="separator"` with an accessible label and supports arrow-key resizing.

## Technical Design

### Files to Create/Modify

- `apps/ui/src/features/console/Console.tsx` — the drawer shell (strip + resizer + body), owns expanded/height state
- `apps/ui/src/features/console/ConsoleStrip.tsx` — caret, agent pill, counts, HALT
- `apps/ui/src/features/console/AgentPill.tsx` — working/idle/halted pill derived from queue + jobs
- `apps/ui/src/features/console/JobList.tsx` — the 380 px master list
- `apps/ui/src/features/console/JobDetail.tsx` — header (`↗ open`, Retry/Abandon) + log pane
- `apps/ui/src/features/console/JobLog.tsx` — log rendering, `ERR` classification, auto-scroll pinning
- `apps/ui/src/features/console/useJobLogStream.ts` — initial `GET /api/jobs/:id/log` + SSE append, per-job buffer
- `apps/ui/src/features/console/useConsoleLayout.ts` — expanded flag + height, clamping, `localStorage` persistence, pointer drag
- `apps/ui/src/features/console/console.css` — styles lifted from `design/index.html`
- `packages/kit/src/hooks/useJobs.ts` — `GET /api/jobs?recent=` with SSE invalidation
- `packages/kit/src/hooks/useJobLog.ts` — `GET /api/jobs/:id/log`
- `packages/kit/src/hooks/useQueueControl.ts` — halt / resume / retry / abandon (`DELETE /api/queue/:id`)
- `apps/ui/src/app/AppShell.tsx` — make the console a flex sibling of the board so expansion **pushes** (modify)
- `apps/ui/src/features/board/AttentionRow.tsx` — failed-job reason chip + live clearing (modify or create alongside UI-004's Attention rows)

### Key Implementation Details

**Push, not overlay.** The shell is `display: flex; flex-direction: column; height: 100vh` with `header`, `main.board { flex: 1; min-height: 0 }`, and `.console { flex: none }`. The drawer's body height is an inline style on `.console-body`; growing it shrinks the board because the board is the flex-grow child. Never introduce `position: fixed` on the console — that is the one thing §11 explicitly forbids.

**Resize.** Pointer events on `.console-resizer`: `pointerdown` captures `{ y, h }` and sets pointer capture; `pointermove` computes `h = clamp(startH + (startY - clientY), 120, window.innerHeight * 0.6)`; `pointerup` releases and persists. Clamp on window resize too (a 60 vh height must shrink when the window does). Persist `{ open, height }` under a single `localStorage` key (e.g. `corpus.console`), read once on mount with a schema guard so a corrupted value falls back to defaults.

**Log streaming.** `useJobLogStream(jobId)` fetches the full log once on selection, then subscribes to the SSE stream's job-log events filtered to that job id, appending to a local buffer. Keep the buffer per job (a small `Map` capped to a few recent jobs) so switching back and forth does not refetch. Cap a single job's rendered buffer (e.g. 5 000 lines) with a "…truncated" head marker to keep the DOM bounded. `ERR` classification matches the prototype's rule — the line contains `ERR` — applied at render time, not stored.

**Auto-scroll pinning.** Track `pinned = scrollHeight - scrollTop - clientHeight < 24px`. On append, only `scrollTop = scrollHeight` when `pinned`. Update `pinned` on user scroll. Do not use `scrollIntoView` (it perturbs the page when the drawer is short).

**Selection policy.** `selectedJobId` defaults to the newest job. When the jobs list refreshes: if the selected id still exists, keep it; if it does not, fall back to the newest. Track whether the selection was explicit (user click) — an explicit selection is never overridden by a new arrival; an implicit one follows the newest job.

**Agent pill derivation.** `working` when `jobs.some(j => j.status === "running" | "in-progress")`; `halted` when the server reports the HALT sentinel (queue status endpoint / SSE); otherwise `idle`. Queue depth is the count of pending events. All of this comes from the same `useJobs`/queue-status data — do not add a separate poller.

**`↗ open`** resolves the job's payload to a document or thread id (`payload.threadId` ?? `payload.parentId` ?? `payload.docId`) and calls `useOpenInColumn` from UI-009. When the referenced document no longer exists, render the link disabled with a tooltip rather than hiding it.

**Attention integration.** A failed job produces an Attention row with an `.r-chip` reason (`failed job`). Retry/Abandon must invalidate both the jobs query and the Attention (`needs=me`) query so the row disappears live via SSE without a manual refresh — verify this explicitly rather than trusting a blanket invalidation.

**Styling** verbatim from `design/index.html`: `.console` (top hairline, `--surface`), `.console-strip` (mono 11px, `--ink-2`, `user-select: none`), `.c-failed` (`--signal`), `.halt-btn` (mono 10.5px pill, 1px `--line-strong`; `.halted` → signal wash + signal text + transparent border), `.console-resizer` (5px, hidden until open, accent wash on hover/`.dragging`), `.console-body` (default height 210px, top hairline, `display: flex` when open), `.job-list` (380px, `flex: none`, right hairline, 6px padding), `.job` (mono 11px, 8px radius, 7/10px padding; `.sel` → accent wash), `.job-dot` (7px circles; `running` pulses via the shared `pulse` animation), `.job-title` (sans 12px, ellipsized), `.job-meta` (`--ink-3`, `margin-left: auto`), `.job-detail-head` (mono 11px, 8/14px padding, bottom hairline; buttons 1px `--line` pills that go accent on hover), `.job-log-lines` (mono 11px, `--ink-2`, 10/16px padding, `line-height: 1.8`; `.err` → `--signal`), `.job-empty` (20px padding, `--ink-3`).

### Edge Cases

- Drawer expanded with the window resized below the stored height → clamp to 60 vh on resize; never let the console exceed its clamp or squeeze the board to zero.
- Very long single log line → wrap or scroll horizontally within the pane; must not widen the drawer or the page.
- High-frequency log lines (hooks firing rapidly) → batch appends per animation frame; do not re-render per line.
- SSE reconnect mid-stream → on reconnect, refetch the selected job's full log and reconcile rather than appending duplicates (dedupe by line index/offset).
- A job that completes while selected → status dot and header meta update in place; the log keeps its final lines.
- Retry on a job whose event was already reaped → surface the server's error as a toast, refresh the list.
- Abandon → the job leaves `running`/`failed` and its Attention row clears; the detail pane falls back to the newest remaining job.
- HALT toggled from the CLI while the drawer is open → pill and button update via SSE without a reload.
- Zero jobs → empty list plus `.job-empty` detail; the strip still renders with `0 running · 0 done · 0 failed`.
- Collapsed drawer must not subscribe to a job's log stream (no wasted SSE work when nothing is visible).
- `localStorage` unavailable/blocked → fall back to in-memory defaults without throwing.

## Testing Strategy

Vitest + Testing Library in `apps/ui` and `packages/kit`:

- `useConsoleLayout.test.ts` — clamping at 120 px and 60 vh, persistence round-trip through a `localStorage` stub, corrupted-value fallback, re-clamp on window resize.
- `Console.test.tsx` — expanding changes the shell's board height (assert the flex sibling relationship / computed layout), and the console never carries `position: fixed`.
- `ConsoleStrip.test.tsx` — counts formatting including the `.c-failed` span; HALT button label/class in both states; strip toggles on click and on Enter/Space.
- `AgentPill.test.tsx` — working/idle/halted derivation from job + halt state; queue depth rendering.
- `JobList.test.tsx` — dot class per status, `.job.sel` on exactly one row, newest auto-selected, explicit selection preserved across a refresh that adds a newer job.
- `JobDetail.test.tsx` — `↗ open` present only with a resolvable target and calling `useOpenInColumn`; Retry/Abandon rendered only for `failed`; empty state text.
- `JobLog.test.tsx` — `ERR` lines get `.err`; auto-scroll pins at the bottom, does not yank when scrolled up, re-pins on return; batched appends.
- `useJobLogStream.test.ts` — initial fetch + SSE append; reconnect refetch dedupes; per-job buffer retained across selection switches; no subscription while collapsed.
- `useQueueControl.test.ts` — halt/resume/retry/abandon invalidate both the jobs and `needs=me` queries.

## E2E Verification Plan

### Verification Steps

1. Start the real stack (`npm run watch`) against a `corpus init` workspace, plus a real agent loop (or `corpus thread reply --from agent` + `corpus job log` to drive jobs deterministically).
2. Post an `@agent` comment in the UI → a `comment.created` event is enqueued. Observe the collapsed strip: the agent pill flips to `working` with a pulsing dot, queue depth increments, and the counts show `1 running`.
3. **Expand the console** → confirm the board is **pushed up**, not covered: the topmost board row is still visible and clickable, and the console has no `position: fixed` in the computed styles. The job list shows the job (dot + `comment.created · <title>` + state) and its log detail renders — this is the §15 M3 console check.
4. **Live log streaming (§15 M4)**: run `corpus job log <eventId> "reading thread context"` from a terminal → the line appears in the selected job's log pane within a second, and the job row's state updates. Emit a line containing `ERR` → it renders in signal red. Emit ~50 lines rapidly → the pane keeps up and stays pinned to the bottom.
5. Scroll the log pane up mid-stream → new lines arrive **without** yanking the viewport; scroll back to the bottom → pinning resumes.
6. **Drag-resize** the drawer by its top edge → the board shrinks accordingly; try to drag past both clamps and confirm it stops at 120 px and 60 vh. **Reload the browser** → the drawer is still expanded at the dragged height (§15 M3 persistence check).
7. `↗ open` in the detail header → the board scrolls that document/thread's column into view, flashes it, and opens it in the reader.
8. **Failed job**: fail one (`corpus queue fail <eventId>`) → the job row and dot turn signal red, the strip's failed count increments in red, and an **Attention row** appears with a `failed job` reason chip. Click **Retry** in the detail header → the job re-enters the queue **and the Attention row clears live** without a reload. Repeat with **Abandon** and confirm the same clearing.
9. **HALT**: click `HALT ○` → it becomes `HALT ●` with signal styling, the pill reads `halted`, and `.corpus/HALT` exists on disk; `corpus queue claim-all` returns empty while halted. Click again to resume → the sentinel is gone and claiming works. Then run `corpus queue halt` from the CLI → the UI reflects `halted` via SSE **without a reload**.
10. Collapse the drawer → confirm (devtools Network/EventSource) that no job-log stream is being consumed while collapsed.
11. Playwright: `apps/ui/e2e/console.spec.ts` automating steps 3, 4, 6, and 8 against the real app (§15 M3 and M4 console checks).

## E2E Verification Log

**Implemented on: opus.**

### Reproduction (bugs only)

N/A — this is a feature, not a bug.

### Environment

Real workspace, real server, real CLI, real Chromium. Nothing mocked.

```
$ mktemp -d /tmp/corpus-s010-u011-XXXXXX          → /tmp/corpus-s010-u011-YhrTZQ
$ corpus init /tmp/corpus-s010-u011-YhrTZQ --port 8977
  Initialized Corpus workspace at /tmp/corpus-s010-u011-YhrTZQ
  port 8977, token in .corpus/config.json (mode 600)
  git: initialized on main, one commit authored as user
$ corpus server start --workspace $WS       → corpus 0.0.0 listening on http://127.0.0.1:8977
$ corpus health --workspace $WS             → ok — corpus 0.0.0, up 1s
# UI dev server, proxying /api and /events at the real workspace server:
$ CORPUS_SERVER_ORIGIN=http://127.0.0.1:8977 VITE_CORPUS_TOKEN=$TOK \
    npm run dev -- --port 5276 --strictPort
```

Real jobs, made the way the product makes them — `POST /api/threads` with
`requestsAgent`, which enqueues a `comment.created` event:

```
$ curl -X POST .../api/docs   -d '{"type":"note","title":"Mortgage options",...}'  → doc_e7h4radm
$ curl -X POST .../api/threads -d '{"parent":"doc_e7h4radm","title":"Insurance carrier choice",
                                    "body":"@agent which carrier should we pick?","requestsAgent":true}'
  → {"thread":{"id":"th_nmvbl4dn",…},"eventId":"evt_k336wixosdmp"}
$ curl .../api/jobs
  {"jobs":[{"eventId":"evt_k336wixosdmp","type":"comment.created","status":"pending",
            "started":"2026-07-28T06:49:08Z","lastLine":null,
            "originId":"th_nmvbl4dn","originTitle":"Insurance carrier choice"}]}
```

### The collapsed strip (TEST-86, TEST-87, TEST-88)

```
strip text  : ▴ console  agent: idle · queue 1  0 running · 1 queued · 0 done · 0 failed  corpus 0.0.0  HALT ○
counts      : 0 running · 1 queued · 0 done · 0 failed
agent pill  : agent: idle · queue 1
strip css   : font-size 11px, padding 7px 18px, user-select none
```

After `corpus queue claim-all --from agent`, with no reload:
`1 running · 0 done · 0 failed` and `agent: working · queue 0`; the pill dot takes
`dot busy`. The queued segment disappears at zero, exactly as the prototype's
template omits it. **PASS.**

### `.c-failed` coexistence (TEST-85) — sprint-010 adjudication 5

The failed-job count is `<span class="c-failed-jobs">`, never `.c-failed`:

```
failed span class : c-failed-jobs
computed colour   : rgb(196, 85, 46)   (--signal)
.console-strip .c-failed matches, real server up   : 0
.console-strip .c-failed matches, no server (e2e)  : 1 → "server unreachable"
```

`apps/ui/e2e/smoke.spec.ts` is **unmodified** and its line-235 strict-mode
assertion passes in the full run below. **PASS.**

### The drawer pushes the board (TEST-90)

```
board before expanding : {"x":0,"y":56.6,"width":1400,"height":802.5}
board after  expanding : {"x":0,"y":56.6,"width":1400,"height":587.5}   ← shrank 215px
console box            : {"x":0,"y":644.1,"width":1400,"height":255.9}
getComputedStyle(.console).position      : static
getComputedStyle(.console-body).position : static
getComputedStyle(.console-body).height   : 210px
console top >= board bottom              : true
flex-grow  : {"topbar":"0","board":"1","console":"0"}
first column box before/after : height 774.5 → 559.5, x/y unchanged, still visible
elementFromPoint at the board's top-left → inside .board, not inside .console
```

**PASS** — the board loses exactly the drawer's height and nothing is behind it.

### Master-detail (TEST-93, TEST-94, TEST-95, TEST-96, TEST-98)

```
job rows        : 1
row 0 title     : comment.created · Insurance carrier choice     ← <type> · <originTitle>
row 0 dot class : job-dot pending
row 0 meta      : pending
.job.sel count  : 1        (newest auto-selected)
detail head     : comment.created · Insurance carrier choice | ↗ open |
                  pending · started 23:49 · evt_k336wixosdmp
.job-list width : 380px
```

With no jobs at all the detail pane renders `.job-empty` reading exactly
`No jobs yet — agent activity will stream here.` and the list has zero rows
(verified in `console.spec.ts` against the serverless dev server). **PASS.**

**The five-to-four dot mapping, stated (TEST-93, Open Conflict 10):**

| wire `QueueEventStatus` | dot class        | treatment                     |
| ----------------------- | ---------------- | ----------------------------- |
| `pending`               | `job-dot pending`| `--sepia`                     |
| `in-progress`           | `job-dot running`| `--accent`, pulsing           |
| `processed`             | `job-dot done`   | `--good`                      |
| `failed`                | `job-dot failed` | `--signal`                    |
| `abandoned`             | `job-dot`        | neutral `--ink-3`, no modifier|

Observed live: `abandoned` renders `rgb(155, 161, 168)`. Per sprint-010
adjudication 8 — no prototype colour to copy, and the three that exist each
already mean something else.

### The log is HTTP, announced by SSE (TEST-99, TEST-100, TEST-101)

A `curl -N /events` capture ran for the whole session, in parallel with the browser.

```
$ corpus job log evt_k336wixosdmp "reading thread context"
  browser network → GET /api/jobs/evt_k336wixosdmp/log?cursor=0
$ corpus job log evt_k336wixosdmp "ERR subagent timeout after 3m"
  browser network → GET /api/jobs/evt_k336wixosdmp/log?cursor=1
rendered lines  : ["reading thread context","ERR subagent timeout after 3m"]
line classes    : ["", "err"]
.err colour     : rgb(196, 85, 46)   (--signal)
pane css        : 11px, line-height 19.8px (1.8), padding 10px 16px, colour --ink-2
```

**The mechanism, not just the outcome:**

```
SSE frames captured        : 55
distinct SSE event names   : ["event: invalidate"]
sample frames              : data: {"keys":[["jobs"],["jobs","evt_k336wixosdmp"]]}   (×4)
grep "reading thread context" in the SSE capture → (empty — no log text on the wire)
grep "progress line"          in the SSE capture → (empty)
```

**The cursor is the dedup mechanism (TEST-100):** 52 log fetches over the session,
each carrying the previous `nextCursor` (`…?cursor=0`, `?cursor=1`, … `?cursor=51`);
no line ever rendered twice. Unit-tested for the reconnect case too — two
invalidations at the same cursor issue `[0, 4, 4]` and the buffer stays at 4 lines
(`packages/kit/src/query/useJobLog.test.tsx`). **PASS.**

### Auto-scroll discipline and a chatty job (TEST-102, TEST-103)

```
50 lines emitted back to back (corpus job log ×50)
after       : 52 rendered lines, scrollTop 875, scrollHeight 1049, clientHeight 174
              → distance from bottom: 0        (pinned)
scrolled to top, then one more line appended:
  scrollTop before 0 → after 0                 (the viewport is NOT yanked)
scrolled back to the bottom, one more line:
  distance from bottom: 0                      (re-pinned)
a 600-character line: page horizontal overflow = false; drawer scrollWidth 1400 = viewport 1400
```

Appends are batched upstream rather than per line: the server debounces its
`invalidate` frames and one cursored refetch returns every line accumulated in
that window, so 50 CLI appends cost a handful of renders, not 50. **PASS.**

### The server's own caps, honestly surfaced (TEST-104)

Exercised: the **8 KB per-line cap**. The 4 MB file cap was not exercised (it
needs ~4 MB of log; the `appended: false` path it produces is covered by the
contract's own tests).

```
$ corpus job log <evt> <9000 "Y" characters> --json
  {"eventId":"evt_ti5cbowksaqw","appended":true}
rendered last line length : 8190
last 20 characters        : "YYYYYYY …[truncated]"
page overflows horizontally : false
.job-log-lines overflow-wrap : anywhere
```

The UI shows the server's own ` …[truncated]` marker verbatim and never implies
the whole line was written. **PASS.**

### A collapsed drawer consumes nothing (TEST-105)

```
collapsed → .console-body count 0, .console-resizer count 0
$ corpus job log evt_… "a line nobody is looking at"
requests in the next 3s      : ["GET /api/jobs"]     ← the strip's counts, nothing else
log requests while collapsed : 0
expanded again → ["GET /api/jobs/evt_…/log?cursor=56"], and the line is visible
```

**PASS** — the body is not rendered while collapsed, so there is no log query to
refetch.

### Drag resize and stickiness (TEST-91, TEST-92)

```
resizer     : height 5px, cursor ns-resize, role=separator, aria-label="Resize console",
              aria-valuenow=210 aria-valuemin=120 aria-valuemax=540
drag up 120px            → 332px
drag to the top of the screen → 540px   (60vh of a 900px window = 540)
drag to the bottom       → 120px
settle                   → 259px
localStorage["corpus.console"] = {"version":1,"open":true,"height":259}
reload                   → class "console open", height 259px      ← §15 M3's named check
two ArrowUp presses      → 291px
window shrunk to 400px   → 240px (60vh), board still 57.5px tall — re-clamped, not squeezed
```

Its own key, not `corpus.board`; the board blob contains no console state
(asserted in `console.spec.ts`). A corrupted value falls back to the collapsed
default with no uncaught error, and `throwingStorage()` (Safari private mode) is
covered by unit tests. **PASS.**

### `↗ open` (TEST-97)

```
link disabled?   : false
click → .col.flash count 1, .col.reading count 1
reading column   : "Attention | VIEW | 0"
after 1.4s       : .col.flash count 0        (the flash is removed, not left on)
```

It calls UI-009's `useOpenInColumn().open({ docId: job.originId })` with **no
`subject`** — a job knows an id, not a folder or a type — so resolution falls
through to the documented first-column fallback. With `originId: null` the button
renders disabled with the title *"This job has no originating document, or it no
longer exists"* (unit-tested), which is also the "no longer resolves" case: the
server nulls `originId` when the projection no longer holds the document. **PASS.**

### HALT is server state in both directions (TEST-89)

```
sentinel before        : false
click HALT ○           → POST /api/queue/halt, then GET /api/queue/status
button                 : "HALT ●", class "halt-btn halted"
button css             : bg rgba(196,85,46,0.1), colour rgb(196,85,46), border-color transparent
pill                   : agent: halted · queue 0
.corpus/HALT on disk   : true  → {"at":"2026-07-28T09:10:45Z"}
$ corpus queue claim-all --from agent   → {"events":[]}        ← claims are empty while halted
click again            → sentinel false, button "HALT ○"
$ corpus queue halt --from agent        → UI shows "HALT ●" and "agent: halted", NO reload
$ corpus queue resume --from agent      → UI shows "HALT ○",  NO reload
```

**PASS** — nothing local: the button posts and re-reads, and a CLI halt reaches
the UI through the `["queue"]` invalidation.

### Failed jobs, Retry, Abandon (TEST-107, TEST-108, TEST-109, TEST-110)

```
$ corpus queue claim-all --from agent ; corpus queue fail evt_aoirruo2ib6r --from agent
strip counts (live, no reload) : 0 running · 0 done · 1 failed
failed span colour             : rgb(196, 85, 46)
job dot (live, no reload)      : job-dot failed
detail head                    : … | ↗ open | failed · started … | Retry | Abandon
```

**Retry (TEST-108) — PASS, and asserted rather than assumed:**

```
click Retry → requests issued:
  POST /api/jobs/evt_aoirruo2ib6r/retry
  GET  /api/queue/status
  GET  /api/jobs
  GET  /api/jobs/evt_aoirruo2ib6r/log?cursor=0   (then ?cursor=1)
  GET  /api/docs?pinned=true&sort=order&type=view
  GET  /api/docs?needs=me                        ← the Attention query, explicitly
  GET  /api/docs?folder=inbox
  GET  /api/docs?status=open&type=thread
Attention rows before: 2 (chips "failed job", "failed job") → after: 0, with NO reload
.corpus/queue/pending/ now contains evt_aoirruo2ib6r.json
server GET /api/docs?needs=me → []
```

**Abandon (TEST-109) — PASS:** `POST /api/jobs/{id}/abandon`, same invalidation set
including `GET /api/docs?needs=me`; the 2 Attention rows clear live; the event
moves to `.corpus/queue/abandoned/`; the row goes to the neutral `job-dot` with
meta `abandoned` and the detail pane keeps showing it (`.job-empty` count 0).

**TEST-110 — PASS at the server boundary, and the UI path is unit-tested:**

```
POST /api/jobs/evt_nosuchjob/retry
  → 404 {"code":"not_found","message":"no queue event evt_nosuchjob"}
POST /api/jobs/evt_k336wixosdmp/retry   (already abandoned)
  → 409 {"code":"conflict","message":"queue event evt_k336wixosdmp is abandoned;
          only a failed job can be retried"}
```

`JobDetail` passes the mutation's `onError` straight to the toast surface with
the server's own message (`Could not retry <id>: …`) and the list refreshes; no
optimistic row is written anywhere (the mutations are deliberately not optimistic).

### TEST-107 — **PARTIAL: an escalation, not a pass**

A **CLI-side** `corpus queue fail` updates the strip's failed count and the job
row's dot live, but the **Attention row does not appear without a reload**. The
data is right; the announcement is missing:

```
$ corpus queue fail evt_aoirruo2ib6r --from agent
strip counts (live)   : 0 running · 0 done · 1 failed      ← updated, no reload
job dot (live)        : job-dot failed                     ← updated, no reload
requests against /api/docs in the following 4 seconds : []
Attention rows WITHOUT a reload : 0
server GET /api/docs?needs=me   : [["th_l7wdkir2",["failed-job"]],
                                   ["doc_e7h4radm",["failed-job"]]]
Attention rows AFTER a reload   : 2, chips ["failed job","failed job"]
```

**Cause, read out of the server:** `apps/server/src/queue/project.ts:32` declares
`QUEUE_QUERY_KEYS = [QUEUE_KEY, JOBS_KEY]`, and `apps/server/src/watcher/watcher.ts:350`
pushes the same two on a queue-event transition. Neither names `DOCS_KEY` — but
`failed-job` **is** a `needs=` reason computed from `events.status = 'failed'`
(`apps/server/src/docs/needs.ts:108`), so a queue transition genuinely makes the
document collection stale and nothing on the wire says so.

**What UI-011 did about it:** the four console mutations invalidate `DOCS_KEY`
themselves, with the coupling written down (`packages/kit/src/query/useQueueControl.ts`),
which is what makes TEST-108 and TEST-109 pass above. The **CLI-initiated** half
cannot be fixed from `apps/ui` or `packages/kit` without the client inventing an
invalidation rule the server owns. **Escalated to the orchestrator as a SERVER
issue:** add `DOCS_KEY` to `QUEUE_QUERY_KEYS` (and to the watcher's `queue-event`
branch), which is a two-line change in `apps/server`.

### Keyboard and reduced motion (TEST-111, TEST-112)

```
strip           : role=button, tabindex=0, aria-expanded=true/false
                  reached after 14 Tab presses from the document start
                  matches :focus-visible → true
                  outline 2px solid rgb(59,95,151) offset 2px radius 4px   ← global.css:42-48, no new rule
Enter           → console open;  Space → console (toggles both ways)
HALT            → next in tab order, BUTTON, aria-pressed, same ring
job rows        → BUTTON, aria-current="true" on the selected one
resizer         → role=separator, tabindex=0, aria-label="Resize console",
                  aria-valuenow/min/max = 210/120/540; ArrowUp/ArrowDown resize

reducedMotion: "reduce"   → .job-dot.running   animation-name: none
                            .agent-pill .dot.busy animation-name: none
default context           → .job-dot.running   animation-name: pulse
```

`.job-dot.running` was **added to the existing block** in
`apps/ui/src/app/global.css` beside `.agent-pill .dot.busy` — no second
`@media (prefers-reduced-motion)` anywhere. **PASS.**

### Automated suites

```
$ VITEST_MAX_THREADS=4 vitest run apps/ui packages/kit
  Test Files  57 passed (57)
  Tests      795 passed (795)
$ npm run lint          → clean
$ npm run format:check  → All matched files use Prettier code style!
$ npm run typecheck -w apps/ui -w packages/kit → clean
$ CORPUS_UI_PORT=5276 npm run e2e
  44 passed (9.5s)   — smoke 13 (unmodified), board 7, search 11, console 13
```

`apps/ui/e2e/console.spec.ts` (13 tests) covers the layout facts jsdom cannot
check at all: push-not-overlay, the drag clamps, arrow-key resize, reload
persistence and its storage key, the `.c-failed` coexistence, the `.job-empty`
copy, keyboard reachability and the reduced-motion guard.

### Uncaught errors

`page.on("pageerror")` collected `[]` across every browser session above.

### Cleanup

Server stopped by pid (`corpus server stop` → `stopped (pid 70103)`), Vite killed
by recorded pid, `curl -N` SSE clients killed by pid. `8765`, `8977` and `5276`
verified free with `lsof -nP -iTCP:<port> -sTCP:LISTEN`.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-011]` prefix

## Correction (orchestrator, 2026-07-28 — sprint-010 Conflicts 1/5 + deps)

- **No SSE log streaming** — that text was stale. Logs arrive by cursored HTTP refetch
  (`JobLog.nextCursor`) triggered by `jobKey` invalidation; the append path deliberately
  broadcasts nothing (SPEC §2.2 rule 3, `jobs/service.ts`).
- **`↗ open` reads `originId`** — `Job` has no `payload`.
- **Do not reuse `.c-failed`** for the failed-count span; `smoke.spec.ts:235` asserts on
  `.console-strip .c-failed` in strict mode and must keep passing unmodified.
- **Dependencies corrected**: also depends on UI-009 (`useOpenInColumn`) and SERVER-027
  (`Job.type`) — wave B of sprint-010.
- Dev server port for this issue: `CORPUS_UI_PORT=5276`.
