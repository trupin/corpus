# [AGENT-027] The converse skill can still adopt work the orchestrator is holding

## Domain

agent-runtime

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: AGENT-025, AGENT-026 (which closed the other half)
- Related: SHARED-047

## Spec References

- SPEC.md **§7** — lanes, the lapse fallback, and reconciliation
- SPEC.md **§7** — *"the agent can see what the server still thinks it is doing"*

## Summary

`AGENT-026`'s drill found a real defect and fixed the half the orchestrator
controls. **The other half is still open, and it is the same failure.**

The defect, in `AGENT-026`'s own measurement: a listener launched for a lapsed
lane parked, the lane went live, and its **first scoped claim reported the
orchestrator's in-flight event in `inProgress`**. The converse skill's
reconciliation then did that work and completed the orchestrator's event. Two
agents answered one message, and **nothing anywhere reported an error** — both
behaved exactly as written.

`AGENT-026` closed the path it owns: *per lane, per pass, take the work or launch
the listener, never both.* That covers every listener the orchestrator starts.

**It does not cover a listener that starts any other way** — a person
re-designating a thread, or starting `/converse` by hand, while the orchestrator
is holding that lane's work under fallback. The orchestrator cannot prevent
that, and the converse skill currently adopts anything its first claim reports
as in-progress.

## What the converse skill must learn

`AGENT-026` states the rule it needs, and it is worth quoting because it is the
whole fix:

> a held row older than your first claim on this lane is not yours.

An event the server reports as `in-progress` when a resident has only just
started parking was claimed by somebody else — necessarily, because the resident
had claimed nothing yet. Reconciliation exists to recover a resident's *own*
interrupted work, not to adopt whatever the lane happens to be holding.

## Acceptance Criteria

- [x] `assets/workspace/claude/skills/converse/SKILL.md` distinguishes work this
      listener claimed from work it merely found in progress, and adopts only
      the former
- [x] The reasoning is stated, not just the rule — a later editor who reads
      "reconcile what is in progress" as an obvious simplification would
      reintroduce exactly this defect, which is how it arrived
- [x] The rule does **not** break the case reconciliation exists for: a resident
      that crashed mid-event and comes back must still recover its own work.
      Say how the two are told apart, and test it
- [x] Drilled for real: start a listener by hand while the orchestrator holds
      that lane's work under fallback, and show the listener declining it. A
      unit test cannot show two agents not colliding

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/converse/SKILL.md`
- `scripts/workspace-template.test.ts`

### Notes

`AGENT-026` measured that `inProgress` is per-lane and that the orchestrator's
held view *does* include a lapsed lane's work under fallback
(`apps/server/src/queue/held.ts` documents that deliberately). Both facts are
load-bearing here.

## Testing Strategy

Template tests for the text. The real test is the drill: two live processes and
one event, showing it answered once.

## E2E Verification Log

**Model: Opus 5 (1M context)**, agent-runtime-dev, 2026-08-17. Two real workspaces on free
high ports (never 8765 / 5173): `/tmp/corpus-agent027/ws1` (9781, mechanism probes and the
crashed-listener recovery) and `/tmp/corpus-agent027/ws2` (9782, the two-process drill,
scaffolded by `corpus init` **after** the skill was written — the installed
`converse/SKILL.md` is byte-identical to the source, verified by `diff`). Transcripts:
`/tmp/corpus-agent027/orch.jsonl` (the orchestrating session) and `listener.jsonl` (the
hand-started resident). Both sessions ran on **claude-fable-5** via `claude -p`, given
nothing but the workspace and "read the skill and follow it".

### 1. Reproduced first, on a real server

`th_mknx4es5` designated `researcher` and left with no listener. A user turn posted at
06:04:28 was claimed by the **orchestrator's** unscoped claim under the fallback. A listener
was then started by hand — park, then its first scoped claim:

```
$ corpus queue idle --thread th_mknx4es5     # the lane goes live
$ corpus queue claim-all --thread th_mknx4es5
{"events":[],"inProgress":{"events":[{"id":"evt_q35ls6r6oqlg","type":"comment.created","heldSince":"2026-08-17T06:04:28Z","originId":"th_mknx4es5","originTitle":"Q3 refinance planning"}],"total":1,"truncated":false}}
the server still holds 1 event in-progress — not claimed by this call:
  evt_q35ls6r6oqlg  comment.created  held 12s  Q3 refinance planning
```

The orchestrator's in-flight event, reported to a listener that had claimed nothing, with
`heldSince` twelve seconds before the listener existed. Against the pre-AGENT-027 text —
*"If nothing answers it, the work did not happen: do it now"* — that row is work to do.

### 2. The signals cannot tell the two cases apart at the row, and that is measured

- `apps/server/src/queue/held.ts` filters the held report with **the same lane predicate the
  claim uses** (`visibleTo`: `scope !== orchestrator ⇒ lane === scope`), deliberately, per
  SERVER-111. A row carries `id`, `type`, `heldSince`, `originId`, `originTitle` — and **no
  claimant**, on the wire or on disk.
- `corpus agents --json` prints the *same* `summary` string on every row
  (`"working Q3 refinance planning"` on both the orchestrator's row and the resident's), and
  `apps/cli/src/commands/agents.ts` states the contract promises its length and nothing about
  its content — so it must not be parsed.

So the skill cannot classify a row from the server's answer, and it must not try. What it can
do is ask a first-person question — *did I claim this event, in this session?* — which is
**exact** for the case reconciliation exists for (its own missed settling call) and correctly
declines everything else. `heldSince` versus the session's own first claim is the same test
in mechanical form.

### 3. The case reconciliation exists for still works — via the reaper, not via adoption

Measured end to end in `ws1`. A resident claimed `evt_cvkog7le7on5` on lane `th_mknx4es5` at
**06:05:26** and died. The row sat in `in-progress/`; declining it stranded nothing:

```
06:20:52  $ corpus queue reap-stale        # the orchestrator's, run every pass
          $ corpus job list
          evt_cvkog7le7on5 pending          ← requeued, 15m 26s after the claim

06:23:2x  $ corpus queue idle --thread th_mknx4es5      # a NEW listener parks
          evt_cvkog7le7on5 comment.created              ← same lane, preserved
          $ corpus queue claim-all --thread th_mknx4es5
          {"events":[{"id":"evt_cvkog7le7on5","type":"comment.created", … "threadId":"th_mknx4es5" …}],
           "inProgress":{"events":[],"total":0,"truncated":false}}
```

The crashed listener's work came back in **`events`**, not in `inProgress` — to be worked, not
adopted. Declining costs the staleness window and the orchestrator's next pass; it never
strands. That is the trade the skill now states.

### 4. The drill — two live processes, one event, answered once

`ws2`, `th_owap6v7w` designated `researcher`, no listener. Timeline, all measured:

```
06:11:17  user posts "@agent what rate should we assume …"   → evt_dueakaa7yrql, lane th_owap6v7w
06:11:49  a real orchestrate session starts (claude -p)
06:12:15  its unscoped claim takes evt_dueakaa7yrql under the fallback
          job log: "claimed comment.created on th_owap6v7w under the fallback — that lane has no listener"
06:12:36  a listener is started BY HAND: /converse th_owap6v7w   ← the thing AGENT-026 cannot prevent
06:12:5x  it reads the roster (waiting), binds the persona, hydrates, and parks
06:13:17  user posts a second turn                            → evt_6f3sg5ufdr57, lane th_owap6v7w
06:13:24  the listener's park returns and it makes its FIRST scoped claim
```

That claim, from the listener's own transcript:

```
$ corpus queue claim-all --thread th_owap6v7w
{"events":[{"id":"evt_6f3sg5ufdr57","type":"comment.created","created":"2026-08-17T06:13:17Z", …}],
 "inProgress":{"events":[{"id":"evt_dueakaa7yrql","type":"comment.created","heldSince":"2026-08-17T06:12:15Z","originId":"th_owap6v7w","originTitle":"Q3 refinance planning"}],"total":1,"truncated":false}}
```

One event of its own, one held row that is the orchestrator's live dispatch. Its next command
— **its first act on the held row**:

```
$ corpus job log evt_6f3sg5ufdr57 "claimed comment.created on th_owap6v7w — working it inline;   held row evt_dueakaa7yrql predates this session's first claim and is left to its claimant"
```

It then read the thread and saw the 06:11:17 turn with **no reply answering it** — the exact
evidence the old text reads as "the work did not happen" — and declined anyway. Its own
closing report:

> `claim-all` gave me `evt_6f3sg5ufdr57` … and reported one held row, `evt_dueakaa7yrql`,
> held since 06:12:15 — **before my first claim, so it was the orchestrator's and I left it
> untouched**.

Outcome, off the server after both sessions ended (06:22:25):

```
$ corpus job list
evt_dueakaa7yrql processed  completed — replied on th_owap6v7w with the sourced 6.67% figure and a form;
                            created [[doc_drmthgdj]]            ← the orchestrator's subagent
evt_6f3sg5ufdr57 processed  replied on th_owap6v7w: term is 30-year fixed by default … no document
                            written — the rate itself is still held by another claim   ← the listener
```

Three user turns, **two** agent turns — one answer per question, and the 06:11:17 message
answered exactly once, by the agent that claimed it. The listener ran exactly **one** settling
verb in the whole run (`complete` on its own event); it issued no `complete`, `fail`, `defer`,
`abandon`, `job retry` or `reap-stale` against anything it had not claimed. No stand-down was
sent anywhere. The orchestrator, for its part, left the one row *it* could not account for
(`evt_ofxv7vgg4aug`) exactly where it was.

The two skills also stayed out of each other's way at the seam: the listener's reply says
*"Your earlier question … is being answered separately; nothing is written down for this plan
yet"*, and its job log gives the reason — *"no document written — the rate itself is still held
by another claim"*.

### 5. What the drill falsified in my own text

**The rule alone was not enough: the boundary it measures against was still moving.** As first
written the change was only the reconciliation rule, and the loop still began at the claim.
That leaves a real window — from a listener's first claim until its first park the lane does
not read `live`, so the orchestrator's fallback can still take this lane's pending work, and
a row claimed *after* the listener's first claim would pass the `heldSince` half of the test.
The `heldSince` backstop was therefore unsound on its own; only the first-person id question
covered it. Fixed by adding *Starting up* step 6 — **park before you claim anything**, with
the reason — which is also what the worked example already did while the prose did not say so
(the AGENT-019 shape: an example that beats the rule beside it). The live listener followed
it exactly, parking before its first claim; that park is what made the boundary at 06:12:5x
stable and the held row unambiguously older than it.

**The loop's own sentence about the held list was the defect in miniature and had to go.**
*"It is your lane's held work and nobody else's — the orchestrator does not see it and you do
not see the orchestrator's"* is true about **lanes** and false about **claimants**, and it is
exactly the confusion a rewrite restores. Replaced with a sentence that separates the two.

### 6. Tests, lint, typecheck

`scripts/workspace-template.test.ts` — **298 passed** (290 before this issue; 8 added, in a
`reconciliation adopts only what this listener claimed` describe). The guards are proved to
fire rather than pass vacuously: the ten predicates they rest on were run against the
pre-AGENT-027 body (reconstructed verbatim from commit `b7a35527`), and every one returns
`false` on the old text and `true` on the new — including the structural one that pins the
surviving *"If nothing answers it, the work did not happen: do it now"* sentence to the
paragraph led by *"For a row you did claim in this session"*, which is what stops a rewrite
lifting it back to the top of the section.

`prettier --check` clean on both changed files; `eslint` clean; `tsc --noEmit -p
scripts/tsconfig.json` **exit 0**. Section structure re-checked with a real CommonMark parser
(`mdast-util-from-markdown`): **15** top-level `##` headings — agreeing with the template
test's own walker, unchanged — and 7 code nodes, **0** left unterminated.

### Post-Implementation Verification

Both servers stopped (`stopped (pid 95773)`, `stopped (pid 74069)`); ports 9781, 9782 and 9783
confirmed to have zero listeners; no drill process survives. Nothing was run on 8765 or 5173
and nothing was written under `/Users/theophanerupin/cos`. `corpus doc check` clean in both
workspaces (12 and 13 documents, no findings).

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] E2E verification log filled
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-027]` prefix
