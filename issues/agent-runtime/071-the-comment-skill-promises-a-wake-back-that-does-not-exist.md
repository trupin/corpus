# [AGENT-071] The comment skill promises a wake-back that does not exist

## Domain

agent-runtime

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —

## Origin

Re-filed 2026-09-06 from **SHARED-003** (the PR #11 / PR #12 review ledger). The
ledger tracked the `agent.done` producer gap from sprint-016 contracting:

> (contract/server/cli chain to file) `agent.done` has no producer — §7 makes it
> load-bearing for delegation wake-back but no route/verb enqueues it
> (sprint-016 OC1; AGENT-005 ships without it, reconciling at idle returns).

The 2026-09-06 audit found the consequence the ledger did not record: the
**comment skill still tells the agent the mechanism works**. The producer gap is
a design question (tracked in SHARED-081). A skill instructing an agent to rely
on a mechanism that does not exist is a defect, and it is this issue.

## Spec References

- SPEC.md:325 — §7 core event types:

  > `agent.done` (background subagent wake-back — reserved: nothing produces it
  > yet, and an arriving one is settled like a report)

- SPEC.md:354 — §7, "Outcomes are never assumed":

  > The orchestrator parks while subagents run and settles reported outcomes
  > whenever parking returns — on a new event, or on `idle`'s ~8-minute rearm;
  > the subagent's report itself is the signal, and settlement never depends on
  > any queue event announcing it.

Both are signed spec text. The skill contradicts both.

## Summary

`assets/workspace/claude/skills/comment/SKILL.md:296` tells the agent that when a
spawned subagent finishes, "the server's `agent.done` event wakes the orchestrate
skill, which routes the result back so the thread gets its closing reply". Nothing
produces `agent.done`. The orchestrate skill says so in its own routing table, and
SPEC §7 marks the event reserved. So the comment skill's spawn instruction rests
on a wake-back that will never fire: an agent that follows it hands off work,
replies "I will come back", and has no described path by which anything comes
back. The real mechanism — settlement whenever parking returns, with the
subagent's report as the signal — is not mentioned where the agent is told to
spawn.

This is text-only. No code changes.

## Acceptance Criteria

- [ ] `comment/SKILL.md`'s spawn instruction no longer asserts that `agent.done`
      wakes anything.
- [ ] It states what actually happens instead, in the same place the agent is
      told to spawn: the subagent's own report is the signal, and the orchestrator
      settles it whenever parking returns — on a new event or on `idle`'s rearm.
- [ ] The replacement text does not describe a mechanism the product does not
      have. If the honest answer is "the orchestrator picks it up when it next
      parks", say that.
- [ ] The reply-first instruction preceding it is unchanged: replying before
      handing off is correct and stays.
- [ ] `orchestrate/SKILL.md:289` and `:536` are re-read and confirmed consistent
      with the new wording. They are currently correct — do not "fix" them into
      agreement with the wrong sentence.
- [ ] No other occurrence of `agent.done` in `assets/workspace/` claims a
      producer. Sweep and report what was found, including the nil result.
- [ ] SPEC.md is not edited by this issue. The spec is already right.

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/comment/SKILL.md` — line 296 and the sentence
  it sits in.

### Key Implementation Details

The current text, `comment/SKILL.md:291-297`:

> - **Spawn a subagent** when the work is long enough that a person should not sit
>   on a pending indicator waiting for it. **Reply first**, saying what you are
>   doing and that you will come back; then hand off. Its prompt carries the task
>   and the anchors it starts from — the ids, heading paths and snippets
>   `corpus search` printed, pasted as they printed — and never a document body:
>   it retrieves and reads through the same verbs you do. The subagent works
>   through the CLI like you do and never touches queue accounting. When it
>   finishes, the server's `agent.done` event wakes the orchestrate skill, which
>   routes the result back so the thread gets its closing reply.

Only the last sentence is wrong. Everything before it is accurate and stays.

The two correct statements to align with:

`orchestrate/SKILL.md:289`, the routing table row:

> | `agent.done` | A finished piece of background work. Nothing produces this
> event today; handle an arriving one like a report — verify the work its payload
> identifies and settle it. |

and SPEC.md:354, quoted above.

Write the replacement so it survives the producer chain being built later: the
sentence should describe the outcome the agent can count on ("the result reaches
the thread when the orchestrator next settles it"), not the plumbing. A sentence
about plumbing is a sentence that goes stale.

### Edge Cases

- `orchestrate/SKILL.md:536` lists `agent.done`'s touched set. That is a
  contingency for an arriving event and is legitimate — the event type exists on
  the wire even with no producer. Leave it.
- The product ships these skills into user workspaces via `corpus init`. A
  workspace that already has them keeps its copy until `corpus workspace
  upgrade`, so the fix reaches existing workspaces through the ordinary upgrade
  path. Nothing special is needed here, but say so in the log rather than
  implying the fix is retroactive.
- The repo's own `.claude/` is the development harness and is **not** this
  domain. Do not touch it.

## Testing Strategy

Text change. Verification is reading, plus any existing test that asserts on
skill content. Check whether `assets/workspace` has content tests before assuming
there are none.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. `rtk proxy grep -n 'agent\.done' assets/workspace/claude/skills/comment/SKILL.md`
2. Expected: no claim that the event wakes anything.
3. Actual: line 296 asserts the wake-back.
4. Cross-check `orchestrate/SKILL.md:289` and `SPEC.md:325` to confirm the
   contradiction is real and not a stale grep.

### Verification Steps

1. Re-read the amended paragraph end to end and confirm it reads as one
   instruction, not a patched sentence.
2. `corpus init` a scratch workspace from this tree and confirm the installed
   `comment/SKILL.md` carries the new text.
3. Grep the installed workspace for `agent.done` and confirm no producer claim
   survives.

## E2E Verification Log

_[Agent fills: quote the before and after text verbatim. State which model the
implementing agent ran on.]_

### Reproduction (bugs only)

_[Agent fills]_

### Post-Implementation Verification

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] `/lint` passes (prettier over markdown)
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance — the new text agrees with SPEC.md:325 and :354
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[AGENT-071]` prefix
