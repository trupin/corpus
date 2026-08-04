# [CLI-027] `corpus workspace diff <path>` — what the tool changed under an edited file

## Domain
cli

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-007 (amended 2026-08-03)
- Blocks: CLI-025 (which points at this command in its conflict report)

## Spec References
- SHARED-007 amendment, signed 2026-08-03: a conflict "gives the command that
  shows the difference (`corpus workspace diff <path>`)"
- SPEC.md §2.1 workspace template provenance

## Summary
`corpus workspace upgrade` already refuses to overwrite a template file the
workspace has edited, and reports it as `keep-modified`. Today that report is a
dead end: it tells you a newer version exists and gives you no way to see it.
The signed amendment makes the conflict *unresolved work*, so the resolver needs
the one thing it is missing — what actually changed upstream.

**The audience is the agent** (user, 2026-08-03: _"let's assume this will be run
by an agent"_). So this verb's output is an input to a merge decision, not
decoration. It must be unambiguous about which side is which: the baseline
`init` recorded, the workspace's current copy, and the version the installed
tool ships.

The three shas are all available — `.corpus/template-manifest.json` holds the
baseline, the file holds the workspace's, and `resolveTemplateRoot()` reaches the
tool's. The pieces exist; this is the surface over them.

## Acceptance Criteria
- [ ] `corpus workspace diff <path>` prints the difference between the
      workspace's copy and the version the installed tool ships
- [ ] It is explicit about direction — which side is the workspace's and which
      is the tool's — so a merge cannot be applied backwards
- [ ] The **baseline** is reachable too, since a three-way merge needs it: either
      shown by default or behind a flag, but reachable without reading the
      manifest by hand
- [ ] With no path, it lists the paths that currently have conflicts, so the
      agent can enumerate its work without re-running an upgrade
- [ ] A path with no conflict says so plainly and exits successfully — asking
      about a clean file is not an error
- [ ] A path the manifest does not know is refused with an explanation, not a
      confusing empty diff
- [ ] Machine-legible output available (`--json` or equivalent), because the
      primary caller is an agent — decide the shape and say why
- [ ] Read-only: this verb never writes to the workspace, and never needs the
      server running (the same bootstrap-class reasoning as `workspace upgrade`)
- [ ] Works when the tool no longer ships the file (retired) — say that rather
      than diffing against nothing

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/workspace/diff.ts` (new) + tests
- `apps/cli/src/commands/workspace/index.ts` (registration)
- reuse `template/manifest.ts` (`readTemplateManifest`, `sha256`) and
  `paths.ts` (`resolveTemplateRoot`) — do not re-derive either
- `docs/cli.md` is a generated artifact: regenerate, never hand-edit

### Notes
- `template/plan.ts` already computes the verdict per path (`decide`), including
  `keep-modified` and `retired`. Enumerate conflicts from the same function
  rather than re-implementing the comparison — two spellings of this rule is
  exactly the drift the three-way logic exists to prevent.

## Testing Strategy
Unit tests over the manifest/plan seam (pure, no filesystem) plus command tests
covering: conflict, clean file, unknown path, retired file, and the listing mode.

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
