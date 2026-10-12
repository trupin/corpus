# [SERVER-171] Two edge doors where the status act reads wrong

## Domain

server

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SERVER-106 (whose act-subject module these edges sit in)

## Spec References

- SPEC.md **§4**: archiving and restoring are acts wherever they happen; the
  commit names the act. **§5**: `open` is the default status.

## Summary

PR #79's delta re-review (2026-09-24) found two edge doors, both MINOR:

1. **An unset status is read as unchanged.** `readStatusMove` in
   `apps/server/src/docs/update.ts` reads an absent post-save `status` as
   "unchanged". Every other reader treats an absent key as `open` (§5). So
   `PUT {unset: ["status"]}` on a `status: resolved` note is a real
   resolved-to-open move for every reader, but it is not treated as an act
   and commits as `doc edit`. Archived documents are safe:
   `assertNotUnarchivingByPut` refuses that request over an archived file.
2. **A skill's frontmatter archive names an archive that did not happen.**
   `PUT {status: "archived"}` on a `SKILL.md` stays allowed, because the
   archive route heals it on the next call. The frontmatter moves, the file
   does not, and the log now reads `doc archive:` for a change that archived
   nothing. The frontmatter mismatch itself is older than SERVER-106.

## Acceptance Criteria

- [ ] An unset `status` reads as `open` for the status move, so the unset
      case is an act with the right subject (test pinned)
- [ ] A skill's frontmatter-only status write either takes a subject that
      tells the truth, or is refused. Decide which and record the decision
      (test pinned)

## E2E Verification Log

_Implementing agent fills; state the model._
