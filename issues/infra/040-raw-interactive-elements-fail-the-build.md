# [INFRA-040] A raw interactive element outside kit fails the build

## Domain

infra

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: UI-191 (the primitives and the migration — this check encodes
  its end state)

## Spec References

- **CLAUDE.md** → Verification Is On Demand: a diff-scopable check runs
  locally, a whole-codebase check is CI's (user rule, 2026-08-07)

## Summary

The second half of the 2026-09-06 directive:

> "come up with some static check that ensures that those components are
> being used everywhere they should. Make that a pre-commit check + CI check
> so such inconsistencies stop happening."

## What to build

**An ESLint rule, not a bespoke scanner** — recommended and to be confirmed
by the implementer against one alternative, recorded either way. The case:
ESLint already runs diff-scoped on staged TypeScript in pre-commit and
whole-repo in CI, so the rule rides both gates with **zero new hook steps**,
satisfying INFRA-025's placement rule by construction. A bespoke script
would duplicate that wiring for nothing.

- `no-restricted-syntax` (or a small local rule if messages need to name the
  replacement) forbidding JSX `<button>`, `<select>`, `<option>` in
  `apps/ui/src` and `packages/kit/src`, with the message naming the kit
  primitive to use instead — a refusal that does not say the fix is half a
  refusal.
- **Exemptions are files, not comments**: the primitives' own internals
  (UI-191's recorded list) are exempted by path in the ESLint config. No
  inline `eslint-disable` is acceptable for this rule anywhere else — the
  Lint Discipline section already forbids fixing lint by disabling it.
- Native elements that stay legitimate (`<input>` for text, `<a>`, form
  internals inside kit's Composer) are out of scope — the rule bans exactly
  what UI-191 replaced, and the issue records the banned list.

## Acceptance Criteria

- [ ] A raw `<select>` added to any apps/ui file fails `npx eslint` on that
      file with a message naming the kit primitive — shown in the log
- [ ] Pre-commit blocks it (staged-file path, measured cost ~0 — it is the
      existing eslint step)
- [ ] CI whole-repo lint catches a file nobody staged
- [ ] Zero violations on the migrated tree; zero inline disables
- [ ] The exemption list matches UI-191's recorded internals exactly, with a
      test or comment pinning the two together

## E2E Verification Log

_Implementing agent fills; state the model._
