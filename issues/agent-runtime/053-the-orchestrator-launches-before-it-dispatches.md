# [AGENT-053] The orchestrate skill launches before it dispatches, and never takes a lane's work

## Domain

agent-runtime

## Status

done

## Priority

P0

## Model

fable

## Dependencies

- Depends on: SERVER-152, SERVER-155
- Blocks: —

## Spec References

- SPEC.md §7 — rider C and rider D, both signed 2026-08-25

## Summary

**This issue rewrites the two most densely argued sections of
`orchestrate/SKILL.md`, and both are arguments for a mechanism that no longer
exists.**

The user supplied the reproduction, in an orchestrator's own words:

> Your designated resident on that thread is not running, and I am the reason.
> The skill forbids launching a listener in the same pass I take that lane's
> work, because a listener would read my in-progress events as abandoned and
> answer the same turns twice. You have kept posting there, so I have kept
> claiming, so the launch keeps deferring. It goes out on the first pass where
> that lane's queue is clear.

A conversation somebody is actively using never has a clear pass. The busier the
conversation, the more certain it is that the agent that owns it never starts.

**The fix is deletion, not amendment.** SERVER-152 removes the fallback, so the
orchestrator never holds an in-progress event stamped for another lane, so the
collision the deferral rule guards against cannot occur.

## Acceptance Criteria

- [x] **The launch-deferral rule is deleted.** *"But never in the same pass you
      took that lane's work"* and everything under it goes. Its own text says it
      exists because of the fallback — _"it is the one collision the fallback can
      actually produce"_ — and there is no fallback
- [x] **Launching moves to the roster read**, ahead of dispatching, which is
      where that same rule says it would have been but for the fallback: _"This
      is why launching happens after the claim rather than at the roster read"_
- [x] The skill launches for a lane where **`pending > 0` and not `live`**,
      reading SERVER-155's field. Not from `summary`, which the contract forbids
      deciding from, and not from absence alone, which launches for every idle
      conversation
- [x] **One listener per lane per pass**, still. The *"a conversation that queued
      eight messages gets eight listeners"* hazard is unchanged by any of this
- [x] *"What the claim hands you is yours, and you do not audit it"* is rewritten.
      Its conclusion survives and its reason does not: the claim is still not
      audited, but no longer because the server folded lapsed lanes in
- [x] *"A lapsed lane's work is ordinary work"* is **deleted entirely.** There is
      no such work. With it goes the instruction *"do not hold work back for an
      agent that might come back"*, which rider C inverts, and the `corpus job
      log … "claimed under the fallback"` example
- [x] **The never-apologise rule survives, and its reason is restated.** *"Never
      apologise for a resident and never announce that one is missing"* was right
      for the fallback and is more right now — the orchestrator is not in that
      conversation at all. But its old rationale (the lapse costs warmth and
      speed) is now false, and the reproduction above is an orchestrator
      apologising at length in somebody's thread
- [x] **A held row leaving the list** section is re-read against the new rules and
      repaired or deleted
- [x] Every deleted argument is deleted **with its conclusion re-derived**, never
      left as a conclusion whose reason has gone

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md` — §§ around lines 24–45,
  237–250, 310–345, 418–441, 618–640

### Key Implementation Details

**Read the whole file before editing any of it.** The fallback is argued in at
least five places, and this repository's most-repeated defect is a rule left
standing in one place after being replaced in another. Grep `fallback`, `lapse`,
`lapsed`, `grace` and fix every hit or say why it stands.

**The skill states the rule and the server enforces it.** Do not have the skill
check whether an event belongs to another lane — it cannot receive one. The
existing instruction *"there is no classification step here, and inventing one is
a mistake in both directions"* survives verbatim and is now simply true.

**Rider D is an instruction, not a mechanism.** Nothing tests it. Write it so a
model reading it once cannot mistake the priority — SHARED-072 records that this
is the whole of the mitigation for a conversation that would otherwise go
unanswered.

### Edge Cases

- The orchestrator's own lane always has a listener — itself. It must not launch
  one for itself.
- A lane with `pending > 0` and a listener that is merely between parks reads
  `live: true` because the grace window is already applied. Do not re-derive it.

## Testing Strategy

Prose. There is no unit test for a skill. What stands in for one:

- **The reproduction, re-read.** Walk the new text against the user's quoted
  transcript and show, in the E2E log, which sentence now prevents each step.
- A grep sweep for `fallback` / `lapse` with every remaining hit justified in the
  log.

## E2E Verification Plan

Against a real workspace: designate a thread, post three turns in a row with no
listener running, start `/orchestrate`, and confirm it launches a listener on its
**first** pass rather than claiming the turns. Confirm the turns are answered by
the resident. Paste the console output.

Then keep posting while the listener works, and confirm nothing defers.

## E2E Verification Log

Implemented by the orchestrator on opus, 2026-08-25.

### Writing the instruction found a hole in the surface

Rider D has the orchestrator launch from a lane that is **not live** with **work
pending**, read off `corpus agents`. CONTRACT-087 put `pending` on the wire and
SERVER-155 fills it — and `renderLane` never printed it. The skill would have
named a fact the surface does not show, and an orchestrator left inferring it
from absence launches an agent for every idle conversation in the workspace.

Filed and fixed as **CLI-070**. A row now reads:

```
th_9f1a2b "Rate check" · analyst (doc_a7) · lapsed, last parked 41m ago · 3 waiting
```

Absent at zero, and a cell of its own rather than folded into presence: presence
answers *is anybody there*, this answers *is anybody waiting*, and the decision
needs both stated separately.

### The deferral rule is deleted, with its own reason as the epitaph

The text that produced the user's transcript is gone. What replaces it says why
it was right, why it cannot bite any more, and what it cost:

> Deferring the launch until the lane was clear meant a conversation somebody
> kept using **never had a clear pass** — you claimed, so you deferred; they
> replied, so you claimed again. The busier the conversation, the more certain
> it was that the agent that owned it never started at all. Nothing in the old
> text was wrong; the outcome was.

### Every deleted argument had its conclusion re-derived

Not one was left standing without its reason.

- **"What the claim hands you is yours, and you do not audit it"** keeps its
  conclusion. Its reason changes, and the instruction *"do not hold work back
  for an agent that might come back"* is now true for the opposite reason — the
  server is already holding it.
- **"A lapsed lane's work is ordinary work"** is deleted outright. There is no
  such work.
- **"Never apologise for a resident"** survives and is *stronger*. Its old reason
  was that the work still got done slowly. The new one: you are not in that
  conversation at all, and **the fix is a launch, not an explanation.** The
  transcript that prompted this issue is an orchestrator writing a paragraph
  where it should have started an agent, so the rule is aimed at exactly what
  went wrong.
- **The reaper**, the **broken-`converse` diagnosis** and the **held-row** rule
  each named the fallback and each was repaired rather than deleted. The
  broken-`converse` symptom is now *a climbing pending count*, which is both
  more precise and the only symptom left.

### Falsification, as far as prose admits it

There is no unit test for a skill. What stands in for one is a walk of the new
text against the user's own transcript, sentence by sentence, checking that each
step it describes is now prevented by a named passage:

```
OK   the deferral rule is gone
OK   launch outranks dispatch
OK   the pair is the decision
OK   no work falls to the orchestrator
OK   do not explain, launch
OK   starvation named
```

And a grep sweep for `fallback` / `lapse`: **three hits remain, all deliberate
history** — sentences that say what was removed and why, which is the one form
in which the word should survive.

### What no test can hold, restated

Rider D is an instruction. If a model reads it and dispatches first anyway, a
conversation goes unanswered — where before it went answered by the wrong agent.
SHARED-072 records this as the whole of the mitigation, and it still is.

### Checks

```
vitest run apps/cli              2129 tests passed   exit 0
generated artifacts drift        openapi + docs/cli.md up to date
```


## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[AGENT-053]` prefix
