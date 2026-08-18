# [SERVER-124] Under a `.claude/` root, Corpus's own frontmatter goes entirely unvalidated

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-123
- Blocks: —

## Spec References

- SPEC.md **§7** line 399 — *"Corpus's frontmatter fields (`id`, `type`, `title`,
  `tags`, `status`, `anchors`) coexist with Claude Code's (`name`,
  `description`) in the same YAML block; `corpus doc check` validates both sets"*

## Summary

SERVER-123 made §7:399 true of **Claude Code's** set under `.claude/agents/`. It
is still false of **Corpus's** set under every `.claude/` root, and PR #49's
third review found this while checking that issue's residual was honestly stated.

Measured against a real server, 2026-08-17. A hand-authored
`.claude/agents/bogus.md` carrying:

```yaml
id: 12345
type: not-a-real-type
title: []
tags: seven
status: banana
```

produces **zero findings**. Every one of those is malformed, and `corpus doc
check` says nothing about any of them.

**The cause is that §5's waiver is all-or-nothing.** It has to waive
*required-ness* — a hand-written profile legitimately has no `id`, no `type`, no
`status`, and demanding them would refuse files Claude Code wrote and Corpus only
reads. But the same waiver drops *well-formedness* of the fields that **are**
present, and those are two different questions. A file that declares
`status: banana` has not omitted a field; it has got one wrong.

## Why this is worth fixing rather than documenting

Everything under these roots is projected like any other document. A
`type: not-a-real-type` reaches the projection, the board, and every query that
filters on type. A malformed `tags` reaches the tag vocabulary. The waiver was
written so a hand-authored `SKILL.md` would not be refused for lacking Corpus's
block; it was never meant to make the block unfalsifiable when somebody writes
one.

## What has to be decided

**A present-only validation mode**: validate a field's shape when it appears,
never its presence. That is the shape the two questions want, and the risk is
stated plainly — **it would newly report files in existing workspaces**, which is
exactly the objection SERVER-123's regression was about (PR #49 third review,
MAJOR 1). So:

- It must be **reported, not blocking** — the same partition SERVER-123 settled
  on, for the same reason. `isClaudeCodeRequirement`'s sibling.
- Someone should measure how many documents in a real workspace it would newly
  report, before it lands. If the answer is "many", that is a finding about the
  waiver's history, not a reason to skip it.

## Acceptance Criteria

- [ ] A field of Corpus's set that is **present and malformed** under a
      `.claude/` root is reported by `corpus doc check`
- [ ] A field of Corpus's set that is **absent** is still waived — a
      hand-authored `SKILL.md` or profile with no Corpus block must stay clean
- [ ] The finding is **reported, not blocking**, so no existing file becomes
      unwritable (SERVER-123's regression, and its fix, are the precedent)
- [ ] The count of newly-reported documents in a realistic workspace is measured
      and stated before merge
- [ ] §7:399's claim is either true afterwards or the sentence is corrected —
      whichever, the record says which, and a SPEC edit needs the user's sign-off

## Technical Design

### Files to Create/Modify

- `apps/server/src/core/check.ts` — the waiver, currently all-or-nothing
- `apps/server/src/docs/write.ts` — the reported/blocking partition

### Key Implementation Details

Read `checkCorpus`'s `claudeCodeRoot === null` branch: the §5 finding is emitted
only when the root is absent, which is what makes the waiver total. Splitting
presence from shape means the branch has to ask two questions instead of one.

`isClaudeCodeRequirement` (SERVER-123) is the precedent for how a finding under
these roots is tolerated on the write path while still failing `check`.

### Edge Cases

- A field present but `null` — absent, or malformed?
- `anchors`, whose shape is nested
- A plugin type, which is legal and not in the built-in `type` set

## Testing Strategy

Per-field tests over present-and-malformed, present-and-valid, and absent, under
each `.claude/` root. Falsify by restoring the total waiver and watching only the
present-and-malformed cases go green.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Hand-author the `bogus.md` above; `corpus doc check` reports each malformed
   field
3. Hand-author a profile with no Corpus block at all; `check` stays clean
4. Every write surface still succeeds on both (`doc edit`, `PUT`, archive, bulk)
5. Stop the server; confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-124]` prefix
