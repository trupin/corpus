# [SHARED-028] Four riders reviewed one by one, and a contradiction found doing it

## Domain

shared (orchestrator-handled)

## Status

done — **SIGNED and APPLIED** to SPEC.md on 2026-08-08

## Priority

P1

## Model

fable

## Dependencies

- Depends on: SHARED-025 (whose rule §4 was contradicting), CONTRACT-043, UI-091, CONTRACT-042
- Implemented by: — (three of the four record shipped behaviour; the fourth is a correction)

## Spec References

- SPEC.md §6, §11, §9.2, §4

## Summary

The user asked to go through the held riders one at a time rather than sign them
as a batch. That is what surfaced the fourth item as something other than
wording.

**§6 — the `turnModels` commitment** (CONTRACT-043). The load-bearing clause is
"the turn heading never grows a field for it". Without it in the spec, a later
reader finds a map in frontmatter, judges it indirect, and moves the model into
the heading as a simplification — the one option that makes attribution
forgeable and retroactively re-reads every existing thread file. §6 documents
the `anchors` map the same way and for the same reason.

**§11 — the pre-check widened** (UI-091). Three of the four §6 refusals are now
caught in the composer, so the sentence scoped on review under-described what
ships. The clause worth having is "the same rules, asked twice": it stops a
future change relaxing the server guard as redundant, which would move a
data-integrity check into the client.

**§9.2 — `/api/search`'s filter set.** The line claimed search carries "the same
set" of structured filters as `GET /api/docs`. It never did — `pinned` was
already absent, and `isParent` made it two. **The user chose to fix the sentence
rather than the product**: search is ranked retrieval, and adding a
slice-the-corpus filter nobody asked for to make a sentence true would be
growing the product to fit its documentation. The exclusions are now named as
deliberate rather than pending.

**§4 — a genuine contradiction, not the wording problem it was filed as.**
Reported by AGENT-020 as "reads as though a thread were meant". Reading the full
sentence showed two clauses, and the first was worse: on a `doc.edited` event §4
said the agent "updates or **comments** where it does" ripple into other
documents — i.e. opens a thread — while SHARED-025's §7 rule, signed the day
before, says of the same trigger that it "does **not** open a thread". Two
signed sections giving opposite instructions for one event. §7 is later and
explicit, and the skill implements §7, so nothing misbehaved; but relying on
"the later one wins" is how a rule gets quietly reverted by someone who reads §4
first, with SPEC on their side. And the ripple path is the one most likely to
fire, so the practical effect of §4 winning would have been precisely the
behaviour the changelog rider was written to remove.

## What this says about the process

Three of these were bookkeeping. The fourth was a live contradiction between two
signed riders, one day old, that a batch sign-off would have carried straight
into `main` — found only because each was read out in full rather than
summarised. Worth remembering the next time a set of riders looks routine.

## Completion Checklist (orchestrator)

- [x] Each rider presented individually with its actual drafted text
- [x] Signed by the user, one at a time
- [x] Applied to SPEC.md
- [ ] Committed with `[SHARED-028]` prefix
