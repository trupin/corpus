# [SERVER-113] `GET /api/docs/{id}/diff`'s default base is a commit that touched a different document

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Related: SERVER-097 (the same defect in the edit acknowledgment, fixed there;
  this is its twin, found while fixing it and deliberately left alone)

## Spec References

- SPEC.md **§4** — commit windows gather a party's saves across documents
- SPEC.md **§9.2** — `GET /api/docs/{id}/diff`

## Summary

Found while fixing SERVER-097 and **left unfixed on purpose**: that issue says in
as many words *"do not widen this into changing what the diff serves"*, and this
field is served by that route.

`readDocDiff` computes its default `from` as `parentOf(to)` — the immediate
predecessor commit, whatever document that commit touched. §4's commit windows
gather a party's saves **across documents**, so the predecessor is routinely a
commit about something else entirely.

Measured live while SERVER-097 was being verified:

```
corpus doc diff doc_qy2xgecq  →  from: 4e1cd61
git show --name-only 4e1cd61  →  comment2.md      (a different document)
```

So the default diff of a document is computed against a base that has nothing to
do with it. The numbers are right — every read is path-scoped — but the **base is
a false claim about provenance**, which is exactly the wording SERVER-097 landed
on for the acknowledgment's version of this.

## Why it matters more now

SERVER-097 fixed the acknowledgment path with `previousCommitFor(git, sha, path)`
— parent, then `rev-list --max-count=1 <parent> -- <path>`. **The two paths now
disagree about the same document's base**: the event the agent receives says one
thing, and the route the agent calls to see the change says another. Before
SERVER-097 they were consistently wrong together, which is at least legible.

## Acceptance Criteria

- [x] The default `from` is the previous commit that **touched this document**,
      using the helper SERVER-097 already added rather than a second
      implementation
- [x] A document whose first commit is its only one diffs against the empty tree,
      as the acknowledgment path now does — "nothing before this touched it" is
      an honest base rather than an error
- [x] An explicit `--from-rev`/`--to-rev` is untouched: this is about the default
      alone
- [x] Reproduced before fixing, against a real workspace where a window gathered
      two documents, and the reproduction logged

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/diff.ts` — `readDocDiff`'s default base
- `apps/server/src/edit/diff.ts` — `previousCommitFor`, already exists, exported

### Notes

One line, now that the helper exists. The care is in the tests: a fixture whose
commits each touch one document cannot tell the two bases apart, so the
reproduction needs a window that genuinely gathered two.

## Testing Strategy

A repository where a commit between the document's two revisions touched only
another file; assert the default base skips it. Verify the test fails against
`parentOf`.

## E2E Verification Log

**Model: Opus 5 (1M context), as server-dev.** Real server started from source
(`corpus server start`, which spawns the server under tsx) on **port 8797**
(never 8765/5173), scratch workspace
`/Users/theophanerupin/.claude/jobs/s113/tmp/ws113` created by the real
`corpus init`, real CLI from source, real git. Nothing under
`/Users/theophanerupin/cos` was touched.

### Pre-fix reproduction (mandatory)

The window has to have gathered two documents, so the parties alternate:

1. `corpus doc create --title Estate` (user) → `ba06cfc`, touches `estate.md`
2. `corpus --from agent doc create --title Comment` (agent) → closes the user's
   window and opens its own: `059c0e9`, touches `comment.md` **only**
3. `corpus doc edit doc_umzwtlur --file … --key …` (user) → the newest commit
   touching `estate.md` (`6580908`, relabelled to `33970c5` when the read below
   closed its window)

```
$ git log --format='%h %an %s' -4
33970c5 user  editing session: 1 document by user     <- to
059c0e9 agent editing session: 1 document by agent    <- the base it chose
ba06cfc user  editing session: 1 document by user     <- the base it should choose
c4cb368 user  workspace: initialize corpus workspace by user
```

```
$ corpus doc diff doc_umzwtlur --json
{ "from": "059c0e961196a942c956eddcc18be30d6afc714c",
  "to":   "33970c54da295a3ccf08bb0a3724061e82c8b547",
  "stats": { "commits": 1, "insertions": 3, "deletions": 7 },
  "path": "data/docs/inbox/estate.md" }

$ git show --name-only 059c0e9   ->  data/docs/inbox/comment.md   (a different document, by the agent)
$ git show --name-only ba06cfc   ->  data/docs/inbox/estate.md
$ git log --format='%h %s' -- data/docs/inbox/estate.md  ->  33970c5, ba06cfc   (059c0e9 is not in it)
```

**The two paths disagreed about the same document's base**, which is the cost the
issue names. The `doc.edited` this same session emitted, read straight out of
`.corpus/queue/pending/`:

```json
{ "docId": "doc_umzwtlur", "actor": "user", "endedBy": "close",
  "from": "ba06cfcff3ac0e3e6c23fbd72631673580947a5b",
  "to":   "33970c54da295a3ccf08bb0a3724061e82c8b547",
  "stats": { "commits": 1, "insertions": 3, "deletions": 7 } }
```

Same document, same head, two different bases — the event's correct (SERVER-097),
the route's a neighbour's commit.

**Second symptom, the acceptance criteria's other half.** `doc_s76pqdj5` — the
agent's `Comment`, whose first commit is its only one — answered
`from: ba06cfc`, i.e. a commit that touched `estate.md` and at which
`comment.md` did not exist. A base predating the file, described as though the
file were in it.

The issue's diagnosis is **confirmed exactly**: `readDocDiff`'s default `from`
was `parentOf(to)`, branch order rather than this document's order, and §4's
party-scoped window makes those diverge routinely rather than occasionally.

### The fix

One line in `apps/server/src/edit/diff.ts`: the default base is
`previousCommitFor(git, to, path)` — SERVER-097's helper, already exported —
instead of `parentOf(git, to)`. No second implementation, and `?from=` is
untouched. The doc comment on `readDocDiff` was rewritten to say why.

### Post-fix E2E (server restarted, same workspace, same history)

```
$ corpus doc diff doc_umzwtlur --json
{ "from": "ba06cfc…", "to": "33970c5…", "stats": {"commits":1,"insertions":3,"deletions":7}, "totalChars": 493 }

$ corpus doc diff doc_umzwtlur --from-rev 059c0e9… --to-rev 33970c5… --json     # the old default, named explicitly
{ "from": "059c0e9…", "to": "33970c5…", "stats": {"commits":1,"insertions":3,"deletions":7}, "totalChars": 493 }
```

`cmp` of the two `diff` bodies: **byte-identical**. The numbers and the bytes do
not move — every commit skipped over left this file untouched and both readers
were already path-scoped — only the claim does.

Single-commit document, now the empty tree:

```
$ corpus doc diff doc_s76pqdj5 --json
{ "from": "4b825dc642cb6eb9a060e54bf8d69288fbee4904", "to": "059c0e9…", "stats": {"commits":1,"insertions":20,"deletions":0} }
```

and `cmp` against the same read with the old base (`--from-rev ba06cfc…`) is
byte-identical too — `new file mode 100644`, whole file added, either way.

**The two paths now agree.** A fresh round (agent creates `Ledger` → `7a3c78c`
touching `ledger.md` only; user edits `Estate` → `588cff1`), diff read first so
the window closes and the sha settles, then the session flushed:

```
diff route default : {"from":"33970c5…","to":"588cff1…","stats":{"commits":1,"insertions":2,"deletions":1}}
doc.edited event   : {"from":"33970c5…","to":"588cff1…","stats":{"commits":1,"insertions":2,"deletions":1}}
git show --name-only 7a3c78c (HEAD~1) -> data/docs/inbox/ledger.md   (skipped)
git show --name-only 33970c5 (HEAD~2) -> data/docs/inbox/estate.md   (chosen)
```

### Tests, and that they were red first

`apps/server/src/edit/routes.test.ts` (real workspace, real git, real app), three
added, the first two **verified red against the unfixed code** in exactly the
reproduction's shape:

- "defaults `from` to the previous commit that touched this document, skipping a
  neighbour's" — failed at `expect(body.from).not.toBe(interloper)` with the two
  shas equal. It also re-reads the same range from the *old* base and asserts the
  stats and the diff bytes are unchanged, so the test says what did **not** move.
- "defaults to git's empty tree when nothing before this document's only commit
  touched it" — failed with `ab6a950…` where `4b825dc…` was expected.
- "leaves an explicitly named base alone, however unrelated the commit it names"
  — green before *and* after, deliberately: it is the guard against widening this
  past the default.

Renamed one existing test ("…and its parent" → "…and the one before it"); its
assertion is unchanged and still passes, because in a single-document history the
parent *is* the previous commit that touched the file.

`apps/server/src/edit/` + `docs/provenance.test.ts`: 143 passed, 0 failed.
`tsc --noEmit -p apps/server` exit 0; eslint and prettier clean on both touched
files.

### Stale prose left for other domains (not fixed here)

Three places still describe the default as "the parent of `to`", and all three
are outside `apps/server`:

- `SPEC.md` §9.2 — "`to` defaults to the newest commit that touched the document
  and `from` to its parent". That rider was signed 2026-08-05, before §4's
  party-scoped window (2026-08-10) made the parent a different commit's
  document. Needs a spec amendment, i.e. user sign-off.
- `packages/contract/src/routes/doc-diff.ts` and
  `packages/contract/src/schemas/edit.ts` (`DocDiffQuerySchema.from`,
  `DocDiff.from`) — OpenAPI description text; `edit.ts:240` is *already* stale
  from SERVER-097 in the same way ("the parent of its first commit"). Contract
  domain, and editing it regenerates `openapi.json`.
- `apps/cli/src/commands/doc/diff.ts` (help text, two places) — CLI domain.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-113]` prefix
