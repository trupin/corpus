# [CLI-037] A workspace's git repairs itself in the background, and can corrupt itself doing it

## Domain

cli

## Status

done — code complete; **four SPEC.md riders drafted and held for the user's
signature** (see "Drafted SPEC.md text")

## Priority

P0

## Model

fable

## Dependencies

- Depends on: SERVER-089 (found and measured the mechanism)
- Blocks: —

## Spec References

- SPEC.md **§4** — every mutation auto-commits; git is the audit trail and the
  only recovery for a deletion
- SPEC.md **§5** — files on disk are the source of truth
- SPEC.md **§2.1** — `corpus init` creates the workspace and its git repository

## Summary

Escalated from SERVER-089, which found this while fixing a CI failure and
deliberately did not act on it, because it is a product decision spanning the CLI.

**Since git 2.29 every `git commit` ends by spawning
`git maintenance run --auto --quiet --detach`** — a detached background process.
On git **2.54** that process begins repacking a *fresh* repository at the
**tenth** commit, concurrently with anything else touching it. Measured on git
2.54.0 over 65 runs of a commit-then-read sequence: **26 corrupt repositories**,
with `error: Could not read <sha>` / `fatal: cannot simplify commit`, `git fsck`
reporting `missing commit` and `broken link`, and no self-healing.

Corpus is exactly that shape. The server is the sole writer, **auto-commits on
every mutation** (§4), and reads git back immediately — `corpus doc diff`, skill
rollback, the watcher's HEAD comparison. Ten commits is a short session.
`apps/cli/src/commands/init/git.ts` sets no maintenance configuration, so every
workspace `corpus init` creates is in the measured configuration.

**Why this is P0**: §4 makes git the audit trail and the *only* recovery for a
deletion. A corrupt object store is not a slow workspace — it is the recovery
path failing, in a product whose deletion story is "git preserves history".

## What is known, and what is not

**Known**, from SERVER-089's measurements: `gc.auto=0` is **not** a fix (9/25
corrupt versus a baseline of 8/25 — the dispatcher spawns regardless, and the
repacking tasks read `maintenance.<task>.auto`). `maintenance.auto=false` gives
0/25, and 50/50 clean after it.

**Not known, and the reason this is `fable` rather than `opus`:** whether a tool
should disable maintenance in a repository it commits into dozens of times an
hour, and if it does, **what maintains it instead**. A workspace that never packs
accumulates loose objects indefinitely. That is a real cost with a real answer —
maintenance at a moment Corpus chooses, rather than never — and choosing it is a
product decision, not a patch.

## The ruling

**Corpus un-schedules git's maintenance. It does not go without maintenance.**

The open question was whether a tool should disable maintenance in a repository
it commits into dozens of times an hour, and what maintains it instead. The
answer rests on one fact the framing of the question hides: `maintenance.auto`
does not govern **whether** a repository is maintained. It governs **who decides
when**. It suppresses only the `--auto` dispatcher other commands trigger; an
explicit `git gc` is unaffected by it, and by `gc.auto=0` as well. So the choice
is not "packed" versus "never packed". It is "packed by a detached process
Corpus did not schedule, cannot observe and cannot wait for" versus "packed by
Corpus, in the foreground, at a moment it chooses".

Put that way it is not close. CLAUDE.md Architecture Decision 2 makes the server
the **sole writer**; §5 makes the files on disk the truth and §4 makes git the
audit trail and the only recovery for a deletion. A repository with exactly one
writer, which serialises its own commits and reads them straight back
(`corpus doc diff`, `corpus skill rollback`, the watcher's HEAD comparison), has
no business having a second unsupervised one. Git's background maintenance is
designed for a human's checkout where nothing else is racing it. Corpus is not
that, and the price of pretending otherwise is measured: 8 of 25 runs corrupt.

**What maintains it, and when.** `corpus server start`, in the foreground,
before the daemon is spawned. That instant is not a convenient hook — it is the
**one moment in a workspace's life when the absence of a writer is provable**
rather than hoped for. `start` has by then established that no server for this
workspace is running, no stale pid is alive, and nothing holds the port; the
server that will become the next writer does not exist yet. Any other moment
would be Corpus guessing that nobody is writing, which is the bug.

**How often.** Only when the loose-object count is past **6700 — git's own
`gc.auto` default**, adopted rather than invented. The point of taking git's
number is that this changes *when* a repository is packed and *who* packs it,
not *how often*: at 6700 loose objects git would have packed too. The one
difference is that git estimates that count from a single fanout directory and
therefore fires anywhere from a few hundred objects upward, while Corpus counts
exactly. A Corpus workspace writes about six loose objects per commit, so this
is on the order of a thousand commits between packs — and further out again once
SHARED-040's party-scoped windows fold several saves into one commit. Measured:
packing a workspace of that size takes 0.16 s, so it is not felt at start.
SHARED-040 is not a fix here and is not treated as one; it only widens an
interval that was already wide.

**What a user sees.** Nothing, on the overwhelming majority of starts — a tool
that narrates its own housekeeping teaches people to stop reading it. Two things
are worth saying and both are said:

- the first time a workspace comes under the rule:
  `git: turned off git's own background maintenance in this repository (maintenance.auto, gc.auto) — corpus packs it at server start instead`
- every time the repository is actually packed:
  `git: packed 7028 loose objects (now 0 loose in 2 packs)`

And there is a place to **look**, rather than only be told: `corpus workspace
maintain` reports the loose count, the packed count, the pack count and the
threshold, applies the settings, and packs on demand. It refuses while the
workspace's server is running (exit 7, nothing changed) with no flag to override
— that refusal is the ruling stated as a command, not a limitation.

**Existing workspaces — both vehicles, and `server start` is the load-bearing
one.** `corpus workspace upgrade` (§2.4) is the declared vehicle and does apply
the settings, before its own "already up to date." short-circuit, so a workspace
with nothing else to upgrade is still repaired; `--dry-run` predicts it without
writing. But an upgrade is something a user chooses to run, and this is a P0
integrity bug, so it cannot be the only path: **`corpus server start` applies
the settings too**, which means every existing workspace self-heals the first
time its server starts after this ships, with no user action at all. The upgrade
never *packs* — it may run against a live server, and packing beside the sole
writer is the exact race being removed.

**Maintenance never blocks a start.** A workspace that failed to pack is slow; a
workspace whose server refuses to come up because `git gc` failed is unusable,
and the operator cannot reach the board to find out why. A failure is reported
as a `warning:` line and the start proceeds.

## Acceptance Criteria

- [x] Reproduce against a real `corpus init` workspace on git ≥ 2.54, driving
      enough mutations to pass the ten-commit trigger. SERVER-089 reproduced the
      mechanism in a container; this needs it reproduced through the product —
      **done, log below: repacked behind us at commit 41**
- [x] A new workspace is not left in the measured configuration — `corpus init`
      writes the settings **before the first commit**, because that commit would
      itself spawn a maintenance child
- [x] **Existing workspaces are addressed, not only new ones.** — both
      `corpus workspace upgrade` (the §2.4 vehicle, decided and stated above)
      and `corpus server start` (the one that needs no user action)
- [x] If maintenance is disabled, **something maintains the repository** — see
      the ruling: `corpus server start`, at git's own threshold, in the
      foreground, reported; plus `corpus workspace maintain` on demand
- [x] Whatever is chosen is stated in SPEC.md if it is user-visible behaviour —
      **drafted below and held for sign-off**, not applied
- [x] Check whether this explains any of the standing e2e flakes — checked, see
      "The e2e flakes" below

## Technical Design

### Files created

- `apps/cli/src/commands/workspace/maintenance.ts` — the ruling and its
  plumbing: `MAINTENANCE_SETTINGS`, `LOOSE_OBJECT_LIMIT`,
  `ensureMaintenanceSettings` / `missingMaintenanceSettings`,
  `readRepositoryObjects`, `maintainRepository`, `renderMaintenance`,
  `maintainOrWarn`. No `Output`, no registry — three topics call it.
- `apps/cli/src/commands/workspace/maintain.ts` — the `corpus workspace
  maintain` verb.
- `apps/cli/src/commands/workspace/maintenance.test.ts`,
  `apps/cli/src/commands/workspace/maintain.test.ts`.

### Files modified

- `apps/cli/src/commands/init/index.ts` — settings written **before** the
  initial commit; `maintenanceSettings` on `InitReport`; one summary line.
- `apps/cli/src/commands/server/start.ts` — `maintainOrWarn` between
  `refuseAnOccupiedPort` and `spawnServer`; lines printed as they happen;
  `maintenance` on the emitted JSON (`null` when already running).
- `apps/cli/src/commands/workspace/upgrade.ts` — settings applied before the
  up-to-date short-circuit; `maintenanceSettings` on `UpgradeReport`; predicted
  under `--dry-run`; rendered ahead of "already up to date.".
- `apps/cli/src/commands/workspace/index.ts` — topic gains `maintain`.
- `apps/cli/src/commands/hygiene.test.ts` — both pinned module inventories.
- `docs/cli.md` — regenerated (`npm run docs:cli -w apps/cli`), never hand-edited.

### What was learned about the mechanism (git 2.54.0 source, not re-derived measurement)

SERVER-089's numbers are taken as given. Reading `builtin/gc.c` in git 2.54.0
explains *why* they came out as they did, which the fix depends on:

- Unscheduled maintenance — what `git commit` spawns — uses the **geometric**
  strategy by default (`initialize_task_config`, `geometric_strategy`). Its
  tasks are `commit-graph`, `geometric-repack`, `pack-refs`, `rerere-gc`,
  `reflog-expire`, `worktree-prune`. **`gc` is not among them.** That is exactly
  why `gc.auto=0` measured 9/25 — it governs a task the dispatcher never runs.
- `geometric_repack_auto_condition` reads `maintenance.geometric-repack.auto`
  (default 100) and passes it to `too_many_loose_objects`, which rounds it up to
  256 and compares against an **estimate**: `odb_source_loose_count_objects`
  with `ODB_COUNT_OBJECTS_APPROXIMATE` counts entries in `.git/objects/17` and
  multiplies by 256. So the trigger is "≥ 2 loose objects happen to land in one
  of 256 fanout directories" — probabilistic, which is why it fired at the tenth
  commit for SERVER-089 and the forty-first here, and why the corruption rate
  was a fraction rather than always.
- `maintenance.auto=false` short-circuits the dispatcher itself, so no child is
  spawned whatever the strategy. Confirmed E2E below over 221 commits.
- Neither setting affects an explicit `git gc`: `need_to_gc` is only consulted
  under `--auto`. Verified directly — `git gc --quiet` in a repository carrying
  both settings packed 966 loose objects in 0.16 s, `fsck` clean, history intact.

## Testing Strategy

A real workspace, real mutations past the trigger, `git fsck` clean afterwards.
Plus whatever pins the chosen maintenance story.

**As implemented:** 33 new tests, all against real git repositories (a stubbed
runner can only restate the claim back at itself — the claim under test is a
claim *about git*). `maintenance.test.ts` covers the settings (write, idempotence,
correcting a re-enabled `true`, locality, dry-run prediction), the counts, the
threshold branches, `--force`, `settings-only`, the renderer's silence, and
`maintainOrWarn`'s degradation; one test drives 60 real commits and asserts
`packs: 0` and `fsck` clean. `maintain.test.ts` covers the verb, including the
refusal beside a live server changing nothing and a stale pidfile not making a
workspace permanently unmaintainable. `lifecycle.test.ts` gains the two start
paths against a real detached daemon; `init/index.test.ts` and `upgrade.test.ts`
gain their own.

## Drafted SPEC.md text — NOT APPLIED, held for the user's signature

Four riders. Each is quoted verbatim as it would appear in `SPEC.md`, so it can
be read aloud without paraphrase.

### Rider 1 — §4 "The workspace": a new paragraph

Inserted immediately **after** the paragraph beginning "The workspace is its own
git repository." and **before** the paragraph beginning "**Commit windows — a
commit per act, not per save.**".

> **Corpus maintains the repository; git does not maintain it in the
> background.** Git ordinarily repacks a repository on its own, in a detached
> process it starts after a commit, at a moment of its own choosing. In a
> workspace committed into on every mutation and read straight back, that is a
> second writer nobody scheduled racing the one writer there is meant to be —
> and a lost race leaves the object store permanently damaged, which here means
> the audit trail and the only recovery for a deletion. So a Corpus workspace is
> created with git's background maintenance **off**, and Corpus does the packing
> itself. `corpus server start` packs the repository once it has accumulated
> enough loose objects to be worth packing, at the one moment a workspace
> provably has no writer: after every running server has been ruled out, and
> before the next one is spawned. The threshold is git's own, so a workspace is
> packed about as often as git would have packed it — the change is who decides
> when, not how often. It is never silent: a start that packs says what it
> packed. `corpus workspace maintain` is the same run on demand and the place
> the object store's state is readable; it refuses while the workspace's server
> is running, because that is precisely the race being avoided, and no flag
> overrides that. Maintenance never prevents a server from starting: a failure
> is reported and the start proceeds. A workspace created before this behaviour
> existed is brought under it by its next `corpus server start`, or by
> `corpus workspace upgrade`.

### Rider 2 — §2.1, the `corpus init` list

The third bullet of the list under "`corpus init` creates a workspace in the
current directory:" changes from:

> - a git repository with an initial commit,

to:

> - a git repository with an initial commit, created with git's own background
>   maintenance switched off — Corpus packs the repository itself (§4),

### Rider 3 — §2.1, the "**Workspace upgrade**" paragraph

Appended as the final sentences of that paragraph, after "…a running server's
watcher picks the changes up and re-projects like any out-of-band edit."

> An upgrade also carries the workspace's **repository settings** forward: a
> workspace created before Corpus took git's background maintenance out of its
> own repository (§4) has it switched off here, and reported like anything else
> the upgrade did. Being repository configuration rather than a file, it needs
> no baseline, overwrites nothing and makes no commit — so a workspace with
> nothing else to upgrade still gets it, and `--dry-run` predicts it like any
> other change. The upgrade never **packs** the repository: it is allowed to run
> with the server up, and packing beside the server is the race §4 avoids.

### Rider 4 — §2.1, the `corpus server start` bullet under "**Server lifecycle**"

The bullet changes from:

> - `corpus server start` — starts the server as a background daemon (pidfile
>   and logfile under `.corpus/`), waits until it responds, and prints the board
>   URL. Idempotent: starting an already-running server reports it and exits
>   cleanly.

to:

> - `corpus server start` — starts the server as a background daemon (pidfile
>   and logfile under `.corpus/`), waits until it responds, and prints the board
>   URL. Idempotent: starting an already-running server reports it and exits
>   cleanly. A start that spawns a server also maintains the workspace's git
>   repository first (§4); one that finds a server already running maintains
>   nothing, there being a writer.

## The e2e flakes

_(Acceptance criterion 6 — SERVER-089 flagged this as a plausible lead.)_

**No, and structurally so.** The Playwright suite creates no git repository,
spawns no workspace server and makes no commits, so the maintenance trigger is
unreachable from it. `apps/ui/playwright.config.ts` starts Vite and nothing
else; `apps/ui/e2e/stubCorpus.ts` answers `**/api/**` from an in-memory map via
`page.route`; the only real process is an ephemeral-port `node:http` SSE server
in `apps/ui/e2e/eventStream.ts`. `apps/ui/e2e/coverage.ts` says as much in its
own comment: nothing in the shipped suite spawns a Node process. Grepping the
suite for `git` returns only comments saying the disk-and-git half is verified
by hand in issue logs.

The recorded standing flakes are all UI/timing-shaped, and none mentions a git
error, a missing object or `fsck`: UI-105 (`press("End")` lands on the end of
the *visual* line, so a typed character goes mid-word under load), UI-047 (three
blind `Tab` presses right after `page.goto("/")`, before the app is
interactive), INFRA-020 (a 5 s timeout on 1 s of work; a pointer gesture racing
layout), UI-040 (`route.fulfill` closes the stub SSE stream, the bridge
reconnects and refetches), UI-077 (a real code race at `--workers=8`, plus two
environmental failures from the user's own server holding 8765), UI-033, UI-037.

**One correction to escalate.** SERVER-089's escalation note asserts that "the
e2e suite drives exactly that — a real `corpus init` workspace on the runner's
git 2.54". That is not true of the suite as it stands, and CLI-037's framing
inherited it. `issues/server/089-fixture-git-allows-auto-gc.md` should be
corrected; it is another domain's issue file, so this is reported rather than
edited here.

What the flake lead was probably picking up is the **other** real exposure, which
this issue does fix: manual E2E verification runs against real `corpus init`
workspaces — the "disk-and-git half" recorded in issue logs — and every user
workspace created before this ships.

## E2E Verification Log

**Model: Fable** (`claude-fable-5`), per the issue's `Model: fable`.

### Environment

The machine's own git is **2.37.3**, which the maintenance comment records as
never crossing the threshold — useless for this. Git **2.54.0** was built from
source into a scratch prefix and put on `PATH` for every run below; the CLI
passes its environment to the daemon it spawns, so the server's git children are
the same binary.

```
$ git --version
git version 2.54.0        # /Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/gitinstall/bin/git
```

Two further notes on the setup, because they affected the evidence:

- The repository's working tree was being edited concurrently by SHARED-040's
  server work, and a rebuild mid-run gave me a live server throwing
  `ReferenceError: session is not defined` at `apps/server/src/git/commit.ts:435`
  — not this issue, and it poisoned one run. Everything below therefore runs
  against a **pristine tree at HEAD** (`git archive HEAD` into a scratch
  directory, `node_modules` copied so the workspace symlinks resolve inside it),
  with only `apps/cli/src` replaced by this issue's code for the post-fix runs.
- All scratch workspaces and servers live under
  `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp` on ports 8791–8794. Port
  8765 (the user's live server) and 5173 were never bound; all four scratch
  ports were verified free at the end.

### 1. Pre-fix reproduction, through the product

`corpus init` a real workspace, start its server, then 200 real
`corpus doc create --from agent` mutations with a background loop running
`git log --oneline -- data/docs` and `git rev-list --objects HEAD` throughout —
the reads `corpus doc diff`, `corpus skill rollback` and the watcher perform.

```
$ node .../apps/cli/dist/bin/corpus.js init $WS --port 8792
$ git -C $WS config --local --get maintenance.auto
  maintenance.auto  (unset -> git's default: true)
$ git -C $WS config --local --get gc.auto
  gc.auto           (unset -> git's default: 6700)
$ node .../corpus.js server start --workspace $WS
corpus 0.4.0 listening on http://127.0.0.1:8792 (pid 7388)

  mutation 20: loose=148 fanout17=0 packs=0
>>> REPACKED BEHIND US at mutation 40 (packs=1) <<<
count: 6 size: 24 in-pack: 262 packs: 1 size-pack: 80 …
  mutation 40: loose=6 fanout17=0 packs=1
  mutation 60: loose=126 fanout17=0 packs=1
  …
  mutation 200: loose=966 fanout17=1 packs=1
== repacked at mutation: 40 ==
```

**A workspace `corpus init` created is in the measured configuration** — neither
key set — and at the **41st commit** a process Corpus never scheduled rewrote
262 objects of its object store into a pack, while the server was up and
committing and a reader was walking the history. `fsck` came back clean in this
particular run, which is expected: the corruption is the tail of the race
SERVER-089 measured at 8/25, and this loop spawns a CLI process between commits,
which widens the gap the detached child has to finish in. The unscheduled
concurrent repack is the defect; the corruption is its consequence, and it is
already measured. An earlier run of the same script aborted at mutation ~80 and
the repack still landed after the script exited — the child outlives the command
that provoked it, which is the point.

### 2. Post-fix: a new workspace, 220 mutations, same concurrent reader

```
$ node .../corpus.js init $WS --port 8793
Initialized Corpus workspace at …/fixed
  port 8793, token in .corpus/config.json (mode 600)
  git: initialized on main, one commit authored as user
  git: background maintenance is off here — corpus packs the repository at server start
  installed 8 template files, …
$ git -C $WS config --local --list | grep -E 'maintenance|gc\.'
maintenance.auto=false
gc.auto=0

$ node .../corpus.js server start --workspace $WS
corpus 0.4.0 listening on http://127.0.0.1:8793 (pid 18499)   # silent: nothing to do

  mutation  40: loose=268  packs=0
  mutation  80: loose=508  packs=0
  mutation 120: loose=748  packs=0
  mutation 160: loose=988  packs=0
  mutation 200: loose=1228 packs=0
  reader errors: 0
  create errors: 0
  final: count: 1348  in-pack: 0  packs: 0
  git fsck --full: exit=0 output=''
  commits: 221
```

221 commits — **5.4× past the point the unfixed workspace repacked** — with
zero packs, zero reader errors, zero mutation failures and a clean `fsck`.

### 3. Post-fix: the verb

```
# while the server is up
$ node .../corpus.js workspace maintain --workspace $WS
corpus: this workspace's server is running (pid 18499 on :8793), and it is the
  only writer of this repository
  Run `corpus server stop`, then `corpus workspace maintain`. A start will
  maintain it for you.
$ echo $?
7

$ node .../corpus.js server stop --workspace $WS
stopped (pid 18499)
$ node .../corpus.js workspace maintain --workspace $WS
loose objects   1348
packed objects  0
packs           0
packs at        6700 loose objects
  nothing to pack yet; corpus packs at server start once the count is above the threshold.

$ node .../corpus.js workspace maintain --workspace $WS --force
loose objects   0
packed objects  1348
packs           1
packs at        6700 loose objects
  git: packed 1348 loose objects (now 0 loose in 1 pack)
$ git -C $WS fsck --full ; echo $?
0
$ git -C $WS log --oneline | wc -l
221                                   # history intact across the pack

$ node .../corpus.js workspace maintain --workspace $WS --json
{"workspace":"…/fixed","settings":[],"before":{"loose":0,"packed":1348,"packs":1},
 "after":null,"packed":false,"due":false,"threshold":6700}
```

### 4. Post-fix: a start that actually packs

A workspace pushed over the real 6700 threshold (loose objects written straight
into the store — how they got there is irrelevant to the branch under test, the
input is the count), then started normally:

```
loose before start: 7028
--- corpus server start ---
git: packed 7028 loose objects (now 0 loose in 2 packs)
corpus 0.4.0 listening on http://127.0.0.1:8794 (pid 37445)
  logs: corpus server logs -f
--- after ---
count: 0   in-pack: 7028   packs: 2
fsck: 6999 `dangling blob` lines, 0 lines matching missing/broken/error
```

The 6999 dangling blobs are the unreachable objects I wrote by hand, reported by
`fsck` as information, not damage — and note `gc` **did not prune them**, which
is the conservative behaviour §4's recovery story needs.

### 5. Post-fix: an existing workspace, both vehicles

Run against the actual pre-fix workspace from §1 — created by the unfixed CLI
and already repacked behind our back at commit 41.

```
$ git -C $OLD config --local --get maintenance.auto
  (unset — git will maintain it)

# vehicle A — corpus workspace upgrade (SPEC §2.4), server down
$ node .../corpus.js workspace upgrade --workspace $OLD
git: turned off git's own background maintenance in this repository
  (maintenance.auto, gc.auto) — corpus packs it at server start instead
already up to date.
$ git -C $OLD config --local --list | grep -E 'maintenance|gc\.'
maintenance.auto=false
gc.auto=0
# second run — silent
$ node .../corpus.js workspace upgrade --workspace $OLD
already up to date.

# vehicle B — corpus server start, settings removed again
$ node .../corpus.js server start --workspace $OLD
git: turned off git's own background maintenance in this repository
  (maintenance.auto, gc.auto) — corpus packs it at server start instead
corpus 0.4.0 listening on http://127.0.0.1:8792 (pid 33718)
# the next start is silent
$ node .../corpus.js server start --workspace $OLD
corpus 0.4.0 listening on http://127.0.0.1:8792 (pid 34030)

# --dry-run predicts it and writes nothing
$ node .../corpus.js workspace upgrade --workspace $OLD --dry-run
git: would turn off git's own background maintenance in this repository
  (maintenance.auto, gc.auto) — corpus packs it at server start instead
already up to date.
$ git -C $OLD config --local --get maintenance.auto || echo "still unset"
still unset
```

Note the ordering in vehicle A: the maintenance line comes **before** "already up
to date.", because the template files were current and that sentence would
otherwise be a lie about the one thing that did change.

### 6. Checks

```
$ npm run build                                    # exit 0
$ VITEST_MAX_THREADS=4 npm test -w apps/cli
  Test Files  87 passed (87)
       Tests  1367 passed (1367)                   # 1329 before; +38
$ npx tsc -p apps/cli/tsconfig.json --noEmit       # clean
$ npx eslint apps/cli/src                          # 0 problems
$ npx prettier --check "apps/cli/src/**/*.ts" docs/cli.md
  All matched files use Prettier code style!
$ npm run docs:cli -w apps/cli                     # regenerated, +49 lines
```

### Cleanup

Every process started here was stopped by pid; ports 8791, 8792, 8793 and 8794
verified free. Port **8765 was never bound** and its server (pid 1715) was left
alone.

## Completion Checklist (domain agent)

- [x] Tests written and passing — 1367/1367 in `apps/cli` (+38)
- [x] `/lint` passes — eslint 0 problems, prettier clean, `tsc --noEmit` clean
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Open for the orchestrator

1. **SPEC.md is drafted, not applied.** Four riders above, verbatim. They need
   the user's signature.
2. **SERVER-089's escalation note is factually wrong** about the e2e suite
   driving a real `corpus init` workspace (see "The e2e flakes"). Another
   domain's file; not edited here.
3. **The server's own `disableAutoMaintenance` is test-only.** `apps/server/src/
   git/maintenance.ts` is imported exclusively by tests and by
   `docs/write-fixture.ts` — nothing in the server's production path applies it.
   That is correct as things stand, because the CLI now owns the repository's
   configuration and the settings are repository-local, so the server's git
   children inherit them. It is worth stating so nobody later "fixes" the server
   by having it write the config too, which would put a second writer of the
   same setting in a repository the CLI already owns. `apps/server/src/git/` was
   not touched, per instruction.

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
