# [CLI-017] `corpus doc unarchive`: the agent's promised recovery path doesn't exist

## Domain
cli

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CLI-003
- Blocks: —

## Spec References
- SPEC.md §7 — agent is CLI-only; skill genesis (409 on archived names, "unarchive it to bring it back")

## Summary
Sprint-016 evaluator MAJOR finding (AGENT-P5W2-eval.md, 2026-07-30): the comment skill
and the server's own 409 message tell the agent to "unarchive" an archived skill, but
`corpus doc unarchive` does not exist, and the near-miss `corpus doc edit --status
open` reports success while producing a half-state: frontmatter flips to open but the
folder stays in `.claude/skills-archived/` and the name stays 409-blocked. The
unarchive route exists over HTTP (`POST /api/docs/{id}/unarchive`) — the CLI-only agent
just can't reach it. Two fixes, both in scope: (a) add the thin `corpus doc unarchive
<id>` verb; (b) decide what `doc edit --status open` on an archived doc should do —
refuse with a pointer to the unarchive verb (recommended: the half-state is a lie) or
perform the full unarchive. Regenerate docs/cli.md.

## Acceptance Criteria
- [x] `corpus doc unarchive <id>` round-trips the HTTP route; archived skill → installed path restored, name freed (409 gone)
- [x] `doc edit --status open` on an archived doc no longer produces the half-state (refusal naming the verb, or full unarchive — decide and justify)
- [x] docs/cli.md + hygiene inventories updated; the comment skill's "unarchive it" instruction becomes executable verbatim
- [x] E2E: archive → 409 on create → unarchive via CLI → create of the same name refused-as-installed / rollback works

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/doc/unarchive.ts` (+ test), doc index wiring, edit.ts guard, docs/cli.md

## Testing Strategy
apps/cli scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real server + scratch workspace (job tmp dir, init from outside the repo, ports 9180-9199, never 8765): the archived-skill recovery cycle end to end.

## E2E Verification Log

**implemented on: opus** (2026-07-30). Workspace `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-cli017-WpOoSH`,
server on **9190**, every command run with cwd **outside** this repository. `8765` never bound,
never proxied (no dev server started for this issue).

### What shipped

- `apps/cli/src/commands/doc/unarchive.ts` — a thin round trip onto the shipped
  `POST /api/docs/{id}/unarchive`, mirroring `archive.ts`: read the status first (so the line can
  tell a real unarchive from a no-op), `POST`, emit the server's response verbatim.
- `apps/cli/src/commands/doc/edit.ts` — `assertNotArchived`: `--status` on an **archived** document
  refuses unless the new status is `archived`, naming `corpus doc unarchive <id>` in the hint
  (Adjudication 13). The read it needs shares one `GET` with `--add-tag` (`currentDocument`), so
  naming both flags is still one extra request and naming neither is still none.
- `doc/index.ts` (verb wiring + topic prose), both `hygiene.test.ts` inventories, and the comment
  skill's genesis sentence (one clause, TEST-540). `docs/cli.md` regenerated on the merged tree.

### TEST-538 · the verb exists and round-trips the shipped route

```
$ corpus doc unarchive doc_vcmyq4om --from agent
unarchived doc_vcmyq4om                                     # exit 0
$ corpus doc unarchive doc_vcmyq4om --from agent --json | …
keys: ['doc', 'warnings'] | status: open | warnings: []     # same shape `doc archive` emits
$ corpus doc show doc_vcmyq4om --json | …
status: open | path: .claude/skills/weekly-review/SKILL.md
```

### TEST-542 · the half-state, reproduced pre-fix and refused post-fix

Pre-fix binary: `apps/cli/dist/bin/corpus.js` **as built before the `edit.ts` change**
(`/usr/bin/grep -c unarchive apps/cli/dist/commands/doc/edit.js` → `0`).

```
$ node dist/bin/corpus.js doc edit doc_vcmyq4om --status open --from agent
edited doc_vcmyq4om                                          # exit 0 — reports success
$ /usr/bin/grep -n '^status:' .claude/skills-archived/weekly-review/SKILL.md
10:status: open                                              # frontmatter says open …
$ ls .claude/skills-archived/ ; ls .claude/skills/
weekly-review                                                # … while the folder is still archived
comment  fixture-notes  orchestrate  todos                   # (not installed — the skill stays disabled)
$ corpus skill create weekly-review …
corpus: 409 conflict: the name `weekly-review` belongs to an archived skill … — unarchive it …
$ git log --oneline -1
72745a5 doc edit: weekly-review (doc_vcmyq4om) by agent      # and it committed the lie
```

Worse than the evaluator recorded: `corpus doc show` reported `archived` (the projection derives it
from the archived root) while the **file** said `open` — the two representations disagreed.

Post-fix (rebuilt CLI), TEST-541 and TEST-542:

```
$ corpus doc edit doc_vcmyq4om --status open --from agent
corpus: doc_vcmyq4om is archived; `--status open` would set the frontmatter without bringing the document back.
  Run `corpus doc unarchive doc_vcmyq4om` — it restores the status and, for a skill, moves its folder
  back out of `.claude/skills-archived/` and frees the name.
exit=2
$ corpus doc edit doc_vcmyq4om --status resolved --from agent      # the other way to reach it
corpus: doc_vcmyq4om is archived; `--status resolved` would …      exit=2
$ git log --oneline -1 ; git status --porcelain
8640e19 doc edit: weekly-review (doc_vcmyq4om) by agent            # no new commit
                                                                   # working tree clean
```

The guard covers **every** CLI way to set `status` on an archived document: `doc edit --status` is
the only one, and it refuses before the body, the title or anything else is sent (unit test
"refuses before sending a body, so no half-state is reachable by pairing the flags").

### TEST-539 · the folder moves back and the name is freed

```
$ corpus doc unarchive doc_vcmyq4om --from agent
unarchived doc_vcmyq4om
$ ls .claude/skills/ ; ls .claude/skills-archived/
comment  fixture-notes  orchestrate  todos  weekly-review          # back
(empty)
$ git show --stat --oneline HEAD
5198d9f doc unarchive: weekly-review (doc_vcmyq4om) by agent
 .claude/{skills-archived => skills}/weekly-review/SKILL.md | 2 +-
$ corpus skill create weekly-review --description "x" --from agent -m "again"
corpus: 409 conflict: a skill named `weekly-review` is already installed (.claude/skills/weekly-review
exists) — edit it with `PUT /api/docs/{id}` or choose another name         exit=5
```

The `409` changed from *archived-name* to *already-installed*: the name is genuinely free again.
One commit, carrying the rename (the server's coalescing window amended the immediately preceding
commit — shipped auto-commit behaviour, visible in `git reflog`, not introduced here).

### TEST-543 · nothing else about `--status` changes

Unit-covered for all three statuses on a non-archived document (`--status open|resolved|archived`
each send exactly `{status}` and print `edited …`), plus re-archiving an **archived** document,
which still goes through. Live: `corpus doc edit doc_vcmyq4om --status archived --from agent` →
`edited doc_vcmyq4om`, file flips back to `status: archived`.

### TEST-544 · edges

```
(a) not archived      $ corpus doc unarchive doc_vcmyq4om --from agent
                      doc_vcmyq4om is not archived                    exit=0, no commit, tree clean
    twice in a row    doc_vcmyq4om is not archived                    exit=0  (the concurrent case)
(b) unknown id        $ corpus doc unarchive doc_nope --from agent
                      corpus: 404 not_found: no document with id doc_nope        exit=5
                      $ corpus doc archive  doc_nope --from agent
                      corpus: 404 not_found: no document with id doc_nope        exit=5   ← identical
```

(a) matches `doc archive`'s treatment of an already-archived document exactly: report it, exit 0,
write nothing. One asymmetry is **documented in the help rather than invented away**: the route sets
`status: open` rather than restoring a remembered status, so unarchiving a `resolved` document does
change it — the CLI says `… was not archived — status is now open` instead of claiming a no-op.

### TEST-545 · destination collision surfaces, with the message intact

```
$ mkdir -p .claude/skills/weekly-review && echo placeholder > .claude/skills/weekly-review/NOTES.md
$ corpus doc unarchive doc_vcmyq4om --from agent
corpus: 400 bad_request: the archive destination already exists
  [ { "path": "id",
      "message": ".claude/skills/weekly-review already exists; move or remove it first" } ]
exit=5
$ rm -rf .claude/skills/weekly-review && corpus doc unarchive doc_vcmyq4om --from agent
unarchived doc_vcmyq4om                                                            exit=0
```

**Contract correction:** TEST-545 calls this a `409`; the shipped guard raises **400**
(`validationError` → `bad_request`), which `apps/server/src/docs/archive.ts:105-109` records as a
deliberate sprint-005 ruling ("400, since this route declares no 409"). The CLI surfaces it with the
message and the issue list intact, non-zero exit, no stack trace — which is what the criterion is
about.

### TEST-540 · the instruction is executable verbatim

```
$ /usr/bin/grep -rn 'unarchive' assets/workspace apps/server/src/skills docs/cli.md
assets/workspace/claude/skills/comment/SKILL.md:345:  archived skill that `409` means unarchive it with `corpus doc unarchive <id>` — never
apps/server/src/skills/create.ts:116:  "unarchive it to bring it back, or choose another name; …"
docs/cli.md:30,260,430,449,629,636,650,656  (TOC, topic summary, edit prose, --status flag, and the
                                             `corpus doc unarchive` section with both examples)
```

The skill now names the verb (one clause — the "a word" allowance of TEST-547). The server's `409`
text is unchanged (`git diff apps/server` empty): it says "unarchive it", and the command that does
that now exists and is documented, so an agent following it word for word succeeds.
`scripts/workspace-template.test.ts` is green with `CLI_COMMANDS_PENDING_CLI_006` still `[]`, which
is what grants the skill permission to name the verb.

### TEST-546 · docs and inventories

`npm run docs:cli -w apps/cli` regenerated `docs/cli.md` on the merged tree (Adjudication 20 — the
same regeneration carries CLI-016's `--extra` and the todos plugin's `migrate` verb);
`apps/cli/src/docs/generate.test.ts`'s committed-file assertion and
`npx prettier --check docs/cli.md` both pass. `doc/unarchive.ts` added to **both** pinned
inventories in `hygiene.test.ts`.

### TEST-547 · blast radius

`git status --porcelain`: `apps/cli/**`, `docs/cli.md`, one clause in
`assets/workspace/claude/skills/comment/SKILL.md`. `git diff packages/contract`, `git diff apps/server`,
`git diff SPEC.md` — **empty** for this issue (the `apps/server` and `plugins/` entries in the
branch's `git status` are other agents' landed work, not this session's).

### Checks

`npm run build -w apps/cli`, `npm run typecheck -w apps/cli`, `npx eslint apps/cli`,
`npx prettier --check` — all clean. `VITEST_MAX_THREADS=4 npm test -w apps/cli` → **831 passed / 66
files**. Server on 9190 stopped by recorded pid (81969); `lsof -nP -iTCP:9190` empty;
`ls -d /Users/theophanerupin/code/corpus/.corpus` → "No such file or directory".

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix

## Audit fix round (wave-3, 2026-07-30 — opus)

Findings from `issues/evals/AUDIT-S017-wave3.md` closed here: **FIX 11**, **FIX 15**, **TEST 22**,
**TEST 26**, **CLEAN 49**, **CLEAN 54**.

**CLEAN 49 / FIX 11.** `archive.ts` and `unarchive.ts` were the same twenty lines with two words
changed, and the drift that invites is exactly what the audit found: the "already there?" read was
decorative in one and destructive in the other. Both now sit on
`doc/archive-toggle.ts#runArchiveToggle` (added to both `hygiene.test.ts` inventories). The toggle
**sends nothing** when the document is already where the verb would put it, which is FIX 11 — the
route sets `status: open` unconditionally, so the old unconditional `POST` silently reopened a
`resolved` document while the output line called the run a no-op.

**Deviation, deliberate: "settled" is status *and* folder, not status alone.** A plain
`!wasArchived` skip would have given up the only CLI repair for a skill whose folder and status
disagree — the server plans the folder move off the *path*, not the status. `isSettled` therefore
also asks, for a `type: skill` document, which side of `.claude/skills-archived/` the wire `path` is
on. Proven live below: a status-only skip would have printed "is already archived" and left an
archived skill enabled and discoverable by Claude Code.

**FIX 15 — took the audit's second branch, not the first.** The brief preferred narrowing
`assertNotArchived` to `type: "skill"`. **SERVER-039 landed in the same round and refuses the same
`PUT` for every type** (`apps/server/src/docs/update.ts#assertNotUnarchivingByPut`), so narrowing
would have traded a local exit 2 naming `corpus doc unarchive <id>` for a server 400 naming
`POST /api/docs/{id}/unarchive` — a route the CLI-only agent cannot issue, against TEST-540's whole
point. So the guard stays universal and the *message* became honest per type, which is the audit's
own stated alternative: a skill hears about its folder, every other type hears that un-archiving is
its own operation. The guard is now explicitly documented as the better error rather than the
enforcement — the same relationship `assertWritableExtraKey` has with `ExtraFrontmatterSchema`.
**The choice is also the robust one if SERVER-039 were ever reverted**, which narrowing would not
have been.

### E2E Verification Log (fix round)

Real server on `9190`, workspace `.../jobs/4dd0ddef/tmp/audit3-cli/ws1`, `corpus init` run from
outside the repo, binary rebuilt (`npm run build -w apps/cli`) between the code change and these
runs.

FIX 15 — the two messages, from the one binary:

```
$ corpus doc edit doc_laegx37j --status open --from agent          # archived NOTE
corpus: doc_laegx37j is archived; `--status open` writes the frontmatter and nothing else, which
        is not how a document comes back.
  Run `corpus doc unarchive doc_laegx37j` — the operation that un-archives a document. The server
  refuses this write too (SERVER-039); refusing it here is what lets the message name a command
  instead of a route.
exit=2                          # no "skill", no ".claude/skills-archived/" anywhere in it

$ corpus doc edit doc_w2av4hmv --status open --from agent          # archived SKILL
corpus: doc_w2av4hmv is an archived skill; `--status open` would set the frontmatter without
        bringing the skill back.
  Run `corpus doc unarchive doc_w2av4hmv` — it restores the status *and* moves the folder back out
  of `.claude/skills-archived/`, which re-enables the skill and frees its name.
exit=2
```

FIX 11, beside the proof that the route really would have reopened it:

```
$ corpus doc edit doc_2cwqmfbh --status resolved --from agent   → edited doc_2cwqmfbh
$ corpus doc unarchive doc_2cwqmfbh --from agent --json
{"doc":{…"status":"resolved"…},"warnings":[]}            exit=0
  status afterwards : resolved      (unchanged)
  new commit        : NO

# the same route, reached by hand, on an identically-prepared document:
$ curl -XPOST -H "authorization: Bearer …" …/api/docs/doc_zrjrujrh/unarchive
  status after raw POST : open      ← what this verb used to do to it
```

The folder half of `isSettled`, in the direction where it is load-bearing (status says `archived`,
folder never moved — reachable by a hand edit or a merge):

```
  wire status: archived | wire path: .claude/skills/weekly-review/SKILL.md
$ corpus doc archive doc_w2av4hmv --from agent
archived doc_w2av4hmv
  .claude/skills/          : comment fixture-notes orchestrate todos
  .claude/skills-archived/ : weekly-review      ← the repair a status-only skip would have skipped
```

Settled cases send nothing, and `--json` is one shape either way:

```
$ corpus doc unarchive doc_w2av4hmv --from agent    (already open)   → "is not archived",      exit 0, no commit
$ corpus doc archive   doc_w2av4hmv --from agent    (fully archived) → "is already archived",  exit 0, no commit
$ corpus doc archive   doc_w2av4hmv --json                            → keys: doc,warnings
```

**CLEAN 54** — the status read is now documented as the same accepted read-then-write race as the
tag merge, and the stdin-drain order turned out cheap to fix rather than document: `runDocEdit`
parses every pure flag *before* `resolveBody`, so a usage error no longer swallows the caller's
heredoc.

```
$ corpus doc edit doc_seedattention --extra title=Nope --from agent  (heredoc body piped in)
corpus: `title` is a core frontmatter key, not an `extra` key — `--extra title=…` is refused.
  Use `--title` instead.                                             exit=2
```

Pinned in `edit.test.ts` with `unreadable()` — a stdin that rejects on first read, so "this verb
drained a body it never needed" fails as an assertion rather than as silently lost data.

**TEST 22 / TEST 26.** `doc/fixtures.ts` gained `SKILL` and `ARCHIVED_SKILL` (a real skill, with the
folder that makes the story true); the archived-guard tests use them instead of notes. `unarchive`
now covers the `423` edit-lock (one attempt, exit 5, never retried) and both directions of the
read-then-post window, including the one that has to fail safe.

### Checks (fix round)

`npm run build`, `npx tsc --noEmit -p apps/cli/tsconfig.json`, `npx eslint apps/cli/src`,
`npx prettier --check` — all clean. `VITEST_MAX_THREADS=4 npm test -w apps/cli` → **869 passed / 66
files** (was 831). `docs/cli.md` regenerated; `apps/cli/src/docs/generate.test.ts` green. Server
stopped by recorded pid 54636; 9190–9195 and 8765 all free; no workspace under the repo.
