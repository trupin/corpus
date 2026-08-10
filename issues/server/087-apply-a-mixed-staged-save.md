# [SERVER-087] Apply a mixed staged Save as one act, and one commit

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-048
- Blocks: UI-083

## Spec References

- SPEC.md **§4** — "A Save carrying a mix of verbs is still one act and still one
  commit … anything else would make the history disagree with the single report
  §11 requires"
- SPEC.md **§11** — bulk mode, per-row staged actions, Save

## Summary

SERVER-077 applies **one** act over many ids as one commit. SHARED-032 makes a
Save carry a different verb per row. The commit boundary already exists and is
already told rather than inferred (`CommitRequest.docIds`); what changes is that
the act now plans per document with a **different planner per document**.

## Acceptance Criteria

- [x] A Save mixing verbs lands as **one** commit containing exactly the
      documents that changed, with `changed` and `git show --name-only` agreeing
      as the containment invariant states (one direction; the commit may carry
      files for documents the act did not name — §6's cascade parent, §7's skill
      folder move)
- [x] Per-document outcomes stay per-document, unchanged from SERVER-077: a lock,
      an unknown id, a not-applicable act and a failed write are entries in
      `refused`, never a verdict on the request
- [x] The whole-request refusal set is unchanged — an agent asking to `delete`
      is `403` before anything is read or written, **even when delete is one row
      of a mixed set**. A staged set is not a way to smuggle a delete past §9.2
- [x] Lanes cover every document the act writes, including those a planner
      reaches (SERVER-078's carried skills, §6's cascade parent). A mixed set
      touches more planners, so the lane union is larger, not different in kind
- [x] One SSE invalidate for the act, carrying each key once
- [x] The projection sees one act

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/bulk.ts`.

### Notes

- `applyOperations` N times then `finishMutation` once is already the shape; the
  change is that `planFor` is chosen per document rather than once for the act.
  Do not reintroduce a loop over the single-document write path — that is the
  failure SERVER-077 exists to prevent and it will look like it works.
- `TREE_MOVING_ACTIONS` is currently consulted for the act; with a mixed set it
  must be consulted per row, or a Save that moves one document and tags another
  will not re-measure the tree.

## Testing Strategy

A mixed Save (archive ×3, resolve ×2) → one commit, five files, `changed` equal
to `git show --name-only`. A mixed Save with one locked row and one unknown id.
An agent `delete` as one row of five → `403`, nothing written. A mixed Save
touching a skill and a thread, so two planners' carried writes land in one lane
union.

## Decisions taken

1. **`planFor` is chosen per row; the loop is over rows, never over verbs.** The
   act's shape — N isolated `applyOperations`, one `finishMutation` — is
   untouched. `StagedRow` (`{id, action, destination}`) is what the loop walks,
   so a mixed Save reaches one commit boundary by the same code path a
   single-verb one does. Grouping by verb was rejected at the docblock level as
   well as in code: it writes the same files and lands one commit per verb,
   which is exactly what §4's amendment forbids and what a file-only test would
   not catch.
2. **`mayChangeTree` is accumulated from the rows whose write actually landed.**
   Per row, because a request with a mix has no verb to ask about; from the ones
   that landed, because a refused row wrote nothing and so can have moved
   nothing. `finishMutation` still decides `["tree"]` by measuring
   `folderTreeSignature` either side of the projection (SERVER-018) — this only
   decides whether the measurement is taken.
3. **A `move` folder is resolved once per distinct folder, outside the lanes.**
   Two rows may name different folders in one Save, so `destination` moved onto
   the row; a folder that names nothing stays a `400` for the whole request
   rather than N identical refusals, which is SERVER-077's rule unchanged.
4. **The commit subject names every verb it carried, with a count each** —
   `bulk archive 3, resolve 2: 5 documents by user` — in `BULK_ACTION_NAMES`
   order so two Saves with the same mix produce the same subject. The
   single-verb form is byte-identical to what SERVER-077 shipped
   (`bulk archive: 3 documents by user`): a count repeated twice on one line
   reads as a mistake. Rejected: a verbless word like `bulk save`, which would
   leave `git log` unable to tell a bulk archive from a bulk delete, and
   per-document verbs in the trailers, which would change a published trailer
   format for something the response already reports.
5. **The whole-result-set entry is resolved in `docs/selection.ts`, by compiling
   the `ViewQuery` into `DocsQuerySchema` and running `queryDocIds`** — the same
   `compileFilters`/`whereClause` `GET /api/docs` runs, in the COUNT statement's
   shape (no page, no row joins), ordered by id. A second filter grammar would
   let a Save write a set the board could never show. `limit`, `offset` and
   `sort` are accepted and ignored: §11's second selection act covers "all 412
   matching", not the fifty on screen, and refusing them would refuse the
   board's own stored queries. An unrecognised key is a `400` naming it
   (`DocsQuerySchema` *strips* unknown keys, so the check is against its shape
   before it runs) — CONTRACT-048 decision 2, because here the query decides
   what gets written.
6. **Uniqueness inside `entries` is not re-derived on the server.** The contract
   refuses a repeated id with a `400` before the handler; `collapse` is gone
   rather than kept as a silent second opinion that would disagree with the
   refusal message.

## E2E Verification Log

### Post-Implementation Verification

**Model: Opus 5 (1M context)** (`claude-opus-5[1m]`), running as `server-dev` in
the main working tree on `phase-27-serializer-p0-stub-typing`. No worktree. **No
git command was run in this repository**; every `git` invocation below ran inside
the scratch workspace `/tmp/s087-ws`, which is a product workspace and the thing
under test. Scratch port **8791** — 8765 and 5173 were never bound. The server
was started with `corpus server start` (pid 30814) and stopped with
`corpus server stop`; the port is free.

**1. A mixed Save is one act and one commit — the response, then git.**

Three notes and two standalone threads, staged as three `archive` rows and two
`resolve` rows in one request:

```
$ curl -X POST …/api/docs/bulk -d '{"entries":[
    {"id":"doc_doq4k6g5","action":{"action":"archive"}},
    {"id":"doc_j5hsschz","action":{"action":"archive"}},
    {"id":"doc_rcbzv72d","action":{"action":"archive"}},
    {"id":"th_33gl26vc","action":{"action":"resolve"}},
    {"id":"th_k2n5ovfe","action":{"action":"resolve"}}]}'
{
 "changed": [
  {"id":"doc_doq4k6g5","action":"archive"},
  {"id":"doc_j5hsschz","action":"archive"},
  {"id":"doc_rcbzv72d","action":"archive"},
  {"id":"th_33gl26vc","action":"resolve"},
  {"id":"th_k2n5ovfe","action":"resolve"}
 ],
 "alreadyInState": [], "refused": [], "orphanedThreadIds": [],
 "commit": "343f3abc39662455ec90415f2872083b5e0cac16", "warnings": []
}
```

```
$ git log -2 --format='%H %s'
343f3abc39662455ec90415f2872083b5e0cac16 bulk archive 3, resolve 2: 5 documents by user
7b74d22df1237b1c90f437dcd211e017e0d648e4 comment: new standalone thread (th_k2n5ovfe) by user

$ git show --name-only --no-renames --format= 343f3abc39662455ec90415f2872083b5e0cac16
data/docs/inbox/alpha.md
data/docs/inbox/beta.md
data/docs/inbox/gamma.md
data/threads/th_33gl26vc.md
data/threads/th_k2n5ovfe.md

$ git log -1 --format=%b 343f3abc…
Corpus-Doc: doc_doq4k6g5
Corpus-Doc: doc_j5hsschz
Corpus-Doc: doc_rcbzv72d
Corpus-Doc: th_33gl26vc
Corpus-Doc: th_k2n5ovfe
Corpus-Actor: user

$ git log -1 --format='%an' 343f3abc…      → user
$ git rev-list --count 7b74d22..HEAD       → 1
$ git status --porcelain | wc -l           → 0
```

**One** commit, five files, and the five files are exactly `changed` — a server
that grouped by verb would have produced two commits here. Both verbs actually
happened, read off the files rather than the response:

```
$ grep -H '^status:' data/docs/inbox/{alpha,beta,gamma}.md data/threads/th_*.md
data/docs/inbox/alpha.md:status: archived
data/docs/inbox/beta.md:status: archived
data/docs/inbox/gamma.md:status: archived
data/threads/th_33gl26vc.md:status: resolved
data/threads/th_k2n5ovfe.md:status: resolved
```

**2. An agent's `delete` as one row of three: `403`, before anything is read or
written.**

```
$ curl -X POST -H 'x-corpus-author: agent' …/api/docs/bulk -d '{"entries":[
    {"id":"doc_3iayvida","action":{"action":"tag","add":["q3"]}},
    {"id":"doc_ersw2hhs","action":{"action":"delete"}},
    {"id":"doc_doq4k6g5","action":{"action":"review"}}]}'
HTTP/1.1 403 Forbidden
{"code":"forbidden","message":"deletion is user-only; the agent archives, never deletes"}

HEAD unchanged: e91c16efbd981d5ef9b10735d2a7b5cd40a7f905
data/docs/inbox: alpha.md beta.md doomed.md gamma.md kept.md
q3 occurrences in kept.md: 0
```

The other two rows were **not** applied "as far as they could be". The same body
from the user goes through as one act:

```
"changed": [{"id":"doc_3iayvida","action":"tag"},
            {"id":"doc_ersw2hhs","action":"delete"},
            {"id":"doc_doq4k6g5","action":"review"}]
$ git log -1 --format=%s   → bulk tag 1, review 1, delete 1: 3 documents by user
$ git show --name-only --no-renames --format= HEAD
data/docs/inbox/alpha.md
data/docs/inbox/doomed.md
data/docs/inbox/kept.md
```

**3. Per-document outcomes survive the mix** — a lock on one row, an unknown id
on another, one row through:

```
"changed":[{"id":"doc_doq4k6g5","action":"unarchive"}],
"refused":[
 {"id":"doc_j5hsschz","action":"tag","reason":"locked",
  "message":"doc_j5hsschz is being edited by agent; the lock was acquired at 2026-08-09T23:22:19Z",
  "lock":{"docId":"doc_j5hsschz","holder":"agent","acquired":"2026-08-09T23:22:19Z","ttl":300}},
 {"id":"doc_nosuchid","action":"resolve","reason":"not-found",
  "message":"no document with id doc_nosuchid","lock":null}]

$ git show --name-only --no-renames --format= HEAD   → data/docs/inbox/alpha.md
$ git log -1 --format=%s                             → bulk unarchive: 1 document by user
```

Every refusal names **which act** it was refusing, which is the only way a mixed
report reads without the request beside it. The single-verb subject is
unchanged.

**4. §11's whole-result-set entry, beside a hand-staged row.** `alpha` staged by
hand as `tag`, the entry carrying `unarchive` for everything matching
`{tag: finance, status: archived}`:

```
"changed":[{"id":"doc_doq4k6g5","action":"tag"},
           {"id":"doc_j5hsschz","action":"unarchive"},
           {"id":"doc_rcbzv72d","action":"unarchive"}]
$ git log -1 --format=%s   → bulk unarchive 2, tag 1: 3 documents by user
$ grep -H '^status:' data/docs/inbox/{alpha,beta,gamma}.md
data/docs/inbox/alpha.md:status: archived     ← kept the verb the person chose
data/docs/inbox/beta.md:status: open
data/docs/inbox/gamma.md:status: open
```

The entry covered two ids **that appear nowhere in the request**, and excluded
the one `entries` named. An unrecognised key is refused for the whole request,
before any write:

```
$ … -d '{"entries":[],"wholeResultSet":{"query":{"colour":"blue"},"action":{"action":"archive"}}}'
HTTP/1.1 400 Bad Request
{"code":"bad_request","message":"the whole-result-set query names a filter that does not exist",
 "issues":[{"path":"wholeResultSet.query.colour","message":"`colour` is not a filter `GET /api/docs` accepts, …"}]}
```

**5. One SSE frame per act, each key once — and the tree measured per row.**
Live `GET /events` while three Saves ran:

```
:connected
event: invalidate
data: {"keys":[["docs"],["docs","doc_doq4k6g5"],["docs","doc_j5hsschz"],["docs","doc_rcbzv72d"],["tree"]]}   ← unarchive ×2 + tag
event: invalidate
data: {"keys":[["docs"],["docs","doc_j5hsschz"],["docs","doc_rcbzv72d"]]}                                     ← tag + review: no tree key
event: invalidate
data: {"keys":[["docs"],["docs","doc_j5hsschz"],["docs","doc_rcbzv72d"],["tree"]]}                            ← tag + move: tree key
```

The tree-moving row is the **second** one in the third Save (`bulk move 1, tag 1:
2 documents by user`), which is the case a per-request or first-row answer gets
wrong: `tag` alone would have left the folder badge stale.

**6. The projection agrees with the files afterwards.**

```
$ corpus db doctor
projection is clean — 15 documents from 15 files (3ms)     → exit 0
```

**7. Checks.**

```
$ npm run build                                             → exit 0
$ cd apps/server && tsc --noEmit                             → exit 0
$ ./node_modules/.bin/eslint apps/server/src                 → exit 0 (no warnings)
$ ./node_modules/.bin/prettier --check "apps/server/src/**/*.ts" → All matched files use Prettier code style!
$ VITEST_MAX_THREADS=4 vitest run apps/server/src/docs/bulk.test.ts \
      apps/server/src/docs/selection.test.ts apps/server/src/docs/query.test.ts \
      apps/server/src/docs/tree-key.test.ts
  Test Files 4 passed (4) · Tests 184 passed (184)           → exit 0
$ VITEST_MAX_THREADS=4 vitest run apps/server
  Test Files 176 passed, 2 failed (178) · Tests 3683 passed, 2 failed (3685)
```

`bulk.test.ts` grew from 31 to 49 tests: a new "a mixed staged set is one act"
suite (nine cases — the five-row mixed commit, the subject, a locked row beside
an unknown id, the agent's delete inside a mix, both planners' carried documents
in one lane union, the tree gate in both directions, two folders in one Save, a
bad folder beside good rows) and a new "§11's whole-result-set entry" suite
(nine cases), plus `selection.test.ts` (five). Every commit assertion reads real
`git show --name-only` output.

**The two failures in the workspace-wide run are timeouts, not assertions**, and
both pass on re-run: `bulk.test.ts > archives twenty documents…` and
`skills/rollback.test.ts > refuses when the walk found nothing…` (a file this
issue does not touch) each hit vitest's default 5 s per-test limit while 178
files ran in parallel on a laptop shared with other agents (`collect 140s` for
the run). Re-run scoped:

```
$ VITEST_MAX_THREADS=4 vitest run apps/server/src/docs/bulk.test.ts apps/server/src/skills/rollback.test.ts
  Test Files 2 passed (2) · Tests 82 passed (82)             → exit 0
```

**Refused / not done, deliberately:**

- **`packages/contract` was not touched.** The shape is CONTRACT-048's and its
  four decisions were consumed, not re-litigated.
- **SPEC.md was not edited**; CONTRACT-048's held §9.2 draft still needs the
  user's signature.
- **The trailer format was not changed** to carry a per-document verb. It is a
  published format shared with every other mutation, and the response already
  pairs each id with its act; the subject names the verbs.
- **No defensive de-duplication of `entries`** was added — a repeated id is the
  contract's `400`, verified live (`"doc_3iayvida is staged twice with different
  actions (tag and review)"`), and a second opinion here could only disagree
  with it.
- **No git command was run in this repository.**

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint, prettier and `tsc --noEmit` in `apps/server`)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
