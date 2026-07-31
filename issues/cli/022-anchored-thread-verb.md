# [CLI-022] No CLI surface for anchored thread creation

## Domain
cli

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: CLI-003
- Blocks: —

## Spec References
- SPEC.md §6 (anchored threads), §7 (the agent interacts only through the CLI), §9.2 `POST /api/threads`

## Summary
Found during CLI-018 (2026-07-31): `POST /api/threads` supports three creation shapes
(anchored on a selection, whole-document, standalone), but the CLI reaches only the
standalone shape — an agent cannot open a comment thread ON a document, let alone on
a text-quote anchor, despite §7 binding it to the CLI for every interaction. Add the
missing shapes to the thread-creation surface (e.g. `corpus thread new --on <docId>
[--quote "<exact text>"]` — the server derives the selector from the quote the way
the create-thread endpoint already specifies). Exact verb/flag shape follows the
existing thread verb conventions; no contract change expected (the route accepts all
three shapes today — verify against the generated client first).

## Acceptance Criteria
- [ ] Agent can create a whole-document thread and an anchored thread (quote → selector, anchor written into the parent's frontmatter) via documented verbs
- [ ] Quote not found in the parent: the server's error surfaces per existing conventions (no client-side selector construction)
- [ ] `docs/cli.md` regenerated; thread verb inventory tests updated

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/thread/` creation verb (+ tests); docs regen

## Testing Strategy
apps/cli scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real server: anchored create from the CLI → anchor in parent frontmatter, thread file, highlight visible in the UI (once UI-027 lands).

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
