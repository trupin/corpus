# [CLI-046] `corpus queue status` never shows whether an agent is there

## Domain

cli

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-112 (which made the field carry a real answer)
- Related: CONTRACT-045 (which added it), UI-098 (the same omission in the
  console), CLI-043 (which found it)

## Spec References

- SPEC.md **§7** — presence is the parked request
- SPEC.md **§11** — the agent pill's four states

## Summary

`QueueStatus` carries `agent` — required since CONTRACT-045, and filled with a
real tracker's answer since SERVER-112. `corpus queue status` renders none of
it: the human output omits it entirely, and the `--json` example in the help
omits the field the route actually returns.

Found by CLI-043 while building the lane verbs, and deliberately not folded into
that issue.

**Why P1 rather than a nicety.** `corpus queue status` is what an agent or an
operator runs to answer "why is nothing happening". The queue depth alone cannot
distinguish *nobody has picked this up yet* from *nobody is there to pick it up*
— which are the two explanations, and they call for opposite responses. This is
the same defect UI-097 fixed in the thread indicator and UI-098 is fixing in the
console, in the one surface an agent reads.

A `--json` example that omits a field the route returns is its own small
problem: it is documentation that will be copied.

## Acceptance Criteria

- [x] Human output states whether an agent is present, and since when
- [x] It distinguishes **unknown** from **absent** — a status that has not
      answered must not render as "no agent", which is the trap UI-097 named and
      ui-dev's Domain Knowledge now records
- [x] The `--json` example matches what the route actually returns
- [x] It does not restate `AGENT_PRESENCE_WINDOW_SECONDS`; if the output
      mentions the window it reads the contract's constant, as CLI-043's lapse
      note does
- [x] If the output shows both `QueueStatus.agent` and anything from
      `corpus agents`, they are not presented as one fact — CONTRACT-053 records
      that the two can legitimately disagree for one grace window

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/queue/status.ts` and its test
- `docs/cli.md` (regenerated)

### Notes

`apps/cli/src/commands/age.ts` (added by CLI-043) already formats an age; reuse
it rather than spelling a second one.

## Testing Strategy

Unit on the rendering, including the unknown case. No E2E drill is warranted for
a formatting change if the field's plumbing is already covered by SERVER-112's —
say so rather than inventing one.

## E2E Verification Log

**Model: opus (claude-opus-5[1m]).**

**No server drill was run, deliberately.** This is a rendering change over a
field whose plumbing SERVER-112 already covers end to end; a drill here would
prove that the server fills `agent`, which is SERVER-112's evidence and not
this issue's. What is exercised instead is the surface itself, against the real
built command surface:

```
$ cd apps/cli && tsx src/bin/corpus.ts queue status --help
corpus queue status — Show the halt state, the queue depth, and whether an agent is there.
…
`agent present, parked 2m ago` means a listener is holding a parked `corpus queue idle`
right now; `no agent — last parked 3h ago` means one was there and has been gone longer
than the grace window (16m) … **A server that did not report the field at all reads
`agent presence unknown`** — an answer that never arrived is not an answer saying nobody
is there.
…
  # One JSON value, the status verbatim: `{"agent":{"live":true,"since":"2026-08-16T09:00:00.000Z"},
    "halted":false,"pending":0,…}`.
  corpus queue status --json
```

The four renderings themselves are covered by unit tests against a real stub
HTTP server (`testing/stub-server.ts`), which is how every other verb in this
CLI is exercised:

- `agent present, parked 2m ago` (live)
- `no agent — last parked 3h ago` (lapsed)
- `no agent — none has parked since the server started` (`since: null`)
- `agent presence unknown — this server did not report it` (field absent)

**Falsified before trusting green** (each mutation applied to `control.ts`, the
suite re-run, then reverted):

| Mutation                                     | Result                                                       |
| -------------------------------------------- | ------------------------------------------------------------ |
| `UNKNOWN_PRESENCE` → `"no agent"`            | 1 failed — the unknown-vs-absent test                        |
| drop `out.line(presenceLine(...))`            | 2 failed — the depth+presence test and the end-to-end line   |
| `${GRACE_WINDOW}` → literal `16m`             | 1 failed — the derivation test (value equality still agreed) |

The third is the one worth noting: `AGENT_PRESENCE_WINDOW_SECONDS * 1000`
formats to exactly `16m` today, so a value-equality assertion passed against
the literal. The test that caught it is the one asserting the module reaches
the constant (`import { GRACE_WINDOW … } from "../agents.js"`) and carries no
`grace window (<digit>` of its own — CLI-043's rule, applied through the one
module that already names the constant rather than by naming it twice.

`npm test -w apps/cli`: 92 files, 1502 tests, all passing.
`tsc --noEmit -p apps/cli`: exit 0. `eslint` on the touched files: exit 0.
`docs/cli.md` regenerated (`npm run docs:cli -w apps/cli`) and Prettier-clean.

### Design notes for review

- **`halt` and `resume` deliberately do not print presence**, though the same
  `QueueStatus` comes back from both. They are acts and report what the act
  did; `status` is the verb asked "why is nothing happening". Pinned by a test
  so the choice is visible rather than accidental.
- **No second read of `GET /api/agents`.** CONTRACT-053 records that the two can
  legitimately disagree for one grace window, so corroborating here would print
  two facts as one. A test asserts `queue status` issues exactly one request,
  and the help names the divergence rather than leaving a reader to hit it.
- The vocabulary and the age rendering are `corpus agents`' own (`presenceOf`,
  `sinceAge`, `formatAge`), read at the workspace's grain — one derivation, so
  the two verbs cannot come to disagree about what three hours looks like.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CLI-046]` prefix
