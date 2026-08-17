# [UI-122] The designate menu offers a general resident first, and never dead-ends

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-061, SERVER-121
- Blocks: —
- Related: UI-109 (the board's resident badge, which must read a general
  resident too)

## Spec References

- SPEC.md **§7** — the SHARED-048 rider: *"Naming none is the ordinary case and
  requires nothing to exist first; naming a profile is how a conversation gets
  an agent that behaves differently from the default."*
- SPEC.md **§11** — the conversation's menu, and *"exactly that item's existing
  actions"*

## Summary

Right-clicking a standalone thread offers **"Designate a resident"** whose
submenu is the workspace's agent-def directory, and in a fresh workspace that
directory is empty, so the menu says *"no agent-def documents in this
workspace"* and there is nothing to do. Reported by the user 2026-08-17: the
feature v0.10.0 is named for cannot be reached from the UI at all.

With a profile now optional, the menu leads with the act itself and offers
profiles as the refinement.

## Acceptance Criteria

- [ ] A standalone thread offers designating a resident **with no profile**, in
      one gesture, whatever the agent-def directory holds
- [ ] Profiles are offered alongside it when the directory has any
- [ ] An **empty** directory no longer dead-ends: the general option is there,
      and the absence of profiles is stated without reading as an error or a
      misconfiguration
- [ ] A directory that has **not answered yet** still offers nothing rather than
      an empty list that looks like a workspace with no agents — the existing
      rule in `residentActions.ts`, preserved
- [ ] A thread with a **parent** offers neither, as today
- [ ] Release is unchanged, and names the resident where there is a profile to
      name
- [ ] The resident badge (`ResidentBadge`) reads a general resident honestly —
      it does not print a synthesised profile name, and does not read as "no
      resident"
- [ ] The composer's recipient picker lists a general-resident lane and routes
      to it
- [ ] Keyboard-operable throughout, matching the menu's existing contract

## Technical Design

### Files to Create/Modify

- `apps/ui/src/thread/residentActions.ts` — the action list and
  `NO_AGENT_DEFS`
- `apps/ui/src/thread/ThreadMenuItems.tsx` — the menu body
- `apps/ui/src/thread/ThreadPanel.tsx` — the mutation (stays on the panel, per
  the existing note about `SettledCallbacks` and unmounting menus)
- `apps/ui/src/thread/ResidentBadge.tsx` — the general-resident reading
- `packages/kit/src/recipient/laneRows.ts` — the recipient row for a general lane

### Key Implementation Details

**Take the vocabulary from the contract, not from the component.** Whatever
CONTRACT-061 chose is what the badge, the menu and the recipient row all read.
If the UI needs a *word* for a general resident, that word is written in one
place and imported — three components inventing three labels for one state is
the defect class this phase exists to remove.

**`NO_AGENT_DEFS` stops being a dead end and may stop being a message at all.**
It currently substitutes for the whole offer. Now the offer exists regardless,
so decide whether the absence of profiles is worth saying and record why.

**Do not fake a name.** A general resident has no profile; a badge printing
`agent` or `general` beside real profile names is the trap CONTRACT-061 was
shaped to avoid.

### Edge Cases

- The roster has not answered — distinguish from "answered, no resident"
  (UI-098's rule: unknown is not absent)
- Designating while a previous designation is in flight
- A profile archived after designation — §7 says the designation survives and
  the missing profile is reported, not silently substituted

## Testing Strategy

Component tests for: empty directory offers the general action, populated
directory offers both, unanswered directory offers nothing, parented thread
offers neither, badge rendering for general vs profiled vs none vs unknown.
E2E in `apps/ui/e2e/`: designate a general resident on a real standalone thread
through the real menu and see the badge and the recipient row change.
**Check `stubCorpus` has a real handler for every route this touches** before
trusting a green run — its `{}` fallback answers routes nobody wrote a handler
for (UI-116).

## E2E Verification Plan

### Verification Steps

1. Real server + real UI, ports not 8765 / not 5173 (`CORPUS_UI_PORT` set)
2. Fresh workspace with **no** agent-defs: right-click a standalone thread,
   designate a general resident, observe the badge
3. Add an agent-def, reopen the menu, observe both options
4. Open a composer in the thread and confirm the recipient picker lists the lane
5. Resolve the thread and confirm the badge and the lane go
6. Stop both processes; confirm the ports are free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-122]` prefix
