# [CLI-042] Mutating verbs carry the job they serve

## Domain
cli

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: [CONTRACT-050], [SERVER-106]
- Blocks: [AGENT-025]

## Spec References
- SPEC.md §7 as amended by SHARED-043 — job attribution

## Summary
Expose job attribution on the CLI: a `--job <evt_…>` flag and a `CORPUS_JOB` environment
variable (flag wins) on every mutating verb that creates or edits a document or thread —
`doc create/edit/patch/move/archive/unarchive`, `thread create/reply`. This follows the
`--from`/`CORPUS_FROM` attribution pattern exactly (`define once, spread everywhere`, like
`MODEL_FLAG` at `apps/cli/src/input.ts:128`): a working agent exports `CORPUS_JOB=evt_x`
once at dispatch and every write it makes is provenance-stamped without further thought —
which is what makes stamping reliable rather than remembered. Also expose detach:
`corpus doc detach <id>` clears `origin` (user actor only, server-enforced).

## Acceptance Criteria
- [ ] `JOB_FLAG` defined once beside `MODEL_FLAG`; accepted on the verbs above; value validated shape-only client-side (`evt_` prefix), existence left to the server's 422
- [ ] `CORPUS_JOB` read exactly like `CORPUS_FROM`; `--job` overrides; neither present → field omitted (today's behavior, no default)
- [ ] Server 422 (unknown/settled job) surfaces as the CLI's ordinary contract-error rendering with the server's reason verbatim — never retried, never stripped-and-resent
- [ ] `corpus doc detach <id>` sends the clear-only edit; agent actor gets the server's 403 rendered plainly ("detaching is the user's act")
- [ ] `corpus doc show` prints `origin` when set (one line, `origin th_… · <thread title>` when the projection can title it); `--json` carries the raw field
- [ ] Read verbs take no `--job` (attribution is for writes; a flag on reads would imply meaning it does not have)

## Technical Design

### Files to Create/Modify
- `apps/cli/src/input.ts` — `JOB_FLAG` + env resolution
- `apps/cli/src/commands/doc/*.ts`, `apps/cli/src/commands/thread/create.ts`, `thread/reply.ts` — spread the flag, pass through the generated client
- `apps/cli/src/commands/doc/detach.ts` — new verb
- `apps/cli/src/commands/doc/show.ts` — render origin

### Key Implementation Details
The CLI stays a thin client: no origin computation, no walking, no validation beyond
shape. `queue` verbs (`complete`/`fail`/`defer`) do **not** take `--job` — the event id is
already their positional argument; adding the flag there would invite passing a different
one.

### Edge Cases
- `CORPUS_JOB` set to a settled event because a subagent's environment outlived its work: the server's 422 says so; the error text should hint "unset CORPUS_JOB or pass --job"
- `--job` with `--from user` — legal, passed through; the server decides meaning

## Testing Strategy
CLI unit tests against the route stubs: flag/env precedence, omission, 422 rendering,
detach's 403 path, show's origin line in both modes.

## E2E Verification Plan

### Verification Steps
1. Real server + workspace; enqueue and claim a comment event
2. `export CORPUS_JOB=<evt>`; `corpus doc create --from agent -m "notes" --title "Rates"` → `corpus doc show` prints the origin line
3. `corpus doc detach <id> --from agent` → refused with the server's reason; `--from user` → cleared
4. `CORPUS_JOB=evt_nope corpus doc create …` → 422 rendered with the id

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
- [ ] Committed with `[CLI-042]` prefix
