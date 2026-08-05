# [UI-072] Hard-wrapped prose shows its line breaks in the document editor

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
- SPEC.md §11 Document view (TipTap over markdown, autosave, "serializes to clean
  markdown")
- SPEC.md §11 thread view, as amended by SHARED-009 Amendment 7 (newlines render
  by author) — the read surface's answer to the same question

## Summary
Live report 2026-08-05, with a screenshot of an agent-written document: the prose
breaks mid-sentence at roughly 80 columns —

> …Tomorrow is a
> Wednesday, so the
> office opens an hour later than the rest of the week…

**Mechanism, traced:**
1. The agent writes hard-wrapped markdown (~80 columns) — measured during
   UI-054: 10 of 11 agent turns in the live workspace wrap this way. It is the
   agent's house style, not a defect.
2. remark parses a single newline inside a paragraph as part of one `text` node,
   value and all.
3. `apps/ui/src/editor/markdown/parse.ts` `case "text"` passes `md.value`
   straight through, so the ProseMirror text node contains a literal `\n`.
4. `apps/ui/src/editor/editor.css:38` sets `.doc-editor .ProseMirror {
   white-space: pre-wrap }`, which renders that `\n` as a visible line break.

So the **document view disagrees with CommonMark and with the app's own read
surface**: a single newline is a space everywhere else (that is exactly why
UI-054 had to add `remark-breaks` to get user turns to break at all), and here it
is a break. Every hard-wrapped document — most of what the agent writes — reads
ragged.

## The constraint that makes this non-trivial
**A fix must not silently rewrite the file.** The editor autosaves (§11), so
whatever the parse does, the serializer round-trips it back to disk on the next
keystroke. Normalising newlines to spaces at parse time would re-flow every
agent-written paragraph the moment the user opens the document — a whole-file
diff nobody asked for, auto-committed, on every document they read. That is worse
than the ragged rendering.

So the shape to aim for: **the model keeps the author's bytes; the view stops
drawing them as breaks.** Options, to be weighed rather than picked by default:

1. **Render-side.** Stop `pre-wrap` from turning soft newlines into breaks while
   keeping what it is actually there for (typed spaces, indentation). Establish
   what `pre-wrap` is load-bearing for here before changing it — ProseMirror
   relies on it for whitespace fidelity while typing, so plain `normal` is likely
   to break something.
2. **Model-side with fidelity.** Keep the newline out of the text node but record
   it so the serializer re-emits the original wrapping. This is the round-trip
   trace's territory (`serialize.ts` already carries one) — expensive, and worth
   it only if option 1 has no clean answer.
3. **Producer-side (partial at best).** Teach the agent not to hard-wrap
   (AGENT-012's neighbour). It does nothing for the documents that already exist
   or for anything a human pasted in, so it cannot be the whole answer.

## Acceptance Criteria
- [x] A hard-wrapped paragraph renders as flowing prose in the document editor,
      the way it does in every read surface
- [x] **The file is unchanged by opening and closing the document.** Byte-for-byte
      — assert it, because this is the criterion the obvious fix violates
- [x] Typing still works: caret placement, selection, and whitespace fidelity
      while typing are unaffected — and fidelity while typing was **not** true
      before this issue; see the E2E log
- [x] Deliberate hard breaks still render as breaks — markdown's two-trailing-
      spaces and backslash forms both survive (`roundtrip.test.ts` has cases)
- [x] Code blocks, `.md-raw` and table cells keep their own whitespace rules
      (`editor.spec.ts:130` pins `.md-raw`)
- [x] Consistent with the thread view's signed answer (SHARED-009 Amendment 7):
      a person's typed newline breaks, an author's soft wrap does not
- [x] A test with a hard-wrapped fixture asserting both the rendering and the
      byte-identical round-trip

## Technical Design
### Files to Create/Modify
- `apps/ui/src/editor/markdown/parse.ts`, `editor.css`, possibly `serialize.ts`
- tests alongside, plus an e2e on a hard-wrapped fixture

### As built
Neither `parse.ts` nor `serialize.ts` needed a line: the walk already carries the
newline through verbatim and writes it back byte-for-byte, which is what made a
render-side answer possible at all.

- **new** `apps/ui/src/editor/softWrap.ts` — the decoration that draws a soft
  newline as a space, and the DOM parser that keeps it a newline when a change
  is read back
- **new** `apps/ui/src/editor/softWrap.test.tsx` (17 tests)
- **new** `apps/ui/src/editor/markdown/fixtures/hard-wrapped.md` — joins both
  fixture corpora (round trip, anchor offset map)
- **new** `apps/ui/e2e/soft-wrap.spec.ts` (6 tests)
- `apps/ui/src/editor/editor.css` — `.md-soft-wrap`, plus `.md-raw`'s own rule
  restated where it can win over prosemirror-view's node-view rule
- `apps/ui/src/editor/DocEditor.tsx` — the extension, beside `createRefSuggestion`
- `apps/ui/src/editor/markdown/roundtrip.test.ts`,
  `apps/ui/src/anchors/offsetMap.test.ts` — the fixture-count guards, 14 → 15

### Notes
- UI-054 measured the workspace and found the agent hard-wraps at ~80 columns;
  that measurement is the reason this affects most documents rather than a few.
- Check whether the same literal newline reaches other `pre-wrap` surfaces.

## Testing Strategy
Unit: a hard-wrapped fixture through parse → serialize, asserting byte equality.
E2E: open an agent-written document, assert the rendered paragraph has no break
where the file has a soft newline, then close it and assert the file is unchanged.

## E2E Verification Log

**Model: opus (claude-opus-5, 1M context).** Real `corpus init` workspace at
`/tmp/ui072ws`, real server on port **8791** (never 8765 — the user's live
server holds it), real Vite dev server on **6031** with
`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8791` and `VITE_CORPUS_TOKEN` read from
`.corpus/config.json`, real Chromium driven by Playwright. Documents created
through the real CLI `--from agent`, so every file below is a real
git-auto-committed workspace file.

### The option taken, and why the other two lose

**Option 1, render-side** — the model keeps the author's bytes untouched and the
newline is drawn as a space. Two measurements decided it:

- **CSS alone cannot do it.** CSS Text 4 spells exactly the value wanted —
  `white-space-collapse: preserve-spaces` (keep spaces, turn segment breaks into
  spaces) — and Chromium does not implement it: measured on a probe page, the
  declaration is dropped and the element falls back to `collapse`, the very
  value prosemirror-view's `checkCSS` rejects. So the newline is wrapped in a
  one-character `<span class="md-soft-wrap">` that collapses, inside a surface
  that does not.
- **What `pre-wrap` is load-bearing for: spaces and tabs, not newlines.**
  prosemirror-view ships the rule itself and warns on any computed value in
  `['normal','nowrap','pre-line']` — the three that collapse *spaces* — because
  a surface that collapses a run of spaces stops matching the document
  `readDOMChange` reads back out of it (a typed trailing space becomes
  invisible). Outside a code block a ProseMirror text node does not normally
  hold a newline at all, so nothing in ProseMirror depends on `pre-wrap`
  preserving one. Confirmed on a probe: with the span, `two  spaces`, tabs and
  indentation all still render preserved while the newline flows.

Option 2 (model-side with a fidelity trace) loses because it is unnecessary once
option 1 works, and because it would take the newline out of the DOM's text —
the property comment anchoring rests on (SPEC.md §6), and the one
`turnBreaks.test.tsx` already pins for threads. Option 3 (teach the agent not to
wrap) loses because it does nothing for the documents that exist or for anything
a human pasted.

### The rendering, before and after — the live report's own paragraph

`data/docs/inbox/short-report.md`, body exactly the report's three lines. Same
document, same column, same browser; only the extension differs.

```
BEFORE  innerText: "Tomorrow is a\nWednesday, so the\noffice opens an hour later than the rest of the week."
        visual lines: 3          ← breaks mid-sentence at the file's columns
AFTER   innerText: "Tomorrow is a Wednesday, so the office opens an hour later than the rest of the week."
        visual lines: 2          ← flows to the column's measure
        textContent unchanged:  "Tomorrow is a\nWednesday, so the\noffice opens…"
```

Screenshots `/tmp/ui072-short-BEFORE.png` / `-AFTER.png`: the before shows the
reported ragged three lines, the after one flowing paragraph.

### The file's bytes, before and after opening it

`data/docs/inbox/office-hours.md`, agent-written, hard-wrapped at ~76 columns:

```
sha256 before opening  52566bff17d06eb73ef611fd2f4472bf710651639bda420ba7fed53ace3c427d
sha256 after  opening,
  reading for 3 s,
  and navigating back  52566bff17d06eb73ef611fd2f4472bf710651639bda420ba7fed53ace3c427d
non-GET /api calls observed on the wire while reading: []
git: no new commit
```

Byte-identical, and the reason is stronger than a comparison: the UI issued no
write at all, and the server is the sole writer.

### The larger defect this uncovered, reproduced and fixed

Verifying "whitespace fidelity while typing" (criterion 3) turned up a
**pre-existing silent file rewrite**, present with and without this issue's
change. Reproduced against the real workspace by replacing the first word of a
hard-wrapped paragraph (`Tomorrow` → `Today`) with the extension disabled:

```
git diff (BEFORE, extension off) — data/docs/inbox/office-hours.md
-Tomorrow is a Wednesday, so the office opens an hour later than the rest of
-the week. The badge readers on the north door stay on the old schedule until
+Today is a Wednesday, so the office opens an hour later than the rest of\
+the week. The badge readers on the north door stay on the old schedule until\
 facilities reflashes them, which is why the lobby desk is staffed from seven.
git log: 2e58fae doc edit: Office hours (doc_q6r6vfei) by user
```

Two lines the user never touched were rewritten — and rewritten in *meaning*: a
soft wrap is a space, a `\` is a break, so the paragraph then reads as broken
lines on every read surface too. Auto-committed.

**Mechanism**, traced in `node_modules`: ProseMirror reads a typed change back by
re-parsing the DOM around it (`prosemirror-view` `parseBetween`, which passes
`preserveWhitespace: $from.parent.type.whitespace == "pre" ? "full" : true` — so
`true` for a paragraph), and under that option `prosemirror-model`'s
`addTextNode` splits on `\n` and inserts `schema.linebreakReplacement`, which
TipTap's `hardBreak` declares. It was invisible before this issue only because
the editor already drew every soft wrap as a break; with the paragraph flowing,
one keystroke visibly shatters it. So the fix ships here: the editor supplies a
`domParser` that upgrades that `true` to `"full"` — the option a code block
already gets, and the faithful inverse of a `pre-wrap` surface. `parseSlice`
(the clipboard) is deliberately untouched.

Same edit, same document, with the fix:

```
git diff (AFTER) — data/docs/inbox/office-hours-after.md
-Tomorrow is a Wednesday, so the office opens an hour later than the rest of
+Today is a Wednesday, so the office opens an hour later than the rest of
 the week. The badge readers on the north door stay on the old schedule until
 facilities reflashes them, which is why the lobby desk is staffed from seven.
```

One line changed, exactly the one edited.

### The neighbours that had to keep their own rules

Read off the live editor, same document: `br` count **1** (the deliberate
backslash break, and only it); `.md-soft-wrap` spans **2**; the fence's
`innerText` still `"A fence keeps its own line endings:\nthis is the second
line."`.

One adjacent **pre-existing** defect found while checking `.md-raw`: in the live
editor it computed `white-space: normal`, not `pre`, because a raw block is a
node view and prosemirror-view's own
`.ProseMirror [contenteditable="false"] { white-space: normal }` outranks
`.md-raw` — so the one construct the schema keeps *verbatim* was drawn collapsed
onto a single line. `editor.spec.ts:130` never caught it because its probe is
neither inside `.ProseMirror` nor `contenteditable="false"`. Fixed with the same
declaration restated at a winning specificity, and pinned on the live element in
`e2e/soft-wrap.spec.ts`.

### Gates

- `apps/ui` unit: **2104 passed**, 128 files (`softWrap.test.tsx` 17 new;
  `hard-wrapped.md` joins the round-trip corpus and the anchor offset-map corpus).
- `packages/kit` unit: **660 passed**, 40 files.
- Playwright, full suite on `CORPUS_UI_PORT=6020`: **280 passed, 2 failed** —
  `console.spec.ts` and `smoke.spec.ts`' "server unreachable" assertions, which
  require nothing listening on 8765; the user's live personal server holds it.
  Environmental, not a regression.
- `eslint --max-warnings 0`, `prettier --check`, `tsc --noEmit`: clean.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
