# [SERVER-065] Three projection readers swallow a failed `readdir` silently

## Domain

server

## Status

done

**Retargeted 2026-08-22 by SHARED-065 (Phase 41), and deliberately not closed.**
This issue was filed against `apps/server/src/plugins/discover.ts`, whose docblock
said *"Never throws"* in front of an unguarded `readdirSync`, killing boot.
SHARED-067 removed the plugin surface and SERVER-139 deleted that file, so the
headline defect has no subject.

**The rest of the issue is core and survives untouched.** Its *"Also worth
deciding here"* section names three projection readers that swallow a failed
`readdir` with a bare `catch {}`, and all three are still in the tree. Those were
never plugin code, and losing them because the issue's opening paragraph named a
plugin would be losing a real defect. So the issue is retargeted to them rather
than closed, and the plugin half is struck below rather than silently rewritten.

The rule the issue converged on is unchanged and is what it now asks for:
**skip, exclude from the counts, and log at `error`.**

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Sibling of: SERVER-063 (queue readers), SERVER-064 (document projection)

## Summary

~~`apps/server/src/plugins/discover.ts:158` — the docblock says *"Never throws"*.
It guards with `existsSync(pluginsRoot)`, which returns **true** for a `chmod 000`
directory (measured, not assumed), and then calls `readdirSync` unguarded. It runs
from `lifecycle.ts:186` during boot, so the failure is the same user-visible one
SERVER-063 and SERVER-064 describe.~~ **MOOT — SHARED-067 removed the plugin
surface and SERVER-139 deleted `apps/server/src/plugins/`.**

What is left is the opposite failure, and it is the half with the higher blast
radius anyway: **three projection readers lose data with no trace.** Each wraps a
`readdirSync` in a bare `catch` and returns empty, so an unreadable directory is
indistinguishable from an empty one — the projection reports success over a
partial corpus.

Verified present on 2026-08-22 (line numbers have drifted from the original
filing, so both are given):

| Reader | Filed as | Now |
| --- | --- | --- |
| `apps/server/src/projection/roots.ts` — `walk` | :178 | :180 |
| `apps/server/src/projection/project-runtime.ts` — `listFiles` | :47 | :51 |
| `apps/server/src/projection/unindexable.ts` — `walkUnindexed` | :186 | :195 |

Two of the three carry a comment justifying the swallow — *"a root that does not
exist is simply empty, and a directory that vanished mid-walk is a removal"* —
and **that reasoning is right for those two causes and wrong for the third.**
`ENOENT` is genuinely empty. `EACCES` is not, and the comment covers it by
accident. That is the distinction to make: swallow the causes the comment names,
and log the ones it does not.

`listFiles` in `project-runtime.ts` carries no comment at all.

**Sibling context that still applies.** SERVER-063 (queue readers) and SERVER-064
(document projection) fixed the same shape and settled the rule these three should
adopt: `error` is the one level a `silent` server still writes, and only an
operator can repair an unreadable directory, so it names the path and the reason.

`locks/store.ts:180` rethrows but is a **request** path, not boot — out of scope,
unchanged.

## Acceptance Criteria

- [x] Each of the three readers distinguishes *absent* from *unreadable*: an
      `ENOENT` stays silent and empty, any other failure is reported naming the
      path and the reason — at `error` on the boot and projection path, and as a
      report-only doctor warning on the one reader that has no logger. See
      *The choice* below.
- [x] The skipped directory is **excluded from the counts** rather than counted as
      empty, so a partial projection does not report as a complete one
- [x] The two existing comments are corrected rather than deleted — they explain a
      real decision for two causes and now stop covering the third
- [x] `listFiles` gets the comment it never had
- [x] Reproduced first, with the silent data loss observed before the fix
- [x] ~~`discover.ts`'s docblock becomes true~~ — no subject; the file is deleted
- [x] ~~`existsSync` is no longer trusted as a guard against unreadability~~ —
      **checked, and none of the three repeats it.** `roots.ts` guards each root
      with `realpathSync` (which throws on an unreadable *parent*, and is now
      reported when it does), and neither `project-runtime.ts` nor
      `unindexable.ts` probes existence at all — both go straight to the
      `readdir`. Dropped for good.

## Technical Design

### Notes

- **Test it without depending on privileges.** SERVER-063's round measured all
  five candidates and found that no filesystem trick makes an *existing
  directory* unlistable for every user: the privilege-free ones (regular file,
  symlink→file, dangling symlink, symlink loop) change what the path *is*, and
  only `chmod 000` leaves it a directory — which root bypasses, so a chmod-based
  test proves nothing in CI. Its answer was to split coverage: an `ENOTDIR` case
  that holds for everyone, plus a fake at the store seam throwing exactly what
  `readdirSync` throws for `chmod 000`. Reuse that approach rather than
  rediscovering it.

## Testing Strategy

Per reader: a directory that cannot be listed. The projection completes, the
directory is excluded from the counts rather than counted empty, and the skip is
logged at `error`. Plus one real boot over a workspace with an unreadable
`data/docs` subdirectory.

## E2E Verification Log

**Model: Opus 5 (1M context).** 2026-08-24, branch `phase-45-not-so`.

### The choice, made once and applied three times

**A directory the projection cannot list is skipped, excluded from the counts,
and reported. It is never fatal, and never silent.** `ENOENT` is the one cause
that stays silent, because a root that does not exist genuinely is empty.

*Not fatal* is the half worth stating, because the issue asked it as an open
question. Boot is a **read**. Losing one root is not a reason to lose the
others, and a `corpus server start` that exits during startup leaves no server to
ask why over one directory the operator then has to find by hand — SERVER-063's
argument, unchanged, and the reason its own reader skips rather than throws.

Every reader **returns** the skip rather than logging it, which is SERVER-063's
shape one walk over: the reader knows the fault, the caller holds the channel.
Each caller then reports it on the loudest channel it has:

| reader | caller | channel |
| --- | --- | --- |
| `projection/roots.ts` — `walk`, and the per-root `realpathSync` | `populate.ts` | `db.logger.error`, and the path joins `PopulateReport.skipped` |
| `projection/project-runtime.ts` — `listFiles` | `projectQueueDir`, `projectJobsDir` | `db.logger.error` |
| `projection/unindexable.ts` — `walkUnindexed` | `collectUnindexableFiles` | a report-only `DoctorWarning` |

The third channel differs because the reader does, not because the decision
does. `collectUnindexableFiles` is not on the boot path and its caller holds no
logger an operator is watching — `doctor` opens the projection read-only and its
logger is `silentLogger` by default. That pass already speaks in warnings, and a
warning is strictly louder than a log line for somebody who has just run
`corpus db doctor` to ask whether the projection is whole. `doctor` also reports
the *other two* readers' skips the same way (`unlistable_directory`), so an
operator sees one vocabulary whichever reader found it.

**Why a warning and not drift.** A rebuild cannot index what it cannot list and
the drift check cannot look inside it either, so files and rows agree exactly and
there is nothing `rebuild && doctor` would fix. §11's report-only family is
written for precisely that, and it is `unindexable_file`'s argument word for
word.

### The two comments, corrected

Both said *"a root that does not exist is simply empty, and a directory that
vanished mid-walk is a removal"*. Both now keep that sentence — it is right for
the two causes it names — and add the third it was covering by accident. The
`unindexable.ts` one carries the sharper version: this pass exists to report
files nobody can see, so answering silence for a directory nobody can read is the
pass failing at its own job.

`listFiles` gained the docblock it never had, plus the distinction: the empty
list for a directory that does not exist is the ordinary state of a workspace
that has enqueued nothing, and the empty list for one that cannot be read means
`events` or `jobs` is short by however many files are in there.

### Reproduction — before the fix, on a real server

Real workspace at `scratchpad/ws45`, port 8791 (never 8765), the document walk's
guard neutered to its pre-fix form, `data/docs/finance/` at `chmod 000` holding
one document:

```
$ corpus db rebuild
rebuilt the projection in 39ms — 21 documents, 6 threads, 6 turns, 1 anchor,
0 links, 2 events, 0 jobs, 0 seen

$ corpus db doctor        # the document walk's finding
(absent)
```

**No mention of the directory anywhere.** The rebuild reports success over a
corpus it silently truncated, and the document under `finance/` is gone with no
trace — exactly the defect filed.

### Verification — same server, same directory, guard restored

```
$ corpus db rebuild
rebuilt the projection in 41ms — 21 documents, … — skipped 1 file (data/docs/finance)

$ corpus server start        # a real boot over the unreadable root
{"level":"error","msg":"skipping unlistable directory; its documents are not projected",
 "path":"data/docs/finance",
 "reason":"EACCES: permission denied, scandir '…/data/docs/finance'"}

$ corpus db doctor
unlistable_directory data/docs/finance: … could not be listed (EACCES: permission denied,
  scandir '…'), so any document under it is missing from the projection and invisible to
  this check. The projection is not wrong about what it holds — it was never able to see them.
unlistable_directory data/docs/finance: … so this check could not look inside it. Any
  unindexable file under it is missing from the list above.
```

Both walks report it, each in its own words, and the rebuild's count says
`skipped 1 file` where it previously said nothing.

The queue reader, with `.corpus/queue/pending/` at `chmod 000`:

```
$ corpus db rebuild
{"level":"error","msg":"cannot list queue status directory; its events are not projected",
 "path":"…/.corpus/queue/pending","reason":"EACCES: permission denied, scandir '…'"}
```

(The second line beside it is `queue/service.ts`'s own SERVER-063 reporting, at
the same level, for the same directory — the two readers now agree, which is what
the sibling issues asked for.)

### Falsification, and why the tests use `ENOTDIR`

All three readers reverted to swallowing every cause:

```
VITEST_MAX_THREADS=4 vitest run apps/server/src/projection
  × roots.test.ts        — is reported, named, and kept out of the files
  × project-runtime.test — is reported by `listQueueEventFiles` rather than read as empty
  × project-runtime.test — logs the queue skip at `error` and leaves it out of the count
  × project-runtime.test — logs the jobs skip at `error` too, which is the same choice
  × unindexable.test.ts  — is reported as its own warning kind, naming path and reason
  × populate.test.ts     — is skipped, reported, and logged at `error` — never fatal
  × doctor.test.ts       — is reported as a warning naming the path and the reason
  exit 1
```

Restored, green. The unit tests provoke the failure with **`ENOTDIR`** — a
regular file where a directory belongs — rather than `chmod 000`, reusing
SERVER-063's measurement: root bypasses a mode, so a chmod-based test proves
nothing in CI, while `ENOTDIR` fails for every user. The E2E above uses a real
`chmod 000` and a real `EACCES`, because that run is not under root.

**One limitation, stated rather than papered over.** `walkUnindexed` descends
only into `entry.isDirectory()`, which is false for both a regular file and a
symlink, so a *nested* unlistable directory cannot be provoked without a mode.
That reader's nested branch is therefore covered by the E2E's real `EACCES` and
not by a unit test. Its top-level branch — the one the pass always reaches — is
unit-tested.

### Checks

```
npm run typecheck -w apps/server                exit 0
eslint apps/server/src                          exit 0   (no rule disabled)
VITEST_MAX_THREADS=4 vitest run apps/server
  Test Files 204 passed (204)   Tests 4662 passed (4662)   exit 0
```

### Note for a reader of the diff

`enumerateDocuments` and `listQueueEventFiles` changed **shape** — each now
returns its findings alongside its skips. That is deliberate and is the whole
mechanism: a caller that cannot see the skip has no way to keep it out of the
counts, and would have no choice but to report a partial projection as a complete
one. Seven call sites and eight test assertions were updated with it.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
