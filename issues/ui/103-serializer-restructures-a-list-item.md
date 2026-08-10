# [UI-103] Opening a document and typing one character can silently restructure a list

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
- Related: UI-099 (found it), UI-068 (the selector must quote the file's
  spelling), §4 autosave

## Spec References

- SPEC.md **§11** — "the editor serializes to clean markdown", and **autosave,
  no save button**: every keystroke eventually writes the file
- SPEC.md **§5** — files on disk are the source of truth
- SPEC.md **§1** — the corpus is the user's own documents; the tool stewards
  them, it does not rewrite them

## Summary

Found by UI-099's reproduction, and it is the worse half of what that
investigation turned up. UI-099 fixed the *anchoring* consequence; **this is the
data consequence, and it is untouched.**

`apps/ui/src/editor/markdown/serialize.ts`'s round trip is **not
structure-preserving** for a further paragraph of an outer list item following a
nested sublist:

```markdown
- Outer bullet leads in.
  - Nested bullet one.
  - Nested bullet two.

  A trailing paragraph of the outer item.
- Second outer bullet.
```

Printing once drops the blank line. Printing the result again re-reads that
paragraph as a continuation of the **nested** item and indents it 2 → 4 spaces.
So the construct is not a fixed point: `canonicalize(canonicalize(x)) ≠
canonicalize(x)`.

Because §11 gives the editor **autosave and no save button**, opening such a
document and typing a single character anywhere in it writes the restructured
form to disk. A paragraph that belonged to an outer list item silently becomes
part of a nested one — in the user's own file, with no action that asked for it,
and the git commit records it as the user's edit.

## Why this is P0

It is not a rendering defect. It changes **what is on disk**, in the direction
the product is least allowed to: §5 makes files the source of truth and §1 makes
them the user's. The change is invisible at the moment it happens, survives into
git under the user's authorship, and the affected construct is ordinary
markdown — an outer bullet with a sublist and a closing paragraph.

UI-099 made anchoring immune to it (the layer now traces what the editor
actually shows), so nothing depends on this being fixed to render correctly.
That is exactly why it needs its own issue rather than a note: the symptom that
would have led someone here is gone.

## What UI-099's PR (#39) changed about this bug — read before triaging a report

Two things, and neither of them fixes what is written above.

**1. This is a live P0 data-corruption bug whose only remaining symptom is now
gone.** Before #39, a document containing the construct announced itself: it drew
no comment highlights at all, which is what led to the investigation that found
this. After #39 it renders and anchors correctly and looks entirely healthy,
while still being silently restructured on disk the first time anyone types in
it. Nothing in the product now points at this defect. It will not be rediscovered
by use — only by someone reading a git diff and wondering why their paragraph
moved. Do not read the absence of reports as evidence that it is rare or benign.

**2. Seam-spanning selections on an affected document now produce a visible
refusal.** A selection that crosses the boundary the two printings disagree about
— e.g. from the last nested bullet into the outer item's trailing paragraph — is
refused with *"Couldn't quote that selection from the document as it is saved —
select a whole phrase and try again."* (`REFUSAL_NOTICE["not-in-file"]`), and no
comment is created.

That is **better than what it did before**, which was to create a comment quoting
text that is in no file — `exact: "bullet two.\n    A trailing paragraph"`, four
spaces the file does not contain — so the thread was born orphaned and no later
edit could reattach it (UI-068's failure mode). A loud refusal beats a silently
broken comment.

But it is **new, and unexplained to the user**: the message says the selection
cannot be quoted from the document "as it is saved", which is true and gives no
hint that the cause is the serializer disagreeing with itself about one blank
line, nor that selecting slightly differently will work. It is a user-visible
consequence of this bug that will outlive #39 and disappear when this issue is
fixed — because once `canonicalizeMarkdown` is idempotent for the construct the
two printings agree and there is no seam to straddle. Treat a report of that
message on a list-with-sublist document as a report of *this* issue, not as a
selection bug. Pinned by `useAnchorLayer.test.tsx` → "commenting on a file whose
two printings disagree about structure".

> **Resolved.** That refusal is gone: the printings agree, and the same
> seam-spanning selection now quotes the file and opens a composer. The describe
> is still there, renamed to "…used to disagree about structure", and now asserts
> the acceptance. A report of the message on a list document is therefore a *new*
> defect, not this one.

## Acceptance Criteria

- [x] `canonicalizeMarkdown` is **idempotent** for this construct — printing
      twice equals printing once — and that is asserted as a property, not for
      one fixture
- [x] The paragraph keeps its list level through a parse → print round trip, and
      through parse → print → parse → print
- [x] A document containing the construct, opened and edited elsewhere, writes
      back with the construct **unchanged**. Drive it through the real editor
      and autosave, not through the serializer in isolation — autosave is what
      makes this reach disk
- [x] Reproduce before fixing, with the on-disk before/after and the git commit
      it produced, per the SDLC's rule for bugs
- [x] **Sweep for siblings.** A round trip that is not a fixed point for one
      construct is unlikely to be one for exactly one construct. Round-trip a
      corpus of real markdown — the repo's own documents will do — and report
      what else moves, even if this issue only fixes this case
- [x] UI-099's fix is not undone: the anchor layer traces the editor's own
      document, and must keep doing so whatever the serializer is made to do

## Technical Design

### Files to Create/Modify

- `apps/ui/src/editor/markdown/serialize.ts`, and its tests.

### Notes

- The failing step is the **blank line**, which is what tells a reader the
  paragraph belongs to the outer item rather than the nested one. Dropping it is
  the loss; the re-indent on the second read is only the consequence.
- Idempotence is the property worth testing, because it is checkable without
  knowing what the right output is: whatever the printer chooses, printing its
  own output must not choose differently.
- Do not fix this by making the *reader* tolerant. The file on disk is what
  changed, and a reader that copes with both spellings still leaves the user's
  document rewritten.

## Testing Strategy

A property test over the construct and its neighbours (nested sublist with and
without a trailing paragraph, at two and three levels, ordered and unordered),
asserting print∘print = print. Plus the real-editor autosave case, and the
corpus sweep from the acceptance criteria.

## E2E Verification Log

**Model run on:** Opus 5 (1M context).

### Pre-fix reproduction — the file on disk, and the commit it produced

Real workspace, real server, real browser. `corpus init /tmp/ui103ws --port
8793`, `corpus server start` (pid 70274), the HEAD UI built by `npm run build -w
apps/ui` and served by that server; Playwright driving Chromium against it.
Nothing bound 8765 (the user's live server) or 5173 (an ssh tunnel) at any point.

The document, created through the CLI so the server owned every byte
(`corpus doc create --type note --title "List construct" --file …`) →
`doc_onibghpe`, `data/docs/inbox/list-construct.md`, sha256
`40f834bb…a773e`, at `git` commit `5230fd9 doc create: List construct
(doc_onibghpe) by user`:

```markdown
- Outer bullet leads in.
  - Nested bullet one.
  - Nested bullet two.

  A trailing paragraph of the outer item.
- Second outer bullet.

A closing paragraph, nowhere near any of it.
```

**The edit: one character, in the last paragraph, six lines below the
construct.** Click the closing paragraph, `End`, type `!`. No list was touched,
selected, or looked at.

The `PUT /api/docs/doc_onibghpe` that autosave sent, read off the wire:

```
"- Outer bullet leads in.\n  - Nested bullet one.\n  - Nested bullet two.\n
   A trailing paragraph of the outer item.\n- Second outer bullet.\n\nA closing
   paragraph, nowhere near any of it.!\n"
```

and the file after the server wrote it:

```markdown
- Outer bullet leads in.
  - Nested bullet one.
  - Nested bullet two.
    A trailing paragraph of the outer item.
- Second outer bullet.

A closing paragraph, nowhere near any of it.!
```

The blank line is gone and the paragraph is indented **four** spaces: it is no
longer a block of the outer item, it is the second paragraph of *Nested bullet
two*. Auto-committed as the user:

```
e5543f840650c672f4c846ab8bbe717664a5523e
user <user@corpus.local>
doc edit: List construct (doc_onibghpe) by user
```

**Worse than the issue describes, and worth recording.** The issue reads the
damage as taking two printings. It takes one: `DocEditor` parses
`editorBody(body)` — `canonicalizeMarkdown(body)` — so the document the editor
holds is already the *second* printing, and the very first save writes the fully
restructured form. There is no intermediate state in which the file has merely
lost a blank line.

### Post-fix — the same edit, on the same construct

Fix applied, `npm run build -w apps/ui`, server restarted (pid 70734), a fresh
document `doc_xst3bn6y` created from the same file (sha256 `baf946ff…c73c56`, at
`4e1bf04 doc create: List construct after fix (doc_xst3bn6y) by user`). Same
click, same `End`, same `!`.

The `PUT` body:

```
"- Outer bullet leads in.\n  - Nested bullet one.\n  - Nested bullet two.\n\n
   A trailing paragraph of the outer item.\n- Second outer bullet.\n\nA closing
   paragraph, nowhere near any of it.!\n"
```

and the commit `6235de7 doc edit: List construct after fix (doc_xst3bn6y) by
user` shows the construct untouched — blank line present, two-space indent, the
paragraph still the outer item's. The only change in the file is the `!` and the
`updated` stamp.

**Second session.** Reloaded the page (so the editor now reads back its own
output — the pass that used to move the paragraph) and typed one more character:
`f162c41`, construct still identical. No console errors in either run.

### The fix

`separateListItemBlocks`, a `join` rule on the printer
(`apps/ui/src/editor/markdown/serialize.ts`). Items are printed tight
(`spread: false`, because ProseMirror does not model looseness), and tight is
also what the printer used between an item's **own** blocks: a bare newline. So
the block on the left kept reading the line below it. The rule inverts the
default — a blank line between an item's blocks, with the flush spelling as the
exception — and the exceptions are exactly two, both with a **list** on the
right:

- a nested list under a paragraph of the same item (what hand-written markdown
  looks like, and what keeps every existing nested list byte-identical). Any
  paragraph, not only the item's lead one — a list may follow a later paragraph
  of the item too, and the rule always flushed both. The docstring said "lead"
  and was corrected in the follow-up (PR #40 review, MINOR 5);
- two adjacent lists, left to the printer because it tracks the bullet it last
  used (`state.bulletLastUsed`, `mdast-util-to-markdown`'s `handle/list.js`) and
  **alternates the marker** — `- lead\n  - a\n  * b\n` — which is what keeps
  them two lists with nothing between them.

  > **Corrected (PR #40 review, MINOR 4).** This originally said the printer
  > "must keep separating them with `<!---->` because a blank line would merge
  > them". That is not what the installed printer does. `joinDefaults`
  > (`mdast-util-to-markdown/lib/join.js`) has no such case — it returns `false`
  > only for indented code — and there is no `<!---->` anywhere in the output.
  > The round-trip assertion was genuine; only its stated mechanism was wrong,
  > which matters because this exception list is what future readers are told to
  > reason from. `serialize.test.ts` now asserts the actual bytes.

**And both exceptions are conditional on the list being one that may *interrupt*
a paragraph** — added in the follow-up, after the review found two spellings
where it may not (see below). Written unconditionally, the exception destroyed
either the sublist or the paragraph above it.

**Not fixed by making the reader tolerant.** The parser is untouched; what
changed is what gets written.

### Sweep — 618 real markdown documents

`canonicalize`/`canonicalize∘canonicalize` over every `.md` in the repo, before
and after.

| | before | after |
| --- | --- | --- |
| documents that are **not a fixed point** (`c(c(x)) ≠ c(x)`) | **6** | **0** |
| documents whose canonical form the fix changed | — | **40** (6.5%) |
| documents whose **structure** the first save changes | 72 | 68 |

The six that were not fixed points: `SPEC.md`, `issues/ui/099-…`,
`issues/ui/077-…`, `issues/contract/002-…`, `issues/contract/015-…`,
`issues/shared/023-…`. Forty documents — one in fifteen — contained the
construct family at all. It is ordinary markdown, not a corner.

**The family is wider than the report.** An 81-pair probe over every ordered pair
of block types inside a list item found **21 lossy adjacencies**, now 0 (and the
100-pair version, with `rawBlock`, is a committed test). Three distinct ways for
text to be absorbed, all reproduced end to end:

- after a nested list, a paragraph becomes a lazy continuation of the last nested
  item — the reported bug;
- after a **blockquote**, a paragraph is swallowed into the quotation and comes
  back with a `> ` in front of it (`issues/shared/023-…` did this);
- after a **table**, a paragraph becomes another **row** (`issues/ui/099-…` and
  `issues/ui/077-…` did this — the tables gained a column);
- a `thematicBreak` after a paragraph is read as a **setext underline**, turning
  the paragraph into a heading, and a `thematicBreak` before anything at all
  swallowed every following block.

**What still moves, and is not this issue** (the 68 documents whose structure the
first save changes, reported rather than fixed):

- **51 — a soft line break inside an inline code span becomes a space.**
  `` `corpus init\n--port 8791` `` → `` `corpus init --port 8791` ``. This is
  remark's own `inlineCode` handler, and it matches what CommonMark says a code
  span *renders* as, so the meaning survives and only the bytes move. Cosmetic,
  but it is a diff on every prettier-wrapped document containing a wrapped code
  span.
- **14 — a table with a ragged row gains a column.** One unescaped `|` in one
  cell makes remark read that row wider, and the printer then pads every row to
  the widest. Idempotent afterwards; the ambiguity is in the source.
- **3 — mark nesting order normalises** (`bold+link` → `link+bold`, `bold+strike`
  → `strike+bold`), which is `MARK_ORDER` doing its stated job.
- **Loose lists are tightened** (a blank line between items is dropped). Already
  a documented normalisation — `roundtrip.test.ts` pins it under
  `NON_CANONICAL` — and structurally lossless, but it is a real rewrite of the
  user's file and worth an issue of its own if it is not wanted.
- **`**Stale **and** unread**`-style malformed emphasis is healed**, which merges
  three inline nodes into one and extends the bold run. Deliberate (`escape.ts`,
  and pinned in `roundtrip.test.ts`), and it does change what the document says.

- **The fix's own rewrite: a blank line inside a list item, which makes the list
  loose.** Named late (PR #40 review, MINOR 3) because it was measured as "40
  documents changed" without being classified. It is the whole of the fix's
  effect on the corpus, and not all of it is required — see *Where the blank
  line is not required, and why it is written anyway* below. Classified on the
  record in UI-104.

None of these is a fixed-point failure: after this change, all 618 documents
settle on the first pass.

### Where the blank line is not required, and why it is written anyway

Raised by PR #40's review and decided here rather than left implicit: the rule
prints a blank line between *every* pair of blocks in a list item bar the two
exceptions, and for several of those pairs flush was already safe and already
byte-stable. Measured over the repo (610 `.md` at the time of the follow-up),
counting adjacencies inside list items rather than documents:

| adjacency          | occurrences | documents | blank line required? |
| ------------------ | ----------: | --------: | -------------------- |
| paragraph → list   |          66 |        38 | flush (the exception) |
| paragraph → code   |          48 |        31 | **no** — a fence interrupts a paragraph |
| code → paragraph   |          36 |        24 | **no** — a fence is closed by its own fence |
| paragraph → paragraph |       11 |         7 | yes — flush merges them into one paragraph |
| list → paragraph   |           9 |         4 | yes — the reported bug |
| paragraph → blockquote |       9 |         5 | **no** — `> ` interrupts a paragraph |
| paragraph → table  |           3 |         3 | **no** — a GFM table interrupts a paragraph |
| table → paragraph  |           3 |         3 | yes — flush makes it another row |
| blockquote → paragraph |       3 |         2 | yes — flush is swallowed by the quotation |
| code → code        |           1 |         1 | **no** |
| paragraph → rawBlock |         1 |         1 | **depends on the HTML** |

So of 164 adjacencies, 98 get a blank line they do not strictly need, and the
visible cost is real: a blank line between an item's blocks makes the whole list
**loose**, so `CLAUDE.md`'s `8. Format:` item plus its fenced block re-renders
with every item `<p>`-wrapped. That is a rewrite of the user's file that nobody
asked for.

**Decision: keep the blank line; do not narrow the rule.** Three reasons, in
order of weight.

1. **It is not information the editor holds.** ProseMirror does not model list
   looseness at all — tight and loose parse to the identical document — so the
   spelling is the printer's to choose, the output is a fixed point, and no
   content moves. It is the same category as "loose lists are tightened", which
   this serializer has always done in the other direction and which
   `roundtrip.test.ts` already pins.
2. **Each exception is a proof obligation, and this issue is what a loosely
   discharged one costs.** The obligation is not "the right-hand block can
   interrupt a paragraph" — it is that, in *every spelling* of that block, plus
   "the left-hand block is not extended by it". The original `paragraph → list`
   exception was written as though the first half were the whole of it and had
   **two** live holes for exactly that reason. The matrix above is not uniform:
   `paragraph → rawBlock` is undecidable without classifying the HTML block
   type (`<div>` is type 6 and interrupts; `<custom-el data-x>` is type 7 and
   does not — verified, it is absorbed into the paragraph), and `table → table`
   flush feeds the second table's header row to the first. Three more exceptions
   buy byte-stability on ~50 documents at the price of three more obligations of
   that shape.
3. **Blank-by-default is what makes a block type the schema grows later safe.**
   A new type arrives separated rather than silently absorbed. Flush-by-default
   would invert that, and the probe would only catch it if someone had thought
   to write the case.

Recorded as a classified category in UI-104, per that issue's rule that a
category nobody classified is how it gets closed with a file still moving.

### UI-099 is not undone

The anchor layer still traces `editorBody(body)`; `DocEditor` still parses it.
What changed is that the expression is now provably a no-op, exactly as this
issue's brief anticipated, and the tests that stood on the disagreement had to be
re-pointed rather than deleted:

- `DocEditor.test.tsx` → "the text the editor parses" now asserts the stronger
  fact underneath: a real mounted editor over that body prints the file back
  **byte for byte**;
- `useAnchorLayer.test.tsx`'s seam describe asserts the acceptance criterion from
  the user's side — the `REFUSAL_NOTICE["not-in-file"]` on a seam-spanning
  selection is **gone**, the selection is accepted, and the quote on the wire is
  in the file (`prefix + exact + suffix` ⊂ body);
- `rebase.test.ts`'s two "spellings diverge" describes now take the divergent
  spelling as **data** rather than computing it from today's printer. That is the
  honest shape regardless: `rebaseRange` maps between two texts and knows nothing
  about their provenance, and it is still handed a text that is not the file
  whenever the file is non-canonical or an out-of-band write has moved on.
  Every behavioural assertion is unchanged, including the straddle refusal and
  the two-divergence bound;
- `anchorPlacement.test.ts`'s reported-document case likewise supplies the
  editor's text instead of printing it.

**The follow-up UI-099 left open is resolved.** Swapping
`useAnchorLayer.test.tsx`'s two inline `canonicalizeMarkdown` call sites to
`editorBody` — which failed on exactly one test and for reasons never
established — now works: 36/36 green, and the swap is applied. It was the same
underlying fact. The one test it broke was "refuses a selection across the
respelt seam", whose whole premise was this bug. While here, `useAnchorLayer.ts`
imported `editorBody` **without** the `.js` extension, alone among the file's
relative imports, which is the likeliest source of the "a type that could not be
resolved" note recorded there; that is now `.js` like its neighbours.

### Tests

- `apps/ui/src` + `packages/kit/src` — **3,498 pass**, 192 files, no regressions.
  New: 200 pair tests + 15 construct tests in `serialize.test.ts`, a
  `lists-block-content.md` fixture in the round-trip corpus (which had **zero**
  coverage of a list item holding anything but a nested list — which is how this
  shipped), and one `NON_CANONICAL` entry pinning that a body an older serializer
  already flattened settles rather than keeps moving.
- Playwright — `apps/ui/e2e/list-blocks.spec.ts`, new: the construct opened in a
  real editor, one paragraph rewritten, the autosaved `PUT` asserted byte for
  byte against the file, plus a second save. **Negative control: both fail with
  the fix removed**, and both pass 8/8 under `--repeat-each 4`.
- Full Playwright suite: **356 pass, 3 fail**, and none of the three is this
  change:
  - `smoke.spec.ts:241` and `console.spec.ts:62` are the recorded environmental
    pair — both assert the console strip reads "server unreachable", and the
    user's live workspace server **is** listening on 8765 (pid 1715), which is
    the proxy target;
  - `soft-wrap.spec.ts:193` is a **pre-existing flake, reproduced 2 of 3 full
    runs and 0 of 24 in isolation**. Its cause is now known: it places the caret
    with `press("End")`, which goes to the end of the **visual** line, so under
    parallel load the `!` lands mid-word (`offic!e opens later.`). It cannot be
    this change — `separateListItemBlocks` returns `undefined` for every parent
    that is not a `listItem`, and that document contains no list at all. Left
    alone as out of scope; the same hazard bit the new spec here and was fixed
    there by selecting the paragraph instead of seeking its end.
- `npm run build`, `tsc --noEmit` (apps/ui, packages/kit), `eslint`, `prettier`
  — all clean. (`apps/server`'s `src/docs/bulk.ts` typecheck errors on this
  branch are another agent's in-flight work, untouched here.)

---

## E2E Verification Log — PR #40 review follow-up

**Model run on:** Opus 5 (1M context). Appended, not overwritten: everything
above is the original fix and stands.

Two MAJOR findings from the PR #40 review, both **live failures of the very
family this issue claims went 6 → 0**, and both ruled fixed here rather than
filed. The flush exception for `paragraph → list` was written unconditionally,
but a list may only sit flush under a paragraph if it can **interrupt** one
(CommonMark §5.3), and two spellings cannot.

### Reproduced first, both of them

Through `canonicalizeMarkdown` and through `serializeDoc` on a hand-built
ProseMirror document — `orderedList` carries `attrs.start`, so neither shape
needs a file to exist:

```
MAJOR1 canonical once:  "- Lead paragraph.\n  5. item five\n  6. item six\n"
MAJOR1 canonical twice: "- Lead paragraph.\n  5\\. item five\n  6\\. item six\n"
MAJOR1 serializeDoc(doc(ul(li(p("Lead paragraph."), ol(start 5, li(p("item five")))))))
      = "- Lead paragraph.\n  5. item five\n"
      reparsed → ONE paragraph: "Lead paragraph.\n5. item five" — the list is gone

MAJOR2 serializeDoc(doc(ul(li(p("Lead paragraph."), ul(li(p()))))))
      = "- Lead paragraph.\n  -\n"
      canonicalised → "-\n\n  ## Lead paragraph.\n"
      reparsed → an empty outer item holding an H2. The user's sentence is a heading.
```

And from the **real editor with real autosave**, with the fix removed
(`list-blocks.spec.ts`, the bytes the stub transport received on `PUT`):

```
- Outer bullet leads in.
  - Nested bullet one.
  - Nested bullet two.
  A trailing paragraph of the outer item.
  -
...
- Fourth outer bullet.
  5\. item five
  6\. item six
```

The lone `-` flush under the paragraph is a setext underline; the `5\.` and
`6\.` are the escape that makes the loss permanent. Both are exactly what the
review described.

### The fix

`listInterruptsParagraph` in `serialize.ts`, checked **before** either exception
and regardless of what is on the left, because every block this printer emits
inside a tight item ends on a line a list marker would have to interrupt:

- an ordered list whose `start` is neither null nor 1 cannot interrupt;
- a list whose first item begins with a blank line cannot either —
  `itemStartsBlank`, which is "the first block is an empty paragraph". Task
  items are no exception: `mdast-util-gfm-task-list-item` writes no `[ ] `
  checkbox when the marker is followed by nothing, so an empty task item prints
  as a bare `-` like any other.

Both then get the default blank line, which costs nothing and is what makes both
spellings survive.

### The probe was fixed first, because it could not fail

The 100-pair probe is advertised as what keeps the exception list from going
stale, and it structurally could not see either defect: `BLOCKS.orderedList` was
parameterised at `start: 1` only and every `BLOCKS` list had a non-empty first
item. A probe that cannot fail on the two holes it is pointed at is the thing to
correct first.

`SPELLINGS` adds the four spellings that change the answer (ordered-from-five,
bullet/ordered/task with an empty first item), the pairs run over `BLOCKS ∪
SPELLINGS` — **196 pairs, 392 tests, up from 100 and 200** — and a new guard test
asserts the spelling map still parameterises *both* interruption conditions, so
it cannot silently drift back to uniform `start: 1`. Two probe bugs of its own
were fixed along the way: an empty paragraph has to be built as the parser spells
one (`{type: "paragraph"}`, no `content` key) or every pair holding one fails for
a reason that is not the printer's, and the schema-coverage assertion now runs
over the merged map so adding spellings cannot weaken it.

**Negative control, at three levels.** With the fix removed:

- the pair probe: **60 of 196** variant pairs fail round-trip *and* fixed-point
  (corrected on re-review: the count was written as 169; the matrix is 196 pairs
  and exactly 60 fail, which is the 120 pair failures inside "123 of 471")
  (0 with it);
- `serialize.test.ts`: **123 of 471 tests fail** (120 pairs + the 3 named
  regressions);
- `roundtrip.test.ts`: `lists-block-content.md` fails both its byte-for-byte and
  its idempotence assertion, the fixture having been extended with both
  spellings;
- `list-blocks.spec.ts`: 2 of 3 specs fail in a real browser.

### Sweep — re-run, 610 documents

The corpus has moved since the original run (618 → 610 `.md` outside
`node_modules`, `dist`, `coverage` and other sessions' worktrees), so the
comparison is re-measured across three serializers rather than quoted:

| | pre-UI-103 | UI-103 as PR #40 stands | with this follow-up |
| --- | ---: | ---: | ---: |
| documents that are **not a fixed point** | **7** | **0** | **0** |
| documents whose structure the first save changes | **72** | **67** | **67** |
| documents whose canonical form differs from pre-UI-103 | — | **40** | **40** |

The 7 are the issue's original 6 plus `lists-block-content.md`, the fixture
UI-103 itself added. The 40 differ **only** by inserted blank lines, all 40 of
them — classified in *Where the blank line is not required* above and in UI-104.

**The follow-up moves no repo document**, and that is the honest headline: both
holes need a shape the repo does not contain (`start ≠ 1` sublists, empty first
items). They are reachable by **typing**, which is why the evidence is the
editor-driven spec and the probe rather than the sweep. A sweep over files
cannot see a defect whose input the editor creates.

### Tests

- `apps/ui/src` + `packages/kit/src` — **3,695 pass**, 192 files, 0 fail (3,498
  before; +197 from the widened probe and the new cases).
- New: 3 named regression tests in `serialize.test.ts` (ordered-from-five,
  empty-first-item via `serializeDoc` on the exact PM document from the review,
  and both under a sibling list rather than a paragraph), the two spellings
  appended to the `lists-block-content.md` fixture, and a third Playwright spec
  driving the **`Enter` → `Tab` gesture** that produces the empty sublist — the
  shape no file holds and only the editor makes.
- That spec needed a deterministic caret and did not get one twice. `End` is the
  known visual-line hazard; a triple click then `ArrowRight` *looks* collapsed to
  `window.getSelection()` while ProseMirror still holds a node selection, so the
  `Enter` after it deleted the paragraph (observed, 2 of 4 runs). It now clicks
  just inside the right edge of the paragraph's **last line box** via
  `getClientRects()`. **15/15 under `--repeat-each 5`.**
- Full Playwright: **357 pass, 2 fail** on the second run; the 2 are the recorded
  environmental pair (`smoke.spec.ts:241`, `console.spec.ts:62` — both assert the
  console strip reads "server unreachable" while the user's live server holds
  8765). The first run also failed `todos.spec.ts:555` once; it passes in
  isolation, passed on the re-run, and cannot be this change — its fixture is a
  flat task list with no item holding two blocks, so `separateListItemBlocks`
  never fires on it. Same load-sensitive mouse-drag family as `soft-wrap.spec.ts:193`
  (UI-105), which passed both runs here.
- `npm run build`, `tsc --noEmit` (apps/ui, packages/kit), `eslint`, `prettier`
  — all clean. Ports: the suite ran on **5473**; 8765 and 5173 were never bound.

### MINOR findings, disposed of

- **MINOR 3** — decided and recorded, in *Where the blank line is not required*
  above and as a classified category in UI-104. Kept, not narrowed.
- **MINOR 4** — the `<!---->` mechanism was wrong. Corrected in *The fix* above
  and in `serialize.ts`; `serialize.test.ts` now asserts the real output
  (`- lead\n  - a\n  * b\n`) and names bullet alternation.
- **MINOR 5** — "lead paragraph" widened to "a paragraph of the same item" in
  both docstrings, with a test covering a list after a *later* paragraph.
- **MINOR 6** — `REFUSAL_NOTICE["not-in-file"]` is pinned again, in
  `useAnchorLayer.test.tsx`: a file spelling an inline code span across two lines
  (UI-104's 51-document category) is a document whose words are on screen and in
  no byte range of the file, so the layer refuses with that sentence. The
  `no-quote` test alongside it now asserts its message too, rather than only its
  tone.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
