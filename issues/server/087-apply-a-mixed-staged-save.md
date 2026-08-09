# [SERVER-087] Apply a mixed staged Save as one act, and one commit

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-048
- Blocks: UI-083

## Spec References

- SPEC.md **§4** — "A Save carrying a mix of verbs is still one act and still one
  commit … anything else would make the history disagree with the single report
  §11 requires"
- SPEC.md **§11** — bulk mode, per-row staged actions, Save

## Summary

SERVER-077 applies **one** act over many ids as one commit. SHARED-032 makes a
Save carry a different verb per row. The commit boundary already exists and is
already told rather than inferred (`CommitRequest.docIds`); what changes is that
the act now plans per document with a **different planner per document**.

## Acceptance Criteria

- [ ] A Save mixing verbs lands as **one** commit containing exactly the
      documents that changed, with `changed` and `git show --name-only` agreeing
      as the containment invariant states (one direction; the commit may carry
      files for documents the act did not name — §6's cascade parent, §7's skill
      folder move)
- [ ] Per-document outcomes stay per-document, unchanged from SERVER-077: a lock,
      an unknown id, a not-applicable act and a failed write are entries in
      `refused`, never a verdict on the request
- [ ] The whole-request refusal set is unchanged — an agent asking to `delete`
      is `403` before anything is read or written, **even when delete is one row
      of a mixed set**. A staged set is not a way to smuggle a delete past §9.2
- [ ] Lanes cover every document the act writes, including those a planner
      reaches (SERVER-078's carried skills, §6's cascade parent). A mixed set
      touches more planners, so the lane union is larger, not different in kind
- [ ] One SSE invalidate for the act, carrying each key once
- [ ] The projection sees one act

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/bulk.ts`.

### Notes

- `applyOperations` N times then `finishMutation` once is already the shape; the
  change is that `planFor` is chosen per document rather than once for the act.
  Do not reintroduce a loop over the single-document write path — that is the
  failure SERVER-077 exists to prevent and it will look like it works.
- `TREE_MOVING_ACTIONS` is currently consulted for the act; with a mixed set it
  must be consulted per row, or a Save that moves one document and tags another
  will not re-measure the tree.

## Testing Strategy

A mixed Save (archive ×3, resolve ×2) → one commit, five files, `changed` equal
to `git show --name-only`. A mixed Save with one locked row and one unknown id.
An agent `delete` as one row of five → `403`, nothing written. A mixed Save
touching a skill and a thread, so two planners' carried writes land in one lane
union.

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
