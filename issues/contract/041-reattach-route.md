# [CONTRACT-041] A thread has no way to be re-attached to a range a person chose

## Domain

contract

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: SERVER-072, UI-086

## Spec References

- SPEC.md §6 Anchoring
- SPEC.md §9.2 — the route inventory

## Summary

Phase B of SERVER-059's chosen route needs a door that does not exist. Today a
thread's anchor is written at creation and rewritten only by reconciliation,
which runs on save and has the diff. There is no way for a **person's decision**
to correct a selector.

## Acceptance Criteria

- [x] A route that re-attaches an existing thread to a range the caller names —
      `POST /api/threads/{id}/reattach`
      (`packages/contract/src/routes/thread-reattach.ts`), a sibling of
      `resolve`/`reopen`/`seen`, keyed by the **thread** (which knows its own
      parent, so the parent cannot be named wrongly)
- [x] The request carries the **range**, not a candidate index or a score.
      `ReattachThreadRequest` is `{range: {start, end}, expectedText}` and
      nothing else; `range` is in `ResolvedAnchor.range`'s own coordinate space,
      so a range read from `GET /api/docs/{id}` goes straight back. A candidate
      index is not merely unused — CONTRACT-017 strictness makes sending one a
      `400` naming the key (`Unrecognized key: "candidate"`, E2E below), and the
      generated client rejects it at compile time
      (`thread-reattach.test.ts` → "rejects a wrong-shaped body at compile
      time"). Proven non-vacuously against four byte-identical parallel siblings:
      three requests differing **only** in their offsets each land on their own
      line
- [x] The server recomputes the selector from the document's bytes. The request
      has no selector field to store, by construction; the route's description
      and `schemas/reattach.ts` both state that `expectedText` is a guard that is
      never written, exactly as `prefix`/`suffix` are on `POST /api/threads`
      (SERVER-071). The mounted-app test asserts the returned selector's
      `prefix + exact + suffix` occurs exactly once **in the fixture's bytes**,
      which is what makes the repaired anchor resolve on rung 1
- [x] A range that no longer exists, or that overlaps another thread's text, is
      refused with a distinguishable status. `409` in all three refusal cases
      with a machine-readable `reason` — `range-changed`, `range-overlaps`,
      `not-anchored` — carried by `ReattachConflictError`, a **narrowing** of
      `ConflictError` in the shape `LockConflictError` already established, so
      `ERROR_CODES` does not grow and no consumer that switches on `code` grows
      a branch (`isApiError` still parses it; asserted). Distinguishable from
      each other, not only from success
- [x] It is explicit that this route is **person-initiated**. Decided **no, the
      agent may not call it**; reasoning and the held SPEC line are under
      "Decisions" below. The contract says so: `403` is declared, the route's
      description carries the rule and the reason, and the acting party still
      travels and still becomes the git author
- [x] `openapi.json` and the typed client regenerated, not hand-edited — via
      `npm run generate -w packages/contract`; idempotence and hand-edit
      detection are both in the E2E log

## Technical Design

### Files to Create/Modify

- `packages/contract/src/routes/` and `packages/contract/src/schemas/`, plus
  regenerated artifacts.

### Notes

- **§9.2 will need a line for this route.** That inventory has needed one three
  times on this project, was caught by review twice, and pre-empted once. A SPEC
  edit needs user sign-off — draft it in this issue and hold it rather than
  applying it.
- Re-attaching is a mutation of an existing thread, so it inherits §4's
  "one action, one commit" — check whether it composes with CONTRACT-037's work
  rather than inventing a second commit shape.

## Testing Strategy

Contract tests over the happy path, the vanished range, the overlapping range,
and shape rejection; the OpenAPI drift check as usual.

## Decisions

### 1. May the agent call this? **No.** (`403` for `x-corpus-author: agent`)

Two independent reasons, either of which settles it:

1. **It would be the reverted mistake with an HTTP door in front of it.** The
   route's entire justification is SERVER-059's construction: the evidence that
   separates "this line was edited" from "this line was deleted and a sibling
   remains" **does not exist at read time**. An agent calling this supplies a
   judgment it provably cannot make, and the result is permanent and invisible —
   a repaired anchor is indistinguishable from a healthy one and `corpus doc
   check` reports nothing. §6 orders the outcomes explicitly: "a visible orphan
   beats a silent misattachment".
2. **The agent never needs it.** Every case where a machine *does* hold the
   evidence is an edit, and edits already reconcile on the save path with the
   diff in hand. There is no legitimate agent call left over — so the refusal
   costs the agent nothing it could otherwise do correctly.

Mechanism is the shipped one: `403` + `ForbiddenError`, the same as §9.2's other
user-only endpoints (document and turn deletion). Declared in the contract rather
than left to an actor check nobody wrote down, which is how it would quietly stop
being true. **If the user rules the other way**, the change is small and local:
drop `403` from the route's `responses`, delete the two paragraphs about it from
the description, and delete the two `who may ask for a repair` tests.

### 2. §4's "one action, one commit" — it composes, and needs nothing new

Checked rather than assumed. **CONTRACT-037 is still `todo`**, and it is about
*several documents in one act* (the board's bulk archive). A re-attach is one
person, one thread, one act — and it writes exactly **one** file: the parent's
`anchors` map. The thread document is not rewritten (its `anchor` id does not
change), so this is the ordinary single-mutation shape `resolve`, `reopen` and
`thread create` already have, and inventing a batch envelope for it would be the
"second commit shape" the issue warns against. The route's description states
"One action, one commit" so that a server implementation which split it is
visibly wrong.

### 3. Why a guard field rather than a document revision

`expectedText` exists because a bare offset pair is a coordinate into a **live**
document: the agent may save between the person seeing the candidate sites and
choosing one, and stale offsets designate today's bytes silently and wrongly.
The rejected alternative was a whole-document version token — it would refuse a
repair because an unrelated paragraph moved, which on a corpus an agent is
actively editing means the person's correction fails for a reason they cannot
see. The guard is scoped to exactly the text the decision was about.

Its length is required to equal `end - start`, checked by a `.refine()` at
validation time, so an incoherent body is a `400` naming the field rather than a
state check that would blame the document for the caller's arithmetic. The
residual is stated in the code rather than hidden: an edit that shifts the range
and leaves byte-identical text at the new offsets passes — and attaches the
thread to text the person chose, character for character, which is the one case
where not distinguishing is harmless.

### 4. Scope: a repair, not a re-scoping

A thread with `anchor: null` (standalone, or a whole-document comment) is refused
with `not-anchored`. Giving one an anchor changes the *scope* of somebody's
comment, which is a different act with different evidence. Conversely a thread
that **already resolves** may be re-attached, which moves it: a misattached
anchor is exactly as wrong as a detached one, and refusing would leave
delete-and-recreate — losing the conversation — as the only correction.

## SPEC amendments — SIGNED 2026-08-08 and APPLIED

Two, both for §9.2. Signed by the user on 2026-08-08 and applied to SPEC.md by
the orchestrator, verbatim as drafted below; `routes/inventory.ts`'s docblock was
updated to stop describing them as pending. This package never edits SPEC.md.

**Amendment 1 — a new bullet, placed immediately after the
`resolve` · `reopen` · `seen` · `DELETE …/turns/:ts` bullet:**

> - `POST /api/threads/:id/reattach` — **user-only**: re-attaches an anchored
>   thread to a range of its parent's current body that **a person chose**. The
>   repair §6 has no other route to: reconciliation only ever carries an anchor
>   forward or orphans it, so a selector that never byte-matched stays detached
>   for the life of the document, and no reader can decide where it belongs —
>   deleting a line from a parallel list and renaming that line while deleting
>   its sibling produce the same after-state and demand opposite answers. The
>   request names the **range** (in the coordinate space `GET /api/docs/:id`
>   reports) plus the text the caller saw there; the server stores neither —
>   it reads the selector off the document's own bytes, exactly as thread
>   creation does. A range whose bytes are no longer what the caller saw, a range
>   overlapping another thread's anchored text (§6: two threads on disjoint text
>   never claim overlapping text), and a thread with no anchor to repair are each
>   refused with `409` and a distinguishable reason. One action, one commit (§4),
>   authored by the acting party.

**Amendment 2 — one clause widened.** §9.2 currently reads:

> Every mutating request carries the **acting party** (`user` or `agent`) — it
> becomes the git author (§4), and the user-only endpoints (deletion) reject
> agent actors.

Proposed:

> Every mutating request carries the **acting party** (`user` or `agent`) — it
> becomes the git author (§4), and the user-only endpoints (deletion, and
> re-attaching a thread) reject agent actors.

Amendment 2 is what makes the `403` a spec rule rather than a contract opinion;
the derivation is also recorded in `routes/inventory.ts`'s docblock so the gap
reads as a pending amendment rather than an undocumented route.

## E2E Verification Log

**Model: Opus 5 (1M context).** No server implementation exists yet
(SERVER-072), so "real interfaces" here means the three this package owns: the
**generated typed client** over HTTP, the **published document**, and the
**generation pipeline**.

### 1. The generated client against a mounted app

A throwaway script (gitignored `build/`, deleted afterwards) built an
`OpenAPIHono` from `contractRoutes.reattachThread` — the published definition,
not a copy — served it through the **real** `createCorpusClient` from
`@corpus/contract/client` with an injected transport, and called
`client.api.POST("/api/threads/{id}/reattach", …)`. The fixture is four
byte-identical parallel list items, the shape SERVER-055's tests were shape-lucky
on with two:

```
Q1: 200 range={"start":14,"end":44}  sentRange={"start":14,"end":44}  equal=true orphaned=false exact="Review the Q1 report by Friday" prefixFromFile=true rung1Unique=true
Q2: 200 range={"start":47,"end":77}  sentRange={"start":47,"end":77}  equal=true orphaned=false exact="Review the Q2 report by Friday" prefixFromFile=true rung1Unique=true
Q3: 200 range={"start":80,"end":110} sentRange={"start":80,"end":110} equal=true orphaned=false exact="Review the Q3 report by Friday" prefixFromFile=true rung1Unique=true
stale range:             409 {"code":"conflict","message":"moved under you","reason":"range-changed"}
beyond the body:         409 {"code":"conflict","message":"moved under you","reason":"range-changed"}
overlaps another thread: 409 {"code":"conflict","message":"taken","reason":"range-overlaps"}
no anchor to repair:     409 {"code":"conflict","message":"no anchor","reason":"not-anchored"}
agent actor:             403 {"code":"forbidden","message":"person-initiated only"}
empty range:             400 issues=[json.range.end, json.expectedText]
length mismatch:         400 issues=[json.expectedText]
candidate index:         400 issues=[{"path":"json","message":"Unrecognized key: \"candidate\""}]
```

`equal=true` on all three is the acceptance criterion made observable: three
requests that differ **only** in their offsets each land on their own line, where
a candidate index or a similarity score could not tell them apart at all.
`rung1Unique=true` means the returned `prefix + exact + suffix` occurs exactly
once in the fixture's bytes — the repaired anchor resolves on rung 1, with no
fuzzy rung, which is SERVER-072's third criterion made checkable in advance.

### 2. Generation is idempotent, and a hand edit is detected

```
npm run generate -w packages/contract   (twice)
2072da6b7924c990085ba7f468b2e630e5184a5be9c3a726bab4d1eb8b925588  openapi.json
e9afe27d63f1095b904e0db85de65fab15a5171e3def5c6ccba58639e25be70d  src/client/schema.generated.ts
→ byte-identical across runs
```

Then a deliberate hand edit (`summary: "HAND EDITED"` written straight into
`openapi.json`) and a probe comparing the file against `buildContractArtifacts()`:

```
--- with a hand-edited openapi.json ---
openapi.json matches generation: false
client types match generation: true
--- after npm run generate ---
openapi.json matches generation: true
client types match generation: true
```

Restored byte-for-byte — the sha above is unchanged. `scripts/check-generated-artifacts.ts`
also fires against `HEAD` as expected while the artifacts are uncommitted; CI's
copy of that check is the gate (INFRA-025 moved it out of pre-push).

### 3. Checks

- `VITEST_MAX_THREADS=4 npx vitest run packages/contract` — **57 files, 2148
  passed, 0 failed** (29 of them new, in `routes/thread-reattach.test.ts`)
- `npm run build` clean; `npm run typecheck` across **all** workspaces clean —
  the `BodyRangeSchema` extraction changes `ResolvedAnchor.range`'s description
  but not its inferred type, and no consumer pins that prose (grepped)
- eslint and prettier clean over `packages/contract`

### 4. What was pinned from the other side

Three repo-wide sweeps had to be told about the new surface, each of which would
otherwise have caught it — which is the point of them:

- `openapi.test.ts` §14 carriers: `ReattachThreadResponse` added, because a
  re-attach rewrites the parent's frontmatter and auto-commits it, so a rejected
  hook is exactly as reachable here as on a create
- the request-body census: 16 → **17**, and the mandatory/omittable partition
  gained `"POST /api/threads/{id}/reattach": true`
- `routes/index.test.ts`'s stub app mounts the route, so the
  mounted-set-equals-inventory assertion stays honest

### 5. Not verified here, deliberately

The **server behaviour** — that the selector really is recomputed, that the
commit is one commit, that the projection invalidates — is SERVER-072's, and
this issue declares the contract it must satisfy. The handler in the tests is not
a double for it: it is the demonstration that the declared request carries
*enough* to decide every refusal, which is the claim this issue makes about the
shape.

## Completion Checklist (domain agent)

- [x] Tests written and passing (29 new in `routes/thread-reattach.test.ts`;
      three existing sweeps in `openapi.test.ts` / `routes/index.test.ts`
      extended to cover the new surface)
- [x] `/lint` passes (eslint + prettier + tsc across all workspaces)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
