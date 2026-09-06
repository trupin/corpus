# [AGENT-064] An event is settled without the reply it was claimed to write

## Domain

agent-runtime

## Status

done — 2026-09-06, committed on phase-58 (settle binds to the reply receipt)

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Related: `INFRA-036` (whose noise this was hiding inside), `AGENT-054`

## Spec References

- SPEC.md **§7** — *"Outcomes are never assumed. An event is marked
  `complete`/`fail` only from its subagent's reported outcome"*
- SPEC.md **§7** — *"No path loses a job silently."*

## Summary

Found in the v0.32.0 pre-release pass, 2026-09-02 — story 1, run 3:

- ended by **quiescence**, not by the runner exiting: `pending === 0 &&
  inProgress === 0`, so the queue genuinely drained
- the seeded question's event was **settled**
- and the thread carried **no agent reply at all**

So a `comment.created` asking a question was taken to a settled state without
the question being answered. §7 says an event is settled *"only from its
subagent's reported outcome"* and that *"no path loses a job silently"* — here a
job was settled and the person's question was silently dropped.

## Why this was nearly missed, and why it is filed separately

The same pass produced fourteen breach lines, and almost all of them were
`INFRA-036`'s: runs the harness cut short and scored anyway, which read as
*"ended pending, found 0 replies"*. **This one reads almost identically and is
not the same thing** — its queue drained. It was found only by checking each
failing run's `endedBy` against its queue state.

That is the argument for fixing `INFRA-036`: a suite whose reds are mostly noise
hides the reds that are not.

## What is not yet known

- **How often.** One run in three of story 1's isolation probe was cut short and
  a different run settled without replying; the pass's other stories were too
  noisy to read. The rate is unknown until `INFRA-036` lands and a clean pass is
  read.
- **Whether the tier matters.** Story 1 now seeds a **non-strongest** weight
  (changed on review in v0.32.0), so this run's listener was at the lighter end.
  A lighter listener dropping the reply while still settling the event is a
  plausible shape and is exactly what nobody has measured.
- **Where it settled.** Whether the event was `processed`, `failed` or
  `abandoned` decides whether this is a wrong report or a lost one, and the raw
  record has it.

## Acceptance Criteria

- [x] The failure is reproduced against a real workspace, with the settled
      event's status named, before anything is changed — bugs are reproduced
      first (SDLC step 1)
- [x] Either the agent cannot settle an answering event without having posted,
      or it fails the event with a reason a person can read. Silence is the one
      outcome §7 rules out
- [ ] `INFRA-034` story 1 and story 3 both pass a full pass afterwards, on runs
      that were actually scored *(the orchestrator's release-gate pass — the
      implementing agent's budget excluded a full rehearsal run)*

## Technical Design

### Files to Create/Modify

Unknown until reproduced. Likely `assets/workspace/claude/skills/converse/` or
`comment/`, wherever the settle verb is reached.

### Notes

- **Do not fix this from the scorecard.** The record names the run
  (`rehearsals/out/2026-09-02T16-29-29.929Z/01-stated-weight.run-3.json`) and it
  carries the job log, the queue state and the thread bytes. Read those first.

## Testing Strategy

`INFRA-034` story 1 is the regression test and already exists. What it needs is
`INFRA-036` landed, so that a red row means the product did something rather
than that the harness stopped watching.

## E2E Verification Log

_Filled by the implementing agent; state the model._

**Pre-fix observation, 2026-09-02 (orchestrator, Opus 5):** story 1 run 3 of the
v0.32.0 pass — 65s, ended by quiescence, event settled, `expected exactly one
agent reply on th_novjybop, found 0`.

**2026-09-06 — agent-runtime-dev, Fable 5.**

**TEST-1158 — the raw record, read before anything changed**
(`rehearsals/out/2026-09-02T16-29-29.929Z/01-stated-weight.run-3.json`):

- **Where it settled: `processed/` — but by a hand `mv`, never by the CLI.** The
  `comment.created` (`evt_epuegcyypmub`, lane `th_novjybop`) sits in
  `.corpus/queue/processed/`, yet its own JSON body still reads
  `"status": "pending"` with `updated` == `created` (16:30:02Z), and it has **no
  job log at all**. The two events that settled legitimately in the same run
  (`evt_opk2cx3mewlb`, `evt_r6uqfi7suuge`) both have bodies rewritten to
  `"processed"` with `updated` bumped to 16:30:20Z and job-log lines. So the
  verbs rewrite the body; a moved file with an untouched body was moved by hand.
  This is a **lost job wearing a wrong report**: never claimed, never completed,
  no reported outcome — the folder alone says "done".
- **The "reply" exists as bytes that are not a turn.** The thread file carries a
  full answer under a hand-written `## resident · 2026-09-02T16:30:15Z` heading.
  `§6`'s author set is closed (`ACTORS = ["user","agent"]`,
  `packages/contract/src/actor.ts:13`), so `turnHeadings` does not recognise
  `resident`: the observer parsed **one** turn (`user`), the frontmatter
  `updated` never moved past creation, and both post-seed commits are authored
  `user <user@corpus.local>` ("editing session: 1 document by user") — the
  watcher filing the hand-edit under the person's name. This confirms
  INFRA-037's lead exactly: a listener hand-edited the thread file and
  hand-moved the queue file. (The hand-written ts, 16:30:15Z, even predates the
  listener-launch log line at 16:30:20Z — but a hand-written ts is
  author-invented, so which party did it is not provable from this record;
  `runner.stdout` is empty.)

**TEST-1159 — reproduced live, 2026-09-06.** Fresh workspace
(`corpus init`, worktree CLI build, server pid 45766 on :8767, stopped after):
`corpus thread create --from user --requests-agent true` seeded the record's
question on `th_km7tv374` (`evt_i77jthop2lpg` pending). Replaying the breach —
appending `## resident · 2026-09-06T16:02:40Z` + an answer to
`data/threads/th_km7tv374.md` and `mv`-ing the event file to `processed/` —
reproduced every observable of the record: `corpus thread show` renders **one**
turn with the hand-written heading as literal `##` text inside the user's turn,
the event body still says `pending`/`updated == created` inside `processed/`,
`pending/` drained, and the watcher committed the edit as
`user <user@corpus.local>` ("doc edit: Raised bed preparation (th_km7tv374) by
user").

**The fix (skills; TEST-1160/1161):**

- `converse/SKILL.md` § *Settling your own lane*: **"Complete a message's event
  only holding its reply's receipt."** — `corpus thread reply` prints
  `replied to <thread> — turn <ts>`; that line is what makes a reply exist, its
  ts goes in the settled job-log line, and with none in hand the event is
  posted-to or failed with a readable reason — plus "A settle is one of the
  three verbs above and a reply is that receipt; neither has a path through the
  workspace's files", which names both hand-moves the run made.
- `orchestrate/SKILL.md` § *Completing and failing*: **"And complete these two
  only against the turn the report names"** — scoped by "these two" to the
  `comment.created`/`form.respond` paragraph above it (the TEST-1161 boundary:
  a reflection completes with no turn, held by the existing *"A trivial edit is
  completed in silence"* pin).
- `comment/SKILL.md` § *Reply*: the hand-edit bullet now states the real
  consequence — a hand-written heading is **not a turn at all** (closed author
  set), lands inside the person's own turn, under their name, invisible, no
  event fired — replacing "a corrupted conversation", which understated it.

Paid for under the INFRA-038 ratchet by in-place trims (converse 16025 → 15998,
orchestrate 12519 → 12504, comment 10277 → 10260 tokens; baseline lowered via
`--update-baseline`).

**Verification:** `scripts/workspace-template.test.ts` — 657/657 pass, three
new AGENT-064 tests among them (receipt gate, report-turn rule + boundary
scope, hand-written-heading consequence + negative pin on the old
understatement). `scripts/skill-budget.test.ts` 23/23. `npm run skills:check` ✓.
eslint + prettier clean on every touched file. A fresh `corpus init` from the
built CLI installs the edited skills (both new rule sentences grep in the
installed workspace). No full rehearsal pass run (excluded by the task's
machine budget); INFRA-034 stories 1 and 3 remain the orchestrator's
release-gate regression check.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier on touched files; scoped runs only)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified (third criterion is the orchestrator's
      release-gate rehearsal pass)

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
