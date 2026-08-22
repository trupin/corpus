# [UI-063] A comments list with resolved/open and anchored/unanchored filters

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-010 (the rider for this surface)
- Blocks: —

## Spec References
- SPEC.md §6 Anchoring (orphaned anchors), §10 Document view (today: "Whole-
  document comments and orphaned threads listed below the body")

## Summary
Live report 2026-08-04: _"For comments that are no longer anchored in the
document (bc the doc changed), we should show them in a separate list of comments
which I can filter per resolved / open. I also want to see anchored comments
there, and I want to be able to filter based on anchored / unanchored state as
well. That list of comments should be available in full screen and in column
view."_

**What exists today.** §10 already says orphaned threads and whole-document
comments are "listed below the body". So there is a place unanchored comments go
— but it is a passive tail of the document, not a surface you can work: no
filters, no anchored comments in it, and nothing that answers "what is
outstanding on this document?"

**What is being asked for** is that list promoted into a real panel: every
comment on the document, filterable on two independent axes —
**resolved / open** and **anchored / unanchored** — and available in both column
view and full screen.

The two axes are genuinely independent and the combination is the point: an
*open, unanchored* comment is the one that most needs attention, because the
document moved out from under a question nobody has answered. Today that is the
hardest state to find.

## Design questions
- **SETTLED (user, 2026-08-04): a tab beside the document.** The reader's header
  carries a `Document / Comments` switch, so the list gets the full column width
  and rows can show quote, status and age legibly. The trade the user accepted is
  seeing one or the other, not both. Full screen uses the same switch. Signed as
  SHARED-010 Amendment 1; the below-the-body listing stays.
- **SETTLED: the below-the-body listing is deliberately KEPT, and the 💬 popover
  is what the tab subsumes.** Two different things were in question here. The
  below-body listing is not a design choice open to this issue — §10's signed
  rider says in the same breath as the list itself that *"whole-document comments
  and orphaned threads remain listed below the body"*, so removing it would need
  a new signature. It also answers a different question: the body's list says
  *this conversation has nowhere to sit in the text*, while the tab says *here is
  everything outstanding on this document*. Neither can drift from the other,
  because both render the same `ThreadPanel` over the same `useDocs({parent,
  type: thread})` rows. What **was** a genuine duplication is the 💬 popover:
  the same rows, one line each, with nothing to do about any of them. It is
  deleted, its `threadMeta()` and `threadQuote()` moved into
  `comments/commentsModel.ts` rather than being rewritten, and its keyboard
  guarantee (UI-030) is carried by the tab.
- **SETTLED: a row leads where its anchor does.** An anchored row offers *Show in
  document*, which flips the switch back and calls UI-037's own `jumpToThread`
  seam — expand, flash, scroll — and no second mechanism. An unanchored row has
  nothing to reveal to, so it opens in place: the row **is** its `ThreadPanel`,
  so the conversation is right there, repliable and resolvable, and the row says
  in one line why it has no anchor.
- **SETTLED: the filters are not persisted, deliberately.** Both axes default to
  *all*, which hides nothing. A filter that survived a reload would hide comments
  from someone who has forgotten they set it, and a list silently missing rows is
  the failure this surface exists to cure. They are a question being asked now,
  not a place being returned to — which is what §10's stickiness is about. The
  **tab** resets to Document on every navigation, for the same class of reason:
  arriving at a `[[ref]]` on the Comments tab would hide the body you followed
  the link to reach.
- **SETTLED: every filter position carries its count**, over the whole list
  rather than over what the other axis allows — so moving one axis never
  renumbers the other. Each count sits in a reserved two-character box, so a
  count landing after the control has painted moves nothing (SHARED-057).

## Acceptance Criteria
- [x] A comments list showing every thread on the document, anchored and not
- [x] Independent filters: resolved/open, and anchored/unanchored
- [x] Available in both column view and full screen
- [x] An anchored row leads to its anchor in the document (reuse UI-037's reveal
      seam; do not invent a second mechanism)
- [x] An unanchored row still opens its thread, and says why it has no anchor
- [x] Resolving/reopening from the list updates it without a reload
- [x] The existing below-the-body listing is either subsumed or deliberately
      kept, with the reason stated — **kept**, see Design questions
- [x] Empty and single-item states read well — an empty list should say which
      filter is hiding things, not just be blank
- [x] Keyboard reachable, consistent with the app's existing list conventions

## Technical Design
### Files to Create/Modify
- `apps/ui/src/comments/` — the surface, colocated: `commentsModel.ts` (the two
  axes, pure), `CommentsTab.tsx`, `CommentsSwitch.tsx`, `useCommentsTab.ts`,
  `comments.css`
- `apps/ui/src/reader/` — `ReaderHead` (the switch), `DocView` (the two halves),
  `Reader`/`FocusMode` (the state), `Reader.css`
- `apps/ui/src/reader/CommentsPopover.tsx` — **deleted**, subsumed
- No `packages/kit` change, and **no wire change**.

### The anchored axis is derived client-side, and keys on RESOLUTION

`DocRow.anchorQuote` is `an.exact_text` — the **stored** selector's text — so it
is present whenever an anchor entry exists, including one that no longer
resolves. A list keyed on it files every orphan under *anchored*, which is
exactly the row the live report asked for. `Doc.anchors[].orphaned` is the
server's verdict about the body as it now stands, and that is what the axis
reads. `commentRows()` turns it into three states under two labels — `anchored`,
`orphaned`, `unanchored` — because §10 also requires the row to **say why** it
has no anchor, and "detached" and "never had one" are different sentences: one
reports a loss and the other does not.

No contract or server issue was needed, and none was filed.

## Testing Strategy
Component tests for each filter combination including the empty results case;
e2e in the real app covering both hosts and the reveal-from-row path.

## E2E Verification Log

**Model: Opus 5 (1M context).** Verified in a real browser (Playwright, Chromium)
against `stubCorpus`, plus jsdom component tests for the arithmetic.

### The surface

`apps/ui/e2e/comments-tab.spec.ts`, `CORPUS_UI_PORT=5473 npm run e2e` — 12 tests,
all green:

```
✓ the Document / Comments switch › is in the head, and shows one surface or the other
✓ the Document / Comments switch › is reachable from the keyboard, and says which state it is in
✓ the Document / Comments switch › is absent on a document with no comments, which reaches the list on ⋯
✓ the list › holds every conversation and says why each unanchored one has no anchor
✓ the list › filters on both axes, and names what a filter is hiding
✓ the list › reveals an anchored row at its anchor, in the document
✓ the list › offers a detached row its way back, and offers it to nobody else
✓ the list › resolves from the list, without a reload
✓ writing a comment with no selection › starts a new unanchored thread, and a second remark starts its own
✓ writing a comment with no selection › takes a newline on ↵, so a remark can have paragraphs
✓ writing a comment with no selection › replies in place to a conversation already in the list
✓ in full screen › carries the same switch and the same list
```

Observed, on a document seeded with one live anchor, one orphan and one
whole-document remark:

```
[data-comment-row="th_anchored"] .cm-why-text  "anchored to “lender spreads”"          + [data-reveal-thread]
[data-comment-row="th_orphan"]   .cm-why-text  "detached — the document no longer      + [data-reattach]
                                                contains “a phrase since deleted”"
[data-comment-row="th_whole"]    .cm-why-text  "about the whole document — it never had an anchor"
```

Filters: `status:open` → 2 rows; then `anchor:unanchored` → 1 row, `th_orphan` —
the open, unanchored comment the rider is written about. `status:resolved` +
`anchor:anchored` → 0 rows and the sentence
`No resolved, anchored comments. 3 comments are hidden by these filters.`

Resolve from a row: the card is replaced by its collapsed line
(`[data-thread-expand].resolved-chip`), `corpus.doc("th_anchored").status`
polls to `resolved`, and the row's `data-anchor-state` stays `anchored` — the two
axes are independent in the surface as well as in the predicate.

### The head's width — measured, and it changed the design

The switch was **first built as a segmented two-position control** with the words
`Document` and `Comments N`. `apps/ui/e2e/reader-head-geometry.spec.ts` refused
it, which is exactly what that file is for:

```
✘ survives the narrowest column `columnWidth.ts` permits
    scrollWidth 267 > clientWidth 238   (a 240px column)
✘ leaves the ordinary head whole — the id entire, the back label at its cap
    "the document id is cut short on an ordinary head"
```

Instrumented at 560px with a long parent title, the row measured:

```
content 534   back 187  reader-id 84  save-chip 100  doc-tabs 73  ⋯ 28  ⤢ 22   gaps 45  → 539
```

— over by 5px with the id already clipped, and needing 37px more to put `.back`
back at its own 40% cap. Without any switch the same row is 489 in 534: **45px of
slack, and the switch wanted 73 + a 9px gap.** Two glyph cells (~57px) did not fit
either.

So the switch is **the 💬 button, as a two-state toggle**: same element, same
place, same width, `aria-pressed` while the list is showing, the count in the
same reserved box UI-134 gave it. One control out, one control in — literally the
same one.

After that change, all 8 head-geometry tests pass, including the two above and
`still fits when the document carries conversations, at that same width`.

### The deviation from §10, measured — the switch is NOT unconditional

§10's rider reads *"reached by a Document / Comments switch in the reader's
header"*, with no clause about the document already having conversations. It was
built that way and **measured**. It does not fit on one head, and not by a
margin that padding could close.

At a 560px column (534px of content), on a document reached from a long-titled
parent so `.back` sits at its own `max-width: 40%` cap. `natural` is what each
item would take if the row had the room; `drawn` is what it got:

| item | natural | drawn |
| --- | --- | --- |
| `.back` | 214 (its cap) | 206 |
| `.reader-id` | 101 | **85, clipped** |
| `.save-chip` | 120 | **101** |
| `.comments-btn` | 52 | 52 |
| `⋯` | 28 | 28 |
| `⤢` | 22 | 22 |
| gaps | 5 × 9 = 45 | 45 |
| **total** | **582** | 539 |

Content is **534**. So:

```
natural with the toggle      582   →  deficit 48px
natural without the toggle   521   →  slack   13px
```

The row has **13px of slack** and the toggle needs **61px** — 52 plus its gap.
No control of any width fits, so this is not a padding-shaving problem, and the
two items that pay are precisely the pair UI-135's own log records as the
rejected trade: *"the back label squeezed below its own cap and the document id
truncating on a head where nothing unusual was happening."*

Every other head measured has room. The **same column with an ordinary back
label** (`‹ Inbox`) draws back 39, id 114 unclipped, chip at its full 120, toggle
52, ⋯ 28, ⤢ 22 — 420 of 534, **114px of slack**. Both 240px cases pass with the
toggle present.

So the toggle keeps 💬's own render condition, plus one: whenever the list is
showing, so the way back is never missing. **A document with no comments reaches
the list through the reader's ⋯ menu**, which costs the row nothing, and
`comments-tab.spec.ts` walks that whole path — ⋯ → Comments → the empty
sentence → type → send → one row, no toggle before and a pressed toggle after.

Restoring §10's unconditional reading needs room the head does not have: a
shorter `.reader-id`, a smaller `.back` cap, or a narrower save-chip reservation
— each of them somebody else's signed tuning. Reported to the orchestrator as a
deviation to be recorded rather than a defect to be hidden.

### The unfiltered empty list has its own sentence

Because a person now arrives at it **deliberately**, through ⋯, in order to write
the first comment on a document. So it names the act rather than the absence, and
says the one thing that is not obvious:

```
No comments on this document yet. Write the first one below — no text selection needed.
```

A list emptied by a **filter** says something else entirely — it names the filter
and counts what it is hiding — and the two are pinned apart in
`commentsModel.test.ts` and asserted in the browser.

### The reveal, and why the editor is hidden rather than unmounted

The first build unmounted the body when the list showed. `changelog.spec.ts`
caught it:

```
✘ expands the clip when the conversation is revealed
    locator('.reader .ProseMirror.doc-body [data-changelog-clipped]') expected 0, received 7
```

`useAnchorLayer`'s flash effect expands a clipped changelog entry **around the
anchored highlight**, once, in the commit that sets the flash — so a body that
mounts a beat later has nothing for it to find, and UI-089's clip stayed shut on
every reveal out of the list. The editor is now hidden (`.doc-body-slot`,
`display: contents` + `[hidden]`) rather than unmounted, so its highlights exist
when the effect runs. Nothing §7 protects is hidden-but-mounted: every placement
that shows a **conversation** — the chips at their anchors, the margin column,
the below-body list, a thread document's own card — is still unmounted, and the
e2e asserts that (`.anchor-slot .thread-card` → 0, `[data-thread-section]` → 0).

### Falsification

`commentRows` keyed on *has an anchor entry* instead of *does the anchor
resolve* (`anchor === null ? "unanchored" : "anchored"`):
**11 failed | 27 passed** across `commentsModel.test.ts` and `CommentsTab.test.tsx`
— the orphan's row, its reason sentence, both filter axes, its counts, its
re-attach offer and the reveal's exclusivity all went red. Restored, 38 pass.

### Unit coverage

```
apps/ui/src/comments/commentsModel.test.ts   23 tests
apps/ui/src/comments/CommentsTab.test.tsx    15 tests
apps/ui/src/reader/**                       255 tests (whole directory, green)
```

### Regression sweep (e2e, all green)

`reveal`, `soft-wrap`, `collapse`, `anchor-layer`, `reader`, `thread`,
`turn-comment`, `comment-move`, `reattach`, `changelog`, `related`,
`reader-head-geometry`, `digit-geometry`, `console`, `console-index`, `abandon`,
`edit-session-close`, `context-menu`, `todos`, `todos-menu`,
`plugin-late-arrival`, `key-conflict`, `composer-sticky`, `autocomplete-keys`,
`compose-keyboard`, `anchors`, `images`, `render-fixes`, `fences`, `editor`,
`forms`, `attachments`.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
