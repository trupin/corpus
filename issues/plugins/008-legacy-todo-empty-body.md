# [PLUGINS-008] Legacy frontmatter-items todo renders a silently empty body

## Domain
plugins

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: PLUGINS-005
- Blocks: —

## Spec References
- SPEC.md §12 todos (body-checkbox format, `corpus todos migrate`)

## Summary
Live dogfood report (2026-08-02, v0.1.0): a workspace whose todo documents
predate the PLUGINS-005 body-checkbox redesign (items under `items:` in
frontmatter, empty body) renders a reader with the stats card populated (the
projection still counts frontmatter items) and a completely empty body — no
checkboxes, nothing to toggle, select, comment on, or right-click. Every todo
affordance silently vanishes with no clue; the remedy (`corpus todos migrate`)
is undiscoverable from the UI. Cost the user all todo functionality until
diagnosed by hand.

## Acceptance Criteria
_Amended before spawn per sprint-023 Open Conflicts 1 and 7: the notice lives in
the plugin's own `DocPanel`, and covers all **three** legacy storage states._

- [x] A todo document with frontmatter `items:` and an empty body shows an
      explicit legacy-format notice in the reader naming `corpus todos migrate`
      (agent-side verb — the notice explains the agent/CLI runs it)
- [x] Legacy items render read-only under the notice (visible, not interactive),
      so content is never invisible — collapsed by default behind a count
- [x] A **malformed** legacy `items` key renders the notice with the plugin's own
      diagnostic instead of no panel at all (the previous `return null`)
- [x] A **dual-storage** document (body items *and* a legacy key) says it needs
      migrating, quoting the same clause `itemProblems`/`planWrite` use
- [x] A migrated document renders exactly as today — the notice never shows
- [x] Stats card behavior unchanged (and still absent where items are unreadable)

## Technical Design
### Files to Create/Modify
- `plugins/todos/ui/legacy.ts` (new) — the storage-state derivation, built
  entirely from `items.ts`'s existing exported reads
- `plugins/todos/ui/LegacyItemsNotice.tsx` (new) — the notice and the read-only
  collapsed list
- `plugins/todos/ui/TodoDocPanel.tsx` — renders the notice above the stats strip
- `plugins/todos/ui/todos.css` — the notice's two treatments

**The anticipated CONTRACT escalation does not fire** (sprint-023 C2):
`DocPanelProps` is `{ doc: Doc }` — the whole document, `body` and
`frontmatter.extra` included — so no kit change and no core change is needed.
Removed from this design rather than left as a live option.

**Attribution correction** (sprint-023 C1): the populated stats card on a legacy
document does not come from the projection. `readItems` reads the body first and
falls back to the legacy key (`items.ts:375-382`); the panel calls it on the
whole document, in the browser.

## Testing Strategy
Component tests on all three states plus the migrated-document negative, through
`TodoDocPanel` (the public entry point); e2e with legacy fixtures in a new spec
file — `apps/ui/e2e/todos.spec.ts` is UI-034's this sprint (Open Conflict 6).

## E2E Verification Plan
Real app: create legacy-format todo files on disk; reader shows the notice and
read-only items; run migrate; notice disappears and checkboxes work.

## E2E Verification Log

**Model: Opus 5 (`claude-opus-5[1m]`).** Date: 2026-08-02.

### Real app, real server, real files on disk

Workspace: `corpus init` in a scratch directory → port 8766, real git repo.
Three `type: todo` files written **directly to disk** (a pre-existing workspace
is exactly how these states arise), then the real server, then the real UI
(Vite dev server on 5273, `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8766`,
`VITE_CORPUS_TOKEN` from `.corpus/config.json`), driven with a headless browser.

The server really does hand back the legacy key — `GET /api/docs/doc_legacychores`:

```
"extra":{"items":[{"text":"Book the passport appointment","done":false,"ts":"2026-07-01T09:00:00Z"},
                  {"text":"Send the signed form","done":true,"ts":"2026-07-01T09:00:00Z"}]}
"body":"\nChores that landed in the inbox before the item format changed.\n"
```

**Before the fix's states, as rendered in the reader** (`.reader [data-todo-legacy]`):

| Document | notice | kind | stats panel | editor checkboxes |
| --- | --- | --- | --- | --- |
| `doc_legacychores` (items in frontmatter, empty body) | 1 | `frontmatter` | 1 — open 1 / done 1 | 0 |
| `doc_brokenchores` (`items: nope`) | 1 | `malformed` | **0** | 0 |
| `doc_dualchores` (body item + legacy key) | 1 | `dual` | 1 — open 1 / done 0 | 1 |

Read-only list on `doc_legacychores`: `details open by default: false` (collapsed),
`2 ITEMS, STORED IN FRONTMATTER`, expanding gives
`["open: ☐Book the passport appointment","done: ☑Send the signed form"]`, and
`button/input/a` inside the whole notice: **0** — there is no UI trigger, by design.
Screenshot: the notice sits above the stats strip, above the body, in the column
reader; identical in full-screen focus.

**The dual-storage claim, checked against the real refusal** —
`PUT /api/x/todos/doc_dualchores/items/0`:

```
HTTP 400
{"code":"bad_request","message":"doc_dualchores carries items in its body *and* in its
 `items` frontmatter, and was not written — remove whichever list is stale before writing to it"}
```

The on-screen notice quotes `itemProblems`' sentence, which shares its clause with
that refusal — a user reading the reader can predict the agent's failure.

**The real verb.** `corpus todos migrate --dry-run` then `corpus todos migrate`:

```
migrated Legacy chores [doc_legacychores] — 2 items moved into the body
skipped Hand-edited chores [doc_brokenchores] — … malformed items … found string
skipped Half-migrated chores [doc_dualchores] — … carries items in its body *and* in its `items` frontmatter …
1 migrated · 2 skipped · 0 already migrated
```

The two documents `migrate` **skips** are exactly the two whose notices say to fix
something by hand first — the notice and the verb agree about who has to act.

File on disk afterwards (`data/docs/inbox/legacy-chores.md`): the `items:` key is
gone and the body carries `- [ ] Book the passport appointment` /
`- [x] Send the signed form`; auto-commit `doc edit: Legacy chores (doc_legacychores) by user`.

**After migration**, reloading the reader: `notice count: 0`, panel `open 1 / done 1`
(the same two numbers as before — the notice added a region, it did not move a
number), `editor checkboxes: 2` `[false, true]`.

**The affordance the bug removed, back.** Repairing the two skipped documents as
their notices instruct and re-running `migrate` cleared all three
(`1 migrated · 0 skipped · 2 already migrated`), and clicking the first checkbox in
the previously-legacy document wrote through the core path: on screen
`[false,true] → [true,true]`, panel `0 open / 2 done`, and on disk
`- [x] Book the passport appointment`.

### Automated

- `plugins/todos/ui/TodoDocPanel.test.tsx` — **29 passed** (14 new, covering the
  three states, the migrated negative, the empty-legacy-key non-case, the
  no-request assertion, and the notice clearing on re-render with no reload).
- `apps/ui/e2e/todos-legacy.spec.ts` (new) — **10 passed**, run as
  `CORPUS_UI_PORT=5273 playwright test e2e/todos-legacy.spec.ts`.
  `apps/ui/e2e/todos.spec.ts` was **not touched** (UI-034 holds it, Open Conflict 6).
- Workspace gate: `vitest run plugins/todos` — **273 passed / 9 files**.
- `eslint` clean on `plugins/todos` and the new spec; `prettier --check` clean;
  `tsc --noEmit` clean in both `plugins/todos` and `apps/ui`.

**Deviation from TEST-1063**, deliberately: the diff is inside `plugins/todos/**`
except for the **new** e2e spec `apps/ui/e2e/todos-legacy.spec.ts`, which the
orchestrator's spawn instruction required in place of editing `todos.spec.ts`.
`packages/kit`, `packages/contract` and every other file in `apps/ui` are
untouched, and `plugins/todos/ui/todos.css` is the only stylesheet changed.

**Not covered by e2e, by construction**: TEST-1056's "no reload" is a component
test rather than a browser one — the browser suite's stub pushes no SSE and the
kit's `staleTime` is `Infinity`, so nothing in it can deliver a migrated document
to a mounted reader. The real-app drill above covers the migration itself.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier + tsc, scoped to the touched workspaces)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
