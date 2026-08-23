# [SERVER-096] Dragging a column wider moves its document to the top of every list

## Domain

server

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: SERVER-095 (found alongside it, in the same commit, and deliberately
  filed apart), UI's `useColumnWidth`

## Spec References

- SPEC.md **§5** — `updated` is part of a document's frontmatter
- SPEC.md **§9.2** — `GET /api/docs` is "newest-updated first by default"
- SPEC.md **§10** — the board, and the column a view document backs

## Summary

Found while diagnosing SERVER-095 in the user's live workspace, and filed apart
from it on purpose: SERVER-095 is about **who gets woken**, this is about **what
the list says**. Fixing one does not fix the other, and folding them together
would have recorded a second defect as a side effect of the first.

The same commit demonstrates both:

```
commit 4e8fc3f  Author: user  doc edit: Open threads (doc_seedopenthreads) by user

-updated: 2026-08-08T22:24:13Z
+updated: 2026-08-08T22:41:49Z
-width: 444
+width: 725
```

Someone dragged a board column wider. That bumped the view document's `updated`,
and §9.2 orders the default result set **newest-updated first** — so resizing a
column moves its document to the top of every list that shows it, ahead of
documents someone actually wrote in.

## The question this issue has to answer first

**Is `updated` "when the bytes changed" or "when the content changed"?** The
answer decides the fix, and it is not obvious:

- If it is *bytes*, the current behaviour is correct and the defect is that
  view state lives in the document at all — which makes this a UI/contract issue
  about where a column's width belongs, not a server one.
- If it is *content*, `updated` should move only when the body or the fields a
  reader would call the document's substance change, and a pure view-state write
  should leave it alone.

SERVER-095 has already drawn a line for a neighbouring question — the **body** is
what decides whether a person was writing. Reusing that line here is the obvious
move and is probably right, but it is not automatic: a title change is not a body
change, and a title change plainly should touch `updated`.

Do not implement until this is settled. If it needs the user, escalate rather
than guessing — this is a visible ordering rule for every list in the product.

## Acceptance Criteria

- [x] The `updated` question above is answered explicitly, in this file, with
      the reasoning — not settled implicitly by whatever the diff does
- [x] Reproduce first: resize a column, then confirm its view document has
      jumped to the head of `GET /api/docs` ordered by `updated`
- [x] A pure view-state write no longer reorders the board
- [x] Whatever rule is chosen is applied **consistently**, not just to `width`:
      any other field of the same class gets the same treatment, and the class is
      named rather than enumerated by accident
- [x] A real edit still updates `updated`. Assert both directions
- [x] Check the projection: `updated` is a column there too, and the ordering is
      SQL. A fix that only corrects the file leaves the list wrong

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/update.ts` and wherever `updated` is stamped
- Possibly `apps/ui/src/board/useColumnWidth.tsx`, if the answer is that view
  state should not be a document write at all

### Notes

- SERVER-095's `bodyChanged` computation is right next to where this decision
  has to be made, and the two rules should be visibly related in the code even
  if they turn out to differ — a later reader will ask why one write is "not a
  content edit" and yet still bumps `updated`.

## Testing Strategy

Unit, against the real write pipeline: one test per field class, asserting
whether `updated` moves; plus a projection-level test that ordering matches.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start a server on a free port (**never 8765 or 5173**).
2. Note the order of `GET /api/docs`.
3. `PUT /api/docs/<view-id>` with `{"extra":{"width":725}}`.
4. Expected: order unchanged.
5. Actual: the view document is now first.

## The answer, and the class

**`updated` is when the document's *content* changed, not when its bytes moved.**
Three things settle it, and none of them is a preference:

1. **The code already says so.** `updateDocumentLocked` has exempted `reviewed`
   from stamping since SERVER-004, with exactly this reasoning — "staleness runs
   from `max(updated, reviewed)`, so stamping `updated` here would make review
   indistinguishable from editing". A byte-movement reading of `updated` was
   never the shipped one. This issue extends an existing rule rather than
   inventing one.
2. **§5 reads it as an age.** The staleness ramp runs off `max(updated,
   reviewed)` and asks "does this still need attention". A write that changes
   nothing a reader could read makes a document no less stale, so a bytes
   reading would let a resize reset the ramp.
3. **§9.2 reads it as recency of work.** "Newest-updated first" is the default
   order of every list, which is the visible defect: the resized view document
   led every list ahead of documents someone had written in.

**The class is presentation state — a key that records how a document is
*shown*, never what it holds.** The rule for membership is stated in code
(`PRESENTATION_KEYS` in `apps/server/src/docs/update.ts`): a key joins when
changing it changes no answer to any question about the document — not what it
says, not what is being asked of it, not where it sits in the corpus.

**Today the class has exactly one member, `width`,** and that is the honest count
rather than an accidental enumeration. Every other key this route writes fails
the test: `status`, `tags`, `due`, `stage`, `evergreen`, a board's `columns`, a
view's `query` and the title all change such an answer. It is named as a class
so the second member is a one-line addition instead of a second special case.

**Not SERVER-095's line, deliberately.** That one is `body || title` and decides
whether the agent is woken to reflect — drawn at what the document *says*,
because only prose ripples into other documents. This one is drawn at what the
document *is*, because `updated` is read by the ramp and by every list. They
differ where they must: moving, tagging or resolving a document moves `updated`
while none of them reflects. They agree on width, which is neither.

**It did not need SPEC.md changed and it did not need the UI changed.** §10's
rider signed 2026-08-23 is explicit: "A column's edge stays draggable and stays
in the view document's frontmatter: it describes the view and travels with it."

## E2E Verification Log

**Model: Opus 5 (1M context).** Real server, real workspace, real git — never
port 8765 or 5173.

### Phase 41 check, first

The issue was filed before Phase 41 and warned the defect might have moved.
**It did not move and it did not evaporate.** Phase 41 moved a board's *columns
list* onto the board document. The **width** still rides the **view** document's
`extra`: `apps/ui/src/board/useColumnWidth.ts:98` sends
`{ id: viewDocId, changes: { extra: { width: next } } }`, and §10's rider of
2026-08-23 re-signs that placement. So the defect is exactly where the issue
said it was, on the document the issue named.

### Pre-fix reproduction (2026-08-23)

Workspace `scratchpad/ws096`, `corpus init`, server on **127.0.0.1:8791**
(pid 74017).

```
BEFORE  GET /api/docs?limit=6
   doc_skillorchestrate  2026-08-22T00:00:00Z
   doc_skillconverse     2026-08-21T00:00:00Z
   doc_skillcomment      2026-08-12T00:00:00Z
   doc_seedattention     2026-07-26T00:00:00Z
   doc_seedboardattention 2026-07-26T00:00:00Z
   doc_seedboardbystatus 2026-07-26T00:00:00Z
                              (doc_seedopenthreads was 9th)

PUT /api/docs/doc_seedopenthreads  {"extra":{"width":725}}  → 200

AFTER   GET /api/docs?limit=6
   doc_seedopenthreads   2026-08-23T15:11:32Z     ← first
   doc_skillorchestrate  2026-08-22T00:00:00Z
   ...
```

The commit is the same shape as the `4e8fc3f` quoted in the Summary:

```
d5cdf59 user  doc edit: Open threads (doc_seedopenthreads) by user
-updated: 2026-07-26T00:00:00Z
+updated: 2026-08-23T15:11:32Z
+width: 725
```

Ninth to first, from a drag. Reproduced.

### Post-fix, same workspace, server restarted (pid 84033)

```
PUT /api/docs/doc_seedopenthreads  {"extra":{"width":900}}  → 200
order unchanged; doc_seedopenthreads keeps updated 2026-08-23T15:11:32Z
file:   updated: 2026-08-23T15:11:32Z
        width: 900
commit: 9db7c8e  doc edit: Open threads (doc_seedopenthreads) by user
        data/docs/views/open-threads.md | 1 insertion(+), 1 deletion(-)
```

One line changed — the width. The resize still writes, still commits and still
syncs to every browser (§10); only the timestamp stays put.

**The other direction, same server:**
`PUT {"title":"Open threads, everywhere"}` → `updated: 2026-08-23T15:14:39Z`,
and the document leads the list again. A real edit still counts.

### Projection

The ordering is SQL over `documents.updated`, which is projected from the file's
frontmatter, so the file fix *is* the projection fix — but that is asserted
rather than assumed: `does not reorder the projection's default list` drives
`GET /api/docs` through the real route and compares the returned ids.

### Tests

`VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/server/src/docs/update.test.ts`
→ **54 passed**, 13 of them new.

**Falsification.** With `PRESENTATION_KEYS` emptied to `new Set<string>()`
(the pre-fix behaviour) the same file reports **3 failed | 51 passed**: the
width-only save, the width clear, and the projection-ordering test all fail. The
file was then restored and `diff` against the pre-break copy reported identical.

**One test cannot fail with the fix absent, by construction**: `moves updated
when a real edit rides along with the width` asserts the *other* direction, so
the pre-fix code passes it. It is there to pin the direction the fix must not
break, and the nine `still moves updated for <field>` cases are the same kind —
they pass either way and exist so a later exemption cannot be added quietly.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
