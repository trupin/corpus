# [CONTRACT-021] Rider: queue deferred-status surface for SERVER-030

## Domain
contract

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: CONTRACT-002 (queue surface)
- Blocks: SERVER-030

## Spec References
- SPEC.md §7 — deferral wording (amended; the end-state SERVER-030 implements)

## Summary
Sprint-015 Open Conflict 5: SERVER-030 (honest queue defer/requeue) cannot ship
server-only — the job/event status enum lives in `packages/contract` and the console UI
renders from it. Define the wire surface for the deferred state: the status enum value,
any transition metadata the amended §7 requires (reason, retry linkage), and what
`corpus job retry` / `queue` verbs read. Scope exactly to what SPEC §7's amended
deferral paragraph describes — no speculative states. Note: the §7 clauses this spends
are in SHARED-004's sign-off set (item 7); coordinate wording, don't touch SPEC.md.

## Acceptance Criteria
- [x] Deferred status + metadata modeled per amended §7; existing statuses untouched
- [x] openapi.json + client regenerated; strictness/enum tests per house pattern
- [x] Consumer impact enumerated in the log (server handlers, console rendering, CLI verbs) so SERVER-030 and any UI/CLI riders are filed with real scope

## Technical Design
### Files to Create/Modify
- `packages/contract/src/` queue/job schemas + routes (+ tests), regenerated artifacts

## Testing Strategy
Schema/enum tests; generation idempotence.

## E2E Verification Plan
Typecheck across consumers (server may temporarily need exhaustiveness-case handling — coordinate commits like the CONTRACT-019/SERVER-034 pairing if a switch breaks).

## E2E Verification Log

**implemented on: opus** (2026-07-30, contract-dev)

### What §7 actually says, and what was modelled from it

The amended lock bullet: the orchestrator replies to the waiting thread, "fails the event with a
`deferred:`-prefixed reason, and the work re-enters the queue via `corpus job retry` … **A
dedicated defer/requeue queue state that re-enters automatically on lock release is planned
(SERVER-030); until then the deferral is visible as an actionable failed job, never silently
dropped.**" The force-unlock bullet: "the agent's deferred edit stays retryable (`corpus job
retry`) rather than being lost." §7's status list: `pending → in-progress → processed | failed`,
plus `abandoned`.

That yields exactly four wire facts, and nothing beyond them was invented:

1. **One new status, `deferred`** — "a dedicated defer/requeue queue **state**". Singular. No
   `waiting`, no `blocked`, no per-reason variants. `QUEUE_EVENT_STATUSES` gains it after
   `in-progress` (non-terminal states first, since the constant is what the server iterates to
   create `.corpus/queue/<status>/`); no existing member is removed or renamed.
2. **The blocking document** — "re-enters automatically **on lock release**" is unimplementable
   without knowing which lock. It is supplied at defer time rather than read from the payload,
   because the payload cannot always carry it: `comment.created` has `parentId`, `form.respond`
   has `{threadId, formTs, option, note}` and names no document, and plugin event types own their
   own payload shapes.
3. **A verb to enter the state** — the CLI is a thin HTTP client, so the transition needs a route.
   `POST /api/queue/{id}/defer`, beside `complete`/`fail`/`abandon`.
4. **`job retry` keeps its role** — §7 names it in the force-break bullet, so it stays, now
   documented as the *manual override* that automatic re-entry supplements rather than replaces.

**Deliberately not modelled** (would have been speculative): no route for the reverse transition
(re-entry is the server's reaction to the lock clearing, not a client request); no `deferredAt`
(the store's `updated` already stamps every transition); no `deferredUntil`/TTL (§7 gives a
deferral no expiry — lock reap is what ends it); no `deferred` count split by reason.

### What shipped

- `schemas/queue.ts` — `"deferred"` in `QUEUE_EVENT_STATUSES`; `QueueEventStatusSchema`'s
  description now says which values are terminal and that `deferred` is neither terminal nor
  claimable; `QueueStatusSchema` gains a required `deferred` count; new
  `DeferEventRequestSchema` (`z.strictObject`, `blockedOn` required `DocumentId`, `reason?`).
- `routes/queue.ts` — `deferEvent`: `POST /api/queue/{id}/defer`, actor header, mandatory body,
  responses `200 QueueEvent` / `400` / `401` / `404` / `409`.
- `schemas/job.ts` — `Job.blockedOn` and `Job.blockedOnTitle`, both required-and-nullable,
  following `originId`/`originTitle`'s denormalised-read rule verbatim.
- `routes/jobs.ts` — `retryJob` summary/description widened to failed **or deferred**, naming
  itself the manual override.
- `query-keys.ts` — the `queue` key's emitters now read "…complete, fail, defer, abandon, reap,
  halt/resume, and any lock release, break or reap that re-enters a deferred event" (it already
  named the break case). This text is published verbatim in the `/events` description.
- Registered in `routes/index.ts` + `routes/inventory.ts`; artifacts regenerated.

### The one judgement call: `409` on defer

Only an `in-progress` event may be deferred — nothing else has tried the edit yet, and terminal
events are done. That mirrors `POST /api/jobs/{id}/retry`, which already answers `409` from
`requeue({onlyFrom})`. It is stated in the route description so SERVER-030 implements it rather
than inferring it, and it means a second defer of the same event is a `409` rather than a silent
no-op. (`complete`/`fail`/`abandon` are state-agnostic today and stay that way — untouched.)

### Tests

- `VITEST_MAX_THREADS=4 vitest run packages/contract` → **39 files, 1304 tests, all pass** (shared
  run with CONTRACT-020).
- New/extended: `schemas/queue.test.ts` (status-set ordering pin, rejection of undefined states
  incl. `"deferred:lock"`, seven-field `QueueStatus`, and a `DeferEventRequest` block covering the
  mandatory `blockedOn`, thread ids, blank reason, wrong id prefix and three unknown keys);
  `schemas/job.test.ts` (deferred row round-trip, missing blocking title, both keys demanded,
  wrong id prefix); `routes/index.test.ts` (defer stub handler + four live-request cases through
  the mounted app); `openapi.test.ts` (+12 cases in "the deferred queue state (CONTRACT-021)",
  plus the widened `Job.required` pin); `client/index.test.ts` fixture.
- `typecheck` / `eslint` / `prettier --check` on `packages/contract` → all exit 0. No rule
  disabled, no test deleted; the two pinned lists that changed (`Job.required`, `QueueStatus`
  field order) were widened deliberately and are listed here.

### Artifact regeneration and idempotence

```
$ npm run generate -w packages/contract
$ shasum -a 256 openapi.json src/client/schema.generated.ts > before.sha
$ npm run generate -w packages/contract && shasum -a 256 -c before.sha
openapi.json: OK
src/client/schema.generated.ts: OK      # exit 0 — byte-stable
```

Document: **41 paths, 75 components**. This issue adds `POST /api/queue/{id}/defer` and the
`DeferEventRequest` component (`required: ["blockedOn"]`, `additionalProperties: false`);
`QueueStatus` goes to seven properties; `Job` to ten; the status enum everywhere reads
`["pending","in-progress","deferred","processed","failed","abandoned"]`.

**Drift check not run** — it shells out to `git diff --stat HEAD --` and this agent runs no git
commands (harness rule). Substitute evidence is the double-generation checksum; the orchestrator's
post-commit run is authoritative (accepted pattern, sprint-015 Adjudication 12).

### Consumer impact — enumerated, with the typecheck breaks this rider causes

Measured by building `packages/contract` (and `packages/kit`) and running each workspace's
`tsc --noEmit`. **These breaks are expected and are left for the paired commits**, exactly as
CONTRACT-019/SERVER-034 were paired; nothing was loosened to make them go away.

**`apps/server` — 2 typecheck errors (SERVER-030 fixes them):**

- `src/queue/service.ts:371` — the `QueueStatus` literal is missing `deferred`. The counts are
  already computed by iterating `QUEUE_EVENT_STATUSES`, so this is a field to surface, not a new
  computation.
- `src/jobs/project.ts:119` — the projected `Job` is missing `blockedOn`/`blockedOnTitle`. Needs a
  stored `blockedOn` on the event record (beside the existing `error`/`attempts`) and the same
  title join `originTitle` already does.

**`apps/server` — further work with no typecheck signal (silent until implemented):**

- `src/queue/store.ts:191` creates one directory per status → `.corpus/queue/deferred/` appears
  automatically, but `store.test.ts:42` asserts the directory listing equals the status set and
  will fail until the workspace is re-scaffolded in-test. `projection/project-runtime.ts:57-59`
  and `watcher/paths.ts:53` also iterate the set and will start classifying `deferred/` files.
- `service.ts`'s `availablePending()`/`claimAll` must keep skipping `deferred` (it reads only
  `pending/`, so this is already true — worth an explicit test rather than an implicit one).
- `requeue({onlyFrom: "failed"})` for `POST /api/jobs/{id}/retry` must widen to accept `deferred`
  (§7's manual override), and a new `defer` transition with `onlyFrom: "in-progress"`.
- The lock paths — release, break, **and** reap — become queue triggers. That coupling is new
  (`apps/server/src/locks` ↔ `apps/server/src/queue`) and is the substance of SERVER-030.
- Invalidation: emit `QUEUE_QUERY_KEYS` + `JOBS_KEY` on defer and on every re-entry, and the lock
  keys on the release itself — the vocabulary already says so, so a missing emit is a lie in a
  published description.

**`apps/ui` — 5 typecheck errors (UI rider, not yet filed):**

- `src/console/consoleModel.ts:25` — `JOB_DOT_CLASSES` is an exhaustive
  `Record<QueueEventStatus, JobDotClass>`; needs a `deferred` dot that reads as *waiting*, not
  *broken* (sprint-015 TEST-355). `consoleModel.test.ts:31` asserts the key set equals
  `QUEUE_EVENT_STATUSES`, so the test moves with it.
- `src/console/consoleModel.ts:104` — `UNKNOWN_QUEUE_STATUS` needs `deferred: 0`; and
  `queueSummary` (`:95-101`) should surface the deferred count separately from `failed`, which is
  the whole user-visible point.
- `src/console/Console.test.tsx:32,42` and `consoleModel.test.ts:16` — fixtures.
- No typecheck signal, but in scope for the rider: rendering `blockedOn`/`blockedOnTitle` on the
  deferred row (TEST-356), and deciding whether `packages/kit/src/row/useRowSignals.ts:18`'s
  `ACTIVE_JOB_STATUSES` (`["pending","in-progress"]`) should count a deferred job as active on a
  document row. **`packages/kit` typechecks clean** — that array is typed
  `readonly QueueEventStatus[]`, so it is a judgement call, not a compile error.

**`apps/cli` — 0 typecheck errors, but two real changes (CLI rider, not yet filed):**

- `src/commands/init/scaffold.ts:41` hard-codes its **own** `QUEUE_STATUSES` copy rather than
  importing the contract's, so a fresh workspace gets no `.corpus/queue/deferred/` and nothing
  fails to compile. Sprint-015 TEST-363/TEST-365 already anticipate this file. Importing
  `QUEUE_EVENT_STATUSES` from `@corpus/contract` would make the duplication impossible to repeat.
- `src/commands/queue/control.ts:14-16, 98, 106` — the status line and both help/`--json` examples
  enumerate the five counts and must gain `deferred`; `docs/cli.md` regenerates from them.
- A verb for the new transition (`corpus queue defer <id> --blocked-on <docId> [--reason …]`, name
  is the CLI's call), plus retiring the interim `queue fail --reason "deferred:…"` protocol
  (sprint-015 TEST-357) and the orchestrate-skill rider that documents it (TEST-359).

### SPEC.md §7 — spent clauses, recorded not edited

`git diff SPEC.md` from this agent is empty by construction (this agent runs no git commands and
edited no file outside `packages/contract` and these two issue files). Three sentences become
stale when SERVER-030 lands, for the SHARED-004 sign-off set:

1. §7's status list — `pending → in-progress → processed | failed`, plus `abandoned` — gains
   `deferred` as an explicitly non-terminal, non-claimable state.
2. The lock bullet's interim protocol ("fails the event with a `deferred:`-prefixed reason … A
   dedicated defer/requeue queue state … is planned (SERVER-030); until then …") is spent in
   full and should be flattened to the deferral behaviour itself.
3. The force-unlock bullet's "stays retryable (`corpus job retry`)" becomes "re-enters
   automatically; `corpus job retry` remains the manual override".

### UI consumption — done (ui-dev)

**implemented on: opus** (2026-07-30). The five `apps/ui` typecheck errors this rider predicted are
closed, with no defer/requeue UI built (that stays SERVER-030's). `JobDotClass` gains a `deferred`
member and `JOB_DOT_CLASSES` a `deferred: "deferred"` entry — its own selector rather than
`failed`'s or `abandoned`'s, because a deferred job is neither broken nor a tombstone; `design/index.html`
draws no parked affordance, so `.job-dot.deferred` takes pending's `--sepia` (already the
"hasn't run yet" hue, so it asserts nothing untrue) under a distinct class SERVER-030 can restyle
without touching the mapping. `consoleCounts` surfaces the deferred count as its own segment beside
`queued` (`N running[· N queued][· N deferred] · N done · N failed`, omitted at zero exactly as
`queued` is) rather than folding it into `queued` or `failed` — the whole user-visible point of the
state — and it stays inside `lead` because nothing about it is red; the shipped e2e assertion
`"0 running · 0 done · 0 failed"` is unaffected. `UNKNOWN_QUEUE_STATUS` gains `deferred: 0`, and the
`Console.test.tsx` / `consoleModel.test.ts` fixtures gain `deferred: 0` plus
`blockedOn: null` / `blockedOnTitle: null`. Three tests added: the dot mapping for `deferred` (and
that it differs from `failed` and `abandoned`), the counts segment appearing and being omitted, and a
rendered deferred row asserting `class="job-dot deferred"`. The mapping's exhaustiveness test
(`Object.keys(JOB_DOT_CLASSES) === QUEUE_EVENT_STATUSES`) needed no change and now covers six
statuses. Deliberately **not** done, and left to SERVER-030's phase: no defer/requeue controls, no
`blockedOn`/`blockedOnTitle` rendering on the row (TEST-356), and `packages/kit`'s
`ACTIVE_JOB_STATUSES` left as `["pending","in-progress"]` — a deferred job is *not* actively being
worked, so counting it as an active signal on a document row would be the same lie the dot avoids;
if SERVER-030 wants a distinct parked signal on rows, that is a kit decision to file, not a silent
widening here. Verification: `tsc --noEmit` in `apps/ui` → **exit 0**; `vitest run apps/ui/src` →
**88 files, 1302 tests, all pass**; `eslint` + `prettier --check` on `apps/ui/src/console` → exit 0.
No e2e run (single-holder, orchestrator's gate).

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier + tsc, scoped to `packages/contract`)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
