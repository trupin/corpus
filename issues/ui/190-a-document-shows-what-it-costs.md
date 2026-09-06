# [UI-190] A document shows what it costs

## Domain

ui

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: CONTRACT-097, SERVER-166 (series route live); CLI-085 (data
  exists); the SHARED-079 rider signed

## Spec References

- SPEC.md §10 — the drafted telemetry rider (SHARED-079)

## Summary

A **measurements panel on the document/thread view — deliberately not in the
console section** (SHARED-079's recorded placement reading; flag to the user
at review if the document view makes it cramped, do not silently relocate).

The panel answers one question: **is working with this document getting more
expensive as it grows?**

- The series from `GET /api/docs/{id}/cost`: read-tokens and wrote-tokens
  over time, bucketed as served.
- The document's size as the reference line, so flat-cost-against-growing-
  size is visible at a glance — that shape IS the bounded reads working, and
  the panel exists to show it or its absence.
- A by-command breakdown (the contract's `byCommand`) on demand — which verb
  is paying, not just how much.
- Empty state: a document nobody has touched through the CLI shows the panel
  with an honest "no measurements yet", never a fabricated zero series.
- Read-only, poll-or-SSE per the surrounding view's existing pattern — copy
  what the thread view does, do not invent a channel.

## Acceptance Criteria

- [ ] The panel renders the series + size line + by-command breakdown from a
      workspace with real CLI-085 data — E2E via Playwright against seeded
      telemetry
- [ ] Not in the console section; reachable from the document and thread
      views
- [ ] Empty state honest; truncation stated when the server truncated
- [ ] Units labelled as the workspace token estimate (bytes ÷ 4), same words
      as the CLI help uses

## E2E Verification Log

_Implementing agent fills; state the model._
