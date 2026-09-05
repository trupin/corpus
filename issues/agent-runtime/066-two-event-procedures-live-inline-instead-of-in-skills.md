# [AGENT-066] Two event procedures live inside `orchestrate` instead of in skills of their own

## Domain

agent-runtime

## Status

todo

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Blocks: AGENT-067 (the remaining split, which is easier once these are gone)
- Related: INFRA-038 (the budget this serves), INFRA-039

## Spec References

- SPEC.md **§7** — the agent loop, and skills as documents in the workspace
- **INFRA-038** — the size budget: warn 2K tokens, error 4K

## Summary

`assets/workspace/claude/skills/orchestrate/SKILL.md` is **167,737 bytes, about
41,900 tokens**. It is 31% of every skill and agent profile this repository
tracks, and every orchestrator run reads all of it before doing anything.

**The file already names the anomaly this issue fixes.** Its Routing table
dispatches every event type to a skill — `comment.created` and `form.respond` to
**comment**, `resident.designated` to **converse** — except two rows, which say
so out loud:

> `doc.edited` — A subagent working **Reflecting on a user edit** below — **one of
> the two events whose procedure lives in this skill instead of in a skill of its
> own**.
>
> `workspace.reflect` — A subagent working **Reflecting on the corpus** below —
> **the other one**.

Those two sections cost **6,448 tokens**, 15% of the file:

| Section | Tokens | Share |
| --- | --- | --- |
| Reflecting on a user edit | 4,437 | 10% |
| Reflecting on the corpus | 2,011 | 4% |

Every orchestrator run pays for both. `doc.edited` and `workspace.reflect` are a
minority of events, and the orchestrator never performs either procedure itself —
it pastes the text into a subagent's prompt. That is exactly the split rule
INFRA-038 states: **move only what a minority of runs reads.**

## What to build

Two new skills under `assets/workspace/claude/skills/`, installed by
`corpus init` like the others:

- **`reflect-edit`** — the `doc.edited` procedure, moved whole.
- **`reflect-corpus`** — the `workspace.reflect` procedure, moved whole.

Then change the two Routing rows to dispatch to them exactly as every other row
dispatches to a skill, and delete the two sections from `orchestrate`.

**This is a move, not a rewrite.** The procedures are correct and are not what is
being fixed. Carrying them across unchanged is what makes this issue safe to do
before AGENT-067, which does change text.

## Why this is the right shape rather than a reference file

INFRA-038 offers two ways to split, and this is the first one: a piece that is
**invocable in its own right**. Three things make these skills rather than
references:

1. **They are dispatched, not consulted.** A subagent is launched to perform them.
   That is what a skill is in this workspace, and the routing table's other rows
   prove it.
2. **The dispatch gets simpler.** Delegation currently carries a carve-out — the
   binding rules travel in the prompt *"only where the dispatch runs a procedure
   from this skill rather than a skill of its own."* With no such procedure left,
   that clause and the reasoning around it go too.
3. **A skill is versioned, archivable and on the board** like every other document
   (§7). A reference file is none of those.

## Acceptance Criteria

- [ ] `reflect-edit` and `reflect-corpus` exist with valid frontmatter and are
      installed by `corpus init`.
- [ ] `orchestrate`'s two Routing rows dispatch to them in the same words the
      other rows use, and the "one of the two events whose procedure lives in this
      skill" phrasing is gone from both.
- [ ] The two sections are **deleted** from `orchestrate/SKILL.md`.
- [ ] The Delegation carve-out about procedures from this skill is removed.
- [ ] `orchestrate/SKILL.md` drops by at least 6,000 tokens. Record the before and
      after.
- [ ] Neither new skill exceeds INFRA-038's 4K error line. `reflect-edit` is 4,437
      today, so it lands just over — either it shrinks, or the issue records why it
      stays and files the shrink. Do not move the threshold to fit it.
- [ ] The procedures' text is carried across **unchanged** except for what a
      standalone skill needs: frontmatter, an opening that states its own subject,
      and the invariants it inherits.
- [ ] `scripts/workspace-template.test.ts` passes, with guards added for the two
      new skills.
- [ ] A `doc.edited` event and a `workspace.reflect` event both still get worked,
      verified against the real app.

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/reflect-edit/SKILL.md` — new.
- `assets/workspace/claude/skills/reflect-corpus/SKILL.md` — new.
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — two rows changed, two
  sections deleted, one carve-out removed.
- `scripts/workspace-template.ts` and `.test.ts` — the template manifest and its
  guards.

### Key Implementation Details

**A skill inherits nothing.** `converse` opens with an *Inherited invariants*
section for exactly this reason, and both new skills need the same: a subagent
gets only its prompt. Copy that pattern rather than inventing one.

**Check whether `corpus init` enumerates skills or lists them.** If the workspace
template names each skill explicitly, both must be added there or they ship to
nobody.

### Edge Cases

- A workspace upgraded from an earlier version has an `orchestrate` that still
  carries the procedures and no new skills. `corpus upgrade` is what reconciles
  that — confirm it does, and if it does not, say so and file it rather than
  assuming.
- A dispatch that names a skill the workspace does not have. Routing already
  covers a missing target: do the work as well as you can and say the target was
  not found.

## Testing Strategy

- `workspace-template.test.ts` guards: both files present, valid frontmatter,
  named in the manifest.
- A guard asserting `orchestrate` no longer contains either section heading.
- A size assertion on `orchestrate/SKILL.md` recording the drop, so a later edit
  that reinstates the text fails visibly.

## E2E Verification Plan

### Verification Steps

1. `corpus init` a scratch workspace. Confirm both skills install and appear on
   the board.
2. Edit a document as `user` through the real app to raise a real `doc.edited`.
   Run the orchestrator. Confirm the dispatch names `reflect-edit` and the work
   happens.
3. Raise a `workspace.reflect` and do the same.
4. Record `orchestrate/SKILL.md`'s size before and after.

## E2E Verification Log

_Filled in by the implementing agent. State which model it ran on._

### Post-Implementation Verification

_[Agent fills: both event types worked end to end, both sizes]_

## Completion Checklist (domain agent)

- [ ] Both event types verified working against the real app
- [ ] Before and after sizes recorded
- [ ] `/lint` passes
- [ ] E2E log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (touches the core loop — qualifies)
- [ ] `/evaluate` passes
- [ ] Committed with `[AGENT-066]` prefix
