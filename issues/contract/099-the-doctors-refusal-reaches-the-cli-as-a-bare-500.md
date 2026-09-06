# [CONTRACT-099] The doctor's refusal reaches the CLI as a bare 500

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —

## Origin

Re-filed 2026-09-06 from **SHARED-003** (the PR #11 / PR #12 review ledger), from
the wave-3 audit fix round, 2026-07-30:

> (contract, minor) `doctorDb` declares only 200/401, so the stamp-mismatch
> refusal (audit FIX 16) reaches the CLI as a bare `500 internal_error` (same
> shape as the pre-existing no-projection refusal). Surfacing the message needs a
> declared error response — small CONTRACT rider when the doctor surface is next
> touched.

The 2026-09-06 audit re-checked the route definition: it still declares 200 and
401 and nothing else.

## Spec References

- SPEC.md §11 — validation and the doctor's report
- SPEC.md §2.2 — `corpus db doctor` / `corpus db rebuild`
- SPEC.md §9.2 — `GET /api/db/doctor`

## Summary

`GET /api/db/doctor` declares exactly two responses: `200` with the drift report
and `401`. The server, however, has two states in which it refuses to produce a
report at all — a projection whose stamp does not match, and no projection at all
— and both leave the handler by throwing. With no declared error response, they
reach the CLI as a bare `500 internal_error`. The operator gets no message and no
remedy for a condition with a specific, actionable fix (`corpus db rebuild`).
Declaring the refusal is what lets the message through.

## Acceptance Criteria

- [ ] `doctorDb` declares an error response for the refusal states, carrying the
      contract's standard `ApiError` shape with a message the CLI can print.
- [ ] The status code chosen is justified in the route's description or a comment.
      A stamp mismatch and a missing projection are **precondition failures**,
      not internal errors — `409` or `503` are the candidates, and the choice
      should match whatever the sibling projection routes already do for the same
      condition. Check `rebuildDb` before inventing a new convention.
- [ ] The two refusal reasons are distinguishable by the caller: a stamp mismatch
      and an absent projection want different remedies in the message even if
      they share a status.
- [ ] `openapi.json` is regenerated and the drift check passes.
- [ ] The typed client's consumers still compile: the CLI's `db doctor` verb must
      handle the new declared status rather than falling into its generic error
      path.
- [ ] A test asserts the refusal reaches a CLI-visible message, not
      `internal_error`.

## Technical Design

### Files to Create/Modify

- `packages/contract/src/routes/db.ts` — the `responses` block of `doctorDb`,
  lines 71-79.
- `packages/contract/openapi.json` — regenerated, committed.
- `apps/server/src/projection/routes.ts` — the handler at line 169, so the throw
  becomes the declared response.
- `apps/cli/src/commands/db/doctor.ts` — surfacing the message and choosing the
  exit code.
- Tests beside each.

### Key Implementation Details

`packages/contract/src/routes/db.ts:71-79` is the declaration:

```ts
  responses: {
    200: jsonContent(
      DoctorReportSchema,
      "The drift report. `ok` is true exactly when `drift` is empty; a drifted projection is a " +
        "`200` carrying the findings, not an error status. `warnings`, when present, is " +
        "report-only and leaves `ok` alone.",
    ),
    401: UNAUTHORIZED_RESPONSE,
  },
});
```

Note the description's existing care: a **drifted** projection is deliberately a
200. That is not what this issue changes. What is missing is the case where there
is no report to give at all.

`apps/server/src/projection/routes.ts:159-175` is the handler:

```ts
  app.openapi(contractRoutes.doctorDb, async (c) => {
    const effectiveModel = await deps.index?.effectiveModel();
    return c.json(
      toDoctorReport(doctor(deps.config, effectiveModel === undefined ? {} : { effectiveModel })),
      200,
    );
  });
```

`doctor()` is where the refusal originates. Read it before choosing a status: the
exact conditions and their existing error types decide whether one declared
response covers both or two are wanted.

The sibling route `rebuildDb` (same file, lines 50-55) declares `400`, `401` and a
`RebuildResultSchema` 200. Whatever it does for a missing projection is the
precedent — follow it or state why not.

This is a contract change with one consumer change. Per CLAUDE.md, a change
spanning contract plus a consumer is normally two issues with a dependency. Here
the consumer change is a single `catch` arm in the CLI verb and the server's one
`throw` site, so it stays in one issue — but if the server side turns out to need
real work (two distinct refusal reasons that `doctor()` does not currently
separate), split it and file the server half.

### Edge Cases

- A drifted projection stays a `200`. Do not let this change turn drift into an
  error — the route's description says drift being visible is the point.
- `corpus db doctor` is documented as cheap enough for a pre-commit hook. Its
  exit code is load-bearing for that use. Decide whether a refusal exits with the
  same code as "drift found" or a distinct one, and say which in `docs/cli.md`.
- The `--json` shape for the refusal is the `ApiError` shape, not a
  half-populated `DoctorReport`.

## Testing Strategy

Contract: a schema test that the route declares the new status. Server: a
handler test with a stamped-mismatched projection asserting the declared status
and a message. CLI: a test that the message reaches stdout/stderr rather than
`internal_error`.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start a workspace and let the projection build.
2. Induce a stamp mismatch (the mechanism audit FIX 16 introduced — read it
   before improvising; corrupting the stamp by hand is acceptable if the log
   says exactly what was done).
3. `corpus db doctor`
4. Expected: a message naming the stamp mismatch and `corpus db rebuild`.
5. Actual: `internal_error` with no detail.

### Verification Steps

1. Rebuild and restart. Repeat step 2-3.
2. Expected: the refusal message and its remedy, with a documented exit code.
3. `corpus db rebuild` then `corpus db doctor` → an ordinary report, proving the
   happy path is untouched.
4. Confirm a genuinely drifted projection still returns 200 with findings.

## E2E Verification Log

_[Agent fills. State which model the implementing agent ran on.]_

### Reproduction (bugs only)

_[Agent fills]_

### Post-Implementation Verification

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] `openapi.json` regenerated and committed; drift check green
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (cross-domain — qualifying)
- [ ] `/evaluate` passes
- [ ] Committed with `[CONTRACT-099]` prefix
