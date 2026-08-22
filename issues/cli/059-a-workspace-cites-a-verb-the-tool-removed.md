# [CLI-059] A workspace's skills can cite a verb the tool removed, and nothing says so

## Domain
cli

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Related: CLI-040 (which removed `skill rollback`), CLI-027 (`corpus workspace diff`), CLI-025 (upgrade's template sync), SERVER-066 (`doc check`'s existing job)

## Spec References
- SPEC.md **§2.4** — upgrade and the workspace template sync
- SPEC.md **§11** — validation on the write path

## Summary

Raised by a live report, 2026-08-21: *"The workspace already cites `skill
rollback` in three places, so either the CLI is missing a verb its own ecosystem
assumes, or the citations were always wrong."*

**Neither.** `corpus skill rollback` existed and was **deliberately removed** by
CLI-040 on 2026-08-12, under SHARED-042 (*"A revert is a write like any other"*).
PR #43's review found it destroyed uncommitted edits unrecoverably; the answer
was that a revert is a write whose content came from history, so the verb went
and the skills teach the loop instead.

The tool repository is already guarded: `scripts/workspace-template.test.ts`
carries a `REMOVED_VERBS` allowlist naming `skill rollback`, and
`assets/workspace/README.md` says outright *"There is no rollback command, and
here that is the point."* So a workspace created **today** is correct.

**A workspace created before 2026-08-12 is not**, and keeps its old skills until
`corpus upgrade` runs the template sync. The reporter's workspace is in exactly
that state, and the symptom is the worst kind: the agent's own instructions tell
it to run a command that does not exist.

## The gap

`corpus workspace diff` (CLI-027) and upgrade's template sync both exist, so the
repair path is there. What is missing is that **nothing tells you to walk it**.
The stale citation is discovered by an agent trying the verb and failing, which
is a bad moment to find out and costs a turn every time.

## What to build

The narrow, cheap version: a workspace skill that cites a CLI verb the installed
tool does not have is a **finding**, reported where findings already go. The
`REMOVED_VERBS` list the tool repo already maintains is half the data; the
command registry is the other half and is authoritative.

## Decisions to make and record

1. **Where the check lives.** `corpus doc check` already validates skills on
   every save (§11) and knows how to report a finding — that is the cheap seam.
   A check at `corpus upgrade` time reaches a whole workspace at once. They are
   not exclusive, and doing both may be right.
2. **Warning or failure?** A skill citing a removed verb still saves and still
   runs — it just fails later. §11's warning channel is the honest home, and
   SERVER-067 is the open question about that channel. Do not make this a hard
   failure without saying why.
3. **False positives.** A skill may quote a verb inside prose explaining that it
   was removed — `assets/workspace/README.md` does exactly that. A checker that
   flags the sentence explaining the removal is worse than no checker.

## Acceptance Criteria
- [ ] A skill citing a verb the installed registry does not have is reported
- [ ] The registry is the source of truth, not a hand-kept list
- [ ] Prose explaining that a verb was removed is not flagged
- [ ] The report names the skill, the line, and what to do instead
- [ ] A current workspace produces no findings

## Testing Strategy
Unit over the detector, with `assets/workspace/README.md`'s own removal sentence
as the negative case — it is the exact false positive that matters.

## E2E Verification Log
_[Agent fills — state the model]_
