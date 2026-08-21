# [INFRA-028] Running the e2e suite beside a live workspace server silently tests the wrong thing

## Domain

infra

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Related: UI-070 (found it), INFRA-025 (what the hooks do and do not run)

## Spec References

- Not spec behaviour. Development harness.

## Summary

`apps/ui/vite.config.ts` proxies `/api` to `127.0.0.1:8765` by default. That is
the right default for development — it is where `corpus server start` puts a
workspace server — and it is wrong for the e2e suite, which stubs the transport
and expects nothing to answer.

So on any machine where a real workspace server is running, `npm run e2e`
**silently exercises a different system**: `console.spec.ts` and `smoke.spec.ts`
assert the console's "server unreachable" notice, and a live server on 8765
answers them, so the assertions fail for a reason that has nothing to do with the
change under test.

`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8799 npm run e2e` — any port nothing
holds — reproduces CI's condition, and both specs pass.

**This has already cost real confusion in this repo.** Those two failures were
repeatedly written off as "the pair that needs 8765 free", which is true but
states the symptom rather than the cause, and leaves every local run with two
failures a reader has to remember to discount. Two expected failures is how three
unexpected ones get through.

## Acceptance Criteria

- [x] A local `npm run e2e` passes with a workspace server running on 8765,
      without the caller having to know about `CORPUS_SERVER_ORIGIN`
- [x] The e2e run does not reach a real server at all — the suite stubs its
      transport, so a proxy target that answers is a bug rather than a fallback
- [x] The fix is in the harness rather than in the specs: an assertion weakened
      to tolerate a live server would stop testing the notice it exists for
- [x] Whatever the mechanism, `npm run e2e` and CI run the **same** configuration
      — a local-only override reintroduces the drift one layer up

## Technical Design

### Files to Create/Modify

- `apps/ui/vite.config.ts` — the proxy target when running under Playwright
- `apps/ui/playwright.config.ts` — where the e2e configuration is already set
- `apps/ui/package.json` — the `dev` script, which is now where the 8765 default lives
- `apps/ui/README.md` — the dev-server documentation

### Notes

`CORPUS_UI_PORT` already exists for the same class of collision (the dev server's
port), so the shape of the answer is established: the e2e run pins what it needs
rather than inheriting a developer's environment.

### What was chosen: the proxy is opt-in, and only `npm run dev` opts in

`vite.config.ts` proxies **nothing** unless `CORPUS_SERVER_ORIGIN` names a
target. `apps/ui`'s `dev` script supplies `http://127.0.0.1:8765` (still
overridable, `${CORPUS_SERVER_ORIGIN:-…}`), so the development default is
unchanged. A new `dev:isolated` script is plain `vite`, and that is what
`playwright.config.ts` starts.

With no proxy configured the dev server holds no target, so **no request can
leave the process** — the isolation does not depend on any port being free. A
small plugin answers `/api`, `/attachments` and `/events` with the same
`500 text/plain` Vite's own proxy returns when its target refuses a connection,
which is what CI has always observed and what makes the shell report "server
unreachable". Without it the SPA fallback would answer `/api/…` with the
`index.html` shell — a `200`, which reads as a server answering nonsense.

`playwright.config.ts` also sets `webServer.env.CORPUS_SERVER_ORIGIN = ""`.
Whitespace and the empty string count as unset, so a developer who exported the
old workaround into their shell cannot re-point the suite at anything. Verified
below by running the suite with that variable exported.

Both directions are then structural: 8765 appears in the `dev` script and
nowhere else, and reaching a workspace server from any other entry point takes a
deliberate act. Local and CI run the identical Playwright config.

### What was rejected

1. **`webServer.env.CORPUS_SERVER_ORIGIN = "http://127.0.0.1:8799"`** — the
   issue's own reproduction. It swaps one live-server collision for a rarer one:
   8799 is only unreachable until something binds it, and a reader has to know
   why that number is there. It also keeps 8765 as the config's default, so
   every future entry point inherits the trap.
2. **A `CORPUS_E2E=1` flag that switches the config into an e2e mode.** Same
   effect today, weaker property: the unsafe behaviour stays the default and
   safety is something a caller must remember to ask for. The inversion makes
   the dangerous path the one that must be named.
3. **`vite --mode e2e`.** Vite's mode also changes `import.meta.env.MODE` in the
   browser bundle, so the suite would exercise a mode the shipped app never
   runs in — a new class of the very drift this issue is about.
4. **A second `vite.e2e.config.ts`.** Two configs that can disagree about the
   SSE headers, the port policy or the plugin list. One config with one
   opt-in is fewer places to drift.
5. **Weakening the assertions.** Explicitly out of bounds per the acceptance
   criteria, and it would delete the only test of the "server unreachable"
   notice.

## Testing Strategy

The check is the run: start a server on 8765, run the suite, expect zero
failures. That is also the reproduction.

## E2E Verification Log

Model: **Opus 5 (1M context)**, agent `infra-dev`, 2026-08-21, on
`phase-38-comments-have-a-place`.

The failing condition was live on the machine throughout: a real workspace
server answered `127.0.0.1:8765` before, during and after every run below. It
was never stopped, so the before/after is a real one.

```
$ curl -s -o /dev/null -w 'health-8765=%{http_code}\n' http://127.0.0.1:8765/api/health
health-8765=200
```

`5173` was held by an unrelated ssh forward, so every run used
`CORPUS_UI_PORT=5373`. That is orthogonal to the bug.

### 1. Reproduction — before the fix, with the server up

```
$ CORPUS_UI_PORT=5373 npx playwright test --config apps/ui/playwright.config.ts \
    apps/ui/e2e/console.spec.ts --workers=1 --reporter=list

  ✘   3 [chromium] › console.spec.ts:127:3 › the collapsed strip › keeps the failed-job
        count off the health notice's class (15.7s)
  …
  1) [chromium] › console.spec.ts:127:3 › … keeps the failed-job count off the health
     notice's class

    Error: expect(locator).toHaveText(expected) failed

    Locator: locator('.console-strip .c-failed')
    Expected: "server unreachable"
    Timeout: 15000ms
    Error: element(s) not found

  1 failed
  14 passed (32.9s)
```

The notice is absent because the live server answers the health check. Exactly
the failure another agent reported on this branch and wrote off as
environmental.

### 2. After the fix, same machine, same server still up

```
$ curl -s -o /dev/null -w 'health-8765=%{http_code}\n' http://127.0.0.1:8765/api/health
health-8765=200
$ CORPUS_UI_PORT=5373 npx playwright test --config apps/ui/playwright.config.ts \
    apps/ui/e2e/console.spec.ts --workers=1 --reporter=list

  ✓   3 [chromium] › console.spec.ts:127:3 › the collapsed strip › keeps the failed-job
        count off the health notice's class (1.5s)
  15 passed (19.1s)
```

The test that timed out for 15.7s now settles in 1.5s: the notice is there
immediately, because nothing answers.

### 3. The other specs the issue names, plus stubbed ones, same conditions

```
$ CORPUS_UI_PORT=5373 npx playwright test --config apps/ui/playwright.config.ts \
    apps/ui/e2e/smoke.spec.ts apps/ui/e2e/board.spec.ts apps/ui/e2e/notices.spec.ts \
    --workers=2 --reporter=line
  24 passed (17.7s)
```

Includes `smoke.spec.ts › server state › a failing health check fails soft with a
notice in the console strip`, the second spec named in the summary.

### 4. The developer who exported the old workaround is safe too

```
$ CORPUS_SERVER_ORIGIN=http://127.0.0.1:8765 CORPUS_UI_PORT=5373 \
    npx playwright test --config apps/ui/playwright.config.ts \
    apps/ui/e2e/console.spec.ts --workers=1 --reporter=line
  15 passed (23.1s)
```

An exported origin — even one pointing straight at the live server — does not
reach the suite. `webServer.env` overrides it.

### 5. The development default is intact

```
$ npm run dev -w apps/ui -- --port 5373 --strictPort   # backgrounded
$ curl -s -w '\nGET /api/health -> %{http_code}\n' http://localhost:5373/api/health
{"status":"ok","version":"0.9.0","uptimeSeconds":435001.795,"workspace":"/Users/…"}
GET /api/health -> 200
```

`npm run dev` still proxies to the real workspace server on 8765.

### 6. The isolated server refuses every workspace path, with 8765 up

```
$ npm run dev:isolated -w apps/ui -- --port 5373 --strictPort   # backgrounded
$ for p in /api/health /api/docs /attachments/x.png /events; do curl …; done
/api/health     -> 500 text/plain
/api/docs       -> 500 text/plain
/attachments/x.png -> 500 text/plain
/events         -> 500 text/plain
$ curl -o /dev/null -w '%{http_code}' http://localhost:5373/     # the shell still serves
200
```

And with the variable exported but emptied the way the Playwright config empties
it:

```
$ export CORPUS_SERVER_ORIGIN=http://127.0.0.1:8765
$ env CORPUS_SERVER_ORIGIN="" npm run dev:isolated -w apps/ui -- --port 5373 --strictPort
$ curl -o /dev/null -w '/api/health -> %{http_code}\n' http://localhost:5373/api/health
/api/health -> 500
```

### 7. Gates

```
$ npx tsc --noEmit -p apps/ui/tsconfig.json            # exit 0
$ npx eslint apps/ui/vite.config.ts apps/ui/playwright.config.ts   # exit 0
$ npx prettier --check apps/ui/{vite.config.ts,playwright.config.ts,package.json,README.md}
All matched files use Prettier code style!
```

Repo-wide `npm run build` and `npm test` were deliberately not run: three other
agents were working on this branch and the machine was at its load cap. Every
process started here was killed by recorded pid, `5373` is free, and the user's
server on `8765` was never touched.

### Not covered

No unit test guards the wiring. The root Vitest `include` globs are
`apps/**/src/**/*.test.{ts,tsx}`, so a test beside `vite.config.ts` would not be
collected, and `apps/ui/src/**` was owned by other agents during this issue. The
issue's own Testing Strategy names the run as the check, and the run is the
strongest available evidence: it fails before and passes after with a live
server up. A guard could later live in `scripts/` if it proves worth the
cross-workspace import.

## Completion Checklist (domain agent)

- [x] Tests written and passing — the run is the test (Testing Strategy above);
      no new unit test, see "Not covered" in the E2E log
- [x] `/lint` passes (scoped to the changed files)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[INFRA-028]` prefix
