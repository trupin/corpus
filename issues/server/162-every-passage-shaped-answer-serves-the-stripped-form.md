# [SERVER-162] Every passage-shaped answer serves the stripped form

## Domain

server

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-094
- Blocks: —

## Spec References

- SPEC.md §5 — "**Every passage-shaped answer serves the stripped form**: search
  snippets, the semantic index's chunks (§9.1), related-document passages. The
  index never embeds a marker, so styling a phrase never changes what it
  retrieves for."
- SPEC.md §5 — "`corpus doc show` serves the **raw body** — reading a document
  whole is the deliberate act before editing it (§7), and an agent that saw the
  markers preserves them"
- SPEC.md §9.1 — the semantic index

## Summary

Once bodies carry styling markers, everything the server hands back as a
*passage* would carry them too: a search snippet reading
`the [rate]{color="warning"} rose`, a chunk whose embedding is computed over
attribute syntax, a related-document excerpt full of `==`. §5 forbids all three.
This issue applies `stripStyling` at the projection, which is where a body
becomes index text, and leaves the file and `doc show` untouched.

## Acceptance Criteria

- [ ] The `search` FTS table indexes stripped text
- [ ] `documents.body_excerpt` is stripped
- [ ] Semantic chunks embed and FTS-index stripped text
- [ ] A search for a word that sits inside a styled span finds the document, and
      the snippet shows no marker
- [ ] `corpus doc show` still serves the **raw** body, markers included
- [ ] `GET /api/docs/{id}` still serves the raw body
- [ ] A chunk's `start_offset` / `end_offset` still address the **file**, so a
      resolved passage reads the right bytes
- [ ] Styling a phrase does not change what its chunk retrieves for
- [ ] A workspace with no styling anywhere projects byte-identical index text to
      what it does today

## Technical Design

### Files to Modify

- `apps/server/src/projection/project-document.ts` — `bodyExcerpt`, and the
  `search` insert
- `apps/server/src/semantic/chunker.ts` — the chunk's index text
- `apps/server/src/semantic/chunks.ts` — index and embed the stripped text
- `apps/server/src/core/one-line.ts` — its docblock, which currently says the
  server never strips markdown

### Where the strip goes

**At the projection, once.** The file on disk is the record and keeps its bytes;
the projection holds what the index reads. Every consumer downstream —
`body_excerpt` for list rows, related-document excerpts, thread context
excerpts, search snippets — reads the projection, so one strip serves all of
them and none of them grows its own.

### Chunks, and the two things that must not move

`Chunk` carries `start`/`end` offsets into the body and the invariant
`text === body.slice(start, end)`. `resolve.ts` reads a passage back from the
file by those offsets, so **chunking runs on the raw body** and the offsets stay
true.

What changes is the text that is *indexed*: `Chunk` gains `indexText`, the
stripped form of `text`, and it is what `chunk_search.body` stores and what the
embedder is given.

`chunkId` hashes `indexText` rather than `text`. §5 says styling a phrase never
changes what it retrieves for, and hashing the stripped form makes that true of
the chunk's identity too — styling a word no longer forces a re-embed that would
produce the same vector. **Consequence, recorded**: every existing chunk id
changes once on the first projection after this lands, so a workspace re-embeds
its corpus one time. That is a one-off cost on an index that is already rebuilt
from scratch when the model changes.

### What does not change

`one-line.ts` still does not parse markdown, and sprint-019 Adjudication 5
stands. `stripStyling` removes the four forms §5 names and nothing else — a
document *about* asterisks keeps every one of them. The docblock is amended to
say that, so it does not read as a promise the code no longer keeps.

### Edge Cases

- A marker inside a fenced block in a body: not stripped, because the grammar is
  fence-aware. A code sample that shows `==x==` is indexed as written.
- A styled block's fence lines are removed from index text, so the chunk's
  heading scan is unaffected — a fence line was never a heading.
- Offsets: `char_length` is `text.length` today. It stays the raw length,
  because it describes the span the offsets address.

## Testing Strategy

- A document with markers: assert the `search` row's `body` holds none, and that
  a query for a word inside a span returns the document
- `bodyExcerpt` over a styled body
- A chunk's `start_offset`/`end_offset` still slice the right text out of the
  **file**
- Two documents identical but for styling produce the same `chunk_search.body`
- A marker-free workspace: index text byte-identical to today's
- `GET /api/docs/{id}` and `corpus doc show` return markers

**Falsification.** Remove the strip from the `search` insert and watch the
snippet test go red; remove it from the chunk path and watch the identity test
go red. Two separate call sites, two separate falsifications.

## E2E Verification Plan

1. Start the real server on a workspace
2. Write a document whose body styles a phrase
3. `corpus search <word-inside-the-styled-phrase>` — the document is found and
   the snippet carries no marker
4. `corpus doc show <id>` — the body carries the markers
5. Confirm the semantic index reaches `ready` and a related-document excerpt
   carries no marker

## E2E Verification Log

### Post-Implementation Verification

Implemented on: **opus**.

**Unit.** `project-document.test.ts` 61 passed, `chunker.test.ts` 33 passed,
`chunks.test.ts` 15 passed. The whole `semantic/` and `projection/` suites:
703 passed, 0 failed.

**Falsification, three call sites, three separate breaks.**

| Break | Result |
| --- | --- |
| `insertSearchRows` indexes `passage.body` again | 1 failed |
| `bodyExcerpt` excerpts the raw body again | 1 failed |
| `chunkBody` sets `indexText = text` | 2 failed in `chunks.test.ts`, 2 in `chunker.test.ts` |

Restored: 61, 33 and 15 passed.

One assertion is deliberately **not** a falsifier and is kept anyway: "finds a
word that sits inside a styled phrase" passes with the strip removed, because
FTS5 tokenises on non-alphanumerics and finds `mortgage` inside
`[mortgage]{color="warning"}` either way. It is a requirement the strip must not
break, not evidence the strip is there. The snippet-cleanliness assertion is
what proves the strip.

**E2E, real server, real CLI, real workspace.** Built CLI at
`apps/cli/dist/bin/corpus.js`, a fresh `corpus init` workspace on **port 8766**
(never 8765 — that is the user's own server).

```
$ corpus server start
corpus 0.27.0 listening on http://127.0.0.1:8766 (pid 4852)
```

The document written to disk:

```markdown
The [mortgage]{color="warning"} rate ==rose== sharply, per <u>Ofgem</u>.

::: {align="center"}

A centred note.

:::
```

`corpus search mortgage` — the document is found, and the snippet carries no
marker and no fence line:

```
doc_ratesE2E   Mortgage rates   The mortgage rate rose sharply, per Ofgem. A centred note.
```

`corpus doc show doc_ratesE2E` — the raw body, every marker intact:

```
The [mortgage]{color="warning"} rate ==rose== sharply, per <u>Ofgem</u>.

::: {align="center"}

A centred note.

:::
```

Both halves of §5 hold in the running product: the passage is stripped, the
document is not. The run reported "ranking is degraded — the semantic index is
stale", which is expected in a workspace with no embedding provider configured
and is unrelated to this change; the chunk half is covered by the `chunk_search`
assertions above.

Server stopped (pid 4852). The user's server on 8765 was never touched.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified
