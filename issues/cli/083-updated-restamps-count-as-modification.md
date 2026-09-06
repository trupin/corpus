# [CLI-083] `updated:` restamps count as modification

## Domain

cli

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: **CONTRACT-098** (the importable key sets)
- Related: CLI-081, CLI-082 (both consume the same comparison), UI-189 (its
  presentation key rides the same mechanism)

## Spec References

- SPEC.md **§5** — server-stamped core fields; **§4** — upgrade

## Summary

Reported from a real upgrade (0.32.0 → 0.33.0, `cos` workspace, 2026-09-06).

Server-stamped keys — `updated:` foremost — make a content-identical file
read as "edited here" in the template comparison. This never conflicts alone,
but it widens every diff and can turn a no-op into a flagged file.

## What to build

The template comparison (`apps/cli/src/template/plan.ts` and the manifest
hashing) ignores server-stamped frontmatter keys when deciding whether a file
diverges from baseline. Enumerate the ignored set from one place (the
contract already knows which core fields the server stamps — reuse, never
restate), and record which keys made the list and why. A file whose only
delta is stamped keys is **unmodified**: not flagged, and eligible for a
clean template update.

## Acceptance Criteria

- [ ] A template file touched only by an `updated:` restamp reads unmodified
      and upgrades cleanly — E2E on a real workspace
- [ ] The ignored-key set is derived from the contract's own definition, with
      a drift test
- [ ] A file with a stamped delta AND a real edit still reads modified
- [ ] `workspace diff` output for a stamp-only file shrinks to nothing (or
      states the file is stamp-only — decide and record)

## E2E Verification Log

_Implementing agent fills; state the model._
