# [UI-035] Upgrade UI: on-demand check + "Upgrade & restart" with SSE ride-through

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-027, SERVER-050
- Blocks: —

## Spec References
- SHARED-007 rider

## Summary
On-demand only: a "Check for updates" affordance (console/health area — match
where the version already surfaces); on `upgradeAvailable`, show latest version
+ notes link and an "Upgrade & restart" action calling `POST /api/upgrade`.
The UI then rides the restart with the existing SSE reconnect machinery: show
an upgrading state while the connection is down, and on reconnect show the new
version (re-fetch whatever carries it). Never check without the user asking.

## Acceptance Criteria
- [x] Check runs only on explicit user action; result states current vs latest
- [x] Upgrade action visible only when a newer release exists; disabled with
      an honest message when the trigger answers the in-flight refusal
- [x] SSE drop after trigger renders an upgrading state, not the generic
      unreachable-server error; reconnect restores the board and shows the new
      version
- [x] Unreachable GitHub renders the modeled failure, not a crash

## Technical Design
### Files to Create/Modify
- Console/health surface components + kit client methods/hooks per the
  generated client

## Testing Strategy
Component tests for all states (stubbed transport); e2e with a stubbed check +
a real SSE drop/reconnect.

## E2E Verification Plan
Real app: check → upgrade against a stubbed server-side trigger; observe the
ride-through.

## Decisions

**The version label is the affordance.** It is where a person already looks to
ask "am I current", it keeps the same words and the same `.c-status` class — so
the 24ch bound and §10's no-re-widening rider both still hold — and it becomes a
`<button>`. No new control was added to the strip, which is the one line in the
app that always renders.

Rejected: a fourth console tab. §10's tab list is rider-authorized in a named
order, and updates are not the running system's account of itself the way Jobs,
Notices and Residents are.

**No `role="status"` on the button.** An explicit role replaces the implicit one,
so `<button role="status">` is not a button to a screen reader. The three states
*around* it keep theirs — those change under a person and are worth announcing;
this one is a control they press. Caught by the test that could not find the
button by role.

**Both hooks are mutations, not queries.** §2.4 promises Corpus "never checks
for, downloads, or installs anything in the background". A `useQuery` is a thing
react-query may re-run on a window focus, a reconnect or a remount — this repo's
defaults switch two of those off, but the promise then rests on a config nobody
would think to guard. A mutation runs when something calls it and at no other
moment. There is a test that focuses the window and asserts no second request.

**The ride-through waits for the server to go away first.** The `202` is written
*before the download begins*, so for several seconds the old server is still
answering on the old version. The first implementation declared success on the
next successful probe and its own tests caught it. The panel now waits for the
probe to fail — the restart — and only a success after that ends the phase.

It watches `dataUpdatedAt`, not `data`, and that is not incidental: a server
returning on the **same** version answers with a structurally equal body, and
react-query's structural sharing hands back the identical object, so an effect
watching `data` never fires. That version of the panel said "upgrading" forever,
and the test for the unchanged case is what found it.

**And a bound, at ninety seconds.** An upgrade can decline after starting — an
undetectable install method, a release that stopped being verifiable — and then
nothing restarts and nothing drops. A spinner that never ends would be this
panel's own version of the false promise v0.24.0 removed from the pending row.
At the bound it stops claiming and points at the report.

**Coming back on the same version claims neither success nor failure**, because
neither is known. It names the log and says which question it answers.

## E2E Verification Log

Run by the orchestrator on **opus** (Claude Opus 5), 2026-08-26.

**Unit**: 26 tests across `upgradeModel.test.ts` and `UpgradePanel.test.tsx`,
plus 3 in `ServerStatus.test.tsx`, all through the transport rather than through
mocked hooks — what matters is which requests the panel issues and when.

**Falsified, both load-bearing behaviours.**

- Removing the wait-for-the-drop guard (`!dropped.current`) turns **6** tests
  red, including "does not call it finished while the old server is still
  answering".
- Making `canUpgrade` read `upgradeAvailable` alone turns **5** red, including
  the panel test that asserts the action is not offered for an unverifiable
  release.

Both restored; 26 green again.

**Playwright** (`apps/ui/e2e/upgrade.spec.ts`, 2 specs, both passing): the
version is a real control, the panel is a modal on the shared `.overlay.open`
layer with `aria-modal`, the check renders both verdicts, the trigger fires
exactly once, and — three components away from the click — **the strip stops
saying "server unreachable" and says `upgrading…`**, with `.c-failed` absent.
The second spec pins that an unverifiable release is explained rather than
offered.

The drop-and-return cycle is **not** in the browser suite, deliberately. The e2e
harness has no reachable event stream — the dev server starts with no proxy
target, so `/events` is refused (INFRA-028) — and the health probe is only
refetched when the SSE bridge invalidates it. Driving a restart there would
assert against whatever a failing `EventSource` happened to do, which is timing
rather than behaviour. It is driven through real query states in the unit suite
instead, and the note is in the spec file so the next reader does not think it
was forgotten.

**Two existing tests were corrected, not worked around.** `Console.test.tsx`
read the version through `getByRole("status")`; it now reads the button, and
gained an assertion that the control *disappears* when the server is
unreachable. `console-strip-geometry.spec.ts` asserted the whole `title` string;
the title now also says what pressing it does, so it asserts the version is in
it — which is what §10's clause 2 is actually about.

**Suites**: `vitest run apps/ui packages/kit` — 246 files, 4764 tests, green.
`tsc --noEmit -p apps/ui` clean, `eslint .` clean.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
