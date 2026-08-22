# [UI-112] The comment popover can be moved, and what it is about stays lit while you write

## Domain

ui

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Related: UI-110 (the same complaint one surface over — writing and reading what
  you are writing about are currently exclusive), UI-111 (the same popover)

## Spec References

- SPEC.md **§10** Document view — *"selecting text pops a floating toolbar
  (formatting + **Comment**); commenting captures the text-quote selector and
  opens a thread composer"*
- SPEC.md **§10** Thread view — a comment on a selection inside a turn: *"the
  selection becomes the child thread's text-quote anchor (§6), **is highlighted
  in the turn** the way an anchor is highlighted in a document"*
- SPEC.md **§6** — anchors and how a highlight is painted

## Summary

Two complaints about the same modal, reported together:

> I want to be able to move the comment modal (sometimes, it is above content I
> need for the comment). The selected content should be highlighted in the
> document / thread immediately so I don't lose track of what is selected while
> scrolling.

**The popover lands where the selection is, which is exactly where the thing you
are writing about is.** For a short quote that is right; for anything where the
comment needs the surrounding paragraph — a figure two lines up, the sentence the
pronoun refers to — the box is sitting on the evidence.

**And the highlight arrives too late to help.** `useTurnComments.tsx` says it
plainly: *"the highlight is the anchor the server resolved, painted over the
turn."* So the selection is lit **after** the comment is posted — at the moment
it stops mattering. While composing, which is the only time you need to know what
you have got hold of, the browser's own selection is all there is, and it is lost
the moment focus moves to the composer or the view scrolls.

## What it should do

**The popover can be moved, and stays where it was put.** Dragged by a handle,
kept within the viewport, and it does not fight the selection: reopening for a
new selection places it afresh, since a position chosen for one passage means
nothing for the next.

**The selection is lit the moment the popover opens**, in the document and in a
turn alike, the way §6 paints an anchor — so scrolling away to check something
leaves a visible mark where you will come back to. It goes out when the popover
closes without sending; on send it is replaced by the real anchor, which is the
same paint by a different owner.

## Acceptance Criteria

- [x] The popover can be dragged, by an affordance that says so, and is operable
      from the keyboard — §10 adds no exclusive-pointer capability
- [x] It cannot be dragged off-screen, and survives a scroll of the surface
      beneath it
- [x] A position is per-opening, not persisted: a new selection opens a fresh
      popover in the default place
- [x] The selection is highlighted **on open**, before anything is sent, in a
      document body and in a rendered turn
- [x] The provisional highlight is visibly the same paint as an anchor's (§6),
      because it is about to become one — but it disappears cleanly if the
      comment is abandoned, leaving nothing behind
- [x] Scrolling the surface with the popover open leaves both the popover and the
      highlight where they belong: the popover where it was put, the highlight on
      its text
- [x] Nothing about the composer key contract, the ask-agent toggle or (with
      UI-111) attachments changes

## Technical Design

### Files to Create/Modify

- `apps/ui/src/anchors/CommentPopover.tsx` — the drag handle and its bounds
- `apps/ui/src/anchors/` — the provisional highlight, painted from the pending
  selector rather than from a resolved anchor
- `apps/ui/src/thread/useTurnComments.tsx` — the same for a selection in a turn

### Notes

The highlight machinery already exists; what is new is painting it from a
selector the server has not seen yet. Keeping one painter for both cases is what
makes "the same paint" true rather than approximately true.

**Watch the ProseMirror interaction**: the document body is an editable surface,
and a decoration that survives an edit while its text is being typed over is a
decoration that has to reconcile. A provisional highlight over a *live* selection
in an editable document may need to yield on edit rather than reconcile — say
which, and why, rather than discovering it.

## Testing Strategy

Component: the drag bounds, the per-opening reset, the highlight's appearance on
open and its removal on abandon. E2E: open the popover on a long document, scroll,
assert both the popover and the highlight are still where they should be — the
scroll is the apparatus, exactly as in UI-110.

## E2E Verification Plan

### Verification Steps

1. Select a passage mid-document, open the comment popover
2. The passage is lit immediately
3. Drag the popover clear of the passage; scroll up — the highlight is still
   visible on its text, the popover still where it was dropped
4. Press escape without sending — the highlight goes, leaving no mark
5. Repeat on a selection inside a rendered turn

## E2E Verification Log

**Model: Opus 5 (1M context), ui-dev agent, 2026-08-16.**

### The ProseMirror decision, stated

**A provisional highlight reconciles with edits around it and yields to edits
through it**, and it lives in a slot of its own in the anchor plugin rather than
among the server's placements.

- *Reconcile with edits around it.* It maps through every transaction exactly as
  an anchor does. Typing above the quote is the common case while a composer is
  open ("as I wrote above…"), and a mark pinned to fixed offsets would slide onto
  whatever text moved into them.
- *Yield to edits through it.* Where an anchor collapsed to nothing is retained
  and hidden (sprint-011 TEST-111), this is dropped. That retention exists
  because a **conversation** hangs off the anchor and only the server may orphan
  it; a provisional range has neither. It is a promise about words that are about
  to be quoted, and once they have been typed over the promise is false — a
  zero-width mark asserting the selection survived its own deletion is the worse
  failure, because the surface would then have no way to say so.
- *Its own slot.* The placements are the server's offsets into the **saved**
  body, and `applyAnchors` declines every dispatch while the editor is showing
  anything else. Routing a live range through that gate left the highlight dark
  for the whole of an editing session — which is precisely when someone is
  commenting. Pinned by "lights the selection even while the editor holds unsaved
  edits" in `useAnchorLayer.test.tsx`.
- A wholesale document replacement (an external change adopted while the composer
  is open) collapses it too, and that is right: after a replacement those offsets
  describe a document that is no longer on screen, and there is no server anchor
  to repair them from.

### Real app: real server, real workspace, real browser

`corpus init /tmp/ui112-ws --port 8834` (never 8765 — the user's live server),
`corpus server start`, a real note created through the CLI, Vite on **5373** with
`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8834`, driven by a real Chromium at
1400×900. Console errors were watched throughout: none after the token was wired.

```
1. board loaded against the real server on 8834
2. reader open on the real document
3. composer open; provisional highlights: 1
   text: "The rate assumption is 6.1% today, and it drives every figure below it."
   pips drawn (should be 0): 0
4. composer opened at { x: 831, y: 265 }
5. dragged by (+260,+300) → composer now at { x: 1072, y: 565 }
6. scrolled the reader: highlight y 238 → -102 | composer still at { x: 1072, y: 565 }
   highlight still painted: 1 "The rate assumption is 6.1% today, …"
7. keyboard: grip focused = true | moved { x: 1072, y: 565 } → { x: 1008, y: 517 }
8. escape: composer hidden; highlights left behind: 0
9. sent: highlights now 1  provisional: 0  pip: 1
   highlighted text: "The rate assumption is 6.1% today, …"
```

Read against the criteria: (3) lit **on open**, before any request, with an
anchor's own paint and no pip. (5) the drag moved it, and stopped at `x = 1072`
= `1400 − 320 − 8`, the clamp, not the pointer. (6) the surface scrolled 340px
under it — the words went from `y 238` to `y −102`, off the top — and the box did
not move a pixel; the mark is still on its own text. (7) `↑↑↑` then `⇧←` moved it
`−48, −64`, exactly three steps and one coarse step. (8) abandoning left **no**
mark anywhere. (9) on send the provisional mark is replaced by the server's
anchor, pip and all — the same paint, a different owner.

Disk and git, in the same workspace:

```
$ git log --oneline -3
cb0bc7c comment: new thread on doc_bzx4ikea (th_4jp36hm4) by user
87fe55a editing session: 1 document by user
5fbf9bd workspace: initialize corpus workspace by user

$ sed -n 1,16p data/docs/inbox/long-rates-memo.md
anchors:
  anc_3790f23d:
    exact: The rate assumption is 6.1% today, and it drives every figure below it.

$ cat data/docs/threads/th_4jp36hm4.md
parent: doc_bzx4ikea
anchor: anc_3790f23d
## user · 2026-08-16T16:27:23Z
Where does 6.1% come from?
```

Both processes were stopped afterwards and 5373/8834 verified free.

**One defect the drill found that no unit test could.** The grip's first
accessible name was "Move this comment box". Playwright's `getByLabel` matches
**substrings**, so `composer.getByLabel("Comment")` — how five existing e2e specs
fill the field — resolved to two elements and threw. Renamed to
`"Move this composer"`, and the reason is recorded next to the constant.

### Playwright, against the app (`apps/ui/e2e/comment-move.spec.ts`, 8 specs)

`CORPUS_UI_PORT=5373` throughout. Both surfaces: a document body and a rendered
turn (whose mark is read out of the real `CSS.highlights` registry, since
react-markdown owns those nodes). The scroll is the apparatus, as in UI-110.

Every one of them was **checked red before it was checked green**:

- with the popover's position read from the props instead of the drag state, 5
  of the 8 fail (moves-and-scrolls, off-screen clamp, keyboard, opens-afresh,
  and the turn's drag);
- with `setProvisional` removed from `openDraft` and the turn's `draft ?? pending`
  reverted to `pending`, 5 fail (lit-on-open on both surfaces, the scroll spec,
  abandon-leaves-nothing, opens-afresh).

Regression runs: `anchor-layer`, `anchors`, `context-menu`, `turn-comment`,
`todos` and `comment-move` together — **69 passed**, which is what proves the new
button did not make the existing locators ambiguous.

### Unit

`npx vitest run apps/ui` — **2998 passed, 0 failed**. Each new unit test was also
checked red under a mutation of the code it covers: the drag tests against a
props-driven position (6 red), the turn highlight against `pending`-only (2 red),
the layer's provisional tests against a removed `setProvisional` (7 red), and the
yield rule against a `mapAnchors`-style retain (1 red).

`npx eslint` clean on everything touched, `npx prettier --check` clean,
`tsc --noEmit -p apps/ui` clean.

### Not fixed, and deliberately

- **`useAnchorLayer`'s `flashThread` effect still returns silently** when the
  reveal target's decoration is not drawn yet, and never re-runs (`deps:
  [flashThread]`). My work neither fixes nor collides with it: the provisional
  decoration carries no `data-thread`, so that query is untouched, and the fix it
  needs — re-trying once the anchors' own dispatch lands — does not fall out of
  this change for free.
- **A refusal that re-opens the composer resets its dragged position**, because
  the host unmounts the popover on submit and mounts a fresh one on the refusal.
  The words stay lit across that round trip; only the box goes back to the
  selection. Per-opening is the rule, and this reads as a new opening.
- **Editing away the quoted words while composing puts the mark out but does not
  cancel the draft.** Sending then quotes text the document no longer contains,
  and §6's ladder is the server's to run — the anchor may come back orphaned.
  That was true before this issue; what is new is that the surface now *says* so
  by going dark, instead of saying nothing at all.
- `npm run build` currently fails in **apps/cli** (`src/commands/doc/edit.ts:296`,
  `exactOptionalPropertyTypes` on `addTags`). Pre-existing and untouched by this
  work — nothing here is in `apps/cli` — but it will fail the harvest gate.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-112]` prefix
