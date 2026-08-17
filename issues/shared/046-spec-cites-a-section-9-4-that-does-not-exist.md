# [SHARED-046] SPEC.md cites a §9.4 that does not exist, and the citation has reached the published contract

## Domain

shared (SPEC amendment — requires user sign-off)

## Status

todo

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Related: CONTRACT-055 (which found it), SHARED-043, SHARED-041

## Spec References

- SPEC.md **§9** — runs §9.1 Projection, §9.2 HTTP API, §9.3 Contract-first.
  **There is no §9.4.**

## Summary

Eleven places cite **SPEC.md §9.4** for "the ordinary invalidate keys". §9 has
three subsections and stops at §9.3.

Found by CONTRACT-055's structural sweep, not by anyone reading the spec — which
is the point: a cross-reference to a section that does not exist reads exactly
like one that does, and nothing checks.

**Where it has spread:**

- **SPEC.md itself, three times** — §7 line 329 (the recipient paragraph), line
  363, and §9.2 line 459 (`GET /api/agents`)
- **Eight issue files** — including four written on 2026-08-16 alone
  (`SHARED-044`, `SERVER-114`, `SERVER-115`, `SERVER-116`, `CONTRACT-053`,
  `CONTRACT-055`), which is how fast a wrong citation propagates once it is in
  the text people copy from
- **`packages/contract/src/schemas/key.ts`**, and from there
  **`src/client/schema.generated.ts`** — so it ships

The content the citations mean is real and is in **§9.2** (the SSE/invalidate
bullets) and the architecture list at line 67 (*"the server never pushes data
over SSE — only `invalidate` events carrying query keys"*), plus the watcher
paragraph in §9.1. So this is a numbering error, not a missing promise: nothing
about the system is unspecified.

## What the amendment must decide

Two ways to make the citations true, and they are not equivalent:

1. **Repoint them** to §9.2 (or §9.1 where the watcher is meant). Cheapest, and
   correct, but it leaves invalidation described in scattered bullets across two
   subsections — which is presumably why eleven authors independently reached
   for a section number that felt like it ought to exist.
2. **Write the §9.4 everyone has been citing** — one subsection that states the
   invalidate-key contract in one place. That is a larger edit and a real
   editorial decision, and it is the one that would stop this recurring.

The fact that this many independent authors assumed a §9.4 exists is evidence
worth weighing rather than dismissing: they were citing the section the document
*should* have.

## Acceptance Criteria

- [ ] Drafted amendment text quoted to the user **verbatim** and signed before
      anything is applied
- [ ] Every citation in SPEC.md points at a section that exists
- [ ] The eight issue files and `packages/contract/src/schemas/key.ts` are
      swept in the same pass, and `openapi.json` regenerated — the citation
      currently ships in the published client
- [ ] A check that no SPEC cross-reference names a non-existent section. This
      one survived eleven copies because nothing looks; `scripts/check-issues.ts`
      is the precedent for the kind of check that catches it

## Testing Strategy

The check in the last criterion is the deliverable worth having. It is
mechanical: enumerate the headings, enumerate the `§N.M` citations, diff.

## E2E Verification Log

_Not applicable until the amendment is signed._

## Completion Checklist (orchestrator)

- [ ] User sign-off on the amendment text
- [ ] Committed with `[SHARED-046]` prefix
