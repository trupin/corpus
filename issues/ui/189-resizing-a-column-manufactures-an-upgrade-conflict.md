# [UI-189] Resizing a column manufactures a template conflict by clicking

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
- Related: CLI-081 (deliberate divergence — the general mechanism; this issue
  removes one systemic source of accidental divergence)

## Spec References

- SPEC.md **§10** — boards and views; **§4** — the workspace

## Summary

Reported from a real upgrade (0.32.0 → 0.33.0, `cos` workspace, 2026-09-06).

Resizing a board column writes `width:` into the view's own document —
`apps/ui/src/board/useColumnWidth.ts:98` PUTs `{ extra: { width } }` onto the
view doc. `views/attention.md` got `width: 686`, `views/inbox.md` got
`width: 418`. The user never edited those files, yet the workspace is now in
permanent conflict with every future template upgrade of them. **Any user who
resizes a column manufactures this conflict by clicking.**

## What to build

Decide between the two directions and record the decision — both are honest,
one must be chosen and the other rejected in writing:

1. **Presentation state moves out of template-tracked documents.** Per-viewer
   runtime state lives under `.corpus/` (never committed, never compared).
   Cost: the width no longer travels with the document, and a second viewer
   does not inherit it — which for a single-user product is no cost today.
2. **The template comparison ignores designated keys.** `width` (and any
   future presentation key) is declared presentation-state and excluded from
   the manifest comparison. Cost: the list of ignored keys is a second place
   the meaning of frontmatter lives, and a key on it can never become
   load-bearing content.

Whichever wins: an upgrade over a workspace whose only change to a view is a
resize reports **no conflict**, and existing workspaces with stamped widths
stop conflicting (migration or comparison-side fix — state which).

## Acceptance Criteria

- [ ] The decision recorded here with the rejected direction argued
- [ ] Resize → upgrade reports no conflict for that file (E2E, real upgrade)
- [ ] Existing stamped-width workspaces stop conflicting on upgrade
- [ ] Resize still persists across a reload

## E2E Verification Log

_Implementing agent fills; state the model._
