# Evaluation: CONTRACT-005

**Date**: 2026-07-27
**Sprint**: sprint-005 (TEST-100…TEST-116, plus TEST-124 on the wire)
**Verdict**: PASS

Evaluated against the final merged state of `phase-2-server-cli` (HEAD `879a443`), including the
post-sprint addendum that made `DocFrontmatter` timestamps nullable. Where sprint prose and the
issue's "Sprint-005 Adjudications" section conflict, the adjudication governs.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                                                        |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Two blocks: the main log and a signed addendum (`DocFrontmatter` timestamps).                                                                                                                |
| Commands are specific and concrete      | PASS   | Exact `node -e` inspections of `openapi.json`, `npx tsc -p` invocations with recorded exit codes, `shasum -a 256` artifact hashes, verbatim TS2345 compiler text.                            |
| Real E2E (not mocked)                   | PASS   | CONTRACT-005's declared "real application" is the generated artifacts + real `tsc` (sprint §Verification Environment). Both were exercised. The addendum additionally used a real server.     |
| Scenarios cover acceptance criteria     | PASS   | Every AC has evidence; the one sprint-authorized deferral (`DEFERRED → SERVER-006`, no turn-append call site) is recorded with its authorized substitute.                                     |
| Application restarted after changes     | PASS   | Contract package rebuilt before probing; probes ran against `dist/`, and the addendum restarted a real server.                                                                                |
| Actual model recorded (implemented on:) | PASS   | "implemented on: opus" stated in both the main log and the addendum.                                                                                                                          |
| Reproduction logged before fix (bugs)   | PASS   | Applies to the addendum, which is a defect fix: the pre-fix divergence (list `null` vs get-one epoch sentinel) is stated as the defect before the change, and TEST-111's pre-fix bare call was reconstructed and shown compiling (`BEFORE-STATE EXIT=0`) before the fix closed it. |

**Honesty spot-check.** Three claims I re-derived independently rather than accepting: the
nine-shape vocabulary, the byte-identical regeneration, and the "bare call no longer compiles"
before/after. All three reproduced. Nothing in this log was found to be overstated.

## Criteria Results

| #        | Criterion                                                        | Result | Notes                                                                                                                                                                                            |
| -------- | ---------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-100 | Published vocabulary is exactly the emitted vocabulary            | PASS   | `QUERY_KEY_VOCABULARY` has **9** entries: `["docs"]`, `["docs","<docId\|threadId>"]`, `["tree"]`, `["threads","<threadId>"]`, `["queue"]`, `["jobs"]`, `["jobs","<eventId>"]`, `["locks"]`, `["locks","<docId>"]`. No more, no fewer. |
| TEST-101 | Closed set pinned by a test that fails when it grows              | PASS   | `packages/contract/src/query-keys.test.ts` → "is exactly the nine shapes the server emits" and "is a closed set — the record and the pinned name list agree", both green in my own suite run.     |
| TEST-102 | Every published key is a valid `QueryKey`                         | PASS   | All 5 constants and all 4 helpers (`docKey`/`threadKey`/`jobKey`/`lockKey`) return non-empty arrays of `string`; none returns a bare string. Verified at runtime against `dist/query-keys.js`.     |
| TEST-103 | Each key documents its emitter and its consumer                   | PASS   | Every one of the 9 entries carries a non-empty `emittedBy` **and** `refetchedBy`, plus a `parameterised` flag. The same text renders into `openapi.json`'s `GET /events` description.             |
| TEST-104 | Importable without pulling the validation layer                   | PASS   | Scratch probe importing only the vocabulary from `@corpus/contract/client`: `tsc --strict --module nodenext` **EXIT=0**. `dist/query-keys.js` has **0** imports/requires and **0** occurrences of "zod". |
| TEST-105 | Every row carries a staleness tier                                | PASS   | `DocRow.stale` is `["string","null"]`, enum `aging \| stale \| very-stale \| null`; the description states `null` is fresh and that `evergreen: true` and unknown age are both null. Documented, not silent. |
| TEST-106 | Thread affordances present on thread rows, `null` on others       | PASS   | `parent, agent, anchorQuote, turnCount, lastAuthor, lastTurn, unread, awaitingAgent` all present; all 23 `DocRow` properties are in `required` — nullable, not optional, as adjudicated.          |
| TEST-107 | Every new field populatable from the shipped projection           | PASS   | Confirmed behaviorally under SERVER-015: each field returned real data traceable to a projection column. Nothing invented, nothing flagged as unsourced.                                          |
| TEST-108 | Nullable-timestamp decision made and written down                 | PASS   | Decision is "nullable, sentinel rejected", recorded in the schema description. `DocRow.created` and `DocFrontmatter.created` are both `["string","null"]` and both still **required**.            |
| TEST-109 | Turn-append body declares `required: true`, both media kept       | PASS   | `openapi.json` → `requestBody.required = true`, content = `['application/json','multipart/form-data']`.                                                                                            |
| TEST-110 | Both media forms validate, dispatched by content-type             | PASS   | Covered by `routes/turn-append.test.ts` (25 tests), green in my own full-suite run. Sprint-authorized substitute for the absent server handler.                                                    |
| TEST-111 | A bare call no longer compiles                                    | PASS   | **Reproduced independently.** My own probe: `c.api.POST("/api/threads/{id}/turns", { params: … })` → `error TS2345: … Property 'body' is missing …`. The well-formed call with `body` compiles (EXIT=0). |
| TEST-112 | Exemption gone, guard test updated not deleted                    | PASS   | `RULE_EXEMPTIONS` is empty; the guard test survives renamed as "earns no exemption from the rule at all". Full contract suite green.                                                              |
| TEST-113 | Every standing contract invariant still holds                     | PASS   | Endpoint inventory unchanged (38 operations); request-body count still **11**; whole `openapi.test.ts` suite green in my run.                                                                     |
| TEST-114 | Regeneration idempotent and drift-free                            | PASS   | `node --import tsx scripts/check-generated-artifacts.ts` → **exit 0**, "API contract is up to date" and "CLI reference is up to date". `git status` in the repo is clean.                        |
| TEST-115 | Round-trip tests cover every changed schema                       | PASS   | Contract package suite green; coverage stayed above the gate (repo-wide 98.81 % lines / 95.05 % branches).                                                                                        |
| TEST-116 | The repo typechecks with the new fields                           | PASS   | `npm run typecheck` across all workspaces → **exit 0**. Open Conflict 9's expected `apps/server` red is closed by SERVER-015.                                                                     |
| TEST-124 | Published vocabulary == emitted vocabulary, proved on the wire    | PASS   | See below — **all nine** published shapes observed on a real `curl -N` stream.                                                                                                                    |

## Probes I ran

**Artifact inspection** (`packages/contract/openapi.json`):

```
KEY SHAPES IN OPENAPI: ["docs"] ["docs", "<docId|threadId>"] ["tree"] ["threads", "<threadId>"]
                       ["queue"] ["jobs"] ["jobs", "<eventId>"] ["locks"] ["locks", "<docId>"]   count 9
turns requestBody.required= true  media [ 'application/json', 'multipart/form-data' ]
request bodies total= 11
DocRow required count 23
created type ["string","null"]
DocFrontmatter created type ["string","null"] req? true
Warning enum: commit_failed | commit_skipped | orphaned_anchor | unresolved_ref
```

**tsc probes** (`/tmp/eval-s5-c005`, `--strict --module nodenext`, `types: []`):

- vocabulary-only import from the client surface → `EXIT=0`
- bare turn-append call → `TS2345: Property 'body' is missing in type '{ params: … }'` (fails, as required)
- well-formed turn-append call → `EXIT=0`

**TEST-124 on the wire.** A single `curl -N /events` client held open across the whole run
(document create/edit/move/archive/unarchive/delete, lock acquire/release/break, job-log append,
a queue fail/retry/abandon, and out-of-band document and thread edits). Union of observed key
shapes, ids normalised:

```
["docs"]  ["docs","<id>"]  ["tree"]  ["threads","<id>"]  ["queue"]
["jobs"]  ["jobs","<id>"]  ["locks"] ["locks","<id>"]
```

Exactly the published nine — every published shape observed at least once, and no emitted shape
outside the set. `["threads","<id>"]`, whose product emitter (thread writes) is SERVER-006 and out
of scope here, was still observed via the watcher on an out-of-band thread edit, so the set is
fully closed on both sides with nothing outstanding. `grep '^data:' | grep -v '^data: {"keys":'`
returned nothing: every payload's only field is `keys`.

**Repo gates** (my own runs, clean tree): `npm run build` ✔ · `npm run lint` ✔ ·
`npm run format:check` ✔ · `npm run typecheck` ✔ · `npx vitest run --coverage` → **2725 passed /
670 suites, 0 failed**, 98.81 % lines / 95.05 % branches · `check-generated-artifacts.ts` ✔ ·
`CORPUS_UI_PORT=5273 npm run e2e` → **13 passed**.

## Failures

None.

## Notes for the record

1. **`?since=` is silently ignored.** `GET /api/jobs/{id}/log?since=2` returns 200 with the full
   log rather than a 400. That is the contract's declared "ignore unknown query parameters"
   posture (SERVER-011's adjudicated behavior) and the param name is correctly `cursor`, so this
   is not a defect — recorded because the issue file's Technical Design still says `since` in
   three places, and that prose is now stale relative to the shipped contract.
2. **TEST-101 verified by assertion, not by mutation.** Proving "a tenth shape makes a test fail"
   would require editing source, which an evaluator does not do. I verified the pin exists, names
   the closed set explicitly, and passes. Recorded so the method is visible.

## Summary

**17 of 17 criteria passed.** The vocabulary is published, closed, Zod-free, documented on both
sides, and — checked against a live SSE stream — is exactly what the server emits. The `DocRow`
growth is nullable-not-optional as adjudicated, every field is real, and the nullable-timestamp
decision is applied consistently across both response shapes (the addendum closed a genuine
cross-route divergence that the original decision table had wrong, and said so plainly). The
turn-append helper restores the compile-time guarantee CONTRACT-004 escalated, which I reproduced
myself. Artifacts regenerate byte-identically and the repo is drift-clean and green.
