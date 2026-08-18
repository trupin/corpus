# [SERVER-124] Under a `.claude/` root, Corpus's own frontmatter goes entirely unvalidated

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-123
- Blocks: —

## Spec References

- SPEC.md **§7** line 399 — *"Corpus's frontmatter fields (`id`, `type`, `title`,
  `tags`, `status`, `anchors`) coexist with Claude Code's (`name`,
  `description`) in the same YAML block; `corpus doc check` validates both sets"*

## Summary

SERVER-123 made §7:399 true of **Claude Code's** set under `.claude/agents/`. It
is still false of **Corpus's** set under every `.claude/` root, and PR #49's
third review found this while checking that issue's residual was honestly stated.

Measured against a real server, 2026-08-17. A hand-authored
`.claude/agents/bogus.md` carrying:

```yaml
id: 12345
type: not-a-real-type
title: []
tags: seven
status: banana
```

produces **zero findings**. Every one of those is malformed, and `corpus doc
check` says nothing about any of them.

**The cause is that §5's waiver is all-or-nothing.** It has to waive
*required-ness* — a hand-written profile legitimately has no `id`, no `type`, no
`status`, and demanding them would refuse files Claude Code wrote and Corpus only
reads. But the same waiver drops *well-formedness* of the fields that **are**
present, and those are two different questions. A file that declares
`status: banana` has not omitted a field; it has got one wrong.

## Why this is worth fixing rather than documenting

Everything under these roots is projected like any other document. A
`type: not-a-real-type` reaches the projection, the board, and every query that
filters on type. A malformed `tags` reaches the tag vocabulary. The waiver was
written so a hand-authored `SKILL.md` would not be refused for lacking Corpus's
block; it was never meant to make the block unfalsifiable when somebody writes
one.

## What has to be decided

**A present-only validation mode**: validate a field's shape when it appears,
never its presence. That is the shape the two questions want, and the risk is
stated plainly — **it would newly report files in existing workspaces**, which is
exactly the objection SERVER-123's regression was about (PR #49 third review,
MAJOR 1). So:

- It must be **reported, not blocking** — the same partition SERVER-123 settled
  on, for the same reason. `isClaudeCodeRequirement`'s sibling.
- Someone should measure how many documents in a real workspace it would newly
  report, before it lands. If the answer is "many", that is a finding about the
  waiver's history, not a reason to skip it.

## Acceptance Criteria

- [x] A field of Corpus's set that is **present and malformed** under a
      `.claude/` root is reported by `corpus doc check`
- [x] A field of Corpus's set that is **absent** is still waived — a
      hand-authored `SKILL.md` or profile with no Corpus block must stay clean
- [x] The finding is **reported, not blocking**, so no existing file becomes
      unwritable (SERVER-123's regression, and its fix, are the precedent)
- [x] The count of newly-reported documents in a realistic workspace is measured
      and stated before merge — **2 of 45**, see the log below
- [x] §7:399's claim is either true afterwards or the sentence is corrected —
      **it is now true of Corpus's six fields under every `.claude/` root**, so
      no SPEC edit is proposed. Its *other* half is unchanged and still carries
      SERVER-123's stated residual: Claude Code's `name`/`description` are
      required under `.claude/agents/` and asked of nothing under
      `.claude/skills/**`. That gap is a product call already recorded on
      `claudeCodeRootFor`, not something this issue closed.

## Technical Design

### Files to Create/Modify

- `apps/server/src/core/check.ts` — the waiver, currently all-or-nothing
- `apps/server/src/docs/write.ts` — the reported/blocking partition

### Key Implementation Details

Read `checkCorpus`'s `claudeCodeRoot === null` branch: the §5 finding is emitted
only when the root is absent, which is what makes the waiver total. Splitting
presence from shape means the branch has to ask two questions instead of one.

`isClaudeCodeRequirement` (SERVER-123) is the precedent for how a finding under
these roots is tolerated on the write path while still failing `check`.

### Edge Cases

All three decided; the reasoning lives on `waivedAsAbsent` in
`apps/server/src/core/check.ts` and is summarised here.

**1. A field present but `null` → treated as absent, and waived.**

`key:` with nothing after it is YAML's ordinary spelling of "I have not filled
this in" — a template stub, a half-finished hand edit — and it carries exactly
the information the waiver exists to permit under these roots: *there is no
Corpus block here*. It also cannot mislead a reader the way a wrong value can:
every projection reader falls back for `null` to precisely what it falls back to
for a missing key (`asString`, `TagsSchema.safeParse`, `DocStatusSchema.safeParse`
in `projection/project-document.ts` all do), so the two are indistinguishable
downstream and reporting one but not the other would be a finding about a
keystroke rather than about the document. Note the decision has a *small* domain:
the fields where `null` is a legal value — `due`, `reviewed`, and a thread's
`parent` and `anchor` — never produce an issue at all, so it only ever touches
keys for which `null` and absent already mean the same thing.

**2. `anchors` → no special case; it follows the same present/absent rule as
every other field, asked of the top-level key.**

Presence is a question about *the key the author wrote down*, so a fault at any
depth beneath `anchors` is a fault in something present, and the issue's own
nested path (`anchors.anc_k4f7.prefix`) is reported verbatim. Two things fall out
and both are correct:

- The structural `anchor-malformed` rule already ran on the raw mapping *before*
  the validation gate and was never waived, so an `anchors` fault under these
  roots now produces two findings. That is not new behaviour invented here — it
  is exactly what the same bytes have always produced under `data/`, and it is
  what makes the roots stop being a special case. `check/routes.test.ts`'s
  pre-existing "still reports the same file's structural problems" was updated to
  say so.
- Only the structural one blocks a save. That is the pre-existing partition
  (`LOCAL_CHECK_CODES`), unchanged.

**3. A plugin type → nothing to decide; it was never in question.**

`DocTypeSchema` is an open `z.string().min(1)`, deliberately, because "a closed
enum here would make every plugin a contract change". So `type: not-a-real-type`
is a well-formed plugin type and is reported by **nothing**, here or under
`data/` — which means the issue's own headline example is 4 findings, not 5, and
the `type` line is the one field of the five that is not malformed at all.
`type: []`, `type: 3` and `type: ""` are reported, being not a non-empty string.
Nothing here narrows the open string, and nothing should: under these roots the
root's own `type` override (`agent-def`, `skill`) is what reaches the projection
regardless.

## Testing Strategy

Per-field tests over present-and-malformed, present-and-valid, and absent, under
each `.claude/` root. Falsify by restoring the total waiver and watching only the
present-and-malformed cases go green.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Hand-author the `bogus.md` above; `corpus doc check` reports each malformed
   field
3. Hand-author a profile with no Corpus block at all; `check` stays clean
4. Every write surface still succeeds on both (`doc edit`, `PUT`, archive, bulk)
5. Stop the server; confirm the port is free

## E2E Verification Log

Ran on **Opus 5 (1M context)**, 2026-08-18, branch `phase-34-loose-ends`.

### Files changed

- `apps/server/src/core/frontmatter.ts` — `FrontmatterIssue` gains `field`, the
  top-level key read off zod's structured path. Carried rather than recovered by
  splitting `path` on `.`: `path` is display text with a `<root>` sentinel, and
  re-deriving the key from it would be parsing a string whose grammar exists for
  a human.
- `apps/server/src/core/check.ts` — `waivedAsAbsent`, and the
  `claudeCodeRoot === null` branch becomes a per-issue filter instead of a
  whole-branch suppression.
- `apps/server/src/docs/write.ts` — `isClaudeCodeRequirement` →
  `isClaudeRootFrontmatter`, widened from "§7's profile requirement" to "any
  `frontmatter-invalid` under a root `claudeCodeRootFor` names".
- `apps/server/src/docs/update.ts` — the rename, in a doc reference only.
- Tests: `core/check.test.ts` (+34), `docs/write.test.ts` (+4),
  `check/routes.test.ts` (+3, and 1 updated).

### Blast radius — measured, not estimated

Workspace built at `/tmp/corpus124/ws`: `corpus init` (10 template files + 2
plugin skill files + 1 plugin seed template), then 20 notes, 6 anchored threads
and 2 agent-defs created through the CLI, then five hand-authored `.claude/`
files of the shapes people actually write.

**Zero newly-reported documents at 43 documents.** That number is the answer to
the objection, and it is worth being precise about *why* it is zero:

```
$ corpus doc check
checked 43 documents — no findings.
```

- The 6 `corpus init`-seeded `SKILL.md` files carry a **complete and valid**
  Corpus block already — so they were never at risk.
- The 2 server-created agent-defs are written from validated wire values.
- `.claude/agents/proofreader.md`, `.claude/agents/summarizer.md` (name +
  description + `model` + `tools`) and `.claude/skills/pdf-filler/SKILL.md`
  (name + description + `allowed-tools`) are Claude Code's own shapes. They
  carry **no Corpus keys at all**, so the waiver still covers them entirely.
  This is the structural reason the blast radius is small: Claude Code does not
  write Corpus's vocabulary, so the only files this can newly report are ones a
  human hand-wrote a Corpus key into.
- `.claude/skills/notes-helper/SKILL.md` carries a hand-written *correct* Corpus
  block (`title`, `tags: [helper, core]`, `status: open`, `evergreen: true`) —
  clean, which is the present-and-valid case at real scale.

Adding the two files that have a Corpus key **wrong** — the issue's own
`bogus.md`, plus `handwritten-tags/SKILL.md` carrying `tags: research, sources`
and `status: Open`, the two most likely real hand mistakes:

```
$ corpus doc check
error frontmatter-invalid .claude/agents/bogus.md: id: Invalid input: expected string, received number
error frontmatter-invalid .claude/agents/bogus.md: title: Invalid input: expected string, received array
error frontmatter-invalid .claude/agents/bogus.md: tags: Invalid input: expected array, received string
error frontmatter-invalid .claude/agents/bogus.md: status: Invalid option: expected one of "open"|"resolved"|"archived"
error frontmatter-invalid .claude/skills/handwritten-tags/SKILL.md: tags: Invalid input: expected array, received string
error frontmatter-invalid .claude/skills/handwritten-tags/SKILL.md: status: Invalid option: expected one of "open"|"resolved"|"archived"
corpus: 6 errors in 45 documents.
$ echo $?
6
```

**So: 2 documents of 45, and 6 findings.** Pre-fix, the same 45 documents
produced zero findings — verified by the falsification below. `type:
not-a-real-type` is deliberately absent from that list (edge case 3).

### Every write surface, on both file kinds

Real server, port **8794**, real workspace, real git. Never 8765 (the user's
live server, confirmed still listening under a different pid afterwards) and
never 5173.

| surface | `.claude/agents/bogus.md` (malformed block) | `.claude/agents/proofreader.md` (no block) | `.claude/skills/handwritten-tags/SKILL.md` |
| --- | --- | --- | --- |
| `corpus doc edit --file --key` | `edited` | `edited` | `edited` |
| `PUT /api/docs/{id}` (curl) | `HTTP 200 warnings=[]` | `HTTP 200 warnings=[]` | `HTTP 200 warnings=[]` |
| `corpus doc archive` / `unarchive` | both | both | both (folder move) |
| `POST /api/docs/bulk` archive ×3 | `changed`, `refused: []` | `changed` | `changed` |

The reporting channel fires on every one of those writes without refusing any:

```
{"level":"error","msg":"document saved with validation errors","path":".claude/agents/bogus.md",
 "errors":["frontmatter-invalid: title: Invalid input: expected string, received array",
           "frontmatter-invalid: tags: Invalid input: expected array, received string"]}
```

`corpus db doctor`: *projection is clean — 45 documents from 45 files (8ms)*.

**The repair is expressible, which is what makes an error the right severity
here.** Unlike SERVER-123's `description` — whose only repair was an `--extra`
flag the error text did not name and the board could not express — every finding
this rule raises is cleared by the ordinary verbs:

```
$ corpus doc edit doc_skillc1857f4f --add-tag sources      # rewrites `tags` as a list
$ corpus doc edit doc_agentdef65040d80 --title "Bogus"     # rewrites `title` as a string
$ corpus doc check
checked 45 documents — no findings.
```

Two of the four `bogus.md` findings were in fact repaired *by the E2E itself*:
the archive/unarchive round trip rewrote `status`, and the first save stamped
the synthetic `id`. That is the write path doing what it always does with the
fields it owns — and it is only reachable because the finding does not block.

Server stopped; `lsof -iTCP:8794` reports the port free.

### Falsification — twice, independently

**(a) Restore the total waiver** (`if (claudeCodeRoot !== null) continue;`) and
re-run the three suites: **34 tests fail, and every one of them is a
present-and-malformed case.** 27 are the 9 fields × 3 roots matrix; 3 are the
general cases (`type` not-a-string, nested `anchors`, the issue's `bogus.md`); 3
are the route tests; 1 is the write-path log assertion. **Zero**
present-and-valid tests and **zero** absent tests went red — which is what makes
the waiver's surviving half a claim the suite actually holds rather than one it
merely restates.

**(b) Narrow the write-path partition** back to `discoveredAs !== null` (i.e.
copy `isClaudeCodeRequirement` rather than widen it): **3 tests fail**, all of
them the non-blocking half under `.claude/skills*`, including "what a check
reports, a save still accepts" through the real route. That is the second
regression the issue warned about, and it is now pinned.

### Checks

- `VITEST_MAX_THREADS=4 vitest run apps/server/src` — **191 files, 4221 tests,
  all passing**. (One earlier run had `watcher/commit-out-of-band.test.ts` flake
  on `'skipped' vs 'committed'` under full-suite load; it passed alone and
  passes in the final full run. Unrelated to this change, which touches no git
  path.)
- `npm run lint` — exit 0. `npm run typecheck` — exit 0. `prettier --check` on
  every touched file — clean.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-124]` prefix
