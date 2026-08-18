# [SERVER-125] An off-root agent-def is offered, resolvable, and dead

## Domain

server

## Status

todo

## Priority

P1

## Model

fable

## Dependencies

- Depends on: SERVER-123
- Blocks: —
- Related: AGENT-036 (the skill sentence that describes this wrongly today)

## Spec References

- SPEC.md **§7** line 399 — `.claude/agents/*.md` as the agent-def root, and
  *"`corpus doc check` validates both sets"*
- SPEC.md **§8** — `@<subagent-name>` is a directive routed to that persona
- SPEC.md **§11** line 539 — the `@` autocomplete, backed by `GET /api/docs`

## Summary

A `type: agent-def` document filed **outside** `.claude/agents/` is offered to
people, resolvable by the agent, invisible to Claude Code, and unreported by
every check. Found by PR #49's fifth review while checking a skill sentence that
claimed such a document "resolves to nobody".

It does resolve. `targetIndex` (`apps/server/src/threads/mentions.ts:144-156`)
indexes each agent-def under **two** aliases — `invocableName(row.path)` and
`row.title`, both lowercased. `invocableName` returns null off-root; the title
alias does not.

So `corpus doc create --type agent-def --title Bookkeeper --folder inbox`
produces a document that:

| | |
| --- | --- |
| `@bookkeeper` in a comment | **resolves to it** (`MENTION_TYPE = "agent-def"`) |
| the `@` autocomplete | **offers it** (`GET /api/docs?type=agent-def`) |
| `name` / `description` frontmatter | **absent** — `claudeCodeFields` returns `{}` when `discoveredAs` is null |
| Claude Code | **never loads it** |
| `corpus doc check` | **says nothing** — the requirement is gated on `discoveredAs !== null` |

That is SERVER-123's two-readers divergence in its **other** direction. SERVER-123
closed the case where a document in the right root lacks the fields; this is a
document in the wrong root that looks addressable from every surface a person or
agent touches, and answers from none.

**Not a regression.** Before Phase 34, *every* CLI-created agent-def landed
off-root, so this was the norm and the divergence was universal. SERVER-122 and
CLI-050 made the root the default, which narrows this to an explicit `--folder`
opt-out — a much smaller target, and now a surprising one, because everything
else about creating a persona started working.

## The question to settle

**Should an agent-def outside its root be addressable at all?** Three readings,
and the issue does not pick one:

1. **Report it.** `corpus doc check` gains a finding for a `type: agent-def`
   document outside `.claude/agents/`. Cheapest, keeps every existing document
   working, and makes the state visible. Follow SERVER-123's precedent:
   **reported, never blocking** — a blocking finding would make existing
   documents unwritable, which is the regression PR #49's third review caught.
2. **Stop offering it.** Drop the title alias for agent-defs whose path is
   off-root, so `@bookkeeper` resolves to nothing and the autocomplete omits it.
   Honest, and it makes the skill's current sentence true — but it silently
   breaks any workspace that has been mentioning such a persona, and those
   mentions become "target not found" rather than doing nothing.
3. **Both**, in that order: report now, stop offering after a release in which
   people could see the report.

Weigh 2 against §8's rule that a missing or archived target *"is never silently
ignored"* — the agent says so in its reply. That rule argues a mention resolving
to nothing is a legible state, not a broken one, which strengthens route 2.

## Acceptance Criteria

- [ ] The state is no longer silent: an off-root `type: agent-def` document is
      either reported by `corpus doc check`, or not offered as a mention target,
      or both — and the choice is recorded with the rejected alternatives
- [ ] Whatever is chosen, **no existing document becomes unwritable** — the
      SERVER-123 regression is the precedent, and its fix is the shape
- [ ] A document *about* a persona, deliberately filed under `data/docs/`, is
      still expressible. That case is why `--folder` wins over the by-type
      default (SERVER-122), and it must not be collateral damage
- [ ] `assets/workspace/claude/skills/profile/SKILL.md` is reconciled — AGENT-036
      corrects its sentence against today's behaviour, and this issue must not
      leave that sentence false again in the other direction
- [ ] The two-alias indexing is documented where it is read, since it is the
      mechanism nobody expected

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/mentions.ts` — `targetIndex`'s two aliases
- `apps/server/src/core/check.ts` — the finding, if route 1 or 3
- `apps/server/src/docs/write.ts` — the reported/blocking partition
  (`isClaudeCodeRequirement`'s sibling)

### Key Implementation Details

The title alias is not an accident and predates the agent-def root being
creatable — it is what let a hand-authored profile be addressed by its human
title. Read why it exists before removing it: the same alias serves skills, and
a change here reaches `@` resolution for every type `targetIndex` covers.

### Edge Cases

- An agent-def whose title and stem differ, in the root — the common case since
  SERVER-122, and it must keep both aliases
- A workspace that has been mentioning an off-root persona for months
- The autocomplete and the resolver must agree: offering what will not resolve is
  worse than either

## Testing Strategy

Resolution tests for on-root and off-root agent-defs by stem and by title, plus
the autocomplete query. Falsify by reverting the chosen change and watching the
specific case go green.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Create an agent-def with `--folder inbox`; post `@<title>` in a real thread
3. Read the queue event's `mentions` — confirm the chosen behaviour
4. Confirm an on-root persona still resolves by both stem and title
5. Confirm a document *about* a persona is still creatable and does not become
   an accidental mention target
6. Stop the server; confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-125]` prefix
