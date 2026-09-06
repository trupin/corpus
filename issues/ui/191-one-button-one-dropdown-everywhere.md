# [UI-191] One button, one dropdown, everywhere

## Domain

ui

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Blocks: INFRA-040 (the enforcement — nothing to enforce until the
  primitives exist and the product uses them)

## Spec References

- SPEC.md **§10** — the board; `design/index.html` is authoritative for look
  and feel; `packages/kit/src/tokens.css` transcribes it verbatim

## Summary

User directive, 2026-09-06, from two screenshots of the running product:

The editor's format toolbar renders **native `<select>` chrome** — glossy
macOS gradient pills with stepper arrows on "Heading 1", "Colour", "Align",
"Indent" — while the document header's pill row is the product's actual
design language. The user wants the second, everywhere:

> "I want you to come up with button / drop down component styles and apply
> them consistently across the whole product."

**The target language, transcribed from the screenshot** (the images do not
travel into the repo — this prose and the design mockup are the record):

- Flat, fully-rounded pills; fill one step lighter than the surface behind
  them; no gradients, no gloss, no native chrome anywhere.
- Quiet single-tone labels; compact height (the pill row's, not the native
  select's).
- A **dashed border** is the empty/placeholder state (the `due: —` chip).
- A **tinted fill** is the stateful variant (the `status: resolved` chip's
  blue); tint colours come from the existing semantic tokens (`--accent`,
  `--signal`, `--sepia`) by role, never by look.
- Dropdown triggers are the same pill with a chevron; the menu is a custom
  popover on the dark surface — a styled native `<select>` is not the target,
  because the popup is native chrome too.

## A third screenshot, and what it adds (user, 2026-09-06)

The Ask composer's designation row mixes both languages **in one row**:
"agent will answer ▾" is already the correct pill dropdown, while the "owner"
and "at" controls beside it are native selects — glossy chrome — **and both
truncate their labels** ("its own agen…", "the launche…"). Located:
`apps/ui/src/compose/ComposeOverlay.tsx:475` and `:517`.

Two things this instance adds to the requirements:

1. **The migration's proof-of-done includes mixed rows**: the composer row is
   the acceptance screenshot, because it shows the before and after side by
   side in one component.
2. **The `Select` primitive must handle long labels** — these two truncate
   mid-word with no affordance. The primitive states its truncation
   behaviour: ellipsis with the full value in the popover (which, being
   custom, can be wider than its trigger — the native popup cannot), and a
   `title` for hover. A dropdown whose closed label is unreadable is the
   defect that motivated this sentence.

Note the file's own comments document fighting the native element
(`ComposeOverlay.tsx:100-103` — the sentinel dance because "a `<select>`
value is a string and cannot be `null`"). The kit `Select` takes real values,
`null` included, and that workaround is deleted rather than ported.

## What to build

1. **Design first, in the authoritative place.** The primitives are drawn in
   `design/index.html` (states: rest, hover, active, disabled, open; both
   variants; keyboard focus visible), then ported to kit — that is the
   established token pipeline and it is not skipped.
2. **Kit primitives** under `packages/kit/src/components/`: `Button`,
   `IconButton`, `Select` (trigger + popover menu, full keyboard support:
   arrows, type-ahead, Escape, focus return), `Chip` (with empty/dashed and
   tinted variants). Accessible: real roles, focus management, and the
   popover closes on outside click and blur.
3. **Migrate the whole product.** All 82 files currently carrying raw
   `<button>`/`<select>` in `apps/ui` and kit's own surfaces — the format
   toolbar first (it is the reported offence), then compose, console,
   board, readers. No raw interactive element survives outside the
   primitives' own internals.
4. **No behaviour change.** This is restyling and componentization; every
   existing e2e must pass unmodified except selectors that named native
   elements — update selectors, never assertions.

## Acceptance Criteria

- [ ] `design/index.html` carries the primitives in all states; tokens.css
      ports any new values verbatim, per its own header rule
- [ ] The format toolbar renders zero native select chrome — Playwright
      asserts the absence of `<select>` in the editor DOM
- [ ] `grep -rE "<(select|button)\b" apps/ui/src packages/kit/src` returns
      only the primitives' own internals (the exact allowed list recorded
      here for INFRA-040 to encode)
- [ ] Keyboard: every dropdown fully operable without a mouse — e2e-tested
- [ ] Both themes (§10's dark and light) — verified in the mockup and the
      product
- [ ] The composer's designation row renders one language: pill dropdowns for
      recipient, owner and weight, no truncated closed labels, the null
      sentinel workaround deleted (`ComposeOverlay.tsx:100-103`)
- [ ] `Select` states its long-label behaviour and an e2e proves a long
      option readable
- [ ] Full e2e suite green with assertion semantics unchanged

## E2E Verification Log

_Implementing agent fills; state the model._
