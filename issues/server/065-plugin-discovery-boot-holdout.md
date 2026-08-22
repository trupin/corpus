# [SERVER-065] Three projection readers swallow a failed `readdir` silently

## Domain

server

## Status

todo

**Retargeted 2026-08-22 by SHARED-065 (Phase 41), and deliberately not closed.**
This issue was filed against `apps/server/src/plugins/discover.ts`, whose docblock
said *"Never throws"* in front of an unguarded `readdirSync`, killing boot.
SHARED-067 removed the plugin surface and SERVER-136 deleted that file, so the
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
surface and SERVER-136 deleted `apps/server/src/plugins/`.**

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

- [ ] Each of the three readers distinguishes *absent* from *unreadable*: an
      `ENOENT` stays silent and empty, any other failure is logged at `error`
      naming the path and the reason
- [ ] The skipped directory is **excluded from the counts** rather than counted as
      empty, so a partial projection does not report as a complete one
- [ ] The two existing comments are corrected rather than deleted — they explain a
      real decision for two causes and must stop covering the third
- [ ] `listFiles` gets the comment it never had
- [ ] Reproduced first, with the silent data loss observed before the fix
- [ ] ~~`discover.ts`'s docblock becomes true~~ — no subject; the file is deleted
- [ ] ~~`existsSync` is no longer trusted as a guard against unreadability~~ — the
      only site that made that mistake was `discover.ts`. Check the three readers
      do not repeat it before dropping this criterion for good

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

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
