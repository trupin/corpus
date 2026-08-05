# [UI-065] A long document title is cut off instead of wrapping

## Domain
ui

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- `design/index.html` is authoritative for look and feel
- SPEC.md §11 Document view

## Summary
Live report 2026-08-04: _"Document's title can only show on one line, meaning it
is cut when too long. I want it to be wrapped."_

The title is the document's name and the thing a reader orients by; truncating it
hides exactly the distinguishing tail when several documents share a prefix
(`Catch-Up Report — 2026-08-03` and `Catch-Up Report — 2026-08-04` differ only at
the end). Let it wrap.

## Acceptance Criteria
- [x] A long title wraps to as many lines as it needs, in the reader and in
      focus mode
- [x] Nothing below it is overlapped or pushed off — the surrounding layout
      reflows rather than colliding
- [x] It stays editable: the title is an input surface, so wrapping must not
      break typing, caret placement, or selection in it
- [x] Short titles are visually unchanged
- [x] Check the same treatment in the places a title is *deliberately* one line —
      board rows and column headers, where truncation is the right answer because
      the row is a fixed-height list item. State which surfaces wrap and which
      truncate, so the difference is intentional rather than incidental
- [x] Consistent with `design/index.html`; if the mockup shows one line, say so
      and treat this as a deliberate departure

## Technical Design
### Files to Create/Modify
- The reader's title element and its CSS (likely `apps/ui/src/reader/`), plus
  focus mode
- `design/index.html` if the mockup should follow

## Testing Strategy
Component test with a long title asserting the rendered height grows and no text
is clipped; visual check in the real app at a narrow column width.

## E2E Verification Log
Model: **opus** (claude-opus-5, 1M context). 2026-08-04.

### Cause
`.doc-title` was an `<input>` (`FrontmatterForm.tsx:286`). An input is
single-line **by construction** — no CSS can make one wrap — so a long title
scrolled horizontally inside it and the tail simply left the viewport. The CSS
had already asked for the right thing (`text-wrap: balance`, no `nowrap`, no
`text-overflow`); the element could not deliver it.

### What the mockup says
`design/index.html:268` draws the title as an `h1` with `text-wrap: balance` and
**no** truncation, and its editable variant (line 1093) is
`<h1 class="doc-title" contenteditable="true">`. So wrapping is the mockup's own
answer and this is **not** a departure — what shipped was an input substituted
for the mockup's heading, which silently changed the behaviour.

### Fix
`<input>` → `<textarea rows={1}>`, plus `apps/ui/src/reader/useTitleFit.ts`,
which sets `style.height` from `scrollHeight` on every value change and on a
`ResizeObserver` over the **parent** (the observer never watches the field it
resizes, or every fit would re-enter). `Reader.css` adds `resize: none`,
`overflow: hidden`, `line-height: 1.25` and `overflow-wrap: anywhere`.

Editability is untouched, which is the criterion easiest to break: `useTitleFit`
only ever writes `style.height` — never the value, never the selection. `↵`
still `preventDefault`s and saves, so **no newline can reach the value** and one
row stays the floor; `Escape` still reverts a draft; `field.focus()` /
`field.select()` after creation still work (a textarea implements both), which
`Board.test.tsx` pins by asserting `selectionStart === 0` and
`selectionEnd === value.length` on the freshly created document.

### Which surfaces wrap, and which truncate — stated on purpose
| Surface | Element | Behaviour |
| --- | --- | --- |
| Column reader title | `.doc-title` (`Reader.css`) | **wraps**, height measured |
| Focus mode title | `.focus .doc-title` (`FocusMode.css`) | **wraps** — same element, 30px/66ch |
| Column header | `.col-title` (`Column.css:106`) | truncates (`nowrap` + ellipsis) |
| Board row | `.row-title` (`@corpus/kit/row.css:56`) | truncates (`nowrap` + ellipsis) |

The difference is the shape of the box, not an oversight, and it is now written
in `Reader.css` beside the rule that makes the reader wrap: a title in the
reader **is** the document and has a whole column to spend; a title in a
fixed-height list item is a label, and a wrapping one would make rows jump
between heights and cost the list its scannability. Both truncating rules
already carried comments saying so; neither was changed.

### Reproduction, then fix, in a real browser
`apps/ui/e2e/render-fixes.spec.ts`, Chromium, `CORPUS_UI_PORT=5993`. Fixture:
`"Catch-Up Report — mortgage, insurance and the quarterly portfolio review —
2026-08-04"` (84 chars) opened in a column reader.

Pre-fix (reverted to `<input>` with the hook removed, rebuilt):

```
✘ wraps to the lines it needs, with nothing scrolled out of view
    title height   Expected: > 37.5   Received: 25
    → one line of a 25px box; everything past it scrolled out of the field
```

Post-fix: **8 passed**. Measured on the live element:
- height > 1.5 × its own `line-height` — it occupies the lines it needs;
- `scrollHeight ≤ clientHeight + 1` — the box holds all of them, nothing is cut;
- `.doc-editor`'s top ≥ the title's bottom — the body reflowed below it rather
  than colliding;
- the board row for the same document still computes `white-space: nowrap`,
  non-`visible` overflow, and a box under 1.5 lines tall — the deliberate
  truncation is pinned as such.

Short titles are visually unchanged: the measured height for a one-line title is
one line, and the type (serif, 24px / 20px in a column / 30px in focus) is
untouched.

### Unit coverage
`apps/ui/src/reader/useTitleFit.test.tsx` (6 tests): the height is the content
height; the previous height is released **before** measuring, so a title can
shrink as well as grow; a tree with no layout (`scrollHeight === 0`) keeps its
intrinsic height rather than collapsing to `0px`; the hook fits on mount and on
every value change; a `ResizeObserver` notification refits and `disconnect`
happens on unmount; an environment without `ResizeObserver` does not throw.

### Gates
`vitest packages/kit/src` 657 passed · `vitest apps/ui/src` 2052 passed ·
`eslint --max-warnings 0` clean · `prettier --check` clean · `tsc --noEmit`
clean in both workspaces · Playwright `render-fixes` 8 passed, plus
`reader/editor/related/turn-breaks/fences/board/column-width` 47 passed —
`related.spec.ts` reads the title with `toHaveValue`, which still holds for a
textarea.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
