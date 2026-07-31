# [UI-020] Unarchive affordance in the reader menu

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SERVER-039, UI-012
- Blocks: —

## Spec References
- SPEC.md §7 (archived skills "restorable"), §11 (reader ⋯ menu)

## Summary
Wave-3 audit SPEC 34: the reader menu offers Archive with no inverse — unarchiving is
CLI-only, while the *broken* transition (status flip without the folder move) was
UI-reachable until SERVER-039 closed it server-side. Add Unarchive to the doc action
source (menu/docActions.ts — one declaration, both presentations pick it up) for
archived documents, calling the existing unarchive route. Availability mirrors
Archive's; no confirm (reversible act).

**Scope correction (sprint-018 diligence, 2026-07-30 — Adjudications 6 and 7).** The
UI has no archive/unarchive client calls at all: it archives via
`PUT {status:"archived"}` (`useRowActions.ts`), which never runs the server's folder
move — the mirror image of the half-state SERVER-039 closed, live in the archive
direction for skills. This issue therefore (a) moves the UI's **Archive** onto
`POST /api/docs/{id}/archive` and adds **Unarchive** on `POST …/unarchive` (both
routes already in the contract inventory — no contract change), and (b) adds the two
typed-client call sites in `packages/kit` — a named exception to the UI-only file
scope, kit being this domain's second workspace. Sprint-018 TEST-615–626 are the
binding criteria.

## Acceptance Criteria
- [x] Archived doc's ⋯ menu and context menu offer Unarchive; non-archived docs don't
- [x] Skill docs: folder moves back, name freed (the SERVER-036 409 case recoverable from the UI)
- [x] SERVER-039's write-boundary refusal no longer reachable from the frontmatter form (status select disabled or redirected to the affordance on archived docs)

## Technical Design
### Files to Create/Modify
- apps/ui/src/menu/docActions.ts (+ tests), reader FrontmatterForm guard

## Testing Strategy
apps/ui scoped (VITEST_MAX_THREADS=4); e2e case in the menu spec.

## E2E Verification Plan
Real app: archive a skill → unarchive from the menu → create-409 gone; frontmatter form cannot produce the half-state.

## E2E Verification Log

**implemented on: opus** (`claude-opus-5[1m]`), 2026-07-31. Sprint contract:
`issues/sprints/sprint-018.md` (TEST-615–626, Adjudications 6, 7, 19). Port `8797`, Vite `5276`.
Workspace: `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s018-ui/020-eytUKW`, created from a cwd
**outside** this repository.

### Machine hygiene, first

`8797` and `5276` were both probed free before use. The dev server was started **only** after
exporting `CORPUS_SERVER_ORIGIN`, and the proxy target was proved rather than assumed
(Adjudication 2 — this issue drives archive and unarchive, which move folders on disk):

```
$ export CORPUS_SERVER_ORIGIN="http://127.0.0.1:8797"
$ export VITE_CORPUS_TOKEN="$TOKEN"        # apps/ui/src/app/apiClient.ts, the dev source
$ npm run dev -w apps/ui -- --port 5276 --strictPort

$ curl -s http://localhost:5276/api/health -H "Authorization: Bearer $TOKEN"
{"status":"ok","version":"0.0.0","uptimeSeconds":121.94,
 "workspace":"/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s018-ui/020-eytUKW"}
```

The `workspace` in that answer is **mine**, so every write the browser made in this drill landed in
the scratch workspace. `8765` throughout:

```
$ lsof -nP -iTCP:8765 -sTCP:LISTEN
node  15627 theophanerupin  15u  IPv4 ... TCP 127.0.0.1:8765 (LISTEN)
```

Still pid 15627 — never bound by me, never killed, never proxied into. (First attempt at the proxy
proof went out over `127.0.0.1` while Vite had bound `[::1]:5276`; re-run over `localhost`, which is
the same server, and pasted above.)

### The scope correction, restated as what was actually wrong

`/usr/bin/grep -rn "unarchive" packages/kit/src apps/ui/src` returned **zero hits** before this
issue: the menu item had nothing to call. And Archive did not archive — `useRowActions.archive` was
`useUpdateDoc(...).mutate({status: "archived"})`, a frontmatter patch. So both halves were built:

| surface | before | after |
| --- | --- | --- |
| reader ⋯ menu · context menu · row menu (Archive) | `PUT {status:"archived"}` | `POST /api/docs/{id}/archive` |
| board `e` shortcut | `PUT {status:"archived"}` | `POST /api/docs/{id}/archive` |
| row hover quick action (`Row.tsx`) | `PUT` (via `useRowActions`) | route, unchanged call site |
| **Unarchive**, anywhere | did not exist | `POST /api/docs/{id}/unarchive` |

### TEST-615 · Unarchive appears exactly where Archive does, and only on archived documents — **PASS**

One declaration, `apps/ui/src/menu/docActions.ts`: `archived = subject.status === "archived"` chooses
between the two, so it is impossible for both to be listed or for neither to be. `DocActionSubject`
already carried `status`, so no plumbing was added. Asserted by reading the **action list**, not by
two copies of a UI assertion — `apps/ui/src/menu/docActions.test.tsx`, *"offers Archive on a live
document and Unarchive on an archived one, never both"*. No confirm step, `disabled` mirroring
Archive's pending state, meta in the app's voice: `"restores it — a skill's folder moves back too"`.
Observed live in the browser (below), where the same reader's menu read
`["review:Still current","archive:Archive","delete:Delete…"]` and then
`["review:Still current","unarchive:Unarchive","delete:Delete…"]`.

### TEST-616 · the menu item calls the route that owns the transition — **PASS**

Real browser, wire recorded off the page:

```
$ node drill020.mjs unarchive
reader menu items: ["review:Still current","unarchive:Unarchive","delete:Delete…"]
toast: ✓Restored "weekly-review" — committed. It is back in the default lists.✕
writes on the wire: ["POST /api/docs/doc_zn574rrd/unarchive"]
```

One write, and it is the `POST`. No `PUT` — which is what SERVER-039 refuses with a `400` naming this
exact route.

### TEST-617 · Archive moves onto its own route too — **PASS**

Same drill, the other direction:

```
$ node drill020.mjs archive
reader menu items: ["review:Still current","archive:Archive","delete:Delete…"]
toast: ✓Archived "weekly-review" — committed. Archiving is reversible.✕
writes on the wire: ["POST /api/docs/doc_zn574rrd/archive"]
```

Every surface, pinned by test: the context menu
(`rowContextMenu.test.tsx` — *"archives through the route that owns the transition"*, asserting
`POST /api/docs/doc_a/archive` **and** `writes("PUT")` empty), the row quick action
(`packages/kit/src/row/useRowActions.test.tsx` — *"issues a single POST to the archive route,
carrying no status patch"*), the reader ⋯ sheet (`DocMenu.test.tsx`), and the `e` shortcut
(`Board.test.tsx` — *"e archives the row under the cursor, through the route that owns the
transition"*, plus the open-document-in-preference case). The shipped toast wording is **untouched**:
`archivedMessage` still reads `Archived "<title>" — committed. Archiving is reversible.` and the
optimistic `.leaving` slide and `isBusy` double-click guard behave exactly as before (their tests are
unmodified).

**One archive path was deliberately left on the `PUT`, and it is named rather than overlooked**: a
column's ⋯ → **Unpin**, which archives the `type: view` document behind the column
(`Board.test.tsx` — *"unpins by archiving the view document, never by deleting it"*). It is not one of
the four surfaces TEST-617 enumerates; a `view` can never be a skill, so no folder move exists to
miss; and moving it would change that action's shipped toast (*"was archived, not deleted"*), which
this issue's Out of Scope forbids. Flagged for the orchestrator as a consistency follow-up, not
silently skipped.

### TEST-618 · a skill round-trips, folder and name included — **PASS** (the gate)

Workspace on `8797`, cwd outside the repository, real skill via the real CLI:

```
$ corpus skill create weekly-review --description "Reviews the week's open threads…"
created doc_zn574rrd — .claude/skills/weekly-review/SKILL.md
```

**Before**, `.claude/skills/weekly-review/` exists, `status: open`, `.claude/skills-archived/` empty,
and `corpus skill create weekly-review` 409s on the *installed* branch.

**After Archive from the reader's ⋯ menu:**

```
$ ls .claude/skills/            → comment/ fixture-notes/ orchestrate/ todos/     (weekly-review gone)
$ ls .claude/skills-archived/   → weekly-review/
$ grep '^status:' .claude/skills-archived/weekly-review/SKILL.md   → status: archived
$ corpus skill create weekly-review --description x
corpus: 409 conflict: the name `weekly-review` belongs to an archived skill
  (.claude/skills-archived/weekly-review exists) — unarchive it to bring it back, or choose
  another name; creating over the name would leave it unable to return
```

That is SERVER-036's shipped message, reached from the UI for the first time — the state the issue's
criterion 2 could not get into before, because UI archiving did not archive a skill.

**After Unarchive from the reader's ⋯ menu:**

```
$ ls .claude/skills/            → comment/ fixture-notes/ orchestrate/ todos/ weekly-review/
$ ls .claude/skills-archived/   → (empty)
$ grep '^status:' .claude/skills/weekly-review/SKILL.md            → status: open
$ corpus skill create weekly-review --description x
corpus: 409 conflict: a skill named `weekly-review` is already installed
  (.claude/skills/weekly-review exists) — edit it with `PUT /api/docs/{id}` or choose another name
```

The 409 flipped to the **other** branch: the name is free of the archive. Both auto-commits, with the
acting party:

```
$ git log --oneline --format='%h %an <%ae> %s'
3372d72 user <user@corpus.local> doc unarchive: weekly-review (doc_zn574rrd) by user
0856708 user <user@corpus.local> doc archive: weekly-review (doc_zn574rrd) by user
```

**A note the next reader will want.** The first run of this loop produced a history with only the
unarchive commit in it, and the reflog explains why —
`3d34272 HEAD@{0} commit (amend): doc unarchive…` over `672ab6f HEAD@{1} commit: doc archive…`. That
is the shipped auto-commit squash (`apps/server/src/git/commit.ts`, `SQUASH_IDLE_MS = 30_000`:
successive edits of the same document by the same author inside the window amend). Not a UI-020
behaviour and not a regression — both writes committed, and the second folded the first. The loop was
re-run with a gap past the window to produce the two distinct commits pasted above.

### TEST-619 · SERVER-039's refusal is unreachable from the frontmatter form — **PASS**

`apps/ui/src/reader/FrontmatterForm.tsx`. On an archived document the `status` `<select>` is
`disabled` and a hint under it names the way out: *"archived — Unarchive in the ⋯ menu brings it
back"*. On a live document the select no longer offers `archived` **as a destination** at all
(`EDITABLE_STATUSES` = `DOC_STATUSES` minus `archived`), with the hint *"archive from the ⋯ menu — a
status flip would not move a skill's folder"*; the `archived` option is rendered only as the current
value of a document that already is one, so the control still has something to show. Tests:
*"disables the status control on an archived document and says where the way out is"* and *"offers no
archived destination on a live document"* (asserting the option list is exactly `["open",
"resolved"]`).

Going beyond the archived direction the criterion names is deliberate: leaving `archived` selectable
would have left the form as a fifth surface that archives a skill without moving its folder — the
exact half-state Adjudication 7 exists to close.

### TEST-620 · the exit flush cannot produce it either — **PASS**

The guard is in **`changedFields`**, not on the control, because Save is not the only path to the
wire: `outgoingWrite`/`flush`/`onPageHide` (`FrontmatterForm.tsx:172-198`) all funnel through it.
`status` is dropped whenever either side of the change is `archived`. Three unit cases under
*"the archive boundary"* — *"never unarchives, which SERVER-039 refuses with a 400 naming the
route"*, *"never archives, because a status flip does not move a skill's folder"*, *"still carries
everything else on an archived document"* — plus the integration case *"flushes a draft on the way
out without ever carrying status"*: an archived document is opened, the title is typed, the reader is
unmounted, and the resulting `PUT` body is exactly `{title: "Renamed while archived"}`. No 400, no
toast the user cannot connect to anything they did.

### TEST-621 · the write-boundary guard is still there, and is still the enforcement — **PASS**

Sent directly at the real server, bypassing the UI entirely:

```
$ curl -X PUT http://127.0.0.1:8797/api/docs/doc_32hsyhib -d '{"status":"open"}' …
HTTP 400
{"code":"bad_request","message":"request failed validation","issues":[{"path":"body.status",
 "message":"doc_32hsyhib is archived; `status: open` would set the frontmatter without bringing the
  document back. Use `POST /api/docs/doc_32hsyhib/unarchive` — it restores the status and, for a
  skill, moves its folder back out of `.claude/skills-archived/` and frees the name."}]}
```

Byte-identical to SERVER-039's shipped behaviour. **`git diff apps/server` is empty for UI-020** — I
made no edit under `apps/server` for this issue at all (the two comment/test-name edits in this
session belong to UI-021, Adjudication 8). The UI guard is a better error in front of the
enforcement, not a replacement for it.

### TEST-622 · a non-skill archives and unarchives with no folder move — **PASS**

An ordinary `type: note`, `doc_32hsyhib`, `data/docs/inbox/rate-assumptions.md`:

| | path | status | id |
| --- | --- | --- | --- |
| created | `data/docs/inbox/rate-assumptions.md` | `open` | `doc_32hsyhib` |
| after `POST …/archive` | `data/docs/inbox/rate-assumptions.md` | `archived` | `doc_32hsyhib` |
| after `POST …/unarchive` | `data/docs/inbox/rate-assumptions.md` | `open` | `doc_32hsyhib` |

The file does not move and the id never changes, in either direction. Its list membership was
observed live in the browser: the drill's board carried a pinned `Skills` column
(`query: {type: skill}`) and an `Archived` column (`query: {status: "archived"}`), and the skill left
the first and appeared in the second — and came back — over SSE without a reload, which is how the
drill found the row to right-click in each direction. The archived chip renders on the row from the
row's own `status`, unchanged by this issue.

### TEST-623 · the context menu invented nothing — **PASS**

`apps/ui/src/menu/docActions.test.tsx`, *"the ⋯ sheet and the context menu agree on a %s document,
new item included"*: `DocMenu` and `DocMenuItems` are rendered over the **same** doc and their
`data-act` lists are compared with `toEqual`, for `open` and for `archived`. An equality, not two
hand-written expectations that could drift. A second case pins the row menu's set as
`["open", "open-focus", "unarchive", "delete"]` — the same declaration, plus only the two openers a
row surface adds.

### TEST-624 · the kit change is minimal and additive — **PASS**, and here is the whole of it

`git diff packages/kit` is **non-empty by permission** (Adjudication 6). Four files:

1. **`src/client/createCorpusClient.ts`** — two methods on `CorpusClient` and their implementations:

   ```ts
   archiveDoc(id: string): Promise<DocMutationResponse>;
   unarchiveDoc(id: string): Promise<DocMutationResponse>;
   ```
   ```ts
   async archiveDoc(id) {
     return unwrap("POST /api/docs/{id}/archive",
       await api.POST("/api/docs/{id}/archive", { params: { path: { id } } }));
   },
   async unarchiveDoc(id) {
     return unwrap("POST /api/docs/{id}/unarchive",
       await api.POST("/api/docs/{id}/unarchive", { params: { path: { id } } }));
   },
   ```
   Both routes were already in the contract inventory (`packages/contract/src/routes/docs.ts:149,173`)
   and already in the generated client schema, so **`git diff packages/contract` is empty**.

2. **`src/query/useSetDocArchived.ts`** (new) — one mutation hook, `{id, archived}` variables,
   `mutationFn: ({id, archived}) => archived ? client.archiveDoc(id) : client.unarchiveDoc(id)`,
   modelled exactly on the shipped `useSetThreadStatus`. One hook rather than two because it is one
   reversible decision taken at call time; two would mean two invalidation lists for one flip.

3. **`src/query/useUpdateDoc.ts`** — the word `export` added to the existing private
   `invalidateDoc(queryClient, docId)` helper, and its docblock extended to say why. This is
   Open Conflict 3's "mirror `useUpdateDoc`'s invalidation exactly, by composition": the new hook
   *calls the same function* rather than copying its two `invalidateQueries` calls, so the two cannot
   drift. No signature changed, and the helper is **not** exported from the package index.

4. **`src/index.ts`** + **`src/index.test.ts`** — `useSetDocArchived` and `type DocArchiveVariables`
   added to the public surface and to the export-inventory test.

Plus `src/row/useRowActions.ts`, whose `archive` had to move per Adjudication 7: `useUpdateDoc(row.id,
…)` → `useSetDocArchived(…)` and `mutate({status:"archived"})` → `mutate({id: row.id, archived: true})`.
`RowActions`'s shape, `archivedMessage`'s wording, the `isBusy` guard, `isLeaving`, and every
teardown-safe callback are unchanged.

**No change** to `useDocs`, `usePluginQuery`, query-key shapes, or any existing hook's signature; no
plugin-facing behaviour change. The exception was needed because there was no client method to call:
the menu item literally could not be wired to "the existing unarchive route", since nothing in the UI
stack reached it.

**Deliberately not taken:** `unarchive` was *not* added to `useRowActions`. `docActions.ts` calls
`useSetDocArchived` directly for it, exactly as it already calls `useSetThreadStatus` for
Resolve/Reopen — which keeps `RowActions`, a kit public type, unwidened.

### TEST-625 · scoped suites green — **PASS**

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/ui packages/kit
 Test Files  136 passed (136)
 Tests       2031 passed (2031)
```

New/changed tests for this issue: `apps/ui/src/menu/docActions.test.tsx` (new, 9 cases),
`packages/kit/src/query/useSetDocArchived.test.tsx` (new, 7 cases), two wire cases in
`packages/kit/src/client/createCorpusClient.test.ts`, one archived case added to `DocMenu.test.tsx`,
four cases added to `FrontmatterForm.test.tsx`, and route assertions updated in
`useRowActions.test.tsx`, `rowContextMenu.test.tsx` and `Board.test.tsx`. The three transports
(`readerFixture`, `boardFixture`, e2e `stubCorpus`) learned to answer the two routes.

`npm run typecheck -w apps/ui -w packages/kit` clean; `eslint apps/ui packages/kit` clean (0 errors,
0 warnings); `prettier --check` clean.

**The scoped Playwright run was `DEFERRED → single-holder conflict.** UI-020's one permitted scoped
run is `context-menu.spec.ts`, and Playwright starts its **own** Vite; running it while this issue's
dev server was up on `5276` would have violated the sprint's single-holder rule, and tearing that
server down mid-drill would have cost the disk/git evidence. The spec was **written** and is on the
branch — two new cases, *"offers Unarchive on an archived row, and only there, calling the route that
owns it"* (asserting `data-act="unarchive"` present and `archive` absent on an archived row, the
converse on a live one, one `POST …/unarchive` and **zero** `PUT`s) and *"archives through POST
…/archive rather than a status patch"* — with the existing menu spec **extended, not replaced**.
Substitute evidence: the same two assertions are covered in jsdom by `docActions.test.tsx` and
`rowContextMenu.test.tsx` (both drive the real board and the real context menu), and the browser half
was proved by the manual Chromium drill above, which is the stronger of the two because it ran
against a real server. The orchestrator's harvest `npm run e2e` is the first clean opportunity to run
the spec, and it should be watched.

### TEST-626 · both halves of the UI evidence rule — **PASS**

The browser half (menu contents, which request goes out, the toast) came from real Chromium against
the dev server on `5276`; the disk/git/name half (the folder in `.claude/skills-archived/`, the
`status:` line, the two 409 branches, the auto-commits) came from the manual real-app drill on
`8797`. Neither is offered as acceptance alone. The proxy proof and the `8765` check are pasted at
the top of this log.

### Cleanliness

- No state-changing git command was run in this repository. Commits inside the scratch workspace are
  the server's own auto-commit (plus one explicit fixture commit inside the *scratch* workspace for
  UI-021's hand-edited thread).
- Scratch confined to `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s018-ui/020-eytUKW`; nothing
  glob-deleted.
- Every `corpus init` passed `--port` explicitly.
- `git diff SPEC.md` and `git diff packages/contract` empty. §11's ⋯-menu sentence enumerates
  "Archive, Delete, and Resolve/Reopen" and does not name Unarchive — **not patched in passing**
  (TEST-647); routed to the orchestrator as a spec rider for the phase PR.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
