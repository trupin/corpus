# [AGENT-004] Teach the product agent to emit `↳` trace lines in its turns

## Domain

agent-runtime

## Status

todo

## Priority

P2

## Model

opus — skill-text authoring against an already-rendered UI convention.

## Dependencies

- Depends on: AGENT-002 (orchestrate skill), SHARED spec amendment (trace grammar)
- Blocks: —

## Spec References

- SPEC.md §6/§7 (agent turns) — **currently defines no trace grammar; the phase-3 spec pass
  proposes it** (a trailing agent-turn line beginning with `↳` naming what the agent did)
- UI-008 (2026-07-28): the thread view already renders a trailing `↳` line as a styled trace
  (arrow re-supplied from CSS), but nothing in the product writes one

## Summary

UI-008 shipped the reader's side of a convention the runtime doesn't have yet: an agent turn
whose last line begins with `↳` renders as a trace ("what I did"), styled distinctly. This issue
teaches the orchestrate/comment skills (assets/workspace) to end action-taking turns with such a
line, once the spec pass lands the grammar. If the spec pass rejects the grammar, close this and
strip the UI affordance instead.

## Acceptance Criteria

- [ ] Skills emit `↳ <past-tense action summary>` as the final line of turns that performed
      writes (per the spec amendment's exact grammar).
- [ ] E2E: a real agent run produces a turn the shipped UI renders as a trace.

## E2E Verification Log

_(to be filled by the implementing agent)_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
