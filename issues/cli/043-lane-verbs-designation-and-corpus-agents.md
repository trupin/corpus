# [CLI-043] Lane verbs, designation, and `corpus agents`

## Domain
cli

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: [CONTRACT-051], [SERVER-107], [SERVER-108], [SERVER-109]
- Blocks: [AGENT-025], [AGENT-026]

## Spec References
- SPEC.md §7/§8 as amended by SHARED-043 — scoped verbs, designation, the roster

## Summary
The CLI surface for lanes. `corpus queue idle --thread <th_…>` and
`corpus queue claim-all --thread <th_…>` pass `scope` through and otherwise behave exactly
like their unscoped forms (same output shapes, same `--wait`, same `--json`, same held
report — scoped). `corpus thread designate <id> --agent <name>` and
`corpus thread release <id>` drive the designation routes (user-actor verbs).
`corpus agents` lists the roster: one row per lane — resident name, live/lapsed/waiting,
since, and the one-line summary — the same read the composer's droplist consumes.

## Acceptance Criteria
- [ ] `--thread` on `idle`/`claim-all` (`apps/cli/src/commands/queue/idle.ts:83-140`, `claim-all.ts:28-53`): shape-validated `th_` prefix, passed as `scope`; output identical in structure to unscoped (a scoped empty batch prints the same empty-events payload)
- [ ] `corpus thread designate <id> --agent <name>`: renders the resolved `{name, docId}` on success; renders the server's 409 (not standalone), 404 (no such agent-def), 403 (agent actor) reasons verbatim; warns inline when the response carries `status: "archived"`
- [ ] `corpus thread release <id>`: idempotent, prints what was released or that nothing was
- [ ] `corpus agents`: human mode one row per lane — `orchestrator · live · parked 2m — idle` / `th_4b8e2c "Q3 planning" · researcher · live · reading the mortgage docs` / `… · waiting for a listener`; `--json` carries the roster verbatim
- [ ] `corpus thread show <id>` prints the resident line when designated
- [ ] All new verbs registered in the command index with help text matching the existing voice

## Technical Design

### Files to Create/Modify
- `apps/cli/src/commands/queue/idle.ts`, `queue/claim-all.ts` — `--thread`
- `apps/cli/src/commands/thread/designate.ts`, `thread/release.ts` — new
- `apps/cli/src/commands/agents/index.ts` — new top-level `agents` verb
- `apps/cli/src/commands/thread/show.ts` — resident line
- `apps/cli/src/commands/{queue,thread}/index.ts` — registration

### Key Implementation Details
Thin client discipline: no liveness math, no summary derivation — render the server's
fields. `designate`/`release` are user verbs the way `doc delete` is: they do not refuse
the agent client-side (the server owns actors), they just render the 403 honestly.
The scoped idle's expiry payload is unchanged (`{"idle":true,"reason":"timeout"}`) — the
converse skill depends on that stability.

### Edge Cases
- `--thread` naming an undesignated thread on `idle`: the server accepts the park (a lane may be designated moments later) — document that the verb parks on whatever lane it is given; `corpus agents` is where to check the lane is real
- `corpus agents` with zero designations: one orchestrator row, never an empty table

## Testing Strategy
CLI unit tests against stubs: flag pass-through, scoped payload rendering, designation
error surfaces, roster rendering in both modes, registration/help snapshots.

## E2E Verification Plan

### Verification Steps
1. Real server; `corpus thread designate th_x --agent researcher --from user` → resolved row printed
2. `corpus agents` → orchestrator + th_x (`waiting for a listener`)
3. `corpus queue idle --thread th_x` parked in one shell → `corpus agents` shows live; comment in the thread → scoped shell unparks with the event, plain `claim-all` elsewhere returns empty
4. `corpus thread release th_x` → second run prints nothing-to-release

## E2E Verification Log
_Filled in by the implementing agent as proof-of-work._

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0)
- [ ] Committed with `[CLI-043]` prefix
