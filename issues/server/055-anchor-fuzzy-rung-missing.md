# [SERVER-055] The read path implements two of SPEC §6's three resolution rungs

## Domain
server

## Status
closed — implemented, then **reverted**, and deliberately not in the tree.
Wiring SPEC §6's third rung into the read path landed threads on the neighbouring
bullet, the next table row and the parallel paragraph — the silent misattachment
§6 forbids, worse than the detachment it was meant to cure (sprint-003
Adjudication 1). `apps/server/src/docs/read.ts` records this at the resolver.
Was `done`, which told a reader the behaviour is there. (INFRA-027, 2026-08-13.)

## Priority
P1

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §6 Anchoring — the resolution ladder

## Summary
Escalated by UI-062 (2026-08-04) while tracing why a comment landed at the top of
a document.

`apps/server/src/docs/read.ts:252` resolves anchors with `resolveAnchorExact` —
rungs 1 and 2 (literal match, then unique `exact`). SPEC §6 specifies a **third,
fuzzy rung** for when a document has been edited under an anchor. It is not
implemented on this path, so an anchor that the spec says should survive a small
edit is reported `orphaned` instead.

The user-visible consequence: edit a paragraph you have commented on, and the
comment detaches when the spec says it should follow. That is the whole point of
text-quote anchoring over line numbers — it is supposed to survive editing — so
this is a gap in the central promise of §6, not a nicety.

Worth checking before assuming it is simply missing: the anchor **engine** has
had substantial work (SERVER-002, -012, -013, -014 covered truncated selectors,
the substitution class, and duplicate-survivor policy). It is possible the fuzzy
rung exists in the engine and the read path does not call it, which would make
this a wiring fix rather than an implementation. Establish which first — the two
have very different risk.

## Acceptance Criteria
- [x] The read path resolves through the full §6 ladder, fuzzy rung included
- [x] An anchor whose surrounding text was edited but whose quote survives is
      resolved, not orphaned — with a test per edit shape (insertion before,
      insertion inside, deletion after, whitespace change)
- [x] A quote that genuinely no longer exists still orphans — the fuzzy rung must
      not become a "match something nearby" that re-introduces the
      confidently-wrong anchoring the client-side guards exist to prevent
- [x] Duplicate-survivor policy (SERVER-014) is respected by whatever the fuzzy
      rung does; the two must not disagree about which of two candidates wins
- [x] If the engine already implements it, say so and make this a wiring change
      with the reasoning recorded rather than a second implementation
- [x] Reconciliation on write (§6) and resolution on read agree about what
      resolves — a divergence here would show as an anchor that reconciles
      cleanly and then reads as orphaned

## Technical Design
### Files to Create/Modify
- `apps/server/src/docs/read.ts`, the anchor engine, tests

## Testing Strategy
Fixture-driven per edit shape, plus a round-trip test: write an edit through the
real mutation path and assert the anchor reads back resolved.

## E2E Verification Log

**Model: Opus 5 (1M context)**, server-dev agent. Real `corpus init` workspaces,
real server started with `corpus server start` on port **8791** (8765 and 5173
never touched), real HTTP, real files on disk, real watcher. Three builds were
run against the same scenario script: the shipped exact-only build (red), and the
fixed build (green).

### Was the rung missing, or unwired? — **unwired, and deliberately so**

`findFuzzyRange` (`apps/server/src/anchors/fuzzy.ts`) is a complete rung 3 and
has been since SERVER-002, and `resolveAnchor` composes the whole ladder.
`reconcileAnchors` already calls it — `reconcile.ts:134` locates every selector
in `oldBody` with the **full** ladder. What stopped at rungs 1–2 was every
*reader*: `docs/read.ts`, `projection/project-document.ts` and §14's `checkSeams`.

That was not an oversight. **Sprint-003 Adjudication 1** chose exact-only
explicitly, on a premise stated in the contract itself: "reconciliation runs on
every write path… so a live anchor's selector is always fresh by the time the
projector sees it". The premise is false in three named states, one of them
permanent:

1. **A selector that never byte-matched** (UI-068's canonical-mismatch class): an
   anchor born orphaned. No later save repairs it, because reconciliation leaves
   an anchor that does not resolve in `oldBody` exactly as it found it.
2. An **out-of-band edit** inside the watcher's debounce and its 100 ms flush
   budget (SERVER-022).
3. A **thread document whose turns were appended or deleted** — `turns.ts` never
   mentions anchors, so no reconciliation pass ever sees that body change.

So this is a wiring change, with one engine change that the wiring required (see
below) and no second implementation of the rung.

### The engine change the wiring required

Wiring rung 3 in unchanged would have been unsafe, and the sprint-003 objection
was concrete: a deleted bullet's parallel sibling. Measured, not assumed —
`"- milk from the corner bakery"` is **5** edits from `"- bread from the corner
bakery"` against a budget of `floor(30 × 0.25) = 7`, so the quote-similarity test
accepts it outright. Reverting only the new gate turns the *pre-existing* test
`never lands the orphaned bread bullet on the milk bullet` red.

The fix is a **corroboration gate**, not a new threshold: a fuzzy candidate is
accepted only when the passage **with its declared context** —
`prefix + exact + suffix`, the very string rung 1 matches literally — is within
the same `FUZZY_THRESHOLD` of the body at that offset. An in-place edit leaves
its neighbours; a sibling has its own. Rung 3 becomes the fuzzy analogue of rung
1 instead of "match something nearby". **No constant was added**, ranking and
tie-breaks are untouched, and a selector with no context at all is unaffected
(nothing to corroborate — rung 1 is skipped for it too).

### Pre-fix red on a real server (exact-only build, `/tmp/s055red`)

```
[1] at creation:              {"orphaned":false,"range":{"start":76,"end":106}}
    ← file edited on disk: "a 30-year fixed at 6.1%" → "a 30-year fixed-rate at 6.4%"
[1] read immediately:         {"orphaned":true,"range":null}        ← the comment detached
[4] fuzzy-resolved on read:   {"orphaned":true,"range":null}
[4] reconcile report:         {"remapped":["anc_58905b0e"],"orphaned":[]}
```

`[4]` is the divergence the issue names, in two consecutive lines from one
server: the reader calls the thread detached, and the very next save's
reconciliation resolves the same selector and reports it **remapped**.

The permanent class, same build, with **no edit at all** — a selector quoting the
editor's re-print (`5 * 3`) of a file that carries `5 \* 3`:

```
[6] right after the comment was posted:  {"orphaned":true,"quote":null}
[6] 3 s later (watcher has had its go):  {"orphaned":true,"quote":null}
```

### Post-fix, same scenarios, same script (fixed build, `/tmp/s055green`)

```
[1] read immediately:         {"orphaned":false,"quote":"assume a 30-year fixed-rate at"}
[1] after watcher reconciled: {"orphaned":false,"quote":"assume a 30-year fixed-rate at 6.4%"}
[2] quote genuinely gone:     {"orphaned":true,"range":null}   ← unchanged, before and after
[2] after watcher reconciled: {"orphaned":true,"range":null}
[3] deleted line, lookalike sibling one line below: {"orphaned":true,"range":null}
[3] landed on the Q4 sibling? no
[4] fuzzy-resolved on read:   {"orphaned":false,"quote":"assume a 30-year fixed at 6.4%"}
[4] reconcile report:         {"remapped":["anc_bbe67be5"],"orphaned":[]}
[4] read after the save:      {"orphaned":false,"quote":"assume a 30-year fixed at 6.4%"}
[6] right after the comment was posted:  {"orphaned":false,"quote":"fixed and 5 \* 3 is fiftee"}
```

`[1]` also shows the rung being honest about its own precision: the fuzzy window
is `exact.length` long, so the range is approximate (`…fixed-rate at`) until
reconciliation snaps it to the real bytes ~1 s later. `[2]` and `[3]` are
byte-identical before and after — the safety cases were never traded for the
feature.

The agent's context pack for `[1]`, read through `GET /api/threads/{id}/context`,
returns the **anchored** shape, not `orphaned-anchor`:

```json
{"id":"doc_wdgerxg7","headingPath":"Mortgage model",
 "quote":"assume a 30-year fixed-rate at 6.4%","section":"# Mortgage model…"}
```

`corpus doc check` on the same workspace warns `anchor-unresolved` for exactly
the two genuinely-gone anchors and for none of the 400 fuzzy-resolved ones — §14
now means by "orphaned" what the reader means.

### The perf objection sprint-003 raised, measured

Fuzzy runs only for an anchor that failed both exact rungs, so a healthy
workspace pays nothing. The pathological workspace — 400 documents, every anchor
falling all the way to rung 3 — was built and `POST /api/db/rebuild` timed three
times each way on the same server:

| every anchor resolves exactly (fuzzy never runs) | every anchor falls to rung 3 |
| --- | --- |
| 175 / 218 / 220 ms | 372 / 248 / 246 ms |

≈ 0.1 ms per unresolved anchor, matching a direct microbenchmark of
`findFuzzyRange` (0.052 ms present / 0.078 ms absent on a 6 KB body). SERVER-004's
2 s target for 2000 documents is not in play. Afterwards: `db doctor` →
`projection is clean — 419 documents from 419 files (11ms)`; `schema_version` →
`10`; 403 anchors with a `resolved_offset`, 2 NULL (the two deliberately-gone).

### Gates

- `apps/server` suite: **3193 passed / 164 files**, 0 failed
  (`VITEST_MAX_THREADS=4 vitest run apps/server`).
- Pre-fix red, by reverting each half in place and re-running: reverting the
  **wiring** → 4 red (3 in `docs/read.test.ts`, 1 in
  `projection/project-document.test.ts`); reverting the **context gate** alone →
  4 red, including the pre-existing `never lands the orphaned bread bullet on the
  milk bullet`.
- `npx eslint … --max-warnings 0`, `npx prettier --check`, `npx tsc --noEmit -p
  apps/server/tsconfig.json`: all clean.

### Processes

The workspace server on 8791 was started and stopped for each build; 8791
verified free at the end, no vitest workers left. Ports **8765** and **5173** were
never touched. Scratch workspaces removed.

---

## REVERTED (2026-08-05) — the read-path wiring is withdrawn

**Model: Opus 5 (1M context)**, server-dev agent. Triggered by the Fable review of
PR #22, which found the corroboration gate above does not hold. It does not, and
the failure is larger than the review measured. The wiring is reverted;
`findFuzzyRange` stays where it was before this issue: reconciliation only.

Acceptance criteria 1, 2 and 6 above are **withdrawn as written** — they asked for
a behaviour §6 forbids. Criteria 3, 4 and 5 stand and are what the revert keeps.

### 1. The reviewer's three cases, reproduced against PR-head sources

Driving the real `resolveAnchor(newBody, selector)` with `prefix`/`suffix` from
the real `computeContext`, and `reconcileAnchors` alongside it:

```
A. bullets — eggs / bread / milk / jam; the anchored "- bread from the corner bakery" deleted
   reconcile:     {"unchanged":[],"remapped":[],"orphaned":["anc_1"]}
   resolveAnchor: [41,71) -> "\n- milk from the corner bakery"          ← the sibling

B. parallel prose — three "Attendees agreed to revisit the X model in Qn." paragraphs; first deleted
   reconcile:     {"orphaned":["anc_1"]}
   resolveAnchor: [9,61) -> "Attendees agreed to revisit the staffing model in Q2"   ← the sibling

C. two threads, bread deleted, milk kept
   reconcile:     {"remapped":["anc_milk"],"orphaned":["anc_bread"]}
   resolveAnchor: anc_bread -> [41,71)      anc_milk -> [42,71)   ← overlapping claims
```

All three confirmed, including case C's overlapping claims on disjoint old text —
§6's "two threads anchored to disjoint text never end up claiming overlapping
text after a save", violated verbatim.

### 2. Five further shapes, and a class the review did not reach

Twelve deletion shapes were built (every selector via `computeContext`, every
list ≥ 3 items). **Eight misattach**: homogeneous bullets; a one-character-apart
`Q1–Q4` list at the middle, first and last item; parallel table rows; a task
list; parallel prose; numbered steps. Two orphan correctly (template prose whose
neighbours differ; a two-item list) and both do so on the **length** term, which
is what made the shipped two-item safety tests pass.

Worse, and new: **the rung is wrong on genuine edits too.**

```
edit "| north-2 | alice | green |" -> "| north-2 | alice | amber |"
  resolveAnchor -> "| north-3 | alice | green |"      ← the untouched row below
edit "- Review the Q2 report by Friday" -> "- Review the Q2 revenue report by Friday"
  resolveAnchor -> "- Review the Q3 report by Friday" ← the untouched item below
```

The anchored passage is still on the page, edited, and the reader answers with a
neighbour. This is the case the feature was filed to serve.

### 3. On a real server — the misattachment is permanent, not a debounce window

Real `corpus init` workspace, real server on port **8793** (8765 and 5173 never
touched), real HTTP, files edited out of band, real watcher. Two runs of one
script, PR-head sources and reverted sources, with selectors carrying context —
the shape the UI writes and the only shape the gate ever examined:

```
PR-HEAD    [delete] at creation:      orphaned=False quote="- Ship the Q2 renewal report by Friday afternoon"
           [delete] read immediately: orphaned=False quote="- Ship the Q3 renewal report by Friday afternoon"
           [delete] after reconcile:  orphaned=False quote="- Ship the Q3 renewal report by Friday afternoon"
           [edit]   read immediately: orphaned=False quote="- Ship the Q3 renewal report by Friday afternoon"
           [edit]   after reconcile:  orphaned=False quote="- Ship the Q2 revenue renewal report by Friday afternoon"

REVERTED   [delete] read immediately: orphaned=True  quote=null
           [delete] after reconcile:  orphaned=True  quote=null
           [edit]   read immediately: orphaned=True  quote=null
           [edit]   after reconcile:  orphaned=False quote="- Ship the Q2 revenue renewal report by Friday afternoon"
```

The deleted-bullet line is the finding: reconciliation orphans the anchor and
preserves the selector, and the reader then re-guesses that preserved selector
onto the Q3 bullet **on every read, forever**. Nothing repairs it. A comment
sits on text its author never wrote about, permanently, with no warning anywhere
— `corpus doc check` reported no `anchor-unresolved` for it under PR-head.

Also measured: `corpus thread create` stores `prefix`/`suffix` exactly as sent,
so a CLI-created anchor is **context-free** and `contextCorroborates` returns
`true` at its first line. The gate was inert for every anchor the agent opens.

### 4. Why no gate was landed

Three candidate gates were scored over all 18 shapes:

| gate | shapes it gets wrong |
| --- | --- |
| unique quote-plausible site + corroboration | the three in-list *edit* cases |
| unique corroborated site | 8 |
| candidate must fit `exact` better than the declared suffix | 4 |

The first is the only one that rejects every deletion shape, and it does so by
rejecting every **edit** inside a list or table as well — the shapes where the
rung is most wanted. Its uniqueness test is also computed over a heuristic
candidate generator (a bitap seed plus five sampled 16-unit shingles, capped at
64 — measured returning 64 sites for a body holding 80), so "no second plausible
site exists" is not a property it can certify; making it sound needs
pigeonhole-complete seeding, i.e. a redesign of candidate generation.

Underneath all three sits a fact no gate can get around. Deleting
`- Review the Q2 report by Friday` from a Q1–Q4 list, and renaming that line to
`Q3` while deleting the old Q3 line, produce **the same `newBody` from the same
`oldBody` with the same selector**, and want opposite outcomes (asserted in
`resolve.test.ts`). The bodies do not carry the answer, so no function of them
is right about both, and §6 breaks that tie one way: orphan. Any similarity
measure will keep saying parallel items are similar, because they are.

### 5. What was reverted, and what stayed

- `docs/read.ts`, `projection/project-document.ts`, `docs/write.ts`
  (`checkSeams`) → `resolveAnchorExact`, rungs 1–2.
- `anchors/fuzzy.ts` → `contextCorroborates` removed; `findFuzzyRange` is
  byte-for-byte its pre-SERVER-055 self. Reverting *only* the wiring would have
  left reconciliation's `oldBody` lookup running a gate nothing reviewed for that
  question.
- `reconcileAnchors` is untouched — it keeps the full ladder for `oldBody`, where
  a fuzzy hit means "this selector has drifted from its own text" and the diff
  adjudicates what follows.

**`SCHEMA_VERSION` 10 → 11**, not back to 9. A v10 projection holds
`anchors.resolved_offset` values this projector would never write — some of them
pointing at a passage the anchor's author never commented on — and only a rebuild
clears them. Going back to 9 would also rebuild (the check is a mismatch, not an
ordering), but it would leave two different databases stamped 9, which is a trap.
A workspace that never ran v10 pays one extra rebuild.

**SERVER-014 cannot disagree with this outcome.** Its rule is that uniqueness
adjudication runs only when the engine has lost the anchor's own bytes and must
prove survival, and that a mapped slice byte-identical to the `exact` is the diff
demonstrating where the text went. Both halves live inside `reconcileAnchors`,
on the diff-backed path, which this change does not touch. The read path holds
no diff, so it is always "must prove survival" territory — exactly where
SERVER-014 says verbatim evidence is required — and `resolveAnchorExact` is that
evidence. The duplicate-survivor fast path is a statement about `equal`
classifications, which only exist where there is a diff.

### 6. Tests

- `anchors/resolve.test.ts` → new block **"rung 3 is inadmissible on a read
  path"**: eight deletion shapes (bullets, a one-character-apart list at three
  positions, table rows, a task list, parallel prose, numbered steps) asserting
  the reader orphans *and* the full ladder lands on something that is not the
  quote; the two edited-in-place cases; the two-intent construction; and the
  unique-passage case rung 3 gets right, kept as the stated cost. Every list
  carries **four** parallel items — at two, a deletion shortens the body by a
  whole item and a length term rejects the sibling for free, which is how the
  shipped safety tests passed while the rung was misattaching.
- `docs/read.test.ts` → the ladder block now pins orphan-on-edit-inside-the-quote
  and the save that repairs it; the sibling test is parameterised over bullets, a
  table and parallel prose at four items; a new case pins that an *edited* table
  row orphans rather than pointing at the row below; the projection-agreement
  test now checks both the attached and the orphaned direction.
- `anchors/fuzzy.test.ts` → the two gate-dependent tests are replaced by tests
  that pin the rung's actual behaviour (it accepts a deleted bullet's sibling,
  and it ranks by quote similarity ahead of declared context), so the reason the
  rung stays off read paths is recorded where the rung lives.
- `projection/project-document.test.ts` → the fuzzy-offset test asserts NULL; a
  new test pins NULL for the deleted-table-row shape.

### 7. Gates

- `apps/server` suite: **3286 passed / 168 files**, 0 failed
  (`VITEST_MAX_THREADS=4 vitest run apps/server`).
- `npx tsc --noEmit -p apps/server/tsconfig.json`, `npx eslint … --max-warnings
  0`, `npx prettier --check` over the touched files: clean.
- Live workspace afterwards: `db doctor` → `projection is clean — 33 documents
  from 33 files (6ms)`; `schema_version` = **11**; 12 anchors, 5 NULL, matching
  `corpus doc check`'s five `anchor-unresolved` warnings exactly — the reader,
  the projection column and §14 give one answer.
- Server on 8793 stopped, port verified free, scratch workspaces removed, no
  vitest workers left. 8765 and 5173 untouched.

### 8. What a re-filed issue must solve

The gap SERVER-055 identified is real and unaddressed: a selector that never
byte-matched (UI-068's canonical-mismatch class) reads orphaned forever, because
reconciliation leaves an anchor it cannot locate in `oldBody` exactly as it found
it. That class is worth fixing — but it is a *repair* problem, not a resolution
problem, and it should not be fixed by making every read fuzzy.

A future attempt has to answer the question this one could not: **what evidence,
available to a reader, distinguishes "this passage was edited" from "this passage
was deleted and a sibling remains"?** Similarity is not it, in either direction —
parallel items are supposed to look alike, and the two-intent construction shows
the bodies are genuinely silent. Directions that do not require that answer:

1. **Repair at the source, not at read time.** Give the canonical-mismatch class
   its own pass — a one-off, diff-free re-resolution attempt recorded *in the
   file* (rewriting the selector once, with a visible provenance) rather than a
   guess recomputed on every read. A wrong answer then appears once, in a commit,
   where it can be seen and reverted.
2. **Make the reader's honesty cheap to recover from.** An orphaned thread that
   offers "re-attach to…" candidates in the UI turns the ambiguity into a
   one-click user decision, which is the only party that actually knows which
   intent produced the body.
3. **If a fuzzy read rung is attempted again**, it needs (a) pigeonhole-complete
   candidate generation, so "unique" means unique; (b) a rule that orphans on any
   ambiguity, accepting that in-list edits orphan; and (c) adversarial fixtures at
   ≥ 3 parallel items in every shape, since two-item fixtures certify unsafe
   resolvers as safe.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes (scoped: eslint, prettier, tsc over the touched files)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
