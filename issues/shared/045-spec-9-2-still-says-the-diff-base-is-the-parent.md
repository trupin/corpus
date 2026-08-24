# [SHARED-045] SPEC §9.2 still says the diff base is `to`'s parent, which §4 made wrong

## Domain

shared (SPEC amendment — requires user sign-off)

## Status

done

## Priority

P1

## Model

fable

## Dependencies

- Depends on: SERVER-113 (which changed the behaviour to match §4)
- Related: CONTRACT-052, CLI-045 (the same sentence, in the published contract
  and the CLI help)

## Spec References

- SPEC.md **§9.2** — the diff route: *"`from` to its parent"* (rider signed
  2026-08-05)
- SPEC.md **§4** — *"Where several documents share one window commit, each
  document's acknowledgment names that same commit and each diff is
  path-scoped, so every event still answers about its own document."*
  (party-scoped commit windows, 2026-08-10)

## Summary

Two signed riders disagree, and the second one is right.

§9.2's diff rider was signed **2026-08-05**. §4's party-scoped commit window
landed **2026-08-10** and made a commit's parent routinely a *different party's*
commit touching a *different document* — the exact condition §4 then addresses
by saying each document's diff is path-scoped.

So §9.2's "`from` to its parent" was true when it was written and stopped being
true five days later, and nothing caught it because the sentence still parses
fine. `SERVER-113` reproduced the consequence against a real workspace: the diff
route and the `doc.edited` event reported **different bases for the same
document**, because one followed §9.2's sentence and the other followed §4's.

The code now matches §4. The spec sentence is what is left wrong.

## What the amendment must say

The default base is **the previous commit that touched this document**, and
git's empty tree where there is none. It should also say *why*, in a clause,
because the reason is the thing that will stop it drifting back: the parent of a
window commit is not this document's history, it is whoever else's document
happened to be saved in the same window.

## Signed 2026-08-24 — §9.2 amended to match §4

§9.2's `from` default now reads **the previous commit that touched the
document**, with a sentence saying why it differs from `to`'s parent in ordinary
use rather than at an edge: §4's window is party-scoped, so a commit's parent is
routinely a different party's commit over a different document.

The 2026-08-05 rider's signature stands and the amendment is dated beside it, so
a reader can see that the sentence was true when written and that §4 falsified
it five days later. **The code already followed §4**, so this moved only the
spec.

## Acceptance Criteria

- [ ] Drafted amendment text quoted to the user **verbatim** and signed before
      anything is applied
- [ ] The amended §9.2 sentence agrees with §4's path-scoping sentence, and
      neither can be read as contradicting the other
- [ ] `CONTRACT-052` and `CLI-045` land the same wording in the published
      OpenAPI and the CLI help, so the three surfaces state one rule
- [ ] A check of whether any *other* §9.2 sentence predates 2026-08-10 and makes
      a claim about commit parentage — this one was found by accident, while
      fixing the code, and that is not a search

## Testing Strategy

Not applicable — spec text. The behaviour is already covered by SERVER-113's
regression tests.

## E2E Verification Log

_Not applicable until the amendment is signed._

## Completion Checklist (orchestrator)

- [ ] User sign-off on the amendment text
- [ ] Committed with `[SHARED-045]` prefix
