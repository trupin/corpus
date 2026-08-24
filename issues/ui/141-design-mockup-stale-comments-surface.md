# [UI-141] The design mockup still draws the 💬 popover the app no longer has

## Domain

ui

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: UI-063 (which replaced the surface)
- Blocks: —
- Related: UI-055 (the same class of staleness, in the same file, one release earlier)

## Spec References

- SPEC.md §10 — the comments-list rider _(signed 2026-08-04)_: *"A document's
  comments are also available as a **list**, reached by a Document / Comments
  switch in the reader's header and present in both column view and full
  screen."*
- `design/index.html` — authoritative for look & feel

## Summary

UI-063 replaced the reader head's 💬 popover with a `Document / Comments` toggle
and a comments tab. `design/index.html` still draws the old surface:

```
design/index.html:192   .comments-btn { … }                     ← still a plain pill, no pressed state
design/index.html:193   .comments-pop { … }                     ← the popover the tab replaced
design/index.html:576   <button class="comments-btn" data-comments hidden>💬</button>
design/index.html:1155  …the same button in the column reader's head…
design/index.html:1693  function toggleCommentsPop(btn) { … }   ← and the behaviour behind it
```

So the mockup shows a control that opens a list of conversations **with nothing
to do about any of them**, where the app now has a two-state toggle onto a
surface that filters, replies, resolves and writes. It also has no comments list
at all, and no composer for a comment with no selection — the two things §10's
rider is about.

**Why this matters, and why it is filed rather than folded in.** The mockup is
what gets consulted for "how should this look". UI-055 was filed for exactly this
failure mode one release earlier — stale composer key labels — and its own
summary says why: *"a stale key label there will be copied into something
eventually."* This release proved the point twice over: two agents read a stale
contract out of this file. UI-055's scope was deliberately held to the composer
keys ("nothing else in the mockup changes"), so the comments surface needs its
own issue rather than a quiet widening of that one.

**It is not a code defect.** The app is right and the mockup is stale; §10's
signed rider supersedes it. Nothing is broken for a user. What is at risk is the
next person who reads the mockup.

## Acceptance Criteria

- [x] The reader head draws the **toggle**, not the old 💬 button: the same pill
      in the same place, with a pressed state for "showing the list"
      (`.comments-btn.on` in `apps/ui/src/reader/Reader.css`)
- [x] The head's toggle reflects **when it appears**, which is not
      unconditional — see the Notes below, and `comments/CommentsSwitch.tsx` for
      the measurement behind it
- [x] The ⋯ menu carries a **Comments** item, which is how a document with no
      conversations reaches the list
- [x] The mockup draws the comments list itself: the two filter axes with their
      counts in reserved boxes, rows that say why an unanchored comment has no
      anchor, a reveal on an anchored row, and the composer at the foot
- [x] `.comments-pop` and `.cp-item` **stay** — the ⋯ document menu still uses
      them, in the app and in the mockup. Only the 💬 popover's *use* of them goes
- [x] The prototype's behaviour matches: pressing the toggle swaps the body for
      the list and back, and does not open a popover
- [x] Nothing else in the mockup changes

## Technical Design

### Files to Create/Modify

- `design/index.html` — the head's control, the ⋯ item, the list, and the
  prototype JS behind them

### Key Implementation Details

The app is the reference, and it is small enough to read end to end:

- `apps/ui/src/comments/CommentsSwitch.tsx` — the toggle, its two states, its
  accessible names, and **why it is not unconditional** (a measured deviation
  from §10, recorded in the docblock)
- `apps/ui/src/comments/CommentsTab.tsx` + `comments.css` — the list
- `apps/ui/src/reader/Reader.css` — `.comments-btn`, `.comments-btn.on`,
  `.comments-count`
- `apps/ui/src/menu/docActions.ts` — the ⋯ menu's `Comments` item

The mockup has no comments list to port from, so this is new drawing rather than
a transcription. It should be built out of the treatments the mockup already
defines — the composer toggle's pill for the filters, `.thread-slot` for the
rows, `.composer` at the foot — exactly as the app's own `comments.css` was.

### Edge Cases

- **Do not draw the switch unconditionally.** The app's toggle appears when the
  document has conversations, or whenever the list is showing. That is a
  deviation from §10's wording, measured and recorded in UI-063: at a 560px
  column with a parent title at its `max-width: 40%` cap the head has 13px of
  slack and the toggle needs 61px. A mockup that drew it always would put the
  next reader back where this release started.
- The **count** lives in a reserved two-character box (`.comments-count`), so it
  does not re-cut the head when it crosses into two digits (SHARED-057).
- An **unfiltered** empty list and a **filtered** empty list say different
  things. Both sentences are in `commentsModel.ts`.

## Testing Strategy

Visual check; the mockup carries no test suite. `prettier --check
design/index.html` must pass.

## E2E Verification Plan

Open `design/index.html` in a browser and compare the reader head and the
comments surface against the running app, side by side.

### Verification Steps

1. Open the mockup and the app on the same document
2. Compare the head: the toggle's two states, its place in the row, its count
3. Press the toggle in both: the body is replaced by the list, and back
4. Compare the list: filters, counts, row sentences, the reveal, the composer
5. Open the ⋯ menu in both and confirm the **Comments** item
6. Confirm the ⋯ menu still uses `.comments-pop` / `.cp-item` in both

## E2E Verification Log

**Model: Opus 5 (1M context).** 2026-08-24. `design/index.html` opened as a
`file://` URL in a real chromium and driven with Playwright's node API, twice.
`localStorage` cleared before each drill. **Zero page errors, zero console
errors, in both runs.**

### What changed in the file

- **CSS** — `.comments-btn.on` (the pressed state) and `.comments-count` (the
  reserved two-character box) beside the existing pill; a `.comments-tab` block
  ported from `apps/ui/src/comments/comments.css`. `.comments-pop`, `.cp-item`,
  `.cp-quote` and `.cp-meta` are untouched and now carry a comment saying why
  they stay.
- **Markup** — both reader heads (the column's and full screen's) draw
  `💬 <span class="comments-count">N</span>` with `data-tab` and `aria-pressed`.
- **Prototype JS** — `state.tab` and `state.cmFilters` (browser-local, per
  reader); `readerBodyHTML(key, docId)`, through which **every** render of a
  reader now goes, so the switch, a re-render and a restore cannot disagree;
  `commentsTabHTML` with the two axes, their counts, the row sentences, the
  reveal and the composer; `setDocTab` and `revealThread` in place of
  `toggleCommentsPop` and `jumpToThread`; a `Comments` item first on the ⋯ menu;
  a `maybeMargin` guard so full screen does not lay out a Docs-style margin over
  the list.

### Drill 1 — a document with conversations, in a column

| checked | observed |
| --- | --- |
| the toggle at rest | visible, `💬 2`, `aria-pressed="false"` |
| pressed | `aria-pressed="true"`, `class="comments-btn on"` |
| the body | `.comments-tab` × 1, `.doc-body` × 0 — swapped, not layered |
| no popover | `.comments-pop.open` × 0 |
| rows | 2 `.cm-row` |
| filters | `All 2 · Open 1 · Resolved 1` and `All 2 · Anchored 2 · Unanchored 0`, each count in its own box |
| row sentences | `anchored to “assume a 30-year fixed at 6.1%”`, `anchored to “PMI drops off automatically at 78% LTV”` |
| reveal | 2 `.cm-reveal` |
| composer | `Comment ⌘↵`, hint `starts a new thread` |
| Resolved filter | 1 row; the pressed segment is the one clicked |
| Open + Unanchored | `No open, unanchored comments. 2 comments are hidden by these filters.` |
| the reveal | list gone, `.doc-body` back, the thread's slot expanded, toggle un-pressed |
| the ⋯ menu | `.comments-pop.open` × 1, six `.cp-item`s, `Comments` first |
| Comments from the menu | `.comments-tab` × 1 |

### Drill 2 — the conditions, and full screen

| checked | observed |
| --- | --- |
| a document with **no** conversations (`doc_payoff`) | the toggle is **hidden** |
| the ⋯ menu on it | reaches the list anyway |
| its empty sentence | `No comments on this document yet. Write the first one below — no text selection needed.` |
| the toggle **while the list shows** | visible — the way back is never missing |
| pressing it | back to `.doc-title` |
| a whole-document conversation (`doc_insurance`) | `about the whole document — it never had an anchor`, and **no** reveal button |
| full screen | the same toggle, the same list, 1 row |
| the margin | `.focus-margin` × 0 while the list shows |
| pressing it again in full screen | `.doc-body` back |

### The two sentences an empty list can say

Both are drawn and both were observed, which is the point of having two: a list
emptied by a filter names the filter and says how many rows it hides; a document
with no comments at all names the act instead of the absence.

### One thing deliberately not drawn

**No fixture produces an `orphaned` row.** `anchorState` reads a thread's own
`orphaned` flag and the prototype draws the detached sentence and the `--signal`
treatment if one is set, but no thread in `THREADS` carries it and inventing one
would need a "detached threads" section in the mockup's data model — outside *"nothing
else in the mockup changes"*. The two states the fixtures do produce (anchored,
whole-document) are both drawn and both verified above.

### Lint

`prettier --check design/index.html` — clean.

## Completion Checklist (domain agent)

- [x] `/lint` passes (prettier covers the file)
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-141]` prefix
