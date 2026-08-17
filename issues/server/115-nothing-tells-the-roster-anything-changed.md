# [SERVER-115] Six emitters never name `["agents"]`, and this release is what makes them bite

## Domain

server (contract-coordinated)

## Status

in-review

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-055 (the published `emittedBy` for `["queue"]`)
- Blocks: nothing formally — but see below, it should land **with or before**
  UI-108/UI-109
- Related: SERVER-114 (the same defect shape, found first), CONTRACT-045

## Spec References

- SPEC.md **§7** — *"Who is running is a **read**, never a push"*
- SPEC.md **§9.4** — invalidate keys

## Summary

`SERVER-114` fixed one emitter that failed to name a key the changed fact is
cached under. Its sweep found **six more of the same shape**, all in the same
direction: a fact that changes what `GET /api/agents` would answer, emitted
without ever naming `["agents"]`.

| Where | What changes about the roster |
| --- | --- |
| `queue/project.ts:39` | queue transitions — the roster's `summary` reads the same `events` / `jobs.last_line` |
| `watcher.ts:463` | job-log appends — same `summary` |
| `docs/write.ts:1195` | a designated thread's title changes |
| `projection/routes.ts:52` | projection rebuild (also the boot catch-up path) |
| `watcher.ts:291` | out-of-band thread edits |
| `watcher.ts:457` | out-of-band queue-event file moves — **a second copy of `QUEUE_QUERY_KEYS`** |
| `docs/delete.ts:104` | deleting a designated root thread |

**They are latent only because nothing caches `/api/agents` yet**, and that is
precisely why this is P0 rather than backlog: `UI-108` (the composer offers the
recipient) and `UI-109` (the board shows who is resident, and who is live) are
**in this release**, and both exist to put the roster on screen. The day either
lands a cached `useAgents`, all seven rows above become live staleness bugs —
a recipient picker that keeps offering an agent that left, a board that keeps
showing a resident whose thread was deleted.

So the choice is to fix them now or to ship the feature and the bugs together.

**Note the trap at `watcher.ts:457`**: it is a *second copy* of
`QUEUE_QUERY_KEYS`, so fixing the shared constant would silently miss it. That
duplication is worth removing as part of this, not merely working around.

## Why it is contract-coordinated

Adding `["agents"]` to `QUEUE_QUERY_KEYS` rewrites the frame of every queue
transition, and contradicts the contract's published `emittedBy` for that key.
The vocabulary has to say the new truth first, or the server and the published
description disagree — which is exactly the drift `CONTRACT-052` spent a pass
cleaning up in a different corner.

## Acceptance Criteria

- [x] Every listed emitter names `["agents"]` where it changes what the roster
      would answer, and does not where it does not — a blanket addition that
      makes unrelated writes re-read the roster is a different defect
- [x] The duplicate `QUEUE_QUERY_KEYS` at `watcher.ts:457` is removed in favour
      of the shared constant, or the duplication is justified in a comment
- [x] `CONTRACT-055` lands the vocabulary change; the server does not ship a
      frame the published description denies
- [x] Tests assert the **whole key list** at each site, as SERVER-114's does —
      "something was emitted" is what let this survive
- [x] Each test checked red against the current emit

## Technical Design

### Files to Create/Modify

The seven sites above, their tests, and `apps/server/src/queue/index.ts` (the
shared constant).

### Notes

`SERVER-114` established the rule to apply: *an emit names every key a route
carrying the changed fact is cached under, not the key of the route the fact is
named after.* Every row here is a failure of that one rule.

## Testing Strategy

Per-site unit assertions on the emitted key list. If an integration test can
show a roster going stale and then not, it is worth more than any of them.

## E2E Verification Log

**Model: opus.** Real `corpus init` workspaces at `/tmp/s115-ws` (pre-fix) and
`/tmp/s115-ws2` (post-fix), real server on port 8791, frames read off a live
`curl -N /events`, roster read with `GET /api/agents` before and after every
action.

### Pre-fix reproduction — all seven listed sites, plus the eighth

Setup: agent-def `.claude/agents/researcher.md`, standalone thread
`th_nr3ynds6` "Claims review", `thread designate --agent researcher`.

| # | Action | Frame emitted | Roster before → after |
| --- | --- | --- | --- |
| A1 | `queue claim-all --thread th_nr3ynds6` | `[["queue"],["jobs"],["docs"]]` | `summary: null` → `"working Claims review"` |
| A2 | `doc edit th_… --title "Claims review, revised"` | `[["docs"],["docs",th]]` | `summary: "working Claims review"` → `"working Claims review, revised"` |
| A3 | `job log evt_… "reading the claims table"` | `[["jobs"],["jobs",evt]]` | `summary` → `"reading the claims table"` |
| A4 | out-of-band `sed` on the thread's `title:` | `[["docs"],["docs",th],["threads",th]]` | `origin.title` → `"Claims review, out of band"` |
| A5 | out-of-band `mv in-progress/evt.json processed/` | `[["queue"],["jobs"],["docs"]]` | `summary: "reading the claims table"` → `null` |
| A6 | `db rebuild` | `[["docs"],["tree"],["queue"],["jobs"]]` | unchanged (idempotent rebuild) |
| A7 | out-of-band `mv .claude/agents/researcher.md researcher-senior.md` | `[["docs"],["docs",old],["docs",new]]` | `resident.docId: doc_agentdef9aac2cc9` → `doc_agentdefd48a7cd0` |
| A8 | `doc delete th_…` | `[["docs"],["docs",th],["threads",th]]` | lane row present → gone |

Not one frame named `["agents"]`. A1 is the row `UI-108` measured through a real
browser (page issued no second `/api/agents` request over 6 s).

**A7 settles the eighth emitter as real**: an agent-def under `.claude/agents/`
that declares no `id:` carries a *synthetic* id derived from its path, so
renaming the file gives the same agent a different document id while the
designation still resolves (by its title alias). A held roster then points a
reader at a document the workspace no longer has.

### Post-fix — the same actions, on a fresh workspace and a rebuilt server

| # | Action | Frame emitted | Roster moved? |
| --- | --- | --- | --- |
| B1 | `thread reply` with `@agent` (enqueue) | `[["docs"],…]` then `[["queue"],["jobs"],["docs"]]` | no |
| B2 | `queue claim-all --thread th_…` | **`[["queue"],["jobs"],["docs"],["agents"]]`** | yes — `null` → `"working Claims review"` |
| B3 | `job log evt_… "reading the claims table"` | **`[["jobs"],["jobs",evt],["agents"]]`** | yes |
| B4 | `doc edit th_… --title "Claims review, revised"` | **`[["docs"],["docs",th],["agents"]]`** | yes |
| B5 | `doc edit doc_xzcgl5mo --title "Still unrelated"` | `[["docs"],["docs",doc]]` | no |
| B6 | `queue halt --reason maintenance` | `[["queue"],["jobs"],["docs"]]` | no |
| B7 | `queue resume` | `[["queue"],["jobs"],["docs"]]` | no |
| B8 | out-of-band retitle of the designated thread | **`[["docs"],["docs",th],["threads",th],["agents"]]`** | yes |
| B9 | out-of-band `mv in-progress/ → processed/` | **`[["queue"],["jobs"],["docs"],["agents"]]`** | yes |
| B10 | out-of-band drop into `pending/` | `[["queue"],["jobs"],["docs"]]` | no |
| B11 | out-of-band rename of the agent-def | **`[["docs"],["docs",old],["docs",new],["agents"]]`** | yes — `docId` re-resolved |
| B12 | `db rebuild` | **`[["docs"],["tree"],["queue"],["jobs"],["agents"]]`** | no (unconditional, by decision) |
| B13 | `doc delete th_…` | **`[["docs"],["docs",th],["threads",th],["agents"]]`** | yes — lane gone |

Every row satisfies *names `["agents"]` iff `GET /api/agents` changed*, except
B12, which is the same deliberate exception `["tree"]` already has on that route.

### Cost of the measurement

`rosterSignature` vs `folderTreeSignature` over 2020 documents (2000 iterations
each, after warm-up):

| designated lanes | `rosterSignature` | `folderTreeSignature` |
| --- | --- | --- |
| 0 | 3.1 µs | 645.6 µs |
| 1 | 39.1 µs | 609.8 µs |
| 5 | 159.4 µs | 612.3 µs |
| 20 | 644.7 µs | 630.7 µs |

Linear in *lanes*, flat in corpus size — which is why it is taken unflagged on
every mutation where the tree signature had to be gated behind `mayChangeTree`.

### Red-check

Every new and changed assertion was run against the pre-fix emit and observed
to fail: 12 red across `queue/project.test.ts`, `projection/routes.test.ts`,
`events/frames.test.ts` and `agents/staleness.test.ts`, plus 4 red in
`watcher/watcher.test.ts`. Re-inlining the watcher's copy of the key list named
`watcher/watcher.ts` in the containment test's offender list. Making the
addition *blanket* — always returning the transition table, always pushing
`["agents"]` after a write — turned the enqueue, halt/resume, unrelated-document
and turn-append tests red, which is the other half of the acceptance criterion.

Full `apps/server` suite: **4005 passed, 0 failed**. Typecheck, eslint and
prettier clean.

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-115]` prefix
