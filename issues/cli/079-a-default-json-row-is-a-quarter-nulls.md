# [CLI-079] A default `--json` row is a quarter nulls

## Domain

cli

## Status

todo

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

- [ ] A `doc list --json` row carries no key whose value is `null`.
- [ ] `--fields` output is unchanged — a field **explicitly requested** that is
      null on a row keeps CLI-065's behaviour exactly as shipped and tested.
- [ ] The `page` envelope is untouched.
- [ ] Non-null values are byte-identical to today — this removes keys and
      changes nothing else.
- [ ] Measured on the same 23-row fixture shape: the total drops ~20% or more,
      and the issue records before and after.
- [ ] `docs/cli.md` regenerates cleanly if any help text changes.

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/doc/list.ts` — the projection.
- `apps/cli/src/commands/doc/list.test.ts` — the cases below.

### Key Implementation Details

One decision to make and record: **whether other list emitters follow.**
`job list`, `agents --json`, `search --json` were measured lean (their rows are
small or already sparse), so the recommendation is `doc list` alone, with the
others left until a measurement says otherwise — CLI-065 made the same call for
`search --json` in as many words.

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

_Filled in by the implementing agent. State which model it ran on._

### Post-Implementation Verification

_[Agent fills: both byte totals, the zero-null assertion]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E log with both measurements
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-079]` prefix
