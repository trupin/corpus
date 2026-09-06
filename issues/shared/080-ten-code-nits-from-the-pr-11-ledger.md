# [SHARED-080] Ten code nits from the PR #11 ledger

## Domain

shared

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —

## Origin

Batched 2026-09-06 from **SHARED-003** (the PR #11 / PR #12 review ledger) by the
audit that closed it. Ten items whose fix is a comment, a wording, a small
defensive change, or a test — none of which changes what the product does, and
none of which is worth a review round on its own.

**This issue spans domains** (cli, server, kit, contract, ui). It is filed as
`shared` because splitting ten one-line fixes across five domain issues would cost
more than the fixes. The orchestrator may hand it to one agent or split it by
domain — but if it is split, the split is recorded, not silent.

## Spec References

- Each item cites its own where it has one. Most are internal accuracy, not
  behaviour.

## Summary

Ten small defects, mostly docblocks and comments that overstate what the code
guarantees. They matter because a comment that overclaims is worse than no
comment: the next reader trusts it and stops checking. Two items are real (if
small) behaviour — a post-unmount state set, and a body drained before a refusal.

**Line numbers below are the ledger's, recorded 2026-07-29 to 2026-07-31. Verify
each before editing.** An item that no longer applies is struck with evidence, not
silently ticked.

## Acceptance Criteria

- [ ] **1. (contract) `packages/contract/src/schemas/form.ts` —
      `FormFenceMatch.end`'s doc comment is imprecise for CRLF bodies.** Ledger
      NIT 19. Make the comment say exactly what `end` indexes for a `\r\n`-ended
      fence, or say that it is line-ending agnostic if that is the truth. Check
      the code, then write what it does.

- [ ] **2. (kit) `packages/kit/src/row/useRowActions.ts:101` — `setLeaving(false)`
      in `onError` can fire after unmount.** Ledger NIT 21. It relies on React
      18 treating a post-unmount `setState` as a no-op, which is true today and
      is not a contract. Guard it, or state the reliance in a comment so it is a
      decision rather than an accident.

- [ ] **3. (cli) `apps/cli/src/commands/workspace/upgrade.ts:161-167` — a
      version-only bump early-returns without refreshing the manifest's `tool`
      field.** Ledger NIT 30. The consequence is a stale `fromVersion` on a later
      run. Note this is **not** the no-op-commit finding from the same file — that
      one is fixed. Verify the early-return path still exists before changing
      anything.

- [ ] **4. (cli) `apps/cli/src/commands/init/git.ts` — `commitPaths`'s docstring
      overclaims.** Ledger NIT 31. It says the index is "left alone"; `git add --
      <paths>` updates those index entries. Fix the docstring to describe what the
      function does. Do not change the function.

- [ ] **5. (contract + cli, wording) `DeferEventRequestSchema.reason` and
      `queue defer --reason` promise the reason is "shown in the console".** It
      never reaches the wire — `Job` carries no `reason` field. Two honest fixes:
      correct the wording (regenerate `openapi.json` and `docs/cli.md`), or ship
      the field as a contract rider. **Prefer the wording fix** — shipping a field
      to make a help string true is the wrong direction, and the field would need
      its own spec basis. If the field is genuinely wanted, that is a design
      decision and belongs in SHARED-081, not here.

- [ ] **6. (cli) The archived refusal drains a piped body before refusing.** PR
      #12 review NIT. Reading stdin and then refusing wastes the caller's input
      with no way to recover it. Refuse first, or say in a comment why the drain
      has to happen first (a piped writer blocking on a full pipe is a real
      reason — if that is the reason, record it and strike the item).

- [ ] **7. (server) `normalizeBody`'s docblock overstates the invariant for the
      extra-trailing-newlines direction.** PR #14 review NIT. The behaviour is
      safe — clamped, with the tail highlight dropped — and the docblock claims
      more than that. Narrow the claim to what holds.

- [ ] **8. (server) `unarchivedMessage` uses typographic quotes where
      `archivedMessage` uses straight ones.** PR #14 review NIT. Pick one and use
      it in both. Check whether either string is asserted on by a test before
      changing it.

- [ ] **9. (server) The search tie-break comment slightly overstates.** PR #15
      review NIT: the doc-vs-own-turn bm25 tie-break is by `ref`, not `id`. The
      behaviour is deterministic and tested; only the comment is wrong.
      **Comment fix only** — do not change the tie-break.

- [ ] **10. (ui, e2e) `anchor-layer.spec.ts`'s UI-031 parked-pointer test is
      load-flaky.** On 2026-08-01 it blocked two pre-push runs; its own build log
      documents a boundary-event race and a two-frame `settle()` that is
      evidently marginal under load. **Read `docs/TS_GUIDELINES.md` → Testing
      before touching it**: per INFRA-020 a failing test is diagnosed before its
      timeout moves, and three of the four things that look like load are not
      load. The intended fix is to wait for the hover-adoption observable itself
      — poll the class state with a timeout — rather than counting frames. Do not
      simply raise a timeout.

- [ ] Any item that turns out to be a behaviour change rather than a nit is
      **pulled out and filed separately**, not quietly done here. Say which, in
      the log.
- [ ] `openapi.json` and `docs/cli.md` are regenerated once, at the end, if item
      5 changed either.

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/form.ts` — item 1
- `packages/kit/src/row/useRowActions.ts` — item 2
- `apps/cli/src/commands/workspace/upgrade.ts` — item 3
- `apps/cli/src/commands/init/git.ts` — item 4
- `packages/contract/src/schemas/queue.ts` and the `queue defer` verb — item 5
- The archived-refusal path in `apps/cli` — item 6
- `normalizeBody` and the archive messages in `apps/server` — items 7, 8
- The search tie-break comment in `apps/server` — item 9
- `apps/ui/e2e/anchor-layer.spec.ts` — item 10

### Key Implementation Details

Nine of these ten are one-line changes. Item 10 is not, and it is the one that can
consume the whole issue if it is approached as a timeout tweak. Budget for it, and
if it grows, split it into a `ui` issue rather than leaving the other nine
unlanded behind it.

Items 1, 4, 7, 9 all have the same shape: a comment claims more than the code
delivers. The rule for all four is the same — **describe the code, do not repair
the claim by changing the code**. If a comment is wrong because the code is wrong,
that is a different issue and gets filed.

### Edge Cases

- Item 5 touches the contract. Regenerating `openapi.json` triggers the CI drift
  check, so it must be committed with the change.
- Item 8's strings may appear in test assertions and in `docs/cli.md`.
- Item 2 is in `packages/kit`, whose only consumer is `apps/ui`. Build kit before
  running the UI tests, or the change will appear to have no effect (the kit
  `dist` falsification trap).

## Testing Strategy

Comment-only items need no new tests. Items 2, 3, 5, 6 and 10 do. Run the
affected workspaces' tests directly — the commit hook runs none.

## E2E Verification Plan

### Verification Steps

1. Per item: quote the before and after, and name the code read to decide what
   "after" says.
2. Item 10: run the e2e spec repeatedly (at least 10 runs) under load and report
   the pass rate before and after. A single green run is not evidence for a
   flake fix.
3. `npm test` in each touched workspace, and `npm run e2e` if item 10 changed.

## E2E Verification Log

_[Agent fills, item by item. A struck item needs its evidence here too. State
which model the implementing agent ran on.]_

## Completion Checklist (domain agent)

- [ ] All ten items ticked or struck with evidence
- [ ] `/lint` passes
- [ ] Affected workspaces' tests run and passing
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: no comment now claims more than its code does
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[SHARED-080]` prefix
