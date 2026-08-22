# [SHARED-065] Sweep every open issue clean of plugins and todos

## Domain
shared

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SHARED-064 (signed and applied)

## Spec References
- SPEC.md — §10, §12 and §13 are deleted; the plugin concept is gone from §1, §3, §4, §5, §7, §9 and §12

## Summary

Part of Phase 41. The plugin surface and the todos plugin are removed entirely,
on the user's instruction: *"I want it fully gone, no trace of it in the codebase
or the specs."* `todo` is not a document type.

The full inventory for this area is in the orchestrator's brief to the
implementing agent. Two rules bind every part of this phase:

1. **A document carrying an unrecognised `type:` must still open, render with
   working checkboxes, search, and pass `doc check`.** That is SPEC §12's M6, and
   it is what protects the user's existing `type: todo` documents.
2. **Where a rule existed only because a plugin might, delete it. Where it
   survives its cause, keep it and restate the reason.** A docblock explaining a
   constraint by a plugin that no longer exists is worse than no docblock.

## Acceptance Criteria
- [x] No reference to plugins or todos remains in this area
- [x] Rules that outlive their plugin justification are kept and restated
- [x] Nothing that only existed for plugins is left behind as a stub

## E2E Verification Log

### 2026-08-22 — the sweep (shared, model: Opus 5)

**The open-issue list came from `issues/PLAN.md`'s status column, never from
grep.** A naive `grep -rli todo issues/` matches the literal status word in every
file, which is where the brief's ~77 false positives came from. The list was
built by parsing the plan's `| ID | Title | Status | …` rows for `todo`,
`in_progress` and `blocked` — **86 open issues** — and each ID was resolved to its
file through its own `# [ID]` heading, the same rule `scripts/issue-tracker.ts`
uses, because `AGENT-*` does not live under `issues/agent-runtime/` for every
number.

**21 of the 86 matched `plugin|todos|@corpus/kit|/api/x/`.** Six are Phase 41's
own deletion issues (CLI-060, INFRA-031, SHARED-065, SHARED-066, UI-149, UI-150),
which must name what they delete. The other 15 are the survey's 15 — the sweep
found no open issue the survey had missed on this axis. A second, wider pass over
`type: todo`, `` `todo` ``, `PLUGINS-[0-9]`, `packages/kit`, `corpus todos` and
`/api/x` added nothing: every extra hit was a `packages/kit` path, and the kit is
kept by SHARED-064 amendment 3.

**Four closed, eleven rewritten.** One reclassification against the brief:
**SERVER-065 was retargeted rather than closed.** Its headline was
`plugins/discover.ts`, but its *"Also worth deciding here"* section names three
core projection readers that swallow a failed `readdir` silently, and all three
were verified still in the tree — `projection/roots.ts:180`,
`project-runtime.ts:51`, `unindexable.ts:195`. Closing it would have lost a real
defect.

**Every claim of the form "the file is gone" was checked on disk**, not inferred
from the plan: `apps/server/src/plugins/` (absent), `apps/cli/src/registry/plugins.ts`
(absent), `apps/ui/src/plugins/` (absent), `assertDerivedFieldsNotSet` (absent from
`apps/server/src/docs/update.ts`), `pluginRequest` / `usePluginQuery` /
`broadcastInvalidate` (absent from `packages/kit/src` and `apps/ui/src`, present
only in stale `apps/ui/dist` output), and `apps/ui/e2e/todos*.spec.ts` +
`plugin-late-arrival.spec.ts` (deleted in the working tree).

**One item was found already fixed rather than moot.** SHARED-003's
reveal-into-focus gap was filed against PLUGINS-010 but was a defect in core
`FocusMode`. `onOpenFocus` is now wired at `apps/ui/src/board/Column.tsx:223-230`
and carries an `OpenPayload` to both surfaces, so the ledger records it as
resolved.

**Gates:**

- `./node_modules/.bin/tsx scripts/check-issues.ts` → `issues:check ✓ 568 PLAN
  rows and 568 issue files agree`. It failed first on all four closures with
  `is closed with no reason`, because the checker reads the gloss from the status
  **line** and this file's prose sat a paragraph below. Each now carries a
  same-line `closed — obsoleted by SHARED-064 (Phase 41): …`.
- `npx prettier --check "issues/**/*.md"` → `All files formatted correctly`.
- No file was deleted, and no code was touched. `git diff --stat` reports 16
  files, all under `issues/`.
