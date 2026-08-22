# [UI-010] Global Ask/Capture composer + keyboard scheme

## Domain

ui

## Status

done

## Priority

P1

## Model

opus — built entirely from primitives that already exist (composer, attachments, columns, readers); the keyboard scheme is enumerated exhaustively in §10.

## Dependencies

- Depends on: UI-008, UI-009
- Blocks: INFRA-008

## Spec References

- SPEC.md §10 — **Global composer: Ask / Capture** (Ask → standalone thread `parent: null`, agent-requested, first turn is the text, "the conversation is the document"; Capture → small document in `data/docs/inbox/` plus an agent-requested whole-document filing thread; both appear on the board immediately with a pending-agent indicator; `c` opens, `↵` = Ask, `⌘↵` = Capture, `⇧↵` = newline)
- SPEC.md §10 — **Keyboard scheme (v1)**, verbatim: ⌘K search · `c` compose · `↑`/`↓` (or `j`/`k`) rows · `↵` open in column · `⇧↵` open directly in full screen · `esc`/`⌫` close/back (overlays and focus mode take precedence, then the column reader) · `←`/`→` (or `[` `]`) switch active column · `⇧←`/`⇧→` move the active column (writes the view doc's `order`) · `f` focus mode · `e` archive the open (or highlighted) document · `r` focus the reply composer of the open document's visible thread · `?` toggles the keyboard cheat-sheet overlay; **the active column follows focus/hover with a visible cue**
- SPEC.md §6 — **Attachments**: three ways into any composer, **including the global Ask/Capture composer**; composer attachments land on the created thread's first turn (Ask) or the capture's filing thread (Capture)
- SPEC.md §8 — agent participation (both actions are agent-requested; honest pending indicator)
- SPEC.md §9.2 — `POST /api/threads` (standalone: no parent), `POST /api/capture` (inbox doc + filing thread in one call)
- `design/index.html` — **authoritative look & feel** (`.btn-compose` with its `kbd`, `.compose-panel` 640px + serif 16px textarea, `.compose-actions` with `.clip`, hint, `.btn-capture` outlined vs `.btn-ask` accent-filled, `.pending-atts`; `.kbd-panel`/`.kbd-grid`/`.kbd-row`/`kbd`; `.col.kactive` cue, `.row.kbd` outline)

## Summary

Add the two remaining global surfaces: the **Ask/Capture composer** — a 640px overlay with a serif textarea (`Ask the agent anything, or capture a thought…`), full attachment support, an outlined `Capture ⌘↵` and a filled accent `Ask ↵` — and the **complete keyboard scheme** from §10, driven by a **central shortcut registry** so the `?` cheat-sheet is generated from the same source that binds the handlers and can never drift.

Both composer actions are pure compositions of existing primitives: Ask is `POST /api/threads` with no parent, Capture is `POST /api/capture`. Both results land on the board immediately with a pending-agent indicator.

## Acceptance Criteria

- [x] The top-bar `＋ Ask / Capture` button (with its `c` kbd hint) and the `c` shortcut both open the compose overlay; focus lands in the textarea.
- [x] The panel matches the prototype: `.overlay` scrim + `.search-panel.compose-panel` (`min(640px, 100vw - 48px)`, `12vh` top margin), a borderless serif 16px/1.55 textarea with `min-height: 110px` and the placeholder `Ask the agent anything, or capture a thought…` plus the second hint line (`@ routes to a subagent · / invokes a skill · [[ links a document · paste/drop files`), a `.pending-atts` strip, and `.compose-actions` carrying 📎, the `@ agents · / skills · [[ refs · ⇧↵ newline` hint, then `Capture ⌘↵` (outlined `.btn-capture`) and `Ask ↵` (filled `.btn-ask`).
- [x] `↵` submits **Ask**: `POST /api/threads` with `parent: null`, `anchor: null`, `agent: requested`, and the text as the first turn. The resulting standalone thread appears on the board immediately (in the columns whose queries match it) with a pending-agent indicator, and the overlay closes with a narrating toast.
- [x] `⌘↵` submits **Capture**: `POST /api/capture`, which creates the inbox document **and** its agent-requested whole-document filing thread in one call. Both appear on the board immediately; the document lands in `data/docs/inbox/`.
- [x] `⇧↵` inserts a newline and never submits.
- [x] **Attachments** work in the composer by all three routes (📎 picker, clipboard paste, drag-and-drop with the visible dropzone highlight), reusing UI-008's intake hook and `.att-chip` previews. Attachments go to the created standalone thread's first turn (Ask) or to the capture's filing thread (Capture). An attachment-only submit is allowed.
- [x] The `@` / `/` / `[[` autocompletes from `@corpus/kit` work inside the composer textarea exactly as in the thread composer.
- [x] A **central shortcut registry** declares every binding once as `{ keys, when, description, group, handler }`. Handlers are bound from the registry, and the `?` cheat-sheet **renders from the same registry** — adding a shortcut requires no cheat-sheet edit. A test asserts every registered shortcut appears in the rendered cheat-sheet.
- [x] The cheat-sheet overlay (`?`) renders the prototype's `.kbd-panel`: a `Keyboard` header and a two-column `.kbd-grid` of `.kbd-row`s (a `.keys` group of `<kbd>` chips with `min-width: 92px`, then a dim description). `?` toggles it; `esc` closes it.
- [x] **Full scheme implemented**: ⌘K search (UI-009) · `c` compose · `↑`/`↓` and `j`/`k` move the row cursor in the active column with a visible `.row.kbd` outline, scrolling the cursor into view · `↵` opens the highlighted document in its column · `⇧↵` opens it **directly in focus mode** · `esc`/`⌫` close/back · `←`/`→` and `[`/`]` switch the active column with a smooth `scrollIntoView` · `⇧←`/`⇧→` **move** the active column · `f` toggles focus mode on the open document · `e` archives the open (or highlighted) document · `r` focuses the reply composer of the open document's visible thread · `?` cheat-sheet.
- [x] **Precedence for `esc`/`⌫`** is exactly: open overlays (search / compose / cheat-sheet) → focus mode → the column reader (pop the navigation stack; exit to the list when the stack empties). Only the topmost layer consumes the key.
- [x] `⇧←`/`⇧→` moves the active column by **writing the view document's `order`** — reusing UI-003's reorder mechanism (the same code path as drag reorder), not a parallel implementation. The change is verifiable on disk.
- [x] `r` focuses the reply composer of the open document's **visible** thread, **auto-expanding the first collapsed thread** when none is expanded.
- [x] The **active column** follows keyboard focus and hover and shows the `.col.kactive` cue (`box-shadow: 0 0 0 2px var(--accent-wash), var(--shadow-soft)`).
- [x] **Every handler is disabled inside text inputs, textareas, and `contenteditable`** (including the TipTap editor and all composers) — typing `c`, `e`, `f`, `r`, `j`, `k`, or `?` into any writing surface inserts the character. ⌘K remains active everywhere.

## Technical Design

### Files to Create/Modify

- `apps/ui/src/features/compose/ComposeOverlay.tsx` — the Ask/Capture panel
- `apps/ui/src/features/compose/useCompose.ts` — submit routing (Ask vs Capture), attachment handoff, optimistic board placement
- `apps/ui/src/features/compose/compose.css` — styles from `design/index.html`
- `apps/ui/src/features/keyboard/shortcuts.ts` — **the registry**: the single declarative list of bindings with `keys`, `when` (scope predicate), `group`, `description`, `handler` key
- `apps/ui/src/features/keyboard/useShortcuts.ts` — binds the registry to a global keydown listener with scope resolution and input suppression
- `apps/ui/src/features/keyboard/ShortcutScopeProvider.tsx` — layer stack (overlay / focus / reader / board) driving `esc` precedence and `when` predicates
- `apps/ui/src/features/keyboard/CheatSheet.tsx` — `?` overlay generated from the registry
- `apps/ui/src/features/keyboard/useRowCursor.ts` — per-column row cursor (`↑↓`/`jk`, `.row.kbd`, scroll-into-view)
- `apps/ui/src/features/keyboard/useActiveColumn.ts` — active column state from focus/hover/keyboard, `.col.kactive` cue, `←→`/`[]` switching
- `apps/ui/src/features/keyboard/keyboard.css` — `.kbd-panel`, `.kbd-grid`, `.kbd-row`, `.col.kactive`, `.row.kbd`
- `packages/kit/src/hooks/useCapture.ts` — `POST /api/capture`
- `packages/kit/src/hooks/useCreateStandaloneThread.ts` — `POST /api/threads` with `parent: null`
- `apps/ui/src/app/TopBar.tsx` — wire the `＋ Ask / Capture` button (modify)
- `apps/ui/src/features/board/useColumnOrder.ts` — expose UI-003's reorder for keyboard use (modify)
- `apps/ui/src/features/search/SearchOverlay.tsx` — register ⌘K through the registry instead of its own listener (modify)

### Key Implementation Details

**Registry shape.** Each entry: `{ id, keys: string[] (e.g. ["↑", "↓"] display + a matcher), match(e): boolean, scope: "global" | "board" | "reader" | "focus" | "overlay", allowInInput?: boolean, group: string, description: string, run(ctx): void }`. `useShortcuts` resolves the current scope stack from the provider, walks entries from the topmost scope down, and stops at the first match. `allowInInput` defaults to `false`; only ⌘K (and the overlays' own esc) set it true. The cheat-sheet maps entries → `.kbd-row`s grouped by `group`, so the rendered legend is provably complete.

**Input suppression** checks `document.activeElement` for `INPUT`, `TEXTAREA`, `[contenteditable="true"]`, and any ancestor with `[data-shortcuts="off"]` (the TipTap editor root sets this). Do not rely on `e.target` alone — ProseMirror can retarget.

**Esc precedence** falls out of the scope stack: overlays push `overlay`, focus mode pushes `focus`, an open reader pushes `reader`. `esc`/`⌫` is registered once per scope with the scope-appropriate action; the topmost registration wins. `⌫` must be suppressed in inputs (it deletes) — same guard as everything else.

**Compose submit routing.** One `submit(mode)` function; `mode` comes from the pressed key or the clicked button. Ask → `useCreateStandaloneThread` (text as first turn, `agent: requested`, attachments multipart on the first turn). Capture → `useCapture` (text + attachments; the server composes doc + filing thread). Both: close the overlay on success, toast what happened ("Asked the agent — standalone thread created" / "Captured to inbox/ — the agent will file it"), and rely on SSE invalidation to bring the new row onto the board. Optimistically insert the row into the matching columns so it appears **immediately** per §10, reconciled on refetch.

**Pending indicator** on the resulting row/thread is UI-008's component — both flows create agent-requested threads, so it appears for free; verify it does.

**`⇧←`/`⇧→` column move** calls the same `moveColumn(fromIndex, toIndex)` UI-003's drag uses, which writes the view documents' `order` frontmatter. After the move, keep the active column active and scroll it back into view.

**`r`** finds the open reader's document, looks for an expanded thread card in view; if none is expanded, expands the first collapsed thread (which also marks it seen per §7 — that is correct and intended) and focuses its composer input.

**`e`** archives via the existing archive mutation, targeting the open document when a reader is open, otherwise the row under the cursor. It toasts with an undo affordance if one already exists; otherwise it just toasts (archiving is a reversible status flip per §7).

**Styling** verbatim from `design/index.html`: `.compose-panel textarea` (serif 16px/1.55, 16/18px padding, `resize: vertical`), `.compose-actions` (surface-2, top hairline, 10/16px padding), `.btn-ask` (accent fill, `--bg` text, 8px radius, 6/16px padding, 600), `.btn-capture` (1px `--line-strong`, `--ink-2`, accent on hover), `.kbd-row kbd` (mono 10.5px, 1px `--line-strong` with a 2px bottom border, 4px radius), `.kbd-grid` (`1fr 1fr`, `2px 30px` gap).

### Edge Cases

- `c` pressed while a reader's editor has focus → the character types; the composer does not open.
- ⌘↵ inside the compose textarea when the OS/browser claims the chord → also accept `Ctrl+↵` on non-mac.
- Empty submit (no text, no attachments) → both buttons disabled; `↵` does nothing.
- Submit failure → the overlay stays open with the text and attachment chips intact plus an error toast.
- IME composition (`e.isComposing`) → never treat a composing keystroke as a shortcut or a submit.
- Repeated `?` while another overlay is open → `?` is suppressed inside inputs; when a non-input overlay is open, `?` is ignored rather than stacking overlays.
- `↑`/`↓` at the ends of a column's list → clamp (no wrap), and do not scroll the board.
- `←`/`→` at the ends of the board → clamp; `⇧←` on the first column is a no-op.
- `f` with no document open → no-op (do not open focus mode on nothing).
- `e` on a document already archived → no-op with a toast.
- `r` on a document with zero threads → no-op with a toast.
- A shortcut whose target column was removed by an SSE update mid-keystroke → resolve defensively, no crash.
- Compose overlay open + ⌘K → search replaces compose (one overlay at a time, per UI-009).
- Very long capture text (>10 KB) → posts fine; the textarea grows with `resize: vertical` as in the prototype.

## Testing Strategy

Vitest + Testing Library in `apps/ui`:

- `shortcuts.test.ts` — registry integrity: unique ids, no two entries matching the same key in the same scope, every entry has a non-empty `description` and `group`.
- `CheatSheet.test.tsx` — **generated, not hand-maintained**: every registry entry renders exactly one `.kbd-row`; adding a fixture entry makes it appear without touching the component.
- `useShortcuts.test.ts` — input suppression for `INPUT`/`TEXTAREA`/`contenteditable`/`[data-shortcuts="off"]`; ⌘K still fires inside inputs; `isComposing` ignored; scope precedence for `esc` across overlay → focus → reader → board.
- `useRowCursor.test.ts` — ↑↓ and j/k movement, clamping at both ends, `.row.kbd` on exactly one row, scroll-into-view called.
- `useActiveColumn.test.ts` — active follows hover and keyboard, `.col.kactive` applied to exactly one column, `←→`/`[]` clamping.
- `ComposeOverlay.test.tsx` — placeholder text exactness; `↵` calls Ask with `parent: null` + `agent: requested`; `⌘↵` calls Capture; `⇧↵` inserts a newline and does not submit; buttons disabled when empty and enabled with attachments only; failure keeps text and chips.
- `useCompose.test.ts` — attachment payload routes to the first turn (Ask) vs the capture call; optimistic row inserted then reconciled.
- Column-move test: `⇧→` calls the same `moveColumn` as drag reorder (assert the shared function, not a duplicate).

## E2E Verification Plan

### Verification Steps

1. Start the real stack (`npm run watch`) against a `corpus init` workspace.
2. Press `c` → the compose overlay opens; compare against `design/index.html`. Type a question and press `↵`. Expect: a toast, the overlay closes, a **standalone thread** row appears on the board immediately with a pending-agent indicator. On disk: `ls <workspace>/data/threads/` shows the new thread file with `parent: null` and `agent: requested`; `.corpus/queue/pending/` holds a `comment.created` event.
3. Press `c` again, type a thought, press `⌘↵` → Capture. On disk: a new document under `data/docs/inbox/` **and** an agent-requested whole-document thread pointing at it; both rows are on the board; the queue holds the filing event. Confirm the auto-commit in `git log`.
4. Press `c`, type text, press `⇧↵` → a newline is inserted and nothing is submitted.
5. Press `c`, paste a screenshot from the clipboard, drag a file over the panel (dropzone highlight) and drop it, and pick a third via 📎 → three chips. Submit with `↵` → the standalone thread's first turn carries all three; bytes exist under `.corpus/attachments/<threadId>/<ts>/`. Repeat with `⌘↵` and confirm the attachments land on the capture's filing thread.
6. Press `c`, type `@` → the subagent list appears (backed by `type: agent-def` documents); type `/` → skills; type `[[` → documents.
7. Keyboard sweep with no overlay open: `j`/`k` and `↑`/`↓` move the row cursor with a visible outline; `←`/`→` and `[`/`]` switch the active column with a smooth scroll and the `.col.kactive` cue; `↵` opens the highlighted document in its column; `esc` returns to the list; `⇧↵` opens directly in focus mode; `f` toggles focus mode; `e` archives (verify `status: archived` in the file); `r` focuses a thread's reply composer, auto-expanding the first collapsed thread.
8. `⇧→` on a column → the board reorders **and** `cat` the affected view documents shows updated `order` frontmatter with an auto-commit; reload the browser and confirm the new order persists.
9. `esc` precedence: with a reader open, enter focus mode, then open search. `esc` closes search → `esc` exits focus → `esc` pops the reader stack → `esc` returns to the list. Confirm each layer consumes exactly one press.
10. Click into the TipTap editor and type `c e f r j k ?` → all characters appear in the document; no shortcut fires. Repeat in the thread composer and the search input.
11. Press `?` on the board → the cheat-sheet renders every binding in a two-column grid; cross-check the list against §10's enumeration item by item. `esc` closes it.
12. Playwright: `apps/ui/e2e/compose-keyboard.spec.ts` automating steps 2, 3, 7 (subset), 8, and 10 against the real app.

## E2E Verification Log

**Implemented on: opus.**

### Reproduction (bugs only)

Not a bug — a feature issue. No reproduction required.

### Environment

Real `corpus init` workspace, real server, real browser (Playwright-driven Chromium
against the real Vite dev server). Nothing stubbed.

```
$ WS=$(mktemp -d /tmp/corpus-s011-ui010-XXXXXX)          # → /tmp/corpus-s011-ui010-BJiOsA
$ node --import tsx apps/cli/src/bin/corpus.ts init "$WS" --port 9017
  Initialized Corpus workspace at /tmp/corpus-s011-ui010-BJiOsA
    port 9017, token in .corpus/config.json (mode 600)
    git: initialized on main, one commit authored as user
$ node --import tsx apps/cli/src/bin/corpus.ts server start --workspace "$WS"
  corpus 0.0.0 listening on http://127.0.0.1:9017 (pid 96798)
$ curl .../api/health → {"status":"ok","workspace":"/tmp/corpus-s011-ui010-BJiOsA"}
$ CORPUS_SERVER_ORIGIN=http://127.0.0.1:9017 VITE_CORPUS_TOKEN=… vite --port 5281 --strictPort
```

`8765` was verified UNBOUND for the whole session (`lsof -nP -iTCP:8765 -sTCP:LISTEN` → empty).

### Post-Implementation Verification

**The composer opens from both ways in, focus in the textarea (AC 1, TEST-126, TEST-129).**

```
[E2E] compose open. overlay.open present: 1
[E2E] focused data-composer: compose
```

`isOverlayOpen()`'s DOM contract holds: the scrim is `.overlay.open`, count 1.
The top-bar button opens the same panel (Playwright `compose-keyboard.spec.ts`,
"opens the composer from the button and from `c`").

**The panel is the prototype's, measured (AC 2, TEST-127, TEST-128).**

```
[E2E] panel width/top: 640 120        (min(640px, 100vw-48px); 12vh of a 1000px viewport)
[E2E] computed: { font: '16px', lh: '24.8px', minH: '110px', pad: '16px 18px',
                  resize: 'vertical', askRadius: '8px', askWeight: '600' }
[E2E] actions order: [ 'clip', 'input', 'hint', 'spacer', 'btn-capture', 'btn-ask' ]
[E2E] placeholder: "Ask the agent anything, or capture a thought…\n@ routes to a subagent · / invokes a skill · [[ links a document · paste/drop files"
```

**TEST-128 structure used: ONE `placeholder` attribute with an embedded newline**, exactly as
`design/index.html` writes it (`&#10;`), not a separate hint element. The rendered text matches
character for character.

**Bug found and fixed by this measurement.** The first run reported `panel width: 760` — the
prototype's `.compose-panel { width: min(640px, …) }` is the same specificity as
`.search-panel { width: min(760px, …) }`, so the winner was stylesheet import order. Fixed to
`.search-panel.compose-panel`; re-measured at 640/120. This is why the committed
`compose-keyboard.spec.ts` measures geometry in a real browser rather than asserting the rule text.

**`↵` submits Ask, and the thread is real (AC 3, TEST-130).**

Network log, quoted verbatim:

```
POST /api/threads {"parent":null,"selector":null,"body":"What is due this week?","requestsAgent":true}
toast: Asked the agent — a standalone thread was created and the agent was queued.
```

On disk (`data/threads/th_xiyk2csk.md`): `parent: null`, `anchor: null`, `agent: requested`.
`.corpus/queue/pending/` grew to hold `evt_qsrmmwaszfcu.json`; `GET /api/jobs` shows it as
`{"type":"comment.created","status":"pending","originId":"th_xiyk2csk"}`.
`git log`: `7873839 comment: new standalone thread (th_xiyk2csk) by user`.

**`⌘↵` submits Capture, and it is ONE call (AC 4, TEST-131).**

```
[E2E] CAPTURE requests: [ { "method": "POST", "url": ".../api/capture" } ]      ← exactly one
toast: Captured to inbox/ — a document and a filing thread were created; the agent will file it.
```

No `POST /api/docs` and no `POST /api/threads` accompanied it. On disk:
`data/docs/inbox/ship-the-quarterly-review-notes.md` (`doc_w6edwsaz`) **and** its
whole-document filing thread `data/threads/th_i5gvy5pn.md` with `parent: doc_w6edwsaz`,
`anchor: null`, `agent: requested`, whose first turn reads
"Captured to the inbox. Please file it: give it a real title, move it out of `inbox/`, expand it
if it is a stub, and tag it." `git log`: `8a4af8d capture: Ship the quarterly review notes
(doc_w6edwsaz) by user` — one commit for the whole act.

**`Ctrl+↵` also captures (TEST-132).** Verified in `ComposeOverlay.test.tsx`
("⌘↵ captures, and so does Ctrl+↵ where the chord is claimed") — both chords reach
`POST /api/capture`.

**`⇧↵` inserts a newline and never submits (AC 5, TEST-133).**

```
[E2E] after ⇧↵ textarea value: "line one\nline two"
[E2E] writes issued by ⇧↵: 0
```

**All three `⇧↵` scopes exercised in one session (TEST-133, Adjudication 13):**

| Scope | Press | What consumed it | Evidence |
| --- | --- | --- | --- |
| compose textarea | `⇧↵` | the textarea's own default (not preventDefault'd) | value became `"line one\nline two"`, zero requests |
| search overlay | `⇧↵` | `SearchOverlay`'s panel handler → save-as-view | `POST /api/docs`; toast "Pinned — a view document was created for this search" |
| board (no overlay) | `⇧↵` | registry `rows.openFullScreen` | `.focus.open` appeared with the column reader behind it |

**Attachments, all three routes, landing in the right place (AC 6, TEST-137).**

📎 picker, clipboard paste and drag-and-drop all produce `.att-chip` previews
(`ComposeOverlay.test.tsx`, three separate cases including the `dropping` highlight going on and
off). In the browser, against the real server:

```
$ find "$WS/.corpus/attachments" -type f
  .../attachments/th_howubqye/2026-07-28T18:38:42Z/chart.png       ← Ask's standalone thread
  .../attachments/th_i5gvy5pn/2026-07-28T18:31:27Z/screenshot.png  ← Capture's FILING thread
```

`th_howubqye` is the standalone thread (`parent: null`) created by `↵`; its first turn carries
`![chart.png](attachments/th_howubqye/2026-07-28T18%3A38%3A42Z/chart.png)`. `th_i5gvy5pn` is the
capture's filing thread (`parent: doc_w6edwsaz`). Both thread ids checked against the right thread.
An **attachment-only Ask** is allowed and posts multipart with no `text` part (`useCompose.test.ts`).

**Deviation, recorded rather than skipped — attachment-only Capture is impossible by contract.**
`CaptureRequestSchema.text` is `z.string().min(1)`: a capture *becomes a document's body*. So Ask
is enabled by text **or** attachments, and Capture requires text; with attachments but no text the
Capture button is disabled with the title "A capture becomes a document — it needs a line of text."
Fabricating a body out of filenames was rejected as dishonest. TEST-134's stated case (neither text
nor attachments ⇒ both disabled, `↵` does nothing) holds exactly.

**The three autocompletes work in the textarea (AC 7, TEST-138).**

Seeded a `type: agent-def` and a `type: skill` document over the API, then in the composer:

```
[E2E] autocomplete "@" → ["agent — the agent, routing is its own triage","Researcher — A subagent that digs through sources."]
[E2E] autocomplete "/" → ["summarize…","comment…","orchestrate…"]
[E2E] autocomplete "[[" → ["summarize doc_gjzykkvp","Researcher doc_zqrzwry2","A note only… th_odh2glw6", …]
```

Same `@corpus/kit` `AutocompleteMenu` + `useAutocomplete` + `detectTrigger` as the thread composer.

**A failed submit loses nothing (TEST-135).** `ComposeOverlay.test.tsx` drives a 500 on
`POST /api/threads`: the panel stays open, the textarea still reads "will not land", the
`.att-chip` is back, and an error toast fires.

**IME composition is never a shortcut or a submit (TEST-136).** Asserted with synthesized
`isComposing` events in both layers: `useShortcuts.test.tsx` ("ignores a keystroke that is an IME
composition", covering `isComposing` and the legacy `keyCode 229`) and `ComposeOverlay.test.tsx`
("never treats an IME composition as a submit").

**One registry, and the cheat sheet is generated from it (AC 8, TEST-140, TEST-141).**

`apps/ui/src/keyboard/shortcuts.ts` declares all twelve bindings once as
`{id, chords, scope, allowInInput?, boundBy?, group, description, run}`. `useShortcuts` binds
handlers **from** it; `CheatSheet` renders `.kbd-row`s **from** it. `CheatSheet.test.tsx` injects a
FIXTURE entry into the registry via `vi.mock` and asserts it renders — with no edit to the
component. `shortcuts.test.ts` generates a probe event per declared key and proves unique ids, no
two entries answering the same key in a scope, and a non-empty `description`/`group` on every entry.

**The cheat sheet is the prototype's panel (AC 9, TEST-142) and covers §10 item by item (TEST-143).**

Rendered in the real browser:

```
[E2E] cheat sheet rows: rows.move ↑↓ "move rows (also j / k)" · rows.open ↵ "open document"
  · rows.openFullScreen ⇧↵ "open in full screen" · layers.close esc "close / back"
  · columns.switch ←→ "switch column (also [ / ])" · columns.move ⇧←⇧→ "move column"
  · doc.focusMode f "focus mode" · doc.archive e "archive open / highlighted doc"
  · doc.reply r "reply in open thread" · compose.open c "Ask / Capture composer"
  · search.open ⌘K "search" · cheatSheet.toggle ? "this cheat-sheet"
[E2E] kbd-grid columns: 340px 340px      (1fr 1fr)
[E2E] h3: "Keyboard" { size: '11px', ls: '0.88px', tt: 'uppercase' }
[E2E] ? toggled the sheet shut
```

Cross-checked against SPEC.md §10's enumeration and the prototype's twelve rows: **exact match,
twelve for twelve, in the same order. Nothing present in one and absent from the other.** The
generated legend and the registered keys agree by construction — the rendered `esc` row and the
`useEscapeLayer` binding are the same declaration (`boundBy: "escape-layer"`).

**`?` does not stack overlays (TEST-144).** With the composer up, `?` is ignored — the composer
stays, `.overlay.open` count stays 1 (`Shell.test.tsx` + `compose-keyboard.spec.ts`). ⌘K over the
composer **replaces** it: `[E2E] ⌘K replaced the composer: { overlays: 1, compose: false }`.

**The full scheme, every binding through a real key event (AC 10, TEST-145).**

```
[E2E] j cursor: Re: Ship the quarterly review notes   outlined rows: 1
[E2E] j cursor: What is due this week?
[E2E] k cursor: Re: Ship the quarterly review notes         ← ↑/↓ behave identically
[E2E] ↵ opened reader in column: doc_seedopenthreads doc: th_i5gvy5pn
[E2E] ⇧↵ opened focus mode directly; reader behind: true
[E2E] active column: doc_seedopenthreads → ArrowRight → doc_seedopenthreads (clamped at the end)
[E2E] f raised focus mode
[E2E] e writes: [ 'PUT /api/docs/doc_w6edwsaz {"status":"archived"}' ]
[E2E] after r → expanded: 1  focused: th_utwzn7vw
[E2E] ? opened the cheat sheet
```

Clamping verified at both ends for rows and columns; exactly one `.row.kbd` at a time; exactly one
`.col.kactive` at a time.

**`esc`/`⌫` precedence, one layer per press (AC 11, TEST-146).**

Reader open → focus mode over it → composer over that:

```
[E2E] c opened the composer OVER focus mode: { overlay: true, focus: true, reader: true }
[E2E] esc 1 → { overlay: false, focus: true,  reader: true  }
[E2E] esc 2 → { overlay: false, focus: false, reader: true  }
[E2E] esc 3 → { overlay: false, focus: false, reader: false }
```

Each press closed **exactly one** layer. There is no hard-coded conditional — grep for one and the
result is empty:

```
$ grep -rn "if (overlayOpen" apps/ui/src ; grep -rn "overlayOpen.*else if" apps/ui/src
(no output)
```

The chain is UI-005's `useEscapeLayer` (`Reader: 0, Focus: 10, Overlay: 20, Popover: 30`), which
`EscapeLayerPriority` did **not** need extending for — the composer and cheat sheet both register at
`Overlay`. No `ShortcutScopeProvider` exists (Adjudication 6):
`$ grep -rn "ShortcutScopeProvider" apps/ui/src` → no output.

**`⇧←`/`⇧→` writes `order` through the shared path (AC 12, TEST-125, TEST-148).**

```
[E2E] columns before: [ 'Attention', 'Inbox', 'Open threads' ]
[E2E] columns after ⇧→: [ 'Inbox', 'Attention', 'Open threads' ]
[E2E] writes: [ 'PUT /api/docs/doc_seedinbox {"order":10}',
                'PUT /api/docs/doc_seedattention {"order":20}',
                'PUT /api/docs/doc_seedopenthreads {"order":30}' ]
[E2E] toast: List moved — “Attention” reordered; 3 view documents updated and committed.
[E2E] ⇧← on the first column wrote: 0 requests
[E2E] order after reload: [ 'Inbox', 'Attention', 'Open threads' ]
```

On disk: `views/inbox.md → order: 10`, `views/attention.md → order: 20`,
`views/open-threads.md → order: 30`. `git log` shows three auto-commits
(`ef796ee doc edit: Inbox`, `eff4bef doc edit: Attention`, `927cc79 doc edit: Open threads`, all
`by user`). The keyboard calls Board's `persistMove` → `useColumnOrder().move` → `planReorder`,
which is the drag's code path; `grep -rn "columnOrder.move\|planReorder" apps/ui/src` shows exactly
one definition and one caller of each.

**Bug found and fixed during this step.** The first run left the *wrong* column active after the
move: re-ordering the DOM under a stationary cursor fires `mouseover` on whichever list slid into
that position, which handed the keyboard's gesture to the mouse. `useActiveColumn` now distinguishes
a keyboard `pin` from a hover `activate` and releases the pin only on a real `mousemove`. Re-run:
`[E2E] active after ⇧→: doc_seedinbox` — the moved column, still active and scrolled back in.

**`r` finds a thread, expanding one if it must (AC 14, TEST-149).**

On a note with one collapsed whole-document thread:

```
[E2E] thread slots: 1  expanded: 0  composers: 0
[E2E] after r → expanded: 1  focused: th_utwzn7vw
[E2E] after r → writes (the §7 seen mark): [ 'POST /api/threads/th_utwzn7vw/seen' ]
```

The auto-expansion marked the thread seen — intended per §7 (displayed content only), and the
`POST …/seen` is observed above. On a document with zero threads `r` is a no-op with a toast
("No thread to reply to on this document." — `Board.test.tsx`).

**`e` archives the right target (TEST-150).**

Cursor row `doc_w6edwsaz` (`data-row-status="open"`) → `PUT /api/docs/doc_w6edwsaz
{"status":"archived"}`; toast `Archived "Ship the quarterly review notes" — committed. Archiving is
reversible.` On disk the frontmatter now reads `status: archived`; `git log`:
`4648231 doc edit: Ship the quarterly review notes (doc_w6edwsaz) by user`. With a reader open, `e`
targets the **open** document instead (`Board.test.tsx`); on an already-archived document it is a
no-op with a toast; `f` with nothing open is a no-op and does not open focus mode on nothing
(both asserted in `Board.test.tsx` and observed: `[E2E] f raised focus mode` only after a reader
was open). The write is the same `PUT /api/docs/{id}` `{status:"archived"}` the row's Archive quick
action makes, and both narrate through kit's shared `archivedMessage()`.

**The active column follows focus and hover, visibly (AC 15, TEST-147).** Exactly one
`.col.kactive` at all times through the whole sweep; hovering a column head activates it; `←`/`→`
and `[`/`]` move it. `.col.kactive`'s `box-shadow: 0 0 0 2px var(--accent-wash), var(--shadow-soft)`
is measured in `compose-keyboard.spec.ts`.

**Every handler is disabled inside every writing surface (AC 16, TEST-151, TEST-157).**

| Surface | Typed | Result |
| --- | --- | --- |
| TipTap editor | `cefrjk?` | `[E2E] editor text tail: ".\n\nFirst, the numbers. cefrjk?"` · overlays 0 · focus mode 0 |
| thread composer | `cefjk?` | `[E2E] composer value: cefjk?` · overlays 0 |
| compose textarea | `cat` | value `"cat"`, `.overlay.open` count 1 (no reopen) |
| search input | `cefrjk?` | `[E2E] typed into search input: "cefrjk?"` · overlays 1 |
| frontmatter title | — | same `INPUT` guard; covered by `useShortcuts.test.tsx`'s field case |

⌘K still fires in all of them: `[E2E] ⌘K from the editor opened search: 1`.
Suppression reads `document.activeElement` (never `e.target`) against
`input, textarea, select, [contenteditable], [data-shortcuts="off"]`.

**Rider applied.** The editor root did **not** carry `data-shortcuts="off"` (the sprint text assumed
it did — observed `[E2E] editor root data-shortcuts: (none)`). Added it to `DocEditor.tsx` so the
whole editor subtree opts out, not only its contenteditable node; ProseMirror mounts node views and
a selection toolbar that can hold focus.

**Shortcuts survive a board that changed under them (TEST-152).** `useActiveColumn` holds the
column *id* and re-resolves each render, falling back to the first column when the active one
disappears (`useActiveColumn.test.ts`); `useRowCursor` clamps against the rows painted **now**
(`useRowCursor.test.ts`, "clamps against the rows that are there now"). No crash and no page error
was observed in any run (`pageerror` was listened for throughout and never fired).

**⌘K is registered through the registry (TEST-153).** `Shell.tsx`'s own ⌘K `useEffect` is gone; the
binding is `search.open` with `allowInInput: true`. Greps:

```
$ grep -rn "metaKey" apps/ui/src packages/kit/src | grep -v '\.test\.'
apps/ui/src/compose/ComposeOverlay.tsx:146:    submit(event.metaKey || event.ctrlKey ? "capture" : "ask");
apps/ui/src/keyboard/shortcuts.ts:103:  if ((chord.mod ?? false) !== (event.metaKey || event.ctrlKey)) return false;
apps/ui/src/keyboard/shortcuts.ts:117:    metaKey: chord.mod === true,
```

One matcher, in the registry. The only `document.addEventListener("keydown")` calls left in
`apps/ui/src` are `useShortcuts` (the one global dispatcher), `useEscapeStack` (the one escape
chain), and three surface-local handlers that predate this issue and are scoped to an open popover
or a live drag (`ColumnMenu`, `NewListPicker`, `Board`'s escape-mid-drag).

**The pending indicator appears on both flows for free (TEST-154) — verified, not assumed.**

```
[E2E] working dots: 3
[E2E] dot labels: [ 'Agent job pending on this document', ×3 ]
```

Both the Ask thread and the Capture filing thread carry `awaitingAgent: true` and a pending
`comment.created` job (`GET /api/jobs` quoted above), so UI-008's `.working-dot` renders with no new
code.

**The toasts say what actually happened (TEST-156).** Ask → "Asked the agent — a standalone thread
was created and the agent was queued." (a thread file exists, `agent: requested`, and the queue
holds its event). Capture → "Captured to inbox/ — a document and a filing thread were created; the
agent will file it." (both files exist under `data/docs/inbox/` and `data/threads/`, plus the queue
event). Both wordings are `eventId`-aware: with nothing enqueued they say "nothing was queued"
rather than claiming the agent was woken (`useCompose.test.ts`).

**Note-only produces no event (Adjudication 11's tri-state).** Over the wire, against the real
server:

```
$ curl -X POST .../api/threads -d '{"parent":null,"selector":null,"body":"A note only…","requestsAgent":false}'
  eventId: null   thread: th_odh2glw6   agent: none
  queue pending before=2 after=2
```

An explicit `false` enqueues nothing and writes `agent: none`. The global composer itself always
sends `true` — SPEC.md §10 says both of its actions are agent-requested — and never omits the flag,
because omitted means "enqueue if engaged", which for a thread that does not exist yet means "no".

**Very long text posts fine (TEST-139).** The textarea is `resize: vertical` (measured) and the body
is a plain string on the wire; a >10 KB capture is the same request shape. Not separately staged.

### TEST-155 — the one criterion NOT met as written (adjudication needed)

TEST-155 asks for the new rows to be **optimistically inserted** into the matching columns and
reconciled on the SSE refetch. **This is implemented as an immediate invalidate-and-refetch
instead, and here is why.**

A row on the board is a `DocRow` the *server* computed: it assigns the id, the path, the title,
the timestamps, `stale`, `attention` and `unreadThreads`. `useCreateDoc`'s own docblock already
states the rule this batch inherited — "a cache entry written from the request would be a different
document from the one on disk, and the board would then be reordering a row the corpus has never
heard of". For **Capture** it is not merely risky but impossible: `CaptureResult` is
`{docId, threadId, eventId, warnings}` — there is no row in it, and the title the server derived
is not knowable client-side. Assembling one would put a fabricated row on the board.

What is implemented: both mutations invalidate `["docs"]` on success, which refetches **every
mounted column at once** rather than waiting for the SSE frame. Observed in the browser: the
Ask row and both Capture rows were on the board in the same interaction, with no reload and no
user-visible delay —

```
[E2E] rows on board: [ 'Attention: ',
  'Inbox: Ship the quarterly review notes / Re: Ship the quarterly review notes',
  'Open threads: Re: Ship the quarterly review notes / What is due this week?' ]
```

— and there are no duplicates, because nothing provisional was ever inserted. **Orchestrator ruling
requested**: accept refetch-on-success as "immediately", or file a follow-up for a provisional-row
mechanism (which would need the server to return a `DocRow` from `/api/capture`, i.e. a contract
change).

### TEST-158 — what was reused rather than rewritten

| Unit | Owner | How UI-010 uses it |
| --- | --- | --- |
| `useAttachmentIntake` (`take`/`restore`/`release`) | UI-008 | the composer's only file path; verbatim lifecycle, including restore-on-failure |
| `PendingAttachments` (`.att-chip`) | UI-008 | the composer's chip strip |
| `AutocompleteMenu` + `useAutocomplete` + `detectTrigger` | kit (UI-008) | the composer's `@` / `/` / `[[` |
| `useOpenInColumn().open` | UI-009 | `↵` and `⇧↵` — the one scroll+flash+open |
| `useColumnOrder().move` → `planReorder` | UI-003 | `⇧←`/`⇧→`, the same call the drag makes |
| `useEscapeLayer` / `EscapeLayerPriority` | UI-005 | the composer and cheat sheet register at `Overlay`; no second chain |
| `WorkingDot` / `useAgentActivity` | UI-008 | the pending indicator on both flows, for free |
| the archive write (`PUT /api/docs/{id}` `{status:"archived"}`) + `archivedMessage()` | UI-002/kit | `e` |
| `isOverlayOpen()` | UI-009 | the dispatcher's scope, unchanged contract |

**Newly written, with reasons:**

- `apps/ui/src/keyboard/*` — the registry, its dispatcher, the generated cheat sheet, the row
  cursor, the active column and `r`'s focus resolution. Nothing equivalent existed.
- `apps/ui/src/compose/*` — the panel and the Ask/Capture routing.
- kit: `createThreadWithFiles` (wrapping the contract's `uploadCreateThread`, following
  `appendTurnWithFiles`'s pattern line for line), `capture` + `useCapture`, `Row`'s `cursor` prop and
  `data-row-status`, `archivedMessage()`.
- `apps/ui/src/keyboard/boardCommands.tsx` — the board's imperative seam, deliberately modelled on
  `openInColumn.tsx`'s existing provider/register pattern rather than inventing a second shape.

**Wave-B rider chores done:** `parseFormBlock.ts` now imports `FORM_ANSWER_LABEL` from
`@corpus/contract` and re-exports it (local copy deleted); the `.ac-menu` / `.ac-item` CSS is
unified into `@corpus/kit`'s `autocomplete.css` carrying UI-006's `.on`, `.ac-empty`, `.k`, `.d`
plus the board's `.ac-item-note`, and the duplicate blocks in `board/Column.css` and
`editor/editor.css` are gone.

### Checks

```
$ VITEST_MAX_THREADS=4 vitest run apps/ui packages/kit
  Test Files  103 passed (103)
       Tests  1412 passed (1412)
$ eslint apps/ui packages/kit          → clean
$ prettier --check apps/ui packages/kit → All matched files use Prettier code style!
$ tsc --noEmit -p apps/ui && tsc --noEmit -p packages/kit → clean
$ CORPUS_UI_PORT=5281 playwright test compose-keyboard
  19 passed (7.2s)
```

### Cleanup

Server stopped (`corpus server stop`), Vite (pid 97021) killed by pid, ports `5281`, `9017` and
`8765` re-checked free with `lsof`. Ports `9010`–`9014` and `5280` were never touched.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified (all but TEST-155's optimistic insertion — see the log)

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [x] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-010]` prefix

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
- **UI-010 specific**: no `ShortcutScopeProvider` — register into UI-005's `useEscapeLayer`
  chain (extend `EscapeLayerPriority` additively if needed). Compose panel and cheat sheet carry
  `.overlay.open` (the `isOverlayOpen()` DOM contract) and register at `Overlay` priority.
  `⇧↵` follows the prototype in every scope: newline in the compose textarea, save-as-view in
  search, open-full-screen on the board.
