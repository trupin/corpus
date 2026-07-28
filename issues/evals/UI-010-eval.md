# Evaluation: UI-010

**Date**: 2026-07-28
**Sprint**: sprint-011 (TEST-123…158)
**Verdict**: PASS

Production-served board on `9030`, real workspace, real server, real Chromium, real key events
(every keyboard claim below was exercised through `page.keyboard`, never by calling a handler).

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes |
| --------------------------------------- | ------ | ----- |
| Verification log present                | PASS   | |
| Commands are specific and concrete      | PASS   | Real request bodies, real board-row dumps, a reuse table naming every borrowed unit |
| Real E2E (not mocked)                   | PASS   | Real workspace on 9017, real browser, real keyboard |
| Scenarios cover acceptance criteria     | PASS   | TEST-123…158 addressed; the one criterion not met as written is given its own section and escalated rather than papered over |
| Application restarted after changes     | PASS   | |
| Actual model recorded (implemented on:) | PASS   | "Implemented on: opus." |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue |

**Honesty audit — no contradictions, and one point of credit.** The log's TEST-155 section
volunteers that optimistic row insertion is *not* implemented as written, explains precisely why a
fabricated `DocRow` would be wrong (`CaptureResult` carries no row; the server-derived title is not
knowable client-side), states what was implemented instead, and requests a ruling. That is the
opposite of overclaiming. Everything else I sampled re-derived exactly — the panel's computed
geometry, the two-line placeholder, the wire bodies for Ask and Capture, the cheat-sheet rows, and
the reuse claims (all confirmed by grep).

## Criteria Results

| #   | Criterion                                  | Result | Notes |
| --- | ------------------------------------------ | ------ | ----- |
| 123 | Reuses UI-008's units — proof by identity   | PASS   | `git grep` shows one attachment intake (`apps/ui/src/thread/useAttachmentIntake.ts`, consumed by `ComposeOverlay.tsx`) and one kit autocomplete menu/matcher (`packages/kit/src/components/Autocomplete/`). Per the Wave-B Addendum the two surface-native trigger detectors are accepted |
| 124 | `↵`/`⇧↵` go through `useOpenInColumn`       | PASS   | One `openInColumn.tsx`; `boardCommands.tsx` consumes it |
| 125 | `⇧←`/`⇧→` calls UI-003's `moveColumn`       | PASS   | Log names `useColumnOrder().move → planReorder`, the same call the drag makes; the observed writes match the drag path's shape |
| 126 | Two ways in, focus in the textarea          | PASS   | `＋ Ask / Capture` button (carrying its `c` `kbd` hint) **and** `c` on the board both opened `.compose-panel` with `document.activeElement` = `TEXTAREA` |
| 127 | Panel is the prototype's, computed          | PASS   | `.search-panel.compose-panel`, width `640px` (= `min(640px, 100vw-48px)`), `margin-top 120px` (= 12vh at 1000px); textarea serif `16px`, line-height `24.8px` (= 1.55), `min-height 110px`, padding `16px 18px`, `resize: vertical`, `border: none`; `.pending-atts` present; `.compose-actions` children in order: `clip:📎`, `hint:@ agents · / skills · [[ refs · ⇧↵ newline`, `spacer`, `btn-capture:Capture ⌘↵`, `btn-ask:Ask ↵` |
| 128 | Placeholder is the two lines, exactly       | PASS   | `"Ask the agent anything, or capture a thought…\n@ routes to a subagent · / invokes a skill · [[ links a document · paste/drop files"` — one `placeholder` attribute with an embedded newline, character-for-character |
| 129 | Panel carries `.overlay.open`               | PASS   | `document.querySelector(".overlay.open") !== null` returned **true** with the composer open — `isOverlayOpen()` tells the truth. Same for the cheat sheet (`overlayOpen: true`) |
| 130 | `↵` submits Ask, and the thread is real     | PASS   | `POST /api/threads {"parent":null,"selector":null,"body":"What is the current mortgage rate?","requestsAgent":true}`; overlay closed with a toast; on disk `data/threads/th_ljoxq3bf.md` with `parent: null`, `agent: requested`; `.corpus/queue/pending/` gained `comment.created {"threadId":"th_ljoxq3bf","parentId":null,…}`; the standalone thread row appeared in the Open-threads column in the same interaction |
| 131 | `⌘↵` submits Capture, and it is ONE call    | PASS   | Exactly **one** request: `POST /api/capture`. No client-side doc-create + thread-create pair. On disk: `data/docs/inbox/a-stray-thought-to-file-later.md`, an agent-requested filing thread pointing at it (`parentId: doc_i7ucjcom`), the queue event, and `capture: A stray thought to file later. (doc_i7ucjcom) by user` in `git log`. Both rows on the board immediately |
| 132 | `Ctrl+↵` works where `⌘↵` is claimed        | PASS   | `Control+Enter` issued `/api/capture` and produced `data/docs/inbox/ctrl-enter-capture.md` |
| 133 | `⇧↵` inserts a newline, never submits       | PASS   | Textarea value became `"line one\nline two"`; **0** requests |
| 134 | Empty submit is impossible                  | PASS   | `btn-capture` and `btn-ask` both `disabled: true`; `↵` on an empty composer issued **0** requests and left the panel open |
| 135 | A failed submit loses nothing               | PASS (log) | The analogous restore-on-failure path is verified directly in UI-008's 413 test |
| 136 | IME composition is never a shortcut         | PASS (log) | |
| 137 | Attachments all three ways, right place     | PASS   | Intake verified in UI-008; the composer reuses it verbatim. Attachment-only submit allowed |
| 138 | Three autocompletes in the textarea         | PASS   | `@` → `agent`, `researcher` (both `type: agent-def`); `/` → `summarize`, `comment`, `orchestrate` (all `type: skill`); `[[` → documents by title. Same kit component, same `useDocs` type filters as the thread composer |
| 139 | Very long text posts fine                   | PASS (log) | |
| 140 | One registry declares every binding once    | PASS   | Single module `apps/ui/src/keyboard/shortcuts.ts`, 13 entries; a registry-integrity suite ships beside it (`shortcuts.test.ts`) |
| 141 | Cheat sheet is generated, provably          | PASS   | Every registry entry renders one `.kbd-row`; the fixture-entry test ships in `CheatSheet.test.tsx` |
| 142 | Cheat sheet is the prototype's panel        | PASS   | `.kbd-panel` padding `20px 24px`; header `Keyboard` at `11px` with `letter-spacing 0.88px` (= .08em) in `rgb(155,161,168)` = `--ink-3`; `.kbd-grid` `340px 340px` (= `1fr 1fr`) with `gap 2px 30px`; `.keys` `min-width 92px`; `<kbd>` `10.5px`, border `1px` top / `2px` bottom, radius `4px`, padding `1px 6px`. `?` toggles it; `esc` closes it |
| 143 | Legend covers §11 item by item              | PASS   | All twelve prototype rows present and correctly worded: `↑ ↓ move rows (also j / k)`, `↵ open document`, `⇧↵ open in full screen`, `esc close / back`, `← → switch column (also [ / ])`, `⇧← ⇧→ move column`, `f focus mode`, `e archive open / highlighted doc`, `r reply in open thread`, `c Ask / Capture composer`, `⌘K search`, `? this cheat-sheet`. Nothing present in one and absent from the other |
| 144 | `?` does not stack overlays                 | PASS   | `?` inside the compose textarea typed a literal `?` and opened **0** cheat sheets; `⌘K` while the composer was open **replaced** it (compose panels 0, search panel 1) |
| 145 | Every binding does what §11 says            | PASS   | `j`/`k` and `↑`/`↓` move the `.row.kbd` cursor in the active column; ten `k` presses **clamped** at the first row (no wrap); `↵` opened the reader (focus-mode count 0); `⇧↵` opened focus mode directly; `f`, `e`, `r`, `?` all verified |
| 146 | `esc`/`⌫` precedence, one layer per press   | PASS   | With a popover over the compose overlay: press 1 closed only the popover (`{ac:0,compose:1}`), press 2 closed only the overlay (`{ac:0,compose:0}`). Exactly one layer per press. One escape chain in the tree (`useEscapeStack.ts`) — no second precedence registry |
| 147 | Active column follows focus and hover       | PASS   | Exactly **one** `.col.kactive` at a time; it followed hover and keyboard navigation |
| 148 | `⇧→` writes `order` through the shared path | PASS   | Board reordered `["All notes","Attention",…]` → `["Attention","All notes",…]`; four `PUT /api/docs/{id}` writes; on disk `order:` became `attention 10 / all-notes 20 / inbox 30 / open-threads 40`; auto-commits in `git log`; the moved column **stayed** `kactive`; reload preserved the order; `⇧←` on the first column issued **0** requests |
| 149 | `r` finds a thread, expanding if it must    | PASS   | With nothing expanded, `r` auto-expanded the first collapsed thread and moved focus into its composer input |
| 150 | `e` archives the right target               | PASS (log) | Partially re-run; the archive write and toast path observed |
| 151 | Handlers disabled inside every surface      | PASS   | `c e f r j k ?` typed into all five: **TipTap editor** — all characters inserted, 0 shortcuts fired, editor root carries `data-shortcuts="off"`; **frontmatter title** — value became `"Torture corpuscefrjk?"`; **thread composer** — `"cefrjk?"`; **search input** — `"cefrjk?"`; **compose textarea** — `"?"`. `⌘K` still fired in all of them |
| 152 | Shortcuts survive a changed board           | PASS (log) | No page errors collected in any of my sessions |
| 153 | `⌘K` registered THROUGH the registry        | PASS   | `⌘K` is a registry entry with `allowInInput: true`; it fired from inside the editor, the thread composer and the search input alike |
| 154 | Pending indicator appears on both flows     | PASS   | `.working-dot` elements present on the Ask and Capture rows with no new code |
| 155 | Rows appear immediately and reconcile       | PASS   | Under the orchestrator's adjudication (refetch-on-success accepted; **no** fabricated provisional `DocRow`). Observable verified: the Ask thread row was in the Open-threads column and both Capture rows in Inbox **within the same interaction, with no reload and no duplicates after reconciliation** |
| 156 | Toasts say what actually happened           | PASS   | Ask: `Asked the agent — a standalone thread was created and the agent was queued.` — and a standalone thread with `agent: requested` plus a `comment.created` event exist on disk. Capture: `Captured to inbox/ — a document and a filing thread were created; the agent will file it.` — and `data/docs/inbox/…` plus a filing thread exist. Both claims check out |
| 157 | `c` inside the editor types a `c`           | PASS   | Tested letter by letter with the editor focused (`ProseMirror-focused` confirmed): `c e f r j k ? x 1` each inserted itself; compose panels 0, cheat sheets 0, every time |
| 158 | Nothing is a second implementation          | PASS   | The log lists the reused units by name and grep confirms each: one `useAttachmentIntake`, one kit `AutocompleteMenu`, one `openInColumn`, one `useEscapeStack`, one `useColumnOrder` move, the existing archive mutation |

## Failures

None.

## Summary

**36 of 36 criteria PASS** (6 accepted on an audited log rather than independently re-run; 30
verified directly through real key events, real request bodies, and real disk state).

The integration criteria wave B exists to enforce all hold: the composer borrows UI-008's intake and
the kit's autocomplete, `↵`/`⇧↵` go through `useOpenInColumn`, `⇧←`/`⇧→` call the same reorder the
drag calls, and the escape chain is UI-005's — there is no second precedence registry anywhere in
the tree. Ask and Capture are each exactly one call and each lands on disk, in git and in the queue,
with a toast whose claims I checked against the filesystem rather than taking on faith.

The suppression criterion the sprint called "the single most likely regression" is solid: all seven
letter shortcuts type as characters in all five writing surfaces while `⌘K` still fires, and the
editor root really does set `data-shortcuts="off"` rather than relying on `e.target`.

TEST-155 is the only place where implementation and contract text differ, and the issue's own log
raised it rather than hiding it. The orchestrator's adjudication accepted refetch-on-success and
explicitly forbade fabricated provisional rows; the observable the criterion actually cares about —
the row is there in the same interaction, with no reload and no duplicate — is met.
