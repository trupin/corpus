# [CLI-023] `corpus tree`: expose GET /api/tree to the agent

## Domain
cli

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: CLI-003
- Blocks: —

## Spec References
- SPEC.md §9.2 `GET /api/tree`; §7 (agent interacts only through the CLI); §7 Retrieval discipline (structure ≠ enumeration)

## Summary
Found during sprint-019 pre-flight (Open Conflict 2): `GET /api/tree` exists in the
contract and serves the UI, but no CLI verb exposes it — the agent cannot see folder
structure at all (the comment skill's old workaround was a raw `data/docs/` read,
removed by AGENT-008's retrieval-first pass). A structure view is not enumeration:
one bounded call showing folders (and counts), not document bodies. Add `corpus
tree` as a thin typed-client verb; output compact (one folder per line, depth
indent, doc count); `--json` mirror. This is the same §7 reachability species as
CLI-022.

## Acceptance Criteria
- [ ] `corpus tree` renders the folder tree with per-folder counts; no document bodies
- [ ] `--json` mirrors the wire shape; docs/cli.md regenerated; inventory tests updated
- [ ] Skill text may then reference it for filing decisions (follow-up skill touch, not this issue)

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/tree.ts` (new + tests); docs regen

## Testing Strategy
apps/cli scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real server: seeded workspace → tree matches disk; empty workspace → sane empty output.

## E2E Verification Log

Implemented on: **opus**.

**Real server, real workspace**, port 8766. Two documents filed into
`finance/2026` and `finance`, then:

```
$ corpus tree
boards  3
finance  1 (2)
  finance/2026  1
inbox  4
templates  1
views  3
```

The tree matches disk, the nesting is indented, and `finance 1 (2)` says the
folder holds one document and its subtree holds two — which is the number a
filing decision actually needs. `--json` returns the wire shape unchanged,
nesting included.

**Two decisions worth recording.**

The line names the **path**, not the folder's name. `--folder` takes a path, and
a name repeated at two depths would be ambiguous exactly where it mattered. The
indent carries the shape for a person; the path carries it for anything else.

The total is printed **only where it differs** from the folder's own count. A
parent whose descendants hold documents it does not is the common case, and one
number there would hide whichever it was not.

**Structure, not enumeration** (SPEC.md §7), asserted rather than asserted-in-a-
comment: a test renders a tree and checks that no line matches `doc_` or `th_`
and that every line is a path and a count. This verb cannot stand in for a
search, which is the property that lets it exist at all.

**Unit**: `tree.test.ts` 6 passed, including the empty tree — a fresh workspace
would not reach it through the server, since `corpus init` creates four folders,
so it is covered where it can be. Whole `apps/cli` suite: **2,223 passed**, 110
files. `docs/cli.md` regenerated and the hygiene inventory updated, which is what
caught the new module.

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
