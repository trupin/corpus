# [CONTRACT-016] Rider: `SkillRollbackResult.commit` becomes nullable

## Domain

contract

## Status

done

## Priority

P1

## Model

opus — a one-field rider pinned by sprint-013 Adjudication 8.

## Dependencies

- Depends on: CONTRACT-008
- Blocks: SERVER-019

## Spec References

- SPEC.md §14 — "commit failed, file write stands, warn" path
- issues/sprints/sprint-013.md — Open Conflict 4 + Adjudication 8

## Summary

Filed from sprint-013 Open Conflict 4 (2026-07-28). CONTRACT-008 shipped
`SkillRollbackResult.commit` as required-non-null, but §14's rollback path allows the file write to
stand when the auto-commit fails (rejected hook), with a warning — that outcome has no legal value
on the wire. Make `commit: string | null` (`null` ⇔ commit failed, write stands; the rejected-hook
warning rides `warnings`), regenerate artifacts idempotently, and keep every other CONTRACT-008
invariant intact. Wire-surface only; SERVER-019 consumes it.

## Acceptance Criteria

- [x] `SkillRollbackResult.commit` is `string | null` with the semantics documented on the schema;
      artifacts regenerated; drift check green twice; client round-trips both values.
- [x] No other route or schema changes; no consumer files touched.

## E2E Verification Log

Implemented on: **opus** (contract-dev, worktree `agent-a8142f0fd7bc5db5a`, based on phase HEAD
`ffdfa1b`), 2026-07-28.

### The change

`SkillRollbackResultSchema.commit` (`packages/contract/src/schemas/skill.ts`) gains `.nullable()`
between the regex and the description, so it is `string | null` — required, never optional. The
description now publishes the semantics: `null` ⇔ the file was restored but not committed (the
auto-commit failed or was skipped), the write stands regardless (§14), and the reason is in
`warnings` (`commit_failed` carries the workspace hook's own output, `commit_skipped` the git-less
workspace). A code comment records why the tempting alternative — echoing the pre-existing HEAD —
was rejected: it puts a commit that is not this restoration into the field the audit trail reads.

Two prose lines in `routes/skills.ts` that asserted `commit` is always a sha were reconciled in the
same change (the route description's hook-rejection sentence, and the 200 response description);
leaving them would have shipped a document that contradicts its own schema. No route shape changed:
same path, params, header, body, status codes. Grep confirms `SkillRollbackResult` has **zero**
consumers outside `packages/contract` today, so no consumer file was touched; the full repo
`npm run typecheck` is green.

### Artifact regeneration + drift check

```
$ npm run generate -w packages/contract        → exit 0
generated ./openapi.json
generated ./src/client/schema.generated.ts

$ node --import tsx scripts/check-generated-artifacts.ts        # run 1 → exit 1
✗ API contract is stale: packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts
 packages/contract/openapi.json                   | 11 +++++++----
 packages/contract/src/client/schema.generated.ts |  8 ++++----
✓ CLI reference is up to date (docs/cli.md).
$ node --import tsx scripts/check-generated-artifacts.ts        # run 2 → exit 1, byte-identical output
```

The failing arm is `diffAgainstHead`, not `hashFiles`: the check regenerates, sees the regeneration
was a **no-op** (hash arm passes), then compares against `HEAD` — and a domain agent never commits,
so the working tree necessarily differs. The summary it prints is exactly the two intended artifacts
and nothing else. The check goes green the moment the orchestrator commits; proven by running the
real `checkGeneratedArtifacts` with real regeneration and real hashing and only `diffAgainstHead`
stubbed clean (`/tmp/corpus-s013-contract016-drift-postcommit.ts`), twice:

```
✓ API contract is up to date (packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts).
✓ CLI reference is up to date (docs/cli.md).
regeneration-is-a-noop: true          # both runs, exit 0
```

Idempotence, independently: sha256 of both artifacts before and after two further regenerations —
`diff` reports identical (`openapi.json` = `39ae2954924dae36…`, `schema.generated.ts` =
`99e289e7488300a4…`). `git diff --stat` over the whole worktree lists six files and no others; the
artifact diff is the `commit` property (`"type": ["string","null"]`, pattern retained), its
description, and the two route prose lines.

Generated client type, verbatim from `src/client/schema.generated.ts`:

```ts
commit: string | null;
```

### Round-trip against a live stub (port 9117)

`/tmp/corpus-s013-contract016-roundtrip/roundtrip.ts` mounts the **shipped** `rollbackSkill` route
definition on a real `OpenAPIHono` served by `@hono/node-server` on `127.0.0.1:9117`, builds each
response through `SkillRollbackResultSchema.parse` (so the wire value is contract-validated), and
drives it with the **generated** client (`createCorpusClient` from `@corpus/contract/client`):

```
$ node --import tsx /tmp/corpus-s013-contract016-roundtrip/roundtrip.ts   → exit 0
PASS string commit round-trips: {"status":200,"commit":"9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456"}
PASS null commit round-trips: {"status":200,"commit":null,"warnings":[{"code":"commit_failed","detail":"pre-commit hook exited 1: skills are frozen"}]}
PASS commit is present-and-null, never absent: ["name","docId","commit","path","warnings"]
PASS typed as string | null: "9f1c2ab3d4e5f60718293a4b5c6d7e8f90123456"
ROUND-TRIP OK
```

Type-level proof in the same file, checked with `tsc --noEmit` under the repo's strict flags
(exit 0): `const widened: string | null = data.commit` compiles, and
`// @ts-expect-error … const narrowed: string = data.commit` is **used** — an unused
`@ts-expect-error` is itself an error, so this only passes because the generated type is no longer
`string`.

### The new tests are load-bearing

`.nullable()` was temporarily removed and the two touched suites re-run:

```
× SkillRollbackResult round-trips > accepts a null commit, meaning the restoration is uncommitted
× SkillRollbackResult round-trips > accepts a null commit for the git-less workspace too
× the validation and skill-rollback surface > lets `commit` be null, since §14 keeps the write when the commit fails
Tests  3 failed | 192 passed (195)        # exit 1
```

Restored; artifacts re-verified byte-identical afterwards.

### Checks

| Command                                                                 | Result                        |
| ----------------------------------------------------------------------- | ----------------------------- |
| `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run packages/contract`  | exit 0 — 38 files, 1172 tests |
| `npm run lint`                                                           | exit 0                        |
| `prettier --check 'packages/contract/src/**/*.ts' openapi.json`          | exit 0                        |
| `npm run typecheck` (all workspaces)                                     | exit 0                        |
| `npm run build`                                                          | exit 0                        |

Exit codes read from `$?` immediately after each command redirected to a file — never through a
pipeline. Scratch under `/tmp/corpus-s013-contract016-*`; the stub closed its own listener, ports
9117 and 8765 verified free at exit; no long-lived process left running.

### Note for SERVER-019

`commit: null` plus a `commit_failed`/`commit_skipped` warning is now the contract's way to say
"restored, uncommitted". The regex still applies to non-null values, so a handler must send `null`
rather than `""` or a foreign sha when `CommitOutcome` carries none.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
