# [CONTRACT-042] No filter can express "top-level only", so views cannot exclude children

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-024 (the §9.2 rider — **must be signed before this lands**)
- Blocks: SERVER-073, CLI-032, UI-088

## Spec References

- SPEC.md **§9.2** — the collection query endpoint's enumerated filter list
- SPEC.md **§11** — columns and saved views are filtered lists

## Summary

**Requested by the user, 2026-08-07**: "a filter query attribute called
`isParent`, so I can show parents only in views."

Today `GET /api/docs` takes `parent=<id>` — threads whose parent is *that
document*. There is no way to ask for documents that are **not a child of
anything**, so a view cannot exclude child threads, and a board column showing
threads shows sub-threads mixed in with the conversations they hang off.

This is the query-side companion to UI-087 (child threads rendering twice in a
reader). That one is a rendering defect; this is a missing capability.

## The semantics, decided

**User decision, 2026-08-07**, chosen against the alternative:

`isParent=true` selects documents whose `parent` is **null or absent** —
top-level documents. A standalone document with no children **still matches**:
it parents nothing, but it is not a child of anything, and a view of "parents
only" that hid every uncommented note would be nearly empty.

The rejected reading was "has at least one child". It matches the name more
literally and is the wrong behaviour.

**The name is misleading and that was accepted knowingly** — these are roots
rather than parents. `isRoot`, or `hasParent=false`, would say what it does.
Keeping the user's word is deliberate; nothing is published, so renaming stays
cheap. Do not rename it unilaterally.

## Acceptance Criteria

- [ ] `isParent` is a boolean query parameter on `GET /api/docs`
- [ ] `isParent=true` matches documents with **no parent**; `isParent=false`
      matches documents that **are** a child of something
- [ ] **Absent means no filtering**, exactly as every other optional filter
      behaves — not a default of `true`. A view that never set it must not
      change what it shows
- [ ] Its description says plainly that it selects *roots*, not *documents that
      have children*, so the next reader is not misled by the name. State the
      rejected reading, or someone will "fix" it
- [ ] The interaction with `parent=<id>` is **decided and stated**, not left to
      fall out: `parent=X` with `isParent=true` is a contradiction. Choose
      refusal or empty-set deliberately and say which in the description
- [ ] Whether this **no-ops for non-thread types** is answered explicitly. The
      existing `parent` filter is documented as thread-only; this one probably
      should **not** be, because a non-thread document with no parent is a
      genuine top-level document and the whole point is a mixed view. Verify
      what `parent` actually holds for non-thread rows before deciding — do not
      assume it is null
- [ ] `openapi.json` and the typed client regenerated, not hand-edited

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/query.ts` (the filter, beside `parent` at
  ~L150), plus regenerated artifacts.

### Notes

- **§9.2 enumerates the filter list literally** — `?q=&type=&status=&…&parent=&…`
  — so this needs a line there. That is SHARED-024, drafted and **awaiting user
  sign-off**. Do not apply a SPEC edit; do not land this before it is signed.
- Booleans on query strings are a place drift creeps in. Match however the
  existing `pinned` / `unread` / `stale` booleans are parsed rather than
  inventing a second convention.

## Testing Strategy

Contract tests over `true`, `false`, absent (no filtering), the contradiction
with `parent=<id>`, and shape rejection; the OpenAPI drift check as usual.

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
