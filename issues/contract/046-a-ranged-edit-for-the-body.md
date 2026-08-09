# [CONTRACT-046] The only body edit is a whole-body replacement

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-037 (rider must be signed first)
- Blocks: SERVER-079, CLI-035

## Spec References

- SPEC.md §9.2 — as amended by SHARED-037 (rider pending sign-off); today it
  documents `PUT /api/docs/:id` whole-body replacement only
- SPEC.md §6 — anchors reconciled on every write
- SPEC.md §4 — autosave squashing, author attribution

## Summary

The agent's only way to change one line of a document is to send the whole
document: `corpus doc edit` pipes a full body into `PUT`. The user asked
(2026-08-08) why insertion isn't possible and what Claude does natively — the
answer is **anchored exact-string replacement** (an `old` excerpt unique in the
file, a `new` replacement, refusal on zero or multiple matches), which costs
tokens proportional to the change rather than the document.

This issue adds that operation to the contract. It matters twice over: token
efficiency for every agent edit, and — with SHARED-035's styled text — an edit
that never carries the rest of the body **cannot wipe the style markers it never
saw**.

## Acceptance Criteria

- [ ] A patch request shape: `old` (non-empty string), `new` (string, may be
      empty — deletion of the quoted text), `all` (boolean, default false)
- [ ] Semantics documented in the route definition, mirroring the native Edit
      tool contract: `old` must match the body **exactly and uniquely**;
      zero matches is a refusal naming the count (0), multiple matches is a
      refusal naming the count, unless `all` — which replaces every occurrence
- [ ] The refusal shape carries the match count and is distinguishable from
      validation refusals — the caller's recovery differs (re-quote with more
      context vs. fix the content)
- [ ] The response is the same shape as the existing document write response —
      a patch is an ordinary write once applied (anchors reconciled per §6,
      same commit semantics per §4)
- [ ] The operation is a **body** operation only; frontmatter keeps its existing
      field-patch semantics on `PUT`
- [ ] `openapi.json` regenerates with no diff; typed client exposes the route;
      schema round-trip tests cover `old`/`new`/`all` and both refusal shapes

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/doc.ts` — request/response/refusal schemas
- the route definitions module — `POST /api/docs/:id/patch` (a `PATCH` verb on
  the resource would collide with the existing frontmatter-patch semantics of
  `PUT`; a named sub-resource is honest about being an operation)
- generated `openapi.json` + client (regenerated)

### Key Implementation Details

Mirror the native Edit contract precisely rather than inventing near-variants:
uniqueness required by default, `all` as the explicit escape, exact-string
matching (no regex, no normalisation — the agent read the raw body from
`corpus doc show` and quotes it verbatim). Whitespace is significant; say so in
the schema description, because "close enough" matching is how a patch lands in
the wrong place.

### Edge Cases

- `old` equal to `new` — a no-op; decide refusal vs. success-no-change and
  document it (the existing write path's "only a real change" precedent at
  `update.ts:233` suggests no-op success with no commit)
- `old` spanning a frontmatter boundary — refused; the operation is body-only
- Overlapping matches with `all` (e.g. `old: "aa"` in `"aaa"`) — define the
  scan order (left-to-right, non-overlapping) so the server and any client
  simulation agree

## Testing Strategy

Vitest schema round-trips; contract-level tests that the refusal shapes carry
the count; the typed client compiles against both consumers.

## E2E Verification Plan

### Verification Steps

1. `npm run generate -w packages/contract` from a clean tree — no diff
2. Typed-client call against the route mounted on a stub app returns the typed
   response (the M1-style check)

## E2E Verification Log

_[Agent fills: model run on, commands, observed output.]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] `openapi.json` regenerated, drift check clean
- [ ] E2E verification log filled in
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[CONTRACT-046]` prefix
