# [AGENT-041] Nothing tells the launch what model to run at, so a designation's weight is decorative

## Domain
agent-runtime

## Status
done

## Priority
P0

## Model
fable

## Dependencies
- Related: AGENT-039 (which was meant to deliver this), SHARED-055, SHARED-022/023, CONTRACT-067, SERVER-129, CLI-053, AGENT-040 (same file, same pass)

## Spec References
- SPEC.md **§7** — a resident works its conversation inline, at the weight its designation names
- SPEC.md **§7** — the weight rider (signed 2026-08-06): a stated weight is *"honoured, not weighed again"* and *"travels to whatever actually does the work"*

## Summary

Reported from live use, 2026-08-21: *"there's no way to specify the model when
starting the resident."*

**Confirmed, and the gap is larger than the report.** The orchestrate skill tells
the orchestrator what model to launch at, and never tells it **how**:

> **Find the row whose Key cell holds it, and launch the listener at that row's
> model.** Name that model in the launch prompt too, because a resident is told
> what it runs at and nothing else tells it.

A grep of `assets/workspace/claude/skills/orchestrate/SKILL.md` for
`subagent_type`, `model:`, `Task tool` or `Agent tool` returns **nothing**. The
Delegation section says dispatch goes "through Claude Code's subagent mechanism —
the Task (Agent) tool", and lists what the prompt must carry, including "the
model you are launching it at" — as a **prompt field**, beside the event id and
the anchors.

So the instruction an agent can actually follow is: write the model's name into
the prose. The subagent then runs on whatever model it would have run on anyway.

## Why this is P0

**The weight is discarded silently, which is the exact failure SHARED-055 was
signed to end.** That rider records the same shape: an instruction whose failure
clause cannot detect its own failure, so the user's choice vanishes without a
word. v0.14.0 then built the whole chain to carry a weight — `CONTRACT-067` put
it on the wire, `SERVER-129` stored and reported it, `CLI-053` let a person state
it and `corpus agents` print it, and `AGENT-039` was *"a listener is launched at
the designation's weight"*.

Every link exists except the last one, and the last one is the only link that
changes what actually answers the conversation. A person can choose a weight,
see it stored, see it printed on the roster — and be answered by a model nobody
chose.

## What to build

State the mechanism, concretely enough to execute. The Agent tool takes a model
override as an argument; the skill must name it and show it, in the same way the
skill shows every `corpus` invocation it expects.

**A named model in prose is not a substitute and must stop being offered as
one.** Keep telling the resident what it runs at — §7 requires that a resident
knows, and AGENT-021 requires every turn to name the model that wrote it — but
the prompt field is *how the resident learns its name*, never how the runtime is
chosen. The skill currently conflates the two, and that conflation is the defect.

## Decisions to make and record

1. **How to write the launch so it is executable**, not described. Every
   `corpus` call in this skill is shown as a runnable line; the launch is the one
   instruction given only in prose. Match the surrounding convention.
2. **What happens when the tier table's model is not available to the installed
   agent.** The skill already has a rule for a weight it cannot meet — launch
   anyway at your own judgment and log the deviation. Check it still reads
   correctly once the mechanism is explicit, because "launch anyway" is a
   different act when the model is an argument that can be rejected.
3. **Whether the same gap exists for ordinary dispatch, not only for a
   listener.** Delegation names the model as a prompt field there too. If a
   per-event subagent is also running on an inherited model, the weight rider is
   unhonoured everywhere and this issue is larger than a listener launch. **Check
   before writing, and say what you found either way.**
4. **Whether `converse` needs a matching change.** AGENT-032 was filed because
   one rule written into two skills drifted, and it was the fourth finding in
   three passes from a single duplicated rule.

## Acceptance Criteria
- [ ] The skill names the launch mechanism's model argument and shows a
      runnable launch
- [ ] A designation at a stated weight launches its listener at that weight's
      model, demonstrably rather than by assertion
- [ ] The prompt still tells the resident what it runs at, and the skill says
      plainly that the prose is not what selects the runtime
- [ ] The unavailable-model rule still reads correctly against the explicit
      mechanism
- [ ] Decision 3 answered in writing: does ordinary dispatch have the same gap
- [ ] `scripts/workspace-template.test.ts` pins the mechanism so it cannot be
      reverted to prose

## Testing Strategy
`scripts/workspace-template.test.ts` is where skill text that must not drift is
pinned. Pin the launch's model argument. A skill is prose, so the test is the
guard.

## Decisions Record

1. **How the launch is written so it is executable.** As the mechanism, stated once where
   dispatch is owned (Delegation) and consumed at both launch sites. Delegation now opens
   with *"The call's `model` argument is what chooses the runtime, and the prompt chooses
   nothing"*, names the spelling (the model's lowercase family name — the Sonnet row
   travels as `sonnet`, the Opus 5 row as `opus`), and shows a fenced `Task(model: …,
   prompt: …)` call. The listener-launch bullet shows its own `Task` call with
   `model: "sonnet"` beside the `/converse th_…` prompt, matching the worked example beside
   it, and the roster-launch clause names "the same `model` argument on the same Task call"
   rather than acquiring a second account.
2. **The unavailable-model rule against the explicit mechanism.** The three causes stand,
   and the first two now have one concrete shape: the `model` argument comes back refused.
   The rule adds that *launch anyway* means making the call again with a value your own
   judgment picks — never proceeding without the argument — so the refusal is announced at
   the call instead of discovered never. The listener half ("stated twice, and here the
   launch prompt is one of the two") is unchanged and still reads correctly.
3. **Does ordinary dispatch have the same gap? Yes — the gap was Delegation-wide.**
   Verified before writing: the pre-fix Delegation named the model only as a prompt field
   ("the model you are launching it at", listed beside the event id and the anchors), and a
   grep of the whole skill for `subagent_type`, `model:`, or any tool argument returned
   nothing. Every per-event subagent was therefore also running on an inherited model, and
   the weight rider was unhonoured for dispatches exactly as for listeners. Fixed at the
   root rather than scoped down: the mechanism paragraph binds **every** launch this skill
   makes ("set it on **every** launch this skill makes"), and the pin asserts that
   sentence.
4. **Does `converse` need a matching change?** No. A resident never chooses its own model —
   its launch tells it what it runs at, which is unchanged and still true (the prompt is
   how it learns its name), and its side-task hand-offs are already bound to "the same
   delegation rules the orchestrate skill states", which now include the argument. Adding a
   second account of the mechanism there would be the AGENT-032 shape; the launch mechanism
   stays single-owner in orchestrate. (Converse did change for AGENT-040 — the startup
   `live` branch — but that is the other issue's fix, recorded there.)

## E2E Verification Log

**Model: Fable 5 (`claude-fable-5`).**

- **The gap, confirmed in the source before writing**: `grep -n "subagent_type\|model:\|Task
  tool\|Agent tool"` over the pre-fix
  `assets/workspace/claude/skills/orchestrate/SKILL.md` found the Task (Agent) tool named
  with no argument anywhere, and the model present only as prompt prose — in the dispatch
  paragraph and in both launch clauses. Decision 3 above records that this made the issue
  Delegation-wide.
- **The mechanism exists as stated**: the Claude Code Agent (Task) tool this product's
  agent runs under takes a `model` override argument beside `prompt` (verified against the
  live tool schema in this session's own Claude Code environment — the same mechanism the
  skill names; the tier table's rows map to `haiku` / `sonnet` / `opus`).
- **The weight chain below the skill, re-verified on a real server** (port 8899,
  2026-08-21, shared with AGENT-040's drill): `corpus thread designate th_rbo4oump
  --weight standard` printed `designated a general resident at standard`, the claimed
  `resident.designated` carried `"weight":"standard"`, and `corpus agents` printed
  `a general resident at standard` — so the stated weight reaches the launcher intact, and
  the only missing link was the one this issue closes: the argument on the launch call.
- **Pins** (`scripts/workspace-template.test.ts`): the Delegation mechanism sentence, the
  spelling rule, the silent-substitution statement, a fenced `Task(` call with
  `model: "sonnet"` in Delegation and another beside `/converse th_…` in the launch bullet
  (a revert to prose has to delete them), the prompt-names/argument-chooses split at the
  launch site, the refused-argument clause, and the tier-table Model column tied to the
  argument it fills. Pin-break drills: reverting the Delegation fence to prose and
  stripping the launch bullet's argument sentence each failed exactly the new tests.
  Suite after restore: **424/424**, eslint and prettier clean,
  `tsc --noEmit -p scripts/tsconfig.json` exit 0.
