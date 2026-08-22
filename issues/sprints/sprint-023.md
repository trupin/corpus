# Sprint 023 — Todos dogfood polish: one issue that fits the plugin, and two that do not

**Issues**: PLUGINS-008 · PLUGINS-009 · PLUGINS-010
**Domains**: plugins (filed) — see Open Conflicts 2, 4 and 5 for the real domain split
**Branch**: `dogfood-todos-polish` (orchestrator-owned)
**Date**: 2026-08-02
**Test numbering**: continues the ladder from sprint-022's `TEST-1050`; this sprint runs
`TEST-1051`–`TEST-1090`.

**Also on this branch, and deliberately not contracted here**: UI-034 (task-list CSS). It was
spawned as an urgent standalone before this pre-flight. C12 confirms it shares **no file and no
selector** with anything below; the one artifact it touches in common is the e2e spec
`apps/ui/e2e/todos.spec.ts`, which is a merge hazard, not a design one (Open Conflict 6).

---

## What this wave is

Three issues filed the same day from one live v0.1.0 dogfood session, all of them real bugs the
user hit. The pre-flight verified every premise against the tree, read-only, and the batch does
**not** hold together the way the filing implies:

- **PLUGINS-008 is exactly what it says it is, is entirely inside `plugins/todos/`, and is
  ready.** The escalation its Technical Design anticipates ("possibly `packages/kit` if the plugin
  cannot see frontmatter extras") does not fire — the `DocPanel` already receives the whole `Doc`
  (C2). It is also **under-scoped**: two adjacent silent-failure states are strictly worse than
  the one filed, and one of them makes the reader show a healthy-looking stats strip over a
  document every write refuses (C3).
- **PLUGINS-009 contradicts signed SPEC text.** `SPEC.md:423` closes the context-menu paragraph
  with "Plugin-rendered surfaces (e.g. rows inside a plugin column body) are out of scope in v1",
  from SHARED-004 sign-off item 4 — a decision the user confirmed. Core does not merely omit the
  menu on plugin rows; it **actively bails** in three places, each citing that sign-off (C4). The
  issue cannot be implemented without reversing a signed decision, and it needs a kit export that
  does not exist and is lint-forbidden to reach around (C6).
- **PLUGINS-010 is ~90 % not a plugins issue, and one of its two acceptance criteria is not
  satisfiable as written.** There is no anchor-flash treatment to reuse — the only transient
  flashes in the app are on a *thread card* and on a *column*, and `.anchor-hl` is a persistent
  decoration on an existing thread's anchor, not an animation (C9). And the click payload cannot
  reach the reader at all: three separate seams are `docId`-only (C10).

There is also a **fourth bug, not filed**, that the pre-flight found while checking PLUGINS-009's
premise and that is cheaper and more spec-compliant than the issue that led to it: a todo
**document** row has no context menu anywhere on the board, in any column, because core suppresses
its own row menu for every type with a plugin `ListItem` (C5). Right-click and ⇧F10 both do
nothing on a todo row today. That is a core action set going missing on a core subject, and it is
in scope for v1 by the same sentence that puts PLUGINS-009 out of it.

**The bar for this wave**: PLUGINS-008 ships. PLUGINS-009 and PLUGINS-010 are re-shaped or
deferred by the orchestrator's ruling before any agent is spawned on them — a domain agent handed
either issue as filed will either escalate on the first hour or quietly build something the spec
says should not exist.

---

## Premise corrections — what the pre-flight found

Verified against the tree at contract time (2026-08-02), read-only: no git, no builds, no
installs, no test runs.

### C1 — PLUGINS-008: the bug is real; the attribution is wrong

The reader for a legacy document renders exactly as reported. The cause is not "the projection
still counts frontmatter items" — the projection is not involved. `readItems` reads the **body
first** and falls back to the legacy key only when the body carries no task lines
(`plugins/todos/items.ts:375-382`), and `TodoDocPanel` calls it on the whole document
(`plugins/todos/ui/TodoDocPanel.tsx:35`, `docSource` at `items.ts:103-105`). So the panel's
`open`/`done`/progress/due chip are all computed from `frontmatter.extra.items`, by the plugin,
in the browser.

The body half is equally mechanical: PLUGINS-006 dropped the todo `View`, so a todo document falls
through to the core editor (`apps/ui/src/reader/DocView.tsx:238-247`), and an empty body is an
empty editable surface — there is no placeholder, no empty-state, nothing. The user's summary of
the effect ("stats card populated, body completely empty, every affordance silently gone") is
accurate in full.

### C2 — PLUGINS-008: the `DocPanel` is a sufficient home; no kit change, no core change

`DocPanelProps` is `{ doc: Doc }` (`packages/kit/src/plugin/types.ts:41-44`) — the **whole**
document, including `body` and `frontmatter.extra`. `resolveDocPanel` renders it in the one v1
injection slot, above the body, in both the column reader and focus mode
(`apps/ui/src/plugins/slots.tsx:74-79`, mounted at `DocView.tsx:212`). Everything the notice needs
is already exported from the plugin's own module: `hasLegacyItems` (`items.ts:336-338`),
`readLegacyItems` (`items.ts:346-363`), `LEGACY_ITEMS_KEY` (`items.ts:59`).

**The issue's anticipated CONTRACT escalation does not fire.** Open Conflict 1 still has to rule
*whether* the panel is the right home — "a notice plus a read-only list" is a different object
from "a stats strip" — but it is a design question, not a capability gap.

### C3 — PLUGINS-008 is under-scoped: two worse states are unnamed

The filed bug is the *best-behaved* of three legacy states.

| State | What the reader shows today | Filed? |
| --- | --- | --- |
| Legacy key parses, body empty | Populated stats strip + empty body | Yes |
| Legacy key **malformed** (hand-edited YAML) | **No panel at all** + empty body | No |
| **Dual storage** (body items *and* legacy key) | Normal panel, normal checkboxes, every write refused | No |

- **Malformed**: `TodoDocPanel` returns `null` on `!read.ok` (`TodoDocPanel.tsx:36`), by a
  deliberate and well-argued rule ("a stats panel over an unreadable list would be a quiet claim
  about a broken state"). The consequence under an empty body is that the document renders as a
  blank page with no chrome whatsoever — strictly worse than the filed bug, and reached by the
  same hand-edit.
- **Dual storage**: `readItems` returns the **body** items, so the panel and the checkboxes look
  perfectly healthy — while `planWrite` refuses every write with a 400 naming the conflict
  (`items.ts:632-638`) and `itemProblems` reports it (`items.ts:420-428`). Nothing in the UI ever
  calls `itemProblems` (`validate` is "reserved: core does not invoke it in v1",
  `packages/kit/src/plugin/types.ts:96-100`), so that 400 is visible only to the CLI. The user
  sees a normal todo document that silently refuses to be written by the agent.

Both are the same class of bug as the one filed, both are one branch away in the same component,
and leaving them out ships a fix that a second dogfood session walks straight past.

### C4 — PLUGINS-009: the premise is inverted, and the issue contradicts signed SPEC text

The issue says core rows have menus "but the todos plugin renders its own item rows with no
`onContextMenu` at all". The plugin did not forget. **Core refuses**:

- `apps/ui/src/board/ColumnList.tsx:106-109` — `if (resolveListItem(row.type) !== null) return;`,
  commented "A plugin `ListItem` owns its own surface; v1 leaves it the native menu rather than
  half-populating a core menu over it (sign-off item 4)."
- `apps/ui/src/shell/Board.tsx:379-381` — the same bail on the ⇧F10 path, same citation.
- `apps/ui/src/menu/nativeMenu.ts:23-37` — `[data-plugin-surface]` is listed among the hosts that
  keep the **browser's** menu; `DocView.tsx:170-177` stamps that attribute on any plugin `View`.

And the spec is explicit: `SPEC.md:423`, last sentence — *"Plugin-rendered surfaces (e.g. rows
inside a plugin column body) are out of scope in v1."* Its provenance is
`issues/shared/004-phase5-spec-pass.md:110`, a `[DECISION NEEDED]` the user answered: **out for
v1 — core surfaces only; a kit-provided affordance for plugin views is a follow-up, so plugins
are not half-covered by accident.**

PLUGINS-009 as filed is that follow-up. It is a **SPEC amendment plus a kit surface**, not a
plugin bug fix. Open Conflict 2.

### C5 — the unfiled bug behind PLUGINS-009: todo **document** rows have no menu either

Both bails in C4 key on `resolveListItem(type)`, and todos registers a `ListItem` for `type: todo`
(`plugins/todos/manifest.ts`). So **every todo document row, in every column on the board**, loses
the core row menu: open, open in focus, archive, delete, and the staleness quick actions. Right-
click gives the browser menu; ⇧F10 gives nothing.

This is not what sign-off item 4 was about. The subject there is a *plugin-rendered surface* — the
item rows the plugin invents. A todo **document** is a core subject with a core action set, and
`RowMenuItems`' actions (`subjectFromRow(row)`, `ColumnList.tsx:115-127`) need nothing from the
plugin: they act on the `DocRow`, which core already holds. The v1 rule reads on the
*surface's origin*, and it was applied to the *row's type*.

It is also worse in practice than the filed issue, because it removes actions that exist
everywhere else rather than declining to add new ones. Open Conflict 3 files it.

### C6 — PLUGINS-009: the kit exports no context-menu primitive, and the boundary is enforced

`packages/kit/src/index.ts` exports rows, badges, staleness, reasons, `useRowActions`, the query
hooks and `AutocompleteMenu` — and **nothing** from `apps/ui/src/menu/`. There is no
`useContextMenu`, no `ContextMenuProvider`, no `ContextMenuRequest`, no `MenuItems`, no
`RowMenuItems`, no `useRovingMenu`.

The real hook is `useContextMenu()` (`apps/ui/src/menu/ContextMenuHost.tsx:64`), and its request
shape is `{ label, clientX, clientY, autoFocus?, items: (close) => ReactNode }` (`:29-37`) — note
that **items arrive as an element factory, not as data**, precisely because every action list is
built from hooks (`:23-27`). A kit export of this is not a re-export; it is a design.

Reaching around it is lint-forbidden and proven so: `eslint.config.js:72-100` restricts
`plugins/**/*.{ts,tsx}` to `@corpus/kit`, `@corpus/kit/**`, `@corpus/contract` and
`@corpus/contract/plugin`, plus a second pattern banning `**/apps/**` and `**/packages/**` by
path, with `scripts/eslint-boundaries.test.ts` proving both directions. The issue's "escalate if
the kit surface needs a new export" is not a conditional — **it fires**.

### C7 — PLUGINS-009: "open existing thread" is knowable plugin-side and not actionable

The knowing half works. `Doc.anchors` is `ResolvedAnchor[]` —
`{ anchorId, selector, threadId, threadStatus, range, orphaned }`
(`packages/contract/src/schemas/doc.ts:164-184`, on `DocSchema` at `:192`) — and the kit exports
`useDoc`. A plugin can match an item's text against `selector.exact` and hold the `threadId`.

The acting half does not exist. `ColumnComponentProps.onOpen` is `(docId: string) => void`
(`packages/kit/src/plugin/types.ts:78`), and the reader's jump-and-flash is local state with no
external entry point: `jumpToThread` is created in `useReaderSurface.ts:153-161` and consumed at
exactly two call sites, both `ReaderHead`'s `onSelectThread` (`Reader.tsx:139`,
`FocusMode.tsx:118`). Nothing above it carries a target — `ReaderProps` (`Reader.tsx:25-36`) has
none, `OpenTarget` is `{docId, subject?, columnId?, selectTitle?}`
(`apps/ui/src/board/openInColumn.tsx:39-62`), and `NavEntry` is `{docId, scrollY}`
(`apps/ui/src/board/useBoardLocalState.ts:30-34`).

Same missing seam as PLUGINS-010's. Open Conflict 5 treats them as one.

### C8 — PLUGINS-009: "comment on item" has no selection, but the payload is legal

Since PLUGINS-006 an item is body text and commenting is the editor's selection gesture
(`SPEC.md:429` — *"selecting an item's text and commenting creates an ordinary text-quote anchor
(§6, unchanged — no special item anchoring exists)"*). From a column row there is no editor and no
selection, so the plugin must **construct** the selector.

That is legal and has precedent: `useCreateThread` is a kit export
(`packages/kit/src/index.ts:87`), `selector` is `{exact, prefix?, suffix?}`
(`createCorpusClient.ts:120-121`), and a non-editor caller already sends `{ exact }` alone with no
prefix or suffix — `apps/ui/src/thread/NewChildThread.tsx:42`. No plugin calls `useCreateThread`
today, and nothing stops one.

The cost is context. The column's data source has no body: `TodoListView` is
`{docId, title, open, done, items}` (`plugins/todos/ui/queries.ts:63-69`). A bare `{ exact }` on
an item like `- [ ] call the bank` is exactly the selector §6's reconciliation resolves worst, and
two identical items in one list would anchor to whichever the server finds first. Getting
prefix/suffix means a `useDoc(docId)` per commented item. Open Conflict 4.

### C9 — PLUGINS-010: there is no anchor-flash treatment to reuse

The criterion "reuses the existing anchor flash treatment, not a new style" is not satisfiable.
The complete inventory of transient flashes:

- `@keyframes thread-flash` on `.thread-card.flash`, 1.2 s (`apps/ui/src/reader/Reader.css:418-426`,
  driven by `FLASH_MS` in `useReaderSurface.ts:20`).
- `.col.flash` on a column (`apps/ui/src/board/Column.css:68`, `COLUMN_FLASH_MS`
  in `openInColumn.tsx:217`).
- `.row.flash` (`apps/ui/src/app/global.css:65`) — a reduced-motion override only.

`.anchor-hl` is **not** a flash. It is a persistent ProseMirror decoration on an existing thread's
anchor — a steady accent wash and underline (`apps/ui/src/anchors/anchors.css:12-24`), created at
`apps/ui/src/anchors/anchorDecorations.ts:117`. The reader's "jump to anchor"
(`useAnchorLayer.ts:402-411`) scrolls `.anchor-hl[data-thread="…"]` into view and is keyed on a
**thread id**. An item with no thread has no `.anchor-hl` — there is nothing to query and nothing
to light up.

So PLUGINS-010 requires a **new** transient body-range treatment (modelled on `thread-flash`,
honouring the `prefers-reduced-motion` override that `global.css:65-66` already establishes), and
it has to be an editor decoration, in `apps/ui`, because that is where the body's node structure
is. The plugin cannot contribute it.

### C10 — PLUGINS-010: three seams are `docId`-only; the plugin's share is one argument

Everything between the click and the reader carries a document id and nothing else:

| Seam | Current shape | File |
| --- | --- | --- |
| Plugin column → host | `onOpen?: (docId: string) => void` | `packages/kit/src/plugin/types.ts:78` |
| Host → board | `onOpen: (docId: string) => void` | `apps/ui/src/board/Column.tsx:45,190` |
| Cross-shell open | `OpenTarget {docId, subject?, columnId?, selectTitle?}` | `apps/ui/src/board/openInColumn.tsx:39-62` |
| Navigation entry | `NavEntry {docId, scrollY}` | `apps/ui/src/board/useBoardLocalState.ts:30-34` |

And the reader's arrival position is an **offset**, not a target: `useReaderSurface` restores from
`restoreY` keyed on `navToken` (`:25-37, :90-119`), with an explicit convergence guard that stops
the moment the user scrolls. A reveal-by-text has to enter that machinery deliberately or it will
fight the restoration it lands beside.

Realistic split of PLUGINS-010 as filed: widen a kit type (KIT/CONTRACT) · widen `OpenTarget`,
`NavEntry` and `ReaderProps`, resolve the text to a body position, scroll it, and add the flash
style (UI) · pass `item.text` instead of nothing (plugins, ~1 line). The issue is filed on
`plugins`. Open Conflict 5.

### C11 — PLUGINS-003's status is drift, and PLUGINS-009 depends on it

`issues/plugins/003-item-level-commenting.md:8-10` says **`todo`**. `issues/PLAN.md:134` says
**`done`**, annotated "design closed; impl = PLUGINS-005/006/007". PLAN.md is right — the design
question ("anchors resolve against the body while items live in frontmatter") was answered by
moving items into the body, and §12's signed text describes the outcome.

PLUGINS-009 declares `Depends on: PLUGINS-005, PLUGINS-003`. On the file's reading that dependency
is unmet and the issue is not ready; on the PLAN's reading it is. **The issue file must be
corrected to `done`** regardless of how Open Conflict 2 rules, or the next batch that reads issue
files instead of the plan draws the wrong conclusion.

### C12 — UI-034 does not collide with anything here, except in one e2e spec

- `.check-list`, `.check`, `.todo-items`, `.doc-panel`, `.todos-column` exist **only** in
  `plugins/todos/ui/todos.css` (`:27, :35, :81, :149, :193`).
- **No task-list CSS exists anywhere in `apps/ui` or `packages/kit` today** — no `.css` file in
  either contains `taskList`, `taskItem` or `data-type`. The single adjacent rule is
  `packages/kit/src/markdown/markdown.css:103-105` (`.doc-body input[type="checkbox"]`), for the
  read-only renderer, which `todos.css:20-25` already defers to.
- UI-034's node structure comes from `@tiptap/extension-task-list`
  (`apps/ui/src/editor/markdown/schema.ts:8,113-114`), so its CSS lands in
  `apps/ui/src/editor/editor.css` (the only owner of `.doc-editor .ProseMirror`, `:37`) or
  `apps/ui/src/reader/Reader.css`.

**Verdict: disjoint files, disjoint selectors.** The one shared artifact is
`apps/ui/e2e/todos.spec.ts` — UI-034's stated test home (`issues/ui/034-task-list-styling.md:51`)
and the only e2e file any todos work would touch. Open Conflict 6.

Two gaps worth knowing while writing tests: `TodosColumn` — the surface PLUGINS-009 and
PLUGINS-010 both act on — is **mounted in no e2e spec at all** (`todos.spec.ts` builds a plain
`view` column and exercises the row `ListItem` preview only, `:25-36, :227`), and **no e2e
anywhere constructs a legacy `extra.items` todo**; migration is unit- and server-tested only.

---

## Machine rules — binding on every agent in this batch

- **Scoped tests only.** `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run <path>`. Never the
  repo-wide suite, never `npm run test:coverage`. The orchestrator runs the single full gate at
  harvest. One workspace-scoped run at the very end of a session is the maximum.
- **Build before typecheck or test.** `@corpus/*` imports resolve through `dist/`; a stale
  `packages/kit` build is the usual cause of a phantom type error in `plugins/todos`.
- **One heavy command at a time.** Never overlap a build, a vitest run, an e2e run or an
  `npm install`.
- **Playwright is single-holder.** It starts its own Vite. Never run it while another e2e run or a
  dev server is up. Override the port with `CORPUS_UI_PORT` if 5173 is held.
- **At most two implementation agents concurrently on this branch**, and only if Open Conflicts 2
  and 5 have been ruled in a way that puts them in different workspaces.
- **Kill what you start**, by recorded pid, and verify your ports are free before reporting.

---

## Acceptance Tests

### PLUGINS-008: legacy frontmatter-items todo renders a silently empty body

Scope assumes Open Conflict 1 rules **the panel is the home** and Open Conflict 3's ruling on C3's
two extra states. TEST-1059–1062 are conditional on the latter and are marked.

TEST-1051: A legacy document announces itself, by name
Given: a `type: todo` document whose frontmatter carries `items:` with two entries and whose body
has no task lines
When: the document is opened in a column reader
Then: a notice is visible above the body, it states that this list still stores its items in
frontmatter, and it names the verb `corpus todos migrate` verbatim as the remedy — phrased as
something the agent or the CLI runs, never as a button the notice offers

TEST-1052: The legacy items are visible, and are not interactive
Given: the document of TEST-1051
When: the reader is open
Then: both item texts are rendered under the notice; each shows its done/open state; clicking one
changes nothing on screen and issues no request; no checkbox in that list is focusable or
keyboard-toggleable

TEST-1053: A migrated document is byte-identical to today
Given: a `type: todo` document with two body task lines and no `items:` key
When: the document is opened
Then: no notice renders anywhere; the panel shows the same open/done/progress/due values it shows
today; the body renders the editable checkbox list

TEST-1054: The stats strip is unchanged in both states
Given: TEST-1051's document and TEST-1053's document, each with the same two items in the same
states
Then: the two panels report identical `open`, `done`, progress percentage and due chip — the
notice adds a region, it does not alter a number

TEST-1055: The notice survives focus mode
Given: TEST-1051's document
When: it is opened in full-screen focus rather than in a column reader
Then: the notice and the read-only items render there too, with the same text

TEST-1056: Migration clears the notice with no reload
Given: TEST-1051's document open in a reader
When: the legacy key is folded into the body and cleared (the act `corpus todos migrate` performs)
Then: the notice disappears, the items become the editable checkbox list, and the panel's numbers
do not change — without a page reload

TEST-1057: An empty legacy key is a migration, not a notice-worthy list
Given: a todo document whose frontmatter carries `items: []` and whose body has no task lines
Then: whatever the notice says, it never claims there are items to see, and it renders no empty
read-only list — the document reads as an empty todo list, because that is what it is

TEST-1058: The notice is not a second write path
Given: TEST-1051's document
Then: no interaction with the notice or the read-only items issues any request; the plugin's
write routes are untouched by this issue

TEST-1059 _(conditional on Open Conflict 3)_: A malformed legacy key says so instead of vanishing
Given: a todo document whose `items:` key is a hand-edited scalar (not a list) and whose body is
empty
When: the document is opened
Then: a notice names the problem and quotes the plugin's own diagnostic (the `items: must be a
list of items; found string` family from `items.ts:353-357`); the reader is not a blank page

TEST-1060 _(conditional on Open Conflict 3)_: A dual-storage document stops looking healthy
Given: a todo document carrying one body task line **and** a non-empty `items:` key
When: the document is opened
Then: a notice states that the document stores items in two places and that nothing can be written
to it until one is removed — the same sentence `itemProblems` already produces
(`items.ts:424-427`), not a second wording

TEST-1061 _(conditional on Open Conflict 3)_: The dual-storage notice matches what a write actually
does
Given: TEST-1060's document
When: an item-level write is attempted against it through the plugin's route
Then: it is refused with 400, and the refusal's reason and the on-screen notice name the same
condition — a user reading the reader can predict the agent's failure

TEST-1062 _(conditional on Open Conflict 3)_: The panel never renders numbers it cannot stand behind
Given: TEST-1059's document
Then: no `open`/`done` count and no progress bar is shown — the existing `return null` rule
(`TodoDocPanel.tsx:36`) survives; the notice replaces the blank, it does not restore the stats

TEST-1063: The whole issue stays inside the plugin
Then: the diff touches only `plugins/todos/**`; `packages/kit`, `packages/contract` and `apps/ui`
are byte-identical; `plugins/todos/ui/todos.css` is the only stylesheet changed

TEST-1064: E2E, on the real app, with a real legacy file
Then: the E2E log records a legacy todo file created on disk in a live workspace, the reader
screenshot or DOM evidence showing the notice and the read-only items, the output of the real
`corpus todos migrate` run, and the reader afterwards with working checkboxes. The log states the
model the agent ran on.

### PLUGINS-009: right-click quick actions on todo item rows

**These tests do not authorise implementation.** They describe what "done" would mean *if* Open
Conflict 2 rules that the SPEC sentence is amended and the kit gains a menu surface. If it rules
otherwise, TEST-1065–1072 are void and TEST-1073–1078 (Open Conflict 3's doc-row fix) are what
this issue becomes.

TEST-1065: A signed SPEC sentence is not contradicted in silence
Then: `SPEC.md:423`'s final sentence has been amended through the spec-writer with the user's
sign-off recorded, **before** any code lands; the three code sites citing sign-off item 4
(`ColumnList.tsx:108`, `Board.tsx:380`, `nativeMenu.ts:23`) have their comments updated to cite
the new decision, and no code path silently keeps a stale citation

TEST-1066: Right-click on an item row opens a Corpus menu
Given: a Todos column showing a group with at least two open items
When: an item row is right-clicked
Then: a Corpus context menu opens at the pointer, labelled for that item, and the browser's own
menu does not appear

TEST-1067: The menu offers exactly three actions, and the third is conditional
Then: the menu lists toggle done/open, comment on item, and — only when that item already has a
resolved anchor on its parent — open existing thread. An item with no thread shows two items, not
three greyed to disabled

TEST-1068: Toggle goes through the plugin's own write path and refreshes without reload
When: toggle is chosen on an open item
Then: exactly one request reaches the plugin's item route (`PUT /api/x/todos/{docId}/items/{index}`),
it carries `expectedText` for the item the user saw, the document's body gains an `x` on that one
line and is otherwise byte-identical, and the column row and the document row's preview both
update with no reload

TEST-1069: A stale index is refused, not applied to whatever moved
Given: an item row rendered from a list that has since had an earlier item deleted
When: toggle is chosen
Then: the write is refused with 409 and nothing is written; the refusal surfaces to the user rather
than failing silently

TEST-1070: Comment produces an ordinary text-quote thread, not a new shape
When: comment on item is chosen
Then: a thread is created with `parent` set to the todo document and a text-quote `selector` whose
`exact` is the item's text without its checkbox syntax and without its `(due: …)` marker; the
resulting thread is indistinguishable — in file shape and in the parent's `anchors` frontmatter —
from one created by selecting the same words in the reader

TEST-1071: The anchor is context-bearing, or the contract says why it is not
Then: per Open Conflict 4's ruling, the selector either carries `prefix`/`suffix` drawn from the
parent body, or the E2E log records the deliberate `{ exact }`-only choice, cites
`NewChildThread.tsx:42` as its precedent, and demonstrates the duplicate-item case the omission
makes ambiguous

TEST-1072: The menu behaves like every other menu in the app
Then: `esc` dismisses, arrows navigate, `↵` activates, focus returns to the row on close, and the
menu is reachable from the keyboard on the highlighted row — the conventions
`apps/ui/src/menu/useRovingMenu.ts` already establishes, not a second implementation

### Open Conflict 3's issue: todo document rows have no context menu

Filed by this contract as a new issue if the orchestrator accepts C5. Spec-compliant today;
implementable without any SPEC change.

TEST-1073: A todo document row has the same menu as every other document row
Given: any column listing a `type: todo` document
When: the row is right-clicked
Then: the Corpus row menu opens with the core action set — open, open in focus, archive, delete,
and the staleness quick actions where the row shows them — identical to the menu a `note` row
offers in the same column

TEST-1074: ⇧F10 on a highlighted todo row opens the same menu
Given: a todo row under the keyboard cursor
When: ⇧F10 (or the menu key) is pressed
Then: the same menu opens with its first item focused

TEST-1075: The v1 plugin-surface rule still holds where it was meant to
Then: a plugin **column body's** own rows still get the browser's menu, and a plugin `View`'s
surface still carries `data-plugin-surface` and still keeps the native menu — the change is scoped
to the *row of a document core owns*, and `nativeMenu.ts`'s behaviour is unchanged

TEST-1076: The subject is the document, and needs nothing from the plugin
Then: the menu's actions are built from the `DocRow` core already holds; no plugin module is
imported by any core file as a result of this change, and `eslint.config.js:104-130`'s core→plugins
ban still passes

TEST-1077: The delete confirmation and the archive path are the real ones
When: delete is chosen on a todo row
Then: the same explicit confirmation every other row's delete shows appears, and the user-only rule
(§9) is enforced exactly as elsewhere

TEST-1078: The regression is pinned in e2e
Then: `apps/ui/e2e/context-menu.spec.ts` gains a case asserting a todo row's menu, so the next
plugin to register a `ListItem` cannot silently take the menu away again

### PLUGINS-010: clicking a todo item opens its document with the item revealed

**Conditional on Open Conflict 5.** These tests describe the whole act across whichever issues it
is split into; the plugin's share is TEST-1086 alone.

TEST-1079: Clicking a bottom item scrolls the reader to it
Given: a todo document with 17 items and a Todos column showing its group
When: an item that would sit below the fold is clicked
Then: the reader opens on that document with that item's line visible in the viewport — not the top
of the document, and not a position produced by scroll restoration

TEST-1080: The revealed item is marked transiently, by a treatment that did not exist before
Then: the item's line carries a transient highlight that fades on its own within about a second and
a half, is implemented as a new named treatment modelled on `thread-flash`
(`Reader.css:418-426`), and is **not** `.anchor-hl` — which stays what it is, the persistent
decoration for a real anchor. The E2E log records C9's finding, that the criterion's "reuses the
existing anchor flash treatment" was not satisfiable, and what was built instead

TEST-1081: Reduced motion is honoured
Given: `prefers-reduced-motion: reduce`
Then: the reveal still scrolls the item into view, and the flash degrades exactly as
`apps/ui/src/app/global.css:65-66` already degrades the other two flashes

TEST-1082: The document group header keeps today's behaviour
When: a group's header button is clicked
Then: the document opens at the top, with no reveal and no flash — unchanged from today
(`TodosColumn.tsx:94`)

TEST-1083: The reveal works in the column reader and in full-screen focus
Then: both surfaces scroll to the item and flash it; neither shows the flash without the scroll or
the scroll without the flash

TEST-1084: The reveal does not fight scroll restoration
Given: a reader navigated back to a document it had previously scrolled, then a fresh item click on
the same document
Then: the reveal wins for the new navigation, and pressing Back afterwards restores the earlier
position — `useReaderSurface`'s convergence guard (`:90-119`) is entered deliberately, not
bypassed, and its "the user scrolled, never touch it again" rule still holds

TEST-1085: An item whose text is no longer in the body degrades honestly
Given: an item row rendered from a cached aggregate, whose line has since been deleted
When: it is clicked
Then: the document opens at the top with no flash — never a thrown error, never a scroll to a
coincidentally similar line elsewhere in the body

TEST-1086: The plugin's share is one argument
Then: the diff inside `plugins/todos/` adds the item's identifying payload to the existing
`onOpen?.(group.docId)` call (`TodosColumn.tsx:104`) and changes nothing else; every other change
lands in `packages/kit` and `apps/ui`, in the issue(s) Open Conflict 5 creates

TEST-1087: The widened seam is optional at every hop
Then: `ColumnComponentProps.onOpen`'s new payload is optional, a host that ignores it still opens
the document, and every existing caller of `OpenTarget` compiles unchanged — a column rendered
outside a board still simply opens things (`packages/kit/src/plugin/types.ts:73-78`)

### Cross-cutting

TEST-1088: PLUGINS-003's status drift is corrected
Then: `issues/plugins/003-item-level-commenting.md`'s Status reads `done` and carries the PLAN's
annotation ("design closed; impl = PLUGINS-005/006/007"), so the file and `issues/PLAN.md:134`
agree

TEST-1089: Every corrected premise is written back into its issue file
Then: PLUGINS-008's Technical Design drops the CONTRACT escalation (C2) and gains C3's two states
if ruled in; PLUGINS-009's Summary is corrected from "the plugin renders rows with no
onContextMenu" to C4's finding; PLUGINS-010's second acceptance criterion is restated per C9 and
its Domain per C10. A wrong premise left in a file is a wrong premise the next agent inherits

TEST-1090: The full gate is green at harvest
Then: `npm run lint`, `npm run typecheck`, `npm test` and `npm run coverage` (≥ 90 % on all four
metrics) pass on the branch head, and `apps/ui/e2e/todos.spec.ts` passes with both this sprint's
additions and UI-034's

---

## Out of Scope

- **Any change to the item format, the parser, or the plugin's write routes.** `items.ts` and
  `server/routes.ts` are signed, covered and shared with the CLI. PLUGINS-008 reads; it does not
  write.
- **A UI-invoked migration.** The notice names `corpus todos migrate`; it does not offer a button.
  §12 makes `migrate` a CLI verb, it is an all-documents operation with no per-document argument
  (`plugins/todos/cli/commands/migrate.ts:31`), and a reader-scoped button would be a second
  migration surface with different semantics.
- **Invoking `validate` from core.** `PluginDocType.validate` stays reserved in v1
  (`packages/kit/src/plugin/types.ts:96-100`). PLUGINS-008's dual-storage notice derives its own
  answer from the `Doc` it already has.
- **Task-list CSS.** UI-034 owns it, in `apps/ui`. Nothing in this batch touches
  `apps/ui/src/editor/editor.css`, `apps/ui/src/reader/Reader.css` or
  `packages/kit/src/markdown/markdown.css` — except PLUGINS-010's flash, if Open Conflict 5 rules
  it in, which is why Open Conflict 6 exists.
- **A general kit context-menu framework.** If Open Conflict 2 rules PLUGINS-009 in, the export is
  scoped to what the todos column needs; a plugin menu API for surfaces nobody has built is a
  separate design.
- **Item reordering, drag, nesting, or subtasks.** §12 describes a list, not a tree; `items.ts:38-44`
  states the non-goal explicitly.
- **The todos column's own e2e coverage gap.** `TodosColumn` is mounted in no e2e spec (C12). Worth
  an issue; not a prerequisite for PLUGINS-008.

---

## Integration Points

- **PLUGINS-008 has none.** It consumes `DocPanelProps.doc` — a frozen kit type — and produces
  markup inside its own slot. No shared type, no new endpoint, no cross-domain contract.
- **PLUGINS-009 (if ruled in)** produces a demand on `packages/kit`: a context-menu surface a
  plugin can open, whose request shape must accommodate `items` as an element factory (C6),
  because the actions are hook-built. Consumers: `plugins/todos/ui/TodosColumn.tsx`. Producer:
  `packages/kit` + `apps/ui/src/menu` (the host stays core; only the seam is published).
- **PLUGINS-010 (if ruled in)** produces a widened open payload consumed at four hops in order —
  `ColumnComponentProps.onOpen` (kit) → `Column.tsx` (ui) → `OpenTarget`/`NavEntry` (ui) →
  `ReaderProps`/`useReaderSurface` (ui). The shared shape is a **reveal target**, and it must be
  optional at every hop (TEST-1087). Whatever it carries must be resolvable against a body the
  plugin has never read: the item's text is the only identifier both ends hold.
- **PLUGINS-009 and PLUGINS-010 need the same seam** for two different destinations — a thread and
  a body position. Designed once, they are one field with two shapes; designed twice, they are two
  parallel reveal mechanisms in the same reader. Open Conflict 5.
- **UI-034 ↔ this batch**: no code integration. One shared test file (Open Conflict 6).

---

## Escalations and Open Conflicts

**Open Conflict 1 — where the legacy notice lives: the plugin's `DocPanel`, or a core reader
region.**
The panel can carry it — it receives the whole `Doc`, renders above the body in both surfaces, and
needs no new capability (C2). But the panel is a compact horizontal stats strip today
(`todos.css:81-147`), and "a notice paragraph plus a read-only item list" is a different object
sharing one container; a long legacy list would push the body far down a narrow column. The
alternatives are a core-owned document-level notice region (a second injection slot — a real
extension-point addition, against §10's "one core slot in v1"), or the plugin rendering the notice
as a *sibling* of the panel inside the same slot.
**Recommendation: the plugin's `DocPanel`, rendering a notice block and a collapsed read-only
list.** Rationale: it needs nothing from core, it keeps a plugin-format problem explained by the
plugin that owns the format, it works in both surfaces for free, and §10's one-slot rule is a
deliberate constraint rather than an oversight. The list is collapsed by default with a count
("2 items, stored in frontmatter — show") so a 17-item legacy document does not bury its own body.
The panel keeps its stats strip; the notice sits above it inside the same slot.
**Orchestrator rules, before PLUGINS-008 is spawned** — it decides whether this is one workspace or
two.

**Open Conflict 2 — PLUGINS-009 requires reversing a signed decision. Amend, defer, or narrow.**
`SPEC.md:423`'s closing sentence puts plugin-rendered surfaces out of v1 context-menu scope; its
provenance is the user's own answer at `issues/shared/004-phase5-spec-pass.md:110`, and three code
sites enforce it by name (C4). It additionally needs a kit export that does not exist and is
lint-forbidden to reach around (C6).
- **(A) Amend the spec.** Route a SHARED issue through the spec-writer, get the user's sign-off,
  then build the kit surface and the menu. Honest, and it is the "follow-up" the original decision
  named. Cost: a spec cycle plus a kit design, for a P2.
- **(B) Defer PLUGINS-009 to a later phase**, unchanged, and ship Open Conflict 3's doc-row fix
  now — which is spec-compliant, cheaper, and addresses the larger regression the user has not yet
  noticed (C5).
- **(C) Narrow to a non-menu affordance** — an inline toggle control on the item row, no context
  menu, no SPEC change. Delivers the most-wanted action (toggle) and drops comment/open-thread.
**Recommendation: (B) now, (A) filed behind it.** Rationale: the user's dogfood pain is that
right-click does nothing on todos; the *document* row losing its whole action set is a bigger and
more surprising instance of that than item rows never having gained one, and it is fixable this
sprint without touching signed text. (A) is the correct long-term answer and should be filed
immediately so the deferral is recorded rather than forgotten. (C) is tempting and rejected: an
inline toggle on an aggregate row is a second write affordance with no undo and no menu context,
and it pre-empts (A)'s design.
**Orchestrator rules, before any agent is spawned on PLUGINS-009.** This one gates the batch —
under (A) the issue is not startable this sprint at all.

**Open Conflict 3 — file the unfiled bug: todo document rows have no context menu.**
Both suppression sites key on `resolveListItem(type)`, so registering a `ListItem` costs a doc type
its entire core row menu on the whole board (C5). Sign-off item 4 is about plugin-*rendered*
surfaces; this is a core action set on a core subject, and the rule was applied to the row's type
rather than to the surface's origin.
**Recommendation: file it as a `ui` issue, P1, and rule it a bug rather than a spec question.** The
fix is to narrow the bail from "this type has a plugin `ListItem`" to "this surface is
plugin-rendered" — the `[data-plugin-surface]` test `nativeMenu.ts` already uses. Assign to
**ui-dev**; it touches `ColumnList.tsx`, `Board.tsx` and `context-menu.spec.ts`, and no plugin
file. Rationale: it restores behaviour that exists everywhere else, needs no SPEC change, and is
the cheapest real win in this batch.
**Orchestrator rules; if accepted, this becomes the sprint's second shippable issue.**

**Open Conflict 4 — does a programmatically constructed item anchor carry prefix and suffix?**
Only if PLUGINS-009 survives Open Conflict 2. `{ exact }` alone is legal and precedented
(`NewChildThread.tsx:42`), and the column has no body to draw context from — `TodoListView` carries
items, not markdown (C8). Getting context means a `useDoc(docId)` per commented item.
**Recommendation: fetch the body and send `prefix`/`suffix`.** Rationale: a bare `exact` on short
repeated item text ("call the bank") is precisely the selector §6's reconciliation resolves worst,
and a thread anchored to the wrong duplicate is a silent, permanent wrong. The fetch is one
document, on an explicit user action, cached by the kit — and `NewChildThread`'s precedent is a
*child* thread on a quote the user is already looking at, which is not this.
**Orchestrator rules inside PLUGINS-009, only if it proceeds.**

**Open Conflict 5 — PLUGINS-010's shape: one plugins issue, or a kit/ui pair with a one-line plugin
change?**
As filed it is a `plugins` issue; ~90 % of the work is a kit type widening plus a reader
reveal-by-text plus a new flash treatment, none of which a plugin may write (C9, C10). PLUGINS-009's
"open existing thread" needs the same seam for a different destination (C7).
- **(A) Split into three**: KIT (widen `ColumnComponentProps.onOpen`'s payload) → UI (thread the
  payload through `OpenTarget`/`NavEntry`/`ReaderProps`, resolve text to a body position, scroll,
  and add the flash) → PLUGINS (pass `item.text`). Correct domains, correct dependency chain,
  three issues for one dogfood complaint.
- **(B) One UI issue** that owns the kit change and the reader work, with the plugin's one line
  folded in as a cross-domain exception.
- **(C) Defer**, and ship only PLUGINS-008 and Open Conflict 3's fix this sprint.
**Recommendation: (A), with the seam designed once for both destinations.** Define the reveal
target as a discriminated payload — an anchored thread, or a body text target — so PLUGINS-009's
"open existing thread" and PLUGINS-010's "reveal this item" are one field, not two parallel
mechanisms in the same reader. Rationale: the reader is the most-touched surface in the app and
`useReaderSurface`'s restoration logic is the subtlest code in it (C10); two reveal paths added
independently will fight each other and the restoration. If the orchestrator judges three issues
too much for a P2, **(C)** is honest and **(B)** is not — (B) puts a kit contract change inside a
UI issue where no contract review sees it.
**Orchestrator rules, before PLUGINS-010 is spawned.**

**Open Conflict 6 — `apps/ui/e2e/todos.spec.ts` is single-holder, and UI-034 already has it.**
UI-034 is spawned and its stated test home is that file (`034:51`). PLUGINS-010's TEST-1079–1085
and Open Conflict 3's TEST-1078 would also land in e2e. No CSS or source file collides (C12); the
spec file does, and Playwright is single-holder on this machine besides.
**Recommendation: UI-034 keeps `todos.spec.ts` exclusively until it merges.** Open Conflict 3's
case goes in `apps/ui/e2e/context-menu.spec.ts` (where every other row-menu case lives, and which
UI-034 does not touch). PLUGINS-010's e2e waits for UI-034 to land, or takes a new spec file. No
two agents run Playwright concurrently on this branch under any ruling.
**Orchestrator enforces at spawn time.**

**Open Conflict 7 — PLUGINS-008's scope: the filed state, or all three legacy states?**
C3's malformed and dual-storage states are the same bug class, one branch away in the same
component, and one of them is strictly worse than the filed bug.
**Recommendation: all three, in one issue.** Rationale: the fix is a single "what state is this
document's item storage in?" branch in one component; splitting it means writing that branch twice
and shipping a fix a second dogfood session walks straight past. It adds TEST-1059–1062 and no new
files. The issue's Acceptance Criteria are amended before spawn.
**Orchestrator rules, before PLUGINS-008 is spawned.**

---

## Done Criteria

This sprint is complete when:

- Open Conflicts 1–7 are ruled and each ruling is recorded in the affected issue file
- Every acceptance test that survives those rulings PASSes in the evaluator's verdict
- The corrected premises are written back into the issue files (TEST-1089) and PLUGINS-003's
  status drift is fixed (TEST-1088)
- `npm run lint`, `npm run typecheck`, `npm test` and `npm run coverage` (≥ 90 % on all four
  metrics) pass on the branch head (TEST-1090)
- Each shipped issue's E2E Verification Log is filled with concrete evidence from the real running
  app, and states the model the implementing agent ran on
- The pr-reviewer returns APPROVE on the phase PR

## Recommended sequencing

1. **Rule Open Conflicts 1 and 7, then spawn PLUGINS-008** (plugins-dev, opus). It is the only
   issue in this batch that is ready, self-contained and P1. No dependency on anything else here.
2. **Rule Open Conflict 3; if accepted, file and spawn the doc-row menu fix** (ui-dev, opus) in
   parallel with PLUGINS-008 — different workspaces, no shared file, and it is the larger of the
   two context-menu regressions.
3. **Rule Open Conflict 2 before PLUGINS-009 is spawned at all.** Under the recommended (B) it is
   deferred this sprint and a SHARED spec-amendment issue is filed behind it.
4. **Rule Open Conflict 5 before PLUGINS-010 is spawned.** Under the recommended (A) it becomes a
   KIT → UI → PLUGINS chain, and only the first link is startable now.
5. **Hold all Playwright work behind UI-034** (Open Conflict 6), and never run two e2e sessions on
   this branch concurrently.

## Orchestrator adjudications (2026-08-02, Fable)

1. **OC1 — legacy notice lives in the plugin DocPanel** (accepted): above the
   stats strip, read-only legacy list collapsed by default. No core reader
   region; §10's one-slot rule stands.
2. **OC2 — PLUGINS-009 conflicts with signed SPEC §10** ("plugin-rendered
   surfaces out of scope in v1", SHARED-004 item 4): ruled **amend — SIGNED by the user 2026-08-02
   ("Amend — plugin menus in")** — the user's 2026-08-02 dogfood request ("right click…
   should allow me to take quick action on the item") is a direct scope
   expansion of their own earlier decision, so the amendment is being put to
   them explicitly. PLUGINS-009 is **held** until signed; it does not start
   this sprint.
3. **OC3 — unfiled doc-row menu bug accepted as UI-036 (P1)**: the
   suppression keys on `resolveListItem(type)` and kills the ENTIRE context
   menu on todo document rows — core actions on a core subject. Narrow the
   bail to "surface is plugin-rendered". This is likely most of what the
   user actually hit when right-clicking.
4. **OC4 — item-comment anchors carry prefix/suffix** (accepted): fetch the
   body; `{exact}` alone mis-anchors duplicate item text silently.
5. **OC5 — reveal seam built once, as a discriminated payload** (accepted,
   shape A): filed as UI-037 (kit + reader; ui domain owns both).
   PLUGINS-010's dependency rewritten to UI-037; PLUGINS-009's "open
   thread" uses the same payload when it unblocks.
6. **OC6 — todos.spec.ts single-holder = UI-034** (accepted): UI-036's e2e
   goes in context-menu.spec.ts; PLUGINS-010's e2e waits for UI-037.
7. **OC7 — PLUGINS-008 keeps all three legacy states** (accepted): empty
   body + malformed legacy key (no panel at all) + dual-storage (healthy
   panel over 400-refused writes) are one branch in one component.
8. Bookkeeping: PLUGINS-003's issue file said `todo` while PLAN says done —
   file corrected to `done`.

Wave plan: PLUGINS-008 (plugins-dev) + UI-036 (ui-dev, after UI-034
harvests) in parallel; PLUGINS-009 held on the §10 sign-off; UI-037 →
PLUGINS-010 sequenced behind the wave.
