# [SHARED-034] Full-screen editing has no persistent formatting toolbar

## Domain

shared (orchestrator-handled — SPEC.md rider, needs user sign-off)

## Status

todo — **DRAFTED, awaiting sign-off**

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Blocks: UI-101

## Spec References

- SPEC.md §11 — "**Document view — always editable, Google-Docs-like.** There is
  no edit mode … Markdown shortcuts apply as you type … **the editor serializes
  to clean markdown**"
- SPEC.md §11 — "**Commenting**: selecting text pops a floating toolbar
  (formatting + **Comment**)"
- SPEC.md §11 — focus mode: "a full-viewport reading/editing surface with margin
  threads"
- `design/index.html` — authoritative for look & feel

## Summary

The user asked (2026-08-08) for full-screen document editing to carry a
persistent formatting toolbar like Google Docs', citing that product's toolbar
directly. Today the only formatting surface is the **selection** toolbar
(`apps/ui/src/editor/SelectionToolbar.tsx`), which appears on selection and
vanishes — so formatting is discoverable only by people who already know it is
there, and applying a heading means selecting text first.

§11 already calls the document view "Google-Docs-like" and already has a floating
toolbar; it has never said whether a **persistent** one exists. This rider settles
that.

## The constraint that shapes the whole thing

**§11 requires the editor to serialize to clean markdown.** Roughly half the
controls on the Google Docs toolbar have no markdown representation, and putting
them on screen would promise formatting the file cannot hold. From the reference
screenshot, sorted against what `apps/ui/src/editor/markdown/schema.ts` actually
supports:

**Expressible** — bold, italic, strikethrough, inline code, heading level, link,
image, bulleted list, numbered list, checklist (`TaskList`), blockquote, code
block, table, horizontal rule, clear formatting, undo/redo.

**Not expressible in clean markdown** — font family, font size, text colour,
highlight colour, text alignment, line spacing, paragraph indent, page zoom,
**underline** (markdown has none, and StarterKit ships no `Underline` for exactly
that reason).

A toolbar that offered the second group would either write HTML into the document
— ending "clean markdown" and breaking the agent's ability to read and rewrite
files as prose — or silently do nothing. Both are worse than not offering them.

## Drafted rider text

To be added to §11's document-view paragraph:

> **A persistent formatting toolbar in focus mode.** The full-viewport surface
> carries a formatting toolbar that is always present, above the document — the
> familiar shape of a document editor, and the answer to formatting being
> discoverable today only by selecting text first. It acts on the selection, or
> on the block the cursor is in where the control is a block control, and it
> **reports state**: the heading control names the current block's level, and an
> active mark shows as active, so the toolbar says what the text already is and
> not only what could be done to it. The selection toolbar stays exactly as it is
> — it carries **Comment**, which is not formatting and belongs where the
> selection is (§6) — and the two never disagree, because both act on one
> document through one editor.
>
> **It offers what markdown can hold, and nothing else.** The editor serializes
> to clean markdown, so the toolbar's contents are bounded by what round-trips
> through it: emphasis, headings, lists including task lists, quotes, code, links,
> images, tables, rules. Font family, font size, colour, highlight, alignment,
> line spacing and paragraph indent are **deliberately absent** — a control that
> wrote formatting the file cannot carry would either put HTML in a markdown
> document, ending the guarantee that every document is prose the agent can read
> and rewrite, or do nothing at all while appearing to work. This is a bound on
> the toolbar, not a limitation to be worked around later: the file format is the
> product.
>
> **Column readers keep the floating toolbar alone.** A persistent bar costs
> vertical space that a column cannot spare, and the column reader is the
> narrow surface; focus mode is where a document is edited at length and where the
> bar earns its room.

## Open questions for the sign-off conversation

1. **Underline.** It is on the reference toolbar and has no markdown form. Absent
   entirely (drafted), or mapped to something else? Mapping it to emphasis would
   be a lie about what the file holds.
2. **Column readers** — the drafted text excludes them. Confirm, since the
   request said "full screen" but the frustration (formatting hidden behind a
   selection) applies in both.
3. **Undo/redo as toolbar buttons** — the editor has history and `⌘Z` works.
   Buttons are discoverability, not capability; worth their space or not?
4. **Does this belong in `design/index.html` first?** It is authoritative for look
   and feel, and a new persistent chrome element is exactly the kind of thing it
   exists to settle before implementation.

## Acceptance Criteria

- [ ] Read aloud to the user on its own, together with the expressible /
      not-expressible split above — the split is the substance of the decision
- [ ] The four open questions answered in the sign-off conversation
- [ ] User signs off, or amends
- [ ] Applied to SPEC.md §11 with a `_(Rider signed YYYY-MM-DD.)_` marker
- [ ] Contradiction sweep recorded here against §11's existing floating-toolbar
      sentence and the "no edit mode" rule — a toolbar must not read as a mode
- [ ] `design/index.html` updated, or a decision recorded that it follows
      implementation

## Technical Design

None — spec text. Implementation is UI-101.

## Testing Strategy

N/A — spec text.

## E2E Verification Plan

N/A.

## E2E Verification Log

_N/A — spec rider._

## Completion Checklist (orchestrator)

- [ ] Rider read aloud, with the expressible/not-expressible split
- [ ] Open questions answered
- [ ] Signed by user
- [ ] Applied to SPEC.md with signature marker
- [ ] Contradiction sweep recorded
- [ ] Committed with `[SHARED-034]` prefix
