# [AGENT-061] A turn states the model the agent believes it is, so §10's record can be wrong

## Domain

agent-runtime

## Status

done

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Related: `INFRA-034` story 4, which found it; SPEC.md §10's model-record rider
  (signed 2026-08-07), CLI-`thread reply --model`

## Spec References

- SPEC.md **§7** — *"A thread document's frontmatter records, per turn timestamp,
  the model that wrote that turn (§10) … **The server is the only writer of the
  record**"* (rider signed 2026-08-08)
- SPEC.md **§10** — *"An agent turn says which model wrote it … a turn written
  before this was recorded shows **nothing** rather than a guess: an unknown that
  says so is worth more than a plausible attribution nobody can check."* (rider
  signed 2026-08-07)

## Summary

Found by the rehearsal suite, 2026-09-02, story 4 run 2 of the v0.31.0 pass.
The story's invariant is *exactly one agent reply per lane*. It found two, and
the second was a correction. The agent's own job log:

> posted the answer, then corrected the model stamp: the first turn said
> `claude-opus-4-5`, the run was `claude-opus-5[1m]`

**The server is the only writer of the record, but it writes what it is told.**
`corpus thread reply --model` takes the value from the caller, and the caller is
the agent stating what it believes it is. Nothing checks that belief, so §10's
guarantee — *"which model wrote this?" is answerable from the conversation
itself* — holds only as far as an agent's self-knowledge, which this run shows is
not far enough.

**§10 already decided what to do about an unknown**, and it is not this: *"shows
nothing rather than a guess: an unknown that says so is worth more than a
plausible attribution nobody can check."* A wrong stamp is precisely the
plausible attribution nobody can check. `claude-opus-4-5` is a real model name,
so nothing about the record looks broken — a reader asking which model wrote a
turn would get a confident, wrong answer.

## Why it matters

- **It is the one durable answer.** §7 says the job log is reaped with its event
  and *"what else survives the reaping is narrower and lives on the turn itself:
  the model that wrote it"*. So this stamp is not a convenience — it is what
  remains after the console is gone.
- **It costs a second turn when the agent notices.** That is how the suite caught
  it: the correction turn breached *one question, one answer*. The agent noticing
  is luck, exactly as in `AGENT-060` — the silent version leaves a wrong
  attribution nobody ever questions.
- **It undercuts this release.** v0.31.0 is named for being able to see what a
  resident ran at. The launch log's provenance is now trustworthy (`AGENT-059`);
  the turn's own stamp is not.

## What is **not** wrong, so nobody re-chases it

- The launch provenance from `AGENT-059` is correct in this very run:
  `launched a converse listener on th_iuacwomt — a general resident (Opus 5 —
  defaulted: no weight chosen, strongest declared tier)`.
- The server's write path is doing what §7 says: it is the only writer, and it
  removes the entry when the turn is deleted. The defect is in what it is handed.
- Lane separation held. Story 4's actual subject — *nobody crosses* — was fine:
  each reply landed in its own thread.

## Acceptance Criteria

- [ ] An agent turn's recorded model is not a value the agent composes from
      belief. Either it is derived from something authoritative at the point of
      the write, or the agent is told plainly that stating a model it has not
      read is worse than stating none
- [ ] Where the model genuinely cannot be established, **nothing** is recorded —
      §10's own answer, and it must be reachable rather than theoretical
- [ ] A wrong stamp is never corrected by posting a second turn. §6 already has
      revision for "the latest turn was wrong"; a correction turn breaks *one
      question, one answer* to fix a frontmatter field
- [ ] The rule is guarded in `scripts/workspace-template.test.ts`
- [ ] `INFRA-034` story 4 passes 3/3 afterwards, which is what will prove it

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/` — wherever a turn's `--model` is taught
- Possibly `apps/cli/src/commands/thread/reply.ts` — if the honest fix is that
  the CLI should not accept a model the caller merely asserts
- `scripts/workspace-template.test.ts` — the guard

### The open question this issue does not settle

Whether the fix belongs in the prose or in the CLI. Telling the agent to be
careful is the cheap fix and is the same shape as the instruction that failed
here. Deriving the value authoritatively is the real fix and may not be
available to the CLI at all — it is the subprocess, not the model. A third
option is that the CLI refuses a `--model` the workspace's own tier table does
not declare, which would have caught this exact case, since `claude-opus-4-5` is
in no row. That is cheap, checkable, and does not require self-knowledge.

## Testing Strategy

The subject is an agent's behaviour, so the test is `INFRA-034` story 4 at 3/3
plus whatever unit coverage the chosen mechanism admits. If the CLI gains a
refusal, it gets ordinary CLI tests and a falsification.

## E2E Verification Log

_Filled by the implementing agent; state the model._

**Pre-fix reproduction, 2026-09-02 (rehearsal pass for v0.31.0, runner sonnet,
dispatching Opus 5):** story 4 run 2, thread `th_iuacwomt`, two agent turns where
the invariant allows one. Job log line quoted in the Summary above. Raw run
record: `rehearsals/out/2026-09-02T04-29-55.690Z/04-two-lanes-no-crossing.run-2.json`.

**Implementation, 2026-09-02 — agent-runtime-dev running on Fable 5
(`claude-fable-5`), per the issue's Model recommendation.**

**Mechanism chosen: the third option.** The CLI refuses a `--model` the
workspace's tier table does not declare, and the taught stamp becomes the
table's **Model** cell — the word the dispatch already hands the subagent
("You are running as Sonnet"), so stating one is quotation rather than
composition. Prose-only lost because it is the instruction that already failed
(`orchestrate` already said "name what actually ran" and the agent composed
`claude-opus-4-5` anyway). Authoritative derivation lost because the CLI is a
subprocess: no environment contract names the driving model, and the "deciding
stage" of a staged run is a judgment only the caller can make — `MODEL_FLAG`'s
own docblock had already established "a process cannot know which model is
driving it".

**Post-fix E2E, 2026-09-02, real workspace + real server** (`corpus init` into
a scratch dir, server on `:8891` — never 8765; transcript retained at the
scratch dir's `agent061-e2e.log`):

1. `thread reply --from agent --model claude-opus-4-5` (the incident's literal)
   → exit `2`, refusal names the value and lists `Haiku, Sonnet, Opus 5`,
   thread still has 1 turn — nothing posted, nothing to correct later.
2. `thread reply --from agent --model "Opus 5"` → exit `0`; the thread file's
   frontmatter shows `turnModels: {2026-09-02T15:08:43Z: Opus 5}`, written by
   the server.
3. `thread reply --from agent` with no flag → exit `0`, no `turnModels` entry
   for that turn — §10's nothing, observed on disk.
4. `thread create --from agent --model claude-opus-4-5` → same exit-`2`
   refusal on the second turn-writing verb.
5. **Reachable-nothing:** archived the orchestrate skill (`corpus doc archive
   doc_skillorchestrate --from agent`) → every `--model` refused with
   "this workspace declares no model names … drop --model"; unarchived, the
   declared word landed again via the heredoc form the skills teach.

**Falsification (both halves, red then restored green):**

- Disabled the `requireDeclaredModel` call in `reply.ts` → 2 tests red in
  `apps/cli/src/commands/thread/reply.test.ts` ("refuses a model the tier
  table does not declare, and posts nothing" and the vouched-send test).
- Reintroduced `--model claude-sonnet-4-5` into `profile/SKILL.md` → 2 tests
  red in `scripts/workspace-template.test.ts` ("states only declared model
  names" and "never again shows a version-string stamp").

**Suites:** `apps/cli` 111 files / 2236 tests green (`VITEST_MAX_THREADS=4`),
`scripts/workspace-template.test.ts` 538 green, `packages/kit` weight tests 64
green, `npm run typecheck -w apps/cli` exit 0, `npm run lint` exit 0,
`docs/cli.md` regenerated (`npm run docs:cli -w apps/cli`). Comment skill body
at 6,997 words — under AGENT-047's 7,000 cap by displacement, per that test's
own doctrine.

**Left to the next rehearsal pass:** the criterion "INFRA-034 story 4 passes
3/3" drives real Claude sessions and is the release rehearsal's to run; the
mechanism it would exercise is verified above at the CLI and template level.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified (story-4 3/3 rerun left to the release
      rehearsal, as logged above)

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
