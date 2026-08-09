# [CLI-035] `corpus doc patch` — edit a line without shipping the document

## Domain

cli

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-046, SERVER-079
- Blocks: — (an agent-runtime follow-up teaching the skill to prefer patch over
  edit should be filed once this ships)

## Spec References

- SPEC.md §9.2 — the patch operation
- SPEC.md §2.3 — the declarative command registry, generated `docs/cli.md`
- The orchestrate skill — the agent's edit loop this verb exists to shorten

## Summary

Expose the patch operation as `corpus doc patch <id>`: the agent quotes the
text it read from `corpus doc show`, supplies the replacement, and pays tokens
for the change rather than the document. Refusals surface the match count so
the recovery is obvious — add context, or re-read.

## Acceptance Criteria

- [ ] `corpus doc patch <id> --old <text> --new <text>` performs the patch;
      `--all` opts into replace-every-occurrence; `--new ""` deletes the quoted
      text
- [ ] Multi-line `old`/`new` are first-class — the common case is quoting a few
      lines with context. Support stdin (e.g. a JSON `{old, new}` document via
      `--stdin`) so shell quoting is never the reason a patch fails; decide the
      exact flag shape against the CLI's existing stdin conventions
      (`resolveBody`) and record it
- [ ] The zero-match refusal and the N-match refusal render distinctly, each
      naming the count, with a hint naming the recovery ("quote more context" /
      "re-read the document: `corpus doc show <id>`")
- [ ] `--from` / `CORPUS_FROM` attribution works exactly as `doc edit`'s does
- [ ] Registered through the declarative registry; `--help` renders at all
      levels; `docs/cli.md` regenerates with no diff
- [ ] Anchor consequences reported by the server (remapped/orphaned) are
      rendered, as `doc edit` renders them
- [ ] Exit codes: success 0, refusals non-zero and distinct from transport
      errors, matching the CLI's existing conventions

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/doc/patch.ts` (+ test) — thin typed-client call
- the doc command index + registry entry
- `docs/cli.md` — regenerated

### Key Implementation Details

Thin client, like every verb: no local matching, no local validation of `old`
beyond non-emptiness — the server owns the semantics, and a CLI that
pre-checked would drift from it. Render the server's refusal counts verbatim.

### Edge Cases

- `old` containing characters the shell mangles — the stdin path is the answer;
  the error hint for a suspicious zero-match (e.g. `old` containing literal
  `\n`) can suggest it
- Piping both a body and flags — refuse ambiguity the way `doc edit` refuses
  conflicting body sources

## Testing Strategy

Vitest with the existing CLI test harness: happy path, both refusals rendered
with counts, `--all`, stdin form, attribution, exit codes, help output from the
registry.

## E2E Verification Plan

### Verification Steps

1. Against a running server: `corpus doc show <id>`, quote three lines, patch
   them — confirm the file, the commit author, the projection row
2. Ambiguous patch — confirm the refusal, count, and hint
3. Patch through stdin with content full of quotes and newlines
4. `docs/cli.md` drift check clean; `--help` renders the verb

## E2E Verification Log

_[Agent fills: model run on, commands, observed output.]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] `docs/cli.md` regenerated
- [ ] E2E verification log filled in
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-035]` prefix
