# Evaluation: SERVER-024

**Date**: 2026-07-27
**Sprint**: sprint-009
**Verdict**: PASS

`npm run build` (which builds `apps/ui/dist`), real `corpus init` workspace on **8955**, real
`corpus server start`, real headless Chromium, plus raw `curl`.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                  |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Per-criterion, with a hostile-token escaping probe the sprint did not even ask for.                                                     |
| Commands are specific and concrete      | PASS   | Raw request/response pairs with headers; redacted token prefixes; a named post-refinement re-verification after `isAppShellPath` changed. |
| Real E2E (not mocked)                   | PASS   | Real browser against the installed shape; the unit-level `localhostOnly` half is explicitly labelled as such with the bind evidence.    |
| Scenarios cover acceptance criteria     | PASS   | All three ACs, plus the security rationale AC that the sprint predicted would be skipped.                                               |
| Application restarted after changes     | PASS   | Two scratch workspaces, second one specifically because serving behaviour changed.                                                      |
| Actual model recorded (implemented on:) | PASS   | "implemented on: opus".                                                                                                                 |
| Reproduction logged before fix (bugs)   | N/A    | Not a bug.                                                                                                                              |

## Criteria Results

| #        | Criterion                                                | Result | Observed (re-derived independently)                                                                                                                                                                                                    |
| -------- | -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TEST-97  | Production UI reaches authenticated data, zero steps      | PASS   | Opened the printed URL in Chromium with **no env var, no edited file, no pasted token**. Network log: `GET /api/docs?pinned=true&sort=order&type=view` → **200**, plus `?needs=me`, `?folder=inbox`, `/api/locks`, `/api/jobs` all 200. Console strip read `corpus 0.0.0`, not "server unreachable". Zero uncaught page errors. |
| TEST-98  | SSE authenticates too                                    | PASS   | `GET /events?token=…` → **200** from the page itself; by hand `?token=nope` → **401**. Out-of-band `POST /api/docs` repainted the board (3 → 4 columns) with no reload.                                                                 |
| TEST-99  | Dev flow unchanged                                       | PASS   | Accepted on the log (documented `VITE_CORPUS_TOKEN` command, dev page has no injected block, `200 /events`). Not independently re-run — the production path was the composed target and 5273 was left free.                             |
| TEST-100 | Precedence decided and documented                        | PASS   | Documented in `apiClient.ts` (injected wins, env var is the fallback) and covered in both orders by `apiClient.test.ts`.                                                                                                                |
| TEST-101 | No token still degrades quietly                          | PASS   | With `CORPUS_UI_DIST` pointing at a missing dir, `/` returns a plain 503 rather than a page that renders and then 401s. Zero uncaught errors observed on every browser probe run in this eval.                                          |
| TEST-102 | Security rationale written where the mechanism lives      | PASS   | `apps/server/src/ui-runtime-config.ts` carries an 82-line header naming **all four** required items: who can obtain the token (the two shipped guards), what an unauthorized process must do, why it is not weaker than reading the 0600 config (with the *different-local-uid* residual named explicitly), and a five-bullet "what would make it weaker" list. This is not a "safe because localhost" comment. |
| TEST-103 | Token not handed to an unauthenticated caller unguarded   | PASS   | The shell is guarded: any `Origin` header → 403; non-loopback peers cannot reach the bind at all.                                                                                                                                       |
| TEST-104 | Non-loopback request cannot obtain the token             | PASS   | `curl -H "X-Forwarded-For: 8.8.8.8" http://127.0.0.1:8955/` → **200** — the header is ignored and the socket peer decides. Socket bound `127.0.0.1:8955` only (`lsof`). The synthesized non-loopback peer is unit-covered.               |
| TEST-105 | Cross-origin browser request cannot obtain the token     | PASS   | `Origin: https://evil.example` → **403** `{"code":"forbidden","message":"this endpoint refuses requests carrying an Origin header; it is not a browser API"}`. `Origin: http://127.0.0.1:8955` (same-origin-looking) → **403** too. Deep SPA route `/doc/abc` with an Origin → **403**. |
| TEST-106 | Token appears only where the mechanism puts it           | PASS   | Extracted the injected token and grepped the hashed JS asset: **0 occurrences**. `.corpus/config.json` still mode **600** after the whole run. The injected value equals the config token exactly (verified by comparison).             |
| TEST-107 | No contract route added without a contract issue         | PASS   | `git show --stat a5278bf` touches only `apps/server/src/{app,static-ui,ui-runtime-config}.{ts,test.ts}`, `apps/ui/src/app/apiClient.{ts,test.ts}` and the issue file. **Nothing under `packages/contract`.**                             |
| TEST-108 | Missing-build path unchanged                             | PASS   | Restarted with `CORPUS_UI_DIST=/tmp/…no-such-dist`: `/` → **503** "UI build not found — run `npm run build -w apps/ui` (dev) or reinstall the corpus package"; `/doc/abc` → **503**; `/api/health` → **200**. Crucially, `/` with a hostile `Origin` **also stayed 503**, not 403 — the guard runs after the shell read, so a missing build never masquerades as a refusal. |
| TEST-109 | Serving still correct for every other asset              | PASS   | `/assets/index-DJeHxMNV.js` → `cache-control: public, max-age=31536000, immutable`, **0** token occurrences; the same asset with `Origin: https://evil.example` → **200** (correct: same-origin ES modules do send `Origin`). Tokenized shell is `no-store` + `x-frame-options: DENY`. |
| TEST-110 | `apps/ui` stays inside the kit's rules                   | PASS   | `grep -rn "fetch(\|@corpus/contract/client" apps/ui/src` excluding tests returns **exactly one line**, inside `apps/ui/src/app/apiClient.ts` (the provider wiring). The kit was not touched.                                            |
| TEST-111 | Unit suite covers both halves                            | PASS   | `ui-runtime-config.test.ts` (new), `static-ui.test.ts` (+13), `apiClient.test.ts` (+10) all present; the two modified shipped tests are listed with reasons.                                                                            |
| TEST-112 | E2E is the real installed shape                          | PASS   | Reproduced end to end here: `npm run build` → `corpus init --port 8955` → `corpus server start` → printed URL → real browser → authenticated `200 GET /api/docs`.                                                                       |

## Honesty Audit

Sampled TEST-97, 98, 103, 104, 105, 106, 108, 109 and re-ran every one against a fresh workspace and
a fresh server. **All reproduced**, including the exact 403 message text and the `no-store` /
`X-Frame-Options: DENY` / immutable-asset split. The escaping claim was not re-run with a hostile
token, but the mechanism it protects (`type="application/json"` data block, JSON-escaped) is visible
in the served page and the module documents the requirement.

No contradiction found. **This is the strongest-evidenced issue in the sprint.**

## Summary

16 of 16 criteria passed. An installed user opens the printed URL and gets authenticated data with
zero manual steps, and the credential-bearing response is guarded by socket-peer loopback detection
and an `Origin`-presence refusal that even rejects a same-origin-looking header. PASS.
