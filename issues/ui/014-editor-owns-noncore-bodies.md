# [UI-014] Editor ownership of non-core document bodies (plugin fallback + unknown types)

## Domain

ui

## Status

done

## Priority

P2

## Model

opus — a gating change with a spec-clarification rider.

## Dependencies

- Depends on: UI-006, PLUGINS-001
- Blocks: —

## Spec References

- SPEC.md §11 — the always-editable document editor
- SPEC.md §10 — deletion safety: a removed plugin's documents "render as plain markdown"
- issues/evals/PLUGINS-001-eval.md — adjudication request 1 (2026-07-28)
- issues/sprints/sprint-011.md — adjudication "editor owns doc bodies always"

## Summary

Found by the sprint-012 evaluator: `editorHandlesType` has gated on `CORE_DOC_TYPES` since Phase 3,
so a document whose type is not core — including a plugin-owned type without a `View`, and any doc
after its plugin is deleted — renders through the static `MarkdownView`, not the always-editable
`DocEditor`. Sprint-011's adjudication ("the editor owns doc bodies always") and §11's
always-editable principle suggest the editor should own **every** markdown body that no plugin
`View` claims; §10's "renders as plain markdown" concerns the absence of plugin chrome, not
read-only-ness.

Extend the gate: any doc type without a registered plugin `View` renders in the standard editable
document view. A plugin `View` still wins for types that declare one. Includes a one-line §11
clarification (spec-writer, user sign-off at the phase PR) stating the rule.

## Acceptance Criteria

- [x] A doc of an unknown/non-core type renders in the editable editor (autosave, locks) exactly
      like a core note.
- [x] Deleting a plugin flips its typed docs from plugin `View` to the editable editor, not to a
      static render.
- [x] Plugin `View`s still take precedence; `DocPanel` slot unaffected.
- [x] §11 clarification drafted and held for user sign-off.

## Drafted §11 clarification — for spec-writer, held for user sign-off

**Do not apply to SPEC.md from this issue.** One line, for §11's always-editable document view:

> Every document whose body is markdown renders in the editable document view — core type, plugin
> type or a type nothing recognises — unless a plugin registers a `View` for that type, which
> replaces the document view wholesale; a `thread` (whose body is its conversation) and a `view`
> (whose content is its query) are the two exceptions.

Rationale, for the sign-off conversation: §10's "a removed plugin's documents render as plain
markdown" reads naturally as *the plugin's chrome is gone, the markdown is what is left* — not as
*the body becomes read-only*. Read the second way it contradicts §11's "no edit mode" for exactly
the documents a user most needs to repair, and it makes deleting a plugin a partly destructive act.
Sprint-011's adjudication ("the editor owns doc bodies always") is the same reading.

## E2E Verification Log

**Implemented on: opus** (ui-dev, 2026-07-29).

### The change

`editorHandlesType` gated on `CORE_DOC_TYPES` since Phase 3. It now gates on the two types whose
body is not markdown prose: `return !NON_EDITABLE_TYPES.has(type)` (`thread`, `view`). Plugin
precedence is **not** decided there — `DocView` already asked `resolveDocView` first, so the gate
answers about the type alone and there is one place that decides, not two. `MarkdownView` is left
with exactly one document: a `view`. `DocPanel` resolution is untouched.

### Environment

Workspace `/tmp/corpus-s014-uihard-ws` (from-source CLI), workspace server on `9150`, Vite dev
server on `5286`, Chromium via Playwright. Three seeded documents: `doc_657k4jp6` (`note`),
`doc_6jvfnwr4` (`fixture-note` — the `_fixture` plugin owns it and registers a `View`, a `ListItem`
**and** a `DocPanel`), `doc_twe53hyp` (`recipe` — a type nothing in the repo has ever heard of).

### An unknown type gets the editor, and it works

```
recipe (no plugin View): editor present = 1 | data-editable = "true"
                         body = "Prose nobody claims. Fix me."
typed " Edited in a browser." →
  writes: ["POST /api/locks/doc_twe53hyp", "PUT /api/docs/doc_twe53hyp"]
  save chip: "committed · git ✓"
```

The edit lock is taken on the first keystroke and the autosave commits — the same lifecycle a core
`note` gets, which is the criterion. Before the change this document rendered through the static
`MarkdownView`: readable, and impossible to correct.

### A plugin `View` still wins

```
fixture-note (plugin installed): editor present = 0
  body = "…Fixture panel — 23 characters | Rendered by the _fixture plugin — A plugin note"
```

The plugin owns the whole body surface; no editor is mounted underneath it, and the `DocPanel` still
renders above it.

### Deleting the plugin flips its documents to the editor

`plugins/_fixture/` copied to `/tmp/corpus-s014-uihard-fixture-backup`, then removed; Vite restarted
(`--force`) so the discovery glob is re-evaluated; browser reloaded. Same document:

```
=== UI-014 · plugin DELETED ===
plugin column body : "Fixture sample PLUGIN — … Plugin missing · This column renders _fixture's
                      sample view, which is not installed. Restore the plugin to bring the c…"
row markup         : "FIXTURE-NOTE A plugin note The body a plugin owns. inbox/ just now"   ← the kit Row
editor present     : 1 | data-editable = "true"
plugin View rendered: false
DocPanel rendered   : false
body text          : "fixture-note inbox/ open updated 2026-07-29 edit The body a plugin owns."
typing into it wrote: ["/api/docs/doc_6jvfnwr4"]
save chip           : "committed · git ✓"
```

The document is **editable**, not a static render, and the edit committed. §15 M6's "renders as
plain markdown" is satisfied — the body shown is plain markdown, with the plugin's chrome gone.

### …and restoring it flips them back

The directory was restored from the backup and Vite restarted:

```
=== UI-014 · plugin RESTORED ===
plugin column body : "Fixture sample PLUGIN — … Fixture sample — 1 note A plugin note"
row markup         : "▣ A plugin note"          ← the plugin ListItem again
editor present     : 0
plugin View rendered: true
DocPanel rendered   : true
body text          : "… Fixture panel — 39 characters | Rendered by the _fixture plugin — A plugin
                      note | The body a plugin owns. Fixed by hand."
```

The edit made while the plugin was absent survived (the panel's character count moved 23 → 39), and
the tree is back exactly as it was — `plugins/_fixture/` restored, verified present.

### Tests

- `apps/ui/src/editor/DocEditor.test.tsx` — the gate: core types, the two exceptions, and "every
  other markdown body, core or not" (`todo`, `_fixture-note`, an invented type).
- New `apps/ui/src/reader/DocView.test.tsx` — the branch order through the **real reader**: unknown
  type → editor; plugin type with a registered `View` → the `View`, no editor; the same document
  with the registry emptied → the editor, editable, with the plugin's text gone; a `view` document →
  the static render, no editor. Asserted through `Reader` rather than by calling the gate, because
  the finding was that the gate and its call site disagreed.
- Scoped run `apps/ui packages/kit` → **119 files, 1773 tests, all passing**; build, typecheck,
  lint and prettier clean.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
