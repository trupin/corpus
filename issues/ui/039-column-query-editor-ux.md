# [UI-039] Column query editor: autocomplete + syntax help

## Domain
ui

## Status
done

## Priority
P2

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §5 views / §11 column configure (the query editor surface)

## Summary
Live dogfood report (2026-08-02, screenshot): editing a column's query presents
a bare text input holding the raw query (`type=todo`) with no assistance at
all. User directive: at minimum (a) autocomplete while typing — field names
(type, tags, status, folder, due, …) and, after a field, its actual values
from the projection (types in use, existing tags, statuses); (b) a help
affordance in/next to the input opening a concise query-syntax reference
(fields, operators, combinators, examples) so a user can learn the language
without leaving the editor.

## Acceptance Criteria
- [x] Typing in the query input suggests field names; after `field=`/operator,
      suggests real values from the workspace (via existing projection
      endpoints — no new routes unless escalated)
- [x] Suggestions follow the app's existing autocomplete conventions (the §11
      smart-input machinery, arrows/↵/esc)
- [x] A visible help button on the editor opens a syntax reference with
      examples; dismissible; keyboard reachable
- [x] Invalid queries surface the existing error state unchanged
- [x] No behavior change to query execution itself

## Orchestrator adjudication (2026-08-02)

The unrecognised-field `role="status"` notice (scope the agent added beyond the
stated criteria) is ACCEPTED as in-scope: the server tolerantly strips unknown
params, so a stored typo renders a healthy column that silently ignores its
filter — surfacing that is the same usability gap this issue exists for.
Non-blocking, no commit-path validation, both existing error states untouched.

## Technical Design
### Files to Create/Modify
- Column configure/query editor components; reuse the §11 autocomplete
  machinery if practical (smart input already suggests docs/skills/agents)
- Help content colocated with the editor; sourced from the actual parser's
  grammar so it cannot drift silently — escalate if the parser lives
  server-side without an introspectable surface

## Testing Strategy
Component tests for suggestion sources + help toggle; e2e for the flow.

## E2E Verification Plan
Real app: open a column's query editor; field + value autocomplete works
against real workspace data; help opens and matches the shipped grammar.

## E2E Verification Log

**Model: Opus 5 (`claude-opus-5[1m]`), ui-dev, 2026-08-02.**

### Grammar source (the anti-drift question the issue raises)

There is **no separate query parser** — a column's query *is* the
`GET /api/docs` query string. The canonical definition is
`DocsQuerySchema` in `packages/contract/src/schemas/query.ts`, and it is
introspectable: `Object.keys(DocsQuerySchema.shape)` returns the exact 19
field names the server parses (`q, type, status, includeArchived, tag, folder,
parent, references, agent, author, since, due, stale, unread, pinned, needs,
sort, limit, offset`). `apps/ui/src/board/query/grammar.ts` reads that list at
runtime, and every enumerated value list is the same exported constant the
contract validates against (`DOC_STATUSES`, `NEEDS_FILTERS`, `DOC_SORTS`,
`DUE_KEYWORDS`, `STALE_TIERS`, `THREAD_AGENT_STATES`, `ACTORS`,
`CORE_DOC_TYPES`). Autocomplete and the help panel both render from that one
module, so they cannot disagree with each other or with the server. The only
hand-written part is each field's one-line summary; `grammar.test.ts` fails if
a field the schema publishes has none.

Grammar shape confirmed from the same file: **one operator** (`=`), **two
combinators** (`&` = AND across fields, `,` = OR within one). No negation, no
grouping, no comparison — the help panel says exactly that.

### Value sources per field (existing endpoints only — no routes added)

| Field | Source |
| --- | --- |
| `type` | `GET /api/docs` rows, counted — types **in use**, then core types not yet used |
| `tag` | `GET /api/docs` rows' `tags`, counted |
| `folder` | `GET /api/tree`, via `newList.ts`'s `folderChoices` (same walk the new-list picker uses) |
| `parent`, `references` | `GET /api/docs` rows, offered **by title**, inserting the id (§5) |
| `status`, `needs`, `due`, `stale`, `agent`, `author`, `sort` | the contract's own enums |
| `unread`, `pinned`, `includeArchived` | `true` / `false` |
| `q`, `since`, `limit`, `offset` | **name-only** — free text, an ISO instant, a number: no vocabulary exists to enumerate, and the help panel states what to type instead |

One `GET /api/docs?limit=200&includeArchived=true` + one `GET /api/tree`, both
ordinary cached queries, issued only while an editor is open and shared across
every open editor by cache key. Bounded sample noted in the module docstring;
`CONTRACT-026` (tag/type aggregate) is what would make it exhaustive.

### Real-browser drill (Chromium, Playwright, `CORPUS_UI_PORT=6173`)

`apps/ui/e2e/query-editor.spec.ts`, **6/6 passed** (6.1 s). Actions and
observed behaviour:

1. **Field then value completion.** ⋯ → *Edit query* on a column storing
   `type=thread&status=open`; ⌘A, typed `ty` → `.ac-menu` listbox opened
   **below the field** (asserted from measured `getBoundingClientRect`:
   menu `y` > field `y`, `x` ≥ 0), listing `type` with its description
   ("Document type…"). `⇥` → field read `type=`; the menu re-opened on values
   and listed **`todo`** — a plugin type present only because a `type: todo`
   document exists in the stubbed corpus, which no hardcoded list could know —
   alongside `note`. Typed `tod`, `⇥` → `type=todo`.
2. **Closed sets and tree/tag values.** `status=` listed exactly
   `open, resolved, archived` in the contract's order. `↓` moved the highlight
   (`aria-selected="true"` on the second option), `↵` accepted →
   `status=resolved`. `&folder=` listed `finance` and `inbox` from
   `GET /api/tree`; `tag=` listed `finance` and `housing` off the rows.
3. **Escape layering.** With the menu open, first `esc` closed the menu and
   left the field open; second `esc` abandoned the edit — the column's chips
   still read `type: thread`, i.e. nothing was written.
4. **Syntax reference.** A visible `?` button beside the field opened a
   `role="dialog"` panel containing "AND, between fields", "OR, within one
   field", the example `needs=me&folder=finance`, and **19**
   `[data-query-field]` rows — asserted against
   `Object.keys(DocsQuerySchema.shape).length`, so the panel cannot list a
   different set than the server accepts. Opening it did **not** commit the
   edit (the field stayed open). `esc` inside the panel closed the panel only
   and returned focus to the `?` button; the field remained open.
5. **Write path unchanged.** Completing `type=note` and pressing `↵` produced
   exactly **one** `PUT /api/docs/doc_view_threads` with body
   `{"query":{"type":"note"}}` — the completed query verbatim. (Asserted on the
   request: the shared `stubCorpus` `PUT` handler applies `title`/`status`/
   `body`/`extra` and does not merge `query`, so its stored copy would answer a
   question about the stub, not the app. Column chips are not asserted for the
   same reason the stub documents — it pushes no SSE `invalidate`.)
6. **Unknown field.** `typ=todo` surfaced a non-blocking `role="status"` notice
   naming `typ`; `↵` still committed, body `{"query":{"typ":"todo"}}`.

Visual check by screenshot, light theme: the menu is the product's own
`.ac-menu`/`.ac-item` surface (kit CSS, no new look invented) and the help
panel is the same surface with a body. Two layout defects were found and fixed
this way — the panel was being clamped to `.ac-menu`'s 200 px cap (fixed with a
doubled `.ac-menu.query-help` selector) and `includeArchived` overflowed the
field column (widened to 106 px). Page horizontal overflow measured at **0 px**
with the panel open. All colours are existing tokens, so both themes follow.

### Gates

- `vitest run apps/ui/src` — **117 files, 1852 tests, all passing** (includes
  66 new tests across `grammar`, `queryCompletion`, `queryVocabulary` and
  `QueryEditor`).
- `tsc --noEmit` in `apps/ui` — clean for this change. One unrelated
  pre-existing error remains in `e2e/todos-menu.spec.ts` (a concurrent
  plugins-dev file, not this surface).
- `eslint` + `prettier --check` on every touched file — clean, no suppressions.

### Note beyond the stated criteria

`DocsQuerySchema` is a *tolerant* zod object, so the server **silently strips**
an unknown parameter rather than refusing it: a stored `typ=todo` renders a
perfectly healthy column that ignores the filter, with no error anywhere.
Autocomplete prevents the typo going forward; the advisory notice (item 6
above) is what surfaces one already sitting in a hand-edited view document. It
blocks nothing, adds no validation to the commit path, and leaves both existing
error states — `BoardColumn.error` and the column's failed-request card —
untouched.

## PR #19 review follow-up (2026-08-03)

**Model: Opus 5 (`claude-opus-5[1m]`).** Agent: ui-dev.

1. **Mid-token completion duplicated the tail.** `detectQueryTrigger` ended the trigger at
   the caret (the kit's `detectTrigger` convention — but that convention is safe only
   because a sigil bounds those triggers, and a query string has none, so *every* caret
   position sits inside a token). From `tye=note` with the caret at 2, `↵` wrote
   `type=e=note`, which `parseQueryString` reads as the **known** field `type` — so the
   unknown-field notice stayed silent and the column just rendered empty. The trigger now
   spans the whole token under the caret (stopping at `=`/`&` for a field, `,`/`&` for a
   value, trailing whitespace excluded), and `applyQueryCompletion` skips its `=` when the
   field already has one, putting the caret past it. 8 new cases in
   `queryCompletion.test.ts` plus a real-input `QueryEditor.test.tsx` case: type
   `tye=note`, caret to 2, `↵` → `type=note`, no `role="status"` notice.
2. **The `sort` help was wrong.** "A leading `-` reverses it" — but `DOC_SORTS` enumerates
   the keys and only `updated`/`created` have a descending form; `sort=-due` is a 400. Now
   "One of the keys below; -updated when unset." (the completion menu was already right).
3. **`.query-help-field`'s hard-coded `106px` name column** — fitted by hand to
   `includeArchived` in a panel that is otherwise schema-derived. The field list is now one
   grid (`grid-template-columns: max-content minmax(0, 1fr)`) with each row
   `display: contents`, so the column is exactly as wide as the widest name the contract
   publishes and the next longer filter needs no CSS edit.

Checks: `vitest run apps/ui/src/board/query` → **73 passed** / 4 files; full `apps/ui/src`
**1888 passed**; `tsc --noEmit`, `eslint`, `prettier` clean.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
