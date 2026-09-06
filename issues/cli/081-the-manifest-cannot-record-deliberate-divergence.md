# [CLI-081] The manifest cannot record deliberate divergence

## Domain

cli

## Status

done — 2026-09-06, evaluator PASS, committed on phase-58

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

## Decisions (recorded per issue instructions)

- **Verb shape**: `corpus workspace keep <path>` marks, `corpus workspace keep`
  with no path **lists kept files by path** (TEST-1104's listing verb), and
  `corpus workspace unkeep <path>` clears. Flags on an existing verb were
  rejected: the mark is an act on per-path state, not a mode of the upgrade,
  and the bare-`keep` listing gives the count line somewhere to point.
- **Storage**: **in the manifest**, as an optional `kept: true` per entry
  (like `normalizedSha256`, no version bump — both manifest generations parse
  under `version: 1` in both directions, and a malformed value degrades to
  "not kept", which reports more, never less). Chosen over a side file because
  the mark has the entry's own lifecycle: `nextManifestFiles` carries it
  forward on every advance, and a `retired` entry takes its mark with it — a
  side file would accumulate marks for paths the manifest no longer knows.
  One file, one reader (`entry.kept === true`), read identically by upgrade,
  keep/unkeep, and merge (S2).
- **Kept semantics beyond the issue text**: a kept file is excluded from the
  upgrade's *writes* as well as its report — including `--restore` (the
  workspace owns its absence too). `retired` still reports once, because the
  entry (and mark) is being dropped. The summary line prints on every run
  with ≥1 kept file, including "already up to date" runs; zero kept files
  print nothing (there is no list to hide).
- **Baseline advance mechanics**: the kept entry advances to the **incoming
  copy's** shas (never the workspace's — the plan.ts safety property holds),
  and the advance alone defeats the `upToDate` early exit so the manifest is
  actually rewritten. The advanced bytes are the tool's and no workspace
  commit ever holds them, so the upgrade also writes them into the **baseline
  store** (`.corpus/template-baselines/<sha256>`, CLI-082's `baseline.ts`) —
  without that, `corpus workspace merge` on a kept file was unrecoverable the
  moment the template moved again (found live in E2E, below).

## The §2.4 rider, drafted for signature (PR #75 review, finding 1)

The review found the upgrade strand shipped behaviour §2.4 does not describe.
The report-naming half was fixed in code (kept files are named, not counted).
The spec half is this rider, for the user's signature:

> **The comparison reads edits, and a person can retire a file from the
> report.** A file differing from its baseline only in keys the server stamps
> (`created`, `updated`) or keys that carry presentation state (`width`) is
> not an edit: the comparison reads through them, and the upgrade's write
> carries them forward, so a resize or a restamp neither blocks an update nor
> is destroyed by one. A person may mark a customized file **kept** —
> deliberately diverged, no longer a conflict — and the upgrade then names it
> in one quiet line instead of reporting it: named, not nagged, because a
> silence that hides a growing list is the failure this mark must not create.
> Keeping is not merging: the baseline still advances, so un-keeping compares
> against the current template. And a dual-owned file can be **merged**: a
> three-way of baseline, workspace, and incoming copies, written through the
> server when clean, reported and left untouched when conflicted, with the
> one undecidable hunk shape — present in baseline and workspace, absent from
> the incoming copy — named as undecidable rather than silently resolved.
> _(Rider signed — date to be filled at signature.)_

## E2E Verification Log

**Model: Fable (claude-fable-5), 2026-09-06.** Real built CLI
(`apps/cli/dist/bin/corpus.js`), real `corpus init` workspace at
`scratchpad/e2e-081`, template = this worktree's `assets/workspace` (edited to
simulate a tool release, restored afterwards). No server needed — keep is
bootstrap-class like upgrade/diff.

1. Customized `data/docs/boards/attention.md` (appended a hand-written column
   note), appended a line to the template's copy, ran `corpus workspace
   upgrade`:
   `keep    data/docs/boards/attention.md — modified here — 1 line only here, 1 line only in the new copy`
   `unresolved — corpus workspace diff data/docs/boards/attention.md` — the
   reported eternal conflict reproduced.
2. `corpus workspace keep data/docs/boards/attention.md` → exit 0, then
   `corpus workspace upgrade` again: **no conflict line**, and the summary
   `1 kept file deliberately diverged, skipped by this report — \`corpus
   workspace keep\` lists them, \`corpus workspace unkeep <path>\` resumes
   reporting.` (TEST-1103). The advance was committed
   (`wrote 0 files in commit aa339d6…` — the manifest is tracked by the stock
   `.gitignore`).
3. Third upgrade: `already up to date.` **plus** the same summary line —
   silence never hides the list (TEST-1104's line). Manifest entry:
   `"sha256": "bfeb0fe7…", "kept": true` — byte-equal to
   `shasum -a 256` of the template's changed copy, i.e. the baseline advanced
   while the file on disk kept its customization verbatim (TEST-1106/1107).
4. `corpus workspace unkeep …` → next `corpus workspace upgrade` printed
   nothing for the path (local-only divergence against a **current** baseline
   is `keep-silent`); after appending a *second* template change,
   `corpus workspace diff` showed `baseline bfeb0fe7…` (the advanced one) and
   a diff whose `+` side named the newest template's line — un-keep compares
   against the current template, not the one in force when kept (TEST-1105).
5. `corpus workspace keep data/docs/notes/mine.md` → exit 2,
   `"data/docs/notes/mine.md" is not template-tracked — the manifest has no
   entry for it — so there is no divergence to mark. Nothing was written.`
   (TEST-1108). Bare `corpus workspace keep` → `no kept files: …`.

Unit coverage: `keep.test.ts` (12 tests: skip+summary, three-file count and
listing, advance-without-write across two releases, un-keep vs current
baseline, kept restore-candidate, unknown-path refusal with manifest byte
comparison, idempotence, no-manifest refusal, cwd-relative resolution, JSON
shapes, upgrade `--json` `kept` array), plus `plan.test.ts` and
`manifest.test.ts` cases for the mark's plumbing and parsing.
