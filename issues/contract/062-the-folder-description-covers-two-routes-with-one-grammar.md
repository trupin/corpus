# [CONTRACT-062] `FOLDER_DESCRIPTION` describes two routes whose grammars have diverged

## Domain

contract

## Status

done

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

- [x] `CreateDocRequest.folder` and `MoveDocRequest.folder` carry separate
      descriptions
- [x] The create-side description states the whole grammar SERVER-122
      implemented: the default-by-type, naming a declared root outright, that a
      named root must match the type it holds, and that an explicit folder wins
- [x] The move-side description is **today's text unchanged** — move did not
      gain the grammar, and this issue must not quietly give it one
- [x] Neither description restates a derivation the server owns; each says what
      a caller may conclude (SERVER-114)
- [x] `openapi.json` and the generated client regenerated and committed; the
      drift check passes
- [x] No `§9.4` is reintroduced anywhere — SHARED-046 corrected all eleven
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

Model actually run: **opus** (as recommended).

### 1. Authority: `resolveFolder(folder, forType)`, not the proposal

The description was written against `apps/server/src/docs/write.ts:675` and its
helpers (`namedRoot`, `admitRoot`, `rootForType`, `NAMEABLE_ROOTS`), then
confirmed against the server's own tests:

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/server/src/docs/write.test.ts
 Test Files  1 passed (1)
      Tests  37 passed (37)
```

Behaviours those tests pin, each of which the create description now states:

| `resolveFolder(...)`                     | → | stated as |
| ---------------------------------------- | - | --------- |
| `(undefined, "agent-def")`               | `.claude/agents` | the by-type default |
| `(".claude/agents", "agent-def")`        | `.claude/agents` | a root nameable outright, by its exact path |
| `("inbox", "agent-def")`                 | `data/docs/inbox` | an explicit folder always wins |
| `(".claude/agents", <other type>)`       | `400` | a named root must hold the type being created |
| `(".claude/skills", "skill")`            | `400` | a root that takes no ordinary `*.md` is out of reach |
| `(undefined, "skill")`                   | `data/docs/inbox` | …and is not a default either |
| `(undefined)` / `("finance")` (no type)  | `data/docs/inbox` / `data/docs/finance` | the move-side grammar, unchanged |

**What the proposed wording got wrong.** "a type that SPEC.md §7 gives its own
document root" is true of `type: skill` — §7 declares `.claude/skills` — but a
skill create neither defaults there nor may name it: `rootForType` and
`admitRoot` both gate on `projectionIndexesFolder`, and that root indexes
`SKILL.md` files alone. A caller who believed the proposal would have expected
`.claude/skills/` and got `data/docs/inbox/`, with no `400` to tell them. The
published text now says so outright and points at `POST /api/skills`. Two
smaller corrections: the match is on the root's **exact declared path**, never a
folder beneath it (`namedRoot` compares `root.path === folder`), and `data/`
roots are excluded from the grammar entirely, so `data/threads` is not nameable
either.

### 2. Build, regenerate, drift, idempotence

```
$ npm run build -w packages/contract          # EXIT=0
$ npm run generate -w packages/contract       # EXIT=0
generated ./openapi.json
generated ./src/client/schema.generated.ts
$ md5 openapi.json src/client/schema.generated.ts   # before/after a second generate
Files are identical                                 # STABLE=0
$ ./node_modules/.bin/tsc --noEmit -p packages/contract   # TSC=0 (redirected; exit read from tsc)
```

### 3. The two descriptions, read out of the generated document

```
$ node -e "const d=require('./packages/contract/openapi.json'); …"
differ: true
move unchanged: true      # byte-identical to the pre-change string
create-has-grammar: true
```

`MoveDocRequest.properties.folder.description` (unchanged):

> Folder under `data/docs/`, accepted either as a bare name (`finance`) or as
> the full prefix (`data/docs/finance`). Defaults to `inbox` — creation is
> inbox-first (SPEC.md §11), and the agent files inbox arrivals per its skill.

`CreateDocRequest.properties.folder.description` (new): the sentence above,
continued with the §7-root grammar — the by-type default (`type: agent-def` →
`.claude/agents/`), naming a declared root outright by its exact path and
nothing beneath it, the type-match `400`, the `.claude/skills` exclusion with
`POST /api/skills` as the alternative, and "an explicit folder always wins".
Present in the generated client too (`src/client/schema.generated.ts:4425`).

### 4. `§9.4` stays gone (SHARED-046)

```
$ grep -c "§9.4" packages/contract/openapi.json                 # 0
$ grep -c "§9.4" packages/contract/src/client/schema.generated.ts  # 0
$ grep -c "§9.4" packages/contract/src/schemas/key.ts              # 0
```

### 5. Tests, and the falsification

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run packages/contract
 Test Files  65 passed (65)
      Tests  2607 passed (2607)          # includes 9 new
$ ./node_modules/.bin/eslint <touched>    # EXIT=0
$ ./node_modules/.bin/prettier --check <touched>  # EXIT=0 (after one --write)
```

Falsified as the Testing Strategy asks — pointing `MoveDocRequestSchema.folder`
back at `CREATE_FOLDER_DESCRIPTION` turns exactly the guards red and nothing
else:

```
× MoveDocRequest > describes a plainer folder grammar than create's
× …(CONTRACT-062) > does not publish one sentence for both routes
× …(CONTRACT-062) > leaves move's description as the plain `data/docs/` grammar
× …(CONTRACT-062) > publishes the type-aware grammar on exactly one field in the document
```

Reverted; suite green again.

### Observations for the orchestrator (not fixed here)

- **`MoveDocRequest.folder` is required, so "Defaults to `inbox`" is dead text
  on that route.** It reads as create's default because it *was* create's. The
  issue is explicit that move keeps today's text unchanged, so it is untouched —
  but it is a real (smaller) instance of the same defect and wants its own issue.
- `POST /api/docs/bulk`'s `move` act carries a third `folder`, with its own
  constant in `schemas/bulk.ts:163`, already free of the type-aware grammar
  (correctly — bulk calls `resolveFolder` with no type). A test now pins that the
  grammar appears on exactly one field in the whole published document.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-062]` prefix
