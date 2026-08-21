# [CONTRACT-070] The heading scan is written twice, and a parity test is holding them together

## Domain
contract

## Status
todo

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
- [ ] One implementation, in `@corpus/contract`
- [ ] The CLI's copy and the parity test are both deleted
- [ ] The server imports the same function
- [ ] Both sides' existing tests pass unchanged — the behaviour is not the
      subject of this issue
- [ ] Fixture-level proof that the two implementations agreed before the merge,
      or a statement of where they differed and which won

## Testing Strategy
Run both implementations over a shared fixture set before deleting either; that
comparison is the evidence, and it belongs in the issue log.

## E2E Verification Log
_[Agent fills — state the model]_
