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

- [x] **Thread card** renders per the prototype: `.thread-card` (surface-2, 1px `--line` border, **3px** `--accent` left border, 10px radius, `max-width: 62ch`), `.resolved` variant with `--ink-3` left border and `opacity: .75`. Head shows the anchor quote as italic serif (`.t-quote`), or `whole-document thread` / `standalone` when there is no anchor; then the status chip, a `✓ resolve` / `reopen` button, and a `–` collapse control (suppressed in `bare` mode).
- [x] **Anchor quote pinned at top links back to the parent at the anchor position**: the `.t-context` line reads `on <parent title> · at "<quote>"` (or `· whole document`, or `standalone thread · <id>`), and clicking the parent title opens that document in the reader **scrolled to the anchor** with the highlight flashed.
- [x] **Turns** render as `.turn` blocks separated by hairline top borders (first has none): `.turn-who` with a mono uppercase author (`agent` in `--accent-ink`) and timestamp, `.turn-body` with **markdown-rendered** content including working `[[refs]]` (rendered as the target's current title), and an optional `.turn-trace` line (`↳ …`) describing what the agent changed.
- [x] **Turn deletion is user-only with two-click arming**: `.turn-del` (`✕`) is hidden until turn hover/focus; first click arms it to `delete?` (`.armed`, signal color); second click issues `DELETE /api/threads/:id/turns/:ts`; clicking elsewhere or pressing esc disarms. Agent turns expose no delete control. The UI reflects the server's cascade (§6): deleting the last turn removes the thread and its highlight/entry disappears live.
- [x] **Composer**: `.composer` with the exact placeholder `Reply — @ route · / skill · [[ link · paste or drop files`, and a `.composer-foot` carrying `📎` (`.clip`), the `◉ ask agent` / `○ note only` toggle (`.toggle.on` when asking), the engaged-thread hint (`thread stays open` when open, `reopens on reply` when resolved), and `Reply ↵`.
- [x] **Shared autocomplete** (in `@corpus/kit`, reused by UI-010's global composer and UI-006's editor): `@` lists agent + subagents (`type: agent-def` documents, name + description), `/` lists skills (`type: skill`), `[[` lists documents by title — **all three via `useDocs` over `GET /api/docs` with a type filter; no separate registry**. Keyboard ↑↓/↵/esc, mouse hover; menu styled as `.ac-menu`/`.ac-item` (`.k` mono accent key, `.d` dim description).
- [x] **Attachments, three ways**: the 📎 picker, pasting an image/file from the clipboard (never as garbage text), and drag-and-drop onto the composer, which shows the `.composer.dropping` highlight while a drag hovers. Pending attachments preview as removable `.att-chip`s with image thumbnails (34px). A turn may be **attachment-only** (no text) — Reply stays enabled when at least one attachment is pending.
- [x] **Posted turns** render images inline (`.turn-att-img`, max 240×180) and non-images as `.att-file` download chips, resolving bytes through `GET /attachments/...`.
- [x] **Forms**: an agent turn containing a fenced ```` ```form ```` block (YAML: prompt + options) renders as `.form-comment` — a stack of `.form-opt` option cards showing the option label with a right-aligned detail (`.price`), a `.picked` state on selection, an optional note field, and a `Answer` `.form-submit`. Submitting appends a structured answer turn (chosen option + note) and results in a `form.respond` queue event. An **answered** form renders inert with the chosen option shown and no submit.
- [x] **Child threads per turn**: commenting on a turn creates a child thread whose `parent` is the thread id; child threads render nested under their turn, and the component handles **at least two levels** without layout breakage (nesting depth is capped visually — level ≥3 renders flush with a depth indicator rather than indenting further).
- [x] **Read state**: `POST /api/threads/:id/seen` fires **only for displayed content** — opening the thread view, expanding a collapsed chip, or a margin card becoming visible. Opening the parent document alone does **not** mark its collapsed-chip threads seen. Unread badges (`.unread`) clear everywhere live via SSE, and a document row's aggregate indicator clears only when all of its threads have been seen.
- [x] **Pending-agent indicator**: while an agent response is outstanding, a `.working` row with a pulsing `.working-dot` shows honest, time-escalating text — `agent is working…` → (45 s) `still working…` → (3 m) `still working — longer than usual` → (15 m) `still working — <elapsed>`. **No fake progress bars, no token streaming.**
- [x] **Optimistic own-turn append**: pressing Reply appends the user's turn immediately (with a provisional timestamp), then reconciles against the refetch; a failed POST removes it and restores the composer text and pending attachments.
- [x] **Resolve/reopen** is available on the thread card head **and** in the reader ⋯ menu when a thread document is open; both hit `/resolve` and `/reopen` and update live.

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

**Implemented on: opus.**

### Reproduction (bugs only)

Not applicable — UI-008 is a feature, not a bug.

### Post-Implementation Verification

**Environment.** A real `corpus init` workspace at `/tmp/corpus-s011-u008-Y5njyt` on port
**9007**, a real server (`corpus server start`, pid 39416), a real Vite dev server on **5279**
(`CORPUS_SERVER_ORIGIN=http://127.0.0.1:9007 VITE_CORPUS_TOKEN=… vite --port 5279 --strictPort`),
and a real Chromium driven by Playwright against `http://localhost:5279`. `8765` stayed unbound
throughout (`lsof -nP -iTCP:8765 -sTCP:LISTEN` → empty). Every write below is checked on disk and,
where it commits, in `git -C <ws> log`. Seed: `Filing plan` (`doc_lzxem7tu`, inbox) with three
threads, `Mortgage options` (`doc_35evnyl5`, finance) with one, a `Researcher` `agent-def`, and the
two seeded skills.

**Read state — TEST-79 / TEST-80 / TEST-83.** With the parent document open and its chips collapsed:

```
ROW-BADGES-BEFORE: 2
A. after opening the parent doc — seen POSTs: []
A. chips on screen: ["💬 2 · agentnew","💬 2 · agentnew"]
A. aggregate pill still: 2
B. after expanding one chip — seen POSTs: ["POST /api/threads/th_3hargg3b/seen"]
B. aggregate pill now: 1
C. after 3 collapse/expand cycles — seen POSTs: ["POST /api/threads/th_3hargg3b/seen"]
```

Opening the parent fires **nothing**; expanding a chip fires **one** POST and drops the row's
aggregate 2 → 1 with no reload; three collapse/expand cycles add nothing. The refresh path is the
server's own broadcast on a seen mark (`threads/seen.ts:133` — `[["docs"], docKey(id),
threadKey(id)]` plus the parent's `docKey`), consumed by the SSE bridge. **PASS.**

**Badges clear everywhere, from the server — TEST-82.** Two independent browser contexts on the
same server, both showing the unread thread row:

```
UNREAD BADGE A/B BEFORE: 1 1
UNREAD BADGE A/B AFTER READING IN A: 0 0
```

Window B never touched the thread. **PASS.**

**The card, the head and the context line — TEST-37 / 38 / 39 / 41.**

```
HEAD:    “the insurance quote”open✓ resolve–
CONTEXT: on Filing plan · at “the insurance quote”
(whole-document thread) → t-quote "whole-document thread", context "on Filing plan · whole document"
(standalone thread doc)  → head "“a 30-year fixed at 6.1%”open✓ resolve" (no collapse control)
STANDALONE COMPOSER: 1   STANDALONE COLLAPSE CONTROL: 0
```

One component, switched by a host class: the standalone host renders the same head, turns and
composer and simply has nothing to collapse into (the collapse control is present exactly when the
host supplies `onCollapse`). Computed geometry is pinned by `apps/ui/e2e/thread.spec.ts`. **PASS.**

**Turns, the trace and delete arming — TEST-42 / 44 / 45 / 46 / 47 / 48.**

```
TURN AUTHORS: [ 'user', 'agent' ]      AGENT CLASS: who agent
DELETE CONTROLS (user turns only): 1   TRACE: checked the rate table
ARMED LABEL: delete?
DELETE BEFORE 2nd CLICK: []
DELETE CALLS: ["DELETE /api/threads/th_3hargg3b/turns/2026-07-28T17%3A16%3A47Z"]
TURNS AFTER DELETE: 2
```

The first click issues **no** request; the second targets the URL-encoded timestamp. On disk the
`## user · …` block is gone from `data/threads/th_3hargg3b.md`, and `git -C <ws> log -p` still
contains it (2 matches for the deleted attachment reference). Agent turns expose no control at all.
The trace's `↳` is CSS `::before` content, absent from `textContent` (asserted live and in
`thread.spec.ts`). **PASS.**

**The composer and the tri-state `requestsAgent` — TEST-50 / 51 / 52 / 53 / 54 / 55.**

```
placeholder: Reply — @ route · / skill · [[ link · paste or drop files
foot:        📎◉ ask agentthread stays openReply ↵     (resolved thread → "reopens on reply")
/api/threads/th_f6c6madp/turns :: {"body":"a silent note","requestsAgent":false}
/api/threads/th_f6c6madp/turns :: {"body":"@agent please confirm","requestsAgent":true}
queue before: 2 → after the note-only reply: 2 → after the ask reply: 3
```

The thread was **engaged** (`agent: engaged` in its frontmatter), which is the case where an omitted
flag would have re-triggered the agent. `○ note only` sent an explicit `false` and enqueued nothing;
`◉ ask agent` sent `true` and produced `evt_sjjljxratseu.json`, a `comment.created`.

**TEST-53 — what the UI sends for a mention under `○ note only`: explicit `false`.** Observed queue
result: nothing enqueued. The toggle is an explicit instruction from the person and the UI does not
overrule it; the server's own `decideParticipation` documents the same precedence ("`false` — 'note
only'. Wins over everything, including an `@agent` in the body"). The UI still never resolves
routing — it sends the raw text and the flag.

Double-submit: `ThreadComposer.test.tsx` asserts one POST for two rapid clicks (send disabled while
in flight). **PASS.**

**The shared autocomplete — TEST-58 / 59 / 60 / 61.** Typed into the real composer against the real
`GET /api/docs`:

```
"@res" → AC ITEMS: [ 'ResearcherDigs up sources and cites them.' ]   ↵ → "@Researcher "
"/com" → AC ITEMS: [ 'comment …' ]
esc    → AC AFTER ESC: 0 menus, input still "/com", READER STILL OPEN: 1
```

`@` filters `type=agent-def`, `/` filters `type=skill`, `[[` searches documents — three triggers,
one endpoint, no registry; a document created a moment earlier is completable immediately. Escape
closes the menu, leaves the literal trigger characters, and does **not** reach the reader's escape
layer. The unit lives at `packages/kit/src/components/Autocomplete/` and `apps/ui/src` contains
exactly one trigger-detection implementation (`grep -rn "detectTrigger" apps/ui/src` → only the
import in `ThreadComposer.tsx`).

**Attachments — TEST-62 / 63 / 64 / 65 / 66 / 67.**

```
CHIPS: [ 'corpus-s011-ui008-shot.png✕', '📄corpus-s011-ui008-policy.pdf✕' ]
THUMBNAILS: 1        THUMB HEIGHT: 34px      SEND ENABLED WITH NO TEXT: true
DROPPING CLASS: composer dropping
DROPPING AFTER CROSSING A CHILD: composer dropping     ← the counter, not a boolean
DROPPING AFTER LEAVING: composer
INLINE IMAGES: 1     FILE CHIPS: [ '📄 corpus-s011-ui008-policy.pdf' ]   IMG BOX: 240px x 180px
ATTACHMENT RESPONSES:
  RES 200 image/png       /attachments/th_3hargg3b/2026-07-28T17%3A16%3A47Z/…shot.png
  RES 200 application/pdf /attachments/th_3hargg3b/2026-07-28T17%3A16%3A47Z/…policy.pdf
```

Bytes exist under `.corpus/attachments/th_3hargg3b/2026-07-28T17:16:47Z/`;
`git -C <ws> status --ignored=matching` reports `!! .corpus/attachments/` and `git ls-files .corpus`
lists only the queue `.gitkeep`s — untracked and ignored. The committed thread markdown carries
relative links only. The turn was **attachment-only** (no text part in the multipart body).

**Attachment auth, and the one thing that had to change outside the components.**
`/attachments/*` is behind the workspace bearer token, and a browser sends no `Authorization`
header on an `<img src>`. So the kit fetches the bytes (`fetchAttachment` → `useAttachment`) and
renders an object URL; the alternative — a `?token=` in the image URL — would put the workspace
token into referrers and proxy logs, which is exactly why the server allows query tokens on
`/events` and nowhere else. `apps/ui/vite.config.ts` gained an `/attachments` proxy entry so the dev
server looks like the installed origin. **PASS.**

**Over-limit upload — TEST-68 / 69.** A 26 MB file against the shipped 25 MB per-file cap:

```
413 RESPONSES: ["POST 413 /api/threads/th_3hargg3b/turns"]
TOASTS: ['Reply failed — POST /api/threads/{id}/turns failed (HTTP 413): attachment
         corpus-s011-ui008-big.bin is 27262976 bytes, over the per-file limit of
         26214400 bytes (25 MB)']
TURNS BEFORE/AFTER: 3 3
TEXT RESTORED: this one is far too big
CHIPS RESTORED: [ '📄corpus-s011-ui008-big.bin✕' ]
```

`tail` of the thread file shows no new turn — nothing partial was written. **PASS.**

**Forms — TEST-70 / 71 / 72 / 73 / 74 / 75.** An agent turn posted with
`corpus thread reply --from agent --file` carrying a ```` ```form ```` fence:

```
FORM PROMPT: Which quote should I file?
FORM OPTIONS: [ 'Lemonade$1,840/yr', 'State Farm$1,975/yr', 'Chubb$2,410/yr' ]
FORM PRICES:  [ '$1,840/yr', '$1,975/yr', '$2,410/yr' ]
SUBMIT: Answer      SUBMIT DISABLED BEFORE PICK: true    YAML LEAKED INTO PROSE: false
PICKED CLASS: form-opt picked
POST /api/threads/th_f6c6madp/turns/2026-07-28T17%3A14%3A16Z/form
  body :: {"option":"State Farm — $1,975/yr"}
INERT: true — "Answered — State Farm — $1,975/yr", no submit control
```

The **dedicated route**, with the `ts` URL-encoded, and zero POSTs to `/turns` (Open Conflict 1's
adjudication). `.corpus/queue/pending/` then held:

```json
{ "id": "evt_v44qa3apz266", "type": "form.respond", "source": "thread",
  "payload": { "threadId": "th_f6c6madp", "formTs": "2026-07-28T17:14:16Z",
               "option": "State Farm — $1,975/yr", "note": null } }
```

`formTs` is the answered turn's timestamp and `option` is verbatim from the offered options.
The thread file gained `## user · … / **Answered:** State Farm — $1,975/yr`.

**One §8 fact worth recording rather than mistaking for a bug.** The *first* form I answered lived
on a thread whose `agent` was `none` (created `requestsAgent: false`, replied to by the agent). The
answer produced the turn and the inert form but **no** `form.respond` event — which is the server's
documented behaviour (`FormAnswerResponseSchema`: the event is null when the answer does not
re-trigger the agent) and not a UI defect. Repeating the test on a genuinely engaged thread produced
the event above.

Whole-info-string matching and malformed YAML are covered by `parseFormBlock.test.ts` and
`FormBlock.test.tsx` (```` ```formula ````/```` ```form-builder ```` render as ordinary code blocks;
bad YAML renders as a code block plus a warning and throws nothing — the page-error listener
collected `[]` on every run above).

**Child threads and the depth cap — TEST-76 / 77 / 78.**

```
CREATE THREAD CALLS: ["POST /api/threads"]   (parent = the THREAD's id, selector = the turn's line)
CHILD PRESENT: 1 id: th_o3fl5lyl  CHILD DEPTH: 1  CHILD SITS UNDER TURN: 2026-07-28T17:12:15Z
GRANDCHILD DEPTH: 2
COMPOSER WIDTHS 0/1/2: 456 399 342
NESTING left offsets: depth0=133 depth1=175 depth2=217 depth3=259 depth4=259
```

Depths 3 and 4 land on the same line, with a `.t-depth` indicator ("nested 4 deep") instead of more
indentation. **This failed on the first measurement** (259 vs 276) because the flush rule was on the
card rather than on the wrapper that carries the indent; fixed by cancelling the parent card's own
inset on `.child-threads.flush`, re-measured, equal. **PASS.**

**The pending indicator — TEST-84 / TEST-85.**

```
WORKING: agent is working…            WORKING-DOT: 1
WORKING-SINCE: 2026-07-28T17:14:44Z   PROGRESS ELEMENTS: 0
… four minutes later, on a FRESH page load:
WORKING TEXT: still working — longer than usual
WORKING SINCE: 2026-07-28T17:15:21Z
```

The tier is computed from the requesting turn's timestamp, so a reload mid-wait does not reset it.
`grep -rn "progressbar\|token.*stream\|percent" apps/ui/src` → no matches, and the live page
reported zero `progress` / `[role=progressbar]` elements. Reduced motion is honoured through
`global.css`'s existing guard block (extended, not re-declared) and is asserted in
`thread.spec.ts` with `page.emulateMedia({ reducedMotion: "reduce" })` → `animation-name: none`.

**Live refs — TEST-43.** Renaming the target out of band while the turn was on screen:

```
REF BEFORE RENAME: Rate table
REF AFTER RENAME (no reload): Rate table (July)
```

**PASS** — the turn body renders through the kit's `MarkdownView`, whose `RefLink` resolves through
cache-deduped `useDoc` and repaints on the SSE invalidation.

**Resolve and reopen from both places — TEST-86.**

```
card head ✓ resolve → POST /api/threads/th_3hargg3b/resolve
   STATUS CHIP: resolved   RESOLVE BUTTON: reopen   CARD CLASS: thread-card host-slot resolved
   HINT: reopens on reply
   disk: status: resolved   git: "thread resolve: Re: Filing plan (th_3hargg3b) by user"
   Attention rows after: [ 'th_sbcvyta3' ]   Open-threads rows for it: 0
reader ⋯ menu Reopen → POST /api/threads/th_3hargg3b/reopen
   MENU ITEMS: [ 'Still current', 'Reopen', 'Archive', 'Delete…' ]
   STATUS CHIP AFTER: open   CARD CLASS AFTER: thread-card host-standalone
   disk: status: open   git: "thread reopen: Re: Filing plan (th_3hargg3b) by user"
```

**PASS.**

**Page errors.** Every driver above installed a `pageerror` listener; all reported `[]`, including
the deleted-parent path (`.t-context` degraded to the stored `doc_gone` id with no link) and the
malformed-form path.

**Automated suites.**

```
VITEST_MAX_THREADS=4 vitest run apps/ui packages/kit   → 83 files, 1068 tests, all passing
   (of which 22 files / 209 tests are this issue's)
CORPUS_UI_PORT=5279 playwright test apps/ui/e2e/thread.spec.ts → 10 passed
eslint apps/ui packages/kit → clean (0 errors, 0 warnings)
tsc --noEmit in apps/ui and packages/kit → clean
prettier --check → clean
```

`apps/ui/e2e/thread.spec.ts` follows the shipped split (`reader.spec.ts`, `board.spec.ts`): the
suite runs with **no** workspace server, so it pins the stylesheet contracts — card, turns, delete
arming, composer and foot, attachments in both states, form controls, the `.working` row and its
reduced-motion guard, the kit's `.ac-menu`, and the nesting cap — while the behavioural half is the
log above.

**Deferred / struck.**

- `createThreadWithFiles` (the multipart create-thread wrapper the sprint lists under "Needed by
  UI-008") is **DEFERRED**: `@corpus/contract/client`'s barrel exports `uploadTurn` and
  `uploadCapture` but **not** `uploadCreateThread` / `buildThreadFormData` / `ThreadUpload`, and the
  package's `exports` map has no deep subpath. Adding the re-export is a `packages/contract` change,
  which is Out of Scope for a UI agent. Substitute evidence: the multipart turn path is implemented,
  tested and exercised end to end above; child-thread creation goes through the existing JSON
  `useCreateThread`, which already carries `selector`. Needs a one-line CONTRACT rider before
  UI-010 or UI-007 can attach a file to a *new* thread.
- TEST-39's "scrolled to the anchor with the highlight flashed" is **DEFERRED → UI-007**: the
  context link opens the parent document and the callback already carries the anchor id as its
  second argument (`onOpenDoc(docId, anchorId)`), verified live — `onOpenDoc` was called with
  `("doc_m", "a_1")`. Scroll-to-anchor is the anchors issue's decoration layer.
- TEST-79's "a margin card becoming visible" is **DEFERRED → UI-007**: margin cards are UI-007's
  surface. The rule it depends on is implemented where it belongs — the seen mark rides on
  `ThreadCard` mounting, so any host that renders the card records the read, and none that does not
  can.

## E2E Verification Log — addendum: Escape disarms the delete button (2026-07-28)

**Implemented on: opus.** Fix for `issues/evals/UI-008-eval.md` → FAIL-1
(TEST-46, "clicking elsewhere or pressing esc disarms"). Main tree, branch
`phase-3-ui`, production build served by `corpus server start` on **9030**,
workspace `/tmp/corpus-s011fix-gKidsH`, real Chromium.

### Reproduction, and the actual cause

`Turn` was already registering an escape layer at `Popover` priority while
armed, so the arming state was not the problem. The press never reached the
chain: `useEscapeStack`'s `isEditing` guard asked whether the event target has
*any* editable ancestor, and in chip mode a thread card is rendered into an
`anchor-slot` — a `contenteditable=false` island **inside the document's
contenteditable**. The armed button therefore always had an editable ancestor,
the capture-phase listener returned early, and no layer was consulted. That is
exactly the evaluator's observation that neither the card nor the reader closed:
the key reached no handler at all.

Reproduced first as a failing unit test (`useEscapeStack.test.tsx` → "treats a
control inside a contenteditable=false island as not typing": `expected "spy" to
be called 1 times, but got 0 times`), then in the browser — the diagnostic below
is from the live page:

```
armed:                              "delete?" | turn-del armed
focused element:                    turn-del armed
inside contenteditable ancestor:    true        ← the guard's mistake
```

### The fix

`apps/ui/src/reader/useEscapeStack.ts` — the **nearest** editable host decides,
not any ancestor: `closest("input, textarea, select, [contenteditable]")`, then
a field is typing and a `[contenteditable]` host is typing only when its
attribute says `""`/`"true"`. A control inside a `false` island is not typing; a
field inside that same island still is, because the textarea is nearer.

### Evidence (live, after the fix)

```
armed:                     "delete?" | turn-del armed
after Escape:              "✕"       | turn-del          ← disarmed
thread card still open: 1   reader open: 1               ← one layer per press
after one more click:      "delete?"                     ← re-arms, does not delete
DELETE requests:           none
page errors:               none
```

### Tests

- `useEscapeStack.test.tsx`: the island case above (fails without the fix).
- `ThreadCard.test.tsx`: "disarms on Escape pressed at the button, inside the
  editor's chip slot" — the card rendered inside a `contenteditable` host with a
  `contenteditable=false` slot, the press dispatched **at the button** (where the
  browser sends it) rather than at `document`, asserting the label returns to
  `✕`, that no `DELETE` is issued, and that the next click only re-arms. The
  pre-existing document-level test stays: it covers the other target.

`apps/ui` + `packages/kit`: 1660 tests passing; lint, format and typecheck clean.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

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
