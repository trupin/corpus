# [SERVER-065] Plugin discovery says "never throws" and throws, killing boot

## Domain

server

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Sibling of: SERVER-063 (queue readers), SERVER-064 (document projection)

## Summary

The third instance of one pattern, found while closing SERVER-063's own gap. All
three share a shape worth naming: **a reader whose docblock promises it cannot
fail, in front of a `readdir`/`read` that can.**

`apps/server/src/plugins/discover.ts:158` — the docblock says *"Never throws"*.
It guards with `existsSync(pluginsRoot)`, which returns **true** for a `chmod 000`
directory (measured, not assumed), and then calls `readdirSync` unguarded. It runs
from `lifecycle.ts:186` during boot, so the failure is the same user-visible one
SERVER-063 and SERVER-064 describe: `corpus server start` reports that the server
exited during startup, with no server left to ask why.

**Lower blast radius than its two siblings**, which is why this is P2: the plugins
root lives inside the installed tool rather than in the user's workspace, so it
takes an unusual install or a deliberate `chmod` to reach. The defect is the same;
the exposure is not.

## Also worth deciding here — the opposite failure

While surveying, three readers were found to swallow a failed `readdir`
**silently**: `projection/roots.ts:178`, `projection/project-runtime.ts:47`,
`projection/unindexable.ts:186`. That is the other half of the same mistake —
where these three lose data with no trace, `discover.ts` refuses to start with a
stack. Neither tells an operator what to repair.

The rule the queue readers converged on is the one to apply: **skip, exclude from
the counts, and log at `error`** — the one level a `silent` server still writes,
naming the path and the reason, because only an operator can fix it. Decide
whether to bring these three onto that rule as part of this issue or to file them
separately, but do not leave three silent readers and one loud one and call it
consistent.

`locks/store.ts:180` rethrows but is a **request** path, not boot — out of scope.

## Acceptance Criteria

- [ ] A server whose plugins root cannot be listed **boots** and serves, with the
      plugins it could not discover named in an `error` log line
- [ ] `discover.ts`'s docblock becomes true, rather than the claim being softened
      to match a reader that still throws
- [ ] `existsSync` is no longer trusted as a guard against unreadability — it
      answers a different question, and that is the trap here
- [ ] The three silent swallowers are either brought onto the same rule or filed
      separately with the reason
- [ ] Reproduced first, with the boot failure observed before the fix

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

A plugins root that cannot be listed: the server constructs, discovery reports
nothing rather than throwing, and the skip is logged at `error`. Plus a real boot.

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
