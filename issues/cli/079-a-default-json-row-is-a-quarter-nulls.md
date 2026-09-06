# [CLI-079] A default `--json` row is a quarter nulls

## Domain

cli

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Related: CLI-065 (`--fields`, whose absent-key semantics this generalizes),
  CLI-072 (`doc list` filters)

## Spec References

- SPEC.md **§2** — the CLI is the agent's whole surface
- SPEC.md **§7** — retrieval discipline: what a read costs must not grow with
  what the caller did not ask about

## Summary

Measured 2026-09-05 on a seeded scratch workspace (corpus 0.32.0, port 8971,
23 documents — the template's skills and views included, which is what a real
workspace holds).

`corpus doc list --json` prints **1,066 B a row (~266 tok)**, consistent with
CLI-065's 293. Of that:

| Component | Share |
| --- | --- |
| **null-valued keys** — 382 across 23 rows | **23%** |
| `excerpt` | 24% |
| `extra` | 8% |

A `note` row carries 35 keys and most are null: the thread-only keys
(`parent`, `parentTitle`, `agent`, `anchorQuote`, `turnCount`, `lastAuthor`,
`lastTurn`, `unread`, `awaitingAgent`), the board-only keys (`query`,
`columns`, `kanban`, `defaultOpen`, `order`), and the sometimes keys (`due`,
`stage`, `origin`, `stale`, …). Every row pays for every other type's schema.

**CLI-065 already decided the semantics this needs.** Its `--fields` projection
ships with the rule *"a field absent on a row stays absent rather than becoming
`null`"* — so for this surface, **absent ≡ null is already the contract**. A
caller written against `--fields` output cannot be assuming null-keyed rows.

## What to build

**Drop null-valued keys from `doc list --json` rows.** CLI-side projection at
render time, exactly where `--fields` already projects — no contract change, no
server change, no wire change.

A lossless ~23% cut on every default `--json` list read, paid on the loop's hot
path: the orchestrate reflection window read, and every scripted list.

## Acceptance Criteria

- [x] A `doc list --json` row carries no key whose value is `null`.
- [x] `--fields` output is unchanged — a field **explicitly requested** that is
      null on a row keeps CLI-065's behaviour exactly as shipped and tested.
- [x] The `page` envelope is untouched.
- [x] Non-null values are byte-identical to today — this removes keys and
      changes nothing else.
- [x] Measured on the same 23-row fixture shape: the total drops ~20% or more,
      and the issue records before and after. **Measured 16,976 B → 12,977 B on a
      16-row page, a 23.6% cut** — the reported 23% share, confirmed against the
      raw wire response.
- [x] `docs/cli.md` regenerates cleanly if any help text changes.

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/doc/list.ts` — the projection.
- `apps/cli/src/commands/doc/list.test.ts` — the cases below.

### Key Implementation Details

**Decision recorded 2026-09-05 (implemented on opus): `doc list` alone.** No
other list emitter follows. `job list`, `agents --json` and `search --json` were
measured lean, and the recommendation is taken as it stands — CLI-065 made the
same call for `search --json` in as many words. Extending the cut to a surface
nobody has measured would buy nothing and would put a second copy of the rule
somewhere a future reader has to reconcile with this one. When a measurement says
a row is null-heavy, that surface gets its own issue and its own before/after.

**A second decision the acceptance criteria imply but do not spell:** the cut is
**top-level only** and does not recurse. `extra` holds the workspace's own
frontmatter (SPEC.md §5) and `kanban` holds a board's configuration, so a null in
either is the author's data rather than this verb's verbosity. Dropping it would
silently rewrite what somebody wrote. A test pins `extra: {assignee: null}`
surviving intact.

**State the semantics in the help**: a key absent from a row is a key whose
value is null, the same reading `--fields` already requires.

### Edge Cases

- A key whose value is `[]` or `""` or `false` is **kept** — only `null` goes.
  `tags: []` and `unreadThreads: 0` are values.
- A row that is all-null except `id`/`type`/`title` still prints those.
- A consumer doing `row.parent === null` gets `undefined` instead. That is the
  break `--fields` already shipped for projected rows, and the help says so.

## Testing Strategy

- A fixture row of each type asserts exactly which keys survive.
- A `--fields` request naming a null field asserts CLI-065's behaviour is
  untouched.
- A snapshot asserting no `":null"` substring in default output.

## E2E Verification Plan

### Verification Steps

1. `npm run build`, restart a scratch server, seed mixed types.
2. `corpus doc list --json | python3 -c "..."` — assert zero null values, and
   record total bytes against the pre-change run.
3. `corpus doc list --json --fields id,parent` on a note — `parent` present and
   null per CLI-065.

## E2E Verification Log

Implemented on: **opus**.

### Post-Implementation Verification

Real binary against a real server: scratch workspace on port **8972**
(`corpus init` then `corpus server start`, pid 14297, stopped afterwards, port
confirmed free). Seeded with the workspace template's own documents plus a note
and three threads — 16 documents of mixed type, which is the shape a real
workspace holds.

**Before** is not a guess: it is the raw wire response, which is exactly what the
CLI emitted under `--json` until this change.

```
$ curl -s -H "Authorization: Bearer $TOKEN" 'http://127.0.0.1:8972/api/docs?limit=200' | wc -c
16976
rows: 16   null-valued keys: 264

$ corpus doc list --json --limit 200 | wc -c
12978
null values in output: 0
```

```
before bytes: 16976   after bytes: 12977   cut: 23.6%
every non-null value byte-identical and present: true
page envelope identical: true
```

The third and fourth lines are a row-by-row comparison of the two payloads: every
key the server sent with a non-null value is present in the CLI's output with a
byte-identical value, no key was added, and `page` is unchanged. 264 null-valued
keys across 16 rows disappeared and nothing else moved. `grep -o ':null'` over
the whole output counts **0**.

**`--fields` is untouched**, on a note where both named fields are null:

```
$ corpus doc list --json --fields id,parent,stage --limit 200
… {"id":"doc_xm62f3jc","parent":null,"stage":null} …
```

CLI-065's behaviour exactly as shipped: a field asked for by name is answered,
even when the answer is null.

**Docs.** `npm run docs:cli -w apps/cli` regenerated `docs/cli.md` for the changed
help text; a second run produces an identical file and
`npx prettier --check docs/cli.md` passes.

**Unit tests.** 63 in `doc/list.test.ts`, all passing, including the two
pre-existing `--json` assertions rewritten to the new contract and eleven new
cases covering each row type, the `[]`/`""`/`false`/`0` carve-out, the untouched
`page` envelope, the unchanged human rendering, and the nested-null rule.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E log with both measurements
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-079]` prefix
