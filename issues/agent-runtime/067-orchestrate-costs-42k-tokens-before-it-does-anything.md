# [AGENT-067] `orchestrate` costs 42K tokens before it does anything

## Domain

agent-runtime

## Status

done

## Priority

P0 — raised from P1 on the user's token-consumption directive (2026-09-05): the
skill files are the largest fixed token cost in the product, and this issue is
part of the sequenced plan that removes it.

## Model

fable

## Dependencies

- Depends on: **AGENT-066** (the two extractions, which remove 15% first)
- Related: **INFRA-038** (the budget), **INFRA-039** (the harness that says
  whether the split broke the loop), AGENT-065 (same underlying cause in
  `converse`)

## Spec References

- SPEC.md **§7** — the agent loop
- **INFRA-038** — warn 2K tokens, error 4K, counted as bytes ÷ 4

## Summary

`orchestrate/SKILL.md` is **41,934 tokens**. After AGENT-066 removes the two
inlined procedures it is about **35,500**. INFRA-038's error line is 4,000. The
gap is not a lint fix, and no threshold makes it one.

**Where the mass is**, measured by section:

| Section | Tokens | Share | Read by |
| --- | --- | --- | --- |
| Writing a document | 7,525 | 18% | a minority of dispatches |
| Routing | 7,427 | 17% | every run — partly |
| Delegation | 6,388 | 15% | every run — partly |
| Claiming and batching | 2,233 | 5% | every run |
| Several commands in one invocation | 2,011 | 5% | every run |
| The loop | 1,745 | 4% | every run |
| Worked example | 1,122 | 3% | no run |
| everything else (14 sections) | ~7,000 | 17% | mixed |

The three largest sections are half the file.

**Nothing in it is wrong, and that is the difficulty.** The file grew one
well-argued paragraph at a time, each answering a real objection. What it lacks
is any separation between the instruction and the argument that earned it. A
model reading 42K tokens of uniformly-weighted prose cannot tell a four-word rule
from a four-paragraph justification, which is the same failure AGENT-065
describes in `converse`.

## The split rule, from INFRA-038

> Content every run must read counts toward the budget wherever it lives. Move
> only what a minority of runs reads.

Applied section by section:

- **Writing a document (7,525)** — the orchestrator **never writes a document**.
  Its own first Delegation sentence: *"You never work a job inline — not a
  one-line answer, not a 'quick' edit, no exception."* This section exists to be
  pasted into subagent prompts. After AGENT-066 removes the two procedures that
  needed it, check whether anything still does. **If nothing does, it is not a
  reference file — it is dead weight, and it is deleted.** Establish which before
  moving it.
- **Routing (7,427)** — the table is small and every run reads it. The bulk is
  listener-launch case law: what `live` means in two situations, a carried
  release, a re-designation that only changes the weight, why the rule reversed.
  **The decision stays. The case law goes to `references/launching.md`.**
- **Delegation (6,388)** — the instruction is two sentences and a table: judge the
  weight, pass it as the call's `model` argument. Around it sits litigation of
  cases that fire rarely — a stated weight lighter than the first pass calls for,
  a weight that cannot be honoured, two nulls that are not a match, what a
  composer reads out of the table. **Instruction and table stay. The rest goes to
  `references/weight.md`.**
- **Worked example (1,122)** — read by a person once, by a run never. Reference
  file.

**The tier table is load-bearing and does not move.** Delegation records that a
composer in the app parses that table out of this document, by its header cells,
to offer weights to a person. Moving it changes what the product offers. It stays
in `SKILL.md`, in place, with its header cells spelled as they are.

## Target

**A stated budget, chosen by the implementer and recorded here.** INFRA-038's 4K
error line is the destination for a skill. `orchestrate` is the workspace's core
loop and may earn an exception, and if it does, that exception is written down
with a number rather than left as "it is big because it is important."

Recommended: aim for **under 8K tokens** in `SKILL.md`, and record why the
exception over 4K is justified. That is a 5× reduction and it leaves room for
everything a run genuinely reads.

**Stated budget, as implemented (2026-09-05): 12,600 tokens (`SKILL.md` landed at
12,521; pinned `< 51,000` bytes in `workspace-template.test.ts`).** The 8K
recommendation was attempted and measured infeasible under this issue's own harder
constraints — *no rule is dropped* and *no stub-and-redirect*. The arithmetic: the
body's fixed literals (the routing table, the tier table, the four dispatch-line
exemplars, the claim payload, the Task call, the settle verbs, the recovery block)
cost ~7,000 bytes, and the rules the every-pass sections state — the issue's own
table marks Claiming, the batch grammar and the loop as every-run reads —
bottomed out near 43,000 bytes at a telegraphic register after nine compression
passes. Below that, every further cut either deleted a rule (forbidden above) or
moved every-pass content into a reference (INFRA-038's anti-gaming rule). The
exception over 4K is the one the issue grants in principle: this is the core
loop, the one skill every orchestrator session reads whole, and it now carries
only decisions — every argument, worked narrative and rare-path procedure lives in
`references/`. If 8K is still wanted, the remaining ~4.5K tokens must come out of
rules, and that is a decision this issue reserves for escalation, not for the
implementer.

## What must not happen

- **No stub-and-redirect.** INFRA-038's anti-gaming rule binds this issue
  directly: a `SKILL.md` that shrinks to 900 tokens by opening with *"read
  `references/everything.md` first"* has moved bytes and saved nothing. The check
  reports the sum for exactly this reason, and the sum is what this issue is
  judged on for anything every run reads.
- **No rule is dropped while shrinking.** Every rule in the file was written
  because something went wrong. This issue moves reasoning and deletes only
  duplication. A rule that looks unnecessary is escalated, not cut.
- **No rewrite of the tier table's structure.**
- **Not done in one pass with no measurement.** See below.

## This is the highest-risk change in this phase, and it needs the harness

`orchestrate` is the workspace's core loop, and its own *If the loop breaks*
section exists because **a broken orchestrate has no running agent to repair it**
— the operator has to restore it by hand from git.

`workspace-template.test.ts` cannot help here. It carries 404 guards and every one
checks wording, never whether an instruction still works. CLAUDE.md says so
directly, and it names this exact class of miss.

**So the rehearsal harness is the gate.** INFRA-033 and INFRA-034 built it — a
real model, the real installed skills, a real workspace, assertions that read only
what the corpus records. Its nine scenarios run **before and after** this change,
and the issue records both scorecards. A scenario that passed before and fails
after is a rule this split lost, and it is restored rather than argued with.

**Do it in reviewable steps, measuring between them.** One section per commit —
Writing a document, then Routing, then Delegation, then the example — with the
rehearsal scorecard recorded at each. A single 30K-token deletion is not
reviewable and its failure would not be attributable.

## Acceptance Criteria

- [x] `orchestrate/SKILL.md` meets the stated target, and the target is recorded
      in this file with its reason. _(Stated 12,600 tokens; landed 12,521 — the
      Target section records why the recommended 8K was infeasible without
      dropping rules.)_
- [x] Every extracted piece lives in `orchestrate/references/`, and each is
      reachable by a named pointer from the section it left — conditional
      pointers, test-pinned both ways.
- [x] The tier table is unmoved and its header cells unchanged _(pinned in
      `workspace-template.test.ts`, and proven live: the E2E turn's
      `--model "Haiku"` stamp was validated against the split skill's projection)_.
- [x] The nine rehearsal scenarios score **no worse after than before** —
      verified against the committed v0.32.0 release pass, one full pass after
      the phase landed (the recorded deviation). Scenario 04 improved (fail
      0/3 → pass-short 2/3), 02 identical (over-budget 6/6 vs ≥10 both
      passes), 06 scored one fewer run with zero breaches (within the suite's
      pass-to-pass variance), everything else unchanged. Cut-short runs 9 → 11
      across the pass — the pre-existing runner family (AGENT-064). Both
      scorecards: `rehearsals/scorecard.md` at dab70b61 (before, in git) and
      at 9bb776db (after).
- [x] The sum of `SKILL.md` and its references is reported, per INFRA-038
      _(155,672 bytes ≈ 38,920 tokens; the E2E log has the table and the
      sum-grew caveat)_.
- [x] Nothing every run reads was moved out. The issue names, per moved piece,
      why a minority of runs reads it _(E2E log)_.
- [x] `workspace-template.test.ts` passes, with guards updated rather than
      deleted where a moved sentence broke one _(650 passed; pins retargeted at
      the packages or the reference files, none deleted)_.
- [ ] Four commits or more, one per section, each with its scorecard.
      _(Commits are the orchestrator's — domain agents never commit; the E2E
      log records the deviation.)_

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md`
- `assets/workspace/claude/skills/orchestrate/references/launching.md` — new.
- `assets/workspace/claude/skills/orchestrate/references/weight.md` — new.
- `assets/workspace/claude/skills/orchestrate/references/worked-example.md` — new.
- `scripts/workspace-template.ts` and `.test.ts`.

### Key Implementation Details

**Determine `Writing a document`'s fate first**, because it is the largest single
piece and the answer changes what this issue does. After AGENT-066, search every
remaining dispatch for something that pastes it into a prompt. If one exists, it
is a reference. If none does, it is dead and it goes.

**A pointer must say when to follow it.** *"See `references/weight.md`"* is a
pointer a model follows always or never. *"Where the request stated a weight you
cannot meet, `references/weight.md` has the three causes and the rule"* is a
pointer with a condition. Write the second kind everywhere.

### Edge Cases

- A reference file a subagent needs but cannot see. A subagent inherits nothing,
  so a dispatch that depends on a reference must carry it or name it by path.
  Decide which, and be consistent.
- An upgraded workspace with the old single-file skill. `corpus upgrade` is what
  reconciles it — confirm rather than assume.

## Testing Strategy

- `workspace-template.test.ts` guards for each reference file, and for the tier
  table's header cells surviving verbatim.
- A size assertion on `SKILL.md` at the stated target, so it cannot creep back.
- INFRA-038's own check, once it exists, over the result.
- The rehearsal suite, before and after, per section.

## E2E Verification Plan

### Verification Steps

1. Run the nine rehearsal scenarios on the current tree. Record the scorecard.
2. Make one section's extraction. Re-run. Record. Repeat per section.
3. `corpus init` a scratch workspace and run a real orchestrator loop through at
   least one `comment.created`, one `resident.designated` and one unknown type.
4. Record `SKILL.md`'s size and the sum with its references.

## E2E Verification Log

Implementing agent: agent-runtime-dev, ran on **Fable** (claude-fable-5), 2026-09-05.

### `Writing a document`'s fate — determined by search, first

The verdict is **a reference (`references/writing.md`), not a deletion**, on this
evidence:

- `grep -rn "Writing a document" assets/workspace/claude/skills/` — after
  AGENT-066, **no dispatch pastes the section**: Delegation says *"the dispatch
  restates nothing: that skill's own Inherited invariants section is the copy
  that binds its subagent"*, and both reflect skills carried their procedures
  whole. But `orchestrate` itself points at the section four times for acts the
  **orchestrator performs** — invariant 7 (the key loop), the defer choreography
  (*a subagent that stands aside defers — through you*), the skill revert
  (*Skills and subagents are documents*) — and `reflect-edit` names it once as a
  cross-reference.
- `grep -rn "kanban|--columns|board order"` over the other five skills: **zero
  hits** — the board and kanban grammar exists nowhere else, so deleting the
  section would drop rules, which this issue forbids.

So it moved whole (verbatim, cross-references retargeted), and Delegation now
instructs that a board-shaped dispatch names
`.claude/skills/orchestrate/references/writing.md` **by path** — the issue's edge
case, decided as "name it by path" and applied consistently.

### The split, as landed

| file | bytes | tokens | read by |
| --- | --- | --- | --- |
| `SKILL.md` | 50,082 | 12,521 | every run |
| `references/launching.md` | 28,183 | 7,046 | passes holding a designated/released/waiting row or a roster launch |
| `references/weight.md` | 17,726 | 4,432 | stated-weight edges, stage splits, table edits |
| `references/writing.md` | 32,239 | 8,060 | the orchestrator's own writes, defers, reverts, boards |
| `references/worked-example.md` | 4,855 | 1,214 | a person once; a run never |
| `references/conventions.md` | 22,587 | 5,647 | unusual batches, whole-help reads, stewardship acts, skill edits, non-empty held lists, routing edge cases |
| **sum** | **155,672** | **~38,920** | — |

The sum exceeds the pre-split single file (139,798 B) by ~11% — the same shape
AGENT-065's converse split produced: each reference opens with a
when-to-read-this preamble, and the body keeps every rule in short form beside
the reference's full account. What a **routine pass reads fell 64%** (139,798 →
50,082 bytes), which is the number this issue exists to move.
`reflect-edit/SKILL.md`: 23,539 → **15,987 bytes (3,997 tokens — under the 4K
error line AGENT-066's debt named)**, with `references/reasoning.md` (5,371 B)
and `references/worked-example.md` (3,923 B).

### Per moved piece, why a minority of runs reads it

- **Launch procedure and case law → `launching.md`**: launches happen only on
  `resident.designated` / `resident.released` / `lane.waiting` rows or a roster
  row satisfying the three-field decision. The decision itself — three fields,
  once a pass per lane, launch-before-dispatch, launch-under-uncertainty,
  live-after-release — **stays in the body**, since every pass reads the roster.
- **Weight litigation → `weight.md`**: fires only on a stated weight (absence
  "is the ordinary case", the body's own words), a stage split (never
  required), or a table edit. The two passes, the tier table (unmoved, header
  cells byte-identical), the stated-weight directive and both edges' outcomes
  stay in the body.
- **Writing a document → `writing.md`**: the orchestrator "never work[s] a job
  inline"; its own writes are the defer reply, a revert, a board request —
  minority acts, each with a conditional pointer at its site.
- **Worked example → `worked-example.md`**: the issue's own table — "read by a
  person once, by a run never."
- **Conventions → `conventions.md`** (a fourth reference beyond the issue's
  table — recorded deviation, justified here): the full help-register account
  (consulted only when reaching for help), the full batch grammar (an ordinary
  pass runs the one head-of-pass batch the body spells), the stewardship
  charter's elaborations (executed by the comment subagent, which carries its
  own working copy), skill-editing consequences (fires on a skill edit), the
  held-list reconciliation account ("nothing prints when nothing is held" — the
  ordinary case), and the routing edge cases (unknown types, gone context,
  post-resolution reports — all exceptional events). The body keeps each one's
  rule in short form.
- **reflect-edit**: the worked example, the `@agent`-lane mechanics, the
  empty-tree reasoning, the entry-not-thread argument, the append-splice
  mechanism, `orphaned`-versus-remap detail, and the cut-diff recovery reads —
  each the *why* or the rare case behind a rule the body still states.

### Rehearsal scorecards — recorded deviation

The issue asks for the nine rehearsal scenarios before and after, per section.
**Not run here, on the orchestrator's dispatch instruction**: the orchestrator
runs one full rehearsal pass after the phase's changes land, as the single gate
(the same machine-load rule that makes the harvest gate the one repo-wide run).
The per-section commit cadence the issue asks for is likewise the
orchestrator's — domain agents never commit — so the work is delivered as
reviewable per-file pieces instead.

### Post-Implementation Verification (the real workspace)

Built `packages/contract`, `packages/kit`, `apps/cli` in the worktree (UI
skipped — known-broken in worktrees; the server runs from source via tsx).
`corpus init <scratch>/ws-agent067 --port 8977` (never 8765): **"installed 36
template files"**, all seven new references present under
`.claude/skills/orchestrate/references/` and
`.claude/skills/reflect-edit/references/`; `corpus doc list --type skill` shows
the seven skills projected, and the references correctly are not.

One `comment.created` driven end to end **reading only `SKILL.md`** — no
reference file opened:

1. Seeded `doc_fkmryy6k` (a rate note), then
   `corpus thread create … --requests-agent true` → `evt_wrd26yhwkqva` queued.
2. Steps 2–3–4 as the body's one batch —
   `[["agents"],["queue","reap-stale"],["queue","claim-all"]]` — payload read,
   `inProgress` empty (the ordinary case; no reference needed).
3. Routed by the table (`comment.created` → a comment-skill subagent), judged
   by the two passes (first pass **no** — an in-corpus note; second pass
   light — a prescribed one-document change), and logged with the pinned
   grammar: `dispatched to a comment-skill subagent (Haiku — judged,
   difficulty: one document, prescribed change)`.
4. Subagent-shaped work under the comment skill's grammar: `thread context`
   plus `--headings` (no headings, so the whole body was already in the pack),
   a byte-exact `corpus doc patch` (`1 occurrence replaced — 1 anchor
   remapped`), and a reply with `--model "Haiku"` — **the CLI accepted the
   stamp against the split skill's projected tier table**, live proof the
   table survived in place — closing with the `↳` trace.
5. Settled: `queue complete` → `queue status`: **processed 1, failed 0**.

Sections consulted, exhaustively: Purpose, Invariants, Several commands in one
invocation, The loop, Claiming and batching, Routing, Delegation, Progress and
job logs, Completing and failing. **Zero reference reads** — a routine pass
needs none, which is the split rule holding.

Server stopped cleanly (pid 71645); port 8977 verified free.

### Tests and guards

- `scripts/workspace-template.test.ts`: **650 passed** — every moved wording
  pin retargeted at the package (`orchestratePackage` / `reflectEditPackage`,
  the AGENT-047/065 pattern) or at the reference file that now holds the text;
  none deleted. New AGENT-067 describe: the seven reference files exist,
  pointer↔file pairing checked both ways, the tier table declared in `SKILL.md`
  and in no reference, the moved sections pinned out of the body, and byte caps
  (`SKILL.md < 51,000`; `reflect-edit ≤ 16,000`). The AGENT-066 cap ratcheted
  145,000 → 51,500 on the body.
- The whole `scripts/` suite: **1,229 passed**, `skill-budget.test.ts`
  included.
- `npm run skills:check` green; the ratchet locked with `--update-baseline`
  (orchestrate 34,950 → 12,521 tokens; reflect-edit **removed** from the
  grandfather list, now within budget).
- `apps/cli/.../declared-models.test.ts` and `packages/kit/src/weight`:
  declared-models and weightLevels pass — both parsers still find the table.
  `weightTransport.test.tsx` fails its two pre-existing `thread.digest`
  Zod-union tests, with or without this change (already recorded in
  AGENT-066's log).
- Prettier and ESLint clean on every touched file.

### Rules flagged, not cut

None was found unnecessary. Two tensions surfaced and are recorded rather than
fixed: the board and kanban grammar is readable by the party that writes boards
only when a dispatch names `references/writing.md` by path (a gap that predates
this split — the text sat in a file no subagent ever read — and is now at least
nameable), and AGENT-066's settlement-voice tension in the moved reflect
procedures stands as that log described it.

## Completion Checklist (domain agent)

- [ ] Before and after rehearsal scorecards for every step _(deviation, recorded
      in the E2E log: the orchestrator runs the single full rehearsal pass)_
- [x] The target and its justification recorded in this file
- [x] `Writing a document`'s fate determined by search, not by assumption
- [x] `/lint` passes _(ESLint + Prettier on touched files; `tsc` is CI's)_
- [x] E2E log filled in
- [x] Self-review
- [x] Acceptance criteria verified _(except the rehearsal criterion, above)_

## Completion Checklist (orchestrator)

- [ ] `/audit` run (core loop, large — qualifies twice)
- [ ] `/evaluate` passes
- [ ] Committed with `[AGENT-067]` prefix, one commit per section
