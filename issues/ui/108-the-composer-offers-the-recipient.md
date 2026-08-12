# [UI-108] The composer offers the recipient

## Domain
ui

## Status
todo

## Priority
P0

## Model
opus

## Dependencies
- Depends on: [CONTRACT-051], [SERVER-107], [SERVER-108]
- Blocks: —

## Spec References
- SPEC.md §8 as amended by SHARED-043 — recipient default and override; the composer says what sending will do

## Summary
The agent picker. Every composer that can wake an agent gains a recipient control: a
droplist of lanes from `GET /api/agents` — each row a name (resident's, or "agent" for the
orchestrator), liveness, and the one-line summary — with the **default preselected by
location**: inside a designated scope, that scope's resident; everywhere else, the
orchestrator. Picking a different row stamps `recipient` on the send. The control is
informative at rest (it *shows* who will answer, which is most of the feature's feel) and
an override only when touched.

## Acceptance Criteria
- [ ] Roster fetched via the generated client under the `["agents"]` query key, live over the existing invalidate stream — no polling
- [ ] Default resolution client-side from what the board already holds: the current thread's root (walking `origin`/`parent` up the thread/doc chain) → if that root carries `resident`, it is the default; else orchestrator; the computed default sends **no** `recipient` field (server default and UI default must be the same rule, and omission is how they cannot drift)
- [ ] Only an explicit pick sends `recipient`; picking the default back sends nothing again
- [ ] Rows render liveness honestly: live (summary line), lapsed (`last seen <relative> — the orchestrator will answer until it returns`), waiting (`no listener yet`); a lapsed pick is legal (contract routes it; fallback covers it)
- [ ] The composer's existing "sending will ask the agent…" affordance (§8: every composer says, while typing, whether sending will ask the agent) names the picked recipient; mention chips are unchanged (persona directives compose with lanes, and the affordance line says both when both are present)
- [ ] Weight control, attachments, and autocomplete are untouched; the picker follows the weight control's composer-row pattern (`UI-082`'s placement)
- [ ] Keyboard accessible per the composer key contract (UI-052/053 conventions)

## Technical Design

### Files to Create/Modify
- `packages/kit/src/query/useAgentsRoster.ts` — new hook beside `useOutstandingJobs.ts`
- `apps/ui/src/composer/RecipientPicker.tsx` — new control
- Composer host components (thread reply, doc comment, global Ask) — mount + default resolution
- `packages/kit` exports

### Key Implementation Details
Reuse the `useOutstandingJobs` fetch/invalidation shape for the roster hook. Default
resolution needs the root walk to be cheap: thread summaries carry `origin`/`parent` and
`resident` (CONTRACT-051), so the walk is over data the board has — never a per-keystroke
request. In the global composer the picker is the full roster and picking a resident
means the send targets that agent's root thread (the send routes as a turn on th_x —
follow SHARED-043's wording for this case).

### Edge Cases
- Roster query erroring or empty: the picker collapses to the static default ("agent") and sends nothing — the composer must never block a send on roster availability
- The picked lane is dissolved between pick and send: server 422 → surface the composer's ordinary send-error state, reset to default
- A resident picked in the global composer while lapsed: allowed, with the lapsed wording visible at pick time

## Testing Strategy
Component tests: default resolution (in-scope, out-of-scope, global), omission vs. explicit
`recipient`, liveness renderings, error collapse. Hook test for invalidation-driven
refresh. E2E stub gains the `/api/agents` route (per the stub-fidelity discipline,
UI-056/085: typed, and unhandled-route guard updated).

## E2E Verification Plan

### Verification Steps
1. Real server + UI; designate th_x with a live listener
2. Open a composer inside th_x's scope → picker shows the resident preselected with its live summary; send without touching it → network tab shows no `recipient` field; the resident answers
3. Override to "agent" on one message → `recipient: "orchestrator"` on the wire; the orchestrator answers that one; the next composer is back to the resident default
4. Global Ask → full roster with summaries; pick the resident → the turn lands on th_x

## E2E Verification Log
_Filled in by the implementing agent as proof-of-work._

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain)
- [ ] Committed with `[UI-108]` prefix
