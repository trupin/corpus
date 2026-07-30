# [CLI-011] `corpus skill create` (with server write path) + `corpus doc list`

## Domain

cli

## Status

todo

## Priority

P1

## Model

opus — two verbs over write/read paths whose shapes exist; the skill-root write path is the only
new server surface.

## Dependencies

- Depends on: CLI-006, SERVER-019
- Blocks: —

## Spec References

- SPEC.md §7 — skill genesis ("recurring patterns become skills")
- issues/sprints/sprint-014.md — Open Conflicts 1 + 2, Adjudications 8 + 9 (2026-07-28)

## Summary

Filed from sprint-014 Open Conflicts 1 and 2. The comment skill's genesis charter is scoped to
extend-plus-propose this phase because a skill cannot be *created* through the system:
`normalizeDocFolder` forces every `doc create` under `data/docs/`, `doc move` refuses skills, and
no `corpus skill create` exists. Likewise "check the tree" has no CLI verb (filesystem reads are
the sanctioned interim per sprint-013 Adjudication 21 / sprint-014 Adjudication 9).

Ship: (a) a skill-creation write path (server: create a `type: skill` document under
`.claude/skills/<name>/SKILL.md` through the normal mutation pipeline — likely a contract rider
for the route) + `corpus skill create <name>`; (b) `corpus doc list` (paginated wrapper over
`GET /api/docs`, filters passthrough, `--json`). AGENT-003's genesis section upgrades from
propose to create when this lands (AGENT rider), and §7's wording is reconciled at that point.

## Acceptance Criteria

- [ ] `corpus skill create <name>` creates a live skill through the server (auto-commit,
      projection, discoverable by the loop); contract rider if a new route is needed.
- [ ] `corpus doc list` with the collection filters and `--json`; registry-validated; docs
      regenerated.
- [ ] AGENT rider filed/executed to upgrade the genesis charter.

## E2E Verification Log

_Filled in by the implementing agent. State the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
