# [CLI-034] `corpus upgrade --unstable` installs the latest PR build

## Domain

cli

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SHARED-038 (rider must be signed first), INFRA-026 (the artifact
  naming scheme this command parses)
- Blocks: —
- Related: INFRA-026 records what the Package workflow does for fork PRs

## Spec References

- SPEC.md §2.4 line 84 — "Upgrading", as amended by SHARED-038 (rider pending
  sign-off): the stable path's guarantees, and the unstable path's stated
  deviations from them
- SPEC.md §9.2 line 403 — `POST /api/upgrade`

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

- [x] `corpus upgrade --unstable --check` reports the newest PR build available
      — naming the **PR number**, the version, the short SHA and the build's age
      — and compares it to what is installed, without installing anything
- [x] `corpus upgrade --unstable` installs it through the same npm-global
      reinstall path the stable upgrade uses, with the same install-method
      detection and the same refusal-with-instructions when it cannot be detected
- [x] Bare `corpus upgrade --unstable` installs **the newest artifact across all
      open PRs** (user decision, 2026-08-08), and names the PR it chose before
      installing — the choice is never silent, because the newest build is not
      always the user's own
- [x] `corpus upgrade --unstable <PR#>` installs that PR's newest build instead,
      and reports clearly when that PR has no usable artifact rather than
      falling back to another PR's
- [x] Without a usable token the command **refuses with instructions** (how to
      set one, and that stable `corpus upgrade` needs none) — it never falls back
      to the stable release silently
- [x] The command states plainly, every time it installs, that this is an
      unverified pre-release build: no published checksum, not a release, and
      how to get back (`corpus upgrade` reinstalls the newest stable)
- [x] Installing an unstable build is **recorded** — the upgrade journal
      (`apps/cli/src/commands/upgrade/journal.ts`) must show which PR build is
      installed, or "which build am I running?" becomes unanswerable after the
      fact
- [x] A fork PR's artifact is refused (or explicitly opted into with a further
      flag) — a fork build is untrusted code; INFRA-026 records what the workflow
      actually does for forks
- [x] An expired or missing artifact is reported as the ordinary answer it is,
      naming the retention window
- [x] The conditional server restart behaves exactly as it does on the stable
      path
- [x] `docs/cli.md` regenerates cleanly with the new flag (the §11 drift check)
- [x] Stable `corpus upgrade` is behaviourally unchanged — same endpoint, same
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

## Decisions

**The lookup is forked; the install is shared.** `unstable.ts` shares nothing
with the release lookup, which is what keeps the stable path's guarantees
intact. The shared install half branches in exactly **four** places, each named
in the code: the release list was not consulted so its unreachability is not a
failure, the version comparison does not apply, the checksum verification cannot
run, and the download is a zip. Everything else — install-method detection, the
undetectable and unwritable refusals, the stop, the npm path, the template sync,
the interrupt handling, the conditional restart — is the same code.

**`--unstable` does not consult the release list at all.** Asking anyway would
double the failure surface of a command that has already been told what to
install. `check.reachable` is `false` on that path and its `detail` says *"the
release list was not consulted"* — which is the truthful reading of a list
nobody looked at, and does not read as a network failure.

**One request answers both the name and the origin.** `GET
/repos/{repo}/actions/artifacts` carries `workflow_run.repository_id` and
`head_repository_id` on every entry, verified against the real API before the
code was written. So the fork test needs no second call, and a build that
**cannot** say where it came from is treated as one that came from elsewhere —
the safe reading, since INFRA-026 established that a fork's PR does run and does
upload.

**The zip reader is hand-written, about sixty lines.** The scope is what makes
that reasonable: one archive, from one workflow, holding one `npm pack` tarball.
It walks the central directory rather than the local headers — the local header's
sizes may be deferred to a data descriptor — and supports stored and deflate,
refusing anything else by name rather than mis-decoding it. Rejected: a zip
dependency, for one call site on a path that must not grow the published
package's dependency tree.

**`sha256` is recorded and never compared.** The field the stable path fills with
a verified digest is filled here with the digest of what arrived, so a run stays
identifiable — and the word printed is "downloaded … unverified", never
"verified", because the stable path's word would be a claim this path cannot
make.

**A build older than what is installed is installed anyway.** `--unstable` is
almost always a sideways move — a branch carries `main`'s version until a release
bumps it — so blocking a "downgrade" would block the ordinary case. It cannot be
reached implicitly: the flag was typed.

**The search is bounded at five pages, and says so.** The artifact list mixes
every workflow's output and coverage bundles outnumber PR builds, so one page is
not always enough. When the bound is reached the command says the search stopped
short — a bounded search reporting "no build" indistinguishably from an
exhaustive one is a lie by omission.

**`--allow-fork` rather than a silent refusal.** A fork's build is untrusted code
and installing it globally runs it on this machine, so the default is off; but
refusing with no way through would make the flag a wall rather than a decision.

## E2E Verification Log

Run by the orchestrator on **opus** (Claude Opus 5), 2026-08-26.

**Semantics decided**: bare `--unstable` takes the newest build across open pull
requests by **artifact creation time** — not by pull-request number, because the
highest-numbered PR is frequently not the most recently pushed — and names the PR
before installing. `--unstable <pr>` takes that pull request's newest build and
reports plainly when it has none.

**The API shape was verified against the real repository before the code was
written**, not assumed: `gh api repos/trupin/corpus/actions/artifacts` returns
`workflow_run` carrying `repository_id` and `head_repository_id` on every entry,
which is what makes the fork test a property of the same request that finds the
build.

**Unit**: 135 tests across `unstable.test.ts` (30) and `index.test.ts`. The zip
reader is tested against real bytes — a zip assembled by hand in the test, both
stored and deflated — rather than against a fixture file.

**Falsified.**

- Accepting a fork's build (`if (false)` in place of the origin check) turns **2**
  tests red, including the one that pins an unattributable build as foreign.
- Removing the `--unstable` branch from `runUpgrade`, so the command silently
  falls back to the release path, turns **8** red.

**The stable path is asserted unchanged by request equality**, not by claim: a
stable run issues exactly

```
https://api.github.com/repos/trupin/corpus/releases/latest
https://example.test/corpus-0.4.0.tgz.sha256
https://example.test/corpus-0.4.0.tgz
```

and reaches no artifact API at all. `result.unstable` is `null` and
`check.verifiable` is `true`.

**Against a real pull request** — this phase's own PR #65, whose Package run
produced `corpus-0.24.0-pr65-7eb8396` (INFRA-026's scheme, verified live):

```
$ corpus upgrade --unstable --check
corpus 0.24.0 → PR #65 — corpus 0.24.0, commit 7eb8396, built 10 minutes ago
  artifact: corpus-0.24.0-pr65-7eb8396
  This is a pre-release build from CI, not a published release. It carries no
  checksum, so the verification `corpus upgrade` performs did not run.
  `corpus upgrade` reinstalls the newest stable release.
  NOT installable here: it is not installed under a node_modules directory
  (a source checkout, or an unpacked build)
nothing was downloaded, installed or written (--check).
```

`--unstable 65 --check --json` carries the whole choice as data —
`{"pr":65,"version":"0.24.0","sha":"7eb8396","artifactName":"corpus-0.24.0-pr65-7eb8396",
"createdAt":"2026-08-26T23:00:36Z","checksumVerified":false}` — with `check.reachable`
false and its detail saying the release list *was not consulted*, and
`tool.installed` false.

With `gh` off `PATH` and neither variable set:

```
$ corpus upgrade --unstable
corpus: --unstable needs a GitHub token with `actions: read`, and none was found
  Workflow artifacts are not anonymously downloadable, even on a public
  repository. Sign in with `gh auth login`, or set CORPUS_GITHUB_TOKEN (or
  GITHUB_TOKEN) to a token with `actions: read`. Nothing was downloaded or
  installed. `corpus upgrade` without the flag installs the newest published
  release and needs no token.
```

Exit 7, nothing downloaded, and no fallback to a release.

**Two defects the real run found, that no review had.**

1. `--check` printed the raw ISO timestamp where the acceptance criterion asks
   for the build's **age**. It now says *"built 10 minutes ago"* in the human
   line and keeps `createdAt` absolute in the JSON, where a machine wants an
   instant rather than a phrase.
2. The undetectable-install refusal offered
   `npm install -g <artifact zip URL>` — a line that **cannot work**, because a
   PR build's URL is an artifact zip behind an authenticated API rather than a
   tarball. `refuseUndetectable` and `refuseUnwritable` now take an override, and
   the unstable path hands over the two steps that do work. "Instructions that
   are not runnable are not instructions" was already written in that function's
   own doc comment; it had acquired a second reader.

**A real install was deliberately not performed on this machine.** It would
replace the operator's global `corpus` with an unreleased build mid-release, and
the acceptance criterion it would prove — that the install goes through the same
npm-global path — is the shared code the stable path already exercises, asserted
in the suite by the tarball handed to `npm` being the unwrapped `.tgz`. This is
stated rather than quietly skipped.

**Docs**: `npm run docs:cli -w apps/cli` regenerated `docs/cli.md` with the new
flag and positional; the §11 drift check is clean. `spec:check` passes over 7,383
citations.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence against a real PR
- [x] `docs/cli.md` regenerated
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] `/audit` run (security-sensitive: installs unsigned code from CI artifacts)
- [x] `/evaluate` passes
- [x] Committed with `[CLI-034]` prefix
