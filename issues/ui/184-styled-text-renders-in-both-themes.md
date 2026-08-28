# [UI-184] Styled text renders, in both themes, through four named roles

## Domain

ui

## Status

done

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

Implemented on: **opus**.

**Unit.** `tokens.test.ts` 87 passed, `MarkdownView.test.tsx` 23 passed, the
whole kit markdown suite 174 passed.

**The roles are measured, not looked at.** Sixteen assertions compute WCAG
contrast: each of the four roles against the page background, in both themes,
and `--ink` against each highlight wash **composited over the background** — a
wash measured on its own would say nothing about the words on it.

That measurement changed a value. `--style-warning` is **not** `--signal`:
the product's rust measures **4.08:1** on the light background, which is fine
behind a chip's bolder label and short of AA for a sentence. The light role is
darkened to `#a34620` (**5.63:1**); the dark role is `--signal` unchanged
(**5.84:1**).

**Falsification, three token breaks.**

| Break | Result |
| --- | --- |
| Light `--style-warning` set back to `--signal` | 2 failed |
| Dark `--style-accent` copied from the light value | 3 failed |
| A highlight wash made opaque | 2 failed |

**Browser, real page, real computed styles** —
`apps/ui/e2e/styled-text.spec.ts`, **5 passed**:

```
✓ each form is visibly different from the prose around it
✓ a styled block is laid out, and its prose stays prose
✓ the fence lines are not visible as text
✓ each role answers the theme
✓ typing in one paragraph saves every marker in the others unchanged
```

Every assertion reads a **computed style** or an **outgoing request body**. A
class name being present says only that the markup was written — it says nothing
about whether the phrase looks different from the prose around it, which was the
entire question. So the highlight is asserted against the editor's own
background, the two colour roles against each other and against the body ink,
and the theme by reading one role's colour under `data-theme="light"` and again
under `"dark"`.

**Falsification in the browser too**, because CSS is exactly where a passing
assertion can be vacuous:

| Break | Result |
| --- | --- |
| The highlight paints `transparent` | 1 failed — the visibility test |
| `align-center` set to `text-align: left` | 1 failed — the layout test |

**The last spec is the arc's real proof.** It opens the document in a real
browser, types into the *plain* paragraph, waits for the autosave `PUT`, and
reads the saved body back: every marker in the other paragraphs is byte-intact,
the fence lines are still there, and the typed words landed. That is UI-182's
and UI-183's round trip through a live editor rather than through a string.

**Out of scope, and named**: §5's style document. The four roles ship as the
workspace default in `tokens.css`, ported verbatim from `design/index.html` and
checked by the existing parity test, so a body that says `color="warning"` is
correct in both themes today and re-themable later without touching any body.

**One call recorded**: a bare `==highlight==` names no role, and rather than
invent a fifth colour outside the palette — the obvious candidate, a highlighter
yellow, is one shade from `--sepia`, which is the dedicated staleness axis and is
never reused — the default *is* a role. `==x==` and `[x]{highlight="accent"}`
paint the same, and one of them is shorter to type.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified
