# Evaluation: CONTRACT-024

**Date**: 2026-08-02
**Sprint**: sprint-022
**Verdict**: PASS
**Evaluator model**: Opus 5 (1M context)

Rig: workspace `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/eval-p9/ws`, server `8808`
(bin `apps/cli/src/bin/corpus.ts` via tsx), UI served by the server from the freshly built
`apps/ui/dist`. `8765` never bound. Warm model cache used through a scratch copy
(`CORPUS_MODEL_CACHE_DIR`); the shared cache was read once and never written.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                       |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | `issues/contract/024-thread-context-route.md:66-358`, ~290 lines                             |
| Commands are specific and concrete      | PASS   | Named artifacts, pasted schema fragments, drift-check invocation                             |
| Real E2E (not mocked)                   | PASS   | Contract-only issue; states plainly "No server started" and defers wire proof to SERVER-047 — the honest scope. The route was exercised live here (below). |
| Scenarios cover acceptance criteria     | PASS   | Five shape schemas + bounds + status set                                                     |
| Application restarted after changes     | N/A    | No running surface in this issue                                                             |
| Actual model recorded (implemented on:) | PASS   | `implemented on: opus` (Opus 5, 1M context), 2026-08-01                                      |
| Reproduction logged before fix (bugs)   | N/A    | Feature, not a bug                                                                           |

## Criteria Results

| #   | Criterion                                            | Result | Observed                                                                                                             |
| --- | ---------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| 1   | `GET /api/threads/{id}/context` published            | PASS   | `openapi.json` `paths["/api/threads/{id}/context"]`, methods `["get"]`                                                 |
| 2   | Five discriminated pack shapes in the schema         | PASS   | `AnchoredContextPack`, `WholeDocumentContextPack`, `OrphanedAnchorContextPack`, `StandaloneContextPack`, `DeletedParentContextPack` |
| 3   | Declared status set matches reality                  | PASS   | Declared `200/400/401/404`; observed live: 200 ×5 shapes, 404 unknown thread, 400 doc-id and garbage id, 401 no auth   |
| 4   | Bounds expressed in the contract                     | PASS   | `excerpts.maxItems: 10` (`CONTEXT_MAX_EXCERPTS`); every live pack returned exactly ≤ 10                                |
| 5   | Excerpt row = id + headingPath + excerpt, no bodies  | PASS   | `ContextExcerpt` documents exactly that, and excludes the thread and its parent by contract — asserted live (below)    |
| 6   | Generated artifacts drift-free (TEST-1040)           | PASS   | `node --import tsx scripts/check-generated-artifacts.ts` → `✓ API contract is up to date` + `✓ CLI reference is up to date`, exit 0 |

## Evidence

```
$ node --import tsx scripts/check-generated-artifacts.ts
✓ API contract is up to date (packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts).
✓ CLI reference is up to date (docs/cli.md).
exit=0

route present: true    methods: [ 'get' ]    responses: [ '200', '400', '401', '404' ]
context schemas: ["AnchoredContextPack","ContextExcerpt","WholeDocumentContextPack",
                  "OrphanedAnchorContextPack","StandaloneContextPack","DeletedParentContextPack"]
```

Live status probes against the real server on 8808:

```
th_wl7djw23 context -> 200      (anchored)
th_mso6oy65 context -> 200      (whole-document)
th_w26ri26o context -> 200      (standalone)
th_g5xm7da6 context -> 200      (orphaned-anchor)
th_sgtlpn3t context -> 200      (parent-deleted)
GET /api/docs/doc_dnrhd6n6      -> 404   (the parent really is gone)
GET /api/threads/th_sgtlpn3t    -> 200   (the thread really exists)
nonexistent thread context      -> 404
a DOC id on the thread route    -> 400
no Authorization header         -> 401
```

The contract's "never the thread this pack is about, and never its parent" clause, asserted on
three live shapes:

```
th_wl7djw23 | self in excerpts: false | parent in excerpts: false | count: 10 | dupes: false
th_mso6oy65 | self in excerpts: false | parent in excerpts: false | count: 10 | dupes: false
th_g5xm7da6 | self in excerpts: false | parent in excerpts: false | count: 10 | dupes: false
```

## Failures

None.

## Summary

6 of 6 criteria passed. The published contract matches what the running server actually does,
including every declared status code and the excerpt-exclusion rule, and both generated artifacts
regenerate byte-identically.
