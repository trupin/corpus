# [CLI-072] `corpus doc list` takes the same filters the board does

## Domain
cli

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-091, SERVER-158
- Blocks: —

## Spec References
- SPEC.md §5 — **Structured fields**
- SPEC.md §9.2 — **Pattern matching**
- SPEC.md §2.3 — the CLI is a thin client, and `docs/cli.md` regenerates from
  the registry

## Summary

The agent writes the frontmatter fields a workspace invents. It should be able to
query them without going through the board.

`corpus doc list` exposes the collection query's filters. It gains `--title`,
`--body` and a repeatable `--extra`, and its existing `--tag` and `--folder`
start carrying globs the moment SERVER-158 lands — no CLI change needed for
those two, but their help text is now wrong and must say so.

## Acceptance Criteria

- [ ] `--title` and `--body` map to the new filters
- [ ] `--extra key=value` is repeatable and maps to `extra.<key>=<value>`
- [ ] `--extra` without an `=` is refused with a message naming the form
- [ ] Help text for `--tag`, `--folder`, `--title` and `--body` names glob
      support and distinguishes it from `--query`
- [ ] `--json` output is unchanged in shape
- [ ] `docs/cli.md` regenerates cleanly (`npm run cli:docs`)
- [ ] Two examples in the registry entry, one glob and one `--extra`

## Technical Design

### Files to Create/Modify
- `apps/cli/src/commands/doc/list.ts` — the flags and the mapping
- `apps/cli/src/commands/doc/list.test.ts`
- `docs/cli.md` — regenerated

### Key Implementation Details

**`--extra key=value`, not `--extra.key value`.** A flag name cannot carry the
key without teaching the parser an open namespace, and this repository already
refuses to grow a second parser for a shape the server owns. Split on the
**first** `=` so a value may contain one.

**Reuse the contract's key validation.** CONTRACT-091 exports the pattern; the
CLI refuses a bad key locally rather than sending a request that will `400`, and
imports the rule instead of restating it.

**Nothing is escaped for the shell here.** A glob is passed through to the server
as text. The user's own shell may expand `*` before the CLI sees it — say so in
the help text and show the quoted form in the examples. That is a real trap and
the one thing a person will hit first.

### Edge Cases
- `--extra owner=` — refused, matching the contract's refusal of an empty value
- The same key twice — last wins, and the help says so
- `--title '*'` — valid, matches everything

## Testing Strategy
Registry-level tests over the argument mapping, and a refusal test for each of
the three bad forms. No network.

## E2E Verification Plan
Against a real server and a real workspace:
1. `corpus doc create` a note, then write `assignee: theo` into its frontmatter
2. `corpus doc list --extra assignee=theo` lists it
3. `corpus doc list --extra assignee='t*'` lists it
4. `corpus doc list --title 'Mort*' --json | jq '.items | length'`
5. `corpus doc list --extra owner` exits non-zero naming the `key=value` form

## E2E Verification Log
_Filled by the implementer._

## Completion Checklist (domain agent)
- [ ] Tests pass
- [ ] `docs/cli.md` regenerated
- [ ] E2E log filled
