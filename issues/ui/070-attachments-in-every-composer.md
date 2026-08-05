# [UI-070] Attachments in every composer, through one kit surface

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-012
- Blocks: PLUGINS-012

## Spec References
- SPEC.md §11 as replaced by SHARED-012; §6 attachments (picker/paste/drag-drop,
  chip previews, the size cap and its 413)

## Summary
Three of five composers cannot take a file: `CommentPopover` (a comment on a
document selection), `NewChildThread` (a comment on a turn), and the todos
plugin's item composer. The other two can. The transport is already there on
both paths — multipart `POST /api/threads` and turn attachments — as are the
reusable pieces: `apps/ui/src/thread/useAttachmentIntake.ts` and
`PendingAttachments.tsx`.

So this is a placement problem, not a capability one, and it is the same shape
SHARED-009's key contract had: something true of two composers because each was
written on its own. That was fixed by moving the rule into the kit, and
PLUGINS-011 then consumed it with one import and no copy. Aim for the same
outcome here — **PLUGINS-012 should need no new kit export of its own.**

## Acceptance Criteria
- [ ] A file can be attached by **picker, paste and drag-and-drop** in every
      composer in `apps/ui`, and appears as a chip preview before sending (§6)
- [ ] The intake and the chip strip are published from `@corpus/kit`, reachable
      by a plugin — verified by PLUGINS-012 consuming them without a copy
- [ ] A comment that **starts a thread** sends multipart `POST /api/threads`; a
      comment that **replies** sends the turn-attachment call. Both already
      exist; no third path is invented
- [ ] An over-cap file is refused visibly, with the reason, on every surface —
      the 413 is contracted (CONTRACT-009) and a silently dropped file is worse
      than no attachments at all
- [ ] Removing a pending attachment before sending works everywhere
- [ ] Sending with attachments and sending without both still work, and the
      composer key contract (`↵` newline, `⌘↵` send) is unchanged
- [ ] `CommentPopover` still reads as a popover with two files attached — check
      against `design/index.html` and say what it should look like; a popover
      that becomes a panel is a different component
- [ ] Paste does not fight the clipboard work: pasting **text** into a composer
      still inserts text, and pasting an image attaches it. UI-042 made paste
      rich in the editor; these are plain-text fields and must not regress
- [ ] Attachments reach disk under the thread they belong to, verified against a
      real server rather than a stub

## Technical Design
### Files to Create/Modify
- `packages/kit` — promote the intake hook and the pending-chip component
- `apps/ui/src/anchors/CommentPopover.tsx`, `apps/ui/src/thread/NewChildThread.tsx`
- `apps/ui/src/thread/` — the existing users become consumers of the kit copy
  rather than keeping their own
- `packages/kit/src/index.test.ts` — `RUNTIME_SURFACE`
- tests alongside

### Notes
- `NewChildThread.tsx` currently documents the absence ("deliberately not a
  second composer: it carries no attachments"). That comment is now wrong and
  must go with the change, not survive it.
- Watch the interaction with UI-067 (the always-available comment section), which
  adds a composer and per-thread replies. If both land in the same phase, they
  should agree about which component they are composing with rather than each
  growing an attachment strip.

## Testing Strategy
Component tests per composer for the three intake routes and the refusal path;
e2e against a real server attaching a file to a document-selection comment and
asserting the bytes land under the created thread.

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
