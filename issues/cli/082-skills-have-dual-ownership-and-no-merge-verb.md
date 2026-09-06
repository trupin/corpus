# [CLI-082] Skills have dual ownership and no merge verb

## Domain

cli

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Related: CLI-081 (keep-marks), AGENT skills doctrine (a skill is the
  workspace's own document, evolved as the agent's memory)

## Spec References

- SPEC.md **§7** — skills are workspace documents the agent stewards
- SPEC.md **§4** — the template ships improved versions of the same files

## Summary

Reported from a real upgrade (0.32.0 → 0.33.0, `cos` workspace, 2026-09-06).

By design a skill is owned twice: the workspace evolves it (the agent's
memory), and the template ships improved versions of the same file. Both
sides behave correctly, so collision is **guaranteed** — the comment skill
arrived with 50 new template lines against 56 local ones. The tool holds all
three copies (manifest baseline, workspace file, incoming tool copy) yet
offers only `workspace diff`. The operator ran `git merge-file` by hand — and
the merge **silently dropped a local block older than the baseline**: the
baseline of a kept-modified file is itself post-modification, so a
pre-baseline local addition reads as an upstream deletion.

## What to build

`corpus workspace merge <path>`:

- Runs the three-way from the manifest's baseline against the workspace copy
  and the incoming tool copy.
- Clean merges are written through the server (sole writer — this is a
  mutation like any other, auto-committed).
- Conflicting hunks are reported, not written: file untouched, hunks printed
  with enough context to resolve by hand, exit code distinguishing
  clean-merge / conflicts / nothing-to-merge.
- **The trap gets a named warning**: a hunk present in baseline and workspace
  but absent from the tool copy is either an upstream deletion or a
  pre-baseline local edit, and the tool cannot tell which — say so on that
  hunk, never silently pick a side.
- Composes with CLI-081: a kept file merges on request; merging does not
  clear the keep-mark (separate acts).

## Acceptance Criteria

- [ ] The comment-skill scenario reproduced (three genuinely divergent
      copies) merges clean hunks, reports conflicts, and warns on the
      baseline-only-hunk trap — E2E on a real workspace
- [ ] A conflicted run leaves the workspace file byte-identical
- [ ] All writes go through the server; git log shows the merge as one
      authored act
- [ ] `docs/cli.md` regenerates; help names the trap in as many words

## E2E Verification Log

_Implementing agent fills; state the model._
