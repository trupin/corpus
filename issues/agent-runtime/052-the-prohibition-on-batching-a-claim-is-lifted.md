# [AGENT-052] The prohibition on batching a claim is lifted

## Domain
agent-runtime

## Status
done

## Priority
P1 (important)

## Model
opus

## Dependencies
- Depends on: AGENT-051, CLI-068
- Blocks: —

## Spec References
- SPEC.md Section 7 — the event queue and the agent loop

## Summary

AGENT-051 kept `corpus queue claim-all` out of every `corpus batch`, because a
batched claim under `--json` handed back `"value": null`. That was the right
call on the day: the loop's one load-bearing read came back empty at exit `0`.

**CLI-068 fixed the cause** (commit `10f15bfa`, one line): `createNestedOutput`
hardcoded `json: false`, so every command a batch ran was told the invocation
was in human mode, and `claim-all` — the only command whose **whole** payload
sits on the mode-dependent branch — wrote its claim to the channel a `--json`
parent suppresses. The reproduction was worse than AGENT-051 reported: the
events **were** claimed, `pending` 2 → 0 and `inProgress` 0 → 2, and the caller
was handed `null` at exit `0`, then held two events it could not name or settle.

This issue removes the prohibition from the orchestrate skill, replaces it with
the two rules that survive the fix, and collects the saving the lift makes
available: the loop's head — steps 2, 3 and 4 — is now one invocation.

## Acceptance Criteria

- [x] The prohibition on batching a claim is gone, and no skill states it again
      in any tense that reads as a live rule.
- [x] **The reasoning is left behind rather than deleted.** A reader who learned
      the old rule can find out that it was lifted and why, in the skill itself.
- [x] The long-poll rule is stated as a **property** — an entry that follows or
      long-polls holds every entry after it — with `queue idle` and
      `server logs --follow` as instances rather than as the list.
- [x] The skill says what the loop **does** when an entry behind a claim fails,
      not merely that it can. A batch is not a transaction (CLI-064).
- [x] Any call site the prohibition was holding out is batched, and the
      difference is measured.
- [x] No behavioural rule changes. This is about which calls go in one
      invocation, never about what the agent does.
- [x] `comment/SKILL.md` stays inside the 7,000-word budget AGENT-047 pinned.

## Technical Design

### Files to Create/Modify
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — *Several commands in
  one invocation* (the closing rules) and *The loop* (a pointer, no fence)
- `scripts/workspace-template.test.ts` — the AGENT-052 pins, plus the widened
  long-poll pin inside the AGENT-051 describe

### Key Implementation Details

**Where the batch rules live is settled and does not move.** They are registered
to `orchestrate`, and `comment` carries a pointer sentence rather than a second
account (AGENT-032's single-owner registry, AGENT-051's registration). Nothing
here adds a second account, so the registry detector's counts are unchanged.

**The loop's head is the call site the prohibition was holding out.** Steps 2, 3
and 4 — `queue reap-stale`, `agents`, `queue claim-all` — are three commands and
none of them wants what another printed. A batch runs its entries **in order**,
so reaping still precedes the claim that collects what it requeued.

**The claim goes last, deliberately.** With nothing behind it, no failing tail
can strand a claimed event. That is this skill's answer to CLI-068's second
recommendation, and it is written as a rule for any batch that does put work
behind a claim.

**No fence may go inside `## The loop`.** AGENT-019's structural pin asserts
`fencedBlocks(loop)` is empty, so the loop section gains a prose pointer and the
array itself stays in the owning section.

### Edge Cases
- A future verb that streams: the rule is about returning, so it binds a verb
  nobody has written down yet. The pin checks `--follow` on every entry.
- `-f` is `--follow` only on `server logs` today, so the pin checks the short
  form only there — a future `-f` for something else fails nothing by spelling.
- A human-mode batch: `server logs --follow` is **not** refused there (the
  refusal is `--follow` against `--json`), so it really does hold the array.

## Testing Strategy

Template pins in `scripts/workspace-template.test.ts`: the holding rule stated
as a property with two instances, the lift with its reasoning intact, a negative
guard that fails on a present-tense return of the prohibition, the loop-head
array with the claim last, and the failing-tail rule. Falsified by restoring
AGENT-051's paragraph verbatim.

## E2E Verification Plan

### Verification Steps
1. Build, package, `corpus init` a scratch workspace from the built template
2. Run the shipped payload verbatim against a real server with real events
3. Time the loop's head both ways
4. Reproduce both surviving rules against the real binary

## E2E Verification Log

### Post-Implementation Verification

**Model: Opus 5, 1M context (`claude-opus-5[1m]`).** Date 2026-08-23, branch
`phase-44-reach-and-size`.

`npm run build` and `npm run package:build` first — `corpus batch` changed within
the hour, and every arm below runs `dist-package/dist/corpus.js`. Two scratch
workspaces with their own servers: **`ws052` on 8811** for the measurements, and
**`ws052b` on 8812** initialized from the built package after the edits, so every
claim about the shipped text is a claim about the files `corpus init` installs.
The user's server on 8765 was never touched.

#### 1 — The batched claim carries its payload, in both modes

The loop's head, `--json`, against three real `comment.created` events:

```
$ corpus batch --json <<'CORPUS_EOF'
[["queue","reap-stale"],["agents"],["queue","claim-all"]]
CORPUS_EOF
[{"command":["queue","reap-stale"],"ran":true,"ok":true,"value":{"reaped":[],"failed":[]}},
 {"command":["agents"],"ran":true,"ok":true,"value":{"agents":[{"lane":"orchestrator",…}]}},
 {"command":["queue","claim-all"],"ran":true,"ok":true,"value":{"events":[
   {"id":"evt_iuynuj4huync",…},{"id":"evt_b2mjcw4myc2u",…},{"id":"evt_bigcvjvg4e3b",…}],
   "inProgress":{"events":[],"total":0,"truncated":false}}}]
exit=0
$ corpus queue status
queue running — pending 0, in-progress 3, …
```

**Parity with the lone invocation**, two arms, fresh events for each, key shapes
compared rather than ids:

```
alone shape: {events:[{created:string,id:string,payload:{mentions,parentId,skills,threadId,
                       turnTs,unresolved},source:string,type:string}],
              inProgress:{events:[],total:number,truncated:boolean}}
batch shape: (identical)      identical: true
```

**Human mode**, which is the mode the loop runs in — each entry under its own
header, the claim still one JSON line:

```
──────── 1: queue reap-stale ────────
──────── 2: agents ────────
orchestrator · waiting for a listener
──────── 3: queue claim-all ────────
{"events":[{"id":"evt_exq5woo6clij",…},{"id":"evt_ewszcctwss73",…}],"inProgress":{…}}
all 3 commands succeeded.        exit=0
```

`reap-stale` printing nothing is the skill's own "after a clean park it reaps
nothing and stays silent", observed rather than assumed.

#### 2 — The saving, measured

15 interleaved iterations, same packaged binary both arms, same server, same
empty queue so both arms do identical work and the only difference is process
starts (`scratchpad/bench.sh`, raw in `scratchpad/bench.txt`). Load average 7.85
at the start.

```
separate (3 invocations)   min 1003   med 1068   max 1564 ms
batched  (1 invocation)    min  415   med  466   max  549 ms
saving                     min  588 ms (2.42x)   med  602 ms (2.29x)
```

Two process starts removed from **every pass of the loop**, not once per event.

#### 3 — The shipped payload, run rather than reviewed

Every `corpus batch … <<'CORPUS_EOF'` block in `ws052b/.claude/skills/` —
**10 blocks**, 9 of them AGENT-051's and one new — extracted from the installed
files. The new one, run verbatim against 8812 with a real pending event:

```
orchestrate/SKILL.md  ["queue reap-stale","agents","queue claim-all"]
queue reap-stale  ran=true ok=true value={"reaped":[],"failed":[]}
agents            ran=true ok=true value={"agents":[{"lane":"orchestrator",…}]}
queue claim-all   ran=true ok=true value={"events":[{"id":"evt_c6ulkvjbrbwp",…
exit=0
```

#### 4 — Rule 1, reproduced: a following entry holds every entry after it

Human mode, where `--follow` is **not** refused, so the rule is the only thing
standing between the loop and a stopped array:

```
$ timeout 6 corpus batch <<'CORPUS_EOF'
[["server","logs","-f","-n","1"],["queue","status"]]
CORPUS_EOF
──────── 1: server logs -f -n 1 ────────
{"level":"info","msg":"request","method":"POST","path":"/api/queue/claim-all",…}
exit=124        held 7081 ms        entries after it that ran: 0
```

`queue status` never ran. That is why the rule is stated as *an entry that
follows or long-polls*, with `idle` and this one as instances: the property is
"does not return on its own", and a list of two verbs is a list the third is
missing from.

#### 5 — Rule 2, reproduced: a claim ahead of a failing entry

```
$ corpus queue status | head -1
queue running — pending 1, in-progress 0, …
$ corpus batch <<'CORPUS_EOF'
[["queue","claim-all"],["doc","patch","doc_5yjw3fzy","--old","text that is not in the document","--new","x"],["job","log","evt_none","never reached?"]]
CORPUS_EOF
──────── 1: queue claim-all ────────   {"events":[{"id":"evt_bwptenulggmb",…}],…}
corpus: 2 of 3 commands failed; every command ran.
  { "failed": [ 2, 3 ], "notRun": [] }
exit=11
$ corpus queue status | head -1
queue running — pending 0, in-progress 1, …
```

The claim stayed done and the event is the agent's to settle. So the skill says
what to do with it — dispatch what was claimed, settle each event on its own
outcome — instead of only warning that this can happen. The shipped array ends
on the claim, so this shape cannot arise from the skill's own example.

#### 6 — Falsification of the pins

AGENT-051's paragraph restored verbatim into the skill, nothing else changed:

```
× the claim goes back in the batch (AGENT-052) > states the holding rule as a property …
× … > lifts the prohibition and leaves the reasoning where it stood
× … > does not let the prohibition back in through a present-tense sentence
× … > puts the loop's head in one array, claim last, in the order the loop runs
× … > says what the loop does when an entry behind a claim fails
Tests  5 failed | 497 skipped (502)
```

The file was then restored and `diff` against the pre-falsification copy is
empty. The negative guard's discriminator is the **tense**: *kept its claim out
of every array* is the history the skill is required to carry, and *keeps* would
be the rule returning.

#### 7 — What did not change

- **No behavioural rule changed.** Steps 2, 3 and 4 are still three steps with
  the same three reports to read. The pin asserts the skill says so
  (*"They stay three steps"*), and the loop's step count, order and the
  claim → dispatch → park rule are untouched.
- **`converse` gains nothing, and that is a finding rather than an omission.**
  Its loop has no adjacent pair without a dependency: the claim at step 1 is
  separated from `corpus agents` at step 5 by the work itself, and step 5 exists
  precisely to run *immediately before* the park. Nothing there was being held
  out by the prohibition.
- **The comment skill is untouched**, and measures **6,990 words** against the
  7,000-word budget — the same figure AGENT-051 left it at.
- The single-owner registry is unchanged: the batch rules stay in `orchestrate`,
  and `comment`'s pointer sentence is the same sentence.

#### Checks

`vitest run scripts/` — **991 passed (18 files)**, 5 new pins and one widened.
The **first** of four runs reported `1 failed | 990 passed` and the summary
scrolled without naming it. Three runs since are green — two full suites and one
scoped to the five files that spawn processes (`pack-audit`, `package-staging`,
`generated-artifacts`, `release-prepare`, `version-sources`, 103 passed) — and
`workspace-template.test.ts` alone is green in five separate runs. It is
recorded as unidentified rather than dismissed: the machine was at load 7.85
with a package build behind it, and nothing narrows it further.
`eslint` clean on the touched test file. `prettier --check` clean on both files.
Both scratch servers stopped by pid, 8811 and 8812 verified free, 8765 untouched.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
- [ ] `issues/PLAN.md` updated — this issue was filed mid-phase and is not in it
