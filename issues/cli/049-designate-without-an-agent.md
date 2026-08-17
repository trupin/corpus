# [CLI-049] `corpus thread designate` without naming an agent

## Domain

cli

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-061, SERVER-121
- Blocks: AGENT-033

## Spec References

- SPEC.md **§7** — the SHARED-048 rider

## Summary

`corpus thread designate <id> --agent <name>` requires `--agent`. Make it
optional, so the CLI can put a general resident on a conversation — the same act
the UI will offer and the same act the converse skill's launch depends on.

## Acceptance Criteria

- [ ] `corpus thread designate <th_…>` with no `--agent` designates a general
      resident and reports what it did in a way that distinguishes it from a
      profiled designation
- [ ] `--agent <name>` is unchanged, including the `404` for a name that
      resolves to nothing
- [ ] `--agent ""` is refused rather than treated as absence — a blank name is a
      mistake, not a request for a general resident
- [ ] `--json` carries the resident shape CONTRACT-061 defined, with no
      hand-rolled restatement of it
- [ ] `corpus agents` lists a general-resident lane legibly — a reader can tell
      "this conversation has an agent with no profile" from "this conversation
      has profile X"
- [ ] The help text says when you would want each, in one line, without
      restating §7

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/thread/designate.ts` — the flag and the call
- the `corpus agents` renderer — the general-resident row

### Key Implementation Details

The command is a thin client (architecture decision 2): it sends the shape the
contract defines and renders what comes back. **It does not decide what a
general resident is** — if rendering needs a word for one, take it from the
contract's field rather than inventing a CLI-local vocabulary, or the CLI and
the UI will come to call the same thing two things.

`designate.ts:69` currently documents the name's resolution at length. Update it
for the optional case, and keep the existing rule that the CLI does not repeat
the server's lookup.

### Edge Cases

- A thread with a parent — the server's refusal, rendered verbatim
- Re-designating from profiled to general and back
- Exit codes unchanged from today's refusals

## Testing Strategy

Command tests against a stubbed client for: no flag, flag given, blank flag,
each refusal, and both `--json` shapes. Renderer tests for `corpus agents` with
a mixed roster (orchestrator, a general lane, a profiled lane).

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. `corpus thread create`, then `corpus thread designate <id>` with no `--agent`
3. `corpus agents` shows the lane; the thread markdown on disk shows it
4. `corpus thread designate <id> --agent <name>` replaces it; `corpus agents`
   shows the profile
5. `corpus thread release <id>`; the lane leaves
6. Stop the server; confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CLI-049]` prefix
