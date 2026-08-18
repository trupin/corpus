# [AGENT-036] A transcript line the CLI cannot print (and a sentence SERVER-125 made true)

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

## STOP — finding 1 was inverted by SERVER-125 on 2026-08-18

**Do not fix finding 1. Fixing it would make the sentence false.**

SERVER-125 landed in the same release and chose route 2: `targetIndex` now skips
any row whose `invocableName` is null, the title alias included. An off-root
`type: agent-def` document is addressable under **no** spelling.

So the sentence this issue was filed to correct —

> a `type: agent-def` document filed anywhere but `.claude/agents/` is a document
> *about* an agent rather than an agent, and it resolves to nobody

— **is now true**, and it was made true by changing the product rather than the
prose. The instruction was right and the reason was right; only the code
disagreed, and the code was what was wrong.

**This issue is therefore reduced to finding 2**, plus its sweep criterion. The
analysis below is kept because it is the record of why SERVER-125 chose what it
chose, and because a later reader who finds the sentence and remembers this issue
needs to know the sentence won.

**What is still worth doing about finding 1:** nothing to the sentence itself.
Check only that no *other* line in the file contradicts it, since the file was
written when the sentence was false.

## 1. *"it resolves to nobody"* was false when filed — line ~209 — and is true now

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

- [ ] **The "resolves to nobody" sentence is left exactly as it is.** SERVER-125
      made it true. Editing it is the failure mode this issue now guards against
- [ ] No *other* line in the file contradicts it — the file was written while the
      sentence was false, so a neighbouring line may still describe the old
      behaviour
- [ ] The transcript line matches what `runDocList` actually prints
- [ ] Every **other** command transcript in the file is checked against its
      source in the same pass, rather than fixing the one that was reported
- [ ] `scripts/workspace-template.test.ts` pins the transcript line and the
      "resolves to nobody" sentence, in the tightening direction. The second pin
      is what stops a future reader "correcting" a sentence that is now right
- [ ] No claim about another component's internal refusal is added while fixing
      this

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/profile/SKILL.md`
- `scripts/workspace-template.test.ts`

### Key Implementation Details

**Superseded, 2026-08-18.** This section told the implementer not to wait for
SERVER-125 because *"the sentence is wrong today whichever way that lands"*. That
reasoning was wrong. SERVER-125 landed in the same release, chose to remove
off-root agent-defs from the `@` index, and made the sentence right. Had this
issue been worked first, as this section advised, it would have introduced the
error it was filed to remove.

The lesson is narrower than "wait for dependencies". It is that **a prose fix
predicting a product decision is a bet**, and this file has now lost that bet
after winning it four times.

### Edge Cases

- The sentence describes a **consequence** ("resolves to nobody") rather than a
  mechanism, which is why it survived a change of mechanism. Keep it that way.
  Wording that recited `targetIndex`'s two aliases would now be stale
- A neighbouring line may still describe the pre-SERVER-125 behaviour

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
