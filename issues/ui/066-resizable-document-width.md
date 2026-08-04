# [UI-066] The document body's width should be resizable, not fixed at the reading measure

## Domain
ui

## Status
todo — needs SPEC sign-off before implementation (new user-visible control)

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-010 (the rider for this surface)
- Blocks: —

## Spec References
- SPEC.md §11 Document view
- `design/index.html` (authoritative for look and feel)

## Summary
Live report 2026-08-04: _"I want to be able to resize documents so they look
wider. I don't see a valid reason why the width of a document needs to be capped
to a such small width. It's fine to cap it, but I want to be able to resize to
the desired width, both in column and full screen mode."_

Today `.doc-body` is capped at **`62ch`** (`packages/kit/src/markdown/
markdown.css`). That number is a typographic reading measure — roughly 62
characters is where prose is comfortable to read — and it is a defensible default
for a *document*. It is a poor fit for the things people actually put in
documents: wide tables, fenced blocks of code or prompts, and pasted output. The
canvas work (UI-050) has just spent effort making long lines wrap *inside* that
measure; letting the measure grow is the other half of the same complaint.

The user is explicit that a cap is fine — the ask is that **they** choose it.

## Design questions to settle before coding
- **The control.** A draggable edge, a preset toggle (comfortable / wide / full),
  or both? A drag handle is the direct expression of "resize to the desired
  width"; presets are cheaper to make keyboard-accessible. Decide against
  `design/index.html` and the app's existing resize affordance — the console
  drawer is already resizable by dragging its top edge (§11), so there is a
  precedent to follow rather than a convention to invent.
- **Scope of the setting.** Per document, per column, or global? "Both in column
  and full screen" implies it should not be re-set every time the same document
  is opened in a different host.
- **Persistence.** §11 says navigation state is sticky. This should be too — say
  where it is stored and whether it is workspace state or per-browser.
- **Interaction with the column width itself.** A column has its own width; a
  document inside it cannot exceed it. Define what "wider" means when the column
  is the binding constraint — does resizing the body widen the column?
- **SETTLED (user, 2026-08-04): everything stretches uniformly.** Prose included.
  The user was offered the variant where prose keeps a reading measure while
  tables and fences break out to full width, and declined it — what you drag is
  what you get. Do not reintroduce a per-element measure as a "sensible default";
  the uniform behavior is the signed one (SHARED-010 Amendment 2).

## Acceptance Criteria
- [ ] The document body's width is adjustable by the user, in column view and in
      full screen
- [ ] The chosen width persists across navigation and reload
- [ ] A default is preserved for documents never adjusted — nobody is forced to
      set a width to read comfortably
- [ ] Keyboard-accessible: the control is reachable and operable without a
      pointer (SPEC §11 requires no exclusive-pointer capability)
- [ ] Wide content that motivated this — tables, fenced blocks — actually uses
      the new width
- [ ] Anchored thread placement still lines up: margin cards and connectors are
      positioned against the body, and they must follow it when it moves
- [ ] The editor and the rendered view agree at every width

## Technical Design
### Files to Create/Modify
- `packages/kit/src/markdown/markdown.css` (the `62ch` measure)
- `apps/ui/src/reader/` (the control, both hosts, persistence)
- watch `apps/ui/src/anchors/` — margin thread placement is measured off the body

## Testing Strategy
Component tests for the control and persistence; e2e asserting the body's
rendered width changes and that an anchored thread card stays aligned to its
highlight after a resize.

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
