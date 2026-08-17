# [AGENT-030] The converse skill teaches the old server, and dies at the shell on a refused park

## Domain

agent-runtime

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Related: SERVER-118 (which changed the behaviour), AGENT-025

## Summary

`assets/workspace/claude/skills/converse/SKILL.md:583-587` says:

> "A scoped park on a lane nobody has designated is **accepted and parks; it does
> not error**, because a lane may be designated a moment later and the server
> does not second-guess the caller. So a listener that skips the check waits
> forever on a conversation that no longer has it, invisible to everyone…"

`SERVER-118` refuses that park with a 422. **Every clause is now false,
including the stated failure mode** — and SERVER-118's own docblock says "the
re-park is refused", so the change was made knowing this paragraph described
re-parking.

**The consequence is worse than stale prose: the resident dies at the shell.**

> A release lands between a pass's `corpus agents` read (top of the loop) and
> its park (step 6) — the window the skill itself calls "one rearm late".
> `corpus queue idle --thread th_X` returns 422; `apps/cli/src/commands/queue/
> poll.ts:169` throws it straight through as exit 5. The skill has no
> instruction for a park that errors, so the resident exits **without running
> Retirement** — it never settles the event it holds and never posts the
> sign-off turn the skill requires.

So a release timed one rearm badly strands a claimed event and leaves the
conversation with no goodbye.

## Acceptance Criteria

- [ ] The stale paragraph states what the server now does, for both verbs — the
      park is refused, the claim is not, and why they differ
- [ ] **A refused park is a normal ending, not a crash.** The skill instructs
      the listener to run Retirement: settle what it holds, post the sign-off,
      exit cleanly. A 422 on the park means the lane is no longer yours, which
      is precisely the condition Retirement exists for
- [ ] Distinguish a refused park from any other failure. A 422 is "this is not
      your lane any more"; a network error is not, and must not silently retire
      a listener that still owns its conversation
- [ ] Drilled: release a resident between its roster read and its park, and show
      it settling and signing off rather than dying. That is the reproduction

## Testing Strategy

Template assertions for the text. The drill is the acceptance test.

## E2E Verification Log

_Filled by the implementing agent. Reproduce first._

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-030]` prefix
