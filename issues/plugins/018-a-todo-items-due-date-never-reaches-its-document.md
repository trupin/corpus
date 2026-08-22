# [PLUGINS-018] A todo item's due date never reaches its document, so Attention cannot see it

## Domain
plugins

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: PLUGINS-005
- Related: SHARED-036 (a todo list's derived status — the same shape, one field over), PLUGINS-016

## Spec References
- SPEC.md **§12** — the todos plugin, and a todo's items as the record
- SPEC.md **§5** — `due:` and the Attention view

## Summary

Reported from live use, 2026-08-21, with a reproduction.

A `type: todo` item carries `(due: YYYY-MM-DD)` as **body text**. Attention reads
the **document's** `due:` frontmatter field. The two never meet.

Tested: an item **18 days overdue** produced `no documents match` on
`--due overdue`, on `--needs due`, and on `--needs me`. Three separate ways of
asking "what is late", and the answer was no in all three while something was
eighteen days late.

## Why this matters beyond the bug

The reporter records that this finding is **what decided them against the plugin
for personal tasks** — and that if a document-level rollup lands, that decision
is worth reopening, because the plugin's other properties are better than what
they use instead.

So this is not one missing field. It is the reason the reference plugin is not
being used for the thing it is for.

## The shape, and it is not new

SHARED-036 already settled the analogous question for `status`: a todo list says
`open` after its last item is checked, and the fix is that a plugin doc type
derives a document-level value from its items. **`due` is the same shape, one
field over** — the earliest open item's due date, surfaced on the document.

PLUGINS-016 is building the derivation seam for status. **Read it before
designing anything here**, and if the seam generalises, use it rather than
building a second mechanism. If it does not generalise, say why in this issue —
that is worth knowing.

## Decisions to make and record

1. **Earliest open item, or earliest item?** A checked item that was due
   yesterday is not late. Almost certainly open-only, but state it.
2. **What happens when no item has a due date** — the field is absent, not null,
   and must not make an undated list look due today.
3. **Whether a hand-written document-level `due:` wins over the derived one.**
   SHARED-036's answer for `status` is the precedent; do not answer it
   differently here without a reason.
4. **Where the derivation runs.** If it is a projection concern it belongs with
   SERVER-085's work; if it is a plugin concern it belongs in the manifest. The
   answer decides whether this issue needs a server issue behind it.

## Acceptance Criteria
- [x] A todo document reports the earliest open item's due date
- [x] `doc list --due overdue`, `--needs due` and `--needs me` all find an
      overdue item — the three the reporter tested, all three pinned
      _(pinned at the derivation, and demonstrated through all three queries
      against the real server with the convergence stood in for; the convergence
      itself is SERVER-134 — see decision 4)_
- [x] A list with no dated open items reports no due date, and is not treated as
      due
- [x] Checking the earliest item moves the document's due date to the next one
- [x] Checking the last one clears it
- [ ] The Attention view shows it, end to end in the real app — **SERVER-134**,
      because the view reads the projection's `due` column and nothing in
      `plugins/` may write it

## Testing Strategy
Unit over the derivation including the empty and all-checked cases. One
end-to-end reproducing the reporter's exact case: an item 18 days overdue, found
by all three queries.

## Decisions, recorded 2026-08-21 — with what each one rejected

### The seam generalised, so it was generalised rather than duplicated

PLUGINS-016's seam is three declarations per derived field: a `derive<Field>`
function on `PluginDocType` (the UI half), `derived<Field>: true` on the type's
`types.yaml` entry (readable without loading UI code), and an export from
`plugins/<dir>/server/derive.ts` (the executable non-UI half). `due` fits all
three unchanged. So `due` became the seam's **second member**, not a second
mechanism: same module, same containment, same `parity.test.ts` — which is now
table-driven over a `DERIVED_FIELDS` list, so a third field is one row rather
than a third copy of the same three tests.

One thing did **not** generalise, and it is worth stating: `status` has two
answers and `due` has three. A due date can be *derived to nothing* — the list
applies, and it has no deadline — which is a different answer from *the
derivation does not apply*. So `deriveDue` returns `{ due: string | null } |
null` where `deriveStatus` returns a bare union. **Rejected: `string | null`,**
which reads more like `deriveStatus` and cannot say the middle answer. Under it,
checking the last dated item would answer "does not apply", the stored deadline
would stand, and a completed list would stay overdue forever — the acceptance
criterion "checking the last one clears it" is precisely the one that encoding
fails.

**Rejected: collapsing the two flags into `derivedFields: [status, due]`.** It
is the better shape, and the seam is unreleased, so there is no compatibility
debt. But the flag is read by `apps/server`, which this issue may not touch: the
moment `types.yaml` stopped saying `derivedStatus: true` the running server
would lose derived status, and this branch is a release branch. Additive is
forced by the constraint, not preferred on the merits. SERVER-134 can collapse
them in one line here, and the parity test is already written for it.

### 1. Earliest **open** item

A checked item that was due yesterday is finished work, not a deadline.

**Rejected: the earliest item of any state.** It makes a completed list
permanently overdue — its earliest date never moves again — so `--due overdue`
would fill with lists nobody has to do anything about, and Attention would
become noise faster than the missing field ever made it quiet. It also breaks
two acceptance criteria outright: "checking the earliest item moves the due date
to the next one" and "checking the last one clears it" are both statements that
only open items count. Falsified deliberately: counting checked items fails 5
tests.

### 2. No dated open item ⇒ **`{ due: null }`**, which the field must show as empty

The derivation applies and answers *no deadline*, and the document's `due` must
end up empty — SQL NULL in the projection row, and core's own empty spelling
(`due: null`, SPEC.md §5's frontmatter example) in the file. Verified against
the real server: an undated list is absent from `--due overdue`, `--needs due`
**and** `--due today`.

**Rejected: answering `null` (does not apply) for an undated list.** It reads
tidier and it is wrong twice — a list whose last dated item is checked would
keep the deadline it no longer has, and a hand-written `due:` on a todo document
would quietly survive the rule in decision 3. Falsified deliberately: 6 tests
fail.

**Rejected: treating the absent field as "due today".** Nothing implements this,
and it is named because it is the failure mode the issue warned about: `due` is
compared with `<= @today` in `needs.ts`, so a field that ever defaulted to a date
would put every undated list in Attention.

### 3. The derived value wins. A hand-written document-level `due:` does not.

SHARED-036's precedent for `status` is followed, and the mechanism makes it more
than a precedent: **"hand-written wins" is not implementable here.** The derived
value is converged into the frontmatter by every server write (SPEC.md §12 —
"the file never disagrees with what is shown"), so one write later a
hand-written date and a derived one are the same bytes. There is nowhere to
record which one a person typed. "Explicit wins" would therefore decay into
"whichever was written last wins", which is drift wearing a rule's clothes —
and drift is the exact thing SHARED-036 rejected on 2026-08-08.

**Rejected: derive only when the body has a dated open item, so a hand-written
`due:` on an undated list survives.** This is the only version of "explicit
wins" that a shadow field can express, and it fails the same criterion decision
2 fails: after the last dated item is checked there are no dated open items, the
stored value stands, and the stored value is the derived date from before. The
deadline never clears.

**Consequence, stated plainly**: a person cannot put a deadline on a todo list
as a whole. They put it on an item, which is what §12's model already asks of
them. The `due` control on a todo document should render locked for the same
§11 reason UI-092 locks `status` — that is `apps/ui`, filed as a note to the
orchestrator rather than done here.

**A rider is owed for this.** SPEC.md §12 says a `todo` item may carry a due
date and that "open items past their date get the overdue treatment wherever
items are shown". It does not say the *document* carries the earliest open
item's date, and §5 currently makes `due` a field anyone may set on any type.
Locking it for one type is spec-level behavior. Drafted text is below; it wants
the user's signature the way SHARED-036 got one.

> **A todo document's deadline is its items' too.** §5's `due` is the field
> Attention and every date filter read, and a todo list's deadlines live on its
> items — so the document carries the **earliest open item's** date, derived
> like its status and set by nobody. A checked item is finished work and holds
> no deadline, so checking the earliest dated item moves the document's date to
> the next one and checking the last clears it. A list whose open items carry no
> date has no deadline, which is not the same as a deadline of today: it is
> absent from every date filter, exactly as an undated document of any other
> type is. The field is **not editable for this type**, for the same reason the
> status control is not — a deadline on the list that its items do not say would
> be overwritten by the next write of the document, so it was never the person's
> to set. **`archived` stands here too**: an archived todo document keeps
> whatever deadline its file states, and unarchiving returns it to whichever its
> items say at that moment.

### 4. The derivation is the plugin's; **reaching Attention is the server's** — so yes, a server issue

**The derivation belongs in the plugin**, unchanged from PLUGINS-016's recorded
evidence: `readItems` and core's remark-gfm parse diverge on blockquoted items,
unclosed fences and ordered task items, and the legacy `extra.items` states are
invisible to any body parse at all. Reading `(due: …)` markers is if anything
more plugin-private than reading checkboxes — the marker is the plugin's own
grammar, and §12 says text that does not parse as it is ordinary item text.

**Reaching Attention is not.** Every surface the reporter tested reads the
`documents.due` column: `--due overdue` compiles to `d.due IS NOT NULL AND d.due
< @today` (`apps/server/src/docs/filters.ts`), `--needs due` to `d.due IS NOT
NULL AND d.due <= @today` (`apps/server/src/docs/needs.ts:225`), and `--needs
me` is the union that contains it. That column is filled by `readDocumentFields`
from frontmatter, and the frontmatter is converged by `applyOperations`. Both
live in `apps/server`, and **nothing in `plugins/` can write either.**

**Rejected: the plugin's own routes write the document's `due:`.** They could —
`corpus todos add|check` already goes through the server — and it would be the
parallel mechanism this repository keeps getting bitten by. SPEC.md §12 makes a
UI checkbox toggle an **ordinary core body edit** that never touches the
plugin's routes, so the convergence would be systematically stale exactly where
a person does the checking. SERVER-085 put the status convergence in
`applyOperations` for this precise reason: it is the one point every create,
body save, item route, unarchive and bulk edit passes through.

So: **STOP was the correct answer, and `apps/server` was not touched.**
**SERVER-134** is filed with the design, the acceptance criteria and the
reproduction — `issues/server/134-a-derived-due-date-reaches-the-projection-and-the-file.md`.

### Packaging: nothing to add, and that was checked rather than assumed

SERVER-085 found that `scripts/package-staging.ts` stages only **named** plugin
entry points, so a new module under `plugins/todos/server/` would be absent from
the installed tarball — silently, in installed builds only. `server/derive.js`
is already an entry point (line 176). `deriveDue` is a **named export of that
same module**, so it inherits the staging and `scripts/` needs no change.
Verified rather than reasoned: the compiled entry was bundled with the repo's
own esbuild using packaging's flags, and its exports read
`default,deriveDue,deriveStatus`, with `deriveDue` answering `{"due":
"2026-08-04"}` from the bundle.

## E2E Verification Log

**Model: Opus 5 (1M context), as recommended.** Real workspace, real server on
port 8977 (never 8765, the user's), real CLI, real `plugins/todos/dist`. Output
verbatim, 2026-08-21. Server's today: `2026-08-22` (UTC), so `2026-08-04` is 18
days past.

### Reproduction — the reporter's case, before any change

```
$ corpus init …/p018-ws --port 8977 && corpus server start
corpus 0.16.0 listening on http://127.0.0.1:8977 (pid 65111)
$ POST /api/docs {"type":"todo","title":"Personal tasks","body":
    "- [ ] call the dentist (due: 2026-08-04)\n- [ ] renew the passport (due: 2026-09-30)\n"}
HTTP 201  → doc_tfpmf4cm

$ corpus doc list --due overdue
no documents match.
$ corpus doc list --needs due
no documents match.
$ corpus doc list --needs me
no documents match.
$ corpus doc list --type todo
doc_tfpmf4cm  todo  open  Personal tasks  data/docs/inbox/personal-tasks.md
showing 1–1 of 1 document

$ sed -n '1,15p' data/docs/inbox/personal-tasks.md
…
due: null
…
- [ ] call the dentist (due: 2026-08-04)
```

Three ways of asking what is late, all answering no, with an item eighteen days
late in the body and `due: null` in the frontmatter. Reproduced.

### The derivation, against the document the real API serves

`plugins/todos/dist/server/derive.js` — the **compiled** module discovery
prefers — called on `GET /api/docs/doc_tfpmf4cm`'s own bytes:

```
storedStatus=open derivedStatus="open" storedDue=null derivedDue={"due":"2026-08-04"}
body="- [ ] call the dentist (due: 2026-08-04)\n- [ ] renew the passport (due: 2026-09-30)\n"
```

### Boot: the new declaration is read by nobody and breaks nothing

```
$ corpus server stop && corpus server start
$ grep -o '"plugin":"todos"[^}]*' .corpus/server.log
"plugin":"todos","routes":true,"types":["todo"],"derives":["todo"]
$ grep -c warning .corpus/server.log
0
```

`derivedDue: true` rides through today's non-strict `TypesFileSchema` on both
the server and the CLI: derived **status** still discovers (`derives:["todo"]`),
`corpus todos list` and `corpus doc create --type todo` both still work, and the
log carries zero warnings.

### All three queries, with the convergence stood in for

The one step this issue does not ship is SERVER-134's: writing the derived value
into the field. A script derived from the live document and `PUT` the answer —
the same act `applyOperations` will perform, through the same public write path,
with **no hand-written date anywhere**:

```
$ node converge.mjs doc_tfpmf4cm
derivedDue={"due":"2026-08-04"}
PUT due="2026-08-04" -> HTTP 200
$ grep -n '^due:' data/docs/inbox/personal-tasks.md
10:due: 2026-08-04

$ corpus doc list --due overdue
doc_tfpmf4cm  todo  open  Personal tasks  data/docs/inbox/personal-tasks.md
$ corpus doc list --needs due
doc_tfpmf4cm  todo  open  Personal tasks  data/docs/inbox/personal-tasks.md
$ corpus doc list --needs me
doc_tfpmf4cm  todo  open  Personal tasks  data/docs/inbox/personal-tasks.md
```

**All three answer yes.** The reporter's exact case.

### Checking the earliest item moves it; checking the last clears it

```
$ corpus todos check doc_tfpmf4cm 1
checked item 1 of Personal tasks [doc_tfpmf4cm] — call the dentist
$ node converge.mjs doc_tfpmf4cm
derivedDue={"due":"2026-09-30"}
PUT due="2026-09-30" -> HTTP 200
$ grep -n '^due:' …/personal-tasks.md   →  10:due: 2026-09-30
$ corpus doc list --due overdue         →  no documents match.
$ corpus doc list --needs due           →  no documents match.

$ corpus todos check doc_tfpmf4cm 2
checked item 2 of Personal tasks [doc_tfpmf4cm] — renew the passport
$ node converge.mjs doc_tfpmf4cm
derivedDue={"due":null}
PUT due=null -> HTTP 200
$ grep -n '^due:\|^status:' …/personal-tasks.md
8:status: resolved
10:due: null
$ corpus doc list --due overdue / --needs due / --needs me
no documents match.
no documents match.
no documents match.
```

`status: resolved` in the same file is SERVER-085's convergence, untouched — the
two derived fields coexist on one document.

### An undated list is not due today

```
$ POST /api/docs {"type":"todo","title":"Undated errands",
    "body":"- [ ] buy milk\n- [ ] water the plants\n"}   → doc_kdd6cg3o
$ node converge.mjs doc_kdd6cg3o
derivedDue={"due":null}
PUT due=null -> HTTP 200
$ grep -n '^due:' …/undated-errands.md  →  10:due: null
$ corpus doc list --due overdue  →  no documents match.
$ corpus doc list --needs due    →  no documents match.
$ corpus doc list --due today    →  no documents match.
```

### Archived derives nothing, and unarchiving returns it

```
$ POST /api/docs/doc_bynxbxoz/archive  → 200
storedStatus=archived derivedStatus=null storedDue="2026-08-04" derivedDue=null
$ POST /api/docs/doc_bynxbxoz/unarchive → 200
storedStatus=open derivedStatus="open" storedDue="2026-08-04" derivedDue={"due":"2026-08-04"}
```

Both derived fields answer `null` for the same document, from the same guard —
the seam's carve-out is shared, not restated per field.

### Breaking the fix, against the same running server

A fresh copy of the reporter's case (`doc_gatitzxj`), `deriveDue` reduced to
reading no deadlines at all, `plugins/todos` rebuilt, the server left running:

```
=== FIX BROKEN ===
derivedDue={"due":null}
PUT due=null -> HTTP 200
--- with the fix BROKEN, is doc_gatitzxj found? ---
0
0
0
=== FIX RESTORED ===
derivedDue={"due":"2026-08-04"}
PUT due="2026-08-04" -> HTTP 200
--- with the fix restored, is doc_gatitzxj found? ---
doc_gatitzxj  todo  open  Reporter case  data/docs/inbox/reporter-case.md
doc_gatitzxj  todo  open  Reporter case  data/docs/inbox/reporter-case.md
doc_gatitzxj  todo  open  Reporter case  data/docs/inbox/reporter-case.md
```

### Subtractive check (SPEC.md §15 M6)

`plugins/todos/` moved aside, server restarted:

```
$ grep -o '"plugin":"[^"]*"[^}]*' .corpus/server.log | tail -2
"plugin":"_fixture","routes":true,"types":["fixture-note"],"derives":[]
"plugin":"_fixture","prefix":"/api/x/_fixture"
$ GET /api/docs/doc_gatitzxj                     →  HTTP 200
$ GET /api/docs?type=todo
doc_gatitzxj Reporter case  due="2026-08-04" status=open
doc_kdd6cg3o Undated errands due=null        status=open
doc_tfpmf4cm Personal tasks due=null         status=resolved
$ GET /api/x/todos/lists                         →  HTTP 404
```

Core boots, todo documents stay readable, both derived fields degrade to what
the files state, nothing errors. Directory restored and the plugin rediscovered
(`derives:["todo"]`, 0 warnings).

### Projection health

```
$ corpus db rebuild
rebuilt the projection in 29ms — 16 documents, 0 threads, …
$ corpus db doctor
projection is clean — 16 documents from 16 files (4ms)
$ corpus doc check
checked 16 documents — no findings.
```

### The tarball's own copy of the module

```
$ esbuild plugins/todos/dist/server/derive.js --bundle --platform=node --format=esm …
$ node -e "import(bundle).then(m => …)"
exports: default,deriveDue,deriveStatus | deriveDue: {"due":"2026-08-04"}
```

### Unit gate and falsification

`VITEST_MAX_THREADS=4 vitest run packages/kit/src/plugin plugins` → **29 files,
584 tests passed**. `tsc --noEmit` clean for `packages/kit` and `plugins/todos`,
`eslint` exit 0, `prettier --write` reported four files reformatted and the
suite re-ran green.

Three deliberate breaks, each restored and re-verified:

| Break | What failed |
| --- | --- |
| `deriveDue` counts checked items too | 5 tests (`items.test.ts` deriveDue block, parity's concrete answers) |
| `{ due: null }` collapsed into `null` | 6 tests (undated, fenced, non-marker text, clear-at-last, legacy, parity) |
| the `archived` guard dropped | 2 tests (`items.test.ts`, parity's concrete answers) |

Server stopped (pids 65111, 74516, 79300, 79478), port 8977 verified free, the
in-repo scratch directory deleted. Port 8765 — the user's live server — never
touched.

## Files changed

- `packages/kit/src/plugin/types.ts` — `DerivedDocDue`, `PluginDocType.deriveDue`,
  and the seam's shared rules stated once on `PluginDocType` rather than per
  field
- `packages/kit/src/plugin/index.ts` — exports `DerivedDocDue`
- `packages/kit/src/plugin/types.test.ts` — the three answers, pinned at the
  type level
- `plugins/todos/items.ts` — `deriveDue`, `DerivedTodoDue`
- `plugins/todos/items.test.ts` — the derivation's own tests
- `plugins/todos/manifest.ts` — `deriveDue` wired
- `plugins/todos/types.yaml` — `derivedDue: true`, and the block rewritten as
  the seam's per-field convention
- `plugins/todos/server/derive.ts` (+ `server/derive.test.ts`) — the named
  `deriveDue` export beside the default status one, one module per plugin
- `plugins/todos/parity.test.ts` — parity per field, table-driven
- `plugins/_fixture/parity.test.ts` — the same invariant, per field
- `issues/server/134-a-derived-due-date-reaches-the-projection-and-the-file.md`
  (new) — decision 4's other half

## Escalated to the orchestrator

1. **SERVER-134 must land or this issue is invisible.** Filed with the design
   and the reproduction. Without it the plugin answers correctly and Attention
   still shows nothing.
2. **A SPEC.md §12 rider is owed**, drafted above under decision 3. It needs the
   user's signature, one rider at a time, as SHARED-036 got one.
3. **`apps/ui` note**: the `due` control on a todo document should render locked
   with its source named, the same treatment UI-092 gives `status`. Not filed —
   another agent is in that tree.

## Completion Checklist (domain agent)

- [x] Decisions recorded with what each rejected
- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier + tsc over the touched workspaces)
- [x] E2E verification log filled in
- [x] Pre-fix reproduction logged
- [x] Subtractive check (delete the plugin) still passes
- [x] Acceptance criteria verified, except the one SERVER-134 owns

## Completion Checklist (orchestrator)

- [ ] SERVER-134 spawned
- [ ] SPEC.md §12 rider read to the user and signed
- [ ] `/audit` run (kit + plugins)
- [ ] `/evaluate` passes
- [ ] Committed with `[PLUGINS-018]` prefix
