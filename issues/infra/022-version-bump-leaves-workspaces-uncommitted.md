# [INFRA-022] The documented release command leaves every workspace manifest uncommitted

## Domain

infra

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: INFRA-008 (the version-singularity guard that caught this)
- Blocks: —

## Summary

Found while cutting **v0.4.0**, on the first release since the guard existed. It
will bite every future release identically.

`CLAUDE.md` documents the release mechanism as:

> a version bump (`npm version <x.y.z> --workspaces --include-workspace-root`)
> followed by pushing the resulting `v*` tag

That command **does** rewrite every workspace manifest, and it **does** create
the tag — but the commit it makes contains only `package.json` and
`package-lock.json`. Every workspace manifest is left **uncommitted in the
working tree**, and the tag points at a tree where they are still the old
version.

Observed, verbatim:

```
$ npm version 0.4.0 --workspaces --include-workspace-root
$ npm run version:check
version:check ✓ every manifest is 0.4.0        # reads the WORKING TREE
$ git show --stat HEAD
 package-lock.json | 4 ++--
 package.json      | 2 +-                       # …but only these are committed
$ git status --short
 M apps/cli/package.json
 M apps/server/package.json
 M apps/ui/package.json
 M packages/contract/package.json
 M packages/kit/package.json
 M plugins/_fixture/package.json
 M plugins/todos/package.json
```

**The local check passes and the release still fails**, which is the trap: the
guard reads the working tree, where everything is correct, while the tag carries
a tree where nothing but the root moved. On CI:

```
version:check ✗ apps/cli/package.json is 0.3.0, expected 0.4.0
   … and six more
```

**INFRA-008 did its job.** The release stopped at its first step, before the
build, before packaging, before `gh release create` — so nothing was published
and the tag was left orphaned rather than pointing at a half-versioned release.
This issue is not a complaint about the guard; it is about the procedure the
guard had to catch.

## Acceptance Criteria

- [x] The documented procedure produces a commit containing **every** manifest it
      changed, or the mechanism is replaced by one that does
      — `npm run release:prepare`; rehearsal step 2 shows the 9-file commit
- [x] Running the documented steps in order cannot leave a `v*` tag pointing at a
      tree the guard would reject — verified by doing it, not by reading
      — rehearsal step 2: the tag detached-checked-out with `GITHUB_REF` set, exit 0
- [x] `npm run version:check` cannot pass locally while the committed tree would
      fail it. It reads the working tree today; if that stays, something else has
      to close the gap
      — it now reads both trees; rehearsal step 1 fails locally on the old command
- [x] `CLAUDE.md`'s release paragraph matches what the commands actually do
      — Git Workflow §12 and Build & Dev Commands rewritten; `README.md` too
- [x] The recovery is written down: what to do when a tag is already pushed and
      the release failed before publishing anything
      — `docs/RELEASING.md` → Recovery, rehearsed verbatim in step 3

## Technical Design

### Notes — options, decide deliberately

1. **A `release:prepare` script** doing bump → stage every manifest → one commit →
   tag, in one place. Removes the ordering trap entirely, and gives the recovery
   a home. Most work, most durable.
2. **Fix the documented command.** `npm version` takes `--no-git-tag-version`;
   the procedure becomes bump, `git add -A`, commit, tag by hand. Smallest change,
   but it is still a sequence a person must get right at the one moment it is
   least often rehearsed — roughly four times a year.
3. **Make `version:check` read the committed tree** (or both). Turns a
   passes-locally-fails-on-CI into a local failure, which is where a failure is
   cheap. Does not stop the mistake, but stops it travelling.

**1 and 3 compose** and are recommended together: 1 removes the trap, 3 catches
whatever future procedure replaces it. 2 alone leaves the sharp edge in place.

Whatever is chosen, note that `npm version` in a workspace root is doing
something reasonable by its own lights — it is not a bug to work around silently,
so the reason for the wrapper belongs in the wrapper.

## Testing Strategy

Run the documented procedure end to end on a scratch branch and assert the tag's
tree passes `version:check`. A unit test over the check's tree-vs-index reading
if option 3 is taken.

## E2E Verification Log

**Model: opus** (infra-dev), 2026-08-07.

### Decision: options 1 + 3, as recommended — plus option 2 folded inside option 1

Option 2 is not a third change: `release:prepare` **is** `--no-git-tag-version` followed by an
explicit stage/commit/tag, done once in a script instead of four times a year by hand. Taking it
separately would leave the sharp edge exactly where the issue says it is — in a sequence rehearsed
too rarely to be got right. Option 3 is what makes the pair safe against whatever procedure replaces
this one: the trap was never the command, it was that **nothing local could tell**.

- `scripts/release-prepare.ts` + `npm run release:prepare <x.y.z>` (option 1).
- `scripts/version-sources.ts` — `version:check` now reads the working tree **and** the committed
  tree (option 3). `checkVersionSources` in `scripts/versions.ts` composes and labels them.
- `docs/RELEASING.md` — procedure, why the wrapper exists, and the recovery.
- `CLAUDE.md` Git Workflow §12 + Build & Dev Commands, `README.md`, `.github/workflows/release.yml`
  and `.githooks/pre-push` now describe what the commands actually do.

### Pre-fix reproduction (the bug is real, and unchanged)

Scratch monorepo, `/tmp`, the documented command verbatim:

```
$ npm version 0.2.0 --workspaces --include-workspace-root
$ git show --stat --oneline HEAD
ebada18 0.2.0
 package.json | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
$ git status --short
 M apps/a/package.json
 M packages/b/package.json
$ git tag
v0.2.0
$ git show v0.2.0:apps/a/package.json
{"name":"tmp-a","private":true,"version":"0.1.0"}     # the tag carries the OLD version
```

### Rehearsal — a full copy of this repo, on scratch branches

Run in an APFS copy-on-write clone of the repo (`cp -Rc` → `/tmp/corpus-rehearsal`, deleted
afterwards) so that no state in the real repository changed: this agent may not run state-changing
git commands here. `core.hooksPath` was unset **in the copy** so the release commit did not fire a
repo-wide pre-commit build+test (machine-load discipline); nothing else was altered.

**1. The old command, on `rehearsal-old-way` — the failure is now local.** This is the criterion
"cannot pass locally while the committed tree would fail":

```
$ npm version 0.5.0 --workspaces --include-workspace-root
$ git show --stat --oneline HEAD
5e144044 0.5.0
 package-lock.json | 4 ++--
 package.json      | 2 +-
$ git status --porcelain -uno
 M apps/cli/package.json      M apps/server/package.json    M apps/ui/package.json
 M package-lock.json          M packages/contract/package.json
 M packages/kit/package.json  M plugins/_fixture/package.json
 M plugins/todos/package.json
$ git tag --points-at HEAD
v0.5.0
$ npm run version:check
version:check ✗ committed tree (HEAD): apps/cli/package.json is 0.4.0, expected 0.5.0
version:check ✗ committed tree (HEAD): apps/server/package.json is 0.4.0, expected 0.5.0
version:check ✗ committed tree (HEAD): apps/ui/package.json is 0.4.0, expected 0.5.0
version:check ✗ committed tree (HEAD): packages/contract/package.json is 0.4.0, expected 0.5.0
version:check ✗ committed tree (HEAD): packages/kit/package.json is 0.4.0, expected 0.5.0
version:check ✗ committed tree (HEAD): plugins/_fixture/package.json is 0.4.0, expected 0.5.0
version:check ✗ committed tree (HEAD): plugins/todos/package.json is 0.4.0, expected 0.5.0
Bump versions with: npm run release:prepare <x.y.z>
If a tag is already pushed and the release failed, see docs/RELEASING.md → Recovery.
exit=1
```

The same seven lines that only CI used to produce, now at the moment the tag was created — and
`version:check` is pre-push's first step, so the push is blocked too.

**2. The new command, on `rehearsal-new-way`.** The optional headline matches the release commits
already on `main` (`[RELEASE] v0.3.0 — comments that stay where you put them`); it is carried into
the annotated tag too.

```
$ npm run release:prepare 0.5.0 "forms and the release trap"
release:prepare ▶ bumping every manifest to 0.5.0
release:prepare ▶ staging 9 file(s): package.json, package-lock.json, apps/cli/package.json,
  apps/server/package.json, apps/ui/package.json, packages/contract/package.json,
  packages/kit/package.json, plugins/_fixture/package.json, plugins/todos/package.json
release:prepare ▶ committing (the pre-commit gate runs now — this takes a few minutes)
[rehearsal-new-way 30355df9] [RELEASE] v0.5.0 — forms and the release trap
 9 files changed, 17 insertions(+), 17 deletions(-)
release:prepare ▶ the release commit carries 0.5.0 in every manifest
release:prepare ✓ [RELEASE] v0.5.0 — forms and the release trap committed and tagged v0.5.0

Nothing has been pushed. To release:
  git push origin HEAD
  git push origin v0.5.0
exit=0

$ git status --porcelain -uno        # (empty — the bump is entirely inside the commit)
$ git log -1 --pretty=%s
[RELEASE] v0.5.0 — forms and the release trap
$ git tag -l --format='%(contents:subject)' v0.5.0
v0.5.0 — forms and the release trap
$ git rev-parse v0.5.0^{commit}; git rev-parse HEAD    # (identical)

$ git checkout --detach v0.5.0       # exactly what actions/checkout does for the tag
$ GITHUB_REF=refs/tags/v0.5.0 npm run version:check
version:check ✓ every manifest is 0.5.0 (working tree, committed tree (HEAD))
exit=0
$ GITHUB_REF=refs/tags/v9.9.9 npm run version:check
version:check ✗ working tree and committed tree (HEAD): the release tag names 9.9.9 but the
  package is 0.5.0 — tag and manifest must agree before anything is published
exit=1
```

**3. The documented recovery, on `rehearsal-recovery`.** Broken state recreated with the old command
(tag present, manifests uncommitted), then `docs/RELEASING.md` → Recovery steps 2 and 3 run verbatim
(the remote half, `git push origin :refs/tags/v0.5.0`, has no remote here):

```
$ git add -- package.json package-lock.json apps/*/package.json packages/*/package.json plugins/*/package.json
$ git commit -m "commit the manifests the bump left behind"
$ npm run version:check
version:check ✓ every manifest is 0.5.0 (working tree, committed tree (HEAD))
$ git tag -d v0.5.0 && git tag -a v0.5.0 -m v0.5.0
$ git rev-parse v0.5.0^{commit}; git rev-parse HEAD
3bf8af279c2b4ba81a74a6b15913deae9410871b
3bf8af279c2b4ba81a74a6b15913deae9410871b
$ git checkout --detach v0.5.0 && GITHUB_REF=refs/tags/v0.5.0 npm run version:check
version:check ✓ every manifest is 0.5.0 (working tree, committed tree (HEAD))
exit=0
```

**4. Guards, on the full repo copy.** Each aborts before writing anything; tree and tags untouched
after all four:

```
$ git tag v0.6.0 && npm run release:prepare 0.6.0
release:prepare ✗ v0.6.0 already exists locally
  if that release failed and was never published, see docs/RELEASING.md → Recovery
$ echo >> README.md && npm run release:prepare 0.6.0
release:prepare ✗ the working tree has uncommitted changes: README.md
  commit or stash them first — a release commit contains the version bump and nothing else
$ npm run release:prepare patch
release:prepare ✗ "patch" is not an explicit version. release:prepare takes x.y.z
  (not `patch`/`minor`/`major`) so the tag it will create is known before anything is written
$ npm run release:prepare
release:prepare ✗ usage: npm run release:prepare <x.y.z>
```

### Against the real repository (read-only)

```
$ npm run version:check
version:check ✓ every manifest is 0.4.0 (working tree, committed tree (HEAD))   exit=0
$ GITHUB_REF=refs/tags/v9.9.9 npm run version:check
version:check ✗ working tree and committed tree (HEAD): the release tag names 9.9.9 …   exit=1
$ GITHUB_REF=refs/tags/v0.4.0 npm run version:check
version:check ✓ every manifest is 0.4.0 (working tree, committed tree (HEAD))   exit=0
```

### Tests

`VITEST_MAX_THREADS=4 npx vitest run scripts` → **449 passed, 0 failed**. New:

- `scripts/release.test.ts` — argument parsing (keyword bumps rejected: the tag name has to be known
  before anything is written; unquoted headline rejected), commit/tag message shape, porcelain
  parsing incl. renames, and the stage/unexpected split.
- `scripts/version-sources.test.ts` — a real scratch git repo, both directions: a committed bump
  passes; the INFRA-022 shape (all manifests rewritten, only the root committed) passes the
  working-tree-only check and fails the pair, naming the seven files.
- `scripts/release-prepare.test.ts` — drives the real script against a scratch repo and asserts the
  **tag's** tree passes `checkVersionSources`, that the commit contains every manifest plus the
  lockfile, and each guard.
- `scripts/versions.test.ts` — `checkVersionSources` labelling, dedup across trees, tag guard.

`npx eslint scripts/` → clean. `tsc --noEmit -p scripts/tsconfig.json` → clean.
`npx prettier --check` on every touched file → clean.

### Known limits

- `release:prepare` never pushes and never deletes a tag. Both are typed by a human, under
  `docs/RELEASING.md`; a script that deletes remote tags is not something to have lying around.
- The `toStage.length === 0` guard is unreachable in practice — `npm version` refuses an unchanged
  version first (verified: the run stops at the bump, no commit, no tag). It is kept as defence and
  is covered as pure logic in `release.test.ts`.
- `version:check` reads `HEAD`, not the refs being pushed. For pre-push on the branch being pushed
  they are the same commit; a push of an older ref is not modelled.

### Review follow-up — PR #28 findings 5 and 8 (2026-08-07, opus, infra-dev)

**Finding 5 (MAJOR) — the gate-failure path left the INFRA-022 shape behind.** Reproduced against a
`cp -Rc` copy of this repo with a stub `pre-commit` that exits 1 (a stand-in for the gate's verdict,
not its checks). The script as reviewed:

```
release:prepare ▶ committing (the pre-commit gate runs now — this takes a few minutes)
pre-commit: tsc --noEmit failed in apps/server
release:prepare ✗ `git commit -m [RELEASE] v0.5.0 — forms and the release trap` failed
$ git status --porcelain -uno
M  apps/cli/package.json    M  apps/server/package.json   M  apps/ui/package.json
M  package-lock.json        M  package.json               M  packages/contract/package.json
M  packages/kit/package.json  M  plugins/_fixture/package.json  M  plugins/todos/package.json
$ git tag --points-at HEAD                                  # (none)
```

Nine files bumped **and staged**, no commit, no tag, no hints. And the retry, verbatim:

```
release:prepare ✗ the working tree has uncommitted changes: apps/cli/package.json, …
  commit or stash them first — a release commit contains the version bump and nothing else
```

**Chose unwind over hints.** Hints only fix the first message; the second one — the dirty-tree
refusal a retry meets — still says "commit or stash them first", which is the one thing that must
not be done with a leftover bump, and no hint on the *first* command can reach the person who has
already typed the second. Unwinding removes the state that produces the wrong advice instead of
annotating it. The clean-tree precondition is what makes it safe: `git status --porcelain -uno`
covers the index too, so index and worktree both matched `HEAD` before `npm version` ran and every
tracked modification afterwards is npm's, never the user's. The cost is a re-reified `node_modules`
on retry, which the retry's own `npm version` does anyway. The tag-only-from-a-verified-commit rule
is untouched: unwinding happens strictly *before* any commit exists.

Every failure between the bump and the commit now goes through `unwindAndFail`, with one deliberate
exception — the "bump touched files that are not manifests" abort. There the script has just
discovered it does not model what `npm version` did, and those files are the only record of it;
discarding them is the reader's call, so it prints the exact restore command instead.

After, on the same copy and the same failing gate:

```
release:prepare ✗ the release commit failed — the pre-commit gate runs here, so its output is above
  nothing was committed and no tag was created; the bump was undone (9 file(s) restored)
  fix what it reported, then re-run: npm run release:prepare 0.5.0 "forms and the release trap"
$ git status --porcelain -uno     # (empty)
$ node -p "require('./package.json').version"   → 0.4.0
$ git tag --points-at HEAD         # (none)
```

Then, with the gate fixed, the retry is simply the first run again — no dirty-tree refusal:

```
release:prepare ✓ [RELEASE] v0.5.0 — forms and the release trap committed and tagged v0.5.0
$ git show --stat --pretty= HEAD    → 9 files changed, 17 insertions(+), 17 deletions(-)
$ git checkout --detach refs/tags/v0.5.0
$ GITHUB_REF=refs/tags/v0.5.0 npm run version:check
version:check ✓ every manifest is 0.5.0 (working tree, committed tree (HEAD))   exit=0
```

`docs/RELEASING.md` → **Recovery: `release:prepare` stopped** carries it, including the
"do not hand-commit a leftover bump" case and the restore command.

**Finding 8a — the lockfile rode in unreviewed.** `expectedBumpPaths` still lists
`package-lock.json` (the bump does rewrite it), but *what* it may contain is now checked:
`classifyLockfileChange` diffs `HEAD:package-lock.json` against the bumped one and allows only
`version` fields moved to the release version. Anything else aborts and unwinds. Demonstrated on the
repo copy with a lockfile drifted from the manifests (a stray `node_modules/leftpad` entry that the
bump's install prunes):

```
release:prepare ✗ package-lock.json changed beyond the version bump — the release commit would carry it unreviewed
    packages["node_modules/leftpad"]
  nothing was committed and no tag was created; the bump was undone (9 file(s) restored)
  the bump runs an install, so a lockfile that had drifted gets repaired here; …
  run `npm install`, commit the lockfile, then re-run: npm run release:prepare 0.5.0 "…"
```

No false positive on a healthy lockfile: the successful rehearsal above committed an 18-line
lockfile diff (nine `version` fields) and the check passed it.

**Finding 8b — the header lied about "joins the check by existing".** Chose to make the check total
rather than to build a glob engine: `selectWorkspaceManifests` now returns `{ selected, unsupported }`,
`VersionSource.unsupportedGlobs` carries the second, and both `version:check` and `release:prepare`
**fail** on it. A real glob matcher would have to be paired with a directory walk on the disk side to
keep the two readers selecting identical sets, and that walk's skip rules are a fresh source of the
same silent-omission bug. Refusing what is not understood cannot omit anything.

The non-coverage was real, not theoretical — same repo copy, `workspaces: [… "plugins/**"]` and
`plugins/todos` drifted to 9.9.9:

```
--- BEFORE (version-sources.ts as committed) ---
version:check ✓ every manifest is 0.4.0 (working tree, committed tree (HEAD))   exit=0
--- AFTER ---
version:check ✗ working tree and committed tree (HEAD): the workspaces glob "plugins/**" is not a
  form this check resolves, so any workspace it selects is unchecked — declare it as an exact path
  or `<dir>/*`, or teach scripts/version-sources.ts the form                    exit=1
$ npm run release:prepare 0.5.0
release:prepare ✗ cannot resolve every workspaces glob: plugins/**
  a workspace one of them selects would be bumped by npm but neither staged nor version-checked
```

The real repo, with its real `plugins/*`, is unaffected: `version:check ✓ every manifest is 0.4.0`.

**Tests** — `VITEST_MAX_THREADS=4 npx vitest run scripts` → **478 passed, 0 failed** (was 449; +29).
New: the gate-failure unwind and the retry-just-works pair, the lockfile refusal, and the
unsupported-glob refusal in `release-prepare.test.ts` (all against a real scratch repo with a real
failing hook); `classifyLockfileChange` in `release.test.ts`; the `unsupported` channel and a
committed `plugins/**` drift in `version-sources.test.ts`.
`npx eslint scripts/`, `tsc --noEmit -p scripts/tsconfig.json`, `prettier --check` → clean.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[ISSUE-ID]` prefix — `930919f7 [INFRA-022] Release bump commits every
      workspace manifest, or fails locally` (its body under-lists the changed files; noted by the
      PR #28 reviewer, message-only, no code impact)
