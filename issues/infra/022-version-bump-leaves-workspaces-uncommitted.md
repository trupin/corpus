# [INFRA-022] The documented release command leaves every workspace manifest uncommitted

## Domain

infra

## Status

todo

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

- [ ] The documented procedure produces a commit containing **every** manifest it
      changed, or the mechanism is replaced by one that does
- [ ] Running the documented steps in order cannot leave a `v*` tag pointing at a
      tree the guard would reject — verified by doing it, not by reading
- [ ] `npm run version:check` cannot pass locally while the committed tree would
      fail it. It reads the working tree today; if that stays, something else has
      to close the gap
- [ ] `CLAUDE.md`'s release paragraph matches what the commands actually do
- [ ] The recovery is written down: what to do when a tag is already pushed and
      the release failed before publishing anything

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

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
