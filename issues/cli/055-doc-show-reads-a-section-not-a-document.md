# [CLI-055] `doc show` reads a whole document or nothing, so the cheapest read path bypasses the CLI

## Domain
cli

## Status
todo

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

## Acceptance Criteria
- [ ] `--headings` lists heading paths that `--section` accepts verbatim
- [ ] `--section` output is byte-exact against the file, newlines included
- [ ] Output of `--section` pasted into `doc patch --old` matches exactly once,
      demonstrated end to end on a multi-line passage — the case `search`'s
      snippet cannot do
- [ ] A `--section` naming nothing fails, and never falls back to the whole body
- [ ] `--json` carries the same content, unprettified
- [ ] The measured saving is re-measured and reported, not assumed

## Testing Strategy
Unit tests over the slicing. One end-to-end test that reads a multi-line section
and patches with it against a real server — the round trip is the feature, and
testing the halves separately would miss exactly the ellipsis defect that
motivated this.

## E2E Verification Log
_[Agent fills — state the model]_
