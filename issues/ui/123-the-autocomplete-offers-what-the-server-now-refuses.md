# [UI-123] The autocomplete offers what the server now refuses

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SERVER-125
- Blocks: — (but v0.12.0 must not ship without it)
- Related: UI-122 (the designate menu), AGENT-036

## Spec References

- SPEC.md **§7** line 399 — `.claude/agents/*.md` as the agent-def root
- SPEC.md **§8** — `@<subagent-name>` is a directive routed to that persona
- SPEC.md **§11** line 539 — the `@` autocomplete, backed by `GET /api/docs`

## Summary

SERVER-125 stopped indexing an off-root `type: agent-def` (and `type: skill`)
document as a mention target. `targetIndex` now skips any row whose
`invocableName` is null, the title alias included. That is the right call and its
reasoning is in that issue.

**It leaves both client surfaces one release behind the server.** The client
never asked the server what resolves. It computes the same two aliases again,
independently, in two places:

| Surface | The code | What it does now |
| --- | --- | --- |
| `@` autocomplete | `packages/kit/src/components/Autocomplete/useAutocomplete.ts:63` — `invocableName(row.path) ?? row.title` | Offers an off-root agent-def under its title. Picking it inserts a mention the server resolves to nothing |
| Designate menu | `apps/ui/src/thread/residentActions.ts:92` — `name: row.title.trim()` | Offers an off-root agent-def. Designating it now gets a 404 that SERVER-125 rewrote to name the file |

**This is a regression that SERVER-125 introduced**, not pre-existing debt. Before
it, both surfaces were right: the title alias did resolve. The server changed and
the clients did not.

SERVER-125's own acceptance criterion states the standard: *"The autocomplete and
the resolver must agree: offering what will not resolve is worse than either."*
That criterion is not met until this issue lands, which is why this is P0 and in
v0.12.0 rather than filed for later.

## What must not break

**`GET /api/docs?type=agent-def` must keep returning every agent-def.** The
board's `type:` filter and the seeded "Skills & agents" view both read that
endpoint, and a document about a persona is a legitimate document that must stay
listed, readable and editable. **The filter belongs in the client, at the point
where a row becomes an offer** — not in the query.

That is the same shape SERVER-125 chose: the document stays, and only its
addressability goes.

## Acceptance Criteria

- [ ] The `@` autocomplete offers an agent-def only when `invocableName(row.path)`
      is non-null, and offers it under that name
- [ ] The designate menu offers the same set, by the same rule
- [ ] A row dropped from the offers is still listed by the board and still
      readable and editable — nothing about the document changes, only whether it
      is offered
- [ ] `type: skill` rows follow the identical rule, because SERVER-125 gated both
- [ ] **The kit and the UI do not each grow a third copy of this rule.** One
      exported predicate, used by both surfaces
- [ ] A test proves client and server agree on the same row: the same off-root
      fixture is absent from the offers and unresolved by the server

## Technical Design

### Files to Create/Modify

- `packages/kit/src/components/Autocomplete/useAutocomplete.ts` — `rowToken`
- `apps/ui/src/thread/residentActions.ts` — the designate list
- `packages/kit/src/index.ts` — the export, if the predicate is new
- Tests beside each

### Key Implementation Details

`invocableName` already lives in the kit and already returns null off-root. The
change is to stop falling back to the title, and to drop the row instead.

**Read `residentActions.ts:80-92` before editing it.** Its docblock explains that
the title is a *spelling* and not an identity, and that the server stores the name
it resolved to. That reasoning stays true. What changes is which rows are offered
at all, not how a designation is spelled.

**`useWeightLevels.ts:109` also calls `invocableName`** and is not part of this
bug — it looks up the orchestrate skill by its invocable name, which is exactly
right. Do not change it.

### Edge Cases

- An on-root agent-def whose title differs from its file stem. This is the
  **common** case since SERVER-122, and it must keep working. Designation sends
  the title today and the server resolves it
- An agent-def with a blank title, already dropped by `residentActions`
- An archived agent-def
- A `type: skill` document under `data/docs/`, which is a document *about* a
  skill

## Testing Strategy

Unit tests on both surfaces with an on-root and an off-root fixture. The pair
that matters asserts the client's offer set and the server's resolution agree on
the same fixture, so the two cannot drift apart again silently.

Falsify by restoring the `?? row.title` fallback and confirming the off-root
cases go red.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port **not 8765** and **not 5173**
2. Create an on-root agent-def and an off-root one with a one-word title
3. In a real thread composer, type `@` — only the on-root persona is offered
4. Open the designate menu — same set
5. Confirm the off-root document is still listed on the board and still opens
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

- [ ] Committed with `[UI-123]` prefix
