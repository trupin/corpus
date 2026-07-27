# [CLI-006] `corpus doc check` + `corpus skill rollback` verbs

## Domain

cli

## Status

todo

## Priority

P1

## Model

opus — thin mappings onto CONTRACT-008 routes; the `--staged` collection is read-only git plumbing.

## Dependencies

- Depends on: CLI-003, SERVER-019
- Blocks: AGENT-003

## Spec References

- SPEC.md §14 — `doc check --staged`, exit-6 gating; §7 — skill rollback
- `issues/cli/003-doc-thread-verbs.md` — the deferred ACs and technical design (staged collection via `git diff --cached --name-only --diff-filter=ACMR -z` + `git show :<path>`, posted as `(path, content)` pairs)

## Summary

The two verbs deferred out of CLI-003 (2026-07-27 adjudication), implementable once CONTRACT-008/SERVER-019 land. `corpus doc check [<id>…] [--staged]` validates via the server (warnings don't fail; errors exit 6; `--json` structured findings; no staged document paths → exit 0, silent). `corpus skill rollback <name> [--to <ref>]` calls the targeted-revert endpoint and prints the restored commit and path (unknown skill → "no skill named <name>", exit 5). The workspace-side pre-commit hook that gates on exit 6 belongs to the agent-runtime domain (workspace template), not this issue, and nothing here touches this repo's `.githooks/`.

## Acceptance Criteria

- [ ] The two deferred CLI-003 ACs, as originally written (minus the `.githooks/` line).
- [ ] Registry + `docs/cli.md` regenerated; read-only-filesystem constraint holds.
- [ ] Vitest for parsing, `--staged` collection, exit-code mapping; E2E through the real binary.

## Technical Design

To be refined when scheduled (Phase 4, before AGENT-003).

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

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
- [ ] Committed with `[CLI-006]` prefix
