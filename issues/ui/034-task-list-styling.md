# [UI-034] Task-list items render unstyled: stray bullet, checkbox stacked above its text

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: PLUGINS-005
- Blocks: —

## Spec References
- SPEC.md §11 reader/editor rendering; §12 todos body checkboxes

## Summary
Live dogfood report (2026-08-02, v0.1.0, post-migration): a todo document's
task-list items render with the list bullet still visible AND the checkbox on
its own line above the item text. The editor's markdown schema fully supports
task lists (parse/serialize/roundtrip tested) but apps/ui ships no CSS for the
task-list node structure at all — the raw TipTap markup renders with browser
defaults: the `ul` keeps `list-style`, and the item's label/content boxes stack
instead of sitting inline. Functionality is intact (toggle works, e2e-proven);
presentation is broken for every task list, todos or otherwise.

## Acceptance Criteria
- [x] Task-list items show no list bullet
- [x] Checkbox sits inline with the first line of the item text, baseline-aligned,
      with wrapped lines indenting under the text (not under the checkbox)
- [x] Done items keep any existing done treatment; spacing consistent with
      ordinary list items in the same document
- [x] Applies identically in the column reader, full-screen focus, and while
      editing
- [x] Ordinary bulleted/numbered lists are visually unchanged

## Technical Design
### Files to Create/Modify
- The editor/reader stylesheet that owns list rendering (colocate with the
  existing document-body styles — likely `apps/ui/src/reader/Reader.css` or the
  editor's own css; match where sibling node styles live)
- Selector target: the task-list/task-item node structure emitted by
  `apps/ui/src/editor/markdown/schema.ts`

## Testing Strategy
E2E visual assertions in apps/ui/e2e/todos.spec.ts: no `list-style` marker on
task items; checkbox and text share a line box.

## E2E Verification Plan
Real app: multi-item todo doc with long wrapping items; verify alignment in
reader + focus + edit mode.

## E2E Verification Log

**Model: Opus 5 (1M context)** — ui-dev, 2026-08-02, branch `dogfood-todos-polish`.

### 1. The DOM was measured, not guessed

The issue's Technical Design named `li[data-type="taskItem"]` as the selector
target. **It matches nothing on screen.** Two dumps of the real markup:

- `DOMSerializer` over `corpusSchema()` (jsdom, scratch vitest) — what
  `renderHTML` would serialise:
  `<li data-checked="false" data-type="taskItem">…`
- The **live editor** in Chromium (scratch Playwright spec,
  `.reader .ProseMirror` innerHTML) — what TipTap's node view actually builds:
  `<li data-checked="false"><label contenteditable="false"><input aria-label="Task item checkbox for …" type="checkbox"><span></span></label><div><p>…</p></div></li>`

  The node view drops `data-type` from the item; only the list keeps it
  (`<ul data-type="taskList">`). So the item is addressable only through its
  list — `ul[data-type="taskList"] > li`. Writing the CSS against the
  serialiser's shape would have shipped a stylesheet that changed nothing, which
  is why the rules and the spec both key off the measured shape.

`MarkdownView` (react-markdown + remark-gfm) was dumped the same way and emits a
third shape: `ul.contains-task-list > li.task-list-item > input[type=checkbox]`
followed by a **bare text node**. Both are styled; both are asserted.

### 2. Reproduction (pre-fix state, in the real browser)

Real Vite dev server on `:5273`, real board, todo document opened in its column
reader. Screenshot with every UI-034 rule neutralised via `addStyleTag`
(`list-style: disc`, `padding-left: 22px`, `display: list-item`):
a `•` marker on every task item, and the checkbox alone on a line **above** its
text — exactly the dogfood report. `/tmp/ui034-unfixed.png`.

### 3. After the fix — three surfaces, real browser

| Surface | Evidence |
| --- | --- |
| Column reader | `/tmp/ui034-fixed.png` — no marker, checkbox on the first text line, the long item's second line indented under the text |
| Full-screen focus (`[data-expand]`) | `/tmp/ui034-focus.png` — same relations at the wider 66ch measure, item wrapping at a different word |
| `MarkdownView` shape | `/tmp/ui034-md.png` — real `mdast-util-to-hast` markup mounted into the live page |

Editing is the reader (SPEC.md §11: no edit mode) — the screenshotted surface
*is* the contenteditable, so "identical while editing" is the same evidence.

Measured numbers off the live column reader (`getBoundingClientRect` /
`Range.getClientRects`), 15px serif at line-height 1.62:

```
checkbox        x=33   y=331.95  w=13  h=13   (bottom 344.95)
text line 1     x=54   y=329     h=21
text line 2     x=54   y=353     h=21
text line 3     x=54   y=378     h=21
content div     x=54   (= 33 + 13 + 8 gap)
```

- Marker: `getComputedStyle(ul).listStyleType === "none"`; the ordinary `ul` two
  blocks below still computes `"disc"`.
- Inline: the checkbox's vertical span (331.95–344.95) sits inside line 1's
  (329–350), and its right edge (46) is left of the text (54). Baseline: the box
  bottom lands within a pixel of the first line's baseline (≈345).
- Wrapped lines: lines 2 and 3 start at **54**, identical to line 1 and well
  right of the checkbox — under the text, not under the box.
- Left edge: task text at 54, ordinary list text at 33 + 22 = 55. One pixel
  apart, so a document mixing both lists reads as one margin.

### 4. Two defects found and fixed by measuring rather than by reasoning

1. `flex-wrap: wrap` (added to let a nested list under a react-markdown task
   item take its own row) **broke the primary case**: the item's text is an
   anonymous flex item, which no selector can give `min-width: 0`, so with
   wrapping enabled it refused to shrink and fell onto its own line — recreating
   defect (b). Caught by the probe failing at 746 vs 737. That shape now uses a
   hanging indent (`padding-left: 21px` / `text-indent: -21px`) instead, which
   needs no box and leaves nested blocks alone.
2. Task items were spaced ~24px apart against ~8px for the plain list under
   them: the content `div` is a flex item, so the paragraph's 10px margins are
   trapped instead of collapsing through the `li`. Trimmed the first/last child
   and gave the item the same 10px, verified by re-screenshot.

### 5. Checks

- `apps/ui` e2e, scoped: `CORPUS_UI_PORT=5273 playwright test e2e/todos.spec.ts`
  → **10 passed** (3 new + the 7 pre-existing, including the toggle and
  comment-anchor tests — `user-select: none` on the checkbox label did not
  disturb either).
- Regression sweep on the specs that probe `.doc-body`:
  `playwright test e2e/reader.spec.ts e2e/editor.spec.ts` → **16 passed**.
- Unit, scoped: `vitest run apps/ui/src packages/kit/src` → **141 files, 2138
  tests passed**.
- `tsc --noEmit` in `apps/ui` → clean. `eslint` + `prettier --check` on the two
  touched files → clean.

### Out of scope, deliberately

Done items get no strike-through or dimming. AC 3 says done items *keep* any
existing treatment; there is none in a document body today (the mockup's
`.check.done` belonged to the todos plugin's `View`, which PLUGINS-006 deleted).
Inventing one here would be a design decision this issue does not carry.

## PR #19 review follow-up (2026-08-03)

**Model: Opus 5 (`claude-opus-5[1m]`).** Agent: ui-dev.

The reviewer's judgment call: this issue's CSS landed in `packages/kit/src/markdown/
markdown.css`, where sprint-023's Out of Scope note had put it in `apps/ui` — and the
TipTap-shaped half (`ul[data-type="taskList"] > li > label …`) is markup **no kit consumer
can emit**: the kit carries no TipTap and no editor, and `MarkdownView` produces the other
shape.

**Decision: split, not keep.** The react-markdown shape (`ul.contains-task-list >
li.task-list-item`) stays in the kit — that *is* what the kit renders, so a plugin
importing `@corpus/kit/markdown.css` needs it. The TipTap node-view shape moved to
`apps/ui/src/editor/editor.css`, beside the editor that builds it. Both files state the
shared measurements (13px box, 8px gap, text at 21px) and say in so many words that
changing one is changing both — §11's "there is no edit mode" is a visual promise, and the
two renderers must draw one document the same way.

Verified in a real browser, both shapes, unchanged: Playwright `todos.spec.ts` →
**10 passed** on `CORPUS_UI_PORT=5974`, including the geometry test that measures the
editor's task item (marker, box size, hanging indent, wrap column) and the probe test that
mounts react-markdown's real output into the real page and measures it against the real
stylesheet.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
