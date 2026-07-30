# [AGENT-006] Comment skill: upgrade skill genesis from propose to create

## Domain

agent-runtime

## Status

todo

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

_Filled in by the implementing agent. State the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
