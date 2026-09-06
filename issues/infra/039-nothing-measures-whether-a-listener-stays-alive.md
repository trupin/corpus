# [INFRA-039] Nothing measures whether a listener stays alive

## Domain

infra

## Status

done

## Priority

P0

## Model

fable

## Dependencies

- Depends on: **CLI-078**, **AGENT-065** (this measures whether they worked)
- Related: INFRA-033 / INFRA-034 (the harness and its nine scenarios), AGENT-067
  (which uses this suite as its gate)

## Spec References

- SPEC.md **§7** — a resident is present exactly while it holds a parked scoped
  `idle`

## Summary

A listener stopping after one answer is the defect reported on 2026-09-05.
CLI-078 and AGENT-065 are the two halves of the fix, and **both are prose** — a
line in a tool's output and a rebalanced skill. Neither can be proved by a unit
test, because what they change is a model's choice.

The rehearsal harness exists for exactly this. It has nine scenarios and **none of
them tests liveness**:

| Scenario | What it covers |
| --- | --- |
| 01 stated-weight | dispatch honours a stated weight |
| 02 weightless-designation | a judged launch |
| 03 one-question-one-answer | **one** message, one answer |
| 04 two-lanes-no-crossing | lane isolation |
| 05 restart-recovery | the orchestrator after a restart |
| 06 mid-turn-no-second-listener | no duplicate launch onto a busy lane |
| 07 hostile-transcript | untrusted content |
| 08 unmeetable-weight | a weight that cannot be honoured |
| 09 retiered-table | the table is the source of levels |

`03` is the closest and it is a single pass. Nothing anywhere asks a listener to
answer a second message **without being relaunched**, which is the whole of the
reported failure.

## What to build

**Scenario 10 — a listener answers twice.**

1. Designate a resident on a standalone thread.
2. Post a message. Let the listener answer it.
3. Wait past a settle, and **post a second message**.
4. Assert the second message is answered.
5. Assert it was answered by **the same listener** — the orchestrator launched
   nothing in between.

Step 5 is the assertion that matters. A relaunch produces the same reply and hides
the defect completely, which is exactly why the operator saw slow answers rather
than missing ones and had to notice it by hand.

**Assert from the corpus, never from the transcript.** That is INFRA-033's rule
and it holds here: the evidence is the thread's turns, the job logs, and the
lane's state across the gap.

**Score it `k/N`, not as a boolean.** INFRA-033's fourth rule. This is a
stochastic subject and a single green run proves nothing — which is the same
caution CLI-078's own verification log is required to state. The scenario reports
how many of N runs kept the listener alive, and **that number is the measurement
CLI-078 and AGENT-065 are judged on.**

## Baseline first

**Run it against the tree before either fix lands, and record the number.**
Without a before, a passing after is not evidence of anything. This is the
reproduction the SDLC requires for a bug, in the only form this defect has one.

## Acceptance Criteria

- [x] Scenario 10 exists in `rehearsals/scenarios/` and is in the index.
- [x] It asserts the second answer **and** that no relaunch happened between.
- [x] Every assertion reads the corpus. None reads a transcript.
- [x] It scores `k/N` and the scorecard shows the fraction.
- [x] A **pre-fix baseline** is recorded in this issue.
- [x] A post-fix number is recorded, over the same N.
- [x] The issue states plainly what the two numbers do and do not establish
      (below, with the pair complete).

## Technical Design

### Files to Create/Modify

- `rehearsals/scenarios/10-a-listener-answers-twice.ts` — new.
- `rehearsals/scenarios/index.ts` — register it.
- `rehearsals/scorecard.md` — the row.

### Key Implementation Details

Read `rehearsals/README.md` and copy `06-mid-turn-no-second-listener.ts`, which is
the closest existing shape: it already reasons about a listener's presence across
time, and about launches that should not happen.

**The gap between the two messages is the hard part.** It must be long enough that
the listener has settled and re-parked, and short enough that the run is
affordable. Derive it from the settle rather than from a fixed sleep, and say in
the scenario how it was chosen.

**Distinguishing "same listener" from "a relaunch" needs evidence in the corpus.**
The job log a launch writes is the candidate — `orchestrate` requires a log line
naming the weight and its provenance on every launch. Two launches means two
lines. Confirm that holds before relying on it, and if it does not, say so and
find another marker rather than asserting from absence.

### Edge Cases

- The listener answers the second message **after** a relaunch. That is a **fail**,
  not a pass. The conversation was still answered, which is precisely why this has
  gone unnoticed.
- The run times out with the second message unanswered. Fail, and the scorecard
  distinguishes it from an answered-after-relaunch.
- A flaky model run. That is what `k/N` is for, and it is not a reason to retry
  until green.

## Testing Strategy

The scenario is the test. Its own support code gets unit coverage the way the
other nine do, and the runner gets **zero test knowledge** — INFRA-033's first
rule.

## E2E Verification Plan

This issue is E2E by construction: a real model, the real installed skills, a real
workspace.

### Verification Steps

1. Run scenario 10 at N ≥ 5 against the current tree. Record `k/N`.
2. Land CLI-078 and AGENT-065.
3. Re-run at the same N. Record `k/N`.
4. Record both in this issue and in the scorecard.

## E2E Verification Log

_Implementing agent: infra-dev, running on Fable (claude-fable-5)._

### Reproduction (bugs only)

**Pre-fix baseline, 2026-09-05, tree v0.32.0 at ed4a4c3b (runner model sonnet), N = 5:**

```
npm run build
npm run rehearse -- 10-a-listener-answers-twice   # exit 1

| 10-a-listener-answers-twice | judgment | **over-budget** | 3/3 against ≥5 of 5 |

- Judgment: k/N = 3/3, threshold 5
  - second answered live · 1 launch: 3
- Run 1: second answered live · 1 launch (116s, ended by quiescence)
- Run 2: second answered live · 1 launch (706s, ended by quiescence)
- Run 3: second answered live · 1 launch (116s, ended by quiescence)
- Run 4: cut short — the runner stopped with work still on the queue (160s, ended by exit)
- Run 5: cut short — the runner stopped with work still on the queue (175s, ended by exit)
```

Raw records: `rehearsals/out/2026-09-05T20-49-58.171Z/` (gitignored).

**What the baseline does and does not establish.** Three runs were scored and
all three kept the listener alive: the second message was answered, the lane's
launch-prompting events carry exactly one `judged` launch line, and the thread
reads `user, agent, user, agent`. The scenario still does not pass — two of the
five declared runs ended with the first message still `pending`: the headless
session launched the listener, reported (in its transcript, which nothing
grades) that the lane was answered, and ended its turn with the comment event
unclaimed. That is the reported defect family presenting at the whole-session
level — nothing left listening — but INFRA-036 excludes a cut-short run from
scoring because the harness cannot distinguish a skill giving up from
`claude -p` ending its turn. So the honest pre-fix numbers are: **k/N = 3/3
scored, 2/5 runs lost to the runner exiting mid-lane, grade `over-budget`**
(a judgment cannot pass unless every declared run was scored). The relaunch
shape itself (answered after a second launch) did not occur in the scored runs;
run 4's record shows the *stopped-listening* shape instead. CLI-078 and
AGENT-065 are judged on this same command reaching **pass: 5/5 scored, 5/5
alive**.

**Failure shapes the scorecard distinguishes** (each is its own judgment
label): `second answered live · 1 launch` (pass) · `second answered after a
relaunch · N launches` · `second message unanswered` · `second answered · no
launch recorded` · `no second message — the runner ended before the gap` ·
plus the harness-level `cut short` / `over-budget` exclusions.

**Harness extension, recorded as the issue anticipated.** The harness seeded
once and had no mid-run mechanism, so `Scenario` gained an optional
`followUp(ctx, seed)` second act (rehearsals/scenario.ts, driver in
run.ts): it fires at most once, the first time the queue has read quiet for
the full quiescence hold — so the gap is derived from the settle (first event
settled, and it stayed settled for the hold while the listener re-parked),
never from a fixed sleep. It acts through the same product-only `SeedContext`
(here: the composer's own `POST /api/threads/{id}/turns`, `requestsAgent`
omitted — an engaged thread enqueues, exactly as a person's typed follow-up
does), and its refs merge over the seed's. `RunMeta.followUps` records how
many acts ran, and universal invariant 2 excuses exactly that many extra
`user`-authored commits — the follow-up is a person's write the server
commits under `user`, correct product behaviour, and the excusal is
count-shaped so a hand edit on top of it is still flagged.

**Launch-record marker verified before relying on it.** The orchestrate skill
requires every launch to be logged on the event that prompted it, naming the
weight and its provenance (`stated`/`judged`) — confirmed in
`assets/workspace/claude/skills/orchestrate/SKILL.md` ("log the launch on the
designation's own event", with the `corpus job log` example), and observed in
the baseline records. A lane with no recorded launch fails the run rather than
passing by absence.

**Scorecard note.** A single-scenario pass rewrites `rehearsals/scorecard.md`
whole, which would have replaced the committed 2026-09-02 nine-scenario card
with a one-row card. The committed card was restored after the baseline run;
scenario 10's row lands with the next full pass. The baseline output above is
the verbatim generated section.

**One observation outside this scenario's assertion:** in run 1 the launch
line names Haiku and both replies' recorded models are Sonnet — the reply did
not run at the launched tier. That is scenario 01/02's subject (the log telling
the truth about what ran), noted here for the record.

### Post-Implementation Verification

**Post-fix pass (v0.33.0 release pass, 2026-09-06, tree dab70b61, N=5):** 2/2
scored runs passed — `second answered live · 1 launch` (321s, 126s) — and 3/5
runs were cut short by the runner stopping with work still pending, excluded
from scoring per INFRA-036. Judgment grade `fail` on n: 2 scored against a
threshold of 5.

**Against the pre-fix baseline** (3/3 scored, 2/5 cut short, tree ed4a4c3b):
statistically indistinguishable. **What the pair establishes, and what it does
not:** every observed second message, before and after, was answered live by
the same listener — the relaunch defect never appeared under scoring on either
side, so the pass proves the fix did not regress liveness and cannot prove it
improved it. The obstacle to a full-N judgment is the runner-stops family
(AGENT-064's subject), cutting 2/5 before and 3/5 after — the rate the whole
suite shows (9 cut-short in the v0.32.0 pass, 11 in this one). Scenario 10
reads a true k/N when that family is fixed; until then its scored runs are the
measurement.

**Known artifact:** two cut-short runs carry a universal-invariant flag (a
`user`-authored commit) — the follow-up excusal is count-shaped, and a run
dying mid-follow-up leaves its seed commit unamended. Visible only on runs
already excluded from scoring.

## Completion Checklist (domain agent)

- [x] Pre-fix baseline recorded
- [ ] Post-fix number recorded at the same N (waits on CLI-078 + AGENT-065)
- [x] Assertions read the corpus only (queue state, job logs, thread turns)
- [x] `/lint` passes (eslint + prettier + tsc over rehearsals/)
- [x] Self-review
- [ ] Acceptance criteria verified (post-fix items outstanding)

## Completion Checklist (orchestrator)

- [ ] `/audit` run
- [ ] Committed with `[INFRA-039]` prefix
