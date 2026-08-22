# Evaluation: PLUGINS-003 — item-level anchored commenting (design deliverable, wave 2)

**Date**: 2026-07-30
**Sprint**: sprint-016 (TEST-456–460 live; TEST-461–464 `STRUCK → Open Conflict 3`)
**Verdict**: **PASS** — Part 1 complete on all five criteria; Part 2 correctly struck and
carried; the wave-3 chain is filed, dependency-ordered, and its spec rider is applied and
signed off.

Scope note: Open Conflict 3's recommended default was ruled in — PLUGINS-003 ran
**design-only** this wave. This evaluation grades the design deliverable against the
contract's Part 1 requirements, checks its §6/§12 claims against the **amended** SPEC (with
SHARED-005 applied), and verifies the wave-3 chain is coherent. TEST-460's runtime claim was
drilled live.

---

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | Present and appropriate to the deliverable: "no code changed, no server started, no test run, no git command", with the grounding read-set enumerated file by file. |
| Commands are specific and concrete | PASS (adapted) | A design-only issue has no commands to paste. What stands in for them — two load-bearing source facts with file:line, each of which decides the recommendation — is checkable, and I checked both. |
| Real E2E (not mocked) | N/A → PASS by substitution | Correctly declared: nothing was built, so nothing was drilled. The one runtime claim the contract still demands (TEST-460) I verified myself against a real server. |
| Scenarios cover acceptance criteria | PASS | TEST-456–460 each have a dedicated section; TEST-461–464 carry the strike with its reason and destination. |
| Application restarted after changes | N/A | No code changed. |
| Actual model recorded | PASS | "plugins-dev on **Opus 5**". |
| Reproduction logged before fix | N/A | Design issue. |

The log's claim `TEST-465/466 hold: SPEC.md and packages/contract were read, never written`
is confirmed mechanically: the only wave-2 commit touching this issue is
`d878971 [PLAN] PLUGINS-003 design banked`, and no implementing commit on this branch touches
`SPEC.md` (only `[SHARED-004]`/`[SHARED-005]`) or `packages/contract` (only wave-1's
`[CONTRACT-020][CONTRACT-021]`).

---

## Part 1 — Criteria Results

| # | Criterion | Result | Observed |
| --- | --- | --- | --- |
| TEST-456 | The decision is recorded, with the option set and the reason | PASS | All three named candidates are treated, **plus** a fourth (2b, a plugin-private item↔thread association) named specifically in order to be rejected — a good sign, since 2b is the tempting shortcut the option set did not list. Candidate 3 is chosen; 1 and 2 are rejected **in writing with costs stated** (Candidate 2 carries five enumerated costs and an explicit four-domain blast radius). All five sprint-016 facts are answered by name: fact 1 in the stage-by-stage table, fact 2 in the frontmatter statement, fact 3 in the identity section, fact 4 as **Gap A**, fact 5 as **Gap B**. **Fact 4 is answered decisively**: the recommendation puts item text *in the body*, so an item comment is an ordinary text-quote anchor that resolves on creation — not a design whose anchors orphan at birth. Candidate 1 is rejected precisely on fact 4. |
| TEST-457 | The decision names its blast radius across domains, honestly | PASS | A per-workspace table with owning domains: `packages/contract` (contract-dev) **No** · `apps/server` (server-dev) **No** · `packages/kit` (ui-dev) **No** · `apps/ui` (ui-dev) **No, contingent** · `plugins/todos` (plugins-dev) **Yes** · `SPEC.md` (spec-writer + sign-off) **Yes**. Better than the criterion asks: it states plainly that this **falsifies Open Conflict 3's premise** for the chosen option — the recommended design crosses no domain plugins-dev may not edit — while noting that candidates 1 and 2 are the ones that would have needed the four-domain chain. That is an honest correction of the contract, not an evasion of it. |
| TEST-458 | Item identity is settled explicitly | PASS | Settled: anchored **to the item's text** as an ordinary text-quote selector; no stable id introduced; `TodoItemSchema` needs no id field. All four lifecycle events are answered in a table with the §6 mechanism named for each — **checked** (`- [ ]` → `- [x]`: `exact` unchanged, rung 1 fails, rung 2 resolves), **renamed** (in-range edit → mapped slice becomes the new `exact`), **reordered** (the moved-passage family), **deleted** (orphaned, selector preserved byte-for-byte, listed in the detached-threads region). The identical-text ambiguity is raised and answered from §6's existing ladder rather than waved past. |
| TEST-459 | The spec's transitional note is routed, not edited | PASS | The implementing agent did not touch SPEC.md (verified above). The `[TBD]` retirement is routed to a named spec-writer rider (SHARED-005) with user sign-off, per Adjudication 24, and named in the log. |
| TEST-460 | Whole-document commenting on todo documents keeps working throughout | **PASS — drilled live** | Against my own server on `:9196`: created a real `type: todo` document (`doc_bsrlrmmz`, two items in `extra.items`), then `POST /api/threads {parent: doc_bsrlrmmz, body:"@agent please look", requestsAgent:true}` → **201**. `corpus doc show th_bbceot72` returns the thread with its first turn at `data/threads/th_bbceot72.md`; the enqueue fired (`queue status` → `pending 1`); `corpus db doctor` → "projection is clean — 29 documents from 29 files". Whole-document commenting on a plugin-rendered document is unaffected. |
| TEST-461–464 | Part 2 — the behavior | **STRUCK → Open Conflict 3** | Correctly marked, with the reason recorded in the issue file's scope-ruling block and the work carried to the wave-3 chain below. Not silently dropped. |

---

## §6 / §12 claims checked against the **amended** SPEC (SHARED-005 applied)

The design was written *before* the rider landed and proposes what the rider should say. The
rider is now applied (`ee2683e [SHARED-005] Wave-3 SPEC amendments applied, user-signed-off`).
Checking the design's claims against the spec as it now reads:

| Design claim | Amended SPEC | Consistent? |
| --- | --- | --- |
| Items become GFM task-list lines in the body | §12: "items are **checkbox lines in the document body** — standard markdown task-list items (`- [ ] text` / `- [x] text`), in body order" | ✓ |
| Open question 1 (per-item `due`), recommending option (b), an inline convention | §12: "An item may carry an inline due date — `(due: YYYY-MM-DD)` at the end of its line… text that doesn't parse as the marker is ordinary item text — never an error" | ✓ — the recommendation was taken, and the rider added the tolerance clause the design asked for |
| Gap A vanishes: an item comment is an ordinary text-quote anchor, §6 unchanged | §12: "selecting an item's text and commenting creates an ordinary text-quote anchor (**§6, unchanged — no special item anchoring exists**)" | ✓ — and §6 itself is untouched, so no anchor-model variant was introduced |
| The four lifecycle outcomes | §12: "The thread follows its item through checks, renames, and reorders, and detaches (orphaned, quote preserved) when the item is deleted" | ✓ — verbatim in substance |
| Gap B vanishes: the plugin stops registering a `View` | §12: "todo documents render in the **core document view**… The plugin registers no custom document renderer." | ✓ |
| Open question 2 (toggling a box) | §12: "In the UI, toggling a box is an ordinary body edit saved like any other; the plugin's routes remain the item-level write path for the CLI and the agent, and the plugin remains the format owner behind them." | ✓ — exactly the restatement the design asked to have confirmed |
| §12's `[TBD: PLUGINS-003]` retired | `grep "TBD: PLUGINS-003" SPEC.md` → **no matches** | ✓ |
| Templates start working for todos | §12: "its type's template can ship starter items in its body like any template pre-fill (§10)" | ✓ |

Every one of the design's open questions 1–3 has been answered in the signed spec, in the
direction the design recommended. There is no daylight between the recorded design and the
amended §12 — which is what makes the wave-3 chain safe to schedule.

---

## The wave-3 chain, checked for coherence

Proposed: `SHARED-005 ──▶ PLUGINS-005 ──┬──▶ PLUGINS-006 └──▶ PLUGINS-007`, with PLUGINS-003
staying open as the umbrella.

| Piece | Filed? | Dependency in `issues/PLAN.md` | Coherent? |
| --- | --- | --- | --- |
| SHARED-005 | `issues/shared/005-phase5-wave3-spec-pass.md` (18.9 K), status **done**, applied in `ee2683e` | line 191, depends on SHARED-004 | ✓ — and it bundled Open Conflict 2's residual `deferred:` sentences into the same sign-off round, as Adjudication 24 recommended |
| PLUGINS-005 | `issues/plugins/005-todos-body-tasklist.md` | line 192, depends on **SHARED-005** | ✓ |
| PLUGINS-006 | `issues/plugins/006-todos-drop-view.md` | line 193, depends on **PLUGINS-005** | ✓ — carries this issue's criterion 2 and TEST-461–464 |
| PLUGINS-007 | `issues/plugins/007-todos-column-body-source.md` | line 194, depends on **PLUGINS-005** | ✓ — parallel with 006, as designed |
| Contingent UI issue | deliberately **not** pre-filed | — | ✓ — the stated reason ("pre-filing it would invent work the shipped extensions may already do correctly") is sound |

The dependency edges in `PLAN.md` match the design's diagram exactly, the gating spec rider is
`done` and applied, and the umbrella issue's own acceptance criterion 2 is explicitly
superseded in writing rather than left to contradict the recommendation.

**Bonus corroboration**: Open Conflict 2's three residual `deferred:`-prefix sentences in §7
are **gone** from the amended SPEC (`grep "deferred:" SPEC.md` → no matches), and `corpus job
retry` now reads as the manual override in all three places (`SPEC.md:257,258,325`). The rider
did what it was chartered to do.

---

## Findings (non-blocking)

### FINDING-1 (MINOR): `issues/PLAN.md` still lists SHARED-005 as `todo`

`issues/shared/005-phase5-wave3-spec-pass.md` reads `## Status\ndone` and its amendments are
applied and committed (`ee2683e`), but `issues/PLAN.md:191` still shows the row as `todo`.
Orchestrator bookkeeping, not an implementation defect — but PLUGINS-005/006/007 all declare a
dependency on it, so a future scheduling pass reading the PLAN alone would consider the whole
wave-3 chain blocked.

### FINDING-2 (MINOR): PLUGINS-003 appears twice in `issues/PLAN.md`

Line 134 (`P2`, deps `UI-014, PLUGINS-002`) and line 180 (`P1`, deps `UI-014`). Two rows for
one umbrella issue with different priorities and dependency sets. Harmless today because the
issue file is authoritative, but worth reconciling before the umbrella is closed by
PLUGINS-006.

### FINDING-3 (informational): the design's own §12 cost accounting has been overtaken

Cost 4 lists "Two signed SPEC §12 clauses stop being true" and cost 5 flags the loss of the
`View` extension point's shipped consumer as needing an explicit user call. Both have since
been decided by the signed rider — §12 now says "The plugin registers no custom document
renderer" outright. The design text still reads as though those were open; a reader coming to
it fresh after wave 3 starts could mistake settled questions for open ones. Nothing to fix in
the deliverable — noted so the wave-3 agents read the amended §12 as authoritative over the
design's open-questions list.

---

## Summary

**5 of 5 live criteria pass; 4 correctly struck.** The design deliverable exceeds the
contract's Part 1 requirements: it answers all five sprint-016 facts by name, it kills
Candidate 1 on fact 4 rather than on taste, it prices Candidate 2 in five specific costs
including the one that matters most (SPEC §6's guarantees are adjudicated invariants, not
code, and none of them transfer to a second engine), and it names and rejects a fourth
option the contract did not list. The chosen design's strongest signal is the one the write-up
identifies itself: `plugins/todos/imports.test.ts`'s anchoring ban stays green **untouched**,
because core does all the anchoring — which is exactly what that boundary was drawn for.

The blast-radius table honestly falsifies the premise of the Open Conflict that scoped this
issue, the spec rider it proposed has landed and signed off saying what the design asked it to
say, and the three implementation issues are filed with matching dependency edges. TEST-460's
fallback — whole-document commenting on todo documents — I confirmed still works against a
real server.

**Verdict: PASS.** Three minor bookkeeping findings, none of them the implementing agent's.
