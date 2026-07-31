# Evaluation: SERVER-033

**Date**: 2026-07-31
**Sprint**: sprint-018
**Evaluator model**: Opus 5 (`claude-opus-5[1m]`)
**Verdict**: PASS (no-behavior spot-checks, per the evaluation brief)

## Scope of this evaluation

This is a dependency migration (`@hono/node-server` 1.x → ^2.0.12) whose intended
observable behaviour is *no change*. Per the brief, I ran spot-checks rather than a
full behavioural sweep: the app boots, statics serve, the attachment/static routes
leak nothing under traversal forms, and the two `c.env.incoming`-dependent guards
still behave — the tokenless loopback job-log write and the bearer guard in front of
the API.

## Rig

Workspace `…/tmp/eval-p6/ws`, server `127.0.0.1:8802` (pid 99059) started from
source. All probes over real HTTP (`/usr/bin/curl --path-as-is` and Python
`urllib` so no client re-normalises the path away).

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                  |
| --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Includes an 18-row traversal matrix run **pre and post** migration, with a positive control.            |
| Commands are specific and concrete      | PASS   | Version pinned (`^2.0.12`, installed `2.0.12`), audit findings 3 → 2, suite counts.                      |
| Real E2E (not mocked)                   | PASS   | Two new **real-listener** spec files precisely because `app.request` cannot see the adapter binding.     |
| Scenarios cover acceptance criteria     | PASS   | Boot, SSE, static UI, attachments, audit, plus the added Adjudication-4 criterion.                       |
| Application restarted after changes     | PASS   | Traversal matrix re-run after the migration.                                                            |
| Actual model recorded (implemented on:) | PASS   | "**implemented on: opus** (Opus 5, 1M context)."                                                        |
| Reproduction logged before fix (bugs)   | N/A    | Dependency migration.                                                                                   |

The log's most valuable act is a **correction to its own issue**: the issue asserted
a bearer guard in front of the UI routes; the log states there is none
(`mountStaticUi` is deliberately unauthenticated per SERVER-024), so the localhost
bind is the only mitigation that holds. I confirmed this — `GET :8802/` returns the
UI with no `Authorization` header. Naming a mitigation that does not exist would
have been the easy path; it did the opposite.

## Criteria Results (spot-checks)

| #   | Check                                                    | Result | Notes                                                    |
| --- | -------------------------------------------------------- | ------ | -------------------------------------------------------- |
| 1   | App boots on the v2 adapter                              | PASS   | `running — pid 99059 on :8802, corpus 0.0.0, up 1694s`.  |
| 2   | Statics serve                                            | PASS   | `GET /` → 200, 1545 bytes of the real SPA index.         |
| 3   | Traversal forms leak nothing (static UI)                 | PASS   | 12 forms, zero leaks.                                    |
| 4   | Traversal forms leak nothing (attachments)               | PASS   | 7 forms, zero leaks.                                     |
| 5   | Tokenless loopback job-log write still 201               | PASS   | 201, appended, `source: "hook"`.                         |
| 6   | The bearer guard still holds on API routes               | PASS   | Tokenless `GET /api/docs` → 401.                         |

## Evidence

### Boot and statics

```
$ corpus server status
running — pid 99059 on :8802, corpus 0.0.0, up 1694s, http://127.0.0.1:8802

$ curl -s -o /dev/null -w '%{http_code} %{size_download}' :8802/
200 1545
$ head -c 120 → <!doctype html><html lang="en"><head><script id="corpus-runtime-config" …
```

### Traversal matrix — static UI route

Sent with the path untouched; body inspected for `root:x:`, `/etc/hosts` content,
`"dataDir"`, and workspace document text.

| path                                   | HTTP | body        | leak  |
| -------------------------------------- | ---- | ----------- | ----- |
| `/../../../../etc/passwd`              | 200  | SPA (1545B) | false |
| `/..%2f..%2f..%2f..%2fetc%2fpasswd`    | 200  | SPA         | false |
| `/%2e%2e%2f%2e%2e%2fetc%2fpasswd`      | 200  | SPA         | false |
| `/..\..\..\etc\passwd`                 | 200  | SPA         | false |
| `/....//....//etc/passwd`              | 200  | SPA         | false |
| `/assets/../../../../../etc/passwd`    | 200  | SPA         | false |
| `/assets/..%5c..%5c..%5cetc%5cpasswd`  | 200  | SPA         | false |
| `/%252e%252e%252fetc%252fpasswd`       | 200  | SPA         | false |
| `/.corpus/config.json`                 | 200  | SPA         | false |
| `/../.corpus/config.json`              | 200  | SPA         | false |
| `/data/docs/inbox/rates-memo.md`       | 200  | SPA         | false |
| `/../../../../etc/hosts`               | 200  | SPA         | false |

Every response is the SPA fallback, byte-identical in length to `/index.html`
(positive control: `GET /index.html` → 200, 1545 bytes). Nothing outside the built
UI is reachable — notably not `.corpus/config.json`, which holds the token, and not
the workspace's own markdown.

### Traversal matrix — attachments route

| path                                             | HTTP | leak  |
| ------------------------------------------------ | ---- | ----- |
| `/api/attachments/..%2f..%2f..%2fetc%2fpasswd`   | 404  | false |
| `/api/attachments/%2e%2e%2f%2e%2e%2fetc%2fpasswd`| 404  | false |
| `/api/attachments/....//....//etc/passwd`        | 404  | false |
| `/api/attachments/%252e%252e%252fetc%252fpasswd` | 404  | false |
| `/api/attachments/nonexistent.png`               | 404  | false |
| `/api/attachments/../../../../etc/passwd`        | 200  | false (client-normalised to `/etc/passwd` → SPA fallback) |
| `/api/attachments/..\..\..\etc\passwd`           | 200  | false (same) |

### The `c.env.incoming`-dependent guards still bind

The adapter binding these guards read is exactly what a major bump can change
silently. Both still behave:

```
$ curl -X POST :8802/api/jobs/evt_swf3krssjl4u/log -H 'Authorization: Bearer …' -d '{"line":"with token"}'
HTTP 201  {"eventId":"evt_swf3krssjl4u","appended":true}

$ curl -X POST :8802/api/jobs/evt_swf3krssjl4u/log -d '{"line":"tokenless loopback probe"}'   # no header
HTTP 201  {"eventId":"evt_swf3krssjl4u","appended":true}

$ curl :8802/api/docs                                                                          # no header
HTTP 401  {"code":"unauthorized","message":"missing or invalid workspace token — pass
           `Authorization: Bearer <token>` from .corpus/config.json"}
```

The tokenless write is accepted **and attributed correctly** — the log file
distinguishes the two callers, which is what proves the peer address was actually
read rather than defaulted:

```
{"ts":"2026-07-31T10:04:28Z","source":"cli","line":"with token"}
{"ts":"2026-07-31T10:04:28Z","source":"hook","line":"tokenless loopback probe"}
```

A guard degraded to `undefined` would have produced neither the 401 on `/api/docs`
nor the `hook`/`cli` distinction.

## Failures

None.

## Summary

6 of 6 spot-checks passed. The v2 adapter boots, serves the built UI, refuses every
traversal spelling I could construct on both the static and attachment surfaces, and
— the migration's real hazard — both `c.env.incoming` consumers still read the
adapter binding rather than silently defaulting. Full behavioural coverage of the
migration is the repo suite's and the harvest e2e gate's job, not this evaluation's.
