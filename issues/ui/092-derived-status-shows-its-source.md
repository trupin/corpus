# [UI-092] A derived status shows its value and its source, and nobody can edit it

## Domain

ui

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SHARED-036 (rider must be signed first), SHARED-030 (rider must be signed first), PLUGINS-016, SERVER-085,
  UI-093
- Blocks: —

## Spec References

- SPEC.md §12 — as amended by SHARED-036: "the status control shows the derived
  value and says it comes from the items"
- SPEC.md §10 — as amended by SHARED-030: a derived field "is editable by
  nobody — that is not an edit mode, it is a field that was never the person's
  to set"

## Summary

UI-093 makes every frontmatter control live. For a `todo` document the status
control must not be live — its value comes from the items, and offering a
dropdown would offer a change the write path would immediately undo. This issue
renders that case: the value, plus a plain statement of where it comes from.

The scope is narrow deliberately. It is the visible half of SHARED-036, and it
is worth its own issue because it is the one place where "always editable" and
"derived" meet, and getting it wrong reads as either a bug or a lie.

## Acceptance Criteria

- [x] On a document whose type declares a derived status, the status control
      renders the derived value and is **not** interactive — not a disabled
      dropdown that looks momentarily clickable, but a control that reads as a
      statement
- [x] It says where the value comes from, in words, next to the value (the
      DocPanel's existing voice is the reference — "derived from the items", not
      an icon alone)
- [x] The row's status chip agrees with it, and with the board, and with the
      DocPanel's counts on the same screen
- [x] Checking the last item updates the control **without a reload**, via the
      same SSE invalidation that updates the DocPanel counts
- [x] An archived todo document shows `archived`, and the control still explains
      that `archived` is the stored decision rather than a derived value
- [x] A document whose items are unreadable falls back to an ordinary editable
      status control — there is nothing to derive from, so the field is the
      person's again
- [x] With `plugins/todos/` deleted, a todo document's status control is an
      ordinary editable one (§12 M6) — covered by unit tests against
      `EMPTY_REGISTRY`, which is exactly the registry a deleted plugin leaves
- [x] The frontmatter form's other controls are unaffected and stay live

## Decision — one predicate, and a form that may ask a sharper question

**Made by the orchestrator, 2026-08-21, on UI-094's hand-off.** UI-094 left this
issue's criterion *"a document whose items are unreadable falls back to an
ordinary editable status control"* unmet, because `statusLock` reads the
**declaration** (does this type derive?) and not the **derived value** (can it
derive for this document?). Answering the second needs the body, and a row
subject carries only `{type, status}`.

**Chosen: the two surfaces may differ, and they differ in exactly one case.** No
third field was added to the shared subject.

- **The menu stays conservative.** A type that declares derivation offers no
  Resolve. A row cannot know more without a request and a flicker on a
  right-click, and being conservative errs toward not offering an act that would
  be refused.
- **The form consults the derivation**, because it holds the `Doc`. Where the
  items cannot be read the derivation returns nothing, §12's "the stored value
  stands" applies, and the control is an ordinary editable one.

**How that was built without forking the predicate.** `statusLock(subject,
registry)` still answers the declaration-level question for both callers, and
nothing else decides "is this locked". The form calls `formStatusLock(doc,
registry)`, which *calls* `statusLock` and may only ever **narrow** its answer —
it never locks a field the shared predicate left open, and it never touches an
`archived` lock. A test asserts that narrowing property over a table of
subjects, so a future rival predicate cannot grow here quietly.

`FieldLock` gained a `kind` (`"archived" | "derived"`) so both the composition
and the rendering branch on the *kind* rather than on the wording of the reason.
That was needed for correctness, not tidiness: `deriveStatus` returns `null` for
an archived document **by rule**, so a check that only asked "did it derive?"
would have unlocked a field the write path refuses outright (SERVER-039).

**What the divergence costs, stated plainly.** The two surfaces disagree for a
**legacy, unmigrated todo whose `items` key no longer parses** — the row menu
offers no Resolve, the form offers an ordinary control. That is rare, it is in
the safe direction (the menu withholds rather than promises), and a person can
still resolve such a document, from the form. Both halves were measured in the
real app — see the log below.

One thing the reproduction taught: a **well-formed** legacy `items` key is *not*
this case. `readItems` reads those items fine and the derivation applies, so the
statement is shown. Only the malformed key (`todos-legacy.spec.ts`'s state 2)
declines.

## Technical Design

### Files to Create/Modify

- `apps/ui/src/reader/FrontmatterForm.tsx` — read the declaration PLUGINS-016
  adds and branch the status control on it
- `apps/ui/src/reader/FrontmatterForm.test.tsx`
- ~~wherever the row-level status chip is rendered~~ — **no change needed**. The
  row and the chip strip already read `status` off the resource the server sends,
  and SERVER-085 puts the derived value there, so nothing re-derives. Confirmed
  live: the row's `data-row-status` and the strip's chip both moved to `resolved`
  in the same frame as the statement.

**As built**, the file list is:

- `apps/ui/src/doc/statusLock.ts` — `FieldLock.kind`, the derived-type archived
  reason, `formStatusLock`, `useFormStatusLock`
- `apps/ui/src/doc/statusLock.test.ts`
- `apps/ui/src/reader/FrontmatterForm.tsx` — `StatusStatement`, the branch
- `apps/ui/src/reader/FrontmatterForm.test.tsx`
- `apps/ui/src/reader/Reader.css` — `.fm-statement`
- `apps/ui/e2e/derived-status.spec.ts` — **new**

### Key Implementation Details

The UI reads the declaration from the **client-side manifest** it already loads
with `import.meta.glob`, so no contract change is needed and no API field has to
carry "is this derived". The *value* comes from the server (SERVER-085 already
puts the derived status on the resource); only the "is it editable" question is
answered locally.

Do not re-derive the value in the UI. Two derivations is two chances to
disagree, and the DocPanel's own doc comment already states the principle: it
derives and never stores, from the same body the editor renders.

### Edge Cases

- The plugin manifest fails to load (a broken plugin, contained at discovery) —
  the control falls back to editable. It must never render permanently
  uneditable because a declaration could not be read.
- A type declaring derived status where the server sends a value that could not
  have been derived (version skew between server and UI) — show what the server
  sent; never correct it locally.

## Testing Strategy

Vitest + Testing Library: a todo doc with all items done renders a
non-interactive `resolved` with its source named; with one open item, `open`;
archived renders `archived`; unreadable items render an editable control; a note
renders an editable control. Assert no mutation is issued from any of the
non-interactive cases.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start the app; open a todo document with every item checked
2. Expected: status reads `resolved`, derived, not editable
3. Actual (today): status reads `open` in an editable dropdown behind an `edit`
   chip — the screenshot that opened SHARED-036

### Verification Steps

1. Restart the app; open a todo document with one open item
2. Confirm status reads `open`, non-interactive, source named
3. Check the last item **in the body editor**; confirm the control flips to
   `resolved` with no reload, at the same moment the DocPanel reads `0 OPEN`
4. Uncheck it; confirm it flips back
5. Archive the document from the ⋯ menu; confirm `archived`
6. Delete `plugins/todos/`, restart, reopen; confirm an ordinary editable control
   and a booting app

## E2E Verification Log

**Model: Opus 5 (1M context).** Branch `phase-40-derived-status`. Nothing was
committed by this agent.

### What was built

- `apps/ui/src/doc/statusLock.ts` — `FieldLock.kind`, an archived reason that
  names itself as *not* a reading of the content on a derived type, and
  `formStatusLock` / `useFormStatusLock` composed on top of `statusLock`.
- `apps/ui/src/reader/FrontmatterForm.tsx` — a `derived` lock renders
  `<output class="fm-statement">` carrying the server's value instead of a
  `<select>`. An `archived` lock keeps the (disabled) control, because there
  *is* an act and it lives on another route.
- `apps/ui/src/reader/Reader.css` — `.fm-statement`: the control's metrics, none
  of its chrome, and a width that is the grid cell's.
- `apps/ui/e2e/derived-status.spec.ts` — 4 specs.

### Unit tests

```
vitest run apps/ui/src/doc/statusLock.test.ts             → 18 passed
vitest run apps/ui/src/reader/FrontmatterForm.test.tsx    → 50 passed
vitest run apps/ui/src/{menu,doc,reader,plugins}          → 31 files, 489 passed
tsc --noEmit -w apps/ui                                   → clean
eslint + prettier on every touched file                   → clean
```

### Falsification — three mutations, each caught

1. **Render the disabled select anyway** (`lock?.kind === "derived"` → `false`):
   `states the value where the control was…` and `follows the document when the
   last item is checked…` both fail.
2. **Drop the form's extra check** (`formStatusLock` returns the lock
   unconditionally): 3 fail, including the e2e-adjacent unit case `hands the
   field back where the items cannot be read`.
3. **Release the archived lock** (`lock.kind !== "derived"` guard removed):
   `never releases an archived document, though the derivation declines for it
   too` fails — the trap this composition exists to avoid.
4. **`.fm-statement { width: max-content }`** (SHARED-057): the Playwright
   geometry case fails, reporting the statement widening `47.3px → 67.9px` when
   `open` became `resolved`.

### Playwright, against the real UI (`CORPUS_UI_PORT=5773`, `--workers=1`)

```
e2e/derived-status.spec.ts                                    → 4 passed (10.9s)
e2e/{todos,todos-menu,todos-legacy,reader,context-menu,doc-width}.spec.ts
                                                              → 76 passed (1.5m)
```

One finding while writing them, recorded because it will bite the next geometry
spec: **the column widens over a transition when a reader opens in it**, so a
box measured too early reads the column still arriving. Measured that way the
flip appeared to resize the form by 82px, none of it the statement's doing. The
spec settles the form's box (UI-127's helper) before and after.

### Real-app drill — a real `corpus` server, a real workspace, a real browser

Workspace `init`ed in a scratch directory on port **8799** (the user's live
server on 8765 was never touched), Vite dev on **5773** proxying to it, Chromium
via Playwright.

```
corpus init ws --port 8799            → Initialized Corpus workspace, port 8799
corpus server start                   → corpus 0.16.0 listening on 127.0.0.1:8799 (pid 50841)
corpus doc create --type todo --title "Week of Aug 21" -m "…- [x] …\n- [ ] …"
                                      → created doc_d5h247pb
data/docs/inbox/week-of-aug-21.md     → status: open      (SERVER-085 wrote it)
```

Opened the document in its column reader and read the DOM:

```
BEFORE  statementTag  OUTPUT
        statementText "open"
        statementBox  {x 544.06, y 259.31, w 169.06, h 28.125}
        formBox       {x 365, y 241.09, w 527.20, h 92.84}
        hintBox       {x 544.06, y 290.44, w 169.06, h 43.5}
        border        rgba(0, 0, 0, 0)      background rgba(0, 0, 0, 0)
        selects       0
        hint          "derived from this document’s own content, so it is nobody’s to set"
        chip          "open"      panel 1 open / 1 done
```

Clicked the **last open item's checkbox in the body editor**:

```
flipped to resolved after 1336ms, with no reload
AFTER   statementText "resolved"
        statementBox  {x 544.06, y 259.31, w 169.06, h 28.125}   ← identical
        formBox       {x 365, y 241.09, w 527.20, h 92.84}       ← identical
        hintBox       {x 544.06, y 290.44, w 169.06, h 43.5}     ← identical
        selects       0
        chip          "resolved"  panel 0 open / 2 done
window.__drill (set before the click) → "same page"              ← no reload
data/docs/inbox/week-of-aug-21.md     → status: resolved         ← the file agrees
```

Unchecking it returned the statement to `open` and the file to `status: open`.

**Archived** (`corpus doc archive doc_d5h247pb`, reopened from an Archive
column):

```
statement  null            selects 1   value "archived"   disabled true
hint       "archived — where this document is kept, not a reading of its content.
            Unarchive in the ⋯ menu brings it back"
chip       "archived"
```

**A legacy list whose `items` key does not parse** — created a todo, then
hand-edited `items: nope` into its frontmatter (which is how such a document
really arises) and let the watcher reproject:

```
legacy notice   data-todo-legacy="malformed"   (the plugin's own DocPanel)
statement       null
select          enabled, value "open", options [open, resolved]
hint            "archive from the ⋯ menu — a status flip would not move a skill’s folder"
selected "resolved" → data/docs/inbox/hand-edited-chores.md → status: resolved
```

And the deliberate divergence, measured on that same document:

```
doc_wt5znbhu row menu: open · open-focus · archive · delete      ← no Resolve
```

The menu withholds on the declaration, the form offers the control, and the
person can still resolve the document. That is the decision recorded above,
working in both directions.

### Teardown

`corpus server stop` (pid 50841), Vite killed. `lsof` shows **5773 and 8799
free**; 8765 still held by the user's own server, untouched. No `vitest`,
`playwright`, `chromium` or `vite` process left behind.

## E2E Verification Log — PR #55 review, finding 1 (CRITICAL) + finding 6

**Model: Opus 5 (1M context).** Branch `phase-40-derived-status`. Nothing was
committed by this agent.

### The defect, reproduced first, against a real server

The reviewer's scenario, run before a line was changed. Workspace `init`ed in a
scratch directory on port **8791** (the user's live server on 8765 was never
touched), Vite dev on **5373** proxying to it, Chromium via Playwright.

```
corpus server start                   → corpus 0.16.0 listening on 127.0.0.1:8791 (pid 58210)
corpus doc create --type todo --title "Reproduction list" \
  -m "- [ ] call the plumber (due: 2026-08-04)\n- [ ] file the form (due: 2026-09-30)"
                                      → created doc_dhcgks7l
data/docs/inbox/reproduction-list.md  → due: 2026-08-04     (SERVER-134 wrote it)
```

Opened the document in its column reader and read the `due` field:

```
file due before        : due: 2026-08-04
due control exists     : 1
due control disabled   : false            ← live, on a field the server derives
due control value      : 2026-08-04
due field statements   : 0                ← no statement
due field hint         : (none)           ← nothing says where the value came from

--- typing 2030-01-01 into the due field ---
PUTs sent               : ["{\"due\":\"2030-01-01\"}"]     ← isDeliberate fires at once
due control value after : 2026-08-04                        ← snapped back
file due after          : due: 2026-08-04                   ← convergence won
due control value +2s   : 2026-08-04
file due +2s            : due: 2026-08-04
```

**No error, no explanation, deadline not set** — exactly as reported. The
document also appeared in the Attention column throughout, on the derived date
the person had just tried to replace.

### What was built

- `apps/ui/src/doc/fieldLock.ts` — `statusLock.ts` renamed, because the module is
  now the derived-field seam rather than the status one. Same exports, plus
  `dueLock` / `formDueLock` / `useFormDueLock` in `statusLock`'s two-function
  shape: a declaration-level predicate over `{type, status}`, and a form-level
  one holding the `Doc` that may only **narrow** it. `StatusSubject` →
  `FieldSubject`.
- `apps/ui/src/reader/FrontmatterForm.tsx` — a `derived` `due` lock renders
  `<output class="fm-statement">` carrying the server's value, or the words
  `no deadline` for `DerivedDocDue`'s middle answer. `changedFields` grew a
  `dueLocked` guard, beside the archive-boundary one and for its stated reason:
  the control is not the only path to the wire. `Field` carries `data-field`.
- `apps/ui/src/plugins/validate.ts` — finding 6: `deriveDue` is checked exactly
  as `deriveStatus` is, so a manifest carrying `deriveDue: "x"` is refused whole
  rather than loaded halfway.
- `apps/ui/e2e/stubCorpus.ts` — `StubRow.due`, stored, reported on the row and
  the document, and updatable through `PUT`. It was flatly `null`, so no spec
  could put a **date** in front of a surface that shows one (UI-085's lesson, one
  field over).
- `apps/ui/e2e/derived-due.spec.ts` — 4 specs. `derived-status.spec.ts`'s
  locators scoped to `[data-field="status"]`, which two statements now require.

### One predicate, not two

`formDueLock` calls `dueLock` and can only release its answer, pinned by the
same property case `formStatusLock` carries — *locks nothing the shared
predicate left open*. The two members differ on exactly one thing, and it is
stated at both sites: **archiving is a fact about `status`, not about `due`.**
`statusLock` returns an `archived` lock; `dueLock` returns `null`, because
`PluginDocType` rule 2 makes an archived document a state every derivation
declines, and where one declines "the stored value stands".

The three-valued contract is never composed with the two-valued one. Nothing in
`apps/ui` combines a derived value with a stored one: `formDueLock` asks only
*whether the derivation applies*, and the statement shows `doc.frontmatter.due`,
which is what the server wrote.

### Unit tests

```
vitest run apps/ui/src/doc/fieldLock.test.ts           → 33 passed
vitest run apps/ui/src/reader/FrontmatterForm.test.tsx → 61 passed
vitest run apps/ui/src/plugins apps/ui/src/menu        → 13 files, 172 passed
vitest run apps/ui                                     → 155 files, 3408 passed
tsc --noEmit -p apps/ui                                → clean
eslint + prettier on every touched file                → clean
```

### Falsification — six mutations, each caught

| Mutation | What failed |
| --- | --- |
| `formDueLock` reads `{due: null}` as *does not apply* (the `??` collapse) | 4 tests, incl. `keeps the lock where the derivation applies and there is no deadline` and the e2e flip |
| `dueLock` locks an archived document too | `hands an archived document's deadline back — archiving is a fact about status` |
| `changedFields`' `dueLocked` guard removed | `drops a date typed before the lock engaged, on every path to the wire` |
| `deriveDue` dropped from the manifest schema (the pre-fix state) | `fails a deriveDue that is not a function — every member of the seam, or none` |
| The pre-fix live date control rendered anyway | 3 unit cases + 2 of the 4 e2e specs (`element(s) not found`) |
| `.fm-statement { width: max-content }` (SHARED-057) | both geometry cases: `due` reports **91.89px → 85.88px** across `2026-09-30` → `no deadline`, and `status` still reports the documented `47.3 → 67.9` |

### Playwright, against the real UI (`CORPUS_UI_PORT=5273`, `--workers=1`)

```
e2e/derived-due.spec.ts + e2e/derived-status.spec.ts   → 8 passed (15.5s)
```

### Real-app drill — the fix, on the same running server

Same workspace, same document, after the change:

```
due control exists     : 0                ← no control at all
due statement count    : 1
due statement text     : 2026-08-04
status statement text  : open
due field hint         : derived from this document’s own content, so it is nobody’s to set
```

Then the derivation driven from the body, through the real editor, with the file
read back after each click:

```
1. derived todo — checking the last dated item
   file            : due: 2026-08-04   | statement: "2026-08-04"
   after 1 checked : file due: 2026-09-30 | statement: "2026-09-30"
   after 2 checked : file due: null       | statement: "no deadline"
   status field    : statement: "resolved"
   restored        : due: 2026-08-04      | statement: "2026-08-04"

2. archived todo (doc_jb2nplfs) — the deadline is the person's again
   due field       : control: value="2026-11-01" disabled=false
   status field    : control: value="archived"   disabled=true

3. a note (doc_y6qiwyrd) — nothing changed for a type nothing derives
   due field       : control: value="" disabled=false
   PUTs            : ["{\"due\":\"2026-12-24\"}"]
   due field       : control: value="2026-12-24" disabled=false   ← it lands and stays
```

The statement tracks the file on every step, and the two documents that derive
nothing keep an ordinary, writable date control.

### Teardown

Scratch server stopped, Vite killed, ports **5373 / 5273 / 8791 free**. 8765 is
still held by the user's own server and was never touched.

## Decision — an archived todo's `due` is locked, like any other todo's

**Made by the orchestrator, 2026-08-22, on PR #55's re-review (finding 2).**

`dueLock` returned `null` for an archived document, so an archived todo kept a
live date control. The argument was `PluginDocType` rule 2: an archived document
is one of the two states in which every derivation declines, and where a
derivation declines "the stored value stands", so the deadline looked like the
person's again.

**Chosen: lock it.** An archived todo's `due` is a statement, exactly as an
unarchived one's is. Three reasons, in order of weight:

1. **§12's rider is categorical.** *"The field is **not editable** for this
   type."* It says nothing about the document's status, and reading a
   status-shaped exception into it is reading something that is not there.
2. **The surprise lands at unarchive.** A date hand-typed on an archived list
   writes and stands — until the document is unarchived, at which point the
   derivation resumes and the very convergence this PR spent a CRITICAL locking
   the control against discards it without a word. That is the silent-discard
   defect surviving through the archive door, and it is worse than the original
   because the discard happens minutes or months after the act.
3. **Nothing is lost.** An archived document neither ages nor appears in
   Attention, so a deadline on one changes nothing a person can see. There is no
   act being withheld here.

**What does not change: `statusLock`'s archived branch.** Archiving *is* a fact
about status — it is a status, set on another route — so the status field keeps
a control, keeps `ARCHIVED_OVER_DERIVED_LOCK`'s wording, and keeps saying which
of the two rules put the word there. The two members still part company on the
archived case. What moved is *what* they disagree about: it used to be whether
there is a lock at all, and it is now the **kind** of lock. `archived` where
there is an act on another route, `derived` where there is no act anywhere.

`formDueLock` needed the mirror of `formStatusLock`'s guard to make this hold:
it asks the derivation only about a document that is **not** archived. Rule 2's
decline is a fact about the archive, not about the document's content, and the
narrowing may only act on content.

## Decision — one home for "a locked field must not reach the wire"

**Made by the ui-dev agent, 2026-08-22, on PR #55's re-review (finding 1); the
reviewer required a single home and rejected a second boolean in advance.**

`changedFields(doc, draft, dueLocked)` guarded `due` alone. `status` has the
identical race and a harsher ending, and had no guard at all.

**Chosen: `changedFields` takes the locks, and filters the whole list.**

- `doc/fieldLock.ts` gained `DERIVED_FIELDS` (`["status", "due"]` — one member
  per `deriveX` on `PluginDocType`), the mapped type `FieldLocks` over it,
  `NO_FIELD_LOCKS`, and `fieldLocks(doc, registry)` / `useFieldLocks(doc)`.
- `changedFields(doc, draft, locks)` computes what the form would have sent and
  then passes it through **one** filter, `withoutLocked`, which loops over
  `DERIVED_FIELDS`. A third derived field is one entry in that list and is
  guarded without anybody remembering to guard it.
- The form holds `locksRef` where it held `dueLockRef`, and renders both fields
  from the same value, so the thing the controls draw and the thing the writer
  consults can no longer disagree.

**Rejected: a `statusLocked` parameter beside `dueLocked`.** Two ad-hoc booleans
for one rule is what produced the defect, and a third field would have added a
third.

**Rejected: gating writes on `PluginDiscoveryPhase`.** The tempting reading of
the rule is *"nothing derivable reaches the wire until discovery has settled"*.
It is not implementable honestly here. `DocView` already refuses to render this
form while the phase is `pending`, so a phase gate would be a rule written twice
with no reachable path. And the window the defect actually lives in is
`abandoned` — discovery took longer than `DISCOVERY_BUDGET_MS`, the reader paints
without plugin chrome, and the client genuinely does not know whether the field
is derived. Withholding the write there would drop the person's pick **in
silence**, where sending it produces the server's own refusal, which names the
field and explains itself. Silence is the worse of the two.

**Added, because the gate alone does not un-wedge the form:** a refused derived
field leaves the local map. See below.

## Decision — a refusal may not outlive its own request

**Made by the ui-dev agent, 2026-08-22 (finding 1's second half).**

`onError` deliberately kept every value the person had set, so the chip's retry
could re-send the lot. That is right for a save that **failed** and wrong for a
value the server said was never the person's: it rides on every later patch and
is refused again, so one refusal made every subsequent save of every field fail.

**Chosen: drop exactly the derived fields the refusal *named*.**
`CorpusRequestError.issues` carries `path: "body.status"` — structured, from the
only party that knows — so `refusedFields` reads the contract's own error shape
and never the prose. A `500`, a dropped connection or a refusal about any other
field names nothing, nothing is dropped, and the existing "keeps every typed
value" behaviour is untouched.

**Rejected: dropping every derived field a failed request carried.** It needs no
error shape at all, and it loses a status pick to a passing network failure.

**Rejected: auto-retrying the surviving fields after a refusal.** The chip
already offers a retry, and an automatic one risks a loop against a server that
keeps refusing.

## Decision — the statements read the document, never the overlay

`StatusStatement` and `DueStatement` both rendered `valueOf(doc, local)` while
their own doc comments promised *"the value is the server's"*. Measured live: the
statement read `resolved` over a file reading `open`. They now read
`draftOf(doc)`. That is the same sentence, read strictly.

## E2E Verification Log — PR #55 re-review, findings 1, 2 and 3

**Model: Opus 5 (1M context).** Branch `phase-40-derived-status`. Nothing was
committed by this agent.

### The wedge, reproduced first, against a real server

Workspace `init`ed in a scratch directory on port **8793** (the user's live
server on 8765 was never touched), Vite dev on **5273** proxying to it, Chromium
via Playwright. The reviewer's window was held open by delaying the todos
manifest's module request by 8s, so plugin discovery exceeded
`DISCOVERY_BUDGET_MS` and the reader painted with an empty registry — which is
what makes the status `<select>` live on a todo.

```
corpus init ws --port 8793            → Initialized Corpus workspace, port 8793
corpus server start                   → corpus 0.16.0 listening on 127.0.0.1:8793 (pid 84448)
corpus doc create --type todo --title "Reproduction chores" \
  -m "- [ ] call the plumber (due: 2026-09-30)\n- [ ] rinse the filter"
                                      → created doc_343eyaq7
data/docs/inbox/reproduction-chores.md → status: open   due: 2026-09-30
```

```
--- BEFORE — the reader painted while discovery was still in flight ---
status select count : 1
status select value : open
status select live  : true        ← live, on a field the server derives
due   input count   : 1

--- the person picks `resolved` ---
PUT {"status":"resolved"} → 400
  `status` is derived from the document itself and is not a value a save may
  set (SPEC.md §12)   issues: [{path: "body.status", …}]

--- AFTER the status pick ---
status select value : resolved    ← the refused value, kept
file status         : open

--- AFTER discovery settled — the control is gone ---
status statement    : "resolved"  ← the statement prints a value the file
file status         : open           does not have (finding 1, second half)

--- a title typed afterwards ---
PUT {"title":"Reproduction chores — renamed","status":"resolved"} → 400
save chip           : "save failed — retry"
file title          : Reproduction chores      ← unchanged. Wedged.
```

**No control left to reset it, and every later save of every field refused** —
exactly as reported.

### What was built

- `apps/ui/src/doc/fieldLock.ts` — `DERIVED_FIELDS`, `DerivedField`,
  `FieldLocks`, `NO_FIELD_LOCKS`, `fieldLocks`, `useFieldLocks`. `dueLock` no
  longer releases an archived document, and `formDueLock` no longer puts the
  narrowing question to one.
- `apps/ui/src/reader/FrontmatterForm.tsx` — `changedFields(doc, draft, locks)`
  with the single `withoutLocked` filter; `locksRef` replacing `dueLockRef`;
  `refusedFields` / `dropRefused` on the error path; both statements reading
  `draftOf(doc)`.
- `apps/ui/src/testing/serverRefusals.ts` — `derivedFieldRefusalBody`, the
  transcription of SERVER-085's refusal, so a double can answer what the server
  answers and the drop path is exercised against the real shape.
- `apps/ui/src/testing/readerFixture.ts` — a `400` on `PUT /api/docs/{id}` now
  carries that body, naming whichever derived fields the request sent.
- `apps/ui/e2e/settledBox.ts` — **new**, finding 3: the byte-identical private
  `settled()` helpers in `derived-due.spec.ts` and `derived-status.spec.ts` moved
  into one module. It is locator-scoped, so `settle.ts`'s `settledReader` (fixed
  target, no argument) is not its home; the two are cross-referenced.
- `apps/ui/e2e/derived-due.spec.ts` — the archived case inverted per finding 2.

### Unit tests

```
vitest run apps/ui/src/doc/fieldLock.test.ts             → 40 passed
vitest run apps/ui/src/reader/FrontmatterForm.test.tsx   → 71 passed
vitest run apps/ui/src/{doc,reader,menu,plugins,testing} → 32 files, 541 passed
tsc --noEmit -p apps/ui                                  → clean
eslint + prettier over apps/ui/src and apps/ui/e2e       → clean
```

### Falsification — six mutations, each caught

| Mutation | What failed |
| --- | --- |
| `changedFields` stops filtering through the locks | 6 tests, incl. all five `a locked field never reaches the wire` cases and the pre-existing `drops a date typed before the lock engaged` |
| `dropRefused` keeps everything (the wedge restored) | `lets go of it, so the next save of another field lands` |
| `StatusStatement` reads the local overlay again | `states the document's value, never a value the local map is still holding` |
| `DueStatement` reads the local overlay again | `states the document's deadline, never one the local map is still holding` |
| `dueLock` releases an archived document again (the pre-fix state) | 3 tests, incl. the e2e-adjacent `states an archived list's deadline too` |
| `formDueLock` puts the narrowing question to an archived document | 2 tests — the trap that made finding 2's fix two changes rather than one |

### Real-app drill — the fix, on the same running server

The same script, the same document, the same held-open discovery window:

```
--- the person picks `resolved` (still refused — the client cannot know) ---
PUT {"status":"resolved"} → 400

--- AFTER the status pick ---
status select value : open        ← the refused value let go of
file status         : open

--- AFTER discovery settled ---
status statement    : "open"      ← the statement agrees with the file
due   statement     : "2026-09-30"

--- a title typed afterwards ---
PUT {"title":"Reproduction chores — renamed"} → 200
save chip           : "committed · git ✓"
file title          : Reproduction chores — renamed      ← it lands
```

Finding 2, on the same server, with a real archived todo and a real note:

```
1. archived todo (doc_2osluijg, file: status=archived due=2026-11-01)
   status : control ×1, hint "archived — where this document is kept, not a
            reading of its content. Unarchive in the ⋯ menu brings it back"
   due    : statement "2026-11-01", controls 0, hint "derived from this
            document’s own content, so it is nobody’s to set"

2. note (doc_hrssu753) — nothing derives, so nothing is locked
   due    : control ×1, no statement, no hint
   typed 2026-12-24 → PUT {"due":"2026-12-24"} → 200 → file due: 2026-12-24
```

### Playwright, the whole suite

```
CORPUS_UI_PORT=5273 npm run e2e -- --workers=1   → 535 passed (10.7m), exit 0
```

Run whole rather than scoped, because the last two rounds each broke a spec
elsewhere. Nothing outside `derived-due.spec.ts` moved.

### Teardown

Scratch server stopped, Vite killed, ports **5273 / 8793 free**. 8765 is still
held by the user's own server and was never touched.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[UI-092]` prefix
