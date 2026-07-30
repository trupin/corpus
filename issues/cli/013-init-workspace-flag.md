# [CLI-013] `corpus init` silently ignores `--workspace`; guard misses repo-like directories

## Domain

cli

## Status

todo

## Priority

P1

## Model

opus — a flag-plumbing fix plus a sharpened guard, with a destructive-failure reproduction.

## Dependencies

- Depends on: CLI-002
- Blocks: —

## Spec References

- SPEC.md §2 — `corpus init`
- issues/plugins/002-todos-plugin.md — incident root cause (2026-07-29)

## Summary

Found the hard way during PLUGINS-002 (the incident scaffolded a workspace into a development git
worktree, overwrote `.gitignore`/`README.md`, and flipped the parent repo's `core.bare`): `corpus
init` takes a positional path and **silently ignores the global `--workspace` flag**, defaulting
to the current directory. A user running `corpus init --workspace ~/notes` from inside any
existing project scaffolds into that project. Additionally the "refuses a directory that already
holds a workspace" guard does not fire on a directory that merely looks like an existing project
(a git repo with files).

Fix both: (a) `--workspace` (when no positional is given) must be honored — or explicitly refused
with an error telling the user to pass the positional; silent divergence is the bug; (b) init
refuses a non-empty directory that is not already a corpus workspace unless `--force` is given,
with a message listing what it found (git repo, existing files).

**Second live occurrence (2026-07-29, CLI-014 E2E drill):** the same silent-cwd fallback
escaped into the development repo root itself — overwrote `README.md`/`.gitignore` and staged a
genesis commit's worth of files (orchestrator repaired by index reset + restore from HEAD).
Additional finding for the fix: **`CreatedPaths.unwind()` cannot repair the worst of it** —
`writeFile`/`copyFile` record a path only when `!existed`, so overwritten pre-existing files
survive the rollback. The guard fix should either snapshot-and-restore files it overwrites or
(simpler) refuse before writing anything into a non-empty non-workspace directory.

## Acceptance Criteria

- [ ] `corpus init --workspace <path>` targets `<path>` (or errors clearly); never silently
      scaffolds the cwd when a target was named.
- [ ] Init into a non-empty non-workspace directory requires `--force`; the refusal names the
      evidence; pre-fix destructive reproduction logged.
- [ ] `docs/cli.md` regenerated; existing init tests updated.

## E2E Verification Log

_Filled in by the implementing agent. State the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
