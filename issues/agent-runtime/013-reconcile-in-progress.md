# [AGENT-013] Teach the loop to reconcile the server's in-progress set

## Domain

agent-runtime

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-015 (signed), CONTRACT-033, SERVER-061, CLI-029
- Blocks: —

## Spec References

- SPEC.md §7 — "**The agent can see what the server still thinks it is doing.**"
  (rider signed 2026-08-05)
- `issues/shared/015-queue-reconciliation-rider.md` — the reasoning and the four
  resolved open questions (Q3 in particular: the never-settle clause)
- `docs/cli.md` — `corpus queue claim-all`, `corpus queue idle`,
  `corpus job list --status in-progress`

## Summary

The contract, server and CLI halves of queue reconciliation all ship in this
phase: `claim-all` and `idle` now carry an `inProgress` field, the server
populates it from `in-progress/`, and the CLI prints it as its own JSON key plus
a stderr block. The product agent's loop does not know the feature exists — the
orchestrate skill still documents `claim-all`'s output as `{"events":[…]}` and
still names `{"events":[]}` as the halted signal, so a user installing this
release runs `/orchestrate` and gets a loop that never reads the list, beside a
stderr block nothing tells it to act on. This issue adds the loop rule: read the
list, settle what you have already done, leave what you are still working, and
**never settle an event you cannot account for**.

## Acceptance Criteria

- [x] `orchestrate/SKILL.md` documents `claim-all`'s output as the shape the CLI
      actually prints — `events` **and** `inProgress` with its `total`/`truncated`
      overflow pair — and no longer names `{"events":[]}` as an exact-match signal.
- [x] The reconciliation rule is stated: read the in-progress list every claim,
      settle an event whose work is already done with the ordinary verbs and
      **without redoing the work**, leave an event still being worked alone.
- [x] The never-settle-what-you-cannot-account-for clause is stated **with its
      reason** — tidying an unfamiliar id off the list silently kills a concurrent
      run's work.
- [x] The skill states that the server reports and settles nothing by itself, and
      that `reap-stale` remains the recovery for a session that died with its
      context and stays a *requeue*, so nothing is dropped.
- [x] The two lists are never confused: the in-progress set is the state
      `in-progress/` was in **before** this claim, so it never contains the batch
      just claimed and is never work to do again.
- [x] The loop stays ONE literal bash block; `sections.size` stays 16.
- [x] Every `corpus …` invocation added resolves against `docs/cli.md`.
- [x] `scripts/workspace-template.test.ts` pins the new rule; prettier clean.

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the loop block's
  comments, the whole of **Claiming and batching**, invariant 4's pointer, and
  the worked example's `claim-all` line.
- `scripts/workspace-template.test.ts` — a `describe("in-progress
  reconciliation")` block inside `orchestrate skill body`.

### Key Implementation Details

**Where the rule goes.** Inside the existing **Claiming and batching** section,
not a new one: the list arrives on the claim, so the section that explains the
claim is where a reader looks for what to do with it. The section-count
assertion (`sections.size` 16) is unchanged, and every `## ` section stays past
the 400-char floor.

**The shape, verbatim from the CLI.** stdout is one JSON line in both modes:

`{"events":[…],"inProgress":{"events":[{"id","type","heldSince","originId","originTitle"}],"total":N,"truncated":bool}}`

In human mode the same list also prints as a readable block on **stderr** with
ages rendered (`held 3h`); under `--json` the block is suppressed and `heldSince`
stays an ISO instant. Nothing prints at all when nothing is held.

**Two lists, never one.** `apps/server/src/queue/service.ts` reads the held set
**before** the claim's moves (`QueueBatch.held`), so the batch just claimed is
never in it. That is what makes "never do this work again" a safe instruction
rather than a hedge, and the skill states it as a fact.

**The uncapped view.** The list caps at 20 with `total`/`truncated`;
`corpus job list --status in-progress` is the whole set, already documented.

### Edge Cases

- An id the agent does not recognise (another session, or an ancestor session's
  residue) — left alone, explicitly, with the reason stated.
- A row for an event whose work failed — settled with `corpus queue fail
  --reason`, not `complete`; reconciliation records what happened, it does not
  launder it.
- The empty set — silence, and no loop step of its own.

## Testing Strategy

`scripts/workspace-template.test.ts` is the only guard the skills have. New
assertions pin: the literal `inProgress` shape in the claim example, the
overflow pair, the two-list separation, both reconciliation branches, the
never-settle clause **and its reason**, the server-settles-nothing and
`reap-stale`-stays-a-requeue statements, and the absence of the old
`{"events":[]}` exact-match sentence. Run scoped:
`VITEST_MAX_THREADS=4 npx vitest run scripts/workspace-template.test.ts`.

## E2E Verification Plan

No live agent is drivable here, so the verifiable claim is that **the shape the
skill now documents is the shape the CLI actually prints**. Build, `corpus init`
a scratch workspace on a scratch port (never 8765), start the real server,
enqueue real events, claim once to move them into `in-progress/`, claim again,
and diff the printed payload against the skill's example — stdout shape, stderr
block, `--json` suppression, and the empty-set silence.

## E2E Verification Log

_Implemented on: opus._

### Post-Implementation Verification

**Build.** `npm run build` — exit 0. Every command below runs the built bin
(`apps/cli/dist/bin/corpus.js`) against a real `corpus server` on a scratch
workspace at `/tmp/agent013-ws`, port **8937**. Port 8765 never touched.

**Setup.**

```
$ corpus init /tmp/agent013-ws --port 8937
  installed 8 template files, recorded in .corpus/template-manifest.json
$ corpus server start
corpus 0.3.0 listening on http://127.0.0.1:8937 (pid 15290)
```

**1 — nothing held: the empty-set silence the skill promises.**

```
$ corpus queue claim-all
--- stdout ---
{"events":[],"inProgress":{"events":[],"total":0,"truncated":false}}
--- stderr ---
(empty)                                                        exit=0
```

The skill's worked example now prints exactly this `inProgress` value on its
`claim-all` line, and its "nothing is printed at all when nothing is held"
sentence is this run.

**2 — two events claimed, then the reconciling claim.** Two threads created with
`--requests-agent true`. The first claim returns both and an **empty**
`inProgress` — the two-list separation the skill states as a fact about
ordering, observed:

```
$ corpus queue claim-all      # first
--- stdout ---
{"events":[{"id":"evt_dv5w5n3urygr",…},{"id":"evt_kelr6gg7otyu",…}],"inProgress":{"events":[],"total":0,"truncated":false}}
--- stderr --- (empty)
```

The second claim reports them, on both streams:

```
$ corpus queue claim-all      # second, human mode
--- stdout ---
{"events":[],"inProgress":{"events":[{"id":"evt_kelr6gg7otyu","type":"comment.created","heldSince":"2026-08-06T19:37:31Z","originId":"th_ft4w3cgd","originTitle":"Q3 planning"},{"id":"evt_dv5w5n3urygr","type":"comment.created","heldSince":"2026-08-06T19:37:31Z","originId":"th_ue5fkn6k","originTitle":"Rate assumption"}],"total":2,"truncated":false}}
--- stderr ---
the server still holds 2 events in-progress — not claimed by this call:
  evt_kelr6gg7otyu  comment.created  held 5s  Q3 planning
  evt_dv5w5n3urygr  comment.created  held 5s  Rate assumption
```

Field-by-field against the example now in the skill: `events` and `inProgress`
are sibling keys on one stdout line; each row carries `id`, `type`, `heldSince`
(ISO instant), `originId`, `originTitle`, **in that order**; the set carries
`total` and `truncated`. The stderr header sentence and the `held <age>`
rendering are what the skill tells the agent it will see in human mode. **The
documented shape is the printed shape.**

**3 — `--json` suppresses the block.** Same state; `diff` of the two stdouts is
empty:

```
$ corpus queue claim-all --json
--- stdout --- byte-identical to the human-mode stdout above ("stdout identical in both modes")
--- stderr --- (empty)
```

**4 — settling from the list, without redoing the work.** The first branch of
the rule, executed exactly as the skill writes it, including its job-log line:

```
$ corpus queue complete evt_kelr6gg7otyu --from agent
event evt_kelr6gg7otyu is complete.
$ corpus job log evt_kelr6gg7otyu "settled late — the reply on th_ft4w3cgd was already posted" --from agent
                                                                exit=0
$ corpus queue claim-all
--- stdout ---
{"events":[],"inProgress":{"events":[{"id":"evt_dv5w5n3urygr",…}],"total":1,"truncated":false}}
--- stderr ---
the server still holds 1 event in-progress — not claimed by this call:
  evt_dv5w5n3urygr  comment.created  held 12s  Rate assumption
```

The settled row is gone from the next claim (and the header is correctly
singular); the other row stays, untouched — the second branch, also as written.

**5 — the cap and the overflow pair, real.** 22 further threads created and
claimed, giving 23 held:

```
$ corpus queue claim-all
--- stdout, parsed ---
events: 0   inProgress.events: 20   total: 23   truncated: true
--- stderr ---
the server still holds 23 events in-progress — not claimed by this call:
  evt_zrgc4nwsecjj  comment.created  held 0s  Filler 11
  …20 rows…
  … and 3 more held, not shown (23 in total)
```

`total` 23 beside 20 rows with `truncated` true — the skill's "capped at the 20
most recently claimed … `total` is how many are really held, `truncated` is true
when the cap bit" is literal. The uncapped view it points at also works:
`corpus job list --status in-progress` printed 23 rows.

**6 — `reap-stale` is silent when nothing is stale.** With 23 held and the
staleness window not yet reached:

```
$ corpus queue reap-stale
                                                                exit=0
```

No output, exit 0 — as the skill's loop line says. (The requeue-not-drop half is
the server's, covered by `apps/server/src/queue/service.ts`'s own tests; the
skill states it as the reason the agent need not clean up after dead sessions.)

**7 — `idle` carries the same field.** One further thread enqueued while 23 were
held:

```
$ corpus queue idle --wait 5 --json
--- stdout, parsed ---
events: 1   inProgress.total: 23   truncated: true
--- stderr --- (empty, as `--json` requires)
```

This is the claim the skill makes in one sentence ("`corpus queue idle` reports
the same field on the returns that carry work"), verified rather than assumed.

**Checks.**

```
$ VITEST_MAX_THREADS=4 npx vitest run scripts/workspace-template.test.ts
  PASS (117)  FAIL (0)
$ npx prettier --check assets/workspace/claude/skills/orchestrate/SKILL.md \
    scripts/workspace-template.test.ts issues/agent-runtime/013-reconcile-in-progress.md
  All files formatted correctly
$ npx eslint scripts/workspace-template.test.ts
  (no output — clean)
```

Cleanup: `corpus server stop` on 8937, scratch workspace removed, no process left
behind, port 8765 never touched.

**Not verifiable here:** that a live Claude Code session running `/orchestrate`
actually reconciles. The skills carry no runner; the guard is the template test
plus the shape agreement proved above.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (prettier + eslint, scoped to touched files)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[AGENT-013]` prefix
