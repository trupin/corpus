# [SERVER-032] `needs=form` drops a thread while a second form is still answerable

## Domain

server

## Status

in_progress

## Priority

P2

## Model

opus — a detector refinement with a SPEC-reading to confirm.

## Dependencies

- Depends on: SERVER-029
- Blocks: —

## Spec References

- SPEC.md §6/§11 — forms and the needs reasons
- issues/evals/HARDENING-P4-eval.md — F-1 (2026-07-29)

## Summary

Found by the Phase 4 evaluator (reproducible): a thread carrying **two** unanswered forms leaves
`needs=form` once *either* form is answered — the first answer moves `last_author` to `user`,
which is the detector's engagement heuristic — while the second form remains answerable (`201`)
and UI-013's finding-12 fix deliberately keeps every unanswered form live in the renderer. SPEC §6
reads as form-scoped, so detector and renderer disagree on multi-form threads.

Refine the detector so a thread stays in `needs=form` while ANY unanswered agent form exists
(per-form answered-state, buildable from `has_form` turns vs. answer turns), or — if the product
answer is "one form at a time" — propose the SPEC clarification instead. Decide with a SPEC
reading; don't guess.

## Acceptance Criteria

- [x] Multi-form thread behavior is consistent across detector, renderer, and SPEC — either the
      detector counts unanswered forms, or the SPEC says one-at-a-time and the renderer follows.
      (Detector counts unanswered forms; `SPEC.md:185` unchanged — Adjudication 14.)
- [x] The evaluator's reproduction is the regression test.
      (`docs/query.test.ts` → "needs=form — a thread may carry several independently answerable
      forms".)

## E2E Verification Log

implemented on: **opus** (server-dev, sprint-017 stage D, 2026-07-30)

Workspace: `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s017-server032-S8cZD5`, created with
`corpus init --port 9192` from a cwd outside this repository. Server started from source
(`node_modules/.bin/tsx apps/server/src/main.ts --workspace <ws>`), port **9192** per the contract.
`8765` checked and left alone (`lsof -nP -iTCP:8765 -sTCP:LISTEN` → nothing, before and after).

### The spec reading (TEST-554) — Adjudication 14, applied, not re-litigated

`SPEC.md:185`:

> A form has no identity of its own: it is identified by the timestamp of the turn carrying it, so a
> turn carries **at most one form**, and answering a form addresses the turn that carries it.

Forms are identified **per turn** and an answer addresses **the turn that carries it**, so a thread
may hold several independently answerable forms. The detector is fixed; `SPEC.md` is not edited (no
agent in this session opened it for writing), and the "propose a one-at-a-time clarification" branch
stays closed.

### TEST-548 — pre-fix reproduction (before any code changed)

Two agent turns, each carrying a form, in one `agent: requested` thread on `doc_kxmr7hgt`:

```
form 1 turn: 201 2026-07-30T20:39:22Z
form 2 turn: 201 2026-07-30T20:39:23Z
needs=form after both forms posted: [{"id":"th_xgbqkfgw","attention":["unread-reply","form"]}]
answer form 1 (ts 2026-07-30T20:39:22Z): 201 "**Answered:** F1-yes"
  needs=form now: []                                  <-- the defect
answer form 2 (ts 2026-07-30T20:39:23Z): 201 "**Answered:** F2-yes"
```

The second form was still answerable (`201`) — and the renderer still drew its controls — while
`GET /api/docs?needs=form` had already dropped the thread. Cause, read off the shipped SQL
(`needs.ts:82-86` pre-fix): `t.last_author = 'agent' AND tu.ts = t.last_ts`. The first answer appends
a user turn, so `last_author` moves and the whole predicate goes false.

### The projection choice (TEST-555) — **a schema change, deliberately**

**Chosen: a projected column, `turns.form_answered` (nullable), `SCHEMA_VERSION` 6 → 7.**

- **Not derivable from `turns.has_form` alone.** Pairing an answer turn with the form it answers
  means matching the option the answer names against *that form's* `options` — which is the fence
  regex plus a YAML parse plus `FormSchema`. SQLite can express none of it, and SERVER-029 is
  precisely the finding that a SQL translation of this grammar drifts from the route.
- **Not a count either.** "Count agent form-turns against turns starting with `**Answered:**`" needs
  the label in SQL (a second grammar again) *and* gets the answer wrong: §6 defines no once-only
  rule, so answering one form twice would silently retire a second, unanswered form. That case is
  pinned by `core/form.test.ts` ("leaves an answer that no open form offers alone") and by
  `query.test.ts` ("does not let a repeated answer close a different form").
- **Where it is computed.** `core/form.ts`'s new `readThreadForms(turns)` — one pass, one `readForm`
  per turn, no extra parsing versus the `carriesForm` call it replaces. It applies the same
  attribution the shipped renderer applies when it has no session pairing to go on (earliest still
  open form that offers the answered option; an answer no open form offers is left alone).
  `project-document.ts` writes `has_form` and `form_answered` from that one reading, so the two
  cannot disagree.
- **`NULL` unless the turn is an agent turn carrying a form**, so `form_answered = 0` reads as
  exactly "an unanswered agent form".

Rebuild proof on a workspace built **before** the change (its `cache.db` was stamped
`schema_version = 6`, `turns` had no `form_answered`; a byte copy of that pre-change workspace is
kept at `…/tmp/s017-server032-prechange-snapshot`):

```
{"msg":"projection schema changed; rebuilding from files","from":6,"to":7,...}   # boot, automatic
meta schema_version = 7
turns columns = thread_id,idx,author,ts,body_md,has_form,form_answered
form rows = [{"ts":"…20:39:22Z","has_form":1,"form_answered":1},{"ts":"…20:39:23Z","has_form":1,"form_answered":1}]

$ corpus db doctor    -> projection is clean — 24 documents from 24 files (2ms)
$ corpus db rebuild   -> rebuilt the projection in 13ms — 24 documents, 8 threads, 38 turns, …
$ corpus db doctor    -> projection is clean — 24 documents from 24 files (1ms)
```

The column is reconstructed from the thread files alone; no workspace needs manual repair.
**Reported to the orchestrator as a projection migration inside a P2 bugfix** (Open Conflict 2's
default), so `/audit` can pick it up at harvest.

### TEST-549 / TEST-550 — post-fix, same reproduction

```
needs=form after both forms posted: [{"id":"th_62ekuens","attention":["unread-reply","form"]}]
answer form 1 (ts 2026-07-30T20:47:16Z): 201
  needs=form now: [{"id":"th_62ekuens","attention":["form"]}]   <-- holds
answer form 2 (ts 2026-07-30T20:47:17Z): 201
  needs=form now: []                                            <-- clears
```

### TEST-551 — order does not matter

Second form answered first (`th_jlum26rf`): after `F2` → `needs=form` **present**; after `F1` →
**absent**. Three-form thread `th_4d4m7dj5` answered `2, 3, 1`: present, present, present, absent.

### TEST-552 — detector and renderer agree at every step

Driven against the running server on 9192 with the **renderer's own module** imported unchanged
(`apps/ui/src/thread/parseFormBlock.ts` → `mapFormAnswers` + `parseFormBlock`); nothing in the drill
re-implements either side:

```
after three forms, none answered   renderer: 3 answerable  detector: PRESENT  agree: YES
first answer (form 2) -> 201       renderer: 2 answerable  detector: PRESENT  agree: YES
second answer (form 3) -> 201      renderer: 1 answerable  detector: PRESENT  agree: YES
third answer (form 1) -> 201       renderer: 0 answerable  detector: absent   agree: YES
```

### TEST-553 — nothing else about `needs` moves

- Single-form thread (`th_i5kjoi66`): `form` present after the form, absent after the answer —
  unchanged.
- `t.status = 'open'` still gates it, drilled live: open thread with two unanswered forms →
  `needs=form` **true**; `POST /api/threads/{id}/resolve` (200) → **false**; `…/reopen` (200) →
  **true** again.
- A user turn quoting a form fence still raises nothing (`query.test.ts`, and the answer route's own
  404 for it is untouched).
- The whole shipped `needs=form` suite in `docs/query.test.ts` — `formula`/quoted/indented/inline
  near-misses, unterminated fence, bad YAML, not-a-form, trailing-space info string — passes
  **unmodified**; only new cases were added, in a separate `describe` with its own workspace so the
  existing exact-equality assertion was not perturbed.

### Tests

- `apps/server/src/core/form.test.ts` — `answeredOption` + 8 `readThreadForms` cases (two forms, all
  answered, out of order, repeated answer, shared option strings, user-quoted fence, agent answering
  its own form, no forms at all).
- `apps/server/src/docs/query.test.ts` — new `describe`: the evaluator's reproduction as a
  regression test, plus order-independence, three-form staging, the repeated-answer trap, single-form
  parity, resolved-thread parity, user-quoted fence.
- `apps/server/src/projection/db.test.ts` — the pinned `turns` column list extended.
- Full workspace run: **`vitest run apps/server` → 122 files, 2470 tests, all passing**
  (`VITEST_MAX_THREADS=4`). ESLint and Prettier clean on every touched file; `tsc --noEmit` clean.

### Blast radius (TEST-556)

Server only: `docs/needs.ts`, `core/form.ts`, `projection/schema.ts`,
`projection/project-document.ts`, `threads/forms.ts` (two stale docblock sentences that described the
old thread-scoped behavior), plus the four test files above. No `SPEC.md`, no `packages/contract`, no
`apps/ui` — the renderer was already correct (UI-013), which is why this was a server issue. Per this
agent's standing rule it ran **no git command** in the development repository (TEST-575); the
blast-radius diff is the orchestrator's to run.

### Note for the orchestrator

`answeredOption`'s rule now exists twice — here and in `apps/ui/src/thread/parseFormBlock.ts` — both
built on the contract's `FORM_ANSWER_LABEL`. The natural single home is `packages/contract` (beside
`FORM_ANSWER_LABEL` and `validateFormAnswer`), but a contract change is out of scope for this issue
(TEST-556) and the UI copy carries an extra session-pairing rung the server cannot have. Filing a
contract-dev issue to host the shared attribution is worth considering; it is not needed for
correctness today, because both copies agree on every thread read off disk (TEST-552 drills exactly
that).

## Audit fix round

_Appended 2026-07-30 by server-dev (opus) in the wave-3 audit fix round
(`issues/evals/AUDIT-S017-wave3.md`). Everything below lands in this issue's own files._

- **FIX 10 — a turn that both answers a form and carries one now counts as both.** The old early
  `return` left such a turn at `form_answered = NULL`, i.e. "nothing to answer here", while
  `POST …/turns/{ts}/form` accepted an answer for it: the same accept-but-never-advertise
  disagreement SERVER-029 and this issue exist to remove. Reproduced on a real server —
  `(2, 'agent', has_form 1, form_answered NULL)`, `needs=form` empty, and `201` from the answer
  route for that very turn — then fixed and re-verified (`form_answered 0`, thread listed with
  `["unread-reply","form"]`, answering it clears the reason). The rejected alternative
  (`answered: false` without opening the form) would have advertised a reason no answer could ever
  clear, which SERVER-022 finding 3 forbids. It is the one place this reader is deliberately wider
  than the renderer's `mapFormAnswers`, which `continue`s past its own registration and leaves such
  a form live forever — pinned by a named test, and reported for a UI follow-up.
- **FIX 12 — `turns_unanswered_form`.** `tu.has_form = 1 AND tu.form_answered = 0` inside the
  `EXISTS` could only seek the thread, so every turn row of every open thread was fetched and
  tested — a cost linear in conversation length, paid on every `needs=me`. A partial index on
  `thread_id WHERE has_form = 1 AND form_answered = 0` holds one entry per open question: measured
  on the real fixture (150 threads × 80 turns) **1.9 ms → 0.3 ms median**, and on a synthetic
  500 × 60 corpus 2.26 ms → 0.06 ms. `SCHEMA_VERSION` 7 → 8, because an index only reaches a
  database at `CREATE`; the plan is asserted in `docs/performance.test.ts` (it fails without the
  index) and the two conjuncts are now documented in `needs.ts` as load-bearing for it.
- **FIX 16 / TEST 18 — `db doctor` no longer blesses a projection it cannot read.**
  `openProjectionReadonly` now checks the stamp and refuses, naming `corpus db rebuild`; a read-only
  handle cannot repair, and a wrong "projection is clean" is worse than no answer. Reproduced on the
  real server (stamp forced to `6` under a running server → `projection is clean — 13 documents from
  13 files (1ms)`, exit 0) and re-verified after the fix (the CLI fails, exit 5, and the guidance is
  in the server log verbatim). **Known limitation for the orchestrator**: `doctorDb` declares only
  `200` and `401`, so the refusal surfaces to the CLI as `500 internal_error` — the same shape the
  pre-existing "no projection at …" refusal already has. Making the message reach the terminal needs
  a declared error response on that route, i.e. a contract change, which this round does not make.
  TEST 18 covers the other half with a **frozen v6 DDL fixture** (a `turns` table with no
  `form_answered`), rebuilt at open: new column filled from the file, stale row corrected, the new
  index present. Live confirmation of the same path: `projection schema changed; rebuilding from
  files {"from":6,"to":8}` at boot, then `corpus db rebuild` → stamp 8, `turns_unanswered_form`
  present, `db doctor` clean.
- **CLEAN 51 — the attribution choice is documented, and the `formTs` alternative is left a P3.**
  The evaluator's FINDING-3 (two open forms sharing an option string; answering one twice retires
  the other) is now a named test and a docblock section. Implementing exact attribution was
  considered and declined as out of this domain: the answer route knows the form's `ts` and throws
  it away because the turn is prose, so recovering it means changing SPEC §6's turn grammar, the
  contract's `FORM_ANSWER_LABEL` and the renderer's reader together — and nothing local can fake it,
  since every projected column must be rebuildable from the file alone.
- **CLEAN 41** — `carriesForm` deleted (production-dead, and its docblock claimed a role
  `readThreadForms` has held since this issue); the body-by-body question survives as the test
  file's own helper. **CLEAN 50** — the nested ternary in `project-document.ts` is now
  `state?.answered ?? null` plus one `Number()`.
- **TESTs 17/19/20** — `form_answered`'s column values are pinned per turn (including every `NULL`
  case), malformed fences are crossed with answers in `query.test.ts` (a fence nobody can answer
  must neither light the reason nor absorb an answer meant for one that is answerable), and the
  duplicate-`ts` case is recorded: `INSERT OR IGNORE` drops the second turn, form and all, so a
  §14 hard failure in the file costs that form its row.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (ESLint + Prettier on every touched file; `tsc --noEmit` clean)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
