# [SERVER-122] `.claude/agents/` is a legal create target

## Domain

server

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: CLI-050, AGENT-034

## Spec References

- SPEC.md **§7** line 397 — *"The projection and watcher cover
  `.claude/skills/**/SKILL.md` (as `type: skill`) and `.claude/agents/*.md` (as
  `type: agent-def`) as **additional document roots** alongside `data/`"*
- SPEC.md **§11** line 539 — *"Creating a new skill or subagent document
  instantly makes it autocompletable — there is no separate registry."*

## Summary

**The server refuses to create a document in the one root SPEC names for
agent-defs**, so the product's own agent is told to do something its only
interface forbids.

`assets/workspace/claude/skills/orchestrate/SKILL.md:1392` instructs the agent:
*"a new `type: agent-def` document is all it takes to make a persona addressable
as `@<name>`"*. Architecture decision 2 confines the agent to the CLI. And the
CLI's only creation path is refused, measured 2026-08-17 against a real server:

```
--folder ../../.claude/agents  → 400  folder escapes the document root
--folder .claude/agents        → 400  folder is not a location documents are indexed from
--folder agents                → 200  created data/docs/agents/summarizer.md
```

`--folder` is rooted at `data/docs/`, and nothing reaches the agent-def root.

**Why it went unnoticed:** a misfiled `type: agent-def` document under
`data/docs/` *works*. `GET /api/docs?type=agent-def` filters on frontmatter
`type`, never on path, so it appears in the designate menu and designates
cleanly. Verified end to end. The drift is invisible to every test because both
roots produce a working agent-def — they just get different id shapes
(`doc_5i25gnld` vs `doc_agentdef711f519a`) and one of them sits in the user's
inbox looking like a note.

## Acceptance Criteria

- [ ] A create naming the agent-def root succeeds and writes
      `.claude/agents/<stem>.md`
- [ ] The created document is projected as `type: agent-def`, is designatable by
      its invocable name, and resolves as `@<name>` — the same as a
      hand-authored one
- [ ] The id it receives is the one the agent-def root produces, not a `data/`
      id — one artifact, one id scheme
- [ ] The path-escape refusal is **unchanged** for everything else: `..`
      segments, absolute paths, and any root that is not a declared document
      root are still `400`
- [ ] `.claude/skills/` is considered and a decision recorded — a skill document
      has the same argument and is deliberately in or out of this issue's scope,
      never left ambiguous
- [ ] Documents already misfiled under `data/docs/` keep working exactly as they
      do today; nothing is moved by this issue

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/write.ts` — the create path's folder validation
- `apps/server/src/projection/roots.ts` — already declares the `agents` root
  (`key: "agents"`, `path: ".claude/agents"`); the create path must consult the
  same declaration rather than a second list
- `apps/server/src/watcher/paths.ts` — `classifyPath` is the existing authority

### Key Implementation Details

**One declaration, consulted twice — never a second list.** `roots.ts` already
knows every document root and which of them synthesize ids. The bug is that the
create path validates against `data/docs/` alone. Route the validation through
the existing root declaration so a root added later is creatable without a
second edit. A hand-maintained allowlist beside `roots.ts` would be exactly the
one-rule-in-two-places defect this phase exists to remove.

**Say how a caller names the root.** Whether that is a reserved `--folder`
value, the document's `type` implying its root, or a distinct field is yours to
decide — CLI-050 consumes whatever you choose, so **write the chosen spelling
into the issue's log and the route description**, because CLI-050 depends on it
and an undocumented scheme is a break waiting to happen.

**Frontmatter is waived in this root, not absent.** `isSkillFrontmatterException`
already waives §5's canonical block for paths whose root synthesizes ids. A
document created here must satisfy every *structural* rule while being allowed
Claude Code's `name`/`description` shape — a created agent-def that the check
path would then reject is the sprint-013 Adjudication 6 violation ("a document
the system accepts on write must not fail a check").

### Edge Cases

- **A name collision** with an existing `.claude/agents/<stem>.md`
- **A stem that is not a legal file name** — the same slug rules as any create
- **Writing into a root the watcher is watching** must not loop: the write
  auto-commits, the watcher re-projects, and that must settle
- **`.claude/agents/` missing** in an older workspace — created, or a clear
  refusal; not a 500

## Testing Strategy

Route tests for the accepted root, the refused escapes (unchanged), the id
scheme, and the frontmatter waiver. A projection test that a created agent-def
is immediately resolvable as a mention target. **Falsify by reverting the
validation change and watching the acceptance test go red** — and note that a
test asserting only "creation succeeded" would pass against a create that
misfiled to `data/docs/`, so assert the **path**.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Create an agent-def through the real HTTP route; `find .claude/agents` shows
   the file; `git log` shows the commit
3. `GET /api/docs?type=agent-def` reports it with the `.claude/agents/…` path
4. Designate it on a real standalone thread; the roster shows it
5. Confirm `--folder ../../x` and other escapes are still refused
6. Stop the server; confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-122]` prefix
