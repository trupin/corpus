# [SERVER-078] A nested skill's id changes when the skill above it is archived

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
- Related: SERVER-077 (found it), §7 skills, §5 document identity

## Spec References

- SPEC.md **§5** — a document's id is its identity; `[[refs]]`, anchors and a
  thread's `parent` are all by id
- SPEC.md **§7** — what disables a skill is where its folder lives, so archiving
  a skill moves its whole folder

## Summary

Found by the pr-reviewer's nested-skill case on PR #37 and confirmed by
server-dev while fixing it. **This is pre-existing single-document-route
behaviour, not something the bulk route introduced** — the bulk path only made
it visible.

Archiving a skill folder that nests another skill moves every file under it,
including the nested `SKILL.md`. A skill document with no explicit `id` in its
frontmatter gets a **synthesized** id that hashes its path, and only the
**requested** skill gets its id stamped into the file it is written back to. So
the nested skill's id changes across the move:

```
doc_skill78aafb0e  →  doc_skill6060ce0d
```

## Why this matters

An id is identity (§5). Everything that points at a document points by id:
`[[refs]]`, the `links` graph, a thread's `parent`, an anchor entry in a parent's
frontmatter. A document whose id changes silently is a document every one of
those references now misses — and nothing reports it, because from the
projection's side an old id vanished and a new one appeared, which is
indistinguishable from a delete plus a create.

Unarchiving does not undo it either: the id is synthesized from the path again,
so the round trip yields a third value unless the path is byte-identical.

## Acceptance Criteria

- [ ] A nested skill's id survives its parent skill being archived, and survives
      the unarchive round trip
- [ ] Whatever fix is chosen applies to the **single-document** archive route
      first — that is where the behaviour lives. The bulk route inherits it
- [ ] A `[[ref]]` to a nested skill, and a thread parented on one, still resolve
      after the parent skill is archived and unarchived
- [ ] Reproduce before fixing, and log the pre-fix id change in the E2E log
- [ ] Check whether anything **else** synthesizes an id from a path and moves the
      file without stamping it — the defect is the pattern, not this one caller

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/archive.ts` (`planSetArchived` / the skill folder move)
  and wherever ids are synthesized and stamped.

### Notes

- The obvious fix — stamp every document under a moved folder, not only the
  requested one — is probably right, but check it against what stamping means:
  writing an id into a file the act did not otherwise change puts that file in
  the commit, which interacts with the containment invariant SERVER-077 states
  and with the "one action, one commit" report. Decide deliberately whether such
  a document belongs in `changed`.
- Consider whether a synthesized id should hash something more stable than the
  path in the first place. That is a bigger change and may be the wrong one —
  raise it rather than doing it silently.

## Testing Strategy

Archive a skill nesting another; assert the nested skill's id is unchanged in the
projection and on disk, and that a `[[ref]]` to it still resolves. Then unarchive
and assert the same. Plus the pattern sweep from the last acceptance criterion.

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
