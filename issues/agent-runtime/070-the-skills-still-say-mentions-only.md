# [AGENT-070] The skills still read "a parked resident answers only mentions"

## Domain

agent-runtime

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-165

## Spec References

- SPEC.md **§7**, **§8** — the designation-engages rider (SERVER-165)

## Summary

Once SERVER-165 lands, any skill text reading the old truth — that a plain
turn on a designated lane reaches nobody — is stale. AGENT-068/069's E2E logs
both hit the old behaviour and worked around it with `@agent` mentions; the
converse skill's lapse/summoned sections and the comment skill's participation
notes must be audited for the same reading and corrected to the rider's.

## Acceptance Criteria

- [x] Every statement about designated-lane participation in converse,
      comment, orchestrate matches the signed rider
- [x] Net size change per skill recorded; INFRA-038 ratchet green
- [x] `workspace-template.test.ts` guards updated
- [x] E2E: a plain (unmentioned) message to a designated conversation is
      answered by its resident on a real workspace

## E2E Verification Log

**Model: Opus 5 (`claude-opus-5[1m]`), agent-runtime-dev, 2026-09-06.**

Real workspace at `…/scratchpad/e2e070`, created by `corpus init` from the CLI
built in this worktree (`apps/cli/dist/bin/corpus.js`, 0.33.0). Real server on
port 8767 (pid 78026, never 8765), stopped afterwards and the port confirmed
free. Every step through the real CLI.

**0. The installed tree carries the corrected text** — the point of initing
rather than reading the repo:

```
$ grep -n "no mention is needed" .claude/skills/converse/SKILL.md
413: …reaches you, and no mention is needed.** Designating this…
$ grep -n "a designation engages a thread" .claude/skills/comment/SKILL.md
520: turn in it, and a designation engages a thread the same way, in one write.
$ grep -n "Designating\|wait for it" README.md
79: listening on a designated conversation its messages wait for it — nobody else…
85: …Plain comments elsewhere are notes to yourself and never wake it. Designa…
```

**1. A designated conversation, with a listener parked on its lane:**

```
$ corpus thread create --title "Kitchen rewiring" -m "I want to plan the kitchen rewiring. Where should we start?" --json
{"thread":{"id":"th_lwfzqway",…,"agent":"engaged",
 "resident":{"name":null,"docId":null,"weight":null,"designationId":"des_rozja44q6b5m"},…},
 "eventId":null,…}
$ corpus agents
th_lwfzqway "Kitchen rewiring" · a general resident · waiting for a listener
$ corpus queue idle --thread th_lwfzqway &     # the park *is* the presence
$ corpus agents
th_lwfzqway "Kitchen rewiring" · a general resident · live, parked 4s ago — idle
```

**2. A plain, unmentioned message reaches the resident** (the mandatory proof).
No `@agent`, no `/skill`, no `--requests-agent`:

```
$ corpus thread reply th_lwfzqway -m "Actually, start with the fuse box — how many circuits does a kitchen need?" --json
… "eventId":"evt_jgg3ms4q4gcr" …
```

The parked scoped `idle` returned at once, and the event on disk is stamped
with the resident's lane and carries no mention:

```
evt_jgg3ms4q4gcr comment.created
next step in the loop: these are pending, not claimed — `corpus queue claim-all`, work, settle, then park.

{"id":"evt_jgg3ms4q4gcr","type":"comment.created",…,
 "payload":{"threadId":"th_lwfzqway",…,"mentions":[],"skills":[],"unresolved":[]},
 "lane":"th_lwfzqway","seq":1788712172822}
```

The resident claimed its own lane, answered inline and settled:

```
$ corpus queue claim-all --thread th_lwfzqway --json
{"events":[{"id":"evt_jgg3ms4q4gcr",…}],"inProgress":{"events":[],"total":0,…}}
$ corpus thread reply th_lwfzqway --from agent --model "Sonnet" -m "A kitchen usually wants four circuits: …"
replied to th_lwfzqway — turn 2026-09-06T16:29:49Z
$ corpus queue complete evt_jgg3ms4q4gcr
event evt_jgg3ms4q4gcr is complete.
```

`data/threads/th_lwfzqway.md` afterwards — two user turns, one agent answer, no
`@agent` anywhere:

```
## user · 2026-09-06T16:29:10Z
I want to plan the kitchen rewiring. Where should we start?

## user · 2026-09-06T16:29:32Z
Actually, start with the fuse box — how many circuits does a kitchen need?

## agent · 2026-09-06T16:29:49Z
A kitchen usually wants four circuits: a ring for the sockets, a radial for the cooker, …
```

**3. Release keeps engagement, and the ordinary agent inherits the
conversation** — the rider's second half, which the comment skill and
`launching.md` now state:

```
$ corpus thread release th_lwfzqway
released a general resident from th_lwfzqway
# frontmatter: `agent: engaged` stays, the `resident:` block is gone
$ corpus thread reply th_lwfzqway -m "And what size cable for the cooker circuit?" --json
… "agent":"engaged","resident":null … "eventId":"evt_zbpio5cpn2jf" …
$ corpus queue claim-all --json          # unscoped: the orchestrator's lane
{"events":[{"id":"evt_zlqpzsl4v35r","type":"resident.released",…},
           {"id":"evt_zbpio5cpn2jf","type":"comment.created",…,"mentions":[],…}],…}
```

So a plain turn on a released conversation is ordinary work on the
orchestrator's lane, exactly as the release bullet in `launching.md` and the
*Engagement and closure* paragraph in the comment skill now say.

**Sizes (INFRA-038 ratchet).** `converse/SKILL.md` 63,991 → 63,984 B
(15,998 → 15,996 tok), `comment/SKILL.md` 41,039 → 41,036 B
(10,260 → 10,259 tok), `orchestrate/SKILL.md` 50,015 B unchanged. References:
`converse/references/leaving.md` 6,514 → 6,498 B,
`orchestrate/references/launching.md` 28,183 → 28,369 B (+186 B, the release
bullet's engaged clause — the only net addition in the change, and it is new
true content rather than moved bytes). Both SKILL.md subjects **shrank**, so
`npm run skills:check -- --update-baseline` was run once at the end and the
baseline is staged with the change.

**Tests.** `scripts/workspace-template.test.ts` (659 tests) and
`scripts/skill-budget.test.ts`, both green; `npm run skills:check` green after
the baseline update.
