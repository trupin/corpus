# [UI-184] Styled text renders, in both themes, through four named roles

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-094, UI-182, UI-183
- Blocks: UI-101

## Spec References

- SPEC.md §5 — "Colours are **named roles from the style map**, never raw hex in
  the body — the roles are `accent`, `warning`, `positive` and `muted`, each
  with a light and a dark value, so a document that says `color="warning"`
  renders correctly in both and can be re-themed without touching any body."
- SPEC.md §10 — `MarkdownView` is the read surface for every markdown body

## Summary

Every read surface in the product renders through `MarkdownView` — the column
reader, focus mode, thread turns, the compose preview. This issue makes the four
styling forms render there, and defines the four colour roles in light and dark
so `color="warning"` is legible in both.

**The style document is out of scope for this release.** §5's third bullet gives
the roles a home in a `type: style` document. Until that exists the four roles
are the workspace default, defined once as CSS custom properties beside the
existing theme tokens. A body that says `color="warning"` is then correct for
both themes today and re-themable later without touching any body — which is
exactly what §5 asks the *body* to guarantee.

## Acceptance Criteria

- [ ] Underline, highlight and attribute spans render in `MarkdownView`
- [ ] Styled blocks render with their alignment and indentation
- [ ] Each of the four roles has a light value and a dark value, and both pass
      a legibility check against their surface
- [ ] `highlight="warning"` and `color="warning"` are distinguishable — one
      paints the background, the other the text
- [ ] Bare `==x==` uses a default role, so a highlight with no colour named
      still shows
- [ ] No raw-HTML path is opened: a `<script>`, an `<img onerror=…>` or any tag
      other than `<u>` still renders as inert text (the existing test that
      asserts this must still pass, unchanged)
- [ ] The editor and the reader draw a styled run the same way

## Technical Design

### Files to Create/Modify

- `packages/kit/src/markdown/MarkdownView.tsx` — add the plugin to the pipeline
- `packages/kit/src/markdown/markdown.css` — the role tokens and the four forms
- `apps/ui/src/editor/editor.css` — the same rules for the editable surface
- `packages/kit/src/markdown/MarkdownView.test.tsx` — rendering and the
  no-raw-HTML assertions

### The roles

Four tokens, each with a light and a dark value, defined beside the existing
theme variables and named for the role rather than the colour:

```css
--style-accent, --style-warning, --style-positive, --style-muted
```

and a background variant per role for `highlight`. `muted` is the one that must
be checked hardest: a muted role that reads as "disabled" in dark is a body the
reader cannot see.

Colour values follow `design/index.html`, which is authoritative for look and
feel. Where it has no token for a role, the new one is added there in the same
change so the mockup and the app do not diverge.

### Why this is not a raw-HTML path

`remarkCorpusStyling` produces the `<u>` element from a node it recognised, not
from raw markup passed through. `rehype-raw` stays absent and
`MarkdownView`'s docblock keeps its guarantee. The docblock is amended to name
the second qualified token — `<u>`, beside `<br>` in a table cell (UI-064) —
so the component's prose does not become one of the things the product says
that are not so.

### Edge Cases

- A styling marker in a **thread turn** renders like one in a document: turns go
  through the same component.
- A styling marker inside a code fence renders literally — the plugin never sees
  it, because the grammar is fence-aware.
- A `highlight` role and a `color` role on one span compose: background and
  foreground.

## Testing Strategy

- `MarkdownView.test.tsx`: each form renders the expected element and class
- The existing raw-HTML assertions re-run unchanged
- A contrast assertion per role, both themes, computed rather than eyeballed
- The compose preview and a thread turn render a styled body

**Falsification.** Delete the dark-theme block and watch the contrast assertions
go red. A test that reads the light value in both themes proves nothing.

## E2E Verification Plan

1. Start the real app with a document carrying all four forms
2. Read it in a column, then in focus mode, then quote it into a thread
3. Switch the theme and confirm all four roles stay legible
4. Confirm a `<script>` tag in the same body still renders as text

## E2E Verification Log

### Post-Implementation Verification

_[filled by the implementer]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified
