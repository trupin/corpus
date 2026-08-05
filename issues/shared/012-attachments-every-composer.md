# [SHARED-012] Attachments belong to every comment (SIGNED 2026-08-05)

## Domain
shared

## Status
todo — signed by the user 2026-08-05; apply to SPEC.md at phase kickoff.

## Priority
P1

## Model
fable

## Dependencies
- Depends on: —
- Blocks: UI-070, PLUGINS-012

## Spec References
- §6 (attachments on turns and thread creation), §11 (thread view composer)

## Summary
**User, verbatim (2026-08-05):** _"I want attachments to be allowed in any type
of comment. Whether it is from a selection in a document, or in a thread. Any
comment should be able to have attachments."_

Unambiguous, so it is recorded as signed rather than taken back for a choice.

**Surveyed state — this is a UI unification, and the wire is already there.**

| Composer | Attachments today |
| --- | --- |
| `ThreadComposer` (thread reply) | **yes** |
| `ComposeOverlay` (global Ask/Capture) | **yes** |
| `CommentPopover` (comment on a document selection) | no |
| `NewChildThread` (comment on a turn) | no — the file says "deliberately not a second composer: it carries no attachments" |
| `TodoItemComposer` (plugin) | no |

The transport exists on both paths §6 already describes: multipart
`POST /api/threads` (CONTRACT-009) and turn attachments. The reusable pieces
exist too — `apps/ui/src/thread/useAttachmentIntake.ts` (picker, paste,
drag-drop) and `PendingAttachments.tsx` (the chip previews §6 asks for). What is
missing is that three composers do not use them.

This is the same shape as the composer **key** contract (SHARED-009 Amendment 1):
a capability that ended up in two of five composers because each was written
separately. That one was fixed by extracting the rule into the kit so a plugin
could consume it — and PLUGINS-011 proved the placement by consuming it with a
single import. Do the same here.

REPLACE, in §11's thread-view composer sentence, the attachment clause — and
state it once for all composers rather than per surface:

> **Every composer takes attachments.** Wherever a comment can be written — the
> global composer, a thread's reply box, a comment on a document selection, a
> comment on a turn or on a selection within one, and any composer a plugin
> contributes — files can be added by picker, paste or drag-and-drop, and appear
> as chip previews before sending (§6). A comment is a comment wherever it starts;
> which surface it was written in decides nothing about what it can carry.

## Design notes for the implementing chain
- **The kit is the home.** `useAttachmentIntake` and `PendingAttachments` live in
  `apps/ui/src/thread/`, which a plugin cannot import. Promoting them is what
  makes PLUGINS-012 a consumer rather than a copy — and the kit-gap list in
  UI-045 already exists for exactly this pattern.
- **`CommentPopover` is small on purpose.** It is a popover anchored to a
  selection, not a panel; adding a file picker and a chip strip changes its
  size. Check it against `design/index.html` and say what it should look like
  with two files attached.
- **The size cap and the 413 are already contracted** (CONTRACT-009). Every new
  surface has to report a refused upload as honestly as the existing ones do —
  a silently dropped file is worse than no attachments at all.
- Attachments on a *thread creation* and on a *turn* are different wire calls.
  A comment that starts a thread uses the first; a reply uses the second. Both
  already exist; do not invent a third.

## Acceptance Criteria
- [ ] The §11 replacement applied verbatim at phase kickoff
- [ ] The chain does not start before the text is in place

## Technical Design
### Files to Create/Modify
- `SPEC.md` §11

## Testing Strategy
None — spec text.

## E2E Verification Log
_N/A — spec change._

## Completion Checklist (orchestrator)
- [ ] SPEC.md updated
- [ ] Committed with `[SHARED-012]` prefix
