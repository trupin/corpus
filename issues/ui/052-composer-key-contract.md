# [UI-052] One composer key contract: ↵ newline, ⌘↵ send, ⇧⌘↵ secondary

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-009 (Amendment 1)
- Blocks: —
- Coordinate with: PLUGINS-011 (todos item composer), UI-051 (turn-selection
  composer), UI-053 (autocomplete claims `↵` while its menu is open)

## Spec References
- SPEC.md §11 Global composer, as replaced by SHARED-009 Amendment 1

## Summary
Live report 2026-08-03: _"I don't want the 'enter' key to send comments. Let's
make that 'shift + enter' and 'enter' should be a breakline instead"_ — and on
sign-off: _"Every composer, but let's use cmd+enter for send/ask as well, as well
as for comment composers. I want consistency."_

So the contract is: **`↵` inserts a newline and never submits. `⌘↵` is the
primary action. `⇧⌘↵` is the secondary action where one exists.**

Current state, surveyed — five composers, four conventions:

| Surface | Element | Today |
| --- | --- | --- |
| `ThreadComposer` | `<input>` | `↵` sends. Single-line, so it cannot newline at all |
| `CommentPopover` | `<textarea>` | `↵` sends, `⇧↵` newline, IME-guarded, `esc` closes |
| `NewChildThread` | `<input>` | `↵` sends, `esc` cancels — **no `shiftKey` and no `isComposing` guard, so an IME commit sends the comment** |
| `TodoItemComposer` | `<textarea>` | `↵` sends, `⇧↵` newline, IME-guarded (PLUGINS-011) |
| `ComposeOverlay` | `<textarea>` | `↵` Ask, `⌘↵` Capture, `⇧↵` newline — matches the old spec exactly |

Two consequences beyond re-binding: `ThreadComposer` and `NewChildThread` are
`<input>` elements and **cannot hold a newline** — they need to become
multi-line surfaces for `↵` to mean anything. And Capture moves off `⌘↵` to
`⇧⌘↵` (orchestrator-derived, recorded in SHARED-009 for the user to overturn).

## Acceptance Criteria
- [ ] Every composer in `apps/ui`: `↵` inserts a newline, never submits
- [ ] `⌘↵` submits the primary action everywhere (send / comment / Ask)
- [ ] `⇧⌘↵` submits Capture in the global composer; no other composer invents a
      secondary action
- [ ] `ThreadComposer` and `NewChildThread` become multi-line and grow with
      content (a one-line box whose `↵` does nothing would be a worse bug than
      the one being fixed)
- [ ] Every submit control names its key (`Send ⌘↵`, `Comment ⌘↵`, `Ask ⌘↵`,
      `Capture ⇧⌘↵`), and `COMPOSE_HINT` is updated
- [ ] An IME composition commit never submits, in **every** composer — this is
      the live `NewChildThread` defect, and it gets a regression test
- [ ] `esc` behavior per composer is unchanged
- [ ] While an autocomplete menu is open it still claims `↵` (UI-053) — accepting
      a completion must not insert a newline, and dismissing must restore `↵` to
      meaning newline
- [ ] Existing tests that pin `↵`-sends are updated, not deleted — each becomes
      the assertion for the new key plus one that `↵` now inserts a newline
- [ ] `apps/ui/e2e/compose-keyboard.spec.ts` updated for the new global bindings

## Technical Design
### Files to Create/Modify
- `apps/ui/src/thread/ThreadComposer.tsx` (+ multi-line), `NewChildThread.tsx`
  (+ multi-line, + IME guard), `apps/ui/src/anchors/CommentPopover.tsx`,
  `apps/ui/src/compose/ComposeOverlay.tsx` (`COMPOSE_HINT`, `ASK_LABEL`,
  `CAPTURE_LABEL`), and their tests
- `apps/ui/e2e/compose-keyboard.spec.ts`

### Notes
- Consider extracting the key handling once (a small hook or helper) so the
  contract has one spelling rather than five — five copies is exactly how the app
  ended up with four conventions.
- The column query editor's `↵` **commits the query**; it is not a composer and
  is out of scope here. Say so in the code rather than leaving it ambiguous.

## Testing Strategy
Component tests per composer for `↵`, `⌘↵`, `⇧⌘↵`, IME commit, and the autocomplete
interaction. E2E for the global composer and one comment composer end to end.

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
