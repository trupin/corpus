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

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
