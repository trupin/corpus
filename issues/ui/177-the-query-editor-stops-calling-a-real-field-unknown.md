# [UI-177] The query editor treats `extra.` as open, and stops calling a real field unknown

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-091, SERVER-158
- Blocks: UI-178

## Spec References
- SPEC.md §5 — **Structured fields**
- SPEC.md §9.2 — **Pattern matching**
- SPEC.md §10 — the column query editor

## Summary

`apps/ui/src/board/query/grammar.ts` derives its field list from
`Object.keys(DocsQuerySchema.shape)` at runtime, which is why a new core filter
appears in the editor with no edit to that file. An **open** namespace cannot
come from `Object.keys`, and `unknownQueryFields` would flag `extra.assignee` as
a field the server has never heard of — marking a working query as broken.

This is the defect this issue exists for, and it appears the moment CONTRACT-091
lands.

## Acceptance Criteria

- [ ] `extra.<key>=<value>` in a column query is **not** reported as unknown
- [ ] `extra.` with nothing after the dot **is** reported, naming the empty key
- [ ] A key that is not a valid identifier is reported, naming the key
- [ ] Autocomplete offers `extra.` as a field, with a summary saying the part
      after the dot is the workspace's own
- [ ] The help panel documents glob patterns on `title`, `body`, `tag` and
      `folder`, and says how a glob differs from `q`
- [ ] `title` and `body` appear in the field list with no edit to the field
      table — they arrive through the schema, and a test asserts that

## Technical Design

### Files to Create/Modify
- `apps/ui/src/board/query/grammar.ts` — the namespace rule, the help entries
- `apps/ui/src/board/query/grammar.test.ts`
- `apps/ui/src/board/query/QueryEditor.tsx` — completion for the prefix
- `apps/ui/src/board/query/QueryEditor.test.tsx`

### Key Implementation Details

**`unknownQueryFields` grows one rule, not a second field list.** A name
starting with `extra.` is judged by the key after the dot, using the pattern
CONTRACT-091 exports. Every other name is judged as it is today. Import the
pattern — do not restate it — for the reason this file already gives about the
value lists.

**The grammar's `extra` entry describes a namespace, not a field.** `QUERY_FIELDS`
gets it from the schema shape like everything else, so the work here is its
`FieldDetail`: a summary that reads as an instruction (*"any frontmatter field
this workspace uses — `extra.assignee=theo`"*) and a `ValueSource` that offers
nothing yet. UI-178 fills that source in and is a separate issue precisely so
this one can ship if the vocabulary endpoint does not.

**Glob help is prose, not a new grammar rule.** Globs are a property of four
existing filters' values, so they belong in those fields' summaries and in one
`QUERY_EXAMPLES` entry, not in `QUERY_OPERATORS`. An operator entry would claim
a syntax the parser does not have.

### Edge Cases
- `extra.a.b=1` — the key is `a.b`, which fails the identifier pattern and is
  reported. Do not split on the last dot
- A query holding both `extra.owner` and an genuinely misspelled `titel` — the
  second is still reported, and the first is not

## Testing Strategy
`grammar.test.ts` over `unknownQueryFields` for each form above.
`QueryEditor.test.tsx` for the completion and the help panel entry, driven the
way its existing cases are.

## E2E Verification Plan
Real Vite dev server, real board. Open a column's query editor, type
`extra.assignee=theo`, and confirm no unknown-field warning renders. Then type
`titel=x` and confirm one does.

## E2E Verification Log
_Filled by the implementer._

## Completion Checklist (domain agent)
- [ ] Tests pass
- [ ] E2E log filled
- [ ] Lint and typecheck clean
