# [AGENT-019] The loop block renders dispatch as a comment, so chaining `claim-all && idle` silently drops it

## Domain

agent-runtime

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: the `held` in-progress list (`corpus queue claim-all`), which is the
  safety net this failure also defeats

## Spec References

- SPEC.md **§7** — "Loop: `claim-all` → dispatch each event → `idle` → repeat.
  **Every event is delegated**"; the order is already specified, so this issue
  needs no spec change. It is a HOW problem, which is the skill's business

## Summary

**Reported by the user from a live run of their own orchestrator, 2026-08-07.**
Events were claimed and never dispatched: the queue moved them to `in-progress/`
and nothing ever worked them.

The user's diagnosis, which reproduces the failure exactly:

1. `corpus queue idle` **carries the event notification in its output** — when it
   wakes on a new event, the return itself signals work is ready.
2. The session was chaining `corpus queue claim-all && corpus queue idle` as a
   **single background command** and re-launching it on every completion
   notification **without ever reading the prior output**.
3. So each cycle ran: `claim-all` (moving the event to in-progress) → `idle`
   (re-parking). The event was claimed and never dispatched. The chain
   **structurally cannot** dispatch, because there is no step between the two
   commands where dispatch could happen.

## Why the current text does not prevent it

Not merely "it implies the order without prohibiting the shortcut". It is worse
than that — **the formatting actively suggests the broken shape.**

The loop block (`## The loop`, around L69-81) reads:

    corpus queue claim-all      # the pending batch, plus what the server still holds in-progress
    # reconcile that held list against your own work first (Claiming and batching below),
    # then dispatch every claimed event to a subagent (Routing and Delegation below), and park:
    corpus queue idle           # returns on a new event or on its ~8-minute rearm

Every **executable** line in that block is a `corpus queue` call. The one
load-bearing step between them — dispatch — is a `#` comment. An agent reading a
bash fence as a script to run drops the comments and is left with exactly
`claim-all` then `idle`. Collapsing those into one command is not a misreading of
the block; it is the literal reading of its executable content.

L83's "The order is claim → dispatch → park" states the order and does not
forbid the collapse.

## Why there is no server-side half

The server cannot fix this, and that is consistent with the user's earlier
ruling on queue reconciliation (2026-08-05): *"only the agent can reconcile."*
`claim-all` moves events to `in-progress/`, and from the server's side a claimed
event that is being worked and a claimed event that was abandoned are
indistinguishable — the difference lives entirely in the agent's session.

Note the compounding: the `held` in-progress list that `claim-all` returns
**is** the designed safety net for precisely this failure, and it did not fire —
for the same root cause. Nothing read the output. A safety net delivered through
a channel the failure mode ignores is not a safety net.

## Acceptance Criteria

- [x] The skill **prohibits** chaining: `corpus queue claim-all` and
      `corpus queue idle` are never combined into one command
- [x] It states that `corpus queue idle` runs **alone** as the background command
- [x] It states that on **every** completion notification the output is read
      **before** anything else happens — the output is the event notification,
      not a log
- [x] The loop is stated as discrete steps — idle returns → read output →
      claim-all → dispatch → re-park — with dispatch as a **step**, not as a
      comment inside a code fence
- [x] The `## The loop` block no longer renders the dispatch step as a `#`
      comment between two executable commands. Whatever shape replaces it, the
      literal executable reading of the block must not be a working loop that
      skips dispatch
- [x] The `## Worked example` section (around L679-740) is checked for the same
      shape and fixed if it has it — an example contradicting the rule beats the
      rule
- [x] `scripts/workspace-template.test.ts` passes, and gains an assertion
      pinning the prohibition so it cannot be edited away silently

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md` — `## The loop`
  (~L65-96), `## Claiming and batching` (~L98), `## Worked example` (~L679), and
  the frontmatter `updated` timestamp
- `scripts/workspace-template.test.ts`

### The skill-file constraints that bite

Verified against the test file, but **re-verify rather than trusting these
numbers** — they have moved before:

- **Exact section count**: `expect(sections.size).toBe(16)` for orchestrate.
  Adding a `## ` section is a two-file change; prefer editing in place.
- **The orchestrate counter is NOT fence-aware** (the comment skill's is). A
  `## ` line inside a fenced block in this file **will** be counted and will
  break the count. This matters directly here, because the fix touches fenced
  blocks.
- Every `## ` section body must exceed **400 characters** after trimming.
- **Forbidden prose**: the hedges `use your judgment`, `consider whether`,
  `you may want`, `if appropriate`, and the strings `SPEC.md`, `CLAUDE.md`,
  `issues/`. Write an instruction, not a consideration.
- **Heredoc mechanics**: every multi-line shell argument uses a quoted heredoc
  (`<<'EOF'`); `-m "$(` is banned.
- **`EXPECTED_TREE` is exhaustive equality** — adding any file under
  `assets/workspace/` fails until the list is updated.

### Notes

- **Do not fix this by adding a sentence and leaving the block as it is.** The
  sentence is necessary and not sufficient; the block is what an agent copies.
- Resist restating the whole loop in prose as well as in a block — two
  descriptions of one procedure drift, and this project has already fixed four
  cases of exactly that. One authoritative shape.
- The point of reading `idle`'s output is not bookkeeping: it is the arrival
  signal. Say what the output is *for*, or the instruction reads as diligence
  and will be dropped under pressure the same way.

## Testing Strategy

`scripts/workspace-template.test.ts` is the whole surface — the skill is prose
and its guarantees are structural. Pin the prohibition and the discrete-steps
shape in the register the file already uses.

## E2E Verification Plan

The skill is only real once installed, so verify through the product:

1. `corpus init` a scratch workspace from the built package on a non-default port
   (never 8765, never 5173) and confirm the skill landed with the new text.
2. Start the real server and the agent loop there.
3. Post a comment addressed to the agent. **Expected: the event is claimed and
   dispatched**, and `corpus job list` shows work, not an event sitting in
   `in-progress/` with nothing running.
4. Confirm the loop parks again afterwards and a second event is picked up.

## E2E Verification Log

**Model: Opus 5 (1M context)**, agent-runtime-dev. 2026-08-07.

Ports: the scratch server ran on **9174**. Neither **8765** (the user's live
workspace) nor **5173** (an ssh tunnel) was bound at any point.

### What changed

`assets/workspace/claude/skills/orchestrate/SKILL.md`:

- `## The loop` — the single `bash` fence is **gone**. The section now opens with
  "This is a procedure, not a script", names the chain prohibition explicitly
  (`corpus queue claim-all` and `corpus queue idle` are always separate commands
  with dispatch between them) **with its cost** (the chain "has nowhere to put
  dispatch", so every event it claims "is worked by nobody, with no error
  anywhere"), and states the procedure as **8 numbered steps**. Dispatch is step
  5 and says of itself "**This step is work, not a command**". Parking is step 6
  ("`corpus queue idle` is the entire command"), reading the return is step 7
  ("That return **is** the arrival notification… a return nobody read is an event
  nobody works. It is not a log to catch up on later"). There is no fenced block
  in the section at all, so no executable reading of it exists that skips
  dispatch.
- `## Claiming and batching` — the empty-batch path said "go straight to
  `corpus queue idle`", the one sentence that reads as a licence to collapse the
  two calls. It now parks "with a separate `corpus queue idle`" and says why the
  empty pass is still two commands.
- `## Worked example` — had the same shape one level out: a claim fence, prose,
  then a lone `corpus queue idle` fence, so the copyable content across fences
  was claim → idle. The lone park fence is gone (the park is inline, "alone,
  never appended to the claim above"), dispatch is a bolded step
  ("**Then the step that no command performs.**"), and the settling fence no
  longer trails a park command.
- frontmatter `updated` → `2026-08-07T00:00:00Z`.

`scripts/workspace-template.test.ts`: the assertion that pinned the loop as
**one literal bash block** was the mechanical reason the broken shape survived
rewrites — it is replaced. Six new assertions in
`describe("the loop is a procedure, not a script")` pin: the prohibition and its
cost, the absence of the chain anywhere in the body, idle-alone plus
read-the-return-first, ≥8 numbered steps in claim → dispatch → park order,
**no fenced block in the section and no fence in the whole skill carrying both
commands**, the empty-batch sentence, and the worked example's dispatch step.

### 1 — Tests (the hooks no longer run them; INFRA-025)

`npx vitest run scripts/workspace-template.test.ts` → **133 passed, 0 failed**.
`npx prettier --check` + `npx eslint` on the test file → clean.
`npx tsc --noEmit -p scripts/tsconfig.json` → clean.
(`assets/workspace/` is prettier-ignored on purpose — its bytes are what
`corpus init` installs.)

**Mutation-checked, so the new assertions are not decorative** (both reverted):

| Mutation                                                  | Result                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| Prohibition sentence deleted, prose left plausible        | FAIL — "prohibits chaining claim-all with idle"                     |
| A `bash` fence with `claim-all`, a `#` comment, and `idle` re-added to the section | FAIL — "leaves no fenced block anyone can copy as the loop" |

### 2 — Real workspace, real server, real events

`corpus init /tmp/agent019-ws --port 9174` from source (`npm run dev -w apps/cli`,
CLI 0.4.0) → 8 template files installed. The installed
`.claude/skills/orchestrate/SKILL.md` carries the new `## The loop`, and
`awk '/^## The loop/,/^## Claiming/' | grep -c '```'` → **0**.

`corpus server start` → listening on `127.0.0.1:9174`, pid 11552.

**Reproduction of the reported failure, on the installed skill's predecessor
shape.** One doc, one agent-addressed comment (`evt_2qrnslu4hs4r`, pending 1).
Ran the chain as a single command with its output redirected and never read:

    (corpus queue claim-all && corpus queue idle --wait 3) > /tmp/agent019-chain.out
    exit=0
    queue running — pending 0, in-progress 1, deferred 0, processed 0, failed 0
    job list --status in-progress → evt_2qrnslu4hs4r in-progress

Exit `0`, nothing printed anywhere, event claimed and worked by nobody. This is
the user's bug, reproduced.

**The procedure as the new text states it**, event `evt_hgzr5rr2oo37`:

- step 2 `queue reap-stale` → silent (nothing stale yet).
- step 3 `queue claim-all` → one payload with `events` (the new event) **and**
  `inProgress` naming `evt_2qrnslu4hs4r` — the event the chain stranded, held 18s.
- step 4 reconcile: that row is not work this session can account for, so it was
  left where it is (per the skill).
- step 5 **dispatch**: a real background subagent (Sonnet) given the comment
  skill, the event/thread/parent ids and the two retrieved anchor lines, CLI-only.
- step 6 `queue idle --wait 90`, alone → parked 19:20:24 → 19:21:55,
  `idle — no events (timeout)`, exit 0. The subagent reported ~41s into the park.
- step 7/8: verified the report (`doc_f7qxfqi4` now reads "6.4% as of 2026-07-28";
  `th_l6ucrrht` carries the agent turn closing with
  `↳ updated the rate assumption in [[doc_f7qxfqi4]] from 6.1% to 6.4%`), then
  `queue complete` → **processed 1**.

**Re-park and second pickup.** `queue idle --wait 60` alone in the background; a
new agent-addressed comment posted 3s later. The park returned **immediately**
with:

    evt_jtwfwkochlfj comment.created
    the server still holds 1 event in-progress — not claimed by this call:
      evt_2qrnslu4hs4r  comment.created  held 2m  Re: "6.1%"

which is step 7's claim demonstrated literally: the return names both what
arrived and what is still held. The stranded event from the chained run was
still sitting there — the visible residue of the bug in the same workspace.

Server stopped (`stopped (pid 11552)`), port 9174 free, workspace removed.

### 3 — Does the new text actually change the reading?

A fresh subagent (Sonnet, no context but the section) was given the adversarial
framing — "every shell command costs a turn, so you want to batch aggressively" —
and asked which commands it would combine. It combined **none**, named
`claim-all` and `idle` as the pair that is never chained, and answered the second
question ("between which two commands does the work happen, and what performs
it?") with: between `claim-all` and `idle`, performed by the dispatched
subagents, "nothing in that gap is a shell command". That is the behaviour the
old block could not produce, since its executable content had no such gap.

### Not exercised

- **Not the built package.** `corpus init` ran from source (`apps/cli/src`) with
  the server started from `apps/server/src/main.ts` via tsx — the same template
  copy path, but no `npm run package:build` / tarball install.
- **No `/orchestrate` run by a real Claude Code session.** The loop's steps were
  driven by hand against the real server and a real dispatched subagent; the
  dispatch decision itself was mine, not a session's reading of the skill. The
  comprehension probe in §3 is what covers the reading, and it is a probe, not a
  live loop.
- The dispatched subagent invoked the CLI through an absolute path wrapper
  (`/tmp/corpus019`) rather than a `corpus` on `PATH`; every mutation still went
  through the CLI.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (scoped: prettier + eslint on the touched test file, and
      `tsc --noEmit -p scripts/tsconfig.json`; `assets/workspace/` is
      prettier-ignored by design)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
