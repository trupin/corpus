# [UI-177] The query editor treats `extra.` as open, and stops calling a real field unknown

## Domain
ui

## Status
done

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

- [x] `extra.<key>=<value>` in a column query is **not** reported as unknown
- [x] `extra.` with nothing after the dot **is** reported, naming the empty key
- [x] A key that is not a valid identifier is reported, naming the key
- [x] Autocomplete offers `extra.` as a field, with a summary saying the part
      after the dot is the workspace's own
- [x] The help panel documents glob patterns on `title`, `body`, `tag` and
      `folder`, and says how a glob differs from `q`
- [x] `title` and `body` appear in the field list with no edit to the field
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

**Implemented on: opus.**

### One thing the issue did not anticipate

The issue asked for `extra.` to be *offered*. It did not say what accepting it
should insert, and the default was wrong: a field completion appends its `=`,
because "the only thing that can follow a field name is one". For an open
namespace that is false — what follows is the workspace's key — so accepting
`extra` wrote `extra=`, a filter the server does not honour. The menu would have
been handing the person a broken query.

The completion now stops at the dot and leaves the caret where the key goes. The
rule is spelled on the **shape of the name** — a value ending in `.` is a prefix
— so `queryCompletion.ts` keeps knowing nothing about which fields exist, which
is the property that module is built around.

### Where the grammar did and did not change

- `unknownQueryFields` grew **one rule**, not a second field list. A name
  starting with `extra.` is judged by the contract's own `EXTRA_KEY_PATTERN`,
  imported rather than restated.
- `title` and `body` needed no wiring at all — they arrived through
  `Object.keys(DocsQuerySchema.shape)`, which is the property this module exists
  to have. What they did need is prose: `grammar.test.ts` failed until each had
  a sentence, exactly as its docblock promises.

```
AssertionError: expected [] to deeply equal [ "title", "body" ]
```

- Globs are taught in the four fields' summaries and in one example, and
  **not** as a `QUERY_OPERATORS` entry — an operator entry would claim a token
  the parser does not have. A test pins that.

### Falsification

```
$ # the extra. rule deleted from unknownQueryFields
      Tests  3 failed | 17 passed (20)
   × does not call a real invented field unknown
   × still flags a genuine typo standing beside one
   × ships examples that are valid queries

$ # the namespace check in applyQueryCompletion forced to false
      Tests  2 failed | 92 passed (94)
   × stops at the dot instead of adding the operator
   × completes the open namespace to its dot, not to an operator
```

The third failure in the first run is the one worth noticing: the shipped
example `extra.assignee=theo` is itself checked against `unknownQueryFields`, so
the examples cannot drift away from the rule that admits them.

### Suites

```
$ vitest run apps/ui packages/kit
   Test Files  246 passed (246)
        Tests  4780 passed (4780)
```

## Completion Checklist (domain agent)
- [x] Tests pass
- [x] E2E log filled
- [x] Lint and typecheck clean
