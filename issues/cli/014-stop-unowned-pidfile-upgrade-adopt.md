# [CLI-014] `stop` unowned-pidfile deletion + `upgrade --adopt` manifest honesty

## Domain
cli

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CLI-009 (foreign-branch precedent), CLI-005 (upgrade)
- Blocks: —

## Spec References
- SPEC.md §13 — server lifecycle (stop semantics)
- SPEC.md §13 — workspace upgrade

## Summary
Two PR #11 review findings on apps/cli, both adjudicated **fix** by the orchestrator:

1. **Finding 13 (stop.ts)**: the `unowned` branch
   (`apps/cli/src/commands/server/stop.ts:46-59`) still deletes a live pid's pidfile —
   the exact "may be this workspace's server on a previously configured port" argument
   CLI-009 used to make the `foreign` branch conservative; CLI-009's log escalated this
   branch rather than deciding it. Adjudication: apply the same treatment — never
   delete a pidfile whose pid is alive; report instead.
2. **Finding 12 (upgrade --adopt)**: on a pre-manifest workspace, the adopt path
   (`apps/cli/src/commands/workspace/upgrade.ts:175-181` with
   `template/plan.ts:170-189`) skips `applyPlan` but `nextManifestFiles` still records
   the incoming sha for files that were never installed. The plan prints
   `install <path>` that never happens, the baseline manifest claims a file not on
   disk, and later runs misreport it as user-deleted. Untested cell.

## Acceptance Criteria
- [x] `stop` `unowned` branch: pidfile of a live pid is never deleted; the command reports the situation (mirroring the `foreign` branch's wording/behavior from CLI-009); dead-pid cleanup unchanged
- [x] `upgrade --adopt` on a pre-manifest workspace: the recorded manifest matches reality — a template file absent from disk is not recorded as installed, and the printed plan lists only actions actually taken (decide: either genuinely install missing files under --adopt, or exclude them from `nextManifestFiles` and report them as pending — pick the semantics most consistent with what `--adopt` promises in its help text/docs, and justify in the log)
- [x] A later `upgrade` run after an adopt no longer misreports never-installed files as user-deleted
- [x] Tests cover both: live-pid unowned pidfile preserved; adopt-on-pre-manifest cell (manifest content, plan output, subsequent-run classification)

## Technical Design

### Files to Create/Modify
- `apps/cli/src/commands/server/stop.ts`
- `apps/cli/src/commands/workspace/upgrade.ts`, `apps/cli/src/template/plan.ts`
- colocated tests

### Key Implementation Details
Read CLI-009's issue file and log first — the `foreign` branch is the behavioral
template for the `unowned` fix. For --adopt, keep `--dry-run` writing nothing.

### Edge Cases
- Unowned pidfile whose pid died → still cleaned up (current behavior for dead pids stands).
- Adopt where *some* template files exist on disk and some don't — mixed recording must be per-file.

## Testing Strategy
apps/cli scoped tests (VITEST_MAX_THREADS=4).

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Scratch workspace (explicit --workspace path). For stop: craft an unowned pidfile pointing at a live pid; run `corpus server stop`; observe the pidfile deleted. For upgrade: strip the manifest, delete one template file, run `upgrade --adopt`; observe the manifest recording the missing file and a later run calling it user-deleted.

### Verification Steps
1. Rebuild the CLI; repeat both drills — pidfile preserved with a report; manifest matches disk and the follow-up run classifies correctly.

## E2E Verification Log

**Implemented on: opus.** 2026-07-29/30. Real `@corpus/server` daemons, real pidfiles, real git
workspaces, from-source CLI. Scratch root `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/cli014`,
workspaces `ws-stop` (:9181), `ws-adopt` (:9183), `ws-adopt2` (:9184), `ws-adopt3` (:9185).

### Incident: a drill escaped into the repo (live evidence for CLI-013)

The first attempt ran `corpus init --workspace <scratch> --port 9181` with the repo as cwd. `init`
takes its target as a **positional** and ignores `--workspace`, so it scaffolded
`/Users/theophanerupin/code/corpus` itself: template files over the repo's `README.md` and
`.gitignore`, product skills into `.claude/skills/`, a `.corpus/`, and a `git add -A`-scale index.
`commitAll` then tripped the repo's own pre-commit hook (which ran the full 6466-test suite, ~77s)
and was blocked; `CreatedPaths.unwind()` removed what it *created* but cannot restore what it
**overwrote** (`writeFile`/`copyFile` record a path only when `!existed`), so the two clobbered files
survived the rollback. The orchestrator repaired the repo (index reset, both files restored,
`.corpus/` removed). This is CLI-013's bug reproduced by accident and is **not** fixed here. Every
later invocation went through a subshell `cd`'d into the scratch workspace, and the repo was
re-checked clean afterwards (`.corpus` absent, `.claude/skills` back to the nine harness skills).

### Finding 13 — `stop` deleted a live pid's pidfile

Reproduction, the CLI-009 scenario reached by the shorter route: a real daemon started on :9181, then
`port` in `.corpus/config.json` re-pointed at :9182 (nothing there) — a copied config, an exported
`CORPUS_PORT`. The probe gets no answer, so the state is `unowned`.

```
$ corpus server start        # → corpus 0.0.0 listening on http://127.0.0.1:9181 (pid 16608)
$ # .corpus/config.json: port 9181 → 9182
$ corpus server status
pid 16608 is alive but is not answering on :9181
status exit=6
$ corpus server stop
not running (stale pidfile removed) — pid 16608 is alive but is not this workspace's server, and was left alone
stop exit=0
$ ls .corpus/server.pid   → No such file or directory
$ curl :9181/api/health   → 200          # the daemon never stopped
```

The harm, config put back the way it was — identical to CLI-009's:

```
$ # .corpus/config.json: port 9182 → 9181
$ corpus server status → corpus: the workspace server is not running   (exit 6)
$ corpus server stop   → not running                                    (exit 0)
$ curl :9181/api/health → 200      # live, serving, and unreachable to the CLI forever
```

After the fix (fresh daemon, pid 26349 on :9181, `port` re-pointed at :9182):

```
$ corpus server stop
not stopped — pid 26349 is alive but nothing answered on :9182, and it was left alone
  Its pidfile was kept: pid 26349 was started on :9181, so it may be this workspace's own server. Point `port` in .corpus/config.json back at 9181 and stop again, or stop pid 26349 directly.
stop exit=0

$ cat .corpus/server.pid
{ "pid": 26349, "port": 9181, "startedAt": "2026-07-30T03:45:38.261Z", "version": "0.0.0" }

$ corpus server stop --json
{"stopped":false,"running":false,"reason":"pid alive but not answering","pidfileKept":true,"pid":26349,"pidfilePort":9181}
exit=0
$ curl :9181/api/health → 200      # untouched, still serving

$ # follow the message's own advice: port 9182 → 9181
$ corpus server stop → stopped (pid 26349);  .corpus/server.pid → No such file or directory
```

The other two cells of the branch. A live pid whose pidfile port **equals** the configured port
(wedged, or a reused pid) gets the remedy that actually applies there — re-pointing `port` would be
nonsense advice — and its file is still kept; a dead pid's file is still cleanup, unchanged:

```
$ sleep 300 &                     # pid 26553 stands in for the live process; :9181 free
$ corpus server stop
not stopped — pid 26553 is alive but nothing answered on :9181, and it was left alone
  Its pidfile was kept: pid 26553 was started on :9181, so it may be this workspace's own server, wedged or still shutting down. Check it with `ps -p 26553` and stop it directly if it is; once that pid is gone, `corpus server stop` removes the file.
stop exit=0                        # .corpus/server.pid still present

$ kill 26553; corpus server stop
not running (stale pidfile removed)
$ ls .corpus/server.pid → No such file or directory
```

### Finding 12 — `--adopt` recorded files it never installed

Reproduction in `ws-adopt`: a real `corpus init` workspace made pre-manifest (manifest deleted), one
template file removed so the tool carries a file the workspace has never had
(`.claude/skills/comment/SKILL.md`), and one file edited (`data/docs/views/inbox.md`) to keep the
mixed case in view.

```
$ corpus workspace upgrade --adopt
upgrade (tool unknown → 0.0.0):
  install .claude/skills/comment/SKILL.md          ← never happened
  keep    data/docs/views/inbox.md — modified here — 1 line only here, 21 lines only in the new copy
wrote a fresh baseline manifest; ... Commit dcca8c38.
$ node -p "manifest.files.map(f=>f.path)"   → includes .claude/skills/comment/SKILL.md
$ ls .claude/skills/comment/SKILL.md        → No such file or directory

$ corpus workspace upgrade            # the run after
  deleted .claude/skills/comment/SKILL.md — deleted from this workspace; pass --restore to reinstall it
$ corpus workspace upgrade --restore --json
{... "written":[".claude/skills/comment/SKILL.md"] ...}   # "restoring" a file that never existed here
```

**Semantics chosen: `--adopt` records, and installs nothing** (the second option in the acceptance
criteria). Justification: the flag's own help text — "record a baseline from the files that already
match the tool's copies" — and the verb's summary line ("wrote a fresh baseline manifest") describe a
**recording** operation, not a writing one. Keeping it that way makes the invariant of a
baseline-less workspace flat and testable — *no run writes a workspace file until a baseline exists,
`--adopt` included* — where installing-sometimes would make "does adopt write?" a per-file question.
It also loses nothing: after the adopt the workspace **has** a baseline, so the very next ordinary
`corpus workspace upgrade` installs the missing file for real, in a proper commit, through the normal
`install` path. And the alternative would have `--adopt` mutate a legacy workspace on the first
command an operator runs after a tool update — the moment they are being most careful. Consequently
the printed plan labels those rows **`pending`**, not `install`, in *any* pre-manifest run (with or
without `--adopt`), since no such run installs anything.

After the fix (`ws-adopt2`, same setup):

```
$ corpus workspace upgrade                       # the plan that precedes --adopt
  pending .claude/skills/comment/SKILL.md — the tool has it, this workspace does not; nothing is written without a baseline, so --adopt first, then upgrade again to install it
  keep    data/docs/views/inbox.md — modified here — 1 line only here, 21 lines only in the new copy
nothing was written. Re-run with --adopt to record a baseline from the files that already match.

$ corpus workspace upgrade --adopt
  pending .claude/skills/comment/SKILL.md — ...
  keep    data/docs/views/inbox.md — ...
wrote a fresh baseline manifest; ... Commit 3bdc30cc.
  --adopt installs nothing, so 1 file the tool carries and this workspace does not have stayed out of the manifest as well as off the disk. Run `corpus workspace upgrade` again, now that there is a baseline, to install it.

$ node -p "manifest.files.map(f=>f.path).sort()"
.claude/skills/fixture-notes/SKILL.md   .claude/skills/orchestrate/SKILL.md
.claude/skills/todos/SKILL.md           .gitignore
README.md                               data/docs/templates/note.md
data/docs/views/attention.md            data/docs/views/open-threads.md
```

Eight entries, and every one of them is on disk: the never-installed file is out (as is the edited
`inbox.md`, which has no baseline either) — per-file, not per-run. The follow-up run then does the
real thing instead of crying deletion:

```
$ corpus workspace upgrade
  install .claude/skills/comment/SKILL.md
  keep    data/docs/views/inbox.md — ...
wrote 1 file in commit dddb6285.
$ shasum -a 256 .claude/skills/comment/SKILL.md → ab4988c14d32…   == manifest sha ab4988c14d32…
$ corpus workspace upgrade            # third run: nothing left to install, no `deleted` row
  keep    data/docs/views/inbox.md — ...
```

`--dry-run --adopt` still writes nothing at all (`ws-adopt3`): plan printed with the `pending` row,
no manifest, no file, `nothing was written (--dry-run).`

### Tests

`npm test -w apps/cli` (`VITEST_MAX_THREADS=4`) → **62 files, 688 tests passed**, including:

- `stop.test.ts` — live silent pid: pidfile kept, message names the probed port; the re-pointed
  variant asserting the `Point \`port\` … back at 8791` remedy; the `--json` shape
  (`reason: "pid alive but not answering"`, `pidfileKept`, `pidfilePort`); dead pid still cleaned.
- `lifecycle.test.ts` — the whole scenario against a real daemon: re-point at a free port, `stop`
  keeps the pidfile and leaves the process alive, then point back and `stop` really stops it.
- `plan.test.ts` — `nextManifestFiles` now takes what the run **wrote**: an unperformed `install` is
  not recorded, the performed one is, and a mixed set is recorded per path.
- `upgrade.test.ts` — the adopt-on-pre-manifest cell end to end (plan says `pending`, manifest
  matches disk file by file, next run installs rather than reporting a deletion), plus the
  pre-`--adopt` plan's labelling.

`eslint` clean on `apps/cli/src`; `prettier --check` clean on every touched file; `tsc --noEmit`
clean; `docs/cli.md` regenerated from the registry (`npm run docs:cli -w apps/cli`).

### Observed, not fixed

- **CLI-013** (above): `corpus init` ignores `--workspace` and scaffolds cwd, overwriting existing
  `README.md`/`.gitignore` irrecoverably — `CreatedPaths` records only paths it created, so unwind
  cannot restore an overwrite. Separately filed; untouched here.
- `corpus server status` renders the `unowned` detail with the **pidfile's** port
  (`state.record.port`) while the probe used the **configured** port, so a re-pointed workspace reads
  "pid N is alive but is not answering on :9181" when :9182 is what was probed. `stop` now names the
  probed port and the pidfile port separately; `status` was left alone as out of scope.
- A `workspace upgrade` with nothing to do but a manifest to rewrite still makes a commit ("wrote 0
  files in commit …") because `installedAt` changes every run. Pre-existing, cosmetic, out of scope.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
