# [CLI-084] The stale-verb scan judges the incoming template against the outgoing tool

## Domain

cli

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Related: CLI-059 (the scan's origin), CLI-077 (`thread digest`, the verb
  that exposed it)

## Spec References

- SPEC.md **§4** — self-upgrade

## Summary

Reported from a real upgrade (0.32.0 → 0.33.0, `cos` workspace, 2026-09-06):
the upgrade flagged `corpus thread digest` in converse/SKILL.md (lines 299,
906) as "a command this tool does not have". The verb exists, and both
flagged lines match its real grammar.

**The reporting agent's diagnosis — a two-word-only parser — is not what the
code shows.** `apps/cli/src/template/stale-verbs.ts:244` caps token
collection at two on purpose, and `thread digest` (with `set` as an `action`
positional) **is** the 0.33.0 registry entry, so the parse is correct and a
0.33.0 binary resolves it. What was actually running was the **0.32.0
binary**: `corpus upgrade` executes on the installed tool, and the scan
resolves the *incoming* template's command references against the *outgoing*
tool's registry — which predates the verb. Every future release that ships a
new verb referenced by its own updated skills will false-positive the same
way. (Hypothesis from reading; the reproduction below is mandatory before
the fix.)

## What to build

The scan must judge the incoming template against the **incoming** tool's
surface. Directions, decide and record:

1. Resolve against the incoming package's own registry (the staged tool copy
   the upgrade already holds), or
2. Defer the scan to first run after the tool swap, reporting then.

Either way: a verb the new tool has is never flagged by the upgrade that
delivers it, and a verb the new tool *dropped* still is — the scan's real
purpose (CLI-059) survives.

## Acceptance Criteria

- [x] **Reproduce first**: 0.32.0 binary upgrading to 0.33.0 flags
      `thread digest`; log the exact output (the SDLC's bug rule)
- [x] Post-fix: the same upgrade path reports no finding for `thread digest`
- [x] A reference to a genuinely removed verb is still flagged (regression
      for the scan's purpose)
- [x] The three-word-grammar hypothesis is answered in the log — tested, not
      assumed — so the report's author gets a correction or a confirmation

## Direction taken (TEST-1122)

**Direction 1 — resolve against the incoming tool's surface — implemented by
letting the incoming template vouch for the commands it invokes.**

`staleVerbCitations` now takes an optional `tool: ToolRoots`. When present, it
reads every markdown file the incoming template would install, collects every
`corpus …` invocation in it with the same walker the report uses, and widens
the surface it judges against: a verb of a known topic is added to that topic,
and a first token this build knows as neither command nor topic is added
outright. `applyWorkspaceUpgrade` passes the `UpgradeDependencies` it already
holds, so both `corpus workspace upgrade` and `corpus upgrade` get it.

**Why not the literal "read the incoming package's registry".** A released
package carries no machine-readable command list — checked against the real
0.32.0 and 0.33.0 tarballs: `assets/`, `server/`, `ui/`, `dist/corpus.js`, and
no surface file. `corpus --help=brief --json` prints rendered text, not JSON
(verified on both binaries), so asking the new binary would mean parsing help
prose or spawning it inside the upgrade's own failure window. Shipping a
generated surface file instead would need `scripts/package-build.ts` staging, a
drift-check inventory entry and a new generated artifact — a cross-domain infra
touch no issue in this batch owns — and it would still be exact only from the
*next* release onward, because the incoming package must carry the file.

**Why not direction 2 (defer to first run after the swap).** It splits one
report across two moments: `corpus upgrade` would print its findings without
the stale-citation section, and something later would have to print it. There
is no natural host for "the first run after the swap", and `UpgradeResult`'s
`staleCitations` would stop meaning what it says. Its reach is no better either
— it needs the fix on both sides of the pair, exactly like direction 1.

**What vouching gives up, named.** A verb the incoming tool has but its own
skills never invoke is still flagged, and a verb the incoming tool ships broken
instructions for is not. Both err toward silence, which is the module's
standing bias, and `stale-verbs.test.ts` pins that the shipped template
produces no findings against the real registry — so the second case is caught
in CI rather than in a workspace.

## E2E Verification Log

**Model: Opus 5 (`claude-opus-5[1m]`).** Date 2026-09-06.

### How the binaries were obtained

`gh release download v0.32.0` and `v0.33.0` from `trupin/corpus`, then
`npm i --prefix t32 ./corpus-0.32.0.tgz` and the same for `t33`, in a scratch
directory outside this worktree. Nothing in the checkout was touched.

```
$ ./t32/node_modules/.bin/corpus --version
0.32.0
$ ./t33/node_modules/.bin/corpus --version
0.33.0
$ ./t32/node_modules/.bin/corpus thread --help=brief   # (verbs only)
  create  show  context  reply  resolve  reopen  designate  release  scope
$ ./t33/node_modules/.bin/corpus thread --help=brief   # (verbs only)
  create  show  context  reply  digest  resolve  reopen  designate  release  scope
```

So 0.32.0 has no `thread digest` and 0.33.0 does.

### Reproduction (TEST-1118) — the 0.32.0 binary flags a verb 0.33.0 ships

The state `corpus upgrade` reaches at step 6 is: the running process is the old
code, and the tool's `assets/workspace/` on disk is the new one, because npm
replaced it in place. That state was staged exactly — the 0.32.0 install kept
its own `dist/corpus.js` and received 0.33.0's `assets/` — and then the
workspace half was run on the 0.32.0 binary:

```
$ ./t32/node_modules/.bin/corpus init ws
$ rm -rf t32/node_modules/corpus/assets
$ cp -R t33/node_modules/corpus/assets t32/node_modules/corpus/assets
$ cd ws && ../t32/node_modules/.bin/corpus workspace upgrade
upgrade (tool 0.32.0 → 0.32.0):
  update  .claude/skills/comment/SKILL.md
  update  .claude/skills/converse/SKILL.md
  update  .claude/skills/orchestrate/SKILL.md
  install .claude/skills/converse/references/leaving.md
  ... (13 files)
wrote 13 files in commit 183a5e779ddb00dfd7660eab9c803a28756ae83c.
migrations: none — every document is written the way this tool reads it.

2 stale command references — these files tell the agent to run a command this tool does not have, and it will find out by trying. Nothing here was changed:
  .claude/skills/converse/SKILL.md:299: `corpus thread digest`
    `corpus thread digest set th_4b8e2c`, the body from stdin or `--file`, never quoted into
    `corpus thread --help=brief` lists the verbs `corpus thread` has.
  .claude/skills/converse/SKILL.md:906: `corpus thread digest`
    corpus thread digest set th_4b8e2c --from agent <<'CORPUS_EOF'
    `corpus thread --help=brief` lists the verbs `corpus thread` has.
  Each of these files is yours, so the repair is an edit: `corpus doc edit <id>` with the line rewritten, or `corpus workspace diff <path>` to see what the tool's own copy says now.
```

Lines 299 and 906, the same two the report named. The diagnosis in the Summary
is confirmed: the outgoing registry judged the incoming template.

### TEST-1119 — the three-word-grammar hypothesis is **wrong**

The reporting agent blamed the two-token cap at `stale-verbs.ts:244`. Tested
rather than assumed, two ways.

1. The 0.33.0 binary was run over the very same workspace — the same bytes, the
   same two lines, only a newer registry:

```
$ cp -R ws ws33 && cd ws33 && ../t33/node_modules/.bin/corpus workspace upgrade --dry-run
already up to date.
migrations: none — every document is written the way this tool reads it.
```

No finding. If the parser could not read `corpus thread digest set th_4b8e2c`,
0.33.0 would have reported it too.

2. A unit test now pins it: _"resolves a verb whose own grammar takes a
   positional action word"_ in `stale-verbs.test.ts`, over the exact quoted
   line including its heredoc opener.

`set` is a positional argument of `thread digest`, not a third name. The cap
stops before it on purpose. **The report's author gets a correction: the parser
was right, the registry was old.**

### Post-fix (TEST-1120, TEST-1121)

The fix ships in the tool that *performs* an upgrade, so it cannot change what
the already-released 0.32.0 binary does. It was verified on the pair it does
govern: a fixed build as the outgoing tool, and an incoming template teaching
a verb that build does not have. `thread summarize` stands in for `thread
digest` — a verb no release has, added to the staged tool's own
`converse/SKILL.md`, so the shape is identical to the reproduction.

The fixed build was staged as an installed layout (`toolfixed/apps/cli/dist` +
`toolfixed/assets/workspace`) and a workspace was created from it, so the
workspace carries the citation the template teaches.

**Run A — the released 0.33.0 binary (unfixed code), same template, same
workspace:**

```
$ ../t33/node_modules/.bin/corpus workspace upgrade --dry-run
already up to date.
migrations: none — every document is written the way this tool reads it.

1 stale command reference — these files tell the agent to run a command this tool does not have, and it will find out by trying. Nothing here was changed:
  .claude/skills/converse/SKILL.md:962: `corpus thread summarize`
    corpus thread summarize th_4b8e2c --from agent
    `corpus thread --help=brief` lists the verbs `corpus thread` has.
```

**Run B — the fixed build, same workspace, same template (TEST-1120):**

```
$ node ../toolfixed/apps/cli/dist/bin/corpus.js workspace upgrade --dry-run
already up to date.
migrations: none — every document is written the way this tool reads it.
```

Nothing reported. The verb the incoming tool delivers is no longer flagged by
the upgrade that delivers it.

**Run C — a workspace-owned citation of a genuinely removed verb (TEST-1121).**
`corpus skill rollback orchestrate` was appended to the workspace's own
`CLAUDE.md`, which no template file teaches:

```
$ node ../toolfixed/apps/cli/dist/bin/corpus.js workspace upgrade --dry-run
...
1 stale command reference — ...
  CLAUDE.md:59: `corpus skill rollback`
    corpus skill rollback orchestrate
    `corpus skill --help=brief` lists the verbs `corpus skill` has.
```

CLI-059's purpose survives.

**Run D — the vouching is per verb, not per topic.** `corpus thread frobnicate
th_1` was added to the same `CLAUDE.md`, while `thread summarize` stayed
vouched:

```
2 stale command references — ...
  CLAUDE.md:59: `corpus skill rollback`
  CLAUDE.md:63: `corpus thread frobnicate`
```

`thread summarize` being vouched for did not excuse `thread frobnicate`.

### Checks

- `npx vitest run apps/cli/src/template/` — 5 files, 87 tests, all pass
  (`stale-verbs.test.ts` 26 tests, 7 of them new).
- `npx vitest run apps/cli/src/commands/workspace/ apps/cli/src/commands/upgrade/`
  — 10 files, 247 tests, all pass.
- `npx vitest run apps/cli` — 2407 of 2408 pass. The one failure is
  `commands/init/git-process-group.test.ts`, which forks a real hanging git
  child and waits for its pidfile. It passes on its own (2/2) and touches
  nothing this issue changes.
- `npm run typecheck -w apps/cli` — clean. `eslint` and `prettier --check` on
  all three changed files — clean.
- No registry or help text changed, so `docs/cli.md` needs no regeneration.

### Files changed

- `apps/cli/src/template/stale-verbs.ts` — the vouched surface, the extracted
  invocation walker, and the doctrine comment.
- `apps/cli/src/template/stale-verbs.test.ts` — the TEST-1119 pin and seven
  vouching tests.
- `apps/cli/src/commands/workspace/upgrade.ts` — one call site: `tool:
  dependencies` on the `staleVerbCitations` call, with a four-line comment.
  Deliberately minimal, because CLI-081/082 hold that file.
