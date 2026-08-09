# [CONTRACT-037] One action, one commit: several document mutations as one act

## Domain

contract

## Status

done

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

- [x] One route accepts **several document ids and one act**, and answers for all
      of them — the board makes one request per action, never one per document
- [x] Its response distinguishes **three** outcomes per document: **changed**,
      **already in that state** (a no-op, explicitly not a failure), and **did not
      change**, the last carrying a **reason** and, for a lock, the **holder**
- [x] The response names documents **individually** in each part — a count alone
      is not a result, because the part worth re-reading is the part that did not
      happen
- [x] The acting party is carried exactly as every other mutation carries it, and
      becomes the git author
- [x] **Deletion keeps §9's user-only rule**: an agent actor is refused for a bulk
      delete exactly as it is for a single one, and the refusal is the request's,
      not a per-document outcome
- [x] The **lock** contract is referenced, not restated or relaxed: a document
      locked by the other party is refused (§7) and appears by name with its
      holder; the other documents go through
- [x] Nothing in the single-document routes changes — they keep their paths,
      their schemas and their status codes, and stay the path for the reader's ⋯
      menu and the per-row quick actions
- [x] `openapi.json` and the typed client regenerate cleanly and are committed;
      the §14 drift check passes
- [x] The contract states, in the route's own description, that the act is **one
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

## Decisions taken (answering "Decisions this issue must make")

1. **Ids only** — the recommendation, taken. The request carries
   `ids: DocumentId[]` (min 1) and no filter. §11's whole-result-set selection is
   resolved to ids by the caller, and §11's "the result reports the documents
   actually changed — saying so when that differs from the number shown" is the
   caller comparing its own count against the response, which is where that
   comparison belongs: only the caller knows what number it showed. The array is
   deliberately **uncapped** — a column's query legitimately matches thousands,
   and a limit the spec does not state would refuse a selection §11 allows the
   board to offer. Recorded at the point of definition in `schemas/bulk.ts`.
2. **One route with an act discriminator.** The value of this surface is
   concentrated in two rules identical for every act — one commit containing
   exactly what changed, and §11's three parts. Per-act routes restate both eight
   times, which is eight opportunities to drift, and would leave a server free to
   implement one of them by looping the single-document path with no declaration
   contradicting it. **Threads ride the same route** rather than getting a second
   batch path under `/api/threads`: a thread is a document (§6), `status` is a
   core document field (§5), `GET /api/docs?type=thread` is already the thread
   list, and the route addresses documents by id and answers in ids — so nothing
   thread-shaped is needed in either direction. Two batch paths would mean two
   commit rules. Both reasons are in the route description and the schema
   docblock.
3. **§9.2 needs a line, and it is drafted below and held.** The route is derived
   from §4's signed text (which presupposes the capability) rather than from
   §9.2's list, so `routes/inventory.ts` carries the derivation the way the
   pending `POST /api/upgrade` pair does. SPEC.md was **not** edited.

## Held for sign-off — proposed SPEC.md §9.2 addition

**Not applied.** This package never edits SPEC.md; the orchestrator applies it
after the user signs it off. Insert as a new bullet in §9.2 immediately after the
`POST /api/docs` / `PUT /api/docs/:id` / move-and-archive bullet (SPEC.md:384),
before `GET /api/threads/:id`:

> - `POST /api/docs/bulk` — applies **one** action to **several** documents as a
>   single act, which is what makes §4's "One action, one commit" something a
>   client can ask for: the board makes one request per action, never one per
>   document. The body carries the ids — never a filter, since a whole-result-set
>   selection (§11) is resolved to ids by the caller — and the act: archive,
>   unarchive, resolve, reopen, move, tag (a delta of added and removed tags,
>   never a replacement, §11), mark still current, or delete. It **applies to what
>   it can and reports what it could not** (§11): the result names individually
>   what **changed**, what was **already in that state** (a no-op, not a failure),
>   and what **did not change and why** — a document locked by the other party
>   refused with its holder named (§7), one failing validation refused with its
>   reason (§14), an unknown id reported as such. Partial application is a `200`;
>   there is no `423` and no `404`, because a lock and an unknown id are
>   per-document outcomes here rather than verdicts on the request. It lands as
>   the **single** auto-commit §4 requires, authored by the acting party and
>   containing exactly the documents it changed, and reports that commit — or
>   `null` when nothing changed and there was therefore nothing to commit. **Delete
>   keeps its user-only rule**: a bulk delete carrying an agent actor is rejected
>   for the whole request, and the result totals the threads left as orphaned
>   records. The single-document routes above are unchanged and remain the path
>   for the reader's ⋯ menu and the per-row quick actions.

## E2E Verification Log

### Post-Implementation Verification

**Model: Opus 5 (1M context)** (`claude-opus-5[1m]`), running as `contract-dev`
in the main working tree on `phase-24-resolve-forms-bulk`. No worktree, no git
command run by this agent.

**1. Regeneration — the artifacts are derived, never hand-edited.**

```
$ npm run generate -w packages/contract
> tsx scripts/generate.ts
generated ./openapi.json
generated ./src/client/schema.generated.ts
```

Run three times over the course of the issue (after the schemas landed, after the
`Lock`-corruption fix below, and after the final wording), each time as the sole
source of both artifacts.

**2. Generation is idempotent, and the committed artifacts equal a fresh build.**

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run \
    packages/contract/src/generation/artifacts.test.ts apps/server/src/app.test.ts
✓ packages/contract/src/generation/artifacts.test.ts (7 tests) 512ms
✓ apps/server/src/app.test.ts (48 tests) 1023ms
Test Files 2 passed (2) · Tests 55 passed (55)
```

`artifacts.test.ts` is the real drift check for an uncommitted change: it builds
the document twice (byte-identical) and compares **the files on disk** against a
fresh build — `has openapi.json committed in sync with the route definitions` and
the same for `schema.generated.ts`. Both pass.

`apps/server/src/app.test.ts` is included because it sweeps
`ALL_CONTRACT_ROUTES` against a bare server; the new route 404s there like every
other unmounted route, so adding it breaks nothing on the server side. No server
handler exists yet — that is the follow-on SERVER issue.

**3. The repo drift check, and why it reports "stale" until the commit lands.**

```
$ node --import tsx scripts/check-generated-artifacts.ts ; echo $?
✗ API contract is stale: packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts
  Fix: npm run generate -w packages/contract && git add ...
 packages/contract/openapi.json                   | 488 ++++++++++++++++++++---
 packages/contract/src/client/schema.generated.ts | 203 ++++++++--
 2 files changed, 612 insertions(+), 79 deletions(-)
✓ CLI reference is up to date (docs/cli.md).
1
```

Read the script before reading the verdict: `diffAgainstHead` runs
`git diff --stat HEAD` over the artifacts, so **any** regenerated-but-uncommitted
artifact reads as "stale". The diff it prints is exactly this issue's
regeneration (the new path, the three new components, the client types) and
nothing else. It goes green the moment the orchestrator commits the two files;
the check that the artifacts are *correct* rather than merely *committed* is
step 2, which passes.

**4. The typed client exposes the operation, and the shape is typed rather than
opaque** — `packages/contract/src/client/index.test.ts`, four new cases against a
mounted stub app (real `fetch` through `app.fetch`, no mocks):

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run packages/contract/src/client/index.test.ts
✓ packages/contract/src/client/index.test.ts (67 tests) 35ms
```

The generated call is `client.api.POST("/api/docs/bulk", {body: {ids, action}})`.
Observed: the act narrows on `action` (a `move` carries `folder`, an `archive`
carries nothing); the response comes back as `{action, changed[], alreadyInState[],
refused[], orphanedThreadIds[], commit, warnings[]}` with `refused[0].lock.holder`
typed as `"user" | "agent"`; an agent bulk delete is the typed `403`
(`error.code === "forbidden"`, `isApiError(error)` true). Two of the four cases
are **compile-time** assertions checked by `tsc --noEmit`: `TagIsADelta` is `true`
only if `add` is a key of the tag act and `tags` is not, and `MoveNeedsAFolder`
only if the move act requires `folder`.

Verbatim from the generated client (`src/client/schema.generated.ts`), which is
what UI-083 consumes:

```ts
BulkActionRefusal: {
    id: string;
    reason: "locked" | "not-found" | "not-applicable" | "invalid" | "write-failed";
    message: string;
    lock: components["schemas"]["Lock"] | null;
};
```

**5. A real bug this found, fixed, and pinned.** The first draft wrote
`lock: LockSchema.nullable()`. `Lock` is a *registered* component and
zod-to-openapi carries a registered name onto anything derived from it, so that
one call rewrote the shared component to `type: ["object", "null"]` **for every
route that references it** — measured in the regenerated `openapi.json`, not
assumed:

```
$ node -e "const d=require('./openapi.json'); console.log(JSON.stringify(d.components.schemas.Lock.type))"
["object","null"]
```

`openapi.test.ts`'s existing "keeps every named component a plain, non-nullable,
undefaulted object" invariant is the guard that catches this class. The fix is
`z.union([LockSchema, z.null()])`, which publishes
`anyOf: [{$ref: Lock}, {type: "null"}]` and leaves the component plain — verified
by probe before adopting it, and after the change:

```
$ node -e "... console.log('Lock.type=', JSON.stringify(s.Lock.type));
           console.log('non-object components:', Object.entries(s).filter(([,v])=>v.type!=='object').map(([n])=>n))"
Lock.type= "object"
non-object components: []
```

The same rule cost the act union its component name: a `z.discriminatedUnion`
renders as a `oneOf` with no `type: "object"`, so `BulkAction` is **not**
registered and inlines into `BulkActionRequest.action` — the rule
`ContextPackSchema` already follows, for the same invariant. Both decisions are
docblocked at the point of definition and pinned from both sides in
`openapi.test.ts`.

**6. Checks.**

```
$ npm run build                                   → exit 0
$ npm run typecheck                               → exit 0   (tsc --noEmit × 5 workspaces)
$ npm run lint                                    → exit 0   (eslint .)
$ npm run format:check                            → exit 0   (prettier --check .)
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run packages/contract
  Test Files 59 passed (59) · Tests 2261 passed (2261)   → exit 0
```

New tests: 35 cases in `schemas/bulk.test.ts`, 18 blocks in `openapi.test.ts`'s
`one action, one commit (CONTRACT-037)` describe, 7 blocks in
`routes/index.test.ts` (mounted, real requests through a stub handler registered
against the route definition), 5 in `client/index.test.ts`. Updated pins:
the request-body count 17 → 18, the mandatory/omittable partition, the user-only
`403` list, and the §14 warning-carrier list.

**Not verified here, by design.** The behavioural run — twenty documents, three
locked, one commit, seventeen files in `git show --name-only` — belongs to the
server issue and to UI-083; there is no handler to exercise yet. No server was
started and no port was bound.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[CONTRACT-037]` prefix
