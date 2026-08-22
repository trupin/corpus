# [UI-095] Clicking a comment does not take you to it, opened

## Domain

ui

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —

## Spec References

- SPEC.md §10 — "Selecting an anchored row reveals it at its anchor in the
  document; an unanchored row opens its thread and says why it has no anchor"
  _(rider signed 2026-08-04)_
- SPEC.md §10 — "Clicking an anchored highlight opens its thread"
- SPEC.md §10 — the collapse rider _(signed 2026-08-05)_: "**Every collapse
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

- [x] Reproduction recorded per surface, with the observed failure named, before
      any fix
- [~] Clicking a listed comment scrolls its anchor into view in the document,
      **expands the conversation**, and flashes it — all three, on every surface
      that lists comments. **Column reader: yes, all three.** Focus mode: expands
      and flashes; the scroll does not land — `useAnchorLayer`, escalated (log
      point 2). The 💬 popover was already correct on both
- [x] An **unanchored** comment opens its thread and says why it has no anchor,
      per the 2026-08-04 rider — it must not silently do nothing
- [x] An **orphaned** comment (quote preserved, anchor unresolvable) behaves as
      the unanchored case rather than scrolling to a wrong place — by
      construction: the reveal names the **thread**, never a range, so there is
      no place to scroll wrongly to; `jumpToThread` expands the card and the
      card carries the orphan's own notice. Not separately driven in the browser
- [~] A comment anchored inside a **clipped changelog** expands the clip to reach
      it, per the 2026-08-07 rider — "revealing that conversation expands the clip
      rather than quietly failing to reach it". The path now reaches
      `expandClipAround` (UI-089) the same way the 💬 popover does, because both
      go through `flashThread`; **not exercised on a changelog fixture**, and it
      shares the arrival race in log point 2
- [x] A comment whose parent document is not the one on screen navigates to that
      document first, then reveals — pushing onto the reader's navigation stack
      like any other follow. This **is** the fix; pinned by `Reader.test.tsx`
- [x] Expanding to reveal does **not** violate the collapse rider's precedence
      rule: the reveal places the conversation expanded, and a subsequent manual
      collapse still sticks — verified through a reload
- [~] Works in both the column reader and focus mode — column reader fully;
      focus mode expands and flashes but does not scroll (log point 2)
- [x] Keyboard-reachable, per §10's "adds no exclusive-pointer capability" — a
      real `<button>`, focusable, activated by Space. `Enter` does not activate
      **any** button in the app, including ones this change never touches; filed
      as log point 3

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

**Model run on:** Opus 5 (1M context). **Implemented by the plugins-dev agent**,
which was handed this issue alongside PLUGINS-015 with instructions to do it if
it turned out small and self-contained and to escalate otherwise. **It is
partly both** — see "What is left" at the end, which is the escalation.

### Setup

Real app, no stub. Scratch workspace `/tmp/p015ws` (`corpus init --port 8793`),
server via `tsx apps/cli/src/bin/corpus.ts server start`, UI from source on
**5373**. 8765 and 5173 were never bound. Fixture: a 40-paragraph `note`
(scrollHeight 7208 at 1500×950) carrying three real threads created through
`POST /api/threads` — one anchored near the top, one anchored near the bottom,
one whole-document.

### Per-surface reproduction — which surfaces honour the gesture today

The issue asks for the enumeration first. Every surface that *lists* a comment,
and what it did before any change:

| surface | gesture | before |
| --- | --- | --- |
| reader head **💬 popover**, column reader | click a row | **works** — `scrollTop 0 → 5522`, highlight at viewport y≈517, conversation expanded, `.thread-card.flash` present within the 1.2 s window |
| reader head **💬 popover**, focus mode | click a row | **works** — `scrollTop 0 → 4976`, highlight at y=489 of 950, expanded, flashed |
| **thread card's `.t-context` link** ("on «Parent» · at «quote»") | click the parent title | **BROKEN** — see below |
| a **threads column** row / a search hit | click | opens the *thread document*, which is what a list of documents should do; the way from there to the passage is the context link above, so it is the same defect one step removed |
| below-body thread list, margin cards | — | these **are** the conversations, rendered in place; there is nothing to navigate to |
| backlinks, Related | — | list documents, not comments |
| the §10 **comments list** (Document/Comments switch) | — | **does not exist yet** — UI-063 is `todo`, pending SPEC sign-off. The 2026-08-04 rider's "selecting an anchored row" has no surface to be true or false on today |

**The broken one, measured.** Same thread, same document, same browser, two
routes to it:

```
via the .t-context link:   scrollTop 0     highlight at viewport y = 6014   flash: none
via the 💬 popover:        scrollTop 5522  highlight at viewport y =  517   flash: yes
```

So the link that says *at "The distant passage…"* opened the parent at the top
and left the passage 5,100 px below the fold, with the conversation neither
expanded nor flashed.

### The cause — a parameter every caller dropped

`ThreadCard`'s context link has always asked for the right thing:

```ts
onClick={() => { onOpenDoc(parentId, anchorId); }}
```

and `ThreadContext`'s own docblock claims it "links back to the parent **at the
anchor position**". But every wiring of `onOpenDoc` takes one parameter —
`DocView`'s `onNavigate: (docId: string) => void`, `Reader`/`FocusMode`'s
`navigate = (next) => stack.push(next, surface.currentScroll())` — and TypeScript
happily accepts a narrower function, so the second argument was **silently
discarded at every call site in the app**. Nothing consumed it; nothing ever had.

`ThreadCard.test.tsx` pinned the wrong half of it: `expect(open)
.toHaveBeenCalledWith("doc_m", "a_1")` passed for years under the name *"links
back at the anchor"*, asserting an argument that went nowhere.

Nothing here is a reveal-machinery defect: `stack.push` has taken a
`RevealTarget` since UI-037, `useReaderSurface` honours `{kind: "thread"}` by
delegating to `jumpToThread`, and both were already tested. The instruction
simply never reached them from this surface.

### The fix

`onOpenDoc` / `onNavigate` carry a `RevealTarget` instead of an anchor id, and
the context link passes `{ kind: "thread", threadId }` — the currency
`useReaderSurface` actually honours, and the one that also works for a thread
with **no** anchor (it expands the card, which is where "· whole document" is
written). Five files, all type-plumbing plus one changed call:
`ThreadCard.tsx`, `ThreadPanel.tsx`, `AnchoredThreads.tsx` (prop type only),
`DocView.tsx`, `Reader.tsx`, `FocusMode.tsx`.

### Post-fix verification — real browser, real server, no stub

| step | observed |
| --- | --- |
| follow the context link | `scrollTop 0 → 5450`; highlight at y=**564** of 950; `.thread-slot.expanded`; `.thread-card…flash` present at 500 ms and gone by 2 s |
| Back, then follow again, twice | `5497`, `5497` — repeatable, and Back restored the thread document |
| the reveal is one-shot | Back onto the entry restores scroll and re-flashes nothing |
| manual collapse after the reveal | collapsing the revealed card and **reloading** leaves it collapsed — the collapse rider's precedence holds |
| an **unanchored** comment's link | context reads `on A long note with comments · whole document`; the card expands and flashes, and reads `whole-document thread`, which is the rider's "says why it has no anchor" |
| a comment **already on screen** | flashes (1 flash node) with `scrollTop 189 → 189` — no pointless scroll |
| keyboard | the link is a real `<button>`, focusable, and **Space** activates it: `readers: ["doc_cgyfaglv"]`, `scrollTop 5450`. See the Enter note below |
| focus mode | the document changes, the card becomes `host-margin` and **flashes** — but the scroll does not land. See below |

### Tests

- `apps/ui/src/thread/ThreadCard.test.tsx` — the mis-pinned test rewritten to
  assert the reveal, plus a new one for the unanchored case.
- `apps/ui/src/reader/Reader.test.tsx` — "follows a thread's context link to the
  conversation, not to the top": the whole path in one act, asserting the pushed
  nav entry carries the reveal **and** that the arriving reader has the
  conversation expanded and flashing.
- **All three were confirmed to bite**, by breaking the fix and watching them go
  red: reverting `ThreadCard`'s call to `onOpenDoc(parentId)` fails all three;
  reverting only `Reader`'s `navigate` (dropping the reveal on the way to
  `stack.push`) fails the Reader one, so both halves of the wiring are pinned
  independently.
- `apps/ui` + `plugins` suites: **pass**. `packages/kit` has 11 failures on this
  working tree that are **not this change** — multipart/upload tests and a
  README-vs-contract `agents` check, from other agents' in-flight work; the same
  work leaves `apps/ui`'s `resident` typecheck errors in the e2e stubs.
- `eslint` and `prettier --check` clean on every touched file.

## What is left — escalation, with measurements

Two things this fix does **not** close. Both were measured; neither is caused by
the change, and the change is strictly better than the previous behaviour in
every case (before, none of scroll/expand/flash happened; now at worst the
scroll falls short).

**1. The thread reveal has no settle-and-retry ladder, and lands short on a cold
arrival.** The *item* reveal has `REVEAL_RETRIES` / `REVEAL_SETTLE_FRAMES` for
exactly this; the thread branch of `useReaderSurface`'s effect calls
`jumpToThread` once and reports itself honoured immediately. On a **navigation**
the document is still laying out, and the smooth scroll is aimed at a position
the layout then moves:

```
unanchored comment, via the context link (a navigation):
  400ms scrollTop 3511  cardTop 3327     ← card's document position 6838
  800ms scrollTop 5326  cardTop 1512
 1500ms scrollTop 5632  cardTop 1206     ← stops ~700px short, card below the fold
the same comment, via the 💬 popover (no navigation):
        scrollTop 6431  cardTop  407     ← lands
```

~700 px is the height of the two anchored cards that start in the below-body
list and are lifted into the margin once the anchor layer places them — the
content above the target shrinks after the scroll was aimed.

**2. In focus mode the scroll does not happen at all, and the reason is in
`apps/ui/src/anchors/useAnchorLayer.ts`.** Measured, scoped to `.focus.open`:

```
focus + 💬 popover (shipped):   scrollTop 0 → 4976,  highlight y=489 of 950   ✓
focus + context link (this fix): scrollTop 0 → 0,     highlight y=5465        ✗ (expanded + flashed)
```

The diagnosis: the highlight's scroll is `useAnchorLayer`'s effect on
`[flashThread]`, which does `querySelector('.anchor-hl[data-thread=…]')` and
**returns silently when the decoration is not there yet** — which is the case on
arrival, before the anchor layer has decorated. It never re-runs, because
`flashThread` does not change again. In the *column* reader the margin is not
used and `ThreadCard`'s own `scrollIntoView` (host-slot, inside the scroller)
covers for it; in focus mode the card is `host-margin` and cannot move
`.focus-scroll`, so nothing scrolls. This also means the 💬 popover would fail
the same way if it were ever fired before the decorations existed.

Both fixes belong in `useReaderSurface.ts` / `reveal.ts` / `useAnchorLayer.ts` —
the reader's settle logic, which is what this issue's own Technical Design named
as the hard part ("the retry/settle logic … is where a reveal into a
not-yet-laid-out document goes to die"). **`apps/ui/src/anchors/` was off limits
to this agent for this session** (another agent is working in it), so this is
reported rather than collided with.

**3. Not this issue, but found while verifying it: `Enter` does not activate
buttons.** Pressing `Enter` on the focused `.t-context .ref` fires `keydown` with
`defaultPrevented=false` at the button and **no `click`**; `Space` works. The
same is true of the reader head's `💬 .comments-btn`, which this change never
touches — so it is app-wide, not a property of this link, and a candidate for its
own issue. §10's "adds no exclusive-pointer capability" is still satisfied
(the control is focusable and Space activates it), but half the keyboard
convention for a button is missing.

**4. No Playwright spec was added.** The issue asks for one and it is warranted —
the settle-frame retry is precisely what a jsdom test cannot prove. It was not
added because `apps/ui/e2e/stubCorpus.ts` currently does not typecheck on this
working tree (another agent's `resident` contract change is mid-flight), so a new
spec would have been written against a harness about to move. The behaviour is
covered by the two unit tests above plus the real-browser run recorded here;
the spec should land with, or after, the settle work in point 1.

## Completion Checklist (domain agent)

- [x] Per-surface reproduction logged **before** the fix
- [x] Every comment-listing surface enumerated and covered
- [x] Tests written and passing (no Playwright spec — log point 4)
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [~] Acceptance criteria verified — three marked `[~]`, all one escalation

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[UI-095]` prefix
