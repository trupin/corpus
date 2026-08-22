# [UI-111] The comment popover takes no attachments, and §10 says every composer does

## Domain

ui

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Related: UI-070 (attachments in every composer, through one kit surface — the
  issue this one is the missing half of), UI-112 (the same popover, moved and
  anchored)

## Spec References

- SPEC.md **§10** Thread view — *"**Every composer takes attachments.** Wherever
  a comment can be written — the global composer, a thread's reply box, **a
  comment on a document selection**, a comment on a turn or on a selection within
  one, and any composer a plugin contributes — files can be added by picker,
  paste or drag-and-drop, and appear as chip previews before sending (§6). A
  comment is a comment wherever it starts; which surface it was written in
  decides nothing about what it can carry."* _(Rider signed 2026-08-05.)_

## Summary

**This is a spec-compliance defect, not a feature request.** The user reported it
as a gap — *"I also want to be able to attach artifacts (e.g. screenshots) when
commenting from the modal. Right now, that's only available in other composers,
not that one"* — and the rider signed 2026-08-05 already promises exactly that,
naming "a comment on a document selection" in its own list.

`apps/ui/src/anchors/CommentPopover.tsx` contains **no** attachment code at all:
no picker, no paste handler, no dropzone, no pending chips. `ThreadComposer.tsx`
carries the intake hook in fourteen places. So the one composer where a
screenshot is most obviously wanted — commenting on a passage, about a thing you
are looking at — is the one composer that cannot take one.

The sentence the rider closes with is the whole of the requirement: *"A comment
is a comment wherever it starts; which surface it was written in decides nothing
about what it can carry."*

## Acceptance Criteria

- [x] The comment popover accepts attachments by **all three** routes §6 names:
      the 📎 picker, pasting an image or file, and drag-and-drop with a visible
      dropzone highlight
- [x] Pending attachments preview as removable chips before sending, exactly as
      they do in the reply box — same component, not a second implementation
- [x] A comment may be **attachment-only**, with no text, as §6 allows
- [x] The attachments land on the created thread's first turn, which is where a
      comment-on-a-selection's content goes
- [x] The composer key contract is untouched (§10): `↵` newline, `⌘↵` sends
- [x] The same audit is run across every surface the rider names, so this issue
      closes the **class** and not one instance: the global composer, the reply
      box, the document-selection popover, a comment on a turn, and a comment on
      a selection within a turn. Any other one that cannot take a file is named
      here, fixed, or filed — **the audit's result is below**

## Audit — every surface the rider names

| Surface | Component | Before | After |
| --- | --- | --- | --- |
| Global composer (Ask / Capture) | `compose/ComposeOverlay.tsx` | takes files | unchanged (now shares `AttachButton`) |
| A thread's reply box | `thread/ThreadComposer.tsx` | takes files | unchanged (now shares `AttachButton`) |
| A comment on a document selection | `anchors/CommentPopover.tsx` | **none** | all three routes |
| A comment on a selection within a turn | same popover, hosted by `thread/useTurnComments.tsx` | **none** | all three routes |
| A comment on a turn | `thread/NewChildThread.tsx` | **none** (and said so in a comment) | all three routes |
| A plugin's comment composer | `plugins/todos/ui/TodoItemComposer.tsx` | **none** | **still none** — filed, see below |

The todos plugin's *Comment on item* composer is the one remaining instance. It
is out of this domain's tree and cannot be fixed by copying: a plugin may import
only `@corpus/kit`, and the kit publishes no intake hook or chip strip yet. That
is exactly UI-070's second acceptance criterion (publish the trio from the kit)
plus PLUGINS-012 (consume it), and both are already filed. `AttachButton.tsx`
was extracted here so UI-070 promotes **one** component instead of three copies.

## Technical Design

### Files to Create/Modify

- `apps/ui/src/anchors/CommentPopover.tsx` — the intake hook and its three routes
- `apps/ui/src/thread/PendingAttachments.tsx` — reused, not reimplemented

### Notes

`ThreadComposer` is the reference implementation: `intake` supplies
`onDragEnter`/`onDragOver`/`onDragLeave`/`onDrop`, `onPaste`, `pending`,
`remove` and `restore`, and the failure path puts the attachments back when the
server refuses the turn. Whatever is extracted for reuse should keep that
restore-on-failure behaviour — a comment that loses its screenshot because the
post failed is worse than one that could never take it.

## Testing Strategy

Component: the three intake routes on the popover, the chips, attachment-only
send, and restore-on-failure. A test that asserts the class list rather than the
behaviour would pass against a dropzone that never fires.

## E2E Verification Plan

### Verification Steps

1. Select text in a document, open the comment popover
2. Paste an image → chip appears; drop a file → dropzone highlights, chip appears
3. Send with no text → the thread is created carrying the attachment
4. Repeat for a comment on a turn and on a selection within a turn

## E2E Verification Log

**Model: opus** (claude-opus-5, 1M context). Date: 2026-08-16.

### Rig — the real thing, not a stub

- Workspace: `corpus init /tmp/ui111-ws`, port pinned to **8791** (never 8765 —
  the user's live server holds it), real git repo, real server started with
  `corpus server start` (runs `apps/server/src/main.ts` from source via tsx,
  pid 68950).
- UI: real Vite dev server on **5473** (5173/5373 were held by other sessions),
  `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8791`, `VITE_CORPUS_TOKEN` from the
  workspace config.
- Browser: real headless Chromium driven by Playwright
  (`/tmp/ui111/drill{1..4}.mjs`), against the real board, the real TipTap
  document, the real context menu.
- Seed: `data/docs/inbox/ui111.md` written on disk; the server's watcher picked
  it up and `GET /api/docs?folder=inbox` returned it, so the fixture is the
  file, not an injected row.

### Drill 1 — a comment on a document selection, all three routes

Selected the first paragraph in the reader, right-clicked, chose Comment. The
popover opened quoting *“The rate assumption is 6.1% today, and the model has
not been revisited since spring.”* Then:

- **📎 picker** — `setInputFiles` on `[data-attach-input="comment"]` →
  chips `['shot.png✕']`
- **paste** — a real `ClipboardEvent` carrying a `File` on the field →
  chips `['shot.png✕', 'pasted.png✕']`, and nothing typed into the field
- **drop** — a real `DragEvent` with a `DataTransfer` on the popover →
  chips `['shot.png✕', 'pasted.png✕', '📄dropped.pdf✕']`
- **remove** — clicking a chip's ✕ left `['shot.png✕', '📄dropped.pdf✕']`
- **attachment-only send** — field value `""`, `[data-comment-send]` **enabled**,
  clicked. Request on the wire:
  `POST /api/threads` `content-type: multipart/form-data; boundary=…`.

On disk, immediately after:

```
data/threads/th_gkzkeuwp.md
## user · 2026-08-16T15:22:56Z
![shot.png](attachments/th_gkzkeuwp/2026-08-16T15%3A22%3A56Z/shot.png)
[dropped.pdf](attachments/th_gkzkeuwp/2026-08-16T15%3A22%3A56Z/dropped.pdf)

.corpus/attachments/th_gkzkeuwp/2026-08-16T15:22:56Z/shot.png
.corpus/attachments/th_gkzkeuwp/2026-08-16T15:22:56Z/dropped.pdf

git log -1 → "comment: new thread on doc_ui111 (th_gkzkeuwp) by user"
```

So the attachments land on the created thread's **first turn**, the bytes land
under the thread, and git records it — with no text in the comment at all.

### Drill 2 — the highlight, the preview, the keys, the shape

- `dragenter` → class `comment-pop open dropping`, computed background
  `rgba(59, 95, 151, 0.1)` (the accent wash); after `drop` → `comment-pop open`.
  The highlight is real CSS on a real drag, not a class name in a test.
- Chip thumbnail `src` = `blob:http://localhost:5473/b9de…` — a live object URL,
  the same preview the reply box draws.
- Popover bounding box **320 × 256** with a chip present: still a popover, not a
  panel (UI-070's criterion for this surface). Screenshot:
  `/tmp/ui111/popover-with-attachments.png`.
- `↵` inserted a newline and left the popover open; `⌘↵` sent. §10's key
  contract is untouched. The second comment landed as
  `data/threads/th_453zzcsw.md` — text **and** file:
  `with words this time` + `![x.png](attachments/…/x.png)`.
- The first comment's anchor was painted in the reopened document (1 highlight),
  so the anchored-comment path still works with a file attached.

### Drill 3 — a comment on a turn (`NewChildThread`)

Opened the thread, clicked 💬 on the turn, dragged a file over the box → class
`composer child-composer dropping`; dropped → chips `['turn-note.png✕']`; the
send control was **enabled with no text**. `POST /api/threads` went out as
multipart and the server answered **201**.

### Drill 4 — the reply box, as a control

Same drill on the untouched `ThreadComposer`: chips appeared, `POST
/api/threads/{id}/turns` answered **201**, and the composer still restored its
text and its chip.

### The one thing that is still wrong, and it is not this issue's

**The server does not emit `resident`, and the contract requires it** — so every
**multipart** write is refused *client-side after the server has already written
it*. The JSON paths use `openapi-fetch` and validate nothing; the multipart
paths parse the response with Zod, and:

```
POST /api/threads → 201, then
CreateThreadResponseSchema: path ["thread","resident"] —
"Invalid input: expected null, received undefined"
```

`GET /api/threads/{id}` answers with keys
`[agent, anchor, created, id, parent, status, tags, title, turns, updated]` and
no `resident`; the append-turn response's `thread` summary omits it too. So the
file is on disk and in git, and the UI says “Comment failed”. Reproduced on the
**reply box** as well (drill 4), which this issue does not touch — it is
pre-existing and affects every composer that attaches a file.

Cause: `residentField` is already **required-nullable** on `ThreadSchema` and
`ThreadSummarySchema` (`packages/contract/src/schemas/thread.ts`), while
SERVER-109 (designate a resident) is still `todo`, so nothing emits it. It went
unnoticed because the JSON paths never validate. Mid-session, a rebuilt
`packages/contract/dist` made the same mismatch break `apps/ui`'s own fixtures
and typecheck; another agent was seen adding `resident: null` to
`readerFixture.ts` and `stubCorpus.ts` while this issue was in flight, which
fixed the unit side. **The server side is unfixed**: until SERVER-109 emits the
field, attaching a file to any comment or reply fails in the UI *after* the
write has landed. Escalated to the orchestrator; deliberately not worked around
here.

That failure is also what UI-111's restore-on-failure is for: the composer came
back holding its words and its chips instead of losing the screenshot.

### Cleanup

Server stopped (`corpus server stop`), Vite killed, ports 8791 and 5473 free.
Nothing was run on 8765 or 5173.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-111]` prefix
