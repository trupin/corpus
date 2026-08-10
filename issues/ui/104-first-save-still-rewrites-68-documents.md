# [UI-104] The first save still rewrites 68 of 618 documents, and one of them changes meaning

## Domain

ui

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: UI-103 (whose sweep found these)
- Blocks: —

## Spec References

- SPEC.md **§11** — "the editor serializes to clean markdown", and autosave with
  no save button
- SPEC.md **§5** — files on disk are the source of truth
- SPEC.md **§1** — the corpus is the user's documents; the tool stewards them

## Summary

UI-103 fixed the fixed-point failures: all 618 repo documents now settle on the
first printing, where six did not. But its sweep also measured what the **first**
save still changes, and that is **68 documents** — down from 72, not to zero.

Normalisation on first save is partly by design: §11 says the editor serializes
to clean markdown. The question this issue exists to settle is **which of the 68
are normalisation and which are the tool rewriting the user's document**, and the
sweep already shows at least one of the latter.

## The one that changes meaning

**14 documents where a single unescaped `|` widens a whole table by a column.**
That is not tidying — a table gains a column that the author did not write, and
every row after it shifts. `issues/ui/099` and `issues/ui/077` were both hit by
it during UI-103's own investigation.

A `|` inside a table cell has to be escaped to be content; the printer is
emitting it bare, so the next read parses it as a delimiter. The reader is not
wrong — the writer is.

## The rest, as measured

- **51 documents**: a soft break inside an inline code span flattens to a space.
  This is remark's own `inlineCode` handler and matches CommonMark render
  semantics, so the rendered output is unchanged. Cosmetic on the page, but it
  still edits the file — decide deliberately whether that is acceptable rather
  than inheriting it.
- **3 documents**: mark-order normalisation.
- Loose lists tightened — already a documented normalisation.
- Malformed `**a **b** c**` emphasis healed in a way that **extends the bold
  run**. Healing malformed input is defensible; changing which words are bold is
  a content decision.

### The category UI-103 itself added — classified, per this issue's own rule

**40 documents gain a blank line inside a list item, which makes the list
loose.** Raised by PR #40's review (MINOR 3) and named here because it was
missing from both this issue's list and UI-103's: it is the entire measurable
effect of UI-103's fix on the corpus, and it is a rewrite the tool performs that
nobody asked for. `CLAUDE.md`'s `8. Format:` item plus its fenced block is the
concrete case — the item gains a blank line, and every item in that twelve-item
list re-renders `<p>`-wrapped.

**Classification: intended normalisation, not a defect.** Decided on the record
in UI-103 (*Where the blank line is not required, and why it is written anyway*),
with the per-adjacency measurements — of 164 adjacencies inside list items across
610 documents, 98 get a blank line that is not strictly required
(`paragraph → code` 48, `code → paragraph` 36, `paragraph → blockquote` 9,
`paragraph → table` 3, `code → code` 1, `paragraph → rawBlock` 1). The reasons it
stands rather than being narrowed:

- ProseMirror does not model list looseness, so tight and loose parse to the
  identical document. Nothing the editor could hold is lost, the output is a
  fixed point, and it is the same category as the already-listed "loose lists
  tightened" running the other way;
- every additional flush exception is a proof obligation over *all* spellings of
  the right-hand block plus the left-hand block not being extended by it, and the
  one exception written without discharging it fully had two live holes
  (UI-103's follow-up). `paragraph → rawBlock` cannot even be decided without
  classifying the HTML block type — `<div>` interrupts a paragraph, a bare
  `<custom-el data-x>` does not;
- blank-by-default is what makes a block type the schema grows later arrive
  separated rather than silently absorbed.

**It is still a byte rewrite of the user's file**, so if the looseness is
unwanted the answer is to make the printer emit loose items consistently, not to
narrow the join rule — a separate decision, and one for this issue rather than
UI-103.

## Also classify: an empty-only task list loses its task-ness

Found by the pr-reviewer on PR #40 and confirmed pre-existing — it reproduces at
`0b3ed418` and **at top level**, where UI-103's join rule never runs, so it is
not caused by that fix.

A task list whose **only** item is empty round-trips as a plain bullet list:
`doc(taskList(taskItem(emptyParagraph())))` prints `"-\n"`, which reads back as a
`bulletList`. The task-ness is gone. UI-103 strictly improved the nested case —
that shape used to turn the paragraph above it into an H2 — but the type loss
survives.

`SPELLINGS.taskListEmptyLead` uses two items, so the pair probe does not see it.
Whatever this issue decides about the other categories, decide this one too:
either the printer must spell an empty task item in a way that survives a read,
or losing task-ness on an empty-only list is accepted on the record.

## Acceptance Criteria

- [x] The `|` case is fixed: a table cell containing a literal `|` round-trips
      with the same number of columns. This one is not a judgment call
- [x] Every remaining category is **classified on the record** as either
      intended normalisation or a defect, with the reason. A category nobody
      classified is how this issue gets closed while a file still moves
      (the blank-line-in-a-list-item category is classified above; the rest are
      still open)
- [x] The emphasis-healing case is decided explicitly: healing is fine, changing
      the bold run is a different act
- [x] The sweep is a **test**, not a one-off script — round-tripping the repo's
      own documents and asserting the count of structurally-changed files does
      not grow. UI-103 ran it by hand; that is why 72 was never noticed
- [x] Reproduce each fixed case before fixing, per the SDLC's rule for bugs

## Technical Design

### Files to Create/Modify

- `apps/ui/src/editor/markdown/serialize.ts` and its fixtures.

### Notes

- UI-103's fixture corpus had **zero** coverage of a list item holding anything
  but a nested list, which is how that bug shipped. Check what else the fixtures
  do not cover before assuming a category is safe.
- Do not fix the `|` case by making the reader tolerant. The file is what moved.

## Testing Strategy

Property: round-trip every document under `issues/` and `docs/` and assert the
set of structurally-changed files is empty for the fixed categories and matches a
pinned, commented list for the accepted ones.

## E2E Verification Log

**Model run on:** Opus 5 (1M context).

### The classification, measured — every category, with its verdict

Swept over the 596 `.md` files this branch tracks (the corpus has moved since
UI-103 measured 610/618). **554 change byte-for-byte on the first save; 67 change
structurally.** Categories overlap — a document may hit more than one.

| # | category | documents | verdict |
| - | -------- | --------: | ------- |
| 1 | a bare `\|` in a cell splits the row and the table gains a column | 12 + every aliased `[[ref]]` in a cell | **DEFECT — fixed** |
| 2 | a line break inside a code span becomes a space | 54 of the 235 that hold one | **intended normalisation — accepted** |
| 3 | marks re-nested into the canonical order | 2 | **intended normalisation — accepted** |
| 4 | adjacent same-mark runs merged; redundant emphasis markers dropped | 15 | **intended normalisation — accepted; and the issue's premise is wrong** |
| 5 | a loose list is tightened | invisible to a parse comparison | **intended normalisation — accepted** |
| 6 | a blank line between an item's blocks makes its list loose | 98 adjacencies | **intended normalisation — decided in UI-103, not reopened** |
| 7 | an empty-only task list loses its task-ness | 0 in the corpus | **accepted — a spelling does survive; writing it into the user's file is the thing declined** |
| — | unclassified | **0** | — |

**1 — the table pipe. Defect, and worse than reported.** Two distinct mechanisms,
reproduced separately before either was touched.

- *The writer emits a bare pipe.* `refSource` spells a reference with an alias as
  `[[id|alias]]`, and the printer writes the four constructs this module invented
  (`corpusRef`, `corpusRawInline`, `corpusRawBlock`, `corpusAutolink`) **verbatim**
  — `remark-stringify` escapes `|` inside a cell for everything it knows about,
  and `mdast-util-gfm-table` patches even `inlineCode`, but neither can do it for
  a construct it has never heard of. So a *correctly written* file was destroyed
  on the first save. It was not even a fixed point: the split row then widened the
  table on the save after that.
- *The printer widens a ragged table.* Where the **file** already wrote a row
  wider than its header — one bare `|` inside `` `jq '.events|length'` ``,
  `string | null`, `2 failed | 8 passed` — `markdown-table` lays every row into a
  matrix as wide as the *widest* row, so the header gained a column, the delimiter
  row gained a `---`, and every row in the table shifted.

  GFM's own answer is to *ignore* the surplus, which deletes the user's text, so
  the fix is neither the printer's nor GFM's: the surplus is **folded back into
  the last column** behind the `|` it came from, which the printer then escapes.
  Column count preserved, every character kept, idempotent from there.

  Two residual costs, both on the record. The padding around the fold is gone,
  because GFM trims a cell's edges before any writer sees it — `SHOPPING | 2`
  comes back `SHOPPING\|2`. And — the one this issue first recorded only as a
  byte change (PR #41, MINOR 5) — **the fold changes what the page renders, not
  only what the file says**: `| 1 | 2 | 3 |` under a two-column header renders
  in GFM as `1 | 2`, because a reader *ignores* the surplus, and after the first
  save it renders as `1 | 2|3`. Text the author wrote and no reader was showing
  becomes text every reader shows. That is the intent — the alternative is
  deleting it, and a document whose content depends on being invisible is not a
  document §5 can call the source of truth — but it is a visible change on the
  first save and it belongs in this list as one.

  Width is read off the **header row**, not `attrs.align`: a column added through
  the editor's table commands extends every row, while `align` is parse-time data
  those commands do not maintain, and reading it would fold the new column away.

**2 — a line break in a code span. Accepted.** It is **not** every line break in
a code span, which is what this table first recorded: 235 documents hold one and
**54** change. `mdast-util-to-markdown`'s `inlineCode` handler walks the
printer's `atBreak` unsafe patterns and replaces the line ending only where the
next line would otherwise be read as a block — a `#`, `-`, `>`, `---` or a blank
line there ends the paragraph and destroys the span. A break followed by an
ordinary word is left exactly where the author put it. (Corrected while fixing
PR #41's MAJOR 1, which is what a classifier keyed on the *change* rather than
on the document's contents makes visible.)

CommonMark §6.1 makes a code span's line endings spaces, and that is already
what every reader shows —
`.doc-body`'s inline `code` inherits `white-space: normal`, so the rendered page
is character-for-character identical before and after. Preserving the break means
hand-rolling `inlineCode`, which then owns backtick-fence widening, space padding,
GFM's table-cell escaping **and** a proof, for every line following a break, that
it cannot be read as a block: a `- `, `> `, `# `, `---` or a blank line there ends
the paragraph and destroys the span. That is exactly the proof obligation UI-103
was, taken on for no rendered difference. **Acknowledged asymmetry:** unlike list
looseness, ProseMirror *does* hold this — which is why it is recorded as a
decision rather than a non-event.

**3 — mark order. Accepted.** `**[link](u)**` → `[**link**](u)`. ProseMirror holds
marks as a set per text node, so nesting order is not information the document
carries; `MARK_ORDER` picks one and the same characters are bold either way.

**4 — emphasis healing. Accepted, and the issue's premise is wrong.** The issue
says the healing of `**a **b** c**` "extends the bold run", and that is a content
change. **It does not.** Measured, not assumed: over all 596 documents and over
seven hand-built malformed spellings (`**a **b** c**`, `*a *b* c*`, `**a *b** c*`,
`*a **b* c**`, `~~a ~~b~~ c~~`, …), the characters carrying each mark are
identical before and after. `**Stale **and** unread**` already parses as *nested*
strong over the whole phrase; the healing drops the redundant inner markers and
merges three nodes into one. No word changes weight. This is now the corpus test's
central assertion (`keeps every word, and the marks over it`), so a printer that
ever did extend a run fails by name.

**6 — the blank line in a list item.** Classified in this issue's own brief and in
UI-103's log; not reopened, and the alternative it names (make the printer emit
loose items consistently) is deliberately declined for the same reason UI-103
gave: looseness is not information ProseMirror holds, so this is spelling, and
narrowing the join rule is a proof obligation per exception.

**7 — the empty-only task list. Accepted, but not for the reason first written
here.** The original text claimed "there is no spelling of an empty task item
that survives a round trip". **That is false against this repository's own
parser**, and PR #41's review was right to call it (MINOR 4).

Measured, this time: `- [ ] <!-- -->` round-trips **byte for byte**, reads back
as `taskList(taskItem(paragraph(rawInline)))`, and renders as an empty task item
— GFM §5.3 wants whitespace and content after the marker, and an HTML comment is
content that renders as nothing. `- [ ] <span></span>` does the same. What is
true is only the narrower claim the four bare spellings support: `- [ ]`,
`- [ ] `, `- [x]` and `- [ ]\n- [x]` all read back as a `bulletList`, before any
printing happens.

So the bare `-` is **a choice, not the only honest output** — the choice not to
write into the user's file something the user did not write. §5 makes the file
the source of truth and §1 makes it theirs; planting `<!-- -->` in a document
because the editor's own model needs a marker to survive is the same class of
act this issue exists to stop, and the comment would be permanent, visible in
every diff, and unremovable through the editor that added it. Losing the list's
type is the smaller intrusion, and it is bounded: no text moves, the output is a
fixed point, and the moment any item has content the whole list is a task list
again, empty items included (`serializeDoc` → `"-\n- [x] Bee two.\n"`).

**The counterexample the sweep should have produced, now on the record:**
`- [ ] &#32;` — a task item whose only content is a space — loses **both** its
task-ness *and* its content. It parses as `taskItem(paragraph(text(" ")))`,
prints as `-\n` (trailing whitespace is dropped before the item is written), and
reads back as a `bulletList`. The space is inside the already-accepted "trailing
whitespace is dropped" normalisation, and the task-ness follows from the item
then being empty — but the two together delete the only character the item had,
and no assertion said so until now. Pinned in `serialize.test.ts` → "a task list
with nothing in it", alongside the surviving `<!-- -->` spelling, so the
acceptance argument now rests on something true.

### Pre-fix reproduction — the real app, on disk, in git

Real workspace, real server, real Chromium. `corpus init /tmp/ui104ws --port
8794`, `corpus server start`, the HEAD UI built by `npm run build -w apps/ui` and
served by that server. Nothing bound 8765 (the user's live server, pid 1715),
5173 (an ssh tunnel) or 5273 at any point; 5473 was used for Playwright.

The document, created through the CLI so the server owned every byte
(`corpus doc create --type note --title "Eval report before the fix" --file …`),
at commit `doc create: Eval report before the fix (doc_7apbuq6r) by user`:

```markdown
The eval table, as an agent wrote it:

| Test | Result | Notes |
| ---- | ------ | ----- |
| 94   | PASS   | 3 pending, 200 | 0 skipped |
| 95   | PASS   | see [[doc_wybdqllv\|the earlier draft]] |
```

Row 94 is what an agent writes and GFM reads as ragged. Row 95 is **correctly
written** — the alias's pipe is escaped exactly as it must be.

**Before a single character was typed, the editor already showed the damage**: the
`[[…]]` row rendered as two cells, `see [[doc_wybdqllv` and `the earlier draft]]`
— because `DocEditor` parses `editorBody(body)`, so the document it holds is
already the round trip's output.

The edit: select the closing paragraph, type over it. Nothing near the table. The
file the server wrote:

```markdown
| Test | Result | Notes                 |                     |   |
| ---- | ------ | --------------------- | ------------------- | - |
| 94   | PASS   | 3 pending, 200        | 0 skipped           |   |
| 95   | PASS   | see \[\[doc\_wybdqllv | the earlier draft]] |   |
```

Three columns became **five**, and the reference was **destroyed** — split across
two cells with its brackets and underscore permanently escaped. That is not a
formatting diff: a link is gone from the corpus, irreversibly, and the file
records it as the user's own edit
(`e5c706d doc edit: Eval report before the fix (doc_7apbuq6r) by user`).

### Post-fix — the same document, the same edit

Fix applied, `npm run build -w apps/ui`, server restarted, a fresh document
`doc_jthisbfn` created from the same file. Same edit:

```markdown
| Test | Result | Notes                                   |
| ---- | ------ | --------------------------------------- |
| 94   | PASS   | 3 pending, 200\|0 skipped               |
| 95   | PASS   | see [[doc_wybdqllv\|the earlier draft]] |
```

Three columns. The reference row is a **context line in the git diff** — byte
identical — and the editor renders it as the resolved title, `see the earlier
draft`, so it is a reference again and not text. The only changes in the diff are
the paragraph the user typed, the padding on row 94, and `updated`.

**Second session.** Reloaded (so the editor now reads back its own output) and
edited again: `git diff 7b97b64..286c67f` shows the paragraph and `updated`, and
nothing else. No page errors in any of the three runs. Workspace and server torn
down; 8794 free.

### The sweep, as a test

`apps/ui/src/editor/markdown/corpus.test.ts` — new, and the acceptance criterion
that matters most. It walks every `.md` in the repository (~600, 10 MB), parses
and prints each twice, and asserts:

- **settles on the first printing** — `print(parse(print(x))) === print(x)`;
- **never changes a table's column count** — the fixed category, pinned at zero;
- **keeps every word, and the marks over it** — a *projection* of the document
  down to block structure, attributes, and every significant character paired
  with its sorted mark set. Anything a normalisation may change is outside it by
  construction; anything else fails, naming the file;
- **writes no character reference a document did not already carry** (seven
  documents quote entities verbatim, which is why the existing corpus-wide rule
  had to be stated as a delta);
- **classifies every document whose parse changes**, and **uses no category that
  is not written down** — the rule from this issue's brief, mechanised. A new
  defect fails the projection; a new *accepted* normalisation fails the pinned
  category set, so nobody can close this with a file still moving for a reason
  nobody wrote down.

Deliberately **not** a pinned list of file names or a pinned count: both go stale
on every documentation edit and say nothing about *what* changed. Cost is ~60–80 s
— by some distance the slowest file in the suite, stated in its docstring, and
absorbed by vitest's parallelism (the whole `apps/ui` + `packages/kit` run is 85 s
with it in).

### Fixture coverage the corpus did not have

Per the issue's warning that UI-103 shipped because the fixtures had zero coverage
of the failing shape: `fixtures/tables.md` gains a table whose cells carry a pipe
in **each construct that can hold one** — plain text, a code span, a raw inline,
and a reference with an alias — so all four are now in the byte-for-byte corpus.

### Negative control — both fixes removed

Both fixes disabled in place and every layer re-run:

- `serialize.test.ts` — 4 of the 6 new pipe tests fail (the ref alias, the raw
  inline, and both folds). The code-span and autolink cases still pass, correctly:
  those are the printer's own escaping and were never broken;
- `roundtrip.test.ts` — the new `tables.md` fixture fails **both** byte-for-byte
  *and* idempotence, which is the evidence that the ref-in-a-cell case was a
  fixed-point failure and not merely a byte change;
- `corpus.test.ts` — "never changes a table's column count" fails with 12 files,
  "keeps every word, and the marks over it" with 13, "settles on the first
  printing" with the new fixture;
- `table-pipes.spec.ts` — both specs fail, on the row width.

Fix restored; everything green again.

### Tests

- `apps/ui/src` + `packages/kit/src` — **3,722 pass, 193 files, 0 fail** (85 s).
  New: `corpus.test.ts` (8), a `pipe inside a table cell` describe and a
  `row with more cells than its header` describe in `serialize.test.ts`, a
  `task list with nothing in it` describe, and the extended `tables.md` fixture.
- Playwright — `apps/ui/e2e/table-pipes.spec.ts`, new: the ragged row and the
  aliased reference through a real editor with real autosave, asserted against the
  bytes on the wire, plus a second save. Run with the serializer-adjacent specs
  (`table-pipes`, `list-blocks`, `editor`, `fences`, `anchors`, `anchor-layer`,
  `render-fixes`, `clipboard`): **68 passed**. `stubCorpus.ts` untouched (UI-102 is
  in it).
- `npm run build`, `tsc --noEmit` (apps/ui, packages/kit), `eslint`, `prettier`
  — all clean.

### Not done, and why

**The code-span line breaks still rewrite 54 files.** That is the accepted
category and it is the largest one; if it is ever judged unacceptable, the work is
a hand-rolled `inlineCode` handler installed *after* `remarkGfm` (extensions are
configured in array order, so a `handlers` entry alone loses to
`inlineCodeWithTable`), carrying the block-interruption proof described above.
Filing that is a decision for the orchestrator, not a defect left open here.

## PR #41 review — the classifier rewritten, and four records corrected

**Model run on:** Opus 5 (1M context). Appended, not overwritten: everything
above is the original pass, and this is what its reviewer found wrong with it.

### MAJOR 1 — the growth guard classified documents by what they *contained*

The finding is right and it is worse than a false negative: the classifier could
not distinguish a document containing a pipe from a document whose pipe had been
**deleted**.

**Negative control, in the direction that proves it.** One character in
`foldSurplusCells` — the fold's separator `{type:"text", value:"|"}` changed to
`" "`, so the surplus is joined to the last cell with a space and the `|` the
author wrote is silently dropped from twelve of this repository's own files:

- **the old `corpus.test.ts` passed all 8 assertions.** Not one of them moved.
  `settles` held (the loss is idempotent), `columnCountHeld` held (the header is
  untouched), the projection held (`IGNORED_CHARACTERS` skips `|` by design),
  `classify` returned `["tableSurplusFolded"]` off the *before* tree — the same
  answer it gives when the fold is correct;
- the only thing that noticed anywhere in the repository was
  `serialize.test.ts` (2 of 632 unit tests in that file pair).

That is the reviewer's scenario reproduced exactly: a regression in the pipe
handling — the thing this issue fixed — landing where the before-tree predicates
had already absolved it. `issues/evals/AGENT-P5W2-eval.md` is one of the twelve,
and it holds a multi-line code span, so under the old classifier it was
pre-absolved twice over.

**The rewrite.** `classify(before, after)` → `explain(before, after)`, which
walks the two parses **in lockstep** and requires every difference it meets to
be one of the named normalisations:

- block structure, node types and attributes compared node for node;
- inline content compared **character by character**, each character paired with
  the marks over it *in tree order*, plus a flag for a text-node boundary that
  fell between two characters carrying identical marks;
- the fold is **modelled, not ignored**: the before tree's ragged rows are
  folded the way `foldSurplusCells` folds them, `|` included, so a fold that
  loses the pipe, drops a cell or joins in the wrong order is an ordinary
  content difference;
- **no whitespace allowance at all.** Over the whole corpus nothing is inserted
  or deleted, so every transition consumes one position from each side and the
  two streams stay index-aligned — a difference in length is itself a
  difference in content.

Five transitions are allowed, each one a named category, and the failure names
the file and prints the two spellings that differ.

**Re-measured over 598 documents — 556 change byte-for-byte, 68 structurally,
`unexplained` is empty:**

| category | old count, by containment | new count, by what changed |
| -------- | ------------------------: | -------------------------: |
| `inlineCodeLineBreak` | 58 | **54** (of 235 documents that hold a multi-line code span) |
| `tableSurplusFolded` | 12 | 12 |
| `markNestingOrder` | 2 | 2 |
| `inlineRunsMerged` | 15 | **2** (the other 12 were the fold's own bookkeeping) |
| `emphasisEdgeSpace` | — | **1, newly named** |

The new category is a real normalisation nobody had written down: a space at the
inside edge of an emphasis run is hoisted out of it, because `** **` opens and
closes nothing (`**~~one~~ two**` → `~~**one**~~ **two**`). The old classifier
swept it into `inlineRunsMerged`'s text-node-count catch-all.

Also corrected while measuring: `inlineCodeLineBreak` is **not** every line break
in a code span. `mdast-util-to-markdown` replaces the break only where the next
line would be read as a block — 235 documents hold one, 54 change.

**With the classifier rewritten, the same regression fails by name**, twelve
files, each with the character it lost:

```
issues/evals/CLI-008-eval.md  …/tableRow[2]/tableCell[0]/paragraph:
  "…eply equal []; `Tests 2 failed|8 passed (10)`.…"
  became "…eply equal []; `Tests 2 failed 8 passed (10)`.…"
issues/evals/PLUGINS-002-eval.md  …: "…`SHOPPING|2|☐ bread|☐ milk`.…"
  became "…`SHOPPING 2 ☐ bread ☐ milk`.…"
```

Fix restored, suite green again.

**`columnCounts` reading only the header row is fixed too** (MINOR 1 in the same
finding): every row is now compared against its own width, asymmetrically — a
row may *lose* cells, which is the fold putting a ragged row back inside its
header, and may never *gain* one, which is a row splitting. That is the defect
this issue exists to fix and it was invisible to the header-only check.

**The guard now has its own tests** (`describe("the guard itself")`, 10 cases).
Each named category is provoked **through the real printer** from a hand-written
source, so a category the serializer stops needing fails there; and each blind
spot the old version had is a case the classifier must *refuse* — the fold that
loses its pipe, a row that gains a cell while the header holds, a word that
changes weight, whitespace that goes missing.

### MINOR 2 — an assertion that could not fail in the direction its name claimed

"uses no category that is not written down" was vacuous on the subset side
(`Category` is `keyof typeof CATEGORIES`, so `classify` can only push the four
literals) and, on the reverse side, one document edit away from red
(`emphasisEdgeSpace` fires on exactly one file).

**Chosen: make the assertion match its name, by moving it off the corpus.** It
is now `still needs every category that is written down` in the guard's own
tests: the categories are collected from the five hand-written sources run
through the real printer, and compared with `CATEGORIES`. A name the serializer
no longer does anything to earn fails there, which is what the reverse direction
was always for, without depending on which documents happen to be in the repo.
The document-level guard against a change nobody named is `unexplained`, which
names the file.

### MINOR 3 — `safeInCell`'s docstring claimed a case it does not cover

Reproduced: a raw inline holding `<span title="a|b">` in a cell prints as
`<span title="a\|b">`, micromark keeps the backslash inside the tag, and the
rendered `title` gains a `\` permanently. `<!-- a|b -->` behaves the same. It
converges after one step (the escape is conditional, so the backslash is not
doubled again) and it is unreachable from a file — parsing a cell splits the row
on a bare pipe before any inline parsing, so it needs the editor to move raw HTML
into a cell. The trade-off stands; **the docstring was the defect** and now
records the case instead of claiming to handle it.

`serialize.test.ts`'s raw-inline test now says why it omits the
`parseMarkdown(printed)` equality its sibling makes: the escape lands inside the
opaque construct, so `<kbd>\|</kbd>` reads back as three nodes — `<kbd>`, the
text `|`, `</kbd>` — which is exactly what a *file* containing that cell parses
to. Nothing is lost, the output is a fixed point (both now asserted), but the
tree is not the hand-built one.

### MINOR 4 — the empty task item claim was false

`- [ ] <!-- -->` round-trips **byte for byte**, reads back as
`taskList(taskItem(paragraph(rawInline)))` and renders as an empty task item; so
does `- [ ] <span></span>`. Category 7 above is rewritten: the bare `-` is a
**choice not to write a comment into the user's file**, not the only honest
output. The counterexample the sweep should have produced is recorded and pinned:
`- [ ] &#32;` prints as `-\n` and loses **both** its task-ness and its content —
the space goes to the trailing-whitespace rule, the task-ness follows from the
item then being empty.

### MINOR 5 — the fold changes what is rendered, not only what is stored

Recorded in category 1 and in `CATEGORIES.tableSurplusFolded`: `| 1 | 2 | 3 |`
under a two-column header renders in GFM as `1 | 2`, because a reader ignores
the surplus, and after the first save as `1 | 2|3`. Text the author wrote and no
reader was showing becomes text every reader shows.

### Checks

- `apps/ui/src` + `packages/kit/src` — **3,733 pass, 193 files, 0 fail** (98 s).
  Net +11: the guard's own 10 cases (`corpus.test.ts` 8 → 17) and 2 new task-list
  tests, minus the renamed ones.
- `apps/ui/e2e/table-pipes.spec.ts` — **2 passed** on port 5473 (5173 and 8765
  untouched; no orphaned worker or listener afterwards).
- `npm run build`, `tsc --noEmit -p apps/ui`, `eslint`, `prettier --check` —
  clean. No production behaviour was changed by this pass: `serialize.ts`'s only
  edit is a docstring.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
