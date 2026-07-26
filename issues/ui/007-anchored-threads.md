# [UI-007] Anchored threads: highlights, comment-from-selection, chips ↔ margin cards

## Domain

ui

## Status

todo

## Priority

P0

## Model

fable — mapping anchor character offsets through ProseMirror positions (and keeping decorations attached across edits, autosave, and server reconciliation) is the hardest UI problem in the product; the adaptive placement layout is novel design with no off-the-shelf answer.

## Dependencies

- Depends on: UI-006
- Blocks: —

## Spec References

- SPEC.md §6 — "Threads and anchors" → text-quote selectors in the parent's frontmatter, the four-step **resolution** ladder, **orphaned** threads, **anchor reconciliation** on every save
- SPEC.md §11 — _Document view_ → **Commenting** (selection → floating toolbar → thread composer with "ask agent" toggle), **Adaptive thread placement** (margin cards in focus/wide, chips in narrow columns), clicking a highlight opens its thread, typing inside one just edits, whole-document + orphaned threads listed below the body
- SPEC.md §8 — agent participation: the composer's toggle translates to the agent flag on the POST
- SPEC.md §9.2 — `GET /api/docs/:id` (anchors with resolved range or orphaned), `POST /api/threads` (selector + first turn + agent flag), `PUT /api/docs/:id` (response reports remapped and orphaned anchors)
- SPEC.md §15 M3 — Playwright check: "select text → comment ('note only') → highlight + chip appear without reload"; "type (file updates via autosave; **anchors survive**)"
- SPEC.md §15 M1 — the reconciliation semantics the UI must visibly honor: edits before/after an anchored range keep it resolved; edits inside update `exact`; deleting the range orphans the thread
- `design/index.html` — **authoritative look & feel** (`.anchor-hl`, `.anchor-hl.resolved`, `.anchor-pip`, `.thread-slot`/`.t-chip`/`.t-collapse`, `.thread-card` + `.resolved`, `.focus-inner.with-margin`, `.focus-margin` + its `::before` connector, `.comments-btn`/`.comments-pop`, `.sel-toolbar .comment-btn`; and the `layoutMargin()` measure-sort-cascade routine)

## Summary

Make anchors visible and durable in the editor. The server returns each anchor's resolved character range in the markdown source; this issue builds the **offset-mapping module** that translates markdown character offsets into ProseMirror document positions (using the very serializer UI-006 wrote), then renders anchored highlights as ProseMirror **decorations** — never marks, so nothing an anchor does can leak into the serialized markdown. On top of that: comment-from-selection (compute `{exact, prefix, suffix}` against the markdown source, POST the thread, show the highlight optimistically), local decoration remapping through edit transactions with the server's `PUT` reconciliation report as the authority, and **adaptive placement** — collapsed chips at the anchor in narrow columns, Google-Docs-style margin cards with connectors in focus/wide layouts.

The offset-mapping module is the crux of this issue: get it right and unit-tested first, then build everything else on it.

## Acceptance Criteria

- [ ] `GET /api/docs/:id` anchors with a resolved range render as `.anchor-hl` spans over the corresponding editor text, with a superscript `.anchor-pip` showing the thread's turn count; resolved-status threads use `.anchor-hl.resolved` (dotted `--ink-3` underline, no wash) and a grey pip.
- [ ] Highlights are implemented as a ProseMirror **`Decoration.inline` set** in a plugin — never as schema marks. Assertion test: with highlights rendered, `serialize(editor.state.doc)` is byte-identical to the same document with no highlights.
- [ ] An offset-mapping module converts a markdown `[start, end)` character range into a ProseMirror `{from, to}` (and back), derived from the same serializer used in UI-006, and is unit-tested across headings, lists (nested), code fences, blockquotes, inline marks, and `[[ref]]` nodes — including ranges that begin or end inside an inline mark and ranges spanning a block boundary.
- [ ] **Comment from selection**: with text selected, the `.sel-toolbar`'s **💬 Comment** opens a small composer popover anchored to the selection with a text input, an `◉ ask agent / ○ note only` toggle, and a submit; submitting computes `{exact, prefix, suffix}` (~32 characters of context each side, clamped at document bounds) **against the markdown source** (not the DOM text), POSTs `POST /api/threads` with `{ parent, selector, firstTurn, agent }`, and paints the highlight optimistically before the response lands. On error the optimistic highlight is rolled back with a toast.
- [ ] Typing inside, before, or after a highlighted range just edits — no mode, no dialog. Decorations remap locally through each transaction's `mapping`; after the debounced `PUT` returns, decorations are **refreshed from the response's remapped/orphaned report**, which is authoritative over the local mapping.
- [ ] An anchor the server reports as orphaned loses its highlight and its thread moves into the "detached threads" section below the body, without a reload.
- [ ] **Adaptive placement — narrow (column reader)**: each anchored thread renders as a `.thread-slot` containing a collapsed `.t-chip` labelled `💬 <n> · <last author>[· resolved]` positioned at the anchor's block; clicking expands the `.thread-card` in place (`.thread-slot.expanded`) and marks the thread seen; `–` (`.t-collapse`) collapses it back.
- [ ] **Adaptive placement — focus/wide**: `.focus-inner.with-margin` switches to the two-column grid (`minmax(0,1fr) 300px`, 30px gap); thread cards are absolutely positioned in `.focus-margin`, each measured against its anchor's vertical offset, sorted by that offset and cascaded downward so no two overlap (`y = max(anchorTop, lastBottom)`, 12px gutter), with the `::before` connector to the anchor. Layout recomputes on first render, on reply/expand (height change), on window resize, and on editor content height change.
- [ ] Clicking an `.anchor-hl` opens/expands its thread (scrolls the margin card into view in wide mode, expands the chip in narrow mode) and marks it seen.
- [ ] Whole-document threads (anchor `null`) and detached/orphaned threads are listed below the body in their own sections, with the prototype's `whole-document thread` / `standalone` head text in place of the anchor quote.
- [ ] Resolved threads render collapsed (chip in narrow, `.thread-card.resolved` — grey left border, 0.75 opacity — in margin) and their highlight switches to the resolved style.
- [ ] Deleting a thread (or its last turn, per §6's cascade) removes its highlight live via SSE, with no stale decoration left behind.
- [ ] The reader header's `.comments-btn` (`💬 <n>`) opens the `.comments-pop` list of this document's threads (italic serif quote + mono meta); clicking an entry jumps to its anchor.

## Technical Design

### Files to Create/Modify

- `apps/ui/src/features/anchors/offsetMap.ts` — **the crux**: markdown offset ↔ ProseMirror position mapping built from the serializer's emission trace
- `apps/ui/src/features/anchors/offsetMap.test.ts` — the mapping's unit suite
- `apps/ui/src/features/editor/markdown/serialize.ts` — extend to optionally emit a **position trace** (`{ pmFrom, pmTo, mdStart, mdEnd }[]`) alongside the string (modify; UI-006 owns the serializer)
- `apps/ui/src/features/anchors/anchorDecorations.ts` — ProseMirror plugin holding the decoration set, with `setAnchors` / `mapThroughTransaction` behavior
- `apps/ui/src/features/anchors/selectorFromSelection.ts` — selection → `{ exact, prefix, suffix }` against the markdown source
- `apps/ui/src/features/anchors/CommentPopover.tsx` — the selection composer popover (input + agent toggle + submit)
- `apps/ui/src/features/threads/ThreadSlot.tsx` — `.thread-slot` wrapper: chip ↔ expanded card, seen-marking on expand
- `apps/ui/src/features/threads/ThreadChip.tsx` — `.t-chip`
- `apps/ui/src/features/threads/MarginLayout.tsx` — the measure-sort-cascade margin column
- `apps/ui/src/features/threads/useMarginLayout.ts` — the layout hook (ResizeObserver + recompute triggers)
- `apps/ui/src/features/threads/DetachedThreads.tsx` — whole-document + orphaned sections below the body
- `apps/ui/src/features/reader/CommentsPopover.tsx` — `.comments-btn` + `.comments-pop`
- `apps/ui/src/features/anchors/anchors.css` — `.anchor-hl`, `.anchor-pip`, margin/connector styles from `design/index.html`
- `packages/kit/src/hooks/useCreateThread.ts` — `POST /api/threads` mutation with optimistic-anchor support
- `packages/kit/src/hooks/useDocAnchors.ts` — anchors slice of `GET /api/docs/:id`
- `apps/ui/src/features/editor/DocEditor.tsx` — wire `onComment`, the decoration plugin, and the PUT reconciliation callback (modify)

### Key Implementation Details

**Offset mapping (do this first).** Extend the serializer to optionally record, for every text run it emits, the ProseMirror range that produced it and the markdown character range it occupied in the output. That trace is a sorted array of intervals; mapping a markdown range to PM positions is then a binary search plus intra-run linear offset arithmetic. Rules:

- Only **text-content** runs are mapped. Syntax the serializer adds (`## `, `- `, `**`, fence lines, blockquote `> `) belongs to no PM text range; a markdown offset landing inside pure syntax snaps to the nearest content boundary.
- A `[[ref]]` node emits its bracket form as one atomic run: an offset inside it maps to the node's whole range.
- Ranges spanning block boundaries produce **multiple** decoration segments (one per block), not one decoration crossing a block — ProseMirror inline decorations cannot span blocks.
- The inverse direction (PM position → markdown offset) is required for `selectorFromSelection` and uses the same trace.

Recompute the trace whenever the serialized string changes (i.e. alongside the autosave serialization) and cache it keyed by the doc version — never recompute per decoration.

**Decoration plugin.** A ProseMirror plugin with state `{ set: DecorationSet, anchors: AnchorView[] }`:

- `apply(tr, state)` → `set.map(tr.mapping, tr.doc)` so decorations follow local edits for free; a decoration mapped to a zero-width range is retained-but-hidden (pending the server verdict) rather than dropped, so a transient delete-and-retype does not flicker the thread out.
- A `setAnchors` meta rebuilds the set from server data: the response of `GET /api/docs/:id` initially, and the `PUT /api/docs/:id` reconciliation report thereafter. Server data always wins.
- Each decoration carries `class="anchor-hl"` (+ `resolved`) and `data-thread="<id>"`; the pip is a separate `Decoration.widget` placed at the range end so it never becomes part of the text.

**Selector computation.** From the PM selection, map to markdown offsets, take `exact = md.slice(start, end)`, `prefix = md.slice(max(0, start-32), start)`, `suffix = md.slice(end, min(len, end+32))`. Do not trim or normalize whitespace — the server's resolution ladder matches literally first. Refuse to create a thread on an empty/whitespace-only selection (disable the Comment button).

**Optimistic highlight.** On submit, generate a client-side temp anchor id, push it into the decoration plugin with the selection's current PM range, and optimistically insert the thread into the TanStack Query cache for this doc. On success, swap temp id → server id; on failure, remove both and toast.

**Interaction with autosave (UI-006).** The autosave PUT already exists; this issue consumes its reconciliation callback. Ordering guarantee: never apply a stale `PUT` response — tag each PUT with a monotonically increasing local revision and ignore reports whose revision is older than the newest applied one.

**Adaptive placement.** Choose mode by measured container width (a `ResizeObserver` on the reader body; margin mode above ~1100px of available reader width, and always in focus mode; below that, chip mode). The layout algorithm mirrors the prototype's `layoutMargin()` exactly:

1. Collect the thread cards.
2. For each, find its anchor element in the main column and measure `getBoundingClientRect().top` relative to the main column; anchors without an element (whole-document threads) fall to `lastBottom`.
3. Sort ascending by `top`.
4. Walk in order: `y = max(top, lastBottom)`; set `card.style.top = y`; `lastBottom = y + card.offsetHeight + 12`.
5. Set `margin.style.minHeight = lastBottom`.

Recompute on: initial render, expand/collapse, reply appended, resize (`ResizeObserver` on the main column and the margin), font load, and editor doc height change. Debounce recomputes to one per animation frame.

**Seen marking** is display-driven per §7: expanding a chip, opening a thread, and a margin card becoming visible each `POST /api/threads/:id/seen`. Use an `IntersectionObserver` on margin cards. (The seen endpoint plumbing and unread-badge behavior belong to UI-008 — call the kit hook it exposes, or a thin local wrapper if UI-008 has not landed.)

**Styling** comes verbatim from `design/index.html`: `.anchor-hl` (accent wash, 2px accent bottom border, 3px 3px 0 0 radius), `.anchor-hl.resolved` (no background, dotted `--ink-3`), `.anchor-pip` (mono 10px, superscript, accent pill), `.t-chip` (mono 10.5px, accent wash pill, accent border on hover; `.resolved-chip` → `--ink-3` on `--surface-2`), `.thread-card` (surface-2, 1px `--line` border with a **3px** `--accent` left border, 10px radius, `max-width: 62ch`; `.resolved` → `--ink-3` left border + `opacity: .75`), `.focus-margin .thread-card::before` connector (23px hairline at `left: -23px; top: 16px`).

### Edge Cases

- Two anchors overlapping the same text → overlapping decorations; the pip stacks (render pips side by side, not on top of each other) and clicking the overlap opens the innermost (shortest) anchor's thread.
- An anchor whose `exact` appears multiple times — the server owns resolution; the UI only consumes the resolved range and must not attempt its own text search.
- An anchored range entirely inside a fenced code block or a `[[ref]]` — the mapping snaps to content boundaries; commenting on a ref node anchors the whole node.
- Selection that starts in one block and ends in another → multi-segment decoration; the selector's `exact` still comes from the contiguous markdown slice (which includes the intervening newlines/syntax) — this is correct and is what the server reconciles against.
- Deleting the whole anchored range: the local mapping yields a zero-width decoration (hidden); the PUT response then reports it orphaned and the thread moves to the detached section.
- A thread created optimistically while the document is mid-save: queue the POST behind the in-flight PUT so the selector is computed against the version the server has.
- Locked document (§7): highlights still render and threads are still readable/repliable, but the selection toolbar and comment creation are unavailable (the editor is not editable).
- Margin mode with more thread height than document height — `minHeight` on the margin extends the scroll region; the main column must not stretch.
- A thread deleted server-side while its margin card is open → card disappears and the layout re-cascades.
- Zero anchors: `.focus-inner` must **not** gain `.with-margin` (no empty 300px gutter).

## Testing Strategy

Vitest in `apps/ui`:

- `offsetMap.test.ts` — the priority suite. Table-driven over fixture documents: for a set of known markdown ranges assert the PM range, and assert the inverse round-trips. Cases: plain paragraph; inside `**bold**`; inside nested list items; inside a fenced code block; across a paragraph boundary; adjacent to a `[[ref]]`; at document start/end; in a blockquote.
- `anchorDecorations.test.ts` — build an editor state, set anchors, apply transactions (insert before / insert after / insert inside / delete the range) and assert decoration ranges track correctly; assert a server `setAnchors` overrides local mapping; assert serialization is unchanged with decorations present (the "never marks" guarantee).
- `selectorFromSelection.test.ts` — prefix/suffix lengths, clamping at document bounds, exactness (no trimming), refusal on empty selection.
- `useMarginLayout.test.ts` — feed synthetic anchor offsets + card heights and assert the cascade output (sorted, non-overlapping, 12px gutter, correct `minHeight`); assert recompute on height change.
- `ThreadSlot.test.tsx` — chip label formatting (`💬 3 · agent · resolved`), expand/collapse, seen POST fired exactly once per expand.
- `CommentPopover.test.tsx` — agent toggle default and its effect on the POST payload; optimistic highlight applied then rolled back on a rejected mutation.

## E2E Verification Plan

### Verification Steps

1. Start the real stack (`npm run watch`) against a `corpus init` workspace with a seeded multi-paragraph document.
2. **§15 M3 gold path**: open the document in a column, select a phrase, click **💬 Comment**, type a comment, set the toggle to `○ note only`, submit. Expect: the highlight and its `💬 1 · user` chip appear **without a page reload**; the thread appears in an Open-threads column; `cat` the parent file and confirm an `anchors:` entry with matching `exact`/`prefix`/`suffix`; confirm the thread file exists under `data/threads/` with `parent` and `anchor` set; confirm **no** queue event was enqueued (`ls .corpus/queue/pending/` empty) since it was note-only.
3. Repeat with `◉ ask agent` and confirm a `comment.created` event lands in `.corpus/queue/pending/`.
4. **Anchor survival (§15 M1 semantics through the UI)**: type a new sentence **before** the anchored range → after autosave, the highlight is still on the same words; `git diff` shows the anchor's `prefix` refreshed and `exact` unchanged. Repeat with an edit **after** the range. Then edit **inside** the range and confirm `exact` updated and the highlight followed. Then delete the whole range and confirm the thread moves to the detached section with no highlight.
5. **Serialization purity**: after all of the above, `git diff` on the document shows no stray markup (no `<span>`, no marker characters) anywhere in the body.
6. **Adaptive placement**: with the reader narrow, confirm chips at the anchor blocks. Press `f` (or ⤢) for focus mode — confirm the layout switches to margin cards with connectors, sorted by anchor position and non-overlapping. Add a reply to the top card and confirm the cards below re-cascade. Resize the window and confirm recompute.
7. Click a highlight → its thread opens/expands and its unread badge clears (verify against the Attention column / row badge).
8. Resolve the thread → chip and card take the resolved styling and the highlight goes dotted-grey.
9. Delete the thread (`corpus doc delete <threadId>` or the ⋯ menu) → the highlight disappears live via SSE and the parent's frontmatter `anchors` entry is gone.
10. Playwright: `apps/ui/e2e/anchors.spec.ts` automating steps 2, 4 (before/after edits), and 6 against the real app — this is the §15 M3 anchor check.

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
- [ ] Committed with `[UI-007]` prefix
