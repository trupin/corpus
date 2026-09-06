# [AGENT-065] `converse` argues for stopping five ways and for continuing once

## Domain

agent-runtime

## Status

done

## Priority

P0

## Model

fable

## Dependencies

- Depends on: **CLI-078** (the next-step line this leans on)
- Blocks: —
- Related: INFRA-039 (the scenario that measures it), AGENT-064, AGENT-066 /
  AGENT-067 (the orchestrate split, same underlying cause)

## Spec References

- SPEC.md **§7** — the agent loop; a resident is present exactly while it holds a
  parked scoped `idle`
- SPEC.md **§8** — agent participation

## Summary

Reported from live use, 2026-09-05: *"subagents keep stopping although the skill
is meant to keep the agent alive."*

CLI-078 carries the mechanism — a Task subagent lives only while it keeps calling
tools, and the last line it reads before deciding is `event evt_x is complete.`
This issue is the other half: **the skill's own text argues for stopping far more
than it argues for continuing.**

`assets/workspace/claude/skills/converse/SKILL.md` documents **five** ways to
stop, each with a paragraph explaining why stopping is correct:

1. *When your context runs heavy* — **"Do not park again."**
2. *Retirement* — a `designationId` that is not yours, so exit.
3. *The loop* — an id your park named coming back held: **"One such id is the
   whole of the evidence. Exit."**
4. *Retirement* — a park refused with `422`.
5. The thread resolved, which releases the resident with it.

Against those five stands one instruction to continue: **"Then repeat from step
1."** Four words, at line 325 of a 1,600-line file.

**Measured**: the file carries 25 stop-signals against 7 continue-signals. Every
one of the five exits is correct in its own case, and every paragraph explaining
them is well argued. The aggregate is a document that has taught the reader,
carefully and at length, that stopping is usually the right answer.

**The softest of the five has no external signal at all.** *When your context runs
heavy* asks the model to assess its own remaining context and stop cleanly. There
is no measurement behind it, nothing refuses it, and it is available on every
single pass. It is the exit an agent will reach for whenever continuing feels
expensive, and its section makes stopping there sound like good citizenship.

## The skill also documents this symptom under the wrong cause

`orchestrate`'s *If the loop breaks* says that a listener which *"exits the moment
it starts and the lane keeps reading not-live with its pending count climbing,
pass after pass"* means a **corrupted `converse` file**, repaired by
`git restore`.

The operator is seeing that symptom with an intact file. So the one recovery
section in the workspace sends them to restore a file that is not broken, and
what they will find is that the restored file behaves the same way. Fix that
paragraph as part of this issue: name the other cause, and name what actually
distinguishes them.

## What to change

Four changes, and the third is the one that matters.

1. **Make the continue instruction outweigh the exits.** *Then repeat from step 1*
   is not a step of the loop, it is a sentence after it. Make continuing **step 8**
   — numbered, in the list, with the same weight the other seven carry — and say
   what it means: the pass ends by starting the next one, and a listener that stops
   parking stops existing.
2. **Cut the five exits to what they need.** Each keeps its rule. None keeps its
   essay. The rules are short: a designation id that is not yours, a `422`, an id
   your park named coming back held. Move the reasoning that earns each one into
   a reference file, per AGENT-067's split rule.
3. **Rewrite *When your context runs heavy*, and make it cost something to
   invoke.** It is the only exit with no external signal, and it must stop reading
   as an always-available option. Two directions, and the implementer decides and
   records which:
   - **Raise the bar in words**: state that a listener stops for this reason only
     when it can name what it has lost — a document it can no longer recall, an
     instruction it has to re-read — and that "this is getting long" is not that.
   - **Require a record**: the exit already asks for a last reply and a written
     handover. Make the *reason* part of that record, so stopping is an act with a
     visible cause rather than a quiet non-continuation.
   Do **not** delete the exit. A degraded listener holding a lane is genuinely
   worse than none, and that argument is sound. What is wrong is its availability,
   not its existence.
4. **Fix `orchestrate`'s *If the loop breaks* paragraph**, per the section above.

## What must not change

- **Every one of the five exits stays.** Each guards a real failure. This issue
  rebalances weight, and it must not become a licence for a listener to hold a
  lane it should have left. A skill that never stops is the opposite defect and it
  is worse: it puts two listeners on one conversation and answers people twice.
- **The `422` retirement path especially.** A park on a released lane must still
  end the listener. CLI-078 deliberately prints no next-step line there.

## Acceptance Criteria

- [x] Continuing is a numbered step of *The loop*, not a trailing sentence.
      _(Step 8, quoting CLI-078's next-step lines verbatim — the constants are
      imported from `apps/cli/src/commands/queue/next-step.ts` into the test, so
      the two can never drift into separate wordings.)_
- [x] The stop-to-continue signal ratio is at or below **2:1**, measured the same
      way as above. The issue records both counts, before and after. _(Before
      24:9 = 2.67, after 23:14 = 1.64, under the phrase-list method recorded in
      the E2E log and encoded in the counting test. The Summary's hand count was
      25:7 — the mechanical method calibrates slightly differently on the same
      text, and both counts here are the mechanical ones.)_
- [x] All five exits still exist, and each still states its rule.
- [x] *When your context runs heavy* states a bar that "this is getting long" does
      not meet. _(Both directions were taken: the named-casualty bar **and** the
      required record — job log line plus the same casualty in the last reply.)_
- [x] `orchestrate`'s *If the loop breaks* names both causes of a listener that
      will not stay up, and how an operator tells them apart.
- [x] `converse/SKILL.md` gets no larger. It should get smaller.
      _(64,952 → 64,140 bytes; the AGENT-068 pass in the same session took it to
      64,111. `references/leaving.md` is new at 6,514 bytes, read only at an
      ending.)_
- [x] `scripts/workspace-template.test.ts` passes, and any wording guard this
      change invalidates is **updated rather than deleted**. _(Every pin on moved
      text was retargeted at `references/leaving.md`; none was deleted.)_

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/converse/SKILL.md`
- `assets/workspace/claude/skills/converse/references/leaving.md` — new. The
  reasoning behind the five exits.
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the recovery paragraph.
- `scripts/workspace-template.test.ts` — the guards.

### Key Implementation Details

**Read CLI-078 before writing this.** The next-step line and step 8 must say the
same thing in the same words. Two wordings for one instruction is the drift this
repository has already paid for more than once.

**This is prose, and prose is not a mechanism.** Nothing here proves an agent will
behave differently. `workspace-template.test.ts` checks wording and can never
check truth — CLAUDE.md says so in as many words about its 404 existing guards.
INFRA-039 is the only thing that will answer whether this worked.

### Edge Cases

- A listener whose context genuinely is exhausted must still be able to stop. Test
  that the rewritten section can be satisfied.
- A resolved thread releases its resident with no event. The retirement path must
  still be reachable through the roster read.

## Testing Strategy

- `workspace-template.test.ts` guards for the new step 8 and for the reference
  file's existence.
- A counting test asserting the ratio criterion, so the balance cannot silently
  drift back. It counts signals and claims nothing about behaviour, and its own
  comment says so.

## E2E Verification Plan

### Verification Steps

1. `corpus init` a scratch workspace and confirm the changed skills install.
2. Run the reproduction from CLI-078 against the real app: designate a resident,
   post two messages several minutes apart, watch `corpus agents`.
3. Record whether one listener answered both.
4. **Then say plainly that one run is not evidence**, and point at INFRA-039.

## E2E Verification Log

Implementing agent: agent-runtime-dev, ran on **Fable** (claude-fable-5), 2026-09-05.

### The counting method (the ratio criterion's record)

Counted over `converse/SKILL.md` whole, whitespace-normalized, case-insensitive.
Stop-signals: imperative `exit` (excluding `exits`, exit codes and `exit
status`), `do not park again`, `stand/stands/standing/stood down`, `stop
cleanly`, `retire on it`, `just go`, `and go`, `go without finishing`.
Continue-signals: `park again` not preceded by `do not`, `park anyway`, `loop
again`, `keep looping`, `carry on`, `from step 1`, `you work on`, `next step in
the loop`, `keep working`. The counting test in `workspace-template.test.ts`
holds these exact patterns, states in its own docblock that it is a wording
guard that can never check behaviour, and pins the ratio at ≤ 2.

| | stop | continue | ratio |
| --- | --- | --- | --- |
| before | 24 | 9 | 2.67 |
| after | 23 | 14 | **1.64** |

### What moved where

- **Step 8 of *The loop*** quotes CLI-078's `IDLE_EVENTS_NEXT_STEP` and
  `IDLE_TIMEOUT_NEXT_STEP` verbatim (test-pinned via import from the CLI
  source), and states the mechanism: a listener is present exactly while it
  keeps parking, so one that stops parking stops existing.
- **`references/leaving.md`** (new, 6,514 B) carries the reasoning behind all
  five endings: the grace-window argument, the empty-batch failure story, the
  two-parked-listeners cost argument, the refused-park shell death, the drain
  asymmetry and the successor-eviction story, the replaced-listener reason, the
  degraded-listener argument, and the resolved-thread case. The body keeps
  every rule and points at the file by name at each site.
- ***When your context runs heavy*** now opens with the bar (a named casualty —
  a document you cannot recall, an instruction you re-read and got wrong; "this
  is getting long" named as not meeting it), makes the recorded reason step 2
  (`corpus job log` before the last settle, then the same casualty in the last
  reply), and ends "park again and keep working" where the bar is unmet.
- **`orchestrate` → *If the loop breaks*** now names both causes of the climbing
  pending count and the discriminator: a **corrupted file** kills the listener
  before it works (nothing settled, no job log, no reply — restore the file); a
  **listener that chose to leave** settled its events and recorded its reason
  (job log or last reply — restoring the file fixes nothing; read the reason).
  Compensating trims in the same section keep `orchestrate` net smaller
  (139,824 → 139,802 B).

### Post-Implementation Verification

Real workspace from this worktree (full build), `corpus init` on port **8975**
(scratch, never 8765): "installed 29 template files" — one more than
AGENT-066's 28, and the new file is `.claude/skills/converse/references/leaving.md`.

The two-message run, driven by hand following the amended skill text (no live
`claude` session — the loop's commands were executed literally, one listener):

1. Standalone thread `th_bjecrndf` created, `corpus thread designate` as user —
   roster read **before** the park showed the row `a general resident · waiting
   for a listener` (startup step 2's ordering).
2. Parked with `corpus queue idle --thread th_bjecrndf`. A plain user reply
   **did not** unpark it: on a thread whose `agent` is `none`, a turn enqueues
   nothing even under a designation — participation gating (§8) still applies.
   A second message written as `@agent …` enqueued `evt_4av4qx5gqrn2` on the
   resident lane and the park returned instantly, printing
   `"nextStep":"next step in the loop: these are pending, not claimed — \`corpus
   queue claim-all\`, work, settle, then park."` — the exact line step 8 quotes.
3. Scoped claim handed the event; worked inline (job log, `--last 2` read,
   reply); `corpus queue complete` printed the settle line step 8's sibling
   quotes: `next step in the loop: park for the next event with \`corpus queue
   idle\`, on the lane you claimed from.`
4. Retirement, live: `corpus thread release` as user, then the scoped park was
   refused — `422 unknown_recipient` at exit **5** — the roster re-read showed
   no row, the one drain claim came back empty, the `--index` header read said
   `open`, and the sign-off was posted. Every step of the retirement list ran
   as written.

**One run is not evidence.** This exercised the wording once, by hand; whether
listeners now actually stay up is INFRA-039's scenario to answer, as the issue
itself says. The observation in step 2 (a designated thread with `agent: none`
swallows plain user turns) is reported to the orchestrator as a possible
participation-semantics surprise, not fixed here.

Tests: `workspace-template.test.ts` **589 passed** at the end of this issue
(612 with `skill-budget.test.ts` at session end), ESLint and Prettier clean on
every touched file, `npm run skills:check` green after
`--update-baseline` locked the shrink in.

## Completion Checklist (domain agent)

- [x] Both signal counts recorded, before and after
- [x] All five exits verified present
- [x] `/lint` passes _(ESLint + Prettier on touched files; `tsc` is CI's)_
- [x] E2E log filled in, and it states what one run proves
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run
- [ ] `/evaluate` passes
- [ ] Committed with `[AGENT-065]` prefix
