# [UI-008] Thread view, composer, attachments, forms, read state

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus — dense surface, but every behavior is pinned by §6/§8 and the prototype; no open design questions.

## Dependencies

- Depends on: UI-005, SERVER-010
- Blocks: UI-010

## Spec References

- SPEC.md §6 — **Turn format** (`## <author> · <ISO ts>`, timestamps are turn identity, user-only turn deletion with inline confirm, cascade), **Forms in turns** (fenced ```` ```form ```` YAML → live controls → structured answer turn + `form.respond`), **Attachments** (📎 picker + paste + drag-drop with dropzone highlight, removable chip previews with thumbnails, attachment-only turns, posted turns render images inline / files as chips), **Recursion** (commenting a turn creates a child thread; ≥2 levels), **Standalone threads**
- SPEC.md §8 — agent participation: `@agent`/`@<subagent>`/`/<skill>`/composer toggle request the agent; every later turn in an `engaged` thread re-triggers unless resolved or "note only"; **honest time-escalating pending indicator** (45 s / 3 m / 15 m), no fake progress
- SPEC.md §7 — **Read state**: unread = last turn newer than last-seen mark; **displayed content only** counts as read; badges clear everywhere via SSE
- SPEC.md §11 — **Thread view** (turns markdown-rendered, attachments, forms, composer with ask-agent toggle, resolve/reopen, anchor quote pinned at top linking back to the parent at the anchor position, opening marks seen, child threads per-turn), **Smart input everywhere** (`@` / `/` / `[[` autocompletes all via `GET /api/docs`), reader **⋯ menu** Resolve/Reopen, optimistic append of the user's own turn reconciled on refetch
- SPEC.md §9.2 — `GET /api/threads/:id`, `POST /api/threads/:id/turns` (multipart), `/resolve`, `/reopen`, `/seen`, `DELETE /api/threads/:id/turns/:ts`, `GET /attachments/...`
- `design/index.html` — **authoritative look & feel** (`.thread-card`, `.t-head`/`.t-quote`/`.t-status`/`.t-resolve`/`.t-collapse`, `.t-context`, `.turn`/`.turn-who`/`.who.agent`/`.turn-body`/`.turn-trace`/`.turn-del` + `.armed`, `.working` + `.working-dot`, `.composer` + `.composer-foot` + `.dropping`, `.pending-atts`/`.att-chip`/`.clip`, `.turn-att-img`/`.att-file`, `.form-comment`/`.form-opt`/`.picked`/`.form-submit`, `.ac-menu`/`.ac-item`, `.unread`)

## Summary

Build the thread card as the product's conversational unit: the head (anchor quote or `whole-document thread`/`standalone`, status chip, ✓ resolve/reopen, – collapse), a hairline-separated turn stream with mono author labels (agent in accent), timestamps, optional `↳ trace` lines and hover-revealed delete arming, and a composer with the shared `@`/`/`/`[[` autocomplete, the `◉ ask agent / ○ note only` toggle, and full three-way attachment capture (picker, paste, drag-drop). On top of that: live `form` blocks in agent turns rendered as option cards with an Answer submit, per-turn child threads, an honest time-escalating pending indicator, and display-driven read state that clears unread badges everywhere via SSE.

This component is reused everywhere threads appear — inline in a document (UI-007's slots and margin cards), as the body of a `type: thread` document opened in a column, and in focus mode — so it must render standalone (`bare`) as well as inside a slot.

## Acceptance Criteria

- [ ] **Thread card** renders per the prototype: `.thread-card` (surface-2, 1px `--line` border, **3px** `--accent` left border, 10px radius, `max-width: 62ch`), `.resolved` variant with `--ink-3` left border and `opacity: .75`. Head shows the anchor quote as italic serif (`.t-quote`), or `whole-document thread` / `standalone` when there is no anchor; then the status chip, a `✓ resolve` / `reopen` button, and a `–` collapse control (suppressed in `bare` mode).
- [ ] **Anchor quote pinned at top links back to the parent at the anchor position**: the `.t-context` line reads `on <parent title> · at "<quote>"` (or `· whole document`, or `standalone thread · <id>`), and clicking the parent title opens that document in the reader **scrolled to the anchor** with the highlight flashed.
- [ ] **Turns** render as `.turn` blocks separated by hairline top borders (first has none): `.turn-who` with a mono uppercase author (`agent` in `--accent-ink`) and timestamp, `.turn-body` with **markdown-rendered** content including working `[[refs]]` (rendered as the target's current title), and an optional `.turn-trace` line (`↳ …`) describing what the agent changed.
- [ ] **Turn deletion is user-only with two-click arming**: `.turn-del` (`✕`) is hidden until turn hover/focus; first click arms it to `delete?` (`.armed`, signal color); second click issues `DELETE /api/threads/:id/turns/:ts`; clicking elsewhere or pressing esc disarms. Agent turns expose no delete control. The UI reflects the server's cascade (§6): deleting the last turn removes the thread and its highlight/entry disappears live.
- [ ] **Composer**: `.composer` with the exact placeholder `Reply — @ route · / skill · [[ link · paste or drop files`, and a `.composer-foot` carrying `📎` (`.clip`), the `◉ ask agent` / `○ note only` toggle (`.toggle.on` when asking), the engaged-thread hint (`thread stays open` when open, `reopens on reply` when resolved), and `Reply ↵`.
- [ ] **Shared autocomplete** (in `@corpus/kit`, reused by UI-010's global composer and UI-006's editor): `@` lists agent + subagents (`type: agent-def` documents, name + description), `/` lists skills (`type: skill`), `[[` lists documents by title — **all three via `useDocs` over `GET /api/docs` with a type filter; no separate registry**. Keyboard ↑↓/↵/esc, mouse hover; menu styled as `.ac-menu`/`.ac-item` (`.k` mono accent key, `.d` dim description).
- [ ] **Attachments, three ways**: the 📎 picker, pasting an image/file from the clipboard (never as garbage text), and drag-and-drop onto the composer, which shows the `.composer.dropping` highlight while a drag hovers. Pending attachments preview as removable `.att-chip`s with image thumbnails (34px). A turn may be **attachment-only** (no text) — Reply stays enabled when at least one attachment is pending.
- [ ] **Posted turns** render images inline (`.turn-att-img`, max 240×180) and non-images as `.att-file` download chips, resolving bytes through `GET /attachments/...`.
- [ ] **Forms**: an agent turn containing a fenced ```` ```form ```` block (YAML: prompt + options) renders as `.form-comment` — a stack of `.form-opt` option cards showing the option label with a right-aligned detail (`.price`), a `.picked` state on selection, an optional note field, and a `Answer` `.form-submit`. Submitting appends a structured answer turn (chosen option + note) and results in a `form.respond` queue event. An **answered** form renders inert with the chosen option shown and no submit.
- [ ] **Child threads per turn**: commenting on a turn creates a child thread whose `parent` is the thread id; child threads render nested under their turn, and the component handles **at least two levels** without layout breakage (nesting depth is capped visually — level ≥3 renders flush with a depth indicator rather than indenting further).
- [ ] **Read state**: `POST /api/threads/:id/seen` fires **only for displayed content** — opening the thread view, expanding a collapsed chip, or a margin card becoming visible. Opening the parent document alone does **not** mark its collapsed-chip threads seen. Unread badges (`.unread`) clear everywhere live via SSE, and a document row's aggregate indicator clears only when all of its threads have been seen.
- [ ] **Pending-agent indicator**: while an agent response is outstanding, a `.working` row with a pulsing `.working-dot` shows honest, time-escalating text — `agent is working…` → (45 s) `still working…` → (3 m) `still working — longer than usual` → (15 m) `still working — <elapsed>`. **No fake progress bars, no token streaming.**
- [ ] **Optimistic own-turn append**: pressing Reply appends the user's turn immediately (with a provisional timestamp), then reconciles against the refetch; a failed POST removes it and restores the composer text and pending attachments.
- [ ] **Resolve/reopen** is available on the thread card head **and** in the reader ⋯ menu when a thread document is open; both hit `/resolve` and `/reopen` and update live.

## Technical Design

### Files to Create/Modify

- `apps/ui/src/features/threads/ThreadCard.tsx` — the card (props: `threadId`, `bare`, `showContext`)
- `apps/ui/src/features/threads/TurnList.tsx` / `Turn.tsx` — turn rendering, trace line, delete arming
- `apps/ui/src/features/threads/TurnBody.tsx` — markdown → React with `[[ref]]` resolution and attachment rendering
- `apps/ui/src/features/threads/ThreadComposer.tsx` — input + foot + toggle + send
- `apps/ui/src/features/threads/PendingIndicator.tsx` — the `.working` escalation row
- `apps/ui/src/features/threads/ChildThreads.tsx` — per-turn child thread nesting
- `apps/ui/src/features/threads/threads.css` — styles lifted from `design/index.html`
- `apps/ui/src/features/forms/FormBlock.tsx` — `form` fence parsing + option cards + submit
- `apps/ui/src/features/forms/parseFormBlock.ts` — extract + YAML-parse the fenced block (use the `yaml` library per §5 — never hand-roll)
- `apps/ui/src/features/attachments/useAttachmentIntake.ts` — picker + paste + drop into one pending list
- `apps/ui/src/features/attachments/PendingAttachments.tsx` — `.pending-atts` / `.att-chip`
- `apps/ui/src/features/attachments/TurnAttachments.tsx` — posted-turn image/file rendering
- `packages/kit/src/components/Autocomplete/` — the shared `@` / `/` / `[[` autocomplete (menu + trigger detection + query wiring)
- `packages/kit/src/hooks/useThread.ts` — `GET /api/threads/:id`
- `packages/kit/src/hooks/usePostTurn.ts` — `POST /api/threads/:id/turns` (multipart when attachments are present), optimistic append
- `packages/kit/src/hooks/useDeleteTurn.ts` — `DELETE /api/threads/:id/turns/:ts`
- `packages/kit/src/hooks/useThreadStatus.ts` — resolve / reopen
- `packages/kit/src/hooks/useMarkSeen.ts` — `POST /api/threads/:id/seen` with de-duplication
- `apps/ui/src/features/reader/ReaderMenu.tsx` — add Resolve/Reopen for thread documents (modify)

### Key Implementation Details

**Turn identity is the timestamp** (§6). Never key React lists by array index — key by `ts`. Deletion targets `ts`. Optimistic turns get a provisional client timestamp flagged `pending: true` and are replaced (not merged) by the server's turn on refetch.

**Agent-request flag.** The POST's `agent` flag is `true` when the toggle is `◉ ask agent` **or** the text contains an `@`/`/` invocation. The server parses mentions authoritatively (§8) — the UI does not attempt to resolve routing itself; it only sets the flag and sends the raw text. The hint text is derived from thread status: `thread stays open` for open threads, `reopens on reply` for resolved ones (replying to a resolved thread reopens it server-side).

**Attachment intake** normalizes all three sources into one `PendingAttachment[]` (`{ id, file, name, previewUrl? }`). Paste: read `ClipboardEvent.clipboardData.files` **first**; only fall back to text insertion when there are no files. Drop: `dragenter`/`dragover` add `.dropping`, `dragleave`/`drop` remove it; use a counter so nested elements do not flicker the class. Image previews use `URL.createObjectURL` and are revoked on removal/unmount. Posting with attachments switches the mutation to `multipart/form-data` through the contract client's upload helper.

**Form blocks.** `parseFormBlock` extracts ```` ```form ```` fences from a turn body and YAML-parses them into `{ prompt, options: [{ value, label, detail? }], note?: boolean }`. Rendering replaces the fence in-place within the turn body. Submitting posts a structured answer turn whose body records the chosen option and optional note in the canonical shape the server/CLI expects (a `form.respond` event follows from the server side — the UI does not enqueue). "Answered" is determined by the presence of a later answer turn referencing this form, and renders the picked option inert.

**Read state de-duplication.** `useMarkSeen` keeps a per-thread in-flight/last-sent map so an expand-collapse-expand burst does not spam the endpoint; it POSTs at most once per `(threadId, lastTurnTs)` pair. The SSE `invalidate` for seen state drives badge clearing everywhere; do not locally mutate other components' badges.

**Pending indicator timing.** Compute elapsed from the timestamp of the last agent-requesting turn (not from mount) so a page reload during a long job shows the correct escalation tier. Thresholds 45 s / 3 m / 15 m; a `setInterval` at 15 s granularity is sufficient — do not animate.

**Reusability.** `ThreadCard` must render correctly in three hosts: `bare` (margin card / slot, no collapse control), standalone (thread document open in a reader — full width, context line shown), and nested (child thread). Keep all layout in CSS driven by a host class, not props branching in JSX.

**Styling** comes verbatim from `design/index.html`: `.turn-who .who` (mono 10.5px, 700, uppercase, `letter-spacing: .05em`; `.agent` → `--accent-ink`), `.turn-del` (opacity 0 → 1 on `.turn:hover`, `--signal` on hover, `.armed` mono 10px), `.turn-trace` (11px `--ink-3`, `↳ ` via `::before`), `.composer` (surface, 1px `--line`, 8px radius, 8/10px padding), `.composer-foot` (mono 10.5px, `.toggle.on` → `--accent-ink`, `.send` accent 600 right-aligned), `.form-opt` (`.picked` → accent border + accent wash; `.price` right-aligned mono), `.form-submit` (accent fill, `--bg` text), `.att-chip`, `.turn-att-img`, `.att-file`, `.working`.

### Edge Cases

- Deleting the **last** turn deletes the thread (§6 cascade): the UI must handle its own unmount gracefully — no "thread not found" flash; show the toast and let the parent remove the slot.
- Deleting a turn that has child threads — reflect whatever the server does; do not assume.
- Two rapid Reply presses → one POST (disable send while in flight) and no duplicated optimistic turn.
- A turn arriving via SSE while the composer has draft text → draft is preserved.
- Attachment upload failure with text present → the turn is not posted at all; text and chips are restored with an error toast.
- Very large pasted image (>10 MB) → surface the server's rejection as a toast rather than a silent failure.
- A malformed ```` ```form ```` block (bad YAML) → render the fence as a plain code block with a small warning, never crash the turn.
- A form answered from another client while open → SSE refetch renders it inert; a submit that races loses harmlessly (server rejects/dedupes) and the UI reconciles.
- Resolved thread + `◉ ask agent` reply → server reopens; the hint (`reopens on reply`) must have said so beforehand.
- Standalone thread (`parent: null`) — no anchor quote, no parent link; head reads `standalone`.
- Nesting depth ≥3 — flatten visually with a depth indicator; never let indentation collapse the composer width.
- A thread whose parent document was deleted (§9: threads become orphaned records) — context line degrades to the stored parent id without a link.

## Testing Strategy

Vitest + Testing Library in `apps/ui` and `packages/kit`:

- `ThreadCard.test.tsx` — head variants (anchor quote / whole-document / standalone), resolved styling, resolve→reopen button text, collapse control suppressed in `bare`.
- `Turn.test.tsx` — author styling, trace line, delete arming state machine (hidden → `✕` on hover → `delete?` → DELETE fired; esc/outside click disarms), no delete control on agent turns.
- `TurnBody.test.tsx` — markdown rendering, `[[ref]]` → current title, inline images vs file chips.
- `ThreadComposer.test.tsx` — placeholder text exact match, toggle default and hint text per status, send disabled while empty and enabled with attachment-only, in-flight double-submit guard.
- `useAttachmentIntake.test.ts` — paste with files (no text insertion), paste with text only, drop counter semantics for nested targets, object-URL revocation.
- `parseFormBlock.test.ts` — well-formed YAML, options with details, malformed YAML → warning result.
- `FormBlock.test.tsx` — pick → `.picked`, Answer builds the expected answer-turn payload, answered form renders inert.
- `PendingIndicator.test.ts` — fake timers across the 45 s / 3 m / 15 m thresholds; elapsed computed from the turn timestamp, not from mount.
- `useMarkSeen.test.ts` — de-duplication per `(threadId, lastTurnTs)`; a new turn re-arms it.
- `Autocomplete` (kit) — trigger detection for `@` / `/` / `[[` including mid-word and escaped cases; keyboard navigation; correct `useDocs` type filter per trigger.
- `usePostTurn.test.ts` — optimistic append then reconcile; failure path restores composer state.

## E2E Verification Plan

### Verification Steps

1. Start the real stack (`npm run watch`) against a `corpus init` workspace with a seeded document and thread.
2. Open a thread. Verify head, turns, hairlines, mono authors (agent in accent) against `design/index.html` side by side. Confirm `POST /api/threads/:id/seen` fired (server log) and the row's unread badge cleared in **every** column showing it.
3. Open the **parent document** without expanding its chip → confirm **no** seen POST (§7). Expand the chip → confirm the POST fires and the badge clears.
4. Reply with `○ note only` → the turn appends optimistically, the file gains a `## user · <ISO>` turn (`cat` the thread file), and `.corpus/queue/pending/` stays empty.
5. Reply with `◉ ask agent` → a `comment.created` event lands in `.corpus/queue/pending/`; the `.working` indicator appears. Leave it for >45 s and confirm the text escalates to `still working…`. Reload the page mid-wait and confirm the escalation tier is preserved (computed from the turn timestamp).
6. Reply with `@agent` typed in the text and the toggle **off** → confirm the event is still enqueued (§8 mention requests the agent).
7. Attachments: (a) 📎-pick a PNG and a PDF → chips with a thumbnail and a file chip; (b) paste a screenshot from the clipboard → chip appears, **no** base64 text in the input; (c) drag a file over the composer → `.composer.dropping` highlight; drop → chip. Remove one chip, send the rest with no text (attachment-only) → posted turn renders the image inline and the PDF as a download chip; bytes exist under `.corpus/attachments/<threadId>/<ts>/` and the committed markdown contains relative links (bytes gitignored).
8. Forms: have the agent post a `form` turn (`corpus thread reply --from agent` with a ```` ```form ```` block). Confirm live option cards, pick one (`.picked`), submit **Answer** → a structured answer turn appears in the file and a `form.respond` event lands in the queue; the form renders inert with the choice shown.
9. Turn deletion: hover a user turn → `✕`; click → `delete?`; click again → the turn disappears and is gone from the file, but `git log -p` still shows it. Delete the thread's last remaining turn → the whole thread is removed and its highlight/entry disappears live.
10. Child thread: comment on a turn → a child thread renders nested under it; comment on a turn of the child → level-2 nesting renders without breaking the composer.
11. Resolve from the card head, then reopen from the reader ⋯ menu; confirm status and styling update live and the thread leaves/returns to the Attention column.
12. Playwright: `apps/ui/e2e/thread.spec.ts` covering steps 2–4, 7(b), and 9 against the real app (§15 M3 read-state and comment-flow checks).

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
- [ ] Committed with `[UI-008]` prefix

## Corrections (orchestrator, 2026-07-28 — sprint-011 adjudications)

Binding; where this contradicts the sections above, this wins. See
`issues/sprints/sprint-011.md` → Orchestrator Adjudications for the full rulings.

- **Paths**: there is no `apps/ui/src/features/` — the domain folders are
  `editor/` (UI-006), `thread/` (UI-008), `anchors/` (UI-007), `compose/` (UI-010).
- **Attachments**: 25 MB/file, 100 MB/request; multipart's text field is `text`; `ts` path
  params are URL-encoded.
- **`requestsAgent` is tri-state**: "note only" sends explicit `false`; omitted means
  "enqueue if the agent is engaged".
- **Lock state** reads via `useLocks`/`useDocLock` + `["locks"]` keys (`DocView.tsx` is the
  example) — never from `GET /api/docs/:id`.
- **UI-008 specific**: form answers go through `POST /api/threads/{id}/turns/{ts}/form` — the
  hand-composed answer turn described above is struck (the endpoint is what produces the
  `form.respond` event and the §8 re-trigger). You own `ThreadSlot`/`Turns` evolution. Read
  state: client dedup without `lastSeenTs`; the server already broadcasts
  `[["docs"], docKey, threadKey, parent docKey]` on a seen mark (`threads/seen.ts:133`) — the
  aggregate refresh signal exists today.
