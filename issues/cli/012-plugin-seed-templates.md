# [CLI-012] Install plugin seed templates at `corpus init`

## Domain

cli

## Status

done

## Priority

P2

## Model

opus — extend the existing plugin-skill install path to a second asset kind.

## Dependencies

- Depends on: PLUGINS-002, CLI-005
- Blocks: —

## Spec References

- SPEC.md §10 — plugin assets
- issues/plugins/002-todos-plugin.md — escalation 3 (2026-07-29)

## Summary

Found by PLUGINS-002: a plugin's `types.yaml` may declare `seedTemplate` per doc type, and
`plugins/todos/seeds/todo-template.md` ships one — but `corpus init` copies `plugins/*/skills/`
only, so seed templates are declared and never installed. Extend the init/upgrade install path to
copy plugin seeds into the workspace's template location, recorded in `template-manifest.json`
with the `source: "plugin:<dir>"` marker so `workspace upgrade` refreshes them like plugin skills.

## Acceptance Criteria

- [x] `corpus init` installs declared plugin seed templates; `workspace upgrade` refreshes them
      (never clobbering user edits, per CLI-005's rules).
- [x] The todos template lands in a fresh workspace and `corpus doc create --type todo` uses it.

## E2E Verification Log

**implemented on: opus** (2026-07-30). Workspaces under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-cli012*`, server on **9186** (second workspace
on 9187, never started), every command run with cwd **outside** this repository. No dev server;
`8765` never bound or proxied.

### What shipped

- `apps/cli/src/template/install.ts` — `planPluginSeedInstall`, the seed-template half of the plugin
  asset path, written to mirror `planPluginSkillInstall` rule for rule. It reads each plugin's
  `types.yaml` (the same schema `apps/server/src/plugins/discover.ts` uses, so the declaration means
  one thing) and plans `plugins/<dir>/<seedTemplate>` → `data/docs/templates/<basename>`.
- `apps/cli/src/commands/init/scaffold.ts` — seeds copy in the same loop as plugin skills and land
  in the manifest with the same `source: "plugin:<dir>"` marker.
- `apps/cli/src/commands/workspace/upgrade.ts` — seeds join `collectIncoming`, so the shipped
  three-way compare refreshes them **with no special case**; plus the queue-skeleton repair.
- `apps/cli/package.json` — **one new dependency, `yaml@^2.9.0`** (see the note at the end).

### TEST-517 / TEST-518 · a fresh workspace arrives with the template, byte-identical

```
$ corpus init --port 9186
  installed 8 template files, recorded in .corpus/template-manifest.json
  installed 2 plugin skill files into .claude/skills/
  installed 1 plugin seed template into data/docs/templates/     ← new line
$ ls data/docs/templates/
note.md  todo-template.md
$ diff data/docs/templates/todo-template.md <repo>/plugins/todos/seeds/todo-template.md
(identical)
$ corpus doc list --type template --json | …
doc_seedtemplatetodo | Todo template | data/docs/templates/todo-template.md | extra= {"for": "todo"}
doc_seedtemplatenote | Note template | data/docs/templates/note.md          | extra= {"for": "note"}
```

Both halves: the file is on disk **and** the projection indexes it as a `type: template` document
carrying `for: todo`. No assertion anywhere pins the template's *content* (TEST-518) — the CLI
installs whatever the plugin ships, which is what keeps this issue order-independent with respect to
PLUGINS-005.

### TEST-519 · `corpus doc create --type todo` uses it

```
$ corpus doc create --type todo --title "Groceries" --from agent
created doc_unaavdq2 — data/docs/inbox/groceries.md
$ cat data/docs/inbox/groceries.md
---
id: doc_unaavdq2   type: todo   title: Groceries   status: open   …
---

## What this list is for

- [ ] First thing to do
- [ ] Something with a deadline (due: 2026-12-31)

## Notes
```

Pre-filled from the installed template, per §11 — the end-to-end proof that the install landed
somewhere the system actually looks.

### TEST-520 · the manifest records the provenance the upgrade needs

```
$ python3 -c "…" .corpus/template-manifest.json
{"path": ".claude/skills/todos/SKILL.md",            "sha256": "a07424b4…", "source": "plugin:todos"}
{"path": "data/docs/templates/todo-template.md",     "sha256": "e6486f98…", "source": "plugin:todos"}
```

Same marker plugin skills carry, so an upgrade tells a plugin asset from a core template from a
user's own file.

### TEST-521 · upgrade refreshes it, and never clobbers a user edit

A "newer tool" is a scratch copy of `plugins/` with the seed template edited, pointed at with
`CORPUS_PLUGINS_DIR` (the same seam `corpus init` resolves through) — the repo's own plugin tree was
never touched.

```
(a) untouched but stale, workspace s017-cli012b:
$ CORPUS_PLUGINS_DIR=<tool> corpus workspace upgrade --from user
upgrade (tool 0.0.0 → 0.0.0):
  update  data/docs/templates/todo-template.md [plugin:todos]
wrote 1 file in commit 6ad910b7…
$ tail -1 data/docs/templates/todo-template.md
(v2: shipped by a newer tool)                    ← refreshed from its plugin

(b) user-edited, workspace s017-cli012:
$ printf '\n- [ ] my own starter item\n' >> data/docs/templates/todo-template.md
$ CORPUS_PLUGINS_DIR=<tool> corpus workspace upgrade --from user
upgrade (tool 0.0.0 → 0.0.0):
  keep    data/docs/templates/todo-template.md [plugin:todos] — modified here — 1 line only here,
                                                                1 line only in the new copy
wrote 0 files in commit f85e38eb…
$ tail -1 data/docs/templates/todo-template.md
- [ ] my own starter item                        ← the user's edit survives, reported not overwritten
```

Exactly the treatment a user-edited plugin skill gets today, because it is the same code path —
CLI-005's rules apply with nothing added.

### TEST-522 · a plugin that declares no `seedTemplate` installs nothing

Tool plugin's `types.yaml` reduced to `types: [{type: todo, label: Todo}]`, its `seeds/` left in
place:

```
$ CORPUS_PLUGINS_DIR=<tool> corpus init --port 9187
  installed 2 plugin skill files into .claude/skills/          ← no seed-template line
$ ls data/docs/templates/
note.md
manifest entries mentioning todo-template: []                   ← only the skill entry carries a source
```

Opt-in **by declaration**, not by the presence of a `seeds/` directory.

### TEST-523 · a declared-but-missing seed file warns, naming plugin and path

```
$ CORPUS_PLUGINS_DIR=<tool with seedTemplate: seeds/does-not-exist.md> corpus init --port 9187
warning: plugin todos declares seedTemplate "seeds/does-not-exist.md", which does not exist —
skipped; no template was installed for it
$ ls data/docs/templates/
note.md                                                         ← nothing installed, no manifest entry
```

**Warn, not fail** — chosen for parity with the shipped plugin-skill path, which warns and continues
for a skill it cannot install (a name collision) rather than refusing to create the workspace. A
plugin's mistake must not make `corpus init` unusable. The declaration is also refused if it points
outside the plugin directory (absolute or containing `..`), and an unreadable or misshapen
`types.yaml` warns instead of throwing.

### TEST-524 · `workspace upgrade` heals a pre-CONTRACT-021 queue skeleton

The gap, confirmed at contract time: `/usr/bin/grep -n 'gitkeep\|queue' apps/cli/src/commands/workspace/upgrade.ts`
returned nothing. Drill on a workspace put into the pre-`deferred` shape (directory removed and the
removal committed, so it is genuinely absent from the index too):

```
$ ls .corpus/queue/ ; git ls-files .corpus/queue/
abandoned failed in-progress pending processed         (five, no deferred/)
$ corpus workspace upgrade --from user
upgrade (tool 0.0.0 → 0.0.0):
  create  .corpus/queue/deferred/.gitkeep — queue status directory this workspace predates; it has
          to be tracked or a clone arrives without it
wrote 2 files in commit c17405ff…
$ ls .corpus/queue/ ; git ls-files .corpus/queue/
abandoned deferred failed in-progress pending processed
.corpus/queue/deferred/.gitkeep                        ← tracked, not merely present
$ git clone -q <workspace> <clone> && ls <clone>/.corpus/queue/
abandoned deferred failed in-progress pending processed  ← the clone carries it
$ corpus workspace upgrade --from user
already up to date.                                    ← idempotent
```

The check is driven from `QUEUE_EVENT_STATUSES`, never a hardcoded list, so the next status added
does not reopen this (unit test asserts the full derived set).

Two design points found by the drill and worth the orchestrator's attention:

- **It needs no baseline.** A directory is either there or it is not, and an empty marker overwrites
  nothing, so the repair also runs in a workspace with no `template-manifest.json` — the *oldest*
  workspaces, which are exactly the population missing `deferred/`. No template file is written
  there, and the output says so.
- **An old `.gitignore` can exclude the marker.** `git add` of a path inside an ignored directory
  **fails the whole command**, so a workspace whose `.gitignore` still says a bare `.corpus/*` would
  have turned a repair into a crashed upgrade. The marker is created, checked with
  `git check-ignore --no-index` (plain `check-ignore` answers "not ignored" for anything already in
  the index, which is *not* what `git add` will do), left out of the commit, and reported:
  "…excluded by this workspace's .gitignore, so it was created but not committed — allow
  `.corpus/queue/` through … and re-run." Overriding the operator's ignore rules with `-f` is not
  this verb's call.

### TEST-525 · the gitignore comment counts correctly

`assets/workspace/gitignore:18-21` no longer says "these **five** directories". It now names no
number at all — "one directory per queue status — `corpus init` creates them all from the status
list itself, so counting them here would only go stale" — which is the better of the two options the
criterion offers, since the count is a contract constant's to own.
`scripts/workspace-template.test.ts` is green (96 tests).

**Adjacent, not fixed, reported instead:** `docs/workspace-template.md:104-106` still enumerates the
same five status directories by name. It is outside TEST-526's stated blast radius
(`apps/cli/**` + `assets/workspace/gitignore`), so it was left alone — flagged for the orchestrator
as a one-line doc rider.

### TEST-526 · blast radius, and the CLI surface

**No new verb and no new flag** — `docs/cli.md`'s only diff from this issue is `workspace upgrade`'s
description gaining the seed-template and queue-skeleton sentences (the file was regenerated once on
the merged tree, also carrying CLI-016 and CLI-017). `git diff SPEC.md` and
`git diff packages/contract` are empty.

`git status --porcelain` for this issue: `apps/cli/src/template/install.{ts,test.ts}`,
`apps/cli/src/commands/init/{index,scaffold}.ts` + `scaffold-plugins.test.ts`,
`apps/cli/src/commands/workspace/upgrade.{ts,test.ts}`, `assets/workspace/gitignore`, `docs/cli.md`
— **plus two files outside it**, both deliberate and both reported:

1. **`apps/cli/package.json` + `package-lock.json`: `yaml@^2.9.0` added to `@corpus/cli`.** Reading
   a plugin's `seedTemplate` declaration means parsing `types.yaml`, and TEST-522/523 both hinge on
   the *declaration* rather than on a `seeds/` convention, so the parse is unavoidable. `yaml` is
   already a dependency of `@corpus/server` at the same range and already in the lockfile; the lock
   entry for `apps/cli` was updated to match so `npm ci` stays in sync. Packaging is unaffected —
   `scripts/build-package.ts` resolves the bundle's externals against all four workspace manifests
   and now finds `yaml` declared by the workspace that imports it, which is what its error message
   asks for.
2. **`apps/cli/src/registry/plugins.test.ts`**: its exhaustive pin of the todos plugin's verbs was
   red on this branch because PLUGINS-005 landed a `migrate` verb without updating it. Updated to
   `["add", "check", "list", "migrate"]` (still exhaustive, not relaxed) so the suite is green — a
   cross-agent artifact, not this issue's work.

### Checks

`npm run build`, `npm run typecheck -w apps/cli`, `npx eslint apps/cli`, prettier — all clean.
`VITEST_MAX_THREADS=4 npm test -w apps/cli` → **831 passed / 66 files**. Server on 9186 stopped by
recorded pid (50318); 9186/9187/9188/9190 all free; `8765` untouched;
`ls -d /Users/theophanerupin/code/corpus/.corpus` → "No such file or directory".

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed

## Audit fix round (wave-3, 2026-07-30 — opus)

Findings from `issues/evals/AUDIT-S017-wave3.md` closed here: **FIX 13**, **TEST 31**, **TEST 32**,
**CLEAN 44**, **CLEAN 52**, **CLEAN 55**.

**FIX 13 / TEST 32.** `existsSync` answers yes for a directory, so a plugin declaring
`seedTemplate: seeds/oops.md` at a *directory* passed the guard and threw `EISDIR` out of
`copyFileSync` in the middle of `corpus init` — unwinding a whole workspace over one plugin's typo.
`fileKind()` now `statSync().isFile()`s and returns `file | other | missing`, so the warning also
says which mistake it is: "does not exist" would have sent the author hunting for a file that is
sitting right there.

**CLEAN 44.** Two of a plugin's own doc types sharing one starter document is a legitimate
declaration, and the collision warning named the plugin as the loser of a race against itself.
Identical declarations within one plugin are now deduplicated silently. Two **different** files of
one plugin landing on the same installed name is still a real conflict, and gets its own honest
sentence naming both paths instead of borrowing the other-plugin one. The cross-plugin message is
untouched, and a test pins that the carve-out did not silence it.

**TEST 31.** `--dry-run` hard-coded `queueSkeletonIgnored: []`, so against an old `.gitignore` the
plan promised a repair the real run then declined to commit — the one thing a plan may not do. The
plan path now runs `trackableMarkers` too; `git check-ignore --no-index` answers about a path that
does not exist yet, which is what makes the prediction possible at all. The rendered line reads
"would be created but not committed" under `--dry-run` and "was" otherwise.

**CLEAN 52 — done, but without a number.** The brief said "five" → six. The comment now names no
count and says why: `QUEUE_STATUSES` is the source, and writing the number down is precisely what
went stale when CONTRACT-021 added `deferred` — inside the comment explaining the mechanism meant to
prevent that. Same call the evaluator recorded for the template `gitignore` at TEST-525.

**CLEAN 55.** The three hand-rolled `${n === 1 ? "" : "s"}` sites in `init/index.ts` now use
`plural()`; output is byte-identical.

### E2E Verification Log (fix round)

`corpus init` run from outside the repo, against a fixture plugins tree: one plugin declaring a
**directory** as its seed, one declaring the same seed for two of its own doc types.

```
pluginsfix/broken/types.yaml          seedTemplate: seeds/oops.md
pluginsfix/broken/seeds/oops.md/      ← a DIRECTORY
pluginsfix/shared/types.yaml          type a and type b, both seedTemplate: seeds/two-types.md
pluginsfix/shared/seeds/two-types.md

$ CORPUS_PLUGINS_DIR=…/pluginsfix corpus init ws2 --port 9191
warning: plugin broken declares seedTemplate "seeds/oops.md", which is a directory, not a file —
         skipped; no template was installed for it
Initialized Corpus workspace at …/ws2
  installed 8 template files, recorded in .corpus/template-manifest.json
  installed 1 plugin seed template into data/docs/templates/
exit=0                                   ← init SURVIVES; pre-fix this unwound the workspace
$ ls ws2/data/docs/templates/  →  note.md  two-types.md
```

No self-blaming warning from `shared` (CLEAN 44), and its file installed exactly once. The pre-fix
failure mode, mechanically: `copyFileSync(<that directory>, …)` throws rather than copying.

TEST 31 — an old `.gitignore` plus a missing status directory, plan then real run:

```
$ printf '.corpus/*\n' > .gitignore && git commit …  &&  rm -rf .corpus/queue/deferred

$ corpus workspace upgrade --dry-run --from user
plan (tool 0.0.0 → 0.0.0):
  …
  pending .corpus/queue/deferred/.gitkeep — queue status directory this workspace predates; …
  1 marker above is excluded by this workspace's .gitignore, so it would be created but not
  committed — allow `.corpus/queue/` through (the shipped template does, with `!.corpus/queue/`)
  and re-run.
nothing was written (--dry-run).
  deferred created by the dry run? NO

$ corpus workspace upgrade --from user
upgrade (tool 0.0.0 → 0.0.0):
  …
  create  .corpus/queue/deferred/.gitkeep — …
  1 marker above is excluded by this workspace's .gitignore, so it was created but not committed …
wrote 4 files in commit 20ed3b3f…
```

The plan and the run now agree, and the plan says "would be" where the run says "was". A stock
workspace is unaffected: the existing `--dry-run` marker test asserts the line is **absent** there.

`plural()` (CLEAN 55) is visible in the init output above — "1 plugin seed template", "8 template
files".

### Checks (fix round)

`npm run build`, `npx tsc --noEmit -p apps/cli/tsconfig.json`, `npx eslint apps/cli/src`,
`npx prettier --check` — all clean. `VITEST_MAX_THREADS=4 npm test -w apps/cli` → **869 passed / 66
files** (`install.test.ts` 23, `upgrade.test.ts` 26). `docs/cli.md` regenerated. Servers stopped by
recorded pid; 9190–9195 and 8765 free; no workspace under the repo.
