# [CONTRACT-091] `extra.<key>` is a filter, and title/body/tag/folder take globs

## Domain
contract

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-011
- Blocks: SERVER-158, CLI-072, UI-177

## Spec References
- SPEC.md §5 — **Structured fields** (rider signed 2026-08-04, applied 2026-08-26)
- SPEC.md §9.2 — **Pattern matching**, and the `GET /api/docs` parameter line
- SPEC.md §9.1 — extra frontmatter, passed through untouched

## Summary

The signed rider promises two things the wire cannot express. A workspace may
invent a frontmatter field and filter on it, and four core filters may take glob
patterns. `DocsQuerySchema` carries neither, and it carries no `title` and no
`body` filter at all — which the rider's own example, `title=Catch-Up*`,
presumes.

This issue puts both on the wire and nowhere else. The SQL is SERVER-158's.

## Acceptance Criteria

- [ ] `title` and `body` are filters on the collection query, published in
      `openapi.json`, and accepted by `GET /api/docs`
- [ ] `extra.<key>=<value>` parses into a validated record on `DocsQuery`
- [ ] A key that is not a safe identifier is refused with `400`, naming the key
- [ ] `DocsQuerySchema.shape` still exists and still enumerates every field —
      `apps/ui/src/board/query/grammar.ts` reads it at runtime
- [ ] The four glob-bearing filters document glob semantics in their published
      description, including that a glob is distinct from `q=`
- [ ] `/api/search` gains `title` and `body` too, and does **not** gain `extra`
      (see below)
- [ ] `npm run openapi:check` regenerates cleanly

## Technical Design

### Files to Create/Modify
- `packages/contract/src/schemas/query.ts` — the shape, the parse, the refinements
- `packages/contract/src/schemas/query.test.ts` — the cases below
- `packages/contract/openapi.json` — regenerated

### Key Implementation Details

**The `extra` namespace cannot be a Zod object key**, because the key is chosen
by the workspace. Represent it on the parsed type as one field:

```ts
extra?: Readonly<Record<string, string>>
```

and lift it out of the flat query record before the object schema runs. Export
the lift as a named function (`collectExtraParams`) so both the route binding
and the CLI use one implementation:

- every raw parameter whose name starts with `extra.` moves into `extra`, keyed
  by the part after the dot
- everything else passes through unchanged, so an unknown non-`extra` parameter
  still fails the way it does today

`DocsQuerySchema` itself keeps `extra` as an optional record field, so
`Object.keys(DocsQuerySchema.shape)` gains exactly one name — `extra` — and the
UI grammar keeps working with no edit. UI-177 renders that one name as the open
namespace it is.

**Key validation.** A key becomes a JSON path in SQL, so it must be an
identifier: `/^[A-Za-z_][A-Za-z0-9_-]*$/`, at most 64 characters. Refuse
anything else with `400` naming the key. Nothing user-supplied ever reaches SQL
as text (SERVER-158 binds the path), and this rule is the second guard rather
than the only one.

**Glob semantics, published once.** A value containing `*` or `?` is a glob. A
value containing neither is matched exactly as it is matched today. That makes
the feature purely additive: every view stored before this release keeps its
meaning, because `folder=work` has no wildcard and `folder=work/*` matched
nothing before.

**`extra` is not on `/api/search`.** §9.2 says ranked retrieval carries "most of
the same set", and names each exception. `title` and `body` are structural
filters and join `docFilterShape`, so they land on both endpoints as every
shared filter does. `extra` stays on the collection query alone, for the reason
`isParent` did: the signed `/api/search` parameter string does not carry it, and
publishing it there is a rider rather than a contract decision. Say so in the
module's existing exclusions docblock, in its voice.

### Edge Cases
- `extra.` with nothing after the dot — `400`, naming the empty key
- An empty value (`extra.assignee=`) — `400`. There is **no absence sentinel**
  in this release. `stage=`'s empty element is a core field's null sentinel and
  inventing a second one is design beyond the signed text
- The same key twice in one query string — last one wins, the way a repeated
  core parameter already resolves
- A glob of `*` alone — matches every document that **has** the field, and no
  document that lacks it

## Testing Strategy

`packages/contract/src/schemas/query.test.ts`:
- `collectExtraParams` lifts `extra.assignee` and leaves `type` alone
- a bad key fails, and the message names the key
- an empty value fails
- `title` and `body` parse, and reject the empty string like `q`
- `DocsQuerySchema.shape` contains `extra`, `title` and `body`
- the openapi parameter list keeps its published order (`openapi.test.ts` pins it)

## E2E Verification Plan

Contract-only, so the E2E is the generated document and the typed client:
`npm run openapi:generate && git diff --stat packages/contract/openapi.json`,
then `npm run build -w packages/contract` and a `tsc` that consumes
`DocsQuery["extra"]`.

## E2E Verification Log
_Filled by the implementer._

## Completion Checklist (domain agent)
- [ ] Tests pass
- [ ] `openapi.json` regenerated and committed
- [ ] Lint and typecheck clean
