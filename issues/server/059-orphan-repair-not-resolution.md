# [SERVER-059] A never-matching selector reads orphaned forever — and fuzzy resolution cannot fix it

## Domain
server

## Status
todo

## Priority
P1

## Model
fable

## Dependencies
- Depends on: UI-068, SERVER-071 (prevention); CONTRACT-041, SERVER-072, UI-086 (repair)
- Blocks: —

**This issue is now an umbrella.** The route was chosen by the user on
2026-08-07 and decomposed into the five issues above; nothing is implemented
here. It closes when they do.

## Spec References
- SPEC.md §6 Anchoring — the resolution ladder, "a visible orphan beats a silent
  misattachment"

## Summary
SERVER-055 tried to close a real gap by wiring SPEC §6's fuzzy rung into the read
paths. **It was reverted after the PR #22 review found it misattaches**, and the
investigation that followed is worth more than the attempt: it establishes that
the gap is a **repair** problem, not a **resolution** problem, and that no
reader-side similarity measure can close it.

**The gap is real and permanent.** A selector that never byte-matched — from
UI-068's canonical mismatch, or `corpus thread create` storing `prefix`/`suffix`
verbatim — is born orphaned, and no later save repairs it: reconciliation leaves
an anchor it cannot resolve in `oldBody` exactly as it found it. That comment is
detached for the life of the document.

## What the failed attempt proved — do not re-derive this
Measured at PR head, with selectors built by the real `computeContext`:

- **8 of 12 deletion shapes misattach** — bullets, a `Q1–Q4` list at first,
  middle and last position, table rows, task lists, parallel prose, numbered
  steps. Every list of **three or more** parallel items. The four that orphan do
  so on the *length* term, which is exactly how the two-item safety tests passed:
  they were shape-lucky, not adversarial.
- **It is wrong on genuine edits too**, not only deletions. Change
  `| north-2 | alice | green |` → `… | amber |` and resolution returns
  `| north-3 | alice | green |` — the untouched row *below*.
- **The gate was inert where it mattered most.** `corpus thread create` stores
  context as sent, so agent-created anchors are context-free and hit
  `contextCorroborates`'s `return true` on the first line. Every anchor the agent
  opens bypassed the safety check entirely.
- **The misattachment is permanent, not a window.** Reconciliation orphans and
  preserves the selector; the reader re-guesses it onto the sibling on every read,
  forever. `corpus doc check` reported nothing wrong.

**The impossibility, stated as a construction** (and pinned as a test): deleting
`- Review the Q2 report by Friday` from a Q1–Q4 list, and renaming that same line
to `Q3` while deleting the old Q3 line, produce **the same `newBody` from the same
`oldBody` with the same selector** — and demand opposite correct answers. A reader
sees only the after-state. No similarity measure, at any threshold, can separate
"edited" from "deleted with a sibling remaining", because the evidence that would
separate them does not exist at read time.

## The route, chosen 2026-08-07 (user decision)

**Prevent at birth, then offer re-attach.** Directions 1 and 3 below were not
taken; direction 2 was, with a prevention phase in front of it.

**Phase A — stop creating them.** Both ways an anchor is *born* orphaned get
fixed, so the population stops growing: **UI-068** (the selector quotes the
serializer's re-print rather than the file's bytes) and **SERVER-071**
(`thread create` stores the context it was sent, which is how every
agent-created anchor ended up context-free — and therefore how every one of them
bypassed `contextCorroborates` entirely).

**Phase B — drain the backlog.** **CONTRACT-041** opens a re-attach route,
**SERVER-072** writes the corrected selector, **UI-086** shows the candidate
sites and lets the person choose. This is the only phase that can fix a comment
already detached.

Why this pairing rather than either half alone: repair without prevention is an
affordance in permanent use rather than a backlog that drains, and prevention
without repair leaves every existing orphan detached for the life of its
document. Direction 1 was declined because the population this issue is about
**never byte-matched**, so there is no diff at write time to consult — the
evidence it relies on does not exist for exactly these anchors.

## Directions that dodge the impossibility
Recorded as the options considered; direction 2 was chosen. The point of keeping
all three is that any future attempt must answer *what evidence a reader has*
rather than tuning a threshold.

1. **A one-off repair pass** that rewrites the stale selector in the file, once,
   in a revertible commit — moving the decision to write time, where the diff
   exists.
2. **UI-offered re-attach candidates** on an orphan: show the user the plausible
   sites and let them choose. The evidence problem is unsolvable for a machine
   and trivial for the person who wrote the comment.
3. **If fuzzy is retried at all**: pigeonhole-complete candidate generation,
   orphan on *any* ambiguity rather than ranking, and adversarial fixtures at ≥3
   parallel items in every shape (list, table, task list, prose, numbered).

## Acceptance Criteria
- [ ] A comment whose selector never byte-matched can become attached again —
      by whichever route is chosen
- [ ] **No route may attach a comment to text the user did not comment on.**
      SPEC §6 is explicit: a visible orphan beats a silent misattachment
- [ ] Two threads on disjoint text never end up claiming overlapping text
- [ ] Whatever ships is tested adversarially at ≥3 parallel items in every shape
      above — the previous attempt's tests passed because they used two
- [ ] If the route is user-facing, the user can tell what they are agreeing to

## Technical Design
### Files to Create/Modify
- Depends entirely on the route chosen.

### Notes
- `findFuzzyRange` remains correct **for reconciliation**, which has the diff and
  therefore the evidence. It is only inadmissible on a read path. Do not delete it.

## Testing Strategy
Adversarial fixtures first, at three or more parallel items, in every shape.

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
