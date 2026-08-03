# [UI-052] One composer key contract: ↵ newline, ⌘↵ send, ⇧⌘↵ secondary

## Domain
ui

## Status
done

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
- [x] Every composer in `apps/ui`: `↵` inserts a newline, never submits
- [x] `⌘↵` submits the primary action everywhere (send / comment / Ask)
- [x] `⇧⌘↵` submits Capture in the global composer; no other composer invents a
      secondary action
- [x] `ThreadComposer` and `NewChildThread` become multi-line and grow with
      content (a one-line box whose `↵` does nothing would be a worse bug than
      the one being fixed)
- [x] Every submit control names its key (`Send ⌘↵`, `Comment ⌘↵`, `Ask ⌘↵`,
      `Capture ⇧⌘↵`), and `COMPOSE_HINT` is updated
- [x] An IME composition commit never submits, in **every** composer — this is
      the live `NewChildThread` defect, and it gets a regression test
- [x] `esc` behavior per composer is unchanged
- [x] While an autocomplete menu is open it still claims `↵` (UI-053) — accepting
      a completion must not insert a newline, and dismissing must restore `↵` to
      meaning newline
- [x] Existing tests that pin `↵`-sends are updated, not deleted — each becomes
      the assertion for the new key plus one that `↵` now inserts a newline
- [x] `apps/ui/e2e/compose-keyboard.spec.ts` updated for the new global bindings

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

**Model: Opus 5 (1M context).** Implemented 2026-08-03 by ui-dev.

### 1. Pre-fix reproduction — the `NewChildThread` IME defect

Written as a regression test first (`apps/ui/src/thread/NewChildThread.test.tsx`,
which did not exist), run against the **unmodified** component:

```
× commenting on a turn > never comments on an IME composition commit
  → expected [ { method: 'POST', …(3) }, …(1) ] to deeply equal []
× commenting on a turn > takes a newline on ↵ instead of commenting
  → expected false to be true            (the `<input>` prevented the key)
× commenting on a turn > grows with the comment being written
  → expected undefined to be 'one\ntwo'  (no growing surface at all)
× commenting on a turn > names its key on the button
  → expected 'Comment ↵' to be 'Comment ⌘↵'
Tests  4 failed | 2 passed (6)
```

Two `POST /api/threads` calls from two IME composition commits — the comment was
posted mid-word, exactly as surveyed. After the fix: `6 passed`.

Note the first attempt at that assertion was a **false green**: asserting "no
POST" immediately after `fireEvent` passes even against the broken code, because
the mutation reaches the transport through a microtask chain. Every "and nothing
was submitted" assertion in the touched suites now awaits a macrotask first
(`settle()`), which is what turned the reproduction red.

### 2. Real app, real server, real browser

`corpus init /tmp/ui052-ws --port 8791` → `corpus server start` (pid 8220) →
Vite on **5983** with `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8791` and the
workspace's own `VITE_CORPUS_TOKEN`. Ports 8765 and 5173 untouched. A real note,
a real anchored thread, driven through Chromium. Console strip read
`agent: idle · queue 0 · index: current`, i.e. a live workspace, not a mock.

```
[1] global composer (ComposeOverlay)
  hint: @ agents · / skills · [[ refs · ↵ newline
  ask: Ask ⌘↵   capture: Capture ⇧⌘↵
  ok — ↵ inserted a newline; the composer stayed open (nothing submitted)
  ok — ⌘↵ asked: threads 1 → 2 (verified over the API, not the DOM)
  ok — ⇧⌘↵ captured a document into inbox/

[2] thread reply composer (ThreadComposer)
  ok — the reply field is a TEXTAREA, not an input;  button reads `Reply ⌘↵`
  ok — ↵ inserted two newlines
  ok — the box grew with the text: 20.25px → 60.75px
  ok — ⌘↵ sent the reply: turns 1 → 2
  ok — the box shrank back after sending: 20.25px ≈ 20.25px
  ok — the newlines reached the file:
       "reply line one\nreply line two\nreply line three"

[3] turn comment composer (NewChildThread)
  ok — the field is a TEXTAREA, not an input;  button reads `Comment ⌘↵`
  ok — ↵ inserted a newline and submitted nothing
  ok — the box grew: 20.25px → 40.5px
  ok — ⌘↵ created the child thread th_sqoiocmi

[4] esc, and the autocomplete's claim on ↵
  ok — esc cancelled the turn-comment box and left the reader open
  ok — `@` opened the menu; ↵ accepted "@agent " and inserted NO newline
  ok — the menu closed on accept; the next ↵ was a newline again
  ok — esc dismissed the menu; ↵ was a newline again, not a send
```

Screenshot reviewed: the reply box is still the mockup's borderless one-line
field when empty, and the grown child composer sits inside the card without
pushing the foot out.

### 3. Suites

- `vitest apps/ui/src` — **120 files, 1915 tests, all passing**
- `vitest packages/kit/src` — **38 files, 583 tests, all passing** (15 new for the contract)
- Playwright `e2e/compose-keyboard.spec.ts` + `e2e/thread.spec.ts` on
  `CORPUS_UI_PORT=5983` — **31 passed, 0 failed**
- `eslint --max-warnings 0`, `prettier --check`, `tsc --noEmit` (apps/ui, packages/kit) — clean

Scratch server stopped, workspace removed, 5983 and 8791 confirmed free.

### 4. Surfaced, not fixed

With `↵` now a newline everywhere, multi-line turn bodies are common — and
`MarkdownView` renders GFM soft breaks, so `a\nb` in a turn displays as `a b`
(visible in the screenshot). Pre-existing renderer behaviour, newly reachable;
not this issue's scope, and it lives in `packages/kit/src/markdown/`, which
UI-049 is editing. Worth an issue.

`design/index.html` still shows `Reply ↵` / `Ask ↵` / `Capture ⌘↵` / `⇧↵ newline`
and its prototype JS still binds them. Left alone: SPEC.md §11's amendment
supersedes the mockup on this point, and rebinding the prototype's own key
handling is a separate chore on a file other agents are editing.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
