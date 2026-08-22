# [UI-045] Kit surface for plugin menus, selectors, and mutations

## Domain
ui

## Status
closed — obsoleted by SHARED-067 (Phase 41): every item here exists to make a core affordance reachable from a plugin, and there are no plugins.

**Closed 2026-08-22 by SHARED-065 (Phase 41).** SHARED-067 removed the plugin
surface on the user's instruction — *"I want it fully gone, no trace of it in the
codebase or the specs."* Every one of this issue's five items exists to make a
core affordance **reachable from a plugin**: the selector rule, the reveal
matcher, a plugin-facing menu frame, an escape-layer registration seam,
`usePluginMutation`, and a plugin-facing composer primitive. With no plugin there
is one consumer of each, `apps/ui`, and no drift surface between a producer and a
consumer that could disagree.

**The one real defect it carried is already fixed.** Item 1b cites PR #19's MAJOR
of 2026-08-03 — a deadlined duplicate revealing the first namesake — which was
fixed in that PR. What remained here was the *structural* ask to publish the
matcher so an external producer could not restate the rule wrongly again. There
is no external producer.

The spec sentence this issue was raised against — *"menus come through the plugin
kit"*, signed 2026-08-02 into what was then §10 — went with the plugin sections.
The Spec References below keep the pre-renumber section numbers, as every issue
filed before 2026-08-22 does. Kept as a record rather than deleted.

## Priority
P1

## Model
opus

## Dependencies
- Depends on: PLUGINS-009
- Blocks: —

## Spec References
- SPEC.md §10 plugin-surface menus amendment (signed 2026-08-02): menus come
  "through the plugin kit" — the kit publishes no such surface yet

## Summary
PLUGINS-009 shipped the todos item menu by hand-rolling what core owns but
does not export. Promote to kit, in priority order:
1. **`SELECTOR_CONTEXT`/`selectorAt`** — the plugin DUPLICATED the 32-char
   anchor-context rule; if core changes it, plugin anchors silently stop
   matching reader anchors. Highest drift risk; export the constant+helper.
1b. **The reveal matcher/frame builder** — same drift class, found the hard way.
   `chooseOccurrence` (`apps/ui/src/reader/reveal.ts`) is the consumer of every
   reveal any plugin will ever produce and is unreachable from a plugin, so
   PLUGINS-010's producer had to *restate* the matching rule to test itself
   against it — and the rule the restatement was written against was wrong
   (2026-08-03 PR #19 MAJOR: a deadlined duplicate revealed the first namesake,
   because producer and consumer framed the due marker differently and the
   first-occurrence fallback hid it). Publish the matcher, or a frame builder
   that produces frames it is guaranteed to satisfy, so producer and consumer
   cannot disagree again.
2. **Menu frame** — ContextMenuHost/useRovingMenu/clampToViewport equivalent
   as a kit component (not a re-export; core's `items` is an element factory —
   design a plugin-facing API).
3. **Escape precedence** — `useEscapeStack` is a module-level registry plugins
   cannot join; the window-capture workaround leaves two plugin menus with no
   defined order. Expose a layer-registration seam.
4. **`usePluginMutation`** beside `usePluginQuery`.
5. **CommentPopover** (or the composer primitive PLUGINS-009 rebuilt).
Migrate plugins/todos to the new surface and delete the hand-rolled copies in
the same change — the duplicates are the debt, not the feature.

## Acceptance Criteria
- [ ] Selector rule single-sourced; plugin uses the kit export; a test pins
      core and kit agree
- [ ] Menu frame + escape layering kit-exported; todos migrated; conventions
      (role=menu, ⇧F10, esc order) preserved by the shared code
- [ ] usePluginMutation with the invalidation semantics usePluginQuery has
- [ ] RUNTIME_SURFACE updated; eslint boundaries still forbid apps/ui imports

## Technical Design
### Files to Create/Modify
- packages/kit (new exports), plugins/todos (migration), boundaries tests

## Testing Strategy
Kit component tests; todos suite green post-migration; drift-pin test.

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
