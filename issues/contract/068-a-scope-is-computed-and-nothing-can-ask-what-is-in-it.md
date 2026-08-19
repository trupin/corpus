# [CONTRACT-068] A scope is computed, and nothing can ask what is in it

## Domain

contract

## Status

done

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Blocks: UI-125
- Related: SERVER-111 (which computes scope at enqueue time)

## Spec References

- SPEC.md **§7** — a resident owns its thread's whole **scope**: the thread, its
  subthreads, and every artifact whose provenance walks back to it
- SPEC.md **§7** — membership is **computed, never stored**; nothing carries a
  scope marker
- SPEC.md **§9.2** — the HTTP API

## Summary

Requested by the user, 2026-08-19: *"There's nowhere I can see the list of active
agents and what is their scope. I want… the designated agents as well as what
documents / threads are attached to their scope."*

The roster half exists: `GET /api/agents` lists designated lanes, and
`corpus agents` prints them. **The scope half does not exist at any layer.**

§7 makes membership computed rather than stored — nothing carries a marker, and
it is derived by walking `origin` and `parent`. The server does this at **enqueue
time**, for one artifact, to decide which lane an event belongs to
(`apps/server/src/queue/scope.ts`). Nothing walks the other direction: *given a
lane, what is in it?*

So the question the user is asking has no answer to return.

## Why this is the hard half of UI-125

The console tab is a view. This is the thing it would view, and it does not
exist. Filing them together would hide that.

**And the direction matters.** The existing walk is cheap because it climbs from
one artifact to its lane — bounded by the depth of the graph. The inverse is a
search over every document and thread whose provenance *might* reach a given
thread, which is a different cost and a different implementation.

## What to decide

1. **Is it a query or a projection?** Computing it per request keeps §7's
   "computed, never stored" literally true. A projected membership table would be
   fast and would be the stored marker §7 forbids — unless it is understood as a
   cache that `db rebuild` reconstructs, which is what the projection already is
   for everything else
2. **What does it return?** Ids and titles, or full rows? §7's retrieval
   discipline says one frugal line per hit and never a body, and a scope listing
   should follow it
3. **Is it bounded?** A long-lived conversation's scope grows without limit. A
   listing with no bound is the enumeration §7 forbids the agent from doing
4. **Does the agent get it too, or only the board?** A resident asking "what do I
   own" is a reasonable question, and it is the same endpoint

## Decided by the orchestrator, 2026-08-19

1. **A query, not a projection table** — computed per request with `walkScope`, so §7 stays literally true. SERVER-130 measures the cost and records it.
2. **One frugal line per hit**: `{id, kind: "thread" | "doc", title, status, via: "origin" | "parent" | "self"}` — never a body. The thread itself is first with `via: "self"`.
3. **Bounded**: a fixed page size stated in the description (200), a `truncated: boolean`, no cursor in this release. The bound exists so a scope cannot be an enumeration, not to make paging a feature.
4. **The agent gets it too** — same endpoint, reached via CLI-054. It answers *"what do I own"*, and it is no sweep: it is the resident's own lane.
5. **Route**: `GET /api/threads/{id}/scope`. A thread with no resident is refused with a `409` whose message says the orchestrator's lane is not a scope.

## Acceptance Criteria

- [x] Given a designated thread, the API answers what is in its scope
- [x] The answer is derived by the **same walk** the queue routes with, not a
      second implementation — `scripts/mention-offer-parity.test.ts` is the
      precedent for what happens when one rule gets two implementations
- [x] It is bounded, and the bound is stated in the description
- [x] §7's "computed, never stored" is either still literally true, or the record
      says why a cache is consistent with it and `db rebuild` reconstructs it
- [x] `openapi.json` and `schema.generated.ts` regenerated, never hand-edited

## Technical Design

### Files to Create/Modify

- `packages/contract/src/routes/` — the new route
- `packages/contract/src/schemas/` — the response
- regenerated artifacts

### Key Implementation Details

**Read `apps/server/src/queue/scope.ts` and `packages/kit/src/recipient/scopeWalk.ts`
before designing the response.** Those two are one walk with one seam, and their
docblock records what happened when they were two: *"A composer said 'Orchestrator
will answer' about a conversation the server routed to Ana, a person pressed the
row they had just read, and Ana never heard about the conversation on the draft
she wrote."*

Whatever this returns must come from that same walk.

### Edge Cases

- A thread with no resident — the orchestrator's lane is not a scope
- An artifact reachable by both `origin` and `parent` to different scopes; §7
  claims at most one scope and SHARED-044 records that the four clauses do not
  guarantee it
- A scope containing an archived document
- A very large scope

## Testing Strategy

Parity with the enqueue-time walk over a derived fixture, in the shape
`scripts/mention-offer-parity.test.ts` uses — a hand-written fixture tests the
cases its author imagined.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Designate a resident; create a subthread and a document written from it
3. Ask for the scope; confirm it holds exactly what the queue would route there
4. Confirm an unrelated document is absent
5. Stop the server; confirm the port is free

## E2E Verification Log

**Implemented on: fable** (as recommended).

**What changed** (all under `packages/contract/`):

- `src/schemas/scope-listing.ts` (new) — `SCOPE_PAGE_SIZE = 200`, `SCOPE_MEMBER_KINDS = ["thread","doc"]`, `SCOPE_MEMBER_VIAS = ["self","parent","origin"]`, `ScopeMemberSchema` (`{id, kind, title, status, via}`, registered `ScopeMember`; `status` is `DocStatusSchema`, with the archived-is-still-in-scope rule on it; `via` documented as the edge `walkScope` took, `parent` winning when both edges exist), `ThreadScopeSchema` (`{thread, members (maxItems 200), truncated}`, registered `ThreadScope`; no cursor and **no `total`** — the module docblock records why: a total would cost the enumeration the bound forbids, unlike `InProgressSet.total` which is a directory count). Order stated: root first with `via: "self"`, then most recently updated first, so a truncated page holds the live end. Exported from `schemas/index.ts`.
- `src/routes/thread-scope.ts` (new) — `getThreadScope`: `GET /api/threads/{id}/scope`, no query parameters, responses `200 ThreadScope`, `400`, `401`, `404`, `409 ConflictError` ("the orchestrator's lane is not a scope", remedy named). Description states computed-per-request by the same `walkScope` the queue routes with, the 200-member bound, and the 409 rationale.
- `src/routes/index.ts` — registered after `getThreadContext` (docblock explains the position), re-exported. `src/routes/inventory.ts` — `GET /api/threads/{id}/scope` added after `…/context`, with its derivation paragraph and the note that §9.2 does not list it yet (pending amendment).
- Tests: `src/schemas/scope-listing.test.ts` (new: frugal line, closed enums, archived member, either id prefix, cap at 200 refused at 201, `truncated` required, no cursor/total), `src/routes/index.test.ts` (mounted stub: root first, vias `self/origin/parent`, archived row, 409 for `th_undesignated`, 400 for a `doc_` id), `src/client/index.test.ts` (typed client narrows `via`/`kind` to the enums; the 409 read is a **narrowing** `if (error?.code !== "conflict") throw`, so it fails to compile if the 409 were undeclared), `src/openapi.test.ts` (pin against the generated document: parameters `["id"]`, responses exactly `200/400/401/404/409`, `ThreadScope` properties/required, `members.maxItems === 200`, `items.$ref` → `ScopeMember`, `ScopeMember` enums `kind`, `via`, `status`, and the description phrases "the orchestrator's lane is not a scope", "by the same walk the queue routes with", "computed, never stored", "Bounded at 200 members, with no cursor and no total").
- `openapi.json` and `src/client/schema.generated.ts` regenerated, never hand-edited.

**Evidence**

1. Build/generate exit 0; `/usr/bin/grep -c "/api/threads/{id}/scope" packages/contract/openapi.json` ≥ 1; generation idempotent (identical `shasum` on a second run).
2. **Falsification**: commented out `getThreadScope,` in `contractRoutes`, ran `vitest run packages/contract/src/openapi.test.ts -t "lists a designated thread's scope"` alone → exit 1, `Error: No get /api/threads/{id}/scope in the generated document.` Restored; `grep -c "^  getThreadScope,$" src/routes/index.ts` → 1; pin green.
3. Scoped tests: 66 files / 2658 tests green (includes the inventory/registry parity tests, which would fail if the route and the inventory disagreed). `tsc --noEmit` (raw) → exit 0. eslint and prettier clean.
4. Root `npm run typecheck`: no consumer breaks because of this route (it is additive); the failures listed on CONTRACT-067 are all from `Resident.weight`.

**Deferred to the server (SERVER-130)**: the computation itself and its cost measurement; the parity test against the enqueue-time walk over a derived fixture belongs where both the projection and `walkScope` are reachable. **Pending spec amendment**: a §9.2 bullet for the route (recorded in `inventory.ts`).

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-068]` prefix
