# [CLI-029] Surface the in-progress set in `queue claim-all` and `queue idle`

## Domain

cli

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-015 (signed), CONTRACT-033
- Blocks: AGENT-013

## Spec References

- SPEC.md §7 — "**The agent can see what the server still thinks it is doing.**"
- SPEC.md §2.3 — the command surface is data; `--json` is the agent's normal mode
- `packages/contract/src/schemas/queue.ts` — `InProgressSetSchema`,
  `InProgressEventSchema`, `MAX_IN_PROGRESS_REPORTED`

## Summary

CONTRACT-033 added a required `inProgress` field to the `claim-all` and `idle`
responses: the events the server currently holds `in-progress/`, most recently
claimed first, capped at 20 with an explicit `total`/`truncated` overflow pair.
The CLI dropped it on the floor — `claim-all` printed the batch, `idle` rebuilt
its own `{events}` object and discarded everything else. This issue surfaces it
in both verbs, as **its own field** in `--json` and as a readable block for a
human, so the agent can reconcile the server's view against its own memory
(SPEC.md §7). The loop rule that says what to *do* with the list is AGENT-013.

## Acceptance Criteria

- [x] `corpus queue claim-all --json` emits `inProgress` verbatim as published by
      the contract — its own key, not flattened into `events`, not renamed.
- [x] `corpus queue idle --json` does the same when the window returns work; the
      `204` path is untouched (no body, so nothing to reconcile).
- [x] The overflow signal reaches both surfaces: `total` and `truncated` in
      `--json`, and an explicit "and N more held, not shown" row plus a total in
      the human block. Neither prints a capped list that reads as complete.
- [x] `heldSince` stays an ISO instant in `--json`; the human block renders it as
      an elapsed age (`held 3h`).
- [x] Nothing is printed at all when the set is empty.
- [x] `claim-all`'s stdout stays exactly one JSON line in **both** modes — the
      orchestrate skill pipes it and `docs/cli.md` documents
      `corpus queue claim-all | jq …`.
- [x] Registered declaratively; `docs/cli.md` regenerated.
- [x] Colocated tests; `npx eslint` / `npx prettier --check` clean on touched files.

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/queue/in-progress.ts` — new: age formatting, the block
  renderer, and the `Output` adapter both verbs call.
- `apps/cli/src/commands/queue/in-progress.test.ts` — new.
- `apps/cli/src/commands/queue/claim-all.ts` — report the set; registry prose.
- `apps/cli/src/commands/queue/idle.ts` — pass `inProgress` into the emitted
  value and report the block.
- `apps/cli/src/commands/queue/poll.ts` — carry `inProgress` out of the poll
  instead of discarding it.
- `apps/cli/src/output.ts` — new `Output.note()`: human prose to **stderr**,
  suppressed under `--json`.
- `apps/cli/src/commands/hygiene.test.ts` — add the new module to the pinned
  inventory.
- `docs/cli.md` — regenerated.

### Key Implementation Details

**Why the human block goes to stderr.** `claim-all`'s stdout is a machine
payload in *both* modes — that is a documented invariant, the orchestrate skill
runs the bare verb and parses stdout, and `docs/cli.md` publishes
`corpus queue claim-all | jq -r '.events[].id'`. Human prose appended to stdout
would break every one of those. stderr is the only channel left, it is the
conventional one for diagnostics, and the stream split is itself the "never
confuse the two lists" guarantee the rider asks for: what you claimed is on
stdout, what the server thinks you already had is on stderr. `idle` uses the same
channel for the same block, so the two verbs read identically.

`Output.note()` is suppressed under `--json` because stderr in that mode is
reserved for the `{"error":{…}}` envelope, and the set is already in the JSON.

**Tolerance is deliberate and narrow.** `reportInProgress` accepts
`InProgressSet | undefined`. By the time it runs, `claim-all` has already moved
events out of `pending/`: a throw would strand a batch the server has already
handed over. A missing report costs a diagnostic; a lost batch costs the work.

### Edge Cases

- `originTitle` null with `originId` set (document deleted since) — falls back to
  the id, then to `—`.
- Unparseable `heldSince` — prints `held since <raw>` rather than `held NaNs`.
- `truncated` true or `total > events.length`: either alone triggers the overflow
  row, so neither half is trusted as the sole signal.
- Clock skew putting `heldSince` in the future — clamped to `held 0s`.

## Testing Strategy

Colocated Vitest. `in-progress.test.ts` covers the age ladder, the empty-set
silence, origin fallbacks and the overflow row. `claim-all.test.ts` and
`idle.test.ts` drive the real generated client against the real `node:http` stub
server and assert the stdout/stderr split in both modes.

## E2E Verification Plan

Build the CLI, `corpus init` a scratch workspace on a free port, start the real
`corpus server`, and drive the built bin against it. Enqueue real events with
`corpus thread create --requests-agent true`; claim once to move them into
`in-progress/`, then claim again so the second call reports the first call's
events. Push past 20 held events for truncation, delete a held event's thread for
the origin fallback, and let a minute pass for the age ladder. Never touch port
8765.

## E2E Verification Log

_Implemented on: opus._

### Post-Implementation Verification

**Build.** `npm run build -w packages/contract -w apps/cli` — exit 0. Every
command below runs the built bin (`apps/cli/dist/bin/corpus.js`) against a real
`corpus server` on a scratch workspace, port **8931** (8765 never touched).
SERVER-061 had landed by the time this ran (`apps/server/src/queue/held.ts`), so
the whole path is real — no stub anywhere.

**Setup.**

```
$ node …/dist/bin/corpus.js init /tmp/cli029-ws --port 8931
Initialized Corpus workspace at /tmp/cli029-ws
$ (cd /tmp/cli029-ws && node …/dist/bin/corpus.js server start)
corpus 0.3.0 listening on http://127.0.0.1:8931 (pid 60360)
```

**1 — nothing held: silence.** The overwhelmingly common case, and the one that
must not add noise to every loop iteration.

```
$ corpus queue claim-all
--- stdout ---
{"events":[],"inProgress":{"events":[],"total":0,"truncated":false}}
--- stderr ---
(empty)          exit 0
$ corpus queue claim-all --json     → byte-identical stdout, stderr empty
```

**2 — two events claimed, then re-claimed.** Two threads created with
`--requests-agent true`; the first `claim-all` moves both to `in-progress/` and
reports an **empty** set (correct — the set is read as it stood before the
claim), the second reports them.

```
$ corpus queue claim-all      # first
--- stdout ---
{"events":[{"id":"evt_247r6bicwb2k",…},{"id":"evt_2dg5schocgu5",…}],"inProgress":{"events":[],"total":0,"truncated":false}}
--- stderr --- (empty)

$ corpus queue claim-all      # second, human mode
--- stdout ---
{"events":[],"inProgress":{"events":[{"id":"evt_2dg5schocgu5","type":"comment.created","heldSince":"2026-08-06T16:33:22Z","originId":"th_negqh5xh","originTitle":"Q3 planning"},{"id":"evt_247r6bicwb2k","type":"comment.created","heldSince":"2026-08-06T16:33:22Z","originId":"th_km6wod6c","originTitle":"Re: the rate assumption"}],"total":2,"truncated":false}}
--- stderr ---
the server still holds 2 events in-progress — not claimed by this call:
  evt_2dg5schocgu5  comment.created  held 5s  Q3 planning
  evt_247r6bicwb2k  comment.created  held 5s  Re: the rate assumption
```

stdout is still exactly one JSON line; the instant `2026-08-06T16:33:22Z`
survives to the agent and is rendered `held 5s` for the person.

**3 — `--json` suppresses the block.** Same state, `corpus queue claim-all
--json`: stdout identical to the above, **stderr empty**.

**4 — truncation, real.** 20 further threads created and claimed, giving 23 held;
the next claim caps at 20:

```
$ corpus queue claim-all
--- stdout (elided) ---
{"events":[],"inProgress":{"events":[…20 rows…],"total":23,"truncated":true}}
--- stderr ---
the server still holds 23 events in-progress — not claimed by this call:
  evt_zfjjedkgyg3t  comment.created  held 6s  Filler 18
  evt_vtfguwslyxhn  comment.created  held 6s  Filler 5
  …18 more rows…
  evt_4ss6ruvg4b23  comment.created  held 6s  Anchor policy
  … and 3 more held, not shown (23 in total)
```

The header carries the true total (23, not 20) and the final row names the
remainder — the cut is stated twice and cannot read as a complete list. In
`--json` the same fact is `"total":23,"truncated":true` beside 20 events.

**5 — `queue idle` with work.** A third thread enqueued while two were held:

```
$ corpus queue idle --wait 5
--- stdout ---
evt_4ss6ruvg4b23 comment.created
--- stderr ---
the server still holds 2 events in-progress — not claimed by this call:
  evt_2dg5schocgu5  comment.created  held 15s  Q3 planning
  evt_247r6bicwb2k  comment.created  held 15s  Re: the rate assumption

$ corpus queue idle --wait 5 --json
--- stdout ---
{"events":[{"id":"evt_4ss6ruvg4b23",…}],"inProgress":{"events":[…],"total":2,"truncated":false}}
--- stderr --- (empty)
```

Pending ids on stdout, the server's view on stderr — the two lists never share a
stream in human mode, and are separate keys in `--json`.

**6 — the `204` carries no list.** With 23 events held and nothing pending,
`corpus queue idle --wait 1` printed `idle — no events (timeout)` on stdout and
**nothing** on stderr. An agent with nothing to claim has nothing to reconcile
against, as the contract's docblock specifies.

**7 — the age ladder and the origin fallback, live.** The 20 shown events were
settled with `corpus queue complete … --from agent`, bringing the older three
into the window a minute later:

```
$ corpus queue claim-all
--- stderr ---
the server still holds 3 events in-progress — not claimed by this call:
  evt_3argvmczx4zn  comment.created  held 1m  Filler 3
  evt_2dg5schocgu5  comment.created  held 1m  —
  evt_247r6bicwb2k  comment.created  held 1m  Re: the rate assumption
```

`held 1m` is the minute rung rendered from a real instant. The `—` row is
`evt_2dg5schocgu5`, whose thread had been deleted with `corpus doc delete
th_negqh5xh --yes` in between: the server nulls **both** origin fields for a
document the corpus no longer holds (`"originId":null,"originTitle":null` in the
JSON), and the row degrades to the em dash rather than to a blank cell.

**Checks.**

```
$ VITEST_MAX_THREADS=4 npx vitest run apps/cli   → PASS (1281) FAIL (0)
$ npx tsc --noEmit   (apps/cli)                  → exit 0
$ npx eslint <touched files>                     → No issues found
$ npx prettier --write <touched files>           → All files formatted correctly
$ npm run docs:cli -w apps/cli                   → docs/cli.md regenerated (+16 −4)
```

Cleanup: `corpus server stop` on 8931, scratch workspace removed, no process left
behind, port 8765 never touched.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier + tsc, scoped to `apps/cli`)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[CLI-029]` prefix
