# [INFRA-023] New nanoid advisory blocks every commit; scoped override clears it

## Domain

infra

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: INFRA-010 (established the scoped-override convention)
- Blocks: —

## Spec References

- —

## Summary

Surfaced by the pre-commit gate mid-session, not by inspection: a newly
published advisory, **GHSA-2v37-7h3g-55p8** (`nanoid@<3.3.17` — custom
generators can loop indefinitely when size is zero), rated high. The audit gate
is zero-of-any-severity, so it blocked every commit in the repo, including
changes with nothing to do with it.

Nothing in this repo depends on `nanoid` directly. The route is
`@corpus/ui → vite@7.3.6 → postcss@8.5.25 → nanoid@3.3.16`.

**An override works here, and that is worth stating** because the last audit
finding of this shape (INFRA-021, GHSA-5p4m-2wfm-xmqj) provably could not be
fixed that way and took a narrow expiring exception instead. The difference is
that `postcss` declares `nanoid: ^3.3.16`, so `^3.3.17` is **inside its own
declared range** — the override moves a transitive dependency forward within
what its parent already accepts, rather than forcing a package past a pin its
author set. No semver violation, and no exception needed.

An exception would have been the wrong tool here: exceptions are for findings
that cannot be fixed, and spending one where a real fix exists erodes the
mechanism that makes the narrow ones credible.

## Acceptance Criteria

- [x] The advisory no longer appears in the audit gate — verified, gate exits 0
- [x] The override is **scoped** to the parent that pulls the dependency
      (`postcss`), following INFRA-010's convention, rather than a bare
      repo-wide pin that would silently apply to any future `nanoid` consumer
- [x] The resolved version stays inside `postcss`'s own declared range —
      resolved to `nanoid@3.3.18`, satisfying `^3.3.16`
- [x] No exception was added; the documented exception mechanism stays reserved
      for findings that genuinely cannot be fixed
- [x] The full suite still passes with the new resolution

## Technical Design

### Files to Create/Modify

- `package.json` (`overrides`), `package-lock.json`.

### Notes

- If a future `postcss` narrows its range below the override, the install will
  conflict loudly rather than silently resolving somewhere unexpected — which is
  the behaviour we want from a scoped override.

## Testing Strategy

The audit gate itself is the test, plus the repo-wide suite to confirm the
resolution change is inert at runtime.

## E2E Verification Log

Run by the orchestrator on **Opus 5 (1M context)**, 2026-08-07.

Before: `audit:check ✗ high nanoid@<3.3.17 …` / `✗ 3 vulnerable package(s),
1 unexcepted advisory(ies)`, and `pre-commit ✗ npm audit failed` — the gate
blocked a commit whose diff did not touch dependencies at all.

After adding the scoped override and reinstalling:
`npm ls nanoid --all` → `postcss@8.5.25 └── nanoid@3.3.18`;
`scripts/audit-report.ts` → exit **0**.

Full suite after the resolution change: **513 files, 10,505 tests, 0 failures**;
build, typecheck, lint and format all clean.

## Completion Checklist (domain agent)

- [x] Tests written and passing — the audit gate is the test; no new unit test
      is meaningful for a resolution change
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[ISSUE-ID]` prefix
