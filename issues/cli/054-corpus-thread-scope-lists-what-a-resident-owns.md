# [CLI-054] `corpus thread scope` lists what a resident owns

## Domain

cli

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-068, SERVER-130
- Blocks: —
- Related: UI-125 (the same listing, on the board)

## Spec References

- SPEC.md **§7** — scope: the thread, its subthreads, every artifact whose provenance walks back to it
- SPEC.md **§7** — the agent's retrieval discipline: one frugal line per hit, never a body

## Summary

CONTRACT-068 decision 4 asked whether the agent gets the scope listing too. **Decided yes, 2026-08-19**: a resident asking *"what do I own"* is a reasonable question, it is the same endpoint, and the CLI is the agent's only way to the server. `corpus thread scope <id>` prints the listing, one line per artifact, and says when it is truncated.

## Acceptance Criteria

- [ ] `corpus thread scope <id>` prints one frugal line per artifact: id, type, title, status, and how it got in
- [ ] A truncated listing says so on its last line, with the bound
- [ ] A thread with no resident prints the server's refusal, in the CLI's ordinary error shape
- [ ] `--json` (if the CLI's other listing verbs have it) returns the response verbatim
- [ ] `--help` documents it; the `converse` skill is **not** edited here (that is AGENT-038's file, and the verb is optional for the skill)

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/thread/scope.ts` (+ test), registry entry, help

### Key Implementation Details

Mirror `corpus agents`' rendering discipline: words for a person, no invented tokens for null fields.

## Testing Strategy

Unit tests against a mocked client, snapshot re-derived by running.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Designate a thread, create a subthread and a document from it, `corpus thread scope <id>` lists all three
3. Stop the server, confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CLI-054]` prefix
