# [AGENT-021] The agent states the model that wrote the turn

## Domain

agent-runtime

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CLI-033 (the flag), CONTRACT-043 + SERVER-074 (done)
- Blocks: the SHARED-027 feature being true rather than merely possible

## Spec References

- SPEC.md **§11** — "An agent turn says which model wrote it… the turn names the
  model of the **deciding** stage"
- SPEC.md **§7** — work may be split into stages at different weights; the
  deciding stage runs at the governing weight

## Summary

CLI-033 makes it possible to state a model. This makes the agent do it, which is
what turns the chip from an empty space into the answer the user asked for.

**The rule is already fixed by the signed rider, so this issue implements rather
than decides**: the turn names the model of the **deciding** stage — the one that
drew the conclusion or wrote the words, which is the stage carrying the
consequence (§7). Where a request ran in stages, the collecting stages do not
appear on the turn; the full per-stage account stays in the job's log while it
lasts.

## Acceptance Criteria

- [ ] Every agent turn the skill posts states the model that wrote it
- [ ] Where work was **split** (§7), what is stated is the **deciding** stage's
      model, not the first stage's and not a list
- [ ] The agent states what actually ran, never what was asked for. A stated
      weight is a directive (§7, CONTRACT-039); this is a fact about what
      happened. Conflating them makes "honoured, not weighed again"
      unverifiable, and the skill should say so in one line so the distinction
      survives a later edit
- [ ] When the agent genuinely does not know, it states **nothing** — §11 wants
      an absence rather than a plausible attribution nobody can check. An
      instruction to "state your best guess" would be the exact failure
- [ ] `scripts/workspace-template.test.ts` passes and pins the rule

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/comment/SKILL.md` and/or
  `assets/workspace/claude/skills/orchestrate/SKILL.md` — whichever owns posting
  a turn — plus the frontmatter `updated` timestamp, and the test.

### The skill-file constraints that bite

**Re-verify against the test rather than trusting these numbers**:

- Exact section counts: **16** orchestrate, **13** comment. Prefer editing in
  place; a new `## ` section is a two-file change.
- Both counters are now **fence-aware** (AGENT-020 made orchestrate's match the
  comment skill's), so a `## ` inside a fenced example is safe in either file —
  this is a recent change and worth confirming rather than assuming.
- Every `## ` body must exceed 400 characters after trimming.
- Banned hedges: `use your judgment`, `consider whether`, `you may want`,
  `if appropriate`. Banned strings: `SPEC.md`, `CLAUDE.md`, `issues/`.
- Quoted heredocs for multi-line shell arguments; `-m "$(` banned.
- `EXPECTED_TREE` is exhaustive equality.
- `## The loop` in orchestrate deliberately contains **no fenced block** and a
  test asserts it (AGENT-019). Do not reintroduce one.

### Notes

- The worked examples post turns. If they show a reply without stating a model,
  they teach the opposite of the rule — check every one of them, since an
  example that contradicts a rule beats the rule.

## Testing Strategy

`scripts/workspace-template.test.ts` is the surface. Pin the rule, the
deciding-stage clause, and the state-nothing-when-unknown case.

## E2E Verification Plan

Through the product: `corpus init` a scratch workspace from the built package on
a non-default port (**never 8765**, **never 5173**), run the real agent loop,
have it answer a comment, and confirm the turn on disk carries a `turnModels`
entry and the board shows the chip. Then a staged request, confirming the
deciding stage's model is the one recorded.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-021]` prefix
