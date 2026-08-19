# [AGENT-038] A resident works serially and inline, and nothing proves it

## Domain

agent-runtime

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: **SHARED-055** — for the weight half
- Blocks: —
- Related: AGENT-025 (the converse skill), UI-126

## Spec References

- SPEC.md **§7** — *"a resident works its conversation inline"*
- SPEC.md **§7** — the weight rider

## Summary

The user asked on 2026-08-19: *"I want designated agents to take events and
process them serially, without using more subagents. The goal is for them to keep
a full conversation in their context without jumping back and forth from subagent
to subagent. **Make sure that is how it is working today.**"*

**It is how it works today**, by the skill's own text. Verified by reading
`assets/workspace/claude/skills/converse/SKILL.md`:

| the user's requirement | where it is stated |
| --- | --- |
| inline, not delegated | `:95` — *"You work your conversation inline. The orchestrate skill hands every event it claims to a subagent and never works one itself. **You do the opposite**"* |
| serial | `:256` — *"Work each claimed event, in claim order, **one at a time**"* |
| one continuous context | `:795` — a subagent *"would [not] do better than the agent that has been in the conversation since the first"* |

The escape hatch is scoped correctly: a heavy **side** task may go to a subagent,
which *"reports, and you record"* (`:442`), and *"a subagent you launch never runs
a claim, a park, or a terminal call"*. The conversation never leaves the
resident's context — the subagent is a tool call, not a handoff.

**So this issue is not "make it work". It is "make it provable, and fix the one
sentence that contradicts it."**

## 1. Nothing enforces any of it

Every guarantee above is prose in a skill file. `scripts/workspace-template.test.ts`
pins a great deal of that file, but nothing pins the three properties the user
just asked to rely on.

This repository has been bitten four times in one week by a skill sentence that
was true when written and false later, and by claims about another component's
behaviour written from belief. The rule adopted after the fourth: **a claim worth
relying on gets a pin.**

## 2. One sentence instructs an impossibility

`:415-420` tells the resident a stated weight governs *"the work you are about to
do — **including your own**"*.

A resident is a running session on a fixed model. It cannot change what it is
without discarding the conversation, which is the thing the user just asked to
protect. So that clause is unsatisfiable, and its failure path — *"where you
cannot honour it… say so twice"* — cannot fire, because the resident has no
signal that it failed. It reports the model it is running as, the report looks
right, and the discarded choice is invisible.

SHARED-055 is the spec rider that settles this. **This issue applies whatever is
signed** and must not guess ahead of it.

## Decided by the orchestrator, 2026-08-19 (SHARED-055 signed as drafted)

- A resident's own weight comes from its **designation** (`Resident.weight`, CONTRACT-067); the skill says so, and says that a `null` there means the launcher chose and said what.
- The weight clause at `:415-420` becomes: a stated weight on a message governs what the resident **hands off**, never its own turn. The "say so twice" path is deleted for the resident's own turn, because it cannot fire — and kept for a hand-off it cannot honour, where it can.
- **A resident whose designation weight changed exits.** The resident already re-reads its designation at the top of each pass and exits on a release. The same read now also compares `weight` against what it was launched at (the launcher tells it in the prompt, AGENT-039); a difference is *the same ending, found one step later* — finish the current turn, settle what is claimed, and exit, so the orchestrator relaunches from the roster. Pin the consequence, not the mechanism.
- **The launcher's "cannot meet" report** reaches the resident in its prompt; the resident states it once, in its first reply, in the register SHARED-050 set.
- SERVER-128 makes a parked resident's idle return immediately on release; the skill's account at `:659-745` stays true and gains nothing mechanism-specific.

## Acceptance Criteria

- [x] Pins for all three properties, each falsified individually: inline by
      default, serial claim order, and a launched subagent that never claims,
      parks, or settles — **with one correction**: the drill measured that a
      claimed batch's order is not the conversation's, so the pin is on the
      conversation's order (see E2E §3)
- [x] The weight clause no longer instructs the impossible — per SHARED-055,
      a stated weight governs what the resident **hands off** and not its own turn
- [x] The skill says where a resident's own weight *does* come from, once
      CONTRACT-067 lands
- [x] **No claim about another component's internal refusals is added** — the rule
      this file adopted after being corrected four times
- [x] Every transcript touched is re-derived by running the command, not read —
      no transcript in the skill was touched at all

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/converse/SKILL.md`
- `scripts/workspace-template.test.ts`

### Key Implementation Details

**Read `converse/SKILL.md:659-745` before editing anything near the park loop.**
It carries a careful account of release, of events stamped before a release, and
of a refused park being *"the same ending, found one step later"*. SERVER-128 may
change the timing there, and these two must not part company.

Pin the **consequence**, not the mechanism. The `profile` skill's *"resolves to
nobody"* sentence survived a change of mechanism precisely because it stated a
consequence (AGENT-036), and the pin that guards it forbids naming a mechanism
beside it.

### Edge Cases

- A resident mid-work when a release lands
- A subagent still running when the resident is released
- A weight stated on a message to a lane whose resident has lapsed — the
  orchestrator answers, and the weight does apply to it

## Testing Strategy

Pins in `scripts/workspace-template.test.ts`, each falsified by deleting the
sentence it covers and confirming that pin alone goes red.

The behavioural half — that a real resident actually claims one at a time and
does not delegate the conversation — needs a **drill against a real Claude Code
session**, not a reading. AGENT-034 and AGENT-035 both found defects that way
that reading had missed.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port **not 8765** and **not 5173**
2. Designate a resident and run `/converse` against it in a real session
3. Post three messages in quick succession; confirm they are worked in claim
   order, one at a time, in one context
4. Confirm the resident's own turns name the model it is actually running as
5. Confirm a side task it delegates never claims, parks, or settles
6. Stop the server; confirm the port is free

## E2E Verification Log

**Implemented on: opus** (agent-runtime-dev, 2026-08-19).

### Files changed

- `assets/workspace/claude/skills/converse/SKILL.md`
- `scripts/workspace-template.test.ts`

### 1. The seven pins, each falsified alone

Every pin was falsified by editing the one sentence it owns, running that test
by name (`npx vitest run scripts/workspace-template.test.ts -t "<name>"`),
seeing it red, and restoring the file from a byte-for-byte backup. All seven
reported `Tests 1 failed | 411 skipped (412)`, and `diff` against the backup was
empty afterwards.

| # | Pin | Sentence edited to falsify |
| --- | --- | --- |
| A | `answers in this session, and its worked example answers there too` | `:97` — cut *"in this session, in the context you already have"* |
| B | `works one claimed event at a time, in the conversation's order` | `:257` — replaced *"one at a time, in the order the conversation has them"* with *"however it suits you"* |
| C | `hands a launched subagent no lane, so the conversation stays in one place` | `:460` — cut *"and it is given no thread id to scope one with"* |
| D | `no longer tells the session to change what it is running as` | `:419` — restored the deleted *"including your own"* clause |
| E | `keeps the stated weight binding on what the resident hands off` | `:430` — *"do the work anyway"* → *"drop it anyway"* |
| F | `says what a designation carrying no weight means, and what to say once` | `:424` — removed the bold on *"Where the designation carries no weight…"* |
| G | `ends the run when the designation's weight changed, without a goodbye` | `:733` — *"ends your run of it, and the designation stands"* → *"is nothing to act on"* |

Final state: `VITEST_MAX_THREADS=4 npx vitest run scripts/workspace-template.test.ts`
→ **PASS (412) FAIL (0)**.

The pins use a `wrapped()` helper, hoisted from the `one rule, one skill` block
to module scope so both users share one copy. A pin that hard-codes where a
sentence breaks across lines goes red on the next reflow, which is how a pin gets
deleted rather than fixed.

### 2. Live drill — throwaway workspace, real server, port 8901

`npm run build:libs`, then a fresh workspace at
`…/scratchpad/ws` (`corpus init --port 8901`, server pid 61268). The user's live
server on 8765 was never touched.

- `diff .claude/skills/converse/SKILL.md assets/workspace/…/SKILL.md` → **empty**.
  The edited skill installs verbatim.
- **CommonMark cross-check** (`mdast-util-from-markdown`): 15 top-level `##`
  headings, matching the pinned `sections.size`, 9 code blocks, **0** that fail
  to end on a fence line. No fence in the file is left open.

### 3. The ordering defect this drill found — CLAIM ORDER IS NOT MESSAGE ORDER

Three replies posted to a designated lane inside one second, then one
`corpus queue claim-all --thread th_3e6jl3sz`:

```
evt_2t2px65hfaq3 created=2026-08-19T20:50:00Z turnTs=2026-08-19T20:50:00Z   (message Y)
evt_7fxhfmvobmxx created=2026-08-19T20:50:00Z turnTs=2026-08-19T20:50:01Z   (message Z)
evt_cyj7m6y5fq7g created=2026-08-19T20:49:59Z turnTs=2026-08-19T20:49:59Z   (message X)
```

The batch is **Y, Z, X** — the first message arrives last, and the ids are in
lexicographic order. Reproduced twice. Confirmed at the source rather than
inferred: `QueueStore.listIds` is a bare `readdir` of `pending/`
(`apps/server/src/queue/store.ts:267`), and `QueueService.claimAll` iterates it
with no sort anywhere (`apps/server/src/queue/service.ts:614`). So the batch's
order is the event id's, which is random against the conversation.

The skill said *"Work each claimed event, in claim order, one at a time. They are
messages in one conversation, so they are ordered by construction…"* — the
premise is false, and a resident obeying it answers the third message before the
first. Step 3 now reads **"in the order the conversation has them"**, with where
to read that order (`corpus thread show`, and each payload's turn). The
pre-existing pin at *"runs the loop as discrete steps"* carried the same false
comment and was corrected with it.

**Escalated, not fixed here**: sorting the batch is the server's. Filed as a
finding for the orchestrator — the skill is now correct whether or not the queue
ever sorts.

Working the same batch in the corrected order produced the right transcript:

```
agent · 2026-08-19T20:52:44Z  Answering message X, in the order the conversation has it.
agent · 2026-08-19T20:52:45Z  Answering message Y, in the order the conversation has it.
agent · 2026-08-19T20:52:46Z  Answering message Z, in the order the conversation has it.
```

Each event was logged, replied to and settled before the next was started —
serial, one at a time, three `queue complete` calls, and `claim-all` afterwards
returned `{"events":[],"inProgress":{…,"total":0,…}}`. Every turn carries
`model: claude-opus-5`, read back from `thread show --json` (plan step 4).

Incidental confirmation of a claim the skill already makes: a write carrying a
`CORPUS_JOB` that names no event was refused (`422 unknown_job`) and nothing was
written.

### 4. What could NOT be drilled, and why

`packages/contract` was being edited in the same working tree by CONTRACT-067
while this ran. `ResidentSchema` now requires `weight`, and the server has not
been updated yet (SERVER-129), so on this tree **a designation is invisible to
the roster**: `corpus thread designate` writes `resident: {name, docId}` with no
`weight`, and `corpus agents` shows no row for the thread. `tsc -p
scripts/tsconfig.json` reports exactly that, in five server files and one script
test, and none in either file this issue touched:

```
apps/server/src/core/resident.ts(41,27): TS2741: Property 'weight' is missing …
apps/server/src/threads/read.ts(105,29): TS2741: …
apps/server/src/threads/resident.ts(206,27): TS2741: …
```

The lane was unblocked for the drill by writing `weight: null` into the
throwaway workspace's thread file and letting the watcher re-project it — the row
then appeared. The row prints `resident unknown` rather than `a general
resident`, which is CLI-053's half, still in flight.

So the weight half was verified against the **contract** rather than a running
launcher: `RESIDENT_WEIGHT_BOUNDARY` and the `Resident.weight` description in
`packages/contract/src/schemas/agents.ts` say the same three things this skill
now says — the weight is the designation's, `null` means the launcher chose and
said so, and a level the launcher cannot meet is reported *"in the listener's
first reply"*. A real `/converse` session against a launcher that passes a weight
needs AGENT-039 and SERVER-129, and is the right drill to run once they land.

- Server stopped, `lsof -iTCP:8901` empty, pid 61268 gone.

### 5. Transcripts

Every transcript in this log was produced by running the command, not read from
anywhere. **No transcript in the skill file was touched** — the edits add no
fenced block and change no command output.

## Completion Checklist (domain agent)

- [x] Tests written and passing — 412 pass, 0 fail, scoped run only
- [x] `/lint` passes — `eslint` and `prettier --check` clean on the changed test
      file; `tsc -p scripts/tsconfig.json` fails only on CONTRACT-067's in-flight
      server files, none of them touched here
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-038]` prefix
