# [AGENT-028] Two product skills still say the empty tree is the repository's first commit

## Domain

agent-runtime

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-113 (which changed the behaviour)
- Related: CONTRACT-052, CLI-045 (the same sentence, fixed in the published
  contract and the CLI help)

## Spec References

- SPEC.md **§4** — commit windows are party-scoped; each document's diff is
  path-scoped

## Summary

`SERVER-113` changed the diff base to *the previous commit that touched this
document*, with git's empty tree when there is none. A consequence nobody
predicted at the time: **every document's first change now diffs against the
empty tree**, where previously that was an exotic case.

`CONTRACT-052` corrected the published contract, `CLI-045` corrected the CLI
help — and its sweep found the same too-narrow framing surviving in two skills
that `corpus init` installs into a user's workspace:

- `assets/workspace/claude/skills/orchestrate/SKILL.md:937` — "empty-tree sha
  carried by a document **the repository's first commit** introduced"
- `assets/workspace/claude/skills/comment/SKILL.md:358` — reads correctly under
  the new rule, but was flagged as worth a second look

**This is product text, not repository documentation.** It is what a user's
agent reads to decide what a diff means, and it currently tells that agent the
empty-tree base is a rarity it will almost never see, when it is now the
ordinary shape of a document's first change. An agent that treats it as
anomalous may report it as one.

The fourth surface of the same sentence, and worth noting as a pattern: this
rule has now been found stale in the spec (`SHARED-045`, unsigned), the
contract, the CLI, and the skills. One behavioural change, four places that
described it.

## Acceptance Criteria

- [ ] `orchestrate/SKILL.md` states the rule correctly: the base is the previous
      commit that touched this document, and the empty tree is the ordinary case
      for a document's first change
- [ ] `comment/SKILL.md:358` is read against the new rule and either corrected
      or confirmed correct in the report — do not leave it ambiguous
- [ ] Wording matched to `packages/contract/src/schemas/edit.ts` rather than
      phrased a fifth time
- [ ] Pinned in `scripts/workspace-template.test.ts`, as AGENT-025's and
      AGENT-027's text is — the defect is documentation drifting from behaviour,
      and it has now recurred four times

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md`
- `assets/workspace/claude/skills/comment/SKILL.md`
- `scripts/workspace-template.test.ts`

## Testing Strategy

Template assertions. No drill: no behaviour changes, and SERVER-113's plumbing
is already covered by its own regression tests.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-028]` prefix
