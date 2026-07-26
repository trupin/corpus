# [CLI-005] `corpus workspace upgrade`: refresh template files after a tool update

## Domain

cli

## Status

todo

## Priority

P1

## Model

opus — the three-way-compare semantics are pinned by the spec stub; implementation is careful file mechanics.

## Dependencies

- Depends on: CLI-002, AGENT-001
- Blocks: —

## Spec References

- SPEC.md §2.1 — "Workspace upgrade" _[TBD: CLI-005]_ (authoritative behavior)
- SPEC.md §7 — skills-as-documents, `corpus skill rollback` (recovery path)
- `docs/workspace-template.md` — the AGENT-001/CLI-002 copy contract this issue extends

## Summary

`corpus init` installs the product agent's skills from the tool's bundled template, but a later `npm update` of the tool leaves existing workspaces running the old template — core-skill fixes never reach them, and blindly re-copying would destroy skills the agent has legitimately evolved (they are the workspace's memory). Add a dedicated verb that upgrades template-provenance files safely: update what the workspace never touched, preserve and report what it did.

## Acceptance Criteria

- [ ] `corpus init` writes `.corpus/template-manifest.json`: for every installed template file, its workspace-relative path (post-rename, e.g. `.claude/...`), the content hash of the installed copy, and the tool version.
- [ ] `corpus workspace upgrade` three-way compares each manifest entry (baseline hash vs. current workspace file vs. new template): unmodified → overwritten with the new template copy; workspace-modified → left untouched and reported (path + one-line diff summary); deleted from workspace → reported, not reinstalled unless `--restore` is passed; new-in-template → installed.
- [ ] The upgrade touches only template-provenance files (`.claude/` skills and personas, workspace README, `.gitignore`) — never anything under `data/` or `.corpus/` beyond the manifest itself.
- [ ] All changes land as a single git commit in the workspace repo, attributed per the acting-party convention, with a structured message naming old → new tool version; the manifest is updated in the same commit.
- [ ] Running upgrade with no template changes is a no-op ("already up to date", exit 0, no commit).
- [ ] `--dry-run` prints the full plan (update / keep-modified / install / restore candidates) without writing anything.
- [ ] Works with the server stopped (upgrade is a bootstrap-class operation like `init`); with the server running, the watcher picks the changes up and re-projects — verified both ways.
- [ ] Registered in the CLI-001 declarative registry (help + `docs/cli.md` regenerate; drift check stays green).

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/workspace/upgrade.ts` — the verb
- `apps/cli/src/commands/init.ts` (or its module) — write the template manifest at install time
- `apps/cli/src/template/` — shared install/manifest/rename logic factored out of CLI-002's copy step so init and upgrade use one implementation
- `docs/workspace-template.md` — extend the copy contract with the manifest and upgrade semantics
- `docs/cli.md` — regenerated

### Key Implementation Details

- Reuse CLI-002's rename table (dotless template → dotfiles) — the manifest stores post-rename workspace paths; comparisons hash the template file **after** rename mapping so the pairing is stable.
- Hashing: sha-256 of file bytes. The baseline hash is the hash of what was installed (which equals the then-template's hash); "workspace-modified" means current-file hash ≠ baseline hash. Template-changed means new-template hash ≠ baseline hash. Only the (template-changed ∧ workspace-unmodified) cell overwrites.
- Like `corpus init`, this is one of the CLI's documented write exceptions (SPEC §2.2 rule 4 covers bootstrap-class operations; the upgrade writes only template-provenance files). The git commit is made by the CLI directly, same as init's initial commit.
- Workspaces created before the manifest existed: `upgrade` without a manifest treats every current template file as "modified" (conservative — reports everything, overwrites nothing) and writes a fresh manifest baseline with `--adopt`.

### Edge Cases

- Manifest lists a file the new template dropped → report as "retired"; leave the workspace copy (it may carry agent edits); drop it from the new manifest.
- A modified file whose template counterpart is unchanged → silent keep (not even reported; nothing to upgrade).
- Interrupted upgrade: stage all writes, commit once; on failure before commit, report the partial state loudly (files are in git-status, nothing is lost).
- Case-insensitive filesystems and the rename table (e.g. `claude/` vs `.claude/`) — pair by table, never by directory scan alone.

## Testing Strategy

Vitest in `apps/cli`: manifest write/read round-trip; the three-way decision matrix as a pure function (all 2×2×presence cells); rename-table pairing; no-manifest conservative mode. Filesystem tests against a temp workspace fixture.

## E2E Verification Plan

### Verification Steps

1. `corpus init` a scratch workspace → `.corpus/template-manifest.json` exists and lists the installed skills.
2. Simulate a tool update by editing a file in the installed tool's template copy; run `corpus workspace upgrade --dry-run` → plan shows exactly that file as "update"; run without `--dry-run` → file updated, single commit in `git log` naming the version bump.
3. Edit `.claude/skills/comment/SKILL.md` in the workspace (simulating agent evolution), change its template counterpart too, re-run upgrade → file NOT overwritten, reported as modified; commit contains only the other changes.
4. Run upgrade again with no template changes → "already up to date", no new commit.
5. With the server running, repeat step 2 → SSE invalidation observed and the skill document re-projected (visible via `GET /api/docs?type=skill`).

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. Must be from real E2E
testing — no mocks, no test clients. Real application, real requests, real
interfaces. Include specific commands run, actual outputs observed, and pass/fail
conclusions. State which model the implementing agent ran on ("implemented on:
opus | fable")._

### Reproduction (bugs only)

_N/A — feature issue._

### Post-Implementation Verification

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[CLI-005]` prefix
