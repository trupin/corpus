# [SERVER-154] A new standalone thread designates a general resident

## Domain

server

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-088
- Blocks: —

## Spec References

- SPEC.md §7 — rider A signed 2026-08-25, including: _"The designation costs
  nothing until there is work. A listener is started when its lane has something
  pending and none is running, not when the thread is created."_
- SPEC.md §10 — rider B signed 2026-08-25

## Summary

Implements CONTRACT-088. `POST /api/threads` with no parent, and
`POST /api/capture`, designate a general resident unless the caller chose
otherwise.

**Nothing here starts a listener.** Rider A's lazy-launch clause makes the
designation a thread field and nothing more; AGENT-053 is what starts listeners,
from the pending count. Building a launch here would be a second launcher beside
the orchestrator's.

## Acceptance Criteria

- [x] A standalone thread created with no designation stated gets a **general
      resident** — no profile, per §7's _"naming none is the ordinary case and
      requires nothing to exist first"_
- [x] An explicitly stated **none** creates a thread with no resident
- [x] A named profile is designated, with §7's existing missing/archived rules
      unchanged — do not re-decide them
- [x] A thread **with a parent** is refused, naming the rule
- [ ] ~~`POST /api/capture`'s filing thread is designated the same way~~ — **cut**, see below. Filed as SHARED-073
- [x] `resident.designated` is enqueued exactly as it is for an explicit
      designation, on the **orchestrator's** lane (§7). This is what lets
      AGENT-053 learn a conversation exists at all
- [x] **No listener is started by this code path**, and a test asserts it: rider
      A's lazy clause is load-bearing, and a launch here would run one agent per
      thread created
- [x] The response carries the designation made

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/create.ts`
- the capture route's thread creation
- the designation write, which already exists for `POST /api/threads/:id/resident`
  and must be **reused rather than reimplemented**

### Key Implementation Details

The designation write already exists. Call it from creation in the same
transaction as the thread write, so a created thread is never briefly resident-less
— a window in which the orchestrator would see its events as unowned.

**One `resident.designated` per designation**, whether it came from creation or
from the explicit route. Two shapes of the same event would give AGENT-053 two
cases to handle for one fact.

### Edge Cases

- A capture that creates several documents and one filing thread: only the thread
  designates.
- Creation refused after the designation was written: one transaction, or the
  designation must not survive.

## Testing Strategy

The three states, the parent refusal, the capture path, and the no-listener
assertion. Falsify the last by starting a listener in this path and watching it
go red.

## E2E Verification Plan

Real server: `corpus thread create` (or the Ask route) with each of the three
states, then read the thread and the roster. Confirm a resident exists, that
`resident.designated` landed on the orchestrator's lane, and that **no listener
is running** — the roster's `live` is false and stays false.

## E2E Verification Log

Implemented by the orchestrator on opus, 2026-08-25.

### Capture was cut, because a rider I drafted has a false premise

Rider B says Ask and Capture both offer a new resident, reasoning that a
capture's lack of a `recipient` is about routing rather than ownership. The
reasoning is sound and **the premise was never checked**: `capture.ts` writes its
thread with `parent: docId`, because it is the document's *filing* thread — and
§7 allows a designation only on a standalone thread.

Ask ships in all three states. Capture's `resident` field was **removed from the
contract** rather than left declared-and-always-refused: a wire field that can
never succeed tells every reader that something is possible. The reason is in the
schema's docblock and pinned by a test, so the absence reads as a decision.

Filed as **SHARED-073** with three ways out, because two of them change signed
text and the choice is not mine.

### Written in the same frontmatter, not by a second call

A created thread is never briefly resident-less. That window would not merely be
untidy: SERVER-153 makes a lane with no resident the *orchestrator's*, and "not
yet designated" is indistinguishable from "released" to the predicate that
decides. `residentToStored` is the one place the stored shape is produced, so
this key and the designate route's cannot drift.

### A parented thread designates nothing, and is not refused for it

The parent check answers `null` before the default is consulted. The contract
refuses a `resident` sent *with* a `parent`, which is where a caller's mistake
belongs — but an ordinary comment sends none and must not acquire one.

### 47 tests failed, and reading them was the work

Almost none were fixture noise. They were the new flow, met from the outside:

- **`provenance.test.ts` (14)** — its helper created a thread and claimed
  unscoped. Every Ask now lands on its own lane, and with no fallback the
  orchestrator cannot see it. **This is the composition SHARED-072 flagged**,
  materialising exactly as written: *"with a resident on every new thread and no
  fallback, every conversation is answered only if its listener started."* One
  helper, scoped, and all fourteen passed.
- **`roster.test.ts`'s `designatedThread`** — creating then designating is now a
  *replacement*, so it announced two events where the cases counted on one. It
  creates undesignated first, which is what the helper always meant.
- **Three frames gained `["agents"]`** — creating a standalone thread, and
  deleting one, now move the roster because a lane appears and disappears.
- **The rest** were cases whose subject is *the absence of a resident*, and they
  now say `resident: null` rather than relying on a default that changed.

### What this leaves resting on a skill

The product flow is now: Ask → thread with a resident → event on its lane →
orchestrator reads `pending > 0 && !live` → launches a listener → listener
answers. Step four is AGENT-053, an instruction rather than a mechanism. That is
what the user asked for, and it is worth restating that no test can hold it.

### Checks

```
vitest run apps/server            205 files, 4686 tests passed   exit 0
vitest run packages/contract       70 files, 3004 tests passed   exit 0
eslint apps/server/src                          0 problems       exit 0
tsc --noEmit -p apps/server                                      exit 0
```


## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[SERVER-154]` prefix
