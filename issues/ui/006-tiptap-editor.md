# [UI-006] Always-editable TipTap document editor

## Domain

ui

## Status

done

## Priority

P0

## Model

opus — well-trodden TipTap+markdown territory; the hard parts (anchor offset mapping, decoration remapping) are isolated in UI-007.

## Dependencies

- Depends on: UI-005
- Blocks: UI-007

## Spec References

- SPEC.md §10 — "UI — the board" → _Document view — always editable, Google-Docs-like_ (no edit mode, markdown shortcuts, autosave, selection toolbar, `[[` autocomplete, lock read-only state)
- SPEC.md §10 — _Smart input everywhere_ (`[[` → documents by title, inserts the id ref)
- SPEC.md §6 — "Threads and anchors" → _Anchor reconciliation (automatic)_ (every save runs reconciliation; `PUT /api/docs/:id` reports remapped/orphaned)
- SPEC.md §5 — inline references are id-based, render as the target's **current** title, alias form `[[id|as text]]`
- SPEC.md §7 — _Document locks_ (locked document renders read-only)
- SPEC.md §9.2 — `PUT /api/docs/:id`, `GET /api/docs` (title search for `[[`)
- SPEC.md §12 M3 — Playwright check: "omnibox-create a doc … → type (file updates via autosave; anchors survive; squashed auto-commit on idle)"
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
10. Playwright: add `apps/ui/e2e/editor.spec.ts` covering steps 2–7 against the real app per §12 M3.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. Must be from real E2E testing — no mocks, no test clients. Real application, real requests, real interfaces. Include specific commands run, actual outputs observed, and pass/fail conclusions. State which model the implementing agent ran on ("implemented on: opus | fable")._

**Implemented on: opus.**

### Reproduction (bugs only)

Not a bug. Two defects *were* found by this E2E pass and fixed before it
finished; both are recorded below under "Defects found and fixed".

### Verification environment

Real workspace, real server, real browser — no mocks, no test client.

```
$ WS=$(mktemp -d /tmp/corpus-s011-ui006-XXXXXX)
$ node --import tsx apps/cli/src/bin/corpus.ts init "$WS" --port 9002
Initialized Corpus workspace at /tmp/corpus-s011-ui006-HICsEa
  port 9002, token in .corpus/config.json (mode 600)
  git: initialized on main, one commit authored as user
$ CORPUS_WORKSPACE="$WS" node --import tsx apps/cli/src/bin/corpus.ts server start
corpus 0.0.0 listening on http://127.0.0.1:9002 (pid 48898)
$ curl -s -H "authorization: Bearer $TOK" http://127.0.0.1:9002/api/health
{"status":"ok","version":"0.0.0","uptimeSeconds":1.229,"workspace":"/tmp/corpus-s011-ui006-HICsEa"}
$ CORPUS_SERVER_ORIGIN=http://127.0.0.1:9002 VITE_CORPUS_TOKEN=$TOK vite --port 5278 --strictPort
```

Seeded: `doc_mhvjje2q` (Rates), `doc_ikx2jmxp` (Mortgage options — headings,
nested bullet and ordered lists, a fenced python block, a blockquote, two
`[[refs]]` including the alias form, one broken ref, and a paragraph of
punctuation chosen to catch escaping churn: `amortization_schedule`, `2 * 3 = 6`,
`[draft]`, a bare `https://example.com`), `doc_i6hmyfyr` (Lockable note), and a
pinned `type: view` column. Browser: real headless Chromium driven by Playwright
against `http://localhost:5278`.

### Post-Implementation Verification

**TEST-1 — the body is editable, with no mode and no ceremony.** Clicking
mid-paragraph places a caret:

```
contenteditable: true
class: tiptap ProseMirror doc-body
caret-color: rgb(59, 95, 151)      --accent: #3b5f97      ← the same colour
```

Grepping every button in the rendered tree for a save/edit-mode control returns
only `FrontmatterForm`'s frontmatter-expander chip (`edit`, UI-005's, opens the
tags/status/due strip). There is no save button, no mode toggle and no "Done
editing" anywhere.

**TEST-4 — prototype typography, from computed style.**

```
font-family: "Iowan Old Style", … serif     font-size: 15px    line-height: 24.3px  (= 15 × 1.62)
max-width: 517.222px  →  62ch
h2  17px, margin 22px 0px 6px      ul  margin 8px 0px, padding-left 22px      li  margin 4px 0px
p   margin 0px 0px 10px            ← the first paragraph; `.doc-body > :first-child` zeroes its top margin (kit's shipped rule)
```

**TEST-2 / TEST-5 — the editor replaces exactly one branch.** `DocView.tsx`'s
non-thread branch is the single call site that changed; the `reader.isThread`
branch still renders `TurnList`, and `MarkdownView` is still exported from
`@corpus/kit` and still renders turn bodies, snippets and the two document types
the editor is not for. Navigating to the `type: view` column document through a
`[[ref]]` in the browser:

```
reader now on: doc_3ov5qeq4
editor mounted for the view document: 0
.doc-body present: 1        contenteditable on it: null        class: doc-body
```

**TEST-15 / TEST-22 / TEST-23 — fifteen characters, one PUT, one commit, one
line of diff.**

```
typed in 437 ms (15 characters)
PUTs immediately after typing: 0
PUTs after the debounce settled: 1   ["/api/docs/doc_ikx2jmxp"]
commits before: 6      commits after: 7
last commit: user <user@corpus.local> :: doc edit: Mortgage options (doc_ikx2jmxp) by user

$ git -C $WS diff HEAD~1 -- data/docs/finance/mortgage-options.md
-updated: 2026-07-28T17:21:16Z
+updated: 2026-07-28T17:24:23Z
@@
-see also [[doc_mhvjje2q|the rate note]].
+see also [[doc_mhvjje2q|the rate note]]. Typed live 15!
```

**That diff is the criterion the serializer exists for.** Only the edited
paragraph and the `updated` timestamp changed. The nested lists, the ordered
list, the fenced python block, the blockquote, `**30-year fixed**`, `*5.85%*`,
`amortization_schedule`, `2 * 3 = 6`, `[draft]` and the bare
`https://example.com` are all byte-identical — none of them was re-escaped,
reflowed or re-marked.

**TEST-16 — a no-op edit issues nothing.** Typing a character and deleting it,
then idling: `PUTs after typing a character and deleting it: 0`. The comparison
is against the last *saved* markdown string, not against "the editor fired an
update".

**TEST-17 — the chip is the response, not a timer.** Sampled every 100 ms:

```
   0ms  class="save-chip"        colour=rgb(155,161,168)  text=""
 700ms  class="save-chip saving" colour=rgb(122,98,56)    text="saving…"      (--sepia-ink #7a6238)
 800ms  class="save-chip saved"  colour=rgb(78,122,70)    text="committed · git ✓"  (--good #4e7a46)
```

With the request artificially delayed the chip stays on `saving…` for the whole
delay (asserted on fake timers in `useAutosave.test.tsx`: 4 s into a 5 s request
it still reads `saving…`).

**TEST-18 / Adjudication 1 — two states, and `committed` is true.** The `PUT`
answers only after the server has committed (`git rev-list --count` goes 6 → 7
and `git log -1` names the commit *before* the response is rendered), so the
`.saved` copy reads `committed · git ✓` truthfully. **No asynchrony was
observed; nothing to escalate.** The anchor half of the copy is the response's
`{remapped, orphaned}` and is asserted in `useAutosave.test.tsx`:
`committed · git ✓ · 2 anchors moved`, and with an orphan
`committed · git ✓ · 1 anchor orphaned` — which never says `anchors ✓`.

**TEST-12 — every input shortcut, live and on disk.** Typed
`## `, `- `, `1. `, `> `, `**bold**`, `*italic*`, `` `code` ``:

```
live DOM: P,H2,UL,OL,BLOCKQUOTE,P
$ cat $WS/data/docs/finance/rates.md      (body)
6.4% this week. Sampled.

## New section

- bullet one
- bullet two

1. first step

> quoted line

**bolded** and *italic* and `code` here
```

**TEST-13 — shortcuts are inert inside a fence.** Opening one with ` ``` ` +
space, then typing the same shortcuts inside it:

```
node types after the fence rule:        P,PRE
node types after typing inside it:      P,PRE       ← no H2, no UL, no <strong>
disk: "```ts\n## not a heading\n- not a bullet\n**not bold**…\n```\n"
```

**TEST-14 — paste.** A plain-text markdown paste parses; the same paste inside a
code block stays literal; no HTML reaches disk.

```
paste into a paragraph → node types: P,H2,UL,P
disk: "## Pasted heading\n\n- pasted one\n- pasted two\n\n6.4% this week.\n"
no <span|<div|style=|class= on disk: true
paste into a fence     → node types: P,H2,UL,P,PRE
disk: "```\n## Not a heading\n- not a bullet…\n```"
```

**TEST-19 — a failed PUT keeps the buffer.** With a 500 injected on the next
`PUT`:

```
chip class: "save-chip failed"   text: "save failed — retry"   element: BUTTON
chip colour: rgb(196,85,46)      --signal: #c4552e
typed text still in the editor: true        file NOT updated: true
after clicking retry → chip: "save-chip saved" "committed · git ✓"   file now matches the editor: true
```

**TEST-20 — pending saves flush before the buffer can be lost.** Typing and then
immediately leaving for another document, inside the 700 ms window:

```
PUTs issued by the switch: ["PUT /api/docs/doc_i6hmyfyr"]      ← the OUTGOING id
outgoing file on disk: "*This doc*ument will be locked by the agent. Flushed on switch.\n"
incoming file on disk: "**6.4%** this week.\n"                 ← untouched
```

Unmount and `visibilitychange → hidden` are covered on fake timers in
`useAutosave.test.tsx`.

**TEST-21 — autosave never touches undo history.** A save landed mid-sequence,
then ⌘Z repeatedly:

```
disk after the save:  "**6.4%** this week. WILL FAIL FIRST UNDO-ME\n"
after one ⌘Z the editor no longer shows UNDO-ME: true
after further ⌘Z, editor text: "6.4% this week."      ← walked back past the save point
disk after the undos: "**6.4%** this week.\n"
```

**TEST-24 / TEST-25 — the `[[` menu is the prototype's, and keyboard-first.**

```
menu class: "ac-menu open"
computed: position fixed, background rgb(255,255,255), border 1px solid rgb(227,225,218),
          radius 9px, padding 4px, min-width 250px, max-height 200px, overflow-y auto, box-shadow yes
items: ["Rates","Mortgage options","Finance","Lockable note","Attention","Inbox","Open threads","Note template"]
first item class: "ac-item on"
ArrowDown → aria-selected ["false","true", …]      ArrowUp → ["true","false", …]
Escape    → menu count 0 · editor still focused: true · reader still open: 1
            literal characters kept: "week. See [["
```

Escape here does **not** reach the reader's escape layer.

**TEST-26 — the id goes to disk, the title goes to the screen.** Typing
`[[mort` filtered the list to `["Rates","Mortgage options"]`; choosing the
second inserted a ref rendering as its title, and the file got the id:

```
rendered ref text: "Rates" / "Mortgage options"     (resolved, live)
ref computed: color rgb(46,75,120) (--accent-ink), border-bottom 1px solid rgba(59,95,151,0.1) (--accent-wash)
disk: "6.4% this week. See [[doc_mhvjje2q]]\n"      ← the bracket form, never the title
```

**TEST-27 — a broken ref.** `[[doc_deadbeef]]` renders as
`.ref-broken` (`data-corpus-ref-broken`), line-through, `cursor: default`, not a
link, and serialises back byte-identical. The only console output is the
browser's own network log line for the `404` on `GET /api/docs/doc_deadbeef` —
the probe that *establishes* the ref is unresolved. Nothing is logged or
toasted by Corpus, and no page error was collected in any run.

**TEST-28 — one request per distinct id.** A body citing `doc_mhvjje2q` twice
plus one broken id:

```
GET /api/docs/doc_ikx2jmxp    (the document itself)
GET /api/docs/doc_mhvjje2q    ← once, for two citations
GET /api/docs/doc_deadbeef    ← once, and it 404s
```

Cache-deduped per-id `useDoc`, per sprint-010 Adjudication 6.

**TEST-29 / TEST-30 — the selection toolbar.** A real mouse drag across a
paragraph:

```
selection: "his docume"
class: "sel-toolbar open"        buttons: ["B","I","💬 Comment"]
computed: position fixed, display flex, background rgb(255,255,255),
          border 1px solid rgb(227,225,218), radius 9px, padding 4px, z-index 50
comment-btn: color rgb(46,75,120) (--accent-ink), font-weight 600
divider: width 1px, background rgb(227,225,218) (--line)
B: aria-pressed false → click → disk "**6.4%** this week.\n"
I: click              → disk "*This doc*ument will be locked by the agent.\n"
```

**TEST-31 — Comment hands off and writes nothing.**

```
PUTs issued by the comment click: 0
file byte-identical after the click: true
git status: ""
```

The `onComment` prop exists on `DocEditor` and `DocView` and is called with the
payload below (exact payload asserted in `DocEditor.test.tsx`); `Reader` and
`FocusMode` do not pass a handler yet, which is UI-007's wiring. **The payload
UI-007 consumes** (`apps/ui/src/editor/selection.ts`):

```ts
interface EditorSelection {
  docId: string;
  from: number; to: number;              // ProseMirror positions
  text: string;                          // the selection as the editor reads it
  body: string;                          // the serialized markdown the offsets index into
  range: { start: number; end: number } | null;               // character offsets into `body`
  selector: { exact: string; prefix: string; suffix: string } | null;   // SPEC.md §6
}
```

`range`/`selector` are **located, not mapped**: the selected text is found in
the serialized body, disambiguated by how many earlier occurrences precede it.
Exact for prose; `null` — never a guess — when the selection spans markup the
body spells differently. A true position↔offset map is UI-007's crux.

**TEST-32 — an agent lock, over SSE, with no reload.**

```
$ corpus lock acquire doc_ikx2jmxp --from agent
locked doc_ikx2jmxp for agent, lease 300s.

contenteditable: false      aria-readonly: true      data-editable: false
caret-color: rgba(0, 0, 0, 0)
lock banner: "agent is editing — holding the edit lock, started just now · document is read-onlyForce unlock"
typed "THIS MUST NOT APPEAR" → editor shows it: false
file unchanged while locked: true      PUTs while locked: 0
lock requests from the editor while locked: 0
selection toolbar under the lock: 0    `[[` menu under the lock: 0
```

Lock state is read from `useLocks`/`useDocLock` + the `["locks"]` keys, never
from `GET /api/docs/:id` (Adjudication 3a). The sprint text says
`--holder agent`; the shipped flag is `--from`.

**TEST-33 — unlocking restores editability without a remount.**

```
scrollTop before the lock: 236
$ corpus lock release doc_ikx2jmxp --from agent
contenteditable after release: true
same DOM node (identity probe survived): 1     ← stamped before the lock, still there
scrollTop after release: 236 (was 236)
caret-color after release: rgb(59, 95, 151)
```

**TEST-34 — SPEC.md §7's user-side lock is implemented, not struck.** The first
keystroke acquires; a second client sees it; idle releases it.

```
lock calls from the first keystroke: ["POST /api/locks/doc_ikx2jmxp"]

$ corpus lock list          # while typing
doc_ikx2jmxp — user, acquired 2026-07-28T17:34:01Z, lease 300s

$ corpus lock list          # after the idle window
no locks held.
```

Also released on blur, on unmount, on `pagehide`, and when a foreign lock
arrives; renewed by re-acquiring while the session stays live (asserted in
`useUserLock.test.tsx`). The lease TTL and `corpus lock reap` remain the backstop
for a tab killed mid-request. Observed in passing, and it is the mechanism
working: an `acquire --from agent` against a document the browser was still
holding was refused with `409 … is locked by user`, which is exactly the
deferral §7 asks for.

**TEST-35 — an SSE invalidation does not clobber the buffer, and lands once.**

```
typed " LOCAL-TYPING-IN-PROGRESS"; agent edit issued mid-word
during the edit, local text preserved: true
after settling, local text on disk: true
title on disk: title: Mortgage options (agent touched)     ← the external change did land
```

Both halves: the guard holds while typing and releases when the session settles
(the registry's idle window with no pending buffer and nothing in flight). The
"exactly once" half is asserted directly in `DocEditor.test.tsx`.

**TEST-36 — the registry is keyed by document.**

```
doc A's buffer intact: true
doc B's row title updated live: "…Rates (renamed by the agent)…"
```

**TEST-3 — focus mode is the same editor at the focus measures.**

```
column measures: {fontSize 15px,   lineHeight 24.3px,  62ch}
focus  measures: {fontSize 16.5px, lineHeight 28.05px, 66ch, contenteditable "true"}
focus hint: "esc closes · click anywhere to edit"
PUTs from focus editing: ["PUT /api/docs/doc_ikx2jmxp"]
focus save chip: "committed · git ✓"
disk contains the focus edit: true
```

**TEST-6 to TEST-11 — the serializer.** Verified in `apps/ui/src/editor/markdown/`
over a **14-fixture** corpus (headings h1–h6, emphasis/inline code/strike,
bullet and ordered lists at two nesting levels, fenced code with and without a
language, blockquotes including one containing a list, links and images,
`[[ref]]` and `[[ref|alias]]`, horizontal rules, hard breaks, tables with
alignment, task lists, HTML/footnote/definition constructs kept verbatim, and
two mixed documents): `serialize(parse(md)) === md` byte for byte for all 14,
plus idempotence-from-the-second-pass over 20 non-canonical inputs. `git grep`
confirms no `turndown` or equivalent in either `package.json`; `parse.ts` and
`serialize.ts` both import `./schema.js` — one extension list, two directions.
TEST-11's rename half was exercised in the browser: renaming the target with
`corpus doc edit --title` changed the rendered text and left the parent's file
byte-identical.

### Defects found and fixed during this pass

1. **`&#x20;` in the file.** Inserting a `[[ref]]` at the end of a paragraph
   left a trailing space, which markdown cannot spell — the printer's faithful
   output is the character reference `&#x20;`, and it landed on disk:
   `"6.4% this week. See [[doc_mhvjje2q]]&#x20;\n"`. Two changes were made: the
   suggestion no longer appends a space, and the serializer drops trailing
   whitespace at the end of a block (never inside one, and never in a code
   block).

   **Correction (2026-07-28).** This entry originally read "fixed twice over"
   and claimed the class of defect was closed. It was not, and the wording
   overclaimed: the trailing-space trim only ever looked at an *unmarked* text
   node at the end of a block, so it covered neither a trailing space **inside
   a mark** (the ordinary case — select a phrase with its trailing space and
   press **B**) nor blanks at any other line edge. The evaluator hit it on the
   first try and it was sprint-011's blocking failure (`issues/evals/UI-006-eval.md`
   → FAIL-1). What was actually broken, and what the real fix is, is recorded
   in the addendum below — the honest summary of this entry is: **one narrow
   symptom was fixed, the defect was not.**
2. **Escape stopped closing focus mode.** `useEscapeStack` ignores keys typed
   inside a contenteditable — correct for `⌫`, but once the body became
   editable it meant Escape with the caret in the text did nothing, while focus
   mode's own hint says "esc closes". Fixed in the editor rather than in the
   shared chain: the first Escape blurs the writing surface (and gives the edit
   lock back), the second reaches the chain and closes the layer. Verified:
   `after the 1st esc — focus open: 1, editor still focused: false` /
   `after the 2nd esc — focus open: 0`. The `[[` menu still answers Escape
   first, and neither press reaches the reader.
3. **`.save-chip.saving` and `.save-chip.saved` had no colours.** `Reader.css`
   shipped only the chip's base. The prototype's `--sepia-ink` / `--good` are
   now in `editor.css` and verified live: `rgb(122,98,56)` / `rgb(78,122,70)`.

### Cross-checks and process

- No page error was collected in any browser run (`pageerror` listener), apart
  from the browser's own network log line for the deliberate unresolved-ref
  `404` and the deliberately injected `500` in TEST-19.
- `8765` was never bound; the Playwright run's proxy `ECONNREFUSED 127.0.0.1:8765`
  lines confirm it.
- `git -C $WS log` shows every mutation committed with `user` as author.
- `git status` in the worktree is clean of stray files; the scratch workspace is
  `/tmp/corpus-s011-ui006-HICsEa` and every `git` invocation carried `-C $WS`.

## E2E Verification Log — addendum: the character-reference defect (2026-07-28)

**Implemented on: opus.** Fix for `issues/evals/UI-006-eval.md` → FAIL-1 (and the
sprint-011 cross-issue FAIL-1 / TEST-161). Main tree, branch `phase-3-ui`.
Workspace `/tmp/corpus-s011fix-gKidsH`, production build (`npm run build`),
`corpus server start` on **9030**, real Chromium via Playwright. `8765` unbound
throughout.

### What was actually wrong

Two positions have no markdown spelling for whitespace, and the printer answers
both with a character reference:

- **inside an emphasis marker** — `**alpha beta ** ` cannot close, so
  `mdast-util-to-markdown` writes `**alpha beta&#x20;**` and then has to encode
  the character after the marker too, which is where the `&#x67;` for a plain
  `g` came from;
- **at a line edge** — a blank at the start or end of a line, or against a soft
  or hard break.

The old trim covered exactly one corner of the second case (an unmarked text
node at the end of a block). Reproduced before fixing, in the same browser, on
seven shapes — `**bold **`, `** bold**`, a bold run holding only a space, bold
at a block edge, `***nested ***`, `~~struck ~~`, and a ref inserted after a bold
run — **13 of 18 probe documents carried entities**.

### The fix

`apps/ui/src/editor/markdown/serialize.ts` — the mdast tree is normalised so the
printer never needs an entity:

- `hoistEdgeWhitespace` moves whitespace at the edge of a `strong`/`emphasis`/
  `delete` wrapper **outside** the markers (`**alpha beta** gamma`), by
  CommonMark's flanking rules, so a no-break space moves too. A wrapper left
  holding only whitespace disappears. Nested marks need no case of their own —
  the inner wrapper is hoisted before the outer one is built.
- `trimLineEdges` (with `splitSoftLines`) drops ASCII blanks at every line edge
  of a block — start, end, and either side of a hard or soft break — which is
  what markdown itself does to them. Visible content (a no-break space) is
  moved, never deleted.
- Both keep the UI-007 trace exact: a text node is **split** rather than
  rewritten, so every run stays one-for-one with the text it came from.

### Evidence

The eval's exact repro, re-run:

```
selection:            "alpha beta "
editor html after B:  <p><strong>alpha beta </strong>gamma delta</p>
save chip:            committed · git ✓
$ od -c data/docs/notes/bold-space-test.md | tail -2
0000300    -   -   -  \n   *   *   a   l   p   h   a       b   e   t   a   *
0000320    *       g   a   m   m   a       d   e   l   t   a  \n
```

`**alpha beta** gamma delta` — no entity, and the space is between the runs
where it belongs. Adjacent cases, all driven in the browser against the same
server:

```
reload + type "!"      → **alpha beta** gamma delta!          (stable, idempotent)
type "link: " + [[ref]] → **link:** [[doc_ax4jl7j7]]**6.4%** this week. See mort
bold mid-block          → **second para** for block start
nested bold+italic in a list item → - ***bullet*** with émphasis here
unicode line untouched  → héllo wörld — ok

$ grep -rn '&#' data/          → (no matches anywhere in the workspace)
$ git -C $WS diff HEAD~1 HEAD  → only the edited lines + `updated:`
```

### Tests

`apps/ui/src/editor/markdown/serialize.test.ts` gains a
"whitespace at a boundary markdown cannot spell" suite (14 cases: trailing and
leading space at a mark boundary, whitespace-only mark, block edges, nested
marks, strikethrough, heading and list item, ref after a bold run, no-break
space kept, soft/hard-break edges, marks beside every escapeworthy character
class, and healing a body that already carries the entities).
`roundtrip.test.ts` asserts **no output of the whole corpus, canonical or not,
contains a character reference**, and carries the three entity-bearing bodies as
non-canonical inputs that must settle. `emphasis.md` gains the boundary shapes
as byte-for-byte fixtures. `offsetMap.test.ts` gains six trace cases built from
edited ProseMirror documents (which the parser can never produce), checked
against its independent `pmTextBetween` oracle.

`apps/ui` + `packages/kit`: **1660 tests, 112 files, all passing**; lint,
format and typecheck clean.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [x] `/evaluate` passes (if evaluator active)
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

## E2E Verification Log — addendum: two save/lock lifecycle defects (PR #10 review, 2026-07-28)

**Implemented on: opus.** Fixes for the PR #10 pr-reviewer's MAJOR findings 2 and 3,
in the worktree `.claude/worktrees/fix-ui` (branch `wt-fix-ui`).
Environment: real workspace `corpus init /tmp/corpus-fix-ui-ws --port 9045`, real
server (`corpus server start`, pid recorded), the worktree's Vite dev server on
**5283** proxying to it, real headless Chromium via Playwright. A 134 KB document
(`doc_psku3f3i`, `data/docs/inbox/latency-probe.md`) with `PUT /api/docs/*` held
for 4 s by a route interceptor — a large document over a busy server, i.e. the
latency the 700 ms debounce was never dimensioned for. `8765` unbound throughout.

### Finding 2 — edits typed during an in-flight `PUT` were stranded unsaved

**Reproduction (pre-fix code, real browser).** Typed `PREFIXA`, waited past the
debounce so the `PUT` went out, typed `PREFIXB` while it was in flight, then
touched nothing for 15 s:

```
t+ 3195ms PUT #1 sent — 132327 bytes, carries [PREFIXA]
t+ 4766ms typed PREFIXB (while PUT #1 is in flight) — NO further input after this point
t+ 7293ms PUT response 200
t+ 7805ms chip: "committed · git ✓" | puts: 1 | disk has PREFIXA: true PREFIXB: false
   ... 15 s of stillness, chip unchanged, one PUT ever ...
file on disk contains PREFIXB: false
```

The chip claimed `committed · git ✓` over text that existed only in the browser's
memory, the editing session never settled (so the deferred SSE update and any
comment queued in `useAnchorLayer.submitComment` would have waited forever), and
`PREFIXB` is *still* absent from the file — the tab closed and the edit was gone.

**The fix.** `useAutosave`'s `PUT` completion handler now checks the buffer: if it
holds content newer than what was just sent, the next save is sent immediately and
the chip stays `saving…` — the `saved` state and the registry settle are reached
only with a clean buffer. A buffer that came back to what was just saved is
dropped without a request. Under a foreign lock that arrived mid-flight the chip
reports the error rather than a save, and a new effect flushes when the lock
clears. `useUserLock` is untouched by this half.

**Verification (fixed code, same browser, same latency).**

```
t+ 3077ms PUT #1 sent — 132334 bytes, carries [FIXEDA]
t+ ~4.6s  typed FIXEDB (while PUT #1 is in flight) — NO further input after this point
t+ 7182ms PUT response 200
t+ 7191ms PUT #2 sent — 132341 bytes, carries [FIXEDA, FIXEDB]   ← 9 ms later, no input
t+ 7701ms chip: "saving…"          | disk has FIXEDA: true FIXEDB: false
t+11338ms PUT response 200
t+11958ms chip: "committed · git ✓" | disk has FIXEDA: true FIXEDB: true
   ... 12 s idle, still 2 PUTs total: no save loop ...
```

The chip never read `committed` while the buffer was dirty (samples at t+7.7 s,
8.7 s, 9.7 s, 10.7 s all read `saving…`, spanning the moment the first response
landed), and the tail edit reached disk with no further input.

### Finding 3 — an acquire resolving after the session ended leaked a permanent heartbeat

**Reproduction (pre-fix code).** `POST /api/locks/*` held for 5 s; typed one
character, then ended the editing session 1 s later, while the acquire was still
out:

```
t+  1506ms POST /api/locks/doc_psku3f3i sent
t+  2686ms DELETE /api/locks/doc_psku3f3i → 404   ← the release lost the race
t+  6522ms POST  /api/locks/doc_psku3f3i → 201   ← granted to a surface that is gone
t+ 13687ms corpus lock list → [{docId: doc_psku3f3i, holder: "user", ttl: 300}]
t+ 44476ms corpus lock break → {"broken":true}
t+ 96526ms POST /api/locks/doc_psku3f3i sent     ← the leaked heartbeat, 90 s later
t+101540ms POST /api/locks/doc_psku3f3i → 201    ← the operator's break, undone
```

**The fix.** The acquire's continuation re-reads `held` — the flag blur, idle,
unmount and "a foreign lock arrived" all clear — and, when the session is gone,
hands the grant straight back through the client instead of installing the
interval. Skipping only the interval would have left the lock held to its TTL, so
the release is the point. The heartbeat's own renewal carries the same guard: a
renewal that lands after the session ended is just as stuck.

**Verification (fixed code, same race, watched past one heartbeat period).**

```
t+  1508ms POST /api/locks/doc_psku3f3i sent
t+  2688ms DELETE /api/locks/doc_psku3f3i → 404  ← same lost race
t+  6525ms POST  /api/locks/doc_psku3f3i → 201   ← same late grant
t+  6527ms DELETE /api/locks/doc_psku3f3i → 200  ← handed straight back
t+13.7s … t+116.5s  corpus lock list → {"locks":[]}   (11 samples, 110 s > the 90 s period)
```

No lock held, and no re-acquire ever fired: the interval was never installed.

### Regression tests

- `apps/ui/src/editor/useAutosave.test.tsx` — new block *"edits typed while a save
  is on the wire"* (6 tests, fake timers): the latency>debounce interleaving sends
  the tail edit with no further input; the chip never reads `committed` over a
  dirty buffer (the crash window); the editing session settles, which is what
  releases the deferred SSE update and `useAnchorLayer.submitComment`'s queued
  comment; an unmount mid-flight still gets the tail edit out; a buffer that came
  back to the saved body costs no request; a lock arriving mid-flight parks the
  save and the clearing lock sends it.
- `apps/ui/src/editor/useUserLock.test.tsx` — new block *"a grant that arrives
  after the session ended"* (3 tests): after an unmount and after a blur, the late
  grant is released and no heartbeat is installed (three lease-lengths of silence);
  a grant to a still-live session still heartbeats and releases nothing.
- Both blocks were run against the pre-fix code: 7 of the 9 new tests fail there
  (the two that pass are the no-regression guards), with the chip literally
  asserting `committed · git ✓` over the stranded buffer.

Suites: `apps/ui` 1206/1206 pass, `packages/kit` query+client 158/158 pass;
eslint, prettier and `tsc --noEmit` clean for `apps/ui` and `packages/kit`.

### Also fixed here: a Node-22-only test-fixture defect (CI)

`packages/kit/src/query/threadWriteHooks.test.tsx`'s wire fixture built
`new Request(input, init)` with jsdom's `FormData` as the body. jsdom's `FormData`
and Node's undici `Request` are different realms: Node 22 (CI) rejects the
construction, so the multipart mutation died before a single call was recorded and
`"switches the append to multipart when files are present"` timed out; Node 25
(local) tolerates it, which is why every local gate was green. The fixture now
reads `input`/`init` directly and only clones a `Request` the caller itself built —
no body is ever handed to a foreign-realm constructor. The same hazard was fixed
identically in `packages/kit/src/query/useCapture.test.tsx` and
`apps/ui/src/testing/readerFixture.ts` (the only other jsdom fixtures that receive
a `FormData` body). No assertion changed in any of the three.
