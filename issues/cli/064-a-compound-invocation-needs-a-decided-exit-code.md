# [CLI-064] A batch verb needs a decided exit code before it is worth building

## Domain
cli

## Status
todo

## Priority
P1 (important)

## Model
fable

## Dependencies
- Depends on: CLI-057, CLI-058
- Blocks: —

## Spec References
- SPEC.md Section 2 — the CLI is the agent's whole surface
- SPEC.md Section 9 — exit codes and `--json`

## Summary

**CLI-058's recommendation, filed as its own issue because it needs a decision
rather than an implementation.**

CLI-058 measured the fixed cost at ~159 ms and found option 1 nearly spent: 10.1
ms taken by deferring `yaml`, 23.4 ms left in `@corpus/contract`
(CONTRACT-082), and a floor of ~135 ms that is over half Node's own — 33.6 ms
boot, 18.4 ms undici, 18.5 ms zod. Its conclusion, in its own words:

> **My recommendation is option 2, batching.** Nothing above changes the *count*
> of calls, and the count is where the cost is.

CLI-057 is the worked example: five `doc show` calls, 796.6 ms, became one call
at 189.0 ms — **608 ms saved, 4.2×**. That is forty times what deferring `yaml`
bought, on one read.

Generalising it means a way to send several commands in one invocation. The
build is cheap. **The semantics are not**, and that is why this is filed rather
than done.

## The decision this issue exists to make

**What does a compound invocation return when the third of five commands fails?**

Every answer has a cost:

- **Stop at the first failure.** Simple, and it makes a batch a worse `&&` chain:
  the agent must reason about what did and did not run.
- **Run everything, exit non-zero if any failed.** The exit code says "something
  went wrong" and nothing about what. An agent must parse `--json` to recover,
  so the human form becomes useless for the case that matters.
- **Run everything, exit with the first failure's code.** Sounds precise, and
  lies when two commands fail differently.

And `--json` has the same question one layer down: is it an array of results
positionally matching the input, an object keyed by something, or a result plus
a failure list? CLI-057 chose an array of the same payloads a single read emits,
with a missing id exiting 5 and naming `details.missing` and `details.found`.
That is a good precedent for one verb over many ids. **It is not obviously right
for many verbs**, because five different commands do not share a payload shape.

## Acceptance Criteria

- [ ] The exit-code rule is decided and written down, with the two rejected
      alternatives and why each lost.
- [ ] The `--json` shape is decided, and it says for each command whether it ran.
      "It is absent from the array" is not an answer — an agent cannot tell
      *did not run* from *ran and returned nothing*.
- [ ] Whether a batch is transactional is decided **explicitly**. Corpus commits
      through §4's window, so a batch of five writes may already be one commit,
      and a reader will assume atomicity the CLI has not promised.
- [ ] Only then, the verb.
- [ ] The saving is measured against real multi-call sequences the product's own
      skills make, not a synthetic five.

## Technical Design

### Files to Create/Modify
- the decision, in this issue file, before any source file
- `apps/cli/src/commands/` — the verb, once decided

### Key Implementation Details

**Do not start with the verb.** The measurement is already done and is not in
doubt. What is in doubt is what the thing means when it half-works, and a batch
verb whose failure semantics were decided by its implementation is one nobody
can rely on.

Read CLI-057's decisions first — the rule character, the repeat handling, the
cap at `MAX_PAGE_LIMIT`, the exit-5-with-details shape. It solved the same
problem for one verb over many arguments, and its answers are the starting
position rather than a template to copy.

### Edge Cases
- A command in the batch that is interactive or that writes to stdout in a form
  the batch cannot frame.
- A batch where one command's output is another's input. If that is out of
  scope, say so in the verb's help rather than leaving it to be discovered.
- A batch of one.

## Testing Strategy

Decided after the semantics are. Whatever they are, the test that matters is the
partial failure: three succeed, one fails, one never runs, and every one of those
three states is distinguishable in both output forms.

## E2E Verification Plan

### Verification Steps
1. Real invocations against a real server, including a partial failure
2. The measurement, against a sequence a shipped skill actually makes

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
