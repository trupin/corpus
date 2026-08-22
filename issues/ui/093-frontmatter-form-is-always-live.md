# [UI-093] Frontmatter controls are always live and save on change

## Domain

ui

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-030 (rider must be signed first)
- Blocks: UI-092

## Spec References

- SPEC.md §11 line 467 — as amended by SHARED-030
- SPEC.md §4 — autosave, idle-squashed commits
- SPEC.md §7 — locks freeze every control

## Summary

Opening a document and changing its status, due date or tags currently requires
clicking an `edit` chip, changing the field, and clicking Save. The body beside
it has accepted a keystroke and autosaved since UI-006. This issue removes the
mode: the controls are live whenever the document is, and each change commits
through the same `PUT` path the Save button used, debounced for free-text fields
and immediate for discrete ones.

## Acceptance Criteria

- [x] The `edit` chip is gone from the frontmatter chip row
- [x] The Save button is gone
- [x] Status and due render as live controls whenever the reader shows the
      document — no click required to reach them
- [x] Changing status or due issues the `PUT` immediately (no debounce — a
      select and a date picker produce one deliberate value, not a keystroke
      stream) — **amended for an empty date**, see Decision 1
- [x] Changing title or tags issues the `PUT` debounced at `AUTOSAVE_DEBOUNCE_MS`
      (700 ms, imported from `apps/ui/src/editor/useAutosave.ts` — **not** a
      second constant)
- [x] A frontmatter change and a body change in the same idle window land in
      **one** commit, per §4
- [x] A failed save is visible and retryable without a Save button, using the
      body's existing `SaveChip` treatment rather than a new one
- [x] ~~Under a lock held by the other party~~ — **void**: SHARED-041 replaced
      locks with keys and §11 makes the board never read-only. The surviving
      not-editable state is a *field* lock with a stated reason (`statusLock`),
      which is what SHARED-030's derived-field clause asks for
- [x] Leaving the document mid-debounce still flushes the pending change (the
      current exit-flush guarantee is not weakened)
- [x] No regression to the "empty document does not survive leaving it" rule
      when a title is cleared

## Decisions taken, and what they rejected

### 1. Which changes commit at once, and which wait

**Taken:** the question is asked of the **change**, not of the control
(`isDeliberate`). A `<select>` always commits at once. A free-text field never
does. A date input commits at once **unless its value is empty**, and then it
waits out the debounce.

**Rejected — "a date picker is discrete, so every change commits":** Chromium
fires a change per *segment* of a date field and reports `value === ""` until
every segment is filled, so typing `2026-10-01` on a document that already has a
deadline would issue `due: null` first and clear it on the way to setting one.
Empty is also exactly what *clearing* the field looks like, and the two are
indistinguishable at the moment they arrive.

**Rejected — "debounce the date like free text":** it costs the criterion's
immediacy for a picked date, which is one deliberate act with nothing following
it, and it makes the rule "some controls are discrete except the ones that are
not" rather than one sentence about values.

### 2. What a failed save looks like

**Taken:** the frontmatter gets the body's `SaveChip`, rendered **in its own chip
strip**, exactly where the `edit` chip used to sit. `SaveChip.tsx` grew a
presentational `SaveChipView` and the head's chip now calls it — one
implementation, two mounting points, so the copy, the reserved box and the nested
retry button cannot drift. A refusal keeps every value the person set, so the
controls still show them, and the retry re-sends the whole patch.

**Rejected — publishing into the head's `SaveStatusProvider`:** that context has
one slot and is last-writer-wins. A body save landing after a frontmatter
refusal would erase the only report that some of the person's text is not on
disk — the silent discard this criterion exists to prevent.

**Rejected — a per-field inline error message:** it reflows the form every time
it appears (SHARED-057), and one request carries up to four fields, so it would
mean four messages for one failure.

**Not in the reader head.** That row is at its limit (UI-135) and nothing new was
put in it — confirmed by `reader-head-geometry.spec.ts` (7/7) and by measuring
`.fm-chips` for overflow.

### 3. Coalescing

**Taken:** the form coalesces **requests** and nothing else. Every control writes
into one local patch, one `PUT` is ever on the wire, and a change made during one
is queued rather than raced. Commit coalescing is **§4's**, not this form's: the
open commit window already joins these writes to each other and to a body edit
made in the same sitting. Measured — five separate writes in the live workspace
produced exactly one `doc edit` commit.

**Rejected — a batching window of the form's own** ("wait for quiet, then send
one request"): that is §4's rule written a second time on the client, and this
repo has been bitten repeatedly by one rule written twice. It would also delay
every deliberate change by a window nobody asked for.

**Rejected — one request per field:** four `PUT`s racing, four edit-write
brackets, and it defeats SERVER-001's untouched-key guarantee from the client
side.

### 4. (Consequential) Escape, and the field a nobody may set

Escape used to revert the draft. With no draft there is nothing to revert, and
the escape chain deliberately ignores keys typed inside a field — so Escape in
the title would have done *nothing at all*. It now **leaves the field**, which is
the rule `DocEditor` already follows for the always-editable body: first press
blurs, second reaches the chain. `Reader.test.tsx`'s Escape test was rewritten
to the new truth.

`statusLock(doc)` is the one place that decides whether the status control is the
person's to set, and `Field` renders the reason beneath any locked control. The
archive boundary is its first user. **UI-092's derived status is its next one** —
a field can be rendered, populated and uneditable with a stated reason without
touching anything else.

## Technical Design

### Files to Create/Modify

- `apps/ui/src/reader/FrontmatterForm.tsx` — remove `editing` state and the
  draft; controls read from `doc` and write on change. The doc comment at the
  top describing the draft ("The draft outlives no surface…") describes
  machinery this issue deletes — rewrite it, do not leave it describing a
  mechanism that is gone.
- `apps/ui/src/reader/FrontmatterForm.test.tsx` — tests are written against the
  edit/save flow; they need rewriting rather than patching.
- `apps/ui/src/editor/editSessionFlush.ts` — the form participates in the exit
  flush today via the draft. Re-point it at the pending debounce, or drop its
  participation if the debounce's own flush covers it. **Do not leave both.**

### What actually changed

- `apps/ui/src/reader/FrontmatterForm.tsx` — rewritten. `editing` and the draft
  are gone; a `local` map of touched fields overlays the document, one patch is
  ever on the wire, and the doc comment describes the mechanism that is there.
- `apps/ui/src/reader/FrontmatterForm.test.tsx` — rewritten (44 tests).
- `apps/ui/src/reader/Reader.css` — the form is a grid of equal fractions of the
  reading measure; `.fm-edit-toggle`, `.fm-actions`, `.fm-save` and `.fm-revert`
  are deleted; `.fm-chips .save-chip` and `.fm-input:disabled` are new.
- `apps/ui/src/editor/SaveChip.tsx` — **additive**: `SaveChipView({state,
  onRetry, surface})` is extracted and `SaveChip` delegates to it. `data-save-chip`
  now carries `"body"` or `"frontmatter"`; every existing selector tests for the
  attribute's presence and is unaffected.
- `apps/ui/src/reader/Reader.test.tsx` — one test rewritten (Escape, Decision 4).
- `apps/ui/src/testing/readerFixture.ts` — the `PUT` stub now **applies** the
  frontmatter delta instead of echoing the document back. It had to: a live
  control reads its value from the document the response carries, so a stub that
  answered with the document as it was would have let a form that dropped the
  person's value pass.

**`editSessionFlush.ts` is unchanged, and there is exactly one flush path.** Its
`beginEditWrite`/`endEditWrite` bracket and `useEditSurface` are load-bearing
(UI-012's unmount seam) and still open and close around every write. What used to
flush *the draft* on unmount and `pagehide` now flushes *the local map* — the
same seam, one mechanism, not two.

### Key Implementation Details

The `PUT` path, the mutation, the `beginEditWrite` / `endEditWrite` bracket and
the lock freeze all stay exactly as they are — this issue changes **when** the
mutation fires, not what it does. The edit-session bracket in particular is
load-bearing (UI-012's unmount seam) and must still open and close around every
write.

Coalescing matters: four rapid changes to four different fields must not issue
four `PUT`s that race. Accumulate changed fields into one pending patch and send
it as a single request, the way the current Save sends all four at once.

### Edge Cases

- Two changes to the same field inside one debounce window — last value wins,
  one request.
- A change made while a previous `PUT` is in flight — queue it rather than
  dropping it or sending concurrently.
- A change made while the document is being unmounted — the exit flush must
  still send it (this is the current guarantee, and the reason the draft
  existed).
- A status value that becomes invalid because the document's type changed under
  the reader via SSE — the control re-renders from the server's answer, never
  from a local draft that no longer exists.

## Testing Strategy

Vitest + Testing Library in `FrontmatterForm.test.tsx`: changing the status
select fires one `PUT` with only `status`; typing in tags fires nothing before
700 ms and one request after; changing two fields inside one window sends one
request carrying both; a rejected request surfaces the failure state; a locked
document renders every control disabled and issues nothing.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. `npm run dev -w apps/cli` against a real workspace, open the board
2. Open any note in a column reader
3. Observe: status shows as a chip; changing it requires clicking `edit`
4. Expected: the status control is live and a change saves itself
5. Actual: an edit mode with a Save button

### Verification Steps

1. Restart the app; open a note in a column reader
2. Change status `open` → `resolved` — no `edit` click first; confirm the chip
   updates and `git log` in the workspace shows the committed change
3. Change the due date; confirm one further commit (or one squashed commit if
   inside the same idle window, per §4)
4. Type a tag; confirm no request before ~700 ms and one after
5. Change title and status together quickly; confirm **one** `PUT` in the
   network panel and one commit
6. Have the agent take the lock (`corpus lock acquire --from agent`); confirm
   every control is disabled with the holder named
7. Change a field and immediately navigate away; confirm the change is on disk

## E2E Verification Log

**Model:** Opus 5 (1M context), 2026-08-22. Branch `phase-40-derived-status`.

### Reproduction (before the change)

Read from the shipped source rather than re-run, because the defect is not
timing-dependent: `FrontmatterForm.tsx` held `const [editing, setEditing] =
useState(false)`, rendered `.fm-form` only under `{editing ? … : null}`, and put
the tags/status/due controls behind a `.fm-edit-toggle` chip labelled `edit`
with a `.fm-save` **Save** button and a `.fm-revert` **Revert** beside it. The
body beside it has autosaved since UI-006.

### The rig

- Scratch workspace: `corpus init … --port 8791` (never 8765 — the user's live
  server), then `corpus server start` → `corpus 0.16.0 listening on
  http://127.0.0.1:8791 (pid 87763)`.
- Real UI: `vite --port 5474 --strictPort` with
  `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8791` and `VITE_CORPUS_TOKEN` from the
  workspace config.
- Real Chromium via Playwright, watching the network.
- One document created through the API: `doc_r75zkzbs`,
  `data/docs/inbox/mortgage-options.md`, `status: open`, `tags: [finance]`.
- **Note for whoever runs this next:** the first server start on this branch
  crashed every write with `ReferenceError: convergeDerivedStatus is not defined`
  (`apps/server/src/docs/write.ts`), a transient half-written state from the
  agent working on UI-092's server side. Restarting the server cleared it.
  Nothing in this issue touched `apps/server`.

### Observed

```
--- 1. the controls are live with no click first ---
status control visible: true | tags: true | due: true
edit chip present: 0
save button present: 0
frontmatter chip in the strip: 1
--- 2. change status open -> resolved, no edit click ---
chip after status change: "committed · git ✓"
PUTs so far: 1 | first body: {"status":"resolved"} | latency ms: 5
status chip in strip now: resolved
select value now: resolved
--- 3. type a tag: nothing before 700ms, one request after ---
PUTs 400ms after the last keystroke: 0
PUTs 1000ms after the last keystroke: 1 | body: {"tags":["finance","mortgage"]} | fired after ms: 706
--- 4. title and due changed together, quickly ---
requests: 1 | bodies: {"title":"Mortgage options 2026","due":"2026-10-01"}
--- 5. change a field and navigate away immediately ---
requests after leaving: 1 | bodies: {"title":"Typed and left"}
```

**The file on disk**, `data/docs/inbox/mortgage-options.md`, after those five
changes — every one of them made by a control with no `edit` click and no Save:

```yaml
id: doc_r75zkzbs
type: note
title: Typed and left
created: 2026-08-22T02:47:25Z
updated: 2026-08-22T02:48:27Z
tags:
  - finance
  - mortgage
status: resolved
due: 2026-10-01
```

**And the workspace's git log** — §4's commit window squashed all of it into one
entry, with no batching window on the client:

```
70cbfe2 user <user@corpus.local> doc edit: Typed and left (doc_r75zkzbs) by user
8a930e6 user <user@corpus.local> editing session: 1 document by user
532d9bc user <user@corpus.local> workspace: initialize corpus workspace by user
```

### The failure path, in the same running app

Every `PUT` refused at the network with a `500`, two fields changed, then the
refusal lifted and the chip's retry clicked:

```
chip says: "save failed — retry"
chip title: "the server refused the save"
retry is a real button: 1
tags field still holds: "finance, mortgage, refused"
status field still holds: "open"
retry sent: {"tags":["finance","mortgage","refused"],"status":"open"}
chip width failed vs committed: 120.109375 120.109375
```

Nothing was discarded, and the chip's box is the same 120.11px in both states.

### Geometry (SHARED-057 and SHARED-061), measured

Column pinned so the room is constant, then a 66-character tag value typed and
the status changed:

```
before: form 527.2 | tags 169.06 | status 169.06 | due 169.06 | overflow false
after : form 527.2 | tags 169.06 | status 169.06 | due 169.06 | overflow false
control widths unchanged: true
form stays inside the column: true
```

At the narrow end (300px column) the grid drops to one column and every field is
still whole: `form 276.58 | overflow false | inside the column true`. The bound
is `--doc-measure` and a `16ch` floor, not a pixel constant.

`reader-head-geometry.spec.ts` — 7/7 green. The head gained nothing.

### Checks

- `vitest run apps/ui/src/reader/FrontmatterForm.test.tsx` — 44 passed.
- `vitest run apps/ui/src` — **154 files, 3344 tests, all passed.**
- `playwright test --workers=1` (full suite, `CORPUS_UI_PORT=5373`) — exit 0;
  re-run of the five affected specs — **58 passed**.
- `tsc --noEmit -p apps/ui` — clean. `eslint` — no issues. `prettier` — clean.

### Falsification — each mutation applied, the suite run, then reverted

| Mutation | What went red |
| --- | --- |
| `isDeliberate("status")` returns `false` | 3 tests, incl. "issues the PUT the moment a status is picked" |
| a failure clears the local map | "says so, keeps every typed value, and retries the whole patch" |
| send concurrently instead of queueing | "orders two deliberate changes rather than racing them" |
| drop the read-your-write publish and the settle-clearing | 5 tests, incl. "publishes the server's document" |

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[UI-093]` prefix
