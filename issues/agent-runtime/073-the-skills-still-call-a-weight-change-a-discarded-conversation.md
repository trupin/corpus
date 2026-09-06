# [AGENT-073] The skills still call a weight change a discarded conversation

## Domain

agent-runtime

## Status

done — 2026-09-06, committed on phase-58

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-076 (the rider — signed 2026-09-06 and applied to §7)
- Related: AGENT-070 (the same defect for the designation-engages rider)

## Spec References

- SPEC.md **§7**, weight-change rider signed 2026-09-06: a resident's weight
  may be changed by re-designation. What it costs is the released agent's own
  working context, and *"the earlier claim that a running agent cannot change
  what it is 'without discarding the conversation it is holding' was too
  strong"*.

## Summary

Found by AGENT-070's audit (2026-09-06). The signed rider corrects §7, and
the skills still teach the old claim: `converse/SKILL.md` says becoming
another model "would mean discarding this conversation", and
`converse/references/leaving.md` plus `orchestrate/references/launching.md`
carry the same overstatement. Skill text now contradicts signed spec text —
the exact failure family AGENT-070 closed for the other rider.

## What to build

Audit the three files (and any other skill text asserting weight
unchangeability) and correct each statement to the rider's semantics: a
weight change is a re-designation, the conversation survives on disk and the
successor reads it, what is lost is the released agent's working context.
Update `scripts/workspace-template.test.ts` guards. INFRA-038 ratchet binds:
pay for additions with in-place trims, run `npm run skills:check`.

## Acceptance Criteria

- [x] No skill or reference text claims a weight change discards or forbids
      anything the rider permits
- [x] The cost that is real (working context) is stated where the old claim
      stood, not deleted into silence
- [x] Net size change per file recorded; ratchet green
- [x] `workspace-template.test.ts` pins the new statements

## E2E Verification Log

**Model: Opus 5 (`claude-opus-5[1m]`), 2026-09-06.** No workspace run: this is
prose measured against a signed rider, so the test pins are the verification.

### The audit

`grep -rn "discard" assets/workspace/` found exactly three sites, and a widened
sweep for `cannot become | one session on one model | becomes another | change
what it is | cannot be changed | never changes` found no fourth. All three are
corrected below. `orchestrate/SKILL.md`'s own summary line ("the old listener
ends its own run") and `orchestrate/references/weight.md` were read and needed
no change — neither asserts unchangeability.

### Statements corrected

1. **`converse/SKILL.md`** — *"You are one session on one model, and becoming
   another one would mean discarding this conversation, which is the thing you
   are here to hold."* → *"You are one session on one model, and what this lane
   runs at changes only by re-designation: it releases you and launches a
   successor, which reads this conversation off disk. What does not survive is
   your working context."* The reason a message weight stops at what the
   resident hands off is now that a message **is not that act**, not that the
   act is impossible.
2. **`converse/references/leaving.md`** — *"no running agent becomes another one
   without discarding the conversation it is holding"* → *"no running agent
   becomes another one — the change is made by replacing it"*, followed by the
   cost in the place the old clause stood: *"What that costs is your own working
   context, and never the conversation: a conversation is a document, and your
   successor rehydrates from it and the artifacts exactly as the survivor of the
   race above does."* The act it earns (stop, do not adapt) is unchanged.
3. **`orchestrate/references/launching.md`** — *"No running agent becomes another
   model without discarding the conversation it holds, so the old listener ends
   its own run instead of changing."* → *"No running agent becomes another model,
   so the change is made by replacing it: the old listener ends its own run, and
   the successor you launch reads the conversation off disk. What that costs is
   the released listener's working context, never the conversation."*

### Net sizes (bytes)

| File | Before | After | Net |
| --- | --- | --- | --- |
| `converse/SKILL.md` | 63,984 | 63,962 | **−22** |
| `converse/references/leaving.md` | 6,498 | 6,613 | +115 |
| `orchestrate/references/launching.md` | 28,369 | 28,462 | +93 |

`converse/SKILL.md` is the one gated file of the three (references are reported
and summed by `skills:check`, never gated). It ended **below** its baseline, so
the addition was paid in full, in place, out of three restatements next to it:
`", which is the one place that declares them"` (a restatement of "declared in
the orchestrate skill's table" in the same sentence), `"actually"` and `"from
scratch"`, and the merge of two provenance sentences — *"Your launch tells you
what was chosen"* and *"its prompt names what it launched you at"* — into one
clause serving both the stated-weight and no-weight cases. `leaving.md` paid 81
of its 196 bytes by cutting the handover clause's duplicated half. Nothing
AGENT-064 or AGENT-070 added was touched.

### Ratchet

```
skills:check ✗ .../converse/SKILL.md — 63962 bytes ≈ 15991 tokens: shrank below
  its ratchet baseline (15992 → 15991 tokens) — lock the gain in
skills:check ▷ lowered .../converse/SKILL.md: 15996 → 15991
skills:check ✓ 30 file(s) measured, 16 over the warn line
```

Baseline lowered 15,996 → 15,991 and staged. Ratchet green.

### Pins

- Positive pins on all three corrected statements, `wrapped()` throughout so a
  reflow cannot break them.
- Negative pins on the old claim, one per file: `/discard(ing|s)? this
  conversation/i` on `converse/SKILL.md`, `/discard(ing|s)? the conversation/i`
  on `leaving.md` and on launching.md's occupied-lane slice.
- A workspace-wide sweep, `nowhere claims a weight change costs the
  conversation`, over every template file — the defect shipped as three
  paraphrases, so the guard is on the claim rather than on any sentence. It
  carries a self-check asserting the regex matches all three shipped wordings,
  so a sweep that stopped catching anything fails instead of passing quietly.
- Two pre-existing literal-space regexes broke on the rewrap and were converted
  to `wrapped()`: `"**When it goes, and how it finds out, is the converse
  skill's to state.**"` and `"Standing it down yourself is still not yours to
  do"`.

### Falsification

The old sentence was reinstated in `converse/SKILL.md` and the suite re-run.
Both guards fired — the local negative pin and the workspace-wide sweep:

```
× converse skill body > a resident's weight is its designation's > no longer
  tells the session to change what it is running as
× a listener launched at its designation's weight > nowhere claims a weight
  change costs the conversation
Tests  2 failed | 658 passed (660)
```

Reverted, and green again.

### Tests

```
✓ scripts/skill-budget.test.ts (23 tests)
✓ scripts/workspace-template.test.ts (660 tests)   [+1 new: the sweep]
Test Files  2 passed (2) · Tests  683 passed (683)
```

`eslint scripts/workspace-template.test.ts` clean, `prettier --write` applied.
`npm run skills:check` green.
