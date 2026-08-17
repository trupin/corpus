# [CONTRACT-052] The diff route's published description tells API consumers the wrong default base

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-113 (which changed the behaviour being described)
- Related: SERVER-097 (which left one of these two descriptions stale already),
  CLI-045 (the same sentence in the CLI's help), SHARED-045 (the same sentence
  in SPEC.md, which needs sign-off)

## Spec References

- SPEC.md **§4** — commit windows are party-scoped, and each document's diff is
  path-scoped
- SPEC.md **§9.2** — the diff route (currently carries the same wrong sentence;
  that is SHARED-045, not this issue)

## Summary

`SERVER-113` changed `GET /api/docs/{id}/diff`'s default base from *the parent
of `to`* to *the previous commit that touched this document*, because since §4's
party-scoped commit windows the parent is routinely a different party's commit
touching a different file.

**The published contract still describes the old behaviour**, in two places:

- `packages/contract/src/schemas/edit.ts` — `DocDiffQuerySchema.from` (~:332)
  and `DocDiff.from` (~:373)
- `packages/contract/src/routes/doc-diff.ts` — the operation description

And one of them was **already** stale before SERVER-113 touched anything:
`edit.ts:240` still says "the parent of its first commit", left behind by
`SERVER-097`. So this is two drifts in one file, and fixing them is one pass.

**Why this is P1 and not documentation tidying.** `openapi.json` is a committed,
generated, drift-checked artifact that ships in the package. An API consumer
reading it is told the base is `to`'s parent, and can compute what they think is
the same range and get a different answer — silently, because both answers are
well-formed diffs. A description that is merely absent makes a caller ask; one
that is confidently wrong makes them not ask.

## Acceptance Criteria

- [x] Both `edit.ts` descriptions state the actual rule: the previous commit
      that touched **this document**, and git's empty tree when there is none
- [x] `routes/doc-diff.ts`'s operation description agrees with them
- [x] `packages/contract/openapi.json` is regenerated and committed, and the
      drift check passes
- [x] **The published artifact is swept, not just the source** — read the
      regenerated `openapi.json` and confirm no remaining description anywhere
      in it claims the parent-of-`to` rule. Grepping the source is what let
      `edit.ts:240` survive SERVER-097
- [x] No behavioural change: this issue moves no code

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/edit.ts`
- `packages/contract/src/routes/doc-diff.ts`
- `packages/contract/openapi.json` (generated)

## Testing Strategy

The generation and drift check are the test. If a description is asserted
anywhere in `openapi.test.ts`, update it there too rather than letting the
assertion pin the old wording.

## E2E Verification Log

**Model: Opus 5 (1M context), as contract-dev.** Description-only issue — no
route, schema, shape or behaviour was touched, so the "E2E" here is the
generated artifact itself: regeneration, idempotence, and a structural sweep of
the published document.

### Where the rule was wrong (five places, not the three the issue names)

Read out of the source and then confirmed against the generated document:

1. `schemas/edit.ts` — `DocDiffQuerySchema.from`'s published description ("Omit
   it to use the parent of `to`"). The one an API consumer reads.
2. `schemas/edit.ts` — `DocDiffSchema.from`'s published description
   ("`EMPTY_TREE_OBJECT_ID` when `to` has no parent").
3. `routes/doc-diff.ts` — the operation description ("`from` to the parent of
   `to`").
4. `schemas/edit.ts:240` — `DocEditedPayload.from` ("the parent of its first
   commit"), stale since SERVER-097. **Not in `openapi.json`**: no `doc.edited`
   payload component is published (the envelope stays open, per the CONTRACT-028
   test), so this one ships only in the package's runtime schema and its source.
   Fixed anyway — it is the same rule, and it is what the CLI and server authors
   read.
5. `schemas/edit.ts` — the `EMPTY_TREE_OBJECT_ID` docblock, **found by the sweep
   and not listed in the issue**. It said the constant is reported "when a
   session's first commit has **no parent**", and that the case "arises only in a
   workspace whose very first commit is also a document edit". Both are now
   false, and the second is the more misleading: since the base is resolved
   against this document's history, *every* document's first change diffs
   against the empty tree. SERVER-113's own log measured exactly that
   (`doc_s76pqdj5` → `from: 4b825dc…`).

### The sweep of the generated artifact

Walked `packages/contract/openapi.json` structurally (every `description` and
`summary` node, by JSON pointer) rather than grepping the source, which is what
the issue asks for and what let (4) survive SERVER-097.

- **1018 descriptions** in the document, before and after — identical counts, so
  the change added and removed none.
- **19** are both "base-ish" (`parent|base|predecessor|preceding|empty tree|
  4b825dc|previous commit|newest commit|commit before|before \`to\`|prior commit|
  root commit|first commit|last commit`) **and** git-ish. All 19 read in full:
  six are the diff surface (operation, `from` ×2 — parameter and its schema —
  `to` ×2, `DocDiff.from`); the other thirteen are unrelated uses of the word
  *parent* (a thread's parent document, `DeleteTurnResult.parentId`,
  `ReattachThreadRequest`'s ranges) or of *commit* (bulk's one-action-one-commit
  containment). None of the thirteen makes any claim about a diff base.
- **Every description mentioning the range parameters at all** (`` `from` ``,
  `` `to` ``, `from..to`) is **exactly seven**, and all seven are the diff
  surface — so the six above plus `DocDiff.to` are the complete set of places the
  document can state this rule. Nothing about a base lives anywhere else.
- No description anywhere matches the retired claim. Pinned as a test (below).

Nothing wrong-for-unrelated-reasons turned up in the swept descriptions.

### Regeneration and the drift check

```
$ npm run generate -w packages/contract          # exit 0
generated ./openapi.json
generated ./src/client/schema.generated.ts

$ shasum -a 256 openapi.json src/client/schema.generated.ts  > hash1
$ npm run generate -w packages/contract                       # again
$ shasum -a 256 openapi.json src/client/schema.generated.ts  > hash2
$ diff hash1 hash2                                # exit 0 — idempotent
8deae09f52fe598572c4efe335b7393a9326d49c9e5d53afdae42ef5fd3b2870  openapi.json
ce63288ea1e04d290790edb8cd13846f5bae561296eff19e848b65dd3fe581cf  src/client/schema.generated.ts
```

### That the shape did not move

The source edits are string literals inside `.describe(...)` / `description:` and
JSDoc, plus one added import of an already-exported constant
(`EMPTY_TREE_OBJECT_ID`, interpolated into the route prose so the sha is not
hand-copied). No `z.` call, no `createRoute` field other than `description`, no
component registration changed.

Prose-stripped fingerprint of the regenerated document (every `description`,
`summary`, `example`, `title` removed, keys sorted) — **50 paths, 107 component
schemas**, `sha256 a9427541ae4a34f31b46274c89b42f2c8e376d0c246fb80b9ccafe5d30c305ba`
over 80 828 bytes. It is recorded here so the orchestrator — who is the one that
runs git — can compute the same projection over `HEAD:packages/contract/openapi.json`
and confirm byte-for-byte that only prose moved; this agent runs no git command
and therefore had no committed baseline to diff against. The
shape assertions already in `openapi.test.ts` — the endpoint inventory, the
`DocDiff` property and `required` lists, the `from`/`to` parameter list and
types, the `additionalProperties: false` request-body sweep — all pass unchanged.

```js
// node shape.mjs <openapi.json>
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const PROSE = new Set(["description", "summary", "example", "examples", "title"]);
const strip = (n) =>
  Array.isArray(n)
    ? n.map(strip)
    : n && typeof n === "object"
      ? Object.fromEntries(
          Object.keys(n)
            .sort()
            .filter((k) => !PROSE.has(k))
            .map((k) => [k, strip(n[k])]),
        )
      : n;
const shape = JSON.stringify(strip(JSON.parse(readFileSync(process.argv[2], "utf8"))));
console.log(createHash("sha256").update(shape).digest("hex"), shape.length);
```

### Tests

Four assertions added to `openapi.test.ts` under CONTRACT-028's describe, so the
rule is pinned where the mistake happened:

- the new rule is stated in **all three** published places (operation, `from`
  parameter, `DocDiff.from`);
- each of the three states the empty-tree case, and the operation carries the
  literal sha;
- the operation and the `from` parameter say **why** (`party-scoped`), which is
  the clause that stops it drifting back;
- **the sweep as a test**: every description in the whole generated document is
  walked and matched against `/parent of (\`to\`|its first commit)|\`to\`( has|
  had| with) no parent/i`, and the offender list must be empty.

Non-vacuity checked directly: the regex matches all four retired strings
verbatim (including `` a `to` with no parent ``, which an earlier draft missed)
and none of the innocent *parent* prose it sits beside (`isParent`'s "documents
with no parent", `DeleteTurnResult.parentId`). Two stale test names/comments in
`schemas/edit.test.ts` were reworded to the new case.

No existing assertion pinned the old wording, so nothing had to be un-pinned.

```
$ vitest run packages/contract          →  63 files, 2524 tests, 0 failed
$ rtk proxy npx tsc --noEmit -p packages/contract > out.txt 2>&1; echo $?  →  0
$ npx eslint <4 touched files>          →  exit 0, no issues
$ npx prettier --check <touched + generated>  →  clean (openapi.test.ts formatted)
```

### Out of scope, still stale (other issues, per SERVER-113's own list)

`SPEC.md` §9.2 (SHARED-045, needs sign-off) and `apps/cli/src/commands/doc/diff.ts`
help text (CLI-045) still describe the parent-of-`to` rule. Untouched here.

## Completion Checklist (domain agent)

- [x] `/lint` passes
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-052]` prefix
