# [CONTRACT-064] The designate schema still states the pre-SERVER-125 resolution rule

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-125
- Blocks: — (but PR #50 should not merge with it open)
- Related: MAJOR 2 of PR #50's review, whose sweep found this

## Spec References

- SPEC.md **§7** line 399 — `.claude/agents/*.md` as the agent-def root
- SPEC.md **§8** — `@<subagent-name>` resolution
- SPEC.md **§9.3** — contract-first: the OpenAPI document is generated from the
  route definitions

## Summary

SERVER-125 made an off-root `type: agent-def` document addressable under no
spelling. MAJOR 2 of PR #50's review found the CLI's help text still stating the
old rule, and that fix's sweep found **two more statements of it in the
contract** — which is worse, because these reach the generated OpenAPI document
and the generated client, so they are the wire's own description of the field.

| Location | What it says | Verdict |
| --- | --- | --- |
| `packages/contract/src/schemas/agents.ts:415` — `DesignateResidentRequestSchema.name` | *"a `type: agent-def` document's own name, or its title, matched case-insensitively"* | **Wrong.** No root qualifier at all |
| `packages/contract/src/schemas/agents.ts:63-68` — `AgentNameSchema` | *"the stem of its file name **under `.claude/agents/`** … and by its title"* | **Half wrong.** The stem clause carries the root; the title clause reads as unrestricted |

The first is copied verbatim into
`packages/contract/src/client/schema.generated.ts:5399` and into
`packages/contract/openapi.json`.

## Why this is P1 and not a documentation nit

**Half the sentence is still true, and that is what makes it dangerous.** For a
document in `.claude/agents/`, the stem *and* the title both still resolve,
case-insensitively — and since SERVER-122 a created persona's title routinely
differs from its slugged filename (`Legacy Analyst` is written to
`legacy-analyst.md`), so the title clause is load-bearing for the common case.

A reader cannot tell from this text which half survived. The correction must keep
the in-root title behaviour and qualify it, exactly as the CLI's help text now
does. **Do not overcorrect into saying titles do not resolve.**

## Acceptance Criteria

- [ ] Both descriptions state the root gate, and keep the in-root stem-or-title
      rule
- [ ] `openapi.json` and `schema.generated.ts` are **regenerated**, never
      hand-edited, and committed
- [ ] `node --import tsx scripts/check-generated-artifacts.ts` reports the API
      contract up to date
- [ ] The sweep is finished: no other schema, route description or example in
      `packages/contract` states the pre-SERVER-125 rule
- [ ] The wording agrees with `apps/cli/src/commands/thread/designate.ts`, which
      was corrected in the same PR — two descriptions of one rule that disagree
      is the defect this issue is part of

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/agents.ts` — the two descriptions
- `packages/contract/openapi.json`, `packages/contract/src/client/schema.generated.ts`
  — regenerated output, committed

### Key Implementation Details

Read `apps/server/src/threads/resident.ts` for the 404 the server now returns. It
names the file and what is wrong with it, and the description should be
consistent with that message rather than inventing a second wording.

Read the corrected CLI help text before writing, and match it.

## Testing Strategy

Whatever pins the contract already has for these descriptions. The behavioural
check is the drift check plus reading the regenerated `openapi.json`.

## E2E Verification Plan

### Verification Steps

1. Regenerate and confirm the drift check is clean
2. Read the description out of `openapi.json`, not out of the source
3. Confirm an in-root persona still designates by title with the wrong case

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-064]` prefix
