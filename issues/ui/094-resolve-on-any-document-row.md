# [UI-094] Right-clicking a document offers no Resolve, though every document has one

## Domain

ui

## Status

todo — **blocked on one design answer**, see "Blocked: where the settable-status
predicate lives" below. Reproduction, the direction of the inconsistency, and the
derived-status decision are all settled and recorded here.

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SHARED-031 (rider must be signed first)
- Related: PLUGINS-016 / UI-092 — a derived-status type must be excluded

## Spec References

- SPEC.md §5 — as amended by SHARED-031: one status vocabulary for every type
- SPEC.md §11 — the reader ⋯ menu and the row context menu
- SPEC.md §11 — the bulk-selection rider's Resolve clause, as corrected by
  SHARED-031

## Summary

Right-clicking a note offers Open, Open in focus, Archive and Delete — no
Resolve. Opening the same note and using the frontmatter form's status dropdown
resolves it without complaint, because `DOC_STATUSES` is type-independent and
the write path gates only on leaving `archived`. One reader, two surfaces, two
different answers about whether a note has a status.

This issue makes the menu agree with the contract.

## Reproduction (confirmed by inspection)

`apps/ui/src/menu/docActions.ts:154` — `if (isThread) { list.push({ id:
"resolve", … }) }`, where `isThread = subject.type === THREAD_DOC_TYPE` (line
119). Every non-thread document is excluded regardless of what its status can
hold.

## Acceptance Criteria

- [ ] Resolve / Reopen appears in the row context menu for **any** document
      whose status is stored, not only threads
- [ ] It appears on the reader's ⋯ menu on the same terms (both surfaces are
      built from `useDocActions`; they must not diverge again)
- [ ] The label flips to Reopen on an already-resolved document, as it does for
      threads today
- [ ] A resolved document **stays visible** in the list it was in — per
      SHARED-031, resolving is not a way to hide something. Confirm no column
      query silently filters it out; if one does, that is a separate finding to
      file, not something to fix by hiding the action
- [ ] It is **not** offered on a document whose type derives its status
      (PLUGINS-016) — there is nothing there for anyone to set
- [ ] It is not offered on an archived document (the write path refuses leaving
      `archived` via `PUT`; offering it would promise a refusal)
- [ ] Threads keep their existing behaviour exactly, including whatever
      `useSetThreadStatus` does beyond the status write

## Which way the inconsistency runs — measured, not assumed

The issue's summary says "one reader, two surfaces, two different answers". The
two surfaces are **not** the row menu and the ⋯ menu. Measured in a real browser
(see the E2E log), those two agree with each other exactly, because both are
built from `useDocActions`:

| subject | row context menu | reader ⋯ menu |
| --- | --- | --- |
| open note | open · open-focus · archive · delete | comments · review · archive · delete |
| resolved note | open · open-focus · archive · delete | comments · review · archive · delete |
| todo | open · open-focus · archive · delete | comments · review · archive · delete |
| thread | open · open-focus · **resolve** · archive · delete | comments · review · **resolve** · archive · delete |
| archived note | open · open-focus · unarchive · delete | — |

So SPEC.md §11's *"exactly that item's existing actions — the same set its ⋯ /
header menu offers"* is **already satisfied between the two menus**. The
divergence is between **both menus** and the **frontmatter form's status
control**, which since UI-093 is live on every document: on a `type: note` the
`<select>` is enabled, reads `open`, and offers `["open", "resolved"]`.

SHARED-031 settles which half is wrong: `status` is one vocabulary, every
document has a `resolved` state, and the write path gates only on leaving
`archived`. **The form is right and both menus are wrong.** The fix therefore
belongs in `useDocActions` alone, and both surfaces move in the same commit —
fixing either separately would create the divergence §11 forbids, which does not
exist today.

## Decision — a document whose type derives its status

**Chosen: omit the Resolve item entirely.** No item, no disabled item, no
explanatory meta line.

The reason is signed spec text. SHARED-031 part 2, applied to §11: *"A type whose
status is **derived** rather than set (§12) is such a case: it offers no Resolve,
because there is nothing there for anyone to set."* "Offers no Resolve" is a
statement about the menu, not about the form. It also matches what the menu
already does with the other unsettable status — an archived document's menu drops
Resolve and offers Unarchive instead, with no explanation of the omission.

**Rejected: show Resolve disabled, with the derivation as its meta line.** The
argument for it is SHARED-036 — *"the status control shows the derived value and
says it comes from the items"* — and the worry that a silent omission teaches a
user nothing. Rejected because:

1. SHARED-036's sentence is explicitly about **the status control**, which is the
   frontmatter form's `<select>`. That is where UI-092 renders the value and names
   its source, and that is where a user who asks "why can I not change this?"
   already gets an answer. The menu does not need to answer it twice.
2. §11's context-menu rule is *"exactly that item's existing actions"*. A
   permanently inert row is not an action, it is a caption wearing an action's
   clothes.
3. The menu already scrolls (see the height finding below). Every item that is
   not an act pushes a real one out of view.

**Where the exclusion is read from**: PLUGINS-016 landed the declaration —
`PluginDocType.deriveStatus`, resolved through `usePluginRegistry().docTypes`. The
issue's fallback ("gate on the doc type being `todo` as a named temporary") is
therefore **not** needed and must not be used.

## Blocked: where the settable-status predicate lives

`statusLock(doc: Doc): FieldLock | null` (UI-093, `FrontmatterForm.tsx`) answers
exactly this issue's question, and its own doc comment claims to be the single
home: *"this is the one function that decides the question for every caller"*, and
*"A **derived** status (SHARED-036, UI-092) belongs here too and is not here
yet"*.

It **cannot be called from `useDocActions` as it stands**, for two reasons:

1. **Its parameter is a whole `Doc`, and a row has none.** `RowSubject` is
   `{id, title, type, status, staleLevel}`, built either from a `DocRow` or —
   on the keyboard path — read back off the painted row's `data-` attributes
   (`subjectFromElement`). Neither can produce a `Doc`. Fetching one to draw a
   menu would put a request and a flicker on a right-click, on a surface whose
   whole job is to appear instantly. The function reads only
   `doc.frontmatter.status`, so the honest parameter is `{type, status}`.
2. **The derived branch needs the plugin registry**, which a pure function taking
   a `Doc` has no way to reach. UI-092 will hit this too: the declaration lives in
   `usePluginRegistry().docTypes`, not on the document.

So `statusLock` needs to change shape and move out of a React component module —
both changes to a file this issue was told not to touch. **The predicate must not
be copied**: a second function deciding "may this status be set" is the shape that
produced PR #48's CRITICAL.

**Proposed answer, for the orchestrator to accept or replace** — new file
`apps/ui/src/doc/statusLock.ts`:

- `export interface FieldLock { readonly reason: string }` — moved verbatim.
- `export interface StatusSubject { readonly type: string; readonly status: string }`
- `export function statusLock(subject: StatusSubject, registry: PluginRegistry): FieldLock | null`
  — the archived branch unchanged, and UI-092 adds the derived branch here, once.
- `export function useStatusLock(subject: StatusSubject): FieldLock | null` —
  `statusLock(subject, usePluginRegistry())`, so both surfaces re-render when
  discovery settles.

`FrontmatterForm.tsx` then changes by three lines: import instead of define, and
`const lock = useStatusLock(doc.frontmatter)`. `useDocActions` calls the same hook
with its subject and drops Resolve when it returns non-`null`. UI-092 gets
strictly smaller.

## Finding (not this issue's to fix) — the context menu is capped at 200px

Measured, since SHARED-057 / SHARED-061 govern anything drawn here.
`apps/ui/src/menu/menu.css` sets `.ctx-menu { max-height: min(60vh, 420px) }`, and
UI-142 recorded that `420px` as a latent finding. **The rule never applies.**
`@corpus/kit`'s `autocomplete.css` sets `.ac-menu { max-height: 200px }`; both
selectors are one class, so specificity ties and source order decides, and the
kit's stylesheet loads last.

In a 720px viewport, a row menu with **five** items already overflows:

```
{ "items": 5, "clientHeight": 198, "scrollHeight": 253, "maxHeight": "200px", "viewport": 720 }
```

So the effective bound is not the one the file names, and it is a chosen number
rather than one taken from the room — SHARED-061's exact complaint. This issue's
change adds a sixth item to a note's row menu, which makes an already-scrolling
surface scroll further, but does not cause the defect. It wants its own issue,
alongside UI-143.

## Technical Design

### Files to Create/Modify

- `apps/ui/src/menu/docActions.ts` — replace the `isThread` gate
- `apps/ui/src/menu/docActions.test.ts`

### Key Implementation Details

**Threads and documents take different write paths today.** Resolve currently
runs `useSetThreadStatus`; a note's status is written through the ordinary
document `PUT` the frontmatter form uses. Do not route notes through the thread
mutation — check what `useSetThreadStatus` does beyond writing status (read
state, Attention, SSE invalidation keys) before assuming the two are
interchangeable. The menu picks the right mutation for the subject; it does not
unify them.

The derived-status exclusion needs PLUGINS-016's declaration. If UI-094 lands
first, gate on the doc type being `todo` as a **named temporary** with a comment
pointing at PLUGINS-016 — do not invent a second mechanism that then has to be
removed.

> **Superseded 2026-08-21.** PLUGINS-016 landed (`6004451e`) before this issue
> was picked up. The declaration is `PluginDocType.deriveStatus`, resolved
> through `usePluginRegistry().docTypes`. **Do not use the `todo` temporary.**

**The write path, checked as the paragraph above asks.** `useSetThreadStatus`
calls `POST /api/threads/{id}/resolve|reopen`, which rewrites and commits the
thread file (SPEC.md §6), and invalidates `threadKey`, `docKey` **and**
`DOCS_KEY` — three keys, because a thread is also a row with a status chip and an
unread badge. A note has no such route: its status is the ordinary
`PUT /api/docs/{id}`, bound as `useUpdateDoc(subject.id, callbacks)`, which
invalidates `docKey` + `DOCS_KEY` through the shared `invalidateDoc`. Both hooks
take **teardown-safe** `SettledCallbacks`, which the menu needs because it closes
in the same click that writes (UI-012). So the menu holds both mutations and
picks by subject type. It does not unify them, and a note must not be sent
through the thread route.

**A resolved document stays in its list** (acceptance criterion 4), checked at
the query layer: `apps/server/src/docs/filters.ts` has exactly one default
lifecycle exclusion, `notArchivedSql` — `status <> 'archived'`. Nothing excludes
`resolved`. Confirm it live once the action exists.

### Edge Cases

- A document type nothing recognises — takes the same three statuses; offers
  Resolve.
- A `view` or `template` document — same. If resolving one of these is
  meaningless in practice, that is an argument to make in SHARED-031, not a
  special case to bury in the menu.
- A locked document — refused as any other write is, naming the holder.
- Bulk selection — once UI-083 is built (per SHARED-032), Resolve must be
  offered on mixed selections per SHARED-031 part 2. Not this issue's work, but
  do not add a gate that would block it.

## Testing Strategy

Vitest: the menu for a note includes Resolve; for a resolved note, Reopen; for a
thread, unchanged behaviour and the thread mutation; for an archived document, no
Resolve; for a derived-status type, no Resolve. Assert which mutation each
subject dispatches, not just that the item renders.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start the app; right-click a `note` row in a folder column
2. Expected: a Resolve action
3. Actual: Open, Open in focus, Archive, Delete — no Resolve, while the same
   note's frontmatter dropdown resolves it fine

### Verification Steps

1. Restart the app; right-click a note row
2. Resolve it — confirm the file's frontmatter reads `status: resolved`, one
   commit was made, and **the row is still in the column**
3. Right-click it again — confirm the action now reads Reopen, and reopening
   reverts both the file and the menu
4. Repeat from the reader's ⋯ menu; confirm identical behaviour
5. Right-click a thread row — confirm unchanged behaviour end to end
6. Right-click an archived document — confirm no Resolve
7. Right-click a todo document — confirm no Resolve (or the temporary gate, with
   its comment, if PLUGINS-016 has not landed)

## E2E Verification Log

**Model: Opus 5 (1M context).** Implementation is **not** done — the session
stopped at the design question above, as instructed. What follows is the
pre-fix reproduction and the measurements it produced.

### Pre-fix reproduction, in a real browser

A temporary probe spec (`apps/ui/e2e/ui094-probe.spec.ts`, written, run, and
deleted) drove Chromium through Playwright against the isolated Vite dev server
(INFRA-028, no workspace server reachable):

```
cd apps/ui && CORPUS_UI_PORT=5673 npx playwright test e2e/ui094-probe.spec.ts --workers=1
```

It stubbed one folder column plus an archive column, then right-clicked each row
and read back every `[role="menuitem"]`'s `data-act`:

```json
{
  "open note":             ["open", "open-focus", "archive", "delete"],
  "resolved note":         ["open", "open-focus", "archive", "delete"],
  "todo (derived status)": ["open", "open-focus", "archive", "delete"],
  "thread":                ["open", "open-focus", "resolve", "archive", "delete"],
  "archived note":         ["open", "open-focus", "unarchive", "delete"]
}
```

**Confirmed**: no Resolve on any non-thread row, and the label already flips
correctly for threads. A resolved note is indistinguishable from an open one in
its menu.

The same probe opened each document and clicked `[data-doc-menu]` — the reader's
⋯ button:

```
note:          ["comments","review","archive","delete"]
resolved note: ["comments","review","archive","delete"]
todo:          ["comments","review","archive","delete"]
thread:        ["comments","review","resolve","archive","delete"]
```

**So the ⋯ menu is not the correct half.** It refuses exactly what the row menu
refuses, because both read `useDocActions`. See "Which way the inconsistency
runs" above.

### The other half of the contradiction, measured

The same note, reader open, reading its frontmatter `<select>` directly:

```json
{ "disabled": false, "value": "open", "options": ["open", "resolved"] }
```

A live control offering `resolved` on a `type: note`, three inches from a menu
that says the document has no such action.

### Menu height, since SHARED-057 / SHARED-061 apply

Measured on the tallest row menu reachable today, 720px viewport:

```json
{ "items": 5, "clientHeight": 198, "scrollHeight": 253, "maxHeight": "200px", "viewport": 720 }
```

`menu.css` asks for `min(60vh, 420px)` and gets `200px` — see the finding above.
The **maximum item count** does not rise from this change: a stale thread row
already reaches the longest list, and the fix only lets a stale note reach the
same length.

### Not verified, because not implemented

- A real document resolved from a row menu, and the file on disk showing
  `status: resolved`.
- The commit that write produces.
- Reopen from the same menu.
- A todo row offering no Resolve after the fix.
- Falsification of the new tests.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Pre-fix reproduction logged
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[UI-094]` prefix
