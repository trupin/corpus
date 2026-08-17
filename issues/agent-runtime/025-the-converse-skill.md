# [AGENT-025] The converse skill — a resident's own loop

## Domain
agent-runtime

## Status
todo

## Priority
P0

## Model
fable

## Dependencies
- Depends on: [SHARED-043], [CLI-044], [CLI-043]
- Blocks: [AGENT-026]

## Spec References
- SPEC.md §7 as amended by SHARED-043 — the resident's loop, one consumer per lane

## Summary
Author the **converse** skill: the loop a resident subagent runs for the lifetime of its
designation. It is orchestrate's sibling, not its child — same invariants where they apply
(CLI-only mutation, attribution, archive-never-delete, retrieval discipline, keys,
patches), but its own doctrine where they deliberately differ: a resident **works inline**
(the conversation *is* the work; delegation is the exception for heavy side-tasks), and a
resident **settles its own lane** (claim → work → settle → park, all first-person — the
rule "queue state never crosses the subagent boundary" is orchestrate's, scoped to the
orchestrator's lane by SHARED-043). The skill is what makes the feature feel synchronous:
warm context, no dispatch hop, reply then settle then re-park.

## Acceptance Criteria
- [x] New skill document at `assets/workspace/claude/skills/converse/SKILL.md`, installed by the workspace template (`scripts/workspace-template.ts` + test), frontmatter matching the existing skills' shape (id `doc_skillconverse`, `type: skill`, `tags: [core]`, `evergreen: true`)
- [x] Invocation contract stated: launched with the designated thread id as parameter (`/converse th_…`); first acts: `export CORPUS_FROM=agent`, `corpus agents` to confirm the lane exists and no other listener is live (one consumer per lane binds the resident too), `corpus thread context` + `thread show` to hydrate
- [x] The loop: `corpus queue claim-all --thread th_x` → work each event inline in claim order → `corpus job log` progress lines → reply (`--model` naming what ran, trace line when documents changed) → settle first-person (`complete`/`fail`/`defer` with the same discipline orchestrate states) → `corpus queue idle --thread th_x` → repeat; `export CORPUS_JOB=<evt>` per event so every write is provenance-stamped, unset/reset between events
- [x] Persona binding: the designation's agent-def document is read at start and bound as the resident's persona; a gone/archived persona → work anyway, state the deviation in replies (mention doctrine, unchanged)
- [x] Summoned work spelled out: an event whose origin is outside the scope (recipient override) is worked with the resident's context but **replied where it was asked**; the resident never adopts the foreign thread into its scope
- [x] Retirement: a scoped claim/park returning against a dissolved lane (`corpus agents` no longer lists it, or idle returns with the lane gone) → finish held work, settle, post a one-line sign-off on the root thread, exit — never re-park on a dead lane
- [x] Context growth: the skill states the rehydration doctrine — the thread and its artifacts are the memory; when context runs heavy, finish and settle held events, then exit cleanly; relaunch (AGENT-026's lapse pickup or the operator) rehydrates from `thread show` + scope artifacts; no transcript handoff, per §7's briefing rule
- [x] Weight/model rules restated for first-person work: a stated `weight` on an event binds the resident's own choice of what to launch for a delegated stage; forms, fences, and the reply grammar bind by reference to the comment skill

## Technical Design

### Files to Create/Modify
- `assets/workspace/claude/skills/converse/SKILL.md` — the skill
- `scripts/workspace-template.ts` / `scripts/workspace-template.test.ts` — install + test
- `assets/workspace/README.md` — mention the third core skill

### Key Implementation Details
Write it the way orchestrate and comment are written: invariants first, the loop as a
numbered procedure, refusals with their recoveries, worked examples. Do not duplicate the
comment skill's reply/forms/fence grammar — bind it by reference, the way orchestrate does.
The skill must be explicit about the two doctrinal departures (inline work, first-person
settlement) *and* their boundary: everything else in orchestrate's invariants binds
unchanged, and a resident dispatching a heavy side-task briefs it under the same delegation
rules orchestrate states.

### Edge Cases
- Two listeners on one lane (operator error): the `corpus agents` check at start; if a live listener already holds the lane, say so and exit rather than split the story
- A person editing a scope artifact the resident wants to write: same courtesy as everywhere — reply, `defer --blocked-on <docId>`, re-park; deferral semantics are lane-preserving (SERVER-111)
- `resident.designated` re-fired for a lane that already has this listener (re-designation with the same name): treated as a no-op report, not a second loop

## Testing Strategy
`scripts/workspace-template.test.ts` covers installation; the skill text itself is checked
by the evaluator against SHARED-043's behavioral criteria.

## E2E Verification Plan

### Verification Steps
1. Real workspace, real server, `.claude/agents/researcher.md` present; designate a standalone thread
2. In a Claude Code session, launch a background subagent on `/converse th_x`
3. Post three messages in the thread in quick succession → replies arrive in order, each turn naming its model; `corpus agents` shows the lane live with real summaries between them
4. Create a doc through the conversation → `corpus doc show` proves `origin: th_x`; comment on that doc → the resident (not the orchestrator) answers
5. `corpus thread release th_x` → the resident signs off and exits; a later comment on the thread is answered by the orchestrator path

## E2E Verification Log

**Model: Opus 5 (1M context)**, agent-runtime-dev, 2026-08-16. The live loop was
driven by a real Claude Code session (Sonnet 4.5) given nothing but the installed
`SKILL.md` and the thread id — the harness prompt carried no doctrine, only the
workspace path and the `corpus` shim.

Two workspaces, both real, both on free high ports (never 8765 / 5173):
`/tmp/corpus-agent025/ws` (port 9761, mechanism probes) and
`/tmp/corpus-agent025/ws2` (port 9762, the live drill, scaffolded by a fresh
`corpus init` **after** the skill was written, so the install path is what put the
skill there).

### 1. The template installs it

```
$ corpus init ws2 --port 9762
  installed 9 template files, recorded in .corpus/template-manifest.json
$ ls ws2/.claude/skills/
comment  converse  fixture-notes  orchestrate  todos
$ corpus doc show doc_skillconverse
Converse
doc_skillconverse · skill · open
key cedc431d07f33ff3e8a971456fbc29b6acc4cad618ab8fb1d78616ca97397608
.claude/skills/converse/SKILL.md
$ corpus doc check
checked 10 documents — no findings.
```

### 2. Presence is the parked request — observed appearing

`researcher` agent-def written into `.claude/agents/`, standalone thread
`th_mtkglcwd` created and designated. The roster read `waiting for a listener` for
three consecutive polls, then flipped **only** when the live session reached its
park:

```
18:06:56  th_mtkglcwd "Q3 refinance planning" · researcher · waiting for a listener
18:07:12  th_mtkglcwd "Q3 refinance planning" · researcher · live, parked 12s ago — idle
```

Nothing registered it. The park is the whole of the presence.

### 3. The resident holds its lane — the orchestrator cannot take its work

A message posted into the scope at 18:08:07 (`evt_qr3ev3r36qob`), and an
**unscoped** `corpus queue claim-all` run immediately afterwards:

```
$ corpus thread reply th_mtkglcwd -m "@agent write down our working rate assumption…"
replied to th_mtkglcwd — turn 2026-08-17T01:08:08Z (queued evt_qr3ev3r36qob)
$ corpus queue claim-all --json          # the orchestrator's claim
{"events":[],"inProgress":{"events":[],"total":0,"truncated":false}}
```

The event was pending and the orchestrator could not see it. The resident claimed
it scoped, worked it **inline**, and replied 39s later:

```
agent · 2026-08-17T01:08:47Z   (model claude-sonnet-4-5)
Written down as [[doc_snwscsg6]] so the rest of the plan can point at it: 6.4%,
with the 6.1-6.6% range it came from and today's date.
↳ created [[doc_snwscsg6]] with the 6.4% rate assumption
```

`inProgress` is per-lane, measured: while the resident held `evt_cwlxn3yyn4ah` on
`ws`, the unscoped claim reported `total: 0`.

### 4. Provenance, and the scope walk that pays for it

The write carried `CORPUS_JOB`, so the server stamped the origin:

```
"id":"doc_snwscsg6", … "origin":"th_mtkglcwd"
```

A whole-document thread was then opened on **that** document (`th_25wucmmm`,
parent `doc_snwscsg6`). Its event was stamped for the resident's lane by the
origin walk — the unscoped claim was empty again — and the resident answered in
the thread the payload named, not at home:

```
agent · 2026-08-17T01:12:05Z
I don't have a source in the corpus that quotes 6.75% — … if you can point me at
the source … I'll read it and update the range here if it holds up.
```

No trace line on that turn, correctly: it changed nothing.

### 5. Retirement

`corpus thread release th_mtkglcwd` at 18:13:58 — the roster row vanished at once
and **no event was enqueued**. The listener was mid-park; it read the roster at the
top of the next pass and signed off at 18:20:43:

```
agent · 2026-08-17T01:20:43Z
Stepping out of this conversation — it has been handed back to the general agent,
which will pick up anything you write here next.
```

It then exited without re-parking. A message posted to the same thread afterwards
routed to the orchestrator, as dissolution requires:

```
$ corpus queue claim-all --thread th_mtkglcwd --json   → {"events":[], …}
$ corpus queue claim-all --json                        → {"events":[{"id":"evt_6dv77z56pcny", …}]}
```

### 6. What was falsified, against the running server

- **A scoped park on a dissolved lane does not error** — it is accepted and parks
  the full window, exit `0`, `{"idle":true,"reason":"timeout"}`. This is why the
  skill forbids re-parking without the roster read: the failure is silent.
- **`--thread orchestrator`** — exit `2`, usage error, as the skill states.
- **`--job` naming a settled or unknown event** — exit `5`, nothing written
  (`settled work cannot acquire a scope`). This is what makes *settle last* a rule
  rather than a preference.
- **`corpus job log` on a settled event** — exit `0`. So the skill does not claim
  a refusal there; it says instead that at retirement there is normally no event
  left to log to.
- **`corpus queue reap-stale` takes no lane** (`docs/cli.md`), which is why the
  skill forbids the resident from running it at all.

### 7. What the live session found wrong in the skill, and what was fixed

The session's report named two defects, both the AGENT-019 shape — a worked
example beating the rule that contradicts it:

1. **It copied `--model claude-sonnet-4-5` out of the example onto its first real
   turn** before catching itself. The one field in the product that exists to be
   checkable was briefly false while looking right. Fixed: the worked example now
   says in words that the model string is what ran *there*, and that copying it is
   the one way to make the field lie.
2. **The example printed a `key` line after `corpus doc create`.** Measured: that
   verb prints `created doc_… — data/docs/…` and **no key**. The example was
   wrong and left the session unsure how to edit what it had just made. Fixed to
   the real output, with the consequence stated (read the document first).

Both are now pinned by tests, including a mechanical one that fails on any
`created doc_…` line followed by a key in a worked block.

A third observation — that the `researcher` persona's "read the sources" brief has
no meaning when the question is about the world outside the corpus — is about
agent-def authoring, not this skill, and is reported to the orchestrator rather
than patched here.

### 8. Tests

`scripts/workspace-template.test.ts` — 276 passed (was 272 before this issue; 275
after the tree/count updates, 276 with the drill's findings pinned).
`apps/cli/src/template` + `apps/cli/src/commands/init` — 144 passed, 9 files.
`prettier --check` clean on all four changed files after one `--write`;
`eslint` clean; `tsc --noEmit -p scripts/tsconfig.json` exit 0 (exit code read
from a redirected run, not from the proxy's stdout).

The `--thread` guard was proved to fire rather than pass vacuously: run against a
block missing the flag it reports `["queue claim-all", false]`.

### Post-Implementation Verification
Servers on 9761 and 9762 stopped and both ports confirmed free; no process left
running by this session.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain)
- [ ] Committed with `[AGENT-025]` prefix
