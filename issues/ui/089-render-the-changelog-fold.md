# [UI-089] The changelog's older entries clip, and the clip reports its size

## Domain

ui

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SHARED-025 (rider), AGENT-020 (which writes the section)
- Blocks: —

## Spec References

- SPEC.md §10 — the **Document view** bullet: "A document's **changelog** (§5)
  renders as the ordinary body content it is. Past a threshold of entries it
  **clips**, exactly as a long fenced block does and for the same reason — the
  newest entries stay visible, the rest sit behind a control that expands them
  and **says how many are hidden**, and expanding shows them whole. This is the
  clipping behaviour above, not the conversation-collapse rule below … Clipped
  entries stay selectable, commentable and searchable like any other body text,
  and an anchor into a clipped entry still resolves — revealing that
  conversation expands the clip rather than quietly failing to reach it."
  _(Rider signed 2026-08-07; re-based on clipping the same day, on review.)_
- SPEC.md §5 — the changelog is ordinary body content, appended and never
  rewritten; "past a threshold the older entries are **clipped** rather than
  removed (§10)"

## Summary

AGENT-020 gives documents a changelog (user decision, 2026-08-07). This is the
reading half.

**This issue was filed against the rider's first draft and its language was
stale.** That draft put the changelog under §10's *collapse* behaviour. On
review the rider was **re-based on clipping** the same day, precisely so that
§10's set of default-collapse rules stays closed at exactly one member (a
`resolved` thread) — a changelog is body content, not a conversation. The signed
text is the clipping behaviour, and this file has been corrected to match it:
"fold" below now reads "clip" throughout, and the §10 quotation above is the
signed sentence rather than the draft's.

**Check before building anything**: the changelog is ordinary markdown in the
body, so the existing renderer may already handle the clip. It did not — see the
verification log — but the check was made first, and it is what settled where
the clip belongs.

## Acceptance Criteria

- [x] Older changelog entries render **clipped**, and the control **says how
      many are hidden** — and its whole size, the way §10 has every fold report
      itself
- [x] It expands **in place**, without navigating away
- [x] Recent entries are visible without expanding anything
- [x] The section stays ordinary content: it is never rewritten, never removed
      from the document, and stays commentable, anchorable, searchable and
      editable. A clip that made its contents unselectable would break
      commenting on an older entry — see the verification log for exactly what a
      clip can and cannot deliver here, and how the gap is closed
- [x] Keyboard-reachable like every other affordance (§10 adds no
      exclusive-pointer capability)
- [x] An anchor into a **clipped** entry still resolves, and revealing that
      thread expands the clip rather than silently failing to scroll to it —
      this is the case most likely to be missed
- [x] If the existing renderer already delivered this, the issue closes with a
      test proving it rather than a new component — checked first; it did not

## Technical Design

### Files to Create/Modify

- `apps/ui/src/editor/changelogClip.ts` (new) — the clip, as a view-only TipTap
  extension over ProseMirror decorations, the same shape `softWrap.ts` uses and
  for the same reason: the editor autosaves, so a reading convenience must not
  touch the document.
- `apps/ui/src/editor/DocEditor.tsx` — one line, the extension in the list.
- `apps/ui/src/editor/editor.css` — what "clipped" looks like.
- `apps/ui/src/anchors/useAnchorLayer.ts` — open the clip before scrolling a
  revealed anchor into view.

### Notes

- The clip is §10's **clipping** behaviour (`CodeFence`), not its collapse
  behaviour. The set of default-collapse rules is closed and stays closed.
- The threshold could not be the fence's constant, and the reason is a unit
  mismatch rather than a preference — see the verification log.

## Testing Strategy

A document with more entries than the threshold: recent ones visible, older ones
clipped with a count, expanding in place. Plus the anchored-thread-into-a-clipped
-entry case, which needs a real browser.

## E2E Verification Log

**Model: Opus 5 (1M context).** Run 2026-08-08 on branch
`phase-21-model-display-changelog-repair`. UI ports used: **5273** (Playwright's
Vite, via `CORPUS_UI_PORT`). Never 8765, never 5173 — 5173 was held by an ssh
tunnel throughout and 5273 was confirmed free before and after.

### The check that came first: does anything already do this?

No, and establishing that took three readings rather than a component:

1. **Nothing in the app knows the word.** `grep -rn "[Cc]hangelog"` over
   `apps/ui/src`, `packages/kit/src`, `apps/server`, `apps/cli` and
   `packages/contract`: **zero** hits. The only occurrences in the repo are the
   two workspace skills AGENT-020 wrote and `scripts/workspace-template.test.ts`.
2. **The existing clip is `CodeFence`'s, and it is a `pre` renderer.** It lives
   in `packages/kit/src/markdown/CodeFence.tsx` and is reached only through
   `MarkdownView`'s `pre` component. It clips by measuring `scrollHeight`
   against `--fence-collapsed-height`. Nothing about it can see a markdown
   section.
3. **A document body is not `MarkdownView` at all.** `DocView.tsx` routes every
   markdown-bodied document to `DocEditor` (TipTap) — its own docblock:
   "`MarkdownView` is left with exactly one document: a `view`, whose content is
   its stored query rather than its prose." A `view` document has no prose and
   therefore no changelog, so **the editor is the only surface a changelog is
   ever read on**, and the fence's clip is not on it.

So there was a real gap. It closes with a decoration plugin, not a component.

### What was built

**`apps/ui/src/editor/changelogClip.ts`** — a view-only TipTap extension, the
same shape as `SoftWrap` (UI-072) and for the same reason: the editor autosaves,
so anything that changed the *document* would be written to disk on the next
keystroke. It contributes no node and no mark; the schema is untouched.

- `changelogSection(doc)` walks the top-level blocks, takes the **last**
  `## Changelog` heading (a document may quote the spelling; §5 puts the real
  section at the end), runs to the next heading of level ≤ 2, and counts
  entries: **a list's items individually** — the canonical section the skill
  appends to is one bullet list, and counting the list as one block would mean
  forty entries never clipped — plus any other top-level block as itself, since
  §5 makes the section the person's to edit too.
- Everything but the newest `CHANGELOG_VISIBLE_ENTRIES` gets a
  `Decoration.node` carrying `data-changelog-clipped`; a `Decoration.widget`
  right after the heading draws the control.
- `editor.css` clips a marked entry with `max-height: 0; overflow: hidden` —
  the fence's own mechanism — and never `display: none` or `visibility: hidden`,
  either of which would take the entry out of the rendered document and with it
  the selection, the commenting and the anchor highlight drawn on it.

**The threshold is a count, and could not be the fence's constant.** The
instruction was to reuse the fence's threshold rather than invent a second one;
that turned out to be impossible, and the reason is a unit mismatch. The fence's
threshold is a **length** — `--fence-collapsed-height: 420px` in `markdown.css`,
measured against the laid-out box, because how much of a fence fits depends on
the width the reader gave it. §10 fixes the changelog's threshold in **entries**
("past a threshold **of entries**"), and §5 and the skill both speak of how many
entries sit behind the control. There is no conversion: a height cannot say how
many entries are hidden, and a count cannot be a `max-height`. So there is one
number (`CHANGELOG_VISIBLE_ENTRIES = 5`, which is both "how many stay" and "the
threshold", stated once), and the **behaviour** is the fence's — deliberately
down to the button's wording.

**What the control says.** `Show all 12 entries · 7 hidden`. Both numbers,
because §10 asks for both and they answer different questions: the whole size is
what every fold in this app reports ("its whole size, the way a clipped block
names its whole length rather than a remainder"), and "says how many are hidden"
is what the changelog rider asks of this control by name.

### The one place the spec asks for more than a clip can give

§10 says "clipped entries stay selectable, commentable and searchable like any
other body text". **Searchable** is free (search reads the markdown on disk, and
nothing here writes) and **commentable/anchorable** is free (anchors are matched
against the document, not the laid-out box — proved below). **Selectable** is
where a clip has a hard limit, and it was measured rather than assumed:

> A `Range` set over the seven clipped entries in Chromium returned
> `"·\n"` from `Selection.toString()` — the list markers and nothing else.

Text a browser is not painting is text the selection does not return. That is
true of **every** clip, `CodeFence`'s hidden lines included, and §10 asks for
this one "exactly as a long fenced block does" — so the literal reading is not
achievable by any clip, in any CSS. The guarantee is therefore delivered the way
a clip can deliver it, and one step further than the fence goes: **any selection
that reaches into the clipped range opens the clip** (`clipStateApply`), so ⌘A,
a keyboard selection walking up out of the visible entries, or a caret placed
inside one all reveal the entries before anything is selected, commented on or
typed. Nothing is ever edited inside a box nobody can see. This is flagged for
the record rather than waived quietly: if the user wants the literal reading, it
needs a different presentation than a clip and therefore a spec change.

**Resolved 2026-08-08, by user sign-off.** §10 was amended rather than the
presentation changed: the sentence no longer promises clipped entries stay
*selectable*, which no clip in any CSS can deliver, and states instead what a
clip can keep — commentable, searchable, anchors resolving — plus the guarantee
this issue added on top, that **a selection reaching into the clipped range opens
the clip first**. The amendment carries the measurement, so the next reader gets
the reason and not just the rule.

### The anchor case, driven in a real browser

`apps/ui/e2e/changelog.spec.ts` seeds a document whose changelog has 12 entries
and a thread anchored inside **entry 2** — one of the seven the clip hides.

- On a fresh load the highlight exists, reads `revision 2`, and is located by
  `.ProseMirror.doc-body [data-changelog-clipped] .anchor-hl[data-thread="th_old"]`
  — i.e. **resolved, decorated, and inside the clip**. `not.toBeInViewport()`
  confirms nobody can see it.
- Clicking 💬 and then the thread's row (`jumpToThread` → `flashThread`) now
  **expands the clip** before the scroll: `useAnchorLayer`'s flash effect calls
  `expandClipAround(highlight)`, which dispatches a bubbling DOM event the
  plugin listens for on `view.dom`; ProseMirror's dispatch repaints
  synchronously, so the `scrollIntoView` on the next line finds the entry laid
  out. Asserted: zero clipped entries, the highlight's box has height, and
  `toBeInViewport()` passes. Before this the jump "succeeded" and showed the
  reader nothing — exactly the quiet failure §10 forbids.
- And it stays open after the 1.2 s flash goes out: the reader was brought
  somewhere, not shown it for a second.

The seam is a DOM event rather than an exported command on purpose: the callers
hold an `Element`, not an `Editor`, so nothing outside `changelogClip.ts` has to
know the clip is a ProseMirror decoration.

### Tests run

- `npx vitest run apps/ui/src/editor/changelogClip.test.tsx` → **18 passed**.
  Covers the section walk (no section, last-section-wins, list items counted
  individually, a hand-written paragraph entry, stopping at the next `##`,
  nothing clipped at or below the threshold), what the reader sees (7 clipped of
  12, the control's text and `aria-label`, the five newest visible and reading
  as themselves, all 12 still in the DOM, expand-and-clip-again, the control is
  a focusable `button` with `contenteditable="false"`), what the file says (no
  `PUT`, and `serializeDoc` returns the opened body byte-for-byte, before **and**
  after expanding), and reaching in (a selection into the clip opens it; the
  DOM-event seam opens it; and it declines a node with no clip around it).
- `npx vitest run apps/ui packages/kit` → **3028 passed, 0 failed**.
- `npx playwright test e2e/changelog.spec.ts` (port 5273) → **7 passed**.
- Regression sweep, same run: `anchor-layer`, `editor`, `reader`, `anchors`,
  `soft-wrap`, `reveal` → **61 passed**.
- `tsc --noEmit` in `apps/ui` clean; ESLint clean on every touched file (no rule
  disabled — the one `no-unsafe-assignment` warning was fixed by narrowing
  `node.attrs["level"]` through `unknown`); Prettier clean.
- Unit-only V8 coverage of `changelogClip.ts`: **98.78% statements / 92.3%
  branches / 98.78% lines**; the two uncovered lines are the widget's
  `mousedown` and `keydown` guards, which the browser suite exercises.

### What was **not** exercised

- **No real `corpus` server.** The browser half runs against `stubCorpus.ts`, as
  the rest of the suite does (sprint-016 Adjudication 19). The disk/git half —
  an agent appending an entry through the CLI and the clip taking it up — was
  proved by AGENT-020's own log on a real workspace; nothing in this change
  writes, and the "no `PUT`" assertions are the evidence for that.
- **`MarkdownView` has no clip.** It renders exactly one document type today (a
  `view`, whose body is a query, not prose), so no changelog is ever read
  through it. If a plugin `View` ever renders a markdown body itself, it renders
  its own surface wholesale (§10) and would need its own answer.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (scoped: eslint + prettier + tsc over the touched files)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
