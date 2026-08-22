# [SHARED-066] The `column` reference only ever named a plugin, and it spans four workspaces

## Domain
shared (cross-domain)

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SHARED-064, UI-150, SERVER-136, CLI-060, CONTRACT-074

## Spec References
- SPEC.md **§9.1** — the projection's `documents` columns
- SPEC.md **§10** — the board's columns

## Summary

Found mid-phase, 2026-08-22, while regenerating `docs/cli.md`.

A pinned view document may carry `column: "<plugin>/<type>"`, telling the board
to render that column through a plugin's own component. **That is its only
meaning.** `apps/cli/src/commands/doc/frontmatter.ts:316` says so outright:
*"`--column` takes `<plugin>/<type>`"*.

With plugins gone the reference names nothing. It is dead frontmatter, a dead
CLI flag, a dead projection column and a dead wire field — and the goal for this
phase is *no trace*.

## Why it is filed apart rather than folded in

It spans **four workspaces and 20+ files**, including a projection column
(`column_ref`), the `documents` table in `projection/schema.ts`, a contract
field, a CLI flag with its own parser and usage error, and the UI's
`viewDoc.ts`. Each of the four domain agents would have touched a slice, and a
partial removal leaves the worst state: a field the wire still carries that
nothing writes and nothing reads.

## What to build

Remove it end to end: the `--column` flag and its parser, the frontmatter key,
the contract field, the projection column, and the UI's reading of it.

## Decisions to make and record

1. **The projection column.** `openProjection` repopulates from files on every
   boot, so dropping a column needs no migration — **verify that** rather than
   assuming it, and say whether `SCHEMA_VERSION` moves.
2. **What happens to a workspace whose view document still carries `column:`.**
   It becomes extra frontmatter, preserved verbatim and ignored — which is what
   §9.1 now says about any key the core does not define. **Confirm it does not
   fail validation**, because a user's board must not break on an old view.
3. **Whether the board loses anything a person can see.** A plugin column
   rendered a plugin's component; with none installed it already showed a
   missing-plugin card. Check what such a view renders as now — it should be an
   ordinary pinned view of its query.

## Acceptance Criteria
- [ ] No `column` reference in any workspace, wire field or generated artifact
- [ ] A view document carrying a stale `column:` still opens, still pins, and
      still renders its query
- [ ] `db rebuild && db doctor` clean
- [ ] Decision 1 answered with evidence, not assumption

## E2E Verification Log
_[Agent fills — state the model]_
