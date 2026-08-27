# [CLI-072] `corpus doc list` takes the same filters the board does

## Domain
cli

## Status
done

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

- [x] `--title` and `--body` map to the new filters
- [x] `--extra key=value` is repeatable and maps to `extra.<key>=<value>`
- [x] `--extra` without an `=` is refused with a message naming the form
- [x] Help text for `--tag`, `--folder`, `--title` and `--body` names glob
      support and distinguishes it from `--query`
- [x] `--json` output is unchanged in shape
- [x] `docs/cli.md` regenerates cleanly (`npm run cli:docs`)
- [x] Two examples in the registry entry, one glob and one `--extra`

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

**Implemented on: opus.**

### Where the flags landed

`--title` and `--body` went into the **shared** list, so they appear on
`corpus search` too — the contract puts them on `docFilterShape` because they
are structural filters exactly as `--tag` is. `--extra` is list-only, for the
same reason `--is-parent` is: §9.2's signed `/api/search` parameter string does
not carry it, so a flag for it on `search` would go nowhere on the wire. Both
facts are pinned by tests rather than left to the reviewer.

`--tag` and `--folder` needed no code change to take globs — the server does
that — but their help text was now wrong and says so.

### E2E, against the real server on the real workspace

The same workspace SERVER-158 verified against, port 8791, two hand-written
documents carrying invented frontmatter fields:

```
$ corpus doc list --extra assignee=theo
doc_broker01  note  open  Catch-Up with the broker  data/docs/work/tasks/broker.md
showing 1–1 of 1 document

$ corpus doc list --extra "assignee=t*"
doc_broker01  note  open  Catch-Up with the broker  data/docs/work/tasks/broker.md

$ corpus doc list --title "Catch-Up*"
doc_broker01  note  open  Catch-Up with the broker  data/docs/work/tasks/broker.md
doc_notary01  note  open  Catch-Up with the notary  data/docs/work/tasks/notary.md
showing 1–2 of 2 documents

$ corpus doc list --extra assignee=theo --extra estimate=3
doc_broker01  note  open  Catch-Up with the broker  data/docs/work/tasks/broker.md

$ corpus doc list --extra owners=dana --json --fields id,title
{"items":[{"id":"doc_broker01","title":"Catch-Up with the broker"}],"page":{"total":1,"limit":50,"offset":0}}
```

The three refusals, each before any request:

```
$ corpus doc list --extra assignee
corpus: --extra takes `key=value`, and `assignee` has no `=`.
  Write it as `--extra assignee=theo`. No request was sent.
exit=2

$ corpus doc list --extra 1bad=x
corpus: `1bad` is not a field name: it must be an identifier — letters, digits, `_` and `-`, starting with a letter or `_`.
  No request was sent.
exit=2

$ corpus doc list --extra assignee=
corpus: --extra assignee= has no value.
  There is no way to ask for a document that *lacks* a field. To find every document that has one, write `--extra assignee='*'`. No request was sent.
exit=2
```

The third refusal says what **can** be asked, not only what cannot. There is no
absence filter, so a message that stopped at "no value" would leave the caller
guessing at a filter that does not exist.

### Falsification

```
$ # the dotted prefix dropped from the wire key
      Tests  4 failed | 48 passed (52)
   × sends one dotted parameter per key
   × splits on the first `=`, so a value may contain one
   × lets the last occurrence of a key win
   × passes a glob through untouched
```

### Suites

```
$ vitest run apps/cli
   Test Files  1 failed | 107 passed (108)
        Tests  2 failed | 2193 passed (2195)
```

**The two failures are `init/git-process-group.test.ts` and are not this
issue's.** Verified by stashing every change in this branch and re-running that
file alone on the clean tree, where it also failed. It is timing-sensitive — one
of its two cases passed on the clean tree and neither did under load — and it
touches no code this issue goes near.

## Completion Checklist (domain agent)
- [x] Tests pass
- [x] `docs/cli.md` regenerated
- [x] E2E log filled
