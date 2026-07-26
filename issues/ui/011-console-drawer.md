# [UI-011] Console drawer: jobs master-detail, live logs, HALT

## Domain

ui

## Status

todo

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

- [ ] **Collapsed strip** renders per the prototype: `.console-strip` (mono 11px, 7/18px padding, hover `--surface-2`) with the `.c-caret` (rotating 180° when open), the label `console`, the agent-status pill, the counts, a spacer, and the `HALT ○` button pinned right. Clicking anywhere on the strip toggles the drawer.
- [ ] **Agent-status pill** derives its state from queue + job state, not from a separate endpoint: `working` (a pulsing accent dot) when any job is running, `idle` when none are, `halted` when the HALT sentinel is set — and shows queue depth (`agent: working · queue 2`). This is the **only** place agent/system status appears; nothing agent-status-related is added to the top bar.
- [ ] **Counts** render `N running[· N queued] · N done · <span class="c-failed">N failed</span>` with the failed count in `--signal`.
- [ ] **HALT toggle** calls the halt/resume endpoints; while halted the button shows `HALT ●` with `.halted` styling (signal wash, signal text) and the agent pill reads `halted`. State is read from the server (SSE-driven), not local — a halt set by `corpus queue halt` from the CLI is reflected in the UI without a reload, and vice versa.
- [ ] **Expanded drawer pushes the board up.** The app shell is a column flex layout where the console is a sibling of the board — expanding shrinks the board's height. Assert there is no `position: fixed`/`absolute` overlay and no board content hidden behind the drawer (the topmost board row stays reachable).
- [ ] **Drag resize**: a 5 px `.console-resizer` (`cursor: ns-resize`, accent wash on hover/drag) on the drawer's top edge; dragging sets the body height clamped to `[120px, 60vh]`.
- [ ] **Sticky state**: the expanded/collapsed flag and the height persist in `localStorage` and are restored on reload (this is the §15 M3 "drawer height persists after drag-resize" check).
- [ ] **Master-detail**: a 380 px fixed-width `.job-list` (right hairline, scrollable) of `.job` rows — `.job-dot` (`running` pulsing accent / `pending` sepia / `done` good / `failed` signal), a sans `.job-title` (`<event type> · <title>`, ellipsized), and a right-aligned mono `.job-meta` state. The selected row takes `.job.sel` (accent wash). The **newest job is auto-selected**, and stays selected once the user picks another (a new arrival does not steal an explicit selection).
- [ ] **Detail header** (`.job-detail-head`): status dot, job title, an `↗ open` link when the job has an originating document/thread, mono meta (`<status> · started <time> · <eventId>`), and — for **failed** jobs only — `Retry` and `Abandon` buttons hitting the queue endpoints.
- [ ] `↗ open` **navigates to the originating document/thread in its home column**, reusing UI-009's `useOpenInColumn` (scroll + `.col.flash` + open in reader). Threads open to the thread view.
- [ ] **Live log stream**: `.job-log-lines` (mono 11px, 1.8 line height) renders the selected job's lines from `GET /api/jobs/:id/log`, then appends lines arriving over SSE. Lines containing `ERR` take the `.err` class (`--signal`).
- [ ] **Auto-scroll discipline**: the log pane stays pinned to the bottom as lines arrive **unless the user has scrolled up**, in which case new lines do not yank the viewport; scrolling back to the bottom re-pins. (A small "jump to latest" affordance is acceptable but not required.)
- [ ] With no jobs, the detail pane shows `.job-empty` — `No jobs yet — agent activity will stream here.`
- [ ] **Failed jobs surface as Attention rows** with a reason chip (`.r-chip`), and the row **clears live** when the job is retried (or abandoned) — verified end to end, not assumed.
- [ ] The console is keyboard-reachable: the strip is a `role="button"` with `tabindex`, the resizer is a `role="separator"` with an accessible label and supports arrow-key resizing.

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

_Filled in by the implementing agent as proof-of-work. Must be from real E2E testing — no mocks, no test clients. Real application, real requests, real interfaces. Include specific commands run, actual outputs observed, and pass/fail conclusions. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Reproduction (bugs only)

_[Agent fills: exact commands, observed output, confirmation bug exists]_

### Post-Implementation Verification

_[Agent fills: application restarted, exact commands, observed output, confirmation fix/feature works]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-011]` prefix
