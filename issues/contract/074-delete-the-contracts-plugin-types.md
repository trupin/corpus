# [CONTRACT-074] Delete the contract's plugin types and the /api/x route note

## Domain
contract

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

**Model: Opus 5 (1M context).** Finished from a partial state: `src/plugin/` and
the `./plugin` export condition were already gone. This pass removed the
**published descriptions**, which are interface documentation rather than
comments — they ship in `openapi.json` and in the generated client's JSDoc.

### The two kinds of rewrite

**Kept the rule, restated the reason** — the rule outlived plugins:

- **`QueueEvent.type`, `InProgressEvent.type`, `Job.type`** stay open strings.
  New reason, matching what the shipped `orchestrate` skill already tells the
  agent: *the set on the wire is not the set any one build knows* — a queue
  carried over from an older workspace, an event written into `pending/` by
  hand, or a server newer than the client. The published prose adds the skill's
  own rule from the other side: an unrecognised type is failed with the type
  quoted, and no handler is ever guessed from the name.
- **`QueueEvent.payload`** stays open for the same reason, spelled as the
  consequence: a union keyed on `type` would close the set `type` deliberately
  leaves open.
- **`DocRow.attention`** entries stay bare codes. New reason, matched verbatim
  to what `packages/kit/src/row/reasons.ts` adopted for the same rule: *the
  server's vocabulary may grow ahead of this build*, so a client must render a
  code it has never seen.
- **`DocRow.awaitingAgent`** keeps the match-by-value rule; the example is now
  an event type this build has never heard of rather than a plugin's.
- **`DocType` / `DocsQuery.type`** stay open, now justified by SPEC §12's M6
  directly: a workspace may hold a document whose `type:` this build has never
  heard of, from its own history or hand-written, and it still opens, renders
  and searches.

**Lost the case entirely** — the reason was plugins and nothing else:

- **`column`** loses `"<plugin>/<type>"`, `todos/board` and the plugin-missing
  card. The field and its regex are unchanged (no shape change): it is a key
  the server stores, validates and round-trips because workspaces hold it on
  disk. The description now says so, and says the thing a reader must not
  assume: **the core defines no column renderer**, so a value selects nothing.
- **`extra`** loses "plugins add fields under their own keys" and the todo
  `items` example. It is now what SPEC §5 and §9.1 say: any key the core does
  not define, stored verbatim, never interpreted, meaning belonging to whoever
  wrote the key.
- The **top-level API description** no longer names `/api/x/<plugin>/...`. Its
  dangling "likewise" (which referred to that exemption) is gone too, leaving
  `/api/openapi.json` as the one adjudicated exemption.

**The enum stayed open.** `DocTypeSchema` is still `z.string().min(1)` and the
generated document carries no `enum` for `type` on `DocFrontmatter`, `DocRow`,
`CreateDocRequest` or the `GET /api/docs` query parameter — nor for
`QueueEvent.type`. Only descriptions changed.

### Checks

- `npm run generate -w packages/contract` → exit 0. Re-run over its own output
  produced **byte-identical files** (sha256 stable), so generation is idempotent.
- `scripts/check-generated-artifacts.ts`: the API-contract group passes its
  regeneration-hash half and fails only `diff --stat HEAD`, which is the
  uncommitted working tree — the orchestrator's commit clears it. The
  `docs/cli.md` half is stale and is another agent's (INFRA/CLI).
- `tsc --noEmit -p packages/contract` clean. `tsc -p tsconfig.build.json` clean.
- `eslint packages/contract` clean, **no rule disabled**. `prettier --check`
  clean.
- `vitest run packages/contract`: **2634 passed, 0 failed.**
- `npm run spec:check`: 6234 citations across 1554 files, all resolving.

### The grep the brief asked for

```
grep -c -iE 'plugin|todo' packages/contract/openapi.json                  → 0
grep -c -iE 'plugin|todo' packages/contract/src/client/schema.generated.ts → 0
grep -rn -iE 'plugin|todo' packages/contract/src package.json             → no matches
```

Before this pass: 22 `plugin` and 8 `todo` lines in `openapi.json`.

### The typed client, against the shape the user's workspace actually holds

`contractRoutes.listDocs` mounted on an `OpenAPIHono` stub, called through
`createCorpusClient({ fetch: app.request })`, serving a row with `type: "todo"`:

```
typed client GET /api/docs?type=todo → todo | Mortgage errands
extra passed through verbatim → {"items":[{"text":"Call the broker","done":false}]}
DocsQuery type=todo → todo
CreateDocRequest type=todo → todo
DocFrontmatter type=todo → todo
QueueEvent of an unknown type → ledger.reconciled
```

A `type: todo` document round-trips through the wire types, through create, and
through the frontmatter read shape, and its `items` survive in `extra`
untouched. The scratch script was run from the repo root and deleted in the same
command.

### Two things left for the orchestrator, neither mine to change

1. **`column` is now a key nothing reads — which is SHARED-066's whole subject,
   and that issue depends on this one.** Deleting the field is a shape change
   spanning four workspaces, so I did not touch the shape: the regex, the
   nullability and the four route sites are byte-identical. The description is
   the honest interim, and it is written so SHARED-066 can delete it without
   contradicting anything published in between.
   `issues/PLAN.md` line 1271 still reads `todo` for CONTRACT-074 — I left
   shared tracker state to the orchestrator, so `npm run issues:check` reports
   the two halves out of step until that cell is flipped.
2. **SPEC.md still carries two todo references I did not touch**: §5's status
   ladder says "A type that **derives** its status (§12) is the one exception —
   §12's `todo` reads its items", and §9.1's `documents(...)` row still lists
   `column_ref`. §12 is now Milestones, so the first citation resolves to the
   wrong section and `spec:check` cannot see it.
