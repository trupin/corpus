# [UI-131] A label that arrives late reflows the row it lands in

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-057 (signed 2026-08-20), UI-128 (the audit that measured it)
- Blocks: —
- Related: UI-125 (which shipped the Residents tab), UI-098 (unknown needs somewhere to live)

## Spec References

- SPEC.md **§11** — *"Nothing resizes because of what it holds"* (rider signed 2026-08-20)
- SPEC.md **§7** — the roster and the scope the Residents tab shows

## Summary

Several rows paint a **placeholder that is shorter than the real value** and swap
it in later: a weight *key* before the workspace's *label*, a document *id*
before its *title*, a lane *id* before a conversation's name. The placeholder is
not a loading state — it is a legitimate fallback that renders when the real
value is genuinely unknown — so the row does not know it is temporary and
reserves nothing for what is coming.

UI-128 named this **shape (b)**, and it is the class UI-127 actually belongs to.
It measured 12 of its 31 latent rows and 3 of its 6 reachable clusters as this
shape, against **three** hits for the hover-driven shape everyone expected.

## The measurement (UI-128, real Chromium, 2026-08-20)

The console's Residents tab, a resident designated at `weight: heavy`, with the
orchestrate skill's body held open and then released:

```
BEFORE (skill body still in flight)
   name  : researcher [x=32 w=251]
   weight: heavy      [x=293 w=33]
   meta  : live       [x=337 w=27]
AFTER  (label arrived)
   name  : researcher [x=32 w=132]
   weight: Heavy or judgment-laden [x=174 w=152]
   meta  : live       [x=337 w=27]
```

**+119px on the weight, −119px on the name, and the weight's own left edge jumps
119px left** — a third of a 380px row, on a row that is a `<button>` a person
clicks the moment the tab opens. The lane name re-ellipsizes at a different point
while it is being read.

## The scope of this issue, stated precisely

**Fix the console's two sites**, which are measured:

- `LaneList.tsx:82` — `.lane-weight` in the master list
- `LaneScope.tsx:86` — `.lane-weight` in the detail pane, where
  `.lane-scope-head .lane-name` is `flex: none; max-width: 40%` so **only**
  `.lane-statement` can pay, and the sentence the tab exists to show is what
  re-truncates

**And establish the pattern the rest will follow.** UI-128 lists seven more sites
of the same shape as latent-but-unmeasured (`L1` `RefNodeView`, `L2`
`ScopeProvenance`, `L3` anchor chips, `L4` search filter chips, `L5` the todo item
preview, `L14` `.scope-count`, `L15` the agent pill). **They are out of scope
here** — each needs its own measurement first. What this issue owes them is a
reusable answer and a comment saying what it is.

## Acceptance Criteria

- [ ] **Measure the box, change the content, measure again, assert unchanged**: a
      Playwright spec holds the orchestrate skill's body open, records
      `.lane-name`, `.lane-mark`, `.lane-weight` and `.lane-meta` bounding boxes,
      releases it, and asserts **every one of them is unchanged**
- [ ] The same assertion for `LaneScope`'s head, where `.lane-statement` is the
      element that must not re-truncate
- [ ] Both the key and the label remain **readable**. If the label is truncated to
      fit a reserved box, the whole of it is reachable per SHARED-057 clause 2 —
      the row already carries `title={laneStatement(row)}`, so extending that is
      the cheap answer
- [ ] The fallback stays honest. `weightLabel` returning the raw key when the
      workspace no longer declares it (`addressModel.ts:188`) is a **real state**,
      not a loading state, and must keep rendering. UI-098's rule holds: an absent
      answer is never presented as one
- [ ] The chosen pattern is written down in a comment where the next site can find
      it, naming which of the three approaches below was taken and why
- [ ] `Residents.test.tsx:221-226` — which already documents the swap in prose —
      is updated to assert the geometry rather than only the text
- [ ] **Falsification**: remove the reservation, rebuild `packages/kit`'s `dist/`
      if the change reaches kit, and watch the spec fail

## Technical Design

### Files to Create/Modify

- `apps/ui/src/console/console.css` — `.lane-weight` (`:562-567`),
  `.lane-scope-head` (`:580-595`)
- `apps/ui/src/console/LaneList.tsx`, `apps/ui/src/console/LaneScope.tsx`
- `apps/ui/src/console/residentsModel.ts` — if the label derivation changes
- `apps/ui/e2e/` — the geometry spec

### Key Implementation Details

The mechanism, precisely. `laneWeightLabel` (`residentsModel.ts:186`) calls
`weightLabel(levels, row.weight)`, and `weightLabel`
(`packages/kit/src/address/addressModel.ts:188`) falls back to the key when
`levels` does not contain it. `levels` comes from `useWeightLevels`
(`packages/kit/src/weight/useWeightLevels.ts:155`), which needs **two sequential
round trips** — an exhaustive paged `?type=skill` scan, then a `useDoc` for the
body — before it can parse the table. `.lane-weight` is `flex: none`, so the
whole delta lands on `.lane-name`, the one shrinkable item.

Three approaches, in the order they should be considered.

1. **Reserve the box.** Give `.lane-weight` a `min-width` sized to the longest
   label the workspace declares — the levels are already in hand when they
   arrive, so the reservation can be computed rather than guessed, and a
   `min-width` from the widest declared label is stable for a given workspace.
   Truncate anything longer and reveal it on the row's `title`.
2. **Do not paint the weight until it is known.** Render nothing in the weight
   slot while `levels` is empty *and* the row has a key — reserving the slot's
   width, not its content. This is the honest reading of UI-098's rule: the row
   does not yet know what the workspace calls this level, so it says nothing
   rather than saying the key. **Note the ambiguity this must not lose**: an
   empty `levels` also means "this workspace declares nothing", and in that state
   the key *is* the answer and must render. The two are distinguishable —
   `useWeightLevels` knows whether its queries have settled — but the hook does
   not expose that today, and exposing it is a kit change with a plugin-facing
   surface. **Escalate before widening the hook's return type.**
3. **Shorten the label.** The weight table's labels are the workspace's own
   words, so the product cannot shorten them. Not available.

**Approach 1 needs nothing from kit and is the recommended default.** Approach 2
is better behaviour and costs a cross-domain conversation — take it only if the
orchestrator agrees to that cost.

**`Shell.tsx:128` warms `useWeightLevels()` at mount, and that is why the window
is narrow rather than absent.** Do not "fix" this by warming harder. The
placeholder-then-swap is the defect and warming only shrinks the window it lands
in — a workspace with many skills pages the scan longer, and §7's skill genesis
makes skill counts grow in ordinary use.

### Edge Cases

- A workspace that declares **no** levels: the key is the answer and must render
- A key the table no longer declares, after a level is renamed
- `row.weight === null`, which is `LAUNCH_WEIGHT_CLAUSE` and a different string
  entirely
- The orchestrator's own row, which has no resident
- `.lane-scope-head`, where the name cannot yield and the statement must

## Testing Strategy

Unit tests for any derivation change, extending `Residents.test.tsx` and
`consoleModel.test.ts`. The acceptance test is a real-browser geometry spec —
jsdom implements no layout and `Residents.test.tsx` already passes against the
current, defective code.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Real Vite dev server on a port that is not 5173
2. A roster with a designated resident carrying a weight key, and an orchestrate
   skill whose table gives that key a long label
3. Hold `GET /api/docs/<orchestrate skill>` open; open the console's Residents tab
4. Record every child box of the lane row
5. Release the response
6. Expected: nothing moves. Actual: the weight grows 119px and the name shrinks
   119px

### Verification Steps

1. Restart the dev server after the change
2. Repeat the reproduction for both the list row and the scope head
3. Expected: every child box is identical before and after
4. Confirm the label is fully readable, on the row or on its `title`
5. Confirm a workspace declaring no levels still shows the key

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in, reproduction first
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-131]` prefix
