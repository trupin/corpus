# [UI-197] An empty sublist sometimes degrades to trailing-space joins

## Domain

ui

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Related: UI-187 (the TipTap 3 upgrade era this likely dates from)

## Spec References

- SPEC.md **§5** — the document's markdown round-trips

## Summary

Flake observed twice during UI-192's runs (2026-09-07, recorded in its E2E
log): `list-blocks.spec.ts` "empty sublist" failed with blank lines degraded
to trailing-space joins, then passed nine straight and the full suite. Not
caused by UI-192's diff (which touched no serializer). INFRA-020's rule: a
test that fails intermittently is diagnosed, not retried into silence —
suspected TipTap-3-era serializer timing.

## Acceptance Criteria

- [ ] The failure is reproduced or its trigger bounded (INFRA-020's
      diagnosis order), with the finding recorded before any fix
- [ ] Whatever the cause, the test stops being able to pass wrongly

## E2E Verification Log

_Implementing agent fills; state the model._
