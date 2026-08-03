# [UI-053] One keyboard contract for all three autocompletes; ⇥ accepts everywhere

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-009 (Amendment 4)
- Blocks: —
- Coordinate with: UI-052 (composer keys — the menu claims `↵` while open)

## Spec References
- SPEC.md §11 "Smart input everywhere", as amended by SHARED-009 Amendment 4

## Summary
Live report 2026-08-03: _"When autocomplete shows, I want to be able to navigate
the results with the top and bottom arrows. I also want to be able to select one
with tab. Make it consistent with any autocomplete UX."_

Arrows already work in all three. `⇥` works in exactly one. Surveyed state:

| Implementation | Where | ↑↓ | ⇥ | ↵ | esc |
| --- | --- | --- | --- | --- | --- |
| `packages/kit/src/components/Autocomplete/useAutocomplete.ts` | `@` `/` `[[` in plain-text composers | wraps | **none — focus leaves the field** | unconditional accept | dismiss (+stopPropagation) |
| `apps/ui/src/editor/RefAutocomplete.tsx` (+ `refSuggestion.ts`) | `[[` in the TipTap document editor | wraps, no `preventDefault` | **none** | accept, falls through when list empty | close via `dismissedAt` |
| `apps/ui/src/board/query/useQueryAutocomplete.ts` | column query editor | wraps, sets `navigated` | **accepts** | conditional (`enterCompletes`) | dismiss (+stopPropagation) |

Three implementations, three behaviors. The kit one and the editor one are
keyboard-identical but are entirely separate code paths with separate state and
separate DOM — which is why they drifted from the query editor's without anyone
noticing.

**The fix the user asked for is `⇥` everywhere. The fix the code needs is one
implementation.** Do both, in that order of priority: no user-visible behavior
should wait on the refactor.

## Acceptance Criteria
- [ ] `⇥` accepts the highlighted item in **all three** autocompletes
- [ ] `↵` also accepts (unchanged where it already does; the query editor's
      `enterCompletes` conditionality is preserved — it exists because that menu
      can be open with nothing typed and an unconditional `↵` would commit an
      empty query; keep that reasoning in the code)
- [ ] Arrows wrap at both ends, everywhere
- [ ] `esc` dismisses leaving the typed text as it stands, everywhere
- [ ] `⇥` does not move focus while a menu is open, and does move focus normally
      when no menu is open
- [ ] The editor's `[[` menu and the kit's `[[` menu behave identically — a user
      cannot tell which one they are in
- [ ] One implementation backs at least the two `[[` menus, or a written reason
      in code why TipTap's suggestion plugin makes that impossible
- [ ] `RUNTIME_SURFACE` updated if the kit's exported surface changes
- [ ] Screen-reader semantics preserved (`role="listbox"`, `aria-selected`,
      `aria-activedescendant` where present)

## Technical Design
### Files to Create/Modify
- `packages/kit/src/components/Autocomplete/useAutocomplete.ts` (+ `⇥`)
- `apps/ui/src/editor/RefAutocomplete.tsx` / `refSuggestion.ts` (+ `⇥`, and the
  consolidation question)
- `apps/ui/src/board/query/useQueryAutocomplete.ts` (already has `⇥`; align the
  rest)
- Tests alongside each

### Notes
- `refSuggestion.ts` returns `true` to tell ProseMirror a key was consumed rather
  than calling `preventDefault`; `⇥` must be consumed the same way or focus will
  still escape.
- UI-052 changes what `↵` means in composers. The menu must claim `↵` **only
  while open**, and hand it back on dismiss.

## Testing Strategy
Component tests per implementation for ↑ ↓ ⇥ ↵ esc, wrap-around at both ends, and
`⇥`-does-not-blur. E2E for at least one composer trigger and the editor's `[[`.

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
