# [AGENT-032] The stand-down rule is written in both skills, and they now contradict

## Domain

agent-runtime

## Status

done

## Priority

P0

## Model

fable

## Dependencies

- Related: AGENT-029 (which wrote it into both), AGENT-031 (which fixed one)

## Summary

`AGENT-029` wrote the stand-down rule into **both** skills. `AGENT-031` rewrote
it in `converse/SKILL.md` and left `orchestrate/SKILL.md:345-348` on the
conjunctive form it deleted. The two copies now contradict:

- orchestrate:346 — *"its claim comes back **empty** on work its own park had
  just named, which on a live lane only another listener can cause, and it
  exits."*
- converse:260 — *"**Judge it on that id, and never on the claim being empty.**"*
- converse:287 — *"**An empty `events` is not the signal in either direction**"*

**And it is load-bearing, not commentary.** That paragraph is the justification
for orchestrate's *"Launch, and let the lane settle it"* invariant — so the
orchestrator accepts duplicate launches on the strength of a mechanism it
describes in its superseded, non-firing form.

Failure scenario, the exact two-message case `AGENT-031` measured on a real
server: L1 claims M1; L2's park named M1, its claim returns `events:[M2]`,
`inProgress:[M1]`. Under converse, L2 exits. Under orchestrate's account the
discriminator does not hold, nothing fires, and two listeners answer alternate
messages.

Nothing pins the two files against each other — none of the 278 new lines in
`scripts/workspace-template.test.ts` compares them.

**This is the fourth finding in three review passes caused by one rule written
in two places**, and the third that shipped green. That pattern is the thing to
fix, not just this instance.

## Two further findings from the same review, to fold in

**A fourth shape the three exclusions do not cover** — created by AGENT-030's
own change. It newly instructs a retiring listener to run one scoped
`claim-all`, and converse:455 already contemplates a person re-designating the
thread. So: release → listener A's park refused → thread re-designated on the
same id → listener B parks, its park names E as pending → A's *drain* claim
takes E. B sees E in `inProgress`, its own park named it, B did not claim it —
all three exclusions pass, B exits, A is leaving, and the conversation has no
listener. Narrow, but it is the one producer of the signal that is **not** a
peer listener.

**The worked example understates the rule** (converse:725): in the one scenario
this whole family concerns — a listener's first park, first claim — it gives
only AGENT-027's "leave it where it was" answer with no mention of the exit.
Not wrong; under-stated, in the same paragraph shape whose first draft stood the
*surviving* listener down during AGENT-031's drill.

## Acceptance Criteria

- [x] `orchestrate/SKILL.md` states the rule as `converse` now states it, or —
      better — **stops restating it** and points at the skill that owns it. A
      rule that only the resident executes does not need a second full account
      in the orchestrator's text; what the orchestrator needs is the invariant
      it relies on, plus where the mechanism lives
- [x] **The two skills are pinned against each other**, so a future edit to one
      fails a test rather than waiting for a reviewer. This is the criterion
      that matters — the instance is cheap and the class has now cost four
      findings
- [x] The fourth shape is handled or explicitly declared out of scope with
      reasoning. If a retiring listener's drain claim can evict a healthy
      successor, say what prevents it
- [x] The worked example carries both answers
- [x] Drilled: the two-message case, showing one conversation ends with one
      listener, with both skills' text in play rather than converse's alone

## Testing Strategy

Template assertions, including the cross-file pin. The drill is two live
listeners and two messages.

## E2E Verification Log

**Model: Fable 5 (`claude-fable-5`).** Real `corpus init` workspace
`/tmp/corpus-agent032/ws` on `:8796` (never 8765, never 5173), real server, real
CLI from `apps/cli/dist/bin/corpus.js`, and **four** real Claude Code sessions
(`--model sonnet`) driven by the installed skill text alone — one `/orchestrate`
and three `/converse`. Transcripts in `/tmp/corpus-agent032/session{O,A,B,S}.jsonl`;
every `corpus …` any session ran is timestamped and session-tagged in
`/tmp/corpus-agent032/calls.log` by a PATH shim.

### What was removed rather than synchronised

`orchestrate/SKILL.md` no longer describes the discriminator at all. The bullet
keeps the invariant it actually relies on — *at the first message either of them
is asked to answer, one of the two finds out it is second and goes* — and adds a
pointer: **How it finds that out is the converse skill's to state, and it is
stated there alone.** A rule only the resident executes needs no second account
in the orchestrator's text, and deleting the copy is the only fix that cannot
drift. Nothing else in the repo states it: `grep` over `assets/`, `docs/`,
`plugins/`, `apps/cli/src` and `SPEC.md` for the mechanism's vocabulary returns
`converse/SKILL.md` alone.

### The general cross-file pin — achievable, in two halves

`scripts/workspace-template.test.ts`, new top-level `describe("one rule, one
skill")`. A single mechanical pin is **not** sufficient, and that is the finding:

- **Copied prose** is caught generally. Every pair of the three skills is
  compared as a word stream (fences dropped, wrapping and emphasis normalised);
  any maximal passage of 12+ shared words that is not in a recorded
  `STATED_TWICE` entry fails. The baseline is 47 passages today, each grouped
  under the reason both skills state it — the inherited invariants, the loop's
  own shape, the settling grammar, delegation, *Writing a document* (stated in
  full in both `orchestrate` and `comment` — the same class, recorded rather
  than fixed, so that it cannot grow), and stewardship.
- **A paraphrase defeats that**, and a paraphrase is exactly how AGENT-029
  shipped: the two accounts never shared twelve words. So a second pin
  registers a rule with its **owner** and the mechanism's own vocabulary. The
  owner must state it, no other skill may, and a skill that relies on it must
  carry a pointer. Two rules are registered: the stand-down (owner `converse`)
  and the weight-levels table (owner `orchestrate` — the pattern already existed
  informally and is now in the same registry).

Both are anti-vacuous by construction: the passage pin proves it still finds the
recorded duplication and, in-test, reports a `converse` sentence pasted into
`orchestrate`; the registry asserts the owner still states the rule. And the
registry is validated against the shipped text — the pre-fix sentence is in the
test verbatim, and the detector run over the **whole** pre-fix
`orchestrate/SKILL.md` reports exactly 1 restatement (0 on the current file, 5
in `converse`, 0 in `comment`). **This pin would have failed PR #48.**

### The fourth shape — closed at the producer, measured on a real server

Reproduced end to end with the CLI, on lane `th_ohyrh5il`:

```
release            → corpus agents: the row is gone
re-designate       → th_ohyrh5il "Q3 planning" · researcher · waiting for a listener
successor's park   → {"events":[{"id":"evt_fe2edwiv56oe",…}],"inProgress":{"events":[],"total":0}}
retiring drain     → claim-all --thread th_ohyrh5il takes evt_fe2edwiv56oe   (unguarded, by design)
successor's claim  → {"events":[],"inProgress":{"events":[{"id":"evt_fe2edwiv56oe","heldSince":…}],"total":1}}
```

That last payload passes all three exclusions — the id the successor's **own**
park named, held by a caller it did not claim it as — so the healthy successor
stands down and the conversation is left with none.

It cannot be excluded at the successor: the held row carries `id`, `type`,
`heldSince`, `originId`, `originTitle` and **no claimant**, so a retiring
listener's hold is indistinguishable from a peer's. So it is closed at the
producer. *Retirement* now states that a re-designated lane's events are the
successor's ordinary pending work, and step 1 makes the drain conditional on a
roster read taken **immediately before** it: a row that is back is a designation
that is not yours — post nothing, drain nothing, exit. Two measurements make
that test the right one: with the successor parked the row reads `live, parked
3s ago`, and *before* it parks it reads `waiting for a listener` — so the rule
keys on the row **existing**, which covers the earlier and more dangerous
instant. The residual race (a designation landing between that read and that
claim) needs a whole launch and startup to fit between two consecutive commands,
and its cost is a lane with no resident, which the orchestrator's fallback
covers.

### The producer side, drilled live as well

A fourth session (**T**) held `th_6yudefrs`, answered a message and settled it;
the lane was released the instant it settled and re-designated two seconds
later, straddling its next roster read:

```
09:55:29 [T] corpus queue complete evt_dmmsjgfiqimv     ← release lands at 09:55:29
09:55:31 [T] corpus agents                              ← re-designation lands at 09:55:31
09:55:33 [T] corpus agents
09:55:35 [T] corpus queue idle --thread th_6yudefrs
```

The first read came back without the row and the second found it back — and
**no `claim-all --thread` was issued between them or after**, which is the act
the rule governs: the pending event (`evt_fyf3twt47k6o`, queued while T was
working) was never drained out from under anyone, and was answered on the lane's
next pass. What the drill does **not** show is a session that reasoned its way
through the new branch: T read the flicker as a stale roster read rather than as
a re-designation ("*grep must have missed it due to timing*") and carried on as
the lane's listener. Same act, different reason — so the CLI reproduction above
is what carries the mechanism, and this run is evidence that the ordering does
not produce a drain.

Two harness facts worth recording for the next drill: a release does **not** end
a park already held (measured — a held `idle` sat through one and stayed
parked), so the retirement branch is normally reached one rearm later; and a
headless `claude -p` session cannot sit on an unqualified park, because the
480-second `idle` exceeds the Bash tool's 120-second timeout and gets
backgrounded, ending the session's turn.

### The drill — two messages, and in fact three listeners

Both skills' text in play. Session **O** ran `/orchestrate` against the edited
Routing bullet and behaved as written — `reap-stale` → `agents` → `claim-all` →
launch → settle at launch time:

```
09:46:50 [O] corpus job log evt_uqydhb4lsgpw launched a converse listener on th_3szqzxvy as researcher (doc_s3qbsuwj)
09:46:50 [O] corpus queue complete evt_uqydhb4lsgpw
```

Its background listener (**L2**) plus two hand-launched sessions (**A**, **B**)
all read the roster before any of them parked, so all three legitimately took
the lane and all three parked. M1 was posted, and M2 the instant the first claim
appeared — the ordinary case, and the one the conjunction could not see:

```
09:47:02 [A] corpus queue idle --thread th_3szqzxvy
09:47:02 [O] corpus queue idle --thread th_3szqzxvy      (L2, launched by the orchestrator)
09:47:09 [B] corpus queue idle --thread th_3szqzxvy
09:47:13  M1 → evt_xrqwth2yocje
09:47:16  M2 → evt_kz25bvyazxck        (posted the instant the first claim-all appeared)
09:47:16 [B] claim → events:[evt_xrqwth2yocje]  inProgress:[]
09:47:16 [O] claim → events:[]                  inProgress:[evt_xrqwth2yocje]
09:47:16 [A] claim → events:[evt_kz25bvyazxck]  inProgress:[evt_xrqwth2yocje]
```

**A's claim is the case that shipped**: `events` **non-empty**, with the id its
own park had named sitting in `inProgress`. Under `orchestrate`'s deleted
account — *"its claim comes back empty on work its own park had just named"* —
nothing fires. Under the rule as `converse` states it, A stood down:

```
09:47:33 [A] corpus job log evt_kz25bvyazxck "stood down — another listener already holds
             evt_xrqwth2yocje on this lane (named by my own park, returned in-progress under
             a different caller); leaving this event unclaimed-in-effect"
A_EXIT=0     (no reply posted, nothing worked, nothing settled)
```

L2 stood down on the empty-claim shape, in its own words: *"an id my own park
named as pending, coming back held by another caller instead of claimed to me,
means another listener is already on this lane (the orchestrator can't be the
cause here since my park just returned and the lane reads live for the grace
window)"*. B stayed, answered, settled and re-parked:

```
09:47:55 [B] corpus thread reply th_3szqzxvy --from agent --model claude-sonnet-5
09:47:59 [B] corpus queue complete evt_xrqwth2yocje
09:48:03 [B] corpus queue claim-all --thread th_3szqzxvy
```

**One conversation, three listeners, two messages, one listener left and one
agent turn on the thread** — no duplicate, nothing posted by either session that
went. M2 stayed in `in-progress/` on the lane for `reap-stale`, which is the
disposal the skill prescribes, and B's `--model claude-sonnet-5` is what ran
rather than the string in the example.

### Checks

- `scripts/workspace-template.test.ts`: **327 pass** (was 320). Six new `it`s;
  `sections.size` unchanged at **16 / 15 / 13**.
- **Every new pin validated against the pre-fix text** (`/tmp/corpus-agent032/negcheck.mjs`,
  which rebuilds both pre-fix bodies by string surgery): 19 checks — each new
  positive matcher absent from the pre-fix body, the negative matcher firing on
  it, and the pre-existing pins the edits sit beside still holding.
- Real CommonMark parse (`mdast-util-from-markdown`): `depth: 2` headings
  16 / 15 / 13, zero code nodes ending off a fence line.
- Example output checked against the real commands: the roster line, the
  `claim-all` payload shape, and the `job log` launch line all match what the
  server printed in this workspace.
- `prettier` and `eslint` clean on all three touched files.

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-032]` prefix
