# [CLI-037] A workspace's git repairs itself in the background, and can corrupt itself doing it

## Domain

cli

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: SERVER-089 (found and measured the mechanism)
- Blocks: —

## Spec References

- SPEC.md **§4** — every mutation auto-commits; git is the audit trail and the
  only recovery for a deletion
- SPEC.md **§5** — files on disk are the source of truth
- SPEC.md **§2.1** — `corpus init` creates the workspace and its git repository

## Summary

Escalated from SERVER-089, which found this while fixing a CI failure and
deliberately did not act on it, because it is a product decision spanning the CLI.

**Since git 2.29 every `git commit` ends by spawning
`git maintenance run --auto --quiet --detach`** — a detached background process.
On git **2.54** that process begins repacking a *fresh* repository at the
**tenth** commit, concurrently with anything else touching it. Measured on git
2.54.0 over 65 runs of a commit-then-read sequence: **26 corrupt repositories**,
with `error: Could not read <sha>` / `fatal: cannot simplify commit`, `git fsck`
reporting `missing commit` and `broken link`, and no self-healing.

Corpus is exactly that shape. The server is the sole writer, **auto-commits on
every mutation** (§4), and reads git back immediately — `corpus doc diff`, skill
rollback, the watcher's HEAD comparison. Ten commits is a short session.
`apps/cli/src/commands/init/git.ts` sets no maintenance configuration, so every
workspace `corpus init` creates is in the measured configuration.

**Why this is P0**: §4 makes git the audit trail and the *only* recovery for a
deletion. A corrupt object store is not a slow workspace — it is the recovery
path failing, in a product whose deletion story is "git preserves history".

## What is known, and what is not

**Known**, from SERVER-089's measurements: `gc.auto=0` is **not** a fix (9/25
corrupt versus a baseline of 8/25 — the dispatcher spawns regardless, and the
repacking tasks read `maintenance.<task>.auto`). `maintenance.auto=false` gives
0/25, and 50/50 clean after it.

**Not known, and the reason this is `fable` rather than `opus`:** whether a tool
should disable maintenance in a repository it commits into dozens of times an
hour, and if it does, **what maintains it instead**. A workspace that never packs
accumulates loose objects indefinitely. That is a real cost with a real answer —
maintenance at a moment Corpus chooses, rather than never — and choosing it is a
product decision, not a patch.

## Acceptance Criteria

- [ ] Reproduce against a real `corpus init` workspace on git ≥ 2.54, driving
      enough mutations to pass the ten-commit trigger. SERVER-089 reproduced the
      mechanism in a container; this needs it reproduced through the product
- [ ] A new workspace is not left in the measured configuration
- [ ] **Existing workspaces are addressed, not only new ones.** `corpus init`
      runs once; a workspace created last week is in this state now. Decide
      whether `corpus workspace upgrade` (§2.4) is the vehicle and say so
- [ ] If maintenance is disabled, **something maintains the repository** — say
      what, when, and what a user sees. "Never packs" is a decision with a cost,
      and it must be a decision rather than a side effect
- [ ] Whatever is chosen is stated in SPEC.md if it is user-visible behaviour —
      **drafted and held for sign-off**, not applied
- [ ] Check whether this explains any of the standing e2e flakes. SERVER-089
      flagged it as a plausible lead and deliberately did not fold them in

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/init/git.ts`, and whatever `corpus workspace upgrade`
  needs.

### Notes

- `apps/server/src/git/maintenance.ts` is the server-side half and carries the
  measurements in its comment. Read it before deciding; do not re-derive them.
- The trigger is **ten** commits, so "most workspaces are small" is not a reason
  to defer.

## Testing Strategy

A real workspace, real mutations past the trigger, `git fsck` clean afterwards.
Plus whatever pins the chosen maintenance story.

## E2E Verification Log

_Filled by the implementing agent; state the model. This is a bug: the pre-fix
reproduction through the product is mandatory._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
