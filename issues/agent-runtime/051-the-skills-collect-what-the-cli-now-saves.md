# [AGENT-051] The skills collect what the CLI now saves

## Domain
agent-runtime

## Status
todo

## Priority
P1 (important)

## Model
opus

## Dependencies
- Depends on: CLI-064, CLI-065
- Blocks: —

## Summary

**Filed by the orchestrator, 2026-08-23, on CLI-065's own report**, which said
it plainly: _"the orchestrate skill's reflection text should add `--fields
id,title,lastActor,updated` to its `doc list --json` command — CLI-065's saving
is unrealized until it does."_

Two savings shipped in v0.21.0 and **neither is collected by anything**:

| shipped | measured | collected today |
| --- | --- | --- |
| `doc list --fields` (CLI-065) | 203.1 → 36.7 tokens a row, **82%** | no — reflection still asks for whole rows |
| `corpus batch` (CLI-064) | 1265.5 → 353.9 ms an event, **3.58×** | no — no skill invokes it |

This is the third time in three releases that a saving shipped with nothing
asking for it. AGENT-045 was the first (`--help=brief`), UI-164 the second (a
refusal channel nothing read). **The rule is now established: a capability the
product does not use is not shipped, it is available.**

## Acceptance Criteria

- [ ] The reflection listing asks for the fields it uses and no others. Which
      fields those are is read off the skill's own text, not guessed — if the
      skill reads a field the projection drops, the saving is a bug.
- [ ] `corpus batch` is used where a skill makes a run of calls whose inputs do
      not depend on each other's outputs. The comment skill's write tail is the
      measured case: seven calls, 911.7 ms.
- [ ] **A batch is not used where one command's input is another's output.**
      CLI-064 does not thread results between entries, and a skill that assumed
      it would fail in a way the report makes look like success.
- [ ] The skill states that a batch is **not transactional**, or does not raise
      the question. §4's commit window may fold a batch's writes into one commit
      anyway, and a skill that saw that and inferred atomicity would be relying
      on timing.
- [ ] The saving is **measured on the shipping skills**, before and after, in
      tokens for CLI-065 and in milliseconds for CLI-064 — the standard AGENT-045
      and SHARED-070 set for this domain.
- [ ] No behavioural rule changes. This is a change to how the skill calls the
      tool, not to what it does.

## Technical Design

### Files to Create/Modify
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the reflection listing
- `assets/workspace/claude/skills/comment/SKILL.md` and its `references/` — the
  write tail
- `scripts/workspace-template.test.ts` — pins

### Key Implementation Details

**The comment skill was restructured hours ago** (AGENT-047) into a core file
plus seven references. Read the current text rather than any transcript: the
call sequence a batch would replace may now sit in a reference rather than the
body, and a batch instruction belongs where the calls are.

**A batch entry's `--from` matters.** CLI-064 resolves the actor per entry, and
an entry's own `--from` wins over the batch's. The skills pass `--from agent`,
so state it once on the batch rather than on every entry.

**`spawnSync({input})` cannot drive `corpus batch`** — that is CLI-066's socket
refusal, working as designed. A harness feeds a file descriptor, as a heredoc
does. Say so where the skill shows the invocation, or someone wrapping the skill
will hit it.

### Edge Cases
- A batch whose entries are all reads: safe, and the largest win.
- A batch where one entry fails: the skill must read the per-command report
  rather than the exit code alone, since exit 11 says only "something failed".
- A skill that already has one call: a batch of one is legal and pointless.

## Testing Strategy

Template tests pinning that the reflection listing carries `--fields`, that the
batch instruction names the non-transactional rule, and that no batch example
threads one entry's output into another's input.

## E2E Verification Plan

### Verification Steps
1. `corpus init` a scratch workspace from the built template
2. Run a real event through the comment skill and capture every invocation
3. Compare the token and millisecond totals against the same event before

## E2E Verification Log

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
- [ ] Committed with `[ISSUE-ID]` prefix
