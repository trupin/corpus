# [CLI-011] `corpus skill create` (with server write path) + `corpus doc list`

## Domain

cli

## Status

done

## Priority

P1

## Model

opus — two verbs over write/read paths whose shapes exist; the skill-root write path is the only
new server surface.

## Dependencies

- Depends on: CLI-006, SERVER-019, SERVER-036 (sprint-015 Adjudication 15 — `issues/PLAN.md`'s
  stale `CLI-003` row was corrected; TEST-325 satisfied by that correction)
- Blocks: AGENT-006 (the genesis-charter rider this issue files)

## Spec References

- SPEC.md §7 — skill genesis ("recurring patterns become skills")
- issues/sprints/sprint-014.md — Open Conflicts 1 + 2, Adjudications 8 + 9 (2026-07-28)

## Summary

Filed from sprint-014 Open Conflicts 1 and 2. The comment skill's genesis charter is scoped to
extend-plus-propose this phase because a skill cannot be *created* through the system:
`normalizeDocFolder` forces every `doc create` under `data/docs/`, `doc move` refuses skills, and
no `corpus skill create` exists. Likewise "check the tree" has no CLI verb (filesystem reads are
the sanctioned interim per sprint-013 Adjudication 21 / sprint-014 Adjudication 9).

Ship: (a) a skill-creation write path (server: create a `type: skill` document under
`.claude/skills/<name>/SKILL.md` through the normal mutation pipeline — likely a contract rider
for the route) + `corpus skill create <name>`; (b) `corpus doc list` (paginated wrapper over
`GET /api/docs`, filters passthrough, `--json`). AGENT-003's genesis section upgrades from
propose to create when this lands (AGENT rider), and §7's wording is reconciled at that point.

## Acceptance Criteria

- [x] `corpus skill create <name>` creates a live skill through the server (auto-commit,
      projection, discoverable by the loop); contract rider if a new route is needed.
- [x] `corpus doc list` with the collection filters and `--json`; registry-validated; docs
      regenerated.
- [x] AGENT rider filed/executed to upgrade the genesis charter — filed as AGENT-006
      (`issues/agent-runtime/006-comment-skill-genesis-create.md`), in `issues/PLAN.md`; execution
      is an orchestrator call (sprint-015 Adjudication 10).

## E2E Verification Log

**implemented on: opus** (2026-07-30, cli-dev)

### What shipped

- `apps/cli/src/commands/skill/create.ts` — `corpus skill create <name>`, a thin `POST /api/skills`
  call. Required `--description`; optional `--title`, `--tags a,b`, and the shared body sources
  (`-m` / `--file` / heredoc via `resolveBody`, which uses `stdinCarriesABody`'s `fstat` probe, so
  the verb cannot hang on an agent harness's fd-0 socket — CLI-007's class). Prints
  `created <id> — <path>` with §14 warnings folded on; `--json` emits the server's `{doc, warnings}`
  envelope unchanged.
- `apps/cli/src/commands/doc/list.ts` — `corpus doc list`, a thin `GET /api/docs` call carrying the
  route's **entire** documented query grammar (19 flags), a padded columnar rendering, and a tally
  line that names the next `--offset`.
- Topic wiring + prose (`doc/index.ts`, `skill/index.ts`), `doc/fixtures.ts` gains a full `DocRow`
  fixture, both `hygiene.test.ts` inventories updated (`doc/list.ts` is write-restricted;
  `skill/create.ts` joins the module scan), `docs/cli.md` regenerated.

### TEST-324 — the dependency, audited before any code

Decisive and positive, against this working tree: `POST /api/skills` is defined at
`packages/contract/src/routes/skills.ts:65-115` with `SkillCreateRequestSchema`
(`packages/contract/src/schemas/skill.ts:86-115`, CONTRACT-020) and **implemented** by
`apps/server/src/skills/create.ts` + `apps/server/src/skills/routes.ts` (SERVER-036, in tree). The
CLI therefore consumes an existing route and writes nothing itself. `normalizeDocFolder`,
`resolveFolder` and `POST /api/docs` are untouched by this issue, and the verb does not go near
them: it posts a name, and the server derives `SKILLS_ROOT + <schema-validated name> + SKILL.md`.
Adjudication 13's sequence CONTRACT-020 → SERVER-036 → CLI-011 held; TEST-326–TEST-332 ran live
rather than being struck.

### Flag surface, and the three judgement calls in it

1. **`--description` is a required flag, not a second positional.** The contract makes it mandatory
   (`SkillCreateRequestSchema`), and `requireFlag` refuses before any request — exit 2, no HTTP.
   A positional would read as part of the name in the heredoc form, which is the form the agent
   actually types.
2. **No name pre-validation.** The pattern and the 64-character bound live in the contract and are
   enforced server-side; the CLI forwards the name byte for byte so `../evil` cannot be silently
   "helped" into `evil`. Refusals surface as the server's `400`/`409` → exit 5.
3. **`corpus doc list` passes the whole grammar through, but validates the *enumerated* flags
   locally** (`--status`, `--sort`, `--needs`, `--stale`, `--agent`, `--author`) against the
   contract's own constant arrays, exactly as `--from` does in `input.ts`: a misspelling is a usage
   error naming the alternatives, and no request is sent. Open-valued flags (`--type`, `--tag`,
   `--folder`, `--due`, ids) are forwarded verbatim, because the CLI does not know a workspace's
   plugin types, tags or folders. `--include-archived`, `--unread` and `--pinned` are booleans that
   select their true side only; the flag descriptions say so rather than implying a `false` side
   exists. The query type is pinned to the route's own generated type, so a contract rename breaks
   compilation instead of quietly dropping a filter.

**TEST-336 note.** `--json` emits the server's `{items, page}` envelope, not a bare array. `page` is
the only thing that tells a machine caller 137 matched and 2 were returned — dropping it to satisfy
the phrase "an empty array" would reintroduce exactly the silent truncation TEST-335 forbids. Empty
reads `{"items":[],"page":{"total":0,"limit":50,"offset":0}}`, exit 0.

### E2E — real server, real workspace, real git

Scratch `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s015-cli011-6KfL0r`, created outside the
repository with the subshell-`cd` form; server on **9186** (pid 79136), stopped by pid. `8765` was
never bound, never probed (every init passed `--port`), never killed. The built CLI
(`apps/cli/dist/bin/corpus.js`) was used throughout.

```
$ ( cd "$WS" && corpus init --port 9186 )       # cwd printed: the scratch dir, not the repo
Initialized Corpus workspace at …/s015-cli011-6KfL0r
$ corpus server start   → listening on http://127.0.0.1:9186 (pid 79136)
```

**TEST-333/334/337 — `corpus doc list` on a fresh workspace** (seed views, the note template, and
the four installed skills; `inbox/`, `templates/`, `views/` all present on disk, `inbox/` empty by
design):

```
doc_skillcomment      skill     open  Comment        .claude/skills/comment/SKILL.md
doc_skillorchestrate  skill     open  Orchestrate    .claude/skills/orchestrate/SKILL.md
doc_seedattention     view      open  Attention      data/docs/views/attention.md
doc_seedinbox         view      open  Inbox          data/docs/views/inbox.md
doc_seedopenthreads   view      open  Open threads   data/docs/views/open-threads.md
doc_seedtemplatenote  template  open  Note template  data/docs/templates/note.md
doc_skill138ec106     skill     open  fixture-notes  .claude/skills/fixture-notes/SKILL.md
doc_skill61c2325d     skill     open  todos          .claude/skills/todos/SKILL.md
showing 1–8 of 8 documents
```

Filters, live: `--type skill` → the four skills; `--folder views` → the three views;
`--status archived` → `no documents match.`; `--needs me` → `no documents match.`; `--pinned` → the
three pinned views; `--type thread --unread` → empty, exit 0; `--status closed` →
`corpus: --status must be one of: open, resolved, archived — got "closed".`, **exit 2, no request**.

**TEST-335 — pagination is honest:**

```
$ corpus doc list --limit 2
doc_hwy7rjjn  skill  open  triage         .claude/skills/triage/SKILL.md
doc_bispp4he  skill  open  weekly-review  .claude/skills/weekly-review/SKILL.md
showing 1–2 of 10 documents — next page: --offset 2
$ corpus doc list --limit 2 --offset 2
… showing 3–4 of 10 documents — next page: --offset 4
```

**TEST-326/327/328 — a skill created through the CLI, on disk, in git, projected live:**

```
$ corpus skill create weekly-review --description "Run the weekly review over the corpus." --from agent <<'EOF'
# Weekly review

Survey `corpus doc list --needs me` and file what has drifted.
EOF
created doc_bispp4he — .claude/skills/weekly-review/SKILL.md

$ cat .claude/skills/weekly-review/SKILL.md
---
name: weekly-review
description: Run the weekly review over the corpus.
id: doc_bispp4he
type: skill
title: weekly-review
created: 2026-07-30T14:20:04Z
updated: 2026-07-30T14:20:04Z
tags: []
status: open
anchors: {}
---
# Weekly review

Survey `corpus doc list --needs me` and file what has drifted.

$ git log -1 --format='%H %an <%ae> :: %s'
7389451… agent <agent@corpus.local> :: skill create: weekly-review (doc_bispp4he) by agent
$ git show --name-only --format= HEAD   → .claude/skills/weekly-review/SKILL.md

$ corpus doc list --type skill          → doc_bispp4he … weekly-review (no restart)
```

The id is the server-minted `doc_bispp4he`, per the orchestrator's 2026-07-30 correction to
TEST-328 and SERVER-036's rationale (a path-derived id would change on archive); the synthetic
`doc_skill<hex>` remains for hand-written files, visible above on the four pre-installed skills.

**TEST-329/332 — refusals; every one leaves the workspace byte-identical**
(`git status --porcelain` empty, HEAD unmoved, `.claude/skills/` unchanged):

| command | result |
| --- | --- |
| `skill create triage` (no `--description`) | exit **2**, `--description is required.` — no request sent |
| `skill create weekly-review --description "Dup."` | exit **5**, `409 conflict: a skill named \`weekly-review\` is already installed …` |
| `skill create comment --description "Dup."` | exit **5**, `409` — shipped skill's name |
| `skill create ../evil`, `a/b`, `Weekly`, `""` | exit **5**, `400 bad_request`, `json.name`, `must match pattern /^[a-z0-9]+(?:-[a-z0-9]+)*$/` |
| 65-character name | exit **5**, `400`, `Too big: expected string to have <=64 characters` |
| `skill create triage` after archiving `triage` | exit **5**, `409 … belongs to an archived skill … unarchive it to bring it back` |

**TEST-330 — the validator:** `corpus doc check` → `checked 10 documents — no findings.` exit 0.

**TEST-331 — rollback composes with create:**

```
$ corpus doc edit doc_bispp4he --from agent -m "…edited…"
$ corpus skill rollback weekly-review --from agent
restored .claude/skills/weekly-review/SKILL.md in commit 282eb97… (doc_bispp4he)
282eb97 agent :: skill rollback: weekly-review (doc_bispp4he) to 7389451 by agent
8a37253 agent :: doc edit: weekly-review (doc_bispp4he) by agent
a0fe0e2 agent :: skill create: triage (doc_hwy7rjjn) by agent
```

`--json` create (no body → template pre-fill; the workspace has no `skill` template, so the body is
empty as §11 prescribes):
`{"doc":{"frontmatter":{"id":"doc_hwy7rjjn","type":"skill",…,"extra":{"name":"triage","description":"Triage the inbox."}},"body":"","path":".claude/skills/triage/SKILL.md",…},"warnings":[]}`.
Claude Code's two keys land in `extra` because the server never interprets them — noted, not a CLI
concern.

### TEST-338 — the §7 consequence, recorded and routed, SPEC.md untouched

`git diff SPEC.md` from this agent is **empty** (the file's modification in the working tree predates
this session and belongs to another issue). §7's genesis bullet reads extend-plus-propose _"until
`corpus skill create` ships (CLI-011), at which point the agent creates the skill directly."_ That
clause is now **spent**: the verb ships in this commit. The replacement wording is a flattening —
the agent extends an existing skill when one fits and creates a new one when none does, with
`corpus skill rollback` as the way back. Routed to **SHARED-004** per sprint-015 Open Conflict 3
(spec-writer authored, user signed off, applied by the orchestrator). Nothing in §7 is false today;
it reads as a roadmap for something already shipped.

### TEST-339 — the AGENT rider, filed with content

`issues/agent-runtime/006-comment-skill-genesis-create.md`, added to `issues/PLAN.md`'s phase-5
table. It names the section (`assets/workspace/claude/skills/comment/SKILL.md:312-337`), quotes the
now-false rationale it must delete, supersedes sprint-014's TEST-189/TEST-210 on which verb the
creation branch names (not on extend-first), preserves the conflict rule that a correction
contradicting an existing skill stays an edit, and pins the template-extractor and
`not.toMatch(/corpus queue (?:complete|fail)/)` constraints. Executing it is an orchestrator call —
agent-runtime is not in this batch (Adjudication 10).

### Tests

`VITEST_MAX_THREADS=4 vitest run apps/cli/src/commands/doc apps/cli/src/commands/skill apps/cli/src/commands/hygiene.test.ts`
→ **137 passed** (24 new for `doc list`, 18 for `skill create`). One workspace-scoped run at the
end: `VITEST_MAX_THREADS=4 npm test -w apps/cli` → **762 passed, 64 files**, which includes
`docs/generate.test.ts`'s "matches the committed docs/cli.md" and both hygiene inventories.
`VITEST_MAX_THREADS=4 vitest run scripts/workspace-template.test.ts` → **91 passed** (TEST-340),
`CLI_COMMANDS_PENDING_CLI_006` still `[]`, no allowlist entry added.
`npm run typecheck -w apps/cli` → exit 0. `eslint` over both topics → 0 problems, no rule disabled.
`prettier --check` clean, including the regenerated `docs/cli.md`.

**One test deliberately inverted** (Adjudication 11, nothing deleted): `skill/rollback.test.ts`'s
_"is the topic's only verb"_ became _"is reachable as `corpus skill rollback`, beside the genesis
verb"_ and now pins `["create", "rollback"]` exhaustively, with a comment naming CLI-011 — a third
verb still has to justify itself there. The two `hygiene.test.ts` inventories gained the two new
modules, which is the mechanism working as designed rather than a relaxation.

### TEST-341 — docs, and the drift check that cannot be green yet

`npm run docs:cli -w apps/cli` regenerated `docs/cli.md`; `corpus doc list` and
`corpus skill create` have full entries, `prettier --check docs/cli.md` is clean, and
`docs/generate.test.ts` is green. `./node_modules/.bin/tsx scripts/check-generated-artifacts.ts` is
**red**, verbatim:

```
✗ API contract is stale: packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts
✗ CLI reference is stale: docs/cli.md
 docs/cli.md | 161 +++++++++++++++++++++++++++++++++++++++++++++++++++++++-----
```

Reason: the check requires `git diff --stat HEAD --` over the artifacts to be empty, and every
artifact in this wave — CONTRACT-020/021's regenerated openapi + client, and this issue's
`docs/cli.md` — is uncommitted, which an implementing agent cannot change. The orchestrator's
post-commit run is authoritative (accepted pattern since CONTRACT-008).

### Repository and machine hygiene (TEST-368/369/370)

No state-changing git command was run against this repository by this agent (`git status`,
`git diff`, `git log`/`show` inside the scratch workspace only). `git status --porcelain` shows only
source edits; my own are confined to `apps/cli/**`, `docs/cli.md`, this log,
`issues/agent-runtime/006-…` and one `issues/PLAN.md` row. `/Users/theophanerupin/code/corpus/.corpus`
absent, verified after every drill. `lsof -nP -iTCP:9186 -sTCP:LISTEN` → free; server stopped by pid
79136; no orphaned vitest workers. Whatever is on `8765` is exactly as it was.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier + tsc, scoped to `apps/cli`)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
