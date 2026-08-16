# [UI-114] `⇧F10` does not open the todo item menu, and the e2e spec that says so is red

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Related: UI-070 (found it while running the suite for an unrelated change)

## Spec References

- SPEC.md **§11** — the board is operable from the keyboard; a menu reachable by
  pointer is reachable by key

## Summary

`apps/ui/e2e/todos-menu.spec.ts:272` asserts that `⇧F10` opens the todo item's
context menu. It fails **consistently** — with and without a live server, so it
is not the transport confusion of INFRA-028.

The pointer path to the same menu passes, which is what makes this worth a P1
rather than a curiosity: the menu exists and works, and only the keyboard route
into it is broken. That is the accessibility half of the affordance, and it is
the half nobody notices is missing.

Reported by UI-070's agent, which touched none of the code involved:

> `⇧F10` lives in `apps/ui/src/keyboard/shortcuts.ts` / `apps/ui/src/menu/*` /
> the plugin's `PluginMenu.tsx`, none of which I touched; the pointer path to the
> same menu passes.

**Reproduce before fixing.** A red spec has two possible causes and they need
different work: the shortcut is genuinely broken (fix the handler), or the spec
asserts something the surface never promised (fix the spec, and say what the
real contract is). Do not assume the first — `⇧F10` is the platform's own
context-menu key, and a browser or OS may be taking it before the page sees it,
which would make this a spec bug wearing a defect's clothes.

## Acceptance Criteria

- [ ] The failure is reproduced and its **cause named** before anything is
      changed, in the E2E Verification Log
- [ ] `⇧F10` opens the todo item menu from the keyboard, focus lands inside it,
      and `Escape` returns focus where it came from
- [ ] `apps/ui/e2e/todos-menu.spec.ts` passes, and the assertion was checked red
      against the unfixed code — a spec repaired into passing proves nothing
- [ ] If the cause turns out to be that the browser intercepts the key, that is
      stated and an alternative keyboard route is provided rather than the
      assertion being deleted

## Technical Design

### Files to Create/Modify

- `apps/ui/src/keyboard/shortcuts.ts`
- `apps/ui/src/menu/`
- `plugins/todos/ui/PluginMenu.tsx`
- `apps/ui/e2e/todos-menu.spec.ts`

## Testing Strategy

Unit for the handler's registration and its target resolution; the e2e spec is
already written and is the acceptance test.

## E2E Verification Log

_Filled by the implementing agent; state the model, and the reproduction first._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-114]` prefix
