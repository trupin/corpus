# [AGENT-033] A resident with no persona to bind

## Domain

agent-runtime

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-061, SERVER-121, CLI-049
- Blocks: —

## Spec References

- SPEC.md **§7** — the SHARED-048 rider
- SPEC.md **§7** line 339 — the orchestrator skill and delegation

## Summary

Both product skills assume a designation names a profile.

`converse/SKILL.md:167` — *"**Bind your persona.** The designation names an
agent, and the launch that started you carries the `resident` from the
announcement's payload — a name and the id of the `agent-def` document that
defines it. Read that document and work as it describes."*

`orchestrate/SKILL.md:290` — the launch *"give it the payload's `resident` — the
name and the `agent-def` document id both, because a subagent inherits nothing
and the persona is what the designation was for."*

With a profile optional, both are wrong for the ordinary case. A general
resident has no document to read and no persona to inherit, and neither skill
says what to do.

## Acceptance Criteria

- [ ] The converse skill binds a persona **when there is one** and works as the
      workspace's ordinary agent when there is not — stated as one rule with a
      condition, not as two parallel procedures that can drift
- [ ] The orchestrate skill's launch carries a persona when there is one and
      launches without one otherwise, with no invented placeholder
- [ ] Everything else about a listener is unchanged and **said to be
      unchanged**: the lane it holds, claiming, settling, parking, the
      stand-down rule, retirement, and resolution ending it
- [ ] The existing rule for a **missing or archived** profile (converse:151,
      *"work anyway and say so in your first reply"*) is reconciled with the new
      case — "no profile" and "a profile that has gone" must not read as the
      same thing, because one is ordinary and one is worth mentioning
- [ ] **One rule, one skill**: no mechanism is described in both files. The pins
      in `scripts/workspace-template.test.ts` must still pass, and if this change
      would put a shared passage in both, it goes in one with a pointer from the
      other
- [ ] The worked examples in both skills match their own prose

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/converse/SKILL.md` — the persona-binding step
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the launch step
- `scripts/workspace-template.test.ts` — extend the single-owner registry if a
  new mechanism vocabulary is introduced

### Key Implementation Details

**Drill it; do not review it.** Phase 33 established this three times over: skill
text that reads correctly can still fail in a live session, and reading found
none of those defects. Drive a **real Claude Code session** from the changed text
against a real workspace and a real server, and log what the session actually
did — including the general-resident path, which is the new one.

**A general resident is the ordinary case, so it reads first.** Text that treats
the profile-less path as the exception will produce sessions that treat it as
one.

### Edge Cases

- A designation replaced mid-session, profiled → general or the reverse
- A profile archived while a listener runs
- The launch payload's resident shape, whatever CONTRACT-061 settled on

## Testing Strategy

`scripts/workspace-template.test.ts` for the structural pins (shared-passage
comparison and the single-owner registry). The behavioural test is the drill.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Designate a general resident on a real standalone thread
3. Run a real Claude Code session invoking `/converse <th_…>` from the changed
   skill text; log the transcript's actual behaviour
4. Post a message in the thread; confirm the listener claims it on its lane,
   works it inline, settles it, replies, and re-parks
5. Repeat with a **profiled** resident and confirm the persona is bound
6. Resolve the thread; confirm the listener retires
7. Stop the server; confirm the port is free

## E2E Verification Log

_[Agent fills — include the drill transcript's observed behaviour, not a
summary of the text]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-033]` prefix
