# [CLI-050] `corpus doc create --type agent-def` lands in `.claude/agents/`

## Domain

cli

## Status

done

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

- [x] `corpus doc create --type agent-def --title "X"` writes
      `.claude/agents/x.md` with no extra flag
- [x] The reported path in both human and `--json` output is the real one
- [x] The created document is immediately designatable and resolves as `@x`
- [x] Creating **any other type** is completely unaffected — `note`, `view`,
      `template`, and plugin types keep today's inbox-first behaviour and
      today's `--folder` semantics
- [x] `--folder` combined with `--type agent-def` is resolved deliberately:
      either refused with a message saying agent-defs have one root, or honoured
      within that root. Decide, implement, and say which in the help text —
      silently ignoring the flag is the one unacceptable outcome
- [x] `--type skill` is decided the same way and stated, even if the decision is
      "unchanged, out of scope"
- [x] Documents already misfiled under `data/docs/` keep working; this issue
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

**Model: opus.** Real server (`tsx apps/server/src/main.ts`) on port **8839**, throwaway
workspace created by `corpus init` at `.../tmp/ws050`; CLI run from source (`tsx
apps/cli/src/bin/corpus.ts`). Server stopped and the port verified free at the end; the
user's 8765 listener was never touched.

### The routing was already done — measured before any code change

SERVER-122 made an omitted `folder` file a document in the root its `type` declares, and
`create.ts:55` already omits `folder` when `--folder` is absent. So the happy path worked
with **zero CLI change**, verified first, against the unmodified tree:

```
### before any edit
doc create --type agent-def --title "Analyst"                    → .claude/agents/analyst.md
doc create --type note      --title "Ordinary"                   → data/docs/inbox/ordinary.md
doc create --type agent-def --title "Critic" --folder .claude/agents → .claude/agents/critic.md
doc create --type agent-def --title "About Analyst" --folder inbox   → data/docs/inbox/about-analyst.md
doc create --type note      --title "Wrong"  --folder .claude/agents → 400 (exit 5)
doc create --type skill     --title "Sk"     --folder .claude/skills → 400 (exit 5)
```

This issue is therefore **help text, examples, generated docs and tests** — no behaviour
change, and none was warranted: routing per type inside the CLI would be the CLI
constructing a path, which architecture decision 2 forbids.

### What changed

- `create.ts` — the false sentence at the old lines 79–80 amended in place (not appended
  to), the `--folder` flag description, a new agent-def example, and a module-header note
  that the root is the server's answer and must not be pre-validated here.
- `skill/index.ts` — two now-false claims ("a skill is the one document that lives outside
  `data/docs/`", "`.claude/skills/` rather than `data/docs/` … the one thing `corpus doc
  create` cannot do") corrected to the real reason skills stay out of scope: a skill is a
  directory plus a fixed filename, not a folder.
- `docs/cli.md` regenerated (`tsx apps/cli/scripts/generate-docs.ts`).

### Post-change evidence (same workspace, same server)

```
AC1  doc create --type agent-def --title "Archivist" --from agent
       → created doc_t4egg6pv — .claude/agents/archivist.md          # no extra flag
AC2  … --title "Sentinel" --json
       → doc.path = .claude/agents/sentinel.md   doc_nxvh6b4y        # real path in JSON too
AC3  thread designate th_m3hfk2qh --agent archivist
       → designated archivist (doc_t4egg6pv) on th_m3hfk2qh
     thread reply th_m3hfk2qh -m "Over to you, @archivist." --from agent
       → resident {"name":"archivist","docId":"doc_t4egg6pv"}        # resolves as @archivist
AC4  --type note|view|template  (no folder) → data/docs/inbox/ord-{note,view,template}.md
     --type note --folder views             → data/docs/views/ord-folder.md   # unchanged
AC5  --type agent-def --folder inbox        → data/docs/inbox/about-archivist.md
       # explicit folder wins, deliberately: a document *about* a persona
     --type note --folder .claude/agents    → 400 "that root holds one kind of document,
       and this is not it" (exit 5), server's words verbatim
AC6  --type skill --folder .claude/skills   → 400 "folder is not a location documents are
       indexed from" (exit 5) — unchanged, out of scope
     skill create post-check                → .claude/skills/post-check/SKILL.md — the
       genesis verb still owns it
     --folder ../../.claude/agents          → 400 folder escapes the document root
AC7  doc list --type agent-def reports all 8, including the two filed under data/docs/ by
     the pre-change runs: nothing was moved.
edge duplicate stem   → 400 "the name `archivist` is already taken in .claude/agents"
edge title "!!!"      → .claude/agents/doc_bet5tw4j.md (server's id fallback, as elsewhere)
     db doctor → "projection is clean — 27 documents from 27 files"
```

**Inapplicable flags** (`--pinned`/`--order`/`--query` with `--type agent-def`): left as the
verb already treats them — parsed, sent, and answered by the server — because this verb
"defaults nothing per type" and refusing per type here would be the same overreach as
routing per type.

### Tests

- `apps/cli`: **92 files, 1514 tests, all passing** (`VITEST_MAX_THREADS=4 vitest run apps/cli`),
  including `docs/generate.test.ts`'s committed-`docs/cli.md` assertion.
- Six new command tests in `create.test.ts` asserting the **request**: an agent-def carries
  no `folder`, a named root passes through, an explicit `inbox` is neither dropped nor
  rewritten, the mismatch is the server's message, and `note`/`view`/`template`/`skill`/a
  plugin type produce byte-identical bodies to today's. Plus a help-text test pinning the
  three sentences the ACs require.
- **Falsification**: adding routing to `create.ts` (`folder ?? (type === "agent-def" ? ".claude/agents" : undefined)`)
  turns the "sends no `folder` for an agent-def" test red; deleting the amended help
  sentence turns the help-text test red. The byte-identical test is what would catch
  collateral damage to other types.
- `eslint` and `prettier --check` clean on every touched file. `tsc --noEmit -w apps/cli`
  reports only the two pre-existing `Resident.name`-nullable errors — `commands/agents.ts:154`
  (CLI-049's) and `commands/thread/designate.ts:49`, the same CONTRACT-061 cause — and
  nothing from this change.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CLI-050]` prefix
