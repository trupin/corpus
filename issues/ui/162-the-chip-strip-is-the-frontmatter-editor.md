# [UI-162] The chip strip is the frontmatter editor

## Domain
ui

## Status
todo

## Priority
P0 (critical path)

## Model
fable

## Dependencies
- Depends on: SHARED-068
- Blocks: —

## Spec References
- SPEC.md Section 10 — "UI — the board", Document view (frontmatter rider,
  SHARED-068)
- SPEC.md Section 5 — the status ladder, "one vocabulary, every type"

## Summary

Delete the labelled form below the title and make the chip strip above it the
editor. Tags, status, stage and dates are each edited on the chip that shows
them. The user asked for this with a mockup; SHARED-068 carries the rider.

## Acceptance Criteria

- [ ] `.fm-form` — the `TAGS` / `STATUS` / `DUE` grid — is gone. No value in the
      reader is displayed in one place and edited in another.
- [ ] A tag chip is a button. Clicking it opens a menu offering **Rename** and
      **Remove**. Rename edits the tag in place; Remove deletes it.
- [ ] A `+` chip sits at the end of the tags and adds one, with the same
      autocomplete behaviour the tags input has today if it has any.
- [ ] The status chip reads `status: <word>`, opens §5's three words, marks the
      current one, and writes on choice.
- [ ] Where `statusLock` refuses a status change, the chip still shows the
      status and the menu says why instead of writing. The text is the reason
      `statusLock` already returns, not a new one invented here.
- [ ] The stage chip reads `stage: <word>`, opens the words the claiming kanbans
      name, and is absent when the document is claimed by none and holds none —
      exactly today's rule, moved onto the chip.
- [ ] A `due` chip opens a date picker and can clear the date. With no due date
      it reads as an unset chip rather than disappearing, so the field is
      reachable.
- [ ] `updated` and the folder and type chips stay read-only. They are not
      frontmatter the reader sets.
- [ ] The strip still ends with the `SaveChipView`, in its reserved box.
- [ ] Keyboard: every chip is reachable by `Tab` and opens with `↵` or `Space`,
      and `esc` closes a menu without writing. §10 adds no pointer-only
      capability.
- [ ] One write per change, through the existing `patch` / `send` path. The
      debounce, the local patch map and the single in-flight request are
      untouched — this issue changes the controls, not the write model.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/reader/FrontmatterForm.tsx` — the strip becomes the controls; the
  `.fm-form` block and its `field()` helper go
- `apps/ui/src/reader/Reader.css` — `.fm-chips` gains the button/menu treatment;
  the `.fm-form`, `.fm-field`, `.fm-input`, `.fm-hint` rules go
- `apps/ui/src/reader/FrontmatterForm.test.tsx` — rewritten against the chips
- `packages/kit` — if a chip menu is worth sharing with the board's chips, it
  belongs there; if it is only ever this strip's, it stays in `apps/ui`

### Key Implementation Details

**Reuse the menu that exists.** The explorer's row menus and the ⋯ document menu
already have a popover with anchoring, an escape stack and a room derivation
(`apps/ui/src/menu/menuModel.ts`, `useEscapeStack`). A chip menu that invents its
own placement will rediscover UI-159 — a box placed by preference rather than
derived from measured room ends up off screen. Anchor to the chip, derive the
room, and let the existing model decide.

**The title stays.** It is above the body as a `textarea` with `title-grow`, and
UI-065's wrapping mechanism is load-bearing. Nothing in this issue touches it.

**The strip wraps.** SHARED-068's rider says one strip, not one visual line. Keep
`flex-wrap: wrap`. A single non-wrapping row either overflows the reader or
squeezes its chips, and SHARED-061 forbids the second.

**Do not add a second write path.** Every chip calls the same `patch(field,
value)` the form's inputs call today. The one thing that changes is
`isDeliberate`: a menu choice is a deliberate change and should send at once,
where typing in a tag rename should debounce like the text field it replaces.
Read `isDeliberate` before touching it rather than adding a branch beside it.

### Edge Cases
- A tag renamed to a name that already exists on the document: collapse to one,
  do not write a duplicate.
- A tag renamed to empty: that is Remove, and should do that rather than writing
  an empty tag.
- A document with many tags: the strip wraps, the `+` stays at the end of the
  tags rather than at the end of the strip, so it does not drift away from what
  it adds to.
- An archived document: the archived banner is unchanged and the status chip
  reads `archived`, with `open` and `resolved` both offered — unarchiving from
  §5's ladder returns a document to `resolved`, and the menu must not silently
  write `open`.
- A save on the wire: the strip's values and the chip menus' marks come from the
  same `valueOf(doc, local)` the form uses today, so an optimistic value shows
  while `saving…` is on the chip.

## Testing Strategy

Component tests over the real `FrontmatterForm`: open a tag chip's menu and
remove the tag, assert the single `PUT` body; rename a tag and assert the
debounce; choose a status and assert it sends at once; open the status menu on a
locked document and assert no request is made and the reason is shown; clear a
due date.

**Falsify.** For the "one write per change" claim, make two changes inside the
debounce window and assert one request carrying both — a test that asserts only
"a request was made" would pass with four.

## E2E Verification Plan

### Reproduction Steps (bugs only)
Not a bug. The current surface is what the screenshot shows: a chip strip
followed by a labelled form repeating the same values.

### Verification Steps
1. `npm run build -w packages/kit` before looking at a browser — kit `src`
   changes are invisible until it is rebuilt
2. Open a note in a column and in full screen
3. Add a tag with `+`, rename one, remove one; change the status; change the
   stage on a kanban'd document; set and clear a due date
4. Confirm each is one commit's worth of write, that the file on disk carries the
   value, and that no labelled form remains on either surface
5. Do the whole of step 3 with the keyboard alone

## E2E Verification Log

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
