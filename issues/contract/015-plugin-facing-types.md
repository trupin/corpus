# [CONTRACT-015] Graduate plugin-facing types into `@corpus/contract`

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus — type relocation along the existing dependency direction; the shapes already exist.

## Dependencies

- Depends on: CONTRACT-002
- Blocks: PLUGINS-002

## Spec References

- SPEC.md §10 — plugin system; plugins import only `@corpus/kit` + `@corpus/contract`
- CLAUDE.md — Repository Structure (dependency direction)
- issues/evals/PLUGINS-001-eval.md — open question 2 (2026-07-28)

## Summary

Filed from PLUGINS-001's evaluation (2026-07-28). A typed plugin currently cannot import the types
its own server routes and CLI commands receive: `PluginServerContext` lives in
`apps/server/src/plugins/context.ts` and `CommandSpec` in the CLI registry — both forbidden imports
for `plugins/**` (kit + contract only). `plugins/_fixture` gets away with structural typing;
PLUGINS-002's todos plugin should not have to.

Move (or re-export) the plugin-facing **type surface** into `@corpus/contract` so a plugin's
`server/routes.ts` and `cli/commands/*.ts` can be fully typed within the allowed imports:

- `PluginServerContext` (doc read/write services + `broadcastInvalidate`) — type only; the
  implementation stays in `apps/server`.
- `CommandSpec` / `CommandContext` (and whatever minimal registry types a plugin command module
  needs) — type only; validation and dispatch stay in `apps/cli`.

Server and CLI implement these imported types (`satisfies`/explicit annotations) so drift is a type
error on the implementing side, keeping the contract package dependency-free of server/cli code.
`@corpus/kit`'s `PluginManifest` stays in kit (it is a React-coupled UI contract).

## Acceptance Criteria

- [ ] `@corpus/contract` exports the plugin-facing types; `apps/server` and `apps/cli` consume them
      as their implementation types (no duplicated shapes).
- [ ] `plugins/_fixture`'s `server/routes.ts` and `cli/commands/*` are explicitly typed via
      `@corpus/contract` imports, and the boundary lint rules still pass.
- [ ] No runtime code moves; generated artifacts unchanged or regenerated idempotently.

## Technical Design

To be refined when scheduled (before PLUGINS-002).

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran
on._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
