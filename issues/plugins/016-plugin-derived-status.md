# [PLUGINS-016] A plugin doc type can derive its own status

## Domain

plugins

## Status

todo

## Priority

P1

## Model

fable

## Dependencies

- Depends on: SHARED-036 (rider must be signed first)
- Blocks: SERVER-085, UI-092

## Spec References

- SPEC.md §12 — the `todo` doc type, as amended by SHARED-036
- SPEC.md §10 — plugin extension points
- SPEC.md §5 line 157 — `status` meaning per type

## Summary

SHARED-036 makes a todo document's status a reading of its items. Nothing in the
plugin system can express that today: `PluginDocType`
(`packages/kit/src/plugin/types.ts:139`) offers `ListItem`, `DocPanel` and
`validate` — all client-side — and `types.yaml`, the server- and CLI-readable
mirror, is declarative strings only. Meanwhile SPEC.md §12 makes UI checkbox
toggles **ordinary core body edits** that never touch the plugin's routes, so
there is no point on the write path where a plugin currently gets a say.

This issue adds that point, and implements it for todos.

## The one design decision, made before implementing

Two defensible homes for the derivation:

- **(A) A plugin-owned function.** Add `deriveStatus?: (doc) => DocStatus | null`
  to `PluginDocType`, and export a server-side counterpart from the plugin's
  `server/` module (which the server already dynamically imports —
  `apps/server/src/plugins/discover.ts`). The item format stays the plugin's,
  which is the boundary as drawn.
- **(B) Core reads task lists; the type opts in.** GFM task lists are already
  core — the core editor renders, toggles and serializes them, which is exactly
  why `manifest.ts` deliberately registers no `View`. So core could expose
  "task-list completion" as an ordinary document property and `types.yaml` could
  carry a declarative `statusFromTasks: true`. Far less machinery, no TS
  execution on the projection path, and the CLI gets it for free.

**Recommendation: (B).** The parse is not actually plugin-private — core owns
task-list syntax already — and (A) puts plugin TS on the projection hot path for
one boolean. Take (A) only if the sweep below finds that todos' item parsing
diverges from plain GFM task lists in a way that matters.

**Before implementing, verify against `plugins/todos/items.ts`:** does
`readItems` treat any line as an item that core's task-list parse would not, or
vice versa (fenced blocks, blockquotes, nesting, the `(due: …)` marker)? Record
the answer in this issue. A divergence decides this for you; no divergence makes
(B) correct. Escalate to the orchestrator if the answer is genuinely ambiguous
rather than picking to keep moving.

## Acceptance Criteria

- [ ] The design decision above is recorded in this file with its evidence
- [ ] A doc type can declare that its status is derived, through whichever
      mechanism the decision picks, and the declaration is readable by **both**
      the UI (from the manifest) and the server/CLI (without loading UI code) —
      the existing `parity.test.ts` invariant must still hold in both directions
- [ ] For `todo`: at least one item and no open items derives `resolved`;
      anything else derives `open`; an empty list derives `open`
- [ ] A document whose stored status is `archived` derives nothing — `archived`
      stands, per SHARED-036
- [ ] A document whose items cannot be read (the legacy `extra.items` state
      `LegacyItemsNotice` reports) derives **nothing** and falls back to the
      stored value — the same rule the DocPanel already applies to its counts
- [ ] Deleting `plugins/todos/` leaves core booting and todo documents rendering
      as ordinary markdown with working checkboxes (SPEC.md §15 M6's subtractive
      check) — derived status degrades to the stored value, it does not error
- [ ] The kit-only import rule is not weakened

## Technical Design

### Files to Create/Modify

- `packages/kit/src/plugin/types.ts` — the declaration, under whichever design
  wins
- `packages/kit/src/plugin/types.test.ts` — contract coverage
- `plugins/todos/types.yaml` — the non-TS mirror
- `plugins/todos/manifest.ts` — the TS side
- `plugins/todos/items.ts` — the derivation itself, if (A); a shared predicate
  either way
- `plugins/todos/parity.test.ts` — must still assert the two declarations agree

### Edge Cases

- A todo document with items only inside a fenced code block
- A document declaring `type: todo` with no body at all
- A plugin declaring derived status for a type it does not own — must be refused
  at discovery, containment-style (logged warning, plugin skipped), never a boot
  failure

## Testing Strategy

Vitest over the derivation function for each case in the acceptance criteria,
plus the round-trip parity test between `manifest.ts` and `types.yaml`, plus a
discovery test that a malformed declaration is contained rather than fatal.

## E2E Verification Plan

This issue lands the mechanism; SERVER-085 makes it observable end to end. Verify
here at the unit boundary and through `corpus todos list` if the CLI can already
show a document's status; leave the board-level proof to SERVER-085 and UI-092.

### Verification Steps

1. Restart the server against a real workspace holding a todo document with one
   open item
2. Check the item through the CLI (`corpus todos check …`)
3. Confirm the derivation reports `resolved` at whatever surface this issue
   reaches (CLI output or a direct call), and `open` after unchecking

## E2E Verification Log

_[Agent fills: model run on, the design decision and its evidence, commands,
observed output.]_

## Completion Checklist (domain agent)

- [ ] Design decision recorded with evidence from `items.ts`
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Subtractive check (delete the plugin) still passes
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (cross-domain: kit + plugins + server contract)
- [ ] `/evaluate` passes
- [ ] Committed with `[PLUGINS-016]` prefix
