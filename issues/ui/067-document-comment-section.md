# [UI-067] An always-available comment section: comment without selecting, reply in place

## Domain
ui

## Status
done

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
- [x] A comment composer is available on every document without selecting text,
      findable at the bottom of the **comments list** — which is where §11's
      signed rider puts it: *"the comments list carries a composer"*. That
      supersedes this issue's own draft wording ("at the bottom of the
      document"), which was written before the placement was signed
- [x] Submitting starts a **new** unanchored thread (`anchor: null`, `parent` =
      the document) — the same shape §6 already defines, not a new kind of object
- [x] Every thread in the comments section can be replied to **in place**, adding
      a turn without navigating away
- [x] The "ask agent" toggle is available on both the new-thread composer and the
      replies, exactly as it is elsewhere
- [x] Composer keys follow the signed contract (`↵` newline, `⌘↵` send) — reuse
      the kit's `handleComposerKeyDown`, do not hand-roll a sixth composer
- [x] Threads read as a conversation: author, time, and turns in order
- [x] Resolve/reopen works per thread from this surface
- [x] Capture's unanchored thread appears here like any other and is repliable
- [x] Anchored comments are unaffected — this adds a path, it does not change the
      selection path
- [x] The section is present in both column view and full screen (it lives with
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
  comments, this is *writing* them. They shipped together, as one tab.

### SETTLED: a reply here is a TURN on the thread, flat — never a child thread

§11 says *"every thread in the list can be replied to **in place**, without
leaving the document: the section reads as a set of conversations, each
continuing where it began."* A reply that opened a **child thread** would not
continue the conversation, it would start a second one hanging off a turn of it —
which is what the ⤷ affordance inside a rendered turn is already for (§11's
turn-comment rider), and which resolves separately, carries its own status and
appears in this very list as another row. Two different acts; keeping them
distinct is the point.

So the row's reply box **is `ThreadCard`'s own `ThreadComposer`**, unchanged:
`POST /api/threads/{id}/turns`, one turn appended to that thread, `↵` newline and
`⌘↵` send through the kit's `handleComposerKeyDown`, the same `◉ ask agent`
tri-state, the same attachment intake, and §8's reopen when the conversation was
resolved. No sixth composer was written for it — the list renders the same
`ThreadPanel` every other placement renders, and the composer comes with it.

The **new-thread** composer at the foot is the one new component
(`NewCommentComposer`), and it is new only because it calls `useCreateThread`
with `selector: null` rather than `useAppendTurn`. Everything below its field is
the reply box's: the same intake, the same autocomplete, the same address line,
the same toggle, the same key handler.

### The reconciliation, as built

Capture's unanchored thread is **not special**. It has no anchor entry, so it is
an `unanchored` row like any other whole-document remark: listed, filtered,
collapsible, resolvable and repliable in place. The composer never appends to it —
it always starts a new thread, which is the signed answer ("a second, unrelated
remark starts its own thread").

## Testing Strategy
Component tests for composing a new thread and replying to an existing one; e2e
in the real app asserting the thread reaches disk with `anchor: null` and the
reply lands as a turn on the same thread.

## E2E Verification Log

**Model: Opus 5 (1M context).** The composer half of
`apps/ui/e2e/comments-tab.spec.ts`, in a real browser, plus jsdom component
tests. The full run and the surface's other half are logged in UI-063.

```
✓ writing a comment with no selection › starts a new unanchored thread, and a second remark starts its own
✓ writing a comment with no selection › takes a newline on ↵, so a remark can have paragraphs
✓ writing a comment with no selection › replies in place to a conversation already in the list
```

**A new thread, with no selector.** Two remarks typed into the foot composer, each
sent with `⌘↵`. The list went 3 rows → 4 → 5, and both requests were
`POST /api/threads` with:

```
parent   "doc_note"
selector null
```

— and `POST /api/threads/th_new1/turns` was never issued, so the second remark
did not join the first. That is §6's whole-document comment (`anchor: null`), not
a new kind of object.

**`↵` is a newline.** Typed `First line.` `↵` `Second line.` into the composer:
no request was sent and the field held `"First line.\nSecond line."`. `⌘↵` then
sent it. The keys come from the kit's `handleComposerKeyDown`, which is what
would have caught a hand-rolled sixth composer.

**Reply in place.** Typed into `[data-composer="th_anchored"]` inside the row and
pressed `⌘↵`: the card grew from one `.turn-body` to two,
`POST /api/threads/th_anchored/turns` was issued exactly once, and
`POST /api/threads` was **not** — a turn on that thread, not a child thread
beside it.

**Resolve/reopen from this surface** and **the ask-agent toggle** are covered in
UI-063's log and in `CommentsTab.test.tsx` (`carries the ask-agent toggle, and
sends an explicit false for a note` — the `○ note only` path puts
`requestsAgent: false` on the wire, never an omission).

### Falsification

`selector: null` replaced with `selector: { exact: "invented" }` in
`NewCommentComposer`:
`✘ the composer at the foot › starts a NEW thread with no selector, whatever is
already listed`. Restored, 15 pass.

### Reply-reopens-a-resolved-conversation

Covered from the board for the first time in
`apps/ui/e2e/stub-fidelity.spec.ts` — see UI-085, which had to fix the stub before
this was assertable at all.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
