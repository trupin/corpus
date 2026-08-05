# [UI-059] Links in rendered bodies are unstyled, and long URLs overflow the measure

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- `design/index.html` is authoritative for look and feel
- SPEC.md §11 Thread view / Document view

## Summary
Live report 2026-08-03, with a screenshot: a pasted Google Docs URL in a thread
turn renders as a browser-default blue underlined link that **runs past the right
edge of the card** and breaks mid-token across two lines, with the second line
clipped.

**Cause, verified:** `packages/kit/src/markdown/markdown.css` has **no rule for
links in rendered bodies at all** — no `.doc-body a`. So:

1. **Styling** is the user-agent default (blue `#0000EE`, plain underline), which
   is not the app's link treatment. Note the file *does* style other inline
   things deliberately (`text-decoration: none` for refs at :251, strikethrough
   for done task items at :268), so links were simply missed rather than left
   default on purpose.
2. **Overflow** — a URL has no spaces to break at, and nothing sets
   `overflow-wrap` for body text. UI-050 has just added `overflow-wrap: anywhere`
   to `.doc-body pre` for exactly this reason inside fences; the same
   consideration was never applied to prose. The reading measure is `62ch`
   (`.doc-body`), so any URL longer than that overflows its container.

The fence half of this problem is already solved in the same file; this is the
prose half.

## Acceptance Criteria
- [x] Links in rendered bodies use the app's link treatment, taken from
      `design/index.html` rather than invented here — state what the mockup says
- [x] A URL longer than the measure wraps inside its container; nothing is
      clipped or painted outside the card, at any column width
- [x] Wrapping breaks the URL only where it would otherwise overflow — ordinary
      prose and ordinary short links break between words as before
- [x] Applies in every rendered surface — reader, thread turns, focus mode,
      plugin bodies — since all render through `MarkdownView`
- [x] `[[ref]]` links keep their existing distinct treatment (`text-decoration:
      none` at markdown.css:251) and are not swept into the new rule
- [x] The editor's rendering of links stays consistent with the read view — check
      both, since the document body renders through TipTap, not `MarkdownView`
- [x] Visited/hover/focus states are deliberate, and focus is visible for
      keyboard users
- [x] A test pins the overflow behavior with a long URL fixture

## Technical Design
### Files to Create/Modify
- `packages/kit/src/markdown/markdown.css` (the link rule)
- possibly `apps/ui/src/editor/editor.css` for parity in the editor
- tests

### Notes
- UI-050 landed `white-space: pre-wrap; overflow-wrap: anywhere` on `.doc-body
  pre` in this same file, with a docblock explaining the reasoning for fences.
  Read it first — the prose rule should be consistent with it and should not
  restate the argument.

## Testing Strategy
Component test with a long-URL fixture asserting the rendered box does not exceed
its container. Visual check against `design/index.html`.

## E2E Verification Log
Model: **opus** (claude-opus-5, 1M context). 2026-08-04.

### What `design/index.html` specifies — and what it does not
Read line by line. The mockup states **no rule for an ordinary link at all**:
every `<a>` in it is a `[[ref]]` or a button-like control, and its global reset
styles `button` but never `a`. The one link treatment it does state is `.ref`
(line 274):

```css
.ref { color: var(--accent-ink); text-decoration: none; border-bottom: 1px solid var(--accent-wash); cursor: pointer; }
.ref:hover { border-bottom-color: var(--accent); }
```

So the mockup gives a **vocabulary** rather than an answer: accent ink for a
link, a quiet line under it, that line confirming on hover. It also makes one
decision explicitly — it *removes* the underline from refs. That removal is
what this issue takes as the distinction to preserve, so the external-link rule
is the mirror of it: accent ink **with** a real underline. A ref opens a
document in this corpus and is not underlined; a link leaves the app and is, and
the reader can tell which before clicking. The `:not(.ref)` in the selector is
what keeps that mechanical rather than a convention someone has to remember.

`:visited` is deliberately not styled (a body is not a browsing history, and the
UA purple is not in the palette). `:focus-visible` restates `global.css`'s one
focus treatment, which covers `button`, `input` and `[tabindex]` but not `a`.

### The overflow half
`overflow-wrap: anywhere` on `.doc-body`, matching the value UI-050 already put
on `.doc-body pre` in the same file — the comment points at that rule rather
than restating its argument. Declared on `.doc-body` rather than per element so
it reaches paragraphs, list items, table cells, headings and the links inside
them in one place.

### Editor parity
No `editor.css` change was needed and none was made: `DocEditor` puts
`class="doc-body"` on its contenteditable (`DocEditor.tsx:207`), so the read
surface and the write surface get the identical link rule from one declaration —
which is what "there is no edit mode" means for links as well as for type.
Verified in the browser: the rule's computed value is the same on both.

### Reproduction, then fix, in a real browser
`apps/ui/e2e/render-fixes.spec.ts`, Chromium, `CORPUS_UI_PORT=5993`. Fixture: a
104-character Google Docs URL in an agent turn, rendered in a column reader.

Pre-fix (rule reverted to `color: unset`, `overflow-wrap` removed, rebuilt):

```
✘ a URL longer than the measure wraps inside its card
    .reader .turn-markdown  scrollWidth 688  vs  clientWidth 456
    → 232px of the URL painted outside the card
```

Post-fix: **8 passed**. `scrollWidth ≤ clientWidth`, the link's right edge is
inside the `.thread-card`'s right edge, and the link's box is more than 1.5 line
heights tall — i.e. it **wrapped** rather than merely being clipped.

### What is pinned
- `render-fixes.spec.ts` → the long-URL fixture: nothing scrolled away, nothing
  painted past the card, and the anchor occupies more than one line.
- `render-fixes.spec.ts` → the treatment: computed `text-decoration-line` is
  `underline` and computed `color` equals the resolved `--accent-ink` token
  (compared through a probe element, so it is colour-space-for-colour-space) and
  is **not** `rgb(0, 0, 238)`.
- `render-fixes.spec.ts` → `.ref` inside `.doc-body` still computes
  `text-decoration-line: none`, so refs are not swept into the new rule.
- Applies on every surface by construction: all six hosts (column reader, focus
  mode, thread turns ×3, plugin bodies) pass `doc-body` to `MarkdownView`, and
  the editor carries the same class.

### Gates
`vitest packages/kit/src` 657 passed · `vitest apps/ui/src` 2052 passed ·
`eslint --max-warnings 0` clean · `prettier --check` clean · `tsc --noEmit`
clean in both workspaces · Playwright `render-fixes` 8 passed, and
`reader/editor/related/turn-breaks/fences/board/column-width` 47 passed — the
measure-and-typography specs that would have caught a `.doc-body` regression.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
