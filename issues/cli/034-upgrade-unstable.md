# [CLI-034] `corpus upgrade --unstable` installs the latest PR build

## Domain

cli

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: INFRA-026 (the artifact naming scheme this command parses)
- Blocks: —
- Related: SHARED-033 (the §2.4 rider, if the sign-off decides one is needed)

## Spec References

- SPEC.md §2.4 line 84 — "Upgrading": `corpus upgrade --check`, `corpus upgrade`,
  the Releases API, checksum verification, the reinstall path, the conditional
  restart
- SPEC.md §9.2 line 401 — `POST /api/upgrade`

## Summary

`corpus upgrade` installs the newest **published release**:
`lookupLatestRelease` hits `/releases/latest`, whose doc comment states the
choice plainly — *"GitHub excludes drafts and pre-releases from it, and a
pre-release is not what 'upgrade me' means"*. There is no way to install a build
that has not been released, which is exactly what dogfooding a PR needs.

The user asked (2026-08-08) for `corpus upgrade --unstable` to install **the
latest PR-uploaded package** — the tarball `.github/workflows/package.yml`
attaches to every PR — with PR-numbered names (INFRA-026) so builds cannot be
confused.

## The constraint that shapes this issue

**GitHub Actions artifacts are not anonymously downloadable, even on a public
repository.** `GET /repos/{owner}/{repo}/actions/artifacts/{id}/zip` requires an
authenticated token with `actions: read`. The stable path needs no credential;
this one does. That is not a detail to discover during implementation — it
decides the command's whole failure surface, and the user chose this source
knowing the trade-off.

Consequences to design for, not work around:

- A token must be found or the command refuses. `gh auth token` when the GitHub
  CLI is present, or an env var (`CORPUS_GITHUB_TOKEN` / `GITHUB_TOKEN`).
- Artifacts expire after **14 days** (INFRA-026), so "the latest PR build" is
  routinely absent for an older PR. That is a normal answer, not an error.
- Artifacts are **zips containing** the tarball, not the tarball. One more
  unwrap step than the release path.
- There is **no published checksum** for an artifact the way there is for a
  release asset. §2.4 promises checksum verification on the stable path; this
  path cannot offer the same guarantee, and the command must say so rather than
  quietly skipping a step the spec advertises.

## Acceptance Criteria

- [ ] `corpus upgrade --unstable --check` reports the newest PR build available
      — naming the **PR number**, the version, the short SHA and the build's age
      — and compares it to what is installed, without installing anything
- [ ] `corpus upgrade --unstable` installs it through the same npm-global
      reinstall path the stable upgrade uses, with the same install-method
      detection and the same refusal-with-instructions when it cannot be detected
- [ ] `--unstable` accepts an optional PR number (e.g. `--unstable 42`) to
      install a specific PR's build rather than the newest across all PRs.
      **Decide and record** whether bare `--unstable` means "newest artifact
      across all open PRs" or requires the number — "latest PR" is ambiguous
      when three PRs are open, and guessing wrong makes the command dangerous
- [ ] Without a usable token the command **refuses with instructions** (how to
      set one, and that stable `corpus upgrade` needs none) — it never falls back
      to the stable release silently
- [ ] The command states plainly, every time it installs, that this is an
      unverified pre-release build: no published checksum, not a release, and
      how to get back (`corpus upgrade` reinstalls the newest stable)
- [ ] Installing an unstable build is **recorded** — the upgrade journal
      (`apps/cli/src/commands/upgrade/journal.ts`) must show which PR build is
      installed, or "which build am I running?" becomes unanswerable after the
      fact
- [ ] A fork PR's artifact is refused (or explicitly opted into with a further
      flag) — a fork build is untrusted code; INFRA-026 records what the workflow
      actually does for forks
- [ ] An expired or missing artifact is reported as the ordinary answer it is,
      naming the retention window
- [ ] The conditional server restart behaves exactly as it does on the stable
      path
- [ ] `docs/cli.md` regenerates cleanly with the new flag (the §14 drift check)
- [ ] Stable `corpus upgrade` is behaviourally unchanged — same endpoint, same
      checksum verification, same output

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/upgrade/release.ts` — a second lookup alongside
  `lookupLatestRelease`; do not overload the release lookup with an artifact mode
- `apps/cli/src/commands/upgrade/install.ts` — the extra unwrap (zip → tarball)
- `apps/cli/src/commands/upgrade/index.ts` — the flag, the refusals, the warning
- `apps/cli/src/commands/upgrade/journal.ts` — record the PR build
- the command registry entry (§2.3) so `--help` and `docs/cli.md` document it

### Key Implementation Details

Keep the two sources genuinely separate. The stable path's guarantees — a
published release, a verified checksum, no credential — are the reason people
trust `corpus upgrade`, and the way to keep them is to not thread an `unstable`
boolean through the middle of that code. Share the *install* half; fork the
*lookup* half.

`CORPUS_RELEASES_API` already exists as an override (`release.ts:29`, and its
tests) — the artifact lookup needs the equivalent so it is testable without
hitting GitHub.

### Edge Cases

- A PR with no successful Package run — no artifact; report it as such
- A PR whose newest run failed but has an older successful artifact — decide
  whether "latest" means latest run or latest *successful* artifact, and say so
- A token that is present but lacks `actions: read` — a 403, distinguishable from
  "no token" in the message
- An artifact whose name does not match INFRA-026's scheme (an older build made
  before that landed) — skipped, not crashed on
- Downgrading: a PR build older than the installed stable version. The stable
  path compares versions and declines to downgrade; `--unstable` almost always
  *is* a sideways move and must not be blocked by that comparison

## Testing Strategy

Vitest with a stubbed fetch, mirroring `index.test.ts`'s existing approach: the
artifact listing is parsed and the newest build for a PR chosen; a missing token
refuses with instructions; a 403 is distinguished from a 401; an expired artifact
reports the retention window; the zip unwrap yields the tarball the install path
expects; the journal records the PR. Assert the stable path's requests are
byte-identical to today's.

## E2E Verification Plan

### Verification Steps

1. Open (or reuse) a real PR and let Package produce a PR-numbered artifact
2. `corpus upgrade --unstable --check` — confirm it names the PR, version, SHA
   and age, and installs nothing
3. `corpus upgrade --unstable` with a valid token — confirm the install
   succeeds, `corpus --version` reflects the build, the journal records the PR,
   and the unverified-build warning was printed
4. With the workspace's server running beforehand, confirm it is restarted
   against the same workspace
5. Unset the token and re-run — confirm the refusal names how to set one and does
   **not** fall back to stable
6. `corpus upgrade` (no flag) — confirm it reinstalls the newest stable release
   and that its output is unchanged from before this issue
7. Request a PR whose artifact has expired — confirm the reported answer
8. `npm run generate` for `docs/cli.md` — confirm no drift

## E2E Verification Log

_[Agent fills: model run on, the `--unstable` semantics decided, commands,
observed output.]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence against a real PR
- [ ] `docs/cli.md` regenerated
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (security-sensitive: installs unsigned code from CI artifacts)
- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-034]` prefix
