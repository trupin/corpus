# [SHARED-068] Frontmatter is edited where it is shown

## Domain
shared

## Status
todo

## Priority
P0 (critical path)

## Model
fable

## Dependencies
- Depends on: —
- Blocks: UI-162

## Spec References
- SPEC.md Section 10 — "UI — the board", Document view: _"Frontmatter editable as
  a small form (title, tags, status, due) — **under the body's rule, not beside
  it: no edit mode, no save button.**"_ (rider signed 2026-08-12)
- SPEC.md Section 5 — the status ladder, "one vocabulary, every type"

## Summary

The reader draws the document's frontmatter twice: once as a read-only chip
strip that says what the corpus holds, and again below the title as a labelled
form — a `TAGS` text input, a `STATUS` `<select>`, a `DUE` date input. The user's
words, 2026-08-23, with both a screenshot of what ships and a mockup of what
they want:

> WTF is this. I want it to look like this. For adding tags, add a "+" button to
> the list of tags, and clicking on them proposes to delete or edit. I want
> everything in one line, the tags, the date picker, the status picker, etc...
> The status a document shows exactly where it is also edited.

The last sentence is the rule, and it is a doctrine rather than a layout
preference: **the place a value is displayed is the place it is changed.** The
form below is a second copy of values already on screen, and two copies of one
value is what the strip's own comment already concedes — _"the two agree except
while a save is on the wire"_.

This issue carries the SPEC rider. UI-162 implements it.

## Acceptance Criteria

- [ ] The rider text below is read back to the user verbatim and **signed**
      before any line of SPEC.md is edited.
- [ ] §10's Document view sentence is replaced, not appended to, so the spec does
      not describe two surfaces.
- [ ] The rider is dated and attributed in the spec, as every other rider is.
- [ ] `npm run spec:check` (or `scripts/check-spec-refs.ts`) passes — every §
      citation in the issues still resolves.

## The rider, as drafted — **unsigned**

> **Frontmatter is edited on the strip that shows it.** The document's own line —
> its type, its folder, its tags, its status, its stage, its dates — is one strip
> of chips above the title, and every chip that names an editable field **is** the
> control for that field. There is no second copy of the same values below it. A
> tag chip opens on click and offers to rename it or to remove it, and a `+` at
> the end of the tags adds one. The status chip opens §5's one vocabulary, marks
> the word the document currently holds, and says why when a document's status is
> not the reader's to set. The stage chip offers the words the kanbans claiming
> this document name, and is absent when none do. A date chip opens a date picker
> and can clear the date. The **title** stays the field above the body: it is the
> document's name, not one of its properties, and it is edited as text because it
> is text. None of this is a mode — the strip is live wherever the document is
> shown, a change commits where it is made, and the rules above about the write
> path, the debounce and the open commit window are untouched.

**What this changes about the product, stated plainly so the signature is
informed**: today's sentence promises "a small form", and a reader could
reasonably build one. After this rider, a labelled form beside a display of the
same values is a spec violation rather than a style choice, in the reader and
anywhere else a document's properties are shown.

**What it deliberately does not say.** It does not say the strip is one visual
line. A strip that refuses to wrap is a strip that either overflows or shrinks
its contents to fit, and SHARED-061 rules the second one out — nothing resizes
because of what it holds. "One line" in the user's message is read as "one strip
rather than a stacked form", and the strip wraps, as it does today. If the user
means a single non-wrapping row that scrolls, that is a second rider and should
be said so.

## Technical Design

### Files to Create/Modify
- `SPEC.md` — §10, Document view: the frontmatter sentence

### Key Implementation Details

One rider, read aloud on its own. The last two releases both put a rule into
SPEC.md that nobody signed, and both times the reasoning attached to the rule was
the orchestrator's rather than the user's. Quote the drafted text, get the word
back, then edit.

### Edge Cases
- A locked status (`statusLock` — a skill's status is decided by its folder). The
  rider says the chip "says why"; it does not say the chip is absent, and it must
  not be, or the document stops showing its own status.
- A document whose type offers no stage: the chip is absent, which the rider says.

## Testing Strategy

None — this issue edits prose. The check is `scripts/check-spec-refs.ts` and the
user's signature.

## E2E Verification Plan

### Verification Steps
1. `npx tsx scripts/check-spec-refs.ts`
2. Read the amended §10 paragraph back and confirm it says one thing

## E2E Verification Log

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
