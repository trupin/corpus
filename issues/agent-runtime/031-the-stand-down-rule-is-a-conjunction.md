# [AGENT-031] The stand-down rule is a conjunction, and the second conjunct throws away the signal

## Domain

agent-runtime

## Status

done

## Priority

P0

## Model

fable

## Dependencies

- Related: AGENT-029 (which wrote the rule), AGENT-027

## Summary

`assets/workspace/claude/skills/converse/SKILL.md:225-235` fires the stand-down
rule on *"an empty `events` array **and** those same ids sitting in its
`inProgress`"*.

`apps/server/src/queue/waiters.ts:126-127` notifies **every** matching waiter, so
both listeners' parks return naming the same event, and `claimAll` is atomic —
so the loser normally gets a fully empty claim and exits, as designed.

**The conjunction breaks the moment a second message arrives.**

> Any event lands on the lane between the winner's claim and the loser's. The
> two claims are separated by two independent LLM sessions each deciding to
> invoke `corpus queue claim-all` — seconds, not milliseconds — and a person who
> just posted M1 posting M2 is the ordinary case. The loser's claim returns
> `events: [M2]`, **non-empty**, so the rule does not fire. AGENT-027 then tells
> it the winner's M1 in `inProgress` is "not yours", so it works M2 and
> re-parks. **Two listeners survive, answering different messages in one
> conversation.**

That is the split-story failure `AGENT-029` was filed to close, and its
acceptance criterion — *"One conversation ends with one listener"* — is not
guaranteed.

**The sound signal is present and discarded**: an id the loser's own park named
is sitting in someone else's `inProgress`. It is the `events`-is-empty conjunct
that throws it away.

## What the rule should test

The evidence of a peer is **an id your own park named appearing in `inProgress`
you did not claim** — regardless of what else the claim returned. Restate the
rule on that alone, and check whether the `events`-empty clause has any
remaining job; if it does not, removing it is the fix rather than an addition.

`AGENT-029` verified the discriminator's soundness in the other direction and
that finding stands: the orchestrator cannot be the claimant, because the
loser's own park release keeps the lane live for the grace window and an
unscoped claim never sees a live lane's events, and orchestrate never passes
`--thread`. The only other producer is an operator hand-running a scoped
`claim-all`, which would be evicting a healthy resident deliberately.

## Acceptance Criteria

- [x] The rule fires on the peer-claim evidence alone, and a concurrent second
      message does not suppress it
- [x] The soundness direction is preserved: nothing but a peer listener can
      produce the state the rule fires on. Re-derive it against the new form
      rather than inheriting AGENT-029's argument for the old one
- [x] Drilled with **two messages**, not one — that is precisely the case
      AGENT-029's drill did not cover, and its absence is why this shipped
- [x] An abandoned event still does not trigger a stand-down (AGENT-029 measured
      that direction; keep it measured)
- [x] **Added by the drill:** the rule carries its exclusions where it is stated.
      The first run of the new text stood the **surviving** listener down too, on
      a held row its park never named, and left the conversation with none

## Testing Strategy

Template assertions for the text. The drill is two live listeners and two
messages posted close together.

## E2E Verification Log

**Model: Fable 5 (`claude-fable-5`).** Real `corpus init` workspace
`/tmp/corpus-agent031` on `:8794` (never 8765, never 5173), real server, real CLI
from `apps/cli/dist/bin/corpus.js`, and **two** real Claude Code sessions
(`--model sonnet`) per run, launched simultaneously on one designated lane and
driven by the installed skill text alone. Transcripts at
`/tmp/agent031{,b}-session{A,B}.jsonl`; every `corpus …` either session ran is
timestamped and tagged in `/tmp/agent031{,b}-calls.log` by a PATH shim.

### Reproduction — two listeners, **two** messages

Both sessions read the roster before either parked, so both legitimately took the
lane (AGENT-029's shape), and both parked:

```
08:48:08 [A] corpus agents        → th_v5arap6k … · waiting for a listener
08:48:09 [B] corpus agents        → th_v5arap6k … · waiting for a listener
08:48:15 [A] corpus queue idle --thread th_v5arap6k
08:48:16 [B] corpus queue idle --thread th_v5arap6k
17787 node …/corpus.js queue idle --thread th_v5arap6k
17816 node …/corpus.js queue idle --thread th_v5arap6k
```

M1 was posted; a watcher posted **M2 the instant the first claim appeared**, which
is the ordinary case the issue describes — a person who has just written one
message writing a second while two sessions are each deciding to run a command.
B won M1. **A's claim, verbatim from its transcript:**

```
{"events":[{"id":"evt_kirfeh2iis7w","type":"comment.created",…}],
 "inProgress":{"events":[{"id":"evt_wojjnoukbdgi","heldSince":"2026-08-17T15:48:41Z",…}],"total":1}}
```

`events` **non-empty** (M2), and the id A's own park named (M1) sitting in
`inProgress`. Both predicates run against that measured payload:

```
AGENT-029 rule (empty events AND ids held):        DOES NOT FIRE
AGENT-031 rule (a park-named id held by another):  FIRES
```

That is the defect, on real output: under the shipped rule A would have worked M2
and re-parked, and one conversation would have had two listeners answering
alternate messages. Under the new rule A stood down, posting nothing and working
nothing.

### The drill's own finding — the fix's first form emptied the lane

In that same run, **B — the winner, the listener that should have stayed — also
stood down**:

```
08:50:09 [B] corpus job log evt_wojjnoukbdgi "standing down: evt_kirfeh2iis7w on this
             lane is held by another caller — evidence of a second listener …"
```

B read *any* held row it had not claimed as a peer. The row was A's abandoned M2;
B's own park had never named it. Both listeners left and the person got **no
answer at all** — a worse outcome than the split story, reached from text I had
just written. AGENT-027 already covers that row (the orchestrator mid-dispatch
under the fallback), but the peer test as first drafted collapsed into "a held row
I did not claim", so the exclusions had to be stated where the rule is stated.

Added: a row **your own park did not name** is not evidence; a row **you claimed
yourself in this session** is yours however often it comes back; and the test
belongs to the claim that immediately follows your park and to no other call —
a mid-pass claim is looking at your own held work.

### Re-drill after the correction — one conversation, one listener

Fresh conversation `th_odj7u3cw`, same launch, same M2 timing:

```
08:53:04 [B] corpus queue claim-all → events:[evt_x5jsc4ekiagn]  inProgress:[]
08:53:05 [A] corpus queue claim-all → events:[evt_2kfyrfqpwe7t]  inProgress:[evt_x5jsc4ekiagn]
08:53:30 [A] corpus job log evt_2kfyrfqpwe7t "stood down — evt_x5jsc4ekiagn (named
             pending by my own park) came back held by another caller …"
SESSION_EXIT=0   (A: no reply posted, nothing worked, nothing settled)
```

A's own reading: *"my park returned `evt_x5jsc4ekiagn` as pending, but the
immediately following `claim-all` reported it already held by another caller …
since my lane reads live for the grace window right after a park release, that
holder can only be another listener on this same lane, not the orchestrator's
fallback."*

And the direction the correction was written for — **B, facing the shape that
fooled it last time**, an empty `events` with a held row:

```
{"events":[],"inProgress":{"events":[{"id":"evt_2kfyrfqpwe7t","heldSince":"…15:53:05Z",…}],"total":1}}
[B] "That held event isn't mine — I never claimed it. It belongs to a second listener
     that briefly raced onto this lane … It'll return to pending once the orchestrator
     reaps stale work, and I'll pick it up then. Leaving it alone and continuing the loop."
```

B stayed, answered the conversation, and parked again. The thread carries **one**
agent turn for the two questions and no duplicate.

### Soundness, re-derived against the new predicate

Not inherited from AGENT-029 — the predicate changed, so each producer was
re-checked. The interval is the same one (between this listener's park returning
and its own claim), so the argument transfers per id, and it was read out of the
code rather than assumed:

- **The orchestrator cannot be the claimant.** `queue/liveness.ts`'s
  `observePark` stamps `lastSeen = now()` on the release as well as on arrival, so
  the lane reads live for a whole grace window *after* a park returns;
  `queue/lanes.ts`'s `visibleTo` hides a live lane's events from an unscoped
  claim; and orchestrate never passes `--thread`.
- **Nothing but a claim moves an event `pending/` → `in-progress/`** — checked
  against the store's transitions; `defer` and `reap-stale` move the other way and
  `abandon` moves sideways.
- **A caller's own just-claimed ids can never appear in its `inProgress`** — the
  list is what was held *when the call arrived* (published in `docs/cli.md`), and
  measured: a claim returning `events:[evt_lov4jqy6lamp]` reported
  `inProgress: []`. Without this the new rule would fire on every claim.
- The remaining producer is an operator hand-running a scoped `claim-all`, which
  is a deliberate eviction — unchanged from AGENT-029.

### The look-alikes, measured rather than reasoned

Both on the real server, on an id a park had just named as pending:

```
halted between the park and the claim → {"events":[],"inProgress":{"events":[],"total":0}}
abandoned between the park and the claim → {"events":[],"inProgress":{"events":[],"total":0}}
```

Neither puts the id in `inProgress`, so neither fires the rule — which is why the
`events`-empty conjunct had no remaining job and was **deleted** rather than
repaired. The text now denies emptiness a meaning in either direction.

### What changed in the text

`assets/workspace/claude/skills/converse/SKILL.md`, in *The loop*: the rule
restated on the peer-claim evidence alone; the exclusions paragraph the drill
demanded; *judge it on that id, and never on the claim being empty*, carrying the
two-message case that shipped the defect; the disposal of what the losing claim
took (leave it in-progress for `reap-stale`, log one line on it, post nothing);
and the quiet look-alikes reworded. One sentence added in *Settling your own lane*
so a reader arriving from AGENT-027's side learns that one not-yours row means
more than *leave it*.

### Checks

- `scripts/workspace-template.test.ts`: **320 pass**. Five `it`s for this issue;
  `sections.size` unchanged at **15**.
- **Negative pins validated against the pre-fix rule** (`/tmp/agent031-negcheck.mjs`):
  the conjunction (``an empty `events` array **and those same``), the emptiness
  lead, and *"you were not in the middle of anything and nothing is stranded"* all
  fire on AGENT-029's paragraph and none on the new body. The structural pin — the
  firing paragraph must contain no `empt` — rejects the old paragraph and passes
  the new one.
- Real CommonMark parse (`mdast-util-from-markdown`): `depth: 2` headings 15 / 16
  / 13 across the three skills, zero code nodes ending off a fence line.
- `prettier` and `eslint` clean on both touched files.

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-031]` prefix
