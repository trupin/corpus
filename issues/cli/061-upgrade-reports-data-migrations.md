# [CLI-061] `corpus upgrade` and `corpus workspace upgrade` report the data migrations a workspace needs, as commands an agent can run

## Domain
cli

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: CONTRACT-077, CLI-062
- Blocks: —

## Spec References
- SPEC.md §2.4 — "Upgrading" (rider 8: migrations reported as commands, never performed)
- SPEC.md §11 — boards as documents

## Summary
Phase 41 removes `pinned` and stops reading `order` on views. An existing workspace has three seed views and possibly more that carry both, and after the upgrade its board is empty. The user's decision (2026-08-22): no silent migration; the upgrade commands say what to do, written for the agent that runs them. This issue adds a **migration registry** to the CLI — each entry a detector over the workspace's files and an instruction writer — and a **migrations** section in both upgrade reports. The first entry is "pinned views without a board". Every later breaking change adds an entry; the registry is the rule.

## Acceptance Criteria
- [ ] `corpus workspace upgrade` and `corpus upgrade` end with a `migrations` section, listed distinctly from updates and conflicts, in the same agent-readable shape conflicts use (one block per migration, a one-line statement of what the tool no longer reads, then the commands, one per line, ready to paste).
- [ ] Detection reads `data/docs/**/*.md` frontmatter from disk, read-only, with the server stopped or running.
- [ ] Migration `views-to-board`: fires when any `type: view` document carries `pinned: true` or `order` **and** no `type: board` document lists it. Instructions: one `corpus doc create --type board --title Board --columns <ids in the views' order>` when no board exists, or `corpus doc edit <board> --columns <existing + missing>` when one does; then one `corpus doc edit <view> --unset pinned --unset order` per view. The stated order follows the views' `order`, nulls last, then title.
- [ ] The section is empty and says so when nothing fires; the exit code is unchanged by migrations (a migration is the agent's work, not the upgrade's failure).
- [ ] `--json` (if the upgrade commands have it; add it if not) carries `migrations: [{ id, statement, commands: [] }]`.
- [ ] The registry has a unit test per entry and a test that an entry with no detector hit prints nothing.

## Technical Design

### Files to Create/Modify
- `apps/cli/src/migrations/registry.ts` — `interface Migration { id; detect(workspace): Hit | null; instruct(hit): string[] }`
- `apps/cli/src/migrations/views-to-board.ts` — the first entry
- `apps/cli/src/commands/upgrade/index.ts` and `apps/cli/src/commands/workspace/upgrade.ts` — the section, after the conflicts block
- `apps/cli/src/migrations/*.test.ts`

### Key Implementation Details
- Frontmatter reading uses the same YAML library the server uses (§5: never hand-rolled); the CLI already depends on it for `init`.
- Instructions are printed as the exact argv a person or agent pastes; quote titles.
- The report wording follows §2.4's existing voice: "These files are written for a version of the tool that no longer reads them as they are. Run the commands below, or ask the agent to."

### Edge Cases
- A view listed by an archived board: still counts as listed (the board can be restored).
- Views with `pinned: false` and no `order`: nothing to do; the key is harmless in `extra`, but the instruction still offers `--unset pinned` as a tidy-up under a separate "optional" line.

## Testing Strategy
Vitest with temp workspaces: seed files with `pinned`, with and without a board, archived board, no views.

## E2E Verification Plan
### Verification Steps
1. `corpus init` with the *previous* template (check out the v0.16.0 seeds into a temp workspace), install this build, run `corpus workspace upgrade`.
2. The report's migrations section names the three seed views and prints the `doc create --type board` and three `--unset` commands.
3. Paste them with the server running; run the upgrade again; the section is empty.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-061]` prefix
