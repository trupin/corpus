# Evaluation: sprint-015 riders — CONTRACT-020, CONTRACT-021, SERVER-036

**Date**: 2026-07-30
**Sprint**: sprint-015 (wave 1, orchestrator-sequenced riders per Adjudications 13 and 14)
**Verdict**: **PASS** (CONTRACT-020 PASS · CONTRACT-021 PASS · SERVER-036 PASS)

Spot-check scope, per the evaluation brief: the riders' **headline claims, re-derived E2E** — skill
creation over HTTP including the archived-name 409 and the traversal 400s; defer refusing with 409
unless the event is in-progress; and `queue status` counts keyed correctly against distinct seeded
counts. Everything below was observed against real servers on **9196** and **9197** in real scratch
workspaces, never from source.

## E2E Proof-of-Work Audit

| Check                                   | CONTRACT-020 | CONTRACT-021 | SERVER-036 | Notes                                                                                                 |
| --------------------------------------- | ------------ | ------------ | ---------- | ------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS         | PASS         | PASS       | All three carry filled logs.                                                                            |
| Commands are specific and concrete      | PASS         | PASS         | PASS       | Contract riders are schema-level, so their logs lean on generated-artifact diffs and typecheck signals — appropriate for the domain; SERVER-036's log carries real HTTP evidence. |
| Real E2E (not mocked)                   | N/A (schema) | N/A (schema) | PASS       | A contract package has no running surface of its own; its E2E is that its consumers work, which SERVER-036 and CLI-011 supply and I re-derived. |
| Scenarios cover acceptance criteria     | PASS         | PASS         | PASS       | Each ticked criterion has a corresponding re-derived behaviour below.                                    |
| Actual model recorded (implemented on:) | PASS         | PASS         | PASS       | `implemented on: opus` in all three (`020:51`, `021:48`, `036:51`).                                      |
| Reproduction logged before fix (bugs)   | N/A          | N/A          | N/A        | All three are feature riders.                                                                            |

## Criteria Results

### CONTRACT-020 — `POST /api/skills` route definition

| #   | Criterion                                                                | Result | Observed                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Route defined with the house error envelope; traversal guard at schema level | PASS   | `openapi.json` declares `POST /api/skills` with responses `201, 400, 401, 409`. The guard is genuinely schema-level: `../evil`, `a/b`, `..`, `/etc/passwd`, `..%2Fevil`, `""` and `../../../etc/evil` all return `400 bad_request` with `{"path":"json.name","message":"Invalid string: must match pattern /^[a-z0-9]+(?:-[a-z0-9]+)*$/"}` — the same envelope every other route uses. A 65-character name → `400 … Too big: expected string to have <=64 characters`; 64 characters is accepted, so the bound is correct at the boundary. |
| 2   | openapi.json + generated client regenerated; route tests per house pattern  | PASS   | The working tree is clean at `3717887`, so the committed `openapi.json` and `schema.generated.ts` are the generated artifacts — no drift.                                              |
| 3   | Response set consistent with SERVER-036's actual behaviour                  | PASS   | Every declared code was produced by the running server: **201** on success, **400** on validation, **401** unauthenticated, **409** on collision. No undeclared code was observed.       |

### CONTRACT-021 — deferred queue status + transition metadata

| #   | Criterion                                                            | Result | Observed                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Deferred status + metadata modelled; existing statuses untouched       | PASS   | The enum in `openapi.json` reads `["pending","in-progress","deferred","processed","failed","abandoned"]` — `deferred` inserted, nothing removed or renamed. `POST /api/queue/{id}/defer` declares `200, 400, 401, 404, 409`, and all five were produced live. `blockedOn` is required and pattern-checked (`400` on omission and on `"not-an-id"`). |
| 2   | openapi.json + client regenerated; strictness/enum tests               | PASS   | Clean tree at `3717887`; the enum is served in the OpenAPI document and consumed identically by server, CLI and UI (see below).                                                                                                                       |
| 3   | Consumer impact enumerated so downstream riders are filed with scope    | PASS   | Verified by outcome — every named consumer moved: the **server** counts and serves it; the **CLI** scaffolds `.corpus/queue/deferred/` (tracked `.gitkeep`, derived from the enum) and prints it in `queue status`; the **console** renders a distinct `deferred` dot and count. `packages/contract` was changed only by this orchestrator-sequenced commit — `a689cee`, `8e6f61b`, `4613b08` and `bed3e7d` touch it not at all (TEST-367 holds). |

**Headline claim re-derived — counts keyed correctly with distinct seeded counts.** This is the
regression CLI-013's log escalated as P0 (`status()` destructuring positionally, so every count after
`in-progress` shifted and `abandoned` was dropped). Seeded through real threads and real transitions
to **1 / 2 / 3 / 4 / 5 / 6**:

```
EXPECTED: pending 1, inProgress 2, deferred 3, processed 4, failed 5, abandoned 6
HTTP    : {"halted":false,"pending":1,"inProgress":2,"deferred":3,"processed":4,"failed":5,"abandoned":6}
CLI     : queue running — pending 1, in-progress 2, deferred 3, processed 4, failed 5, abandoned 6
on disk : pending=1 in-progress=2 deferred=3 processed=4 failed=5 abandoned=6
```

All three views agree with every count distinct, so no shift could hide. **The escalated bug is
genuinely fixed**, and the CLI no longer prints `deferred undefined`.

### SERVER-036 — `POST /api/skills` handler

| #   | Criterion                                                             | Result | Observed                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Creation lands as a normal auto-commit, projected, SSE-invalidated       | PASS   | Commit: `88fa02ca… agent <agent@corpus.local> :: skill create: weekly-review (doc_jwakggjc) by agent`, `git show --name-only HEAD` → exactly `.claude/skills/weekly-review/SKILL.md`, `git status --porcelain` empty. Projected with the server running throughout — `GET /api/docs?type=skill` returns it immediately. Live SSE capture during a create: `event: invalidate` / `data: {"keys":[["docs"],["docs","doc_5d7jyjqt"]]}`. |
| 2   | No write path accepts arbitrary roots; the seam is skills-specific       | PASS   | The request body carries only a `name`, and the server derives the path — there is no client-supplied folder to abuse. Every traversal shape is refused at the schema boundary over **raw HTTP as well as the CLI**, and `find` over the workspace and `/etc` after the refusal batch produced no stray path. `POST /api/docs` and `normalizeDocFolder` are unaffected: `doc create` still lands under `data/docs/`. |
| 3   | Collision with an installed skill → 409; the archived case decided       | PASS   | Installed name → `409 conflict: a skill named \`weekly-review\` is already installed (.claude/skills/weekly-review exists) — edit it with \`PUT /api/docs/{id}\` or choose another name`. Shipped name `comment` → same. **Archived case, re-derived:** `corpus doc archive doc_d4gqvmn2` moved `triage` to `.claude/skills-archived/triage`, and re-creating it returns `409 conflict: the name \`triage\` belongs to an archived skill (.claude/skills-archived/triage exists) — unarchive it to bring it back, or choose another name; creating over the name would leave it unable to return`. The reasoning is in the message itself, which is the right call — creating over it would strand the archive. |
| 4   | Tests per house pattern incl. traversal and validation refusals          | PASS (behavioural) | Source-level test composition is outside the evaluator's remit; every refusal those tests would pin was exercised live, and each left the workspace byte-identical (HEAD unmoved, `git status --porcelain` empty, `.claude/skills` listing unchanged). |

**Headline claim re-derived — defer 409 unless in-progress.** The full matrix against a real server,
one real event per state:

| event state | `POST /api/queue/{id}/defer` |
| ----------- | ------------------------------- |
| `pending`     | `409` — `queue event evt_3iaqutfxejvo is pending; only in-progress work can be deferred` |
| `deferred`    | `409` — `… is deferred; only in-progress work can be deferred` |
| `processed`   | `409` — `… is processed; …` |
| `failed`      | `409` — `… is failed; …` |
| `abandoned`   | `409` — `… is abandoned; …` |
| unknown id    | `404` — `no queue event evt_doesnotexist99` |
| `in-progress` | **`200`** — the event body, and the file moves to `deferred/` |

Each refusal names the event's **actual** current status, which is what makes the message actionable
rather than a bare conflict.

## Failures

None within the riders' own scope.

One boundary note that belongs to the consumers, not to these riders: `CONTRACT-021` defines
`Job.blockedOn` / `Job.blockedOnTitle` with the explicit rationale *"The console needs it to say what
a waiting row is waiting for."* The API serves both fields correctly (`{"blockedOn":"doc_tziz3yof",
"blockedOnTitle":"Unrelated"}`), but the console never renders them — recorded as **FAIL-1 in
`issues/evals/SERVER-030-eval.md`**, against the consumer, not against the contract.

Separately, bookkeeping: the console's deferred rendering landed in commit `b4aa5b1`, whose subject
is `[SHARED-004] Phase 5 SPEC amendments applied, user-signed-off`. A UI rider bundled under a SPEC
sign-off commit makes that work hard to find later; it is not a behavioural defect.

## Summary

**All three riders pass.** Load-bearing evidence, one per rider:

- **CONTRACT-020** — the traversal guard is genuinely expressible at the schema level and is enforced
  identically on both surfaces: `curl -X POST /api/skills -d '{"name":"../../../etc/evil",…}'` →
  `400` with `json.name … must match pattern /^[a-z0-9]+(?:-[a-z0-9]+)*$/`, the same answer
  `corpus skill create ../evil` gets, and nothing is written anywhere.
- **CONTRACT-021** — the enum change is real and reaches every consumer coherently: seeded
  1/2/3/4/5/6 across the six states, the HTTP response, `corpus queue status` and the on-disk file
  counts all agree exactly, killing the positional-destructure regression CLI-013 escalated.
- **SERVER-036** — a document is created **outside `data/docs/`** through the ordinary pipeline:
  `HTTP 201`, `.claude/skills/<name>/SKILL.md` on disk with both frontmatter field sets, an
  auto-commit attributed to `--from`, a live `invalidate` SSE frame, and immediate discoverability —
  with the archived-name case correctly refused at `409` rather than silently stranding the archive.

No rider claim was refuted.
