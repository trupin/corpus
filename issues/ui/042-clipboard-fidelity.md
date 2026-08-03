# [UI-042] Clipboard fidelity: rich copy out, rich paste in

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
- [x] Pre-fix reproduction logged (actual clipboard flavors + contents)
- [x] Copy: text/html carries headings/emphasis/lists/task-lists/links for a
      multi-block selection; text/plain carries the markdown
- [x] Paste from a captured Google-Docs-flavored HTML fixture yields clean
      markdown; no HTML leaks into the saved file; roundtrip test guards it
- [x] [[refs]] copy per the rider (title text; link only when addressable)
- [x] Anchors/threads unaffected by paste-driven edits beyond ordinary §6
      reconciliation (existing tests stay green)

## Technical Design
### Files to Create/Modify
- `apps/ui/src/editor/` clipboard configuration (ProseMirror clipboard
  serializer/parser, transformPastedHTML or paste rules), markdown
  serialize/parse as needed

**As built:**
- `apps/ui/src/editor/clipboard.ts` (new) — `clipboardSerializer` (the
  `text/html` flavor, with the `docRef` rule), `sliceMarkdown` (the `text/plain`
  flavor), `cleanPastedHtml` (the three Google Docs repairs), `refLabel`.
- `apps/ui/src/editor/refResolver.ts` (new) — synchronous ref-title lookup out
  of the TanStack cache; `href` is always `null` in v1.
- `apps/ui/src/editor/DocEditor.tsx` — wires `clipboardSerializer`,
  `clipboardTextSerializer` and `transformPastedHTML` into `editorProps`.
- `apps/ui/src/editor/markdown/refNode.ts` — comment only; `renderHTML` is no
  longer the clipboard's rendering.
- `apps/ui/src/editor/fixtures/google-docs-paste.html` (new) + `.prettierignore`
  entry so the captured bytes are never reformatted.
- Tests: `apps/ui/src/editor/clipboard.test.ts`,
  `apps/ui/src/editor/refResolver.test.ts`, `apps/ui/e2e/clipboard.spec.ts`.

**Follow-up (the menu Copy — orchestrator ruling 2026-08-02, `menu/` released by
UI-036):**

- `apps/ui/src/menu/selectionCopy.ts` (new) — `captureCopy`: the editor's own
  `serializeForClipboard` inside the body, the range's `cloneContents()` outside it.
- `apps/ui/src/menu/SelectionMenuItems.tsx` — `copy: SelectionCopy` instead of
  `text: string`; `clipboard.write` with a two-flavor `ClipboardItem`, degrading to
  `writeText`.
- `apps/ui/src/menu/useSelectionContextMenu.tsx` — captures the flavors at open time.
- Tests: `apps/ui/src/menu/selectionCopy.test.ts` (new),
  `apps/ui/src/menu/SelectionMenuItems.test.tsx`, and the right-click cases in
  `apps/ui/e2e/clipboard.spec.ts`.

## Testing Strategy
Unit: serializer/parser fixtures incl. a captured Google Docs HTML sample.
E2E: Playwright clipboard read after copy (permissions granted), paste flow.

## E2E Verification Plan
Real app: copy the user's repro shape (title + heading + bullets) → inspect
clipboard flavors; paste a Google Docs selection → saved markdown is clean.

## E2E Verification Log

**Model: Opus 5 (`claude-opus-5[1m]`).** Agent: ui-dev. Branch: `dogfood-todos-polish`.
Real Chromium via Playwright against the real Vite dev server (`CORPUS_UI_PORT=5673`),
`clipboard-read` + `clipboard-write` granted, real system clipboard read back with
`navigator.clipboard.read()`. Transport is `e2e/stubCorpus.ts`; everything above it —
React, TanStack cache, ProseMirror, the OS clipboard — is the real application.

### 1. Pre-fix reproduction (mandatory, run before any code changed)

Document opened in the reader, `⌘A` in the body, `⌘C`, then both flavors read back.
Body copied:

```
# Quarterly memo

Lead paragraph with **bold** and *italic* and `code`.

## Findings

- first bullet
- second **bold** bullet

1. one
2. two

- [ ] open task
- [x] done task

See [the site](https://example.com) and [[doc_other]].

```ts
const x = 1;
```
```

**`navigator.clipboard.read()` → types: `["text/plain","text/html"]`**

`text/html` (verbatim, before the fix):

```html
<h1 data-pm-slice="0 0 []">Quarterly memo</h1><p>Lead paragraph with <strong>bold</strong>
and <em>italic</em> and <code>code</code>.</p><h2>Findings</h2><ul><li><p>first bullet</p>
</li><li><p>second <strong>bold</strong> bullet</p></li></ul><ol><li><p>one</p></li>
<li><p>two</p></li></ol><ul data-type="taskList"><li data-checked="false" data-type="taskItem">
<label><input type="checkbox"><span></span></label><div><p>open task</p></div></li>
<li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked">
<span></span></label><div><p>done task</p></div></li></ul><p>See <a target="_blank"
rel="noreferrer noopener" href="https://example.com/">the site</a> and
<a class="ref" href="about:blank#doc_other" data-corpus-ref="doc_other">doc_other</a>.</p>
<pre><code class="language-ts">const x = 1;</code></pre>
```

`text/plain` (verbatim, before the fix — blank runs are real, not formatting):

```
Quarterly memo

Lead paragraph with bold and italic and code.

Findings




first bullet



second bold bullet




one



two




open task



done task

See the site and [[doc_other]].

const x = 1;
```

**Diagnosis — the issue's suspicion is disproved.** There is no
`clipboardTextSerializer` anywhere in `apps/ui/src/editor/`, and ProseMirror's HTML
flavor was never suppressed: `text/html` is present and structural. Three real defects:

1. **`text/plain` is not markdown.** It is ProseMirror's default
   `Fragment.textBetween(…, "\n\n")`. No `#`, no `-`, no `**`, no `1.`, no fence, and
   every nesting level contributes its own separator — five consecutive newlines
   between two list items. A plain-text target receives destroyed prose.
2. **A `[[ref]]` copies as a raw `doc_` id** — the rider's explicit prohibition —
   in both flavors (`>doc_other<` in HTML; the bare bracket form in text).
3. **The ref's `href` is a link to nowhere.** `refNode.ts`'s schema `renderHTML` emits
   `href="#doc_other"`; the clipboard fragment is serialized in a **detached**
   document, so the hash resolves against whatever page is open and the clipboard
   received `about:blank#doc_other`.

### 2. Pre-fix reproduction of the user's actual path (root cause of "ALL formatting")

⌘C is not the only copy in the document body. SPEC.md §11 gives a text selection a
Corpus context menu whose first clipboard item is **Copy**. Reproduced: `⌘A` in the
body → right-click the heading → menu `Actions for the selection` → `[data-act="copy"]`
→ read the clipboard.

```
TYPES: ["text/plain"]
text/html:  (ABSENT)
text/plain: Quarterly memo
            Lead with bold.

            first bullet

            second bullet
```

**No `text/html` at all.** `apps/ui/src/menu/SelectionMenuItems.tsx` copies with
`navigator.clipboard.writeText(text)`, and `text` is `selection.toString()`. Pasted
into Google Docs that is literally *all formatting lost* — the user's report, exactly.
**This file is outside this issue's assigned surface (`menu/`, another agent) and is
NOT fixed here.** Escalated to the orchestrator; see the issue's Unresolved section.

### 3. Post-fix — copy out (same document, same gesture)

**types: `["text/plain","text/html"]`**

`text/html` (unchanged structurally, ref repaired):

```html
… <p>See <a target="_blank" rel="noreferrer noopener" href="https://example.com/">the
site</a> and <span data-corpus-ref="doc_other" class="ref">Lender spreads</span>.</p>
<pre><code class="language-ts">const x = 1;</code></pre>
```

— the ref is now the target's **title** (`Lender spreads`), in a `<span>` (the target
has no address outside Corpus, so no `<a>`), with no `doc_other` visible text and no
`about:blank`. The id survives only in `data-corpus-ref`, which every external editor
drops and `DocRef.parseHTML` reads back.

`text/plain` (now the document's markdown, byte for byte):

```
# Quarterly memo

Lead paragraph with **bold** and *italic* and `code`.

## Findings

- first bullet
- second **bold** bullet

1. one
2. two

- [ ] open task
- [x] done task

See [the site](https://example.com) and [[doc_other|Lender spreads]].

```ts
const x = 1;
```
```

### 4. Post-fix — paste in (real clipboard write + real ⌘V)

`navigator.clipboard.write()` with a `text/html` blob holding
`apps/ui/src/editor/fixtures/google-docs-paste.html` (Google Docs' markup shape:
`<b style="font-weight:normal" id="docs-internal-guid-…">` wrapper, `<span
style="font-weight:700">` for bold, `font-style:italic`, `text-decoration:underline`,
`<p role="presentation">` inside `<li>`, `google.com/url?q=…&sa=D&usg=…` redirect
links, block-level `<br>`, a bordered table), then `⌘A` `⌘V` in the body, then the
autosaved `PUT /api/docs/doc_note` body read back off the wire:

```
# Quarterly memo

Lead paragraph with **bold**, *italic* and underlined copy.

## Findings

- first bullet
- **second** bullet

1. step one
2. step two

See [the rates page](https://example.com/rates) for the numbers.

| **Lender** | **Spread** |
| ---------- | ---------- |
| Acme       | 6.1%       |
```

Headings, emphasis, both list kinds, the link and the table survive. Underline (no
schema node) degrades to its text — "and underlined copy" is present. Asserted absent
from the saved body: `<span`, `style=`, `docs-internal-guid`, `google.com/url`, and
`^\\$` (the `\` hard-break lines the stray block-level `<br>`s used to produce — the
same paste before the `cleanPastedHtml` step emitted two of them).

Plain-markdown paste unchanged: `writeText("## Pasted heading\n\n- pasted bullet\n")`
→ ⌘V → saved body contains `## Pasted heading` and `- pasted bullet`.

Clipboard round trip: copy the whole Corpus body, paste it back → saved body still
contains `[[doc_other`, `# Quarterly memo`, `- [x] done task`.

### 5. Checks

| Gate | Result |
| --- | --- |
| `vitest run apps/ui/src/editor/` | **352 passed** / 13 files (27 new in `clipboard.test.ts`, 4 in `refResolver.test.ts`) |
| `tsc --noEmit` (apps/ui) | clean |
| `eslint apps/ui/src/editor apps/ui/e2e/clipboard.spec.ts` | no issues, nothing suppressed |
| `prettier --check` (same paths) | clean |
| Playwright `clipboard.spec.ts` | **8 passed** |
| Playwright `editor` + `anchors` + `anchor-layer` (regression) | **27 passed** (35 with clipboard) |
| Playwright `context-menu` + `reader` + `todos` (regression) | **40 passed** |

Anchors: no anchor code was touched. `anchors.spec.ts` (13) and `anchor-layer.spec.ts`
(11) are green, and a pasted edit is an ordinary ProseMirror transaction, so it reaches
`useAutosave` → `PUT` → §6 reconciliation on the same path as typing.

## Follow-up: the menu Copy

Orchestrator ruling, 2026-08-02: `apps/ui/src/menu/` is no longer another agent's
surface (UI-036 landed in `5c1e343`), so escalation 1 above is fixed here, as part of
UI-042. This is the path the user actually reported.

### What was wrong

`SelectionMenuItems.tsx` copied with `navigator.clipboard.writeText(text)`, and
`writeText` carries exactly one flavor. Pre-fix dump of the right-click path is in §2
of the log above: **`TYPES: ["text/plain"]`, `text/html` ABSENT**.

### The fix

- `apps/ui/src/menu/selectionCopy.ts` (new) — `captureCopy(editor, text, selection)`
  answers `{ text, html }` for the selection that is open, in the two renders a
  document body has:
  - **inside the editor**: `EditorView.serializeForClipboard(selection.content())` —
    the same function ProseMirror's own `copy` handler calls, so the menu and ⌘C are
    byte-identical by construction and pick up the `docRef` rule and the markdown text
    flavor `DocEditor` configures. Nothing is re-derived, so the two cannot drift.
  - **outside it** (thread turns, `MarkdownView`, a locked body): the range's
    `cloneContents()` is the rich flavor and `selection.toString()` stays the plain
    one. Controls inside the range (`CodeFence`'s copy button) are dropped.
  - The editor path is taken only when the range actually sits inside
    `editor.view.dom`: a reader can hold an open editor while the selection is in a
    thread card beside it, and `editor.state.selection` keeps whatever it last held.
- `SelectionMenuItems.tsx` — `text: string` → `copy: SelectionCopy`;
  `clipboard.write([new ClipboardItem({...})])` with ordered degradations: no rich
  form or no `write` → `writeText`; a **rejected** `write` → `writeText` (Safari
  refuses a `ClipboardItem` built across an `await`, and losing the formatting beats
  losing the text). Cut and Paste keep their items, labels, order and
  remove-only-once-copied safety; Cut goes through the same write, because a cut that
  pasted worse than a copy would be its own defect.

### Post-fix flavor dump — right-click → Copy (real browser, real clipboard)

```
TYPES: ["text/plain","text/html"]
```

`text/html`:

```html
<h1 data-pm-slice="0 0 []">Quarterly memo</h1><p>Lead paragraph with <strong>bold</strong>
and <em>italic</em> and <code>code</code>.</p><h2>Findings</h2><ul><li><p>first bullet</p>
</li><li><p>second <strong>bold</strong> bullet</p></li></ul><ol>…</ol>
<ul data-type="taskList">…<li data-checked="true" …>…</li></ul><p>See <a target="_blank"
rel="noreferrer noopener" href="https://example.com/">the site</a> and
<span data-corpus-ref="doc_other" class="ref">Lender spreads</span>.</p>
<pre><code class="language-ts">const x = 1;</code></pre>
```

`text/plain`:

```
# Quarterly memo

Lead paragraph with **bold** and *italic* and `code`.

## Findings

- first bullet
- second **bold** bullet

1. one
2. two

- [ ] open task
- [x] done task

See [the site](https://example.com) and [[doc_other|Lender spreads]].

```ts
const x = 1;
```
```

Asserted in `clipboard.spec.ts`: `menu.html === keyboard.html && menu.text ===
keyboard.text` — the right-click Copy and ⌘C now put the same bytes on the clipboard.

### A second defect the follow-up exposed

`context-menu.spec.ts`'s "copies the selected text to the real clipboard" went red:
a phrase selected mid-sentence came out as `"6.4% this week.\n"`. `serializeDoc` ends
every document with a newline because a **file** ends with one, and words copied out
of a sentence are not a file — pasted into another sentence, that newline breaks the
line. Fixed in `sliceMarkdown`, and the first fix was wrong for an instructive reason:
`Selection.content()` on a dragged caret returns the enclosing **paragraph** with
`openStart`/`openEnd` of 1, never a bare inline fragment, so testing the fragment's
node type answers "blocks" for every real mid-sentence copy. The open depths are where
ProseMirror records it. A selection of whole blocks keeps the newline, which is what
makes a whole-document copy byte-identical to the file. `context-menu.spec.ts` now
passes **unchanged** — the test was right and the code was wrong.

### Follow-up checks

| Gate | Result |
| --- | --- |
| `vitest run apps/ui/src/menu apps/ui/src/editor` | **475 passed** / 23 files (12 new in `selectionCopy.test.ts`, 6 new flavor tests in `SelectionMenuItems.test.tsx`) |
| `tsc --noEmit` (apps/ui) | clean |
| `eslint` (menu + editor + spec) | exit 0, nothing suppressed |
| `prettier --check` (same) | clean |
| Playwright `clipboard` + `context-menu` + `editor` + `anchors` + `anchor-layer` + `fences` + `thread` + `todos` + `reader` | **92 passed** |

### Unresolved / escalated

- **"Externally addressable" has no v1 answer.** Nothing gives a Corpus document a URL
  a reader outside the app can follow (one `/` route, localhost server), so
  `refResolver` returns `href: null` for every document and refs always copy as plain
  title text. Both branches of the rule live in `clipboardSerializer` and both are
  unit-tested; the publish plugin (SPEC.md §13) is what would start filling `href` in.
  **Orchestrator confirmed as filed, 2026-08-02** — `href: null` for every v1 ref is
  the correct reading of the rider. No code change.
- Nothing else outstanding.

## PR #19 review follow-up (2026-08-03)

**Model: Opus 5 (`claude-opus-5[1m]`).** Agent: ui-dev. Branch: `dogfood-todos-polish`.
Real Chromium via Playwright against the real Vite dev server (`CORPUS_UI_PORT=5974`),
real system clipboard, `clipboard-read` + `clipboard-write` granted.

### MAJOR — `cleanPastedHtml` welded two lines into one word-run

`BREAK_HOSTS` was a hand-listed allowlist of block hosts (`p,h1…h6,li,td,th,blockquote,pre`)
and every `<br>` whose nearest matching ancestor was null was removed. `div`, `span` and
`section` were not on it, so `<div>line one<br>line two</div>` — what Gmail, Outlook web
and Slack put on the clipboard — cleaned to one paragraph with no separator.

**Red proof, at the markdown (not the HTML):**

```
FAIL a paste from anywhere but Google Docs > keeps both lines of a a div separated…
AssertionError: expected 'line oneline two\n' to be 'line one\\\nline two\n'
- line one\
- line two
+ line oneline two
```

Two more, from the same run (MINOR 1, the unconditional DOMParser round trip):

```
expected 'Acme6.1%' to be '<tr><td>Acme</td><td>6.1%</td></tr>'      (wrapMap lost the table)
expected '<p class="c1">strong words</p>' to be '<html><head><style>…'  (the <style> was dropped)
```

**Fixed two ways, both required.** (a) The whole clean-up is now gated on Google Docs'
own signature (`docs-internal-guid-` in the payload); anything else is returned byte for
byte and reaches ProseMirror's `readHTML` with its `wrapMap` and `<style>`-folding intact.
(b) The `<br>` rule is positive and asks the break's **neighbours** rather than its
ancestors: inline content on either side means it separates words and it stays; a block
element (or nothing) either side means it separates blocks and goes. An unrecognised tag
counts as inline, so the next tag nobody listed costs a stray `\` at worst instead of
losing a line.

`clipboard.test.ts` → **40 passed** (9 new: div/span/section/custom-element hosted breaks
kept, div-and-br surviving to the markdown for all three, bare `<tr>` fragment and a
class+`<style>` Word payload passed through untouched).

### MINOR — the menu's Paste was plain text while ⌘V was rich

The mirror image of the Copy defect this issue fixed. `SelectionMenuItems` read
`clipboard.readText()`; it now reads `text/html` through `clipboard.read()` when the
clipboard carries one and hands it to `captureReplace`, which selects the captured range
and calls `EditorView.pasteHTML` — the same function ProseMirror's own `paste` handler
calls, so the menu and ⌘V run one paste path. Degradations, in order: no `read`, a
refused `read`, or no rich flavor → `readText` exactly as before.

Real browser, real clipboard: `navigator.clipboard.write()` with
`<h2>Pasted findings</h2><ul><li>first pasted bullet</li></ul>`, `⌘A` in the body,
right-click → menu **Paste**, then the autosaved `PUT /api/docs/doc_note` body read off
the wire:

```
## Pasted findings

- first pasted bullet
```

— structure, not the flattened `Pasted findings first pasted bullet` the plain flavor
held (asserted absent).

### Checks

| Gate | Result |
| --- | --- |
| `vitest run apps/ui/src` | **1888 passed** / 118 files |
| `vitest run packages/kit/src` | **533 passed** / 35 files |
| Playwright `clipboard.spec.ts` | **13 passed** (2 new: Gmail div+br, menu rich paste) |
| Playwright `context-menu` + `editor` + `reader` + `todos` | **67 passed** |
| `tsc --noEmit` (apps/ui, packages/kit) | clean |
| `eslint` + `prettier --check` (apps/ui, packages/kit) | clean, nothing suppressed |

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
