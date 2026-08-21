# [AGENT-040] A release and its designation need not share a claim, and the skill says they always do

## Domain
agent-runtime

## Status
done

## Priority
P0

## Model
fable

## Dependencies
- Related: AGENT-039 (which launches a listener at the designation's weight), SHARED-055, AGENT-029/031/032 (the stand-down rules), CONTRACT-069 (release as an event)

## Spec References
- SPEC.md **§7** — the queue, designation, release, and a resident's lane

## Summary

Reported from live use, 2026-08-21, with the mechanism already worked out:

> *"a live row means this is a re-designation of a lane that is already
> answered. Launch nothing, log why, complete."*
>
> That reasoning holds for a plain re-designation. It fails for a designation
> that follows a release, because the released listener keeps its park until it
> next unparks. The skill does anticipate release-then-designate, but only as
> reason: `"replaced"` arriving in the same claim as the designation. Yours
> arrived as **two separate events on two separate claims, 9 seconds apart**, so
> the pairing rule never fired and the live check ran instead. That is very
> likely what declined your earlier designations too.

**Confirmed in the source.** `assets/workspace/claude/skills/orchestrate/SKILL.md`
states the pairing as an invariant:

> **`replaced` is the one reason that is not an ending**, and it never arrives
> alone: the same claim carries the `resident.designated` that took the lane
> over, for the same thread.

**"It never arrives alone" is not true**, and nothing in §7 or the queue
guarantees it. Two events reach a claim together only when they are both pending
when that claim runs. A release and the designation that follows it are separate
writes at separate times, so any claim boundary between them splits the pair.

The consequence is silent and repeating: the live check fires, the launch is
declined, a log line records a correct-sounding reason, and the lane is left with
a listener that is on its way out and a designation nobody acted on.

## Two defects, and the second is the one that repeats

1. **A stated invariant that the system does not provide.** The skill teaches
   that `replaced` never arrives alone. It does. Every rule downstream that
   relies on reading the pair as one act inherits the error.
2. **The live check has no exception for a lane this session has just released.**
   A row reads `live` because the outgoing listener still holds its park — it
   finds out it was replaced only when it next unparks, which is the converse
   skill's design and is correct. So `live` here means *"someone is leaving"*,
   not *"this lane is answered"*, and the rule cannot tell the two apart.

## What to build

The reporter's own sentence is the fix, and it should be taken as the shape:

> a live row does not hold back a launch when this session has already processed
> a release on that same lane.

Both defects need addressing, not just the second — a skill that keeps teaching
a false invariant will grow another rule on top of it.

## Decisions to make and record

1. **Where "this session has already processed a release on that lane" is
   remembered**, and for how long. The skill has no store; it has the job log,
   the roster, and what the session has seen. Say plainly what carries it and
   what happens when the orchestrator restarts and loses it — note that on a
   restart every designation survives and the orchestrator's own listeners do
   not, so the fallback rule may already cover the restarted case. Do not invent
   state the runtime does not have.
2. **The interaction with *"a lane with nobody on it gets one, once a pass"*.**
   A launch onto a lane that still reads `live` must not then be judged a failed
   launch by the following pass's "did it go live" check, and must not double up
   with the fallback launch when the row finally goes not-live.
3. **Two listeners, briefly.** The new listener may park while the old one is
   still inside a turn. The skill already says two listeners is not a
   correctness failure — the server hands no event to two claimants — but it is
   a split story. Say what makes this case acceptable where the skill's existing
   warning says it is not: the old one is leaving by construction.
4. **Whether `converse` states the same false invariant.** AGENT-032 was filed
   because a rule written into both skills drifted, and it was the fourth
   finding in three passes from one rule in two places. Check before writing.

## Acceptance Criteria
- [ ] The skill no longer claims `replaced` never arrives alone
- [ ] A designation following a release launches a listener, whether the two
      arrived on one claim or on two
- [ ] A plain re-designation of a genuinely answered lane still launches nothing
- [ ] The following pass does not read the launch as failed because the row was
      live when it went out
- [ ] The fallback does not launch a second listener into the same lane
- [ ] If `converse` states the same invariant, both are corrected together
- [ ] `scripts/workspace-template.test.ts` pins the new rule, so it cannot be
      quietly reverted

## Testing Strategy
`scripts/workspace-template.test.ts` is where this repository pins skill text
that must not drift. Pin the corrected rule and the removal of the false
invariant. A skill is prose, so the test is the guard.

## Decisions Record

1. **Where the memory lives.** In the session itself, and nowhere else: the release the
   session logged and completed is work it has seen, and the skill says plainly that there
   is no store to write it into and none to consult. It lasts until a launch follows on that
   lane — the launch spends it, so a later designation with no new release (measured: an
   exact-repeat designation emits `resident.designated` alone) falls back to the decline
   branch. A restart loses the memory **and** every listener the session launched, so every
   designated lane reads not-`live` on the first roster read and the once-a-pass fallback
   launches with no memory needed — the restarted case was already covered, exactly as the
   issue suspected.
2. **Interaction with the once-a-pass rule.** The exception launch is counted as the pass's
   one launch for that lane, so a `resident.designated` in the same batch and the fallback
   both launch nothing further. The following pass judges it as it judges any launch, and a
   row that reads `live` is the launch working — the row was `live` at launch and the new
   listener parks as the old one leaves, so the reading never breaks. The fallback stays
   quiet afterwards for the same reason: a parked successor keeps the row `live`.
3. **Two listeners, briefly.** Stated with its reason: the one already there is leaving by
   construction — its designation has been replaced — so the lane ends with one voice. The
   converse startup check needed the matching branch, or the fix would have been decorative:
   the successor's own startup read finds `live` (the leaver's park, or its grace window),
   and the old unconditional branch would have it exit on the spot. The launch prompt now
   states that the launch follows a release, and converse's startup `live` branch parks
   through it; which of the two stays is settled by the contested-claim test converse
   already owns, restated nowhere.
4. **Does `converse` state the same invariant?** No — grepped for the pairing claim and for
   `replaced`: nothing. But it carried the same *wrong reading of `live`* in two places, and
   both are corrected: the startup branch above, and "re-designating a lane you are already
   holding launches nothing new", which taught the pre-fix orchestrator and now says a
   successor may be launched while the sitting resident still holds its park, with the
   launch rule left orchestrate's (single-owner) and only converse's two ways of finding out
   stated there.

## E2E Verification Log

**Model: Fable 5 (`claude-fable-5`).** Transcript:
`/private/tmp/claude-501/-Users-theophanerupin-code-corpus/20129721-b03b-4996-937c-c4db9126c356/scratchpad/agent040-transcript.txt`.

**Reproduction of the mechanism, real server** (`corpus init` workspace, port 8899, server
pid 82454, 2026-08-21, CLI run from source via tsx). A scoped
`corpus queue idle --thread th_rbo4oump` was parked in the background as a stand-in
listener, so the lane read `live` throughout.

- **The split shape (the reported failure).** `corpus thread release th_rbo4oump` →
  `claim-all` returned the release **alone**
  (`evt_3jm546gfcpax`, `"reason":"released"`). Then `corpus thread designate th_rbo4oump
  --weight heavy` → the next `claim-all` returned the designation **alone**
  (`evt_zydjyqcsrbnq`), with the still-held release visible only in `inProgress`, and
  `corpus agents` printing `a general resident at heavy · live, parked 2s ago`. Under the
  pre-fix text the pairing rule cannot fire (the release was on the previous claim) and the
  live check declines — the reported behavior, mechanism confirmed.
- **The paired shape.** A weight-changing re-designation
  (`standard` → `heavy`, one command) emitted both events, and one `claim-all` returned
  them as one batch: `resident.released` with `"reason":"replaced"` carrying the old
  weight, and `resident.designated` carrying the new one.
- **The decline branch is real.** An **exact-repeat** designation
  (`--weight standard`, unchanged) emitted `resident.designated` **alone** — no release —
  so "no release seen, lane `live`" is precisely the repeat-on-an-answered-lane case the
  skill still declines.
- **The grace reading.** After the parked process was killed, `corpus agents` still printed
  `live, parked 19s ago` with nobody parked — the "row goes on reading `live` for a grace
  window after any park ends" clause, measured.
- Every claimed event was settled (`corpus queue complete` × 6), the server stopped
  (`stopped (pid 82454)`), port 8899 verified free, and the user's live server on 8765 was
  never touched.

**Pins.** `scripts/workspace-template.test.ts`: the false invariant is pinned **absent**
(`never arrives alone` / `the same claim carries` both refused), the split handling, the
carried release, the launch-through-live exception, the spend/once-a-pass coupling, the
restart story, the rewritten weight-change rule, and both converse corrections. Pin-break
drills: five mutations (false invariant restored; exception deleted; Delegation fence
reverted to prose; launch-bullet mechanism stripped; converse park-anyway branch removed)
each failed exactly its target test; restored, `scripts/workspace-template.test.ts` is
**424/424**, eslint and prettier clean, `tsc --noEmit -p scripts/tsconfig.json` exit 0.
