# [CLI-053] `corpus thread designate` names a weight, and `corpus agents` prints it

## Domain

cli

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-067, SERVER-129
- Blocks: AGENT-039 (the roster line the orchestrator reads)
- Related: SHARED-055 (signed 2026-08-19)

## Spec References

- SPEC.md **§7** — *"A resident's weight is set when it is designated, not per message"* (rider signed 2026-08-19)
- SPEC.md **§7** — the weight rider

## Summary

CONTRACT-067 and SERVER-129 let a designation carry a weight level and report it back. This is the CLI half, both directions:

- `corpus thread designate <id> [--agent <name>] --weight <key>` sends it. Omitting `--weight` keeps today's behaviour exactly. The flag name is `--weight` — the same word a message's `weight` field uses, because it is the same vocabulary (the workspace's tier-table keys: `light`, `standard`, `heavy` in the shipped skill, but whatever the workspace declares).
- `corpus agents` prints it on the resident cell, so the orchestrator reading the roster (AGENT-039) and a person at a terminal both see what a lane runs at. `corpus thread show` (or whatever prints a thread's resident) prints it too.

## Acceptance Criteria

- [ ] `corpus thread designate <id> --weight heavy` designates with that weight; `--help` documents the flag and says the word comes from the workspace's own weight table, never a model name
- [ ] Omitting `--weight` designates with none, byte-identical output to today
- [ ] `corpus agents` shows the weight beside the resident, e.g. `researcher (doc_b7c1d5) · heavy`, and shows nothing extra when it is null — **no invented word** for null, the same rule `Resident.name` already carries
- [ ] The designate confirmation line names the weight when one was given
- [ ] The snapshot tests in `__snapshots__` are re-derived by running, not hand-edited (AGENT-036's rule)
- [ ] The CLI does not validate the key against the table — the server stores what the contract accepts, and the launcher reports a level it cannot meet (§7)

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/thread/designate.ts` (+ test)
- `apps/cli/src/commands/agents.ts`, `resident.ts` (+ tests)
- `apps/cli/src/help.ts` if flags are documented centrally

### Key Implementation Details

Read `resident.ts`'s `residentLabel` — it is the one rendering of a resident the CLI has, and the weight belongs there so every verb prints it the same way. Read `agents.ts:129` for the cell layout.

### Edge Cases

- `--weight ""` — refuse as the server does (a blank is a mistake, not absence)
- A lane whose resident lapsed — the weight still prints; presence is a separate cell

## Testing Strategy

Unit tests through the CLI's dispatch against a mocked client, plus one real-server test if the workspace has the fixture for it.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. `corpus thread designate <id> --weight heavy` → confirmation names `heavy`
3. `corpus agents` → the lane shows `heavy`
4. Designate another thread with no weight → roster shows no weight token
5. Stop the server, confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CLI-053]` prefix
