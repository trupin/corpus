# [CLI-032] `corpus doc list` cannot ask for top-level documents only

## Domain

cli

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: CONTRACT-042, SERVER-073
- Blocks: —

## Spec References

- SPEC.md §2.2 rule 4 — CLI verbs are thin typed-client calls
- SPEC.md §9.2 — the filter set

## Summary

The agent-facing half of the user's `isParent` request. `apps/cli/src/commands/filters.ts`
mirrors the collection query's filters as flags (`--parent` at L112/L202), and
`doc list` documents which of them are thread-only (L137). A filter the agent
cannot pass is a filter the agent cannot use, and the retrieval rules lean on
`doc list` heavily.

P2 rather than P1: the board is what the user asked for, and the CLI can follow.

## Also in scope: a help string SERVER-071 made false

`apps/cli/src/commands/thread/create.ts` (module doc and the `create` command
description) promises that a quote the document "contains twice with nothing to
tell the occurrences apart, still creates the thread and comes back with the
`orphaned_anchor` warning". **SERVER-071 made that a `400` (exit 5)** — a
repeated quote is underspecified and is now refused, escapably, by supplying
framing that occurs once.

CLI tests use a stub server, so nothing failed and nothing will. It is purely a
doc fix, which is exactly why it needs an owner rather than a note in a commit
message.

## Acceptance Criteria

- [ ] `thread create`'s help no longer promises a thread for a doubly-occurring
      quote, and says how to disambiguate (`--prefix`/`--suffix`)

- [ ] A flag on `corpus doc list` selects top-level documents only, and its
      counterpart selects children
- [ ] Its help text says it selects **roots**, not documents that have children
      — the name's trap (CONTRACT-042) reaches the CLI too, and help text is
      where an agent learns what a flag does
- [ ] Absent means no filtering; an existing command line behaves exactly as
      before
- [ ] `doc list`'s thread-only note (L137) is updated if this filter is **not**
      thread-only, so the list of exceptions stays true
- [ ] It stays a thin typed-client call — no filtering client-side, which would
      make `total` and paging lie
- [ ] `docs/cli.md` regenerated, not hand-edited

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/filters.ts`, `apps/cli/src/commands/doc/list.ts`.

### Notes

- Follow whatever convention the existing boolean flags use for the false case;
  a bare `--flag` plus a `--no-flag` and a tri-state absent is easy to get
  subtly wrong, and absent must remain distinguishable from false.

## Testing Strategy

The flag reaches the query unchanged; absent sends nothing; the false case is
distinguishable from absent. Plus the generated-docs drift check.

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
