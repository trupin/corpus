# [UI-095] Clicking a comment does not take you to it, opened

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —

## Spec References

- SPEC.md §11 — "Selecting an anchored row reveals it at its anchor in the
  document; an unanchored row opens its thread and says why it has no anchor"
  _(rider signed 2026-08-04)_
- SPEC.md §11 — "Clicking an anchored highlight opens its thread"
- SPEC.md §11 — the collapse rider _(signed 2026-08-05)_: "**Every collapse
  expands again in place**, where it stands, without navigating anywhere"

## Summary

Two live reports (2026-08-08), one gesture: clicking a comment where it is
*listed* should take you to the passage it is about and show the conversation
open. Reported on the reader head's 💬 popover, and on a thread card showing its
parent-document context link.

**This is specified behaviour that is not happening, not a new feature.** The
2026-08-04 rider already requires it for the comments list, and the code already
claims it for the popover: `useReaderSurface.ts:73` documents `jumpToThread` as
*"The 💬 popover's action: expand the conversation, scroll to it, flash it."* The
mechanism is built — `reveal.ts` carries the text index, occurrence choice,
retry and settle-frame machinery, and `ThreadCard` takes a `flashing` prop
described as "True for ~1.2s after the 💬 popover jumped here".

So the first job is to find out **which part of a working-by-design path is not
firing**, and on which surfaces. Do not rebuild the reveal.

## Reproduction — establish this first

The reporter saw the failure on two surfaces. Before changing anything, reproduce
each against the real app and record what actually happens (nothing at all? scrolls
but stays collapsed? expands but does not scroll? works in a column but not in
focus mode?). The fix differs completely between those, and the issue must not be
implemented against a guess.

1. Reader head 💬 popover → click a row. Path:
   `CommentsPopover` `onSelect` → `ReaderHead` `onSelectThread` →
   `Reader.tsx:196` / `FocusMode.tsx:171` `surface.jumpToThread`.
2. A thread card carrying a `.t-context` link to its parent document (the second
   screenshot). **Identify which surface this actually is** — the below-body
   thread list, a threads column row, or the comments list — because they do not
   share a click handler and the report may cover more than one.

Then **enumerate every surface that displays a comment** and record which of them
honour the gesture today. The two reported are unlikely to be the only two, and a
fix that lands on those alone leaves the same complaint waiting on a third.

## Acceptance Criteria

- [ ] Reproduction recorded per surface, with the observed failure named, before
      any fix
- [ ] Clicking a listed comment scrolls its anchor into view in the document,
      **expands the conversation**, and flashes it — all three, on every surface
      that lists comments
- [ ] An **unanchored** comment opens its thread and says why it has no anchor,
      per the 2026-08-04 rider — it must not silently do nothing
- [ ] An **orphaned** comment (quote preserved, anchor unresolvable) behaves as
      the unanchored case rather than scrolling to a wrong place
- [ ] A comment anchored inside a **clipped changelog** expands the clip to reach
      it, per the 2026-08-07 rider — "revealing that conversation expands the clip
      rather than quietly failing to reach it"
- [ ] A comment whose parent document is not the one on screen navigates to that
      document first, then reveals — pushing onto the reader's navigation stack
      like any other follow
- [ ] Expanding to reveal does **not** violate the collapse rider's precedence
      rule: the reveal places the conversation expanded, and a subsequent manual
      collapse still sticks
- [ ] Works in both the column reader and focus mode
- [ ] Keyboard-reachable, per §11's "adds no exclusive-pointer capability"

## Technical Design

### Files to Create/Modify

Determined by the reproduction. The likely surface area:

- `apps/ui/src/reader/useReaderSurface.ts` — `jumpToThread`, the reveal effect,
  the flash token
- `apps/ui/src/reader/reveal.ts` / `reveal.css` — the reveal machinery itself
- `apps/ui/src/reader/CommentsPopover.tsx` — the popover rows
- `apps/ui/src/thread/ThreadCard.tsx` / `ThreadPanel.tsx` — the card and its
  collapse state
- whichever component owns the second reported surface

### Key Implementation Details

`jumpToThread`'s doc comment explains that it is read through refs specifically
so its identity never changes, because *"an effect that tore itself down mid-retry
would leave a pending reveal instruction with nobody to honour it"*. That is a
strong hint about the failure mode: a reveal that is issued and then dropped. The
retry/settle logic (`REVEAL_RETRIES`, `REVEAL_SETTLE_FRAMES`, and the comment
about a cold open's layout still moving) is where a reveal into a
not-yet-laid-out document goes to die.

`useThreadCollapse` holds the expand/collapse state. Revealing must expand
through it rather than around it, or the card will re-collapse on the next render
and the user will see a flash of the right thing.

### Edge Cases

- The same quote appearing more than once in the body — `chooseOccurrence`
  already exists for this; confirm the reveal uses it rather than the first match
- A comment on a document long enough that the anchor is far off screen — the
  reveal parks the match a third down the viewport (`reveal.ts:57`); confirm that
  still holds after the fix
- Clicking the comment for a conversation that is **already** expanded and on
  screen — should still flash, not scroll away and back
- Clicking the `.t-context` link on a card is a **different** gesture (follow to
  the parent document) and must keep working as it does

## Testing Strategy

Vitest + Testing Library per surface: clicking a listed comment calls the reveal
with the right thread, the conversation ends expanded, and the flash is set;
unanchored and orphaned comments take their documented path instead; a
cross-document comment pushes the nav stack. A Playwright spec is warranted for
the scroll itself — the settle-frame retry is precisely the behaviour a unit test
with no layout cannot prove.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start the real app; open a document carrying at least one anchored comment,
   with the anchor below the fold
2. Click the 💬 chip in the reader head and select the comment
3. Expected: the document scrolls to the quoted passage, the conversation is
   open, and it flashes
4. Actual: _[agent records — this is the point of the step]_
5. Repeat for the thread card surface in the second screenshot

### Verification Steps

1. Restart the app; repeat both reproductions — confirm scroll, expansion and
   flash on each
2. Repeat in focus mode
3. Click a comment for a passage already on screen — confirm it flashes without
   a pointless scroll
4. Click an unanchored comment — confirm it opens and explains itself
5. Click a comment anchored inside a clipped changelog — confirm the clip expands
6. Click a comment belonging to another document — confirm navigation, reveal,
   and that Back returns with scroll position restored
7. Collapse the revealed conversation by hand, navigate away and back — confirm
   the manual collapse still sticks

## E2E Verification Log

_[Agent fills: model run on, per-surface reproduction, commands, observed output.]_

## Completion Checklist (domain agent)

- [ ] Per-surface reproduction logged **before** the fix
- [ ] Every comment-listing surface enumerated and covered
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[UI-095]` prefix
