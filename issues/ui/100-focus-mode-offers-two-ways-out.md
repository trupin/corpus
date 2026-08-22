# [UI-100] Focus mode shows two controls that read as the same exit

## Domain

ui

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —

## Spec References

- SPEC.md §10 — focus mode (⤢), "a full-viewport reading/editing surface"
- SPEC.md §10 — "**Navigation history**: each reader keeps its own stack …
  Back pops with scroll position restored; the reader exits to its list only when
  the stack empties"
- `design/index.html` — authoritative for look & feel

## Summary

User report (2026-08-08): in a full-screen document the header shows **`✕ Close`**
and, immediately beside it, **`‹ DMV day — Wed 2026-08-05, Culver City: what to
bring`** — two controls that read as the same action. The user wants only the
close button.

They are *supposed* to be different, and the code says so.
`apps/ui/src/reader/ReaderHead.tsx:83`:

```ts
export function showsBack(variant, previous): boolean {
  return variant !== "focus" || previous !== null;
}
```

with the docblock: *"The back button earns its place only once the stack has
depth, where it is named after the previous document and navigates within the
excursion. `design/index.html` models exactly this: `#focus-back` ships `hidden`
and `openFocus` unhides it only when the focus stack has a previous entry."*

And `backLabel`'s docblock names the exact symptom reported:

> With depth it is the **previous** document's title … Naming it after the
> **current** document (**the mistake this exists to avoid**) would make the
> control claim it does nothing.

## The question the reproduction must answer

Either:

- **(a)** `previous` is non-null but names the **same document** currently open —
  a self-push onto the nav stack. The button is then labelled with the current
  document and goes nowhere, which is exactly what "two buttons that do the same
  thing" looks like. This is a bug in what gets pushed, not in the header.
- **(b)** `previous` genuinely names a different document, the two controls do
  different things, and the problem is that nothing on screen says so — a `‹`
  chevron beside an `✕ Close` reads as "also close" whatever it does.

**Do not skip this step.** (a) is fixed in the nav stack; (b) is fixed in the
header's affordances, and removing the back button outright — the literal request
— would in case (b) delete the only way to walk back through an excursion without
leaving focus mode, which §10's navigation-history rule requires.

Report which it is before changing anything, and say so to the orchestrator if it
turns out to be (b), because the resolution is then a design call rather than a
bug fix.

## Acceptance Criteria

- [ ] Reproduction recorded, naming (a) or (b) with evidence from the live stack
- [ ] Focus mode never shows a back control that names the document already open
- [ ] Focus mode never shows two controls that perform the same navigation
- [ ] Where the stack **has** depth, Back still works and still names where it
      goes — §10's per-reader navigation stack is not weakened
- [ ] `esc` behaviour is unchanged: at depth 0 it closes, with depth it pops
      (`FocusMode.tsx:141`)
- [ ] Shift-click / ⇧esc "straight to list" still works where it applies
- [ ] Checked against `design/index.html`, which already models the intended
      hidden/unhidden behaviour

## Technical Design

### Files to Create/Modify

- `apps/ui/src/reader/useNavStack.ts` — if (a): whatever pushes the current
  document onto its own stack. Note `toList` at line 182 is a no-op when the
  stack is already empty, so a button that lands there does visibly nothing
- `apps/ui/src/reader/ReaderHead.tsx` — `showsBack` / `backLabel`, if (b)
- `apps/ui/src/reader/FocusMode.tsx` — the `leading` ✕ Close and the `onBack`
  wiring (lines 163–170)

### Edge Cases

- Opening focus mode **directly** on a document versus reaching it by following a
  `[[ref]]` from another — the two produce different stacks and only one of them
  should show Back
- Following a ref, then Back, then Back again — the control must disappear at the
  right moment, not one step late
- A stack entry whose document was deleted — `drop()` already forgets it; confirm
  the header follows
- Focus mode on a **thread** rather than a document

## Testing Strategy

Vitest over `showsBack` and `backLabel` for: empty stack in focus, one previous
entry naming a different document, and a previous entry naming the **same**
document (the case that must never render). Plus a nav-stack test that opening
focus mode on a document does not push that document onto its own stack.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start the app; open a document in a column, then open focus mode (⤢)
2. Look at the header
3. Expected: `✕ Close` alone, no back control
4. Actual: `✕ Close` beside `‹ <a document title>`
5. **Record whether that title is the open document or a different one** — this
   is the whole diagnosis

### Verification Steps

1. Restart the app; open focus mode directly on a document — confirm only
   `✕ Close`
2. Follow a `[[ref]]` to a second document — confirm Back appears, named after
   the **first** document
3. Click Back — confirm it returns there with scroll position restored, and the
   control disappears
4. Press `esc` at depth 0 — confirm it closes focus mode
5. Press `esc` with depth — confirm it pops instead
6. Shift-click Back with depth — confirm it goes straight to the list
7. Compare the header against `design/index.html`

## E2E Verification Log

_[Agent fills: model run on, whether the cause was (a) or (b), commands,
observed output.]_

## Completion Checklist (domain agent)

- [ ] Pre-fix reproduction logged, naming (a) or (b)
- [ ] Escalated to the orchestrator if (b) — the fix is then a design call
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[UI-100]` prefix
