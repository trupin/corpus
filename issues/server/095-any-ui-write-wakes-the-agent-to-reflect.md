# [SERVER-095] Resizing a board column wakes the agent to reflect on it

## Domain

server

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: SERVER-052 (built the acknowledgment), CONTRACT-028 (its payload),
  UI-096-adjacent view-state writes

## Spec References

- SPEC.md **§4** "Edit acknowledgment" — "Every *user* edit session on a document
  ends one of two ways… the server emits one `doc.edited` queue event carrying
  the document id and the session's commit range with change stats… The
  orchestrate skill **reflects on the change**: it checks, through retrieval,
  whether the change ripples into other documents; updates those documents, or
  records what it noticed in **their** changelogs"
- SPEC.md **§8** — what wakes the agent
- SPEC.md **§11** — the board, and the autosave

## Summary

**Reported by the user, 2026-08-10: the system is unusable and burns tokens on
nothing.** Every UI write to a document — not just a content edit — emits a
`doc.edited`, so the agent wakes and reflects on things like a column resize.

Reproduced from the user's own live workspace. This is the **entire** diff of a
commit that woke the agent to reflect on it:

```
commit 4e8fc3f  Author: user  doc edit: Open threads (doc_seedopenthreads) by user

 data/docs/views/open-threads.md | 4 ++--

-updated: 2026-08-08T22:24:13Z
+updated: 2026-08-08T22:41:49Z
-width: 444
+width: 725
```

Somebody dragged a board column wider. `apps/ui/src/board/useColumnWidth.tsx`
persists that as `PUT /api/docs/:id` with `{ extra: { width } }` and nothing
else — a legitimate write of view state to a `type: view` document. The agent was
then asked whether it "ripples into other documents".

The user's framing, which is the acceptance test: **only content edits from a
human should be considered for reflection, not any UI event.**

## Root cause

`apps/server/src/docs/update.ts:388` sets `editSession: loaded.path`
**unconditionally** on every `PUT`, so `observeCommit` opens a session for any
user save whatever it changed. §4 scopes the acknowledgment by *actor* — which
works, agent saves are correctly ignored — but nothing scopes it by **what
changed**.

The comment at that line gives a reason for carrying the path unconditionally:

> Only a `user` save opens one — the tracker scopes that — but the path is
> carried unconditionally, because an agent save through the same verb still has
> to seal a session the user has open on this document.

**That reason does not hold.** Sealing runs through `touches(commit, session)`
(`edit/sessions.ts:262`), which compares `commit.docId` and `commit.paths` — it
never reads `editPath`. So making `editSession` conditional costs sealing
nothing. Verify that before relying on it; it is the linchpin of the fix being
one line rather than a redesign.

## Acceptance Criteria

- [ ] Reproduce first, per the SDLC: a `PUT` changing only `extra`, only `tags`,
      or only `status` currently emits a `doc.edited`. Show it before fixing
- [ ] A user save that **does not change the body** opens no edit session and
      emits no `doc.edited`. Column width, tags, status, folder, `reviewed`, a
      title, `query` — none of them wake the agent
- [ ] A user save that **does** change the body opens a session exactly as today.
      No regression in the acknowledgment's range, stats or idle behaviour
- [ ] A save carrying a body change **and** frontmatter changes is a content
      edit — the body is what decides, and the rest riding along does not
      disqualify it
- [ ] A `PUT` that names a body identical to what is stored is **not** a content
      edit. `changedFields` already drops a `reviewed` equal to the file's; the
      body deserves the same treatment, or the UI's periodic autosave of
      unchanged text reintroduces this bug in a quieter form
- [ ] **Sealing is unaffected.** An agent save still seals a user's open session
      on that document, whatever the agent changed. Prove it with a test where
      the agent's save changes only frontmatter
- [ ] Nothing else that emits `doc.edited` is left unscoped. Sweep every caller
      of `observeCommit` for the same gap rather than fixing the one verb

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/update.ts` — the conditional, and the corrected comment
- `apps/server/src/docs/update.test.ts`, `apps/server/src/edit/acknowledgment.test.ts`

### Key Implementation Details

The change should be to `editSession`, not to the tracker: the tracker's actor
scoping is correct and its sealing rule is correct, and widening the fix into
`edit/sessions.ts` risks both. Decide the body change where the other field
comparisons already happen, beside `changedFields`.

**Do not edit `apps/server/src/edit/sessions.ts` or `apps/server/src/git/commit.ts`**
— another agent is fixing PR #42's review finding in both files right now. If you
believe the fix belongs there, stop and tell the orchestrator.

### Edge Cases

- **A body change that normalizes to the same bytes** (trailing whitespace, a
  serializer round-trip). It reaches disk as no change at all; treat it as no
  content edit rather than as one, and say which you chose in the log.
- **A `PUT` with no body field at all** — §9.2 says an omitted body is a save
  that names no change. Plainly not a content edit.
- **A user's *first* save being frontmatter-only, then a body save.** The session
  opens on the body save, and its range starts there. Correct: the frontmatter
  save is not part of the sitting the agent is asked to reflect on.

## Testing Strategy

Unit, against the real write pipeline. One test per field class that must **not**
open a session (`extra`, `tags`, `status`, `title`, `folder`, `reviewed`, empty
body), one that must (a real body change), one mixed, and one sealing test where
the agent's save is frontmatter-only.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start a server on a free port (**never 8765 or 5173**) against a scratch
   workspace with a `type: view` document.
2. `PUT /api/docs/<view-id>` with `{"extra":{"width":725}}` as `user`.
3. Wait past the acknowledgment idle window.
4. Expected: nothing in `.corpus/queue/pending/`.
5. Actual: a `doc.edited` event naming that document.

### Verification Steps

1. Repeat after the fix: no event for the width write; an event for a real body
   edit; both in the same session.

## E2E Verification Log

_Filled by the implementing agent; state the model. This is a bug: the pre-fix
reproduction is mandatory._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
