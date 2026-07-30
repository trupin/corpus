# [CLI-016] `corpus doc edit --extra <key>=<value>`: agent-writable extra frontmatter

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
- SPEC.md §11 — view width stored in the view doc's frontmatter, agent-stewardable ("@agent make the finance column wider")
- SPEC.md §7 — the agent mutates only via the CLI

## Summary
UI-019's escalation (sprint-016 TEST-455, Adjudication 23): §11 promises the agent can
widen a column, but `corpus doc edit` exposes no way to write an arbitrary `extra`
frontmatter key — `--extra` appears nowhere in docs/cli.md; `extra` is read-only output.
Since the agent is CLI-only, the stewardability promise is unreachable. The server side
already works (`PUT /api/docs/{id}` merges `{extra: {...}}` per RFC 7386 — UI-019 proved
it end to end), so this is a CLI-only verb surface: `corpus doc edit <id> --extra
width=520` (repeatable flag; typed value parsing decided per the registry's conventions
— at minimum numbers, strings, and `null` to delete a key per RFC 7386). No contract
change expected; verify.

## Acceptance Criteria
- [ ] `--extra key=value` (repeatable) writes through the existing PUT; merge semantics match RFC 7386 incl. `key=null` deletion
- [ ] Reserved/core frontmatter keys refused locally with a usage error naming the real flag (`--title`, `--status`, …)
- [ ] docs/cli.md regenerated; hygiene inventories updated
- [ ] E2E: agent sets `width` on a view doc via CLI; the board reflects it over SSE with no UI change (UI-019's log documents the read path)

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/doc/edit.ts` (+ tests), docs/cli.md

## Testing Strategy
apps/cli scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real server + scratch workspace (job tmp dir, init from outside the repo, ports 9180-9199, never 8765): CLI width write → frontmatter shows it beside pinned/order/query → browser reflects it.

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
