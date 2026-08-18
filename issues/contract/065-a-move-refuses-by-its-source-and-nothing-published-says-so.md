# [CONTRACT-065] A move refuses by its source, and nothing published says so

## Domain

contract

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: CONTRACT-064 (whose sweep found this), SERVER-125

## Spec References

- SPEC.md **§4** — the workspace layout, `data/docs/` and `.claude/`
- SPEC.md **§7** line 399 — the agent-def and skill roots

## Summary

`apps/server/src/docs/move.ts:53-54` refuses a move whose **source** is outside
`data/docs/`:

> `${loaded.path} is not under data/docs/ and cannot be moved`

Every published description of moving covers only the **destination** side.
`MoveDocRequest.folder` and the move route both describe where a document may go,
and neither says where it may come from.

Found by CONTRACT-064's second sweep, which walked all 63 folder-and-naming
descriptions in `openapi.json` against the server code rather than against
memory.

## Why it is worth filing rather than shrugging

**Pre-existing, and made slightly more findable by v0.12.0.** That release tells
people plainly that an `agent-def` filed in the inbox "answers to neither
`@<name>` nor `POST /api/threads/{id}/resident`". The natural next thought is to
move it into `.claude/agents/`, and that is precisely the call that fails with a
`400` no published prose predicts.

It is a documentation gap rather than a correctness bug — the refusal itself is
right, since `.claude/` is Claude Code's tree and the server placing files there
by folder request would be a different feature.

**Deliberately not pulled into v0.12.0.** That release has already absorbed one
consequential gap it made findable (SERVER-123's successor, SERVER-125) and three
rounds of review. Widening it again for a prose gap that predates it is how a
release stops ending.

## What has to be decided

1. Whether the fix is prose alone, or whether an off-root document should become
   movable **into** its root. The second is a real feature — it is the repair for
   a misfiled persona — and it is a bigger question than this issue
2. If prose: whether it belongs on `MoveDocRequest.folder`, on the route, or on
   both. CONTRACT-064's lesson is that one rule stated in several places drifts,
   so prefer one home and a pointer

## Acceptance Criteria

- [ ] A caller reading the published description learns that a document outside
      `data/docs/` cannot be moved, before they try
- [ ] The wording agrees with the server's own refusal message rather than
      inventing a second one
- [ ] `openapi.json` and `schema.generated.ts` regenerated, never hand-edited
- [ ] If the answer is instead to allow the move, that is its own issue and this
      one closes pointing at it

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/doc.ts` and/or `packages/contract/src/routes/`
- regenerated artifacts

### Key Implementation Details

Read `apps/server/src/docs/move.ts` for the exact refusal. Read CONTRACT-064's
"PR #50 second review" section for the sweep method, which is the reason this was
found at all.

## Testing Strategy

A pin against the generated document, in the shape CONTRACT-064 used. Falsify by
reverting the clause and running that test alone.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Create an agent-def with `--folder inbox`, then attempt to move it into
   `.claude/agents/`; capture the real refusal
3. Confirm the published description now predicts it
4. Stop the server; confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-065]` prefix
