# [CONTRACT-048] The bulk request cannot express a staged set

## Domain

contract

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-032 (signed 2026-08-09)
- Blocks: SERVER-087, UI-083

## Spec References

- SPEC.md **§11** — bulk mode, per-row staged actions, and Save
- SPEC.md **§4** — "A Save carrying a mix of verbs is still one act and still one
  commit"

## Summary

CONTRACT-037 shipped `POST /api/docs/bulk` as `{ids, action}` — **one verb over
many ids**. SHARED-032, signed 2026-08-09, makes each row carry its own staged
action, so archiving three documents and resolving two is one pass. That set
cannot be said in the shipped shape.

The user chose **pairs in one request** at sign-off, over the two alternatives:
grouping client-side into one request per verb is several commits, which is
exactly what §4 forbids and what this route was built to prevent; deferring the
question to UI-083 risks discovering the shape is wrong with the UI already
written against it.

## Acceptance Criteria

- [x] The request carries a list of `{id, action}` pairs — one act, one commit,
      whatever mix of verbs it holds
- [x] A whole-result-set selection is expressible: SHARED-032 stages it as a
      **single entry** carrying one action for a query rather than for enumerated
      ids, and the shape must say that without a second endpoint
- [x] The response is unchanged in kind — the three parts still partition the
      **requested** ids, which PR #37 pinned in prose and two tests
- [x] An id named twice with different actions is refused, and the refusal says
      so. Last-write-wins here is a silent choice about someone's documents
- [x] `openapi.json` and the typed client regenerated, never hand-edited
- [x] The §9.2 bullet is **redrafted before it is ever signed** — the held draft
      in `issues/contract/037-one-action-one-commit.md` describes the old shape.
      Draft it here and hold it; SPEC.md changes need the user's signature

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/bulk.ts`, `routes/bulk.ts`, regenerated
  artifacts.

### Notes

- Read CONTRACT-037's docblocks first: the reasoning for one route with an act
  discriminator, for ids rather than a filter, and for `commit` being one
  nullable sha is unchanged by this and should not be re-derived.
- `BulkAction` stays the discriminated union; what changes is what it is attached
  to. Keep it inline rather than registered — a `oneOf` has no `type: "object"`
  and the named-component invariant catches it.

## Testing Strategy

Round-trip a mixed set; a single-verb set (the old shape's case) still
expressible; a duplicate id with conflicting actions refused; the query-selection
entry; OpenAPI drift.

## Decisions taken

1. **Pairs in a list, and the whole-result-set entry as a separate singular
   field.** The request is
   `{entries: {id, action}[], wholeResultSet?: {query, action}}`. The alternative
   — one `entries` list holding a discriminated union of `{kind: "id", …}` and
   `{kind: "query", …}` — was rejected because two rules would then have to be
   *remembered* rather than being structural: §11's "a whole-result-set selection
   stages as a **single** entry" (singular field ⇒ at most one, unspellable
   otherwise) and §11's "a whole-result-set selection cannot be deleted"
   (`wholeResultSet.action` is the act union **minus `delete`**, so the
   restriction is a type error in the generated client rather than a `400`
   somebody discovers after confirming on 412 documents).
2. **The query is `ViewQuery`, the same flat parameter map a `type: view`
   document already stores** — not a new filter grammar. It is what the board
   holds in memory and what the server already compiles into `GET /api/docs`, so
   "everything the query matches" means the same thing on both sides. One
   difference from the stored form, stated in the schema: a stored view's unknown
   key degrades in the client, but here the query decides what gets **written**,
   so an unrecognised key or value is a `400` for the whole request.
   CONTRACT-037's "ids, never a filter" is therefore **narrowed, not reversed**:
   a filter still cannot stand in for enumerated rows, and the one thing it may
   express is the one selection §11 says has no enumerated form.
3. **A repeated id is a `400`, not a collapse.** CONTRACT-037 collapsed repeats
   because a repeated member of an `ids` **set** carried no information. A
   repeated staged **row** carries a verb that may contradict its twin, so the
   tolerance is deliberately gone. The message distinguishes the two cases:
   "staged twice with different actions (`archive` and `delete`)" versus "staged
   twice". `400` rather than `409` by the repo's rule — correcting the body fixes
   it, so the caller is not sent in circles.
4. **The whole-result-set entry excludes the ids `entries` names.** Defined as an
   exclusion rather than resolved as a precedence conflict, so no document is
   ever covered twice and the write path needs no tie-break at all. A row someone
   staged by hand keeps the verb they chose.
5. **The single top-level `action` echo is gone; the verb moved onto each named
   document.** Its stated purpose in CONTRACT-037 was that "a rendered report
   never has to be paired back to the call that produced it" — a mixed Save makes
   one verb for the whole result a lie, and for the documents a `wholeResultSet`
   entry covered the caller has no request row to pair against at all. So
   `changed` and `alreadyInState` carry `{id, action}` (`BulkActionOutcome`) and
   `BulkActionRefusal` gains the same `action`. The three parts, their meanings,
   and the partition are otherwise untouched.

## Held for sign-off — proposed SPEC.md §9.2 addition (supersedes CONTRACT-037's draft)

**Not applied.** This package never edits SPEC.md; the orchestrator applies it
after the user signs it off. CONTRACT-037's held draft described the `{ids,
action}` shape and is **void** — a note to that effect is in its issue file.
Insert as a new bullet in §9.2 immediately after the `POST /api/docs` /
`PUT /api/docs/:id` / move-and-archive bullet, before the `GET /api/threads/:id`
bullet:

> - `POST /api/docs/bulk` — applies a column's **staged set** (§11) as a single
>   act, which is what makes §4's "One action, one commit" something a client can
>   ask for: the board makes one request per Save, never one per document and
>   never one per verb. The body carries the individually staged rows as
>   `{id, action}` **pairs** — each row its own action, so archiving three
>   documents and resolving two is one request and therefore one commit — plus,
>   optionally, §11's whole-result-set selection as a **single entry** carrying
>   one action for the column's query rather than for enumerated ids, its count
>   re-evaluated when the Save runs and covering everything the query matches
>   except the ids named individually. The acts are archive, unarchive, resolve,
>   reopen, move, tag (a delta of added and removed tags, never a replacement,
>   §11), mark still current, and delete — `delete` on an enumerated row only,
>   since §11 forbids deleting a whole-result-set selection. A staged set that
>   names nothing, or that names one document twice, is refused for the whole
>   request naming the id and, where they differ, both acts: a row carries exactly
>   one staged action, and picking one silently would be a choice about someone's
>   documents. Otherwise it **applies to what it can and reports what it could
>   not** (§11): the result names individually what **changed**, what was
>   **already in that state** (a no-op, not a failure), and what **did not change
>   and why** — each with the act that applied to it, since a Save carries a mix —
>   a document locked by the other party refused with its holder named (§7), one
>   failing validation refused with its reason (§14), an unknown id reported as
>   such. Partial application is a `200`; there is no `423` and no `404`, because
>   a lock and an unknown id are per-document outcomes here rather than verdicts
>   on the request. It lands as the **single** auto-commit §4 requires, authored
>   by the acting party and containing exactly the documents it changed, and
>   reports that commit — or `null` when nothing changed and there was therefore
>   nothing to commit. **Delete keeps its user-only rule**: a staged set holding a
>   delete and carrying an agent actor is rejected for the whole request, and the
>   result totals the threads left as orphaned records. The single-document routes
>   above are unchanged and remain the path for the reader's ⋯ menu and the
>   per-row quick actions.

## E2E Verification Log

### Post-Implementation Verification

**Model: Opus 5 (1M context)** (`claude-opus-5[1m]`), running as `contract-dev`
in the main working tree on `phase-27-serializer-p0-stub-typing`. No worktree, no
git command run by this agent. No server started, no port bound (8765 and 5173
untouched).

**1. Regeneration — the artifacts are derived, never hand-edited.**

```
$ npm run build                          → exit 0
$ npm run generate -w packages/contract  → exit 0
> tsx scripts/generate.ts
generated ./openapi.json
generated ./src/client/schema.generated.ts
```

**2. Generation is idempotent, and the committed artifacts equal a fresh build.**

```
$ cp openapi.json /tmp/c48-a.json && cp src/client/schema.generated.ts /tmp/c48-a.ts
$ npm run generate -w packages/contract   (second run) → exit 0
$ cmp /tmp/c48-a.json openapi.json                     → identical
$ cmp /tmp/c48-a.ts   src/client/schema.generated.ts   → identical

$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run \
    packages/contract/src/generation/artifacts.test.ts
✓ 7 tests passed                                       → exit 0
```

`artifacts.test.ts` is the real drift check for an uncommitted change: it builds
the document twice (byte-identical) and compares **the files on disk** against a
fresh build.

**3. The repo drift check, and why it reports "stale" until the commit lands.**

```
$ node --import tsx scripts/check-generated-artifacts.ts > /tmp/c48-drift.log 2>&1
$ echo $?
1
✗ API contract is stale: packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts
 packages/contract/openapi.json                   | 319 +++++++++++++++++++----
 packages/contract/src/client/schema.generated.ts | 111 ++++++--
 2 files changed, 357 insertions(+), 73 deletions(-)
✓ CLI reference is up to date (docs/cli.md).
```

`diffAgainstHead` runs `git diff --stat HEAD` over the artifacts, so **any**
regenerated-but-uncommitted artifact reads as "stale" (recorded in CONTRACT-037's
log for the same reason). The printed diff is exactly this issue's regeneration.
It goes green the moment the orchestrator commits the two files; the check that
the artifacts are *correct* rather than merely *committed* is step 2, which
passes. Exit code read from `$?` immediately after redirecting to a file, never
through a pipeline.

**4. The published shape — verbatim from `src/client/schema.generated.ts`, which
is what SERVER-087 and UI-083 consume.**

```ts
BulkActionRequest: {
    entries: components["schemas"]["BulkStagedEntry"][];
    wholeResultSet?: components["schemas"]["BulkWholeResultSetEntry"];
};
BulkStagedEntry: {
    id: string;
    action: { action: "archive" } | { action: "unarchive" } | { action: "resolve" }
          | { action: "reopen" } | { action: "move"; folder: string }
          | { action: "tag"; add?: string[]; remove?: string[] }
          | { action: "review" } | { action: "delete" };
};
BulkWholeResultSetEntry: {
    query: { [key: string]: string | number | boolean | (string | number | boolean)[] };
    action: /* the same union minus `delete` — seven members */;
};
BulkActionOutcome: {
    id: string;
    action: "archive" | "unarchive" | "resolve" | "reopen" | "move" | "tag" | "review" | "delete";
};
BulkActionRefusal: {
    id: string;
    action: "archive" | … | "delete";
    reason: "locked" | "not-found" | "not-applicable" | "invalid" | "write-failed";
    message: string;
    lock: components["schemas"]["Lock"] | null;
};
BulkActionResult: {
    changed: components["schemas"]["BulkActionOutcome"][];
    alreadyInState: components["schemas"]["BulkActionOutcome"][];
    refused: components["schemas"]["BulkActionRefusal"][];
    orphanedThreadIds: string[];
    commit: string | null;
    warnings: components["schemas"]["Warning"][];
};
```

Measured against the generated document rather than assumed:

```
$ node -e "const d=require('./openapi.json'), s=d.components.schemas;
           console.log(JSON.stringify(Object.entries(s).filter(([,v])=>v.type!=='object').map(([n])=>n)));
           console.log('Lock.type=', JSON.stringify(s.Lock.type));"
[]
Lock.type= "object"
```

The named-component invariant holds: no registered component is a non-object, and
`Lock` is untouched — the two new registered components (`BulkStagedEntry`,
`BulkWholeResultSetEntry`) are plain objects, and both act unions stay **inline**
(`BulkAction` and its query-side sibling are not registered, because a `oneOf`
has no `type: "object"`).

**5. The typed client against a mounted app** —
`packages/contract/src/client/index.test.ts`, real `fetch` through `app.fetch`
against the real route definitions, no mocks:

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run packages/contract/src/client/index.test.ts
✓ 71 tests passed                                      → exit 0
```

Observed: a five-row mixed Save (three `archive`, two `resolve`) travels as one
call and comes back with one sha; a `wholeResultSet` entry beside an enumerated
row reaches the handler and its resolved id comes back in `changed`; the refusal
carries `action` and a typed `lock.holder`; a staged set holding a `delete` from
the agent is the typed `403`. Five of the assertions are **compile-time**,
checked by `tsc --noEmit`: `TagIsADelta`, `MoveNeedsAFolder`,
`EveryRowCarriesAVerb`, `EnumeratedRowMayDelete`, and
`WholeResultSetMayNotDelete` — the last is §11's "a whole-result-set selection
cannot be deleted" as a type error rather than a runtime refusal.

**6. Real requests through the mounted routes** —
`packages/contract/src/routes/index.test.ts`, a stub handler registered against
the route definition so the validator actually runs:

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run packages/contract/src/routes/index.test.ts
✓ 99 tests passed                                      → exit 0
```

Including: `POST /api/docs/bulk` still routes to the bulk act rather than to a
document named `bulk`; a mixed staged set reaches the handler with each row's
verb intact and answers one sha; ten malformed bodies are `400` before any
handler runs — among them the **old** `{ids, action}` shape and a
`wholeResultSet` naming `delete`; a repeated id is a `400` whose body contains
the id and "staged twice with different actions"; an agent staged set holding a
`delete` **anywhere in the mix** is `403`.

**7. Checks.**

```
$ npm run build                                        → exit 0
$ ./node_modules/.bin/eslint packages/contract         → exit 0
$ ./node_modules/.bin/prettier --check "packages/contract/**/*.{ts,json}" → exit 0
$ cd packages/contract && tsc --noEmit                 → exit 0
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run packages/contract
  Test Files 59 passed (59) · Tests 2317 passed (2317) → exit 0
```

New/changed tests: `schemas/bulk.test.ts` rewritten (59 cases, was 35),
`openapi.test.ts`'s bulk describe extended (six new blocks, five rewritten),
`routes/index.test.ts` (four new blocks + stub handler restaged),
`client/index.test.ts` (four new blocks + stub handler restaged).

**8. `npm run typecheck` is red, and the red is SERVER-087's, by construction.**

```
$ npm run typecheck                                    → exit 2
apps/server/src/docs/bulk.ts(260,5)   TS2741  'action' missing in the refusal
apps/server/src/docs/bulk.ts(264,7)   TS2741  same
apps/server/src/docs/bulk.ts(267,7)   TS2741  same
apps/server/src/docs/bulk.ts(268,29)  TS2741  same
apps/server/src/docs/bulk.ts(275,3)   TS2741  same
apps/server/src/docs/bulk.ts(298,3)   TS2741  same
apps/server/src/docs/bulk.ts(470,11)  TS2339  'action' does not exist on the request
apps/server/src/docs/bulk.ts(477,32)  TS2339  'ids' does not exist on the request
apps/server/src/docs/bulk.ts(669,29)  TS2322  result shape
apps/server/src/docs/bulk.ts(695,3)   TS2322  result shape
apps/server/src/docs/write-routes.ts(102,24) TS2339  'action' on the result
apps/server/src/docs/bulk.test.ts(130,19) TS2339 · (145,69) · (154,29) · (510,71)
```

Twelve sites in three files, all in `apps/server/src/docs/`, and every one of them
is the consumer half this issue exists to force: SERVER-077 shipped a handler
against `{ids, action}`, and the whole point of CONTRACT-048 is that that shape
cannot express a mixed Save. This is the "drift between server and clients is a
type error" promise working (Architecture Decision 3), not a regression — but it
means **`CI / validate` stays red until SERVER-087 lands**, so the two must be
committed together or the phase PR will not go green. `apps/cli`, `packages/kit`,
`apps/ui` and `plugins/` reference none of these symbols (swept:
`grep -rl "applyBulkAction\|BulkAction\|docs/bulk"` hits only `apps/server`).

The one other `typecheck` failure —
`apps/ui/src/editor/markdown/serialize.ts(871,29)` and `(877,27)` — is the
concurrent ui-dev agent's work in `apps/ui/src/editor` and is not this issue's.

**Not verified here, by design.** The behavioural run — a mixed Save landing as
one commit, `git show --name-only` agreeing with `changed`, a whole-result-set
query re-evaluated at Save time — belongs to SERVER-087 and UI-083. This issue's
E2E is that the contract regenerates idempotently, the client compiles against
it, and the shape can express what §4 and §11 now require while refusing what
they forbid.

**Refused / not done, deliberately:**

- **SPEC.md was not edited.** The §9.2 bullet is redrafted above under "Held for
  sign-off" and needs the user's signature.
- **`apps/server` was not touched**, though it no longer typechecks. It is
  another domain and another issue (SERVER-087), and this agent's scope is
  `packages/contract`.
- **No git command was run.**

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier + `tsc --noEmit` **within
      `packages/contract`**; the repo-wide `typecheck` is red on `apps/server`,
      which is SERVER-087's half — see the E2E log, item 8)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
