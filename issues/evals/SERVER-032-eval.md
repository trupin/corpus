# Evaluation: SERVER-032 — `needs=form` counts unanswered forms, not last speakers

**Date**: 2026-07-30
**Sprint**: sprint-017 (wave 3), TEST-548–556
**Verdict**: **PASS** (9 of 9 criteria) — with one finding for the orchestrator (FINDING-3)

Re-derived against a real running server. Two workspaces, both outside this repository:

- `.../s017-eval3/wsV6` — a **byte copy of the implementing agent's own pre-change snapshot**
  (`s017-server032-prechange-snapshot`), whose `cache.db` was stamped `schema_version = 6` with a
  `turns` table carrying no `form_answered`. Port repointed to `9193`, then booted with the shipped
  server. This is the workspace that proves TEST-555 without taking anybody's word for it.
- The renderer's agreement harness imports `apps/ui/src/thread/parseFormBlock.ts` **unmodified**
  (`mapFormAnswers`, `parseFormBlock`) and drives it against threads read back from that live server,
  so nothing in the drill re-implements either side.

No implementation source was read; the SQL and file paths quoted below come from the issue log and
the SPEC, not from inspection.

---

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                                       |
| --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Filled, structured per test.                                                                                                                                                |
| Commands are specific and concrete       | PASS   | Real thread ids, real turn timestamps, real status codes, the boot log line, `pragma`-level column lists, `db doctor`/`db rebuild` output with timings.                      |
| Real E2E (not mocked)                    | PASS   | Real server on `9192` from source against a scratch workspace; the renderer half imports the shipped UI module rather than restating its rule. Unit suites cited beside the drills. |
| Scenarios cover acceptance criteria      | PASS   | Every TEST-548–556 has drill evidence.                                                                                                                                      |
| Application restarted after changes      | PASS   | TEST-555's proof **is** a restart: a v6 workspace booted under the new server.                                                                                              |
| Actual model recorded (implemented on:)  | PASS   | `implemented on: **opus** (server-dev, sprint-017 stage D, 2026-07-30)`.                                                                                                     |
| Reproduction logged before fix           | PASS   | TEST-548 records the pre-fix run with both form-turn timestamps (`…20:39:22Z`, `…20:39:23Z`), the `needs=form` payload before and after the first answer, and the `201` proving the second form was still answerable. **Independently corroborated**: the preserved v6 snapshot's `turns` table still holds exactly those two form turns at exactly those timestamps. |

---

## Criteria Results

| #        | Criterion                                             | Result | Observed                                                                                                                                                        |
| -------- | ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TEST-548 | The evaluator's reproduction is reproduced first      | PASS   | Logged pre-fix with concrete output, and corroborated on disk — see the audit row above. The pre-fix behaviour itself cannot be re-run without checking out reverted code, which is out of bounds; the surviving v6 artefact is the strongest available independent check and it matches the log exactly. |
| TEST-549 | Detector stays in `needs=form` while any form unanswered | PASS | Two forms, thread `th_ckijn7ix`: after both posted → `[{"id":"th_ckijn7ix","attention":["unread-reply","form"]}]`; **answer form 1 (201) → `[{"id":"th_ckijn7ix","attention":["form"]}]` — it holds**. |
| TEST-550 | Answering the last one clears it                      | PASS   | Answer form 2 (201) → `needs=form` → `[]`. The reason is not sticky.                                                                                             |
| TEST-551 | Order does not matter                                 | PASS   | Three-form thread `th_raiheclz` answered **2, 3, 1**: `true → true → true → false`. Two-form thread `th_nngbphej` with the **second answered first**: `true → true → false`. |
| TEST-552 | Detector and renderer agree                            | PASS   | See FINDING-2 — agreement at every step of a three-form staging, driven by the renderer's own module.                                                             |
| TEST-553 | Nothing else about `needs` moves                      | PASS   | Single-form thread `th_agvp2yx2`: present after the form, absent after the answer. `t.status = 'open'` still gates it, drilled live on `th_lsuccakc`: open with two unanswered forms → **true**; `POST …/resolve` (200) → **false**; `POST …/reopen` (200) → **true**. Near-misses raise nothing: a **user** turn quoting a form fence → false; ```` ```formula ```` in an agent turn → false; an **unterminated** ```` ```form ```` fence → false. |
| TEST-554 | Spec read, cited, left alone                          | PASS   | The log quotes `SPEC.md:185` verbatim; I re-read it at that location and it reads exactly as quoted — *"a turn carries **at most one form**, and answering a form addresses the turn that carries it."* Form-scoped is the correct reading; `git diff cb7825d..HEAD -- SPEC.md` → **empty**. The "propose a clarification instead" branch stayed closed. |
| TEST-555 | Projection grew but still rebuilds clean              | PASS   | See FINDING-1. **Open Conflict 2 resolved to its default (schema change, reported), and the resolution is proven, not asserted.**                                 |
| TEST-556 | Blast radius                                          | PASS   | `git diff --name-only 9ccd7f9~1 9ccd7f9` (minus `issues/`) → `apps/server/src/{core/form.ts, core/form.test.ts, docs/needs.ts, docs/query.test.ts, projection/db.test.ts, projection/project-document.ts, projection/schema.ts, threads/forms.ts}`. **`apps/server` only.** `SPEC.md`, `packages/contract`, `apps/ui` all empty across the batch. |

---

## Load-bearing evidence

### FINDING-1 — TEST-555, the schema migration, proved on a genuinely old workspace

The claim that matters is not "rebuild works" but "an existing workspace heals itself with no manual
repair". Taken on a byte copy of a workspace built **before** the change:

```
$ python3 -c "…"    # the copy, before any server touched it
copy schema_version: [('6',)]
turns cols:          ['thread_id','idx','author','ts','body_md','has_form']     ← no form_answered

$ corpus server start          # the shipped server, on the copy
{"msg":"projection schema changed; rebuilding from files","from":6,"to":7,
 "path":".../s017-eval3/wsV6/.corpus/cache.db"}          ← automatic, at boot

after boot schema_version: [('7',)]
turns cols:               ['thread_id','idx','author','ts','body_md','has_form','form_answered']
form rows:                [('2026-07-30T20:39:22Z',1,1), ('2026-07-30T20:39:23Z',1,1)]

$ corpus db doctor   → projection is clean — 10 documents from 10 files (1ms)
$ corpus db rebuild  → rebuilt the projection in 8ms — 10 documents, 1 thread, 5 turns, …
$ corpus db doctor   → projection is clean — 10 documents from 10 files (1ms)
```

The new column is reconstructed **from the thread files alone** — the rebuild is what produced the two
`form_answered = 1` rows. `SPEC.md` §11's standing `rebuild && doctor` invariant holds. No workspace
needs manual repair.

This also independently corroborates TEST-548: those two form turns at `20:39:22Z` / `20:39:23Z` are
the very ones the pre-fix reproduction created.

### FINDING-2 — TEST-552, detector and renderer, side by side

Driven against the live server with the **renderer's own** `mapFormAnswers` + `parseFormBlock`:

```
three forms, none answered         renderer: 3 answerable  detector: PRESENT  agree: YES
first answer (form 2)              renderer: 2 answerable  detector: PRESENT  agree: YES
second answer (form 3)             renderer: 1 answerable  detector: PRESENT  agree: YES
third answer (form 1)              renderer: 0 answerable  detector: absent   agree: YES
```

The reason is present **exactly while** the renderer still shows an answerable form. That is the
issue's actual acceptance criterion — the defect was a disagreement between two shipped components —
and consistency is restored.

### FINDING-3 — a shared option string retires an unanswered form (agreement preserved)

Not a criterion, and **not a disagreement** — but it refutes a sub-claim in the log and is worth the
orchestrator's attention.

The log defends the projected-column design partly on this ground:

> "…answering one form twice would silently retire a second, unanswered form. That case is pinned by
> `core/form.test.ts` … and by `query.test.ts` ('does not let a repeated answer close a different form')."

The chosen attribution rule is *"earliest still-open form that offers the answered option"*. That
holds when the two forms offer **disjoint** options. When they **share** an option string it does not:

```
form 1 options: [same, other]        form 2 options: [same, other2]

two forms sharing 'same'      renderer: 2 answerable  detector: PRESENT  agree: YES
  answer form1 'same'  (201)  renderer: 1 answerable  detector: PRESENT  agree: YES
  answer form1 'same'  AGAIN  renderer: 0 answerable  detector: absent   agree: YES
      turn#1 answered="same"
      turn#2 answered="same"        ← form 2 attributed the DUPLICATE answer to form 1
  form 2 still accepts an answer: 201
```

Answering the **same** form twice silently retires the second, never-answered form, and the board stops
flagging it — the exact failure mode the log says the design avoids.

**Why this is still a PASS.** The rule lives in the renderer (UI-013, shipped) and SERVER-032
deliberately mirrors it, so detector and renderer *agree* at every step, which is TEST-552's criterion
and the issue's stated acceptance criterion. No sprint-017 criterion fails. The gap is a product
question about answer attribution when two forms in one thread share an option string — pre-existing
on the renderer side, now faithfully mirrored on the server side.

**Recommended orchestrator action**: file a P3 follow-up (attribution should key on the addressed
turn's `:ts`, which the answer route already carries, rather than re-deriving it from the option text),
and correct the sentence in SERVER-032's log so a future reader does not rely on a guarantee that only
holds for disjoint option sets. Neither blocks this wave.

---

## Summary

**9 of 9 criteria pass.** A thread carrying several forms now stays in `needs=form` while **any**
of them is unanswered, clears when the last one is answered, is order-independent across two- and
three-form threads, keeps `t.status = 'open'` gating and every near-miss (user-quoted fence,
```` ```formula ````, unterminated fence) exactly as before, and — the criterion the issue was actually
about — the detector and the shipped renderer now agree at every step.

Open Conflict 2 resolved to its default: the fix took a projection column, `SCHEMA_VERSION` 6 → 7, and
the migration is proven on a genuinely pre-change workspace that heals itself at boot and rebuilds
clean from files. The schema change is reported in the log for `/audit` at harvest, as the conflict's
default requires. One non-blocking finding is recorded above.
