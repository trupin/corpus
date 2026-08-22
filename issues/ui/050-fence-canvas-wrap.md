# [UI-050] Fenced canvases: wrap long lines, and collapse tall blocks

## Domain
ui

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: SHARED-009 (Amendment 5)
- Blocks: —

## Spec References
- SPEC.md §10 Thread view, copyable-canvases sentence as amended by SHARED-009
  Amendment 5

## Summary
Live report 2026-08-03: _"Snippets should show in canvas, but the content should
be wrapped rather than linear. Right now it shows the content as a horizontal
scroll where long lines need to be scrolled horizontally in order to be
visible."_ The user chose **always wrap** over a per-block toggle.

Current behavior, measured: `markdown.css` sets `.doc-body pre { overflow-x:
auto }` and declares **no** `white-space`, so the `<pre>` keeps the UA default
`white-space: pre` and long lines scroll sideways. `.doc-body` is bounded at
`62ch`, so in a narrow column a long fence line becomes a small horizontal
scroller. `CodeFence` is installed as `pre` on `MarkdownView`, so this is
identical in the reader, in thread turns, in focus mode and on plugin surfaces.

No test pins the current overflow anywhere (`CodeFence.test.tsx` and
`fences.spec.ts` contain no `overflow` assertion), so this is free to change.

**Second report, same surface (2026-08-03):** _"Let's add a way to collapse
snippets when they have a lot of content."_ Wrapping makes tall blocks taller —
a long prompt that used to be one scrollable line becomes twenty — so these two
belong in one design rather than being solved twice.

Collapse a block that exceeds a height threshold, with an affordance to expand
it. Choose the threshold on evidence: look at what the agent's turns actually
contain in a real workspace, not a round number. State the number and the
reason in the code.

**The invariant that must not break: the copy button always puts the WHOLE block
on the clipboard, collapsed or not.** A copy that silently yields only the
visible portion would be far worse than no collapse at all — that is the failure
mode to write a test against first.

## Acceptance Criteria
- [x] Long lines wrap inside the fence canvas; no horizontal scrollbar
- [x] A block taller than the threshold renders collapsed with a clear expand
      affordance that states there is more (not a bare fade)
- [x] Expanding and re-collapsing is reversible, and the state is per block
- [x] **Copy yields the entire block whether collapsed or expanded** — a test
      asserts this against a block several times the threshold
- [x] The collapsed state does not hide the fence's label or the copy button
- [x] Blocks under the threshold are visually unchanged from today
- [x] Keyboard-reachable: the expand control is focusable and operable, and
      screen readers are told the block is truncated
- [x] The threshold is justified in the code, not a magic number
- [x] Wrapping preserves the raw text exactly — the copy button still puts the
      original line structure on the clipboard, unwrapped (this is the property
      most at risk: do not let a CSS change become a content change)
- [x] Indentation and leading whitespace survive wrapping (continuation lines
      must not lose the block's shape)
- [x] Applies identically in the reader, thread turns, focus mode and plugin
      surfaces — one rule, one place
- [x] The editor's own code blocks and `.md-raw` are considered: say whether they
      follow or deliberately keep scrolling, and why (`editor.spec.ts:130` pins
      `.md-raw` `white-space: pre` — do not break it accidentally)
- [x] A test pins the new behavior so the next change is deliberate

## Technical Design
### Files to Create/Modify
- `packages/kit/src/markdown/markdown.css` — the `.doc-body pre` / `.fence-canvas`
  rules
- Tests in `packages/kit/src/markdown/CodeFence.test.tsx` and/or
  `apps/ui/e2e/fences.spec.ts`

## Testing Strategy
Assert computed style and, better, actual geometry: a long line's rendered box
must not exceed the canvas width. Round-trip the copy button against a block with
long lines to prove the clipboard text is unchanged.

## E2E Verification Log

**Model: Opus 5 (1M context).** Implemented with UI-054 (same files).

### The threshold, and the evidence behind it
`--fence-collapsed-height: 420px` in `markdown.css` — the only place the number
lives; `CodeFence` never reads it, it asks the laid-out box whether there is
more than it shows (`scrollHeight > clientHeight + 4px`).

420px ≈ **20 lines** of the block's own type (12.5px mono × 1.62 line height ≈
20.3px, plus the block's 20px of vertical padding). Twenty is measured, not
round. Every fenced block in the live workspace at `~/cos/data` (37 blocks, 162
documents) was measured at this canvas's ~60 columns:

| | logical lines | visual lines @60 col |
|---|---|---|
| median | 7 | **10** |
| p75 | 14 | **20** |
| p90 | 19 | 39 |
| max | 84 | 125 |

All **37/37** blocks contain a line wider than the canvas — the wrap report is
not an edge case. Twenty visual lines is simultaneously the p75 and twice the
median, so ~3/4 of real blocks are visually untouched and the quarter that
collapse are the ones that swallow a column (the tallest is 125 lines).
Thresholds considered: 8–12 lines collapses ~half of all blocks (too eager);
30 collapses 16% and still leaves a 30-line wall.

### Real browser (Chromium via Playwright, dev server on `CORPUS_UI_PORT=5985`)
A turn with a 59-line `prompt` fence whose second line is 400 unbroken
characters, opened in the column reader:

```
FENCE-COLLAPSED {"whiteSpace":"pre-wrap","overflowWrap":"anywhere",
                 "scrollWidth":425,"clientWidth":425,
                 "scrollHeight":1624,"clientHeight":418}
MORE-LABEL      Show all 59 lines | aria-label "Show all 59 lines of the prompt block"
COPY-WHILE-COLLAPSED chars 986 lines 59 exact true leading-indent-kept true
FENCE-EXPANDED  {"scrollHeight":1624,"clientHeight":1624}
```

- **Wrap**: `scrollWidth === clientWidth` (425/425) with a 400-column line —
  no horizontal overflow, so no scrollbar. Before the change the same `pre` had
  the UA `white-space: pre` and `overflow-x: auto`.
- **Copy while collapsed**: the clipboard held all **986 characters / 59 lines**,
  `=== FENCE` byte for byte, while the box was showing 418px of 1624px (26%).
  The two-space indent of the continuation lines came back intact.
- **Expand**: `clientHeight` 418 → 1624; re-collapsing returned it to 418.
- **Keyboard**: `focus()` the control, press `↵` → expands (`aria-expanded`
  flips to `true`). The board's global `↵` handler does not eat it — the toggle
  claims its activation keys the way the copy button does.
- **Screenshots**: `/tmp/fence-collapsed.png`, `/tmp/fence-expanded.png`. The
  first pass fade let a line of code read *through* the "Show all…" label; the
  gradient now reaches `--surface-2` at 55% and the last visible line dissolves
  into the cut edge.

### The editor, measured rather than assumed
A note document with a 300-character `sh` code block and a raw-HTML block, in
the real always-editable surface, before and after the new declarations (removed
live through CSSOM to get the "before"):

```
EDITOR-CODE-BLOCK        {"tag":"PRE","whiteSpace":"pre-wrap","overflowWrap":"anywhere",  "scrollWidth":404,"clientWidth":404}
BEFORE-EDITOR-CODE-BLOCK {"tag":"PRE","whiteSpace":"pre-wrap","overflowWrap":"break-word","scrollWidth":433,"clientWidth":433}
EDITOR-MD-RAW            {"tag":"PRE","classes":"md-raw","whiteSpace":"normal","overflowWrap":"anywhere"}
BEFORE-EDITOR-MD-RAW     {"tag":"PRE","classes":"md-raw","whiteSpace":"normal","overflowWrap":"break-word"}
```

**The editor's blocks follow, and always did.** ProseMirror's own base stylesheet
carries `.ProseMirror pre { white-space: pre-wrap }`, and the editor's content
element carries `doc-body` (`DocEditor.tsx:207`) — so an editable code block was
already wrapping before this issue, and `.doc-body pre`'s new `pre-wrap` is the
same value it already computed. What genuinely changes there is
`overflow-wrap: anywhere` (from a global `break-word`), which is strictly better
for unbreakable tokens. **The editor deliberately does not collapse**: the
collapse lives in `CodeFence`, which is a `MarkdownView` override and reaches no
editable surface — clipping text a caret can move into is not a trade worth
making (`collapsed: false` measured on the editor's block above).

`.md-raw` is **untouched**: identical computed `white-space` before and after
(`normal` in both). Two findings for the record, neither caused here and neither
fixed here: `editor.css`'s `.md-raw { white-space: pre }` never wins in the real
app (`.ProseMirror pre` and now `.doc-body pre` are both more specific), and
`editor.spec.ts:130` pins that rule against an isolated `<div class="doc-editor">`
fixture that has neither ancestor — so it asserts a value the running app does
not show. That is UI-056's territory (e2e stub fidelity); the assertion still
passes, unchanged.

### Tests
- `packages/kit/src/markdown/CodeFence.test.tsx` — 24 tests (8 new), including
  the singular case the reports began with: a 400-column block is *one* line
  until it wraps, so the control says "Show the whole line". The
  copy-while-collapsed invariant was written **first** and failed against the
  pre-change component. jsdom has no layout, so the two lengths the component
  reads are stubbed on `HTMLPreElement.prototype`; the geometry itself is the
  browser's job above.
- `apps/ui/e2e/fences.spec.ts` — 4 new specs (wrap geometry, copy while
  collapsed + expanded, keyboard expand, a block that fits is untouched).

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
