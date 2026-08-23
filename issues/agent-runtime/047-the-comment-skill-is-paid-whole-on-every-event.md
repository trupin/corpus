# [AGENT-047] The comment skill is paid whole on every event

## Domain
agent-runtime

## Status
todo

## Priority
P1 (important)

## Model
fable

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md Section 7 — the agent loop: every claimed event is dispatched to a subagent
- SHARED-070 audit report — `issues/evals/SHARED-070-token-audit.md`

## Summary

Measured in the SHARED-070 audit (2026-08-23, real loop, 6 events):
`assets/workspace/claude/skills/comment/SKILL.md` is **15,228 tokens (10,401
words)**, and a dispatched subagent reads it whole on **every** `comment.created`
and `form.respond` event before its first command runs. The same event's entire
CLI traffic was 376–2,254 tokens. On a 30-event day this one file is ~457k
tokens — **56% of everything the loop spends**, the largest single cost in the
product, and no Phase 39 issue touched it.

The dispatch prompt makes it worse by restating the orchestrate skill's
binding-rules block (1,028 tokens) while the comment skill's own "Inherited
invariants" section restates the same invariants again (593 tokens) — ~1.6k
tokens of duplication per event.

Most of the file is context a given event never uses. Measured section sizes:
worked examples 1,758 tok, Forms 1,600, Reply (mostly fence mechanics) 1,960,
Engagement and closure 1,054, Skill genesis 979, Inbox filing 610. An anchored
one-line patch event uses perhaps a third of the document.

## Acceptance Criteria
- [ ] The per-event fixed payload (SKILL.md body + what the dispatch prompt is
      told to restate) is reduced, with the before/after measured in tokens and
      words on the shipping files.
- [ ] The mechanism is progressive disclosure, not deletion: rarely-needed
      grammars (forms, fence widths, skill genesis, worked examples) move to
      `references/` files beside the skill that the subagent reads only when the
      event needs them, each named from the core text at the point of need.
- [ ] The invariants exist in exactly one place: either the dispatch prompt
      carries them or the skill restates them — not both. The orchestrate
      skill's Delegation section and the comment skill's Inherited invariants
      section are reconciled accordingly (this is a cross-file edit inside
      `assets/workspace/`, owned by this domain).
- [ ] No behavioral rule is weakened or dropped — the restructure moves text,
      it does not rewrite obligations. The evaluator scenario set for comment
      handling still passes.
- [ ] The estimated saving is verified: target ≥ 40% off the per-event fixed
      payload (from ~16.8k to ≤ ~10k tokens).

## Technical Design

### Files to Create/Modify
- `assets/workspace/claude/skills/comment/SKILL.md` — core loop only
- `assets/workspace/claude/skills/comment/references/*.md` — forms grammar,
  fence mechanics, skill genesis, worked examples
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the dispatch-prompt
  contract half of the deduplication

### Key Implementation Details
The asd-ste100 skill already ships the pattern: a small SKILL.md with
`references/` and `examples/` read on demand. Keep every pointer explicit ("the
form grammar is in `references/forms.md`; read it before posting a form") so the
disclosure is a directed read, not a discovery problem. Measure with the audit's
scripts (`scratchpad/audit/skills-audit.mjs` pattern: word count + gpt-tokenizer).

### Edge Cases
- A reference file the runtime fails to read is worse than inline text: each
  moved section must be one the event type makes optional, never one every
  event needs.
- Skills are documents the agent itself edits (skill genesis); the references
  are documents too and must carry both frontmatter vocabularies if created
  through the server, or be plain template files installed by `corpus init` —
  decide and state which.

## Testing Strategy
Token/word counts before and after, committed in the issue log. Existing
workspace-template tests (`corpus init` manifest) updated for the new files.

## E2E Verification Plan
Run the SHARED-070 loop shape (one anchored comment, one filing, one form) in a
fresh workspace against the restructured skills; capture the invocations; verify
the worked behavior is unchanged and the per-event fixed payload dropped by the
target.

### Verification Steps
1. `corpus init` a scratch workspace with the new template; `corpus server start`
2. Post an anchored comment requesting an edit; run the loop per the skills
3. Expected: same replies, same trace lines, same settlements; SKILL.md read
   ≤ ~10k tokens; references read only on the events that need them

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
