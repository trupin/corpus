# [UI-051] Select text inside a turn and comment on it, with the selection quoted

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-009 (Amendment 2)
- Blocks: —

## Spec References
- SPEC.md §11 Thread view as amended by SHARED-009 Amendment 2
- §6 "Anchoring" and §6 "Recursion" (a thread is a document; commenting on a
  turn creates a child thread whose `parent` is the thread's id)
- §11 right-click menu ("Comment on selection")

## Summary
Live report 2026-08-03: _"In a thread, or any document for that matter. I want to
be able to select some text and comment on it. When in a thread though, I want the
selected text to automatically start a comment with a citation with the selected
text."_

**The mechanism is already there — the granularity is not.** Established by
survey:
- A thread may be the `parent` of another thread: §6 Recursion says so,
  `ThreadSchema.parent` carries no type restriction, and the server's create path
  loads the parent with no type check and writes `anchors` into its frontmatter.
  Child threads already render per-turn up to `MAX_RENDERED_DEPTH = 4`.
- The per-turn 💬 button exists (`Turn.tsx`, `NewChildThread.tsx`) but anchors to
  `turnAnchorText` — the turn's **first non-empty line of prose, truncated to 160
  characters** (`childThreads.ts`) — not to what the user selected.
- The selection menu **does** fire inside a turn: `nativeMenu.ts` keys on
  `.doc-body`, and turns render `className="doc-body turn-markdown"`. But the
  Comment item is absent because `useAnchorLayer.captureComment` returns `null`
  unless there is an editable TipTap editor with a non-empty PM selection — for a
  thread, `anchorsHost` is false by construction. So today a selection in a turn
  offers Copy and nothing else.

The work is a selection→selector path that does not require the TipTap editor,
plus the citation-prefilled composer.

## Acceptance Criteria
- [x] Selecting text in a rendered turn offers **Comment on selection** in the
      selection menu (and via the floating toolbar if one is shown there)
- [x] The comment creates a child thread whose `parent` is the thread's id and
      whose anchor is a §6 text-quote selector for **the selection**, not the
      turn's first line
- [x] The selector carries the same prefix/suffix framing a document selection
      produces, so a duplicated phrase inside a turn anchors to the occurrence
      the user selected (the PR #19 MAJOR taught this lesson — do not anchor on
      `exact` alone)
- [x] The composer opens with the selection quoted as a citation above the input
- [x] The anchor is highlighted in the turn the way a document anchor is
- [x] Whole-turn commenting still works and still anchors to the turn
- [x] The existing document selection→comment path is unchanged
- [x] Escape/layering behave like the document comment popover
- [x] Composer keys follow UI-052's contract (`↵` newline, `⌘↵` send) — coordinate
      rather than shipping a fifth convention

## Technical Design
### Files to Create/Modify
- `apps/ui/src/anchors/useAnchorLayer.ts` (the `captureComment` editor
  precondition), or a sibling capture path for non-editable rendered bodies
- `apps/ui/src/menu/SelectionMenuItems.tsx` / `nativeMenu.ts` (offer Comment when
  the host is a turn)
- `apps/ui/src/thread/Turn.tsx`, `ThreadCard.tsx`, `NewChildThread.tsx`,
  `childThreads.ts` (selection anchor instead of/alongside `turnAnchorText`;
  citation prefill; highlight placement)
- `apps/ui/src/anchors/selectorFromSelection.ts` — currently PM-position based;
  a DOM-range path is needed for rendered (non-editor) bodies

### Notes
- Placement of an existing child thread back onto a turn currently works by
  `turn.body.includes(quote)` — with selection-level anchors, decide whether that
  stays sufficient or needs the same framing treatment.
- Do not regress `MAX_RENDERED_DEPTH` or the two-level requirement in §6.

### What was built
Two coordinate systems meet, and neither is ProseMirror's:

- `anchors/sourceTrace.ts` — an **emission trace of markdown for a rendered
  surface**, the read-only twin of `offsetMap.ts`. remark's own node positions
  give `plain` (what a renderer draws, syntax removed) plus runs mapping it back
  to markdown offsets. A run whose markdown and text disagree (an escape, a code
  span's delimiters) is **atomic** — a partial hit quotes the whole run rather
  than an offset that means nothing. `[[ref]]` is in neither projection, because
  `MarkdownView` renders a reference as a *title*, which is a query result and
  not text in the file.
- `anchors/renderedRange.ts` — the DOM half: a surface's text with the chrome
  left out (the fence copy button, the fence label, a ref's rendered title), a
  DOM `Range` as offsets into it, and offsets back to a live `Range`.
- `thread/turnAnchors.ts` — the glue, indexed by **occurrence** in both
  directions. `turnSourceParts` states the markdown behind each `.turn-markdown`
  a turn renders and where it sits in the turn body, so the selector's framing
  comes from the whole turn.
- `thread/useTurnComments.tsx` — the card-level host: the same
  `useSelectionContextMenu`, the same `CommentPopover` (hence the citation, the
  escape layer and UI-052's keys, none of them restated), and the anchor
  highlight.
- `anchors/textHighlight.ts` — the highlight, through the **CSS Custom Highlight
  API**. `react-markdown` owns every node in a rendered turn; a `<mark>` wrapper
  would be a second writer of that tree, undone by the next render. Ranges are
  registered per painter so the several cards a board shows cannot clobber each
  other's; `thread.css` styles `::highlight(corpus-turn-anchor)` to read like
  `.anchor-hl`.

### Decision: `turn.body.includes(quote)` does **not** stay sufficient
It picks the first turn containing the words. Whole-turn quotes rarely collided;
a *phrase* collides constantly — a reply quoting the question, an agent restating
an assumption. So `placeChildThreads` now takes the thread's own document
(`useDoc(threadId)`: its body plus its **server-resolved** anchor ranges) and
places a child by which turn's bytes its range falls inside. The server's verdict
is final in both directions: an anchor it declared orphaned is listed under the
conversation rather than re-attached by a quote search that would overrule it.
The `includes` search survives as the fallback for a card that has only a list
row (`DocRow` carries `anchorQuote` and no context) — honest about being
approximate, and unchanged for every case it already handled.

## Testing Strategy
Component tests for the capture path and the citation prefill. E2E against the
real app: select a phrase inside a turn, comment, and assert the child thread's
selector on the wire matches the selection (prefix/suffix included), the
highlight lands on the selected words, and a duplicated phrase anchors to the
right occurrence.

## E2E Verification Log

**Model: Opus 5 (1M context).** 2026-08-03.

### The stack
A real `corpus init` workspace at `/tmp/ui051`, a real server (`corpus server
start`, pid 17645 on `:8791` — never 8765, never 5173), the real Vite dev server
on `:5993` with `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8791`, and real Chromium
via Playwright with real mouse events. Nothing stubbed.

Seed (`corpus thread create`, first turn on stdin) — a phrase repeated inside one
turn, which is the case the whole issue turns on:

```
## user · 2026-08-03T17:01:12Z
Let's revisit the rate assumption.

I said revisit the rate assumption because 6.1% looks stale.
```

### Drill 1 — the second occurrence
Opened the thread from the board, selected the **second** `revisit the rate
assumption` with a DOM range, right-clicked on it at (880, 379):

- menu: `["💬 Comment on selection\nopens a thread anchored to these words",
  "Copy\nthe selection, with its formatting, to the clipboard"]` — Comment first,
  clipboard after, exactly §11's order for a non-editable body.
- composer citation: `“revisit the rate assumption”`.
- typed a comment, clicked send. **On the wire**, `POST /api/threads`:

```json
{"parent":"th_k775jy6s",
 "selector":{"exact":"revisit the rate assumption",
             "prefix":"it the rate assumption.\n\nI said ",
             "suffix":" because 6.1% looks stale."},
 "body":"Is this still the assumption?","requestsAgent":true}
```

- **On disk**, the parent thread's frontmatter grew the anchor (32 characters of
  prefix, the suffix to the end of the sentence), and the child thread file
  carries `parent: th_k775jy6s` / `anchor: anc_8237e5c9` — §6's recursion, on a
  thread, unchanged from a document.
- **Where the server resolved it**: `GET /api/docs/th_k775jy6s` →
  `range {start: 74, end: 101}`, quoting `revisit the rate assumption`. The first
  occurrence is at **37**, the second at **74**. Rung 1 landed on the one that
  was selected.
- `git log`: `comment: new thread on th_k775jy6s (th_73bdooeh) by user`, two
  files, one commit.
- **The highlight**, read out of the live registry:
  `CSS.highlights.get("corpus-turn-anchor")` → one range,
  `{"text":"revisit the rate assumption","x":772,"y":369}`. The two occurrences
  on screen are at `y:335` (first) and `y:369` (second). The paint is on the
  second — the words that were selected.
- One nested child card rendered under the turn.

### Drill 2 — the first occurrence, to prove the direction is the selection's
Same phrase, same turn, **first** occurrence selected. On the wire:

```json
{"selector":{"exact":"revisit the rate assumption","prefix":"Let's ",
             "suffix":".\n\nI said revisit the rate assum"}}
```

Different framing for the same `exact` — the anchor follows the pointer, not the
first match.

### Drill 3 — what must not have changed
- **Whole-turn 💬**: `{"selector":{"exact":"Let's revisit the rate
  assumption."},"requestsAgent":false}` — still `turnAnchorText`, still note-only.
- **A document selection**: opened a `note`, selected `30-year fixed at 6.1%` in
  the editor, right-clicked. Menu: Comment, Copy, **Cut, Paste** (editable
  content, unlike a turn). Sent →
  `{"parent":"doc_ydtbujth","selector":{"exact":"30-year fixed at 6.1%",
  "prefix":"We assume a ","suffix":" today.\n"}}`, and one `.anchor-hl`
  decoration in the editor. The document path is untouched.

### Automated
`apps/ui`: 1984 unit/component tests pass (124 files), of which 62 are new or
changed here — `sourceTrace.test.ts` (22), `renderedRange.test.ts` (15),
`turnAnchors.test.tsx` (17), `turnSelectionComment.test.tsx` (8, the whole flow
through `ThreadCard` with a recording transport), plus 4 added to
`childThreads.test.ts`. The duplicate-phrase case is pinned in three of them,
including one that restates the server's rungs 1–2 and asserts that `exact`
alone does **not** resolve while the framed selector does.

`npx tsc --noEmit`, `npx eslint --max-warnings 0` and `npx prettier --check`
clean over every touched file.

### Not done, and why
No new Playwright spec. `e2e/stubCorpus.ts` implements no `GET
/api/threads/{id}`, so a `ThreadCard` never renders turns there — a spec would
have meant teaching the shared stub to serve conversations while two other agents
are editing that directory. The browser evidence above is stronger than the stub
could be anyway: it exercised the real CSS Custom Highlight API against real
files, real git and the server's real resolution ladder.

**Finding for whoever owns the stub next**: `stubCorpus.resolveAnchor` implements
only rung 2 (unique `exact`) and would report a framed, perfectly resolvable
duplicate as `orphaned`. It disagrees with the server it stands in for.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
