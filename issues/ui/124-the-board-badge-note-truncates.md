# [UI-124] The board badge's resident note truncates, and always has

## Domain

ui

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: UI-123, SHARED-053 (which lengthened the note this measured)

## Spec References

- SPEC.md **§10** — the board

## Summary

The board badge's one-line resident note **truncates**, and the resident's name
already wraps mid-word. Measured in a real browser during PR #50's third review
response:

| | `scrollWidth` | `clientWidth` |
| --- | --- | --- |
| the note before SHARED-053's correction | 310 | 227 |
| after | 499 | 263 |

**Pre-existing, not introduced.** The old string overflowed by 83px and the name
wrapped mid-word already. Correcting the note's text made an existing overflow
larger; it did not create one.

The composer statement — the surface the note is actually written for — carries
the whole corrected sentence cleanly. Only the badge clips it.

## Why it was not fixed in PR #50

The measurement arrived at the end of a three-round review, from an agent that
had already done its work twice over. A layout change to the board badge is not a
loose end of the profile arc, and taking it then would have meant a fourth review
round for a defect that predates the release.

Filed instead of fixed, with the measurement attached so the next person does not
have to take it again.

## What has to be decided

1. **Whether the badge should carry the note at all.** The composer statement
   already says it in full, and a badge that clips a sentence teaches less than a
   badge that shows a state and points elsewhere.
2. If it keeps the note: whether it wraps, truncates with a title attribute, or
   shortens. Shortening means a second wording of a claim that this release spent
   ten sites reducing to one — see SHARED-053 — so prefer wrapping or a tooltip
   over a new short form.
3. The name wrapping mid-word is a separate defect in the same element and should
   be fixed with it.

## Acceptance Criteria

- [x] The badge shows the whole note, or shows a state and does not pretend to
      show the note
- [x] The resident's name does not wrap mid-word
- [x] If a shorter wording is introduced, it is composed from
      `MISSING_PROFILE_CAUSES` rather than typed — that constant exists because
      the claim was typed ten times and four of them were false
- [x] Measured after, in a real browser, the way it was measured here

## Technical Design

### Files to Create/Modify

- the board badge component and its styles
- `packages/kit/src/recipient/laneRows.ts` only if a short form is needed

### Key Implementation Details

Read SHARED-053 and `MISSING_PROFILE_CAUSES` first. The note is composed from a
constant precisely so that no surface types its own version of the claim.

## Testing Strategy

A layout assertion is weak here; the check is the measurement in a real browser.
If a short form is added, pin it to the constant.

## E2E Verification Plan

### Verification Steps

1. Real app, real workspace, port **not 8765** and **not 5173**
2. A thread whose resident's profile has been renamed, so the note renders
3. Measure `scrollWidth` against `clientWidth` on the badge
4. Confirm the composer statement still carries the full sentence

## E2E Verification Log

**Model: Opus 5 (1M context).** 2026-08-24. Real browser (chromium),
`CORPUS_UI_PORT=5373`, `apps/ui/e2e/resident-badge-geometry.spec.ts`.

### Reproduction, before the fix

The fix was reverted in the tree and the new spec run against it, so these are
this machine's numbers rather than PR #50's, at the board's **narrowest column**
(240px, `MIN_COLUMN_WIDTH`), on a `profile-gone` lane named `release-researcher`:

| element | `scrollWidth` | `clientWidth` |
| --- | --- | --- |
| `.t-resident` | **522** | 178 |
| `.t-resident-name` | height **306px** — eight line boxes | — |

The badge overflowed its head by 344px, and the resident's name was broken
**mid-word** down eight lines. PR #50 recorded 499 against 263 at a wider head;
the defect scales with how little room the head has.

### What changed, and what was decided

1. **The badge carries `LaneRow.mark`, not `LaneRow.note`.** That is not a second
   wording of the claim — the thing SHARED-053 exists to prevent, and what
   criterion 3 forbids inventing. `note` and `mark` are two renderings of one
   fact off `LaneRow.kind` (`laneNote` / `laneMark`), and `laneRows.ts` already
   says which surface takes which: *"a surface with a line to itself says the
   note; one whose rows sit side by side says this."* The badge is a row. The
   recipient picker's rows already take the mark. The composer's statement — the
   surface the sentence is written for — still carries it whole, and the badge's
   own `title` carries `MISSING_PROFILE_NOTE` in full, which it always did.
2. **The name never breaks.** `white-space: nowrap`, with `overflow: hidden` and
   an ellipsis for the case where even it must give.
3. **What gives, and in what order.** `.t-head` is a wrapping flex row and three
   runs inside the badge can shrink at once, so shrink factors two orders of
   magnitude apart order them in practice: the **liveness line** first
   (`flex: 1 1 0` — it takes only leftover room and asks for none), then the
   **mark** (`flex: 0 50 auto`), then the **name** (`flex: 0 1 auto`).

`flex: 1 1 0` on the line is the load-bearing part and was reached by
measurement. While the line's own ~370px counted towards what the badge asked
for, the mark was still four pixels short at the **default** 336px column — 89px
of content in an 85px box — for an ordinary `researcher` as well as for
`release-researcher`. Taking the line out of the ask closes it for both.

### After, measured

- 240px column: `.t-resident` `scrollWidth ≤ clientWidth` — the badge no longer
  overflows the head. The mark reads `profile gone`, from
  `MISSING_PROFILE_MARK`. The whole sentence is on the badge's `title`.
- 336px column (`DEFAULT_COLUMN_WIDTH`), both `researcher` and
  `release-researcher`: **nothing truncates** — badge, name and mark all satisfy
  `scrollWidth ≤ clientWidth`. That is SHARED-057 clause 3: revealing is the
  uncommon case, not the reading path.
- The name is **one line box** (`getClientRects().length === 1`) and shorter
  than 1.6 line heights, measured against the element's own computed
  `line-height` rather than a pixel count.

At the 240px floor the liveness line is at zero and, on a long profile name, the
mark ellipsizes. That is stated rather than asserted away: it is SHARED-061's
last clause — a box that cannot be given the room its content needs says so —
and the ellipsis is the saying, with the whole sentence one hover away.

### Tests

- `apps/ui/e2e/resident-badge-geometry.spec.ts` — 4 specs, all green.
- `apps/ui/src/thread/ResidentBadge.test.tsx` — the `profile-gone` case now
  expects `MISSING_PROFILE_MARK` on the face and `MISSING_PROFILE_NOTE` on the
  title.
- `apps/ui/e2e/resident.spec.ts` — the same swap in the existing assertion, plus
  a title check; 18 specs green.
- `vitest run apps/ui/src/thread` — 458 green.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-124]` prefix
