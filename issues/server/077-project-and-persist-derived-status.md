# [SERVER-077] The board, queries and the file all agree on a derived status

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-029 (signed), PLUGINS-014
- Blocks: UI-092

## Spec References

- SPEC.md §12 — as amended by SHARED-029, including "the file never disagrees
  with what is shown"
- SPEC.md §9.1 — `documents` projection row carries `status`
- SPEC.md §14 — validation and `db doctor`

## Summary

PLUGINS-014 makes a derived status computable. This issue makes it the answer
everywhere the system reports a status: the projection row, `GET
/api/docs?status=`, every saved view and column built on a status filter, and
the document's own frontmatter on disk.

The last one is the point of the rider's closing sentence. Without it a todo
document's file says `status: open` while the board says `resolved` — so `git
grep`, `corpus doc` output and the UI disagree, and the disagreement is
invisible until someone reads the file.

## Acceptance Criteria

- [ ] `readDocumentFields` (`apps/server/src/projection/project-document.ts:143`)
      stores the derived status for types that declare one, and the stored value
      for every type that does not
- [ ] `GET /api/docs?status=resolved` returns a todo document whose items are
      all checked, and does not return one with an open item
- [ ] `status=archived` still returns an archived todo document regardless of
      its items; unarchiving returns it to whichever of `open`/`resolved` its
      items say
- [ ] Whenever the server writes a todo document — through the core body write
      path (a UI checkbox toggle) **and** through the plugin's item routes (the
      CLI and agent path) — the derived value is written into the file's
      frontmatter in the **same** write and therefore the same commit. Never a
      second commit, never a second `updated` bump.
- [ ] `corpus db rebuild && corpus db doctor` is clean on a workspace holding
      completed, incomplete, empty and archived todo documents
- [ ] `corpus doc check` does not report a document whose stored status differs
      from its derived one as invalid — the write path converges it; the
      validator does not police it
- [ ] The projection is correct after an **out-of-band** edit: `printf >>` a
      `- [x]` line into a todo file, and the SSE invalidation reprojects with the
      new derived status

## Technical Design

### Files to Create/Modify

- `apps/server/src/projection/project-document.ts` — `readDocumentFields`
  currently does `root.status ?? (status.success ? status.data : "open")`. The
  `root.status` override is the existing precedent for a status the file does not
  own; derived status is a second such source and should read as one rather than
  as a special case bolted beside it.
- `apps/server/src/plugins/discover.ts` / `context.ts` — expose the declaration
  to the projection
- the core document write path — where the derived value is written back
- `apps/server/src/projection/doctor.ts` — confirm doctor's file-vs-row check
  compares against the derived value, or it will report drift on every todo
  document

### Key Implementation Details

**Write-back and reprojection must not fight.** The write path converges the
frontmatter; the projection derives from the body. If both run they must reach
the same answer, and the write must not trigger a second write. Derive once per
write, use the value for both.

**The out-of-band path has no write to hang the convergence on.** A file edited
outside the server reprojects with the derived status, but its frontmatter stays
stale until the next server write. That is acceptable and matches how the rest of
the system treats out-of-band edits (files are the source of truth; the server
converges when it next writes) — but say so in the code, because it is exactly
the case a later reader will mistake for a bug.

### Edge Cases

- A todo document written while the plugin is **absent** (the §15 M6 subtractive
  check) — no declaration, so no derivation and no write-back. The stored value
  stands and nothing errors.
- An archived todo document that gets an item checked — stays `archived`; the
  write-back must not overwrite `archived` with `resolved`.
- A document whose items are unreadable — no derivation, no write-back.
- A type declaring derived status whose derivation throws — contained, logged,
  falls back to the stored value. A plugin must not be able to break projection.

## Testing Strategy

Vitest against a real temp workspace: project a todo document in each state and
assert the row's status; write through both paths and assert the file's
frontmatter converged in one commit (`git log --oneline` length unchanged by the
convergence); rebuild + doctor clean; an out-of-band append reprojects.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. `corpus server start` on a real workspace
2. Create a todo document with one item; check it in the UI
3. `curl "…/api/docs?status=resolved"` — expect it absent
4. `cat` the file — expect `status: open`
5. Both confirm the bug

### Verification Steps

1. Restart the server
2. Check the last item in the **UI**; confirm `GET /api/docs?status=resolved`
   returns the document, the file's frontmatter reads `resolved`, and `git log`
   shows **one** new commit
3. Uncheck it; confirm all three revert
4. Repeat via `corpus todos check` and confirm identical results through the CLI
   path
5. Archive the completed document; confirm it reads `archived` and that checking
   or unchecking items does not disturb that
6. `printf -- '- [x] extra\n' >> <file>` out of band; confirm SSE invalidation
   and that the projection reports the new derived status
7. `corpus db rebuild && corpus db doctor` — clean

## E2E Verification Log

_[Agent fills: model run on, commands, observed output.]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Pre-fix reproduction logged
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (cross-domain, touches the write path and projection)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-077]` prefix
