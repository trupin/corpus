# [SHARED-035] Styled text: in the body, stripped for retrieval, themed by a style document

## Domain

shared (orchestrator-handled — SPEC.md rider, needs user sign-off)

## Status

done — **SIGNED 2026-08-12 and applied to SPEC.md §5 and §11**

Two of the four open questions were answered by the user at sign-off and are
folded into the applied text: the colour roles are **`accent`, `warning`,
`positive`, `muted`** (four, each with a light and dark value), and **per-range
font size is out** — size is document-level, because a body marker for size is
presentation soup.

Two were adjudicated by the orchestrator rather than asked, being editorial
rather than product decisions: `align` and `indent` values are left unenumerated
in the spec (the vocabulary is closed, the value sets are the implementation's to
propose), and §13's `publish-style` merging into `type: style` is left to the
publish track rather than renaming a spec'd type from here.

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Blocks: SHARED-034 (the toolbar's control set is bounded by what this rider
  admits), UI-101, and the implementation issues decomposed after sign-off

## Spec References

- SPEC.md §5 — documents are markdown with YAML frontmatter
- SPEC.md §11 — "the editor serializes to clean markdown"
- SPEC.md §13 — the publish `style map`: "per-element font family/size/weight,
  spacing, colors. All targets render markdown through it. One layout
  definition, N destinations."
- SPEC.md §9.1 — the semantic index; §7 — retrieval discipline ("the matching
  passage, a snippet, and never a body")
- The orchestrate skill — the agent reads through `corpus search` /
  `corpus doc show`, writes through the CLI only

## Summary

The user wants rich text the way a document editor has it — underline, colour,
highlight, alignment, spacing, fonts (2026-08-08) — without giving up the
guarantee that every document is prose the agent can read, rewrite and index.
The decisions, made in this session:

1. **Styling lives in the body, not frontmatter** (user's call, against the
   anchored-frontmatter alternative): visible markers, so the raw file shows its
   own formatting, edits inside a styled range are ordinary edits, and nothing
   has to be reconciled against a selector. Other markdown viewers showing the
   markers literally is accepted.
2. **Syntax is Pandoc attributes**: bracketed spans inline, fenced divs for
   blocks. Underline and highlight keep their own established spellings.
3. **Clean markdown is extractable, and it is what retrieval sees**: one strip
   transform, applied at the server, feeds `corpus search` snippets, the
   semantic index's chunks, and every passage-shaped answer. **`corpus doc show`
   serves the raw file** — it is the deliberate pre-edit read, and an agent that
   edits preserves markers because it saw them (chosen over a stripped show,
   whose show → modify → edit round-trip would silently wipe every marker).
4. **Document-wide look lives in a style document**, generalising §13's
   publish-style map from a publish-only concept into the product's typography
   system: the editor renders through the same style map the publisher uses.

## Drafted rider text — part 1 of 3 (§5, after the frontmatter block)

> **Styled text lives in the body, as text.** Corpus markdown admits three
> styling forms beyond CommonMark/GFM: `<u>underline</u>`, `==highlight==`, and
> **attribute markers** — Pandoc-style bracketed spans for inline styling
> (`[phrase]{color="crimson"}`) and fenced divs for block styling
> (`::: {align="center"}` … `:::`). The attribute vocabulary is **closed** and
> named by this spec: `color`, `highlight`, `align`, `indent`. A marker carrying
> any other attribute is not an error — it is ordinary text, exactly as an
> unparseable due-date marker is (§12) — and never invents behaviour. Styling is
> visible in the raw file by design: a document's formatting is part of its
> text, an edit inside a styled range is an ordinary edit, and no selector has
> to be reconciled to keep a style attached. Colours are **named roles from the
> style map** (part 3), never raw hex in the body — a document that says
> `color="warning"` renders correctly in light and dark and can be re-themed
> without touching any body.
>
> **Clean markdown is always extractable.** Stripping is one defined transform —
> drop the wrapper, keep the inner text; `<u>` and `==` marks likewise — and
> what it yields is the document's content, unchanged in wording, headings and
> structure. **Every passage-shaped answer serves the stripped form**: search
> snippets, the semantic index's chunks (§9.1), related-document passages. The
> index never embeds a marker, so styling a phrase never changes what it
> retrieves for. `corpus doc show` serves the **raw body** — reading a document
> whole is the deliberate act before editing it (§7), and an agent that saw the
> markers preserves them; one that was shown a stripped body would wipe every
> style with its first whole-body write.

## Drafted rider text — part 2 of 3 (§11, the editor)

> The editor renders styled text as styled text — underline, highlight, colour,
> alignment and indent display as what they are, never as their markers — and
> serializes back to the same markers, character for character. "Clean markdown"
> (§11) means **Corpus markdown as §5 defines it**: the three styling forms
> round-trip; arbitrary HTML still does not. Pasting rich text maps what has a
> Corpus form onto it and drops what does not, exactly as paste already
> normalises to the schema.

## Drafted rider text — part 3 of 3 (§13 generalised, or a new §5 subsection)

> **One style map, and the editor is one of its targets.** A `type: style`
> document defines the rendered look — per-element font family, size, weight,
> spacing, colour, and the **named colour roles** bodies may reference — in
> light and dark. A document names its style with a `style:` frontmatter key
> (a ref, like any other); a workspace ships a default; a document without the
> key uses it. The editor, the reader, and every publish target (§13) render
> through the same map — so what focus mode shows is what a publish produces,
> and "change the corpus's font" is one document edit, agent-stewardable like
> anything else. Font family, size and spacing are **document-level by
> design**: they are the document's look, not a phrase's, which is why they
> live here and not in body markers.

## Open questions for the sign-off conversation

1. **The named colour roles** — how many, and what are they called? A small set
   (e.g. `accent`, `warning`, `positive`, `muted`) keeps bodies legible and
   theme-proof; every role needs a light and dark value in the style map.
2. **`indent` and `align` values** — `align: left|center|right` only? Is
   `justify` in? Is `indent` levels (1, 2) or a length?
3. **Does §13's `publish-style` type merge into `type: style`**, or stay a
   separate type that reads the same shape? Merging is cleaner; it renames a
   spec'd type before it ships.
4. **Font size inline?** The user's original list had per-range font size; part
   3 makes size document-level. Confirm per-range size is out (recommended — a
   body marker for size is presentation soup), or name it in the closed
   vocabulary.

## Acceptance Criteria

- [ ] All three parts read aloud, as quoted blocks, on their own; the four open
      questions answered in that conversation
- [ ] User signs off, or amends
- [ ] Applied to SPEC.md (§5, §11, §13) with `_(Rider signed YYYY-MM-DD.)_`
      markers
- [ ] Contradiction sweep recorded here: §11's "clean markdown" and clipboard
      fidelity clauses; §9.1 (chunk identity hashes text — stripping changes the
      hashed text, which may re-chunk the corpus once); §14 (`doc check` must
      not flag markers); §13 (style map ownership)
- [ ] **Decomposed after signing** — expected shape: editor marks + serializer
      (UI), strip transform + retrieval surfaces + index (SERVER, and the
      re-chunk consequence named), style document type + `style:` key
      (CONTRACT + SERVER + UI), toolbar controls (already UI-101). Not filed
      ahead of the signature because the open questions change their contracts.

## Technical Design

None — spec text. Decomposition follows sign-off.

## Testing Strategy

N/A — spec text.

## E2E Verification Plan

N/A.

## E2E Verification Log

_N/A — spec rider._

## Completion Checklist (orchestrator)

- [ ] All three parts read aloud verbatim
- [ ] Open questions answered and recorded
- [ ] Signed by user
- [ ] Applied to SPEC.md with signature markers
- [ ] Contradiction sweep recorded here
- [ ] `/decompose` run; implementation issues filed
- [ ] Committed with `[SHARED-035]` prefix
