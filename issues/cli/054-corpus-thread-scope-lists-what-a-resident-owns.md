# [CLI-054] `corpus thread scope` lists what a resident owns

## Domain

cli

## Status

done

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

- [x] `corpus thread scope <id>` prints one frugal line per artifact: id, type, title, status, and how it got in
- [x] A truncated listing says so on its last line, with the bound
- [x] A thread with no resident prints the server's refusal, in the CLI's ordinary error shape
- [x] `--json` (if the CLI's other listing verbs have it) returns the response verbatim
- [x] `--help` documents it; the `converse` skill is **not** edited here (that is AGENT-038's file, and the verb is optional for the skill)

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

**implemented on: opus** — the implementing agent was killed by a session limit after writing the code and its tests. The orchestrator ran the verification below and wrote it.

**E2E, real server on port 8896, throwaway workspace** (`scratchpad/ws-verify`):

```
$ corpus thread scope th_7h2evk2h
th_7h2evk2h  thread  open  self    Order drill
th_ixoaoqeo  thread  open  parent  Side note
```

The unrelated document created in the same workspace (`doc_cvu3v7s7`, `data/docs/inbox/unrelated.md`) is **absent**, which is the point of the listing.

**An undesignated thread is refused, and the refusal says what to do:**

```
$ corpus thread scope th_b47ott6n
corpus: 409 conflict: th_b47ott6n has no resident, so it has no scope: SPEC.md §7 gives a
scope to a designated thread, and everything outside every scope is the orchestrator's by
default. Designate a resident on this thread, or read `GET /api/agents` for the lanes that exist.
```

**The `origin` case** is covered by SERVER-130's own real-server run (a `via: "origin"` member, including an archived one) and by its parity test against the enqueue-time walk. The CLI has no `--origin` flag on `doc create`, so this drill could not create one by hand.

Unit suite: `apps/cli` 94 files, 1580 tests, all pass. Server stopped, port 8896 free.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[CLI-054]` prefix
