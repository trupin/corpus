# [UI-150] Delete the UI's plugin registry, slot dispatch and plugin columns

## Domain
ui

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SHARED-064 (signed and applied)

## Spec References
- SPEC.md — §10, §12 and §13 are deleted; the plugin concept is gone from §1, §3, §4, §5, §7, §9 and §12

## Summary

Part of Phase 41. The plugin surface and the todos plugin are removed entirely,
on the user's instruction: *"I want it fully gone, no trace of it in the codebase
or the specs."* `todo` is not a document type.

The full inventory for this area is in the orchestrator's brief to the
implementing agent. Two rules bind every part of this phase:

1. **A document carrying an unrecognised `type:` must still open, render with
   working checkboxes, search, and pass `doc check`.** That is SPEC §12's M6, and
   it is what protects the user's existing `type: todo` documents.
2. **Where a rule existed only because a plugin might, delete it. Where it
   survives its cause, keep it and restate the reason.** A docblock explaining a
   constraint by a plugin that no longer exists is worse than no docblock.

## Acceptance Criteria
- [x] No reference to plugins or todos remains in this area
- [x] Rules that outlive their plugin justification are kept and restated
- [x] Nothing that only existed for plugins is left behind as a stub

## E2E Verification Log

**Model: opus (claude-opus-5, 1M context).** 2026-08-22, branch
`phase-41-remove-plugins`.

### The M6 evidence

`apps/ui/e2e/unknown-type.spec.ts` is new, and it is the only thing left
asserting SPEC.md §12's M6 — every spec that used to (`todos.spec.ts`,
`todos-legacy.spec.ts`, `derived-status.spec.ts`, `derived-due.spec.ts`) was
deleted with the plugin. Seven cases against the shipped board in Chromium, with
a `type: todo` document beside a note:

1. it opens in the ordinary document view, with `[data-doc-editor]` and a live
   `contenteditable`, and no "unsupported" surface of any kind;
2. its markdown renders — two `ul[data-type="taskList"] > li`, each with a real
   `input[type=checkbox]`, and the paragraph above them still a paragraph;
3. ticking the first box lands `- [x] Call the plumber about the boiler` in the
   stored file, with the item beside it untouched;
4. searching `plumber` returns its hit, and the hit opens the same reader;
5. a selection in its body takes a comment: one `POST /api/threads` with
   `parent: doc_todo` and the selected words as `selector.exact`, and the anchor
   comes back drawn on the body;
6. its `status` and `due` are live controls with no `<output>` statement, and a
   status change reaches the wire;
7. its row's context menu is **item for item** the note's, `resolve` included.

### Falsification (both directions, in a real browser)

- Added `"todo"` to `NON_EDITABLE_TYPES` in `DocEditor.tsx` → **6 of 7 failed**
  (the reader never rendered an editor). Reverted.
- Made `statusLock` return a reason for `type: todo` → **2 of 7 failed** (the
  frontmatter controls and the row action set). Reverted.

So the spec is measuring the rule, not passing vacuously.

### Gates

- `tsc --noEmit -p apps/ui/tsconfig.json` — clean (from 5 errors at UI-149).
- `eslint apps/ui/src apps/ui/e2e packages/kit/src` — 0 errors, 0 warnings.
- `prettier --check` — clean.
- `vitest run apps/ui/src packages/kit/src` — **210 files, 4231 tests, all pass.**
- `npm run build -w packages/kit` before the kit tests, because a source-only
  change to `packages/kit` cannot falsify anything through the `exports` map.
- `playwright test --workers=1`, `CORPUS_UI_PORT=5273` — **487 passed, 0 failed**
  (556 s). Run twice: the first run failed one case, which was my own
  replacement for the deleted plugin-warning truncation test aimed at the wrong
  element; re-pointed at `.c-status` and green.

### One test replaced rather than deleted, and why

`console-strip-geometry.spec.ts`'s *"a truncated value keeps the whole of itself
in reach"* was written against `.c-plugin-warn`, which was the strip's only
unbounded string. The **rule** (§10's rider clause 2 — revealed, not
accommodated) outlives the warning, so the case now drives a 39-character
version through `GET /api/health` and asserts `.c-status` truncates on screen,
carries the whole string in `title`, and does not make the strip clip.
