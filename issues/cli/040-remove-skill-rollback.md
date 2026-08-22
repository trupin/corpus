# [CLI-040] Remove `corpus skill rollback` — the verb and the route behind it

## Domain

cli (with `packages/contract`, which had to move in the same change — see Summary)

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-042 (the decision, applied to SPEC.md §7 on 2026-08-12)
- Related: SERVER-104 (`apps/server/src/skills/rollback.ts`, concurrent), AGENT-023
  (`assets/workspace/` skill prose, concurrent), SERVER-090 (makes the operator's
  git-side recovery leave an honest trace, and is therefore load-bearing for §7's
  replacement text)

## Spec References

- SPEC.md **§7** — "Loop safety (validate + reverting)", replaced 2026-08-12:
  "There is no separate rollback verb and no revert engine in the server: a revert
  is a write whose content came from history."
- SPEC.md §6 (anchor reconciliation), §11 (validation, warnings), §4 (attributed
  commit) — the four properties the ordinary write path gives a revert for free.

## Summary

PR #43's review found `corpus skill rollback` overwrote a whole file with an old
revision and destroyed uncommitted edits unrecoverably, at exit 0, with no
warning. SHARED-042 replaced it rather than patching it: a revert is a write whose
content came from history, so it belongs on `PUT /api/docs/{id}` with a key, where
it reconciles anchors (§6), validates (§11), commits under the acting party (§4)
and is refused on a stale key (§7).

This issue is the removal on the client side of that decision, and it spans two
workspaces because they cannot move apart: the CLI verb is a thin call onto a
contract route, so deleting the verb and leaving the route would publish an
endpoint nothing reaches, and deleting the route first would break the CLI's
build. `apps/server` is SERVER-104 and was handled concurrently by server-dev.

## Acceptance Criteria

- [x] `corpus skill rollback` is gone: no command module, no registry entry, no
      tests, nothing in `docs/cli.md`.
- [x] `POST /api/skills/{name}/rollback` is gone: no route, no `SkillRollbackRequest`
      / `SkillRollbackResult` schemas, no re-exports, absent from `ENDPOINT_INVENTORY`.
- [x] Both generated artifacts regenerate clean and their drift check's
      regeneration half is a no-op (`openapi.json`, `src/client/schema.generated.ts`,
      `docs/cli.md`) — and the word `rollback` appears in none of them.
- [x] The `skill` topic survives with `create` as its only verb.
- [x] No CLI help or error text points at the removed verb as the recovery for a
      bad skill edit; every such pointer now names the loop the spec teaches.
- [x] Removals are asserted as removals, so the surface cannot come back unnoticed.

## Technical Design

### Files to Create/Modify

**Deleted**

- `apps/cli/src/commands/skill/rollback.ts`, `…/rollback.test.ts`
- `packages/contract`: the `rollbackSkill` route, `SkillNameParamSchema`,
  `SkillRollbackRequestSchema`, `SkillRollbackResultSchema` and their types

**Modified — `apps/cli`**

- `src/commands/skill/index.ts` — topic drops to one verb; the description now
  carries the replacement loop
- `src/commands/skill/create.ts`, `create.test.ts` — three pointers at the verb;
  the topic inventory pin
- `src/commands/hygiene.test.ts` — the pinned command-module inventory
- `src/commands/upgrade/index.ts`, `src/commands/workspace/upgrade.ts` — "so
  `corpus skill rollback` undoes a bad upgrade" (three places) → revert the one
  attributed commit in the workspace with git
- `src/commands/workspace/maintenance.ts` — the verb named in a list of readers

**Modified — `packages/contract`**

- `src/routes/skills.ts`, `src/routes/index.ts`, `src/routes/inventory.ts`,
  `src/openapi.ts`, `src/schemas/skill.ts`
- Cross-references in `src/schemas/edit.ts`, `src/schemas/db.ts`,
  `src/schemas/upgrade.ts` (the last one is published prose)
- Tests: `src/openapi.test.ts`, `src/routes/skills.test.ts`,
  `src/routes/index.test.ts`, `src/schemas/skill.test.ts`,
  `src/client/request-body-required.test.ts`

**Modified — root**

- `scripts/workspace-template.test.ts` — a pin asserting `skill rollback` is
  documented in `docs/cli.md`. **Not changed by this issue**: AGENT-023 reached it
  first while this was in flight (see Unresolved).

**Regenerated**

- `packages/contract/openapi.json`, `packages/contract/src/client/schema.generated.ts`,
  `docs/cli.md`

### Key Implementation Details

The replacement wording, used consistently wherever the verb was named as the
recovery: read the history with `corpus doc diff <id>`, work out the content you
want back, write it with `corpus doc edit <id> --key <key>`. And for the case the
verb existed for — the loop itself broken, no agent running — revert in the
workspace with git directly, which SPEC.md §7 now names explicitly and SERVER-090
makes leave an honest trace.

`SkillNameSchema` bound two things (the create body and the rollback path param);
it now binds one, and its two doc comments that justified the double duty were
rewritten rather than left as citations of a parameter that no longer exists.

### Edge Cases

- The `skill` topic could have gone with the verb. It does not: `create` is still
  the one operation no document verb can express, because a skill is the one
  document living outside `data/docs/`.
- `apps/cli/src/commands/upgrade/index.test.ts` used "rollback" as a plain English
  noun in a comment about a partial install. Reworded to "undo" so a future sweep
  for the verb does not stop on it.
- `packages/contract/src/schemas/bulk.ts` also uses the word generically ("writing
  some and rolling them back"). Left alone — it names no verb.

## Testing Strategy

Unit, per workspace. The load-bearing additions are the ones that assert an
**absence**, because a removal that is not pinned comes back:

- `openapi.test.ts` — no `/api/skills/{name}/rollback` path, no `SkillRollback*`
  component, `ENDPOINT_INVENTORY` does not contain the signature, and the whole
  serialized document contains no `rollback` at all.
- `skill/create.test.ts` — `skillTopic.commands` is exactly `["create"]`, and
  neither the topic description nor the verb description contains "skill rollback"
  while both name `corpus doc edit` and `corpus doc diff`.
- `hygiene.test.ts`'s two pinned inventories drop the module.

## E2E Verification Plan

### Verification Steps

1. Build contract and CLI; regenerate both artifacts; run the drift check.
2. `corpus init` a scratch workspace on a free port, `corpus server start`.
3. Confirm the verb is gone (CLI) and the route is gone (server, via curl).
4. Confirm `corpus skill create` still works.
5. Perform the replacement loop for real: wreck the `orchestrate` skill through
   `corpus doc edit`, read the history with `corpus doc diff`, write the content
   back with `corpus doc edit --key`, and confirm byte-identical restoration as an
   ordinary attributed commit.
6. Confirm the property the removed verb never had: a stale key is refused.

## E2E Verification Log

**implemented on: opus**

### Post-Implementation Verification

Real workspace at `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/e2e-ws`, real
server on port **8811** (8765 and 5173 deliberately untouched). Built CLI at
`apps/cli/dist/bin/corpus.js`. Server stopped and workspace removed afterwards;
port confirmed free.

**Setup**

```
$ corpus init e2e-ws --port 8811
Initialized Corpus workspace at …/e2e-ws
  port 8811, token in .corpus/config.json (mode 600)
  git: initialized on main, one commit authored as user
  installed 8 template files, recorded in .corpus/template-manifest.json

$ corpus server start
corpus 0.5.0 listening on http://127.0.0.1:8811 (pid 77342)
```

**1. The verb is gone — exit 2, and it names what is left**

```
$ corpus skill rollback orchestrate
corpus: unknown verb "rollback" for "corpus skill".
  Valid: create. Run `corpus --help`.
EXIT:2
```

**2. The route is gone — asked of the real server, with the workspace token**

```
$ curl -X POST -H "Authorization: Bearer $TOKEN" \
    http://127.0.0.1:8811/api/skills/orchestrate/rollback
POST /api/skills/orchestrate/rollback -> 404
```

**3. `corpus skill create` survives**

```
$ corpus skill create e2e-probe --description "Prove genesis survives." --from agent
created doc_6wu5erps — .claude/skills/e2e-probe/SKILL.md
EXIT:0
```

**4. The topic's help teaches the replacement rather than pointing at a dead verb**

```
$ corpus skill --help
corpus skill — Create a skill: the one skill operation no document verb can express.
…
**Undoing a bad edit to a skill is not a verb here.** It is an ordinary write whose
content came from history: read what changed with `corpus doc diff <id>`, work out
the content you want back, and write it with `corpus doc edit <id> --key <key>`. …
When it is the agent's own loop that is broken and no agent is running to do that,
revert in the workspace with git directly; the server's watcher sees it as the
out-of-band `user` edit it is and commits it for itself.

Verbs:
  create  Create a skill through the server.
```

**5. The replacement loop, performed for real on the `orchestrate` skill**

Captured the good version first (`corpus doc show … --json` → 79284 body chars,
key `3c3b5cf0760e5b4a…`), then wrecked it:

```
$ corpus doc edit doc_skillorchestrate --from agent --key 3c3b5cf0… -m "# Orchestrate

Do nothing. Ever."
edited doc_skillorchestrate
key 1a025e1459e8fb2271679ba0e49bfdf131cbcf4709b293170420934d78592e64

$ git log --oneline -3 -- .claude/skills/orchestrate/SKILL.md
05162ba doc edit: Orchestrate (doc_skillorchestrate) by agent
3337f9e workspace: initialize corpus workspace by user
```

Read the history:

```
$ corpus doc diff doc_skillorchestrate --from-rev 3337f9e8… --to-rev 05162ba8…
doc_skillorchestrate · .claude/skills/orchestrate/SKILL.md
3337f9e8e7873a71b9c3f3497ac6043c4ed98658..05162ba82579321078e28c40845737f48d91f817
1 commit · +3 -1175 · showing 15947 of 80956 characters
diff --git a/.claude/skills/orchestrate/SKILL.md …
```

Wrote the content back through the ordinary write path, with the key of the
version just read:

```
$ corpus doc edit doc_skillorchestrate --from agent --key <fresh key> --file good-body.md
edited doc_skillorchestrate
key df5781b567c2d2000849d0ee0d9c0a8907d41f3800900621ec930998cb5bdae4

$ git log --oneline -3 -- .claude/skills/orchestrate/SKILL.md
b586c68 doc edit: Orchestrate (doc_skillorchestrate) by agent
1c356c6 editing session: 1 document by agent
3337f9e workspace: initialize corpus workspace by user

restored body chars: 79284 | identical to the good version: True
```

**PASS** — byte-identical restoration, as an ordinary `by agent` commit, with no
verb involved.

**6. The property the removed verb never had**

Replaying the *stale* key (the one read before the bad edit) is refused, nothing is
written, and the refusal hands back the current document to reconcile against:

```
$ corpus doc edit doc_skillorchestrate --from agent --key 3c3b5cf0… -m "clobber"
corpus: 409 stale_key: doc_skillorchestrate changed after the read that handed you
that key — nothing was written, and the text you tried to save is still yours to
resend.
  Reconcile against the document below … then run the same command again with
  `--key df5781b5…`. Retrying after a re-read is the expected path here, not a failure.
```

This is exactly what `skill rollback` could not do: it named a revision rather
than composing against a version it had read, so it had nothing to be stale
against, and it wrote over whatever was there.

**Checks run**

```
$ npm run build -w packages/contract          → ok
$ npm run generate -w packages/contract       → openapi.json, schema.generated.ts
$ npm run build -w apps/cli                   → ok
$ npm run docs:cli -w apps/cli                → docs/cli.md
$ grep -c rollback packages/contract/openapi.json \
      packages/contract/src/client/schema.generated.ts docs/cli.md   → 0, 0, 0
$ node --import tsx scripts/check-generated-artifacts.ts
    → regeneration is a no-op for both groups; the only complaint is the
      diff-against-HEAD half, which is the uncommitted-change guard and clears on
      commit
$ VITEST_MAX_THREADS=4 npx vitest run packages/contract apps/cli
    → PASS 3672 · FAIL 0
$ npm run typecheck -w packages/contract -w apps/cli   → clean
$ npx eslint packages/contract/src apps/cli/src        → No issues found
$ npx prettier --check packages/contract/src packages/contract/openapi.json \
      apps/cli/src docs/cli.md                          → all formatted
```

One pinned count moved as a consequence rather than as a choice:
`openapi.test.ts`'s "finds every request body in the surface" went 17 → 16.

## Unresolved

`scripts/workspace-template.test.ts` still fails four assertions that **pin the
template skills to naming `corpus skill rollback`** (lines ~760, ~1823, ~2118,
~2167). Those are AGENT-023's: agent-runtime-dev was editing `assets/workspace/`
concurrently, had already removed the verb from the orchestrate and comment skill
bodies, and had already fixed the fifth failure — the pin asserting the verb is
documented in `docs/cli.md` — before this issue could. Left untouched to avoid
two agents writing the same file. `docs/workspace-template.md:244` still names the
verb and belongs to the same issue.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint, prettier, tsc on both workspaces)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (P0, cross-domain)
- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-040]` prefix
