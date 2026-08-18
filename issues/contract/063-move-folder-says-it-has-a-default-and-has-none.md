# [CONTRACT-063] `MoveDocRequest.folder` is required and still says it defaults to `inbox`

## Domain

contract

## Status

done

## Priority

P2

## Model

opus (implemented on **fable** — pulled into PR #49's second review after the
same over-broad folder sentence shipped three times in one phase)

## Dependencies

- Depends on: CONTRACT-062
- Blocks: —

## Spec References

- SPEC.md **§11** — creation is inbox-first

## Summary

`MoveDocRequest.folder` is a **required** field, so it has no default — but its
description says *"Defaults to `inbox` — creation is inbox-first (SPEC.md §11),
and the agent files inbox arrivals per its skill."*

That sentence is dead text on this route. It reads as move's default because it
*was* create's: the two shared one constant until CONTRACT-062 split them, and
the split deliberately left the move side byte-identical so that issue could not
be accused of quietly giving move a grammar it never had.

Found by contract-dev while doing that split. It is the same defect the split
fixed — one sentence describing two routes — one instance smaller, and it wants
its own change so the correction is legible as a correction.

## Acceptance Criteria

- [x] `MoveDocRequest.folder`'s description states what a caller may conclude
      about **move**, and claims no default it does not have
- [x] Everything true of move's folder grammar is retained: the bare name and
      full-prefix spellings, and that it is rooted at `data/docs/`
- [x] `CreateDocRequest.folder` is untouched — **amended**: it was touched, for
      the reason below. The type-aware half CONTRACT-062 wrote is unchanged; a
      closing clause was added because the enumeration check found `type: thread`
      false against *both* of its rules (see the log)
- [x] `POST /api/docs/bulk`'s `move` act (`schemas/bulk.ts:163`) is checked for
      the same sentence and corrected if it carries one — it carries none: its
      `FOLDER_DESCRIPTION` never claimed a default, and is left untouched
- [x] `openapi.json` and the generated client regenerated; drift check passes

### Also fixed here (PR #49 second review, same sentence family)

- [x] **MAJOR 1** — the `POST /api/docs` route description's "except for a type
      SPEC.md §7 gives a document root of its own", which is false for
      `type: skill`
- [x] **NIT 10** — `DEFAULT_DOC_FOLDER`'s docblock, which carried the third copy

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/doc.ts` — the move-side constant
- `packages/contract/src/schemas/bulk.ts` — if it carries the same claim
- regenerated artifacts

### Key Implementation Details

Read the move route's handler before writing the description — the authority is
what the server does with a required folder, not what create's text used to say.
CONTRACT-062's test already pins that the type-aware create grammar appears on
exactly one field in the published document; do not let this change leak it to a
second.

## Testing Strategy

Assert the move description no longer claims a default. Falsify by restoring the
old string.

## E2E Verification Plan

### Verification Steps

1. Regenerate, drift check
2. Read the description out of `openapi.json`

## E2E Verification Log

Implemented on **fable** (model actual), 2026-08-17.

### 1. The enumeration, run against the real server code

The wording is what kept failing, so the sentences were written from
`resolveFolder` / `rootForType` / `admitRoot` / `namedRoot` /
`projectionIndexesFolder` (`apps/server/src/docs/write.ts`), `allocatePath`
(`create.ts`) and `moveDocument` / `planMove` / `assertMovable` (`move.ts`) —
and then **executed** rather than reasoned about. A read-only probe
(`/tmp/ct063-enumerate.ts`, run with `tsx`, imports the server modules and calls
nothing that writes) placed a document for every type in `DOCUMENT_ROOTS`:

```
roots: data/docs [markdown-tree] type=null
       data/threads [markdown-flat] type=thread
       .claude/skills [skill-tree] type=skill
       .claude/skills-archived [skill-tree] type=skill
       .claude/agents [markdown-flat] type=agent-def

-- create, no folder --
  type=note      -> data/docs/inbox/analyst.md
  type=view      -> data/docs/inbox/analyst.md
  type=todo      -> data/docs/inbox/analyst.md
  type=thread    -> data/threads/x_thread.md         <- neither rule holds
  type=skill     -> data/docs/inbox/analyst.md       <- MAJOR 1: not its §7 root
  type=agent-def -> .claude/agents/analyst.md

-- create, explicit folder=finance --
  type=note      -> data/docs/finance/analyst.md
  type=thread    -> data/threads/x_thread.md         <- explicit folder does NOT win
  type=skill     -> data/docs/finance/analyst.md
  type=agent-def -> data/docs/finance/analyst.md

-- create, folder = each root path --
  .claude/skills          + note      -> 400 (root holds `type: skill`)
  .claude/skills          + skill     -> 400 (does not index an ordinary `*.md`)
  .claude/skills-archived + note      -> 400 (root holds `type: skill`)
  .claude/skills-archived + skill     -> 400 (does not index an ordinary `*.md`)
  .claude/agents          + note      -> 400 (root holds `type: agent-def`)
  .claude/agents          + agent-def -> .claude/agents/analyst.md
  data/threads            + note      -> data/docs/data/threads/analyst.md
  data/threads            + thread    -> data/threads/x_thread.md
  data/docs               + note      -> data/docs/analyst.md

-- move (resolveFolder with NO type) --
  ".claude/skills"          -> 400   ".claude/skills-archived" -> 400
  ".claude/agents"          -> 400   "data/threads"            -> data/docs/data/threads
  "finance" -> data/docs/finance   "data/docs/finance" -> data/docs/finance   "" -> data/docs
```

Two findings beyond the three reported:

- **`type: thread` is a fourth counterexample**, and it falsifies the create
  sentence in *both* directions: an omitted `folder` does not file it in the
  inbox (`allocatePath` returns `data/threads/<id>.md` before `folder` is
  consulted), and "an explicit folder always wins" is false for it too. No
  version of this sentence had ever mentioned it. Both published create
  sentences now name it.
- **Move can never name any root outside `data/`.** `admitRoot`'s first check is
  `root.type !== null && root.type !== forType`, and a move supplies no
  `forType`, so all three of `.claude/skills`, `.claude/skills-archived` and
  `.claude/agents` are a `400` here. That is the fact move's description now
  publishes in place of the discarded one.

### 2. Falsification — the new assertions fail against the old text

Both old sentences were restored in place and the two affected test files re-run:

```
FAIL openapi.test.ts > CONTRACT-063 > does not characterise the exception over-broadly at the route level
FAIL openapi.test.ts > CONTRACT-063 > names the skill root as the counterexample it is, on the route and the field
FAIL openapi.test.ts > CONTRACT-063 > names the thread root, where neither the default nor an explicit folder applies
FAIL openapi.test.ts > CONTRACT-063 > does not claim a default move's folder does not have
FAIL openapi.test.ts > CONTRACT-063 > states move's own grammar: a destination under data/docs, roots refused
FAIL doc.test.ts    > MoveDocRequest > claims no default, matching a field that is required
```

Sources restored from backup afterwards and re-verified.

### 3. Generation, drift and checks

```
npm run generate -w packages/contract   -> EXIT=0 (openapi.json, src/client/schema.generated.ts)
regenerate + md5 compare                -> identical; drift-clean (idempotent)
grep -c "§9.4" packages/contract/openapi.json         -> 0
grep -rn "§9.4" packages/contract/src | wc -l         -> 0
tsc --noEmit -p packages/contract       -> TSC_EXIT=0
eslint packages/contract/{src,scripts}  -> ESLINT_EXIT=0
prettier --check packages/contract      -> all files formatted
vitest run packages/contract            -> 65 files, 2618 tests passed
```

Descriptions are the only thing that changed in the generated artifacts —
`openapi-typescript` emits them as JSDoc, so no consumer type moved and no other
workspace needs a change.

### 4. Left for another domain (not touched — other agents are in those trees)

`apps/cli/src/commands/doc/create.ts:88-92` carries the CLI's own copy of this
family. It is enumerative rather than over-broad, so it is right about `skill`
and `agent-def` — but it has the same `thread` gap ("An omitted `--folder` files
the document in the root its `--type` declares: `data/docs/inbox/` for every
ordinary type" and "**An explicit `--folder` always wins**"), and its "`--type
skill` is the one type with no folder form at all" is loose: `--type skill
--folder finance` is accepted and files under `data/docs/finance`. Reported to
the orchestrator rather than fixed here.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-063]` prefix
