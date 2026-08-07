# [AGENT-019] The loop block renders dispatch as a comment, so chaining `claim-all && idle` silently drops it

## Domain

agent-runtime

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: the `held` in-progress list (`corpus queue claim-all`), which is the
  safety net this failure also defeats

## Spec References

- SPEC.md **§7** — "Loop: `claim-all` → dispatch each event → `idle` → repeat.
  **Every event is delegated**"; the order is already specified, so this issue
  needs no spec change. It is a HOW problem, which is the skill's business

## Summary

**Reported by the user from a live run of their own orchestrator, 2026-08-07.**
Events were claimed and never dispatched: the queue moved them to `in-progress/`
and nothing ever worked them.

The user's diagnosis, which reproduces the failure exactly:

1. `corpus queue idle` **carries the event notification in its output** — when it
   wakes on a new event, the return itself signals work is ready.
2. The session was chaining `corpus queue claim-all && corpus queue idle` as a
   **single background command** and re-launching it on every completion
   notification **without ever reading the prior output**.
3. So each cycle ran: `claim-all` (moving the event to in-progress) → `idle`
   (re-parking). The event was claimed and never dispatched. The chain
   **structurally cannot** dispatch, because there is no step between the two
   commands where dispatch could happen.

## Why the current text does not prevent it

Not merely "it implies the order without prohibiting the shortcut". It is worse
than that — **the formatting actively suggests the broken shape.**

The loop block (`## The loop`, around L69-81) reads:

    corpus queue claim-all      # the pending batch, plus what the server still holds in-progress
    # reconcile that held list against your own work first (Claiming and batching below),
    # then dispatch every claimed event to a subagent (Routing and Delegation below), and park:
    corpus queue idle           # returns on a new event or on its ~8-minute rearm

Every **executable** line in that block is a `corpus queue` call. The one
load-bearing step between them — dispatch — is a `#` comment. An agent reading a
bash fence as a script to run drops the comments and is left with exactly
`claim-all` then `idle`. Collapsing those into one command is not a misreading of
the block; it is the literal reading of its executable content.

L83's "The order is claim → dispatch → park" states the order and does not
forbid the collapse.

## Why there is no server-side half

The server cannot fix this, and that is consistent with the user's earlier
ruling on queue reconciliation (2026-08-05): *"only the agent can reconcile."*
`claim-all` moves events to `in-progress/`, and from the server's side a claimed
event that is being worked and a claimed event that was abandoned are
indistinguishable — the difference lives entirely in the agent's session.

Note the compounding: the `held` in-progress list that `claim-all` returns
**is** the designed safety net for precisely this failure, and it did not fire —
for the same root cause. Nothing read the output. A safety net delivered through
a channel the failure mode ignores is not a safety net.

## Acceptance Criteria

- [ ] The skill **prohibits** chaining: `corpus queue claim-all` and
      `corpus queue idle` are never combined into one command
- [ ] It states that `corpus queue idle` runs **alone** as the background command
- [ ] It states that on **every** completion notification the output is read
      **before** anything else happens — the output is the event notification,
      not a log
- [ ] The loop is stated as discrete steps — idle returns → read output →
      claim-all → dispatch → re-park — with dispatch as a **step**, not as a
      comment inside a code fence
- [ ] The `## The loop` block no longer renders the dispatch step as a `#`
      comment between two executable commands. Whatever shape replaces it, the
      literal executable reading of the block must not be a working loop that
      skips dispatch
- [ ] The `## Worked example` section (around L679-740) is checked for the same
      shape and fixed if it has it — an example contradicting the rule beats the
      rule
- [ ] `scripts/workspace-template.test.ts` passes, and gains an assertion
      pinning the prohibition so it cannot be edited away silently

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md` — `## The loop`
  (~L65-96), `## Claiming and batching` (~L98), `## Worked example` (~L679), and
  the frontmatter `updated` timestamp
- `scripts/workspace-template.test.ts`

### The skill-file constraints that bite

Verified against the test file, but **re-verify rather than trusting these
numbers** — they have moved before:

- **Exact section count**: `expect(sections.size).toBe(16)` for orchestrate.
  Adding a `## ` section is a two-file change; prefer editing in place.
- **The orchestrate counter is NOT fence-aware** (the comment skill's is). A
  `## ` line inside a fenced block in this file **will** be counted and will
  break the count. This matters directly here, because the fix touches fenced
  blocks.
- Every `## ` section body must exceed **400 characters** after trimming.
- **Forbidden prose**: the hedges `use your judgment`, `consider whether`,
  `you may want`, `if appropriate`, and the strings `SPEC.md`, `CLAUDE.md`,
  `issues/`. Write an instruction, not a consideration.
- **Heredoc mechanics**: every multi-line shell argument uses a quoted heredoc
  (`<<'EOF'`); `-m "$(` is banned.
- **`EXPECTED_TREE` is exhaustive equality** — adding any file under
  `assets/workspace/` fails until the list is updated.

### Notes

- **Do not fix this by adding a sentence and leaving the block as it is.** The
  sentence is necessary and not sufficient; the block is what an agent copies.
- Resist restating the whole loop in prose as well as in a block — two
  descriptions of one procedure drift, and this project has already fixed four
  cases of exactly that. One authoritative shape.
- The point of reading `idle`'s output is not bookkeeping: it is the arrival
  signal. Say what the output is *for*, or the instruction reads as diligence
  and will be dropped under pressure the same way.

## Testing Strategy

`scripts/workspace-template.test.ts` is the whole surface — the skill is prose
and its guarantees are structural. Pin the prohibition and the discrete-steps
shape in the register the file already uses.

## E2E Verification Plan

The skill is only real once installed, so verify through the product:

1. `corpus init` a scratch workspace from the built package on a non-default port
   (never 8765, never 5173) and confirm the skill landed with the new text.
2. Start the real server and the agent loop there.
3. Post a comment addressed to the agent. **Expected: the event is claimed and
   dispatched**, and `corpus job list` shows work, not an event sitting in
   `in-progress/` with nothing running.
4. Confirm the loop parks again afterwards and a second event is picked up.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
