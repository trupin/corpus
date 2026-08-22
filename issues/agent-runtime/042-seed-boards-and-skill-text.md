# [AGENT-042] Seed boards and a kanban; the skills and template say "a board is a document"

## Domain
agent-runtime

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SHARED-064 (riders 2, 5, 6, 9 signed); CLI-060 for the verbs the skill text cites; SERVER-137 for the event to exist end to end
- Blocks: PLUGINS-019

## Spec References
- SPEC.md §4 — the workspace tree and seeds
- SPEC.md §5 — `stage`
- SPEC.md §11 — boards as documents, kanban boards, the seed boards

## Summary
The workspace template ships three pinned views and the product agent's skills say "pin me a view". After Phase 41 a column is a line in a board document and a kanban is a board over a field. This issue updates what `corpus init` installs and what the agent is told: three seed boards, seed views without `pinned`/`order`, and skill, README and docs text that describe boards, kanbans and `stage` in the agent's terms.

## Acceptance Criteria
- [ ] `assets/workspace/data/docs/boards/attention.md` (`order: 1`, `columns: [doc_seedattention, doc_seedinbox, doc_seedopenthreads]`), `boards/by-status.md` (`order: 2`, `kanban: { field: status, stages: [open, resolved, archived] }`, `query: { type: note }`), `boards/files.md` (`order: 3`, `columns: []`, `default-open: true`). Stable ids in the `doc_seed…` style.
- [ ] The three seed views lose `pinned` and `order`; nothing else about them changes.
- [ ] `assets/workspace/README.md` lines ~29-31, 69, 77, 103 describe boards, not "three columns".
- [ ] `assets/workspace/claude/skills/orchestrate/SKILL.md` (~line 1037, "documents `--pinned`, `--order`") teaches: pin a view = add its id to a board's `columns`; make a kanban = one board document with `kanban`; move a document along a workflow = `corpus doc edit --stage`; and that a stage may write a status (§5) so the agent reads the response.
- [ ] `assets/workspace/claude/skills/comment/SKILL.md` mentions of "board" still read true (they do not say pinned; verify).
- [ ] The orchestrate skill handles **`workspace.reflect`** (SPEC §7 rider 9): gather the window with `corpus doc list --since <payload.since>` (no `--since` when null), read what it chooses, write a changelog entry on each document it has something to say about, and post **one standalone thread** as the digest — first line names the window `since … until …`, then what moved, what it did, what it asks — and posts it even when there is nothing to say, in one line. It never treats a stage name as an instruction. The skill names the cost rule: read a document only when the list line is not enough.
- [ ] `docs/workspace-template.md` (~lines 41-43) and `docs/PLUGINS.md` (~lines 20, 75-78: "pinned `type: view` with `column:`") updated: a plugin column is a view with `column:` listed on a board.
- [ ] `corpus init` in a temp dir yields the three boards and the board bar shows them in order (checked with the UI once UI-148 lands; until then, `corpus doc list --type board --sort order`).

## Technical Design

### Files to Create/Modify
- `assets/workspace/data/docs/boards/*.md` — new
- `assets/workspace/data/docs/views/{attention,inbox,open-threads}.md` — strip two keys
- `assets/workspace/README.md`, `assets/workspace/claude/skills/orchestrate/SKILL.md`
- `docs/workspace-template.md`, `docs/PLUGINS.md`
- any template manifest that lists seed files (the three-way rule in `corpus workspace upgrade` needs the new files known as template files)

### Key Implementation Details
- The template installer copies verbatim (scaffold.ts `planTemplateInstall`), so the new board files need no code — but the template's file list must include `boards/` for `workspace upgrade` to offer them to an existing workspace as *new* files (and CLI-061's migration then points at them instead of creating `Board`). Coordinate the title: the migration creates `Board` only when no board exists.
- Skill text is prose the agent runs on: keep the controlled-language rules the skills already follow.

### Edge Cases
- An existing workspace has its own `views/attention.md` edited: the three-way rule leaves it alone, and CLI-061's migration names the `--unset` for it.

## Testing Strategy
The existing template tests (seed parity, skill lint) plus a test that the seed boards parse and validate against the contract's board schema.

## E2E Verification Plan
### Verification Steps
1. `corpus init` in a temp dir → `ls data/docs/boards` shows three files; `corpus doc show doc_seedboardattention` prints `columns`.
2. Run the orchestrate skill's own example ("pin me a view of unresolved finance threads") in a sandbox workspace and confirm the agent edits a board document rather than writing `pinned`.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[AGENT-042]` prefix
