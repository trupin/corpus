# [SERVER-129] A designation stores and reports its weight

## Domain

server

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-067
- Blocks: CLI-053, UI-125, UI-126, AGENT-039
- Related: SHARED-055 (signed 2026-08-19)

## Spec References

- SPEC.md **§7** — *"A resident's weight is set when it is designated, not per message"* (rider signed 2026-08-19)
- SPEC.md **§7** — the weight rider: a stated weight is honoured, never substituted

## Summary

CONTRACT-067 lets a designation carry `weight`, a weight **level key** from the workspace's own tier table, and `Resident` reports it. This is the server half: the designate route accepts it, the thread's frontmatter stores it, every `Resident` the server returns (thread, thread summary, roster row) reports it, and the `resident.designated` event payload carries the same `Resident` so the orchestrator launches the listener at that weight (AGENT-039).

**Decided by the orchestrator, 2026-08-19:**

- The stored shape is `resident.weight` in the thread's frontmatter beside `name` and `docId` — one key, absent when none was chosen. `null` on the wire means *none chosen, the listener runs at whatever the launcher picks*.
- The server **does not validate the key against the tier table**. The table is the workspace's own skill text, which the server never reads (it is read client-side by `@corpus/kit`). The server stores what the contract's `RequestedWeightSchema` accepts, as it already does for a message's `weight`. A level that no longer exists is the launcher's to report, per §7's weight rider — CONTRACT-067 decision 4.
- Re-designating the **same** profile with a **different** weight is a write, not a no-op: the resident's weight changed. Today `ResidentChange.result` is null for a re-designation of the same agent; it must be non-null when the weight differs, and the event is enqueued, because the listener has to be relaunched at the new weight.

## Acceptance Criteria

- [x] `POST .../resident` with `weight` stores it; `GET` on the thread, the thread summary, and `GET /api/agents` all report it on `Resident.weight`
- [x] Omitting `weight` stores none and reports `null` — an existing designation file with no key reads back as `null`
- [x] The `resident.designated` event payload's `resident` carries `weight`
- [x] Same profile, different weight: written, event enqueued. Same profile, same weight: the existing no-op
- [x] Release removes the key with the rest of the `resident` block
- [x] Falsified: drop the frontmatter write and the report test goes red

## Technical Design

### Files to Create/Modify

- `apps/server/src/threads/resident.ts` — `toFrontmatter`-style writer at `:147-150`, the no-op comparison near `:226`
- `apps/server/src/threads/read.ts` — `storedResident`, `currentResident`
- `apps/server/src/core/resident.ts` — the stored-shape parser
- `apps/server/src/agents/roster.ts` — roster rows
- tests beside each

### Key Implementation Details

Read `resident.ts`'s docblock on re-designation and `read.ts:170`'s re-resolution. `weight` is **stored, not re-resolved** — unlike `docId`, it is the person's choice and has nothing to resolve against.

### Edge Cases

- A thread whose frontmatter `resident` block has `weight` but no `name` — a general resident with a weight, legal
- A legacy block with unknown keys — whatever `storedResident` does today for unknown keys stays

## Testing Strategy

Route tests through the real Hono app against a temp workspace, in the shape `resident.test.ts` uses.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Designate with `--weight heavy` (via curl or CLI-053); `GET /api/threads/<id>` shows `resident.weight: "heavy"`; `GET /api/agents` shows it on the lane
3. `corpus queue claim` (or read the event) — payload carries the weight
4. Designate without a weight — `null`
5. Stop the server, confirm the port is free

## E2E Verification Log

**Implemented on: opus.** Verified 2026-08-19 against a real `corpus server` process on port
**8891**, in a throwaway workspace created by `corpus init` at
`…/scratchpad/ws-server-a`. Never the dev repo, never 8765 or 5173.

### 1. Designate with a weight

```
POST /api/threads/th_mip2tbwz/resident  {"name":"researcher","weight":"heavy"}
→ 200 {"thread":{…,"resident":{"name":"researcher","docId":"doc_agentdef9aac2cc9","weight":"heavy"}},"warnings":[]}
```

Reported on every surface the issue names:

```
GET /api/threads/th_mip2tbwz    → resident {"name":"researcher","docId":"doc_agentdef9aac2cc9","weight":"heavy"}
POST .../resident (thread summary) → same object
GET /api/agents                 → lane th_mip2tbwz, resident {"name":"researcher","docId":"doc_agentdef9aac2cc9","weight":"heavy"}
```

### 2. The file is the source of truth

`data/threads/th_mip2tbwz.md`, one key beside `name` and `docId`:

```yaml
resident:
  name: researcher
  docId: doc_agentdef9aac2cc9
  weight: heavy
```

Committed as one act: `git log` → `resident designate: researcher on let us plan the migration
(th_mip2tbwz) by user`, author `user`.

### 3. The event payload carries it

The pending event file, read off disk:

```
resident.designated | lane orchestrator |
  {"threadId":"th_mip2tbwz","resident":{"name":"researcher","docId":"doc_agentdef9aac2cc9","weight":"heavy"}}
```

Built by the contract's `ResidentDesignatedPayloadSchema.parse`, so a field added to `Resident`
cannot be dropped here silently again.

### 4. Omitting the weight

```
POST /api/threads/th_wc3jrqbg/resident  {"name":"researcher"}
GET  /api/threads/th_wc3jrqbg → resident {"name":"researcher","docId":"doc_agentdef9aac2cc9","weight":null}
grep weight data/threads/th_wc3jrqbg.md → no match
```

Absence on disk, `null` on the wire — one spelling each, and no `weight: null` is ever written.

### 5. A general resident at a stated weight

```
POST /api/threads/th_tyywzmgk/resident  {"weight":"heavy"}
→ resident {"name":null,"docId":null,"weight":"heavy"}
```

Orthogonal to the profile pair, as §7's rider requires.

### 6. Projection

`SCHEMA_VERSION` 18 → 19; `.corpus/cache.db` reports `{ value: '19' }` and the new column:

```
th_wc3jrqbg  designated=1  name=researcher  weight=null
th_tyywzmgk  designated=1  name=null        weight=heavy
```

`corpus db doctor` → `projection is clean — 20 documents from 20 files (8ms)`.

### 7. Release removes the key with the block

`DELETE .../resident` leaves no `resident:` key at all, `resident_weight` NULL, and
`GET /api/threads/{id}` reports `resident: null`.

### Falsification

Deleted the weight spread in `core/resident.ts`'s `residentToStored` (so the designation writes
`{name, docId}` and drops the level). **9 tests went red** across `resident.test.ts` and
`roster.test.ts` — including *"stores the level and reports it on the thread, the summary and the
roster"*, *"writes and announces when only the weight changes"* and *"reports the weight a lane
was designated at"*. Restored, green again.

### Checks

- `node_modules/.bin/tsc --noEmit` in `apps/server` — clean
- `eslint apps/server/src --max-warnings 0` — clean; `prettier --check` — clean
- `vitest run apps/server` — **193 files, 4306 tests, all passing**
- Server stopped; `lsof -iTCP:8891` → port free

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-129]` prefix
