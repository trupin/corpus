# [CLI-012] Install plugin seed templates at `corpus init`

## Domain

cli

## Status

todo

## Priority

P2

## Model

opus — extend the existing plugin-skill install path to a second asset kind.

## Dependencies

- Depends on: PLUGINS-002, CLI-005
- Blocks: —

## Spec References

- SPEC.md §10 — plugin assets
- issues/plugins/002-todos-plugin.md — escalation 3 (2026-07-29)

## Summary

Found by PLUGINS-002: a plugin's `types.yaml` may declare `seedTemplate` per doc type, and
`plugins/todos/seeds/todo-template.md` ships one — but `corpus init` copies `plugins/*/skills/`
only, so seed templates are declared and never installed. Extend the init/upgrade install path to
copy plugin seeds into the workspace's template location, recorded in `template-manifest.json`
with the `source: "plugin:<dir>"` marker so `workspace upgrade` refreshes them like plugin skills.

## Acceptance Criteria

- [ ] `corpus init` installs declared plugin seed templates; `workspace upgrade` refreshes them
      (never clobbering user edits, per CLI-005's rules).
- [ ] The todos template lands in a fresh workspace and `corpus doc create --type todo` uses it.

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
