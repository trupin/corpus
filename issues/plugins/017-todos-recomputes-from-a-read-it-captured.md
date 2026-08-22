# [PLUGINS-017] The todos plugin writes from a captured read, and still reaches for a lock

## Domain

plugins

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-049, SERVER-098
- Related: SHARED-041

## Spec References

- SPEC.md **§7** "A key, not a lock" — what needs a key
- SPEC.md **§10** — the plugin surface

## Summary

Found by SERVER-098 while verifying its own work, and filed because nothing in
Phase 30's chain covered `plugins/`.

`plugins/todos/server/routes.test.ts` has **28 failures**, all `400` where `201`
is expected. `mutateItems` and `migrateOne` return `{ body, … }` from
`mutateDoc`, and `UpdateDocRequestSchema`'s refinement now refuses a body that
carries no key.

**This is the mechanism working, not a regression to route around.** A plugin
that rewrites a whole body from a document it captured earlier is exactly the
blind overwrite §7 exists to stop. That the plugin happens to be correct today —
`mutateDoc` hands the callback the document read *inside* the lane, so it is by
construction the version being overwritten — is a property nothing was checking.
Presenting the key makes it checked.

## The second half, found by UI-107 after this issue was filed

The plugin's **UI** still imports kit exports that no longer exist.
`plugins/todos/ui/TodoListItem.tsx` uses `useDocLock` and `LockChip` (lines 3,
15, 64, 119); `ui/testing.tsx` and `TodoListItem.test.tsx` seed `/api/locks`.

This is worse than the server half, because it **fails `npm run build`** — rollup
cannot resolve the import — and takes **35 plugin e2e specs** with it. Until this
lands, the repo-wide gate cannot go green.

Kit's public surface shrank by eight exports and gained **`staleKeyDoc`**, which
is the cross-domain event this plugin should consume instead. The lock chip has
no replacement and should not get one: §10 says the board is never read-only, and
a chip announcing that someone else holds a document is the read-only banner in
miniature.

## Acceptance Criteria

- [x] `mutateItems` and `migrateOne` present the key of the document `mutateDoc`
      handed them. SERVER-098's reading is that this is two lines in
      `plugins/todos/server/routes.ts`; verify that before trusting it —
      **confirmed**: exactly two lines, `routes.ts:158` and `routes.ts:263`
- [x] The test fixture's `docFixture` carries `key` and `userEditing`
- [x] **Do not** work around the refusal by making the key optional on this path
      or by re-reading immediately before writing. Either would restore the blind
      overwrite with extra steps — neither was done; the fake context now
      *enforces* the check, so the workaround is not merely avoided but refused
- [x] Check whether any other plugin surface writes a whole body from a captured
      read. `plugins/` is small; the point is to answer the question rather than
      fix the one call site that failed a test — swept, see log
- [x] `useDocLock` and `LockChip` are gone from `plugins/todos/ui/`, and nothing
      seeds `/api/locks` in its fixtures. **Do not reintroduce a chip** that says
      another writer holds the document — §10 is explicit that the board is never
      read-only, and that chip is the banner in miniature — no replacement chip;
      the row's test now asserts the *inverse*
- [x] `npm run build` passes repo-wide, and the 35 plugin e2e specs run again
- [x] The kit's plugin-facing types expose whatever a plugin needs to do this
      without reaching around the surface (§10) — nothing had to change: `Doc.key`
      rides `@corpus/contract/plugin`'s `PluginDocMutation`, and `@corpus/kit`
      already exports `staleKeyDoc` and an `UpdateDocChanges` that carries `key`

## Technical Design

### Files to Create/Modify

- `plugins/todos/server/routes.ts`, `plugins/todos/server/routes.test.ts`
- `plugins/todos/ui/TodoListItem.tsx`, `plugins/todos/ui/testing.tsx`,
  `plugins/todos/ui/TodoListItem.test.tsx`

### Notes

- `apps/server` is not on this path — SERVER-098 confirmed it. This is purely
  CONTRACT-049's consequence reaching the plugin surface.

## Testing Strategy

The 28 failures are the test: they should pass by the plugin presenting a key,
not by the schema accepting its absence. Add one case that a *stale* key from a
captured read is refused, so the guarantee is asserted rather than incidental.

## E2E Verification Plan

Real server on a free port (**never 8765 or 5173**), scratch workspace under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`. Check a todo item through the
real plugin route.

## E2E Verification Log

Implemented by **plugins-dev on opus** (claude-opus-5[1m]), 2026-08-11.

### Environment

Scratch workspace `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/plugins017`,
`corpus init --port 8791`, server started as a real daemon from source
(`tsx apps/cli/src/bin/corpus.ts server start`). Never 8765 (the user's live
server, verified still listening and untouched at the end) and never 5173; the
browser leg used Vite on 5273. All processes stopped and both scratch ports
verified free before finishing.

### Reproduction, against the real app (bug half)

The plugin's `dist` was rebuilt with `key: doc.key` **removed** from
`mutateItems` (the pre-fix state), the daemon restarted, and the real route
called:

```
POST /api/x/todos/doc_5pl5sd3m/items  {"text":"Reproduce"}
→ status=400  {"code":"bad_request","message":"plugin doc mutate failed validation"}
corpus todos add "Week of Aug 11" "Book dentist" --from agent
→ corpus: plugin doc mutate failed validation
corpus todos check "Week of Aug 11" 1 --from agent
→ corpus: plugin doc mutate failed validation
```

So the 28 unit failures are not a harness artefact: **every item write in the
shipped plugin was broken against a real server** until this landed.

### After the fix, same server

```
POST /api/x/todos/doc_5pl5sd3m/items  {"text":"Reproduce"}
→ status=201  {"docId":"doc_5pl5sd3m","index":4,"item":{"text":"Reproduce","done":false}}
corpus todos check "Week of Aug 11" 1 --from agent
→ checked item 1 of Week of Aug 11 [doc_5pl5sd3m] — First thing to do
corpus todos list
→ Week of Aug 11 [doc_5pl5sd3m] — 4 open · 1 done
```

The file on disk holds exactly the five task lines with `- [x] First thing to
do` flipped and the surrounding prose byte-identical.

A legacy document (`items:` in frontmatter) written straight to disk exercised
`migrateOne`'s keyed write:

```
corpus todos migrate --dry-run → would migrate Legacy List [doc_legacy01] — 2 items to move into the body
corpus todos migrate           → migrated Legacy List [doc_legacy01] — 2 items moved into the body
```

and the file came back with the `items:` key gone and two task lines in the body.

### The key is live, not decorative

Against the same server: read the document (`key = d34e805f…`), let a **plugin**
write land (`POST …/items → 201`), then present the captured key on a body
write:

```
PUT /api/docs/doc_5pl5sd3m  {"body":"overwritten","key":"d34e805f…"}
→ 409 stale_key — "the key presented … names a version this document no longer is …"
   carrying the document as it now stands, fresh key cf95aa2a…
```

Two things at once: the plugin's own write invalidates outstanding keys like any
other write, and a captured key is refused. The plugin's patch is accepted only
because `mutateDoc` hands the callback the version read inside the lane — which
is now checked rather than assumed. The reverse interleaving (another writer
landing *between* the callback and the write) cannot be forced from outside the
process, so it is asserted in `routes.test.ts` under
`describe("§7's key on every body write")`, where the fake context refuses a
stale key exactly as `assertDocumentKey` does.

### UI half, in a real browser

Vite on 5273 against the 8791 server, driven with Playwright's chromium:

```
{ rows: 2,
  preview: ["First thing to do","Something with a deadline","Renew passport",
            "Old item one","Old item two"],
  lockChips: 0,
  due: ["1 due"],
  errors: [] }
```

Both todo rows render through `TodoListItem` with the plugin's item preview and
the due badge, **zero** `.row-lock` chips, and no console or page errors.

### The broader sweep — does anything else write a body from a captured read?

Every write in `plugins/` was enumerated, not just the failing one:

| Surface | Writes | Verdict |
| --- | --- | --- |
| `todos/server/routes.ts` `mutateItems` | whole body, from the doc `mutateDoc` handed it | **fixed** — presents `doc.key` |
| `todos/server/routes.ts` `migrateOne` | whole body + clears `extra.items` | **fixed** — presents `doc.key` |
| `todos/ui/itemActions.ts` | `PUT /api/x/todos/{doc}/items/{i}` with `expectedText` | fine — a named delta, never a body |
| `todos/ui/TodoItemComposer.tsx` | `POST /api/threads` | fine — creates a thread |
| `todos/ui/*` (rows, column, panels, menus) | kit `useRowActions` / `useCreateThread` only | fine — delta writes |
| `todos/cli/client.ts` | thin HTTP over the item routes above | fine |
| `todos/skills/todos/SKILL.md` | tells the agent to use `corpus todos add|check`, explicitly *not* `corpus doc edit` | fine |
| `_fixture/server/routes.ts` | `createDoc` only | fine — a create carries no key |

So: **two call sites, both in `server/routes.ts`, and no others.** The plugin's
UI and CLI never had the problem, because PLUGINS-004 already pushed them onto
item-level routes that name their own delta — the same reasoning §7 uses for why
a delta write needs no key.

### Spec drift cleaned up on the way

The plugin still *described* a world with locks in four doc comments (a `423
locked` passthrough in `server/errors.ts`, "an edit lock" and "a document
someone else is holding" in `routes.ts`, "no lock taken"). All now name §7's
stale-key refusal. `grep -ri lock plugins/` returns only sentences saying there
is no lock.

### Commands run

- `npm run build` — **passes repo-wide** (it did not before this change; rollup
  could not resolve `LockChip`/`useDocLock`)
- `npx vitest run plugins` with `VITEST_MAX_THREADS=4` — **473 passed / 24 files**
  (`routes.test.ts` 52 → 59 tests; the 28 failures are gone)
- `CORPUS_UI_PORT=5273 playwright test todos.spec.ts todos-menu.spec.ts
  todos-legacy.spec.ts plugin-late-arrival.spec.ts` — **35 passed**
- `eslint plugins` — clean; `prettier --check plugins/**` — clean
- `tsc --noEmit -p plugins/todos/tsconfig.json` — clean

### One failure that is not mine

`npm run typecheck` is red on a **single** pre-existing error in another
domain's file, untouched by this issue:

```
scripts/workspace-template.test.ts(623,9): error TS2345:
  Argument of type 'never[] | RegExpMatchArray' is not assignable to
  parameter of type 'ConcatArray<never>'
```

`(body.match(…) ?? []).concat(body.match(…) ?? [])` — the `[]` on the left
infers `never[]`. Spreading instead of `.concat` fixes it. Escalated rather than
edited: `scripts/` is not this domain's.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
