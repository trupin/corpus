# [CLI-031] `corpus job list --status` — make the contract's "one documented route away" true for the agent

## Domain

cli

## Status

done

## Priority

P1 (important)

## Model

opus

## Dependencies

- Depends on: [CONTRACT-030]
- Blocks: —

## Spec References

- SPEC.md Section 7 — "The Queue" (job statuses, reconciliation, the agent reaches the system only through the CLI)
- SPEC.md Section 11 — "The Board" (the console's job list)
- CLAUDE.md Architecture Decision 2 — the CLI is the agent's only interface

## Summary

`packages/contract/src/schemas/queue.ts` tells the reader of the capped in-progress
set that the complete inventory is "one documented route away
(`GET /api/jobs?status=in-progress`), so the cap never puts anything out of reach",
and that "the cap bounds this report, never the caller's reach". For the one party
that field exists for — the product agent — that claim was false: the agent reaches
the system only through the CLI, and `corpus job list` carried `--recent` and nothing
else. The route's `status` and `originId` parameters (CONTRACT-030) had no CLI
spelling, so a `… and N more held, not shown` line from `corpus queue claim-all` named
a number the agent had no verb to expand.

This issue surfaces both parameters on `corpus job list` — `--status <set>` and
`--origin <doc-id>` — passing them through verbatim. No contract change, no server
change: a pure CLI surfacing job that makes a published claim true rather than
softening it.

## Acceptance Criteria

- [x] `corpus job list --status <set>` sends the comma-separated set to
      `GET /api/jobs?status=…` unchanged — same grammar as `JobsQuerySchema`, no second
      spelling.
- [x] `corpus job list --origin <doc-id>` sends `originId`, the complete per-document
      predicate.
- [x] An unknown status surfaces the server's `400` through the CLI's uniform error
      surface, naming the legal values; the CLI holds no second list of statuses to
      validate against.
- [x] Both flags are declared in the registry, so `--help` and `docs/cli.md` come from
      one source; `docs/cli.md` regenerated.
- [x] `--recent`'s help states that it bounds the list and is **ignored once `--origin`
      is given**, and `--status`'s help does not imply the filtered list is unwindowed.
- [x] `--json` still emits exactly one machine-readable value.
- [x] The empty-result line distinguishes "nothing has run" from "nothing matched the
      filter".
- [x] Colocated tests, including the unknown-status path.

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/job/console.ts` — collect the two new flags into the wire
  query; declare them on `listCommand`; sharpen the empty line.
- `apps/cli/src/commands/job/console.test.ts` — pass-through, interaction, and
  unknown-status tests.
- `docs/cli.md` — regenerated (`npm run docs:cli -w apps/cli`).

### Key Implementation Details

- Type the query object from the generated client
  (`paths["/api/jobs"]["get"]["parameters"]["query"]`), so a contract rename stops the
  verb compiling rather than sending a filter nowhere. This is `doc list`'s pattern.
- Build the query with conditional spreads: under `exactOptionalPropertyTypes` an
  explicit `undefined` is not an absent key, and an absent key is what "no such filter"
  means on the wire.
- **`--status` is passed through, not validated.** `commands/filters.ts`'s `oneOf`
  precedent applies to single-valued enum flags; this parameter is a *set*, and its
  grammar (splitting, trimming, dropping empties, "at least one value", the per-value
  enum check) is owned by `JobsQuerySchema.StatusSetSchema`. A CLI-side re-implementation
  would be a second copy of both the vocabulary and the parsing rules — exactly the drift
  the contract's boundary validation exists to prevent. The contract's own docblock says
  it validates there so a typo is "a `400` naming the legal values, not a filter that
  silently matches nothing", and that error already reaches the caller through
  `client.ts`'s `responseError`, which lifts `issues` into `details`.
- The **help text** may name the legal values by interpolating the contract's exported
  `QUEUE_EVENT_STATUSES`. That is the same single source, not a copy — the same thing
  `DOC_FILTER_FLAGS` does with `DOC_STATUSES`.
- Honour `recent`'s documented interaction: the server drops its `LIMIT` only when
  `originId` is given (`apps/server/src/jobs/project.ts#listJobRows`). A `--status`
  filter on its own is still windowed by `recent`, so the help must not read as a
  completeness guarantee.

### Edge Cases

- `--status` with an unknown value → server `400`, CLI exit 5, `issues` rendered as
  details naming every legal status.
- `--status` and `--origin` together → both sent; `recent` is ignored server-side.
- Empty result with a filter → "no jobs match." rather than "no jobs yet."
- `--status` set repeated/whitespaced (`"pending, deferred"`) → the contract trims; the
  CLI does not touch it.

## Testing Strategy

Vitest against the real `node:http` stub server (`testing/stub-server.ts`), the pattern
the rest of `job/console.test.ts` uses: assert the query string the CLI actually put on
the wire, the rendered rows, the `--json` value, and the mapped error for a `400`.

## E2E Verification Plan

### Verification Steps

1. Build, `corpus init` a scratch workspace, start its server on a scratch port (never
   8765).
2. Create real queue work so jobs exist in more than one status; claim some to get
   `in-progress` rows.
3. Run `corpus job list`, `--status in-progress`, `--status pending,deferred`,
   `--origin <thread-id>`, `--status nope`, and the `--json` forms; capture output and
   exit codes.
4. Stop the server, remove the scratch workspace, confirm the port is free.

## E2E Verification Log

### Post-Implementation Verification

Implemented on: **opus**.

`npm run build`, then the **built** CLI (`node …/apps/cli/dist/bin/corpus.js`) against a
real server in a scratch workspace on port **8931**. Port 8765 was never touched (it was
listening for another session throughout, and still was afterwards).

Setup — a real workspace, a real server, and real queue work created through real verbs:

```
$ node …/dist/bin/corpus.js init /tmp/corpus-cli031 --port 8931
Initialized Corpus workspace at /tmp/corpus-cli031
  port 8931, token in .corpus/config.json (mode 600)
  …
$ cd /tmp/corpus-cli031 && node …/dist/bin/corpus.js server start
corpus 0.3.0 listening on http://127.0.0.1:8931 (pid 29172)

$ node …/dist/bin/corpus.js doc create --type note --title "Rate assumptions" --folder finance --from user
created doc_cp5sox7e — data/docs/finance/rate-assumptions.md
$ node …/dist/bin/corpus.js thread create --parent doc_cp5sox7e --title "Are these rates current?" -m "@agent is this still right?" --from user
created th_snsz2bnt — on doc_cp5sox7e (whole document) (queued evt_7swddyrsjio6)
… (five more threads, each queueing a `comment.created` event)

$ node …/dist/bin/corpus.js queue claim-all --from agent      # → five events in-progress
$ node …/dist/bin/corpus.js job log evt_7swddyrsjio6 "wrote the reply" --from agent
$ node …/dist/bin/corpus.js queue complete evt_7swddyrsjio6 --from agent
event evt_7swddyrsjio6 is complete.
$ node …/dist/bin/corpus.js queue fail evt_eftygmwgccxt --from agent
event evt_eftygmwgccxt is failed.
$ node …/dist/bin/corpus.js lock acquire doc_cp5sox7e --from user
locked doc_cp5sox7e for user, lease 300s.
$ node …/dist/bin/corpus.js queue defer evt_t7vd3j3aodcf --blocked-on doc_cp5sox7e --from agent
event evt_t7vd3j3aodcf is deferred on doc_cp5sox7e.
```

That leaves jobs in five of the six statuses. The unfiltered list — unchanged behaviour:

```
$ node …/dist/bin/corpus.js job list
evt_mntnuvcapqho pending
evt_t7vd3j3aodcf deferred waiting on the edit lock
evt_eftygmwgccxt failed could not parse the reply
evt_7swddyrsjio6 processed wrote the reply
evt_iqndh3w6sqgd in-progress
evt_7sst5prj6zkr in-progress
```

**`--status`, the question the contract's claim is about:**

```
$ node …/dist/bin/corpus.js job list --status in-progress ; echo "exit=$?"
evt_iqndh3w6sqgd in-progress
evt_7sst5prj6zkr in-progress
exit=0

$ node …/dist/bin/corpus.js job list --status pending,in-progress,deferred ; echo "exit=$?"
evt_mntnuvcapqho pending
evt_t7vd3j3aodcf deferred waiting on the edit lock
evt_iqndh3w6sqgd in-progress
evt_7sst5prj6zkr in-progress
exit=0

$ node …/dist/bin/corpus.js job list --status processed --json ; echo "exit=$?"
{"jobs":[{"eventId":"evt_7swddyrsjio6","type":"comment.created","status":"processed","started":"2026-08-06T17:24:23Z","updated":"2026-08-06T17:24:23Z","lastLine":"wrote the reply","originId":"th_snsz2bnt","originTitle":"Are these rates current?","blockedOn":null,"blockedOnTitle":null}]}
exit=0
```

Exactly one machine-readable value: `… --json | jq -e 'has("jobs")'` → exit 0.

**`--origin`, the complete per-document predicate** (`recent` dropped server-side — the
same rows come back with `--recent 1`). Note the documented origin rule at work: these
events name a live `threadId`, so their origin resolves to the thread, not to its parent
document, and `--origin doc_cp5sox7e` correctly matches nothing.

```
$ node …/dist/bin/corpus.js job list --origin th_snsz2bnt ; echo "exit=$?"
evt_7swddyrsjio6 processed wrote the reply
exit=0

$ node …/dist/bin/corpus.js job list --origin th_snsz2bnt --recent 1   # same row: recent ignored
evt_7swddyrsjio6 processed wrote the reply
```

**The window is real and the help says so** — a `--status` filter narrows *within*
`--recent` rather than lifting it, which is exactly what the flag's description claims:

```
$ node …/dist/bin/corpus.js job list --status in-progress --recent 1
evt_iqndh3w6sqgd in-progress          # one of the two held events, not both
```

**A filter that matches nothing reads as a filter, not as an empty queue:**

```
$ node …/dist/bin/corpus.js job list --status abandoned ; echo "exit=$?"
no jobs match.
exit=0
```

**The unknown-status path — the server's `400` as the CLI's uniform error, naming every
legal value, with no client-side vocabulary involved:**

```
$ node …/dist/bin/corpus.js job list --status in_progress ; echo "exit=$?"
corpus: 400 bad_request: request failed validation
  [
    {
      "path": "query.status",
      "message": "unknown job status \"in_progress\"; expected one of pending, in-progress, deferred, processed, failed, abandoned"
    }
  ]
exit=5

$ node …/dist/bin/corpus.js job list --status nope --json ; echo "exit=$?"
{"error":{"code":"bad_request","message":"400 bad_request: request failed validation","details":[{"path":"query.status","message":"unknown job status \"nope\"; expected one of pending, in-progress, deferred, processed, failed, abandoned"}]}}
exit=5

$ node …/dist/bin/corpus.js job list --status "pending,nope"   # one bad member fails the whole set
corpus: 400 bad_request: request failed validation
  [ { "path": "query.status", "message": "unknown job status \"nope\"; expected one of pending, in-progress, deferred, processed, failed, abandoned" } ]
```

And the grammar is genuinely the contract's, not a second spelling — whitespace inside
the set is trimmed by `StatusSetSchema`, and the CLI never looks at it:

```
$ node …/dist/bin/corpus.js job list --status "pending, deferred"
evt_mntnuvcapqho pending
evt_t7vd3j3aodcf deferred waiting on the edit lock
```

Help comes from the one registry (`corpus job list --help`, verbatim):

```
Flags:
  --status <a,b>     Comma-separated job statuses; values OR together. Legal values: pending, in-progress, deferred, processed, failed, abandoned. Sent to the server unchanged, so a misspelled value comes back as an error naming the legal set rather than as an empty list. The window still applies: this returns the `--recent` most recent jobs **with these statuses**, not every one that ever had them.
  --origin <doc-id>  Only jobs originating from this document or thread — the `originId` the console links through. A predicate about one document rather than a narrowing of the list, so it is answered **completely**: `--recent` is not applied.
  --recent <count>   How many of the most recent jobs to show. The server applies its own default. Bounds this list only, and is **ignored once `--origin` is given**.
```

Teardown:

```
$ node …/dist/bin/corpus.js server stop
stopped (pid 29172)
$ lsof -nP -iTCP:8931 -sTCP:LISTEN     # no output — port free
$ rm -rf /tmp/corpus-cli031
```

Checks: `VITEST_MAX_THREADS=4 npx vitest run apps/cli` — **1286 passed, 0 failed**
(includes `docs/generate.test.ts`'s "matches the committed docs/cli.md"). `npx eslint`
and `npx prettier --check` clean on `job/console.ts`, `job/console.test.ts`, `docs/cli.md`
and this issue file. `npm run docs:cli -w apps/cli` regenerated `docs/cli.md`.

**Conclusion: PASS.** Both filters reach the wire unchanged, an unknown value is a `400`
naming the legal statuses rather than a silently empty list, and the reach the contract
advertises is now spelled in the only interface the agent has.

**One honest limit, recorded rather than papered over.** `--status in-progress` is
bounded by `recent` (server default 50, `MAX_RECENT_JOBS` 200) — the route itself windows
it, and no CLI flag can lift that. So the agent's reach past the claim report's cap of 20
goes to 200, not to infinity, and the response carries no `total` with which to detect
that cut. In practice the magnitude is not hidden: `queue claim-all`'s `inProgress.total`
already tells the agent the true count, so a caller can compare. If the queue surface ever
needs a genuinely unbounded inventory, that is a contract issue (a `total` on `JobList`, or
`originId`'s window-dropping extended to `status`), not a CLI one.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (scoped: eslint + prettier on touched files)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
