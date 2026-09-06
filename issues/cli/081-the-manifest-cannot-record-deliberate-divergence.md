# [CLI-081] The manifest cannot record deliberate divergence

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
- Related: UI-189 (one accidental-divergence source), CLI-082 (the merge verb
  for files that want both sides)

## Spec References

- SPEC.md **§4** — the workspace is the user's; the template README's own
  invitation ("rename them, reorder them, add your own — nothing here is
  hardwired")

## Summary

Reported from a real upgrade (0.32.0 → 0.33.0, `cos` workspace, 2026-09-06).

The workspace customized two template files exactly as the README invites —
two columns added to the attention board, a refined open-threads query
(`isParent: "true"`). `workspace upgrade` re-reports both as conflicts **on
every run, forever.** The manifest (`apps/cli/src/template/manifest.ts`)
knows two states — matches baseline, or modified — and a deliberate
customization is indistinguishable from an accidental drift.

## What to build

A third state: **deliberately diverged — stop reporting.** Per file, settable
and clearable from the CLI (shape to decide: a `corpus workspace keep <path>`
/ `unkeep`, or flags on an existing verb — decide and record). Semantics:

- A kept file is skipped by upgrade's conflict report, with one summary line
  naming how many kept files exist (silence hiding a growing list is the
  failure mode to refuse).
- Keeping is not merging: the template's copy still advances in the manifest
  baseline, so un-keeping later compares against the current template, not
  the one from when the file was kept.
- CLI-082's merge verb must see kept files too — kept is "stop nagging",
  never "stop being mergeable".

## Acceptance Criteria

- [ ] The customized-file scenario above: keep it once, and the next upgrade
      reports no conflict for it, with the summary line present
- [ ] Un-keep compares against the current baseline
- [ ] The mark survives upgrades and lives in the manifest (or beside it —
      decide and record)
- [ ] `docs/cli.md` regenerates; help states the semantics above

## E2E Verification Log

_Implementing agent fills; state the model._
