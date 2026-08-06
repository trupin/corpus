# [CLI-027] `corpus workspace diff <path>` — what the tool changed under an edited file

## Domain
cli

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-007 (amended 2026-08-03)
- Blocks: CLI-025 (which points at this command in its conflict report)

## Spec References
- SHARED-007 amendment, signed 2026-08-03: a conflict "gives the command that
  shows the difference (`corpus workspace diff <path>`)"
- SPEC.md §2.1 workspace template provenance

## Summary
`corpus workspace upgrade` already refuses to overwrite a template file the
workspace has edited, and reports it as `keep-modified`. Today that report is a
dead end: it tells you a newer version exists and gives you no way to see it.
The signed amendment makes the conflict *unresolved work*, so the resolver needs
the one thing it is missing — what actually changed upstream.

**The audience is the agent** (user, 2026-08-03: _"let's assume this will be run
by an agent"_). So this verb's output is an input to a merge decision, not
decoration. It must be unambiguous about which side is which: the baseline
`init` recorded, the workspace's current copy, and the version the installed
tool ships.

The three shas are all available — `.corpus/template-manifest.json` holds the
baseline, the file holds the workspace's, and `resolveTemplateRoot()` reaches the
tool's. The pieces exist; this is the surface over them.

## Acceptance Criteria
- [x] `corpus workspace diff <path>` prints the difference between the
      workspace's copy and the version the installed tool ships
- [x] It is explicit about direction — which side is the workspace's and which
      is the tool's — so a merge cannot be applied backwards
- [x] The **baseline** is reachable too, since a three-way merge needs it: either
      shown by default or behind a flag, but reachable without reading the
      manifest by hand
- [x] With no path, it lists the paths that currently have conflicts, so the
      agent can enumerate its work without re-running an upgrade
- [x] A path with no conflict says so plainly and exits successfully — asking
      about a clean file is not an error
- [x] A path the manifest does not know is refused with an explanation, not a
      confusing empty diff
- [x] Machine-legible output available (`--json` or equivalent), because the
      primary caller is an agent — decide the shape and say why
- [x] Read-only: this verb never writes to the workspace, and never needs the
      server running (the same bootstrap-class reasoning as `workspace upgrade`)
- [x] Works when the tool no longer ships the file (retired) — say that rather
      than diffing against nothing

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/workspace/diff.ts` (new) + tests
- `apps/cli/src/commands/workspace/index.ts` (registration)
- reuse `template/manifest.ts` (`readTemplateManifest`, `sha256`) and
  `paths.ts` (`resolveTemplateRoot`) — do not re-derive either
- `docs/cli.md` is a generated artifact: regenerate, never hand-edit

### Notes
- `template/plan.ts` already computes the verdict per path (`decide`), including
  `keep-modified` and `retired`. Enumerate conflicts from the same function
  rather than re-implementing the comparison — two spellings of this rule is
  exactly the drift the three-way logic exists to prevent.

## Testing Strategy
Unit tests over the manifest/plan seam (pure, no filesystem) plus command tests
covering: conflict, clean file, unknown path, retired file, and the listing mode.

## E2E Verification Log

**Model: opus** (claude-opus-5, 1M context). Date: 2026-08-05.

Ran the **built** CLI (`npm run build -w apps/cli`, then
`node apps/cli/dist/bin/corpus.js`) against a real workspace at `/tmp/cli027`,
created by a real `corpus init`. No server was started at any point — the verb
must not need one, and not starting one is the proof.

A tool upgrade was simulated the way `npm update` does it: by editing the
**tool's** copy of `assets/workspace/claude/skills/comment/SKILL.md` after the
workspace had been initialized from it. That file was backed up before the edit
and byte-restored afterwards (`shasum` verified identical to the backup; the
repo's pre-existing uncommitted change to it is untouched).

**Setup**

```
$ cd /tmp/cli027 && corpus init
Initialized Corpus workspace at /private/tmp/cli027
  installed 8 template files, recorded in .corpus/template-manifest.json
  installed 2 plugin skill files into .claude/skills/
# workspace evolves its skill:   appended "## Local house rule" (2 lines)
# tool then changes it too:      +1 frontmatter line, +"## New upstream section" (3 lines)
```

**1. Listing mode — enumerate the unresolved work without re-running an upgrade**

```
$ corpus workspace diff
1 conflict — edited in this workspace and changed by corpus 0.3.0:
  .claude/skills/comment/SKILL.md
each is unresolved work: nothing is merged automatically. See what the tool changed with `corpus workspace diff <path>`.
EXIT=0
```

**2. The conflict itself — three sides, then the diff, with direction stated**

```
$ corpus workspace diff .claude/skills/comment/SKILL.md
.claude/skills/comment/SKILL.md
  conflict — edited here and changed by the tool. Nothing is merged automatically; resolve it by editing the workspace's copy yourself.
  baseline  50d24e05cf6e…  recorded by corpus 0.3.0
  workspace 70dd2387f8cd…  moved since the baseline
  tool      cc233c9804e4…  moved since the baseline (corpus 0.3.0)

--- workspace/.claude/skills/comment/SKILL.md
+++ tool/.claude/skills/comment/SKILL.md
@@ -1,5 +1,6 @@
 ---
 name: comment
+# NEW in the tool: a line the upgrade wants you to take
 description: Handle a thread event — read the thread and its anchored context, …
 id: doc_skillcomment
 type: skill
@@ -603,6 +604,6 @@
 EOF
 ```

-## Local house rule
+## New upstream section

-Always link the source document.
+The tool added this in a later release.

# `-` lines are workspace/, `+` lines are tool/: this diff reads workspace → tool, so applying it takes the tool's change and reversing it would discard the tool's change instead. Nothing was written — this verb only reads.
EXIT=0
```

**3. The diff is a real unified diff, not a lookalike**

```
$ git apply -p1 --check --verbose /tmp/cli027.patch     # the `diff.text` from --json
Checking patch .claude/skills/comment/SKILL.md...
APPLY_CHECK=0

$ git diff --no-index --unified=3 <workspace copy> <tool copy> | (strip ---/+++/index)   vs   our body
8c8
< @@ -603,6 +604,6 @@ notes. That closes the filing I paused on; nothing else is outstanding here.
---
> @@ -603,6 +604,6 @@
```

Byte-identical to `git diff --unified=3` on the same two files, every hunk
boundary and line number included; the sole difference is git's optional
after-`@@` heading text, which is decoration and carries no semantics.

**4. `--json` — one value, and the direction is data rather than prose**

```
$ corpus workspace diff .claude/skills/comment/SKILL.md --json
{"root":"/private/tmp/cli027","toolVersion":"0.3.0","baselineRecordedBy":"0.3.0",
 "path":".claude/skills/comment/SKILL.md","source":"template","action":"keep-modified","conflict":true,
 "baseline":"50d24e05…","workspace":{"present":true,"sha256":"70dd2387…","matchesBaseline":false},
 "tool":{"present":true,"sha256":"cc233c98…","matchesBaseline":false},
 "diff":{"from":"workspace","to":"tool","text":"--- workspace/…","added":3,"removed":2,"coarse":false}}
EXIT=0
```

Cross-check against the other verb, which must agree by construction — it does:
`corpus workspace upgrade --dry-run` reports the same file as
`keep — modified here — 2 lines only here, 3 lines only in the new copy`, matching
`removed: 2` / `added: 3`.

**5. A clean file is not an error**

```
$ corpus workspace diff .claude/skills/orchestrate/SKILL.md
.claude/skills/orchestrate/SKILL.md
  identical to the copy corpus 0.3.0 ships — nothing to merge.
  baseline  23ce7df89d7c…  recorded by corpus 0.3.0
  workspace 23ce7df89d7c…  unchanged since the baseline
  tool      23ce7df89d7c…  unchanged since the baseline (corpus 0.3.0)
EXIT=0
```

**6. An unknown path is refused with the reason, not an empty diff**

```
$ corpus workspace diff data/docs/inbox/whatever.md
corpus: "data/docs/inbox/whatever.md" is not a file the corpus tool installs, so there is nothing to compare it against.
  This verb compares template-provenance paths only — … Documents under `data/` are the server's; read their history with `corpus doc diff`. Run `corpus workspace diff` with no path to list the conflicting ones, …
  { "path": "data/docs/inbox/whatever.md", "known": 11 }
EXIT=2

$ corpus workspace diff README.mdx --json
{"error":{"code":"usage_error","message":"\"README.mdx\" is not a file the corpus tool installs, …","details":{"path":"README.mdx","known":11,"didYouMean":"README.md"}}}
EXIT=2
```

**7. Path forms an agent or a person will actually type**

```
$ cd /tmp/cli027/.claude/skills && corpus workspace diff comment/SKILL.md --json | …
.claude/skills/comment/SKILL.md keep-modified true
$ corpus workspace diff /private/tmp/cli027/.claude/skills/comment/SKILL.md --json | …
.claude/skills/comment/SKILL.md keep-modified
```

**8. Read-only, proven rather than asserted**

```
$ snap() { find . -type f -print0 | sort -z | xargs -0 shasum; }
$ snap > before; <4 diff runs, listing + path + --json + clean file>; snap > after
$ diff before after
READ-ONLY: workspace byte-identical after 4 runs (69 files hashed)
```

`git status --porcelain` in the workspace shows only the edit the test itself
made to the skill; the verb wrote nothing, and `.corpus/template-manifest.json`
is unchanged.

**9. A workspace with no baseline still answers, and says the answer is a guess**

```
$ rm .corpus/template-manifest.json && corpus workspace diff
1 conflict — edited in this workspace and changed by corpus 0.3.0:
  .claude/skills/comment/SKILL.md
each is unresolved work: nothing is merged automatically. …
note: this workspace has no .corpus/template-manifest.json, so nothing above knows what was originally installed — a file that merely predates the current template reads the same as one the agent edited. `corpus workspace upgrade --adopt` records a baseline.
EXIT=0
```

**Checks**

- `VITEST_MAX_THREADS=4 npx vitest run apps/cli` → **1156 passed, 0 failed**
  (35 new: 17 command tests in `workspace/diff.test.ts`, 15 in
  `workspace/unified-diff.test.ts`, 3 registry-entry tests).
- `npx tsc --noEmit -p apps/cli` → clean. `npx eslint apps/cli/src` → no issues.
  `npx prettier --check "apps/cli/src/**/*.ts" docs/cli.md` → clean.
- `docs/cli.md` regenerated with `npm run docs:cli -w apps/cli`; the generated
  prose is Prettier-stable (the `*emphasis*` → `_emphasis_` trap was hit once and
  fixed at the source), so `check-generated-artifacts` will pass once the
  regenerated file is committed.

**Retired / deleted / plugin-provenance** paths are covered by unit tests rather
than by this log: reproducing them E2E would mean deleting a file from the
repo's own `assets/workspace/`, and the scratch-tree seam tests exactly the same
code path without touching product source.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
