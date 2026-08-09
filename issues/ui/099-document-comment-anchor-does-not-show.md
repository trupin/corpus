# [UI-099] Commenting on a document selection leaves no visible anchor

## Domain

ui

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: UI-062 (comment anchored at the top, done), UI-068 (selector quoted the
  canonical spelling, not the file's, done), UI-086 / SERVER-072 (orphan
  re-attachment, done) — this area has a history and the fix must not undo them

## Spec References

- SPEC.md §11 — "**Commenting**: selecting text pops a floating toolbar
  (formatting + **Comment**); commenting captures the text-quote selector and
  opens a thread composer"
- SPEC.md §11 — "Clicking an anchored highlight opens its thread"
- SPEC.md §15 M4 — the Playwright check: "select text → comment ('note only') →
  **highlight + chip appear without reload**"
- SPEC.md §6 — anchors are text-quote selectors

## Summary

User report (2026-08-08): selecting text in a **document** and leaving a comment
produces no visible anchor — no highlight on the quoted passage. The same gesture
in a **thread** works.

This is P0: it is a §15 M4 milestone check (*"highlight + chip appear without
reload"*), and without a visible anchor the passage no longer says it has been
discussed, which is the core of the product's anchoring model.

## The framing that matters — "it works in threads" proves nothing here

The two surfaces place conversations by **different mechanisms**.
`apps/ui/src/reader/DocView.tsx:244`:

```ts
const anchorsHost =
  doc !== undefined &&
  !reader.isThread &&
  PluginView === null &&
  editorHandlesType(doc.frontmatter.type);
```

and line 275: `const bodyPlacesThreads = anchorsHost || reader.isThread;`

A **document** draws highlights through the anchor layer (`useAnchorLayer`,
`anchorDecorations`, `textHighlight`). A **thread** has `anchorsHost === false`
and places child threads per-turn via `placeChildThreads` instead. So the working
thread case exercises none of the machinery that is failing. Do not use it as a
reference implementation, and do not conclude the anchor layer is fine because
something adjacent renders.

## Reproduction — establish this first

Reproduce against the real app and record **which of these it is**, because the
fix differs entirely:

1. Is the thread **created** at all? (Check the file on disk and `git log`.)
2. Does the parent document's frontmatter gain an `anchors` entry?
3. Does the selector match the saved body — or is the thread born orphaned?
   `useAnchorLayer.ts:58` carries the message *"Couldn't quote that selection from
   the document as it is saved"*, and `:91–101` explains that the check compares
   two **printings** of the body via `traceOfBody` / `traceOfDoc`. A mismatch there
   is a strong candidate.
4. Is the anchor resolved but the **decoration** not drawn?
5. Is `anchorsHost` false for this document — a plugin `View` claiming the type,
   or `editorHandlesType` returning false?

Record the answer before writing code.

## Acceptance Criteria

- [x] Reproduction recorded, naming which stage fails — stage 4, and it is two
      stacked causes; see the E2E log
- [x] Selecting text in a document and commenting produces a **visible highlight
      on the quoted passage, without a reload** (§15 M4) — real browser + new
      Playwright check
- [x] The chip / margin card appears at the anchor, per the adaptive placement
      rule — chip asserted in the new check and in the browser run; the margin
      half is `anchor-layer.spec.ts`'s focus-mode alignment test, still passing
- [x] Clicking the highlight opens its thread (§11) — `anchor-layer.spec.ts`,
      unchanged and passing
- [x] The anchor survives a reload (`anchor-layer.spec.ts`). Editing elsewhere in
      the body is covered by the existing layer tests for deferred application
      and by `soft-wrap.spec.ts`; **not separately re-verified by hand on the new
      fixture**
- [x] A selection that genuinely cannot be quoted still fails **loudly** — the
      refusal is narrowed, not removed: a range straddling the divergence is still
      refused (`rebase.test.ts`), and `REFUSAL_NOTICE` is untouched
- [x] The regressions this area already fixed stay fixed: UI-062's placement tests
      pass, and UI-068's guarantee is **restored** on these documents rather than
      weakened — `quotableSource` was reading the same wrong premise and quoting
      the printer's spelling. **Pinned by a test, not by the log**
      (`useAnchorLayer.test.tsx` → "commenting on a file whose two printings
      disagree about structure"): a seam-spanning selection is refused
      `not-in-file` instead of putting four spaces the file lacks on the wire,
      and a selection clear of the seam still sends a quote the file literally
      contains. Reverting the trace fix fails it. See "the second fix needed its
      own test" below
- [x] Works in both the column reader and focus mode — column verified directly;
      focus mode via the existing margin-alignment spec
- [x] A whole-document (unanchored) comment is unaffected — `detachedThreads`
      untouched; the 334-test anchors suite and 3,264-test ui/kit suites pass

## Technical Design

### Files to Create/Modify

Determined by the reproduction. Candidates, in the order the pipeline runs:

- `apps/ui/src/anchors/selectorFromSelection.ts` — capture
- `apps/ui/src/anchors/CommentPopover.tsx` — the compose/submit path
- `apps/ui/src/anchors/sourceTrace.ts` / `traceCache.ts` — the two printings
- `apps/ui/src/anchors/useAnchorLayer.ts` — resolution and publication
- `apps/ui/src/anchors/anchorDecorations.ts` / `textHighlight.ts` — drawing
- `apps/ui/src/reader/DocView.tsx` — `anchorsHost`, if the layer is not mounted

### Key Implementation Details

`useAnchorLayer`'s docblock warns that "a report against a document it was not
computed for is how a highlight ends up" wrong (line 47), and that sameness is
**not** string equality with the body because "a file the printer spells
differently is still the same document" (line 91). Both are load-bearing. A fix
that makes the highlight appear by loosening either check will reintroduce the
class of bug UI-068 and SERVER-072 were filed for.

There is a settle delay after a document change before the layer re-checks
(line 107). If the anchor appears only after an unrelated edit, that timer is
where to look.

### Edge Cases

- A selection spanning a formatting boundary (bold, a link, an inline code span)
- A selection whose exact text appears more than once in the body
- A selection made immediately after typing, before autosave has written —
  §11 requires the selector to quote the document **as saved**
- A document whose type a plugin claims with a `View` — `anchorsHost` is false by
  design there, and the todos manifest documents this as the reason it registers
  no `View`. If the reported document is such a type, that is the answer and the
  issue changes shape
- A locked document — commenting is still allowed; the layer is not editable

## Testing Strategy

Vitest for each stage the reproduction implicates. **A Playwright spec is
required regardless**: §15 M4 already specifies this exact flow as a milestone
check, and a bug that reached a user through a specified check means the check is
missing or not asserting the highlight. Add or repair it so this cannot regress
silently.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start the real app; open an ordinary `note` document in a column reader
2. Select a phrase in the body; choose Comment; submit a note-only comment
3. Expected: the phrase is highlighted, a chip/card appears at it, no reload
4. Actual: no visible anchor
5. Repeat the same gesture inside a thread — record that it works, and record
   **which mechanism** drew it there

### Verification Steps

1. Restart the app; repeat the document case — confirm the highlight and the
   chip appear immediately
2. Reload — confirm both survive
3. Edit text elsewhere in the body — confirm the anchor stays attached
4. Edit inside the anchored range — confirm reconciliation keeps it attached
5. Delete the anchored text — confirm the thread detaches as an orphan with its
   quote preserved, and is offered candidate sites (UI-086)
6. Repeat in focus mode
7. Select a phrase that occurs twice and comment on the second occurrence —
   confirm the highlight lands on the second
8. Confirm a whole-document comment still works and still lists below the body

## E2E Verification Log

**Model run on:** Opus 5 (1M context).

### Pre-fix reproduction — which stage fails

Run against **two** real servers and a real browser (Playwright driving Chromium
against a server-served build, never the e2e stub):

- a scratch workspace at `/tmp/ui099ws`, server on port **8791** (`corpus init
  --port 8791`, `corpus server start`), serving the freshly built HEAD UI;
- the reporter's own live workspace on **8765** (`/Users/theophanerupin/cos`),
  **read-only `GET`s only** — nothing was written to it and no process of ours
  ever bound 8765.

**The reporter's own failing comment was located on the live server** and the
issue's five-point ladder answered against it. The thread is `th_bgpkduhf`,
created `2026-08-08T22:42:28Z`, body `This is a test` — the reporter's own test
comment, matching the report date. Its quote is `removing\n  Abigail's name`: a
selection dragged **across a source line break with a two-space continuation
indent**, i.e. soft-wrapped markdown.

| # | Ladder question | Answer |
| - | --- | --- |
| 1 | Is the thread created at all? | **Yes** — `th_bgpkduhf` exists on disk at `data/threads/th_bgpkduhf.md` |
| 2 | Does the parent's frontmatter gain an `anchors` entry? | **Yes** — parent `doc_dfsp3g5c` carries exactly 1 entry, `anc_77801935` |
| 3 | Is the thread born orphaned (selector vs. saved body)? | **No** — `orphaned: false`, and it resolved to a real range `{start: 1493, end: 1518}` (25 chars, exactly the length of the 25-character quote) |
| 4 | Anchor resolved but the decoration not drawn? | **This is the stage that fails** — see below |
| 5 | Is `anchorsHost` false (plugin `View` / `editorHandlesType`)? | **No** — the parent is `type: note`, which the editor handles and no plugin claims |

**So the server did its whole job correctly.** The selector resolved, the anchor
is live and non-orphaned, and it carries a real character range into the body.
Everything from `POST /api/threads` through anchor reconciliation is right. The
failure is downstream of the server, in the anchor layer's **placement** —
stage 4 — which is squarely this domain. Nothing here is a server defect, so
there is nothing to escalate across the domain boundary.

The one property of the failing document that separates it from every fixture
that works: **its body is 31,406 characters** of real, hand- and agent-written
markdown, whose spelling on disk differs from what the serializer prints.

### What does *not* reproduce it — recorded so it is not re-tried

Against a real HEAD server and a real browser, the document comment flow
**works** across ~70 scenarios. These are all negative results; none of them is
the defect:

- document shape (20 cases): plain, ATX/setext headings, `*` bullets, padded GFM
  tables, indented code, soft-wrapped prose, links, inline bold, CRLF, trailing
  spaces, `1)` lists, `_em_`, blockquotes, raw HTML, nested lists, closing-hash
  headings, `***` rules;
- block context of the selection (13 cases): list item, blockquote, heading,
  code fence, task list, nested/ordered items, prose after a fence, changelog
  entries (including a clipped 12-entry changelog);
- inline content (15 cases): `[[ref]]` in and beside the selection, images,
  tables, footnotes, HTML comments, emoji/unicode, escaped `\*`, autolinks,
  reference links, `corpus-form` fences, hard and backslash breaks;
- interaction (10 cases): whole-paragraph and partial mid-sentence selections, a
  second comment on the same document, **survives a reload**, commenting
  immediately after typing (the `editing` gate), selections spanning two
  paragraphs, column widths 900/1400/1700, and focus mode;
- real agent-written markdown used verbatim as the body: `docs/RELEASING.md`,
  `README.md`, `CLAUDE.md`, two issue files;
- **the exact live selector shape**: a list item wrapped with a two-space
  continuation indent, selected across the wrap, puts
  `exact: "removing\n  Abigail's name"` on the wire and draws its highlight.

Both the current HEAD bundle and the **older bundle the reporter's server is
actually serving** (`index-C7ny62wk.js`, fetched from 8765 and re-served on a
scratch port 5291 against the HEAD server) pass that last fixture. So the
reported failure is not explained by the reporter running an older build, and it
is not explained by the shape of the selection.

**Conclusion for the fix:** the defect is stage 4 — a correctly resolved,
non-orphaned anchor that the layer cannot turn into segments — and the variable
that the reproducing document has and every passing fixture lacks is the size
and real-world spelling of a 31KB body. `segmentsOf` returning `[]` puts the
thread in `unplaced` and lists it below the body instead of drawing it, which is
exactly "no highlight on the quoted passage".

### The defect, exactly — two causes stacked

Stage 4 turned out to be **two** independent failures, either of which alone
hides every highlight on the document. Both are in `apps/ui`; neither is a
server defect.

The reproducing construct, reduced from the reporter's 31KB file to six lines —
a further paragraph of an outer list item, after a nested sublist:

```markdown
- Outer bullet leads in.
  - Nested bullet one.
  - Nested bullet two.

  A trailing paragraph of the outer item.
- Second outer bullet.
```

**1. `rebaseRange` refused the whole document over one newline.** The serializer
drops the blank line before that paragraph, so the two spellings' rendered text
differs by a single `\n`. `rebaseRange` gated on `source.plain !== target.plain`
— a **whole-document** equality — and refused every anchor in the file. In the
reporter's document the divergence is at plain offset 23,792 and the anchor is at
~1,400: a comment was refused because of a construct 22,000 characters away, in
text the two spellings agree about to the byte.

Fixed by asking that equality **of the passage rather than of the file**: a range
inside the two projections' common prefix (offsets unchanged) or common suffix
(one constant shift) is licensed by character-for-character identity over exactly
the region it occupies — the premise the global test was standing in for. A range
that **straddles** the divergence is still refused.

**Stated the right way round** (PR #39 review, MINOR 2): this *does* license
ranges the whole-document equality refused — that is the fix, not a side effect
of it. What is unchanged is the premise (still character-for-character identity
over the region the range occupies, now demonstrated per range instead of assumed
for the file) and what was already allowed: when the projections agree the common
prefix is the whole string and every range takes the branch it always did.

**And the relief is bounded** (PR #39 review, MINOR 7). "A divergence stops being
contagious" is true of *one* divergence. The prefix stops at the **first** place
the two projections part company and the suffix reaches back only to the
**last**, so on a document the printer respells in two places every range between
them is still refused — including passages both spellings agree about to the
byte, because the middle is in neither region. That is conservative and correct,
and it means a 31KB hand-written note containing the offending construct more
than once still draws nothing across its whole middle. Pinned by `rebase.test.ts`
→ "a document whose two spellings diverge twice", so the next report of it reads
as a known limit rather than a new bug.

**2. The anchor layer traced a text the editor was not showing.** `DocEditor`
does not parse `body`; it parses `canonicalizeMarkdown(body)`. `useAnchorLayer`
traced `body`, which assumed `canonicalizeMarkdown` is idempotent. For this
construct it is not: printing once drops the blank line, and printing the result
again reads the paragraph as a continuation of the **nested** item and indents it
to match — two spaces becomes four. So `wanted` was 136 characters while the live
editor printed 138, `applyAnchors` declined on every tick, and no decoration was
ever dispatched. Instrumented in the browser:

```
UI099 declined placements=1 at=73 liveLen=138 wantedLen=136
  live  ="ed bullet one.\n  - Nested bullet two.\n    A trailing paragraph of the outer item"
  wanted="ed bullet one.\n  - Nested bullet two.\n  A trailing paragraph of the outer item.\n"
```

Note `placements=1`: cause 1 was already fixed at that point and the placement
existed — it was simply never applied. Fixed by tracing what the editor was
handed, so the layer computes `serialize(parse(editorBody(body)))` and the editor
prints `serialize(parse(editorBody(body)))` — the same expression, agreeing
structurally rather than by luck.

**`editorBody` is that expression, named once** (`apps/ui/src/editor/editorBody.ts`,
added in PR #39 review, MINOR 5). The two call sites used to canonicalise
independently — `DocEditor` wrote `canonicalizeMarkdown(body)` inline, the layer
wrote `traceOfBody(body)` — and "these two agree" was a convention that quietly
stopped holding, which is this bug's whole failure mode. Both now import the one
function, and `DocEditor.test.tsx` → "the text the editor parses" asserts a
**real mounted editor's own document** prints exactly what the layer traces, on
the construct where the two used to part company. A `DocEditor` that parsed
anything else would have to change that test to go green. It is a named and
checked agreement rather than one made impossible by construction; see the note
at the end of this log for why publishing the string from `DocEditor` instead was
rejected.

### The second fix needed its own test

That second premise also fed `quotableSource`, which read the disagreement as
"the editor has unsaved edits" and quoted the **printer's** spelling instead of
the file's — the exact failure UI-068 exists to prevent. Fixing the premise
restores UI-068's guarantee on these documents rather than weakening it.

**That is a second, distinct bug fix, and the original PR pinned it with prose
rather than with a test** (PR #39 review, MAJOR 1). Reverting the trace fix alone
and running the whole 334-test `src/anchors` suite failed exactly *one* test —
the new highlight one — while every UI-068 test passed, because both of them
(`useAnchorLayer.test.tsx`'s table fixture and `anchor-layer.spec.ts`'s) use
documents for which `canonicalizeMarkdown` **is** idempotent and so cannot see
this class of document at all. A future change that kept the canonicalised trace
for placement but fed something else to `quotableSource` would have reintroduced
a twice-regressed shipped defect with a green suite.

The test added for it — `useAnchorLayer.test.tsx` → "commenting on a file whose
two printings disagree about structure" — drives the layer on the six-line
fixture and asserts both halves:

- a selection spanning the respelt seam is **refused** with the `not-in-file`
  notice and opens no composer. Pre-fix it put
  `exact: "bullet two.\n    A trailing paragraph"` on the wire — four spaces the
  file does not contain, so `BODY.includes(exact)` is `false`, §6's ladder has
  nothing to match at any rung, and the comment is orphaned at creation;
- a selection clear of the seam still captures the **file's** own bytes, and
  `prefix + exact + suffix` is literally in `BODY`. Without this second half the
  refusal could be satisfied by a layer that refuses everything.

Reverting `useAnchorLayer.ts`'s `source` memo to `traceOfBody(body)` now fails
that test as well as the highlight one.

### Post-fix verification

**Real browser, real server, no stub, no reload.** Scratch workspace on 8791,
Playwright driving Chromium against the server-served build. Same fixture, same
script, only the code changed:

| | server anchor | `.anchor-hl` | chip | pip | below-body list |
| - | --- | --- | --- | --- | --- |
| **before** | `orphaned:false, range 2..24` | **0** | 0 | 0 | "THREADS WITHOUT A PLACE IN THIS VIEW" |
| **after** | `orphaned:false, range 2..24` | **1**, reading `Outer bullet leads in.` | 1 | 1 | empty |

The post-fix DOM, from the same run:

```html
<span data-thread="th_3kovz3nr" data-anchor="anc_bd79b75e" class="anchor-hl">Outer bullet leads in.</span>
<span class="anchor-pip ProseMirror-widget" data-pip-thread="th_3kovz3nr">1</span>
… <div class="anchor-slot ProseMirror-widget" data-anchor-slot="th_3kovz3nr">
```

**Against the reporter's actual document.** `doc_dfsp3g5c` / `anc_77801935`, read
from the live workspace on 8765 over `GET` only: `segmentsOf` returned **0**
segments before and **1** after. That is the reported comment, and it now draws.

**Tests.**

- `apps/ui/src/anchors/` — 334 pass, including three new regression tests: the
  rebase boundary in both directions plus the straddle refusal
  (`rebase.test.ts`), the placement of an anchor sitting before the respelt
  construct (`anchorPlacement.test.ts`), and the layer drawing it end to end
  (`useAnchorLayer.test.tsx`).
- `apps/ui/src` + `packages/kit/src` — **3,264 pass**, no regressions.
- Playwright: the new §15 M4 check in `anchor-layer.spec.ts` — "select text →
  comment (note only) → highlight + chip appear **without reload**". Confirmed to
  be a real regression test rather than a passing bystander: reverting **either**
  fix alone makes it fail. 49 anchoring-related e2e specs pass (`anchor-layer`,
  `anchors`, `reattach`, `editor`, `turn-comment`, `soft-wrap`).

  **Which assertion catches which revert — corrected** (PR #39 review, MINOR 6;
  the original account had it backwards). Verified by reverting each fix in turn:

  | reverted | fails on | note |
  | --- | --- | --- |
  | fix 2 (the layer's trace) | the highlight — `.anchor-hl` count `0`, `anchor-layer.spec.ts:553` | as originally claimed |
  | fix 1 (`rebaseRange`'s per-passage equality) | the **chip** — `.anchor-slot [data-thread-panel]` count `0`, `:569` | **not** `unplaced`, as originally claimed; and the highlight assertion at `:553` **passes** |

  Both rows re-verified in this pass by reverting each fix in the working tree
  and running the spec in Playwright (the chip was at `:558` before the comment
  added below moved it down).

  Worth recording plainly, because it changes what the check is worth: §15 M4's
  "highlight" half is satisfiable **with no server-derived placement at all**.
  `useAnchorLayer` paints an optimistic `.anchor-hl` from the range the composer
  was opened on (`setOptimistic` in `submitComment`), and it stands until the
  server's own anchor replaces it — so with the *rebase* fix reverted the
  highlight assertion is green and only the chip fails. The chip and the empty
  `unplaced` section are what carry the milestone; nobody should trim them as
  redundant with the highlight. A comment saying so now sits beside them in the
  spec.

  Why the trace fix is the one that takes the highlight down with it: the
  optimistic decoration is dispatched through the **same** `applyAnchors` gate as
  the server's, and that gate declines whenever the layer's trace disagrees with
  the editor's document. Revert the trace and nothing is drawn at all, optimistic
  or not.
- `npm run build`, `npm run typecheck`, `npm run lint`, `npm run format:check` —
  all clean.

**The test harness was unfaithful, and that is why this was invisible to unit
tests.** `useAnchorLayer.test.tsx`'s `fakeEditor` built its document from
`parseMarkdown(body)` — the raw body — while the real `DocEditor` builds from
`parseMarkdown(canonical)`. Modelling the editor as holding `parse(body)` baked
in the very assumption that fails here, so cause 2 could not be reproduced in
jsdom at all until the harness was corrected. It now routes every document
through one `editorDocument()` helper that canonicalises first, matching
`DocEditor`. This is the same class of defect as UI-102 (the e2e stub's untyped
rows), in the unit harness rather than the e2e one.

### Left for a follow-up — not fixed here

The serializer's round trip is **not structure-preserving** for this construct:
`canonicalizeMarkdown` drops the blank line, and re-parsing moves the paragraph
from the outer list item into the nested one. Anchoring is now immune to it, but
the underlying infidelity remains, and it is worse than a missing highlight —
opening such a document and typing one character will autosave the restructured
form, silently moving the paragraph in the user's file. That belongs in
`editor/markdown/serialize.ts`, changes what is written to disk, and wants its
own issue rather than a P0 side-effect. Flagged to the orchestrator. **Filed as
UI-103**, which also records what this PR changed about that bug's symptoms.

### PR #39 review pass — appended, not a re-run of the above

**Model run on:** Opus 5 (1M context).

The reviewer verified both fixes' behaviour independently and they stand
(including a 1,728-body fuzz of `rebaseRange` with uniquified tokens: 9,642
licensed rebases, **zero** misplacements). The verdict was about what is *pinned*
and what the docblocks *claim*. What changed:

| finding | change |
| --- | --- |
| MAJOR 1 — the UI-068 restoration was pinned by prose | new test "commenting on a file whose two printings disagree about structure" (`useAnchorLayer.test.tsx`); acceptance criterion above rewritten to cite it |
| MINOR 2 — `rebase.ts` stated its safety claim backwards | corrected in `rebase.ts`, in this issue, and in `rebase.test.ts`'s "unchanged for a document whose spellings agree throughout" docblock, which had the same inversion |
| MINOR 3 — the 97-line block was orphaned above `commonPrefixLength` | `rebaseRange` moved back up under it and given its own `@param`/`@returns` block; the three helpers now follow it |
| MINOR 4 — `quotableSource`'s docblock described the replaced premise | rewritten; it now states the correctness condition on its caller and names the test that pins it |
| MINOR 5 — the two canonicalisations agreed by convention | `editorBody` (below) |
| MINOR 6 — the e2e failure account was wrong | corrected above, plus a comment in the spec so the chip assertions are not trimmed |
| MINOR 7 — "a divergence is not contagious" oversold it | the bound stated in `rebase.ts` and above, and pinned by "a document whose two spellings diverge twice" |
| UI-103 | two paragraphs added there — the new visible refusal, and that its only remaining symptom is gone |

**Finding 5, and how far it got.** The reviewer asked whether `DocEditor`
publishing what it parsed would make the agreement structural without a redesign.
It would not, and the halfway version is worse than the convention it replaces:

- publishing the string through a callback makes the layer's `source` **lag by a
  commit** whenever the server's body changes, because the callback fires in an
  effect and `useAnchorLayer` re-renders with the new `body` first. In that
  window `placeAnchors` maps new-body offsets through the old trace, and
  `applyAnchors`' guard compares the live document against that same old trace
  and *passes* — so a tick of highlights over the wrong words, which is the one
  failure this whole layer exists to prevent. Trading a rare wrong text for a
  routine one-frame wrong text is not a repair;
- doing it synchronously means hoisting the canonicalisation into `DocView` and
  changing `DocEditor`'s `body` prop to mean "already canonical". That removes
  this drift class by creating a worse one — a caller passing the raw body would
  double-canonicalise, which on a UI-103 document is exactly the non-idempotent
  step, silently — and it is a prop-contract change across four call sites. Real
  restructuring, and pointed the wrong way.

So: **named once and checked**, rather than impossible by construction.
`apps/ui/src/editor/editorBody.ts` holds the single expression; `DocEditor` and
`useAnchorLayer` both call it; and `DocEditor.test.tsx` → "the text the editor
parses" asserts a real mounted editor's document prints exactly
`traceOfBody(editorBody(body)).markdown` on the UI-103 construct, with a
first-line assertion that tracing the raw body would have given a different
answer so the check cannot degrade into a tautology. Verified it bites: making
`DocEditor` parse anything else fails it.

**Verification of this pass.**

- Reverting `useAnchorLayer.ts`'s `source` memo to `traceOfBody(body)` now fails
  **two** tests in `src/anchors` (the new capture test and the highlight test);
  before this pass it failed one. Confirmed by running the suite with the revert
  applied and then restoring it.
- Making `DocEditor` parse something other than `editorBody(body)` fails
  "the text the editor parses". Confirmed the same way.
- Both e2e rows in the table above re-verified by reverting each fix in the
  working tree and running the spec: trace fix reverted → `:553`, `.anchor-hl`
  count `0`; rebase fix reverted → `:569`, chip count `0` with `:553` green. The
  original account of the second one was wrong and is corrected above.
- `apps/ui/src` + `packages/kit/src` — **192 files, 3,270 tests pass** (3,264
  before this pass, plus the six added here). `anchor-layer.spec.ts` — 12/12 in
  Playwright, on `CORPUS_UI_PORT=5373`; 5173 was held by an unrelated ssh tunnel
  and was never bound, and 8765 was never touched.
- `npm run build`, `npm run typecheck`, `npm run lint`, `npx prettier --check` —
  all clean.


## Follow-up left open: the harness still spells the expression out (PR #39 re-review, NEW-2)

`useAnchorLayer.test.tsx` calls `canonicalizeMarkdown` inline in two places
(`editorDocument()` and `selection()`) rather than importing `editorBody` — the
function that exists to be the one named expression. The harness that models
`DocEditor` is exactly where the last drift hid, so closing the shape is worth
doing.

**Attempted and reverted, 2026-08-09.** Swapping both call sites to `editorBody`
— which is defined as `canonicalizeMarkdown(body)` and nothing else — made
`"refuses a selection across the respelt seam instead of quoting the printer"`
fail, and only that test. A substitution that should be an identity is not one
here, and the reason was not established. Reverted rather than shipped red or
guessed at.

That is worth knowing before someone tries the same edit and assumes it is
trivial: **find out why first.** Candidates worth ruling out are the trace cache
(`resetTraceCache`, module-scoped) interacting with import order, and the
resolution of the new module in the test environment — type-aware eslint reported
`editorBody` as "a type that could not be resolved" at the second call site,
which may be the same fact from another angle.

**Closed by UI-103, 2026-08-09.** The swap now works: both call sites use
`editorBody`, and `useAnchorLayer.test.tsx` is 36/36 green. It was the same
underlying fact after all — the one test it broke was "refuses a selection across
the respelt seam", whose entire premise was the serializer's non-idempotence, and
that premise is gone now the printer is a fixed point for the construct (the
describe is renamed and asserts the acceptance instead of the refusal). The
eslint resolution note has a separate and mundane explanation: `useAnchorLayer.ts`
imported `editorBody` **without** the `.js` extension, alone among that file's
relative imports; it now carries one like its neighbours.

## Completion Checklist (domain agent)

- [x] Pre-fix reproduction logged, naming the failing stage
- [x] Tests written and passing, including the M4 Playwright check
- [x] `/lint` passes (eslint, prettier, tsc --noEmit all clean)
- [x] E2E verification log filled in with concrete evidence
- [x] UI-062 and UI-068's fixes confirmed still in force
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (P0)
- [ ] `/evaluate` passes
- [ ] Committed with `[UI-099]` prefix
