# [UI-168] A resident's weight cannot be chosen from the app at all

## Domain
ui

## Status
todo

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

- [ ] `useResident`'s mutation carries an optional `weight`, and passes it to the
      published request field.
- [ ] The designation menu offers the workspace's levels, from
      `weightLevels.ts`. **No second vocabulary**, and no model name anywhere.
- [ ] **Omitting it stays possible and stays the ordinary case.** The contract
      makes the field optional so that absence means what it meant before the
      field existed — the launcher decides. A picker with no "leave it to the
      launcher" option would make every UI designation opinionated.
- [ ] The weight a resident was designated at is **shown** wherever the resident
      is shown. `Resident.weight` was put on the response rather than left
      write-only for exactly this reason: _"a surface that shows who is resident
      must show what it runs at, or the choice is invisible once made."_ Check
      the board badge, the composer's recipient row and the thread panel, and
      say in the log which of them already do and which do not.
- [ ] A workspace whose tier table is empty or unreadable offers no picker and
      still designates. The level list is the workspace's own, so it can be
      absent.
- [ ] Re-designating at a different weight is the act the server already
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
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
