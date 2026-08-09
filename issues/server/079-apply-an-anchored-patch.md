# [SERVER-079] Apply an anchored string patch through the ordinary write path

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-046
- Blocks: CLI-035

## Spec References

- SPEC.md §9.2 — the patch operation, as defined by CONTRACT-046
- SPEC.md §6 — anchors reconciled on every write
- SPEC.md §4 — git auto-commit, author attribution, squashing
- SPEC.md §14 — every server mutation validates before writing

## Summary

Implement `POST /api/docs/:id/patch`: locate `old` in the document's body,
verify uniqueness (or `all`), replace, and then hand the resulting body to the
**existing** write path — validation, anchor reconciliation, projection, git
commit with the acting party. The patch is a smarter front door to the same
write, not a second write path.

## Acceptance Criteria

- [ ] A unique match replaces exactly the quoted range; the rest of the body is
      byte-identical afterwards
- [ ] Zero matches → the contract's refusal with count 0; N > 1 without `all` →
      refusal with count N; nothing written in either case
- [ ] `all: true` replaces every occurrence, left-to-right, non-overlapping
- [ ] The write is ordinary downstream: anchors reconciled (§6) — including
      remap/orphan reporting when the patch hits an anchored range — validation
      before writing (§14), one attributed commit (§4), projection and SSE
      invalidation exactly as a `PUT` produces them
- [ ] A patch against a document locked by the other party is refused naming
      the holder, as any edit is (§7)
- [ ] `old` matching across the frontmatter/body boundary is impossible — the
      match runs against the body only
- [ ] A no-op patch (`old` === `new`, or replacement yields the identical body)
      follows the existing "only a real change" behaviour: success, no commit,
      no `updated` bump
- [ ] Concurrency: the match and the write are atomic under the document mutex —
      a body that changed between match and apply cannot produce a misplaced
      patch

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/patch.ts` (+ test) — the locate/replace, then delegate
- `apps/server/src/docs/update.ts` — if its internals need a seam to accept a
  computed body; prefer reusing its guts over duplicating them
- the docs routes module — mount the contract route

### Key Implementation Details

Exact string matching on the raw body — no normalisation, no trimming. The
agent quoted what `corpus doc show` served (SHARED-035's decision), and any
cleverness here is how a patch lands on the wrong text. Count occurrences with
a plain scan; report the count in the refusal so the caller knows whether to
add context (N > 1) or re-read the document (0).

Do the match **inside** the same mutex/critical section the write path already
uses (`mutateDoc` — see the todos routes' usage for the pattern), so the body
cannot move between verification and write.

### Edge Cases

- `old` containing the anchor-quoted text of a thread — the reconciliation
  reports `remapped`/`orphaned` in the response exactly as an equivalent `PUT`
  would; the patch adds nothing special
- A patch whose `new` introduces an unterminated fence — refused by the §14
  validator like any write (SERVER-075's rule holds here too)
- A patch to a document with unreadable frontmatter — same behaviour as `PUT`
  on that document today
- Very large `old` (the whole body quoted) — legal; it degrades to a whole-body
  edit

## Testing Strategy

Vitest against a real temp workspace: unique replace; both refusals with
counts and no write; `all` semantics including the overlapping-match scan;
anchor remap and orphan through a patch; lock refusal; no-op; the atomicity
test (concurrent edit between two patches serialised by the mutex). Assert
`git log` afterwards: one commit per effective patch, correctly attributed.

## E2E Verification Plan

### Verification Steps

1. Start the server on a real workspace; create a document with a known body
   and an anchored thread
2. `curl` a patch replacing a phrase away from the anchor — confirm the body on
   disk, one attributed commit, anchors intact
3. Patch the anchored phrase itself — confirm the anchor remaps (or orphans)
   and the response reports it
4. Patch with an ambiguous `old` — confirm the refusal names the count and the
   file is untouched
5. Patch while the user holds the lock, `--from agent` — confirm the refusal
   names the holder
6. `corpus db rebuild && corpus db doctor` — clean

## E2E Verification Log

_[Agent fills: model run on, commands, observed output.]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-079]` prefix
