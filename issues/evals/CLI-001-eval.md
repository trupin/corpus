# Evaluation: CLI-001

**Date**: 2026-07-26
**Sprint**: sprint-002
**Verdict**: PASS

Every CLI result below comes from the **real built binary**, linked with
`npm link -w apps/cli` and invoked as `corpus` from a real shell
(`command -v corpus` → `/opt/homebrew/bin/corpus`), never `tsx src/…`, with `echo $?` read
for every exit code. The standalone counterpart is a **real `node:http` server on
`127.0.0.1:8865`** — a real socket, no mocking library. The integration counterpart is a
**real SERVER-003 process** on the same port, which is what makes the previously-deferred
TEST-57/58 runnable in this merged tree. The global link was removed again afterwards.

Scratch: `/tmp/eval-p2-scratch/`, workspace fixtures under `/tmp/eval-p2-cliws`. Repo tree
verified clean before and after.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                             |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Per-test sections TEST-42…58 with an Environment preamble and an explicit deferral block.                                                                             |
| Commands are specific and concrete      | PASS   | Real invocations, real exit codes, real rendered strings, a real `shasum` for `docs/cli.md` (`af2516eb…`) that I reproduced byte-for-byte.                            |
| Real E2E (not mocked)                   | PASS   | Real linked binary, real socket on 8865, real temp workspaces. Where evidence is unit-level (fixture registry, parse matrix) the log says so instead of claiming E2E. |
| Scenarios cover acceptance criteria     | PASS   | Every criterion is exercised; the topic-level gaps are declared, not omitted.                                                                                         |
| Application restarted after changes     | PASS   | Rebuilt and relinked before the run; I rebuilt and relinked independently and reproduced every claim.                                                                 |
| Actual model recorded (implemented on:) | PASS   | "**implemented on: opus** (matches the issue's Model recommendation)."                                                                                                |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue.                                                                                                                                                       |

**Deferral audit.** The log defers TEST-57/58 to CLI-002 because SERVER-003 had not landed
in its worktree. That was true then and is **not** true now — I ran both against the real
server rather than accepting the deferral (results below). The remaining deferrals
(topic-level help, topic-level unknown-verb) are *structural*, not circumstantial: the sprint
contract's own Out of Scope forbids CLI-001 from shipping any topic, so no shipped registry
can exercise them. Those I accept, with the fixture-registry substitute evidence verified.

## Criteria Results

| #   | Criterion                                                | Result           | Notes                                                                                                                                                                                     |
| --- | -------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 42  | The real binary runs outside a workspace                 | PASS             | From `/tmp`: `corpus --version` → `0.0.0`, exit `0`; `corpus --help` → full topic/flag listing, exit `0`; bare `corpus` → identical top-level help, exit `0` (not an error).               |
| 43  | Help at three levels, entirely from the registry         | PASS (2 of 3 levels exercisable) | Level 1 and level 3 verified against the binary: `corpus --help` lists `health` with its one-line summary and the seven globals; `corpus health --help` shows the synopsis, the merged globals and **three** runnable examples. Level 2 (`corpus <topic> --help`) is unexercisable — the shipped registry has zero topics by the sprint's own Out of Scope. Substitute evidence verified: the fixture-registry help snapshots and `run.test.ts` drive all three levels through the same renderer. `DEFERRED → CLI-002` accepted. |
| 44  | Unknown topics/verbs → usage error, exit 2               | PASS             | `corpus nosuchtopic` → `unknown command "nosuchtopic".` / `Valid: health.`, exit `2`. Near misses `helth` and `healht` (both edit distance ≤ 2) → `Did you mean "health"?`, exit `2`. `corpus health nosuchverb` → `unexpected argument "nosuchverb" for "health".` + usage, exit `2`. The topic-scoped unknown-verb wording needs a topic to exist; covered by `run.test.ts` against the fixture registry. |
| 45  | Flag and argument parsing is registry-driven             | PASS (typed matrix partly fixture-bound) | Against the binary: unknown flag (`--nosuchflag`), `=`-form (`--nosuchflag=1`) and short (`-Z`) → each names the flag, lists the known flags, exit `2`. Number typing is real: `--timeout notanumber` → `flag --timeout expects a number, got "notanumber".`, exit `2`; `--timeout=1` parses and produces a 1 ms timeout. Boolean (`--json`, `--verbose`) and string (`--workspace`) flags exercised throughout. Repeated flags and a required positional do not exist in the shipped registry — covered by `parse-args.test.ts` against the fixture command. Global-shadowing is enforced at load (TEST-49). |
| 46  | Workspace resolution walks up, nearest ancestor wins     | PASS             | From `$WS/a/b/c` → resolved `$WS` (proved by `Nothing answered at http://127.0.0.1:8865`, that workspace's port). From `$WS/a/inner/deep` → the **inner** workspace (`…:8866`), no merging. From `/tmp` → `not inside a Corpus workspace — run \`corpus init\` here or pass --workspace`, exit `3`. `--workspace $WS` from `/tmp` → resolves. Malformed JSON → `workspace config is invalid: …is not valid JSON (Expected ':' after property name in JSON at position 34 (line 2 column 9))`, exit `3`, no stack. Schema violation (`"version":2`) → `… — version: Invalid input: expected 1`, exit `3`. |
| 47  | A down server produces the actionable message, exit 4    | PASS             | `corpus: server not running for this workspace — run \`corpus server start\`` / `  Nothing answered at http://127.0.0.1:8865.`, exit `4`. `ECONNREFUSED` appears nowhere in the output (asserted programmatically: `false`).                                                              |
| 48  | Server errors map to their exit codes and rendered forms | PASS             | Against the real stub: `401` → `401 unauthorized: bearer token does not match this workspace` + token guidance, exit `5`. Typed `404` → `404 not_found: no such resource`, exit `5`. Typed `400` → the same form with the `issues` rendered underneath, exit `5`. Non-contract `500` → `500 http_error: Internal Server Error` + body as details, exit `5`. Socket destroyed mid-response → `lost the connection to … before it answered`, exit `4`. Hung server with `--timeout 700` → `did not answer within 700ms`, exit `4`. A malformed `200` (forced internal exception) → exit `1`, one-line message; the stack appears **only** under `--verbose`, verified both ways. |
| 49  | The registry validates itself                            | PASS             | The four required fixtures all exist and pass: duplicate names, missing summary, zero examples, a topic flag shadowing `--json` (and `--workspace`, and an alias shadowing `-h`) — each names the offending command. The shipped registry and the fixture registry both pass. 23/23 tests green on my run. |
| 50  | `--json` writes exactly one JSON value and nothing else  | PASS             | stdout was `{"status":"ok","version":"9.9.9-stub","uptimeSeconds":42.5,"workspace":"/tmp/eval-p2-cliws"}` — `jq .` exit `0`, a whole-string `JSON.parse` succeeded (so exactly one value, not two concatenated), **stderr 0 bytes**, no banner or spinner. |
| 51  | `--json` failures are JSON on stderr, exit unchanged     | PASS             | Typed problem: human exit `5`, json exit `5` (identical); stdout **0 bytes**; stderr `{"error":{"code":"not_found","message":"404 not_found: no such resource"}}`, `jq` parses. With details present the third key appears: `{"error":{"code":"bad_request","message":"400 bad_request: request failed validation","details":[{"path":"folder",…}]}}`. Usage failure outside a workspace: `{"error":{"code":"no_workspace","message":"not inside a Corpus workspace — run \`corpus init\` here or pass --workspace"}}`, exit `3`. |
| 52  | Without `--json`, success is quiet                       | PASS             | Exactly one line: `ok — corpus 9.9.9-stub, up 43s, workspace /tmp/eval-p2-cliws`. stderr 0 bytes. No JSON dump, no banner.                                                            |
| 53  | `--json` combined with `--help` still prints human help  | PASS             | `corpus health --help --json` printed the identical human help text, exit `0`. `docs/cli.md` §Usage documents the exception.                                                          |
| 54  | Non-TTY output carries no color or progress              | PASS             | `corpus health --help` piped to a file: **0** ANSI escape bytes in 1276 bytes of output. No spinner frames anywhere in the run.                                                       |
| 55  | `docs/cli.md` generated, committed, complete, idempotent | PASS             | Two runs of `npm run docs:cli -w apps/cli` → `af2516eb0dfac8b13b05ebeb1c684a244773e3db` both times; `git diff --exit-code docs/cli.md` → `0`. Header line present verbatim. A `## \`corpus health\`` section with flags and three examples. Exit-code appendix `0…6` complete and correct. `.gitattributes:11` → `docs/cli.md linguist-generated=true`. |
| 56  | A stale `docs/cli.md` is blocked before it lands         | PASS             | `.githooks/pre-push` and `.github/workflows/ci.yml` both invoke the **one shared** `scripts/check-generated-artifacts.ts` (the hook comments "Never re-list the artifacts here"). Clean → both `✓`, exit `0`. With `docs/cli.md` mutated → `✗ CLI reference is stale: docs/cli.md` / `Fix: npm run docs:cli -w apps/cli && git add docs/cli.md`, exit `1`. Restored → exit `0`, `git status --porcelain` empty, hash back to `af2516eb…`. |
| 57  | *(integration)* The real CLI reaches the real server E2E | PASS — **run, not deferred** | Real SERVER-003 process on 8865 against `/tmp/eval-p2-cliws`, real binary run from `/tmp/eval-p2-cliws/a/b/c` (three levels down). `corpus health` → `ok — corpus 0.0.0, up 0s, workspace /tmp/eval-p2-cliws`, exit `0`. `corpus health --json` → `{"status":"ok","version":"0.0.0","uptimeSeconds":0.392,"workspace":"/tmp/eval-p2-cliws"}`, stderr 0 bytes, and `HealthSchema.safeParse` → **true**. |
| 58  | *(integration)* The real CLI's error surface matches     | PASS (a); (b) legitimately deferred | (a) With the same server stopped: `server not running for this workspace — run \`corpus server start\``, exit `4`. (b) `corpus health` cannot demonstrate the 401 against a real server because `GET /api/health` is unauthenticated **by spec (§2.1)** — the sprint contract itself rules this half satisfied by TEST-48's real stub and re-proven in CLI-002. I strengthened it anyway: see TEST-74 below, where the **real server's 401 bytes** were replayed and the CLI rendered from them. |

## Cross-issue integration (TEST-71 … TEST-77) — all run, none deferred

| #   | Test                                                 | Result | Evidence                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 71  | CLI → server through the generated client, end to end | PASS   | **The centerpiece, run with no stub in the chain**: real linked `corpus` binary → registry dispatch → `createClient()` over the generated `@corpus/contract/client` → real TCP socket on 8865 → real Hono app in a real `main.ts` process → real `/tmp/eval-p2-cliws/.corpus/config.json` on disk. Exit `0`; payload validates as `Health`; the reported `workspace` equals the real directory. |
| 72  | Regenerated client typechecks against the server     | PASS   | `npm run typecheck` across all five workspaces → exit `0`, no cast and no adapter shim needed.                                                                                                                                    |
| 73  | Regenerated client typechecks against the CLI wiring | PASS   | `npm run typecheck` green. `grep -rn "fetch(" apps/cli/src` excluding `client.ts` → **zero hits**. `createCorpusClient` is consumed as published in `client.ts:1,46`; no path re-declaration anywhere.                            |
| 74  | Server error bodies are contract error bodies, and the CLI renders them | PASS | Real server `401` and `404` captured with `curl`: both `ApiErrorSchema.safeParse` → **true** (`unauthorized`, `not_found`), and the RFC 9457 key set `{type,title,status,detail,instance}` is **empty** in both — Open Conflict 2 honoured. Then the server's exact 401 bytes were replayed and the CLI rendered `corpus: 401 unauthorized: missing or invalid workspace token — pass \`Authorization: Bearer <token>\` from .corpus/config.json`, i.e. derived from the server's own `code`/`message`, not a CLI-side guess. |
| 75  | One config file, two readers, no disagreement        | PASS (with OBS-1/OBS-2) | Six configs in the pinned shape — canonical, minimal, unknown-future-key, custom `dataDir`, 1-char token, and the live workspace — were read by `loadServerConfig` and by the CLI's `resolveWorkspace`: **both accepted every one and derived the same port and token**. Four malformed shapes (out-of-range port, `version: 2`, port-as-string, empty token) were rejected by both. Two out-of-pin shapes diverge — see OBS-1/OBS-2. |
| 76  | Pinned inventory and mounted surface agree           | PASS   | All 39 inventory pairs fetched against the running server with a valid token, each with its own method: `GET /api/health` → `200`; the other 38 → `404` problem JSON. No HTML, no `501`, no empty `200`.                          |
| 77  | Repo-wide gates stay green                           | PASS   | `npm run build` ✓ · `npm run lint` ✓ · `npm run format:check` ✓ ("All matched files use Prettier code style!") · `npm run typecheck` ✓ (5 workspaces) · `npm run test:coverage` ✓ **85 files / 1677 tests passed**, coverage **99.55% lines / 96.18% branches / 100% functions** (gate 90%) · `CORPUS_UI_PORT=5273 npm run e2e` ✓ **13 passed** · `.githooks/pre-push` end to end → `pre-push ✓ all checks passed`, exit `0`. |

## Failures

None.

## Observations (not failures; recorded for the orchestrator)

**OBS-1 — the two config readers disagree on a portless config (TEST-75 edge).**
```
{"version":1,"token":"abcdefghijklmnopqrstuvwxyz012345"}
  server (loadServerConfig): OK, port defaults to 8765
  cli    (resolveWorkspace): REJECT — "workspace config is invalid: … "
```
TEST-75 still passes because its Given is "the pinned shape", and Adjudication 3 lists
`port: number` as non-optional (only `host?` and `dataDir?` carry `?`). But SERVER-003's own
acceptance criterion says "port (default 8765)", so the two components implement two
different readings of the same pin. `corpus init` (CLI-002) will always write a port, so
this is latent — but it is exactly the class of divergence TEST-75 exists to prevent, and it
costs one line of adjudication to close.

**OBS-2 — non-loopback `host` diverges the other way.** `{"host":"0.0.0.0"}` is rejected by
the server (v1 binds loopback only) and accepted by the CLI. Harmless — such a workspace has
no server that will start — but it is the second edge where the pin is read differently.

**OBS-3 — the malformed-`200` path is classified as an internal error, not a server error.**
A stub returning `content-type: application/json` with an HTML body gives
`corpus: Unexpected token '<', "<html>not "... is not valid JSON`, exit `1`. That satisfies
TEST-48's "unexpected internal exception exits 1 and prints a stack only under `--verbose`"
(verified both ways), and a bad body genuinely is unexpected — recorded only so the choice is
on the record before CLI-002 adds verbs that talk to more routes.

## Summary

**17 of 17 standalone acceptance tests pass** (TEST-42 … TEST-58) and **all seven
cross-issue tests pass** (TEST-71 … TEST-77). TEST-57 and TEST-58(a), deferred by the
implementing agent because it worked in an isolated tree, are **runnable in the merged tree
and I ran them** — the real binary reaches the real server and the real error surface. Two
structural gaps remain (topic-level help and topic-scoped unknown-verb), and they are
genuinely unexercisable: the sprint's own Out of Scope forbids CLI-001 from shipping a
topic, and the substitute fixture-registry evidence exists and is green. TEST-71, the
sprint's composition proof, passes with no stub anywhere in the chain.
