# [CONTRACT-085] `doc check` cannot name a malformed `resident:` block

## Domain

contract

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SERVER-132
- Blocks: —

## Spec References

- SPEC.md **§11** — the check vocabulary and its severity partition
- SPEC.md **§7** — designation is user-only state on a standalone thread

## Summary

Filed out of SERVER-132, which shipped the right behaviour through the wrong
door and said so.

An ill-shaped `resident:` block makes a designation vanish from the roster.
SERVER-132 made that visible, but reported it through `corpus db doctor` rather
than `corpus doc check`, because `doc check`'s code list is a closed contract
enum whose every non-warning member blocks the write. Reporting there today would
mean either a new code — a contract change, which is this issue — or reusing
`frontmatter-invalid`, which would make the broken thread permanently unwritable.
That last is SERVER-123's regression verbatim and was correctly refused.

So the finding lives in the projection doctor, which is a health command a person
runs deliberately, rather than in the check a person runs on a document they are
editing. It is reported, but not where someone would look.

## Acceptance Criteria

- [ ] `CHECK_CODES` gains a `resident-malformed` member at **warning** severity,
      so `corpus doc check` reports it and does not block the write
- [ ] The severity choice is stated in the schema, not merely made: a designation
      is user-only state, and refusing the write would trap the thread
- [ ] With the code declared, the finding joins `REPORTED_CHECK_CODES` beside
      `unterminated-fence` and reaches `doc check` with no detail-string predicate
- [ ] `openapi.json` and the typed client regenerated, not hand-edited
- [ ] A follow-up server issue moves the finding, or records why the doctor
      report stays alongside it

## Technical Design

Note the interaction with CONTRACT-084 and SERVER-067, which put tolerated
errors on the mutation response. If `resident-malformed` is a warning rather than
a tolerated error, it travels the existing warning path and needs nothing from
that work.

## Testing Strategy

Contract-side: the code is declared, `codes.test.ts`'s partition assertions still
hold, and `openapi.json` regenerates cleanly.

## E2E Verification Log

_(to be filled by the implementing agent)_
