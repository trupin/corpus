# [SERVER-126] Should a description-less `SKILL.md` fail `corpus doc check`?

## Domain

server

## Status

done

**Amended 2026-08-22 by SHARED-065 (Phase 41), and kept open.** Two clauses cited
plugins. The *"Against"* case said skills arrive from three places, one of them a
plugin — SHARED-067 removed that source, so it now says two, and **the argument
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

- [x] A recorded answer — **no** — with the rejected side and why it lost
- [x] The count was measured anyway, **before** deciding, and it is what decided
      it: **11 of 12**. See below.
- [x] Not extended, so nothing new blocks anything
- [x] Not extended: §7:399's scope is stated in `claudeCodeRootFor`'s docblock,
      and a SPEC rider is **drafted below and escalated unsigned** — this agent
      does not edit SPEC.md
- [x] The asymmetry is documented, in the code, with its reason

## Technical Design

### Files to Create/Modify

- `apps/server/src/core/check.ts` — `claudeCodeRootFor`
- `SPEC.md` §7 — only if the answer is "not extended", and only signed

### Key Implementation Details

Read SERVER-124's decision record first. It settled three edge cases that apply
here unchanged: a field present but `null` is treated as absent and waived;
`anchors` gets no special case; and `DocTypeSchema` is deliberately open, so **a
type the core does not recognise is not a fault** (SPEC §12's M6 — it was written
against plugin types, and SHARED-067 kept the rule while removing that cause).

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

**Model: Opus 5 (1M context).** 2026-08-24, branch `phase-45-not-so`.

### The answer: no, and the measurement is what decides it

**A description-less `SKILL.md` should not fail `corpus doc check`.
`claudeCodeRootFor` is unchanged.**

The issue framed this as a product call between two arguable positions. It turns
out to have a measurable answer, and the measurement was taken before deciding,
as the acceptance criteria required.

**`name` is not something Claude Code requires of a skill.** It discovers a skill
by the **directory** holding its `SKILL.md`, and reads `name` only when the file
offers one. Counted over the twelve hand-authored `SKILL.md` files in this
repository's own `.claude/skills/` — a real population of skills in daily use,
every one of them loading correctly and appearing in the agent's own skill list:

```
$ for f in .claude/skills/*/SKILL.md; do … done
WOULD REPORT: .claude/skills/lint/SKILL.md               dir=lint         name=[]  desc=YES
WOULD REPORT: .claude/skills/learn/SKILL.md              dir=learn        name=[]  desc=YES
WOULD REPORT: .claude/skills/work-until-release/SKILL.md dir=work-…       name=[]  desc=YES
WOULD REPORT: .claude/skills/test/SKILL.md               dir=test         name=[]  desc=YES
WOULD REPORT: .claude/skills/pr/SKILL.md                 dir=pr           name=[]  desc=YES
WOULD REPORT: .claude/skills/dashboard/SKILL.md          dir=dashboard    name=[]  desc=YES
WOULD REPORT: .claude/skills/evaluate/SKILL.md           dir=evaluate     name=[]  desc=YES
WOULD REPORT: .claude/skills/audit/SKILL.md              dir=audit        name=[]  desc=YES
WOULD REPORT: .claude/skills/issue/SKILL.md              dir=issue        name=[]  desc=YES
WOULD REPORT: .claude/skills/implement/SKILL.md          dir=implement    name=[]  desc=YES
WOULD REPORT: .claude/skills/decompose/SKILL.md          dir=decompose    name=[]  desc=YES
repo .claude/skills: 11 of 12 would newly report
```

**Eleven of twelve carry no `name:` at all**, and all twelve carry a
`description:`. The one expression the issue proposes brings the `name` rule with
it, so extending it as written reports **92% of a working population** as faults
— and takes the genuine `.claude/agents` findings down with it, because a check
whose output is mostly noise is a check people stop reading. That is the
*"teaches people to ignore exit 6"* outcome, measured rather than feared.

For contrast, the shipped template's five skills all carry both fields, so a
fresh `corpus init` workspace would report **0**. Measuring only there would have
made extending look free. It is not free for the workspaces the rule is about.

### The half that was considered and rejected: `description` alone

It is defensible — a skill with no description is one Claude Code cannot choose
to dispatch to, and that is the "For" case's real content. Rejected because it
buys almost nothing and costs real machinery:

- Nothing in this system can **create** such a skill. `SkillCreateRequestSchema`
  already requires `description`, in exactly those words (*"a skill created
  without one is a file that looks installed and can never be invoked"*). So the
  finding can only ever fire on a file a person edited by hand — a finding about
  their editing, which is the "Against" case's exact point.
- Splitting the pair means `claudeCodeFrontmatterIssues` growing a per-root field
  set: a second place for "what Claude Code requires" to be written down, and a
  second place for it to drift.

**If a description-less skill is ever measured in the wild, that is the change to
make, and the split is the shape to make it in.** That is recorded in the code.

### The asymmetry, now documented

A persona exists **to be addressed**: one Claude Code cannot load has no other
purpose, which is the reasoning SERVER-123 accepted for `.claude/agents/`. A
skill has a life outside invocation — it is discovered by its directory, it is
documentation, and it is read — so a skill missing `name` is not dead in the way
a persona missing `name` is. `claudeCodeRootFor`'s docblock in
`apps/server/src/docs/write.ts` now carries the decision, the 11-of-12 count, the
rejected half and the residual, replacing the paragraph that left the question
open.

### The decision is pinned, and falsified

Four new tests in `apps/server/src/docs/write.test.ts` assert `claudeCodeRootFor`
directly: `discoveredAs` non-null for `.claude/agents/`, null for
`.claude/skills/**` and `.claude/skills-archived/**`, and the §5 waiver still
applying to all three.

Falsified by making the change this issue rejected —
`root.key === "agents" ? invocableName(path) : null` → `invocableName(path)`:

```
vitest run apps/server/src/docs/write.test.ts
  × Claude Code's fields … > does not require them under `.claude/skills/**`
  × Claude Code's fields … > does not require them under `.claude/skills-archived/**` either
  × validateBeforeWrite > logs those fields as errors instead of refusing them
  × validateBeforeWrite > stays silent for the finding it deliberately waives
  Tests  4 failed | 47 passed (51)     exit 1
```

Restored, green.

### The SPEC residual — signed 2026-08-25 and applied

§7:399 says *"`corpus doc check` validates both sets"*. Its Corpus half is true
under every Claude Code root (SERVER-124). Its Claude Code half is true for
agent-defs and, by this decision, deliberately not for skills. **This agent does
not edit SPEC.md.** The rider below was drafted here, escalated unsigned with
v0.22.0, and **signed as drafted on 2026-08-25**. The orchestrator applied it to
§7 verbatim — it replaces the clause `` `corpus doc check` validates both sets ``:

> Corpus's frontmatter fields (`id`, `type`, `title`, `tags`, `status`,
> `anchors`) coexist with Claude Code's (`name`, `description`) in the same YAML
> block. `corpus doc check` validates Corpus's set under every root, and Claude
> Code's set **where Claude Code requires it** — a persona under
> `.claude/agents/`, which Claude Code loads by `name` and `description` and
> silently does not load without them. It is not required of a `SKILL.md`, which
> Claude Code discovers by the directory holding it: counted over twelve
> hand-authored skills in daily use, eleven carry no `name` and load correctly,
> so requiring it would report working files as faults. A skill Corpus creates
> carries a description regardless — `corpus skill create` requires one.
> _(Rider signed 2026-08-25.)_

### Checks

```
npm run typecheck -w apps/server                exit 0
eslint apps/server/src                          exit 0   (no rule disabled)
VITEST_MAX_THREADS=4 vitest run apps/server
  Test Files 204 passed (204)   Tests 4662 passed (4662)   exit 0
```

No write surface changed, because no rule changed: `claudeCodeRootFor` returns
what it returned before this issue, and the four new tests are what say so on
purpose rather than by accident.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-126]` prefix
