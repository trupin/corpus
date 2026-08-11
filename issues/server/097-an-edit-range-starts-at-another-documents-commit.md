# [SERVER-097] A `doc.edited` range starts at a commit that touched a different document

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: SERVER-052 (built the range), CONTRACT-028 (its payload), SERVER-093
  (path-scoping under multi-document commits), SERVER-095

## Spec References

- SPEC.md **§4** "Edit acknowledgment" — the event carries "the document id and
  the session's commit range with change stats"
- SPEC.md **§9.2** — `GET /api/docs/:id/diff`, "the unified diff of one document
  across a commit range, **path-scoped**"

## Summary

Found in the user's live workspace while diagnosing SERVER-095, and filed apart
from it because it is a separate defect with a separate fix.

A pending `doc.edited` in `/Users/theophanerupin/cos/.corpus/queue/pending/`:

```json
{ "docId": "doc_6malm2hs",
  "from": "62b3c95…",   // "doc edit: Comment (doc_skillcomment) by agent"
  "to":   "b8e5520…" }  // "doc edit: Estate (doc_6malm2hs) by user"
```

The range's `from` is a commit by the **agent** to a **different document**. The
event is about `doc_6malm2hs`; `62b3c95` never touched it.

## Why it is not harmless, and why it is only P1

The diff read is path-scoped (§9.2, verified by SERVER-093), so
`corpus doc diff doc_6malm2hs --from-rev 62b3c95 --to-rev b8e5520` still shows
**only** that document's change. The bytes the agent gets are right.

What is wrong is the *range*, and it costs two things:

1. **`stats` are computed over the range.** `commits` counts commits in it, so a
   range whose base is an unrelated commit reports a commit count that includes
   work on other documents. The agent is told "3 commits" for what was one save.
2. **The range is a claim.** §4 says "the session's commit range", and a reader —
   human or agent — reasonably takes `from` to be the state this document was in
   before the session. It was not.

P1 rather than P0: nothing is corrupted and no wrong bytes are served. But the
number the agent reads to decide "is this change worth fetching" is inflated by
other documents' activity, which is a bad input to a decision that costs tokens.

## The likely cause, to be confirmed rather than assumed

`from` appears to be resolved as "the commit before the session's first commit"
in branch order, rather than "the previous commit **that touched this
document**". Under party-scoped commit windows (SHARED-040) that gets worse, not
better: a window commit legitimately holds several documents, so branch order and
per-document order diverge routinely rather than occasionally.

Confirm this against `apps/server/src/edit/sessions.ts` and `edit/diff.ts` before
building anything. The fix is probably `git log -1 --skip=1 -- <path>` shaped —
the previous commit touching this document — but the interesting question is what
`from` should be when the document has **no** earlier commit, and whether the
answer differs from today's null-range case.

## Acceptance Criteria

- [ ] Reproduce first: two documents saved in one window, then an acknowledgment
      whose `from` names a commit that did not touch its document
- [ ] `from` names a commit that **touched this document**, or is null when there
      is none
- [ ] `stats.commits` counts commits touching this document, not commits in the
      branch range. Check `insertions`/`deletions` too — if they were already
      path-scoped, say so; the inconsistency is worth recording either way
- [ ] The null-range case (a document with no earlier commit) is unchanged, or
      the change is deliberate and stated
- [ ] A range across a **multi-document window commit** is correct in both
      directions — this is the case SHARED-040 made routine

## Technical Design

### Files to Create/Modify

- `apps/server/src/edit/sessions.ts`, `apps/server/src/edit/diff.ts`

### Notes

- SERVER-093 established that path-scoping is newly load-bearing under
  party-scoped windows and verified the **diff** is scoped. This issue is the
  other half: the **range and its stats**. Read that issue's ruling first.
- Do not widen this into changing what the diff serves. The diff is correct.

## Testing Strategy

Unit: a session on document A with a commit to document B interleaved, asserting
`from`, and `stats.commits`. Plus the multi-document window commit case.

## E2E Verification Plan

Real server on a free port (**never 8765 or 5173**), scratch workspace under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`. Never write to
`/Users/theophanerupin/cos` — that is the user's real workspace.

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
