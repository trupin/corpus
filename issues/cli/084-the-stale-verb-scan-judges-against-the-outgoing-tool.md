# [CLI-084] The stale-verb scan judges the incoming template against the outgoing tool

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
- Related: CLI-059 (the scan's origin), CLI-077 (`thread digest`, the verb
  that exposed it)

## Spec References

- SPEC.md **§4** — self-upgrade

## Summary

Reported from a real upgrade (0.32.0 → 0.33.0, `cos` workspace, 2026-09-06):
the upgrade flagged `corpus thread digest` in converse/SKILL.md (lines 299,
906) as "a command this tool does not have". The verb exists, and both
flagged lines match its real grammar.

**The reporting agent's diagnosis — a two-word-only parser — is not what the
code shows.** `apps/cli/src/template/stale-verbs.ts:244` caps token
collection at two on purpose, and `thread digest` (with `set` as an `action`
positional) **is** the 0.33.0 registry entry, so the parse is correct and a
0.33.0 binary resolves it. What was actually running was the **0.32.0
binary**: `corpus upgrade` executes on the installed tool, and the scan
resolves the *incoming* template's command references against the *outgoing*
tool's registry — which predates the verb. Every future release that ships a
new verb referenced by its own updated skills will false-positive the same
way. (Hypothesis from reading; the reproduction below is mandatory before
the fix.)

## What to build

The scan must judge the incoming template against the **incoming** tool's
surface. Directions, decide and record:

1. Resolve against the incoming package's own registry (the staged tool copy
   the upgrade already holds), or
2. Defer the scan to first run after the tool swap, reporting then.

Either way: a verb the new tool has is never flagged by the upgrade that
delivers it, and a verb the new tool *dropped* still is — the scan's real
purpose (CLI-059) survives.

## Acceptance Criteria

- [ ] **Reproduce first**: 0.32.0 binary upgrading to 0.33.0 flags
      `thread digest`; log the exact output (the SDLC's bug rule)
- [ ] Post-fix: the same upgrade path reports no finding for `thread digest`
- [ ] A reference to a genuinely removed verb is still flagged (regression
      for the scan's purpose)
- [ ] The three-word-grammar hypothesis is answered in the log — tested, not
      assumed — so the report's author gets a correction or a confirmation

## E2E Verification Log

_Implementing agent fills; state the model._
