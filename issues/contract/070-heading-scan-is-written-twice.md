# [CONTRACT-070] The heading scan is written twice, and a parity test is holding them together

## Domain
contract

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Related: CLI-055 (which created the copy and filed this), SERVER-040 (heading-path hits in search)

## Spec References
- SPEC.md **§9.3** — the contract as the shared shape between server and clients

## Summary

Filed by CLI-055's implementer, 2026-08-21, against their own work.

`apps/cli/src/commands/doc/sections.ts` re-states
`apps/server/src/core/headings.ts`, because the CLI cannot import from the
server. The implementer guarded it with a parity test that reads the server's
source and fails when either side moves — which is honest, and is not a fix.

**Two implementations of "where does this heading start and end" is exactly the
class of defect this repository keeps finding.** The anchor engine, the fence
scanner and the scope walk have each been written twice at some point, and every
one of those produced a real bug: PR #48's CRITICAL was a client keeping its own
copy of the scope walk on a rule the server had deleted, and both suites were
green because each asserted its own copy.

A parity test that reads another package's *source text* is a smarter version of
the same arrangement. It fails loudly, which is better than silence, but it
cannot survive a refactor that moves the function, and it pins prose rather than
behaviour.

## What to do

Move `headingSections` and `renderHeadingPath` into `@corpus/contract`, beside
the `splitLines` and `fencedCodeRanges` primitives **both sides already import
from there** — which is the argument: the dependency is already permitted and
half the primitives already live there. Then delete the CLI's copy and the
server's, and delete the parity test with them.

## Decisions to make and record

1. **Whether `HEADING_PATH_SEPARATOR` moves too.** It is already in the
   contract; check nothing else re-states it.
2. **Whether the server's version has behaviour the CLI's copy dropped**, or the
   reverse. Do not assume they agree because the parity test passes — it reads
   source, so it proves textual similarity rather than equal behaviour. Diff the
   two by running both over the same fixtures before deleting either.
3. **Whether search's `headingPath` producer shares this code or a third copy.**
   If it is a third, this issue got bigger and should say so.

## Acceptance Criteria
- [x] One implementation, in `@corpus/contract`
- [x] The CLI's copy and the parity test are both deleted
- [x] The server imports the same function
- [x] Both sides' existing tests pass unchanged — the behaviour is not the
      subject of this issue
- [x] Fixture-level proof that the two implementations agreed before the merge,
      or a statement of where they differed and which won

## Testing Strategy
Run both implementations over a shared fixture set before deleting either; that
comparison is the evidence, and it belongs in the issue log.

## E2E Verification Log

Model: **opus** (claude-opus-5, 1M context).

### The three decisions the issue asked for

**1. `HEADING_PATH_SEPARATOR` does not move — it was already in the contract,
and nothing re-states it.** Swept the repository: every join goes through the
constant, and the only *renderers* were `apps/server/src/semantic/chunker.ts`
and the CLI's copy, character for character. That join moved too, as
`renderHeadingPath`, so the constant now has exactly one renderer.

**2. Neither implementation had behaviour the other dropped.** Proven by
fixtures rather than by reading (below). The merged shape carries **`level`**,
which is the one asymmetry: the CLI's copy tracked each section's heading depth
(`corpus doc show --headings` prints an outline) and the server's did not. It is
additive for the server — nothing there reads it — and it is why two assertions
in the moved test now spell `level: 0` in a whole-section `toEqual`. That is the
only assertion anywhere that changed.

**3. Search's `headingPath` producer is not a third copy.**
`apps/server/src/search/search.ts`'s `headingPathFor` reads a **stored**
`heading_path` written at projection time by the chunker, or a turn's heading
from the `turns` row. It performs no scan. So this issue did not get bigger:
there were two scans and two renderers, and there is now one of each.

### Fixture-level proof, taken before either copy was deleted

A throwaway script ran the server's `headingSections` and the CLI's
`documentSections` over one fixture set and compared each section's rendered
address and offsets. The server's partition was filtered to its non-blank
sections first, because dropping the blank preamble is the CLI's presentation
rule and not a scan difference.

```
$ ./node_modules/.bin/tsx parity-scratch.ts
agree   empty
agree   preamble only
agree   opens on a heading
agree   three levels
agree   sibling
agree   empty heading closes a level
agree   closing sequence and indent
agree   four-space indent is code
agree   setext is not a heading
agree   fenced headings are prose
agree   fence inside a list item
agree   blockquoted fence
agree   repeated heading
agree   tabs after the hashes
agree   crlf
agree   trailing heading with no body
agree   deep then shallow
agree   six and seven hashes
agree   no trailing newline
agree   heading only whitespace after hashes
agree   separator inside a heading
agree   unterminated fence
agree   blank preamble then heading

23 fixtures, 0 disagreements
```

The two agreed everywhere, so nothing had to win. (The script was deleted after
the run; it lived at the repository root only because module resolution from a
scratch directory cannot see the workspace.)

### What landed

- **New**: `packages/contract/src/headings.ts` — `headingSections`,
  `enclosingHeadings`, `renderHeadingPath`, `HeadingSection`. It sits beside
  `code.ts` for the same recorded reason (CONTRACT-044) and builds on the
  `splitLines` / `fencedCodeRanges` / `overlapsRange` primitives both sides
  already imported from there, so the dependency edge is one the repository had
  drawn. Exported from the barrel; `index.test.ts` pins all three names.
- **New**: `packages/contract/src/headings.test.ts` — the server's
  `core/headings.test.ts` cases, carried over, plus three for `level`, the
  heading-line start, and the display join.
- **Deleted**: `apps/server/src/core/headings.ts`,
  `apps/server/src/core/headings.test.ts`, the CLI's scan and its
  `renderHeadingPath`, and the parity test
  ("the heading scan is the server's, not a second opinion") with its
  `node:fs`/`node:path`/`node:url` imports.
- **Rewired**: `apps/server/src/core/index.ts` now names the scan on the `core`
  surface, exactly as it already did for the fence scanner; `threads/context.ts`,
  `threads/context.test.ts`, `semantic/chunker.ts`, `semantic/chunker.test.ts`
  import from `@corpus/contract`; `semantic/index.ts` re-exports
  `renderHeadingPath` from the contract, so `threads/context.ts`'s import of it
  is untouched.
- `apps/cli/.../sections.ts` keeps only the CLI's own part: which sections are
  readable, how one is addressed, and the three refusals. `documentSections` is
  now a map-and-filter over the shared scan. The comment about `match` versus
  `exec` went with the copy — `hygiene.test.ts` scans `apps/cli/src/commands/**`
  and the scan is no longer there.

### Falsification — one break, three packages fail

The merge is only real if a single edit reaches every consumer. The fence mask
was disabled in the contract (`if (false) continue;`) and the package rebuilt:

```
× enclosingHeadings > ignores headings inside a fenced code block                    (contract)
× headingSections > keeps a fenced heading inside the section that encloses the fence (contract)
× documentSections > reads a `## Rates` inside a fenced block as prose …             (cli)
× chunkBody — fences are not headings > … (5 cases)                                  (server)
Test Files  3 failed | 1 passed (4)
Tests  8 failed | 104 passed (112)
```

Under the old arrangement that same edit would have failed one package and left
the other green — which is the defect the issue is about. Restored and rebuilt.

### Tests, typecheck, lint

```
$ npm run build                                                    → 0
$ VITEST_MAX_THREADS=4 vitest run packages/contract apps/cli/src/commands/doc
Test Files  85 passed (85)     Tests  3374 passed (3374)

$ VITEST_MAX_THREADS=4 vitest run apps/server/src/semantic apps/server/src/threads/context.test.ts \
      apps/server/src/search apps/server/src/core
Test Files  50 passed (50)     Tests  1127 passed (1127)

$ npm run typecheck -w packages/contract → 0
$ npm run typecheck -w apps/server       → 0
$ npm run typecheck -w apps/cli          → 0
$ eslint <12 touched files>              → 0
$ prettier --check <12 touched files>    → clean
```

One typecheck error surfaced and was fixed: `sectionAt`'s last-resort literal in
`threads/context.ts` had to gain `level: 0` once `HeadingSection` carried the
field. `tsc` found it; no test could have.

### Out of scope, and named rather than left silent

The server suite was run **scoped** to the four areas this touched, not whole.
The repo-wide run is the orchestrator's harvest gate.
