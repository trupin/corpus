# [UI-160] A kanban's status chip may be decided by a different board

## Domain
ui

## Priority
P2

## Status
done

## Model
opus

## Dependencies
- Depends on: UI-152, SERVER-138

## Spec References
- SPEC.md §5 — "while a document is in a kanban, its stage decides its status"
- SPEC.md §10 — the kanban bullet

## Summary

Raised by the agent that added the `→ open` chip under PR #58's second review,
against its own work rather than someone else's.

**The deciding board is the lowest-`order` kanban that claims the document, and
that need not be the board you are dragging on.** SERVER-138 settled it that
way, and says which board decided in its warning. So every status chip a kanban
column draws — the `→ resolved` chips UI-152 shipped, and the `→ open` chip
added since — is *advisory*: it states what this board's map says, not
necessarily what will be written.

The new chip adds no dishonesty of its own. It extends an existing one, which is
why this is filed rather than left in a commit message.

## What a reader sees

Two kanbans over `stage` claim the same document. Board A, `order: 1`, maps
`done → resolved`. Board B, `order: 2`, maps `done → archived`. Dragging the
card to `done` on **board B** shows `→ archived` on the column and writes
`resolved`, because board A decides. The response's warning names board A, so
nothing is hidden — but the chip the person was looking at was wrong.

## Acceptance Criteria
- [x] A column whose board is not the deciding board for a document either says
      so or does not promise a status
- [x] Decide whether the chip should be per-column (what this board would do) or
      per-card (what will actually happen), and say why the other lost. A
      per-card answer costs a lookup the board may not have
- [x] Whatever is chosen, a person who reads the chip and then drops the card
      is not surprised
- [x] A test covers two kanbans claiming one document, since one board alone
      cannot exhibit this

## Testing Strategy
Vitest over the chip derivation with two boards in the fixture; Playwright for
the drag if the answer is per-card.

## E2E Verification Plan
### Verification Steps
1. Two kanbans over `stage`, different status maps, same document in scope.
2. Drag on the higher-`order` board.
3. What the chip said and what was written agree, or the chip did not claim.

## E2E Verification Log

**Model: opus (claude-opus-5[1m]).**

### The answer: per column, and here is why per card lost

**Per column.** The question a column can answer honestly is not "what will
happen to this card" but "could another board outrank this one at all" — and
that one is answered exactly, from the board documents the bar already holds.
`decidingStageBoard(boards)` is the lowest-`order` kanban over `stage`, using
`compareBoards`, which is SERVER-138's tiebreak spelled out. A column on that
board **promises**: no other kanban can outrank it, whatever any card's scope
membership turns out to be. A column on any other kanban over `stage`
**hedges**.

**Per card lost on three counts.** It would have to run every other kanban's
scope query against every row in the column, client-side: a second
implementation of the filter grammar in the browser — the defect
`packages/kit/src/recipient/scopeWalk.ts` records the cost of — or a request per
card the board does not make. And it would still be a guess: the scope is
evaluated server-side at write time against the row as it will stand.

**What a hedged chip looks like.** `→ resolved?`, muted rather than `good`, with
the reason in its `title`. The question mark is readable without hovering, so
the chip does not promise; the title names the board that does decide. §5's
second outcome hedges the same way: `→ open?`.

**Two chips are now honest that were not, and the second was not in the brief.**
A kanban over `status` moves the status field itself, so the coupling never runs
on it — the server skips those boards outright. Its `→ <status>` map chip was
drawn unconditionally and would have been false. It is now drawn only on a
kanban over `stage`, beside the `→ open` chip that was already guarded that way.

### Verification, against the real app

A real server on port 8790 serving the built UI, driven by Chromium. Two kanbans
over `stage` with the same scope (`type: note`) and different maps: **Triage**
(`order: 1`, `done → resolved`) and **House hunt** (`order: 4`,
`done → archived`).

```
Triage:     ["type: note","stage: candidates","or no stage","→ open","→ offer",
             "type: note","stage: offer","→ open","→ done","→ candidates",
             "type: note","stage: done","→ resolved","→ offer"]
Triage hedged chips: 0

House hunt: ["type: note","stage: candidates","or no stage","→ open?","→ offer",
             "type: note","stage: offer","→ open?","→ done","→ candidates",
             "type: note","stage: done","→ archived?","→ offer"]
House hunt hedged chips: 6 — title: Advisory. “Triage” (doc_boardtriage) is a
  kanban over `stage` with a lower `order`, and the lowest-order board that
  claims a document is the one whose map decides its status (SPEC.md §5,
  SERVER-138). Entering this stage writes `open` only for a card that board does
  not claim — the response names the board that decided.
```

**The drag, on the board that does not decide** — the issue's own scenario:

```
chip the person reads before dropping: → archived?
beta before the drop: {"stage":"offer","status":"open"}
[drag the card onto House hunt's `done` column]
toast: ✓ | “Beta in unfiled” — stage → done, status → resolved. One commit.
          stage `done` set status to `resolved`: this document is in the kanban
          Triage (doc_boardtriage), whose `kanban.status` map decides a status
          on entry (SPEC.md §5). It also matches House hunt (doc_boardhouse);
          the board with the lowest `order` decides. | ✕
beta after the drop: {"stage":"done","status":"resolved"} — the chip said → archived?
```

The chip did not claim, the write went the other way, and the toast says which
board decided and why. Nobody is surprised.

**The toast is a third change, and it is the half that closes criterion 3.** It
used to end "The board’s `kanban.status` map decided the status" — a sentence
this surface cannot make, because the deciding board need not be the board being
dragged on. It now renders the server's `stage_status` warning verbatim, which
names the deciding board and which of §5's two outcomes happened. Rendered as
text, never parsed.

### Falsification

- `decides` forced to `true` → three of the six new tests red
  (`expected '→ resolved' to be '→ resolved?'`, `expected '→ open' to be
  '→ open?'`, and the `order: null` case).
- The toast's warning quote replaced by the old sentence → `kanbanDrag.test.ts`
  red on the exact text.

### Checks

`vitest run apps/ui` — 178 files, 3689 tests pass (six new in `kanban.test.ts`
over two kanbans in one fixture, since one board alone cannot exhibit this).
`vitest run packages/kit` — 63 files, 954 tests pass. `npm run typecheck` exit
0. `eslint apps/ui packages/kit` exit 0.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[UI-160]` prefix
