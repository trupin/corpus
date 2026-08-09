# [SERVER-069] Carry the chosen weight into the dispatch, and name it in the job log

## Domain

server

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: CONTRACT-039
- Blocks: UI-082

## Spec References

- SPEC.md §7 — the orchestrator-skill paragraph (a stated weight is honoured, not
  weighed again) and the console bullet (a dispatch names the weight it ran at)

## Summary

The server half of SHARED-022's missing middle — see CONTRACT-039 for how the
gap was found. The contract will carry a chosen level on the request; this issue
puts it where the dispatch can read it, and makes it visible afterwards.

**The visibility half is not decoration.** §7's console bullet naming the weight
a dispatch ran at is what makes the whole feature testable by an evaluator
reading SPEC alone — otherwise "honoured, not weighed again" is a claim only the
agent's own prose can support, which is exactly the shape of assertion this
project has repeatedly found to be false. It is also how a person tells a
request that was honoured from one that was not.

## Acceptance Criteria

- [x] A level supplied on a request reaches the queue event's payload unaltered
- [x] Absent stays absent — the server never substitutes a default, because
      absent means "the orchestrator decides" (§7) and a default here would
      silently remove that
- [x] The server **records** the level and never **interprets** it: which model a
      level maps to is the skill's business (§7 keeps model names out of SPEC,
      and SHARED-022 keeps the level vocabulary in the workspace's own guidance).
      A server that validated levels against a list would freeze what the rider
      took pains to keep editable
- [x] The job log names the weight a dispatch ran at, per §7's console bullet
- [x] A job that ran in **stages** shows every one of them (SHARED-023's
      amendment to the same bullet) — so this and AGENT-018 must agree on what a
      stage records

## Technical Design

### Files to Create/Modify

- `apps/server/src/queue/` (the event payload) and the job-log write path.

### Notes

- **Do not enforce the level's meaning anywhere in the server.** The temptation
  is to validate against an enum for safety; the cost is that a workspace editing
  its guidance table then gets rejected by its own server. Shape-validate, pass
  through, record.
- SHARED-023 says a job may run in stages at different weights, with the
  *deciding* stage at the governing weight. Whatever this issue records must be
  able to represent more than one weight for one event, or AGENT-018's rule will
  be unobservable — check that before choosing a shape.

## Testing Strategy

Round-trip: a request carrying a level produces an event carrying it; a request
without one produces an event without one; the job log line names it. Plus a
staged case, once AGENT-018's shape is known.

## E2E Verification Log

**Model: Opus 5 (1M context).** Not a bug, so no pre-fix reproduction — the
behaviour did not exist before CONTRACT-039.

Real `corpus init` workspace at `/tmp/corpus-s069-e2e`, real server on scratch
port **8791** (never 8765/5173), real `curl`/`fetch` and the real `corpus` CLI.
Torn down afterwards; port confirmed free.

### The level reaches the queue event, verbatim

`POST /api/threads` with `"weight": "Heavy or judgment-laden"`, on an anchored
thread. The event file on disk, unedited:

```json
{
  "id": "evt_z5hjvqsb2eau",
  "type": "comment.created",
  "created": "2026-08-08T22:07:47Z",
  "source": "thread",
  "payload": {
    "threadId": "th_sa6knfw3",
    "parentId": "doc_bvink6nx",
    "turnTs": "2026-08-08T22:07:47Z",
    "mentions": [],
    "skills": [],
    "unresolved": [],
    "weight": "Heavy or judgment-laden"
  },
  "status": "pending",
  "updated": "2026-08-08T22:07:47Z"
}
```

And it reaches the agent: `corpus queue claim-all --json`, `payload.weight` per
event —

```text
evt_3etbj2g4kyp5 -> None
evt_6hkjv3fqoxrk -> 'Heavy or judgment-laden'
evt_bcpwy246bxum -> 'Small and mechanical'
evt_i2ogc3w3ixe4 -> 'Deliberative — two readers'
evt_z5hjvqsb2eau -> 'Heavy or judgment-laden'
evt_zuxevzervr2y -> 'Standard'
```

### Every composer, both media types

```text
C) invented level     -> 201 | payload.weight = "Deliberative — two readers"
D) turn append        -> 201 | payload.weight = "Small and mechanical"
G) capture (multipart)-> 201 | payload.weight = "Standard"
H) create (multipart) -> 201 | payload.weight = "Heavy or judgment-laden"
```

`"Deliberative — two readers"` is **not** a level the shipped guidance defines —
it is there to prove the server holds no list to check against (§7, §2.4).

### Absent stays absent

```text
B) no weight -> 201 | payload keys: ["threadId","parentId","turnTs","mentions","skills","unresolved"]
   job log file exists: false
```

No `weight` key at all — not `null`, not `undefined` — and no log line. The
projection row agrees: that event's `lastLine` is `null` while every
weight-bearing one names its level.

Two adjacent cases, both as CONTRACT-039 specifies:

```text
E) blank weight              -> 400 [{"path":"json.weight","message":"must not be blank"}]
F) weight + requestsAgent:false -> 201 | eventId = null
```

An empty string is a refusal, never a second spelling of silence; a weight on a
request that enqueues nothing is inert rather than an error — §8 alone decides
what reaches the agent.

### The job log names it, and holds a line per stage

`.corpus/jobs/evt_z5hjvqsb2eau.jsonl` after the orchestrator's own lines were
appended through `corpus job log` (AGENT-018's grammar), byte-for-byte:

```text
{"ts":"2026-08-08T22:07:47Z","source":"server","line":"weight stated by the request: Heavy or judgment-laden"}
{"ts":"2026-08-08T22:08:03Z","source":"cli","line":"claimed comment.created on th_sa6knfw3"}
{"ts":"2026-08-08T22:08:03Z","source":"cli","line":"dispatched to a research subagent, stage 1 of 2, collecting (Haiku — material for the deciding stage)"}
{"ts":"2026-08-08T22:08:03Z","source":"cli","line":"dispatched to a comment-skill subagent, stage 2 of 2, deciding (Opus 5 — stated by the request)"}
```

The server's line is **first** and `source: "server"`, so a reader (or an
evaluator with nothing but SPEC) can check the dispatch lines against a record
the orchestrator did not write — which is what makes "honoured, not weighed
again" observable rather than asserted. Two dispatch lines for one job, in stage
order, with no second surface and no shape change: the record **is** the log's
lines.

### The console row is not silent until the agent speaks

`GET /api/jobs?recent=20`:

```text
evt_zuxevzervr2y | pending | "weight stated by the request: Standard"
evt_6hkjv3fqoxrk | pending | "weight stated by the request: Heavy or judgment-laden"
evt_i2ogc3w3ixe4 | pending | "weight stated by the request: Deliberative — two readers"
evt_bcpwy246bxum | pending | "weight stated by the request: Small and mechanical"
evt_3etbj2g4kyp5 | pending | null
evt_z5hjvqsb2eau | pending | "dispatched to a comment-skill subagent, stage 2 of 2, deciding (Opus 5 — stated by the request)"
```

### Checks

- `npm run build` — clean (run again after the edits, before the E2E server).
- `apps/server` suite — **175 files, 3587 tests, all passing**.
- `eslint apps/server/src` — clean; `prettier --check` clean.
- `tsc --noEmit` in `apps/server` — clean.
- `corpus db doctor` on the E2E workspace — `projection is clean — 17 documents
  from 17 files (3ms)`.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
