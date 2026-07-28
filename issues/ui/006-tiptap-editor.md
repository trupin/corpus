# [UI-006] Always-editable TipTap document editor

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus — well-trodden TipTap+markdown territory; the hard parts (anchor offset mapping, decoration remapping) are isolated in UI-007.

## Dependencies

- Depends on: UI-005
- Blocks: UI-007

## Spec References

- SPEC.md §11 — "UI — the board" → _Document view — always editable, Google-Docs-like_ (no edit mode, markdown shortcuts, autosave, selection toolbar, `[[` autocomplete, lock read-only state)
- SPEC.md §11 — _Smart input everywhere_ (`[[` → documents by title, inserts the id ref)
- SPEC.md §6 — "Threads and anchors" → _Anchor reconciliation (automatic)_ (every save runs reconciliation; `PUT /api/docs/:id` reports remapped/orphaned)
- SPEC.md §5 — inline references are id-based, render as the target's **current** title, alias form `[[id|as text]]`
- SPEC.md §7 — _Document locks_ (locked document renders read-only)
- SPEC.md §9.2 — `PUT /api/docs/:id`, `GET /api/docs` (title search for `[[`)
- SPEC.md §15 M3 — Playwright check: "omnibox-create a doc … → type (file updates via autosave; anchors survive; squashed auto-commit on idle)"
- `design/index.html` — **authoritative look & feel** (`.doc-body`, `.doc-title`, `.save-chip` + `.saving`/`.saved`, `.sel-toolbar` + `.comment-btn`, `.ref`, `.ac-menu`/`.ac-item`, `.lock-banner`, `[contenteditable] { caret-color: var(--accent) }`)

## Summary

Replace the reader's read-only markdown body with a TipTap (ProseMirror) editor that is **always editable** — there is no edit mode, you click anywhere and type. The editor loads the document's markdown, renders it as rich text with the serif `.doc-body` typography from the prototype, applies markdown input shortcuts as you type, and serializes back to **clean, round-trip-stable markdown**. Writes go out debounced through `PUT /api/docs/:id`, and the response — which reports anchor reconciliation and the commit — drives the save chip through `saving… → saved · anchors ✓ → committed · git ✓`. `[[` opens inline title autocomplete inserting an id ref that renders as the target's current title. A floating selection toolbar offers **B**, **I**, and a **💬 Comment** button whose selection payload is handed to UI-007. When the document is locked (§7) the editor is read-only and visually flat.

This issue owns the editing surface and the markdown round-trip; UI-007 owns anchors, decorations, and threads on top of it.

## Acceptance Criteria

- [ ] Opening a document in a column reader (and in focus mode) renders its body in a TipTap editor that is editable immediately — no "Edit" button, no mode switch; clicking mid-paragraph places a caret (`caret-color: var(--accent)`).
- [ ] **Round-trip stability**: loading any document's markdown into the editor and serializing it back with **zero edits** produces a byte-identical string. A Vitest fixture suite covers headings, bold/italic/code, bullet + ordered lists (nested), fenced code blocks, blockquotes, links, `[[refs]]`, horizontal rules, hard breaks, and mixed documents.
- [ ] Markdown input shortcuts work as you type: `## ` → H2 (and `#`–`####`), `**bold**`, `*italic*`/`_italic_`, `` `code` ``, `- `/`* ` → bullet list, `1. ` → ordered list, ``` ``` ``` → code block, `> ` → blockquote.
- [ ] Autosave: edits debounce ~700 ms into one `PUT /api/docs/:id` carrying the serialized markdown; no save button exists anywhere in the UI.
- [ ] The save chip (`.save-chip`) reflects real state driven by the PUT lifecycle: `saving…` (class `saving`) while in flight → `saved · anchors ✓` (class `saved`) when the response reports reconciliation → `committed · git ✓` when the response reports the commit. Chip states are never faked on a timer when the response has not arrived; a failed PUT shows an error state and retries.
- [ ] Typing `[[` opens an inline autocomplete menu (`.ac-menu`) searching document titles via the kit's `useDocs` hook; selecting an entry inserts a `[[<id>]]` ref node that **renders as the target's current title**. The alias form `[[<id>|as text]]` round-trips and renders its alias.
- [ ] Selecting text pops a floating toolbar (`.sel-toolbar`) positioned above the selection with **B**, **I**, a divider, and **💬 Comment**. B/I toggle marks and reflect active state. Comment calls an injected `onComment(selection)` callback (no-op stub until UI-007 wires it) and does not mutate the document.
- [ ] Editing the title heading writes the frontmatter `title` through the same debounced PUT (title is frontmatter, not body — it must not be serialized into the markdown body).
- [ ] When `GET /api/docs/:id` reports an active lock, the editor is `editable: false`, renders visually flat (no caret, no selection toolbar, no input shortcuts), and the existing lock banner remains the only affordance; unlocking (via SSE) restores editability without a remount that loses scroll position.
- [ ] While the user is actively editing a document, SSE `invalidate` events for **that** document do not clobber in-progress local content.

## Technical Design

### Files to Create/Modify

- `apps/ui/src/features/editor/DocEditor.tsx` — the TipTap editor component (props: `docId`, `markdown`, `locked`, `onComment`)
- `apps/ui/src/features/editor/extensions/refExtension.ts` — `[[id]]` / `[[id|alias]]` inline node: parse, render (title lookup), serialize
- `apps/ui/src/features/editor/extensions/refSuggestion.ts` — `[[` suggestion plugin driving the autocomplete menu
- `apps/ui/src/features/editor/RefAutocomplete.tsx` — `.ac-menu` popup (keyboard up/down/enter/esc)
- `apps/ui/src/features/editor/SelectionToolbar.tsx` — `.sel-toolbar` floating pill
- `apps/ui/src/features/editor/markdown/serialize.ts` — ProseMirror doc → markdown (the single serializer; UI-007 depends on it)
- `apps/ui/src/features/editor/markdown/parse.ts` — markdown → ProseMirror doc
- `apps/ui/src/features/editor/markdown/schema.ts` — the shared TipTap extension list / schema (single source for both directions)
- `apps/ui/src/features/editor/markdown/roundtrip.test.ts` — round-trip fixture suite
- `apps/ui/src/features/editor/fixtures/*.md` — round-trip corpus fixtures
- `apps/ui/src/features/editor/useAutosave.ts` — debounce + PUT + save-chip state machine
- `apps/ui/src/features/editor/SaveChip.tsx` — `.save-chip`
- `apps/ui/src/features/editor/editor.css` — editor-specific tokens/styles matching `design/index.html`
- `packages/kit/src/hooks/useSaveDoc.ts` — mutation hook wrapping `PUT /api/docs/:id` (kit owns data access)
- `apps/ui/src/features/reader/Reader.tsx` — swap the read-only body renderer for `DocEditor` (modify)
- `apps/ui/src/features/reader/FocusMode.tsx` — same swap for focus mode (modify)

### Key Implementation Details

**Serializer is the contract.** Both directions live in `markdown/` and share one schema definition. Do **not** use a generic HTML→markdown converter (turndown); write an explicit ProseMirror→markdown serializer keyed on node/mark types so output is deterministic and clean. Rules that make round-trip stable:

- Headings use ATX (`## `), never setext.
- Bullet lists use `- `; ordered lists use `1.` with sequential numbering preserved from the source when the source used sequential numbering (normalize to the source's first marker).
- Emphasis uses `*` for italic and `**` for bold, consistently.
- Fenced code blocks use ``` fences and preserve the language string.
- Exactly one blank line between block nodes; no trailing whitespace; file ends with exactly one `\n`.
- Because clean-serialization normalizes some inputs, round-trip stability is defined as **idempotent from the second pass**: `serialize(parse(md))` must equal `md` for all repo fixtures (which are themselves canonical), and `serialize(parse(serialize(parse(x))))` must equal `serialize(parse(x))` for arbitrary `x`. Assert both.

**Ref node.** `[[doc_x]]` and `[[doc_x|alias]]` become an atomic inline node with attrs `{ id, alias }`. Its view renders `<a class="ref">` showing `alias ?? title(id)`; the title comes from the kit's docs cache (`useDocs`), falling back to the raw id styled as broken (per §5: an unresolved ref renders visibly broken) until the cache resolves. Serialization emits the original bracket form from attrs — never from the rendered text.

**Autosave state machine** (`useAutosave`):

1. Editor `onUpdate` → serialize → if the string differs from the last saved string, schedule a 700 ms debounce.
2. On fire: chip → `saving…`, issue `PUT /api/docs/:id` with `{ body, title? }`.
3. On response: chip → `saved · anchors ✓`; publish the response's `remapped`/`orphaned` anchor report on a callback so UI-007 can refresh decorations (define the callback prop now, even though nothing consumes it yet).
4. When the response indicates the auto-commit landed (or after the server's squash-on-idle signal arrives via SSE), chip → `committed · git ✓`.
5. Errors: chip shows a signal-colored error with a retry; the buffer is not discarded.
6. Flush pending saves on unmount, on focus-mode enter/exit, and on `visibilitychange` → hidden.

**Concurrent-refetch guard.** Keep a module-level "actively editing" registry keyed by doc id (set on first keystroke, cleared ~2 s after the last successful save with no pending buffer). The reader's `useDoc(id)` query for a doc in that registry ignores SSE-driven invalidations (`notifyOnChangeProps` / a guarded `queryClient.invalidateQueries` filter) so a server-side reprojection cannot replace editor content mid-keystroke. When the registry clears, run the deferred invalidation once so the user sees any agent-side changes.

**Lock handling.** `editable = !lock`. Toggling `editable` on the existing editor instance (not remounting) preserves scroll and selection. The selection toolbar and `[[` suggestion plugin check `editor.isEditable` before opening.

**Title.** The title is rendered as a separate single-line editable field (`.doc-title` typography) above the editor, not as an H1 inside the body — this keeps the title in frontmatter where the spec puts it. Its changes feed the same debounce and go into the PUT's `title` field.

**Styling.** Take every value from `design/index.html`: `.doc-body` (serif, 15px/1.62, `max-width: 62ch`; 16.5px/1.7 with `max-width: 66ch` in focus), `.doc-title` (serif 24px/700, 30px in focus), `.ref`, `.sel-toolbar` (surface, 9px radius, `var(--shadow)`, 4px padding; `.comment-btn` in `--accent-ink` 600), `.save-chip` (mono 10.5px; `.saving` → `--sepia-ink`, `.saved` → `--good`), `.ac-menu`/`.ac-item`. Light and dark both come free from the token set — do not hardcode colors.

### Edge Cases

- **SSE invalidation while typing** — handled by the actively-editing registry above; verify the deferred invalidation fires exactly once when editing settles.
- **Paste**: pasting markdown text should be parsed as markdown (paste handler runs `parse` when the clipboard has `text/plain` that looks like markdown); pasting rich HTML goes through the schema's `parseHTML` and is normalized on the next serialize; pasting into a code block stays literal.
- **Undo history vs. autosave**: autosave must never push transactions of its own (it only reads). A save landing during an undo sequence must not reset history. Ctrl/Cmd-Z after a save still undoes past the save point.
- Empty document (frontmatter only) → editor shows an empty paragraph; serializing yields an empty body, not `"\n\n"`.
- Very large document (>200 KB) — debounce still fires; consider serializing off the critical path if profiling shows jank, but do not add a worker preemptively.
- A ref pointing at a deleted/nonexistent id renders visibly broken (per §5) and still serializes back unchanged.
- Rapid doc switching in the same reader: pending saves for the outgoing doc flush before the editor rebinds.
- Non-`note` document types that render via a plugin `View` (§10) must not get the editor — only markdown-bodied docs.

## Testing Strategy

Vitest in `apps/ui`:

- `markdown/roundtrip.test.ts` — the fixture corpus: for each `.md` fixture assert `serialize(parse(md)) === md`; plus property-style idempotence on a set of generated/edge inputs.
- `markdown/serialize.test.ts` — per-node serialization units (nested lists, code fences with language, blockquotes containing lists, refs with/without alias).
- `markdown/parse.test.ts` — input shortcut regressions: parsing `## x`, `- a`, fenced code produces the expected node types.
- `useAutosave.test.ts` — fake timers: N rapid edits → exactly one PUT after 700 ms; chip transitions follow the mocked response; error path retries and keeps the buffer; unmount flushes.
- `refExtension.test.ts` — attrs → rendered title (with a stubbed docs cache), alias override, unresolved-id broken rendering, serialization from attrs.
- `DocEditor.test.tsx` (Testing Library) — locked doc renders non-editable and suppresses the selection toolbar; selection fires `onComment` with `{ from, to, text }`.
- Editing-registry test: an invalidation for an actively-edited doc is deferred, then applied once after idle.

## E2E Verification Plan

### Verification Steps

1. Start the real stack: `npm run watch` (server + UI) against a scratch workspace created by `corpus init`.
2. Open a document in a board column reader. Click mid-paragraph — a caret appears. Type a sentence.
3. Watch the save chip go `saving…` → `saved · anchors ✓` → `committed · git ✓`. Confirm on disk: `cat <workspace>/data/docs/<file>.md` shows the typed text; `git -C <workspace> log --oneline -1` shows the auto-commit.
4. **Round-trip proof against the real file**: `git -C <workspace> diff HEAD~1 -- <file>` shows only the intended line changed — no reflowed lists, re-escaped emphasis, or heading-style churn elsewhere in the document.
5. Type `## New section` on a fresh line — it becomes a heading live; reload the page and confirm it persisted as `## New section` in the file.
6. Type `[[` — the autocomplete opens; pick a document; the inserted ref renders as that document's **title**. Rename the target via `corpus doc edit` (or the UI) and confirm the ref's displayed text follows the new title after SSE refresh.
7. Select a phrase — the floating toolbar appears; **B** bolds it and the file gains `**…**` after autosave; **💬 Comment** fires without altering the body.
8. Lock the document from another process (`corpus lock acquire <docId> --holder agent`, or trigger an agent edit). The editor goes read-only with the banner; typing does nothing. Release the lock and confirm editing resumes without losing scroll position.
9. With the editor focused and mid-sentence, touch the file from outside (`corpus doc edit` on a *different* document, then on the same one after idling) — confirm the in-progress text is not clobbered while typing, and the external change appears once editing settles.
10. Playwright: add `apps/ui/e2e/editor.spec.ts` covering steps 2–7 against the real app per §15 M3.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. Must be from real E2E testing — no mocks, no test clients. Real application, real requests, real interfaces. Include specific commands run, actual outputs observed, and pass/fail conclusions. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Reproduction (bugs only)

_[Agent fills: exact commands, observed output, confirmation bug exists]_

### Post-Implementation Verification

_[Agent fills: application restarted, exact commands, observed output, confirmation fix/feature works]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-006]` prefix

## Corrections (orchestrator, 2026-07-28 — sprint-011 adjudications)

Binding; where this contradicts the sections above, this wins. See
`issues/sprints/sprint-011.md` → Orchestrator Adjudications for the full rulings.

- **Paths**: there is no `apps/ui/src/features/` — the domain folders are
  `editor/` (UI-006), `thread/` (UI-008), `anchors/` (UI-007), `compose/` (UI-010).
- **Attachments**: 25 MB/file, 100 MB/request; multipart's text field is `text`; `ts` path
  params are URL-encoded.
- **`requestsAgent` is tri-state**: "note only" sends explicit `false`; omitted means
  "enqueue if the agent is engaged".
- **Lock state** reads via `useLocks`/`useDocLock` + `["locks"]` keys (`DocView.tsx` is the
  example) — never from `GET /api/docs/:id`.
- **UI-006 specific**: save chip is two states (`.saving`/`.saved`; saved = committed because the
  server commits synchronously — escalate if you find otherwise, don't infer from warnings). The
  editor owns the document body always (`editable: false` under a foreign lock, behind the
  LockBanner; typing does nothing). Title stays in FrontmatterForm — the editor is body-only.
  UI-006 owns §7's user-side lock acquire: first keystroke acquires, heartbeat while focused,
  release on blur/idle (add kit client lock methods additively if missing).
