# [UI-044] Reader close flushes the document's edit session

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SERVER-052
- Blocks: —

## Spec References
- SHARED-008 rider

## Summary
When a reader showing a document with an open USER edit session closes (column
reader exits to its list, focus mode closes without the column staying on the
doc, the doc is swapped by navigation), the UI calls the session-flush
mechanism SERVER-052 exposes so the `doc.edited` event fires promptly instead
of waiting out the inactivity window. Must be reliable on tab close/navigation
too, within reason (sendBeacon/keepalive where the platform allows; the
inactivity window is the guaranteed fallback, so best-effort is acceptable and
stated). Never flush sessions the user didn't have (read-only views, agent
edits, unchanged docs).

## Acceptance Criteria
- [x] Close/navigate-away flushes an active session exactly once
- [x] No flush when nothing changed or the change was agent-authored
- [x] Tab-close best-effort path present and stated honestly in tests
- [x] Back/forward through nav stack doesn't double-flush

## Technical Design
### Files to Create/Modify
- apps/ui reader lifecycle (colocate with useReaderSurface/editor teardown);
  kit method for the flush call

## Testing Strategy
Component tests on the lifecycle triggers; e2e closing a dirty reader and
observing the event (with SERVER-052 landed).

## E2E Verification Log

**Model: Opus 5 (1M context)** (`claude-opus-5[1m]`), 2026-08-05, branch
`phase-11-edit-ack`. Every file written is under `apps/ui/` or
`packages/kit/src/client/` (plus this issue file).

### Which exits count as "the reader closes" — the design decision

A close is **the last editing surface for the document going away**, not any one
surface going away. The registry (`apps/ui/src/editor/editSessionFlush.ts`)
counts surfaces per document id; `DocEditor` and `FrontmatterForm` each retain
one, and a flush is issued when the count reaches zero *and* the document has a
landed user write *and* no write is still on the wire.

| Exit | Session end? | Why |
| --- | --- | --- |
| Reader closes (Back to the list) | **yes** | the surface is gone |
| Reader navigates onto another document | **yes**, for the outgoing one | the reader keys `DocEditor` by id, so it is a remount |
| Focus mode opens or closes over a column on the same document | **no** | two surfaces, one sitting; the column's editor is still mounted |
| Focus mode closes and no column holds the document | **yes** | the count reaches zero |
| Back/forward within a nav stack | **no** second flush | returning opens no session, so leaving again has nothing to end |
| Blur, alt-tab, `visibilitychange → hidden`, 10 s idle | **no** | these are §7's *edit lock* signals, not §4's. `LOCK_IDLE_RELEASE_MS` is 10 s against the session's 180 s, so wiring the flush to any of them would make §4's "distinct and longer window" unreachable and fragment one sitting into an acknowledgment per typing burst — the exact defect CONTRACT-031 was filed to avoid. **No `visibilitychange` listener is registered**, deliberately, against CONTRACT-031's suggestion to fire on both: hiding a tab is not putting a document down |
| Tab close / reload | **yes** | `pagehide`, best effort |

**Unload path.** `pagehide` only, through the existing ordered sequence in
`apps/ui/src/abandon/pagehide.ts`, which gained a third phase — `decide` →
`flush` → `settle`. The ordering is load-bearing: the acknowledgment describes
the commit range *as it stands*, so it must be issued after autosave and the
frontmatter form have put their final `PUT`s on the wire. `fetch(…, {keepalive:
true})` (set unconditionally by `CorpusClient.flushEditSession`, so the in-app
path is not a second, weaker one); `navigator.sendBeacon` is **not** used —
CONTRACT-031 measured it answering `401`, because it sends no headers and so no
bearer token.

**When the flush fails.** Nothing is surfaced and nothing is retried: `open` is
cleared *before* the request, the promise's rejection is swallowed, and §4's
inactivity window remains the guaranteed backstop. A lost flush costs a delay,
not an acknowledgment. The `404` (unknown document) is included in that —
a caller that receives one has nothing to flush either way.

### 1. The real app: real `corpus init` workspace, real server, real browser

Workspace `mkdtemp`'d, `corpus init --port **9414**` (never 8765, never 5173),
`corpus server start`, one `note` created through the CLI. Vite dev server on
**`CORPUS_UI_PORT`-equivalent port 6040** (`--strictPort`) with
`CORPUS_SERVER_ORIGIN=http://127.0.0.1:9414` and the workspace token; headless
Chromium via Playwright, driving the real board.

```
1. opened and closed WITHOUT typing → flushes: 0 puts: 0
2. after the save, reader still open → puts: 1 flushes: 0
3. focus mode opened and closed     → flushes: 0
4. reader closed → ["POST /api/docs/doc_cb2e3b6d/edit-session/flush"]
5. reopened and closed with no typing → 1 flush(es) total
```

Line 1 is the read-only close: no session, no request. Line 2 is the sitting
staying open while the reader is. Line 3 is focus mode ⤢ opened and Escaped over
a column still showing the document — one sitting, no flush. Line 4 is §4's
close path. Line 5 is the Back/forward criterion: reopening and closing again
issues nothing.

The server's own queue, on disk, after that run — **exactly one** event:

```json
{"type":"doc.edited","source":"edit","payload":{"docId":"doc_cb2e3b6d",
 "sessionId":"es_8237bfaf7d287025","actor":"user","endedBy":"close",
 "from":"7d59cf05…cff34","to":"28d915cc…7de4",
 "stats":{"commits":1,"insertions":2,"deletions":2}}}
```

`endedBy: "close"` over a real git range: the flush, not the idle sweep (three
minutes had not passed).

### 2. Tab close / reload

Typed, waited for the `PUT`, then `page.reload()` — the same unload path as
closing the tab, and the one where nothing unmounts, so `pagehide` is the only
route. The browser does not report a keepalive request issued during unload
(`flush requests observed by the browser: 0`), so the proof is server-side:

```
doc.edited close es_b39dd859e0bdba52 {'commits': 1, 'insertions': 2, 'deletions': 2}
```

Server log for the two runs, no other status anywhere in it:

```
{"msg":"request","method":"POST","path":"/api/docs/doc_cb2e3b6d/edit-session/flush","status":204,"durationMs":1}
{"msg":"request","method":"POST","path":"/api/docs/doc_cb2e3b6d/edit-session/flush","status":204,"durationMs":3}
```

### 3. Duplicates — the case the unload path makes likely

Typed, closed the reader, and reloaded the tab **inside the same sitting**, so
both the in-app close and the unload path were live:

```
in-app close + reload → flush requests seen in-page: 1
events in the queue: 1
```

Then two further explicit flushes of the same document over the real socket:

```
204 204
events in the queue: 1   (doc.edited close es_c37afc78e5c12a08)
```

Three flushes, one session, one acknowledgment — the route's idempotence and
this side's "clear the mark before issuing" both holding.

### 4. Navigating the reader onto another document

Typed into A, went Back and opened B in the same column, then closed B untouched:

```
after swapping the reader onto another document → flushes: ["doc_cb2e3b6d"]
after closing the untouched second document     → ["doc_cb2e3b6d"]
queue: doc.edited doc_cb2e3b6d close
```

Only the document being left is flushed; the one that was merely read is not.

### 5. Scoped gates

- `VITEST_MAX_THREADS=4 vitest run apps/ui/src packages/kit/src` → **169 files,
  2796 tests, all passing**. **32 are new**: 24 in the new
  `apps/ui/src/editor/editSessionFlush.test.tsx`, 2 in `DocEditor.test.tsx` (the
  real editor through the real client), 3 in `FrontmatterForm.test.tsx`, 1 in
  `abandon/pagehide.test.ts` (the third phase's ordering), 2 in
  `packages/kit/src/client/createCorpusClient.test.ts` (the `204` and the `404`,
  with `Request.keepalive` asserted at the transport).
- `tsc --noEmit` on `apps/ui` and `packages/kit` → clean.
- `eslint <12 touched files> --max-warnings 0` → clean, no rule disabled (three
  `require-await` errors in the new suite were fixed by removing the needless
  `async`, not suppressed).
- `prettier --check` on the same twelve → clean.
- `npm run build -w packages/contract -w packages/kit` → clean, so `apps/ui`
  resolves `flushEditSession` through `dist/`.

The repo-wide suite and `npm run coverage` were **not** run (machine-load
discipline); that is the orchestrator's harvest gate.

### 6. Note on SERVER-057

The mount landed before this ran (`apps/server/src/edit/routes.ts:67`), so every
flush above went to a real handler and answered `204`.

### 7. Disclosure

No git command was run against this repository. The E2E used a throwaway
workspace under `mkdtemp`, whose own `corpus init` created a repository there;
it and every process started (server pid 27124, Vite pid 27473) were stopped and
removed, and ports 6040 and 9414 verified free.

---

## E2E Verification Log — PR #22 review follow-up (MAJOR + two MINORs)

**Model: Opus 5 (1M context)** (`claude-opus-5[1m]`), 2026-08-05, branch
`phase-11-edit-ack`. Files written: `apps/ui/src/editor/useAutosave.ts`,
`apps/ui/src/editor/useAutosave.test.tsx`, `apps/ui/src/editor/editor.css`,
`apps/ui/src/reader/DocView.tsx`, `apps/ui/src/reader/DocView.test.tsx`,
`apps/ui/e2e/edit-session-close.spec.ts` (new),
`apps/ui/e2e/plugin-late-arrival.spec.ts`, plus this issue file. Nothing under
`apps/server/`. No git command was run.

### 1. Reproduction — the double session, before the fix

The reviewer's sequence, driven deterministically rather than raced. **Two
independent reproductions, both taken with the fix removed and no other change.**

**a. Integration, fake clock** (`apps/ui/src/editor/useAutosave.test.tsx`, the
real `@corpus/kit` client over a stub `fetch`, the real
`editSessionFlush` registry, a surface retained through `useEditSurface`
exactly as `DocEditor` does). Type → `PUT` #1 lands (session open) → type again
→ unmount → the teardown `PUT` is refused (500) → advance the sweep window →
advance past `RETRY_DELAY_MS`:

```
AssertionError: expected [ [ 'doc_a1b2c3' ], [ 'doc_a1b2c3' ] ]
                to deeply equal [ [ 'doc_a1b2c3' ] ]
- Expected            + Received
  [                     [
    [ "doc_a1b2c3" ],     [ "doc_a1b2c3" ],
  ]                     +  [ "doc_a1b2c3" ],
                        ]
```

Two `flushEditSession("doc_a1b2c3")` calls — two acknowledgments for one
sitting — plus a third `PUT` (`expected … to have a length of 2 but got 3`).

**b. Real browser, real timers** (`apps/ui/e2e/edit-session-close.spec.ts`,
headless Chromium via Playwright against the real Vite dev server on
**`CORPUS_UI_PORT=6050`**; never 5173, never 8765). A note is opened in a column
reader, typed into, the save is allowed to land; the next `PUT` is armed to
answer `500`; the last sentence is typed and the reader is closed with Back
inside the debounce window. Then five seconds pass — past `RETRY_DELAY_MS`
(3 s) plus the flush sweep (300 ms):

```
✘ a save refused as the reader closes still ends the sitting exactly once
  Error: one sitting, one acknowledgment
  Expected: 1
  Received: 2
```

and with that assertion removed, `a third PUT means a retry outlived its
surface — Expected: 2, Received: 3`. The orphaned retry, the second session,
the second acknowledgment: all three observed in a real browser.

### 2. The shape chosen, and why the alternatives lose

**A retry belongs to the surface that would report it, and dies with it.** The
failure handler now returns before arming anything when the hook has been
retired (its surface unmounted) or when the response is about a document the
hook is no longer bound to. `endEditWrite(…, false)` still runs first, so the
close path is never left waiting; the sweep ends the session over the range that
actually committed, and nothing lands behind it. The property the module claims
— *a flush never ends a session while a write for that document may still land*
— now holds because **no write can be started after the last surface for the
document is gone**. Nothing is surfaced on failure, as before: there is no chip
left, and §4's inactivity window remains the backstop for the flush itself.

Rejected, with reasons:

- **Keep the write counted until the retry resolves or is abandoned.** Holds the
  invariant, and would even save the text — but it parks the acknowledgment three
  seconds behind the close (`EDIT_SESSION_SETTLE_MS`'s own docstring asks that "I
  closed the document" and "the agent knows" stay the same moment), for a request
  nobody is waiting on. Worse, the hold must be released down *every* path that
  cancels the retry — the retry shares the debounce ref precisely so a keystroke
  supersedes it — and one missed release wedges that document's flush for the
  life of the tab. A stuck acknowledgment is a worse failure than a lost debounce
  window.
- **Have the cleanup adopt the retry.** The cleanup is synchronous and the timer
  is armed later, from a promise it cannot see; adopting it means a module-level
  registry of pending retries — more machinery for the same outcome.
- **Gate on `hasEditSurface(docId)` in the flush registry** instead of on the
  hook's own lifecycle. Rejected as a hidden coupling: `useAutosave` would
  silently stop retrying for any caller that did not also mount
  `useEditSurface`.

What the chosen shape costs is one debounce window of text when a save fails at
the exact moment the reader closes. Nothing could have rescued it: there is no
chip left to report the failure and no user left to press retry, and parking the
body somewhere that outlives its surface is the second source of truth for a
document body that SPEC.md §5 is most careful about — the same reason a buffer
parked behind a foreign lock is not rescued either. The acknowledgment then
describes what the server actually has.

### 3. Verification after the fix

- Both reproductions above pass. In the browser: `2` saves, `1` flush, and the
  refused sentence is absent from the corpus — the range the acknowledgment
  describes is the range that committed.
- The mounted retry is unaffected: `failure > keeps the buffer, shows the signal
  state and retries once by itself` and `re-sends the buffer when the retry
  affordance is used` still pass, as does `sends the tail edit even when the
  surface went away mid-flight` (the success handler's chained send, which is
  registry-counted and must keep working).

### 4. MINOR — `DocView.tsx` blind-paint mark

Fixed the **behaviour**, not the comment: the mark is dropped as soon as the
reader shows another document, so it describes one painted body rather than the
component. A reader is not keyed by document id, so the old mark followed the
column for the life of the tab — a `[[ref]]` opened long after discovery settled
was drawn without its panel, and so was the original document on the way Back,
with nothing on screen either time for a late arrival to move. Real-browser
proof, `apps/ui/e2e/plugin-late-arrival.spec.ts` (new test, manifests held past
`DISCOVERY_BUDGET_MS`, released, then navigated by `[[ref]]` and Back):

```
✘ keeps a body painted blind unadorned, and only that body
  waiting for locator('[data-todo-panel]') to be visible   (before the fix)
✓ keeps a body painted blind unadorned, and only that body (3.6s)  (after)
```

The test waits for the plugin's own aggregate request before navigating — the
only honest signal that discovery has *settled*, since releasing the manifest
merely starts the import. Waiting on the release instead made the test race the
phase it is about (observed: it passed warm and failed cold).

### 5. MINOR — `editor.css` misattribution

Corrected. The competing `.ProseMirror [contenteditable="false"] { white-space:
normal }` is in the stylesheet **TipTap** injects at import time
(`node_modules/@tiptap/core/dist/index.js:4332-4334`, read directly).
`prosemirror-view/style/prosemirror.css` contains only
`.ProseMirror [draggable][contenteditable=false] { user-select: text }` and is
not imported anywhere in the repo (`grep` over `apps/`, `packages/`, `plugins/`
returns nothing). The restatement itself was already correct and stays.

### 6. Gates

- `VITEST_MAX_THREADS=4 vitest run apps/ui/src` → **129 files, 2137 tests, all
  passing**. **+3 tests**: 2 in `useAutosave.test.tsx` (the sitting's single
  acknowledgment; no retry for a document a reader rebound away from), 1 in
  `DocView.test.tsx` (chrome on the next document and on the way Back). The
  autosave harness now retains an edit surface in `DocEditor`'s declaration
  order, and the suite resets the flush registry between tests.
- Playwright on `CORPUS_UI_PORT=6050`: `edit-session-close.spec.ts` (new),
  `plugin-late-arrival.spec.ts` (+1 test, 6 total), `abandon.spec.ts`,
  `editor.spec.ts`, `reader.spec.ts` → **29 passed**. The new close spec was run
  three times, and the plugin spec twice in isolation and twice in-file, to rule
  out the timing flake the first draft had.
- `eslint --max-warnings 0` on the seven touched source/spec files → clean, no
  rule disabled. `prettier --check` → clean. `tsc --noEmit` in `apps/ui` → clean.
- The repo-wide suite and `npm run coverage` were **not** run (machine-load
  discipline; two other agents were live in `apps/server`). Ports 5173 and 8765
  were never touched; 6050 was released — Playwright starts and stops its own
  Vite, and no process was left behind.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
