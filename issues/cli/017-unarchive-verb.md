# [CLI-017] `corpus doc unarchive`: the agent's promised recovery path doesn't exist

## Domain
cli

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CLI-003
- Blocks: —

## Spec References
- SPEC.md §7 — agent is CLI-only; skill genesis (409 on archived names, "unarchive it to bring it back")

## Summary
Sprint-016 evaluator MAJOR finding (AGENT-P5W2-eval.md, 2026-07-30): the comment skill
and the server's own 409 message tell the agent to "unarchive" an archived skill, but
`corpus doc unarchive` does not exist, and the near-miss `corpus doc edit --status
open` reports success while producing a half-state: frontmatter flips to open but the
folder stays in `.claude/skills-archived/` and the name stays 409-blocked. The
unarchive route exists over HTTP (`POST /api/docs/{id}/unarchive`) — the CLI-only agent
just can't reach it. Two fixes, both in scope: (a) add the thin `corpus doc unarchive
<id>` verb; (b) decide what `doc edit --status open` on an archived doc should do —
refuse with a pointer to the unarchive verb (recommended: the half-state is a lie) or
perform the full unarchive. Regenerate docs/cli.md.

## Acceptance Criteria
- [ ] `corpus doc unarchive <id>` round-trips the HTTP route; archived skill → installed path restored, name freed (409 gone)
- [ ] `doc edit --status open` on an archived doc no longer produces the half-state (refusal naming the verb, or full unarchive — decide and justify)
- [ ] docs/cli.md + hygiene inventories updated; the comment skill's "unarchive it" instruction becomes executable verbatim
- [ ] E2E: archive → 409 on create → unarchive via CLI → create of the same name refused-as-installed / rollback works

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/doc/unarchive.ts` (+ test), doc index wiring, edit.ts guard, docs/cli.md

## Testing Strategy
apps/cli scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real server + scratch workspace (job tmp dir, init from outside the repo, ports 9180-9199, never 8765): the archived-skill recovery cycle end to end.

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
