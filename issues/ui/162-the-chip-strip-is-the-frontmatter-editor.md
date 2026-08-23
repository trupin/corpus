# [UI-162] The chip strip is the frontmatter editor

## Domain
ui

## Status
done

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

- [x] `.fm-form` — the `TAGS` / `STATUS` / `DUE` grid — is gone. No value in the
      reader is displayed in one place and edited in another.
- [x] A tag chip is a button. Clicking it opens a menu offering **Rename** and
      **Remove**. Rename edits the tag in place; Remove deletes it.
- [x] A `+` chip sits at the end of the tags and adds one, with the same
      autocomplete behaviour the tags input has today if it has any.
- [x] The status chip reads `status: <word>`, opens §5's three words, marks the
      current one, and writes on choice.
- [x] Where `statusLock` refuses a status change, the chip still shows the
      status and the menu says why instead of writing. The text is the reason
      `statusLock` already returns, not a new one invented here.
- [x] The stage chip reads `stage: <word>`, opens the words the claiming kanbans
      name, and is absent when the document is claimed by none and holds none —
      exactly today's rule, moved onto the chip.
- [x] A `due` chip opens a date picker and can clear the date. With no due date
      it reads as an unset chip rather than disappearing, so the field is
      reachable.
- [x] `updated` and the folder and type chips stay read-only. They are not
      frontmatter the reader sets.
- [x] The strip still ends with the `SaveChipView`, in its reserved box.
- [x] Keyboard: every chip is reachable by `Tab` and opens with `↵` or `Space`,
      and `esc` closes a menu without writing. §10 adds no pointer-only
      capability.
- [x] One write per change, through the existing `patch` / `send` path. The
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

## Adjudication — the stage chip, when the document holds a stage nobody claims

**PR #59 review, recorded so the resolution is a decision on file rather than
silent drift.**

The signed rider's two sentences conflict in one corner. It says the strip shows
"its type, its folder, its tags, its status, **its stage**, its dates", and it
also says the stage chip "is absent when none [of the claiming kanbans] do".

A document that **holds** a `stage` in its frontmatter while **no** kanban claims
it satisfies the first and fails the second.

`FrontmatterForm.tsx` resolves it in favour of showing held frontmatter: the chip
appears, reading the stage the document has, and offers no words to change it to.
The reviewer agreed this is the right reading and I am confirming it as the
decision.

**Why display wins.** The strip's whole purpose after this rider is to be the
document *as the corpus holds it*. A field that is on disk and not on the strip
is a value the surface hides, which is the failure the rider exists to end. The
"absent when none do" sentence is about a chip **offering a vocabulary** it does
not have — an empty picker — not about concealing a value the file carries.

## E2E Verification Log

### Post-Implementation Verification

Model: **Fable 5** (`claude-fable-5`), as the issue recommends.

No kit source was touched, but `npm run build -w packages/kit` was run before
any browser evidence anyway (UI-163, in the same session, edited a kit CSS
comment).

Command (real browser, real Vite dev server, Chromium):

```
CORPUS_UI_PORT=5373 ./node_modules/.bin/playwright test \
  --config apps/ui/playwright.config.ts \
  frontmatter-chips.spec.ts kanban.spec.ts unknown-type.spec.ts context-menu.spec.ts \
  --workers=1
→ 57 passed, then 7/7 on frontmatter-chips.spec.ts after one spec fix (below)
```

Concrete evidence, from the new `apps/ui/e2e/frontmatter-chips.spec.ts`:

- **`.fm-form` is gone**, in the column reader and in full screen alike:
  `.fm-form`, `.fm-field`, `.fm-input` all `toHaveCount(0)` with the strip
  visible on both surfaces.
- **Tag menu.** Clicking `#tax` opens the app's one menu frame
  (`[data-ctx-menu]`), whose box is measured **on screen** (x ≥ 0, bottom ≤
  viewport) — the placement is `clampToViewport` + `menuRoom`'s, not invented
  (the UI-159 lesson). Remove → exactly one
  `PUT {tags:["finance"]}`, the stub's store carries it, the chip is gone from
  the strip and `#finance` remains.
- **Rename in place.** Rename swaps the chip for a focused input prefilled
  `finance`; typing + `↵` lands **one** write; store reads
  `["finances","tax"]`.
- **`+` adds**, and after the add the last tag-family chip in the strip is the
  `+` again — it stays beside what it adds to.
- **Status chip** reads `status: open`, its menu marks `✓ open`, offers §5's
  third word gated (`archived` disabled, with the route-reason beneath), and
  choosing `resolved` writes once, at once; the chip then reads
  `status: resolved` from the echoed document.
- **Due chip** reads `due: —` when unset (present, reachable), swaps for a
  focused native date field, `2026-10-01` lands at once, and clearing the
  field writes `due: null` after the debounce. One Chromium finding logged in
  the spec: with the native picker up, Escape is consumed by the picker before
  the input's handler sees it, so the spec blurs to close — the chip itself
  never depended on Escape.
- **Keyboard alone**: Tab-focus the status chip, `↵` opens with the first item
  focused, `↓` + `↵` writes `resolved`; `esc` on an open tag menu closes it
  with **no** write (PUT count still 1) and focus returns to the chip.

Component evidence (`FrontmatterForm.test.tsx`, 59 tests; `frontmatterStage.test.tsx`,
7 tests — both green):

- the strip renders every editable value on a button chip and no combobox, no
  `.fm-form`, no Save/edit controls;
- locked status (archived doc): the menu shows `statusLock`'s own sentence
  ("archived — Unarchive in the ⋯ menu brings it back"), offers `open` and
  `resolved` disabled, marks `✓ archived`, and clicking `open` sends nothing;
- a rename onto an existing tag collapses to one (`{tags:["finance"]}`, never
  a duplicate); a rename to empty is the removal it is (`{tags:[]}`);
- stage menu groups words under the claiming board's title, `Clear the stage`
  writes `stage: null`, the coupled-status warning surfaces in the server's own
  words, and a stage no board draws is shown marked rather than unmarked;
- the write model is untouched: three fields changed together are **one**
  request carrying all three; two deliberate changes are two ordered writes,
  never two in flight; the in-flight queue, the refusal-drop
  (`body.status`-naming 400) and the unmount/pagehide flush all pass exactly
  as before.

**"File on disk" caveat**: this suite cannot reach a workspace server
(INFRA-028), so "the file carries the value" is asserted against
`stubCorpus`'s store — which required extending the stub first: it had **no
tags storage at all** (fixed `tags: []` on every read, `PUT` ignoring the
field), so any tag write's echo would have wiped the strip. `StoredDoc.tags`
is now seeded, stored, written through and echoed — the 2026-08-17 lesson
("check the route has a real handler before trusting a green run") applied
before writing the spec.

**Falsified**, per the testing strategy: mutated `isDeliberate` to answer
`true` for every change (every keystroke its own write). 9 tests went red,
including "carries three fields in one request when they change together" —
the test that would have passed with four requests if it asserted only "a
request was made" — and "sends nothing while it is being typed". Reverted;
59/59 green.

One test-infrastructure lesson worth keeping: a probe that opens and closes a
menu **inside `waitFor`** livelocks — every probe mutates the DOM, `waitFor`
re-runs on every mutation as a microtask, and its own timeout timer starves
(measured: one vitest worker pinned at ~90% CPU indefinitely).
`frontmatterStage.test.tsx`'s `whenBoardsOffer` is a plain polled loop with
`setTimeout` yields for exactly this reason, and says so.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier + tsc clean on every touched file;
      pre-existing tsc errors in `board/`, `explorer/`, `reflect/` belong to a
      parallel agent's in-flight work, none in files this issue touches)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
