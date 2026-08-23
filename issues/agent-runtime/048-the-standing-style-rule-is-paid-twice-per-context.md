# [AGENT-048] The standing style rule is paid twice per context

## Domain
agent-runtime

## Status
todo

## Priority
P2 (nice-to-have)

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SHARED-070 audit report — `issues/evals/SHARED-070-token-audit.md`
- AGENT-037 — the product ships its own copy of the asd-ste100 skill

## Summary

The workspace CLAUDE.md makes `asd-ste100/SKILL.md` a standing rule for every
text the agent writes: *"Every text you produce for a person follows
`.claude/skills/asd-ste100/SKILL.md`"*. Read literally, that directs every
context — the orchestrator session and each dispatched subagent — to open the
skill: **3,366 tokens per context**, ~111k tokens on a 30-event day (rank 2 in
the SHARED-070 audit).

But CLAUDE.md itself already carries the digest that matters in practice: the
eight structural bullets, the hedge rule and the quotation rule — 891 tokens,
already in every context for free. The full skill adds the rationale, the
lexical direction, and the scan checklist — material a subagent writing a
three-sentence reply does not need. The cost is a full second copy of guidance
whose operative half is already present.

## Acceptance Criteria
- [ ] Workspace CLAUDE.md states explicitly that its own digest is sufficient
      for ordinary writing, and that the skill body is read only when a person
      invokes it by its triggers or when a rewrite task genuinely needs the
      dictionary-level rules.
- [ ] The digest in CLAUDE.md is verified to be self-sufficient: the hedge
      rule and the quotation rule stay in it at full strength (they are the two
      rules the skill calls load-bearing).
- [ ] The change is text in `assets/workspace/` only. The dev harness's copy
      of this arrangement (root CLAUDE.md) is out of scope.
- [ ] Before/after measured: contexts that follow the new wording no longer
      open the skill on ordinary events (verify by running a loop event and
      capturing reads).

## Technical Design

### Files to Create/Modify
- `assets/workspace/CLAUDE.md` — one paragraph making the digest authoritative
  for ordinary writing

### Key Implementation Details
Keep the standing rule standing — the change is *which text carries it*, not
whether it applies. Wording must not invite skipping the rules themselves.

### Edge Cases
- A person invoking the skill by name (`/asd-ste100`, "STE100 rewrite") still
  gets the full skill — the frontmatter description already covers that path.

## Testing Strategy
Template word/token counts re-run; no behavioral tests exist for prose style.

## E2E Verification Plan
Run one comment event in a fresh workspace; confirm the reply still follows the
structural rules and the skill body was not read.

### Verification Steps
1. `corpus init` scratch workspace, post a comment, run the loop
2. Expected: STE-shaped reply; no read of `asd-ste100/SKILL.md` in the transcript

## E2E Verification Log
_Filled in by the implementing agent._

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
