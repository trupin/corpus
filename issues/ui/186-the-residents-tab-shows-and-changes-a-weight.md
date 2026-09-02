# [UI-186] The Residents tab says "weight set at launch" and never what it launched at, and cannot change it

## Domain

ui

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: `AGENT-059` (the launch now records the weight it went out at, so
  there is something true to show)
- Related: `AGENT-063` (a judged pick is safe because this makes it correctable),
  `SHARED-076` (the §7 rider that permits the change), `UI-185`

## Spec References

- SPEC.md **§7** — *"A dispatch says what weight it went out at, and where that
  weight came from"*
- SPEC.md **§7** — the resident rider signed 2026-08-19, as amended by
  `SHARED-076`
- SPEC.md **§10** — the console

## Summary

**User directive, 2026-09-02:** *"maybe we make it possible to change a
resident's model from the residents tab. That would make the mistake less of a
problem."*

The console's Residents tab (`apps/ui/src/console/Residents.tsx`,
`residentsModel.ts`) lists every lane, its resident, liveness and scope. It is
**read-only**, and its weight column has a hole.

**It prints "weight set at launch" and stops.** `laneWeightLabel` returns
`LAUNCH_WEIGHT_CLAUSE` whenever `row.weight` is `null` — a designation that
stated no level. That sentence is true and useless: it says *the launcher chose*
without saying **what it chose**. A person looking at a lapsed resident, last
seen three days ago, cannot find out what it ran as.

**That is the same blind spot that started this whole line of work.** The
operator who reported `AGENT-059` found out their conversations were on Sonnet by
asking their agent, because no surface said so. `AGENT-059` fixed the *log*. This
is the surface.

## Acceptance Criteria

- [x] A lane whose designation stated no weight shows **what the launch actually
      went out at**, not only that the launcher chose. Where the launch recorded
      nothing, it says so plainly rather than guessing — §10's standing rule that
      an unknown says so beats a plausible attribution
- [x] A lane whose designation **stated** a weight still shows that level, as it
      does now, and the two cases are distinguishable: a level somebody asked for
      is not the same fact as a level the launcher picked
- [x] The weight can be **changed from this tab**, on a designated lane
- [x] Changing it uses the re-designation that already exists — the server
      releases the current listener with reason `replaced` and launches a new one
      at the new weight. **No second mechanism.**
- [x] The levels offered are the workspace's own declared table
      (`useWeightLevels`), including the explicit *"the launcher decides"* member,
      worded as `residentActions.ts` already words it. A workspace declaring no
      levels offers no change control
- [x] The person is told what changing costs before it happens: the running
      listener is replaced and anything it held that the conversation does not
      record is lost. The conversation itself is not
- [x] A lane with no resident, and the unscoped orchestrator lane, offer no
      weight control — there is no designation to change

## Technical Design

### Files to Create/Modify

- `apps/ui/src/console/residentsModel.ts` — `laneWeightLabel` and the row model
- `apps/ui/src/console/Residents.tsx` — the control
- `apps/ui/src/console/console.css` — `.lane-weight` is a **fixed reservation**
  (UI-131) and will not grow to hold a longer string; read that comment before
  changing what the column prints
- Possibly `packages/kit/src/address/addressModel.ts` — `LAUNCH_WEIGHT_CLAUSE`
  is shared, so changing its meaning changes other surfaces. Prefer a new
  constant over redefining that one

### Notes

- **Do not invent a weight vocabulary.** SHARED-022 Decision 1: the skill's table
  is the one declaration. `residentActions.ts`'s `weightOptions` is the pattern.
- **Where does the launched model come from?** `AGENT-059` logs it on the
  designation's own event, and §7 makes a job log runtime state reaped with its
  event. So a lapsed three-day-old lane may have no log left. Decide what the
  tab shows then, and say it in the issue log — this is exactly the case the
  screenshot that prompted the issue was showing.

## Testing Strategy

Component tests over the tab: a stated weight, a null weight with a recorded
launch, a null weight with nothing recorded, a lane with no resident. A browser
spec that changes a weight and asserts the re-designation on the wire. Falsify by
removing the weight from the submitted re-designation and watching the wire
assertion fail.

## E2E Verification Log

_Filled by the implementing agent; state the model._

**Pre-fix observation, 2026-09-02 (user screenshot):** the Residents tab showing
four lanes, three reading `weight set at launch`, one resident `lapsed` and
`last seen 3d 09h ago`. What any of them ran as is not on the screen.

### Implemented 2026-09-02 — ui-dev on **Opus 5 (1M context)**

**Where the launched level comes from, and what the tab does when it is gone.**

`AGENT-059` logs the launch on the designation's own queue event, as free prose
in `.corpus/jobs/<eventId>.jsonl` — `(Opus 5 — defaulted: no weight chosen,
strongest declared tier)` against `(Opus 5 — stated at designation: heavy)`.
Nothing else can answer the question: `AgentLane`/`Resident` carry no launch
field, `AGENT-063` makes the launcher's pick a **judgment** rather than a rule,
and §10's signed non-goal keeps model names out of the UI's own vocabulary. So
the tab **reads** the record and never derives one.

It reads it through two queries, for the **selected** lane only — the discipline
`useThreadScope` already follows on this pane: `GET /api/jobs?originId=<lane>`
finds the newest `resident.designated` event (an `originId` answer is complete
rather than windowed, §9.2's rider), then `GET /api/jobs/{id}/log` is scanned for
the parenthesised clause carrying one of AGENT-059's two provenance words. The
clause is shown **verbatim**; it is never split, mapped, or reworded.

**Decision, where the record is gone.** §7 makes a job's log runtime state reaped
with its event, and a lane may also have been designated before AGENT-059 ever
logged one — the drill below found a third route to the same state: a standalone
thread created by a person is given a general resident **with no designation
event at all**, so a very common lane has never had a launch record. All three
are indistinguishable from the client and none licenses a guess. The tab says
`LAUNCH_UNRECORDED_NOTE` — it names the absence, names its cause, and states that
nothing was substituted — which is §10's standing rule (*"an unknown that says so
is worth more than a plausible attribution nobody can check"*). A read that has
**not answered** is a fourth state and says so separately; a read that **failed**
is a fifth and keeps the server's message. Neither is ever reported as an
absence (UI-098).

**The four cases the tab shows.**

| case | what the pane says |
| --- | --- |
| designation **stated** a level | `Stated at designation: Heavy or judgment-laden.` (plus the launch clause when one exists — a stated level that could not be met is launched at another and logged, §7) |
| `null`, launch **recorded** | `No level was stated, so the launcher decides. The launch recorded: Opus 5 — defaulted: no weight chosen, strongest declared tier.` |
| `null`, **nothing** recorded | `No level was stated, so the launcher decides. No launch record for this designation is on the queue — a job's log is runtime state, reaped with its event — so what it went out at is unknown here. Nothing is guessed in its place.` |
| no resident (orchestrator, `unknown`) | nothing at all — no panel, and no request issued for a lane there is nothing to ask about |

**The `.lane-weight` trap (UI-131).** The reserved 24ch box was **not touched**.
The launch clause is unbounded agent prose arriving two round trips late, so it
could never go in that box, and widening it would have re-cut every lane's name
in the list for a value one lane at a time has. The whole answer lives in the
detail pane as a wrapping sentence. Measured in the browser below: both lanes'
weight boxes are **158.94px**, identical, before and after a change.

**`LAUNCH_WEIGHT_CLAUSE` was not redefined.** It still reads *"weight set at
launch"* on every surface that shares it, including this tab's list. The new
wording is new constants in `residentsModel.ts`.

**Changing it.** `useSetResident` with the resident already in force and a new
weight — the same write the conversation's own menu makes. No new route, no new
hook, no second mechanism. `LAUNCHER_DECIDES_LABEL` is imported from
`residentActions.ts` rather than reworded.

**Three lanes are offered no control, for three reasons.** The orchestrator's
lane and an `unknown` row have no designation (no panel at all). A
**`profile-gone`** lane has one that cannot be written — a re-designation names
the profile and `residentFor` answers `404` for a name that no longer resolves —
so it gets the sentence and `WEIGHT_CHANGE_NEEDS_PROFILE` instead of an offer
that could only fail. A workspace declaring **no levels** gets the sentence and
no control, exactly as the thread menu and Ask behave.

**The cost, and a budget decision.** SHARED-076 requires the act to say what it
costs before it is taken. It is said in the pane, above the press — never in a
dialog the press summons. It appears when a level **different from the one in
force** is chosen, which is exactly when the act becomes available. That was
measured rather than preferred: the drawer is 210px by default, and a
permanently rendered cost paragraph made the panel **194px and left the lane's
scope list 12px**. At rest the panel is **108px** and the scope list **66px**.

### Real running app, 2026-09-02

A real workspace and a real server, never port 8765: `corpus init` →
`corpus server start` on **127.0.0.1:8767**, and Vite on **127.0.0.1:5273** with
`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8767`. Driven with a real Chromium.

Seeded:

- `th_tmvvskls` "Pricing rework" — released, then `corpus thread designate` with
  no `--weight`, which enqueued `evt_l5oxri4xfv5m` (`resident.designated`).
  `corpus job log evt_l5oxri4xfv5m "launched a converse listener on th_tmvvskls —
  a general resident (Opus 5 — defaulted: no weight chosen, strongest declared
  tier)"` wrote the real launch record to
  `.corpus/jobs/evt_l5oxri4xfv5m.jsonl`.
- `th_vbhz72sf` "Q3 planning" — a plain `corpus thread create`, which gives a
  general resident with `weight: null` **and no designation event**. The
  no-record case, produced by the ordinary path rather than by contrivance.

Observed in the browser:

```
LANES: orchestrator "agent · waiting"
       th_tmvvskls "Pricing rework · weight set at launch · waiting"
       th_vbhz72sf "Q3 planning · weight set at launch · waiting"
ORCHESTRATOR panel present: 0

th_tmvvskls note: "No level was stated, so the launcher decides. The launch
  recorded: Opus 5 — defaulted: no weight chosen, strongest declared tier."
th_vbhz72sf note: "No level was stated, so the launcher decides. No launch
  record for this designation is on the queue — a job's log is runtime state,
  reaped with its event — so what it went out at is unknown here. Nothing is
  guessed in its place."

options (read from this workspace's own installed orchestrate skill):
  ["the launcher decides","Small and mechanical","Standard","Heavy or judgment-laden"]
apply disabled at rest: true
```

Then: selected **Heavy or judgment-laden** on `th_vbhz72sf` and pressed.

```
WIRE:  POST /api/threads/th_vbhz72sf/resident  {"weight":"heavy"}
TOAST: "Re-designated at Heavy or judgment-laden — the previous listener is
        released, and a new one launches on this conversation."
NOTE AFTER: "Stated at designation: Heavy or judgment-laden."
WEIGHT BOX AFTER: "Heavy or judgment-laden"
LANE WEIGHT BOX WIDTHS: 158.9375  158.9375   (unchanged, both lanes)
```

On disk, in the real workspace — the mechanism the criterion demands, and
nothing else:

```
data/threads/th_vbhz72sf.md
  resident:
    name: null
    docId: null
    weight: heavy
    designationId: des_7lkd64cihwgy      (a new id: a different designation)

.corpus/queue/pending/
  evt_sw7yrczhdenb  resident.released    th_vbhz72sf  reason=replaced
  evt_6fr7cv5xqtyj  resident.designated  th_vbhz72sf  weight=heavy

git log
  27806dd resident designate: general resident on Q3 planning (th_vbhz72sf) by user
```

### Falsification

Removed `weight: chosen` from the submitted re-designation in `LaneWeight.tsx`
(`{ id: row.lane, designate: row.profile }`) and re-ran.

- **e2e** `resident-weight-change.spec.ts`: `PASS (4) FAIL (1)` — *"changes the
  weight by re-designating the thread at the level chosen"* failed on
  `expect(write?.body).toEqual({ weight: "heavy" })`.
- **unit** `Residents.test.tsx`: 3 failed / 30 passed — the general
  re-designation, the profiled one, and the roster read-back after it.
- The one test that stayed green under the mutation is *"clears a stated level
  back to the launcher's choice, as an absent key"*, which is correct: dropping
  the weight **is** what clearing sends. That it did not move is the check that
  the other three moved for the right reason.

Restored, and all green again.

### Checks

- `./node_modules/.bin/vitest run apps/ui packages/kit` — **251 files, 5114
  tests, all passing** (`VITEST_MAX_THREADS=4`).
- `CORPUS_UI_PORT=5273 npx playwright test e2e/resident-weight-change.spec.ts
  e2e/residents-tab.spec.ts e2e/resident-weight-geometry.spec.ts
  e2e/resident.spec.ts e2e/console.spec.ts` — **PASS (42) FAIL (0)**.
- `npm run lint`, `prettier --check`, `tsc --noEmit -p apps/ui` — all clean.
- `npm run build` before every browser run, per the kit-`dist` rule.

### Unresolved

- **`SHARED-076` is still `todo`.** This control does what §7's 2026-08-19 rider
  says is impossible, and the rider correcting it is drafted but **not signed**.
  Nothing here should merge ahead of that signature — a reviewer reading §7 alone
  will reject this correctly.
- **A roster relaunch's record is not read.** AGENT-059 also logs a launch on the
  `lane.waiting` event the orchestrator claimed, when it restarts a lapsed
  listener. This reads the **designation's own** event only, which is the event
  the criterion names and one request rather than a scan. A lane relaunched after
  a lapse therefore shows the original launch, which is the designation's record
  and is not wrong — but it is not the newest launch. Worth a follow-up if it
  bites.
- **The clause is agent prose, matched on AGENT-059's two provenance words.** A
  workspace whose guidance stops logging in that shape reads as *no record*
  rather than as something wrong, which is the safe direction — but it is a
  coupling to a skill's wording, and a structured field on the wire would remove
  it. Not filed; raise it if the shape drifts.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
