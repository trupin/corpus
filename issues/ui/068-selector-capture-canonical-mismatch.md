# [UI-068] Selector capture quotes the canonical spelling, not the file's

## Domain
ui

## Status
done

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
- [x] A selector captured on a non-canonical file quotes bytes that are literally
      present in that file — `exact`, `prefix` and `suffix` alike
- [x] The server resolves such an anchor at creation, on rung 1, not by falling
      through to a weaker rung
- [x] An `exact` that straddles a respelt construct is handled deliberately:
      either rebased correctly or refused with the comment path saying why —
      never captured as a quote the file does not contain
- [x] Canonical files are byte-for-byte unaffected — the common path does not
      change
- [x] A test per trigger from UI-062's list (leading blank line, padded table,
      trailing-space break, setext heading, indented code)
- [x] The reasoning is stated once, next to `rebaseRange`, rather than twice

## Technical Design
### Files to Create/Modify
- `apps/ui/src/anchors/selectorFromSelection.ts`, `rebase.ts`
- tests alongside

### What was built (2026-08-07)

**Map, don't re-slice.** The only address a selection has is a ProseMirror
position, and the only map from those to markdown offsets is the serializer's
emission trace, which indexes the canonical *printing*. Nothing ever printed the
file, so there is no trace into it — "slice the file's bytes instead" is not an
alternative to the trace, it still needs an offset translation. So the trace
stays (it is what makes a selection across `**bold**`, across blocks and inside
a `[[ref]]` exact) and the range crosses into the file's spelling *after* it.

`rebase.ts` gains `fileRangeOf(canonical, file, range)` — `rebaseRange` with its
arguments swapped, plus a second rung — and the whole reasoning for both
directions now lives in that one docblock. Two rungs, in this order:

1. **Rebase** through the plain projection both spellings share. Positional, so
   it names the passage that was pointed at even when the words recur. Inherits
   UI-062's known widening (an escape atomic in one spelling and not the other
   returns the run rather than the word) — wide and true beats narrow and
   invented.
2. **The quote's single literal occurrence in the file.** Keeps a `[[ref]]`
   commentable on a respelt file: a reference token is in *neither* projection,
   so a selection of nothing else has no plain range to travel through. Second,
   not first, because uniqueness is a weaker claim than position.

Neither holds ⇒ `null`, and `selectorFromSelection` now returns a
`SelectionCapture` discriminated union so the comment path can *say* which
refusal it is (`"no-quote"` vs `"not-in-file"`) instead of saying "select some
words" for both.

**Which bytes.** `useAnchorLayer.quotableSource` picks them: the file (`body`)
when `traceOfBody(body).markdown === traceOfDoc(doc).markdown` — equal printings
mean the editor holds nothing the file does not already say — and otherwise the
editor's own printing, because a comment submitted with unsaved edits waits for
the save (`submitComment`'s `editing` gate) and that save is what will be on
disk. When the two strings are equal the crossing is the identity, so a canonical
document takes exactly the path it always did.

**The `400`.** SERVER-071's ambiguity refusal reached the toast as the server's
API-caller sentence ("send `prefix`/`suffix` copied from the file…"), which is
not an act available to someone holding a mouse — and this layer already sends
them. `commentFailureNotice` translates it to "That passage appears more than
once, and the words around it are identical too — select a longer stretch that
includes something unique."

## Testing Strategy
Unit tests over the trigger list; an e2e that comments on a document with a
leading blank line and asserts the wire selector appears verbatim in the file on
disk.

### Tests written
- `selectorFromSelection.test.ts` — a new `a file the editor would print
  differently` block: leading blank line, padded table (the reported fixture,
  both as context and as a cell quote), trailing-space hard break, setext
  heading, indented code, and a `[[ref]]` that only rung 2 can carry. Each
  asserts §6 rung 1 finds `prefix + exact + suffix` in the **file** at the
  captured offset. Plus the `"not-in-file"` refusal.
- `useAnchorLayer.test.tsx` — the layer end to end on the padded-table file
  (wire selector is a file slice; composer shows the file's quote), and the
  `400` translation.
- `anchorPlacement.test.ts` — its whole-flow `comment()` helper now quotes the
  file, which is what the app does.
- `readerFixture.ts` — `POST /api/threads` with `failing: 400` now answers
  SERVER-071's real `ApiError` (code, message, `issues[].path`), route-scoped so
  every other failure path keeps its shapeless refusal.
- `anchor-layer.spec.ts` — two Playwright tests on the reported file shape.

**Each new test was checked to fail without the fix**, not just to pass with it
(sabotage runs recorded below).

## E2E Verification Log

**Model: Opus 5 (1M context).** Branch `phase-19-scanner-anchors-heading`.
Ports: UI dev server on **5299**, workspace server on **8799**. 8765 (the user's
live server) and 5173 (an ssh tunnel) were never bound.

### Real app, real workspace, real browser (2026-08-07)

`corpus init /tmp/ui068-ws --port 8799`, then a document written **directly to
disk** — the way a hand- or agent-written file arrives — whose body is the
reported shape:

```
'\n# Standup\n\n| who | area |\n| --- | ---- |\n| Fernando | platform |\n| Mesbah | infra |\n\n**Moushmi Verma** wrote it up on Monday.\n'
```

Vite on 5299 with `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8799`, driven by a
throwaway Playwright script (deleted afterwards): open the document, select the
paragraph, right-click → Comment, send.

**1. Reproduction, with the capture reading the trace (defect in place):**

```
POSTED selector.prefix: "rm |\n| Mesbah   | infra    |\n\n**"
prefix+exact+suffix present in the file: false
```

The reported string, verbatim. It survived only on rung 2, exactly as the issue
says — the padded cells are in no file anywhere.

**2. The worse case the issue predicts — an `exact` that straddles the
respelling** (select-all inside the editor, then Comment), still with the defect:

```
EXACT: "Standup three\n\n| who      | area     |\n| -------- | -------- |\n| Fernando | platform |\n| Mesbah   | infra    |\n\n**Moushmi Verma** wrote it up on Monday."
exact present in the file: false
highlights drawn: 0
detached thread section: 1
```

Orphaned at creation, before anyone read the comment.

**3. Both, with the fix:**

```
POSTED: {"parent":"doc_ui068a","selector":{
  "exact":"Moushmi Verma** wrote it up on Monday.",
  "prefix":"latform |\n| Mesbah | infra |\n\n**","suffix":"\n"}, …}
prefix+exact+suffix present in the file: true
highlights: ["Moushmi Verma", " wrote it up on Monday."]   detached: 0
```

The file's own single-spaced row. And the straddling select-all case:

```
EXACT: "Standup four\n\n| who | area |\n| --- | ---- |\n| Fernando | platform |\n| Mesbah | infra |\n\n**Moushmi Verma** wrote it up on Monday."
exact present in the file: true   highlights: 9   detached: 0
```

**4. What the real server stored and resolved** (`GET /api/docs/doc_ui068a`):

```json
{"anchorId":"anc_9b0dea70",
 "selector":{"exact":"Moushmi Verma** wrote it up on Monday.",
             "prefix":"latform |\n| Mesbah | infra |\n\n**","suffix":"\n"},
 "range":{"start":88,"end":126},"orphaned":false}
```

`body[88:126]` is the quote and `body[56:88]` is the prefix, so the framed
selector matched **rung 1** — SERVER-071 recomputed context off bytes that
already agreed with what was sent. The frontmatter on disk carries the same
single-spaced row.

### Automated

- `npx vitest run apps/ui packages/kit` — **2974 passed, 0 failed**.
- `npx playwright test anchor-layer.spec.ts context-menu.spec.ts todos.spec.ts
  turn-comment.spec.ts` (`CORPUS_UI_PORT=5299`) — **51 passed**.
- `npm run typecheck -w apps/ui`, `eslint`, `prettier --check` — clean.
- Sabotage runs (fix disabled, then restored): 7 trigger tests + the refusal test
  fail in `selectorFromSelection.test.ts`; the layer test fails with
  `expected '\n# Standup\n\n| who | area |…' to contain 'rm |\n| Mesbah   | infra    |\n\n**Mo…'`;
  the Playwright wire test fails on the same string. The canonical-file cases
  pass under sabotage, which is the evidence for "canonical files unaffected".

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
