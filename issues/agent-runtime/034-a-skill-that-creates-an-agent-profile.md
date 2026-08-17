# [AGENT-034] A skill that creates an agent profile

## Domain

agent-runtime

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SERVER-122, CLI-050
- Blocks: —

## Spec References

- SPEC.md **§7** line 397 — `.claude/agents/*.md` as `type: agent-def`
- SPEC.md **§11** line 539 — *"Creating a new skill or subagent document
  instantly makes it autocompletable — there is no separate registry."*
- SPEC.md **§7** — the SHARED-048 rider: a profile is how a conversation gets an
  agent that behaves differently from the default

## Summary

Ship a product skill that creates an agent profile, so a person can ask for one
in conversation instead of hand-authoring YAML.

Requested by the user 2026-08-17, who will test it manually against the shipped
release. **It is in scope precisely because it is the part a user exercises
directly** — the CLI fix underneath it (CLI-050) is necessary and not
sufficient.

Today there is no skill for this. Three ship — `comment`, `converse`,
`orchestrate` — and while `orchestrate/SKILL.md:1392` tells the agent that *"a
new `type: agent-def` document is all it takes to make a persona addressable as
`@<name>`"*, nothing tells it how to write a good one, and until CLI-050 it
could not put one in the right place.

## Acceptance Criteria

- [ ] A new skill under `assets/workspace/claude/skills/<name>/SKILL.md`,
      installed by `corpus init`, that creates a `type: agent-def` document in
      `.claude/agents/`
- [ ] It is invocable the way the other product skills are, and its
      `description` says when to reach for it in terms a person would use
- [ ] It **gathers what it needs before writing**: what the agent is for, how it
      should behave, what it should avoid. Where the request is thin it asks
      with a form (§6) in one turn rather than interrogating across several, and
      where the request is already specific it does not ask at all
- [ ] The document it writes carries the frontmatter Claude Code needs (`name`,
      `description`) and is immediately resolvable as `@<name>` and designatable
      — verified in the drill, not assumed
- [ ] It reports what it created, where, and how to use it, in the reply
- [ ] **Refusals are honest**: a name that collides with an existing profile, a
      workspace whose root refuses the write, a blank request — each is said,
      not worked around
- [ ] It never edits an existing profile as a side effect of being asked for a
      new one
- [ ] **One rule, one skill**: it owns profile creation, and nothing about
      creating a profile is restated in `orchestrate` or `comment` beyond a
      pointer. `orchestrate/SKILL.md:1392`'s sentence is reconciled — it may
      keep the *fact* that a profile is a document while ceding the *procedure*
- [ ] `scripts/workspace-template.test.ts` covers the new skill: the manifest
      installs it, and the single-owner registry gains its mechanism vocabulary

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/<name>/SKILL.md` — the skill
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — cede the procedure,
  keep the pointer
- `apps/cli/src/template/manifest.ts` and the template manifest — install it
- `scripts/workspace-template.test.ts` — the pins

### Key Implementation Details

**Name it for what a person asks for.** The existing three are `comment`,
`converse`, `orchestrate` — verbs at the grain of the act. Choose in that
register and record why.

**What makes a good profile is the skill's real content.** A skill that only
runs `corpus doc create --type agent-def` is a wrapper around a CLI verb and
earns nothing. The value is in what it puts *in* the document: a persona that
is specific enough to change how the agent works and short enough to stay true.
Write that guidance, and give a worked example — checked against the prose,
since a worked example contradicting its own skill is a defect this repo has
shipped before (AGENT-026).

**Drill it against a real session.** Same rule as AGENT-033, and it matters more
here because the user will exercise this by hand: drive a real Claude Code
session that asks for a profile in ordinary words, and log what the session
actually produced — the file, its frontmatter, and whether designating it then
worked.

### Edge Cases

- A request for a profile that already exists — offer to open or revise it,
  never silently overwrite
- A request so vague there is nothing to write — ask, with a form
- A name that slugs to something already taken by a *skill* rather than an agent
- Being asked inside a thread that already has a resident — creating a profile
  and designating it are two acts; do not conflate them unless asked

## Testing Strategy

`scripts/workspace-template.test.ts` for installation and single-ownership. The
behavioural test is the drill.

## E2E Verification Plan

### Verification Steps

1. `corpus init` a throwaway workspace, port not 8765 / not 5173; start the
   real server
2. Confirm the skill was installed by `init` into `.claude/skills/`
3. Run a real Claude Code session in that workspace, ask for an agent profile in
   ordinary words, and let the skill run
4. `find .claude/agents` shows the created file; `cat` it and read the
   frontmatter and body
5. `corpus thread designate <th_…> --agent <name>` succeeds; `corpus agents`
   shows it
6. Ask again for the same name; confirm the collision is reported, not
   overwritten
7. Stop the server; confirm the port is free

## E2E Verification Log

_[Agent fills — include the created document verbatim and the drill's observed
behaviour]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-034]` prefix
