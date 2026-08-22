# [UI-110] The composer you are typing in stays visible while you scroll what you are commenting on

## Domain

ui

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Related: UI-066 (resizable body width — the other "the reader's shape is the
  user's" change), UI-101 (the persistent formatting toolbar, same instinct one
  surface over)

## Spec References

- SPEC.md **§10** Thread view — the reply box, and what the composers are
- SPEC.md **§10** Document view — anchored thread placement, the comments list

## Summary

**The user's own statement of the problem**, because it is better than a feature
description would be:

> When I start writing content, I often have to scroll up to see what I'm
> commenting on (for large sections) and I want to be able to keep typing while
> seeing the content I'm commenting on.

Today the reply box sits at the end of the conversation in ordinary flow. A
comment on anything longer than a screen therefore forces a choice: look at what
you are responding to, **or** look at where you are typing it. Scrolling up to
re-read the passage pushes the composer off the bottom of the viewport, and the
caret goes with it.

This is not a request for a sticky footer as decoration. It is the ordinary case
of writing a considered comment — quoting a figure, checking a name, answering
the third of four questions — and the app currently makes that a memory exercise.

## What it should do

**A composer that is in use stays on screen.** While the composer is focused, or
while it holds an unsent draft, it sticks to the bottom of the surface that
scrolls, so scrolling the conversation or the document above it never takes the
box you are typing in with it.

**In use, not always.** An empty composer nobody is using goes back into ordinary
flow and costs no vertical space. That is the difference between an affordance
and a permanent bar, and the narrow column is where the difference is felt.

**An unsent draft counts as in use.** Focus alone covers the case the user
described, since scrolling does not blur a textarea. A draft covers the step
after it: clicking into the document to check something, then scrolling — losing
a half-written reply off-screen is the same complaint one move later.

## Acceptance Criteria

- [x] While the composer is focused, it remains visible at the bottom of its
      scrolling surface as the content above it is scrolled
- [x] The same holds while it holds an unsent draft, focused or not
- [x] An empty, unfocused composer is in ordinary flow and adds no fixed
      furniture to the surface
- [x] It holds in **both** places a reply box appears: a thread read on its own,
      and a thread on a document (anchored placement and the comments list)
- [x] The stuck composer is opaque — conversation text never shows through it —
      and never covers the turn it is replying to at rest
- [x] Nothing about the composer key contract, the ask-agent toggle, attachments,
      snippets or the weight control changes (SPEC.md §10)
- [x] Verified against a real scrolling surface, not asserted from the class
      name: `position: sticky` fails **silently** when an ancestor clips it, and
      `Column.css` carries several `overflow: hidden` rules

## Technical Design

### Files to Create/Modify

- `apps/ui/src/thread/thread.css` — the stuck state on `.composer`
- `apps/ui/src/thread/ThreadComposer.tsx` — the "in use" signal, if CSS alone
  cannot express "holds a draft"
- `apps/ui/e2e/` — a spec that scrolls a real surface and asserts the box stayed

### Notes

`ThreadCard` renders `ThreadComposer`, and thread cards are what both surfaces
show, so one change point serves the thread reader and the document's threads
alike. `:focus-within` expresses the focused half in CSS with no JS at all; the
draft half needs a class, because CSS cannot ask whether a textarea has content.

**The risk worth naming up front**: `position: sticky` is not an error when it
does not apply. An ancestor with `overflow: hidden` between the composer and the
scroll container silently disables it, and the element simply scrolls away as
before — which looks exactly like the bug this issue is about. A unit test
asserting the class is present would pass against that. The check has to scroll.

## Testing Strategy

Unit: the in-use predicate (focused, drafted, neither). E2E: a real thread with
enough turns to scroll, scroll the surface with the composer focused, assert the
composer is still in the viewport; assert an untouched composer is not stuck.

## E2E Verification Plan

### Verification Steps

1. Open a thread with more turns than fit the column
2. Focus the reply box, scroll the conversation to the top
3. The reply box is still visible and still holds the caret
4. Repeat on a document with a whole-document thread
5. Blur an empty composer and scroll — it scrolls away with the content

## E2E Verification Log

**Model: Opus 5 (1M context)**, orchestrator. No server started, no port bound
(8765 untouched; the e2e run used `CORPUS_UI_PORT=5373`).

**The fix is four lines of CSS and one class**, which is why the verification
matters more than the change. `.composer:focus-within, .composer.in-use` becomes
`position: sticky; bottom: -1px`. `:focus-within` covers the reported case —
scrolling does not blur a textarea, so the box you are typing in stays focused
while you read above it. `in-use` covers the step after: the composer already
computed `hasContent` (text or pending attachments) for its send button, so the
draft half needed no new state.

**The verification is the scroll, and it had to be.** `position: sticky` fails
**silently** — an ancestor that clips, or the wrong scroll container, and the
element scrolls away exactly as before while the class list and the stylesheet
both still read correctly. A component test asserting either would have passed
against the bug. So `apps/ui/e2e/composer-sticky.spec.ts` puts 30 turns in front
of a real layout engine, types a draft, scrolls the surface to the top, and asks
where the box actually is.

**And the test was checked against the absence of the fix**: with
`position: sticky` swapped for `static`, the scroll case fails and the
"untouched composer is not sticky" case still passes — which is the right pair.
A test that passes either way proves the assertion, not the behaviour.

```
$ npx playwright test apps/ui/e2e/composer-sticky.spec.ts   → 2 passed
$ (with the fix disabled)                                   → 1 failed, 1 passed
$ npx vitest run apps/ui/src/thread                         → 335 passed
```

**Both surfaces are covered by one change point**: `ThreadCard` renders
`ThreadComposer`, and thread cards are what the thread reader and the document's
threads both show — so "a thread" and "a document's main thread" are the same
composer, not two.

**Checked before trusting it**: `.col-list` and `.reader-scroll` are the
scrollers, `.column`'s `overflow: hidden` sits *above* the scroller rather than
between it and the composer, and `.thread-card` sets no overflow — so nothing
clips the sticky context. That reading is what the e2e then confirmed rather than
replaced.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-110]` prefix
