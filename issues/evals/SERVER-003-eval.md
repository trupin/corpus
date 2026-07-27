# Evaluation: SERVER-003

**Date**: 2026-07-26
**Sprint**: sprint-002
**Verdict**: PASS

Every result below comes from a **real `corpus` server process** (`node --import tsx/esm
apps/server/src/main.ts`, and `./node_modules/.bin/tsx` where signals were not involved)
against **real workspaces on real disk** (`/tmp/eval-p2-ws`, `/tmp/eval-p2-ws2`,
`/tmp/eval-p2-cliws`) with real `.corpus/config.json` files, driven by real `curl` and real
POSIX signals. Port 8765 for the manual E2E as assigned; auxiliary ports 8782–8798 for
isolated cases, each recorded inline. `app.fetch()` was not used for any step here.

Scratch: `/tmp/eval-p2-scratch/`. Repo tree verified clean before and after.

> **Note on the harness.** The `tsx` **CLI** forks a child and does not forward `SIGTERM`;
> the issue log records this and so do I — I confirmed it directly (a `kill -TERM` on the
> wrapper left the child listening). Every signal- and restart-sensitive step below runs
> `node --import tsx/esm`, one process. This is a dev-harness artifact, not a server defect.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                        |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Verification log present                | PASS   | Per-test sections TEST-25…41, an Environment preamble, an explicit Deferred block, a Gate block, and a post-merge reconciliation section.                       |
| Commands are specific and concrete      | PASS   | Real curl transcripts with headers and bodies, real pids, real exit statuses, real log lines with `durationMs`, real parse-position text in config errors.      |
| Real E2E (not mocked)                   | PASS   | Real process, real workspace, real curl, real `kill -TERM`. Unit-test claims are labelled as such and kept separate from the process-level evidence.            |
| Scenarios cover acceptance criteria     | PASS   | Every acceptance criterion maps to a test; the TEST-34 deviation (out-of-range port instead of a 5-char token) is declared with its adjudication rationale.     |
| Application restarted after changes     | PASS   | Restart is explicit for the UI-dist swap and for the post-reconciliation re-verification on port 8791.                                                          |
| Actual model recorded (implemented on:) | PASS   | "**implemented on: opus**"; the reconciliation section separately records "model: opus".                                                                        |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue.                                                                                                                                                 |

Spot-checks: every transcript I re-ran reproduced, including the exact 503 body text, the
exact port-collision message, the `"query":"token=redacted"` log line, and the four config
error messages. The reconciliation section's claim that the live document declares no `500`
and that `internal_error` is absent from it also reproduced.

## Criteria Results

| #   | Criterion                                                    | Result | Notes                                                                                                                                                                    |
| --- | ------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 25  | A real server process boots against a real workspace         | PASS   | `{"level":"info","msg":"listening on http://127.0.0.1:8765",…,"workspace":"/tmp/eval-p2-ws"}`; process stayed alive and served traffic.                                       |
| 26  | Health reachable without a token, contract-shaped            | PASS   | `200`, `content-type: application/json`, `{"status":"ok","version":"0.0.0","uptimeSeconds":10.913,"workspace":"/tmp/eval-p2-ws"}` — `uptimeSeconds`, absolute path. Parses as `HealthSchema` (verified in TEST-71). |
| 27  | Guarded paths reject a missing token                         | PASS   | `401`, `www-authenticate: Bearer`, body `{"code":"unauthorized","message":"missing or invalid workspace token — pass \`Authorization: Bearer <token>\` from .corpus/config.json"}`. Token never logged: `grep -c "<token>" server.log` → `0`; `/events` query logged as `token=redacted`. |
| 28  | Wrong token rejected, in constant time                       | PASS   | `Bearer wrong`, bare `Bearer`, `Basic abc`, empty and whitespace headers → all `401`, none threw, none 500'd. `auth.test.ts` asserts the real `crypto.timingSafeEqual` is called for equal-length input and **not** called on a length mismatch (which does not throw) — I ran that suite: green. |
| 29  | Unregistered API path is problem-JSON 404, not the SPA shell | PASS   | `404`, `application/json`, `{"code":"not_found","message":"no route matches GET /api/definitely-not-a-route"}`. No HTML, no stack.                                            |
| 30  | Exactly one contract route mounted, rest 404 honestly        | PASS   | Swept **all 39** inventory method+path pairs with a valid token, each with its own method: `GET /api/health` → 200; the other 38 → `404 application/json` with a `not_found` body. No 501, no empty 200, no HTML. |
| 31  | Live OpenAPI document served, valid 3.1                      | PASS   | Without a token → `401` problem JSON. With the token → `200`, `openapi = 3.1.0`, 34 paths.                                                                                    |
| 32  | Missing UI build degrades to a clear 503, API unaffected     | PASS   | `/` → `503`, `text/plain`, body `UI build not found — run \`npm run build -w apps/ui\` (dev) or reinstall the corpus package`. `/api/health` immediately after → `200`.       |
| 33  | Present UI build serves assets, SPA fallback scoped          | PASS   | Fixture dist: `/` and `/some/deep/route` → `index.html`, `no-cache`; `/assets/app.a1b2c3d4.js` → `public, max-age=31536000, immutable`; `/api/nope`, `/attachments/x`, `/events` → problem JSON, never the shell; `/../etc/passwd` and `/%2e%2e/%2e%2e/etc/passwd` → the shell, no traversal. Re-run against the **real Vite dist** via the monorepo fallback: `index-Bh1F4esT.js` and `index-DBo_PnNP.css` immutable, `/board/some/deep/route` → shell. |
| 34  | Config failures name the file and the problem                | PASS   | Four fixtures, each `exit=1`, one line, no stack: missing file names the path and `corpus init`; malformed JSON names `position 34 (line 2 column 9)`; schema failure names `port: Too big…`; non-loopback names `host: must be a loopback address — this version of corpus binds 127.0.0.1 only`. The 5-char-token substitution is the adjudicated behaviour (Adjudication 3 removed `min(32)` from the reader) — I confirmed a 1-char token boots and authenticates. |
| 35  | Workspace resolution follows the pinned precedence           | PASS   | (a) `--workspace ws2` with `CORPUS_WORKSPACE=ws` → `workspace=/tmp/eval-p2-ws2`; (b) env from `/tmp` → `/tmp/eval-p2-ws`; (c) cwd `$WS/a/b/c` → `/private/tmp/eval-p2-ws` (same dir, macOS symlink); (d) neither → `exit 1`, "not a Corpus workspace: no .corpus/config.json found in /private/tmp or any parent directory; run \`corpus init\`". |
| 36  | `createServer` is pure with respect to ambient state         | PASS   | Called with an explicit config while `CORPUS_WORKSPACE=/tmp/eval-p2-ws2`, `CORPUS_PORT=9999`, `CORPUS_LOG_LEVEL=debug` and `CORPUS_UI_DIST=<real dist>` were all set: bound `8795` (config), served `workspace=/tmp/eval-p2-ws` (config), returned `503` for `/` (config said no UI). `process.exit` replaced with a throwing spy: **0 calls**. |
| 37  | Port collision produces the documented message               | PASS   | `exit=1`, `{"level":"error","msg":"port 8765 already in use — another corpus server may be running (corpus server status)"}`. No `EADDRINUSE` trace.                          |
| 38  | Shutdown graceful, ordered and idempotent                    | PASS   | Real `main.ts` + `SIGTERM`: "shutting down" → "shutdown complete", `exit_status=0`, subsequent curl exit `7`. Two disposers registered through the public `registerDisposer` seam ran in **reverse** order (`second-registered` then `first-registered`). Idempotence proven with a slow disposer so extra signals land mid-shutdown: `SIGTERM`, `SIGTERM`, `SIGINT` → two `"shutdown already in progress"` lines, **each disposer ran exactly once**, exit 0. Backstop: a disposer hanging on a ref'd timer → `BACKSTOP armed at 5000ms` → `"shutdown did not complete within 5000ms; forcing exit"`, `exit_status=1`, `elapsed_seconds=6`. |
| 39  | `localhostOnly` exists, works, is not yet mounted            | PASS   | Driven over **real sockets**: `127.0.0.1` → 200; `::1` → 200 (against a `::` listener); IPv4→IPv6 mapped `::ffff:127.0.0.1` → 200; real non-loopback peer `192.168.68.52` → **403 `{"code":"forbidden","message":"this endpoint accepts loopback connections only"}`**. `X-Forwarded-For`/`X-Real-IP`/`Forwarded` ignored in both directions (spoof-allow stays 403, spoof-deny stays 200). Mounted on no route: `grep -rn localhostOnly apps/server/src` outside its own module hits only a comment. The `forbidden` code matches the recorded adjudication that supersedes TEST-39's last two sentences. |
| 40  | The `?token=` exception is scoped to SSE and nothing else    | PASS   | `/api/health?token=` → 200 (exempt route anyway); guarded `/api/openapi.json?token=<correct>` → **401**; guarded `/api/docs?token=<correct>` → **401**; `/attachments/x?token=<correct>` → **401**; `/events?token=<correct>` → **404** (authenticated, handler is SERVER-007's); `/events?token=wrong` → 401; `/events` with no credential → 401; `/events` with the header → 404. |
| 41  | The development entry point works as documented              | PASS   | `CORPUS_WORKSPACE=… npm run dev -w apps/server` → `> tsx watch src/main.ts`, then the bound-URL line; `/api/health` → 200 with the real payload. `npm run build` from the repo root succeeds (run again for TEST-77).                                                                     |

### Adversarial probes (beyond the sprint's list)

| Probe                                        | Observed                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| `HEAD` / `OPTIONS` / `POST` on `/api/health`  | `401` — the exemption is scoped to `GET` only. Correct and deliberate.        |
| `GET /api/health?junk=%00&x=1`                | `200`, no crash.                                                              |
| 60 KB `Authorization` header                  | `431` from Node's header limit; server survived.                              |
| `GET /api/../../etc/passwd` (`--path-as-is`)  | `503` UI-missing shell path — no traversal, no file served.                   |
| `GET /api/%E2%98%83`                          | `404` `{"code":"not_found","message":"no route matches GET /api/☃"}`.         |
| 5 MB POST body to `/api/docs`                 | `404`, no crash, no hang.                                                     |
| 40 concurrent `/api/health` (20-way parallel) | `40 × 200`, no errors.                                                        |

## Failures

None.

## Observations (not failures; recorded for the orchestrator)

**OBS-1 — the two config readers disagree on a portless config.** See
`issues/evals/CLI-001-eval.md` OBS-1. `loadServerConfig` accepts
`{"version":1,"token":"…"}` and defaults the port to `8765`; the CLI's resolver **rejects**
it. SERVER-003's own acceptance criterion says "port (default 8765)", while Adjudication 3's
pinned shape lists `port: number` as non-optional (only `host?` and `dataDir?` are marked
optional). TEST-75 passes because no in-pin file diverges, but the two components do not
agree about the edges of the pin. Worth one line of adjudication before CLI-002 writes the
first real config.

**OBS-2 — non-loopback `host` is rejected by the server and accepted by the CLI.** Same
mechanism, opposite direction (`{"host":"0.0.0.0"}`). Harmless today — such a workspace
simply has no server that will start — but it is the second edge where the pin is read
differently.

**OBS-3 — a stale `corpus` server on 8765 breaks the UI e2e suite.** My first `npm run e2e`
run failed on `smoke.spec.ts:226 › a failing health check fails soft with a notice in the
console strip`, because a server I had left listening on 8765 made the health check succeed.
Killing it made the suite green. Not a defect in any issue in this batch — but the UI e2e
suite silently depends on 8765 being free, which is a foot-gun now that SERVER-003 exists
and defaults to that port.

## Summary

**17 of 17 acceptance tests pass** (TEST-25 … TEST-41), plus seven adversarial probes.
The server boots from a real config on real disk, serves exactly one contract route and
404s the other 38 honestly, guards `/api/*`, `/attachments/*` and `/events` with a
constant-time bearer check that never logs the token, scopes `?token=` to `/events` alone,
degrades to a documented 503 when the UI is missing without touching the API, and shuts down
gracefully, in reverse disposer order, idempotently, with a working 5 s backstop. The
CONTRACT-002 reconciliation landed correctly: error bodies are contract `ApiError`s with no
RFC 9457 keys, and `localhostOnly` now returns `forbidden` rather than the placeholder code.
