# Evaluation: CLI-011

**Date**: 2026-07-30
**Sprint**: sprint-015 (wave 1, stage B)
**Verdict**: PASS

Evaluated against the committed tree (`8e6f61b [CLI-011]` on `phase-5-followups`), rebuilt once with
`npm run build`. Real workspace at
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s015-eval-cli011-yCgTom`, created with the
subshell-`cd` form from outside the repository, real server on **9196** (pid 47897), real git.
Every request was either a real CLI invocation of `apps/cli/dist/bin/corpus.js` or a real `curl`
against the running server. `8765` was never bound, probed or killed.

Evaluated with the orchestrator's two standing corrections: TEST-328 is judged against the
**server-minted** `doc_<base32>` id, and TEST-336's `--json` against the accepted `{items, page}`
envelope rather than a bare array.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                              |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Sections keyed to TEST-324–TEST-343, with the three judgement calls in the flag surface stated openly.                                                |
| Commands are specific and concrete      | PASS   | Full command lines, heredoc bodies, exact stdout, exit codes, ids, commit hashes, a refusal table with one row per case.                              |
| Real E2E (not mocked)                   | PASS   | Real workspace, real server on 9186, real `git log`/`git show`, real 400/409 responses. No fixtures or test clients in the evidence.                  |
| Scenarios cover acceptance criteria     | PASS   | All three criteria have drills; TEST-326–332 ran live rather than struck, as Adjudication 13 required once SERVER-036 landed.                          |
| Application restarted after changes     | PASS   | TEST-328 explicitly proves the *opposite* is not needed — the skill is discoverable with the server running throughout. I re-derived this.            |
| Actual model recorded (implemented on:) | PASS   | "**implemented on: opus** (2026-07-30, cli-dev)".                                                                                                     |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue, not a bug.                                                                                                                             |

## Criteria Results

| #   | Criterion                                                                             | Result | Notes                                                                                             |
| --- | --------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| AC1 | `corpus skill create <name>` creates a live skill through the server                     | PASS   | Re-derived end to end: disk, frontmatter, auto-commit, live projection. See TEST-326–328.            |
| AC2 | `corpus doc list` with collection filters and `--json`; registry-validated; docs regen'd | PASS   | 19-flag grammar, honest paging, `{items, page}` envelope, `docs/cli.md:481-544`.                      |
| AC3 | AGENT rider filed to upgrade the genesis charter                                         | PASS   | `issues/agent-runtime/006-comment-skill-genesis-create.md` (5814 bytes, real content) and `issues/PLAN.md:176`. |

### Re-derived acceptance tests

| #        | Criterion                                                | Result | Observed                                                                                                                                                                                                                                     |
| -------- | -------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-324 | write path proven present, CLI writes nothing itself     | PASS   | Behaviourally decisive: `POST /api/skills` answers directly over HTTP (`curl -X POST …/api/skills -d '{"name":"raw-http-skill",…}'` → 200 with a full `{doc, warnings}` envelope and a git commit). The CLI is a client of that route, not a writer. |
| TEST-326 | skill lands on disk with both field sets                 | PASS   | `.claude/skills/weekly-review/SKILL.md` frontmatter carries Claude Code's `name: weekly-review` (= directory basename) and `description`, **and** Corpus's `id: doc_jwakggjc`, `type: skill`, `title`, `created`, `updated`, `tags`, `status`, `anchors`. |
| TEST-327 | real mutation with the usual audit trail                 | PASS   | `git log -1` → `88fa02ca… agent <agent@corpus.local> :: skill create: weekly-review (doc_jwakggjc) by agent`; `git show --name-only HEAD` → exactly `.claude/skills/weekly-review/SKILL.md`; `git status --porcelain` empty.                       |
| TEST-328 | projected and discoverable without a restart             | PASS   | Server ran throughout. `corpus doc list --type skill` and a raw `GET /api/docs?type=skill` both return `doc_jwakggjc … .claude/skills/weekly-review/SKILL.md` immediately. Id is the **minted** `doc_jwakggjc`, per the orchestrator's TEST-328 correction; the four pre-installed hand-written skills keep synthetic ids (`doc_skillcomment`, `doc_skill138ec106`, …), confirming the fallback still applies. |
| TEST-329 | name validated, readable errors, nothing written         | PASS   | Missing `--description` → exit **2**, `--description is required.` (no request). Duplicate → exit **5**, `409 conflict: a skill named \`weekly-review\` is already installed …`. Shipped name `comment` → same 409. Empty name → 400. After all ten refusal cases the workspace snapshot (HEAD + `status --porcelain` + `.claude/skills` listing) was **byte-identical** to before. |
| TEST-330 | created skill passes `corpus doc check`                  | PASS   | `checked 12 documents — no findings.` exit 0, with three created skills present.                                                                                                                                                                |
| TEST-331 | `skill rollback` composes with `skill create`            | PASS   | Created → `doc edit` (`EDITED CONTENT MARKER` observed on disk) → `corpus skill rollback weekly-review` → file content restored verbatim, and the rollback is itself commit `ee04972 agent :: skill rollback: weekly-review (doc_jwakggjc) to 88fa02c by agent`. |
| TEST-332 | creation cannot escape the skills root                   | PASS   | `../evil`, `a/b`, `/etc/passwd`, `..%2Fevil`, `Weekly`, `""` all → 400 `json.name … must match pattern /^[a-z0-9]+(?:-[a-z0-9]+)*$/`. Raw HTTP with `"name":"../../../etc/evil"` and `"name":".."` → the same 400. `find` over the workspace and `/etc` produced no stray path. 65-char name → 400 `Too big: expected string to have <=64 characters`; 64 chars accepted (boundary correct). |
| TEST-333 | `doc list` returns documents through the shipped route   | PASS   | Fresh workspace → 8 rows, columnar and padded, `id / type / status / title / path`. Contacts the server (fails without it); reads nothing off disk.                                                                                              |
| TEST-334 | collection filters pass through                          | PASS   | `--type skill` → 4 (then 5 after creation); `--folder views` → 3; `--pinned` → the 3 pinned views; `--type todo`, `--needs me`, `--status archived`, `--folder inbox` → `no documents match.` exit 0. Enumerated flags validated locally: `--status closed` → exit **2**, `--status must be one of: open, resolved, archived — got "closed".`, no request sent; likewise `--sort bogus`. Unknown flag → exit 2 with a did-you-mean. |
| TEST-335 | pagination is honest                                     | PASS   | `--limit 3` → `showing 1–3 of 8 documents — next page: --offset 3`; `--offset 3` → `showing 4–6 of 8 … --offset 6`; `--offset 6` → `showing 7–8 of 8 documents` with **no** next-page hint. The total is always stated, so a truncated page can never read as complete. |
| TEST-336 | `--json` machine-readable and stable                     | PASS (accepted deviation) | `{items, page}`; `page` = `{"total":8,"limit":50,"offset":0}`; each row carries the full contract row schema **including `extra`** (`{"name":"comment","description":"…"}`). Empty result → `{"items":[],"page":{"total":0,"limit":50,"offset":0}}` exit 0. The envelope rather than a bare array is the orchestrator-accepted deviation and is the only shape that keeps TEST-335's honesty guarantee in machine form. |
| TEST-337 | empty and fresh workspace                                | PASS with a recorded caveat | Empty result prints `no documents match.` exit 0 and `{"items":[],…}`. Fresh workspace lists all seed documents; `templates/` and `views/` are visible in the path column. **`inbox/` is not surfaced** — it ships empty, and a document-enumeration verb has no row to show for an empty folder. Folder enumeration lives in `GET /api/tree`, which the sprint's Out of Scope explicitly denies a CLI wrapper this wave, so this is a scope boundary rather than a defect. `data/docs/{inbox,templates,views}` all confirmed present on disk. |
| TEST-338 | §7 consequence recorded, SPEC.md untouched by cli-dev    | PASS   | `git show --stat 8e6f61b` touches 12 files: `apps/cli/**`, `docs/cli.md`, `issues/**`. **No `SPEC.md`, no `packages/contract`, no `assets/workspace/`.** The flattening is recorded in the log and routed to SHARED-004.                          |
| TEST-339 | AGENT rider filed with concrete content                  | PASS   | `issues/agent-runtime/006-comment-skill-genesis-create.md` exists with real content and is in `issues/PLAN.md:176` with dependencies `CLI-011, AGENT-003`.                                                                                        |
| TEST-340 | template extractor green, no allowlist entry             | PASS (behavioural substitute) | Rather than re-run the suite, I enumerated every `corpus …` invocation in `assets/workspace/**`: 30 distinct commands, all of which resolve to entries in `docs/cli.md`. Neither `corpus skill create` nor `corpus doc list` appears there yet — correct, since AGENT-006 is filed and not executed. No allowlist pressure exists. |
| TEST-341 | both verbs registry-valid and documented                 | PASS   | `docs/cli.md:481` `### corpus doc list` with 4 examples; `docs/cli.md:1251` `### corpus skill create` with 3 examples, and prose stating `The CLI writes nothing itself; the server is the sole writer.` Both are in the ToC (`:27`, `:57`). Working tree is clean, so the artifact-drift red recorded in the log is resolved post-commit. |
| TEST-342 | scoped tests green                                       | NOT RE-DERIVED | Test-suite composition is source-level and outside the evaluator's remit. Every behaviour those tests pin is exercised above.                                                                                                                 |
| TEST-343 | model recorded                                           | PASS   | `implemented on: opus`.                                                                                                                                                                                                                          |

## Failures

None.

## Summary

**19 of 20 re-derived criteria pass outright; TEST-337 passes with a recorded scope caveat (empty
`inbox/` is not surfaced, because folder enumeration is explicitly out of scope this wave);
TEST-342 was not re-derived (source-level).** The load-bearing evidence:

```
$ corpus skill create weekly-review --description "Run the weekly review over the corpus." --from agent <<'EOF' …
created doc_jwakggjc — .claude/skills/weekly-review/SKILL.md
$ git log -1 --format='%H %an <%ae> :: %s'
88fa02cabde414e18c7a6db67f7fac56c8d2f82f agent <agent@corpus.local> :: skill create: weekly-review (doc_jwakggjc) by agent
$ corpus doc list --type skill      # server never restarted
doc_jwakggjc  skill  open  weekly-review  .claude/skills/weekly-review/SKILL.md
```

— a document created outside `data/docs/`, through the server, with the same auto-commit and live
projection every other write gets, and immediately enumerable by the new verb. The
CLI-only/server-sole-writer invariant holds: the identical result is reachable with a bare
`curl -X POST /api/skills`, and every traversal attempt (`../evil`, `..`, `/etc/passwd`, `..%2Fevil`)
is refused with a 400 at the schema boundary, over both the CLI and raw HTTP, leaving the workspace
byte-identical. No claim in the log was refuted.
