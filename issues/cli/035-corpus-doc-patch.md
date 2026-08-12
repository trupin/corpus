# [CLI-035] `corpus doc patch` — edit a line without shipping the document

## Domain

cli

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-037 (rider must be signed first), CONTRACT-046, SERVER-079
- Blocks: — (an agent-runtime follow-up teaching the skill to prefer patch over
  edit should be filed once this ships)

## Spec References

- SPEC.md §9.2 — the patch operation, as added by SHARED-037 (rider pending
  sign-off)
- SPEC.md §2.3 — the declarative command registry, generated `docs/cli.md`
- The orchestrate skill — the agent's edit loop this verb exists to shorten

## Summary

Expose the patch operation as `corpus doc patch <id>`: the agent quotes the
text it read from `corpus doc show`, supplies the replacement, and pays tokens
for the change rather than the document. Refusals surface the match count so
the recovery is obvious — add context, or re-read.

## Acceptance Criteria

- [x] `corpus doc patch <id> --old <text> --new <text>` performs the patch;
      `--all` opts into replace-every-occurrence; `--new ""` deletes the quoted
      text
- [x] Multi-line `old`/`new` are first-class — the common case is quoting a few
      lines with context. Support stdin (e.g. a JSON `{old, new}` document via
      `--stdin`) so shell quoting is never the reason a patch fails; decide the
      exact flag shape against the CLI's existing stdin conventions
      (`resolveBody`) and record it
- [x] The zero-match refusal and the N-match refusal render distinctly, each
      naming the count, with a hint naming the recovery ("quote more context" /
      "re-read the document: `corpus doc show <id>`")
- [x] `--from` / `CORPUS_FROM` attribution works exactly as `doc edit`'s does
- [x] Registered through the declarative registry; `--help` renders at all
      levels; `docs/cli.md` regenerates with no diff
- [x] Anchor consequences reported by the server (remapped/orphaned) are
      rendered, as `doc edit` renders them
- [x] Exit codes: success 0, refusals non-zero and distinct from transport
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

**Model run on: opus** (claude-opus-5, 1M context). 2026-08-12.

Real `corpus` binary (`node apps/cli/dist/bin/corpus.js`, built from source) against a
real server in a scratch workspace on port **8931** —
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/cli035-ws`. Port 8765 (the
user's live server) and 5173 were never touched. Server started with
`corpus server start` (pid 76224) and stopped at the end.

Seed document `doc_5kiwsafz` created with `corpus doc create --type note`, body
carrying a heading, two list items, two sentences beginning "The rate sheet",
and a blockquote — so that a unique excerpt, an ambiguous one and a deletion all
exist in one document.

### 1. Unique match, and the file/commit/projection behind it

```
$ corpus doc patch doc_5kiwsafz --from agent --old '- 30-year fixed: 6.1%' --new '- 30-year fixed: 5.8%'
patched doc_5kiwsafz — 1 occurrence replaced
key fcb6630a1c0a251fb287d7bfb81ff079db1d5fcaca8f9f373265bf1f4083fb16
exit=0
```

The file on disk holds `- 30-year fixed: 5.8%` with every other line
byte-identical, `updated` restamped, and `git log` shows
`agent :: doc edit: Mortgage options (doc_5kiwsafz) by agent`. The default
actor was checked too: the same verb without `--from` commits as `user`.
`corpus doc list --json` reports the patched excerpt and the new `updated`.

### 2. Both refusals, each naming its count

```
$ corpus doc patch doc_5kiwsafz --from agent --old '- 30-year fixed: 6.1%' --new 'x'
corpus: the text --old quotes is not in the body of doc_5kiwsafz — it matched 0 times, so nothing was written.
  Re-read the document — `corpus doc show doc_5kiwsafz` — and quote from what it says now. Matching is
  byte-exact: whitespace, indentation and line breaks all count, and the frontmatter block is not part of
  the body. If the excerpt spans lines, --old-file or --stdin carry it without the shell in the way.
exit=10

$ corpus doc patch doc_5kiwsafz --from agent --old 'The rate sheet' --new 'The sheet'
corpus: the text --old quotes occurs 2 times in the body of doc_5kiwsafz and this patch did not pass --all,
  so nothing was written.
  Quote more of the surrounding text until the excerpt occurs exactly once — the line above it is usually
  enough — or pass --all to replace all 2 of them if that is what you meant. `corpus doc show doc_5kiwsafz`
  prints the body to quote from.
exit=10
```

Same exit code, different `code`, opposite recoveries — and neither message
mentions the other's fix. Under `--json`:

```
$ corpus doc patch doc_5kiwsafz --from agent --old 'The sheet' --new 'x' --json
{"error":{"code":"patch_multiple_matches","message":"…occurs 2 times…","changed":false,
  "details":{"reason":"multiple-matches","matches":2}}}
exit=10
```

### 3. `--all`

```
$ corpus doc patch doc_5kiwsafz --from agent --old 'The rate sheet' --new 'The sheet' --all
patched doc_5kiwsafz — 2 occurrences replaced
exit=0
```

### 4. The no-op

```
$ corpus doc patch doc_5kiwsafz --from agent --old '- 15-year fixed: 5.4%' --new '- 15-year fixed: 5.4%'
doc_5kiwsafz unchanged — --new is the text --old quotes, so the 1 occurrence it matched already said
that and nothing was written
key 797ed8f8a717a89222bfd2ffa98c4d396226032dc37b5e03b1dfb03293f8c647
exit=0
```

Commit count unchanged (3 before, 3 after) and the key identical to the previous
write's, so nothing was written — as SPEC.md §9.2 requires, and the line says so
rather than claiming an edit.

### 5. A deletion (`--new ''`)

```
$ corpus doc patch doc_5kiwsafz --from agent --old '
> Draft: do not circulate.
' --new ''
patched doc_5kiwsafz — 1 occurrence replaced
exit=0
```

The blockquote and the blank line around it are gone; the surrounding paragraphs
are untouched.

### 6. Multi-line, stdin and files

Multi-line literal `--old` spanning a heading and a list item: applied, exit 0.

```
$ corpus doc patch doc_5kiwsafz --from agent --stdin <<'EOF'
{"old": "Ask the broker about points.\n", "new": "Ask the broker about points — it's the `--rate` lock that matters.\n"}
EOF
patched doc_5kiwsafz — 1 occurrence replaced
```

(text carrying an apostrophe, backticks and a leading `--`, none of which the
shell ever saw). `--old-file` / `--new-file` with two multi-line files: applied,
exit 0, bytes preserved including the trailing newline.

### 7. Anchors

An anchored thread (`th_k75f4xbj` on `anc_1141a7b6`) was created over
"The sheet is the source of truth." and then patched away:

```
patched doc_5kiwsafz — 1 occurrence replaced — 1 anchor remapped
```

§6's report rides on the patch exactly as it does on `doc edit`.

### 8. Usage refusals, nothing sent

`--old` alone, `--new` alone, `--old ''`, `--old` with `--old-file`, `--stdin`
with `--old`/`--new` — all exit 2 with a hint naming the fix, and the stub/server
received nothing. `--key` is not a flag: `unknown flag "--key" for "patch"`.

**The socket-on-fd-0 case** (CLI-007), run from inside this agent harness, whose
Bash tool hands the child a socket that never ends:

```
$ corpus doc patch doc_5kiwsafz --stdin
corpus: --stdin was given but nothing is piped in.
exit=2
```

Returned immediately — `--stdin` goes through `stdinCarriesABody()`, so it
cannot park the agent.

### 9. Help and docs

`corpus doc --help` lists `patch`; `corpus doc patch --help` renders the
description, flags and all eight examples. `docs/cli.md` regenerated with
`npm run docs:cli -w apps/cli`; `scripts/check-generated-artifacts.ts` reports
the regeneration is a no-op (its only complaint is that the file is not yet
committed, which is the orchestrator's step).

### Checks

- `npm run build` — clean
- `npx vitest run apps/cli` (`VITEST_MAX_THREADS=4`) — **1385 passed, 0 failed**
- `npx tsc --noEmit -p apps/cli/tsconfig.json` — clean
- `npx eslint apps/cli/src` — no issues
- `npx prettier --check` on every touched file — clean

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] `docs/cli.md` regenerated
- [x] E2E verification log filled in
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-035]` prefix
