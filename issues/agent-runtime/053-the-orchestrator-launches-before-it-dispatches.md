# [AGENT-053] The orchestrate skill launches before it dispatches, and never takes a lane's work

## Domain

agent-runtime

## Status

todo

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

- [ ] **The launch-deferral rule is deleted.** *"But never in the same pass you
      took that lane's work"* and everything under it goes. Its own text says it
      exists because of the fallback — _"it is the one collision the fallback can
      actually produce"_ — and there is no fallback
- [ ] **Launching moves to the roster read**, ahead of dispatching, which is
      where that same rule says it would have been but for the fallback: _"This
      is why launching happens after the claim rather than at the roster read"_
- [ ] The skill launches for a lane where **`pending > 0` and not `live`**,
      reading SERVER-155's field. Not from `summary`, which the contract forbids
      deciding from, and not from absence alone, which launches for every idle
      conversation
- [ ] **One listener per lane per pass**, still. The *"a conversation that queued
      eight messages gets eight listeners"* hazard is unchanged by any of this
- [ ] *"What the claim hands you is yours, and you do not audit it"* is rewritten.
      Its conclusion survives and its reason does not: the claim is still not
      audited, but no longer because the server folded lapsed lanes in
- [ ] *"A lapsed lane's work is ordinary work"* is **deleted entirely.** There is
      no such work. With it goes the instruction *"do not hold work back for an
      agent that might come back"*, which rider C inverts, and the `corpus job
      log … "claimed under the fallback"` example
- [ ] **The never-apologise rule survives, and its reason is restated.** *"Never
      apologise for a resident and never announce that one is missing"* was right
      for the fallback and is more right now — the orchestrator is not in that
      conversation at all. But its old rationale (the lapse costs warmth and
      speed) is now false, and the reproduction above is an orchestrator
      apologising at length in somebody's thread
- [ ] **A held row leaving the list** section is re-read against the new rules and
      repaired or deleted
- [ ] Every deleted argument is deleted **with its conclusion re-derived**, never
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

<!-- filled by the implementing agent -->

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-053]` prefix
