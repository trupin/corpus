# [AGENT-060] The skills' fixed `/tmp/corpus-*.txt` flag-file paths collide under parallel dispatch

## Domain

agent-runtime

## Status

done

## Priority

P1 — a person's reply can be silently answered with another job's body, and the
only reason it was seen is that a rehearsal agent happened to detect it.

## Model

fable

## Dependencies

- Found by: `INFRA-034` story 5 (`05-restart-recovery`), first full pass,
  release v0.31.0
- Related: AGENT-035, AGENT-058, CLI-074 (the `--flag-file` mechanism these
  paths feed)

## Spec References

- SPEC.md **§7** — the orchestrator dispatches the whole claimed batch of events
  to subagents **in parallel**, then parks

## Summary

The workspace skills tell an agent to write a value to a **fixed** temp path and
pass it with `--flag-file` — `/tmp/corpus-title.txt`, `/tmp/corpus-description.txt`,
`/tmp/corpus-reply.md`. Those paths are the same for every agent on the machine.

The orchestrate skill dispatches the claimed batch **in parallel** — one
background subagent per event — and every comment subagent follows the comment
skill, which writes its body to `/tmp/corpus-title.txt`. Two subagents running at
once therefore write and read the **same file**, and the second write clobbers
the first between another subagent's write and its read.

This is not only a rehearsal artifact. Parallel dispatch is the ordinary path in
a single workspace, so two comment subagents answering two events at once race on
one path with no lock and no per-invocation name.

## How it was found

`INFRA-034` story 5, run 1 of the first full pass (v0.31.0). A `converse`
listener answered its lane and the thread ended with **two** agent turns. The
job log, in the agent's own words:

> the reply body file at `/tmp/corpus-reply.md` differed at read time from what I
> wrote to it. The first turn post[ed] … posted a correction turn naming the
> dangling ref and the real id … Used `-m` rather than `--file`, which posted …

So the agent wrote its reply to the fixed path, another concurrent agent's write
changed that file before the read, and the first agent posted a wrong body, then
**noticed and self-corrected** with a second turn. The story's invariant — exactly
one agent reply — caught the double turn. The agent catching its own collision is
luck, not a guarantee: a subagent that does not re-read after writing posts the
other job's body and never knows.

## Why it matters

- **A person can receive a reply built from another conversation's body.** The
  worst outcome is silent: no error, a `200`, a committed turn, the wrong words.
- **It is invisible to every existing check.** `workspace-template.test.ts`
  checks the wording of these instructions, never what two agents following them
  at once do to one file.

## What has to be decided

The fix is a path an agent cannot collide on. Options, to weigh:

1. **A unique path per invocation** in the skill guidance — `mktemp`, or a name
   carrying the event id (`/tmp/corpus-reply-<eventId>.md`). Cheapest, and it is
   only skill text, but it depends on every worked example being updated and on
   the agent following it.
2. **A per-workspace or per-job temp directory** the skills point at, isolated by
   construction, so a copied example cannot land on a shared name.
3. **A CLI affordance** that removes the choice — e.g. `--flag-file` reading from
   a path the CLI creates and returns, or a stdin-per-flag form. This is
   CLI-domain work and is the only option that does not depend on the agent's
   habit, which is the same reasoning that made CLI-051 worth its cost.

Whichever is chosen, the worked examples in `comment/`, `profile/`,
`orchestrate/` and `converse/` all move together, and a test should assert two
concurrent flag-file writes cannot name one path.

## Acceptance Criteria

- [ ] Two subagents dispatched in parallel cannot write or read one another's
      flag-file body — shown by a real two-event dispatch, not by inspection
- [ ] The worked examples across all four skills use the chosen scheme, none left
      on a fixed shared path
- [ ] A test fails if a skill example reintroduces a fixed `/tmp/corpus-*.txt`
      path that a second agent could collide on
- [ ] `INFRA-034` story 5 passes 3/3 on the next full pass, for the right reason
      (no collision), not by a widened assertion

## Testing Strategy

A real dispatch of two events at once, each carrying a distinct body through
`--flag-file`, asserting each turn lands with its own body. The rehearsal suite
(story 5) is the end-to-end check; a unit test pins the no-shared-path rule on the
skill bodies.

## E2E Verification Log

_Implementing agent: agent-runtime-dev, run on **Fable 5** (`claude-fable-5`),
2026-09-01._

**Reproduction (pre-fix mechanism, deterministic).** The live occurrence is the
rehearsal quote above. The race replays deterministically as the interleaving
the job log describes — write, concurrent write, read:

```
$ printf 'Reply for thread th_AAAA: grind finer.' > /tmp/corpus-reply.md      # job A writes
$ printf 'Reply for thread th_BBBB: … 18400.'   > /tmp/corpus-reply.md        # job B writes
$ cat /tmp/corpus-reply.md                                                    # job A reads
Reply for thread th_BBBB: the invoice total is 18400.
```

Job A's read returns job B's body, no error anywhere — the shape story 5's
agent caught by luck. With subject-named paths (`/tmp/corpus-reply-th_AAAA.md`,
`/tmp/corpus-reply-th_BBBB.md`) the same interleaving returns each job its own
bytes, because the paths differ by construction.

**Fix.** Every shipped fixed temp path now carries the flag word plus the id or
name of its subject: 18 `/tmp/` sites across `orchestrate`, `comment` (body +
`worked-examples.md` + `skill-genesis.md`), and `profile`. The naming rule and
the leave-the-file decision are stated once, in `orchestrate`'s flag-file
section (the rule's single carrier); the other skills' examples follow it
without restating it. `/tmp/batch.json` (a batch array a command reads back —
same defect class) became `/tmp/corpus-batch-evt_5a2b7c.json`.

**Guard.** `scripts/workspace-template.test.ts` sweeps every template file:
each `/tmp/` token must match
`^/tmp/corpus-[a-z]+-[A-Za-z0-9][A-Za-z0-9_-]*\.[a-z]+$` (anti-vacuity: ≥12
sites across ≥4 files; 18/5 today). A companion test pins that the regex
rejects `/tmp/corpus-title.txt`, `/tmp/corpus-description.txt`,
`/tmp/corpus-reply.md`, `/tmp/title.txt`, `/tmp/batch.json` — the falsification
made permanent. A prose pin holds the owner paragraph in place.

**Falsification.** Reverted `comment/SKILL.md`'s retitle example to
`--flag-file title=/tmp/corpus-title.txt`; the sweep went red naming the file
and the path (`claude/skills/comment/SKILL.md: a fixed temp name is one every
parallel subagent shares: expected '/tmp/corpus-title.txt' to match …`).
Restored; suite green.

**Fresh-workspace drill.** `corpus init` from source (tsx) into an empty
scratch dir: exit 0, 26 template files installed. Installed
`orchestrate/comment/profile SKILL.md`, `skill-genesis.md` and
`worked-examples.md` are `diff`-identical to the edited templates. Installed
tree: 18 `/tmp/` sites, 0 nonconforming.

**Checks.** `VITEST_MAX_THREADS=4 vitest run scripts/workspace-template.test.ts`
→ 511/511, exit 0 (verified without rtk masking). `npm run lint` → exit 0.
Prettier clean on all touched files.

**Deliberately not done here.** Acceptance criterion 1's "real two-event
dispatch" with a live agent, and criterion 4 (story 5 passing 3/3), belong to
the next INFRA-034 full pass — the rehearsal suite is the end-to-end check the
issue itself designates. The mechanism-level race and its removal are shown
above.

## Completion Checklist (domain agent)

- [x] Reproduction logged
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified (1 and 4: mechanism verified here, live
      two-event dispatch rides the next INFRA-034 full pass, as the issue's
      Testing Strategy states)

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-060]` prefix
