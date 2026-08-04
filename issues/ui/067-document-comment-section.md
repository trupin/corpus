# [UI-067] An always-available comment section: comment without selecting, reply in place

## Domain
ui

## Status
todo — behavior signed 2026-08-04 (SHARED-010 Amendment 3)

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-010, UI-063 (the comments list this composes into)
- Blocks: —

## Spec References
- SPEC.md §6 (`anchor: null` = whole-document comment), §11 Document view

## Summary
Live report 2026-08-04: _"I want be able to leave a comment on a document without
having to select text. A comment section should always be available, and it opens
a thread on the first comment I leave. This means each document can have a
'general' thread attached, and it's easy to find that thread at the bottom of the
document."_

Refined on sign-off: _"a new thread per comment but I want to be able to leave
follow up comments on each thread from the document itself. conversations should
be organized as threads of conversations a bit like in a forum website."_

**Half of this already exists.** A whole-document comment is a thread with
`anchor: null` (§6:172), and `AnchoredThreads.tsx` already renders those below
the body under a whole-document heading. Capture creates one on every capture.
What is missing is any way to **create** one from the UI — every path into
commenting today starts from a text selection — and any way to **reply** to one
without leaving the document.

**The model, per the sign-off: a forum, not a guestbook.** The comment box always
starts a **new** thread — a second remark about something unrelated is its own
topic, resolvable on its own. Each existing thread is repliable in place, so a
conversation continues where it started rather than forcing a trip to the thread
view.

## A reconciliation the user should check
The two sign-off answers were given against different premises, and I have
reconciled them rather than asking again:

- Asked what a second comment should do, the user overrode the offered options
  with **"a new thread per comment"** plus inline replies (above).
- Asked whether Capture's unanchored thread should *become* "the general thread",
  the user answered **"yes — first unanchored thread wins"**. That option only
  means something in a world with one general thread, which the first answer
  removed.

**Read as:** Capture's thread is not special and not hidden away — it appears in
the same comments section as every other unanchored thread and is repliable there
like any other. The composer does not append to it. If the intent was instead
that the box's *first* comment should join Capture's existing thread, that is a
one-line change here and the user should say so.

## Acceptance Criteria
- [ ] A comment composer is available on every document without selecting text,
      findable at the bottom of the document
- [ ] Submitting starts a **new** unanchored thread (`anchor: null`, `parent` =
      the document) — the same shape §6 already defines, not a new kind of object
- [ ] Every thread in the comments section can be replied to **in place**, adding
      a turn without navigating away
- [ ] The "ask agent" toggle is available on both the new-thread composer and the
      replies, exactly as it is elsewhere
- [ ] Composer keys follow the signed contract (`↵` newline, `⌘↵` send) — reuse
      the kit's `handleComposerKeyDown`, do not hand-roll a sixth composer
- [ ] Threads read as a conversation: author, time, and turns in order
- [ ] Resolve/reopen works per thread from this surface
- [ ] Capture's unanchored thread appears here like any other and is repliable
- [ ] Anchored comments are unaffected — this adds a path, it does not change the
      selection path
- [ ] The section is present in both column view and full screen (it lives with
      UI-063's Comments tab; agree the placement with that issue rather than
      building a second surface)

## Technical Design
### Files to Create/Modify
- `apps/ui/src/anchors/AnchoredThreads.tsx` (the below-body section) and/or
  UI-063's Comments tab — **decide with UI-063, do not duplicate**
- `apps/ui/src/thread/ThreadCard.tsx` already renders a composer; check whether
  the below-body placement can reuse it rather than growing another one
- `POST /api/threads` with `parent` set and no `selector` is the existing wire
  shape — confirm the server accepts a null anchor from this path

### Notes
- This and UI-063 are one surface seen from two angles: UI-063 is *finding*
  comments, this is *writing* them. They should ship together or be explicitly
  sequenced, or the tab will be built twice.
- Forum-shaped means nesting depth matters: §6 allows a thread on a thread, and
  §11 renders child threads per turn to `MAX_RENDERED_DEPTH`. Decide whether
  replies here are turns on the thread (flat, likely right) or child threads
  (nested), and say why.

## Testing Strategy
Component tests for composing a new thread and replying to an existing one; e2e
in the real app asserting the thread reaches disk with `anchor: null` and the
reply lands as a turn on the same thread.

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
