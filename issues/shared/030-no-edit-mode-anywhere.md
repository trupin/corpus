# [SHARED-030] Frontmatter hides behind an edit mode the rest of the reader abolished

## Domain

shared (orchestrator-handled — SPEC.md rider, needs user sign-off)

## Status

done — **SIGNED 2026-08-12 and applied to SPEC.md §10**

**One clause dropped on application**, for the same reason SHARED-037 lost one:
the drafted text said "the only read-only state is the one that makes every
surface read-only: a lock held by the other party (§7), which freezes these
controls and the body alike and names the holder." Locks were replaced by keys on
2026-08-11 (SHARED-041), and §10 now says the board is **never** read-only. The
sentence would have reintroduced a state the product no longer has. Everything
else is applied verbatim. Drafted 2026-08-08, before the lock was replaced.

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Blocks: UI-093, UI-092

## Spec References

- SPEC.md §10 line 467 — "Document view — always editable, Google-Docs-like",
  "There is no edit mode", "**Autosave, no save button**", and the clause this
  rider amends: "Frontmatter editable as a small form (title, tags, status, due)"
- SPEC.md §4 — autosave and commit granularity (idle squashing)
- SPEC.md §7 — locks render the document read-only with a banner

## Summary

§10 opens by abolishing edit mode for the document view and closes the same
sentence group with "Autosave, no save button". Then it says frontmatter is
"editable as a small form" and stops — silent on whether the form obeys the rule
that governs everything around it. The implementation filled that silence with
an `edit` chip, a draft, and a Save button
(`apps/ui/src/reader/FrontmatterForm.tsx`), so changing a status or a due date
costs three clicks on a surface whose neighbouring body accepts a keystroke.

The user's report is broader than the form (2026-08-08): *"In general, I don't
want that pattern. It's an outdated pattern."* So the rider states the rule
generally rather than patching one control, which also settles the same question
for every editable surface added later.

## Drafted rider text

Replacing §10's "Frontmatter editable as a small form (title, tags, status,
due)." with:

> Frontmatter editable as a small form (title, tags, status, due) — **under the
> body's rule, not beside it: no edit mode, no save button.** The controls are
> live wherever the document is shown, and a change commits where it is made,
> through the same `PUT` path and debounced exactly as the body's autosave is,
> squashed into the same idle commit (§4) — so retitling and retagging in one
> sitting is one history entry rather than two, and a frontmatter change and a
> body change made together are one commit rather than a race between two. **The
> only read-only state is the one that makes every surface read-only**: a lock
> held by the other party (§7), which freezes these controls and the body alike
> and names the holder. A field whose value is **derived rather than stored**
> shows the value and says where it comes from, and is editable by nobody — that
> is not an edit mode, it is a field that was never the person's to set.
> **This is the general rule, not a frontmatter exception**: no surface in the
> reader asks to be put into a mode before it will accept a change, and none
> asks for a second act to keep one.

## Acceptance Criteria

- [ ] Read aloud to the user **on its own**, separately from SHARED-036
- [ ] User signs off, or amends
- [ ] Applied to SPEC.md §10 with the `_(Rider signed YYYY-MM-DD.)_` marker
- [ ] Contradiction sweep recorded here, specifically against:
      - §4 — does per-change autosave change what one idle commit contains?
      - §7 — the lock freeze is the *only* surviving read-only state; confirm no
        other spec text asserts a second one
      - §10's own "empty document does not survive leaving it" rule — a
        title cleared to empty must still behave as it does today
- [ ] PLAN.md row for UI-093 references the signed date

## Technical Design

None — spec text. Implementation is UI-093.

### Edge Cases the text must survive

- **A failed save has no Save button to retry from.** The body's answer is the
  `SaveChip` (`apps/ui/src/editor/SaveChip.tsx`); the rider implies the form
  gets the same treatment rather than inventing one. Confirm the text covers it,
  or leave it to UI-093 as an implementation detail — it is arguably behavioural
  enough to name.
- **A free-text field** (title, tags) cannot commit per keystroke. The rider says
  "debounced exactly as the body's autosave is", which pins it to
  `AUTOSAVE_DEBOUNCE_MS` (700 ms) rather than inventing a second cadence.
  Discrete controls (status, due) have no such problem and commit on change.
- **The existing flush-on-exit** — `FrontmatterForm`'s current doc comment notes
  that leaving the document flushes the draft. With no draft, there is nothing
  to flush; the rider must not leave that mechanism half-alive.

## Testing Strategy

N/A — spec text. Behaviour is tested by UI-093.

## E2E Verification Plan

N/A.

## E2E Verification Log

_N/A — spec rider._

## Completion Checklist (orchestrator)

- [ ] Rider read aloud one at a time, verbatim
- [ ] Signed by user
- [ ] Applied to SPEC.md with signature marker
- [ ] Contradiction sweep across §4, §7, §10 done and recorded here
- [ ] Committed with `[SHARED-030]` prefix
