# [UI-074] The board surfaces have UI-073's exposure too

## Domain
ui

## Status
closed — obsoleted by SHARED-067 (Phase 41): its whole subject is late plugin discovery, which UI-155 deletes.

**Closed 2026-08-22 by SHARED-065 (Phase 41).** SHARED-067 removed the plugin
surface on the user's instruction — *"I want it fully gone, no trace of it in the
codebase or the specs."* This issue's whole subject is **late plugin
discovery**: a registration that settles after first paint and re-lays-out three
board surfaces. UI-155 deletes the registry, the slot dispatch and
`PluginColumnBody`, so there is no asynchronous registration for the board to
wait on and no *"plugin missing"* card to show falsely. `NewListPicker`'s
registration dependency goes the same way.

Each of the three acceptance criteria names an effect of that discovery, so none
outlives it. The reproduction technique it cites,
`apps/ui/e2e/plugin-late-arrival.spec.ts`, is deleted with the surface it holds
open. Kept as a record rather than deleted.

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-073
- Blocks: —

## Spec References
- SPEC.md §10 board, §12 plugins (discovery)

## Summary
Escalated by UI-073, which fixed the reader and scoped itself there deliberately.

Three board surfaces take a plugin registration and re-lay-out when discovery
settles late, exactly as `DocView` did:

- **`apps/ui/src/board/ColumnList.tsx`** — a late plugin `ListItem` changes row
  heights, so a click can open a different document than the one aimed at.
- **`apps/ui/src/board/Column.tsx`** — `PluginColumnBody` flashes a false
  **"plugin missing"** card on every cold load before the real column swaps in.
  That one is not a layout shift; it is the UI stating something untrue about the
  workspace, briefly, every time.
- **`apps/ui/src/board/NewListPicker.tsx`** — same registration dependency.

UI-073's fix is a one-line `usePluginDiscovery()` gate, so each of these is
plausibly a small change — but "plausibly small" is why it should be checked
rather than assumed: a board that holds its rows is a board that shows nothing on
first paint, and the reader's argument for holding ("only the surface whose
geometry is at risk waits") does not obviously transfer to the board, which *is*
the app's first frame.

**Why UI-073 stopped at the reader, and why this is P2 rather than P1:** a wrong
row opens visibly and the user goes back. A wrong quote lands in a comment and
stays. The harm here is recoverable; there it was silent.

## Acceptance Criteria
- [ ] A late plugin registration does not change which row a click opens
- [ ] `PluginColumnBody` never shows "plugin missing" for a plugin that is merely
      still loading — distinguish *absent* from *pending*
- [ ] The board's first paint is not held hostage to plugin discovery: §10's
      containment says core boots independently, and the board is the first frame
- [ ] Whatever is done, say in the code why it differs from the reader's answer
      if it does
- [ ] Reproduced deterministically first — `apps/ui/e2e/plugin-late-arrival.spec.ts`
      has the technique (route-level hold on the manifest module, with the
      interception count asserted so a pattern matching nothing cannot pass)

## Technical Design
### Files to Create/Modify
- `apps/ui/src/board/ColumnList.tsx`, `Column.tsx`, `NewListPicker.tsx`
- tests, extending the late-arrival spec

## Testing Strategy
Deterministic late arrival; assert the row a click opens, and that no
"plugin missing" card appears while discovery is pending.

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
