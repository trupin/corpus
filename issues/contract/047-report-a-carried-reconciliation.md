# [CONTRACT-047] An archive can rewrite a document it never named, and say nothing

## Domain

contract

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SERVER-078 (created the behaviour)
- Blocks: —
- Related: SPEC.md §4's "one action, one commit" reporting rule

## Spec References

- SPEC.md **§7** — location is a skill's enablement, so archiving moves the
  whole folder
- SPEC.md **§4** — the report and the commit are one story: `git log` never
  records an effect the user was told did not happen

## Summary

Raised by the implementing agent while fixing PR #38's review findings, and
deliberately not done there because it is a contract change.

Archiving a skill folder carries every file under it, including a nested skill
the request never named. SERVER-078 now writes into those carried files: the id,
so identity survives the move, and — when the destination is the **enabled**
root — `status: open`, reconciling a stale `archived` a previous independent
archive had written.

That reconciliation is correct (§7 makes location the enablement, so after the
move the file *is* enabled and `open` is the truth). **But it is visible only in
the commit and the server log.** The response says nothing. A person who archived
one skill has had another skill's frontmatter rewritten and is not told.

§4's reporting rule is about the inverse case — never recording an effect the
user was told did not happen. This is an effect the user was told **nothing**
about, which the same principle argues against for the same reason.

## Acceptance Criteria

- [ ] A response that carried a reconciliation says so, naming the documents
      reconciled and what was changed about them
- [ ] The mechanism is the existing `Warning` channel unless there is a reason it
      cannot be — a new top-level response field for this is a larger commitment
      than the fact warrants
- [ ] **A carried document does not become `changed`.** PR #37 pinned, in prose
      and two tests, that a bulk result's three parts partition the **requested**
      ids; a reconciled document was never requested. This is a report *about*
      the act, not a fourth part of it
- [ ] The single-document archive route reports it too, not only the bulk route —
      the behaviour lives in the single-document path
- [ ] Silent when nothing was reconciled. A warning on every skill archive is
      noise, and noise is how a real one gets ignored

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/warning.ts` (a new `WarningCode`), and the
  archive route's response description.

### Notes

- Read `apps/server/src/docs/archive.ts`'s `ownedFields` first — it is the one
  place that decides what a carried write touches, so it is also the one place
  that knows what to report.
- The id stamp is arguably not worth reporting (it preserves identity rather than
  changing anything a reader would notice) while the `status` reconciliation is.
  Decide that deliberately rather than reporting both because both are writes.

## Testing Strategy

Archive a nested skill alone, then archive and unarchive the outer one: the
unarchive's response carries a warning naming the nested skill and its status
change. An archive that carries nothing, and one whose carried files needed no
reconciliation, carry no warning.

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
