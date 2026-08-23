# [CLI-067] `queue fail` needs a reason, and two help strings now contradict the server

## Domain
cli

## Status
todo

## Priority
P1 (important)

## Model
opus

## Dependencies
- Depends on: SERVER-145
- Blocks: —

## Spec References
- SPEC.md Section 7 — the queue, and "nobody settles work they did not claim"
  (rider signed 2026-08-13)
- SPEC.md Section 9 — exit codes

## Summary

Two consequences of SERVER-145, both in `apps/cli/src/commands/queue/transitions.ts`.

**1. Two help strings now state the opposite of what the server does.**

- `completeCommand` says: _"Idempotent: completing an already-completed event is
  not an error … exits 0 like the first"_. It is now a `409` at exit 5.
- `failCommand` offers `corpus queue fail evt_9f2a` as an example of failing
  without an annotation.

Help that describes behaviour the product does not have is worse than no help,
and this release's own audit (SHARED-070) measured help as the surface the agent
reads to decide what to do. A wrong sentence there is paid twice — once to read,
once to recover from acting on it.

**2. `corpus queue fail` still accepts no `--reason`.**

The orchestrate skill treats the reason as what an operator reads in the failed
row, and its examples always pass one. Without it a failed row can exist with
nothing to say why.

## The decision already made, so it is not re-litigated

SERVER-145's implementer settled the breaking-change question and the reasoning
holds: **making `--reason` required is a CLI-side usage error, and the route's
body stays `required: false`.** The reaper writes a `failed` event with its own
`error` without going through the route, so tightening the wire schema would
break an HTTP caller for nothing.

So: **exit 2, before any request is made.**

## Acceptance Criteria

- [ ] `corpus queue fail <id>` without `--reason` is a usage error at **exit 2**,
      and no request reaches the server.
- [ ] The route's request body is unchanged. This issue touches no schema.
- [ ] `completeCommand`'s idempotence sentence is replaced by what the server
      actually does, naming the claim rule rather than the status code alone.
- [ ] `failCommand`'s example passes a reason.
- [ ] Every other help string in the queue verbs is read for the same class of
      claim. One wrong sentence found by an audit usually has a sibling.
- [ ] `docs/cli.md` regenerates and `docs/generate.test.ts` passes.
- [ ] The brief register (CLI-056) is checked too: brief is the **first
      sentence** of each description, so a correction that lands in a later
      sentence never reaches a reader who asked for brief.

## Technical Design

### Files to Create/Modify
- `apps/cli/src/commands/queue/transitions.ts`
- its tests
- `docs/cli.md` — regenerated

### Key Implementation Details

The last acceptance criterion is the one to get right. CLI-056 made brief help
the first sentence of a description and AGENT-045 made the skills ask for brief.
So a correction written as a second or third sentence is invisible to every
reader this release just pointed at the brief register. **Put the rule in the
first sentence.**

### Edge Cases
- `--reason ""` — an empty reason is not a reason, and should fail the same way.
- A reason long enough to matter in a row. Do not invent a cap here; if one is
  needed, that is its own issue.

## Testing Strategy

Command tests: the missing flag exits 2 with no request issued (assert the stub
recorded **zero** requests — a test asserting only a non-zero exit would pass if
the request went out and the server refused it). The help strings' new text, and
their brief renderings.

**Falsify**: remove the required-flag check and watch the "no request issued"
assertion fail.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. `corpus queue fail <id>` with no `--reason` → today, a request is made
2. `corpus queue complete --help` → today, promises idempotence the server
   no longer offers

### Verification Steps
1. Both commands after the change, with real output
2. `corpus queue complete --help=brief` shows the corrected first sentence

## E2E Verification Log

### Reproduction (bugs only)
_[Agent fills]_

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
