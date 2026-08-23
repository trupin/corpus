# [SERVER-145] A settled event can be settled again, in either direction

## Domain
server

## Status
todo

## Priority
P1 (important)

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md Section 7 — the queue's states; complete and fail "reach a terminal state"
- SHARED-070 audit report — `issues/evals/SHARED-070-token-audit.md`

## Summary

Found while auditing the error surface (2026-08-23, v0.19.0, real workspace).
Against an event already in `processed/`:

```
$ corpus queue fail evt_mclfojov3lqm
event evt_mclfojov3lqm is failed.        # exit 0 — processed → failed
$ corpus queue complete evt_mclfojov3lqm
event evt_mclfojov3lqm is complete.      # exit 0 — failed → processed
```

Two defects in one verb pair:

1. **Terminal states are not terminal.** A processed event was re-settled to
   `failed` and back, exit 0 both times, no warning. The orchestrate skill's
   invariant 4 calls these states terminal, and the console's story of a job
   flips with each call. A stray or duplicated settling call (the exact hazard
   the reconciliation section exists for) silently rewrites history.
2. **`corpus queue fail` accepted no `--reason`.** The skill treats the reason
   as what the operator reads in the failed row, and its examples always pass
   one — the CLI let the flag be omitted entirely, so a failed row can exist
   with nothing to say why.

`corpus thread resolve` on a resolved thread already shows the right pattern:
"already resolved", nothing changes.

## Acceptance Criteria
- [ ] `queue complete`, `queue fail` and `queue defer` against an event in a
      terminal state (`processed`, `failed`, `abandoned`) are refused with a
      message naming the state it is already in, and a nonzero exit — or, if
      the spec is read to permit re-settling (e.g. `job retry` semantics), the
      allowed transitions are written into SPEC §7 and enforced; everything
      else refused. Pick one, with the spec updated to match.
- [ ] `queue fail` without `--reason` is a usage error (exit 2), matching how
      `queue defer` treats `--blocked-on`.
- [ ] `job retry` / `job abandon` — the deliberate verbs for moving a failed
      event — keep working unchanged.
- [ ] The orchestrate skill's text needs no change (it already assumes
      terminality); verify rather than edit.

## Technical Design

### Files to Create/Modify
- `apps/server/src/` — queue settle handlers (state check before move)
- `apps/cli/src/commands/queue/fail.ts` — require `--reason` (coordinate: if
  this half is judged a contract/CLI change, split it out rather than doing it
  from the server domain — escalate to the orchestrator for the split)

### Key Implementation Details
The server owns queue state; the check belongs there so the HTTP surface is
covered too, with the CLI mapping the refusal to its usual exit-5 rendering.
Response should name the current state: `event evt_… is already processed`.

### Edge Cases
- Settling an event id that never existed — today's behavior (404/422) stays.
- `defer` on a terminal event: refused the same way.
- Double-`complete` of the same event (the common accident): second call
  refused with "already processed" — and that message must stay cheap, one
  line, since the audit showed refusals are read in full.

## Testing Strategy
Server unit tests over the settle handlers: each terminal state × each settle
verb → refusal; pending/in-progress transitions unchanged. CLI test: `queue
fail` without `--reason` exits 2 before any request.

## E2E Verification Plan
Real workspace: claim and complete an event, then `queue fail <id>` — expect a
one-line refusal naming `processed`, nonzero exit, state unchanged in
`job list`.

### Reproduction Steps (bugs only)
1. Scratch workspace, server up; enqueue and work one event to `processed`
2. `corpus queue fail <id>` (no `--reason`)
3. Expected: refusal
4. Actual (2026-08-23): exit 0, event now `failed`; `queue complete <id>`
   returns it to `processed`

### Verification Steps
1. Restart server after the change, repeat
2. Expected: refusal naming the current state; `job retry`/`job abandon`
   unaffected

## E2E Verification Log
_Filled in by the implementing agent._

### Reproduction (bugs only)
_[Agent fills]_

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
