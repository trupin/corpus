# [AGENT-029] A resident working longer than the grace window reads as absent, and gets a second listener

## Domain

agent-runtime (may require server or contract work — see below)

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Related: AGENT-025, AGENT-026, AGENT-027, SERVER-112, SHARED-047

## Spec References

- SPEC.md **§7** — *"A resident is **live** exactly while it holds a parked
  scoped `idle`"*
- SPEC.md **§7** — the lapse fallback and its grace window

## Summary

PR #48's review found the seam defect that AGENT-026 and AGENT-027 each closed
half of a different hole around. **This one arrives through neither.**

Presence is *only* `observePark`, whose single production call site is the idle
path. The converse loop holds no park while working: claim → work → settle →
check the roster → park. And converse is explicitly told to do long unparked
work — *"You await what you launch; you do not park on it."*

So a turn that takes longer than the 960 s grace window is **designed
behaviour**, and while it runs the lane reads `live: false`.

The reviewer's sequence:

> L1 claims an event at T and works it for 20 minutes. At T+16min the lane reads
> `live: false`. The orchestrator's pass reads the roster; its rule is
> unqualified — *"For every roster row that is not the orchestrator's and does
> not read `live`, launch a listener"* — and its two guards do not fire: no work
> was taken from that lane this pass (nothing new was pending), and this is not a
> relaunch. L2 starts. L2's own startup guard (*"Your row reads `live` → exit"*)
> also sees `live: false`, so it parks. L1 finishes and parks. **Two listeners on
> one conversation.**

That is the split-story failure both skills spend paragraphs preventing, with no
error anywhere — the third instance this phase of *two agents, one conversation,
everything behaving as written*.

## Why it cannot be fixed in the skill text alone

The roster **does** carry the distinguishing signal: a lapsed-but-working lane
has `summary: "working <title>"` from `workSummary`'s in-progress read, while a
dead one reads `idle — last active …`. But AGENT-027's own E2E log establishes
that `summary` **must not be parsed** — the contract promises only its length.

So there is currently **no sanctioned way** for the orchestrator to tell a busy
listener from a dead one, and it launches into both.

## Directions to weigh — this is a design decision, not a text fix

1. **A working resident stays present.** Make presence survive work — the
   listener re-parks between steps, or the server treats a lane holding an
   in-progress event it claimed as live. Note this collides with §7's flat
   sentence that presence is the parked request *and nothing else*, so it may
   need a signed rider.
2. **Publish the distinction the roster already computes** — a structured field
   saying this lane holds work, rather than prose the contract forbids parsing.
   Contract + server work, and probably the cleanest.
3. **Make the launch idempotent at the lane** rather than at the orchestrator's
   knowledge — if a second listener cannot cause harm, the race stops mattering.
   Consider whether AGENT-027's "not yours" rule already gets most of the way,
   and say why it does not get all the way.

Whichever is chosen, say why the other two were not.

## Acceptance Criteria

- [x] The reviewer's sequence is reproduced first, with a real long-running turn
      or a shortened window — the reproduction is the evidence this is real
- [x] One conversation ends with one listener, shown by a drill with two live
      processes
- [x] Any contract or server change is filed as its own issue in its own domain
      rather than done here — **CONTRACT-057**
- [x] If the fix needs a SPEC rider, it is drafted for the user and **not
      applied** — this phase already edited SPEC.md once without sign-off
      (PR #48 finding 6) and that must not repeat. **The chosen direction needs
      none**, and the reason is recorded below rather than assumed

## The direction chosen, and the two rejected

**Chosen: 3 — make the launch harmless at the lane.** The ambiguity is
irreducible at the orchestrator: a row that does not read `live` means *nobody is
parked at this instant*, which a crashed listener, a restarted server and a
listener mid-turn all produce identically, and the only field that separates them
is `summary`, whose content the contract explicitly refuses to promise. But the
ambiguity **is** reducible at the lane, because the queue already arbitrates —
the server hands a pending event to exactly one claimant. The loser of that
arbitration learns something no read can tell it, and it learns it at the first
moment the duplication could hurt anybody: two parked listeners cost zero tokens
and split no story until a message arrives, and that message is what fires the
rule. So the repair costs no new field, no new verb, no poll and no spec change.

**Rejected: 1 — presence survives work.** In its *re-park between steps* form it
is the keep-alive both skills already forbid, and it is mechanically unavailable
at the exact moment it is needed: converse tells a resident to **await** what it
launches, so during the long unparked await that causes the defect there is no
control flow in which a ping could run. In its *server treats a lane holding a
claimed in-progress event as live* form it inverts §7's accepted direction of
failure — a listener that died mid-event would keep its lane reading live, which
suppresses the fallback, so the next message is answered by nobody until
`reap-stale` requeues. Presence would then have two clocks and the grace window
would stop meaning anything. §7 is explicit that a lapse costs slower work and
never silently-undone work; this buys exactly the thing it forbids. No rider was
drafted, because this is not being proposed.

**Rejected here, filed elsewhere: 2 — publish the distinction as a field.** It is
the right long-term shape and the contract's own text argues for it (*"everything
a client needs to decide from is a field of its own on this row"*), but it is
contract + server work outside `assets/workspace/`, so it is **CONTRACT-057**
rather than a change made here. It would also not replace this fix: the field
says *this lane holds work*, which is evidence and not proof — a listener that
died mid-event leaves precisely that state — so a launch informed by it stays
speculative and still wants a lane that can absorb a duplicate. Direction 3 is
the floor; direction 2 makes the floor rarely needed.

**Why AGENT-027 does not already cover it.** Its rule keeps L2 from *adopting*
the event L1 is holding, and that is real. It does not reach this defect for
three reasons. It governs the **held** list only, and says nothing about
*pending* events — after L2 parks, each new message is claimed by whichever
listener wins, so neither ever does the other's work and the rule never fires,
while the conversation is answered alternately by two agents that cannot see each
other. Its **diagnostic conclusion becomes false**: converse tells a listener
that a row sitting in its list for hours means nobody is running the
orchestrator's loop, which with a peer on the lane is a wrong diagnosis of a
healthy workspace. And its **mechanical backstop stops discriminating** — every
event the peer claims *after* this session's first claim has a `heldSince` later
than it, so `heldSince` no longer disqualifies anything and only first-person
recall is left, in a long-lived session, exactly when the duplication has lasted
longest.

## Testing Strategy

Template assertions for the text. The real test is two live sessions and one
long turn.

## E2E Verification Log

**Model: Fable 5 (`claude-fable-5`).** Real workspace at `/tmp/agent029/ws`
(`corpus init`, server on `:8766` — never 8765), real CLI from
`apps/cli/dist/bin/corpus.js`, real queue events, real 16-minute grace window (no
shortening, no patched server).

### Reproduction — the reviewer's sequence, exactly

Standalone thread `th_fe3pamjk` "Q4 planning", resident `researcher`. L1 is a
real listener process: roster read, park, claim, then an **18-minute inline turn
holding no park** — which is what the converse skill instructs.

```
[L1 14:17:16] park returned; loop step 1 — claim
{"events":[{"id":"evt_ioc4i2g3w25o","type":"comment.created",…}],"inProgress":{"events":[],"total":0}}
[L1 14:17:16] claimed evt_ioc4i2g3w25o — WORKING inline, 18 min, holding no park
```

The lane read `live` for exactly one grace window and then flipped **while the
work was still running** (roster sampled once a minute throughout):

```
[watch 14:18:09] th_fe3pamjk "Q4 planning" · researcher · live, parked 53s ago — working Q4 planning
[watch 14:32:12] th_fe3pamjk "Q4 planning" · researcher · live, parked 14m ago — working Q4 planning
14:33:17  th_fe3pamjk "Q4 planning" · researcher · lapsed, last parked 16m ago — working Q4 planning
```

Both of the orchestrator's guards were then checked against the real server and
**neither fires**. Nothing was pending on that lane, so the unscoped claim took
no work from it, and this was not a relaunch:

```
[drill 14:33:20] guard 1: unscoped claim-all:
{"events":[],"inProgress":{"events":[{"id":"evt_ioc4i2g3w25o","heldSince":"2026-08-17T14:17:16Z",…}],"total":1}}
[drill 14:33:21] guard 2: is this a relaunch? no — first launch of this session.
[drill 14:33:21] roster row is not the orchestrator's and does not read live -> LAUNCH a listener
```

L2's own startup guard read the same row and also let it through:

```
[L2 14:33:21] row: th_fe3pamjk "Q4 planning" · researcher · lapsed, last parked 16m ago — working Q4 planning
[L2 14:33:21] startup step 6 — park
[drill 14:33:41] roster with L2 parked and L1 still working:
th_fe3pamjk "Q4 planning" · researcher · live, parked 20s ago — working Q4 planning
```

That line is the defect stated by the product itself: the board says the
conversation is answered, and the agent answering it is twenty seconds old with
none of its context, while the real resident is mid-turn. When L1 finished and
re-parked, **two listener processes held parks on one lane**:

```
[drill 14:35:26] === TWO LISTENERS, ONE CONVERSATION, both parked ===
69961 node …/corpus.js queue idle --thread th_fe3pamjk --json
80728 node …/corpus.js queue idle --thread th_fe3pamjk --json
```

The next user message woke both. The server gave it to one, and the other's claim
came back with the loser's signature — **empty `events`, and the id its own park
had just named sitting in `inProgress`**:

```
[L1 14:35:27] L1 park returned  (named evt_kihigbptierg)
{"events":[],"inProgress":{"events":[{"id":"evt_kihigbptierg","heldSince":"2026-08-17T14:35:28Z",…}],"total":1}}
```

No error was raised anywhere, by either agent or by the server.

### The drill — one conversation ends with one listener

Fresh conversation `th_5ejlq3qt` "Rates review". Two listener processes, both
running the loop with the new rule, both legitimately taking a lane that does not
read `live`:

```
[A 14:36:57] row: th_5ejlq3qt "Rates review" · researcher · waiting for a listener
[A 14:36:57] row does not read live — take the lane (it can rule a listener in, never out)
[B 14:36:57] row: th_5ejlq3qt "Rates review" · researcher · waiting for a listener
[B 14:36:57] row does not read live — take the lane (it can rule a listener in, never out)
43186 node …/corpus.js queue idle --thread th_5ejlq3qt --json
43187 node …/corpus.js queue idle --thread th_5ejlq3qt --json
```

One user message. Both parks return, both claim, the server picks one:

```
[A 14:37:11] park returned; named: [evt_2g4jygp6ouq5]
[A 14:37:11] claim: events=[evt_2g4jygp6ouq5] inProgress=[]
[A 14:37:11] claimed evt_2g4jygp6ouq5 — working it, replying, settling

[B 14:37:11] park returned; named: [evt_2g4jygp6ouq5]
[B 14:37:11] claim: events=[] inProgress=[evt_2g4jygp6ouq5]
[B 14:37:11] RULE FIRES: empty events on work my park named, and those ids are in inProgress
[B 14:37:11] RULE: only another listener can claim a live lane -> EXIT, posting nothing
```

After it, one parked process and one listener script alive (`43570`, `A`), and
the person received **one** reply to their message. A second message was answered
once more by the survivor; the thread carries three agent turns for three
occasions and no duplicate:

```
user · 2026-08-17T14:37:11Z   What is the current 30-year rate?
agent · 2026-08-17T14:37:13Z  A answering evt_2g4jygp6ouq5
```

### The discriminator, measured in both directions

The `inProgress` half is what stops the rule retiring a **sole** listener when
work leaves `pending/` by another door. Both branches were measured on the real
server rather than reasoned:

```
abandoned      → {"events":[],"inProgress":{"events":[],"total":0}}          → rule does NOT fire
claimed by a peer → {"events":[],"inProgress":{"events":[{"id":"evt_qsctckuzyq7y",…}],"total":1}} → rule fires
```

A false positive would in any case fail in §7's accepted direction: the sole
listener exits, the lane goes unattended, the orchestrator covers under the
fallback and relaunches on a later pass.

### Checks

- `scripts/workspace-template.test.ts` — 310 tests pass (304 before; six new).
  `sections.size` unchanged at 15 (converse) and 16 (orchestrate).
- Cross-checked with a real CommonMark parser (`mdast-util-from-markdown`):
  top-level `depth: 2` headings = 15 and 16, and **zero** code nodes ending off a
  fence line — no fence in either file is left open.
- `eslint` clean on the touched test file; `prettier --write` applied.
- Every roster and queue line quoted above is real command output; no example in
  either skill invents a shape the CLI does not print.

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-029]` prefix
