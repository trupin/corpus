# [AGENT-006] Comment skill: upgrade skill genesis from propose to create

## Domain

agent-runtime

## Status

done

## Priority

P1

## Model

opus — the behaviour it describes now exists and is shipped; this is a bounded rewrite of one
documented section against a verb whose semantics are already pinned by CLI-011's E2E log.

## Dependencies

- Depends on: CLI-011 (`corpus skill create`), AGENT-003 (comment skill)
- Blocks: —

## Spec References

- SPEC.md §7 — skill genesis. The bullet signed off in the SHARED-002 set reads extend-plus-propose
  _"until `corpus skill create` ships (CLI-011), at which point the agent creates the skill
  directly."_ CLI-011 has now shipped, so the transitional clause is spent — flattening it is
  spec-writer work routed through SHARED-004 (sprint-015 Open Conflict 3), **not** part of this
  issue. This issue changes the skill, not the spec.
- issues/sprints/sprint-015.md — TEST-339 (this rider's charter), TEST-326–TEST-332 (the shipped
  behaviour the new text must match).

## Summary

Filed by CLI-011 (2026-07-30) as its third acceptance criterion. The comment skill's
**Skill genesis** section (`assets/workspace/claude/skills/comment/SKILL.md:312-337`) tells the
product agent that a genuinely new skill must be **proposed as a note in the inbox**, and gives a
concrete, now-false reason: _"Documents are created under `data/docs/` and nowhere else:
`corpus doc create` cannot write into `.claude/`, and `corpus doc move` cannot move a document
there."_ Both halves of that sentence are still true of `corpus doc …` — and both are now beside the
point, because `corpus skill create <name> --description "…"` exists and writes
`.claude/skills/<name>/SKILL.md` through the server's ordinary mutation pipeline (auto-commit,
projection, live without a restart).

Until this rider runs, §7 promises a behaviour the shipped skill text forbids.

## Acceptance Criteria

- [ ] The **Propose a genuinely new skill** bullet becomes a **create** bullet naming
      `corpus skill create <name> --description "<one line>" --from agent` with a heredoc body, and
      the false rationale about `data/docs/` is removed rather than left standing beside the new
      verb.
- [ ] **Extend-first stays the default.** A pattern that belongs to an installed skill is still an
      edit to that skill (`corpus doc edit <skillDocId> --from agent`); creation is for the case
      where nothing fits. Sprint-014's TEST-189 (creation-versus-extension scope) and TEST-210
      ("created **or** extended" carve-out) are superseded only in which verb the creation branch
      names — not in the rule that extension comes first.
- [ ] **The conflict rule is preserved verbatim in force**: a correction that contradicts an
      existing skill stays an **edit** to that skill. A new skill must never be the way the agent
      avoids amending one it disagrees with.
- [ ] The text states what the server owns, so the skill does not re-implement it: the name is
      lowercase letters, digits and single hyphens, at most 64 characters (`400` otherwise); an
      installed or archived name is a `409`; `--description` is required because Claude Code
      discovers a skill by `name` + `description`; both frontmatter vocabularies are written by the
      server, so a subsequent `corpus doc edit` must keep them intact.
- [ ] `corpus skill rollback <name>` is named as the way back from a bad genesis, and
      `corpus doc archive` as the way to disable a skill that stopped earning its place.
- [ ] `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/workspace-template.test.ts` is
      green with `CLI_COMMANDS_PENDING_CLI_006` still `[]` — every `corpus …` invocation the new
      text adds resolves against `docs/cli.md`, which it does because CLI-011 put both verbs there.
      **No allowlist entry is added**; permission arrives by the verb existing.
- [ ] The pinned assertion `expect(commentBody).not.toMatch(/corpus queue (?:complete|fail)/)`
      still holds (sprint-014 Adjudication 11: queue terminal state stays with orchestrate).

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/comment/SKILL.md` — the **Skill genesis** section only.
- `scripts/workspace-template.test.ts` — only if an assertion pins the propose-only wording.

### Key Implementation Details

The shipped verb, as verified in CLI-011's E2E log:

```
corpus skill create weekly-review --description "Run the weekly review over the corpus." --from agent <<'EOF'
# Weekly review

…instructions…
EOF
→ created doc_bispp4he — .claude/skills/weekly-review/SKILL.md
```

`--from agent` is required for the commit to be attributed to the agent (the CLI's default actor is
`user`). An omitted body pre-fills from the workspace's `skill` template when it has one.

### Edge Cases

- A name colliding with an **archived** skill is a `409` telling the caller to unarchive it — the
  skill text should say so, since "create it again" is the wrong recovery there.
- Creation is not the answer to a disagreement with an existing skill; see the conflict rule above.

## Testing Strategy

Template extractor (`scripts/workspace-template.test.ts`) plus a live `claude` session drill in a
real workspace: provoke a recurring pattern, confirm the agent creates the skill through the CLI,
that it appears in `corpus doc list --type skill`, and that the git commit is authored by `agent`.

## E2E Verification Log

**implemented on: fable** (the sprint runs AGENT-006 through this agent's session; the issue
file recommends opus — recorded per the record-actuals rule). The live `/orchestrate` drill
session ran on `claude-opus-5` (stream-json init record).

**Change.** `assets/workspace/claude/skills/comment/SKILL.md`, Skill genesis section only:
the propose bullet is now a create bullet naming
`corpus skill create <name> --description "<one line>" --from agent` with a `<<'EOF'` heredoc
example; the false `data/docs/`-only rationale is deleted; extend-first stays the first
bullet verbatim; the conflict rule stays verbatim; server-owned mechanics stated as outcomes
("do not pre-check them — know what comes back when one is violated": name grammar →
`400`, installed-or-archived name → `409` with unarchive as the archived-name recovery,
`--description` required for discovery, both frontmatter vocabularies server-written, later
`corpus doc edit` keeps both); ways back named (`corpus skill rollback <name>`,
`corpus doc archive`); the announce paragraph now covers created skills and the next-run
effect. Plus `scripts/workspace-template.test.ts` (genesis assertions replaced, one new
server-owned-facts test).

| Test | Result | Evidence |
| ---- | ------ | -------- |
| TEST-407 | PASS | Second bullet: "**Create a genuinely new skill when nothing installed fits** — `corpus skill create <name> --description "<one line>" --from agent` with a heredoc body". "Propose it as a note in the inbox" is gone entirely (test pins `not.toMatch(/Propose a genuinely new skill/i)`). One documented way. |
| TEST-408 | PASS | The "Documents are created under `data/docs/` and nowhere else…" sentence is deleted; test pins `not.toMatch(/cannot write into `\.claude\/`/i)`. |
| TEST-409 | PASS | First bullet unchanged: extend an installed skill via `corpus doc edit <skillDocId> --from agent`, including the comment skill itself; creation is the nothing-fits branch. |
| TEST-410 | PASS | Conflict rule verbatim: "A correction that contradicts an existing skill is an **edit to that skill**, never a second skill saying the opposite." Pinned by the surviving assertion. |
| TEST-411 | PASS | Stated as server outcomes, not pre-checks: "lowercase letters, digits and single hyphens, at most 64 characters (anything else is a `400`)"; "A name already installed **or archived** is a `409`"; "`--description` is required, not decoration: Claude Code discovers a skill by its `name` and `description`"; "**both** frontmatter vocabularies written by the server … a later `corpus doc edit` keeps both field sets intact". |
| TEST-412 | PASS | "for an archived skill that `409` means unarchive it — never create the same skill again under a different name." |
| TEST-413 | PASS | "`corpus skill rollback <name>` undoes a genesis that misbehaves, and `corpus doc archive` disables a skill that stopped earning its place." |
| TEST-414 | PASS | "**Announce it in the reply**, always, naming the skill you changed or created … a genesis is a real, immediate write into `.claude/` … takes effect on the **next** run of the loop, not in the session that is running." |
| TEST-415 | PASS | `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/workspace-template.test.ts` → **93 passed**; `CLI_COMMANDS_PENDING_CLI_006` still `[]`, no allowlist entry (CLI-011 documented both verbs in `docs/cli.md:1299-1395`); the `:323` pinned regex `not.toMatch(/corpus queue (?:complete|fail)/)` untouched and passing. |
| TEST-416 | PASS | Scratch `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s016-agent006-LsuxYL` (cwd outside the repo, `pwd` logged), `corpus init --port 9183`, server pid 6166. Live `claude -p "/orchestrate"` (pid 6455, transcript `…/transcript-agent006.stream.json`, tools `{Bash: 24, Skill: 1}`, zero Write/Edit). **Genesis branch**: standalone thread `th_fdws4f7g` ("third week in a row… codify it") → transcript shows `corpus skill create weekly-review --description "Run the workspace's weekly review: …"` (**1** real create; the other match is `skill create --help`; **0** `corpus doc create`); `corpus doc list --type skill` shows `doc_2o55qpkc  skill  open  Weekly review  .claude/skills/weekly-review/SKILL.md`; the file carries **both** vocabularies (`name`/`description` + `id`/`type: skill`/`title`/`tags`/`status`/`anchors`); `git log` → `agent skill create: weekly-review (doc_2o55qpkc) by agent`; the reply announces the codification, names `[[doc_2o55qpkc]]`, and even flags the no-scheduler gap honestly. **Extend branch**: thread `th_5ydbfgzz` ("lead with the number… about how you handle threads generally") → `corpus doc edit doc_skillcomment --file … --from agent` (a new "Lead with the number." bullet in Reply rules; frontmatter both-sets intact, `updated` advanced); **no second skill** (`.claude/skills/` still exactly 5 entries); `git log` → `agent doc edit: Comment (doc_skillcomment) by agent`; the reply states the extension-over-creation reasoning ("two skills on the same subject is how they start contradicting each other"). Queue ended `processed 2, failed 0`; workspace `git status --porcelain` empty (every mutation a server auto-commit). |

Cleanup: claude pid 6455 killed; server stopped (pid 6166); `lsof` 9183-9184 and 8765 →
nothing bound; `/Users/theophanerupin/code/corpus/.corpus` absent. Scratch retained with the
transcript for the evaluator.

## Completion Checklist (domain agent)

- [x] Tests written and passing (template suite 93/93)
- [x] `/lint` passes (prettier + eslint on the touched test file; skills are markdown)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
