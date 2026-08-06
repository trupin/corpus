# [SERVER-064] One unreadable document stops the server from booting — and the docblock says it must not

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
- Blocks: —
- Sibling of: SERVER-063 (the same hold-out in the queue's mirror rebuild)

## Spec References

- SPEC.md §2.2 — the server's lifecycle; §5 — the document model

## Summary

Found by SERVER-063 while fixing the same class of fault one directory over.
**This one is wider**: it is any document in the corpus, not a queue file.

`apps/server/src/projection/project-document.ts:493` rethrows any non-`ENOENT`
read error. That runs under `populateFromFiles`, **whose own docblock says**:

> never fatal: one broken document must not take the server down

The code does exactly what the comment forbids. Reproduced on a real workspace:
`chmod 000` on one ordinary `.md` gives

```
EACCES … at projectDocument (project-document.ts:493)
        … at populateFromFiles (populate.ts:82)
        … at openProjection (db.ts:258)
```

and `corpus server status` reports `not running`.

So one unreadable file in `data/` costs the whole workspace its server, with the
same user-visible shape SERVER-063 fixed for the queue: `corpus server start`
prints *"the server exited during startup"* and there is no server left to ask
why. The blast radius is larger because a corpus holds far more documents than
queue events, and because documents are the thing the user actually owns.

## Acceptance Criteria

- [ ] A server whose corpus holds an unreadable document **boots** and serves
- [ ] `populateFromFiles`'s docblock becomes true, rather than the code being
      changed to match a weaker claim
- [ ] The skipped document is excluded from the projection rather than recorded
      as something it is not, and the skip is logged at a level a `silent` server
      still writes (`error`), naming the path and the reason — the operator has
      to find the file by hand
- [ ] Nothing is moved, quarantined or written on this path: boot is a read
- [ ] `corpus db doctor` surfaces the resulting drift as an actionable finding,
      the way it already does for SERVER-063's queue case
      (`count_mismatch: … file(s) but the projection has … row(s)`)
- [ ] Reproduced first, with the boot failure observed before the fix

## Technical Design

### Files to Create/Modify

- `apps/server/src/projection/project-document.ts` (`projectDocument`) and
  `apps/server/src/projection/populate.ts` (`populateFromFiles`)

### Notes

- **Follow SERVER-063's shape**, which followed SERVER-061's: the *store* stays
  honest and keeps throwing; the *reader* decides the policy and skips. That
  keeps one place to change if the policy ever changes.
- Distinguish the two faults as the queue now does: **malformed content** is
  expected residue (`debug`), an **unreadable file** is a workspace fault only an
  operator can fix (`error`).
- **The test needs a different trick.** SERVER-063 used a directory named
  `evt_*.json`, which `readdir` lists and every read of fails with `EISDIR`. That
  does **not** work here — the document enumerator lists files only, so a
  directory named `*.md` is never offered to the reader. `chmod` is unreliable in
  CI because root bypasses it, which would let the test pass without proving
  anything. Find a trick that holds for every user and say what it is.

### Related, out of scope

`availablePending` (`queue/service.ts:567`) and `claimAll`'s post-move read
(`:306`) still rethrow, so an unreadable file in `pending/` fails `idle` and
`claim-all`. Those are **request** paths rather than boot — the same class, a
smaller blast radius, and they deserve their own issue rather than being
smuggled into this one.

## Testing Strategy

A workspace containing one unreadable document and several readable ones: the
server constructs, the projection holds only the readable documents, the skip is
logged at `error` with path and reason, and nothing is moved. Plus an E2E boot
against a real workspace, before and after.

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
