# [SERVER-113] `GET /api/docs/{id}/diff`'s default base is a commit that touched a different document

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
- Related: SERVER-097 (the same defect in the edit acknowledgment, fixed there;
  this is its twin, found while fixing it and deliberately left alone)

## Spec References

- SPEC.md **§4** — commit windows gather a party's saves across documents
- SPEC.md **§9.2** — `GET /api/docs/{id}/diff`

## Summary

Found while fixing SERVER-097 and **left unfixed on purpose**: that issue says in
as many words *"do not widen this into changing what the diff serves"*, and this
field is served by that route.

`readDocDiff` computes its default `from` as `parentOf(to)` — the immediate
predecessor commit, whatever document that commit touched. §4's commit windows
gather a party's saves **across documents**, so the predecessor is routinely a
commit about something else entirely.

Measured live while SERVER-097 was being verified:

```
corpus doc diff doc_qy2xgecq  →  from: 4e1cd61
git show --name-only 4e1cd61  →  comment2.md      (a different document)
```

So the default diff of a document is computed against a base that has nothing to
do with it. The numbers are right — every read is path-scoped — but the **base is
a false claim about provenance**, which is exactly the wording SERVER-097 landed
on for the acknowledgment's version of this.

## Why it matters more now

SERVER-097 fixed the acknowledgment path with `previousCommitFor(git, sha, path)`
— parent, then `rev-list --max-count=1 <parent> -- <path>`. **The two paths now
disagree about the same document's base**: the event the agent receives says one
thing, and the route the agent calls to see the change says another. Before
SERVER-097 they were consistently wrong together, which is at least legible.

## Acceptance Criteria

- [ ] The default `from` is the previous commit that **touched this document**,
      using the helper SERVER-097 already added rather than a second
      implementation
- [ ] A document whose first commit is its only one diffs against the empty tree,
      as the acknowledgment path now does — "nothing before this touched it" is
      an honest base rather than an error
- [ ] An explicit `--from-rev`/`--to-rev` is untouched: this is about the default
      alone
- [ ] Reproduced before fixing, against a real workspace where a window gathered
      two documents, and the reproduction logged

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/diff.ts` — `readDocDiff`'s default base
- `apps/server/src/edit/diff.ts` — `previousCommitFor`, already exists, exported

### Notes

One line, now that the helper exists. The care is in the tests: a fixture whose
commits each touch one document cannot tell the two bases apart, so the
reproduction needs a window that genuinely gathered two.

## Testing Strategy

A repository where a commit between the document's two revisions touched only
another file; assert the default base skips it. Verify the test fails against
`parentOf`.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-113]` prefix
