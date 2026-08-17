# [UI-122] The designate menu offers a general resident first, and never dead-ends

## Domain

ui

## Status

done

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

- [x] A standalone thread offers designating a resident **with no profile**, in
      one gesture, whatever the agent-def directory holds
- [x] Profiles are offered alongside it when the directory has any
- [x] An **empty** directory no longer dead-ends: the general option is there,
      and the absence of profiles is stated without reading as an error or a
      misconfiguration
- [x] A directory that has **not answered yet** still offers nothing rather than
      an empty list that looks like a workspace with no agents — the existing
      rule in `residentActions.ts`, preserved (and sharpened: `agentDefRows`
      now answers `undefined` for an unanswered read instead of `[]`, so the
      offer stands while "No profiles yet" is withheld)
- [x] A thread with a **parent** offers neither, as today
- [x] Release is unchanged, and names the resident where there is a profile to
      name
- [x] The resident badge (`ResidentBadge`) reads a general resident honestly —
      it does not print a synthesised profile name, and does not read as "no
      resident"
- [x] The composer's recipient picker lists a general-resident lane and routes
      to it
- [x] Keyboard-operable throughout, matching the menu's existing contract

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

**Model:** opus (`claude-opus-5[1m]`) · ui-dev · 2026-08-17

### Setup

Real workspace server + real Vite dev server, on ports chosen to avoid the
user's live server (8765) and their ssh tunnel (5173):

- workspace: `corpus init` into a temp dir, `port` rewritten to **8843**;
  `data/` held **no** `type: agent-def` document — the reported case exactly
- server: `tsx apps/server/src/main.ts --workspace <tmp>`; `/api/health` → `200`
- UI: `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8843 VITE_CORPUS_TOKEN=<token>
  npm run dev -w apps/ui -- --port 5373 --strictPort`
- driven with a headless Chromium (throwaway Playwright script, deleted after)

### 1. Fresh workspace, no agent-defs — the reported defect

Right-clicked the standalone thread "Q3 planning". The menu carried, verbatim:

```
"collapse"                    "Collapse ‖ folds to one line — nothing is hidden"                                            [enabled]
"resolve"                     "Resolve ‖ status flip, committed"                                                            [enabled]
"resident-designate-general"  "Designate a resident ‖ no profile — owns this conversation and everything that grows out of it"  [enabled]
"resident-no-profiles"        "No profiles yet ‖ a resident does not need one — add a type: agent-def document to offer one here" [disabled]
```

Before this issue that menu held one item, disabled, reading *"no agent-def
documents in this workspace"*.

### 2. Designated with the keyboard alone

`ArrowDown ×3` → focus on `resident-designate-general` (asserted via
`document.activeElement`), then `Enter`. Result:

- toast: *"This conversation has a resident, with no profile — messages in this
  conversation and everything that grows out of it go to it."*
- badge: `data-resident-kind="general"`, text `resident, no profile | no
  listener yet`, title `resident, no profile — no listener yet`,
  `.t-resident-name` count **0** (no name slot at all)
- on disk, `data/threads/th_rrzodg4l.md` frontmatter:
  `resident:\n  name: null\n  docId: null`
- `GET /api/agents` lists the lane with
  `"resident": {"name": null, "docId": null}` and `origin.title: "Q3 planning"`
- no uncaught page errors

### 3. Composer recipient picker

```
lane "orchestrator"  "agent"        default=false
lane "th_rrzodg4l"   "Q3 planning"  default=true
statement: "Q3 planning will answer — no listener yet (default here)"
```

The general lane is listed, is the computed default for a message posted here
(§7), and is named by the conversation it owns — never by a word standing in
for a profile.

### 4. Add an agent-def, reopen the menu

`POST /api/docs {type: agent-def, title: researcher}`. The menu then read, on a
thread whose resident was general:

```
"resident-release"                  "Release the resident ‖ back to ordinary routing — nothing already queued moves"
"resident-designate-doc_vifl2ia7"   "Replace with researcher ‖ owns this conversation and everything that grows out of it"
```

`resident-no-profiles` was gone, and `resident-designate-general` was not
re-offered to a conversation that already has one. After releasing:

```
"resident-designate-general"        "Designate a resident ‖ no profile — …"
"resident-designate-doc_vifl2ia7"   "Designate researcher ‖ …"
```

Designating `researcher` gave `data-resident-kind="profiled"`, badge text
`researcher | no listener yet`, and the menu then read `Release researcher` /
`Replace with a general resident`.

### 5. Profile renamed after designation (§7's third `Resident` shape)

Renamed `.claude/agents/researcher.md` → `retired-researcher.md` (title too) and
let the watcher reconcile. `GET /api/agents` answered
`"resident": {"name": "researcher", "docId": null}`, and the badge reported it
rather than substituting:

```
kind:  profile-gone
text:  researcher | its profile is gone — renamed or archived since | no listener yet
title: researcher — its profile is gone — renamed or archived since — no listener yet
menu:  "Release researcher" / "Replace with a general resident" / "Replace with retired-researcher"
```

### 6. Release and resolve

Release → `DELETE …/resident`, badge gone. Resolving a designated conversation
took the badge and the lane with it (§7), badge count 0.

### 7. Teardown

Both processes killed; `lsof` reports **5373 free** and **8843 free**. The
user's server on 8765 was never touched and is still listening.

### Automated suites

- `vitest run apps/ui/src` — **3134 passed** (148 files)
- `vitest run packages/kit/src` — **866 passed** (55 files)
- `playwright test` (full suite, `CORPUS_UI_PORT=5373`) — **399 passed, 2
  failed**. Both failures are `console.spec.ts:127` and `smoke.spec.ts:241`,
  which assert the console strip reads *"server unreachable"* with nothing
  listening on **8765** — the user's live server is up on that port on this
  machine, so those two are unrunnable here and are unrelated to this change.
- `eslint apps/ui packages/kit` clean; `prettier --check` clean;
  `tsc --noEmit` clean in both workspaces.

### Falsification

Disabling the general offer in `residentActions` (`if (false && …)`) turned
**5 of the 6** specs in `apps/ui/e2e/resident.spec.ts` red, including the
keyboard one and the recipient-picker one; the sixth is the parented-thread
test, which asserts the offer's absence. The spec therefore fails on the defect
it was written for.

**`stubCorpus` had no handler for `POST`/`DELETE /api/threads/{id}/resident`
at all** — every designation any spec had ever sent was answered `200 {}` by the
untyped fallback (the UI-116 trap). One was added, modelling all three
`Resident` shapes plus the `404` for an unresolvable name, and resolve now
releases the lane as §7 requires.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-122]` prefix
