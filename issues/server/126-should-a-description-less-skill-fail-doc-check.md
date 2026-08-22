# [SERVER-126] Should a description-less `SKILL.md` fail `corpus doc check`?

## Domain

server

## Status

todo

**Amended 2026-08-22 by SHARED-065 (Phase 41), and kept open.** Two clauses cited
plugins. The *"Against"* case said skills arrive from three places, one of them a
plugin — SHARED-064 removed that source, so it now says two, and **the argument
is unweakened**: the point was always that a hand-edited skill is not our defect.
The design note said an open `DocTypeSchema` means "a plugin type is not a
fault"; the rule outlives its cause and now names an unrecognised type. The
question this issue exists to answer is untouched.

## Priority

P2

## Model

fable

## Dependencies

- Depends on: SERVER-124
- Blocks: —
- Related: SERVER-123 (which created this asymmetry and recorded it as residual)

## Spec References

- SPEC.md **§7** line 399 — *"Corpus's frontmatter fields … coexist with Claude
  Code's (`name`, `description`) in the same YAML block; `corpus doc check`
  validates both sets"*

## Summary

SERVER-123 made Claude Code's `name`/`description` required under
`.claude/agents/`. Nothing asks for them under `.claude/skills/**`. SERVER-124
then made Corpus's own field set checkable under **every** `.claude/` root, and
its implementer surfaced the remaining asymmetry as a product call rather than
settling it.

The mechanical change is one expression in `claudeCodeRootFor`. The question is
whether it should be made.

## Why this is now a product call and not a safety one

**Before SERVER-124, extending this would have been dangerous.** A new finding
under `.claude/skills/**` rode a blocking code, so it would have refused writes to
existing files. That is the regression PR #49's third review caught.

SERVER-124 removed that hazard. `isClaudeRootFrontmatter` makes every
`frontmatter-invalid` finding under a Claude root **reported and never blocking**,
so neither root can make a document unwritable now.

What is left is the honest question: **should every description-less `SKILL.md` in
an existing workspace start failing `doc check` with exit 6?**

## The case each way

**For.** §7:399 promises `doc check` validates both sets, and it does not, under
this root. A skill Claude Code cannot load is exactly as dead as a persona it
cannot load, which is the reasoning SERVER-123 accepted for `.claude/agents/`.

**Against.** A workspace's skills arrive from two places — `corpus init` and a
person's own hand — and only the first is under our control. A
finding that fires on files we shipped correctly but that a user has since edited
is a finding about their editing, not about a defect. Exit 6 on a working
workspace teaches people to ignore exit 6.

**The asymmetry may be correct.** A persona exists **to be addressed**, so a
persona Claude Code cannot load has no other purpose. A skill has a life outside
invocation: it is documentation, it is read, and `corpus init` ships several that
a person may reasonably trim.

## What the decision must produce

- [ ] A recorded answer, with the rejected side and why it lost
- [ ] If extended: a measured count of newly-reported documents in a realistic
      workspace **before** it lands, as SERVER-124 did (it measured 2 of 45)
- [ ] If extended: the finding stays reported and never blocking
- [ ] If not extended: §7:399 is either corrected or its scope is stated, and a
      SPEC edit needs the user's signature
- [ ] Either way, the asymmetry stops being undocumented

## Technical Design

### Files to Create/Modify

- `apps/server/src/core/check.ts` — `claudeCodeRootFor`
- `SPEC.md` §7 — only if the answer is "not extended", and only signed

### Key Implementation Details

Read SERVER-124's decision record first. It settled three edge cases that apply
here unchanged: a field present but `null` is treated as absent and waived;
`anchors` gets no special case; and `DocTypeSchema` is deliberately open, so **a
type the core does not recognise is not a fault** (SPEC §12's M6 — it was written
against plugin types, and SHARED-064 kept the rule while removing that cause).

Note that `description` was the field whose only repair was an `--extra` flag the
error text did not name. If this is extended, check that the repair is expressible
through ordinary verbs before shipping it — that is what made SERVER-124's
findings tolerable.

## Testing Strategy

Per-root tests over present, absent and malformed, if it is extended. Falsify by
reverting the root expression and confirming only the `.claude/skills/**` cases go
red.

## E2E Verification Plan

### Verification Steps

1. Build a realistic workspace and count what would newly report, before deciding
2. Throwaway workspace, real server, port not 8765 / not 5173
3. Confirm every write surface still succeeds either way
4. Stop the server; confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-126]` prefix
