# [UI-068] Selector capture quotes the canonical spelling, not the file's

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: UI-062
- Blocks: —

## Spec References
- SPEC.md §6 Anchoring (the resolution ladder matches the file literally)

## Summary
Escalated by UI-062 (2026-08-04), which fixed the *placement* half of this
mismatch and found the *capture* half on the way past.

`selectorFromSelection` slices `traceOfDoc(...).markdown` — the **serializer's
re-print** of what remark parsed, not the bytes on disk. On a file whose spelling
is already canonical those are identical and nothing is wrong. On a file that is
not, the selector quotes text that is not literally in the file.

Observed live on a table fixture during UI-062's drill:

```
prefix: "rm |\n| Mesbah   | infra    |\n\n**"
```

Those padded cells exist only in the editor's printing; the file has different
whitespace. It survived because SPEC §6 rung 2 matches a unique `exact` and
ignores the frames — but **an `exact` that itself straddles a respelt
construct would orphan the thread at creation**, which is the worst time for it:
the user writes a comment, it attaches to nothing, and there is no edit to blame.

Non-canonical files are ordinary, not exotic. UI-062 lists the triggers: a
leading blank line after the frontmatter fence (which every editor leaves),
padded table cells, hard breaks written as trailing spaces, setext headings,
indented code.

## The fix, and the trap
UI-062 built `rebaseRange` (`apps/ui/src/anchors/rebase.ts`) to carry a range
from the file's offsets into the canonical text's, travelling through the plain
projection both share, and refusing unless plain-text equality holds. **This
needs the same thing in the opposite direction** — canonical → file — before
slicing the quote.

**Do not "fix" this by trimming markup out of `exact`.** That is a different
change, it breaks the literal matching the server's ladder depends on, and
`selectorFromSelection.ts`'s docblock rejects it explicitly.

## Acceptance Criteria
- [ ] A selector captured on a non-canonical file quotes bytes that are literally
      present in that file — `exact`, `prefix` and `suffix` alike
- [ ] The server resolves such an anchor at creation, on rung 1, not by falling
      through to a weaker rung
- [ ] An `exact` that straddles a respelt construct is handled deliberately:
      either rebased correctly or refused with the comment path saying why —
      never captured as a quote the file does not contain
- [ ] Canonical files are byte-for-byte unaffected — the common path does not
      change
- [ ] A test per trigger from UI-062's list (leading blank line, padded table,
      trailing-space break, setext heading, indented code)
- [ ] The reasoning is stated once, next to `rebaseRange`, rather than twice

## Technical Design
### Files to Create/Modify
- `apps/ui/src/anchors/selectorFromSelection.ts`, `rebase.ts`
- tests alongside

## Testing Strategy
Unit tests over the trigger list; an e2e that comments on a document with a
leading blank line and asserts the wire selector appears verbatim in the file on
disk.

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
