# [CLI-058] Every call pays ~210ms of startup, and the agent loop makes hundreds

## Domain
cli

## Status
done

## Priority
P1

## Model
fable

## Dependencies
- Related: CLI-057 (batching, which reduces the count), CLI-055 (which reduces payload, not count)

## Spec References
- SPEC.md **§2** — the CLI is the agent's whole surface
- SPEC.md **§7** — the agent loop, which is made of CLI calls

## Summary

Reported from live use, 2026-08-21, measured: **~210ms fixed cost per call,
independent of payload.**

A skill making 20 calls spends **4.3 seconds** on overhead alone, and
`orchestrate` makes far more than 20.

This is filed as a question as much as a defect, because the answer may be
architectural rather than an optimisation.

## The three shapes, and none is obviously right

1. **Make startup cheaper.** Bundle analysis, lazy imports, deferring the client
   generation path. Bounded work with a bounded payoff — and 210ms is not
   obviously reducible to nothing, since some of it is Node itself.
2. **Batch.** CLI-057 does this for one verb. Generalised, it means a way to
   send several commands in one invocation. Cheap to build, but every verb needs
   to opt in and the agent's skills need teaching.
3. **A session mode.** A long-lived process the agent talks to, amortising
   startup across a whole loop. The largest payoff and the largest change: it
   introduces a stateful thing where today there is a stateless one, and §2's
   "nothing is global" and the workspace-resolution rule both have to be
   answered for it.

**Do not pick 3 by default because it is the biggest win.** The tool's
statelessness is a deliberate property and the server is already the stateful
half; a second stateful component wants a signed decision, not an
implementation.

## What this issue asks for first

**A measurement, before any building.** Break the 210ms down — Node boot, module
graph, config resolution, client construction, the HTTP round trip — so the
choice above is made against numbers rather than intuition. Report it, then
recommend, then stop and escalate rather than implementing option 3 unasked.

## Acceptance Criteria
- [x] The 210ms is broken down by phase, measured, and reported
- [x] A recommendation among the three shapes, with the rejected ones argued
- [x] Anything in option 1 that is cheap and safe is done, and re-measured
- [x] Options 2 and 3 are escalated with the numbers rather than built here

## Testing Strategy
A benchmark that can be re-run, checked in, so a later change cannot silently
undo the gain.

## The measurement

**Model: Opus 5 (1M context) — `claude-opus-5[1m]`.** Date 2026-08-23.

Measured on the **packaged bundle** (`npm run package:build` → one 841 kB esbuild
file), which is the shape a user installs. `apps/cli/dist` is ~120 separate
modules and costs measurably more to load, so benchmarking it would measure a
layout nobody has. Real server, real workspace, port **8931** in a scratch
directory — the user's server on 8765 was never touched.

**Every number here is a minimum over 40–60 runs, and the machine matters.** Two
other agents were working in this tree. Under load average 71 the same
`corpus health` measured 341 ms; at load average 3 it measured 158 ms. The
minimum is stable, the mean is not, and the comparisons below are all
**interleaved** — the two builds alternate inside one loop — so a drift in load
cannot masquerade as a saving.

### Where the ~210 ms goes

`corpus health` against a warm local server, instrumented at phase boundaries,
minimum of 40 runs, machine quiet:

| phase | ms | share |
|---|---:|---:|
| Node boot, to the first JS statement | 33.6 | 22 % |
| External packages (`@hono/zod-openapi` → `zod`, `yaml`, `openapi-fetch`) | 43.0 | 29 % |
| Parse of the 841 kB bundle | 18.2 | 12 % |
| First-party module init (contract schemas, the registry, 80 command modules) | 24.8 | 17 % |
| argv resolve, flag parse, actor, version read, workspace config | 1.4 | 1 % |
| **Client construction** | 18.4 | 12 % |
| HTTP round trip and rendering | 9.7 | 6 % |
| **total** | **150.3** | |

Spawning and reaping the process adds ~8 ms that an in-process clock cannot see,
so the figure a caller actually waits for is **158.5 ms** — `npm run
bench:startup -w apps/cli` reports it that way.

Two findings in that table were not expected:

**Client construction costs 18.4 ms, and it is not building a client.** The first
`createCorpusClient` call takes 18.4 ms and the second takes 0.0. Traced to one
line: the first `new Headers()` in a Node process initialises **undici**. Proved
directly — `new Headers()` alone, cold, is 18–80 ms depending on load, and a
cold round trip through `node:http` is ~15 ms against ~105 ms through `fetch` on
the same socket. Any CLI that speaks HTTP through `fetch` pays this once. Only a
different transport removes it, and the typed client is generated over
`openapi-fetch`.

**Registry validation is free, and the profiler said otherwise.** `--cpu-prof`
attributed 38 ms to `gloss.ts`'s `firstSentenceEnd` — the loop that checks every
description's opening sentence at module load — which looked like an obvious win.
It is a profiling artifact: profiled code runs in a lower JIT tier. A build with
`validateRegistry` replaced by the identity function measured **0 ± 1 ms** faster
across two independent A/B pairs. **Do not remove the load-time validation.**

### What each package costs

Minimum of 30 runs, `node --input-type=module -e 'await import(X)'`, machine
quiet. Node boot to the first statement is 33.6 ms; these are the totals with
that boot included.

| import | total | over boot |
|---|---:|---:|
| nothing | 33.6 | — |
| `openapi-fetch` | 36.7 | 3.1 |
| `yaml` | 48.6 | 15.0 |
| `zod` | 52.1 | 18.5 |
| `@hono/zod-openapi` | 66.4 | 32.8 |
| all four the bundle loads | 76.6 | 43.0 |

And, decisively for the escalation below: with `zod` **already loaded**,
importing `@hono/zod-openapi` still costs **18.4 ms** (minimum of 10).

## What was done here, and what it recovered

**`yaml` no longer loads on the startup path.** It had exactly one importer —
`migrations/corpus.ts`, the frontmatter reader behind `corpus upgrade`'s
migration detector — and a static import put it in front of every invocation of
every verb. It is now `await import("yaml")`, memoised as a promise, and
`readWorkspaceCorpus` / `parseFrontmatter` / `detectMigrations` became async to
carry it.

Two builds from the identical tree, differing in that one line, 60 interleaved
runs each:

```
corpus health, packaged-bundle shape, 60 runs each, interleaved
BEFORE (yaml on startup path)    min   168.7  p10   169.6  med   171.4 ms
AFTER  (yaml deferred)           min   158.6  p10   159.6  med   161.1 ms
saving                           min    10.1  p10    10.0  med    10.3 ms
```

**10.1 ms of 168.7 ms — 6.0 %**, and identical at min, p10 and median, which is
what a real saving looks like against a noisy machine.

## The recommendation: option 2, and option 1 is nearly spent

**Option 1 cannot get below ~135 ms, and two thirds of what it can still recover
is not in `apps/cli`.**

Everything option 1 has left, measured rather than estimated:

| change | saving | whose |
|---|---:|---|
| `yaml` deferred | **10.1 ms** | cli — **done here** |
| `"sideEffects": false` on `@corpus/contract` (drops 182 kB of OpenAPI route definitions the CLI never serves) | 5.0 ms | contract / infra |
| contract schemas import `zod` instead of `@hono/zod-openapi`, with `.openapi()` applied only where routes are defined | 18.4 ms | contract |
| **total** | **33.5 ms of 168.7 ms — 19.9 %** | |

The floor that leaves is **~135 ms**, and **more than half of it is Node's**:
33.6 ms of boot, 18.4 ms of undici, 18.5 ms of `zod`. A 20-call skill goes from
3.4 s of overhead to 2.7 s. That is worth having and it is not an answer.

**Rejected: making the command handlers lazy.** This looked like the big
structural win and it is not. A build whose registry holds a single command —
the upper bound on what any amount of lazy loading could save, since it removes
all 80 command modules from the graph rather than merely deferring them —
measured **8.4 ms** faster (208.9 against 217.3, interleaved, under load).
Against that, the registry is declared once and validated at load precisely so
that help, `docs/cli.md`, the dispatcher and CLI-059's stale-verb scan cannot
disagree; splitting every module into declaration and handler would put all four
at risk to buy under 4 %. Not worth it, and the number is why.

**Recommended: option 2, batching, because it is the only lever with an order of
magnitude in it.** Nothing above changes the *count* of invocations, and the
count is where the cost is. CLI-057, shipped alongside this issue, is the worked
example: five documents read in one call instead of five is **189 ms against
797 ms — 608 ms saved on one read**, which is 60× what deferring `yaml` bought.
The generalisation the issue describes — a way to send several commands in one
invocation — is a bigger question than one verb's plural form, and it wants its
own issue: it needs a decision about what a compound invocation's exit code and
`--json` value mean when the third command of five fails. **Escalated, not built
here.**

**Option 3, a session mode, is escalated with its number and no
recommendation.** It is worth **~135 ms per call**, i.e. everything the floor
above holds, and it is the only shape that reaches Node's boot and undici's
initialisation. It is also the one that puts a stateful component where the tool
is deliberately stateless. SPEC §2's "nothing is global" and the
walk-up-from-cwd workspace rule both have to be answered before it can be built —
which workspace does a session belong to, what happens when its config changes
under it, and what reaps it — and this issue's own instruction is not to pick it
by default because it is the biggest win. **It needs the user's signature, not an
implementation.**

## Two things filed for other domains

1. **`packages/contract`, worth 23.4 ms of every `corpus` call** (5.0 + 18.4):
   mark the package side-effect-free so the CLI bundle tree-shakes the route
   definitions, and import `z` from `zod` rather than from `@hono/zod-openapi` in
   `schemas/*.ts`, applying `.openapi()` where routes are built. Both are
   contract-dev's; neither changes any wire shape. The 18.4 ms is a pure tax: the
   CLI serves no routes and reads no `.openapi()` annotation.
2. `startup-cost.test.ts` pins the CLI's own eager third-party imports so this
   cannot silently come back. It does not — and should not — reach across the
   `@corpus/contract` boundary; the contract's own eager loads are the contract's
   to guard.

## E2E Verification Log

**Model: Opus 5 (1M context) — `claude-opus-5[1m]`.** Packaged bundle against a
real server on port 8931.

The checked-in benchmark, which is the artifact the Testing Strategy asked for:

```
$ npm run bench:startup -w apps/cli -- --workspace .../ws --runs 40
corpus startup cost — 40 runs each, minimum reported
  cli:       /Users/.../dist-package/dist/corpus.js
  workspace: /private/tmp/.../scratchpad/ws

Node boot                                         56.6 ms   36%
module graph (bundle parse + imports)             72.5 ms   46%
workspace, client, one round trip                 29.4 ms   19%
TOTAL, one `corpus health`                       158.5 ms  100%

medians, for the record: boot 73.8 ms, --version 143.2 ms, health 162.9 ms
A median well above the minimum means the machine was busy, not that the tool got slower.
```

(Node boot reads 56.6 ms here and 33.6 ms in the table above. Both are right: the
benchmark spawns a process and waits for it to exit, which is what a caller
pays; the table's clock starts inside the process.)

**The deferred `yaml` still works, on the one path that needs it.** A view
document written the pre-Phase-41 way was planted on disk, and the migration
detector — which is the only caller of the deferred parser — read its
frontmatter:

```
$ corpus workspace upgrade --dry-run
already up to date.

1 data migration — these files are written for a version of the tool that no longer reads them as they are. …
  views-to-board: `pinned` and a view's `order` are no longer read … and 1 view document here still relies on them, while no board lists it.
    corpus doc edit doc_seedboardfiles --columns doc_legacyview1
    corpus doc edit doc_legacyview1 --unset pinned --unset order
exit=0
```

### Falsification — the guard broken on purpose

`startup-cost.test.ts` would be worthless if it could not fail. The static
`import { parse } from "yaml"` was put back in `migrations/corpus.ts`:

```
   × the CLI's startup path > loads exactly the third-party packages it has argued for
+   "yaml",
   × the CLI's startup path > does not load `yaml`, which one migration detector needs and no verb does
     → expected [ '@corpus/contract', …(3) ] to not include 'yaml'
      Tests  2 failed | 6 passed (8)
```

Restored, 8 passed. The scan's own five unit tests cover the ways it could lie —
a type-only import, a dynamic import, and the words `import` and `from` inside
help prose and shell examples — because a scanner with a false positive gets
loosened, and a loosened scanner is the one that stops catching anything.

### Checks

- `npx vitest run apps/cli` — 2,015 passed, 104 files. Scoped runs only,
  `VITEST_MAX_THREADS=4`.
- `eslint apps/cli/src apps/cli/scripts` — clean, no rule disabled anywhere.
- `prettier --check apps/cli/src apps/cli/scripts docs/cli.md` — clean.
- `tsc --noEmit -p apps/cli/tsconfig.json` — clean.
- Test server on 8931 stopped; port 8765 never touched.
