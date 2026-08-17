# [SHARED-048] A resident need not have a profile

## Domain

shared

## Status

done — **SIGNED by the user 2026-08-17** and applied to SPEC.md §7.

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Blocks: CONTRACT-061, SERVER-121, CLI-049, UI-122, AGENT-033
- Related: SHARED-043 (the resident rider this amends), SHARED-046 (the §9.4
  citation, corrected in the same edit because it sits in §7)

## Spec References

- SPEC.md **§7** line 321 — *"A conversation may have a resident."*
- SPEC.md **§8** line 407 — `@<subagent>` resolution, the vocabulary a
  designation borrows when it names one

## Summary

**SPEC never required a designation to name an `agent-def` document.** §7 says a
standalone thread *"may designate a **resident agent**: a long-lived agent that
owns that conversation and everything that grows out of it"* and stops there.
The requirement was invented one layer down, by the contract:

```ts
export const DesignateResidentRequestSchema = z
  .strictObject({ name: AgentNameSchema })   // .min(1), non-blank
  .openapi("DesignateResidentRequest");
```

`AgentNameSchema`'s own doc comment supplies the reasoning — *"the invocable
name, never a document id"* — which is a good rule about **how a profile is
named** and was silently promoted into a rule that **a profile must exist**.

The consequence, reported by the user 2026-08-17: a fresh workspace has no
agent-def documents (`corpus init` creates `.claude/agents/` holding only a
`.gitkeep`), so the designate menu offers nothing and says *"no agent-def
documents in this workspace"*. The one feature v0.10.0 is named for cannot be
reached without hand-authoring YAML.

This rider states the rule §7 always implied: **a profile is optional.**

## The amendment, as signed

Inserted into §7 after the designation paragraph (line 321):

> **A resident need not have a profile.** A designation may name a
> `type: agent-def` document — the same invocable name `@<subagent>` resolves
> (§8) — or it may name **none**, in which case the conversation gets a
> **general resident**: an agent with no persona document, working the
> conversation as the workspace's ordinary agent does. Naming none is the
> ordinary case and requires nothing to exist first; naming a profile is how a
> conversation gets an agent that behaves differently from the default.
> **Everything else about a resident is identical either way** — the lane, the
> scope, presence, the lapse fallback, release, and resolution releasing it —
> because a profile says *how* the agent works and nothing about *what it owns*.
> A profile that is renamed or archived after designation does not end the
> designation: the resident goes on owning its scope, and the missing profile is
> reported rather than silently substituted.

## What this deliberately does not change

- **Resolution releases the resident.** Already §7, already implemented
  (`apps/server/src/threads/status.ts:45`), already the converse skill's
  retirement trigger. The user asked for "keep itself alive until the thread is
  resolved"; that is the existing behaviour and needs no amendment.
- **Reopening does not restore a resident** (§8 line 409). Unchanged.
- **Only standalone threads may designate.** Unchanged — a profile-less resident
  is still forbidden on a thread with a parent.
- **Single-valued.** Unchanged: designating again replaces, whether or not
  either designation named a profile.
- **`resident.designated` still lands on the orchestrator's lane.** Unchanged.

## Acceptance Criteria

- [ ] The passage above is inserted into SPEC.md §7 verbatim as signed
- [ ] The `_(Rider signed 2026-08-17.)_` marker is appended, matching the
      convention of every other rider in §7
- [ ] No other §7 sentence is edited to agree with it — if one contradicts the
      rider, that is a finding to report, not a silent fix
- [ ] `issues/PLAN.md` carries a Phase 34 section with every issue of this phase

## Technical Design

### Files to Create/Modify

- `SPEC.md` — §7, one inserted passage
- `issues/PLAN.md` — the Phase 34 table

### Key Implementation Details

The orchestrator applies this itself; it is not delegated. Apply the text
**exactly as signed** — this repo's standing rule is that a rider is quoted, not
paraphrased, because paraphrase is how §9.2 and §4 came to disagree
(SHARED-045).

### Edge Cases

- §7 line 329 cites **§9.4**, which does not exist (SHARED-046). The edit lands
  in the same section; correct that citation in the same commit rather than
  leaving a known-wrong reference in text being touched.

## Testing Strategy

None — this is spec text. The behaviour it licenses is tested by the issues that
depend on it.

## E2E Verification Plan

### Verification Steps

1. `git diff SPEC.md` shows exactly the signed passage plus the §9.4 correction
2. `npm run issues:check` agrees PLAN rows and issue files match

## E2E Verification Log

_[Orchestrator fills]_

## Completion Checklist (domain agent)

- [ ] N/A — orchestrator-applied

## Completion Checklist (orchestrator)

- [ ] Committed with `[SHARED-048]` prefix
