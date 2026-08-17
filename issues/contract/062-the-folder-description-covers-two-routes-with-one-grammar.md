# [CONTRACT-062] `FOLDER_DESCRIPTION` describes two routes whose grammars have diverged

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-122
- Blocks: —

## Spec References

- SPEC.md **§7** line 397 — the additional document roots
- SPEC.md **§11** line 539 — creation is inbox-first

## Summary

`FOLDER_DESCRIPTION` (`packages/contract/src/schemas/doc.ts:49`) is one constant
shared by `CreateDocRequest.folder` **and** `MoveDocRequest.folder`. It was true
of both until SERVER-122, which gave **create** a grammar move did not get: an
omitted `folder` now files a document in the root its `type` declares, and a
declared root may be named outright by its exact path.

So the published description is now **wrong for create and right for move**,
which is worse than being wrong for both — a reader has no way to tell which
route the sentence is about. SERVER-122 left it deliberately rather than editing
a contract-owned constant from the server domain, and wrote the replacement
wording it wants.

This is the SERVER-114 rule turned on the contract itself: a description states
what a caller may conclude about **this** route, and one sentence cannot state
two different things.

## Acceptance Criteria

- [ ] `CreateDocRequest.folder` and `MoveDocRequest.folder` carry separate
      descriptions
- [ ] The create-side description states the whole grammar SERVER-122
      implemented: the default-by-type, naming a declared root outright, that a
      named root must match the type it holds, and that an explicit folder wins
- [ ] The move-side description is **today's text unchanged** — move did not
      gain the grammar, and this issue must not quietly give it one
- [ ] Neither description restates a derivation the server owns; each says what
      a caller may conclude (SERVER-114)
- [ ] `openapi.json` and the generated client regenerated and committed; the
      drift check passes
- [ ] No `§9.4` is reintroduced anywhere — SHARED-046 corrected all eleven
      citations to `§9.2` and the regeneration must preserve that

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/doc.ts` — split the constant
- `packages/contract/openapi.json`, `src/client/schema.generated.ts` —
  regenerated

### Key Implementation Details

SERVER-122 proposed this create-side wording, and it is a starting point rather
than a mandate — sharpen it if you can, but do not drop any of the four facts it
carries:

> Folder under `data/docs/`, accepted either as a bare name (`finance`) or as
> the full prefix (`data/docs/finance`). Defaults to `inbox` — creation is
> inbox-first (SPEC.md §11) — **except for a type that SPEC.md §7 gives its own
> document root**, which is where an omitted `folder` files it: a
> `type: agent-def` document lands in `.claude/agents/`. Such a root may also be
> named outright, by its exact declared path (`.claude/agents`), and a root named
> that way must match the type it holds. An explicit folder always wins, so
> `folder: "inbox"` still files an `agent-def` under `data/docs/` as a document
> *about* a persona.

Verify the description against `resolveFolder(folder, forType)` in
`apps/server/src/docs/write.ts` rather than against the prose above — the
implementation is what a caller will actually meet, and a description that
agrees with a proposal but not with the code is the defect this issue exists to
remove.

### Edge Cases

- Any other schema importing `FOLDER_DESCRIPTION` — find them all before
  splitting

## Testing Strategy

Assert in `openapi.test.ts` that the two routes' `folder` descriptions differ
and that the create-side one names the by-type default. Falsify by re-pointing
both at one constant and watching it go red.

## E2E Verification Plan

### Verification Steps

1. `npm run build -w packages/contract`, regenerate, drift check
2. Read the two descriptions out of `openapi.json` and confirm they differ

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-062]` prefix
