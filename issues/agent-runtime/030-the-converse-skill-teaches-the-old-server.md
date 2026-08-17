# [AGENT-030] The converse skill teaches the old server, and dies at the shell on a refused park

## Domain

agent-runtime

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Related: SERVER-118 (which changed the behaviour), AGENT-025

## Summary

`assets/workspace/claude/skills/converse/SKILL.md:583-587` says:

> "A scoped park on a lane nobody has designated is **accepted and parks; it does
> not error**, because a lane may be designated a moment later and the server
> does not second-guess the caller. So a listener that skips the check waits
> forever on a conversation that no longer has it, invisible to everyone…"

`SERVER-118` refuses that park with a 422. **Every clause is now false,
including the stated failure mode** — and SERVER-118's own docblock says "the
re-park is refused", so the change was made knowing this paragraph described
re-parking.

**The consequence is worse than stale prose: the resident dies at the shell.**

> A release lands between a pass's `corpus agents` read (top of the loop) and
> its park (step 6) — the window the skill itself calls "one rearm late".
> `corpus queue idle --thread th_X` returns 422; `apps/cli/src/commands/queue/
> poll.ts:169` throws it straight through as exit 5. The skill has no
> instruction for a park that errors, so the resident exits **without running
> Retirement** — it never settles the event it holds and never posts the
> sign-off turn the skill requires.

So a release timed one rearm badly strands a claimed event and leaves the
conversation with no goodbye.

## Acceptance Criteria

- [x] The stale paragraph states what the server now does, for both verbs — the
      park is refused, the claim is not, and why they differ
- [x] **A refused park is a normal ending, not a crash.** The skill instructs
      the listener to run Retirement: settle what it holds, post the sign-off,
      exit cleanly. A 422 on the park means the lane is no longer yours, which
      is precisely the condition Retirement exists for
- [x] Distinguish a refused park from any other failure. A 422 is "this is not
      your lane any more"; a network error is not, and must not silently retire
      a listener that still owns its conversation
- [x] Drilled: release a resident between its roster read and its park, and show
      it settling and signing off rather than dying. That is the reproduction
- [x] **Folded in (coordinator, from CLI-048):** `SKILL.md:31`'s *"a wrong lane
      is honoured in silence"* is the same sweep. Restated as the argument it
      always was — the guard cannot fire on a variable's mistake, because the
      lane such a value names is entirely real, just not yours

## Testing Strategy

Template assertions for the text. The drill is the acceptance test.

## E2E Verification Log

**Model: Fable 5 (`claude-fable-5`).** Three real `corpus init` workspaces —
`/tmp/corpus-agent030` (`:8791`), `/tmp/corpus-agent030b` (`:8792`),
`/tmp/corpus-agent030c` (`:8793`); never 8765, never 5173. Real server, real CLI
from `apps/cli/dist/bin/corpus.js`, real designations and releases, and three
real Claude Code sessions (`--model sonnet`) driven by the installed skill text
alone. Transcripts kept at `/tmp/agent030{b,c,e}-session*.jsonl`, call logs at
`/tmp/agent030{b,c}-calls.log` (every `corpus …` the sessions ran, timestamped
by a PATH shim).

### Reproduction, at the CLI, before any text changed

A designated lane, released a moment earlier — the whole of the paragraph's
subject:

```
$ corpus queue idle --thread th_nd4kdqxa
corpus: 422 unknown_recipient: `th_nd4kdqxa` names no lane to consume: either this
workspace holds no such thread, or that thread holds no resident and is therefore not
a lane at all (SPEC.md §7). Nothing was parked and no work was claimed — …
EXIT=5
```

*"accepted and parks; it does not error"* is false in every clause. The other
verb, on the same lane at the same instant, and the network failure the skill
must not confuse with it:

```
$ corpus queue claim-all --thread th_nd4kdqxa
{"events":[{"id":"evt_lov4jqy6lamp","type":"comment.created",…}],"inProgress":{…,"total":0}}
EXIT=0
$ corpus server stop && corpus queue idle --thread th_nd4kdqxa
corpus: server not running for this workspace — run `corpus server start`
EXIT=4      # `server_unreachable` under --json
```

So exit 5 alone cannot be the signal: the code is (`unknown_recipient`, and
`error.code` under `--json`), which is what the text now says.

### Control drill — the pre-fix text, same timing (workspace 030c)

The workspace's own `SKILL.md` restored to its pre-fix wording, one real session,
and a watcher that fires **the moment the resident makes its loop-step-5 roster
read** — the window the skill itself calls "one rearm late". It also posts M2
first, so a message stamped for the lane is pending when the release lands:

```
08:41:40 [session] corpus agents                                   # row still there
08:41:40 [watcher] corpus thread reply th_rl7osifa --from user …   # M2, stamped for the lane
08:41:41 [watcher] corpus thread release th_rl7osifa
08:41:42 [session] corpus queue idle --thread th_rl7osifa          # 422, exit 5
```

**Honest finding: the session did not die at the shell.** It improvised a
recovery (roster read → `thread show` → sign-off, exit 0). So "dies at the shell"
is a hazard the missing instruction leaves open, not a determinism — one sample
recovered, and the issue's stated consequence is stronger than what a single run
proves.

**What did fail, deterministically, is the message.** With no instruction to
drain, M2 was left where it lay, and the session told the person the general
agent would pick it up. Measured immediately afterwards, that is false for a
whole grace window:

```
$ corpus queue claim-all --json         # the orchestrator's own view, right then
{"events":[{"id":"evt_p3io2irgqdwj","type":"resident.designated",…}],…}   # no M2
$ corpus queue status --json
{"agent":{"live":true,"since":"2026-08-17T15:40:55Z"},…}
$ cat .corpus/queue/pending/evt_ymyya2agjqhp.json | …
evt_ymyya2agjqhp comment.created th_rl7osifa pending
```

The person's second question sat stamped for a lane nobody could consume — the
listener refused at the park, the orchestrator blind to a live lane's events.
That is exactly what SERVER-118 left `claim-all` unguarded for.

### The drill — the fixed text, identical timing (workspace 030b)

```
08:43:35 [session] corpus agents
08:43:36 [watcher] corpus thread reply th_kghprel4 --from user …   # M2
08:43:36 [watcher] corpus thread release th_kghprel4
08:43:37 [session] corpus queue idle --thread th_kghprel4          # 422, exit 5
08:43:40 [session] corpus queue claim-all --thread th_kghprel4     # the drain → M2
08:43:46 [session] corpus job log evt_fo7krc5myezi "…during retirement drain…"
08:43:53 [session] corpus thread reply th_kghprel4 --from agent    # answers M2
08:44:00 [session] corpus thread reply th_kghprel4 --from agent    # sign-off
SESSION_EXIT=0
```

Its own words at the refusal: *"The park was refused — the designation ended.
Following the retirement procedure: one last drain claim, then check the
thread."* An earlier run of the same shape (`th_k24e5pwt`) retired identically
with an empty drain. Nothing left in `in-progress/`, both questions answered, the
sign-off posted.

### What the drill falsified in my own text

**"One, not a loop" did not land.** The session ran the drain claim, worked what
it got, settled it — and then claimed **again** to check ("One last drain claim,
then check the thread"). Harmless here (empty, exit 0, no park) but it is a loop,
and an unbounded reading of it is not something to ship. Reworded to carry the
reason rather than the count: *"One claim is provably enough, so do not claim
again to check: the verb takes the whole pending batch in a single call, and
nothing written after the release is stamped for this lane, so a second claim can
only ever come back empty."*

**Re-drilled after the rewording** (`th_lq3nit6v`, same watcher, same window):

```
08:56:09 corpus queue idle --thread th_lq3nit6v        # 422
08:56:12 corpus queue claim-all --thread th_lq3nit6v   # exactly one, → M2
08:56:14 corpus job log evt_2x3wvnkp5hm5 "… final drain after release"
08:56:26 corpus thread reply … --from agent            # answers M2
08:56:32 corpus thread reply … --from agent            # sign-off
```

One claim, no park, `inProgress: 0` at the end.

### What changed in the text

`assets/workspace/claude/skills/converse/SKILL.md`, four sites:

1. **Retirement** — the falsified paragraph replaced by four: the refusal and its
   real output; *retire on it, do not die on it*; *it is that refusal and no other
   failure* (the code, exit 4 vs. another exit-5 code); and the unguarded claim
   with SERVER-118's reason. Step 1 now drains.
2. **Starting up, step 6** — the same refusal before anything is held: step 2's
   missing row, one step later.
3. **The loop** — `idle` no longer promised as exit 0 unconditionally.
4. **Worked example** — the closing "parking on it would be waiting forever"
   corrected, and the retirement drain shown with its real (empty) output.

Plus the coordinator's fold-in at line 31 (the lane-variable argument), restated
in the skill's own voice and matching CLI-048's account in
`apps/cli/src/commands/queue/lane.ts` without copying its sentence.

### Checks

- `scripts/workspace-template.test.ts`: **320 pass** (316 before). Six new `it`s
  for this issue; `sections.size` unchanged at **15**.
- **Every negative pin validated against the pre-fix text** (`/tmp/agent030-negcheck.mjs`):
  `accepted and parks`, `it does not error`, `wait(s|ing) forever` (both
  spellings — the rule said one, the worked example the other), the flat
  wrong-lane claim, and the unconditional `exits 0`. All six fire on the old
  sentences and none on the new body. A negative pin that cannot fail is not a
  pin.
- Cross-checked with a real CommonMark parser (`mdast-util-from-markdown`):
  top-level `depth: 2` headings = 15 / 16 / 13 for converse / orchestrate /
  comment, and **zero** code nodes ending off a fence line.
- `prettier --check` clean on the skill; `prettier --write` + `eslint` clean on
  the test file.
- The quoted refusal in the skill is a true **prefix** of the real output,
  elided with `…` — the full message contains `SPEC.md`, which this file's own
  template test forbids, and `GET /api/agents`, which no skill should show an
  agent.

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-030]` prefix
