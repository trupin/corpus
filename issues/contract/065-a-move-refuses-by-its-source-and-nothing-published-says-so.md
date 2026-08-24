# [CONTRACT-065] A move refuses by its source, and nothing published says so

## Domain

contract

## Status

done

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

### Implemented on

opus.

### Decision

**Prose alone, and the source rule lives on the route.** Allowing an off-root
document to be moved *into* its root is a real feature and a bigger question than
this issue, so it is not attempted here — and the refusal itself is right, since
`.claude/` is Claude Code's tree. `MoveDocRequest.folder` keeps the destination
grammar and gains one pointer sentence; the source rule has one home, per
CONTRACT-064's lesson that a rule stated twice drifts.

### Real refusals, captured before the prose was believed

Throwaway workspace, real server on port **8838** (not 8765, not 5173),
`corpus` run from source.

```
$ corpus doc create --type agent-def --title "Analyst" --json
doc_icnvgtcs .claude/agents/analyst.md

$ corpus doc move doc_icnvgtcs --folder inbox --json
{"error":{"code":"bad_request","message":"400 bad_request: this document's location is fixed",
 "details":[{"path":"id","message":".claude/agents/analyst.md is not under data/docs/ and cannot be moved"}]}}

$ corpus doc move th_pmi46y2p --folder inbox --json
{"error":{"code":"bad_request","message":"400 bad_request: this document's location is fixed",
 "details":[{"path":"id","message":"threads are flat under data/threads/ and cannot be moved"}]}}

$ corpus doc create --type agent-def --title "Old Analyst" --folder inbox --json   # the misfiled persona
doc_fhvn53ju  data/docs/inbox/old-analyst.md
$ corpus doc move doc_fhvn53ju --folder ".claude/agents" --json
{"error":{"code":"bad_request","message":"400 bad_request: that root holds one kind of document, and this is not it", ...}}
```

Both directions are refused, which is why the new text says so in both
directions and points at `POST /api/docs` as the repair.

### The published description now predicts them

Fetched from the **running** server, not from the file on disk:

```
$ curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8838/api/openapi.json
PASS 065 route: source rule            ("Only a document already under `data/docs/` can be moved")
PASS 065 route: thread refusal         ("threads are flat under data/threads/ and cannot be moved")
PASS 065 route: off-root refusal       ("is not under data/docs/ and cannot be moved")
PASS 065 field: destination-only pointer ("This is the destination alone")
```

Both refusal messages are quoted **verbatim** from `assertMovable`
(`apps/server/src/docs/move.ts`), so the contract and the server cannot come to
two accounts of one rule.

### Tests and falsification

Five new assertions in `packages/contract/src/openapi.test.ts`, written against
the generated document. Falsified by replacing the source clause with `"XX "` and
running the file alone:

```
$ vitest run -t "CONTRACT-065" packages/contract/src/openapi.test.ts ; echo $?
× names the source restriction on the route
Tests  1 failed | 4 passed | 551 skipped
1
```

Clause restored, all five pass. `openapi.json` and `schema.generated.ts`
regenerated with `npm run generate -w packages/contract`; neither hand-edited.

### Gates

`vitest run packages/contract` — 70 files, 2972 tests, exit 0.
`npm run typecheck -w packages/contract` — exit 0. ESLint and Prettier clean.
Server stopped, port 8838 free, no stray processes.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-065]` prefix
