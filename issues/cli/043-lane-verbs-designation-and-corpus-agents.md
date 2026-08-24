# [CLI-043] Lane verbs, designation, and `corpus agents`

## Domain
cli

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: [CONTRACT-051], [SERVER-111], [SERVER-112], [SERVER-109]
- Blocks: [AGENT-025], [AGENT-026]

## Spec References
- SPEC.md §7/§8 as amended by SHARED-043 — scoped verbs, designation, the roster

## Summary
The CLI surface for lanes. `corpus queue idle --thread <th_…>` and
`corpus queue claim-all --thread <th_…>` pass `scope` through and otherwise behave exactly
like their unscoped forms (same output shapes, same `--wait`, same `--json`, same held
report — scoped). `corpus thread designate <id> --agent <name>` and
`corpus thread release <id>` drive the designation routes (user-actor verbs).
`corpus agents` lists the roster: one row per lane — resident name, live/lapsed/waiting,
since, and the one-line summary — the same read the composer's droplist consumes.

## Acceptance Criteria
- [x] `--thread` on `idle`/`claim-all` (`apps/cli/src/commands/queue/idle.ts:83-140`, `claim-all.ts:28-53`): shape-validated `th_` prefix, passed as `scope`; output identical in structure to unscoped (a scoped empty batch prints the same empty-events payload)
- [x] `corpus thread designate <id> --agent <name>`: renders the resolved `{name, docId}` on success; renders the server's 409 (not standalone), 404 (no such agent-def), 403 (agent actor) reasons verbatim; ~~warns inline when the response carries `status: "archived"`~~ — **retired, not deferred** (CONTRACT-054, 2026-08-24): designating an archived `agent-def` is not an anomaly worth warning about, so the criterion was wrong rather than unmet. See Unresolved
- [x] `corpus thread release <id>`: idempotent, prints what was released or that nothing was
- [x] `corpus agents`: human mode one row per lane — `orchestrator · live · parked 2m — idle` / `th_4b8e2c "Q3 planning" · researcher · live · reading the mortgage docs` / `… · waiting for a listener`; `--json` carries the roster verbatim
- [x] `corpus thread show <id>` prints the resident line when designated
- [x] All new verbs registered in the command index with help text matching the existing voice

## Technical Design

### Files to Create/Modify
- `apps/cli/src/commands/queue/idle.ts`, `queue/claim-all.ts` — `--thread`
- `apps/cli/src/commands/thread/designate.ts`, `thread/release.ts` — new
- `apps/cli/src/commands/agents/index.ts` — new top-level `agents` verb
- `apps/cli/src/commands/thread/show.ts` — resident line
- `apps/cli/src/commands/{queue,thread}/index.ts` — registration

### Key Implementation Details
Thin client discipline: no liveness math, no summary derivation — render the server's
fields. `designate`/`release` are user verbs the way `doc delete` is: they do not refuse
the agent client-side (the server owns actors), they just render the 403 honestly.
The scoped idle's expiry payload is unchanged (`{"idle":true,"reason":"timeout"}`) — the
converse skill depends on that stability.

### Edge Cases
- `--thread` naming an undesignated thread on `idle`: the server accepts the park (a lane may be designated moments later) — document that the verb parks on whatever lane it is given; `corpus agents` is where to check the lane is real
- `corpus agents` with zero designations: one orchestrator row, never an empty table

## Testing Strategy
CLI unit tests against stubs: flag pass-through, scoped payload rendering, designation
error surfaces, roster rendering in both modes, registration/help snapshots.

## E2E Verification Plan

### Verification Steps
1. Real server; `corpus thread designate th_x --agent researcher --from user` → resolved row printed
2. `corpus agents` → orchestrator + th_x (`waiting for a listener`)
3. `corpus queue idle --thread th_x` parked in one shell → `corpus agents` shows live; comment in the thread → scoped shell unparks with the event, plain `claim-all` elsewhere returns empty
4. `corpus thread release th_x` → second run prints nothing-to-release

## E2E Verification Log

**Model: Opus 5 (1M context)**, cli-dev. Real `corpus init` workspace at
`/private/tmp/cli043-ws`, real server started by `corpus server start` on port **8842**
(8765 and 5173 left untouched), every command below run through the **built binary**
`apps/cli/dist/bin/corpus.js`.

### The verb surface

| Verb | Shape |
| --- | --- |
| `corpus queue idle` | `--thread <th_…>` appended after `--wait`; passed as `scope` |
| `corpus queue claim-all` | `--thread <th_…>`; passed as `scope` |
| `corpus thread designate <id> --agent <name>` | new, user verb |
| `corpus thread release <id>` | new, user verb, idempotent |
| `corpus agents` | new **top-level** command, read-only, `--json` carries the roster verbatim |
| `corpus thread show <id>` | prints a `resident` line when designated |

### Setup

```
$ corpus init . --port 8842
Initialized Corpus workspace at /private/tmp/cli043-ws
$ corpus server start
corpus 0.9.0 listening on http://127.0.0.1:8842 (pid 57205)
$ corpus doc create --type agent-def --title "researcher" -m "…"
created doc_uhk5rtqh — data/docs/inbox/researcher.md
$ corpus thread create --title "Q3 planning" -m "What should Q3 look like?"
created th_4zkykcxe — standalone
$ corpus thread create --title "Unrelated" -m "Something else entirely."
created th_znxj3aoy — standalone
```

### 1. Designation, and the roster before and after

```
$ corpus agents
orchestrator · waiting for a listener

$ corpus thread designate th_4zkykcxe --agent researcher --from user
designated researcher (doc_uhk5rtqh) on th_4zkykcxe

$ corpus agents
orchestrator · waiting for a listener
th_4zkykcxe "Q3 planning" · researcher · waiting for a listener
a lane with no listener is not a failure: past the grace window (16m) its pending work becomes
visible to the orchestrator's own `corpus queue claim-all`, so it is done more slowly and without
the conversation's warmth — never silently not done. Start a listener with `corpus queue idle
--thread <id>`; parking is what presence is.
```

The `(16m)` is `formatAge(AGENT_PRESENCE_WINDOW_SECONDS * 1000)` — the contract's constant,
never a second copy of it.

`corpus thread show` prints the designation; an undesignated thread prints no line:

```
$ corpus thread show th_4zkykcxe | head -5      $ corpus thread show th_znxj3aoy | head -4
Q3 planning                                     Unrelated
th_4zkykcxe · open · agent none                 th_znxj3aoy · open · agent none
parent — · anchor — · standalone                parent — · anchor — · standalone
resident researcher · doc_uhk5rtqh              created 2026-08-17T00:25:24Z · updated …
created 2026-08-17T00:25:24Z · updated …
```

### 2. Parking scoped is what presence is

The park held in its own process; the roster read from another:

```
$ corpus queue idle --thread th_4zkykcxe --wait 120 --json     # parked, silent
$ corpus agents
orchestrator · waiting for a listener
th_4zkykcxe "Q3 planning" · researcher · live, parked 7s ago — idle — last active just now

$ corpus agents --json
{"agents":[
 {"lane":"orchestrator","resident":null,"live":false,"since":null,"summary":null,"origin":null},
 {"lane":"th_4zkykcxe","resident":{"name":"researcher","docId":"doc_uhk5rtqh"},"live":true,
  "since":"2026-08-17T00:27:43Z","summary":"idle — last active just now",
  "origin":{"id":"th_4zkykcxe","title":"Q3 planning"}}]}
```

Nothing was ever sent to make the lane live: the only request the roster read makes is
`GET /api/agents`, and the only thing that made it live is the held park.

### 3. Disjoint sets — a scoped claim sees only its lane, an unscoped one never sees a live one

Two comments, one in each conversation:

```
$ corpus thread reply th_4zkykcxe --from user -m "@agent Can you pull the mortgage numbers?"
replied to th_4zkykcxe — turn 2026-08-17T00:27:57Z (queued evt_vegsxq5vygnd)
$ corpus thread reply th_znxj3aoy --from user -m "@agent Something for the orchestrator."
replied to th_znxj3aoy — turn 2026-08-17T00:27:57Z (queued evt_dxsi6atjqybi)
```

The parked scoped `idle` returned **only its own lane's event** — `evt_dxsi6atjqybi` is absent:

```
{"events":[{"id":"evt_vegsxq5vygnd","type":"comment.created",…,"payload":{"threadId":"th_4zkykcxe",…}}],
 "inProgress":{"events":[],"total":0,"truncated":false}}
```

and the two claims read disjoint sets:

```
$ corpus queue claim-all                       # the orchestrator's, unscoped
{"events":[{"id":"evt_dxsi6atjqybi",…,"payload":{"threadId":"th_znxj3aoy",…}}],…}

$ corpus queue claim-all --thread th_4zkykcxe  # the resident's
{"events":[{"id":"evt_vegsxq5vygnd",…,"payload":{"threadId":"th_4zkykcxe",…}}],…}
```

Sharpest form of the same guarantee — a pending event on a **live** lane is invisible to the
orchestrator, which returns an empty batch rather than an error:

```
$ corpus thread reply th_4zkykcxe --from user -m "@agent And the rate assumption too, please."
replied to th_4zkykcxe — turn 2026-08-17T00:30:54Z (queued evt_5ce52rpemrx7)
$ corpus queue claim-all
{"events":[],"inProgress":{…}}
$ corpus agents | head -2
orchestrator · waiting for a listener
th_4zkykcxe "Q3 planning" · researcher · live, parked 2m ago — idle — last active 2m ago
```

### 4. A lapsed lane, and the orchestrator picking its work up

Waited out the real grace window — 960 s of wall clock, no shortened constant anywhere. Last
park observed at `00:27:57`; at `00:44:20` the row flipped:

```
$ corpus agents
orchestrator · waiting for a listener
th_4zkykcxe "Q3 planning" · researcher · lapsed, last parked 16m ago — idle — last active 16m ago
a lane with no listener is not a failure: past the grace window (16m) its pending work becomes
visible to the orchestrator's own `corpus queue claim-all`, …

$ corpus agents --json | jq '.agents[1]'
{"lane":"th_4zkykcxe","resident":{"name":"researcher","docId":"doc_uhk5rtqh"},
 "live":false,"since":"2026-08-17T00:27:57Z","summary":"idle — last active 16m ago",
 "origin":{"id":"th_4zkykcxe","title":"Q3 planning"}}
```

The lapse is not breakage, and the proof is the same command answering differently. At `00:31`
the unscoped claim returned `{"events":[]}` for the pending `evt_5ce52rpemrx7`; at `00:44`, the
lane having lapsed:

```
$ corpus queue claim-all
{"events":[{"id":"evt_5ce52rpemrx7","type":"comment.created","created":"2026-08-17T00:30:54Z",
  "source":"thread","payload":{"threadId":"th_4zkykcxe",…}}],"inProgress":{…}}
```

The work was done by the orchestrator instead, exit 0, no error anywhere. And the resident
coming back finds its lane exactly as it left it — one probe re-establishes presence, with
nothing registered:

```
$ corpus queue idle --thread th_4zkykcxe --wait 0 --json
{"idle":true,"reason":"timeout"}
$ corpus agents | head -2
orchestrator · waiting for a listener
th_4zkykcxe "Q3 planning" · researcher · live, parked 0s ago — working Q3 planning
```

`waiting` and `lapsed` are told apart deliberately, and the wording is "the server has observed
no park" rather than "nothing has ever parked" — because presence is in memory and nothing about
it is persisted:

```
$ corpus server stop && corpus server start
stopped (pid 57205)
corpus 0.9.0 listening on http://127.0.0.1:8842 (pid 76264)
$ corpus agents
orchestrator · waiting for a listener
th_4zkykcxe "Q3 planning" · researcher · waiting for a listener — working Q3 planning
```

That is §7's fallback in the direction §7 accepts — the orchestrator may do work a resident
would have, never the reverse.

### 4b. The aggregate and the roster are different facts (CONTRACT-053)

Observed live, and not presented as one fact anywhere: `corpus queue status --json` carries the
workspace aggregate, `corpus agents` carries one row per lane, and their `since` values differ
because a park was held on a lane that has no roster row:

```
$ corpus queue status --json
{"agent":{"live":true,"since":"2026-08-17T00:34:48Z"},"halted":false,…}
$ corpus agents
orchestrator · waiting for a listener
th_4zkykcxe "Q3 planning" · researcher · live, parked 8m ago — idle — last active 8m ago
```

No CLI output shows both: `corpus queue status`'s human rendering prints neither, and
`corpus thread show`'s new line reports the **designation** and says nothing about liveness.

### 5. Release, and its idempotence

```
$ corpus thread designate th_znxj3aoy --agent analyst
designated analyst (doc_lt77w6hd) on th_znxj3aoy
$ corpus thread release th_znxj3aoy
released analyst from th_znxj3aoy
$ corpus thread release th_znxj3aoy
th_znxj3aoy had no resident — nothing to release
```

Resolving releases too (SPEC §7), and the lane leaves the roster:

```
$ corpus thread resolve th_znxj3aoy
resolved th_znxj3aoy
$ corpus agents
orchestrator · waiting for a listener — working Unrelated
th_4zkykcxe "Q3 planning" · researcher · live, parked 1m ago — idle — last active 1m ago
```

A **repeat** designation is not a no-op — it announces again, which is how a person asks for a
stopped listener to be launched. Verified: after draining the queue, a second identical
`corpus thread designate` still enqueued a `resident.designated`.

### 6. Refusals, all in the server's own words

```
$ corpus thread designate th_znxj3aoy --agent analyst --from agent          # exit 5
corpus: 403 forbidden: designating a resident is user-only; a resident claims a conversation and
everything that grows out of it, and an agent that could designate would be choosing who answers
a person's messages

$ corpus thread designate th_znxj3aoy --agent nobody                        # exit 5
corpus: 404 not_found: no agent named nobody in this workspace — a designation names an
agent-def the way a mention does

$ corpus thread designate th_fy67rdx2 --agent researcher                    # exit 5
corpus: 409 conflict: only a standalone thread may have a resident — a thread on a document is
about that document, and a resident owns a conversation rather than a passage

$ corpus thread release th_4zkykcxe --from agent                            # exit 5
corpus: 403 forbidden: releasing a resident is user-only; it is the other half of the same
user-only state, and an agent able to release could quietly stop being resident in a
conversation a person put it in
```

Client-side usage errors, which never reach the server (exit 2):

```
$ corpus thread designate th_znxj3aoy
corpus: --agent is required.
  Usage: --agent <name>

$ corpus queue idle --thread orchestrator
corpus: `--thread orchestrator` is not how the orchestrator's lane is named.
  The unscoped call *is* the orchestrator's lane — drop the flag entirely. `--thread` names a
  designated root thread, and the two spellings are kept apart so a lane cannot be addressed by
  accident.

$ corpus queue claim-all --thread doc_uhk5rtqh
corpus: a lane is named by a thread id, which looks like `th_…` — got "doc_uhk5rtqh".
  Pass the id of the designated root thread whose lane you own. `corpus agents` lists every lane
  and the id to use.
```

### 7. The documented edge case: a lane that is not designated

The verb parks on whatever lane it is given, and `corpus agents` is where you check it is real:

```
$ corpus queue idle --thread th_znxj3aoy --wait 0 --json
{"idle":true,"reason":"timeout"}                  # exit 0 — the same payload an unscoped park gives
$ corpus queue claim-all --thread th_znxj3aoy
{"events":[],"inProgress":{"events":[],"total":0,"truncated":false}}
$ corpus agents                                   # no lane was created
orchestrator · waiting for a listener
th_4zkykcxe "Q3 planning" · researcher · live, parked 6m ago — idle — last active 6m ago
```

### Checks

```
$ npx tsc --noEmit -p apps/cli        → exit 0
$ npx eslint apps/cli/src             → no issues
$ npx prettier --check docs/cli.md    → clean
$ npm run docs:cli -w apps/cli        → docs/cli.md regenerated (never hand-edited)
$ vitest run apps/cli                 → 92 files, 1489 tests, all passing
```

### Calls made where the issue left a choice open

- **`--thread`, not `--scope`, and no `CORPUS_LANE`.** A lane has two spellings on the wire and
  the contract makes the absent parameter *mean* the orchestrator's lane. A `--scope` flag would
  give that lane a second spelling at the one place the mistake is invisible: `--scope
  orchestrator` written where a thread id was meant parks the resident on the wrong lane, exits
  0, prints nothing unusual, and quietly leaves the conversation to the orchestrator. So the flag
  admits only `th_…` and refuses `orchestrator` with a usage error naming the fix. For the same
  reason there is deliberately **no environment variable**: `CORPUS_JOB` is safe because a stale
  value is refused with `422`, and a stale lane is silently honoured — a subagent that inherited
  one would claim somebody else's conversation and no server could tell it apart from the
  resident doing its job.
- **`corpus agents` is a top-level command, not a topic.** A topic invites `corpus agents
  register` / `heartbeat`, and §7 has neither. One read, no room to grow a write.
- **The lapse explanation is one note on stderr, not a mark on every row.** A lapsed lane is a
  state; the sentence explaining that the orchestrator covers it belongs beside the answer, not
  in it. It fires only for a **thread** lane with no listener — the orchestrator's lane is the
  fallback, so a note about where its work goes would be wrong.
- **The grace window is `formatAge(AGENT_PRESENCE_WINDOW_SECONDS * 1000)`.** The test asserts the
  module *names* the constant, not just that the rendered value is `16m` — value equality cannot
  tell a derivation from a literal that agrees with it today.
- **`release` pre-reads the thread; `designate` does not.** The `DELETE` answers with
  `resident: null` whether it wrote or not, so the read is the only way to say *who* was
  released — `thread resolve`'s precedent exactly. `designate` needs no read because a repeat is
  **not** a no-op: it re-announces, which is how a stopped listener is asked for again, and
  reporting "already designated" would tell a person the thing they came to do had not happened.
- **Neither designation verb pre-checks the actor.** `doc detach`'s rule: the server owns actors,
  and a second opinion is a second place to disagree. The `403`s above are rendered verbatim.
- **`age.ts` was extracted rather than duplicated.** `queue claim-all`'s `held 3h` and
  `corpus agents`' `last parked 3h ago` now share one ladder.

### Post-Implementation Verification
_See above._

## Unresolved — belongs to another domain

**One acceptance criterion cannot be met from the shipped contract**: _"warns inline when the
response carries `status: "archived"`"_ on `corpus thread designate`. The designation response
carries no archived signal at all, and that is a deliberate server decision, not an oversight —
`apps/server/src/threads/resident.ts:150-153`: _"An **archived** agent-def designates rather than
being refused… Its archived-ness is not reported on this response, because `Resident` carries a
name and a document id and no status."_ Verified against the real server:

```
$ corpus doc archive doc_lt77w6hd && corpus thread designate th_2xamtqep --agent analyst --json
{"thread":{…,"status":"open","resident":{"name":"analyst","docId":"doc_lt77w6hd"}},"warnings":[]}
```

`ThreadSummary.status` is `open|resolved` and never `archived`; `Resident` has no status; and
`warnings` is empty. The only way for the CLI to warn would be a second `GET /api/docs/{docId}` —
re-deriving something the server chose not to publish, and making the CLI a second source of
truth about the persona's state. **Not implemented; escalated.** The fix, if wanted, is a
contract + server change (a §11 warning on the designation, or a status on `Resident`), owned by
contract-dev / server-dev.

**Adjudicated 2026-08-24 (CONTRACT-054, contract-dev): the criterion is retired, not deferred.**
The question CONTRACT-054 had to answer first was whether designating an archived agent-def is
something a person should be warned about, and the answer is no:

1. **Archiving an agent-def changes nothing about the persona.** `ResidentSchema.docId` publishes
   it in so many words — _"an archived `agent-def` still under that root resolves exactly as
   before, and is still designatable"_ — so a warning would tell a person their correct,
   fully-supported act was suspect. A contract cannot say both.
2. **Archiving is an organisational act, not a deprecation** (SPEC.md §7: _"a reversible
   organizational act, never a deletion"_). Designation is user-only state on a standalone
   thread. A person who archived a definition and then named it has done two deliberate things,
   and the second one is the one the tool was asked to do.
3. **§11's `warnings` is about the write, not about the caller's judgement.** It carries a
   rejected auto-commit or a workspace with no git. A warning about which document a request
   named would set a precedent that every write editorialises about the documents it mentions,
   and there is no principled stopping point after the first one.
4. **The cheap-looking fix is not cheap.** `Resident` is consumed by four domains and appears in
   roughly fifty fixture literals (CONTRACT-071 measured it), and a status on it would contradict
   `docId`'s published sentence that _"archived-ness is not carried on a `Resident` at all — it is
   the document's own `status`, on the document this id names, for the caller that cares."_

What a person keeps is the ability to look: `docId` names the document, and its own `status` is
one ordinary read away for any surface that decides it wants to show it. No follow-up CLI issue
is filed, and `apps/server/src/threads/resident.ts`'s comment stands — it already gives this
reasoning and does not contradict the behaviour.

**Separate, pre-existing, and out of scope here**: `corpus queue status` never renders
`QueueStatus.agent` (CONTRACT-045) in human mode, and its `--json` example in the registry omits
the field the route actually returns. Worth a small CLI issue of its own; deliberately not
widened into this one.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified (one exception, escalated above)

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0)
- [ ] Committed with `[CLI-043]` prefix
