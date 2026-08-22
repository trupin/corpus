# [SERVER-084] Count the unanswered forms on a row, from the query that already finds them

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-040 (declares `DocRow.unansweredForms`)
- Blocks: UI-084's last acceptance criterion
- Related: SHARED-021 (signed, applied), SERVER-068

## Spec References

- SPEC.md **§10** — the attention row, and "more than one unanswered form says
  how many are still open" _(rider signed 2026-08-05)_

## Summary

CONTRACT-040 declared `DocRow.unansweredForms: number` — required, integer, never
null and never absent — and deliberately **did not stub it in the server**. So
`apps/server/src/docs/query.ts` currently fails to typecheck, on purpose: writing
`unansweredForms: 0` into `toDocRow` would have made the repo green while
shipping a number that is always a lie.

This issue makes the number true. It is the last thing standing between UI-084
and complete: the surface that consumes it already exists and is waiting.

## Acceptance Criteria

- [x] `unansweredForms` is the real count of unanswered forms on a row, and the
      repo typechecks again
- [x] **Count and reason come from one query, not two.** CONTRACT-040 publishes
      the invariant `unansweredForms > 0` **iff** `attention` contains `form`,
      and two independent derivations of the same fact are how that stops being
      true. `NEEDS_REASON_SQL.form`'s `EXISTS` becomes a `COUNT(*)`, and the
      reason is read as `count > 0`
- [x] A document row (no thread) is `0` and carries no `form` reason — the same
      `t.id IS NOT NULL` guard settles both
- [x] Resolving a thread clears the count and the reason **together**, because
      both hang off the same `t.status = 'open'` term
- [x] The invariant holds in both directions, asserted as such rather than
      assumed from a single-direction test
- [x] `docs/performance.test.ts`'s plan assertion still holds: the partial index
      `turns_unanswered_form` covers the count under the same two terms it
      covered the `EXISTS` under. Check the plan, do not assume it
- [x] `GET /api/docs?needs=form` is unchanged. CONTRACT-040 deliberately did
      **not** publish "needs=form returns exactly the non-zero rows", because an
      archived thread with an unanswered form has both reason and count and is
      still dropped by the default archived exclusion. Do not make that true by
      accident either

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/query.ts` (`toDocRow` and `NEEDS_REASON_SQL.form`).

### Notes

- Read CONTRACT-040's docblock in `packages/contract/src/schemas/query.ts`
  first — it states the invariant with its direction and the reason for the
  field's name, and the handoff in its issue file names the exact SQL move.
- Two one-line fixtures were already set to `0` out of domain to keep the build
  running (`packages/kit/src/testing/docRow.ts`,
  `apps/cli/src/commands/doc/fixtures.ts`). Check whether a fixture that always
  says zero is the right default for each, or whether a test somewhere should
  be driving a non-zero one.

## Testing Strategy

Rows at 0, 1 and 2 unanswered forms; a document row; a resolved thread; an
archived thread with an unanswered form (count and reason present, still excluded
from the default listing). Plus the both-directions invariant assertion and the
query-plan check.

## E2E Verification Log

**Model:** Opus 5 (1M context). Ran 2026-08-08/09 in the main working tree on
`phase-25-form-count-skill-ids`. No git command was run. Real server on scratch
port **8834** (8765 and 5173 untouched), real workspace at `/tmp/s084ws`, torn
down afterwards — `corpus server stop` reported `stopped (pid 69499)` and
`lsof -iTCP:8834` came back empty.

### 1. What shipped

`NEEDS_REASON_SQL.form`'s `EXISTS` is gone. There is one expression, exported as
`UNANSWERED_FORM_COUNT_SQL`, and both readers are splices of it:

```
--- shipped count fragment:
(CASE WHEN t.id IS NOT NULL AND t.status = 'open' THEN (
  SELECT COUNT(*) FROM turns tu
   WHERE tu.thread_id = t.id AND tu.author = 'agent'
     AND tu.has_form = 1 AND tu.form_answered = 0
) ELSE 0 END)
--- shipped form reason:
((CASE WHEN t.id IS NOT NULL AND t.status = 'open' THEN (…same text…) ELSE 0 END) > 0)
```

`query.ts` selects the fragment as `unanswered_forms`, and `toDocRow` maps it. So
the row column, the `reason_form` column beside it and the WHERE clause
`needs=form` compiles to are the same characters three times in one statement.

### 2. Real rows at 0, 1, 2 and 3, through HTTP

Every number below is a `GET /api/docs` response from the running server, after
real `POST /api/threads`, `POST …/turns` (as `agent`), `POST …/turns/{ts}/form`,
`resolve`, `reopen`, `seen` and `archive` calls.

```
--- a second form asked -> 2
    th_pix43zvr    status=open      unansweredForms=2  attention=['unread-reply', 'form']
--- a third form asked -> 3
    th_pix43zvr    status=open      unansweredForms=3  attention=['unread-reply', 'form']
--- one of the three answered -> 2
    th_pix43zvr    status=open      unansweredForms=2  attention=['form']
--- marked seen: unread clears, the count does not
    th_pix43zvr    status=open      unansweredForms=2  attention=['form']
--- resolved with two forms still open: count and reason cleared together
    th_pix43zvr    status=resolved  unansweredForms=0  attention=[]
    /api/docs?needs=form -> []
--- reopened: both come back together
    th_pix43zvr    status=open      unansweredForms=2  attention=['form']
    /api/docs?needs=form -> ['th_pix43zvr']
--- archived: count and reason gone, row dropped from the default listing
    th_pix43zvr    status=archived  unansweredForms=0  attention=[]
```

The final corpus, eight thread rows plus documents, every row of the whole
listing checked for the invariant in both directions on each of the ten states
above (`invariant violations over N rows: []` every time):

```
  th_obtbmxwm    status=open      unansweredForms=2 attention=['unread-reply', 'form']
  th_lnbjiwpc    status=open      unansweredForms=1 attention=['unread-reply', 'form']
  th_62jfxvmf    status=open      unansweredForms=0 attention=[]        # a USER turn's fence
  th_l73kdm43    status=resolved  unansweredForms=0 attention=['unread-reply']
  th_2n3sfwuw    status=resolved  unansweredForms=0 attention=['unread-reply']
  th_ocxh2nwr    status=open      unansweredForms=0 attention=[]
  th_pix43zvr    status=open      unansweredForms=2 attention=['form']
  th_mq7g3py5    status=open      unansweredForms=0 attention=[]        # both its forms answered
  needs=form -> ['th_obtbmxwm', 'th_lnbjiwpc', 'th_pix43zvr']
  invariant violations over 18 rows: []
```

Document rows (`doc_ffdpdvzj` and the seven seeded skills/views/templates) all
reported `unansweredForms=0  attention=[]` while `doc_ffdpdvzj` was the parent of
threads holding five open forms between them — `t.id IS NOT NULL` settling both.

### 3. `GET /api/docs?needs=form` is unchanged

The pre-SERVER-084 `EXISTS` predicate and the new `count > 0` were evaluated side
by side against the **live** projection, row by row:

```
rows compared: 18
rows where the pre-SERVER-084 EXISTS and the new count>0 disagree: 0 []
rows the predicate selects: [ 'th_lnbjiwpc', 'th_obtbmxwm', 'th_pix43zvr' ]
```

The 20-odd pre-existing `needs=form` assertions in `docs/query.test.ts` (the
near-miss corpus from SERVER-029 and the multi-form suite from SERVER-032) were
not edited and are green.

Nor was the equality *made* true by accident: `it("is a filter, not a promise
about which rows a listing returns")` pins that `needs=form&type=note` and
`needs=form&parent=th_two` return fewer rows than there are non-zero ones.

### 4. The query plan, read from the live database

Identical in both positions, on the same partial index the `EXISTS` used:

```
--- plan, SELECT-list (the row column):
    SCAN d USING COVERING INDEX sqlite_autoindex_documents_1
    SEARCH t USING INDEX sqlite_autoindex_threads_1 (id=?) LEFT-JOIN
    CORRELATED SCALAR SUBQUERY 1
    SEARCH tu USING INDEX turns_unanswered_form (thread_id=?)
--- plan, WHERE clause (needs=form):
    …byte-identical to the above…
```

`docs/performance.test.ts` over 150 × 80-turn threads reports the same plan and
`needs=form (150x80 turns): min 0.3 ms, median 0.3 ms, max 0.3 ms` — unchanged.
A second plan assertion was added there for the SELECT-list position, since that
is where the row's count is now computed.

### 5. Mutation check — the invariant tests actually bite

Both directions were broken on purpose and the suite was re-run:

- reason re-derived independently (its own `EXISTS`, status guard dropped) →
  **8 failures**, including `keeps the count and the form reason in step — right
  to left` and three pre-existing resolved-thread tests.
- count re-derived independently (status guard dropped from the column only) →
  **5 failures**, including `keeps the count and the form reason in step — left
  to right`.

Both files were restored and re-verified before finishing.

### 6. Checks

- `npm run build` — green.
- `vitest run apps/server` — **176 files, 3646 tests, all passing**.
- `eslint` on the five touched files — clean, no suppressions.
- `prettier --check apps/server/src/docs/` — clean.
- `npm run typecheck` (whole repo) — **green**; CONTRACT-040's deliberate single
  error is gone.

### 7. One correction to CONTRACT-040's rationale

The issue text motivates the non-claim with "an archived thread with an
unanswered form has both count and reason and is still dropped by the default
archived exclusion". That row cannot exist: `threads.status` **is** the
document's own `status` column, so `t.status = 'open'` — the term both the count
and the reason hang off — excludes `archived` exactly as it excludes `resolved`.
An archived thread reports `0` and no reason (measured above). The non-claim
still stands, for the ordinary reason that `needs=` composes with every other
filter by intersection; the published field description says exactly that and
needed no change. `it("treats an archived thread exactly as it treats a resolved
one")` pins the behaviour so the discrepancy is not rediscovered.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
