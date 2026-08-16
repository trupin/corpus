# [INFRA-028] Running the e2e suite beside a live workspace server silently tests the wrong thing

## Domain

infra

## Status

todo

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

- [ ] A local `npm run e2e` passes with a workspace server running on 8765,
      without the caller having to know about `CORPUS_SERVER_ORIGIN`
- [ ] The e2e run does not reach a real server at all — the suite stubs its
      transport, so a proxy target that answers is a bug rather than a fallback
- [ ] The fix is in the harness rather than in the specs: an assertion weakened
      to tolerate a live server would stop testing the notice it exists for
- [ ] Whatever the mechanism, `npm run e2e` and CI run the **same** configuration
      — a local-only override reintroduces the drift one layer up

## Technical Design

### Files to Create/Modify

- `apps/ui/vite.config.ts` — the proxy target when running under Playwright
- `apps/ui/playwright.config.ts` — where the e2e configuration is already set

### Notes

`CORPUS_UI_PORT` already exists for the same class of collision (the dev server's
port), so the shape of the answer is established: the e2e run pins what it needs
rather than inheriting a developer's environment.

## Testing Strategy

The check is the run: start a server on 8765, run the suite, expect zero
failures. That is also the reproduction.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[INFRA-028]` prefix
