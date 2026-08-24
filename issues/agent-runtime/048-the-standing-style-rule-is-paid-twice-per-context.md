# [AGENT-048] The standing style rule is paid twice per context

## Domain
agent-runtime

## Status
done

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
- [x] Workspace CLAUDE.md states explicitly that its own digest is sufficient
      for ordinary writing, and that the skill body is read only when a person
      invokes it by its triggers or when a rewrite task genuinely needs the
      dictionary-level rules.
- [x] The digest in CLAUDE.md is verified to be self-sufficient: the hedge
      rule and the quotation rule stay in it at full strength (they are the two
      rules the skill calls load-bearing).
- [x] The change is text in `assets/workspace/` only. The dev harness's copy
      of this arrangement (root CLAUDE.md) is out of scope.
- [x] Before/after measured: contexts that follow the new wording no longer
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

_Implementing agent: agent-runtime-dev on **claude-fable-5**, 2026-08-23._

### What shipped

`assets/workspace/CLAUDE.md` only. The opening rule now reads "follows the STE-flavored
rules below, taken from `.claude/skills/asd-ste100/SKILL.md`" (path kept, obligation
redirected to the digest), and a new paragraph makes the digest authoritative: **"This
digest is the rule, not a summary of one you still owe a read"** — the skill body is opened
in exactly two cases (a person invoked it by its triggers, or the task is itself a rewrite
needing the dictionary-level rules and the scan checklist) — closing with **"Skipping the
read never means skipping the rules"**, so the wording cannot be read as licence to skip
the rules themselves. The two load-bearing exemptions (hedge strength, quotations) are
untouched and their pins still pass.

### Measured

- `CLAUDE.md`: 661 w / 892 t → 758 w / 1,004 t (+112 t per context, buying the removal of a
  3,366 t skill read per context — net ≈ −3,254 t/context, ~−107k on the audit's 33-context
  day).
- **Live runs** (the criterion's capture): two real `claude -p --model sonnet` subagents
  worked real queue events in a fresh workspace installed from this template (transcripts
  `scratchpad/audit/e2e-evt1-transcript.jsonl`, `e2e-evt2-transcript.jsonl`). **Neither
  context read `asd-ste100/SKILL.md`** — the string appears only in the runtime's
  slash-command roster line, never in a Read/Bash tool call. Both replies follow the
  structural rules (active voice, no semicolons in prose, short sentences).

### Guard

New pin in the workspace-CLAUDE.md describe: `makes the digest the rule, and the skill body
a directed read`, asserting all four sentences above. 486/486 template tests pass.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
