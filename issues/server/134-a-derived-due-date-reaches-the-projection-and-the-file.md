# [SERVER-134] A derived due date reaches the projection and the file

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: PLUGINS-018 (the derivation and its declaration), SERVER-085 (the
  machinery this extends)
- Blocks: nothing — it is the last half of PLUGINS-018

## Spec References

- SPEC.md §5 line 202 — `due` is an optional deadline on any type, and it is
  what Attention and the filters read
- SPEC.md §12 — the `todo` doc type, and the derived-field seam as landed
- SPEC.md §9.1 — the `documents` projection row carries `due`

## Summary

**Filed by plugins-dev while implementing PLUGINS-018, per that issue's own
decision 4.** PLUGINS-018 landed the derivation — a todo document's deadline is
its earliest open item's — as the second member of SERVER-085's derived-field
seam. Nothing consumes it yet, because every surface the reporter tested reads
the projection's `due` column, and that column is filled from frontmatter by
`readDocumentFields` in `apps/server/src/projection/project-document.ts`.

So the plugin half answers correctly and the three queries still say no. This
issue is the other half, and it is the same shape SERVER-085 already built for
`status`, one field over.

**Verified by hand, against a real server** (PLUGINS-018's log has the full
transcript): with the derived value written into `due:` through an ordinary
`PUT`, `doc list --due overdue`, `--needs due` and `--needs me` all find the
reporter's 18-day-overdue document. With the derivation broken, all three lose
it again. The gap is exactly the convergence and the projection read.

## What PLUGINS-018 already provides

- `types.yaml`: `derivedDue: true` on the `todo` entry, beside `derivedStatus:
  true`. Today's server schema is a non-strict `z.object`, so the key rides
  through unread and a real boot logs **zero** warnings.
- `plugins/todos/server/derive.ts`: a **named** `deriveDue` export beside the
  existing default status export, signature
  `(input: {type, status, body, extra?}) => { due: string | null } | null`.
  Same module, so `scripts/package-staging.ts` needs no change — verified by
  bundling the entry point exactly as packaging does and reading its exports.
- `packages/kit`: `PluginDocType.deriveDue` and `DerivedDocDue`, for the UI.
- `plugins/todos/parity.test.ts`: three-way parity per field, table-driven over
  a `DERIVED_FIELDS` list, so a third field is one row rather than a third copy.

## The three answers, which no caller may collapse

`deriveDue` answers one of three things, and the middle one is the whole reason
it returns an object rather than `string | null`:

| Answer | Meaning | What the server must do |
| --- | --- | --- |
| `{ due: "YYYY-MM-DD" }` | this is the document's deadline | store it, converge the frontmatter to it |
| `{ due: null }` | the derivation applies and there is **no** deadline | store NULL, converge the frontmatter to core's empty spelling |
| `null` | the derivation does **not** apply | the stored value stands, untouched |

Collapsing the middle into the third leaves a stale deadline on a list whose
last dated item was just checked. Collapsing the middle into a date makes an
undated list look due. Both are the bug this issue closes, re-introduced.

## Acceptance Criteria

- [x] `readDocumentFields` stores the derived `due` for types that declare one,
      and the stored value for every type that does not — read through the same
      registry shape `resolveDocumentStatus` uses
- [x] `GET /api/docs?due=overdue`, `?needs=due` and `?needs=me` all return a
      todo document whose earliest open item is past its date, and none of them
      returns one whose open items carry no date
- [x] Checking the earliest dated item moves the document's `due` to the next
      one; checking the last dated item clears it, in the row **and** in the file
- [x] A todo document with no dated open items has a NULL `due` column and is
      absent from `due=today` as well as from `due=overdue` — an undated list is
      never due today
- [x] `status=archived` is unaffected: an archived todo document's `due`
      derivation answers `null`, so whatever the file states stands, and
      unarchiving returns it to what its items say at that moment
- [x] Whenever the server writes a todo document — the core body write path and
      the plugin's item routes alike — the derived deadline is written into the
      file's frontmatter in the **same** write, therefore the same commit. Never
      a second commit, never a second `updated` bump
- [x] `corpus db rebuild && corpus db doctor` is clean on a workspace holding
      dated, undated, completed and archived todo documents
- [x] `corpus doc check` does not report a stale shadow as invalid, exactly as
      SERVER-085 decided for `status`
- [x] An **out-of-band** `printf >>` of a dated item reprojects with the new
      derived deadline through SSE invalidation
- [x] Deleting `plugins/todos/` leaves core booting, with todo documents keeping
      whatever `due:` their files state and nothing erroring
- [x] **Added during implementation, and it was the missing half of the fix**:
      `GET /api/docs/{id}` reports the derived deadline, not the file's shadow.
      `wireFrontmatter` took `status` from the row and `due` from the
      frontmatter, so the reader and the board disagreed about one document's
      deadline for as long as the shadow was stale. Both come from the row now.

## Technical Design

The generalisation SERVER-085 left one field short. Three files carry it:

- `apps/server/src/plugins/derived-status.ts` — the registry is per field
  already in everything but its name: a map of type → function, a `derives()`
  predicate, and answer validation with warn-once containment. Parameterise it
  over the field (the validator is what differs — `["open","resolved"]` for
  status, an ISO date or `null` for due) rather than copying it. **Prefer
  renaming this module to `derived-fields.ts` over adding a sibling**: two
  registries with the same containment rules is the parallel-mechanism shape
  this repository keeps getting bitten by.
- `apps/server/src/plugins/discover.ts` — `derivedDue: true` in
  `TypesFileSchema` and `PluginTypeDecl`, and the module's **named** `deriveDue`
  export loaded beside its default one, under the routes module's existing
  containment. `resolveDeriveModule` is unchanged: one module, one import.
- `apps/server/src/projection/project-document.ts` and
  `apps/server/src/docs/derived-status.ts` — the ladder and the convergence,
  both already written for `status` and both wanting one more rung.

### Key implementation details

- **The clock is not an input.** `deriveDue` answers the *earliest* deadline and
  never whether it has passed. Keep it that way: a projection that read the time
  of day would give two answers for one document in one day.
- **`{ due: null }` must clear.** Core's own empty spelling for the field is
  `due: null` (SPEC.md §5's frontmatter example), and the projection column must
  be SQL NULL. A convergence that writes the string `"null"`, or that skips the
  write when the answer is empty, fails the "checking the last one clears it"
  criterion.
- **Derive once per write, in two calls, for SERVER-085's stated reason**: the
  write path derives from the bytes it is about to write and the projection
  derives from the file those bytes became, through the same function. Threading
  a value from one to the other would make the row a report of what the writer
  decided rather than a reading of what is on disk.

## Testing Strategy

Vitest against a real temp workspace, mirroring
`apps/server/src/projection/derived-status.test.ts` and
`apps/server/src/docs/derived-status.test.ts`: project a todo document in each
state and assert the row's `due`; write through both paths and assert the file
converged in one commit; an out-of-band append reprojects; a derivation that
throws or answers something that is not an ISO date is contained with one
warning and the stored value stands.

## E2E Verification Plan

The reporter's own case, which PLUGINS-018 already reproduced and half-proved:

1. A todo document whose first item is `(due: <18 days ago>)`
2. `corpus doc list --due overdue`, `--needs due`, `--needs me` — all three find
   it, with **no** hand-written `due:` anywhere and no script standing in for
   the convergence
3. `corpus todos check <id> 1` — the deadline moves to the next dated item, in
   the row and in the file, in one commit
4. Check the last dated item — the deadline clears, in both
5. An undated list is absent from all three, and from `--due today`
6. `printf -- '- [ ] late (due: <past>)\n' >> <file>` out of band — SSE
   invalidates and the projection reports the new deadline
7. `corpus db rebuild && corpus db doctor` — clean

## What was found while implementing, and decided

### The read path was the other half of the bug, and it was not in the design

`docs/read.ts`'s `wireFrontmatter` takes `status` from the projection row —
SERVER-085 put it there deliberately — and took `due` from the **file's**
frontmatter. So with the projection and the convergence both correct, a document
whose shadow was stale still reported the stale deadline through `GET
/api/docs/{id}`: the board and every filter said one thing, the reader said
another, about one document. Found live rather than reasoned about (the
transcript is below). `DocumentRow` now carries `due`, both row queries select
it, and `wireFrontmatter` reads it. For a type that derives nothing this is the
same value by construction — the row's `due` is `asCalendarDate(data["due"])`,
which is exactly what the reader used to compute itself.

### The flag-collapse PLUGINS-018 left open: **not done**, and why

PLUGINS-018 rejected collapsing `derivedStatus: true` / `derivedDue: true` into
`derivedFields: [status, due]` because the flag is read by `apps/server` on a
release branch, and offered SERVER-134 the one-line change. It stays additive:

1. **It is not this issue's to make.** The flag's spelling lives in
   `plugins/todos/types.yaml`, `plugins/todos/parity.test.ts`,
   `plugins/_fixture/parity.test.ts` and `packages/kit`'s `PluginDocType`
   documentation — all trees this issue may not touch. A collapse landing in
   `apps/server` alone would take derived status **and** derived due off the
   running server at the same moment, which is the exact failure PLUGINS-018
   named.
2. **The list form is the weaker declaration.** `derived<Field>: true` is
   validated against a literal by name, so `derivedDeu: true` is a shape error
   the boot log names. `derivedFields: [status, due]` is a list of strings, and a
   typo in it is a value nothing can reject without a second enumeration.
3. **The duplication it removes is one line per field**, and the server no longer
   pays it twice: `DERIVED_FIELDS` in `discover.ts` and the `FieldSpec` table in
   `derived-fields.ts` are the two places a fourth field is declared, and both
   are tables rather than copied code.

Filing a follow-up would be cheap if the shape is still wanted once the release
is out — it is a coordinated rename across three trees, not a one-liner.

### The registry was renamed rather than duplicated, as the design asked

`plugins/derived-status.ts` is now `plugins/derived-fields.ts`, and it is one
registry with one member per field. Ownership, the first-plugin-wins rule,
containment of a throw, warn-once and the not-applicable states are written once
and parameterised; the **validator** is the only per-field part, which is what
the issue predicted. `docs/derived-status.ts` became `docs/derived-fields.ts` and
converges every derived field in **one** `setFrontmatterFields` patch — a save
that resolves a list and clears its deadline is one write, one commit, one
`updated`.

## E2E Verification Log

**Model: Opus 5 (1M context), as recommended.** Real workspace, real server on
port 8991 (never 8765, the user's), real CLI, real `plugins/todos/dist` rebuilt
first. Output verbatim, 2026-08-22. Server's today: `2026-08-22` (UTC), so
`2026-08-04` is 18 days past — the reporter's own number.

### Reproduction — all three queries say no, before any change

```
$ corpus init …/s134-ws --port 8991 && corpus server start
corpus 0.16.0 listening on http://127.0.0.1:8991 (pid 91279)
$ POST /api/docs {"type":"todo","title":"Personal tasks","folder":"inbox","body":
    "- [ ] call the dentist (due: 2026-08-04)\n- [ ] renew the passport (due: 2026-09-30)\n"}
created doc_sjytklot due=null status=open

$ corpus doc list --due overdue
    no documents match.
$ corpus doc list --needs due
    no documents match.
$ corpus doc list --needs me
    no documents match.

$ sed -n '1,16p' data/docs/inbox/personal-tasks.md
status: open
due: null
- [ ] call the dentist (due: 2026-08-04)
- [ ] renew the passport (due: 2026-09-30)
```

Three ways of asking what is late, all answering no, with an item eighteen days
late in the body. Reproduced.

### The same three queries, with the fix, before any server write

The server was restarted onto the fixed code and nothing else was done — so this
is the **boot scan** deriving, not a convergence:

```
$ corpus doc list --due overdue
    doc_sjytklot  todo  open  Personal tasks  data/docs/inbox/personal-tasks.md
$ corpus doc list --needs due
    doc_sjytklot  todo  open  Personal tasks  data/docs/inbox/personal-tasks.md
$ corpus doc list --needs me
    doc_sjytklot  todo  open  Personal tasks  data/docs/inbox/personal-tasks.md
$ grep -n '^due:' …/personal-tasks.md   →  10:due: null      ← the shadow, not yet written
```

**All three answer yes**, on the reporter's exact case.

### Checking the earliest item moves it; checking the last clears it

Through `corpus todos check` — the CLI and agent path — with no hand-written date
anywhere:

```
$ corpus todos check doc_sjytklot 1
checked item 1 of Personal tasks [doc_sjytklot] — call the dentist
$ grep -n '^due:\|^status:' …/personal-tasks.md
8:status: open
10:due: 2026-09-30                       ← moved to the next dated item, in the same write
$ corpus doc list --due overdue / --needs due / --needs me
no documents match. (×3)                 ← 2026-09-30 is not late

commits before: 3
$ corpus todos check doc_sjytklot 2
checked item 2 of Personal tasks [doc_sjytklot] — renew the passport
$ grep -n '^due:\|^status:\|^updated:' …/personal-tasks.md
6:updated: 2026-08-22T04:00:03Z          ← one stamp
8:status: resolved                       ← SERVER-085's field, same write
10:due: null                             ← cleared, core's own empty spelling
commits after: 3                         ← §4 folded it into the open window; no commit of its own
$ git log --oneline | head -1
21a1d03 doc edit: Personal tasks (doc_sjytklot) by user
```

### A create already carries the deadline, and an undated list has none

```
$ POST /api/docs "Reporter case"  (the same two dated items)
201 → doc_4n54pjht  due="2026-08-04"  status=open      ← converged by the create's own write
$ POST /api/docs "Undated errands" ("- [ ] buy milk\n- [ ] water the plants\n")
201 → doc_i3q2ie3o  due=null  status=open
$ POST /api/docs "Still empty"     ("Nothing yet.\n")
201 → doc_y6usgxgv  due=null  status=open

$ grep -n '^due:' …/undated-errands.md  →  10:due: null
$ grep -n '^due:' …/still-empty.md      →  10:due: null

$ corpus doc list --due overdue / --needs due / --needs me
doc_4n54pjht  Reporter case      (only)
$ corpus doc list --due today
doc_4n54pjht  Reporter case      (only — the undated list is absent from this one too)
```

### `archived` stands, and unarchiving returns it to the items

```
$ POST /api/docs/doc_zhp3ksqm/archive     →  status=archived  due="2026-08-01"
$ PUT  body "- [x] pay the rent (due: 2026-08-01)"   (the core body path, on the archived list)
$ grep -n '^status:\|^due:' …/archived-list.md
8:status: archived
10:due: 2026-08-01                      ← neither field disturbed
$ POST /api/docs/doc_zhp3ksqm/unarchive
$ grep -n '^status:\|^due:' …/archived-list.md
8:status: resolved
10:due: null                            ← what the items say at that moment, in one write
```

### The out-of-band `printf >>`, with an SSE stream open

```
$ printf -- '- [ ] late from an editor (due: 2026-07-01)\n' >> …/undated-errands.md
$ cat sse.log
:connected
event: invalidate
data: {"keys":[["docs"],["docs","doc_i3q2ie3o"]]}
event: invalidate
data: {"keys":[["index"]]}
$ GET /api/docs?type=todo&due=overdue
doc_i3q2ie3o  due="2026-07-01"  status=open      ← the row reprojected
$ grep -n '^due:' …/undated-errands.md  →  10:due: null    ← the shadow lags, by decision
```

And the shadow heals on the next server write, folded into the open window:

```
commits before: 5
$ PUT /api/docs/doc_i3q2ie3o {"addTags":["errands"]}
$ grep -n '^due:' …/undated-errands.md  →  11:due: 2026-07-01
commits after: 5
```

### The read path — found here, not in a test

With the plugin present and the file's `due:` hand-edited to `2033-03-03` while
the server was down:

```
BEFORE the read-path fix
$ GET /api/docs/doc_4n54pjht     →  due="2033-03-03"     ← the file's shadow
$ GET /api/docs?type=todo        →  due="2026-08-04"     ← the row, derived
```

The board and the reader disagreed about one document. After the fix, over the
same still-stale file:

```
$ grep -n '^due:' …/reporter-case.md  →  12:due: 2033-03-03
$ GET /api/docs/doc_4n54pjht     →  due="2026-08-04"
$ GET /api/docs?type=todo        →  due="2026-08-04"
```

### A hand-written `due:` does not survive a write (PLUGINS-018 decision 3)

```
$ PUT /api/docs/doc_4n54pjht {"due":"2030-01-01","addTags":["late"]}
$ grep -n '^due:' …/reporter-case.md  →  12:due: 2026-08-04
```

### Subtractive check (SPEC.md §12 M6)

Run by pointing the server at an **empty** plugins root (`CORPUS_PLUGINS_DIR`),
so no directory in this repository was moved while another agent was working:

```
$ CORPUS_PLUGINS_DIR=…/noplugins corpus server start
$ GET /api/docs?type=todo
doc_zhp3ksqm  due=null        status=resolved
doc_i3q2ie3o  due="2026-07-01" status=open
doc_y6usgxgv  due=null        status=open
doc_4n54pjht  due="2026-08-04" status=open
doc_sjytklot  due=null        status=resolved
$ GET /api/x/todos/lists                        →  HTTP 404
$ PUT /api/docs/doc_4n54pjht {"due":"2030-01-01"}
$ grep -n '^due:' …/reporter-case.md  →  10:due: 2030-01-01   ← the field is the person's again
```

Core boots, todo documents keep whatever their files state, nothing errors.

### `rebuild && doctor && doc check`, on all five states

The workspace held a dated list, an undated one, an empty one, a completed one
and an archived one — one of them with a **deliberately stale** shadow
(`reporter-case.md` reads `due: 2033-03-03`).

```
$ corpus db rebuild
rebuilt the projection in 29ms — 17 documents, 0 threads, 0 turns, 0 anchors, 0 links, 2 events, …
$ corpus db doctor
projection is clean — 17 documents from 17 files (7ms)
$ corpus doc check
checked 17 documents — no findings.
$ corpus doc check doc_4n54pjht
checked 1 document — no findings.      ← the stale shadow is not a finding, per SERVER-085
$ GET /api/docs?type=todo&includeArchived=true
doc_4n54pjht  due="2026-08-04"  status=open
doc_zhp3ksqm  due=null          status=resolved
doc_i3q2ie3o  due="2026-07-01"  status=open
doc_y6usgxgv  due=null          status=open
doc_sjytklot  due=null          status=resolved
```

### Breaking the fix, against the same running server

`resolveDocumentDue` reduced to `return asCalendarDate(input.data["due"]);`,
server restarted, nothing else changed:

```
=== FIX BROKEN ===   is doc_4n54pjht (the reporter's case) found?
due=overdue -> 0
needs=due   -> 0
needs=me    -> 0
=== FIX RESTORED ===
due=overdue -> 1
needs=due   -> 1
needs=me    -> 1
```

### The tarball's own copy of the module

`deriveDue` rides SERVER-085's existing `server/derive.js` entry point, so
`scripts/package-staging.ts` needed no change — verified rather than assumed, by
bundling the compiled entry the way packaging does and reading its exports:

```
$ esbuild plugins/todos/dist/server/derive.js --bundle --platform=node --format=esm …
exports: default,deriveDue,deriveStatus
deriveDue:           {"due":"2026-08-04"}
deriveDue(no dates): {"due":null}
default (status):    "resolved"
```

### Unit gate and falsification

`VITEST_MAX_THREADS=4 vitest run apps/server` → **196 files, 4404 tests passed**.
`tsc --noEmit`, `eslint apps/server/src` and `prettier --check apps/server/src`
all clean.

Deliberate breaks, each restored and re-verified green:

| Break | What failed |
| --- | --- |
| `resolveDocumentDue` returns the stored value | the three queries lose the reporter's document on a live server (above) |
| `{ due: null }` composed with `?? stored` | 4 tests — "clears the date when the last dated item is checked", "resolves the list and clears its deadline in ONE commit", "keeps an archived list's stored deadline", and the projection's clear case |
| `wireFrontmatter` reads `due` off the file | 1 test — "reads the derived deadline off the row, not off a stale shadow in the file" |
| the `due` validator accepts any object | 2 tests — "passes a date through, normalized" and "contains anything that is not one of the three, and says so once" |

Server stopped (pids 89951, 91279, 82173, 85745, 86103, 87467, 69085, 69270,
69595), port 8991 verified free, SSE listener killed, the scratch workspace left
outside the repository. Port 8765 — the user's live server — never touched, and
verified still listening.

## Files changed

- `apps/server/src/plugins/derived-fields.ts` (new, replacing
  `derived-status.ts`; + `derived-fields.test.ts` replacing its test) — one
  registry, one member per field; the shared rules written once and the
  validators as a table
- `apps/server/src/plugins/discover.ts` (+ `discover.test.ts`) — `derivedDue` in
  `PluginTypeDecl` and `TypesFileSchema`, `DERIVED_FIELDS` as the declaration
  table, `loadExportedFunction` for a **named** export, and a memoized import so
  one module serves both fields
- `apps/server/src/plugins/index.ts` — exports
- `apps/server/src/projection/project-document.ts` — `resolveDocumentDue` beside
  `resolveDocumentStatus` over one shared `DocumentFieldInput`; `storedStatusOf`
  is the carve-out both ask about
- `apps/server/src/projection/derived-fields.test.ts` (new, replacing
  `derived-status.test.ts`)
- `apps/server/src/projection/index.ts`, `db.ts`, `attach.ts`, `rebuild.ts`,
  `routes.ts` — `derivedFields` on the handle and through the rebuild
- `apps/server/src/docs/derived-fields.ts` (new, replacing `derived-status.ts`;
  + `derived-fields.test.ts`) — every derived field converged in one patch
- `apps/server/src/docs/read.ts` (the read-path fix) — `DocumentRow.due`, both
  row queries, and `wireFrontmatter` taking `due` from the row
- `apps/server/src/docs/write.ts`, `archive.ts`, `write-fixture.ts` — the rename
  and the fixture option
- `apps/server/src/docs/move.test.ts` — a `DocumentRow` literal gains `due`
- `apps/server/src/watcher/watcher.ts`, `reconcile-out-of-band.ts` (+ its test) —
  the convergence rides the reconciliation's own rewrite, both fields
- `apps/server/src/lifecycle.ts` (+ `lifecycle.test.ts`) — discovery before the
  projection, now pinned for `due` as well

Nothing outside `apps/server/` was modified. `plugins/todos/dist/` was rebuilt
(gitignored build output) so the real-app checks ran against the current module.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Pre-fix reproduction logged
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (touches the write path and the projection)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-134]` prefix
