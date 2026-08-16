# [SERVER-110] Stamp a document with the thread it came from

## Domain
server

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: [CONTRACT-050]
- Blocks: [SERVER-111], [CLI-044]

## Spec References
- SPEC.md §7 as amended by SHARED-043 — provenance and `origin`

## Summary
Implement provenance stamping. When a mutating request carries `job: evt_…`, resolve the
event, walk its payload to an origin thread (the same first-of `threadId, parentId, docId`
resolution the held-report already uses, `apps/server/src/jobs/project.ts:30-35`), and
stamp the created or edited document's frontmatter with `origin: th_…`. Origin is recorded
**unconditionally** — whether or not the thread is designated — because scope membership is
computed at enqueue time from the origin chain (SERVER-111), never stored. This also makes
the `↳` trace line verifiable and gives the job console a real artifact list.

## Acceptance Criteria
- [x] `job` on a mutating request resolves the event from the store; unknown id or a settled event (`processed/failed/abandoned`) → 422 naming the id and its state; `pending/in-progress/deferred` are all legal (a resident stamps while holding)
- [x] Origin resolution: event payload `threadId` → that thread; `parentId`/`docId` only → the *document's own* origin if it has one, else null — and `doc.edited` events carry only a `docId`, so they fall under exactly that rule (the edited document's origin, else null); reflection work and its artifacts thereby stay in the document's scope
- [x] On **create** (doc or thread), `origin` is written into frontmatter in §6 key order; on **edit**, an existing `origin` is never overwritten (first writer wins)
- [x] Detach: doc edit with `origin: null` from the `user` actor clears the field; the same body from `agent` → 403 (deletion-shaped act, user-only, same doctrine as `doc delete`)
- [x] `origin` round-trips through the projection (`project-document.ts`) onto the wire shape, and invalidates `["docs", id]` like any frontmatter change
- [x] Threads created with `job` carry `origin` too — that is how subthreads join the scope

## Technical Design

### Files to Create/Modify
- `apps/server/src/core/provenance.ts` — new: `resolveOrigin(event): th_… | null`, shared with SERVER-111's lane resolution
- `apps/server/src/docs/*` (create/edit paths) and `apps/server/src/threads/create.ts` — accept `job`, stamp frontmatter
- `apps/server/src/projection/project-document.ts` — read `origin` field-by-field like the rest
- `apps/server/src/queue/store.ts` — a read-by-id that does not move the event (exists as the transition read; expose it)

### Key Implementation Details
Frontmatter key order comes from §6; slot `origin` after `parent`/`anchor` in
`threads/create.ts:182-212` and the doc equivalent. The stamp happens inside the same
write the server was already making — no second commit, no second invalidation. Keep
`resolveOrigin` pure and synchronous; it reads the event object it is handed, not the
filesystem, so the request path stays one store read.

### Edge Cases
- `job` naming an event whose thread has since been deleted: stamp anyway (`th_…` ids stay meaningful in git history); scope walks treat a missing root as undesignated
- A capture (`source: "capture"`) event carries a threadId like any comment — inbox artifacts join scopes too, which is correct
- Two writes racing with the same `job`: both stamp the same origin; idempotent

## Testing Strategy
Unit: `resolveOrigin` across the three payload shapes and `doc.edited`. Integration: create
doc with job → frontmatter + wire `origin`; edit never overwrites; user clears, agent 403;
422 on settled/unknown events.

## E2E Verification Plan

### Verification Steps
1. Real server, real workspace: post a comment mentioning `@agent` → event enqueues
2. `corpus queue claim-all`; `corpus doc create --job <evt> …` (lands with CLI-044; until then, generated-client call) → `corpus doc show` prints `origin: th_…`
3. Edit the doc with a different job → origin unchanged
4. `corpus doc edit <id> --from user` clearing origin → cleared; same `--from agent` → refused

## E2E Verification Log
**Model: Opus 5 (1M context)**, orchestrator, on `phase-34-resident-rider`. No
server started, no port bound — the integration suite drives a real in-process
server with a real queue and real git.

```
$ npx vitest run apps packages scripts plugins  → 12310 passed, 0 failed
$ npm run typecheck / lint / prettier --check   → clean
```

`apps/server/src/docs/provenance.test.ts` is the proof, and every case uses an
event the server actually enqueued rather than a fabricated id: a created
document carries the thread its job came from, on the wire **and in the file**;
a write naming no job records nothing; a thread created from a job is stamped
too; an edit never overwrites an existing origin but does fill an absent one;
detach clears it for a user and is `403` for an agent; setting one is `400`
naming `body.origin`; a detached document can be claimed again; an unknown job
is `422` naming the id, a settled one is `422` naming its state, and a refusal
writes nothing.

### Corrections from PR #47's review

Three MAJORs, all real, and one of them was a criterion this file had already
ticked:

- **AC 2's `doc.edited` half was declared and unimplemented.** `resolveOrigin`
  returned `null` for such an event, its docblock said "resolved by the caller",
  and no caller did. A follow-up written while reflecting fell out of the scope
  it reflects on. `originDocumentOf` + the projection read in `job-lookup.ts`
  close it, tested in `queue/job-lookup.test.ts` **and** end to end in
  `edit/provenance-reflection.test.ts`.

  **A correction to this file's own record.** The first version of this entry
  said the integration test was impossible "because the write fixture wires no
  `editSessions`, so no `doc.edited` event is ever emitted there". That is
  **false**: `createWriteWorkspace` always passes a projection and `app.ts`
  builds the tracker whenever one is present — `editAckIdleMs` shortens the
  window rather than enabling it, and `edit/acknowledgment.test.ts` has been
  asserting real `doc.edited` events through that same fixture all along. The
  test was straightforwardly available and is now written. Recorded because a
  false statement about a fixture is the kind the next agent trusts.
- **Nine routes declared the `422`; three could produce it.** The other six
  accepted `job` and dropped it — the silent ignore §9.2 names as the failure to
  avoid. `patch` now stamps through the ordinary write path (so the two edit
  verbs agree about filing), and move/archive/unarchive/turn-append/form-respond
  validate the job without stamping, since they create no document.
- **A corpus that predates the field became unwritable.** `origin` was a legal
  `extra` key before it was reserved, so a document carrying an unrelated
  `origin:` failed §14 validation on every save, including the reader's
  autosave. The parse, the read path and the projection now read anything that
  is not a thread id as `null`.

Writing the test for the first of those caught a `projection.db.prepare` call
where `ProjectionDb` exposes `prepare` directly. **This was overstated when it
was first written up** as a bug the fix had *caught* in existing code: the string
never existed in any committed tree (`git log --all -S` matches only the fixing
commit itself). It was introduced and corrected inside one working session, and
is worth recording only as a reminder that a seam typed loosely enough to accept
`.db` is a seam that will accept a typo.

### Three things worth recording

**"Has no origin" is `origin: null`, not an absent key.** Every document written
since this issue carries the key, so a first-writer-wins check on key *presence*
would have fired only on documents written before provenance existed — i.e.
never, going forward. Caught by the test that fills an unfiled document.

**A circular import that does not look like one.** Putting `UnknownJobError` in
`schemas/provenance.ts` and re-exporting it made `error → doc → provenance →
error`: `StaleKeyError` carries a whole `Doc`. The symptom was not an import
error but 1213 tests failing with *"Invalid element at key `origin`: expected a
Zod schema"* — a half-initialised schema at route registration. The shape lives
in `schemas/error.ts` with the rest of the `ApiError` union, where it belongs
anyway: a client narrowing on `code` has to be able to reach it.

**`job` had to be threaded through both media types.** `threadRequestBody` maps
JSON and multipart separately, and a field added to one and not the other is the
standing failure mode this repo has hit before.

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0)
- [ ] Committed with `[SERVER-110]` prefix
