# [AGENT-063] A weightless resident is judged on the conversation, not defaulted to a tier

## Domain

agent-runtime

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Reverses: `AGENT-059`'s fixed strongest-tier default (shipped in v0.31.0)
- Related: `UI-186` (change a resident's weight from the Residents tab, which is
  what makes a judged pick safe), `AGENT-041`, SHARED-022

## Spec References

- SPEC.md **§7** — *"Stating no weight means the orchestrator decides, exactly as
  it decides today — absence of a choice is the judgment above, **never a fixed
  default**."* (rider signed 2026-08-06)
- SPEC.md **§7** — *"A stated weight is honoured, not weighed again."*

## Summary

**User directive, 2026-09-02:** *"I would like you to default to: orchestrator
picks based on the task. If I set which tier to use, then use that one."*

`AGENT-059` shipped a fixed default — a weightless designation launches at the
strongest tier the table declares. That is reverted. §7 already said the right
thing and this restores it: **absence of a choice is a judgment, never a fixed
default.**

**The unsigned §7 rider is withdrawn.** It existed only to legalise the fixed
default. With the default gone, §7 stands exactly as signed and needs no
amendment. `AGENT-059`'s open-question section goes with it.

## What must not come back with the revert

`AGENT-059` was filed for a real defect and reverting carelessly restores it.
The defect was **not** "Sonnet is the wrong model". It was that the orchestrator
was not judging at all:

- The **first pass** asks *"what would a bad result do that revising the document
  afterwards would not undo"*. A standing conversation has no single document to
  revise, so the pass answers `no` by default.
- The **second pass** is a table whose middle row reads *"Most comment work: read
  a thread and its parent, decide the wording, edit, reply — multi-step but
  bounded to one or two documents."* Every open-ended conversation reads like
  that sentence, so it lands on **Standard**, and the tie-break
  (*"in doubt between two tiers, take the stronger"*) never fires because nothing
  is in doubt.

So every weightless resident landed on the same tier by construction. That is
landing, not judging, and the user asked for judging.

**The work of this issue is therefore the judgment, not the revert.** The
orchestrator needs something it can actually weigh a *conversation* by, in the
skill's own terms, rather than a table describing bounded units of work.

## Why the judgment is safe now, when it was not before

`AGENT-059` argued for a fixed default from **durability**: §7 said a running
resident *"cannot change what it is without discarding the conversation it is
holding"*, so a wrong pick was permanent. That argument no longer holds:

- Re-designation already exists and already works. Changing the weight on a
  designated thread is a write — `resident.released` with reason `replaced`, the
  displaced listener stopped, a new `resident.designated`, a new listener at the
  new weight (`apps/server/src/threads/resident.ts`).
- The **conversation is a document on disk**. A relaunched listener reads it.
  What is actually lost is the listener's in-flight context, not the
  conversation — so §7's sentence overstates the cost. `SHARED-076` carries the
  rider that corrects it.
- `UI-186` puts that change one click away, in the Residents tab the person is
  already looking at.

A judged pick that can be corrected in one click is a different proposition from
one that is permanent. The user's two instructions are one design.

## Acceptance Criteria

- [x] The fixed strongest-tier rule is gone from the skill — both the payload
      launch and the roster launch
- [x] A designation stating no weight is **judged**, on the conversation, and the
      skill says what to weigh. Whatever it is, it must not be the two-pass job
      table applied unchanged, because that table lands every conversation on its
      middle row
- [x] A designation that **does** state a weight is honoured and never weighed
      again — `AGENT-041`, untouched
- [x] The launch still logs the weight **and where it came from**. The
      provenance word changes from `defaulted` to one that says a judgment was
      made and names what it picked — §7's dispatch rule still applies
- [x] `scripts/workspace-template.test.ts` guards the new rule, and its negative
      pins reject the strongest-tier wording so the revert cannot silently undo
      itself
- [x] `assets/workspace/` only; the dev harness's `.claude/` is untouched

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the launch rule
  (~line 529), the roster launch (~line 718), and the two Delegation carve-outs
  `AGENT-059` added (~868, ~959)
- `scripts/workspace-template.test.ts` — the guards
- `rehearsals/scenarios/02-weightless-designation.ts` — see below

### The scenario changes with the rule

`INFRA-034` story 2 currently pins `10/10` at the strongest tier. Under a
judgment that is the wrong assertion — a judged pick is *allowed* to vary, and
pinning one tier would re-impose the default through the test.

What it should assert instead is what §7 actually promises: the launch **logged a
weight and said it judged it**, and the weight is one the workspace's table
declares. The distribution stays recorded, because a judgment that lands on one
tier 10 times out of 10 is exactly the "landing, not judging" symptom this issue
is about — and the scorecard should make that visible rather than assert it away.

## Testing Strategy

Template guards for the wording, and `INFRA-034` story 2 for the behaviour. The
distribution in the scorecard is the real signal: if it reads 10/10 on one tier
after this lands, the judgment is not judging and that is a finding.

## E2E Verification Log

_Filled by the implementing agent; state the model._

**Implementation and verification, 2026-09-02 (agent-runtime-dev, Fable 5):**

- **The judgment, written and owned.** The payload-launch bullet of
  `orchestrate/SKILL.md` now opens *"A designation that chose no weight is
  judged on the conversation, at launch."* The question it weighs: **what did
  the person open this lane for, and what would a poor turn cost them there** —
  read off what exists at launch (the thread's title, its opening message where
  one was posted via `corpus thread show`, the designated profile's own
  document), placing the lane between the tier table's two ends: a lane opened
  to **fetch and relay** at the lighter end (a poor turn costs one exchange), a
  lane opened to **work something out** at the stronger end (the conversation
  is the deliverable). The lean, stated as the issue invited: where what you
  read genuinely answers neither way, **lean stronger rather than lighter** —
  the existing tie-break, with its reason (an over-weighted quiet lane costs
  tokens; an under-weighted one answers below its conversation until a person
  notices and re-designates). Judged once, at launch; a change is a
  re-designation, which the release case already handles. The roster launch
  and both Delegation spots now point at the judgment; the two-pass job
  scoping (AGENT-059's surviving half) is untouched.
- **Provenance.** The weightless word is **`judged`** — `stated` where a key
  was carried, `judged` where the launcher judged, naming the tier and the
  read that picked it: `(Opus 5 — stated at designation: heavy)` against
  `(Opus 5 — judged: no weight chosen, the lane is for working out a plan)`.
  `defaulted` is dead vocabulary, negatively pinned.
- **Stated weight untouched.** AGENT-041's chain (Key-cell lookup, `model`
  argument, honour-never-reweigh, unmeetable-weight) passes its pre-existing
  guards with no edit to those sentences.
- **Scenario 02 rewritten.** It no longer pins a tier: pass = a launch log on
  the designation's own event (or its `lane.waiting`) contains `judged` naming
  a declared model, the reply's recorded model matches a declared row, the
  log's tier equals the tier that ran, and the question's event is
  `processed`. Which tier is deliberately unasserted; every run's label still
  names tier · provenance so the scorecard shows the distribution — 10/10 on
  one tier stays visible as the "landing, not judging" symptom. A regression
  to the fixed rule surfaces as a `defaulted` label, not as a mute
  "unrecorded". Scenarios 01/04/05/06 and `support.ts`'s
  `launchProvenanceLogged` follow the word change (`stated`/`judged`) — they
  read the same grammar and would have gone red at the next rehearsal
  otherwise (a deliberate, minimal scope extension, reported).
- **Guards.** `workspace-template.test.ts`: *"judges a weightless designation
  on the conversation, at launch"* (owner sentence, the question, the three
  reads, the two ends, the lean, never re-judge, the worked example launching
  at a declared tier as `judged`) and *"does not launch a weightless
  designation at a fixed strongest tier"* (negative pins:
  `launches at the strongest tier the table declares`,
  `the strongest tier this table declares`, `its last row, because the table
  is written lightest first`, `strongest declared tier`, `\bdefaulted\b`).
  Provenance guard updated to the `judged` grammar. Suite: **513/513**; with
  rehearsal units **566/566**
  (`VITEST_MAX_THREADS=4 vitest run scripts/workspace-template.test.ts rehearsals`).
- **Falsification.** (1) Swapped the owner sentence back to AGENT-059's fixed
  rule: 2 tests red — the judgment guard and the negative-pin test (511/513).
  (2) Restored, then changed one `judged` back to `defaulted` in the log
  grammar: 2 tests red — the negative-pin test and the provenance guard
  (511/513). Restored; 566/566 green.
- **Fresh-workspace drill.** `corpus init` (tsx, from source) into a scratch
  dir installed 26 template files; the installed
  `.claude/skills/orchestrate/SKILL.md` is byte-identical to the template
  (diff clean), carries the owner sentence and all three `judged: no weight
  chosen` occurrences, and has **zero** hits for
  `defaulted`/`strongest tier the table declares`/`strongest declared tier`.
  The rehearsal table reader resolves the installed table:
  `[light/Haiku, standard/Sonnet, heavy/Opus 5]`.
- **Live queue drill (scratch server, port 8767 — never 8765).**
  `corpus thread create --title "First vegetables" --requests-agent true -m …`
  → `claim-all` returned `resident.designated` with
  `{"name":null,"docId":null,"weight":null,…}` and a `lane.waiting`; the
  roster printed `a general resident` with no qualifier. Logged the judged
  launch as the skill now directs —
  `… a general resident (Haiku — judged: no weight chosen, the lane is for
  quick factual lookups)` — completed the event, and read the line back off
  `.corpus/jobs/evt_xmkbqqfgxxh5.jsonl`: exactly what scenario 02's scorer
  parses (contains `judged`, names a declared model, carries the read). Server
  stopped, port freed.
- **Issue bookkeeping.** AGENT-059's unsigned §7 rider section deleted
  (withdrawn, not signed) with a reversal note at the top of its Summary.
- **Lint/format/types.** `npm run lint` exit 0; Prettier clean on all touched
  files; `tsc --noEmit` clean for `scripts/` and `rehearsals/`.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
