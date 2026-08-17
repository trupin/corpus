# [CLI-050] `corpus doc create --type agent-def` lands in `.claude/agents/`

## Domain

cli

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SERVER-122
- Blocks: AGENT-034

## Spec References

- SPEC.md **§7** line 397 — `.claude/agents/*.md` as the agent-def document root
- SPEC.md **§11** line 539 — creating a subagent document makes it
  autocompletable with no separate registry

## Summary

`corpus doc create --type agent-def` writes to `data/docs/inbox/`. Measured
2026-08-17 against a real server:

```
$ corpus doc create --type agent-def --title "Researcher" --file body.md
created doc_5i25gnld — data/docs/inbox/researcher.md
```

SPEC says agent-defs live at `.claude/agents/*.md`, and the orchestrate skill
tells the agent the same. The document still *works* — which is why this
survived — but it lands in the user's inbox, gets a `data/` id rather than an
agent-def id, and splits one kind of artifact across two roots.

With SERVER-122 making the root creatable, route creation there.

## Acceptance Criteria

- [ ] `corpus doc create --type agent-def --title "X"` writes
      `.claude/agents/x.md` with no extra flag
- [ ] The reported path in both human and `--json` output is the real one
- [ ] The created document is immediately designatable and resolves as `@x`
- [ ] Creating **any other type** is completely unaffected — `note`, `view`,
      `template`, and plugin types keep today's inbox-first behaviour and
      today's `--folder` semantics
- [ ] `--folder` combined with `--type agent-def` is resolved deliberately:
      either refused with a message saying agent-defs have one root, or honoured
      within that root. Decide, implement, and say which in the help text —
      silently ignoring the flag is the one unacceptable outcome
- [ ] `--type skill` is decided the same way and stated, even if the decision is
      "unchanged, out of scope"
- [ ] Documents already misfiled under `data/docs/` keep working; this issue
      moves nothing

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/doc/create.ts` — the folder/root decision and the help
  text at lines 79–84

### Key Implementation Details

**Use the spelling SERVER-122 published.** That issue fixes how a caller names
the agent-def root and records it; consume that, and do not infer a path here.
The CLI writes nothing itself — it is a thin client over the generated client
(architecture decision 2) — so "routing" here means sending the right request,
never constructing a path.

The current help text says *"An omitted `--folder` files the document in
`data/docs/inbox/` (creation is inbox-first)"*. That sentence becomes false for
one type; amend it rather than adding a second sentence that contradicts it.

### Edge Cases

- A title that slugs to an existing agent-def stem
- A title that slugs to empty
- `--type agent-def` with `--pinned`/`--order`/`--query` and other flags that
  mean nothing in that root — refuse or ignore, but consistently with how the
  command already treats inapplicable flags

## Testing Strategy

Command tests against a stubbed client asserting the **request** carries the
agent-def root, plus tests that every other type's request is byte-identical to
today's. Falsify by reverting the routing and watching the agent-def test go red
while the others stay green.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. `corpus doc create --type agent-def --title "Analyst" --file body.md`
3. `find .claude/agents` shows `analyst.md`; nothing new in `data/docs/inbox/`
4. `corpus thread designate <th_…> --agent Analyst` succeeds
5. `corpus doc create --type note --title "Ordinary"` still lands in
   `data/docs/inbox/`
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

- [ ] Committed with `[CLI-050]` prefix
