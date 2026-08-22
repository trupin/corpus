# [UI-088] A view cannot be told to show top-level documents only

## Domain

ui

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-042, SERVER-073
- Blocks: —
- Related: UI-087 (the rendering half of the same complaint)

## Spec References

- SPEC.md §10 — columns and saved views are filtered lists
- SPEC.md §9.2 — the filter set a view query composes from

## Summary

The surface the user actually asked for: *"so I can show parents only in
views."* CONTRACT-042 and SERVER-073 make `isParent` answerable; this makes it
reachable from a column or saved view without hand-editing the query.

## Acceptance Criteria

- [x] A column or saved view can be set to show top-level documents only, and
      the setting survives a reload the way the rest of a view's query does
- [x] It reads as **what it does** wherever it is shown. The parameter is named
      `isParent` but selects roots (CONTRACT-042), so a label reading "is a
      parent" would be actively wrong. The UI is where a person meets this, and
      the label is the only explanation they get
- [x] A view that does not set it is unchanged — no column silently starts
      hiding rows after this ships
- [x] It composes visibly with the filters already on the view, rather than
      replacing them
- [x] Reachable from the keyboard like every other affordance (§10 adds no
      exclusive-pointer capability)

## Technical Design

### Files to Create/Modify

- `apps/ui/src/board/viewDoc.ts` and the column query editor; check
  `apps/ui/src/board/newList.ts` for where a new column's query is composed.

### Notes

- Check how the existing boolean filters (`pinned`, `unread`, `stale`) are
  presented and follow that, rather than introducing a second idiom for the same
  kind of control.
- A saved view is a document, so its query is content on disk — confirm a query
  written by an older build still loads once this parameter exists.

## Testing Strategy

A view with the filter set returns only top-level rows; a view without it is
byte-identical in behaviour to before. Plus the label assertion — a test that
pins the wording is worth having precisely because the parameter's name
contradicts its meaning.

## What Shipped

No new affordance was invented. `pinned`, `unread` and `includeArchived` are
reached the same way — as fields of the column's query, offered by the query
editor's completion menu and its `?` reference — and this follows them exactly.
Three files carry the change:

- **`apps/ui/src/board/query/grammar.ts`** — `isParent` gets its sentence, its
  `true`/`false` value list, and a place in `READING_ORDER` directly after
  `parent`, whose question it is the other half of. Because the field *names*
  are read off `DocsQuerySchema` at runtime, the field itself was already being
  offered by the editor the moment CONTRACT-042 landed; what was missing (and
  what `grammar.test.ts` was failing on) was the prose. The summary is exported
  as `ISPARENT_SUMMARY` so a test can pin it character for character.
- **`apps/ui/src/board/viewDoc.ts`** — the chip. Every other filter shows its
  stored value verbatim; this one puts the value into words, because
  `isParent: true` on a column header would tell a user their column shows
  parent documents when it shows top-level ones. The **key is kept** so the chip
  still names the parameter it sends and the row still maps onto the query
  string behind ⋯ → Edit query. A value with no phrase (`isParent: yes` from a
  hand edit) renders verbatim and is refused on the round trip, per this file's
  standing rule that the server owns the grammar.
- **`QUERY_EXAMPLES`** gains `isParent=true&status=open`, because the name
  misleads and an example does not.

### The label wording, and why

| Where                     | Wording                                                                        |
| ------------------------- | ------------------------------------------------------------------------------ |
| Column-header chip, `true`  | `isParent: top-level only`                                                     |
| Column-header chip, `false` | `isParent: children only`                                                      |
| Completion menu + `?` panel | `Top-level only: true keeps documents with no parent. Never "has children".` |

"top-level only" is the issue's own vocabulary and the user's own ask ("show
parents only in views" ⇒ top-level documents). The summary states what `true`
selects in terms of *the absence of a parent*, which is the fact the name
denies, and closes with an explicit denial of the "has children" reading —
the reading CONTRACT-042 considered and rejected, and the one a future rewrite
would most plausibly "correct" the prose into. Three tests defend it: an exact
string pin, a meaning test (`contains "no parent"`, never `"is a parent"`), and
the chip labels asserted by equality.

The `parent=<id>` + `isParent=true` `400` is deliberately **not** restated in
the UI. `viewDoc.ts`'s standing rule is that a query the server refuses surfaces
through the column's own failed request, because two copies of the grammar can
disagree. Verified live: the server answers that pair with `400` (below).

## E2E Verification Log

**Model: Opus 5 (1M context).** Ports used: **5473** (Vite) and **8799** (a
scratch `corpus init` workspace). 8765 and 5173 were never bound.

### Real app, real server, real browser

A throwaway workspace (`corpus init /tmp/corpus-ui088 --port 8799`), a real
server process, the real Vite dev server proxying to it, and Chromium driven by
Playwright. The temp spec was deleted and the workspace and server torn down
afterwards; ports confirmed free.

Seeded: one note (`doc_syt3fy3p` "Mortgage options"), one pinned view
`Everything` with `query: {status: open}` — the *older-build* query, written
before this parameter existed — and later one thread `th_s6ndvyqj` hanging off
the note.

1. **A view that does not set it is unchanged.** On first load the `Everything`
   column rendered with chips `status: open` and no mention of `isParent`.
2. **Keyboard reach and composition.** `⋯ → Edit query` opened holding
   `status=open`. `End`, then typing `&isP` opened the menu on `isParent`; `⇥`
   completed to `status=open&isParent=`; `tru` + `⇥` gave
   `status=open&isParent=true`; `↵` committed. No pointer used inside the field.
3. **Survives a reload.** After `page.reload()` the chips read
   `status: open` **and** `isParent: top-level only`, and re-opening the field
   handed back `status=open&isParent=true` — the query as stored.
4. **On disk**, `data/docs/views/everything.md` holds:

   ```yaml
   query:
     status: open
     isParent: "true"
   ```

5. **It actually shows roots only, in the board.** With 12 open documents in the
   workspace (11 roots + the one thread), the column's live count read **11**,
   the child thread "Rate check" was absent, and the note it hangs off was
   present. Editing the query back to `status=open` in the same field took the
   count to **12** and brought "Rate check" back — one clause, added and removed,
   not a mode.
6. **Semantics confirmed against the server** (`GET /api/docs`):
   `status=open` → 12, `status=open&isParent=true` → 11,
   `status=open&isParent=false` → 1. `doc_syt3fy3p` — which now *has* a child —
   is in the `isParent=true` set; `th_s6ndvyqj` is not. That is the decided
   meaning: roots, not "has children".
7. **The contradiction is the server's to refuse**:
   `GET /api/docs?parent=doc_syt3fy3p&isParent=true` → **400**, with no UI
   restatement.

Note on scope: SERVER-073 was being implemented concurrently. The counts above
show the tree's server already answering the filter, but nothing in this issue
asserts that behaviour — the UI tests stub the network, and the row-level
filtering remains SERVER-073's to own.

### Automated

- `npx vitest run apps/ui packages/kit` → **2962 passed, 0 failed.** Includes
  the two previously failing `grammar.test.ts` assertions ("describes every
  field the schema publishes", "offers each field exactly once, in reading
  order"), neither weakened nor skipped.
- `npx playwright test query-editor.spec.ts column-header.spec.ts board.spec.ts`
  (`CORPUS_UI_PORT=5473`) → **19 passed**, including the two new specs:
  _"reaches isParent from the keyboard, described as what it does"_ and
  _"renders a stored isParent as top-level only, and hands it back as it is
  stored"_.
- `npx eslint apps/ui packages/kit` → clean. `prettier --check` → clean.
  `tsc --noEmit -p apps/ui` → clean.

**One unrelated failure observed and diagnosed, not caused by this change:**
`smoke.spec.ts` → "a failing health check fails soft with a notice in the
console strip" fails on this machine because it requires *nothing* listening on
`127.0.0.1:8765`, and the user's live corpus server holds that port. Proven
environmental: the same test passes unchanged with
`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8799`.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
