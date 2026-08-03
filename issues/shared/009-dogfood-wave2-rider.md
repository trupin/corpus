# [SHARED-009] Dogfood wave 2 — five SPEC amendments (SIGNED 2026-08-03)

## Domain
shared

## Status
todo — signed by the user 2026-08-03; apply to SPEC.md at phase kickoff
(orchestrator), before the domain issues start.

## Priority
P1

## Model
fable

## Dependencies
- Depends on: —
- Blocks: UI-049, UI-050, UI-051, UI-052, UI-053, PLUGINS-011

## Spec References
- §6 (anchors, recursion, attachments), §11 (composer, thread view, smart input,
  right-click menu, keyboard scheme)

## Summary
Five live reports on v0.1.0/v0.2.0 (2026-08-03), all approved. Ground truth for
each was established by survey before drafting — cited inline.

---

### Amendment 1 — the composer key contract (§11 "Global composer", last line)

**User answer, verbatim:** _"Every composer, but let's use cmd+enter for
send/ask as well, as well as for comment composers. I want consistency."_

Today only the global composer's keys are specified. The reply box, the comment
popover, the comment-on-a-turn box and the todos item composer all send on `↵`
with no spec sentence at all — and `NewChildThread.tsx` sends on an IME commit
because it lacks the `isComposing` guard its siblings have.

**Orchestrator-derived detail, flagged for the user to overturn:** making `⌘↵`
the send key collides with Capture, which owns `⌘↵` today. Capture moves to
`⇧⌘↵` on the principle that the primary action takes `⌘↵` and a secondary action
takes `⇧⌘↵`. The user did not specify this; it follows from their answer.

REPLACE:
> Keyboard: `c` opens the composer (the shortcut is shown on the button); inside
> it, `↵` submits Ask, `⌘↵` submits Capture, `⇧↵` inserts a newline.

WITH:
> Keyboard: `c` opens the composer (the shortcut is shown on the button); inside
> it, `⌘↵` submits Ask and `⇧⌘↵` submits Capture. **This is the composer key
> contract, and every composer obeys it** — the global composer, the thread reply
> box, the comment popover, a comment on a turn or on a selection within one, and
> any composer a plugin contributes: `↵` always inserts a newline and never
> submits; the primary action is always `⌘↵`; a secondary action, where one
> exists, is `⇧⌘↵`. Every submit control names its key, and an IME composition
> commit never submits. _(Amended 2026-08-03 by user sign-off; `↵`-to-send,
> unspecified for comment composers and specified for the global one, was
> reversed for consistency across every composer.)_

Note this does **not** touch `⇧↵` in the board keyboard scheme ("open directly in
full screen"), which is a row binding, not a composer one.

---

### Amendment 2 — commenting on a selection inside a turn (§11 "Thread view")

**User:** _"In a thread, or any document for that matter. I want to be able to
select some text and comment on it. When in a thread though, I want the selected
text to automatically start a comment with a citation with the selected text."_

Mechanism already exists and is licensed: §6 "Recursion" says commenting on a
thread turn creates a child thread whose `parent` is the thread's id, the
contract puts no type restriction on `parent`, and the server already writes
`anchors` into a thread's frontmatter. What is missing is **granularity**:
`childThreads.ts` anchors a turn comment to the turn's first non-empty line
truncated to 160 characters, and `useAnchorLayer.captureComment` structurally
refuses a selection outside the TipTap editor, so the Comment item never appears
for a selection inside a turn.

APPEND to the Thread view bullet, after "Child threads shown per-turn.":
> **Commenting on a selection.** Selecting text inside a rendered turn offers the
> same Comment affordance the document view offers: the selection becomes the
> child thread's text-quote anchor (§6), is highlighted in the turn the way an
> anchor is highlighted in a document, and the composer opens with the selection
> already quoted as a citation above the input. Commenting on a whole turn stays
> available and still anchors to the turn. _(Rider signed 2026-08-03.)_

---

### Amendment 3 — images open full-size (§11 "Thread view" + §6 attachments)

**User:** _"Images should be clickable. When clicking, it opens it in full screen
so I can see the detail."_

Nothing in the app does this: `MarkdownView` overrides only `pre` and `a`, there
is no `img` override, no lightbox component exists anywhere, and turn attachment
images are capped at 240×180 with no way to see them larger.

The survey also found a **latent bug** the user has not hit yet: an inline
`![](attachments/…)` in a *document* body renders as a bare relative `<img src>`
with no `Authorization` header, and `/attachments/*` is behind `headerAuth` — so
it silently never loads. Only trailing turn attachments work, because those go
through `useAttachment`, which fetches with the token and yields a `blob:` URL.
The user chose to fix this alongside the viewer.

APPEND to the Thread view bullet:
> **Images open full-size.** Clicking any rendered image — a turn attachment or
> an image in a document body — opens it full-screen over the app, where `esc`
> closes it and returns focus to the image. Images anywhere in a body that
> reference workspace attachments load through the same authenticated path as
> turn attachments, so an attachment referenced mid-prose renders exactly like
> one referenced at the end. _(Rider signed 2026-08-03.)_

---

### Amendment 4 — one keyboard contract for every autocomplete (§11 "Smart input everywhere")

**User:** _"When autocomplete shows, I want to be able to navigate the results
with the top and bottom arrows. I also want to be able to select one with tab.
Make it consistent with any autocomplete UX."_

Arrows already work everywhere. `⇥` does not: there are **three** separate
implementations — the kit hook (`@`/`/`/`[[` in plain-text composers), the
editor's TipTap `[[` menu, and the column query editor's — and only the query
editor handles `⇥`. In the other two, `⇥` moves focus out of the field.

APPEND to the Smart input bullet:
> All autocompletes in the app share one keyboard contract: arrows move the
> highlight (wrapping at both ends), `⇥` and `↵` both accept the highlighted
> item, and `esc` dismisses the menu leaving the typed text as it stands. This
> holds wherever a completion menu appears — the three composer triggers, the
> document editor's `[[`, and the column query editor — so the same keys always
> do the same thing. _(Rider signed 2026-08-03.)_

Note the interaction with Amendment 1: once `↵` inserts a newline in composers,
`↵`-accepts-completion is unambiguous, because the open menu claims the key
first and only while it is open.

---

### Amendment 5 — fenced canvases wrap (§11 "Thread view", canvas sentence)

**User:** _"Snippets should show in canvas, but the content should be wrapped
rather than linear. Right now it shows the content as a horizontal scroll where
long lines need to be scrolled horizontally in order to be visible."_ Chose
**always wrap** over a per-block toggle.

Current behavior is `overflow-x: auto` with the UA default `white-space: pre`,
pinned by no test and described by no spec sentence.

APPEND to the copyable-canvases sentence:
> Long lines **wrap** inside the canvas rather than scrolling horizontally, so
> the whole block is readable without a second axis of navigation.
> _(Rider signed 2026-08-03.)_

---

## Acceptance Criteria
- [ ] All five amendments applied to SPEC.md verbatim, each carrying its
      signed-2026-08-03 marker
- [ ] Amendment 1's replacement leaves the board's `⇧↵` row binding untouched
- [ ] No domain issue starts before the spec text is in place

## Technical Design
### Files to Create/Modify
- `SPEC.md` §6, §11

## Testing Strategy
None — spec text. The domain issues carry the tests.

## E2E Verification Log
_N/A — spec change._

## Completion Checklist (orchestrator)
- [ ] SPEC.md updated
- [ ] Committed with `[SHARED-009]` prefix
