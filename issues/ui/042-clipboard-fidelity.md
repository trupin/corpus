# [UI-042] Clipboard fidelity: rich copy out, rich paste in

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §11 clipboard fidelity rider (signed 2026-08-02)

## Summary
User report (2026-08-02): copying from the document view into Google Docs
loses all formatting. Per the signed rider, both directions:

**Copy out** — a selection copied from the document view carries BOTH flavors:
`text/html` with full structure (headings, bold/italic, ordered/unordered
lists, task lists, links, code) and `text/plain` holding the markdown. First
REPRODUCE and diagnose what the clipboard actually holds today (likely a
markdown-only custom serializer suppressing ProseMirror's native HTML flavor)
and log it pre-fix. `[[refs]]` copy as the target document's title; emit a
link only where the target is externally addressable — otherwise plain title
text, never a raw `doc_xxxx` id.

**Paste in** — rich-text clipboard content (from Google Docs, browsers, etc.)
converts through the editor's schema to clean markdown on save: headings,
emphasis, lists, links survive; unsupported constructs degrade to their text
rather than dropping or leaking HTML. Plain-text/markdown paste behavior is
unchanged.

## Acceptance Criteria
- [ ] Pre-fix reproduction logged (actual clipboard flavors + contents)
- [ ] Copy: text/html carries headings/emphasis/lists/task-lists/links for a
      multi-block selection; text/plain carries the markdown
- [ ] Paste from a captured Google-Docs-flavored HTML fixture yields clean
      markdown; no HTML leaks into the saved file; roundtrip test guards it
- [ ] [[refs]] copy per the rider (title text; link only when addressable)
- [ ] Anchors/threads unaffected by paste-driven edits beyond ordinary §6
      reconciliation (existing tests stay green)

## Technical Design
### Files to Create/Modify
- `apps/ui/src/editor/` clipboard configuration (ProseMirror clipboard
  serializer/parser, transformPastedHTML or paste rules), markdown
  serialize/parse as needed

## Testing Strategy
Unit: serializer/parser fixtures incl. a captured Google Docs HTML sample.
E2E: Playwright clipboard read after copy (permissions granted), paste flow.

## E2E Verification Plan
Real app: copy the user's repro shape (title + heading + bullets) → inspect
clipboard flavors; paste a Google Docs selection → saved markdown is clean.

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
