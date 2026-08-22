# [CLI-060] Board flags, `--stage`, `--unset`, and `corpus folder` verbs; `--pinned` and view `--order` go

## Domain
cli

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-074, CONTRACT-075, CONTRACT-076, SERVER-135, SERVER-136, SERVER-137
- Blocks: CLI-061, AGENT-042 (skill text cites the verbs)

## Spec References
- SPEC.md §2.3 — "The `corpus` CLI — one registry, self-documenting"
- SPEC.md §9.2 — folder routes, the document row
- SPEC.md §11 — boards as documents, kanban boards

## Summary
The agent's whole surface is the CLI, and the agent must be able to build a board, a kanban, and a stage change with it. This issue adds the flags for every new field, removes the two that no longer exist, adds `--unset <key>` (the migration in CLI-061 needs it), and adds `corpus folder rename|archive|unarchive|delete`. `docs/cli.md` regenerates from the registry.

## Acceptance Criteria
- [ ] `corpus doc create --type board --title T [--columns id,id] [--order N] [--default-open] [--kanban '<json>'] [--query '<json>']`.
- [ ] `corpus doc edit <id> --columns id,id | --order N | --default-open true|false | --kanban '<json>' | --stage <value> | --unset <key> [--unset <key>...]`; `--unset` removes a frontmatter key (core or extra) and refuses for `id`, `type`, `created`.
- [ ] `--pinned` is gone from create, edit and the list filters; `--order` is gone from views' documentation and is documented as a board's position; passing `--pinned` fails with "removed in <version>: a board lists its columns — see `corpus upgrade`".
- [ ] `corpus doc list --stage <value>` filters; `corpus doc show` prints `stage`, `columns`, `kanban`, `default-open`, `order` when present.
- [ ] `corpus folder rename <from> <to>`, `corpus folder archive <path>`, `corpus folder unarchive <path>`, `corpus folder delete <path> --yes`; `delete` without `--yes` prints the documents it would delete and exits 2; every verb prints the documents the server reported, one per line, token-frugal like `doc list`.
- [ ] When a `--stage` edit's response reports a status change too, the output says so on its own line.
- [ ] `corpus reflect` asks for a reflection now (`POST /api/workspace/reflect`, CONTRACT-076): prints the event id and the window's `since`; on `409` prints the pending event id and exits 0 (asking for what is already happening is not an error). `corpus reflect --status` prints the clock, the pending state, the changed count and the quiet window from `GET /api/workspace/reflect`.
- [ ] Registry-driven `--help` at all levels; `docs/cli.md` regenerates with no diff; the drift check passes.

## Technical Design

### Files to Create/Modify
- `apps/cli/src/commands/doc/create.ts`, `edit.ts` (lines ~291-529 hold `--pinned`/`--order` today), `filters.ts` (lines ~29, 73)
- `apps/cli/src/commands/folder/{rename,archive,unarchive,delete,index}.ts` — new
- `apps/cli/src/registry.ts` (or wherever verbs register) — the `folder` topic
- `docs/cli.md` — regenerated
- tests beside each, plus the registry parity test

### Key Implementation Details
- `--kanban` and `--query` take JSON because the shapes are nested and the agent writes JSON without ceremony; the help text shows one complete example each.
- `--unset` goes through the update route as an explicit "remove key" — coordinate with SERVER-135 for the body form (`{ unset: ["pinned", "order"] }` beside `changes`).
- `folder delete --yes` is the CLI's own guard; the server has none (§11: deletion asks in the UI).

### Edge Cases
- `--columns ""` sets an empty list (a board with no columns, which Files is); `--unset columns` removes the key.
- `--stage ""` is a refusal; use `--unset stage` to clear.

## Testing Strategy
Vitest with the typed client against a stub app for argument parsing and output; the registry parity test already guards help drift.

## E2E Verification Plan
### Verification Steps
1. Real server. Create a kanban board with `--kanban`, edit a document's `--stage`, see the status line in the output.
2. `corpus folder rename inbox triage` → output lists moved ids; `corpus folder delete triage` → exit 2 with the list; `--yes` → deleted.
3. `npm run docs:cli` (or the repo's generator) → no diff.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[CLI-060]` prefix
