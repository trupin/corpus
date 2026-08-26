# [AGENT-054] A listener starts with work already waiting, and that is now ordinary

## Domain

agent-runtime

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: SERVER-152
- Blocks: —

## Spec References

- SPEC.md §7 — riders A and C, signed 2026-08-25

## Summary

Rider A's lazy-launch clause changes when a listener starts: **only once its lane
has work pending.** So a listener's first claim always returns work, and starting
to a backlog stops being an anomaly and becomes the only way it ever starts.

The `converse` skill was written for the opposite case — designation, then a
listener, then messages. Its reconciliation of the held list, in particular, was
written to distinguish work it claimed from work somebody abandoned, a
distinction the fallback made necessary.

## Acceptance Criteria

- [ ] The skill states that starting with pending work is **normal**, not a
      recovery case, and says why: a listener is launched because work arrived
- [ ] The held-list reconciliation is re-read against rider C. Under the old
      rules a row could be an orchestrator's live dispatch; now nothing else ever
      holds this lane's events, so the ambiguity that made reconciliation
      delicate is gone. Simplify it or say why it stands
- [ ] **A listener never assumes it is the first.** A relaunch after a crash finds
      its own abandoned work, which is a real case and is not what changed
- [ ] Any text describing the orchestrator as a fallback for this lane is deleted
- [ ] The retrieval discipline is unchanged: a listener that starts fresh reads
      the thread, because §7 already says the thread's turns are the conversation
- [ ] Every deleted argument has its conclusion re-derived rather than orphaned

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/converse/SKILL.md`
- its `references/` files, if any carry the same assumptions

### Key Implementation Details

Grep `fallback`, `lapse`, `orchestrator` in this skill and judge each hit. Some
mentions of the orchestrator are correct and unrelated — it still launches this
listener, still owns `resident.designated`, and still owns lane-independent
concerns.

**The cost SHARED-072 chose deliberately belongs here in one sentence**: a
resident does not retain the conversation between launches, and re-reads the
thread when it starts. Lazy launch bought a listener count that tracks work
rather than conversations, and this is what it cost.

### Edge Cases

- A listener launched, finding its lane already emptied by a faster claim: park,
  do not error. With one consumer per lane this should be impossible, so if it
  happens something else is wrong — say so rather than papering over it.
- A designation released while the listener runs: unchanged by this issue, and
  already covered.

## Testing Strategy

Prose, as AGENT-053. A grep sweep with every remaining hit justified, and a
walk-through of a cold start against a three-message backlog.

## E2E Verification Plan

Real workspace: post three turns to a designated thread with nothing running,
launch `/converse <thread>` by hand, and confirm it claims all three, answers
them in order, and parks. Paste the output.

## E2E Verification Log

<!-- filled by the implementing agent -->

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-054]` prefix
