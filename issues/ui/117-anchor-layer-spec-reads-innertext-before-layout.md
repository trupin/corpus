# [UI-117] `anchor-layer.spec.ts:475` reads `innerText` before layout has flushed

## Domain

ui

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Related: UI-116 (which surfaced it by adding load), INFRA-028

## Summary

`apps/ui/e2e/anchor-layer.spec.ts:475` intermittently fails with
`allInnerTexts()` returning `""` **after** `toHaveCount(2)` has already passed —
`innerText` read before layout flushed.

**Pre-existing and load-sensitive, not caused by UI-116.** The evidence, from
UI-116's four full Playwright runs: baseline `HEAD` was 382/0; the fixture change
alone was 383/0; the full tree ran 391/1, 391/1, 392/0. Running the two
implicated files with `--repeat-each=3` (63 tests) was clean. So nine extra tests
on four workers tipped over an existing sensitivity rather than introducing one.

CI's `retries: 2` covers it, which is why it has not been noticed. That is also
the argument for fixing it rather than leaving it: a spec that passes on retry is
indistinguishable from one that passes, and the next real flake in that file will
be read as this one.

**UI-116's agent deliberately did not touch it** — editing an unrelated spec to
make its own change look clean is how a real regression gets buried. That was the
right call and this issue is the consequence of it.

## Acceptance Criteria

- [ ] The spec reads `textContent` (or otherwise waits for the text) rather than
      `innerText`, which forces layout and is what makes the read racy
- [ ] The fix is justified against the actual failure mode, not applied by
      superstition: say why `toHaveCount` passing does not imply the text is
      readable
- [ ] Verified under load — the conditions that produced it — not in isolation,
      where it already passes. `--repeat-each` on a quiet machine is not the
      reproduction
- [ ] Sweep `apps/ui/e2e/` for other `allInnerTexts`/`innerText` reads that
      follow a count assertion; if the pattern appears elsewhere it is the same
      latent flake, and the sweep's extent should be reported either way

## Technical Design

### Files to Create/Modify

- `apps/ui/e2e/anchor-layer.spec.ts`

## Testing Strategy

The spec is the test. Reproduction is the difficulty — it needs the whole suite
on a loaded machine.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-117]` prefix
