# [CONTRACT-053] `QueueStatus.agent` is defined against the roster, and the two can legitimately disagree

## Domain

contract

## Status

todo

## Priority

P2

## Model

fable

## Dependencies

- Depends on: SERVER-112 (which found it while implementing both sides)
- Related: CONTRACT-045 (which wrote the sentence), SERVER-109 (designation and
  release)

## Spec References

- SPEC.md **§7** — *"A resident is **live** exactly while it holds a parked
  scoped `idle`… an agent that stops parking stops being present"*
- SPEC.md **§9.2** — `GET /api/agents`, the roster of lanes

## Summary

`CONTRACT-045` describes `QueueStatus.agent` as true *"exactly when some lane of
`GET /api/agents` is live"*. `SERVER-112` implemented both sides and found a
window where that is not so.

**A listener can be parked on a lane the roster no longer has a row for.** The
roster's rows come from designated threads; a resident released — or a thread
resolved, which §7 says releases its resident with it — removes the row
immediately. The agent parked on that lane does not vanish with it: it is still
holding an `idle`, and it stays held until it returns or lapses, up to one grace
window.

For that window, `QueueStatus.agent` says `live` (somebody **is** holding a
parked request, which is what §7 defines presence as) while the roster lists no
live lane. Both are correct about what they measure. The **sentence** binding
them is what is wrong.

`SERVER-112` reports it live deliberately and documented the reasoning in
`presence()`. This issue is only about the contract's wording — no behaviour is
in question, and nothing should change on the server.

## What the fix must decide

Which of the two is the definition, and say so:

- If presence is *"somebody is holding a parked idle"* — the §7 reading, and the
  one the server implements — then `QueueStatus.agent` is the primary fact and
  the roster is a view of it that happens to be filtered by designation. The
  description should stop defining itself in terms of the roster.
- If presence is *"some designated lane is live"*, then the released-resident
  case is a state the roster should still represent for a grace window, and that
  is a server change rather than a wording one.

The first is almost certainly right — §7 defines presence as the parked request
and nothing else, and it is emphatic that there is no registration to keep fresh
— but it is the kind of "almost certainly" that should be written down rather
than inferred by the next reader.

## Acceptance Criteria

- [ ] `QueueStatus.agent`'s description states what it measures directly, not by
      reference to another endpoint's rows
- [ ] The divergence is named where a reader will meet it, rather than left as a
      surprise: a caller comparing the two and finding them disagree should find
      the reason in the contract, not have to reproduce it
- [ ] `openapi.json` regenerated; the published artifact swept for any other
      description that defines one field in terms of another endpoint's contents
- [ ] No behavioural change on the server

## Testing Strategy

Generation and drift check. If a test pins the old wording, update it there.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-053]` prefix
