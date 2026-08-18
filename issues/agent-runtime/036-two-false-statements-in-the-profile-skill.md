# [AGENT-036] Two false statements in the `profile` skill: a refusal's reason, and a transcript line

## Domain

agent-runtime

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: SERVER-125 (the product half of the first one), AGENT-034 (the skill)

## Spec References

- SPEC.md **§7** line 399 — the agent-def document root
- SPEC.md **§8** — `@<subagent>` resolution

## Summary

Two statements in `assets/workspace/claude/skills/profile/SKILL.md` are false.
Found by PR #49's fifth review, judged not worth a fifth round, filed here.

Both are the same species this file has now been corrected for four times: a
claim about **another component's behaviour**, written from what the author
believed rather than from that component's code. The rule adopted in AGENT-034's
last pass — *a skill states what the agent must do and what it may conclude,
names the component that owns a rule, and does not describe that component's
internal refusals* — was applied to the paragraphs under review and not swept
across the whole file. This is the sweep.

## 1. *"it resolves to nobody"* is false — line ~219

The Refusals section says:

> Never retry into a different folder: a `type: agent-def` document filed
> anywhere but `.claude/agents/` is a document *about* an agent rather than an
> agent, and **it resolves to nobody**.

`targetIndex` (`apps/server/src/threads/mentions.ts:144-156`) indexes each
agent-def under **two** aliases — `invocableName(row.path)` *and* `row.title`,
both lowercased. `invocableName` returns null off-root; **the title alias does
not.**

So `corpus doc create --type agent-def --title Bookkeeper --folder inbox`
produces a document that:

- `@bookkeeper` **does** resolve to (`MENTION_TYPE = "agent-def"`),
- `GET /api/docs?type=agent-def` offers in the `@` autocomplete,
- carries no `name`/`description` (create's `claudeCodeFields` returns `{}` when
  `discoveredAs` is null),
- Claude Code will never load,
- and `corpus doc check` says nothing about, because the requirement is gated on
  `discoveredAs !== null` and does not fire off-root.

That is **worse** than resolving to nobody: it is SERVER-123's two-readers
divergence in its other direction — offered, resolvable, and dead.

**The instruction is right and the reason is wrong**, which is why this is not
urgent. The damage is downstream: an agent asked *"why does `@bookkeeper` never
answer?"* consults this skill, concludes a misfiled persona is inert, and looks
elsewhere. It also under-sells the refusal — the real reason not to retry into
another folder is worse than the one given.

## 2. The worked example prints output the CLI cannot produce — line ~269

```bash
corpus doc list --type agent-def
showing 0 documents
```

`runDocList` (`apps/cli/src/commands/doc/list.ts:113-117`) short-circuits an
empty result before the tally is built, so the real output is
`no documents match.`. `renderTally` is unreachable there, and would render
`showing 1–0 of 0 documents` if it were — the string in the skill is not a form
the CLI emits on **any** path.

Low consequence, since the agent reads what the command actually returns. The
risk is a skill author or agent treating the transcript as the contract — for
instance matching on `showing ` to detect an empty roster, which would never
fire.

**Scope this fix tightly.** The fifth review verified the rest of the file's
transcript lines against source and they are correct: `--type` is a real flag,
`created <id> — <path>`, `edited <id>` followed by `key <sha>`, and the
name-collision message with its exit `5` all match.

## Acceptance Criteria

- [ ] The refusal states a reason that is true — that an off-root agent-def is
      resolvable, offered, and unloadable — or states no reason and names where
      the rule lives, per the file's own adopted rule
- [ ] The transcript line matches what `runDocList` actually prints
- [ ] Every **other** command transcript in the file is checked against its
      source in the same pass, rather than fixing the two that were reported
- [ ] `scripts/workspace-template.test.ts` pins both, in the tightening
      direction
- [ ] No claim about another component's internal refusal is added while fixing
      these two

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/profile/SKILL.md`
- `scripts/workspace-template.test.ts`

### Key Implementation Details

The product half of finding 1 — whether an off-root agent-def should be reported
by `corpus doc check`, or kept out of the `@` index entirely — is **SERVER-125**
and is a product call, not a bug fix. Do not wait for it: the sentence is wrong
today whichever way that lands, and this issue can state the truth as it stands.

### Edge Cases

- The sentence must stay true if SERVER-125 later removes off-root agent-defs
  from the `@` index — prefer wording that names the consequence the agent cares
  about over wording that recites the current mechanism

## Testing Strategy

Pins for both statements. The behavioural check is reading each transcript line
against the function that emits it.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. `corpus doc list --type agent-def` on an empty workspace — compare byte for
   byte with the skill's transcript
3. Create an agent-def with `--folder inbox`, then post `@<title>` in a real
   thread and read the queue event's `mentions` — confirm what the skill now says
4. Stop the server; confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-036]` prefix
