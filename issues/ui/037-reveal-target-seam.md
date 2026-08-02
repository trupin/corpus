# [UI-037] Reveal-target seam: open a document at an item/thread via one discriminated payload

## Domain
ui

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: —
- Blocks: PLUGINS-010, PLUGINS-009

## Spec References
- SPEC.md §10 plugin surfaces (kit seam); §11 reader

## Summary
Sprint-023 OC5 ruling. PLUGINS-010 (click a todo item → open the doc revealed
at that item) cannot be built today: the open path is docId-only at four seams
(`ColumnComponentProps.onOpen`, `Column.tsx:45`, `OpenTarget`, `NavEntry`), the
reader has no way to scroll-to/flash arbitrary body text (the only transient
flashes are `.thread-card.flash` and `.col.flash`; `.anchor-hl` is a persistent
decoration keyed on a thread id), and `jumpToThread` is reader-internal. Build
the seam ONCE as a discriminated reveal payload — e.g.
`{docId} | {docId, reveal: {kind: "item", exact, prefix?, suffix?}} |
{docId, reveal: {kind: "thread", threadId}}` — threaded through kit's open
path and honored by the reader (scroll + transient flash, reusing the existing
flash visual language), so PLUGINS-010's "reveal item" and PLUGINS-009's "open
thread" are one field, not two mechanisms fighting `useReaderSurface`'s
restoration.

## Acceptance Criteria
- [x] Kit's open seam accepts the discriminated payload; plain docId opens
      keep byte-identical behavior
- [x] Reader honors `kind: "item"`: scrolls the first match of exact (with
      prefix/suffix disambiguation, sprint-023 OC4) into view with a transient
      flash consistent with existing flash styling
- [x] Reader honors `kind: "thread"` by delegating to the existing
      `jumpToThread` path
- [x] Works in column reader and full-screen focus; survives
      `useReaderSurface` restoration without re-triggering
- [x] No plugin-facing breaking change: the payload is additive

## Technical Design
### Files to Create/Modify
- `packages/kit` open/OpenTarget/NavEntry types (additive)
- `apps/ui` reader: reveal handling + flash css; `Column.tsx` passthrough

### Shipped payload (`@corpus/kit/plugin`)
```ts
type RevealTarget =
  | { kind: "item"; exact: string; prefix?: string; suffix?: string }
  | { kind: "thread"; threadId: string };
interface OpenRequest { docId: string; reveal?: RevealTarget }
type OpenPayload = string | OpenRequest;      // a bare id is still an open
```
`ColumnComponentProps.onOpen?: (target: OpenPayload) => void`. Widened seams:
`ColumnComponentProps.onOpen`, `ColumnProps.onOpen`/`onFocusMode` (+ the
`ColumnBody`/`PluginColumnBody` passthroughs), `OpenTarget.reveal`,
`NavEntry.reveal`. `openRequest(payload)` (apps/ui `board/openInColumn.tsx`) is
the one normalisation point.

**One-shot semantics.** The reveal rides the navigation entry (and therefore
`localStorage`, because the instruction outlives the click that made it). The
shared `useReaderSurface` honours it once the document has content and then
calls `onRevealed` → `clearRevealAt`, which takes it off the entry. Back
therefore lands on a plain entry and restores scroll instead of re-flashing;
a reload after consumption flashes nothing. Two guards: identity ref (covers
StrictMode's double-invoked effect) + the entry write (covers reload/Back).

**The flash is drawn, not applied**: `revealItem` traces the match's client
rectangles with fixed-position boxes appended to `document.body`
(`.reveal-flash-layer[data-reveal-flash]` > `.reveal-flash`), removed after
1200 ms — nothing is written into the DOM ProseMirror/React own, and it can
highlight a fragment of a paragraph. Matching flattens the *rendered* text
(whitespace collapsed, block boundaries separated) so it works identically in
the editor, `MarkdownView` and a plugin `View`.

No new runtime export on the `@corpus/kit` barrel, so `RUNTIME_SURFACE`
(`packages/kit/src/index.test.ts`) is unchanged; the additions are type-only on
the `@corpus/kit/plugin` subpath and are pinned by `plugin/types.test.ts`.

## Testing Strategy
Kit type tests + reader component tests; e2e deferred to PLUGINS-010 (OC6).
**Amended on implementation**: an e2e spec ships now (`e2e/reveal.spec.ts`) —
the reader half is exactly what a consumer cannot bring with it, and the
navigation entry is the one hop the payload is honoured at.

## E2E Verification Plan
Covered by PLUGINS-010 once it consumes the seam.

## E2E Verification Log

**Model: Opus 5 (`claude-opus-5[1m]`), 2026-08-02, branch `dogfood-todos-polish`.**

New spec: `apps/ui/e2e/reveal.spec.ts`, 8 tests, real Chromium against the real
Vite dev server on `CORPUS_UI_PORT=5773` (5173/8765 left alone — both held by
other sessions). Transport stubbed per `stubCorpus.ts`; everything above it is
the real app (real React, real ProseMirror, real layout, real client rects).
Driver: the board's own navigation entry is seeded with a pending reveal via
`addInitScript`, which is the same hop and the same parse a plugin's
`onOpen({docId, reveal})` writes — the producers (PLUGINS-009/010) come later.

```
Running 8 tests using 4 workers
  ✓ an open that names an item › scrolls the item into view and flashes it, over the real text (1.9s)
  ✓ an open that names an item › wears the flash treatment the rest of the board's flashes wear (1.9s)
  ✓ an open that names an item › is transient — it takes itself away and leaves the document untouched (3.2s)
  ✓ an open that names an item › takes the instruction off the entry, so a reload does not flash again (4.2s)
  ✓ an open that names an item › uses the prefix to pick which of two identical items it meant (1.3s)
  ✓ an open that names an item › opens at the top, with no flash at all, when nothing was named (1.5s)
  ✓ an open that names a thread › expands and flashes the thread, through the 💬 jump that already existed (968ms)
  ✓ an open that names a thread › is one-shot too — the entry keeps the open and forgets the instruction (978ms)
  8 passed (5.8s)
```

Observed, concretely:
- **Scroll + flash.** Document = 24 filler paragraphs then a 3-item list. On
  load `.reveal-flash` count 1; its bounding box is within 12 px of the
  `li` containing "Book the passport appointment"; `.reader-scroll.scrollTop`
  > 0 (0 with no reveal) and the box sits inside the viewport.
- **Visual language.** `background-color` equals the live `--accent-wash` token
  read off `:root`; `pointer-events: none`; the layer carries `aria-hidden`.
- **Transient, non-invasive.** `[data-reveal-flash]` goes from 1 → 0 on its own;
  afterwards `.reader .ProseMirror li` is still 3 and
  `.reader .ProseMirror [class*='reveal']` is 0 — nothing was written into the
  editor's DOM.
- **One-shot.** After the flash, `localStorage["corpus.board"]` no longer
  contains the quote; a `page.reload()` re-opens the same document
  (`.reader[data-reader-doc="doc_chores"]`) with zero flash layers.
- **OC4 disambiguation.** With two identical "Call the plumber" items and
  `prefix: "Book the passport appointment"`, the box lands on the *third* `li`
  (within 12 px) and >12 px away from the first.
- **Mutation check (proof the assertion is load-bearing).** Forcing
  `chooseOccurrence` to always return the first occurrence made that test fail
  with `Expected: < 12 / Received: 67.59375` — i.e. the flash moved to the wrong
  item. Restored immediately; suite green again afterwards.

Unit/component evidence (scoped runs, `VITEST_MAX_THREADS=4`):
`apps/ui` + `packages/kit` → **148 files, 2318 tests, all passing**. New cases:
`reader/reveal.test.ts` (28: flattening across inline marks and block
boundaries, whitespace-insensitive quotes, occurrence choice and fallback,
scroll policy incl. "already visible ⇒ do not move", flash lifecycle/undo),
`Reader.test.tsx` (flash once + entry cleared; **no** re-flash after
push→Back; thread reveal expands + `.thread-card.flash`; a missing quote gives
up and still clears), `FocusMode.test.tsx` (both kinds honoured in the
full-screen host; nothing happens without a reveal), `pluginColumn.test.tsx`
(a plugin body calling `onOpen({docId, reveal})` lands the reveal on the
column's entry in `localStorage`; `onOpen(docId)` writes the byte-identical
old blob), `useNavStack.test.ts`, `useBoardLocalState.test.ts` (round-trip,
malformed reveals dropped, write-on-consume), `openInColumn.test.tsx`,
`packages/kit/src/plugin/types.test.ts` (payload accepted/rejected at the type
level).

Gates: `npm run typecheck -w apps/ui -w packages/kit` clean; `eslint` clean
(no suppressions added); `prettier --check` clean.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
