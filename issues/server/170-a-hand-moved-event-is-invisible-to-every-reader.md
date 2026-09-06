# [SERVER-170] A hand-moved event is invisible to every reader

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Related: AGENT-064 (the prose half of the same defect — this is the
  mechanical backstop behind it)

## Spec References

- SPEC.md **§7** — statuses; *"No path loses a job silently"*

## Summary

Found during AGENT-064's reproduction (2026-09-06). A queue event file moved
into `processed/` by hand carries a body that still says `status: "pending"`,
`updated` equal to `created`, and no job log — the settle verbs rewrite the
body, so the mismatch is the signature of a move no verb performed. Today
every reader trusts the folder: the event counts as settled, and the
mismatch is visible to nobody.

## What to build

The server refuses to regard a settled-folder file whose body disagrees with
its folder — either `corpus db doctor` reports it, or `reap-stale` requeues
it, or both. Decide which reader owns the check and record the decision. A
hand-moved event must become visible: reported with the file's path and both
statuses, never silently trusted or silently deleted.

## Acceptance Criteria

- [ ] The pending-body-in-processed shape from AGENT-064's log is detected
      and reported by a real reader on a real workspace
- [ ] A legitimately settled event (rewritten body, job log present) is
      untouched
- [ ] The chosen reader and the rejected alternatives are recorded

## E2E Verification Log

_Implementing agent fills; state the model._
