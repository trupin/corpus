# [SERVER-134] A derived due date reaches the projection and the file

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: PLUGINS-018 (the derivation and its declaration), SERVER-085 (the
  machinery this extends)
- Blocks: nothing — it is the last half of PLUGINS-018

## Spec References

- SPEC.md §5 line 202 — `due` is an optional deadline on any type, and it is
  what Attention and the filters read
- SPEC.md §12 — the `todo` doc type, and the derived-field seam as landed
- SPEC.md §9.1 — the `documents` projection row carries `due`

## Summary

**Filed by plugins-dev while implementing PLUGINS-018, per that issue's own
decision 4.** PLUGINS-018 landed the derivation — a todo document's deadline is
its earliest open item's — as the second member of SERVER-085's derived-field
seam. Nothing consumes it yet, because every surface the reporter tested reads
the projection's `due` column, and that column is filled from frontmatter by
`readDocumentFields` in `apps/server/src/projection/project-document.ts`.

So the plugin half answers correctly and the three queries still say no. This
issue is the other half, and it is the same shape SERVER-085 already built for
`status`, one field over.

**Verified by hand, against a real server** (PLUGINS-018's log has the full
transcript): with the derived value written into `due:` through an ordinary
`PUT`, `doc list --due overdue`, `--needs due` and `--needs me` all find the
reporter's 18-day-overdue document. With the derivation broken, all three lose
it again. The gap is exactly the convergence and the projection read.

## What PLUGINS-018 already provides

- `types.yaml`: `derivedDue: true` on the `todo` entry, beside `derivedStatus:
  true`. Today's server schema is a non-strict `z.object`, so the key rides
  through unread and a real boot logs **zero** warnings.
- `plugins/todos/server/derive.ts`: a **named** `deriveDue` export beside the
  existing default status export, signature
  `(input: {type, status, body, extra?}) => { due: string | null } | null`.
  Same module, so `scripts/package-staging.ts` needs no change — verified by
  bundling the entry point exactly as packaging does and reading its exports.
- `packages/kit`: `PluginDocType.deriveDue` and `DerivedDocDue`, for the UI.
- `plugins/todos/parity.test.ts`: three-way parity per field, table-driven over
  a `DERIVED_FIELDS` list, so a third field is one row rather than a third copy.

## The three answers, which no caller may collapse

`deriveDue` answers one of three things, and the middle one is the whole reason
it returns an object rather than `string | null`:

| Answer | Meaning | What the server must do |
| --- | --- | --- |
| `{ due: "YYYY-MM-DD" }` | this is the document's deadline | store it, converge the frontmatter to it |
| `{ due: null }` | the derivation applies and there is **no** deadline | store NULL, converge the frontmatter to core's empty spelling |
| `null` | the derivation does **not** apply | the stored value stands, untouched |

Collapsing the middle into the third leaves a stale deadline on a list whose
last dated item was just checked. Collapsing the middle into a date makes an
undated list look due. Both are the bug this issue closes, re-introduced.

## Acceptance Criteria

- [ ] `readDocumentFields` stores the derived `due` for types that declare one,
      and the stored value for every type that does not — read through the same
      registry shape `resolveDocumentStatus` uses
- [ ] `GET /api/docs?due=overdue`, `?needs=due` and `?needs=me` all return a
      todo document whose earliest open item is past its date, and none of them
      returns one whose open items carry no date
- [ ] Checking the earliest dated item moves the document's `due` to the next
      one; checking the last dated item clears it, in the row **and** in the file
- [ ] A todo document with no dated open items has a NULL `due` column and is
      absent from `due=today` as well as from `due=overdue` — an undated list is
      never due today
- [ ] `status=archived` is unaffected: an archived todo document's `due`
      derivation answers `null`, so whatever the file states stands, and
      unarchiving returns it to what its items say at that moment
- [ ] Whenever the server writes a todo document — the core body write path and
      the plugin's item routes alike — the derived deadline is written into the
      file's frontmatter in the **same** write, therefore the same commit. Never
      a second commit, never a second `updated` bump
- [ ] `corpus db rebuild && corpus db doctor` is clean on a workspace holding
      dated, undated, completed and archived todo documents
- [ ] `corpus doc check` does not report a stale shadow as invalid, exactly as
      SERVER-085 decided for `status`
- [ ] An **out-of-band** `printf >>` of a dated item reprojects with the new
      derived deadline through SSE invalidation
- [ ] Deleting `plugins/todos/` leaves core booting, with todo documents keeping
      whatever `due:` their files state and nothing erroring

## Technical Design

The generalisation SERVER-085 left one field short. Three files carry it:

- `apps/server/src/plugins/derived-status.ts` — the registry is per field
  already in everything but its name: a map of type → function, a `derives()`
  predicate, and answer validation with warn-once containment. Parameterise it
  over the field (the validator is what differs — `["open","resolved"]` for
  status, an ISO date or `null` for due) rather than copying it. **Prefer
  renaming this module to `derived-fields.ts` over adding a sibling**: two
  registries with the same containment rules is the parallel-mechanism shape
  this repository keeps getting bitten by.
- `apps/server/src/plugins/discover.ts` — `derivedDue: true` in
  `TypesFileSchema` and `PluginTypeDecl`, and the module's **named** `deriveDue`
  export loaded beside its default one, under the routes module's existing
  containment. `resolveDeriveModule` is unchanged: one module, one import.
- `apps/server/src/projection/project-document.ts` and
  `apps/server/src/docs/derived-status.ts` — the ladder and the convergence,
  both already written for `status` and both wanting one more rung.

### Key implementation details

- **The clock is not an input.** `deriveDue` answers the *earliest* deadline and
  never whether it has passed. Keep it that way: a projection that read the time
  of day would give two answers for one document in one day.
- **`{ due: null }` must clear.** Core's own empty spelling for the field is
  `due: null` (SPEC.md §5's frontmatter example), and the projection column must
  be SQL NULL. A convergence that writes the string `"null"`, or that skips the
  write when the answer is empty, fails the "checking the last one clears it"
  criterion.
- **Derive once per write, in two calls, for SERVER-085's stated reason**: the
  write path derives from the bytes it is about to write and the projection
  derives from the file those bytes became, through the same function. Threading
  a value from one to the other would make the row a report of what the writer
  decided rather than a reading of what is on disk.

## Testing Strategy

Vitest against a real temp workspace, mirroring
`apps/server/src/projection/derived-status.test.ts` and
`apps/server/src/docs/derived-status.test.ts`: project a todo document in each
state and assert the row's `due`; write through both paths and assert the file
converged in one commit; an out-of-band append reprojects; a derivation that
throws or answers something that is not an ISO date is contained with one
warning and the stored value stands.

## E2E Verification Plan

The reporter's own case, which PLUGINS-018 already reproduced and half-proved:

1. A todo document whose first item is `(due: <18 days ago>)`
2. `corpus doc list --due overdue`, `--needs due`, `--needs me` — all three find
   it, with **no** hand-written `due:` anywhere and no script standing in for
   the convergence
3. `corpus todos check <id> 1` — the deadline moves to the next dated item, in
   the row and in the file, in one commit
4. Check the last dated item — the deadline clears, in both
5. An undated list is absent from all three, and from `--due today`
6. `printf -- '- [ ] late (due: <past>)\n' >> <file>` out of band — SSE
   invalidates and the projection reports the new deadline
7. `corpus db rebuild && corpus db doctor` — clean

## E2E Verification Log

_[Agent fills — state the model]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Pre-fix reproduction logged
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (touches the write path and the projection)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-134]` prefix
