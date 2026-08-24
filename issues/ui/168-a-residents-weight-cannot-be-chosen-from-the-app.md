# [UI-168] A resident's weight cannot be chosen from the app at all

## Domain
ui

## Status
done

## Priority
P0 (critical path)

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md Section 7 — rider signed 2026-08-19: _"A resident's weight is set when
  it is designated, not per message."_
- SPEC.md Section 10 — "UI — the board", and §10's signed non-goal: **no model
  names in the UI**

## Summary

**Reported by the user, 2026-08-23**:

> I'm still not confident I can pick the model when attaching a resident.

**The confidence is well placed. The app cannot do it.** Traced on the branch:

| layer | carries `weight` on designation |
| --- | --- |
| `SPEC.md` §7, rider signed 2026-08-19 | yes — the designation is the *only* place the choice exists |
| `DesignateResidentRequestSchema` (CONTRACT-067) | yes, optional |
| the server (SERVER-129) | yes |
| `corpus resident` (CLI-053) | yes |
| **`packages/kit`'s `useResident`** | **no** — its mutation takes `{ id, designate: string \| null }` |
| **the UI** | **no** — nothing to send |

So the field exists on the wire, the server honours it, the agent can set it
from the CLI, and **a person using the app cannot.** Every designation made from
the UI sends no weight, which means "the launcher decides", and
`Resident.weight` reads null forever.

## The vocabulary already exists and is not model names

This is worth stating because the fix looks like it collides with a signed
non-goal, and it does not.

`weight` is **a level's key from the workspace's own tier table**, never a model
name — that is how §10's "no model names in the UI" holds by construction. The
composer already has a picker over exactly this vocabulary
(`packages/kit/src/recipient/weightLevels.ts`), because a message carries a
weight too. **The same picker, in the designation, is the whole feature.**

So the honest framing of the user's words: they cannot pick the model, and they
should not be picking a model — they should be picking a **level**, and the app
offers no way to.

## Acceptance Criteria

- [x] `useResident`'s mutation carries an optional `weight`, and passes it to the
      published request field.
- [x] The designation menu offers the workspace's levels, from
      `weightLevels.ts`. **No second vocabulary**, and no model name anywhere.
- [x] **Omitting it stays possible and stays the ordinary case.** The contract
      makes the field optional so that absence means what it meant before the
      field existed — the launcher decides. A picker with no "leave it to the
      launcher" option would make every UI designation opinionated.
- [x] The weight a resident was designated at is **shown** wherever the resident
      is shown. `Resident.weight` was put on the response rather than left
      write-only for exactly this reason: _"a surface that shows who is resident
      must show what it runs at, or the choice is invisible once made."_ Check
      the board badge, the composer's recipient row and the thread panel, and
      say in the log which of them already do and which do not.
- [x] A workspace whose tier table is empty or unreadable offers no picker and
      still designates. The level list is the workspace's own, so it can be
      absent.
- [x] Re-designating at a different weight is the act the server already
      supports — check `resident.ts:251`, which handles precisely that — so the
      UI must not treat "same profile, new weight" as a no-op.

## Technical Design

### Files to Create/Modify
- `packages/kit/src/query/useResident.ts` — the field
- `apps/ui/src/thread/residentActions.ts`, `ThreadMenuItems.tsx`,
  `ThreadPanel.tsx` — the offer and the call
- whichever resident-showing surfaces turn out not to report the weight
- the tests beside each

### Key Implementation Details

**Read `RESIDENT_WEIGHT_BOUNDARY` before writing any prose.** The contract states
once what a resident's weight governs — and specifically that a weight on a
*message* reaching a resident's lane governs any stage the resident **hands
off**, never the resident's own turn. That sentence is published verbatim at two
sites already, and CONTRACT-064 records what happened when a rule like it was
restated at eight. Reuse it; do not paraphrase it into a tooltip.

**Rebuild kit before believing any browser evidence.** `packages/kit` changes are
invisible until `npm run build -w packages/kit`, and that has produced three
false negatives in one release in this repo.

### Edge Cases
- A resident designated before this shipped: `weight` is null, and the surface
  must say "the launcher decides" rather than showing a blank.
- A level key that no longer exists in the workspace's table, because the table
  is the workspace's own and it can be edited.
- A general resident (no profile) with a weight — an ordinary state the contract
  names explicitly, so the picker must not require a profile first.

## Testing Strategy

Kit tests: the mutation sends `weight` when given and omits the key entirely when
not — **omitted, not null**, since absence is the meaning. UI tests: the picker
lists the workspace's levels, choosing one sends it in the same request as the
designation, and choosing nothing sends a body without the key.

**Falsify**: drop `weight` on the way through the hook and watch the request
assertion fail. A test asserting only "a designation was sent" would pass
throughout this defect — which is what the current suite does.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Designate a resident on a standalone thread from the app
2. Inspect the request, and read `Resident.weight` back
3. Expected: the weight chosen
4. Actual: no `weight` key is sent and `Resident.weight` is null, on every
   designation the app has ever made

### Verification Steps
1. Designate with a level chosen, and confirm the request carries it and the
   surface reports it
2. Designate with nothing chosen, and confirm the request omits the key
3. Re-designate the same profile at a different level and confirm it takes
4. `corpus resident show` agrees with what the app displays

## E2E Verification Log

### Reproduction (bugs only)
Traced on the branch 2026-08-23 by the orchestrator: `useResident`'s mutation
signature is `{ id: string; designate: string | null }`. No caller in `apps/ui`
mentions `weight`, and `grep -rn weight` over the thread menu files returns
nothing.

### Post-Implementation Verification

**Model: Opus 5 (1M context).** Verified 2026-08-23 on `phase-44-reach-and-size`.

#### What changed

- **`packages/kit`.** `ResidentVariables`'s designate branch gains
  `weight?: string | undefined`. `designationBody()` is the one seam that turns
  both "no profile" and "no level" into **absent keys** — built by conditional
  spread, never by assignment, so `exactOptionalPropertyTypes` cannot let a
  `{weight: undefined}` become a real key later.
  `CorpusClient.designateResident(threadId, input?: DesignateResidentRequest)`
  now takes the whole body rather than a name, and sends `input ?? {}`.
- **`residentActions.ts`.** A radio set after the acts:
  `resident-weight-launch` (*the launcher decides*) plus one row per declared
  level. Every row is `keepOpen`, because a row states what the act **above**
  will send. Each act names the level it will send in its meta, and nothing at
  all where none is chosen.
- **`ThreadMenuItems.tsx`** reads `useWeightLevels()` — the same projection read
  every composer's weight control uses — and holds the choice in `useState` that
  dies with the menu. Deliberately **not** `weightChoice.ts`, which remembers a
  *message's* weight per conversation.
- **`menuModel.ts` / `MenuItems.tsx` / `useRovingMenu.ts`.** `MenuAction.checked`
  makes an item a `menuitemradio` with `aria-checked`; the roving selector was
  widened so the rows are arrow-reachable. `menu.css` draws the state from the
  same attribute assistive technology reads, in a gutter present on every row of
  the set so nothing shifts sideways as the choice moves.
- **`ResidentBadge.tsx`** reports the weight, through the console's own
  `laneWeightLabel` rather than a second derivation.

#### The no-op skips now compare three fields, not two

`threads/resident.ts` writes on a weight change (`chosen = weight ?? null`), so
omitting the level on a re-designation **clears** it. The menu therefore compares
`(chosen ?? null) === resident.weight` alongside the profile, and says
`Re-designate researcher` — never `Replace with`, which would describe a swap
that displaces nobody.

A consequence found in the browser and fixed: an untouched menu now opens showing
**what the resident runs at now** rather than always at *the launcher decides*.
Seeding from nothing made "same profile, launcher's choice" a real write on every
resident with a level, so merely opening the menu offered to re-designate the
profile already there. It is also the third surface that reports the choice.

#### Which surfaces already reported the weight, and which did not

Measured in a real browser after designating `researcher` at `heavy`:

| surface | before | evidence |
| --- | --- | --- |
| composer's address **line** | **already did** | `researcher will answer · Heavy or judgment-laden` |
| composer's address **popover** | **already did** | `researcher works at Heavy or judgment-laden — a weight set here would govern only what researcher hands off` |
| console **Residents** pane | **already did** | `laneWeightLabel` / `laneRowTitle`, `LaneList` + `LaneScope` |
| **board / thread-panel badge** | **did not** | now `researcher · Heavy or judgment-laden · no listener yet`, `data-resident-weight="heavy"` |
| thread **menu** | **did not** | now the checked radio row |
| composer's recipient **lane rows** | did not, and still does not | `['agent', 'researcher']` — the rows answer *who*; the line and the sentence beside them answer *at what*. Left alone deliberately. |

A resident with `weight: null` reads `weight set at launch` — the composer's own
`LAUNCH_WEIGHT_CLAUSE` — never a blank.

#### `RESIDENT_WEIGHT_BOUNDARY`: read, and deliberately not restated

The constant was read before any prose was written. **No new site was added**,
and this is a decision rather than an oversight. The sentence is about a weight
stated on a *message* reaching a resident's lane — a composer's question, already
answered where a person reaches for a message weight
(`addressModel.residentWeightSentence`, quoted in the table above). Nothing in
the designation menu asks it, and CONTRACT-064 records what a rule restated at
eight sites does. The rows say the minimum true thing instead: *"the level this
resident is designated at"*.

#### Real-browser walk (Playwright, `e2e/resident.spec.ts`, Chromium, 18/18)

1. **A level chosen.** Seeded the workspace's orchestrate skill with a three-row
   tier table. The menu offered `Weight — Small and mechanical` /
   `Weight — Standard` / `Weight — Heavy or judgment-laden` — the declared
   **labels**, and the whole menu matched no `/haiku|sonnet|opus/i`. Pressing
   *heavy* left the menu **open**, set `aria-checked="true"`, and rewrote the
   act's meta to `… — at Heavy or judgment-laden`. Designating sent
   **`{"weight":"heavy"}`** and the badge repainted
   `Heavy or judgment-laden`.
2. **Nothing chosen.** Same workspace, straight to the act:
   `Object.keys(body) === []`. Omitted, not null. Badge reads
   `weight set at launch`.
3. **Re-designation.** researcher at `light` → reopening shows `light` checked
   and does **not** re-offer researcher; pressing `heavy` re-offers it as
   `Re-designate researcher`; sending gives
   `[{name:"researcher",weight:"light"}, {name:"researcher",weight:"heavy"}]`.
   Then back to the launcher's row → `{name:"researcher"}`, and the badge returns
   to `weight set at launch`.
4. **A workspace that declares nothing.** No `menuitemradio` at all, and the
   designation still lands with `{}`.

#### Falsifications

- **Drop the weight in the hook** (`designationBody`'s spread removed): the two
  new kit tests fail — `body: {}` against `body: {weight: "light"}`. The three
  pre-existing tests still pass, which is exactly the issue's point: a test
  asserting only *"a designation was sent"* passes throughout this defect.
- **The same mutation, with `npm run build -w packages/kit` so `dist/` really
  changed** (the trap in this repo's domain notes): two Playwright tests go red
  in a real browser. `grep` confirmed the mutation reached
  `packages/kit/dist/query/useResident.js` before the run, and confirmed its
  restoration after.

#### Commands, with their real output

```
npm run build                                          # clean
eslint apps/ui packages/kit                            # clean
prettier --check .                                     # clean for apps/ui + packages/kit
npm run typecheck -w apps/ui -w packages/kit \
                  -w packages/contract                 # clean
VITEST_MAX_THREADS=4 vitest run apps/ui packages/kit   # 242 files, 4681 passed
playwright … e2e/address-geometry.spec.ts --workers=1  # 24 passed (46.0s)
playwright … 13 specs --workers=1                      # 137 passed (3.6m), EXIT=0
```

The 13 e2e specs are the ones that touch a thread card's head, the resident
badge, a menu, or composer geometry: `resident`, `residents-tab`,
`resident-weight-geometry`, `recipient`, `weight`, `collapse`, `thread`,
`context-menu`, `menu-room-geometry`, `comments-tab`, `digit-geometry`,
`turn-comment`, `anchor-layer`.

**The whole 617-test suite was started three times and finished none of them**:
this laptop is shared with other agents and one worker was managing about ten
tests per five minutes, which projects past four hours. Scoped runs are what this
agent is told to do; the single repo-wide run is the orchestrator's at harvest.
`apps/server` and `apps/cli` are red on typecheck for a reason that is not this
work — see the `designationId` note in UI-168.

#### A regression the badge caused, measured and fixed

Adding the clause to the badge broke
`e2e/address-geometry.spec.ts`'s *"the weight clause arriving late moves neither
the line nor Send"*: the reply composer's line and its Send button both moved
**26px down** while somebody could already be typing in it.

The cause is the one `console.css` documents. The roster names the level **key**;
the words are the workspace's own and need `useWeightLevels`'s `?type=skill` scan
plus a `useDoc` for the body, so `weightLabel` renders the bare key until both
land — and the label arriving widened the badge enough to wrap `.t-head`.

Measured in a real browser, a 410px card at 1280×720, `.t-head`'s height:

| what is drawn | height |
| --- | --- |
| everything | 79px |
| the weight clause hidden | 50.8px |
| the weight clause **and** the `⋯` hidden | 50.8px |
| the whole badge hidden | 24.8px |

Two readings, and both matter. **UI-167's `⋯` costs zero height** — the negative
block margins it shares with the fold do exactly what they were written for.
**The weight clause costs a whole wrapped row**, and before the fix it appeared
late.

The fix is `console.css`'s `.lane-weight` pattern, which that file names as the
one *"the next late-arriving value copies"* and lists this badge among the sites
that should reach for it: a fixed `width` in `ch`, ellipsis, whole value on the
`title`. **26ch** — the console's 24ch against the same vocabulary, plus 2ch for
the `· ` lead this clause carries inside its box and the console's row does not.
`address-geometry.spec.ts` is 24/24 after it.

**One tradeoff worth the orchestrator's eye.** The reservation is ~164px, and on
a card narrow enough it takes a row of the head to itself — permanently, on every
conversation with a resident. The head is `flex-wrap: wrap` by design, so that is
the head behaving as built, and the row is now the same height before and after
the answer arrives. But the same card already states the weight a few lines lower
in the composer's address line (`researcher will answer · Heavy or
judgment-laden`), so this is the second statement of it on one card. It is here
because the acceptance criterion asks for it *wherever the resident is shown*, and
because `Resident.weight` was put on the response for that reason. If the density
is judged the worse trade, it is one CSS rule to drop and the measurement above is
what the decision needs.

#### A level the guidance stopped declaring

Found while reading the browser evidence rather than the code. The table is the
workspace's own and can be edited under a standing designation, and the menu now
seeds from `Resident.weight` — so a recorded key the tier table no longer lists
would have left the radio set with **nothing** checked and the acts naming no
level while sending one. The rows therefore carry the standing choice as its own
key when the guidance dropped it, exactly as the composer's `weightOptions`
does, and say so in the composer's own words. Asserted in
`residentActions.test.ts`.

#### Picked up mid-session: `Resident.designationId` (CONTRACT-071)

A parallel agent added a **required** nullable `designationId` to
`ResidentSchema` and rebuilt `packages/contract/dist` while this work was in
flight. Every `Resident` literal in the tree stopped compiling. Within this
agent's domain that was 27 fixtures in `apps/ui` and 17 in `packages/kit`, plus
`e2e/stubCorpus.ts` and `src/testing/readerFixture.ts`, which mint residents.

All of them now carry `designationId: null`, which is the honest value: nothing
in `apps/ui` or `packages/kit` reads the field — it exists for a listener
comparing the id it was launched with against the id in force — and a stub that
minted ids nobody compares would be modelling a mechanism it cannot exercise.
`apps/ui`, `packages/kit` and `packages/contract` typecheck clean.

**`apps/server` and `apps/cli` still do not**, and that is outside this domain.
Escalated to the orchestrator rather than fixed here.

#### Not done

The **CLI cross-check** (`corpus resident show` agreeing with the app) was not
run. `npm run e2e` cannot reach a workspace server at all (INFRA-028 — Vite
starts with no proxy target), so that check needs a real `corpus init` workspace
and a real server, which is outside what this agent may start beside the user's
own on 8765. Everything above `fetch` is the real application; the stub's
resident route stores and echoes `weight` verbatim, which was checked before the
run rather than assumed.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
