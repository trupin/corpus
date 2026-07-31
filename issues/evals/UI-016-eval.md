# Evaluation: UI-016

**Date**: 2026-07-31
**Sprint**: sprint-020 (TEST-749–758)
**Evaluator model**: Opus 5 (1M context) — `claude-opus-5[1m]`
**Verdict**: PASS

Same rig as UI-029 (server `8807`, real Chromium against the production bundle). Evidence is shared
with `issues/evals/UI-029-eval.md`; the verdict is separate.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                              |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | `issues/ui/016-react-router-v8.md:63-322`. Two dated entries: the **BLOCKED** entry is retained as history, then the migration entry |
| Commands are specific and concrete      | PASS   | `npm view … peerDependencies`, the `useOptimistic` grep with line numbers, the per-version audit table, install output verbatim      |
| Real E2E (not mocked)                   | PASS   | Real install in this tree, real server, real hand-driven reader walk on `8805`                                                       |
| Scenarios cover acceptance criteria     | PASS   | TEST-749–758 each addressed; the four-file claim shown with `git diff --stat`                                                        |
| Application restarted after changes     | PASS   | Server on `8805` after the install; nav-stack walk performed against it                                                              |
| Actual model recorded (implemented on:) | PASS   | "ui-dev, model **opus** (claude-opus-5[1m])" on both entries. Wording differs from the contract's `implemented on:` form — nit only  |
| Reproduction logged before fix (bugs)   | N/A    | Migration, not a bug. The retained BLOCKED entry is a genuine pre-state record and strengthens the log                               |

The retained blocker entry deserves credit: it is the rare case of a log that documents *not* doing
the work, with measurements (`useOptimistic` at `components.js:18`, the four-version audit table)
that later turned out to be exactly right. It is not padding.

## Criteria Results — verified independently

| #   | Criterion                                             | Result | Observed                                                                                                        |
| --- | ----------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| 1   | TEST-749 — `react-router-dom` gone, `react-router@^8.3.0` in | PASS   | `apps/ui/package.json` → `"react-router": "^8.3.0"`, no `react-router-dom`. `npm ls react-router-dom` → `└── (empty)`. `npm ls react-router` → one hoisted `react-router@8.3.0` |
| 2   | TEST-750 — no `react-router-dom` anywhere in source   | PASS   | `/usr/bin/grep -rn "react-router-dom" apps packages plugins scripts --include=*.ts --include=*.tsx --include=*.json` (node_modules filtered) → **zero hits** |
| 3   | TEST-753 — `npm audit` reports zero                   | PASS   | `metadata.vulnerabilities: {"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}`, `vulnerabilities` map `[]`, `npm audit` exit `0`. Contract-time was `moderate:2, total:2` |
| 4   | TEST-754 — stop condition not triggered               | PASS   | Total is zero, so INFRA-013 was entitled to start                                                                 |
| 5   | TEST-755 — reader navigation behaves identically      | PASS   | Walked by hand: rows open readers, readers **stack** (1 → 2 when a thread is opened from another column), the `‹ Inbox` / `‹ Open threads` back control unwinds the stack one level at a time to empty, and `esc` closes the reader beneath a closed focus overlay. Stack-empty exit reached repeatedly (`readers: 1 → 0`) |
| 6   | TEST-757 — `useOptimistic` blocker resolved in fact   | PASS   | The **declarative** router renders in the running app — this is the decisive test, since `useOptimistic` is imported statically by `lib/components.js`, the `BrowserRouter`/`Routes`/`Route` module. `BrowserRouter` mounts, the catch-all route serves the board at `/nope/not/a/route?x=1`, `/a/b/c` and `/__probe`, and `history.back()`/`forward()` re-render correctly. Zero console output |

### The router, exercised in the real browser

```
/__probe?doc=doc_escch2xh → cols: 3
/__probe                  → cols: 3
/                         → cols: 3
/a/b/c                    → cols: 3      (catch-all)

=== history Back/Forward through the router ===
after goBack:    http://127.0.0.1:8807/         cols: 3
after goForward: http://127.0.0.1:8807/__probe  renders

CONSOLE: (none)
```

(`/__probe` resolves to the catch-all in the production bundle because `devRoutes()` is dev-only —
expected, and it confirms the catch-all is the route doing the work.)

### The v6 `future` flags

`/usr/bin/grep -rn "v7_startTransition\|v7_relativeSplatPath" apps packages plugins` → **zero hits**.
Neither the props nor the comment that explained them survive.

## Failures

None.

## Summary

6 of 6 independently-checked criteria pass. `react-router-dom` is gone from the manifest, the
lockfile and every source file; `react-router@8.3.0` is the single hoisted copy; the tree audits at
`total: 0`, which is INFRA-013's precondition and is a measurement rather than an inference; and the
declarative router — the module that statically imports `useOptimistic` — genuinely mounts and
routes in the running application, including the catch-all and browser history. Reader navigation,
stacking and stack-empty exit are unchanged.

**One nit, not a failure**: the log records the model as "model **opus**" rather than the contract's
literal `implemented on: opus` phrasing (TEST-822). The datum the recalibration rule needs is
present.
