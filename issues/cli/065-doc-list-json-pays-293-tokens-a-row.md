# [CLI-065] `doc list --json` pays 293 tokens a row against 25 for the human row

## Domain
cli

## Status
todo

## Priority
P1 (important)

## Model
opus

## Dependencies
- Depends on: — (contract change may be needed for server-side field selection;
  if so, split a CONTRACT issue rather than widening this one)
- Blocks: —

## Spec References
- SPEC.md Section 7 — reflecting on the corpus gathers the window with `doc list`
- SHARED-070 audit report — `issues/evals/SHARED-070-token-audit.md`

## Summary

Measured in the SHARED-070 audit (2026-08-23, 20-document workspace):

- `corpus doc list` (human): 497 tokens for 20 rows — **25 tok/row**
- `corpus doc list --json`: 5,864 tokens for the same 20 rows — **293 tok/row,
  11.7×** — because every item carries ~25 fields including the full `excerpt`
  and `lastTurn` bodies, `kanban`, `columns`, `attention`, `snippets`, whether
  or not the caller wants them. Words understate this surface 4.9× (1,295 words
  → 6,361 tokens), so Phase 39's word counting never saw it.

The cost is on the loop's hot path: the orchestrate skill's reflection
procedure directs the agent to `corpus doc list --json` because **only the JSON
carries `lastActor`** — the one field reflection needs to skip its own writes.
At 500 documents a single reflection's window read is ~147k tokens. The agent
pays 268 tok/row for fields it wants one of.

## Acceptance Criteria
- [ ] The reflection path can read its window without paying for excerpts and
      turn bodies. Two acceptable shapes — pick one and state why:
      1. `lastActor` joins the human row (one short token per row), and the
         orchestrate skill's reflection text is updated by agent-runtime to
         drop `--json` there (coordinate, do not edit `assets/` from this
         issue), or
      2. `--json` gains field selection (`--fields id,title,lastActor,updated`)
         with the full object remaining the default.
- [ ] Measured before/after on a 20-doc workspace in the issue log: target
      ≤ 40 tok/row for the reflection read.
- [ ] No existing consumer breaks: the UI does not use the CLI, and the full
      `--json` object stays available unchanged.

## Technical Design

### Files to Create/Modify
- `apps/cli/src/commands/doc/list.ts` — human row or `--fields` filtering
- (option 2, if server-side) `packages/contract` — split to a CONTRACT issue

### Key Implementation Details
Field selection can be CLI-side filtering of the server response with zero
contract change — the tokens are paid on the agent's context, not on the wire.
That makes option 2 cheap: parse `--fields`, project each item, print. Option 1
is smaller still but touches the human format other readers may parse.

### Edge Cases
- `--fields` naming an unknown field: usage error listing the known ones
  (exit 2), before any request.
- `--fields` with pagination lines: keep the trailing "showing X–Y of Z" line —
  the skill reads it to page.

## Testing Strategy
CLI unit tests: projection, unknown field, interaction with `--json` absent
(usage error: `--fields` requires `--json`, or define it for human mode too —
decide and test).

## E2E Verification Plan
Real workspace with 20 docs: run the reflection read both ways, count tokens
with the audit's scripts, confirm the target.

### Verification Steps
1. Scratch workspace, seed 20 documents
2. `corpus doc list --json --fields id,title,lastActor,updated` (or the human
   row with `lastActor`)
3. Expected: ≤ 40 tok/row, `lastActor` present, pagination line intact

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
