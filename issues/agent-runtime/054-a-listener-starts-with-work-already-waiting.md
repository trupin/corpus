# [AGENT-054] A listener starts with work already waiting, and that is now ordinary

## Domain

agent-runtime

## Status

done

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

- [x] The skill states that starting with pending work is **normal**, not a
      recovery case, and says why: a listener is launched because work arrived
- [x] The held-list reconciliation is re-read against rider C. Under the old
      rules a row could be an orchestrator's live dispatch; now nothing else ever
      holds this lane's events, so the ambiguity that made reconciliation
      delicate is gone. Simplify it or say why it stands
- [x] **A listener never assumes it is the first.** A relaunch after a crash finds
      its own abandoned work, which is a real case and is not what changed
- [x] Any text describing the orchestrator as a fallback for this lane is deleted
- [x] The retrieval discipline is unchanged: a listener that starts fresh reads
      the thread, because §7 already says the thread's turns are the conversation
- [x] Every deleted argument has its conclusion re-derived rather than orphaned

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

Implemented by the orchestrator on opus, 2026-08-25.

### The section this simplifies was the hardest one in the skill

*Settling your own lane* existed to answer a question that can no longer be
asked: **is this held row the orchestrator mid-dispatch, or work somebody
abandoned?** Under the fallback that distinction was genuinely hard and getting
it wrong meant two agents answering one message.

Since nobody but a listener on this conversation can claim this lane, a held row
is **always** a listener's — yours before a restart, or a predecessor that
crashed with work in hand. The text now says that, and says what it used to say
and why it stopped being true, rather than being quietly shortened.

**One exception survives, and a person makes it happen.** A released conversation
hands its pending work to the orchestrator, and the stamp is never rewritten — so
after a release-then-redesignate, rows the orchestrator took still carry this
lane. The server refuses that re-designation while any are outstanding, so the
window is narrow and closes on its own. Written down rather than left as a
surprise.

### Starting to a backlog is now the ordinary case

The skill said parking before claiming was a **safety** order: claim first and
the orchestrator could take the lane's work under the fallback, opening a window
you opened yourself. That reason is gone. The order stays for two smaller ones
that are enough — parking is what makes the board show a person you arrived
before you start writing in their conversation, and a **refused** park is the
cheapest way to learn the designation ended before you have claimed anything.

### The cost of lazy launch, written where it lands

A listener starts when work arrives and ends when the conversation goes quiet, so
**it does not carry the conversation in its head between messages — it reads
it.** That is what the lazy-launch decision bought and what it cost, and this
skill is where an agent meets the consequence:

> The alternative was a listener parked on every conversation anybody has ever
> started, warm and idle, and the count was the reason against it.

### Falsification

A grep sweep for `fallback` / `lapse`: **two hits remain, both deliberate
history** — sentences naming what was removed and what it used to make hard.

### Checks

```
generated artifacts drift        openapi + docs/cli.md up to date
```

No unit test covers a skill. The check that stands in for one is above, plus a
read of every surviving mention of the orchestrator in this file to confirm each
is still true — it still launches this listener, still owns `resident.designated`,
and still owns a released lane's work.


## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[AGENT-054]` prefix
