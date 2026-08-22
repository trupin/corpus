# Releasing Corpus

Releases are deliberate. Merging to `main` produces nothing but a green `CI / validate`; a release
happens only when someone decides one should, and the decision is expressed as a pushed `v*` tag.

One version number describes the whole tool — the root `package.json`'s `version`, matched by every
workspace manifest. That is the **version singularity** (INFRA-008), and `npm run version:check`
enforces it in pre-push, in CI, and in the release workflow, where it is also the tag guard.

## Cutting a release

```sh
npm run release:prepare <x.y.z> "what this release is"   # bump + commit + verify + tag, locally
git push origin HEAD                                     # the release commit
git push origin v<x.y.z>                                 # the tag — this starts the release
```

`release:prepare` takes an explicit `x.y.z` (not `patch`/`minor`/`major`), because the tag it is
going to create has to be known before anything is written. The title is optional and quoted; it
becomes the headline of both the commit and the tag, matching the release commits already on `main`
(`[RELEASE] v0.3.0 — comments that stay where you put them`). The script:

1. refuses to start if the working tree has tracked modifications, if `v<x.y.z>` already exists, or
   if the root manifest declares a `workspaces` glob the version guard cannot resolve;
2. runs `npm version <x.y.z> --workspaces --include-workspace-root --no-git-tag-version`;
3. stages the root manifest, the lockfile and **every** workspace manifest — by name, never `-A`;
   anything else the bump touched aborts the run instead of riding along, and the lockfile is
   checked to have moved nothing but `version` fields;
4. makes one commit (the pre-commit gate runs; this takes a few minutes);
5. re-reads the manifests **out of that commit** and refuses to tag it if they disagree;
6. creates the annotated tag, and stops. Pushing is yours.

Every failure between step 2 and step 4 **undoes the bump** before it reports: a run that does not
finish leaves the tree as it found it. See _Recovery: `release:prepare` stopped_ below. What is not
traded away for that tidiness: the tag is still only ever created from a commit whose tree has
already passed step 5.

Release commits go **directly to `main`** — they are bookkeeping, not a change under review, and
every previous one (`v0.1.0`…`v0.4.0`) landed that way. Cut them from an up-to-date `main`, after the
phase PR they are releasing has merged; the script does not check the branch, so that part is on you.
Push the commit before the tag: a tag whose commit is not on the remote releases a commit nobody can
see.

### Why the wrapper exists

The procedure used to be `npm version <x.y.z> --workspaces --include-workspace-root` on its own, and
that command does not do what the sentence implies. It rewrites every workspace manifest, then
commits only `package.json` and `package-lock.json`, then tags that commit. The seven workspace
manifests are left uncommitted, and the tag points at a tree where only the root version moved.

`npm version` is not misbehaving by its own lights — it is a single-package command whose git step
has always meant "commit the version of _this_ package", and `--workspaces` extends the rewriting,
not the committing. It has no way to know this repo declared one version for all of them.

What made it cost a release rather than a minute was that the local check passed: `version:check`
read the working tree, where all seven manifests were already correct. v0.4.0 was tagged, pushed,
and died on the release workflow's first step. Both halves are fixed: `version:check` now reads the
working tree **and** the committed tree, so the same mistake fails locally, and `release:prepare`
removes the ordering that produced it. INFRA-022.

## What pushing the tag does

`.github/workflows/release.yml` triggers on `v*` tags only. It re-runs the whole validate gate
(version check with the tag guard, build, artifact drift, lint, format, typecheck, unit tests, e2e,
the merged ≥ 90% coverage gate), then `package:build` → `pack:check` → `npm pack`, and finally
creates a GitHub Release with the tarball and its `.sha256` attached. It does **not** publish to npm;
distribution is the repo-hosted tarball.

The steps are ordered inside one job, so a failure anywhere stops everything after it. In particular
a failure before `gh release create` means **nothing was published** — the tag is orphaned, not
half-released.

## Recovery: `release:prepare` stopped

The ordinary failure, and the one worth knowing by heart. `release:prepare` runs the pre-commit gate
— lint, typecheck, the whole unit suite — as part of making the release commit, and a gate failing is
not an exotic event. **Nothing is committed and no tag exists**, so nothing needs undoing by hand:
the run already restored every manifest and the lockfile before it printed.

```
release:prepare ✗ the release commit failed — the pre-commit gate runs here, so its output is above
  nothing was committed and no tag was created; the bump was undone (9 file(s) restored)
  fix what it reported, then re-run: npm run release:prepare 0.5.0 "the headline"
```

Fix what the gate reported, commit that fix like any other change, and run the same
`release:prepare` command again. There is nothing release-specific to clean up first.

**Do not hand-commit a leftover bump.** If a run ever does leave bumped manifests behind — the undo
itself failed, or you interrupted the run — the message names the command that clears them:

```sh
git restore --staged --worktree -- package.json package-lock.json apps/*/package.json packages/*/package.json
```

Committing them instead produces a commit with neither the `[RELEASE]` subject nor a tag, which is
precisely the INFRA-022 shape this script exists to prevent.

Two other stops need a decision rather than a retry:

- **`package-lock.json changed beyond the version bump`** — the bump runs an install, and the
  install repaired a lockfile that had drifted from the manifests. The repair is probably fine, but
  it is a change to review, not to smuggle into a commit whose subject promises a version bump and
  nothing else. Run `npm install`, commit the lockfile on its own, then re-run.
- **`cannot resolve every workspaces glob`** — the root manifest declares a `workspaces` entry the
  version guard does not resolve (`tools/**`, `apps/{a,b}`, `!apps/_fixture`). npm would bump
  the workspaces it selects; nothing would stage or check them. Declare them as an exact path or
  `<dir>/*`, or teach `scripts/version-sources.ts` the form.

## Recovery: the tag is pushed and the release failed

This is the situation INFRA-022 was filed from. Work in this order.

**1. Establish whether anything was published.** Nothing below is safe until you know.

```sh
gh release view v<x.y.z>            # "release not found" is the good answer
gh run list --workflow=release.yml --limit 5
```

- **No release exists** — the tag is orphaned. Continue; the tag can be moved.
- **A release exists** — stop. Do not move the tag: people may already have the tarball, and the
  checksum published beside it attests to those exact bytes. Fix forward with a new patch version.

**2. Fix the tree.** For the INFRA-022 failure that means committing the manifests the bump left
behind; for another failure it means whatever the workflow log says. Then confirm locally — this now
checks the committed tree, so a green answer means the tag's tree will be green too:

```sh
git status --porcelain
npm run version:check
git push origin HEAD
```

**3. Move the tag onto the fixed commit.** A re-run of the workflow will not help: the tag still
points at the bad tree, and that tree is what gets checked out.

```sh
git push origin :refs/tags/v<x.y.z>   # delete the remote tag
git tag -d v<x.y.z>                   # delete the local tag
git tag -a v<x.y.z> -m v<x.y.z>       # re-create it on the fixed commit
git push origin v<x.y.z>              # this starts a fresh release run
```

**4. Watch it.** `gh run watch` on the new run. When it goes green, `gh release view v<x.y.z>` shows
the tarball and the checksum.

### If you would rather not move a tag at all

Deleting a pushed tag is only safe while nothing consumes it, which is why step 1 comes first. The
always-safe alternative is to burn the version: leave the failed tag deleted or in place, and cut
`v<x.y.z+1>` from the fixed commit with `npm run release:prepare`. Version numbers are cheap.

## Related

| Command                   | What it does                                                    |
| ------------------------- | --------------------------------------------------------------- |
| `npm run release:prepare` | Bump, commit every manifest, verify the commit, tag             |
| `npm run version:check`   | Version singularity across the working tree and the commit      |
| `npm run package:build`   | Assembles the publishable package into `dist-package/`          |
| `npm run pack:check`      | Audits the tarball `npm pack` would produce, in both directions |
| `npm run publish:dry-run` | `npm publish --dry-run` over the staged package                 |

Every PR also builds the same tarball as a workflow artifact
(`.github/workflows/package.yml`), so an installable build exists without cutting a release.
