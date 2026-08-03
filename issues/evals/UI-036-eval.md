# Evaluation: UI-036

**Date**: 2026-08-02
**Sprint**: sprint-023
**Verdict**: PASS

## Test environment

Real `corpus init` workspace at `/tmp/eval-dogfood`, real server on **:8791**,
**real built UI served by the server** at `http://127.0.0.1:8791/`, real headless
Chromium. The todos plugin is the real bundled plugin — the rows under test carry
`class="row todo-row"` and their item text comes from the plugin's own aggregate,
so a regression that unloads the plugin would change what I measured rather than
pass quietly.

Board layout under test: a core `Inbox` folder column containing four `type: todo`
document rows and ordinary `note` rows, **plus** a pinned plugin column
(`--column todos/todos`) rendering the same todos through `TodosColumn`. Both
surfaces are on screen at once, so the pointer/keyboard results below distinguish
*surface* from *document type* rather than assuming it.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                                                    |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Verification log present                | PASS   | Filled, with a reproduction section, pointer/keyboard sections and a negative section.                                                                                                   |
| Commands are specific and concrete      | PASS   | Names the subject (`.row[data-row-doc="doc_todo"]`), the gesture, the asserted `data-act` sequence, the recorded request, and the failing Playwright output verbatim.                     |
| Real E2E (not mocked)                   | **PASS, with a caveat** | Real Chromium against a real Vite dev server, real bundled plugin — but the API is `stubCorpus` plus intercepted routes, so the transport is not real. Declared honestly in the log. I re-ran every case against a **real server and real documents** and got the same results, which closes the gap. |
| Scenarios cover acceptance criteria     | PASS   | AC 1 (pointer + keyboard), AC 2 (plugin column negative), AC 3 (surface-vs-type dissociation), AC 4 (spec file) all have evidence.                                                        |
| Application restarted after changes     | PASS   | The temporary bails were reinstated for the reproduction, then removed and the spec re-run green (`grep TEMP-REPRO` → nothing).                                                           |
| Actual model recorded (implemented on:) | PASS   | "**Model: Opus 5 (`claude-opus-5[1m]`).**"                                                                                                                                               |
| Reproduction logged before fix (bugs)   | PASS   | §1 reinstates `resolveListItem(row.type)` in both sites and shows both new cases failing with `element(s) not found` on `role="menu"` — the bug observed before the fix, not after.        |

The stub-transport caveat is the only soft spot in the log, and the agent
declared it rather than hiding it. Because a stubbed store could in principle
mask a real-data difference (e.g. rows painted differently when the plugin's
aggregate is real), I did not credit it — I reproduced all four criteria against
the real server, and record that evidence below.

## Criteria Results

| #   | Criterion                                                                            | Result | Notes                                                                                                       |
| --- | -------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| 1   | Todo/plugin-typed document rows get the standard core context menu, right-click and ⇧F10 | PASS   | Identical `data-act` sequence to a `note` row, on all four todo documents, via both gestures.                |
| 2   | Rows rendered by a plugin column body remain excluded                                | PASS   | Four different right-click targets inside `[data-plugin-surface]` → no Corpus menu; ⇧F10 there → none.       |
| 3   | The bail is "surface is plugin-rendered", not "type has a plugin ListItem", in all three sites | PASS   | Same document type gets the menu outside the plugin surface and none inside it — the dissociation the criterion asks for, observed on both the pointer and keyboard sites. |
| 4   | E2E in `context-menu.spec.ts` (not `todos.spec.ts`)                                  | PASS   | `apps/ui/e2e/context-menu.spec.ts` exists; `fences.spec.ts` and `todos-legacy.spec.ts` are the other new files, `todos.spec.ts` is UI-034's.  |

## Evidence

### Provenance: the row really is plugin-painted

```
[data-row-doc="doc_wreqytia"]  class = "row todo-row age-1"
  contains the plugin's item text ("Call the plumber about the north wall")  → true
  .closest('[data-plugin-surface]')                                          → false
```

So it is a core row, for a core subject, whose *type* has a plugin `ListItem` —
precisely the case the old type-keyed bail suppressed.

### AC 1 — pointer path, compared against a note row

Right-click on the plain note `doc_kjy3xutk`:

```
aria-label "Actions for Plain note for menu comparison"
data-act   ["open","open-focus","archive","delete"]
labels     Open · Open in focus · Archive · Delete…
```

Right-click on the todo document `doc_wreqytia`:

```
aria-label "Actions for Inbox chores"
data-act   ["open","open-focus","archive","delete"]
labels     Open · Open in focus · Archive · Delete…
```

Byte-identical action set. Repeated on the other three todo documents:

| Row                | menu label                          | data-act                                     |
| ------------------ | ----------------------------------- | -------------------------------------------- |
| `doc_legacychores` | "Actions for Legacy chores"         | `["open","open-focus","archive","delete"]`   |
| `doc_brokenchores` | "Actions for Hand-edited chores"    | `["open","open-focus","archive","delete"]`   |
| `doc_dualchores`   | "Actions for Half-migrated chores"  | `["open","open-focus","archive","delete"]`   |

### AC 1 — keyboard path

Hover `doc_wreqytia`, then `ArrowDown` until the cursor genuinely lands on it —
trail `["doc_eo25lael","doc_kjy3xutk","doc_wreqytia"]`, and `.row.kbd` reads
`class="row todo-row kbd"`. Then `Shift+F10`:

```
aria-label "Actions for Inbox chores"
data-act   ["open","open-focus","archive","delete"]
document.activeElement[data-act] = "open"   ← first item focused
```

(My first attempt at this landed the cursor on a *note* row; I re-ran walking the
cursor until it demonstrably sat on the todo row, because a menu opened on the
wrong row would have been a false pass.)

### The action actually works — core route, plugin-typed document

Clicking `[data-act="archive"]` from the todo row's menu:

```
recorded request:  POST /api/docs/doc_wreqytia/archive     ← exactly one, the core route
row disappears from the board
GET /api/docs/doc_wreqytia → "status": "archived"
data/docs/inbox/inbox-chores.md → status: archived
```

The core menu on a plugin-typed document drives the core write path all the way
to disk. (Restored with `corpus doc unarchive doc_wreqytia` afterwards.)

### AC 2 + AC 3 — the negative, pushed harder than the log did

The plugin column body carries exactly one `[data-plugin-surface]`
(`div.col-list`, wrapping `TodosColumn`), containing no `[data-row-doc]` at all.
Right-clicked **four different nodes** inside it:

| Target                                  | Corpus `role="menu"` |
| --------------------------------------- | -------------------- |
| the surface itself (`div.col-list`)     | none                 |
| an item button (`button.check`)         | none                 |
| item text (`span.todos-group-title`)    | none                 |
| a group heading (`button.todos-group-head`) | none             |

Keyboard: hovering the plugin surface and pressing `ArrowDown` six times never
puts `.kbd` on anything inside it (`[null,null,null,null,null,null]`), and
`Shift+F10` there opens nothing.

In the **same page load**, the same gestures on `doc_wreqytia` in the core column
still open "Actions for Inbox chores". The exclusion tracks the surface, not the
document type — which is the whole content of AC 3, and it holds on both the
pointer site and the keyboard site. (The third site, `nativeMenu`'s host list, is
observable only as the absence of a Corpus menu on the plugin surface, which is
what the table above records.)

Screenshot: `/tmp/eval-dogfood/shots/00-board.png` (both columns on screen).

## Failures

None.

## Subjective quality (the menu)

- Design quality **4** — the menu reads as one component: action, then a muted
  clarifier line ("reversible — hidden from default lists", "user-only · click
  twice to confirm"), so consequence is legible before the click.
- Originality **3** — a standard row context menu; the deliberate touch is the
  per-item consequence line and the ⇧↵ hint on Open in focus.
- Craft **4** — identical rendering from the pointer and keyboard paths, first
  item focused on ⇧F10, correct `aria-label` naming the subject document.
- Functionality **5** — the affordance that was entirely missing is back and
  fully wired; no discoverability gap remains on plugin-typed rows.

Average 4.0, no score of 1.

## Summary

**4 of 4 criteria passed.** Every `type: todo` document row on the board now
opens the full core menu by right-click and by ⇧F10, the actions execute the core
routes through to disk, and the plugin column body remains completely excluded on
both gesture paths — verified against a real server with real documents, not the
stubbed transport the implementation log used.
