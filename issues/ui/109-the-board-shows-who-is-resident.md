# [UI-109] The board shows who is resident, and who is live

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: [CONTRACT-051], [SERVER-112]
- Blocks: —

## Spec References
- SPEC.md §8 as amended by SHARED-043 — presence; the pending indicator's wording per lane

## Summary
Presence rendering. A designated thread wears its resident: a badge on the thread card
(name + live/lapsed/waiting dot) sourced from the same `["agents"]` roster the composer
uses. The pending indicator learns lanes: on a thread whose recipient is a live resident,
the waiting tiers read as that resident working (`researcher is working…`); on a lapsed
lane, the indicator says the orchestrator will answer — never a claim that a gone listener
is working (the same honesty rule as UI-097's queued-vs-working distinction, which this
must compose with, not fork from).

## Acceptance Criteria
- [x] Resident badge on `ThreadCard` for designated roots: resident name, liveness dot, summary line on hover/expand; updates over the invalidate stream
- [x] `PendingIndicator` (`apps/ui/src/thread/PendingIndicator.tsx:20-31,58-79`) names the lane's consumer when it is a resident; tier thresholds unchanged; wording composes with UI-097's waiting-to-be-picked-up tier (queued-and-unclaimed on a resident lane reads "waiting for researcher")
- [x] Lapsed-lane honesty: a pending request on a lapsed lane reads as waiting for pickup with the fallback named ("waiting — researcher is away, the agent will pick this up")
- [x] Designation controls surfaced where user acts live: designate/release on a standalone thread's card menu (user-only actions; drive the CONTRACT-051 routes; agent-def names offered from the same autocomplete source as `@` mentions, `MENTION_DOC_TYPE`)
- [x] Scope visibility: a document whose `origin` chain reaches a designated root shows a quiet provenance line ("part of *Q3 planning* — researcher") linking to the root thread
- [x] No SSE payload extensions; everything reads through existing query keys plus `["agents"]`

## Technical Design

### Files to Create/Modify
- `apps/ui/src/thread/ThreadCard.tsx` — badge
- `apps/ui/src/thread/PendingIndicator.tsx` + `outstandingAgentRequest.ts` — lane-aware wording
- Thread card menu component — designate/release actions
- Document header component — provenance line
- Reuse `packages/kit/src/query/useAgentsRoster.ts` (UI-108)

### Key Implementation Details
The indicator must not add a data dependency to render its default tiers — lane wording is
an enhancement over the roster query, and the indicator's existing behavior is the
fallback whenever the roster is unavailable. Coordinate with UI-097 rather than
duplicating: if UI-097 is unimplemented when this lands, implement the composed wording
here and mark UI-097's criteria accordingly in a PR note, per the no-two-mechanisms rule.

### Edge Cases
- Designation while a pending indicator is showing: wording flips on invalidation; the elapsed clock keeps its original start, per the queued-vs-working rider's clock rule (in flight with UI-097 — coordinate with its wording, don't cite it as landed spec)
- A resident answering a summoned message on a foreign thread: that thread's indicator names the picked resident too (`recipient` is on the event; the outstanding-jobs row carries the lane per SERVER-111's mirror)

## Testing Strategy
Component tests: badge states, indicator wording matrix (live/lapsed/waiting ×
claimed/unclaimed), menu actions with the typed E2E stub, provenance line resolution.

## E2E Verification Plan

### Verification Steps
1. Real server + UI; designate th_x from the thread card menu → badge appears, roster row exists
2. Start the listener → dot flips live; post → indicator reads "researcher is working…"
3. Kill the listener past grace; post → indicator names the fallback honestly
4. Open a document created by the resident → provenance line links back to th_x

## E2E Verification Log
_Filled in by the implementing agent as proof-of-work._

### Post-Implementation Verification

**Model:** opus (Opus 5, 1M context). **Date:** 2026-08-16.

**Rig.** Real server + real UI, never the user's. Fresh workspace `corpus init --port 8871`
at `/private/tmp/ui109ws`; server on `127.0.0.1:8871`; Vite on `5391` with
`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8871` and `VITE_CORPUS_TOKEN` from
`.corpus/config.json` (without the token the board loads and every read is a `401` — the
first run of this drill did exactly that and is why the token is named here). Driven with
Playwright/chromium against the dev server. Repo tree at `e01a7290` — **SERVER-115 had
already landed**, which matters for the staleness finding below.

Seeded: `doc_3tnfupr2` (`type: agent-def`, title `researcher`), standalone thread
`th_owaq47iy` "Q3 planning".

**1 — Designate, from the conversation's own menu.** Right-clicked the card head. The menu
carried its existing actions plus one new one, from the mention directory:

```
[["collapse","Collapse folds to one line — nothing is hidden"],
 ["resolve","Resolve status flip, committed"],
 ["resident-designate-doc_3tnfupr2","Designate researcher owns this conversation and everything that grows out of it"]]
```

Before the click: no badge at all. After: `POST /api/threads/th_owaq47iy/resident
{"name":"researcher"}`, and the head grew

```
badge[waiting] "researcher  no listener yet"   title="researcher — no listener yet"
```

`corpus agents` agreed: `th_owaq47iy "Q3 planning" · researcher · waiting for a listener`.

**2 — A not-live lane, and §7's fallback in §8's row.** Replied `@agent please draft the Q3
plan.` (queued `evt_h5qvgznfhuqw`). With nothing parked, the card read:

```
badge[waiting]  "researcher  no listener yet"
pending[waiting] lane=th_owaq47iy
  "still waiting — researcher is not running, the agent will pick this up"
```

**3 — The transition when an agent parks.** Scheduled `corpus queue idle --thread
th_owaq47iy` to start 10 s after the page loaded, and polled the badge:

```
t+0s  liveness=waiting
t+10s liveness=live
badge[live] "researcher  idle — last active just now"
pending[waiting] "still waiting — researcher has not picked this up yet"
```

Repainted within ~1 s of the park, off the `["agents"]` invalidation alone — no poll, no
`staleTime: 0`, no refetch-on-focus anywhere in this change.

**4 — A live lane working.** `corpus queue claim-all --thread th_owaq47iy`:

```
badge[live] "researcher  working Q3 planning"
pending[working] lane=th_owaq47iy "researcher is still working — longer than usual"
```

(the `longer than usual` tier because the requesting turn was >3 m old — one clock, unchanged).
Then `corpus queue complete evt_…`: one `/api/agents` request 1 s later, badge back to
`researcher  idle — last active just now`.

**5 — Provenance on the artifact.** `corpus doc create --title "Q3 plan draft" --job
evt_3iutu67lfrgf` wrote `origin: th_owaq47iy` into `data/docs/inbox/q3-plan-draft.md`.
Opened `doc_l3amnhwk` in a reader:

```
.scope-provenance  data-provenance-lane="th_owaq47iy"  "part of Q3 planning — researcher"
```

**6 — Release.** Right-clicked the card again; the menu now offered
`["resident-release","Release researcher back to ordinary routing — nothing already queued moves"]`.
Clicked it: `DELETE /api/threads/th_owaq47iy/resident`, the badge detached, `corpus agents`
listed the orchestrator alone — and the provenance line on `doc_l3amnhwk` was gone on the
next load, because the walk now lands on the orchestrator. Both surfaces follow one fact.

**`lapsed` was unit-tested, not driven.** The server's grace window is
`AGENT_PRESENCE_WINDOW_SECONDS` = 2 × 480 s = **16 minutes**, so a browser drill would have
had to idle for a quarter of an hour. Covered instead by `ResidentBadge.test.tsx`
("stops claiming somebody is there once the evidence has gone stale", fake timers, +60 m ⇒
`lapsed`) and by the wording matrix in `PendingIndicator.test.tsx`.

**Roster staleness: none observed, and the one UI-108 measured is fixed.**
`corpus queue claim-all --thread th_owaq47iy` with the page open: **1** `/api/agents`
request, **1 s** after the claim, and the badge went `idle — last active 1m ago` →
`working Q3 planning`. UI-108 measured 6 s and no second request on this exact action; the
tree here carries SERVER-115 (`e01a7290`). `corpus thread reply` (an enqueue) issues **no**
`/api/agents` request — measured 15 s — but that is not observable staleness: `corpus
agents` reports a byte-identical row before and after an enqueue, so nothing the roster
answers has moved.

**One honest limit found, and it is a contract gap.** The pending row's lane is the *scope
walk's* answer, not the lane the outstanding event was stamped with, because `Job` carries
no lane field (`packages/contract/src/schemas/job.ts`) — the issue's Edge Cases assumed
SERVER-111's mirror put one there and it did not. For a `comment.created` the two agree.
For §7's two carve-outs they do not: designating enqueues `resident.designated` on the
**orchestrator's** lane, and for the seconds before it settles the card reads "waiting for
researcher" (observed in this drill). Display only — nothing routes off it. Documented at
the head of `PendingIndicator.tsx`; escalated as contract work.

**Checks.** `npm run build`, `npm run typecheck`, `npm run lint`, `npx prettier --check` all
clean. `vitest run apps/ui/src packages/kit/src` — **202 files, 3945 tests, all passing**.

**Falsification.** Every new test checked red first (see the PR report): `useLaneRow`
answering `unknownLaneRow` instead of withholding, `laneRow` ignoring the `now` it is
handed, `useSetResident` dropping `AGENTS_KEY`, the row naming a resident as *working* on an
away lane, the row describing an `unknown` lane, the badge rendering a stand-in before the
roster answers, the badge not ticking, the provenance line drawn on the root itself and on
an orchestrator document, `residentActions` offering a designation on a parented thread.
Two provenance negatives passed under mutation at first — a `waitFor` over an absence
settles on its first tick — and were rewritten to wait on the two reads that *would* have
drawn the line before asserting it was not drawn. The cross-package trap was exercised
deliberately: mutating `laneName` in kit's **source** left `ResidentBadge.test.tsx` green
(7/7), and the same mutation after `npm run build -w packages/kit` turned it red (2 failed).


## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying)
- [ ] Committed with `[UI-109]` prefix
