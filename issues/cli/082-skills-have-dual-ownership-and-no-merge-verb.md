# [CLI-082] Skills have dual ownership and no merge verb

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

## The merge-base finding (recorded per P4, honestly)

The manifest stores the baseline's **sha256 only**, and the installed tool
ships **no previous template versions** (`resolveTemplateRoot` resolves one
tree; `workspace diff`'s own help already states "the baseline is an identity,
not bytes"). So baseline *bytes* come from, in order, all hash-verified:

1. The workspace file itself (baseline exactly when untouched — mostly moot,
   since that verdict is `update` and refused as nothing-to-merge).
2. The **baseline store**, `.corpus/template-baselines/<sha256>` — new in this
   issue. Written whenever a baseline advances *past the workspace's history*:
   a kept entry following the template (CLI-081) and a merged entry advancing
   to the incoming copy. Content-addressed, self-verifying, pruned to the
   manifest's live shas; losing it degrades to the refusal, never a wrong base.
3. The workspace's **git history**: `git rev-list --all --objects -- <path>`,
   then `cat-file` each candidate blob until one's sha256 equals the record.
   `corpus init` and every upgrade commit what they install, so an installed
   baseline is ordinarily here.

Where nothing matches — an `--adopt` baseline recorded from bytes nobody
committed, a rewritten history, a store lost before this fix existed — the
verb **refuses** (`merge_baseline_unavailable`, exit 7) naming exactly this
limitation, and points at `workspace diff` + `workspace keep`. Never guessed.
The store exists because the first live E2E run hit the gap: after a clean
merge advanced the baseline to the tool's bytes, a further template change
made the next merge of the same file unrecoverable — bytes of a past template
live nowhere else.

## Further recorded decisions

- **Scope of the merge**: the document **body**. Frontmatter is compared, not
  merged — the server owns frontmatter serialization and the write path is
  `PUT /api/docs/{id}` `{key, body}` — so a tool-side frontmatter change
  (beyond the ignored stamp/presentation keys) is reported as unresolved work
  for `corpus doc edit`, with a labelled frontmatter diff, and blocks the
  write. A restamped `updated:` is not such a change.
- **Only documents are writable**: the write is addressed by the file's own
  frontmatter `id:`, checked against the server's `doc.path` before the PUT
  (`merge_wrong_document` otherwise). `README.md` / `.gitignore` have no id
  and are refused (`merge_not_a_document`) — the server is the sole writer,
  and this verb does not write around it.
- **Exit codes**: 0 clean-and-written; **6** (`check_failed`) unresolved hunks
  reported, nothing written; **7** (`refused`) nothing-to-merge and
  baseline-unavailable, distinguished by `code`. Documented by meaning in the
  verb's help.
- **The trap chunk is conflict-class**: a block in baseline+workspace and
  absent from the tool's copy is *never* auto-applied (an upstream
  **replacement** still is — upstream demonstrably touched that region). The
  hunk prints the named warning and the block, no side is picked, and the run
  exits 6. `git merge-file` deletes such a block silently — the reported
  incident.
- **All-or-nothing**: any conflict/ambiguous/frontmatter finding means no
  write at all — the file stays byte-identical (sha-compared in tests + E2E).
- **After a clean merge, the baseline advances** to the incoming copy's shas
  (tool bytes — the plan.ts safety property holds) and its bytes go into the
  store; without the advance the next upgrade re-reports the conflict the
  merge just resolved. Merging never touches the keep-mark.
- **Diff3 grouping is conservative**: hunks whose base ranges overlap *or
  touch* group (two insertions at one boundary have no honest order); one
  conflict too many is recoverable, an invented interleaving is not.
- **Known consequence for long-kept files**: while kept, the baseline advances
  each release without the workspace absorbing those changes, so a much-later
  merge sees never-absorbed template changes as conflicts to resolve by hand
  (all three sides printed) — honest, and observed in E2E round E below.

## E2E Verification Log

**Model: Fable (claude-fable-5), 2026-09-06.** Real built CLI, real workspace
(`scratchpad/e2e-082`), real server (`corpus server start`, port 8767 — dev
layout, tsx source entry), template = this worktree's `assets/workspace`
(edited per round, restored afterwards). The comment-skill three-copy scenario
reproduced with three genuinely divergent copies.

- **Round A — clean merge (TEST-1110, TEST-1114).** Evolved the skill through
  the server (`corpus doc patch doc_skillcomment --from agent …` adding a
  "local lesson" bullet — the server restamped `updated:` on the way, which
  correctly did not count as frontmatter work), then added an unrelated
  template paragraph. `corpus workspace merge .claude/skills/comment/SKILL.md`
  → exit 0, `merged .claude/skills/comment/SKILL.md: 1 change from corpus
  0.33.0 joined 1 local change, written through the server as user in one
  commit.` The file then held **both** additions;
  `git log -1 --format='%an | %s'` = `user | doc edit: Comment
  (doc_skillcomment) by user` — one authored act through the server, no
  direct-to-disk write. `corpus workspace upgrade --dry-run` afterwards:
  `already up to date.` — the baseline advanced, the conflict is gone.
- **Round B — conflict (TEST-1111).** Local and template edits to the same
  line of the orchestrate skill. Exit **6**; sha256 of the file identical
  before and after (`07f9dd33…` both times); the hunk printed with context
  and all three labelled sides (`<<<<<<< workspace (your copy)` /
  `||||||| baseline (what the manifest recorded)` / `=======` /
  `>>>>>>> tool (corpus 0.33.0)`), at the **file-relative** line (`:15`,
  frontmatter counted — a body-relative number was found and fixed during
  this E2E).
- **Round C — the trap (TEST-1112).** Template deleted a two-line doctrine
  paragraph the baseline and workspace both hold (converse skill, locally
  edited elsewhere). Exit **6**, file byte-identical (`aca3a496…` unchanged),
  and the hunk carried the warning in as many words: `undecidable at
  workspace/.claude/skills/converse/SKILL.md:102 — this block is in the
  recorded baseline and in this workspace, and absent from the tool's copy.
  That is either an upstream deletion or a local edit older than the recorded
  baseline, and the tool cannot tell which — so no side is picked and the
  block stays:` followed by the block itself. Nothing dropped, nothing
  written.
- **TEST-1113**: merge of the untouched profile skill → exit **7**,
  `is already identical to the tool's copy — there is nothing to merge.`
- **Round D — the gap this E2E found.** Kept the comment skill (CLI-081),
  moved the template again, merged: refused `merge_baseline_unavailable` —
  the advanced baseline's bytes existed nowhere. This produced the baseline
  store (above). **Round E — after the fix**: an upgrade advanced the kept
  baseline and stored its bytes (`.corpus/template-baselines/` gained the
  blob); a further template change, then merge → the base came from the
  store and the verb ran to an honest three-sided conflict (the kept file had
  never absorbed the intermediate template change), file untouched, mark
  still `"kept": true` in the manifest (TEST-1115/1116's composition: kept
  merges on request, merging clears nothing).

Unit coverage: `merge3.test.ts` (11 pure-diff3 tests incl. the
ambiguous-deletion rule and touching-hunk grouping), `baseline.test.ts` (7:
git recovery by exact hash, store round-trip, pruning, tamper rejection),
`merge.test.ts` (15: server write with key, conflict byte-identity and no
PUT, trap warning, store-carried second merge, kept-merge mark survival,
frontmatter finding and stamp exemption, wrong-document and not-a-document
refusals, every nothing-to-merge verdict, JSON report). Full `apps/cli` suite:
118 files, 2451 tests, green.
