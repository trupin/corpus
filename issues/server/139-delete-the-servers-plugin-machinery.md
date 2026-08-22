# [SERVER-139] Delete the server's plugin discovery, registry and derived-field seam

## Domain
server

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SHARED-067 (signed and applied)

## Spec References
- SPEC.md — §10, §12 and §13 are deleted; the plugin concept is gone from §1, §3, §4, §5, §7, §9 and §12

## Summary

Part of Phase 41. The plugin surface and the todos plugin are removed entirely,
on the user's instruction: *"I want it fully gone, no trace of it in the codebase
or the specs."* `todo` is not a document type.

The full inventory for this area is in the orchestrator's brief to the
implementing agent. Two rules bind every part of this phase:

1. **A document carrying an unrecognised `type:` must still open, render with
   working checkboxes, search, and pass `doc check`.** That is SPEC §12's M6, and
   it is what protects the user's existing `type: todo` documents.
2. **Where a rule existed only because a plugin might, delete it. Where it
   survives its cause, keep it and restate the reason.** A docblock explaining a
   constraint by a plugin that no longer exists is worse than no docblock.

## Acceptance Criteria
- [x] No reference to plugins or todos remains in this area
- [x] Rules that outlive their plugin justification are kept and restated
- [x] Nothing that only existed for plugins is left behind as a stub

## E2E Verification Log

**Model: Opus 5 (1M context).**

`apps/server/src/plugins/` is gone (10 files). The derived-field seam is gone
from `db.ts`, `attach.ts`, `rebuild.ts`, `project-document.ts`, `routes.ts`,
`watcher.ts`, `reconcile-out-of-band.ts`, `docs/write.ts`, `docs/update.ts` and
`docs/write-fixture.ts`. Boot order is now: parse args → load config → open the
projection (which runs the scan) → `createServer` → attach projection → attach
watcher → semantic. Discovery no longer precedes anything, and nothing else
needed the ordering the deleted lifecycle test pinned.

**Checks.** `tsc --noEmit` clean. `eslint apps/server` clean, no rule disabled.
`prettier --check` clean. `vitest run apps/server`: **190 files, 4302 tests
passed**.

**The guarantee that protects the user's data, on a real server.** A real
workspace at `scratchpad/ws`, `corpus init`, server started from source on port
**8799** (the user's 8765 was never touched, and 8799 was confirmed free
afterwards). A hand-written document was placed under `data/docs/inbox/`:

```
id: doc_todolegacy1
type: todo
status: open
due: 2026-09-01
items:
  - text: Call the broker about the escrow shortfall
    done: false
```

1. **It projects.** `GET /api/docs?type=todo` returned the row with
   `type: "todo"`, `status: "open"`, `due: "2026-09-01"`, and `extra.items`
   carrying both YAML items verbatim.
2. **It serves.** `GET /api/docs/doc_todolegacy1` returned the same frontmatter,
   the extra keys included.
3. **It searches.** `GET /api/search?q=escrow shortfall` ranked it first, and
   `corpus search "escrow shortfall"` did too.
4. **It passes `doc check`.** `corpus doc check` → *checked 10 documents — no
   findings*. `corpus doc check doc_todolegacy1` → *checked 1 document — no
   findings*.
5. **It saves.** A `PUT` checking a box wrote the body to disk and produced
   `543143f doc edit: Mortgage errands (doc_todolegacy1) by user`. The
   frontmatter's `status` and `due` were left exactly as the file stated —
   nothing converged, nothing rewrote.
6. **`corpus db doctor`** → *projection is clean — 10 documents from 10 files*.
   `POST /api/db/rebuild` rebuilt 10 documents and the row came back identical.
7. **The route space is gone.** `GET /api/x/todos/items` → `404`.

**The accepted loss, observed.** A `PUT` naming `status: resolved` and
`due: 2026-10-01` on that document now answers `200` and both values land, with
no relation to the items. Before this issue that was a `400`. This is the
deletion SHARED-067 records the user accepting, not a regression.
