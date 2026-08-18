# [AGENT-033] A resident with no persona to bind

## Domain

agent-runtime

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-061, SERVER-121, CLI-049
- Blocks: —

## Spec References

- SPEC.md **§7** — the SHARED-048 rider
- SPEC.md **§7** line 339 — the orchestrator skill and delegation

## Summary

Both product skills assume a designation names a profile.

`converse/SKILL.md:167` — *"**Bind your persona.** The designation names an
agent, and the launch that started you carries the `resident` from the
announcement's payload — a name and the id of the `agent-def` document that
defines it. Read that document and work as it describes."*

`orchestrate/SKILL.md:290` — the launch *"give it the payload's `resident` — the
name and the `agent-def` document id both, because a subagent inherits nothing
and the persona is what the designation was for."*

With a profile optional, both are wrong for the ordinary case. A general
resident has no document to read and no persona to inherit, and neither skill
says what to do.

## Acceptance Criteria

- [x] The converse skill binds a persona **when there is one** and works as the
      workspace's ordinary agent when there is not — stated as one rule with a
      condition, not as two parallel procedures that can drift
- [x] The orchestrate skill's launch carries a persona when there is one and
      launches without one otherwise, with no invented placeholder
- [x] Everything else about a listener is unchanged and **said to be
      unchanged**: the lane it holds, claiming, settling, parking, the
      stand-down rule, retirement, and resolution ending it
- [x] The existing rule for a **missing or archived** profile (converse:151,
      *"work anyway and say so in your first reply"*) is reconciled with the new
      case — "no profile" and "a profile that has gone" must not read as the
      same thing, because one is ordinary and one is worth mentioning
- [x] **One rule, one skill**: no mechanism is described in both files. The pins
      in `scripts/workspace-template.test.ts` must still pass, and if this change
      would put a shared passage in both, it goes in one with a pointer from the
      other
- [x] The worked examples in both skills match their own prose

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/converse/SKILL.md` — the persona-binding step
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the launch step
- `scripts/workspace-template.test.ts` — extend the single-owner registry if a
  new mechanism vocabulary is introduced

### Key Implementation Details

**Drill it; do not review it.** Phase 33 established this three times over: skill
text that reads correctly can still fail in a live session, and reading found
none of those defects. Drive a **real Claude Code session** from the changed text
against a real workspace and a real server, and log what the session actually
did — including the general-resident path, which is the new one.

**A general resident is the ordinary case, so it reads first.** Text that treats
the profile-less path as the exception will produce sessions that treat it as
one.

### Edge Cases

- A designation replaced mid-session, profiled → general or the reverse
- A profile archived while a listener runs
- The launch payload's resident shape, whatever CONTRACT-061 settled on

## Testing Strategy

`scripts/workspace-template.test.ts` for the structural pins (shared-passage
comparison and the single-owner registry). The behavioural test is the drill.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Designate a general resident on a real standalone thread
3. Run a real Claude Code session invoking `/converse <th_…>` from the changed
   skill text; log the transcript's actual behaviour
4. Post a message in the thread; confirm the listener claims it on its lane,
   works it inline, settles it, replies, and re-parks
5. Repeat with a **profiled** resident and confirm the persona is bound
6. Resolve the thread; confirm the listener retires
7. Stop the server; confirm the port is free

## E2E Verification Log

Ran on **opus** (Opus 5, 1M context). Throwaway workspaces under
`~/.claude/jobs/4dd0ddef/tmp/{ws33,drill33}`, real server on port **8844**
throughout, stopped at the end (port verified free; 8765 and 5173 untouched).
Drill transcripts retained as `~/.claude/jobs/4dd0ddef/tmp/s033-drill-*.jsonl`
(`claude -p --output-format stream-json --verbose --model opus`).

**One harness note that invalidated the first attempt**: the globally installed
`corpus` on this machine is **0.9.0**, which has no `corpus agents` verb, and a
drill session picks that up off `PATH`. Its first pass logged *"roster read
unavailable: this CLI build has no 'corpus agents' verb"*. Every measurement
below was re-run with a shim putting the repo's built **0.10.0** CLI first.

### The three states, measured (`ws33`, before any text was written)

```
$ corpus thread designate th_agzzrvir --from user
designated a general resident on th_agzzrvir
$ corpus queue claim-all
… "payload":{"threadId":"th_agzzrvir","resident":{"name":null,"docId":null}} …
$ corpus agents
th_agzzrvir "Q3 planning" · a general resident · waiting for a listener
th_yqbho7rg "Refinance"  · researcher (doc_z4jbjkvk) · waiting for a listener
$ rm .claude/agents/researcher.md && corpus agents      # the profile goes
th_yqbho7rg "Refinance"  · researcher (profile missing) · waiting for a listener
$ corpus thread show th_yqbho7rg          # human mode, re-resolved at read time
resident researcher (profile missing)
$ corpus doc show doc_gaefzfoh            # a payload's docId, after removal
corpus: 404 not_found: no document with id doc_gaefzfoh
EXIT=5
```

Two facts the text is built on came from this: **`corpus thread show` prints the
same three labels**, which is what a listener started by hand (no payload) reads;
and **a payload is stamped at designation and never re-resolved**, so a profile
removed afterwards arrives with both fields set and 404s on the read. The second
is why the profiled reading routes into the missing one rather than sitting
beside it.

### Drill A — the launch (`s033-drill-orchestrate.jsonl`)

`corpus init drill33`, two standalone threads, one `editor` profile written with
both frontmatter vocabularies. `th_srupf7c7` designated with **no** `--agent`,
`th_ilpkbays` with `--agent editor`. A real `claude -p "/orchestrate"` session,
given nothing but the workspace, claimed both `resident.designated` events and
composed **two** launches. Verbatim from the general one:

```
  threadId: th_srupf7c7
  resident: {"name": null, "docId": null}

Both resident fields are null — this is an ordinary designation naming no
profile. Do not invent a name or a document id; what a listener does with a
null resident is stated in the converse skill and there alone.
```

The profiled launch is the same prompt with
`resident: {"name": "editor", "docId": "doc_cvuz4xhe"}` and one sentence naming
the profile. Job logs: *"launched a converse listener on th_srupf7c7 — a general
resident"* and *"… — editor (doc_cvuz4xhe)"* — the CLI's own words for the two
states, not invented ones. Both events completed at launch time; the session
parked. **Zero placeholders**: no synthesised name, no `@agent`, no `default`.

### Drill B — the general resident, launched with null fields

The listener read the roster, and its own account of the branch it took was:
*"Both resident fields are null, so I'm a general resident with no persona
document to read."* It then hydrated (`thread context`, `thread show`), **posted
no arrival turn**, parked, claimed on its own lane, worked inline, and replied:

```
agent · 2026-08-17T23:47:26Z
Written down as [[doc_i5o3wlqr]]: 6.4% for the Q3 model, with the 6.1–6.6% range
it came from and today's date, so the rest of the plan can point at one figure …
↳ created [[doc_i5o3wlqr]] with the 6.4% Q3 rate assumption
```

**Not one word about having no profile**, in the reply or anywhere in the thread
— which is the behaviour the ordinary case has to produce, and the one an
exception-shaped rule would have spoiled. Zero `corpus doc show` on any
`agent-def`. Settled after the write, re-parked.

### Drill C — the profiled resident, same text, same session

The listener ran `corpus doc show doc_cvuz4xhe`, said *"Persona bound"*, and
answered **in persona** — the `editor` profile says cut qualifiers, name what you
kept, never rewrite the argument:

```
agent · 2026-08-17T23:47:38Z
> Most teams are unprepared for a significant shift in how software gets written.

Cut: *I think*, *probably*, *fair to say that*, *in some sense*, *somewhat*,
*arguably*, *fairly* — seven hedges stacked in front of one claim …
Kept: *most*. It scopes the claim rather than softening it …
↳ created [[doc_pnqcx5ri]] with the revised opening paragraph
```

Same lane discipline, same settling, same parking as Drill B. The only observable
difference between the two listeners is the one read and the voice of the answer.

### Drill D — a profile that has gone (payload set, document removed)

`th_esg4urrz` designated `--agent auditor`, then `.claude/agents/auditor.md`
removed out of band. The orchestrator's own reasoning, verbatim: *"One
designation for a new lane; its named profile does not resolve on the roster. I
pass the payload through exactly as it came and let the listener deal with it —
inventing a substitute is the one thing I must not do."* The listener ran
`corpus doc show doc_gaefzfoh` (404, exit 5) and opened its **first** reply with:

```
Before the numbers: this thread was designated an `auditor`, but the profile
document that designation points at (`doc_gaefzfoh`) isn't in the workspace, so
there's nothing for me to read. I'm answering as the general agent instead.
Nothing about the work changes; you may want to know the persona went missing.
```

— then did the work and asked the rest with a form. One line, first reply, names
what was named, works anyway. **This is the pair the acceptance criterion is
about**: the same skill text produced silence in B and this line in D. It reached
the right branch by judgement rather than by instruction (the payload's `docId`
was **not** null), so the text now routes a 404 on that read into the missing
reading explicitly — the drill is what found that gap.

### Drill E — started by hand, no payload at all
(`s033-drill-handstart.jsonl`)

`th_u3skq24d` designated general; `claude -p "/converse th_u3skq24d"` with **no
resident information in the prompt**. First tool call `corpus agents`, then:
*"The lane is unattended and I'm a general resident (no persona named)."* It
hydrated, parked, claimed, and replied with a note created under `home/` and a
trace line — again with no remark about the persona. This is the path the
orchestrate skill's roster-launch bullet now depends on: a launch with no
resident in its prompt is not a launch that loses one.

### An earlier stand-down, which is the skill working (`s033-drill-standdown.jsonl`)

A hand-started listener aimed at `th_esg4urrz` while that lane still read `live`
(a killed session's park keeps `lastSeen` warm for the grace window) exited
without claiming, parking or posting: *"its row reads `live, parked 16s ago` … I
read the roster before parking, which is what makes `live` mean somebody else."*
Unchanged behaviour, recorded because it is one of the things this issue promised
not to disturb.

### End state

`corpus agents` at the end showed all four lanes with their correct labels — two
`a general resident`, one `editor (doc_cvuz4xhe)`, one `auditor (profile
missing)`. Queue: `processed 7, failed 0`. Workspace git shows every mutation as
a server auto-commit under the right author (`comment: turn on th_… by agent`,
`resident designate: general resident on Kitchen rebuild (th_u3skq24d)`); no
listener ever wrote a file by hand. Server stopped, port 8844 verified free,
orphaned `corpus queue idle` shells from killed sessions swept.

**Out-of-scope observation for a follow-up**: the Drill E listener retitled its
thread and the title landed as `Kitchen rebuild — cabinet quote, ,400` while its
reply body says `$18,400` — consistent with `$18` being eaten by the shell in a
double-quoted argument. The skills mandate quoted heredocs for bodies; a `$` in a
short flag argument is a different surface and nothing in the text covers it.

### Tests

`VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts` — **15 files, 742
tests, all passing** (359 in `workspace-template.test.ts`, including the eight
new AGENT-033 pins and the extended single-owner registry).
`tsc --noEmit -p scripts/tsconfig.json` exit 0; prettier clean on all four
changed files; `npm run build` green.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-033]` prefix
