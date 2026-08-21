# [CLI-055] `doc show` reads a whole document or nothing, so the cheapest read path bypasses the CLI

## Domain
cli

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —
- Related: CLI-035 (`doc patch`, whose `--old` this exists to feed), CLI-019 (`corpus search`)

## Spec References
- SPEC.md **§2** — the CLI is the agent's whole surface
- **CLAUDE.md Architecture Decision 2** — *"The agent interacts with the system **only through the CLI**."*

## Summary

Reported from live use, 2026-08-21, with measurements.

`corpus doc patch` needs a byte-exact `--old`. That makes it the cheap way to
edit — but only if a passage can be quoted without reading the whole document.
Through the CLI alone, it cannot be.

- `corpus doc show` declares `flags: []` (`apps/cli/src/commands/doc/show.ts:63`).
  All or nothing, verified.
- `corpus search --json` returns `headingPath` and a snippet, but the snippet is
  **ellipsized and newline-collapsed**. Tested in the field: a snippet quoted
  across a line break matched **0 times**. A single-line snippet patched
  successfully once the leading and trailing `…` were stripped. So search drives
  a one-line change and nothing that spans lines.
- `doc diff` shows revisions, `doc related` returns neighbours. Neither reads
  content.

**Measured on a 3,500-word document**: `show` then `edit --key` costs 3,510 words
in and 3,490 out across 3 calls. A targeted read then `patch` costs 20 and 20
across 1 call. Roughly **175× less context**.

## Why this is P0 rather than an ergonomic wish

The workaround is `grep` and `sed` against the file, then patch. It works, and it
is self-checking — a stale read makes `--old` match 0 times, so the write fails
loudly rather than silently.

**That is the problem.** It means the cheapest read path in a Corpus workspace
goes around the CLI, and CLAUDE.md's second architecture decision says the agent
interacts with the system *only* through it. The invariant is not being violated
by carelessness; it is being violated because the CLI does not offer the thing.
An architecture decision that costs 175× to honour will not be honoured.

## What to build

- `corpus doc show <id> --headings` — the document's heading tree, as
  `headingPath` values that `--section` accepts, with nothing else.
- `corpus doc show <id> --section "<headingPath>"` — that section's body text,
  **byte-exact and unmodified**, suitable for pasting straight into
  `doc patch --old`.

**Byte-exactness is the whole feature.** `search`'s snippet failed precisely
because it was prettified. Whatever `--section` prints must be what is in the
file, including its newlines and its trailing whitespace. If a rendering step
would touch it, it is the wrong output for this flag.

## Decisions left to the implementer, to make and record

1. **Server-side route or CLI-side slice?** A CLI-side slice of the body it
   already fetches solves the reported problem — the cost being paid is the
   agent's context, not the wire. A route makes the wire small too and would
   serve the UI later. Start with whichever is honest about what it saves, and
   say which in the issue: do not claim a wire saving a CLI-side slice does not
   make.
2. **Heading-path syntax must match what `search --json` already emits**, or the
   two cannot be composed — and composing them is the point: search to find the
   section, `--section` to read it, `patch` to change it.
3. **What a `--section` that matches nothing does.** It must fail loudly, and it
   must not print the whole document as a fallback — that is the 175× cost
   arriving silently.
4. **Ambiguity**: two sections with the same heading path. Decide, and say so.

## Decisions taken

### 1. CLI-side slice, not a server route

`corpus doc show` slices the body that `GET /api/docs/{id}` already returned.
**No wire saving is claimed anywhere**, and the help text says so in as many
words: "These two flags narrow **what you read**, not what crosses the wire."
A test asserts the request count is still one.

*Rejected: a server-side route* (`GET /api/docs/{id}/sections` or a `section`
query parameter). It would shrink the wire too, would serve the UI later, and
would let the server reuse its own `headingSections` instead of this CLI
re-stating it. Three reasons it lost:

1. The reported cost is the agent's context, not bytes on a loopback socket.
   Nobody reported the wire.
2. It needs a CONTRACT issue and a SERVER issue to ship, and this is P0.
3. **The decisive one.** A section computed server-side is a *second*
   definition of "the bytes to quote", sitting beside `doc.body` — the string
   `POST /api/docs/{id}/patch` actually matches `--old` against. Slicing the
   body this read already holds makes the excerpt a substring of that exact
   string *by construction*, which is the one property the feature turns on.
   Two definitions is one drift away from a `--section` that reads correctly
   and patches nothing.

**Accepted cost:** the heading scan is duplicated from
`apps/server/src/core/headings.ts`, which `apps/cli` cannot import (the CLI
depends on `@corpus/contract` alone, and `headings.ts` is not on the server's
published surface). Mitigated by a parity test in `sections.test.ts` that reads
the server's source and fails when either side moves. **Follow-up worth
filing:** move `headingSections` + `renderHeadingPath` into `@corpus/contract`,
beside the `splitLines` / `fencedCodeRanges` / `overlapsRange` primitives both
already build on, and delete the copy.

### 2. The heading-path syntax is search's, verified against a live server

Not assumed. Against a real workspace, `corpus search "impound account" --json`
returned `headingPath = "Mortgage options › Escrow"`, which is character for
character one of the lines `corpus doc show <id> --headings` printed, and
`--section` accepts it unchanged. The separator comes from the contract's own
`HEADING_PATH_SEPARATOR` (`" › "`, U+203A) rather than a literal, and the
render rule is the server's: enclosing headings outermost first, the document's
**title** when a passage has none above it. A thread turn is addressed by its
own `<author> · <ts>` heading, which is how the server addresses a turn hit.

Matching is **string equality against the whole path**. *Rejected: accepting a
bare last segment* (`--section Escrow`) as a convenience — it is a second
accepted form to document, it manufactures ambiguity that the full path does
not have, and neither producer of a path (`search --json`, `--headings`) ever
emits one. A near miss now fails loudly and lists the real paths, which is one
step, not two.

### 3. A `--section` matching nothing is exit 2, and prints nothing at all

Zero bytes on stdout, verified. The message names the path and says nothing was
printed, and the **paths that do exist are listed in the error** — capped at 40,
with an overflow line pointing at `--headings`. `--json` carries the same list
at `.error.details.headingPaths`, so a machine caller recovers without a second
request either. There is no fallback of any kind: a test asserts the body
appears nowhere in the message, the hint, or the rendered details.

*Rejected: `RefusedError` (exit 7, `code: "no_such_section"`).* A distinct
machine code is genuinely nicer, but exit codes in this CLI group by *what the
caller does next*, and exit 7's established meaning is a precondition that
retrying later might satisfy. A missing section will not appear by waiting —
the caller must change its command line, which is exit 2. The structured
recovery moved into `details` instead.

### 4. Two sections with the same heading path: refused, and `--nth` chooses

A path names more than one section only when a heading is literally repeated
under the same parent (a second top-level `## Notes`; or an `# Title` under a
document whose title is the same word, which collides with the preamble's
title-derived address). That is refused with the count and each occurrence's
character range, and `--nth 1 … --nth n` selects one in document order. `--nth`
past the end, below 1, or non-integer is exit 2; `--nth` without `--section` is
exit 2 before any request.

*Rejected: returning the first match.* A silently wrong section on the one verb
whose output is pasted into a write is the worst available outcome — the patch
would apply cleanly to the wrong passage. *Also rejected: an index inside the
path syntax* (`"A › B#2"`), which would stop `search --json`'s output pasting
in unchanged and so break decision 2.

### Boundary rules, stated once

- A section runs from the first character of **its own heading line** to the
  character before the next heading that closes it. The heading is part of what
  is printed. This is the server's own definition, already used for the thread
  context pack's `section` field.
- Trailing blank lines inside those bounds are part of the section, verbatim.
- The text above the first heading is a section, addressed by the document's
  title. It is dropped when blank, so a document opening with `# Title` does
  not offer an empty section colliding with that heading.
- A document with no headings is **one** section, the whole body. That is not a
  fallback: `--headings` lists exactly that one address, and the caller named it.
- Headings inside fenced code blocks are prose, using the contract's own
  `fencedCodeRanges` mask — the same one the server's scan and the semantic
  chunker read.

## Acceptance Criteria
- [x] `--headings` lists heading paths that `--section` accepts verbatim
- [x] `--section` output is byte-exact against the file, newlines included —
      the section read through the CLI occurs **exactly once** as raw bytes in
      `data/docs/inbox/mortgage-options.md` on disk
- [x] Output of `--section` pasted into `doc patch --old` matches exactly once,
      demonstrated end to end on a multi-line passage — twice, on a 10-newline
      whole section and on a 3-line excerpt cut from that section's own bytes
- [x] A `--section` naming nothing fails (exit 2, 0 bytes on stdout) and never
      falls back to the whole body
- [x] `--json` carries the same content, unprettified (10 newlines preserved,
      no ellipsis)
- [x] The measured saving is re-measured and reported, not assumed — see below;
      the honest figure is **19× on the read and 98× on the write**, not 175×

## Testing Strategy
Unit tests over the slicing. One end-to-end test that reads a multi-line section
and patches with it against a real server — the round trip is the feature, and
testing the halves separately would miss exactly the ellipsis defect that
motivated this.

## E2E Verification Log

**Model: Opus 5 (1M context) — `claude-opus-5[1m]`.** Date 2026-08-21.

Real `corpus` invocations (`tsx apps/cli/src/bin/corpus.ts`) against a real
daemonized server on **port 8911** in a scratch workspace — never the user's
server on 8765. Document: 3,426 words, 30,579-character body, 8 sections.

### Before the fix — reproduction

```
$ corpus doc show doc_hhtyj2z7 --headings
corpus: unknown flag "--headings" for "show".
  Known flags: --from, --json, --workspace, --timeout, --verbose, --no-color, --help, --version

$ corpus doc show doc_hhtyj2z7 | wc -w
    3443                      # words IN, to read anything at all

$ wc -w big.md
    3426                      # words OUT, the body `doc edit --key --file` resends
```

The only cheap read available, and why it does not work:

```
$ corpus search "impound account" --json | jq -r .hits[0].snippet
…It draws on the impound account the lender opened at closing, and…

$ corpus doc patch doc_hhtyj2z7 --from agent --old "$SNIP" --new x
corpus: the text --old quotes is not in the body of doc_hhtyj2z7 — it matched 0 times, so nothing was written.
exit=10
```

Ellipsized **and** newline-collapsed: the body has a line break between
`closing,` and `and the true-up`. Exactly the reported defect, reproduced.

### After the fix

```
$ corpus doc show doc_hhtyj2z7 --headings
Mortgage options
Mortgage options › Rates
Mortgage options › Rates › Fixed
Mortgage options › Rates › Adjustable
Mortgage options › Escrow
Mortgage options › Underwriting
Mortgage options › Closing costs
Mortgage options › Appendix
                              # 35 words

$ corpus search "impound account" --json | jq -r .hits[0].headingPath
Mortgage options › Escrow     # decision 2, verified not assumed
```

**Byte-exactness against the file on disk**, not against the CLI's own idea of
the body:

```
$ corpus doc show doc_hhtyj2z7 --section "Mortgage options › Escrow" > old.md
$ python3 -c "print(open('.../mortgage-options.md','rb').read().count(open('old.md','rb').read()))"
1                             # occurs verbatim, exactly once, 1232 bytes, 10 newlines
```

**The round trip — the acceptance test that matters** (multi-line, 10 newlines):

```
$ sed 's/opened at closing,/opened at signing,/' old.md > new.md
$ corpus doc patch doc_hhtyj2z7 --from agent --old-file old.md --new-file new.md
patched doc_hhtyj2z7 — 1 occurrence replaced
key 9fdbd806d641c8352f71551a53d991afa62ac0a446185c0f5ed211ccfec6089a
exit=0
$ grep -n "opened at signing" .../mortgage-options.md
35:It draws on the impound account the lender opened at signing,
```

**And again on a 3-line excerpt cut from `--section`'s own output**, which is
what an agent actually does — read the section, quote the lines that change:

```
$ sed -n '3,5p' section.md > tiny-old.md      # spans a blank line
$ corpus doc patch doc_hhtyj2z7 --from agent --old-file tiny-old.md --new-file tiny-new.md
patched doc_hhtyj2z7 — 1 occurrence replaced
exit=0
```

### Falsification — the fix broken on purpose

`documentSections` altered to prettify its slice the way the search snippet is
prettified (`…${text.replace(/\s+/g, " ").trim()}…`). **14 unit tests failed**,
including "slices bytes, so every section is a substring of the body it came
from" and "prints a section byte for byte". The live round trip failed too, in
exactly the original way:

```
$ corpus doc show doc_hhtyj2z7 --section "Mortgage options › Escrow" > old-broken.md
$ head -c 120 old-broken.md
…## Escrow The escrow reserve is recalculated annually. It draws on the impound account the lender opened at signing, an
$ corpus doc patch doc_hhtyj2z7 --from agent --old-file old-broken.md --new x
corpus: the text --old quotes is not in the body of doc_hhtyj2z7 — it matched 0 times, so nothing was written.
exit=10
```

Restored, re-verified green.

### Refusals

```
$ corpus doc show doc_hhtyj2z7 --section "Escrow"; echo $?
corpus: --section "Escrow" names no section of doc_hhtyj2z7, and nothing was printed.
  Matching is exact, against the whole path. The separator is “ › ” (U+203A with a space each side), and a `headingPath` from `corpus search --json` pastes in unchanged. The sections this document does have:
    Mortgage options
    Mortgage options › Rates
    …
2
# stdout: 0 bytes.  --json: code=usage_error, details.matches=0, details.headingPaths=[8 paths]

$ corpus doc show doc_abbfkt4v --section "Notes"; echo $?
corpus: --section "Notes" names 2 sections of doc_abbfkt4v, so nothing was printed.
  A heading path repeats when its heading does. Choose one with --nth 1 … --nth 2, in document order:
    --nth 1 · chars 0–51 · 51 characters
    --nth 2 · chars 68–99 · 31 characters
2
$ corpus doc show doc_abbfkt4v --section "Notes" --nth 2
## Notes

Second set of notes.
```

`--nth 3` (out of range), `--nth 0` / `-1` / `1.5`, `--headings` with
`--section`, and `--nth` without `--section` are all exit 2. The last two are
refused **before the request** (asserted by request count in tests).

### No regression on the plain read

`corpus doc show <id>` and `--json` unchanged: header, key on line 3, path,
timestamps, tags, body; `--json` keys still
`frontmatter, body, path, anchors, key, userEditing`.

### The re-measurement, honestly

Same 3,426-word document, same edit.

| | calls | words IN | words OUT |
|---|---|---|---|
| Before — `doc show` then `doc edit --key --file` | 3 | 3,443 | 3,426 |
| After — `--headings`, `--section`, `doc patch` | 3 | 185 (35 + 150) | 35 |
| After — `search --json` gives the path, then `--section`, then `patch` | 3 | 359 (209 + 150) | 35 |

**19× less read and 98× less written**, or 30× on the combined total — not the
175× the issue projected. The gap is arithmetic, not a shortfall: the projected
figure assumed a ~20-word passage read directly, while a read is bounded below
by the section that contains it, and this document's `Escrow` section is 4.0%
of its body (1,232 of 30,579 characters). The write half is where the 100×
lives, and that half is what `doc patch` was built for.

### Checks

- `npx vitest run apps/cli` — see the report; scoped runs only, `VITEST_MAX_THREADS=4`.
- `eslint apps/cli/src` — clean, no rule disabled anywhere.
- `prettier --check apps/cli/src docs/cli.md` — clean.
- `tsc --noEmit -p apps/cli/tsconfig.json` — clean.
- `docs/cli.md` regenerated with `npm run docs:cli -w apps/cli`; `docs/generate.test.ts` green.
- Test server on 8911 stopped; port 8765 never touched.
