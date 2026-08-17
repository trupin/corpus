# [UI-108] The composer offers the recipient

## Domain
ui

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: [CONTRACT-051], [SERVER-111], [SERVER-112]
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
- [x] Roster fetched via the generated client under the `["agents"]` query key, live over the existing invalidate stream — no polling
- [x] Default resolution client-side from what the board already holds: the current thread's root (walking `origin`/`parent` up the thread/doc chain) → if that root carries `resident`, it is the default; else orchestrator; the computed default sends **no** `recipient` field (server default and UI default must be the same rule, and omission is how they cannot drift)
- [x] Only an explicit pick sends `recipient`; picking the default back sends nothing again
- [x] Rows render liveness honestly: live (summary line), lapsed (`last seen <relative> — the orchestrator will answer until it returns`), waiting (`no listener yet`); a lapsed pick is legal (contract routes it; fallback covers it)
- [~] The composer's existing "sending will ask the agent…" affordance (§8: every composer says, while typing, whether sending will ask the agent) names the picked recipient; mention chips are unchanged (persona directives compose with lanes, and the affordance line says both when both are present)
- [x] Weight control, attachments, and autocomplete are untouched; the picker follows the weight control's composer-row pattern (`UI-082`'s placement)
- [x] Keyboard accessible per the composer key contract (UI-052/053 conventions)

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

**Model: opus** (claude-opus-5[1m]).

Real `corpus init` workspace at `/tmp/ui108-ws`, real server on **:8931**, real Vite on
**:5391** with `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8931`, real Chromium (Playwright
`chromium.launch()`), every `/api` request recorded off the page.

Setup: `corpus thread create` → `th_zthhs5lx`; `.claude/agents/claims-review.md`;
`corpus thread designate th_zthhs5lx --agent claims-review`; `corpus queue idle --thread
th_zthhs5lx` parked, so `GET /api/agents` reported
`th_zthhs5lx: live=true, summary="idle — last active just now"`.

**1. The default is computed, and shown.** Opening the thread from the *Open threads*
column drew the picker with two lanes and no interaction:

```
lanes: [{lane:"orchestrator", default:"false", liveness:"waiting", pressed:"false", title:"agent — no listener yet"},
        {lane:"th_zthhs5lx",  default:"true",  liveness:"live",    pressed:"true",  title:"claims-review — idle — last active 1m ago"}]
statement: claims-review will answer — idle — last active 1m ago (default here)
```

**2. The default travels by being absent.** Typed and `⌘↵`:

```
POST /api/threads/th_zthhs5lx/turns {"body":"Default send — nobody touched the picker.","requestsAgent":true}
```

No `recipient` key. The event the server enqueued was stamped `lane=th_zthhs5lx`.

**3. An override routes one message.** Clicked `agent`; the statement changed to
`agent will answer this message — no listener yet` and the fill moved, leaving
`claims-review` dashed as the default. Sent:

```
POST /api/threads/th_zthhs5lx/turns {"body":"Overridden send — addressed to the orchestrator.","requestsAgent":true,"recipient":"orchestrator"}
```

Enqueued event: `lane=orchestrator`, `payload.threadId=th_zthhs5lx` — routing followed the
recipient, filing followed the conversation (§7).

**4. …and never persists past it.** Immediately after the send, with no interaction:
`orchestrator` `aria-pressed=false`, `th_zthhs5lx` `aria-pressed=true`, statement back to
`claims-review will answer — … (default here)`. Third send:

```
POST /api/threads/th_zthhs5lx/turns {"body":"Third send — should be the default again.","requestsAgent":true}
```

No `recipient`; enqueued `lane=th_zthhs5lx`.

**5. It rewires no scope and re-designates nothing.** Every non-`GET` the page made during
the whole drill:

```
POST /api/threads/th_zthhs5lx/seen   (×4)
POST /api/threads/th_zthhs5lx/turns  (×3, bodies above)
```

No `/api/threads/{id}/resident` call in either direction. Afterwards
`GET /api/threads/th_zthhs5lx` still reports `resident: {name:"claims-review",
docId:"doc_agentdef8b151b19"}`, `GET /api/agents` reports the identical two lanes and the
same `origin`, the thread file's frontmatter still carries the one `resident:` block the
designation wrote, and `git log` shows only `comment: turn on th_zthhs5lx by user` ×3 on
top of the designation commit.

**6. The global composer.** `c` → the overlay's picker offered the full roster with
`orchestrator` marked `default="true"` and `claims-review` offered beside it — §7's
summons, from a composer whose Ask is in no scope by construction.

**7. Degradation.** Before designating anything the roster held one lane and no composer
drew a control at all — `GET /api/agents` was the only request the feature made.

**Liveness renderings observed live:** `live` (green dot, server summary) and `waiting`
("no listener yet") in the browser. `lapsed` was **not** waited out — the grace window is
`AGENT_PRESENCE_WINDOW_SECONDS` = 16 min — and is covered by `laneRows.test.ts` instead,
including the `last seen <age> ago — the orchestrator will answer until it returns` wording
and the orchestrator's own variant.

**Roster staleness observed (reported, not worked around).** With the picker open,
`corpus queue claim-all --thread th_zthhs5lx` moved the lane's event to `in-progress`;
`GET /api/agents` changed server-side from `summary: "idle — last active 1m ago"` to
`summary: "working Claims review"`, and over the next 6 s the page issued **no** second
`/api/agents` request — the statement line still read the old summary. That is SERVER-114's
first emitter (**queue transitions do not emit `["agents"]`**), latent until this surface
cached the route. Left alone deliberately: no poll, no `staleTime`, no refetch-on-open.
**Presence transitions are fine** — parking a listener on the orchestrator's lane flipped
the roster server-side and the page refetched `["agents"]` and repainted the dot within 5 s
(`onPresenceChanged` already emits that key), still correct at t+60 s.

**Look and feel.** Light and dark close-ups of the composer foot: the `TO` row sits under
`WEIGHT` in the same mono voice and pill anatomy, with the console strip's dot vocabulary
(`--good` live, `--ink-3` lapsed, inset ring for waiting/unknown).

**Falsification.** Every new test was checked red before being trusted green: origin-before-parent
in the walk, `unread`→orchestrator collapse, lapsed→waiting, `overridden` ignoring the computed
default, a no-op `clear`, the picker drawing on one lane, a roster `{}` reading as empty, an
unanswered roster reading as orchestrator, `humanizeElapsed` losing its hours branch, and the
recipient spread dropped from `useAppendTurn` (kit `dist/` rebuilt for the cross-package ones),
`NewChildThread`, `CommentPopover`, `useCompose` and `ThreadComposer`'s `clear`.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain)
- [ ] Committed with `[UI-108]` prefix
