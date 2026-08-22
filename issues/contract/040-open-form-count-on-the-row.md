# [CONTRACT-040] A row says how many unanswered forms a thread still holds

## Domain

contract

## Status

done (contract half; the server derivation follows — see "Handoff" below)

## Priority

P2 (nice to have)

## Model

opus

## Dependencies

- Depends on: CONTRACT-038 (the richer form grammar)
- Blocks: the last acceptance criterion of UI-084
- Related: SERVER-068 computes `needs=form`; UI-084 renders the reason chip

## Spec References

- SPEC.md **§10**, Attention — "a thread holding **more than one** unanswered
  form says how many are still open"
- SPEC.md **§9.1** — the projection is where a row's derived columns come from

## Summary

UI-084 shipped every part of §10's Attention sentence except its last clause.
`DocRow` carries `attention: NeedsReason[]` — a list of reason **codes** and
nothing else — so the reason line can say "awaiting your answer" and cannot say
"2 still open".

**The count is not derivable in the UI, and approximating it is the defect this
repo has filed repeatedly.** A row carries no turns: `lastTurn` is a plain-text
preview of the last turn only, and the forms in question are typically in turns
above it. The only way for a board column to count a thread's open forms today is
to fetch every thread in the column (`GET /api/threads/{id}`) and re-derive it —
an N+1 per column render, for a chip. `unreadThreads` is the precedent for the
opposite choice: an aggregate the server already knows, ridden on the row so no
list ever issues one query per row.

So this is a contract question, filed rather than guessed (UI-084's Technical
Design says exactly that: "if the count is not derivable in the UI, file the
contract issue rather than approximating it — a chip that says '2' by guessing is
the class of defect this codebase has filed repeatedly").

## Acceptance Criteria

- [x] `DocRow` carries how many **unanswered** forms an open thread holds — the
      same set `needs=form` is computed from, so the count and the reason can
      never disagree
- [x] It is `0` (never null, never absent) on a thread with no open form, and
      `0` on a non-thread row, so `0` always means "none" and never "unknown" —
      the rule `unreadThreads` already states
- [ ] (server) The count and the `form` reason are computed from **one** derivation in the
      projection, not two
- [ ] (server) Resolving the thread takes the count to `0` along with the reason (§6: a
      resolved thread stops awaiting an answer)
- [ ] (server) The count survives being read: `POST …/seen` does not change it — the
      asymmetry UI-084's e2e guards
- [x] (ui) The board's reason chip reads "2 awaiting your answer" (or the wording the
      mockup settles on) only when the count is greater than one, and stays
      "awaiting your answer" at one — §10 says *more than one* says how many

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/query.ts` — the new field on `docRowBaseShape`
  or `threadRowShape`, with the `unreadThreads` docblock as the template for its
  "never null" contract
- `packages/contract/openapi.json` + `src/client/schema.generated.ts` — regenerated
- `apps/server/src/projection/*` and `apps/server/src/docs/query.ts` — one
  derivation feeding both `needs=form` and the count (a **server** issue to file
  once this lands)
- `packages/kit/src/row/reasons.ts` + `Row.tsx` — `REASON_TABLE` has no shape for
  a number today; the chip's label becomes a function of the row, not of the code
  alone

### Key Implementation Details

**Where the number comes from.** `apps/server/src/core/form.ts`'s
`readThreadForms` already computes the open-form set — that is the count.
Exposing it is cheaper than any alternative and cannot drift from the reason,
which is the whole point.

**Do not widen `attention` into objects.** `attention` is a list of codes that
plugins may extend (SPEC.md §10); turning entries into `{code, count}` would
change every consumer for one reason's sake. A sibling scalar is additive.

## Testing Strategy

Contract: the field's presence, its `0`-not-null rule, and the OpenAPI drift
check. Server: the count agrees with `needs=form` across the same fixtures
`docs/query.test.ts` already uses for the reason, including the resolved case and
the seen case. UI: the chip's wording at zero, one and two.

## E2E Verification Plan

A thread with two unanswered forms shows one row saying how many are still open;
answering one takes it to the single-form wording; answering the second clears
the row.

## The declared shape

`DocRow.unansweredForms: number` — required, integer, `minimum: 0`, never
nullable, never absent. Declared in `packages/contract/src/schemas/query.ts`
immediately **before** `attention`, so the count and the reason it belongs to sit
next to each other.

Named `unansweredForms` rather than `openForms`: "open" is already this
codebase's word for a thread's `status`, and the count's own SQL guard is
literally `t.status = 'open'`, so `openForms` on a row that also carries a thread
status invites exactly the conflation the field must not have. `unanswered` names
the predicate (`turns.form_answered = 0`) and is §10's own adjective
("unanswered form").

**The invariant, stated in both directions** (and published in the description
that way, because a one-directional claim is what two review rounds caught this
week):

> `unansweredForms > 0` **iff** `attention` contains `form`.

- Left to right: a form counted here is an agent turn with `has_form = 1 AND
  form_answered = 0` in an open thread — exactly what
  `NEEDS_REASON_SQL.form`'s `EXISTS` looks for, so it finds one.
- Right to left: that `EXISTS` cannot hold with nothing to count.
- The guards are shared, not merely similar: `t.id IS NOT NULL` (so a document
  row is `0` and never carries the `form` reason) and `t.status = 'open'` (so
  resolving takes count and reason to nothing together).

What the description deliberately does **not** claim: that the item set of
`GET /api/docs?needs=form` equals the rows with `unansweredForms > 0`. That is
false in one direction — an archived thread with an unanswered form has the
reason and the count but is dropped by the default archived exclusion. The
published wording is that `needs=form` *filters on the same predicate*, with the
rest of the query still applying.

`POST /api/threads/{id}/seen` is documented as leaving it untouched, explicitly
contrasted with `unread`/`unreadThreads`, which being read is what clears — §10's
"an unanswered form's row is the one that survives being read".

`attention` stays an array of bare reason codes; its description now says why the
one reason with a number reports it in a sibling field (plugins extend that list,
SPEC.md §10).

## SPEC.md

**Nothing held for sign-off.** No route is added or changed, so §9.2's route
inventory needs no line — `DocRow`'s field list is not enumerated there. The
behaviour this implements is already signed §10 text ("a thread holding more than
one unanswered form says how many are still open", rider signed 2026-08-05).

`packages/contract/src/routes/inventory.ts` was checked and left alone: its claim
that `POST /api/docs/bulk` is "the one entry §9.2 does not yet list" is still
true — §9.2 lines 402–403 do list `GET /api/upgrade/check` and `POST
/api/upgrade`, and this issue adds no route.

## Handoff (what this leaves red, on purpose)

`npm run typecheck` has **exactly one** error, and it is the follow-up server
issue's line:

```
apps/server/src/docs/query.ts(256,3): error TS2741: Property 'unansweredForms' is missing …
```

`toDocRow` must map a new projection column. The derivation must be **one** query
with the reason, per acceptance criterion 3: `NEEDS_REASON_SQL.form` is today an
`EXISTS` over `turns` — the count is the same correlated subquery as a
`COUNT(*)`, with the reason then read as `count > 0` rather than computed a
second time. The partial index `turns_unanswered_form` (`WHERE has_form = 1 AND
form_answered = 0`) covers a `COUNT(*)` under the same two terms, so the plan
assertion in `docs/performance.test.ts` still applies.

Two out-of-domain one-liners were made here, because without them nothing builds
and the single remaining error would have been three:

- `packages/kit/src/testing/docRow.ts` — `unansweredForms: 0` in the shared
  fixture (`npm run build` fails without it, blocking every workspace).
- `apps/cli/src/commands/doc/fixtures.ts` — same, in `DOC_ROW`.

No stub value was written into the server: a hardcoded `0` in `toDocRow` would
have made the repo green while shipping a number that is always a lie.

## E2E Verification Log

**Model:** Opus 5 (1M context). Ran 2026-08-08 in the main working tree on
`phase-25-form-count-skill-ids`. No git command was run.

### 1. Generation is derived, and regeneration is idempotent

```
$ npm run generate -w packages/contract
generated ./openapi.json
generated ./src/client/schema.generated.ts
$ md5 -q packages/contract/openapi.json packages/contract/src/client/schema.generated.ts
25f19429aad5baac24ff74b7d17555d1
8893e94c021cf0e067d7be5f6c821637
# second run of build + generate, after prettier reformatted the source:
$ diff <before> <after>  →  identical, exit 0
```

The published property:

```json
"unansweredForms": { "type": "integer", "minimum": 0, "description": "How many **unanswered forms** …" }
DocRow.required includes "unansweredForms": true
```

and `packages/contract/src/client/schema.generated.ts:4237` — `unansweredForms: number;`
(no `| null`, not optional).

### 2. The drift check fires — a hand edit does not survive

The committed doc was hand-edited to delete the new property and drop it from
`required`, then regenerated:

```
hand-edited: removed unansweredForms from the committed doc
md5 after hand edit:      24b7469b85df78a7f78ee474662b566a
md5 after regeneration:   25f19429aad5baac24ff74b7d17555d1   ← back to the generated value
regenerated doc equals the committed-good doc: true
hand edit survived regeneration: false
```

So CI's regenerate-and-diff would report the hand edit as drift, and the
committed artifact is byte-for-byte what the generator produces from the schemas.

### 3. The typed client, over a real socket, against a mounted app

A throwaway script mounted `contractRoutes.listDocs` on `@hono/node-server` at
`127.0.0.1:43871` (deliberately not 8765 or 5173), served three rows, and read
them back through `createCorpusClient` — then again with a raw `fetch` so the
evidence is the wire and not the client's reconstruction. `const open: number =
row.unansweredForms` compiles with no null check, which is the shape claim.

```
{"id":"doc_a1b2c3","type":"note",  "unansweredForms":0,"attention":[],      "invariantHoldsBothWays":true,"chip":""}
{"id":"th_x9y8",   "type":"thread","unansweredForms":2,"attention":["form"],"invariantHoldsBothWays":true,"chip":"2 awaiting your answer"}
{"id":"th_single", "type":"thread","unansweredForms":1,"attention":["form"],"invariantHoldsBothWays":true,"chip":"awaiting your answer"}
wire: [["doc_a1b2c3",0],["th_x9y8",2],["th_single",1]]
```

That is acceptance criterion 6 end to end at 0 / 1 / 2 — the number appears only
above one — and criteria 1–2 on the wire. `invariantHoldsBothWays` is
`(open > 0) === attention.includes("form")` evaluated per row. Server closed, port
`43871` confirmed free afterwards; nothing else was bound.

The full E2E of the plan's sentence (two real forms in a real thread, answering
one, answering the second) is not runnable yet: the projection does not populate
the column. It belongs to the server issue's log, and its fixtures are named
above.

### 4. Checks

```
$ npm run build                                   → exit 0
$ npx tsc --noEmit   (packages/contract)          → exit 0
$ npm run typecheck  (repo)                       → exit 2, one error, in apps/server (see Handoff)
$ VITEST_MAX_THREADS=4 vitest run packages/contract
  Test Files  59 passed (59)
       Tests  2281 passed (2281)                  → exit 0
$ npx eslint <7 changed files>                    → No issues found
$ npx prettier --check packages/contract/src …    → All files formatted correctly
```

The repo-wide suite was not run from here; the orchestrator's harvest gate owns
that.

### 5. Self-review

- Criterion 1 — same set as `needs=form`: the description ties the count to
  `has_form`/`form_answered` and to the reason's `EXISTS`, in both directions.
  Contract-side that is prose plus the fixture invariant test; the server issue
  is where "one derivation, not two" is enforced in code (criterion 3).
- Criterion 2 — `0` never null/absent: schema is `z.number().int().min(0)`,
  required; asserted in `query.test.ts`, in the published document by
  `openapi.test.ts`, and on the generated client type in `client/index.test.ts`.
- Criterion 4 (resolve) and 5 (seen) are declared in the description and are the
  server's to enforce; both are named as required server tests above.
- The standing invariant "every named component is a plain, non-nullable,
  undefaulted object" is untouched: this adds a scalar property to an existing
  component and registers no new one, and nothing was `.nullable()`-derived.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier on the changed files)
- [x] E2E verification log filled in
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified (contract half; three are the server's and one the UI's)

## Correction (SERVER-084, 2026-08-09)

The rationale above motivated the deliberate non-claim — that `needs=form` does
**not** return exactly the non-zero rows — with "an archived thread with an
unanswered form has both count and reason and is still dropped by the default
archived exclusion". **That row cannot exist.** `threads.status` *is* the
document's own `status` column, so the count's `t.status = 'open'` guard excludes
`archived` exactly as it excludes `resolved`; measured live, an archived thread
reports `0` and carries no reason. Pinned by
`it("treats an archived thread exactly as it treats a resolved one")`.

The non-claim itself still stands, for the ordinary reason: `needs=` intersects
with every other filter on the query, so any of them can drop a non-zero row.
**The published field description is correct as written and was not changed** —
only this issue file's example was unrealizable.
