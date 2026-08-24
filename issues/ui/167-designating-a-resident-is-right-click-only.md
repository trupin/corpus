# [UI-167] Designating a resident is reachable only by right-click

## Domain
ui

## Status
done

## Priority
P0 (critical path)

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md Section 7 — "Designation is user-only state on the thread, set and
  released like any other thread field"
- SPEC.md Section 10 — "UI — the board", the conversation's menu

## Summary

**Reported by the user, 2026-08-23**, in these words:

> There's no longer a way to attach a resident to a thread (at least not that I
> could find).

**The act still works. It has no visible affordance.** Traced on the branch:
`ThreadPanel` opens the menu carrying `residentActions`, and it is opened from
exactly two places — `CollapsedThread`'s `onContextMenu` and `ThreadCard`'s
`onCardContextMenu`. Both are right-click.

`ThreadCard` renders two visible buttons, `✓ resolve` and collapse. **There is no
⋯ on a thread card**, though the document reader's head has one and the
explorer's rows have one. So every other object in the product exposes its
actions to a left click, and a conversation does not.

The user is the person who signed §7's designation rider and could not find the
control. That is the whole finding.

## This has happened once before, to this exact feature

`residentActions.ts` records it in its own docblock: UI-122 found that "the
feature v0.10.0 is named for was unreachable from the UI" because the
designation sat behind a profile directory that was empty. That was fixed by
making the general designation the first item.

**The feature is now unreachable for a second, unrelated reason.** A capability
that has been undiscoverable twice for different reasons is one nobody is
checking the reachability of.

## Acceptance Criteria

- [x] A conversation exposes its actions to a **left click**, in the same idiom
      the rest of the product uses.
- [x] The right-click menu keeps working and offers **exactly the same items**.
      §10 binds the two together and `menuModel.ts` exists so they cannot
      diverge — do not add a second list.
- [x] The affordance is present wherever a designation is legal: a standalone
      thread in a reader (`host="standalone"`), and a thread on a board.
- [x] It is **absent or inert where a designation is not legal** — a thread with
      a parent may not have a resident at all (§7), and the menu already knows
      this through `hasParent`. Do not offer a control that opens onto nothing.
- [x] Keyboard-reachable, like every other affordance (§10 adds no
      exclusive-pointer capability).
- [x] A test asserts the control is present on a standalone thread and that its
      items equal the context menu's. A test that only opened the context menu
      would have passed throughout this defect.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/thread/ThreadCard.tsx` — the visible trigger
- `apps/ui/src/thread/ThreadPanel.tsx` — wiring, if `openMenu` needs a second
  caller
- `apps/ui/src/thread/CollapsedThread` — the collapsed line, same question
- the tests beside each

### Key Implementation Details

**Reuse `openMenu`.** `ThreadPanel` already builds the item list once and hands
it to the context menu. The new trigger calls the same function with the
button's own box as the anchor. A second list is the drift `menuModel.ts` exists
to prevent.

**Anchor from measured room.** The chip menus in UI-162 and the explorer's row
menus both derive placement from `menuRoom` and `clampToViewport`. A trigger on
a thread card sits inside a scrolling reader, sometimes in a 300px margin card —
placement by preference will put the menu off screen, which is UI-159's lesson
and cost a blocking review finding one release ago.

**Do not widen this into the card's whole action set.** The card's two visible
buttons stay. This adds the way into the menu, not a rearrangement of what a
card shows.

### Edge Cases
- The collapsed line, which is one row and has less room for a control.
- A margin-placed card at 300px.
- A thread on a document, where the designation items are absent — the trigger
  still has resolve, open and the rest to offer, so it should not vanish.
- Two panels for one conversation on one screen, which `DocView` guards against.

## Testing Strategy

Component tests over `ThreadPanel` in `host="standalone"`: the trigger exists,
clicking it opens the menu, and the item ids equal those the context menu opens
with. Then the parent case, asserting the designation items are absent from
both.

**Falsify**: remove the trigger and watch the presence test fail. Then make the
trigger build its own item list and watch the equality test fail — that second
one is what stops the two menus drifting.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Open a standalone thread in a reader
2. Look for any way to designate a resident without right-clicking
3. Expected: a visible control, as every other object in the product has
4. Actual: nothing — the only route is a right-click on the card

### Verification Steps
1. Repeat, and designate a resident using the left mouse button only
2. Repeat using the keyboard only
3. Right-click the same card and confirm the two menus offer the same items

## E2E Verification Log

### Reproduction (bugs only)
Traced on the branch 2026-08-23 by the orchestrator: `ThreadPanel`'s `openMenu`
has exactly two callers, `CollapsedThread`'s `onContextMenu` and `ThreadCard`'s
`onCardContextMenu`. `ThreadCard`'s only `<button>` elements are `t-resolve` and
`t-collapse`. No menu trigger exists.

### Post-Implementation Verification

**Model: Opus 5 (1M context).** Verified 2026-08-23 on `phase-44-reach-and-size`.

#### What changed

- `ThreadPanel.openMenu` now takes `(clientX, clientY, autoFocus)` instead of a
  `MouseEvent`. It still builds the item list **once**. Two thin wrappers sit
  over it: `onContextMenu` (the pointer's coordinates, `autoFocus: false`) and
  `onTriggerMenu` (the button's `getBoundingClientRect()`, `autoFocus: true`).
- `ThreadMenuTrigger.tsx` — the `⋯` itself, one component drawn at two sites so
  the card's head and the collapsed line cannot announce the same conversation
  differently. `panelMenuLabel.ts` was split out of `ThreadPanel` so the trigger
  can read the name without importing the panel that renders it.
- `ThreadCard` takes `onContextMenu` (renamed from `onCardContextMenu`),
  `onOpenMenu` and `menuLabel`, and draws the `⋯` between `✓ resolve` and the
  fold — `ColumnHead`'s own order. **Both existing buttons are untouched.**
- `Reader.css`: `.t-menu` joins `.t-collapse`'s box, hover and focus rules by
  selector rather than by a copy, so the two glyphs in one head cannot drift.
  `FocusMode.css`'s margin-mode hide rule was widened to the sibling trigger,
  which the old `.t-chip`-only selector would have left drawing alone in the
  body.

#### Anchoring is measured, not preferred

Placement is the host's, unchanged: `ContextMenuProvider.open` runs
`clampToViewport`, and `ContextMenu` then re-derives the vertical half from the
menu's real height with `menuRoom`. The trigger contributes only its box. Real
browser, `⋯`-opened menu, at three viewports:

| viewport | menu box | right edge | bottom edge |
| --- | --- | --- | --- |
| 1280×720 | x 721, y 363, 397.3×353 | 1118.3 ≤ 1280 | 716 ≤ 720 |
| 1024×640 | x 671, y 267, 353×369 | 1024 ≤ 1024 | 636 ≤ 640 |
| 1728×1080 | x 721, y 391.1, 397.3×402.5 | 1118.3 ≤ 1728 | 793.6 ≤ 1080 |

Nothing leaves the viewport on any axis.

#### The `⋯` costs the card no height

Measured in a real browser on a 410px card at 1280×720, `.t-head`'s height with
elements hidden one at a time:

| what is drawn | height |
| --- | --- |
| everything | 79px |
| the resident badge's weight clause hidden | 50.8px |
| that **and** the `⋯` hidden | 50.8px |

The `⋯` adds **0px**: the 26×26 target and the `margin: -4px 0` it shares with
the fold do exactly what that rule was written for, so a 26px hit area does not
add 8px to every card's head. (The 28px between the first two rows is UI-168's
badge clause, and is dealt with there.)

#### Real-browser walk (Playwright, `e2e/resident.spec.ts`, Chromium, 18/18)

1. **Pointer only.** Opened `th_solo` in a reader. `[data-thread-menu]` is
   visible, `aria-haspopup="menu"`,
   `aria-label="Actions for this standalone thread"`. Left-clicked it, clicked
   *Designate a resident* → `POST /api/threads/th_solo/resident` with body `{}`,
   and the badge repainted `data-resident-kind="general"`. No right-click was
   used at any point.
2. **Keyboard only.** Focused the `⋯`, pressed `↵` → the menu opened with
   `[data-act="collapse"]` focused; `↓ ↓ ↵` landed on
   `resident-designate-general` and designated. Menu hidden, badge visible.
3. **The two menus agree.** Opened by right-click and by the `⋯` on the same
   card, and compared the full `[data-act]` list in order. Equal, and containing
   `resident-designate-doc_researcher`.
4. **Collapsed line.** Folded the conversation from the menu; the `⋯` is still
   there and `node.closest("[data-thread-expand]") === null` — a sibling, not a
   button inside a button. Clicking it opened the menu offering *Expand*.
5. **A thread with a parent.** The trigger is present and the menu opens onto
   `["collapse", "resolve"]` in **both** presentations — no `resident-*` item in
   either. It never opens onto nothing, because a conversation always has those
   two.

Screenshots taken from the running app: the card head reads
`✓ resolve  ⋯  –`, and the collapsed line reads `💬 1 turn · user · standalone  ⋯`.

#### Falsifications (both required by the issue)

- **Remove the trigger** (`ThreadCard`'s `<ThreadMenuTrigger …/>` → `{null}`):
  5 of the new tests fail, the presence test first. Restored, green again.
- **Give the trigger its own item list** (a second `menu.open` in
  `onTriggerMenu` with a hand-built `actions` array): 3 fail, led by *"opens the
  same items the right-click opens"*. That is the drift `menuModel.ts` exists to
  prevent, and it is now asserted rather than assumed. Restored, green again.

#### Commands, with their real output

```
npm run build                                          # clean
eslint apps/ui packages/kit                            # clean
prettier --check .                                     # clean for apps/ui + packages/kit
npm run typecheck -w apps/ui -w packages/kit \
                  -w packages/contract                 # clean
VITEST_MAX_THREADS=4 vitest run apps/ui packages/kit   # 242 files, 4681 passed
playwright … e2e/address-geometry.spec.ts --workers=1  # 24 passed (46.0s)
playwright … 13 specs --workers=1                      # 137 passed (3.6m), EXIT=0
```

The 13 e2e specs are the ones that touch a thread card's head, the resident
badge, a menu, or composer geometry: `resident`, `residents-tab`,
`resident-weight-geometry`, `recipient`, `weight`, `collapse`, `thread`,
`context-menu`, `menu-room-geometry`, `comments-tab`, `digit-geometry`,
`turn-comment`, `anchor-layer`.

**The whole 617-test suite was started three times and finished none of them**:
this laptop is shared with other agents and one worker was managing about ten
tests per five minutes, which projects past four hours. Scoped runs are what this
agent is told to do; the single repo-wide run is the orchestrator's at harvest.
`apps/server` and `apps/cli` are red on typecheck for a reason that is not this
work — see the `designationId` note in UI-168.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
