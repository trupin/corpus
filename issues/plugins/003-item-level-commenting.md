# [PLUGINS-003] Item-level anchored commenting on plugin-rendered documents

## Domain

plugins

## Status

done

## Priority

P2

## Model

fable — requires a design for anchoring outside the body-range model.

## Dependencies

- Depends on: UI-014, PLUGINS-002
- Blocks: —

## Spec References

- issues/sprints/sprint-014.md — Open Conflict 8 + Adjudication 16 (2026-07-28)
- issues/sprints/sprint-016.md — PLUGINS-003 (TEST-456–464), Open Conflict 3, Adjudications 14/24
- SPEC.md §6 (threads and anchors), §10 (plugin system), §10 (document view), §12 (todos), §12 M6

## Summary

Filed from sprint-014 Open Conflict 8, struck from PLUGINS-002. Anchored comments on individual
todo items are unreachable today under either storage format: anchors resolve against the document
*body* while items live in frontmatter, and `selectorFromSelection` is a ProseMirror/`DocEditor`
affordance that a plugin `View` replaces entirely (a plugin View wins over the editor — UI-014).
Needs a real design: either a kit-provided selection→selector affordance plugin Views can embed,
or an item-keyed anchor variant, or moving items into the body. Document-level commenting on todo
docs is the v1 behavior.

## Acceptance Criteria

- [ ] Design decision recorded (spec amendment if the anchor model grows a variant).
- [ ] A comment can be opened on an individual todo item from the plugin View and round-trips
      through the standard thread machinery.

> **Wave 2 (2026-07-30) — scope ruling.** Per sprint-016 Open Conflict 3, this issue ran
> **design-only**: criterion 1 is delivered by the Technical Design below; criterion 2 is
> **STRUCK → Open Conflict 3** and is carried by the wave-3 issue chain proposed in
> "Decomposition for wave 3". Criterion 2's wording ("from the plugin View") is superseded by the
> recommendation — the design's whole point is that the todo document stops having a plugin `View`.

## Technical Design

### The problem, stated exactly

Anchoring is a **body-text** mechanism end to end, and todo item text is not body text.

| Stage | Where | Signature / fact |
| --- | --- | --- |
| Capture | `apps/ui/src/anchors/selectorFromSelection.ts:39-48` | maps a **ProseMirror** range through the serializer's emission trace (`pmRangeToMd`, `DocumentTrace`) into markdown offsets |
| Create | `packages/contract/src/schemas/thread.ts:140-156` | `selector: {exact: min(1), prefix?, suffix?}` — **no check that `exact` occurs in the parent body** |
| Resolve (read) | `apps/server/src/docs/read.ts:242` → `anchors/resolve.ts:25-45` | `resolveAnchorExact(parsed.body, selector)` |
| Resolve (project) | `apps/server/src/projection/project-document.ts:351-366` | `anchors(doc_id, anchor_id, exact_text, prefix, suffix, resolved_offset)` — an offset **into the body** |
| Reconcile (write) | `apps/server/src/anchors/reconcile.ts:72-280` | driven by `computeOffsetMapper(oldBody, newBody)` — a **body diff** |
| Validate | `apps/server/src/core/check.ts:391` | `resolveAnchor(document.parsed.body, selector)` |
| Render | `apps/ui/src/reader/DocView.tsx:88-96,228-260` | `anchorsHost = … && PluginView === null`; chips/margin cards are ProseMirror **decorations** |

Todo items live in `extra.items` (`plugins/todos/items.ts:34-59`), i.e. in frontmatter, pinned there
by PLUGINS-002. So the five sprint-016 facts reduce to two independent gaps:

- **Gap A (resolution).** No text exists in the body for an item selector to match, and nothing
  refuses the selector on creation — `POST /api/threads` accepts any `exact` and the next read
  answers `range: null, orphaned: true`. Any design that does not close Gap A produces threads that
  are **orphaned from birth** and looks like it worked in a demo (sprint-016 fact 4, TEST-462).
- **Gap B (rendering).** Wherever a plugin `View` wins, the anchor layer is structurally absent:
  every thread on the document falls into the flat `thread-slots` list below the body
  (`DocView.tsx:249-260`). Attaching a thread to an item and *showing* it on that item are two
  separate pieces of work (fact 5, TEST-464).

Any candidate has to close both. The candidates differ mainly in **who pays** — and the winner is
the one that closes both by making them stop existing.

### Candidate 1 — a kit-provided selection→selector affordance plugin Views embed

**Rejected.** Two independent failures, either fatal.

1. *It does not close Gap A.* Item text is not in the body, so the selector it captures cannot
   resolve. This is sprint-016 fact 4 applied literally: the thread is created, `200` is returned,
   and the very next `GET /api/docs/:id` reports it orphaned. TEST-462 rejects it by construction.
2. *Its capture primitive cannot be built for an arbitrary plugin View.* `selectorFromSelection`
   does not read the DOM — it maps ProseMirror positions through the **serializer's emission trace**
   for the markdown the editor itself produced. Its own docstring states why: a selection reading
   `30-year fixed quote` on screen is `**30-year fixed** quote` in the file, and "a tidied quote is
   a quote of a document that does not exist". A plugin `View` renders from parsed data and owns its
   own DOM; there is no trace, so a kit affordance would have to invent a **plugin-side
   offset-annotation protocol** ("this element renders body bytes [a,b)") and make every plugin
   implement it correctly, forever, or silently produce wrong quotes.

Candidate 1 is therefore not a design. It is at most the *capture half* of a design that has already
put the item text in the body — and once the text is in the body, the editor supplies the capture
half for free (see the recommendation), so even that role disappears.

### Candidate 2 — an item-keyed anchor variant in the contract

The honest, general form: `anchors` values grow a second kind — a **field anchor** — carrying a
pointer into structured frontmatter plus the quoted value, e.g.
`{target: "/extra/items/3/text", exact: "book the passport appointment"}`, resolved by transposing
the §6 ladder from "positions in a string" to "elements in a collection" (pointer hit → unique exact
match among siblings → fuzzy among siblings → orphan). It is buildable, it is not obviously wrong,
and it answers TEST-458's four lifecycle events. **Rejected on cost and on blast radius**, for five
reasons:

1. **It forks the anchor engine.** `resolveAnchor`/`resolveAnchorExact` take `(body, selector)` and
   are called from four places; reconciliation is *defined* by a body diff
   (`computeOffsetMapper(oldBody, newBody)`), and a frontmatter-only patch produces **no body diff at
   all** — so a field anchor needs a **second reconciler**, driven by a collection diff, living
   beside a 14.6 KB engine with a 66 KB test file.
2. **None of that engine's proof transfers.** SPEC §6's guarantees are not code, they are a body of
   adjudicated invariants — "a visible orphan beats a silent misattachment", the moved-passage
   family, SERVER-012's straddle/self-round-trip/overlap checks, SERVER-013's substitution class,
   "an anchor already orphaned before the save is never silently re-attached". Every one would have
   to be re-earned, from scratch, in a second engine, for a second target kind.
3. **It breaks a coupling the contract has published.** `ResolvedAnchorSchema`
   (`packages/contract/src/schemas/doc.ts:163-181`) makes `range: null` **mean** `orphaned: true`. A
   field anchor is resolved and has no body range, so `{range: null, orphaned: false}` must become
   representable — which changes the meaning of a shipped field for every existing consumer
   (`useAnchorLayer`, `anchorPlacement`, the CLI's `doc check` output, the generated client).
4. **It grows the projection's schema.** `anchors(… resolved_offset)` gains a target column, which
   is a projection migration plus `db rebuild` / `db doctor` work.
5. **It still does not close Gap B**, and it costs a §6 spec amendment (the anchor model literally
   grows a variant) with user sign-off — on the product's most load-bearing mechanism — for a
   generalisation whose only consumer is one bundled plugin, in a product whose §1 declares
   third-party plugin distribution a non-goal.

Blast radius if it were chosen: `packages/contract` (anchor.ts, doc.ts, thread.ts + regenerated
`openapi.json` and typed client, consumed by **both** UI and CLI) → `apps/server`
(resolve/reconcile/read/write/check/projection) → `packages/kit` + `apps/ui` (a placement path for
range-less anchors, plus thread rendering exported to plugins for Gap B) → `plugins/todos`. Four
domains, in that order, plus a SPEC §6 rider. That is the most expensive of the three options and it
buys the *least* — the reference plugin ends up with a bespoke anchoring path that shares none of
core's hardening.

### Candidate 2b (named to be rejected) — a plugin-private item↔thread association

Create the thread with `anchor: null` and record the item in the **thread's** own `extra`. Tempting:
zero core change, and the standard thread verbs still apply. **Rejected**: it is an anchor by another
name living outside `anchors`, so nothing about it works — no reconciliation, no orphan visibility,
no `doc check`, no git-preserved quote, and the relation is one core "cannot reason about"
(SPEC.md §10's closing rule). It also fails TEST-462 in spirit: nothing resolves because nothing
resolves anything. This is precisely the class of thing `plugins/todos/imports.test.ts:104-116`
exists to forbid.

### Candidate 3 — the item text moves into the document body ✅ RECOMMENDED

**Recommended, in the variant below.** Items become GFM task-list lines in the body:

```markdown
- [ ] Book the passport appointment
- [x] Send the signed form
```

and `plugins/todos/items.ts` becomes the parser/serializer of that format instead of a frontmatter
schema — still "the one module that knows what a todo item is", still the format owner
(SPEC.md §12: "items as markdown checkboxes in the body — builder's choice, but the server must own
the format", which is satisfied because every write still goes through `mutateDoc` → the core write
path).

**Gap A vanishes.** The item's text *is* body text, so a comment on it is an ordinary text-quote
anchor. It resolves on creation, resolves after a round trip, projects with a real
`resolved_offset`, and survives `db rebuild`/`doctor` — not because new code makes it so, but
because there is nothing special about it.

**Gap B vanishes too, in the recommended variant: the plugin stops registering a `View` for
`todo`.** With no `View`, `DocView.tsx:88-96` computes `anchorsHost = true` (`editorHandlesType`
excludes only `thread` and `view` — `DocEditor.tsx:45`), and the todo document renders in the
**core editor**, which already ships GFM task lists end to end:
`@tiptap/extension-task-list` + `@tiptap/extension-task-item` are configured in
`apps/ui/src/editor/markdown/schema.ts:78-79`, parsed at `parse.ts:166`, serialized at
`serialize.ts:231`, and rendered by the kit's `MarkdownView` (`markdown.css:103-104`) when the
plugin is absent. So the user gets checkboxes **and** the entire §10 document surface on the same
screen: select an item → the floating toolbar's **Comment** → an anchored thread, with the highlight,
the chip or margin card, and the detached-threads region, all of it existing code.

This is the domain's own "**views before React**" rule applied one level up: a `View` whose job is to
render a checkbox list that core renders *better* — with anchors, autosave, `[[ref]]` autocomplete,
markdown shortcuts and lock handling — is not a feature, it is a downgrade that costs the document
its anchor layer. UI-014 already ruled that a plugin `View` wins over the editor; the correct
response is not to rebuild the editor inside the plugin, it is to stop claiming the slot.

Three further consequences, all in the design's favour:

- **Templates start working for todos.** SPEC §10 makes template pre-fill body-only, which is why
  `items.ts:27-31` has to argue that "absent `items` is an empty list" — no seed can supply items
  today. Under body storage, `plugins/todos/seeds/todo-template.md` can seed real starter items.
- **The §12 M6 drill gets *more* honest.** Delete `plugins/todos` → the document still renders as
  plain markdown **with working-looking checkboxes**, exactly as §10's degradation promise says;
  restore → the DocPanel, the `ListItem` and the Todos column return.
- **`plugins/todos/imports.test.ts`'s ban stays green, untouched** (Adjudication 14): the plugin
  still mentions no `TextQuoteSelector`, no `resolveAnchor`, no `selectorFromSelection`. Core does
  all of it. That the ban survives *unchanged* is the strongest single signal that this design is
  the one the boundary was drawn for.

#### Why not Candidate 3b (items in the body, plugin keeps its `View`)

Storage alone closes Gap A but not Gap B: a `View` still suppresses `anchorsHost`, so the plugin
would need (i) a kit capture affordance — which, per Candidate 1, requires a plugin-side
body-offset-annotation protocol — and (ii) kit-exported thread rendering (`ThreadSlot`/`ThreadCard`
live in `apps/ui/src/reader`/`src/thread` today, not in `@corpus/kit`) plus a placement mechanism
that is not ProseMirror decorations. That is a multi-issue ui-dev programme to reproduce, worse, a
surface the editor already gives for free — and it would force the anchoring ban in
`imports.test.ts` to be rewritten. Rejected.

### The costs of the recommendation, stated plainly

1. **It reverses PLUGINS-002's frontmatter decision** and needs a migration for existing todo
   documents (sprint-016 Out of Scope allows exactly this, conditioned on this design choosing it
   and the orchestrator ruling the chain in).
2. **Per-item `due` and `ts` lose their home.** `ts` has no consumer beyond React keys and ordering
   (body order becomes the order), but `due` is shipped behavior — `corpus todos add --due`, the
   overdue treatment in `TodoListItem`/`TodosColumn`, `dueCount`/`isOverdue` in `items.ts:296-305`.
   Body form needs either an inline convention the plugin parses (`- [ ] text (due: 2026-08-01)`) or
   a deliberate drop to the document-level `due` core field. **Open question 1.**
3. **The Todos column loses its one-query story.** `extra` rides every list row
   (`docRowBaseShape`), which is why `TodosColumn` aggregates open items across every todo document
   with a single `useDocs` and no N+1 — the plugin's own docstring calls this "the kit-only proof".
   Bodies do **not** ride list rows (only `excerpt`), so the column must re-source. Recommended
   mitigation, in the wave-3 issue: the plugin's existing `GET /api/x/todos` route aggregates
   server-side (it already lists todo documents with open/done counts), and the column keys that
   `usePluginQuery` on the `(id, updated)` fingerprint taken from a `useDocs({type:"todo"})` call —
   so a core-path body edit changes `updated`, changes the key, and refetches. Without that
   fingerprint there is a real live-update hole: a core write broadcasts `["docs"]` and never
   `["x","todos",…]`.
4. **Two signed SPEC §12 clauses stop being true**: "Renderer: checkbox list view" and "toggling a
   box PUTs through a plugin route" (the UI toggle becomes an ordinary body edit through autosave;
   the plugin route stays the CLI/agent path, which is where format ownership actually matters). Plus
   §12 M6's "restore → custom renderer, DocPanel, and Todos column return". **Open questions 2 and
   3** — spec-writer rider, never patched in passing (TEST-459/465, Adjudication 24).
5. **The `View` extension point loses its shipped consumer.** The `docTypes` slot is still exercised
   by the reference plugin through `ListItem`, `DocPanel` and `validate`; `View` remains contracted
   and covered by the underscore fixture plugin, and §13's publish plugin is its natural first real
   consumer. This is a real reduction in the reference plugin's demo surface and should be an
   explicit user call, not a side effect.

### Item identity and the four lifecycle events (TEST-458)

An item comment is anchored **to the item's text**, as an ordinary text-quote selector — no stable
id is introduced and `TodoItemSchema` needs no id field. Identity therefore inherits §6 wholesale,
and every outcome below is *existing, adjudicated* behavior rather than something this design
invents:

| Event | Path | Outcome |
| --- | --- | --- |
| **Checked** | `PUT /api/x/todos/:doc/items/:i` → `mutateDoc` → core write path, or a click in the editor | `- [ ] text` → `- [x] text`: `exact` is unchanged, only the prefix is. Rung 1 fails, **rung 2 (unique `exact`) resolves**, reconciliation refreshes `prefix`/`suffix`. Thread stays attached. |
| **Renamed** | same routes, or typing in the editor | In-place edit inside the anchored range → the mapped slice becomes the new `exact` (`reconcile.ts`, "range partially edited"), subject to the honesty checks. Thread stays attached, quote stays truthful (§6 "recomputed quotes are honest"). |
| **Reordered** | a list rewrite through the routes, or cut/paste in the editor | The moved-passage family: "an anchored passage moved wholesale within the document … keeps its thread at the new location" (§6). Thread follows the item. |
| **Deleted** | `DELETE /api/x/todos/:doc/items/:i`, or deleting the line | Text is gone → **orphaned**, selector preserved byte-for-byte, thread still fully functional and listed in the detached-threads region (`DocView.tsx:255`, `AnchoredThreads.tsx:19-20`). Never silently detached, never re-attached to a lookalike. |

Two items with identical text are the only interesting ambiguity, and §6 already answers it: rung 1
disambiguates by context, rung 2 refuses a non-unique `exact`, and reconciliation's offset mapper
plus its overlap check keep two threads anchored to disjoint text from claiming overlapping text.

### Blast radius by domain (TEST-457)

| Workspace | Owning domain | Touched? |
| --- | --- | --- |
| `packages/contract` | contract-dev | **No.** No schema, no route, no regenerated client. |
| `apps/server` | server-dev | **No.** No anchor, projection, write-path or check change. |
| `packages/kit` | ui-dev | **No.** No new export; `View` simply goes unused by this plugin. |
| `apps/ui` | ui-dev | **No**, contingent — the editor already handles the type once no `View` is registered. Only if the wave-3 drill finds a task-list round-trip or capture defect does a ui-dev issue get filed, on discovery. |
| `plugins/todos` | plugins-dev | **Yes** — storage, routes, CLI-facing behavior, manifest, column, seeds, tests. |
| `SPEC.md` | spec-writer + user sign-off | **Yes** — a rider, filed and signed, never edited by an implementing agent. |

**This falsifies sprint-016 Open Conflict 3's premise for the chosen option**: the conflict assumed
every candidate crosses a domain `plugins-dev` may not edit. The recommended design crosses none —
it is plugins-dev work gated on one spec rider. Candidates 1 and 2 are the ones that would have
needed the four-domain chain, and they are rejected above.

### Decomposition for wave 3 (proposed — orchestrator files these; do not create them here)

```
SHARED-005 ──▶ PLUGINS-005 ──┬──▶ PLUGINS-006 ──┐
                             └──▶ PLUGINS-007 ──┴──▶ PLUGINS-003 closes
```

- **SHARED-005 — spec rider: todos storage branch, renderer/toggle clauses, and the `[TBD]`**
  (spec-writer, **fable**, user sign-off). Retire §12's `[TBD: PLUGINS-003]`; select §12's
  body-checkbox branch; restate "Renderer: checkbox list view" and "toggling a box PUTs through a
  plugin route"; restate §12 M6's "custom renderer" clause; record the per-item `due` decision
  (open question 1). Bundled with Open Conflict 2's sentences in one sign-off round
  (Adjudication 24). **Blocks everything below.**
- **PLUGINS-005 — todo items move into the document body as GFM task-list lines** (plugins-dev,
  **opus**). `items.ts` becomes a body parser/serializer; the routes recompute the body under
  `mutateDoc`; CLI verb surfaces (`add|check|list`) are unchanged; `validate` updated; a bulk
  migration path for existing documents plus read-both/write-body tolerance; seeds and template
  updated; `parity.test.ts` and `imports.test.ts` kept green. **Depends on SHARED-005.**
- **PLUGINS-006 — todos stops registering a `View` for `todo`; item comments land** (plugins-dev,
  **opus**). Removes the `View` from the manifest so the core editor renders the task list and
  `anchorsHost` becomes true; delivers this issue's acceptance criterion 2 and sprint-016
  TEST-461–464; ships the first `apps/ui/e2e/` todos spec (there is none today) plus the manual
  real-app drill. **Depends on PLUGINS-005.**
- **PLUGINS-007 — the Todos column re-sourced off the body** (plugins-dev, **opus**). Server-side
  aggregation through the plugin's own route + the `useDocs` `(id, updated)` fingerprint that keeps
  live updates honest. **Depends on PLUGINS-005; parallel with PLUGINS-006.**
- **Contingent UI-0xx** (ui-dev, filed **on discovery only**): a task-list round-trip or
  comment-capture defect surfaced by PLUGINS-006's drill. Not pre-filed — pre-filing it would
  invent work the shipped extensions may already do correctly.

`PLUGINS-003` stays open as the umbrella and closes when PLUGINS-006 lands.

### Open questions — decision required before wave 3 starts

1. **Per-item `due` (user + spec-writer).** Body form has no field for it. (a) Drop it and rely on
   the document-level `due` core field (§5), losing `corpus todos add --due` and the per-item
   overdue treatment; (b) an inline convention the plugin parses, e.g. `- [ ] text (due:
   2026-08-01)`, which the user can break by typing and which is a micro-syntax SPEC.md does not
   describe; (c) a frontmatter sidecar keyed by item text — **rejected here** as re-inventing
   anchoring in plugin space. Recommendation: (b), with the plugin tolerating absence; needs
   sign-off because it adds product surface.
2. **§12 "toggling a box PUTs through a plugin route" (user + spec-writer).** Under the
   recommendation the UI toggle is an ordinary body edit through core autosave; the plugin route
   remains the CLI/agent write path and the format owner. Confirm the restatement.
3. **§12/§12 "Renderer" (user).** The reference plugin stops registering a `View`. Confirm that the
   `docTypes` extension point is adequately proved by `ListItem` + `DocPanel` + `validate` (plus the
   fixture plugin and, later, §13's publish plugin), or state that a shipped `View` consumer is
   required — in which case Candidate 3b's cost has to be re-opened.
4. **Migration policy (orchestrator/plugins-dev — design detail, not spec).** Bulk
   `corpus todos migrate` verb vs. migrate-on-first-write vs. read-both-forever, and whether
   `corpus doc check` should warn on residual `extra.items`. Mixed-format states are what make the
   aggregate column ambiguous during a transition, so a bulk verb plus tolerant reads is the
   recommended shape.
5. **Loss of per-item `ts` (plugins-dev, flagged).** It exists today only for React keys and
   ordering; body order becomes the order. Confirm at implementation time that the skill, the CLI
   output and the column have no other consumer.

## Testing Strategy

Design-only in wave 2 — nothing to test. The wave-3 chain inherits sprint-016's TEST-461–464 as its
acceptance bar, with TEST-462 (resolved, not orphaned, on creation **and** after
`GET /api/docs/:id` + `corpus db doctor`) as the single gate that separates the design from a demo.
TEST-460's fallback — whole-document commenting on todo documents — must keep working at every
point in the chain, including on documents created before the migration.

## E2E Verification Log

_Filled in by the implementing agent. State the model._

### Wave 2 — design deliverable (2026-07-30, plugins-dev on **Opus 5**)

Design-only per sprint-016 Open Conflict 3: **no code changed, no server started, no test run, no
git command.** The design above was grounded by reading shipped code only —
`plugins/todos/{items.ts,manifest.ts,server/routes.ts,ui/*}`,
`packages/kit/src/{index.ts,plugin/index.ts}`, `packages/contract/src/{schemas/{anchor,doc,thread}.ts,plugin/server.ts}`,
`apps/server/src/{anchors/{resolve,reconcile}.ts,docs/read.ts,projection/project-document.ts,core/check.ts}`,
`apps/ui/src/{reader/DocView.tsx,anchors/{selectorFromSelection,AnchoredThreads}.tsx,editor/{DocEditor.tsx,markdown/{schema,parse,serialize}.ts}}` —
and the two load-bearing discoveries are recorded here because they are what decided it:

1. `editorHandlesType` (`apps/ui/src/editor/DocEditor.tsx:45,79-81`) excludes **only** `thread` and
   `view`, so dropping the plugin `View` is sufficient to make `anchorsHost` true for `todo` — no
   `apps/ui` change is required to give todo documents the anchor layer.
2. The core editor already supports GFM task lists in both directions
   (`schema.ts:7-8,78-79`, `parse.ts:166`, `serialize.ts:231`) and the kit's `MarkdownView` renders
   them (`markdown.css:103-104`), so "items as markdown checkboxes" needs no editor work either.

TEST-465/466 hold: `SPEC.md` and `packages/contract` were read, never written. The only file this
session modified is this issue file.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
