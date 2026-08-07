# [CONTRACT-037] One action, one commit: several document mutations as one act

## Domain

contract

## Status

todo

## Priority

P2 (nice-to-have)

## Model

opus — the rider settled the behaviour and §11 spells the result vocabulary. The
open shape decisions are named under "Decisions this issue must make"; escalate
rather than invent.

## Dependencies

- Depends on: SHARED-017 (signed 2026-08-05; amendments applied to SPEC.md)
- Blocks: UI-083
- Related: SERVER-side implementation follows this contract and is not filed yet
  — a change spanning contract and one consumer is two issues with a dependency,
  not one issue

## Spec References

- SPEC.md **§4**, "One action, one commit" (rider signed 2026-08-05) — the whole
  reason this issue exists: a bulk action "lands as a **single** auto-commit",
  contains "exactly the documents the action **changed**", "never folds into a
  preceding editing session's squashed commit, and no later save folds into it",
  and its message "names the action and the documents it changed"
- SPEC.md **§11**, "Selecting rows, and acting on the selection" — the actions, the
  three-part result, and "the history agrees with it (§4)"
- SPEC.md **§9.2** — the document mutation routes as they stand today; the acting
  party on every mutating request; deletion user-only
- SPEC.md **§7** — document locks: write paths refuse edits to a document locked
  by the other party, identifying the holder
- SPEC.md **§14** — every mutation validates before writing; a mutation may
  succeed and still carry warnings

## Summary

**SHARED-017 flagged this as its own precondition, and it is filed first for
exactly that reason.** Its final acceptance criterion reads: "Before the UI issue
is filed, Amendment 1 is checked against what the write path can actually promise
— if 'one action, one commit' needs a way to ask for several document mutations
as one act, that is a contract/server issue filed **first**, not something the
board approximates."

It does need one. Checked against the code, not assumed:

- **Every document mutation route takes a single `{id}`.** `createDoc`,
  `updateDoc`, `moveDoc`, `archiveDoc`, `unarchiveDoc`, `deleteDoc` — all of them
  are one document per request. Swept across every non-GET route in
  `packages/contract/src/routes/`, the only request body anywhere that accepts
  more than one document id is `POST /api/check`, which is **read-only**.
- **So a board with no batch route fires N requests**, and each one commits on its
  own. The auto-committer's fold decision (`amendTarget` in
  `apps/server/src/git/commit.ts`) keys on the **same `docId` and same actor**
  within a 30 s idle window, so twenty archives of twenty different documents can
  never fold: they are twenty commits, by construction.

That is precisely the outcome §4 now forbids. Archiving twenty documents must be
one commit, not twenty — so that reverting the action is one `git revert`, and so
that `git log` and the on-screen report say the same thing, which is the entire
point of the audit trail being git. **Without a way to ask the server for several
document mutations as one act, §4's newly-signed "One action, one commit" is a
promise the UI cannot keep** — and a board that fires twenty requests and hopes
the commits land the way the spec says is the shape SHARED-017 explicitly refused
to accept. This is why UI-083 depends on this issue rather than the other way
round.

The second half is the result. §11 requires a bulk action to apply to what it can
and report what it could not, **in three parts** — changed, already in that state,
and, listed apart from both, did not change and why. That vocabulary has to exist
on the wire before the board can render it: "already archived" is a no-op and not
a failure, and a locked document is refused with its holder named, exactly as a
single edit to it would be. A response that returned only a count would make the
board infer the parts, and inferring them is how a bulk action ends up reporting
success for work that did not happen.

## Acceptance Criteria

- [ ] One route accepts **several document ids and one act**, and answers for all
      of them — the board makes one request per action, never one per document
- [ ] Its response distinguishes **three** outcomes per document: **changed**,
      **already in that state** (a no-op, explicitly not a failure), and **did not
      change**, the last carrying a **reason** and, for a lock, the **holder**
- [ ] The response names documents **individually** in each part — a count alone
      is not a result, because the part worth re-reading is the part that did not
      happen
- [ ] The acting party is carried exactly as every other mutation carries it, and
      becomes the git author
- [ ] **Deletion keeps §9's user-only rule**: an agent actor is refused for a bulk
      delete exactly as it is for a single one, and the refusal is the request's,
      not a per-document outcome
- [ ] The **lock** contract is referenced, not restated or relaxed: a document
      locked by the other party is refused (§7) and appears by name with its
      holder; the other documents go through
- [ ] Nothing in the single-document routes changes — they keep their paths,
      their schemas and their status codes, and stay the path for the reader's ⋯
      menu and the per-row quick actions
- [ ] `openapi.json` and the typed client regenerate cleanly and are committed;
      the §14 drift check passes
- [ ] The contract states, in the route's own description, that the act is **one
      commit** — so a server implementation that loops the single-document path
      is visibly wrong rather than merely slower

## Technical Design

### Files to Create/Modify

- `packages/contract/src/routes/docs.ts` — the new route definition, beside the
  seven single-document ones (registration order in `routes/index.ts` is
  load-bearing; a batch path must not shadow `/api/docs/{id}`)
- `packages/contract/src/schemas/doc.ts` — the request (ids + the act) and the
  three-part result schema, registered as OpenAPI components like their
  single-document neighbours (`DocMutationResponse`, `UpdateDocResponse`,
  `DeleteDocResult`)
- `packages/contract/src/routes/index.ts` — registry entry
- `packages/contract/src/schemas/doc.test.ts`, `packages/contract/src/routes/index.test.ts`,
  `packages/contract/src/openapi.test.ts` — the shape, the registry membership,
  and any pinned counts
- `packages/contract/openapi.json`, `packages/contract/src/client/schema.generated.ts`
  — regenerated and committed

### Key Implementation Details

**The commit rule is the whole point, and it has two sides that both need
saying.** §4 requires that a bulk commit "never folds into a preceding editing
session's squashed commit, **and no later save folds into it**". Both directions
matter and they are different mechanisms: the first is `squash: false` on the
bulk plan (today only `skills/rollback.ts` and `locks/service.ts` opt out); the
second means the bulk commit must not become an amend target for a subsequent
save, which is what `endSquashSession(sha)` exists for. A bulk archive landing on
top of someone's autosave, or someone's next keystroke folding into a bulk
archive, would each erase the action from the history as an *act* — which is the
one thing §4 asked for. The contract cannot enforce this, but its description is
where the requirement is stated so the server issue cannot miss it.

**The commit contains exactly what changed.** A document the action could not
change leaves nothing in it, and a document that was already in the target state
contributes nothing either. So the three-part result and the commit's file list
are the same set computed once, not two answers that might disagree. §11 puts it
as "the history agrees with it (§4)"; concretely it means the response's
`changed` list and `git show --name-only` must match.

**Partial failure is the normal case, not the error path.** The route answers
`200` when some documents changed and some did not — it is not a `207`-shaped
puzzle and not a `4xx`. The reasons for that are SHARED-017's Decision 1 and
worth carrying: a locked document is routine (the agent takes locks while it
works), so an all-or-nothing rule fails the user's action for reasons that have
nothing to do with the other nineteen documents; and "refuse the whole set" over
twenty files is a guarantee the write path cannot actually give without either
checking everything first and racing anyone who edits one in between, or writing
some and rolling them back — a rollback that itself commits.

**Which acts.** §11 offers Archive, Unarchive, Resolve/Reopen, Move to a folder,
add or remove tags, mark still current, Delete, and "Ask the agent about these".
The last one needs **nothing here** — it creates one standalone thread whose
first turn references every selected document, through the existing
`POST /api/threads`, and it changes none of them (which is why §11 keeps it
available when some are locked). Note that "mark still current" and "add/remove
tags" have no dedicated single-document route today either: both are keys of
`UpdateDocRequestSchema` on `PUT /api/docs/{id}`. **Tagging is add-or-remove, never
replace** — §11 is explicit — so the batch shape must express a delta and must not
be a "set the tags to this" that quietly flattens twenty different tag sets.

**Resolve/Reopen acts on threads**, whose routes live on `/api/threads/:id`
rather than `/api/docs/:id`. §11 offers an action only when it applies to every
selected item, so a selection is homogeneous by the time Resolve is offered — but
the route must still decide whether it covers thread status or whether threads get
their own batch path. Prefer one route over two if the act can be named uniformly;
say which, and why, in the description.

### Decisions this issue must make (escalate if genuinely ambiguous)

1. **Ids only, or a query too?** §11's "Selecting a whole result set is two
   distinct acts" lets a selection extend to *everything the column's query
   matches*, with "the count re-evaluated when the action runs". That could be a
   filter-shaped request body, or the UI could resolve the query to ids and send
   those. _Recommendation: **ids only** for v1._ A filter-shaped mutation is a far
   larger promise (the server acting on a set nobody enumerated), §11 already
   forbids bulk delete on a whole-result-set selection for exactly that reason,
   and "the result reports the documents actually changed — saying so when that
   differs from the number shown" is satisfiable by the UI comparing its own
   count against the response. If the reviewer disagrees, the cost is a second
   request shape and a re-evaluation semantics to specify.
2. **One route with an act discriminator, or one route per act?** A discriminated
   union keeps the commit rule and the three-part result in one place, which is
   where the value is; per-act routes mirror the existing single-document surface
   more closely. Either is defensible — pick one and state the reason in the
   route description, because the next person will ask.
3. **Does §9.2 need a line?** §9.2 enumerates the API surface, and this adds to
   it. §4's signed text presupposes the capability, so this is implementing signed
   behaviour rather than extending it — but if the reviewer judges the route list
   should name it, that is a one-line orchestrator-owned SPEC addition, not a
   rider, and it happens **before** the code lands.

### Edge Cases

- **An empty id list** — reject it. An act on nothing is a caller bug, and
  answering `200` with three empty lists would let a broken board look healthy.
- **The same id twice** in one request — collapse, do not act twice.
- **An unknown id** — a "did not change" entry with that reason, not a `404` for
  the whole request; the other nineteen documents are not the caller's mistake.
- **Every document already in the target state** — a legal, successful act that
  changes nothing and therefore **makes no commit at all**. §4 says the commit
  contains exactly what changed, and a commit containing nothing is not one.
- **Every document refused** — still `200` with an empty `changed` list; the
  board reduces the selection to all of them and the user retries.
- **Mixed lock holders** — each named individually with its own holder.
- A document that fails **§14** validation — refused with its reason, in the same
  part as a lock refusal but with a different reason, per §11.
- **Bulk delete's orphaned threads** — `DeleteDocResult` already reports the
  threads a single delete orphans; the batch result must total them, because §11's
  confirm has to say "how many threads will be left as orphaned records" *before*
  the act.

## Testing Strategy

Unit tests in `packages/contract`:

- the request schema: empty list rejected, duplicate ids, unknown act
- the result schema: all three parts present and independently populated; a
  reason required on every "did not change" entry; a holder present on a lock
  reason
- tag delta expressible as add and remove, and **not** expressible as replace
- the route is registered, its path does not shadow `/api/docs/{id}`, and the
  actor header is required
- `openapi.test.ts` — the new components appear, counts updated

The behaviour these shapes exist for (one commit, correct membership) is the
server issue's to test against real git; this issue tests that the shape can
express it and cannot express the wrong thing.

## E2E Verification Plan

### Verification Steps

1. `corpus init` a scratch workspace on a non-default port; start the real
   server; `npm run build` and confirm the §14 drift check passes on the
   regenerated `openapi.json`.
2. Confirm the generated typed client exposes the new operation and that the
   three-part result is typed — the drift between server and clients being a type
   error is the contract's own promise (§9.3).
3. The full behavioural run (twenty documents, three locked, one commit,
   seventeen files) belongs to the server issue and to UI-083; this issue's E2E is
   that the contract regenerates and the client compiles against it.

## E2E Verification Log

### Post-Implementation Verification

_[Agent fills: application restarted, exact commands, observed output,
confirmation the feature works. State which model you ran on.]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[CONTRACT-037]` prefix
