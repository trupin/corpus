# [CONTRACT-013] Export `uploadCreateThread` from the client barrel; move `FORM_ANSWER_LABEL` into the contract

## Domain

contract

## Status

done

## Priority

P1

## Model

opus — two mechanical moves along existing patterns.

## Dependencies

- Depends on: CONTRACT-009, CONTRACT-007
- Blocks: UI-010 (Ask-with-attachment), UI-007 (comment-with-file)

## Spec References

- SPEC.md §6 (attachments, form grammar)
- UI-008's report (2026-07-28): both findings verified against the shipped tree

## Summary

Two small gaps UI-008 hit that only the contract package can fix:

1. **`@corpus/contract/client`'s barrel exports `uploadTurn` and `uploadCapture` but not
   `uploadCreateThread` / `buildThreadFormData` / `ThreadUpload`**, and the package's `exports`
   map has no deep subpath — so the kit cannot wrap multipart thread creation
   (`createThreadWithFiles`), which blocks attaching a file to a *new* thread. One-line
   re-export (plus the types).
2. **`FORM_ANSWER_LABEL` (`**Answered:**`) lives only in `apps/server/src/threads/forms.ts`.**
   The UI needs it to know whether a form is already answered, and `apps/ui` must not import
   `apps/server`. It belongs in `packages/contract` beside the rest of the form grammar
   (CONTRACT-007); the server imports it from there so drift is impossible.

## Acceptance Criteria

- [x] `uploadCreateThread`, `buildThreadFormData`, `ThreadUpload` exported from the client
      barrel; kit can implement `createThreadWithFiles` against it (a UI/kit follow-up wires it).
- [x] `FORM_ANSWER_LABEL` defined in the contract's form grammar module; `apps/server` imports
      it from there (its own definition deleted); grep proves one definition.
- [x] Regeneration idempotent; drift check green; contract invariant suites untouched-and-green.

## E2E Verification Log

Implemented on: opus (contract-dev, main tree, branch `phase-3-ui`, base `aec0b21`).

**Change set**

- `packages/contract/src/client/index.ts` — re-exports `buildThreadFormData`, `uploadCreateThread`
  and `type ThreadUpload` beside the two upload helpers that were already published, with a note
  on why (`@corpus/contract`'s `exports` map has no subpath below `./client`, and thread creation
  only needs the multipart form when it carries files).
- `packages/contract/src/client/index.test.ts` — a `the client barrel` suite pinning all three
  multipart endpoints, their builders, `UploadError`/`FILES_FIELD`, and a compile-time check that
  `ThreadUpload`/`TurnUpload`/`CaptureUpload`/`UploadOptions` are nameable from the barrel.
- `packages/contract/src/schemas/form.ts` — `FORM_ANSWER_LABEL = "**Answered:**"` with the
  docblock naming it the answered-form marker the server writes and the UI reads.
- `packages/contract/src/schemas/form.test.ts` — pins the marker's spelling and its prefix use.
- `apps/server/src/threads/forms.ts` — local definition deleted; imports the constant from
  `@corpus/contract` and re-exports it, so `threads/index.ts` and `forms.test.ts` are untouched
  (the mechanical swap only, nothing else in another domain's tree).

**Single definition (grep, `packages/*/src apps/*/src plugins`)**

```
$ grep -rn '"\*\*Answered:\*\*"' packages/*/src apps/*/src plugins
packages/contract/src/schemas/form.test.ts:37:    expect(FORM_ANSWER_LABEL).toBe("**Answered:**");
packages/contract/src/schemas/form.ts:86:export const FORM_ANSWER_LABEL = "**Answered:**";
apps/ui/src/thread/parseFormBlock.test.ts:75:    expect(answeredOption("**Answered:**")).toBeUndefined();
apps/ui/src/thread/parseFormBlock.ts:33:export const FORM_ANSWER_LABEL = "**Answered:**";
$ grep -rn 'FORM_ANSWER_LABEL' apps/server/src
apps/server/src/threads/forms.ts:37:  FORM_ANSWER_LABEL,          # imported from @corpus/contract
apps/server/src/threads/forms.ts:59:export { FORM_ANSWER_LABEL };
apps/server/src/threads/forms.ts:63:  const chosen = `${FORM_ANSWER_LABEL} ${answer.option}`;
apps/server/src/threads/index.ts:21:  FORM_ANSWER_LABEL,
apps/server/src/threads/forms.test.ts:14: import { FORM_ANSWER_LABEL, ... } from "./forms.js";
```

`apps/server` now has zero definitions of the literal. `apps/ui/src/thread/parseFormBlock.ts` still
carries UI-008's copy (its docblock even points at the server's old one) — out of this issue's
scope and of the contract domain, and UI-006 was live in `apps/ui` at the time. **Follow-up for
ui-dev: import `FORM_ANSWER_LABEL` from `@corpus/contract` and delete the UI's copy** — until then
the marker has two spellings, one of which this issue cannot reach.

**Runtime E2E — the barrel through the *published* entry point.** A scratch ESM script (deleted
after the run) imported `@corpus/contract/client`, i.e. the built `dist/client/index.js` the
`exports` map resolves, and drove `uploadCreateThread` against an `OpenAPIHono` app mounting the
real `mountCreateThread` route definition via an injected `app.fetch`:

```
$ node scratch-c013-e2e.mjs                                              # EXIT=0
barrel exports present: uploadCreateThread, buildThreadFormData, uploadTurn, uploadCapture,
                        buildTurnFormData, buildCaptureFormData, FILES_FIELD, UploadError
barrel exports missing: (none)
thread: th_x9y8 | text=what do you make of this? files=shot.png auth=Bearer workspace-token
eventId: evt_7c1d
form parts: title,files | files: 1
FORM_ANSWER_LABEL from @corpus/contract: "**Answered:**"
route contractRoutes.createThread path: /api/threads
```

The multipart body reached the contract's own validator (the mounted route's `c.req.valid("form")`
echoed the text, the file name and the bearer header back), so the newly exported helper is not
just present — it works from the entry point the kit will import.

**Generation idempotence / drift.** `node --import tsx scripts/check-generated-artifacts.ts` run
twice, byte-identical output, both `EXIT=0`:

```
✓ API contract is up to date (packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts).
✓ CLI reference is up to date (docs/cli.md).
[ok] Files are identical   # diff of the two runs' output
$ git status --short packages/contract/openapi.json packages/contract/src/client/schema.generated.ts docs/cli.md
(clean)
```

Nothing regenerated: neither a plain constant nor a barrel re-export is OpenAPI surface, which is
the expected outcome for this change.

**Tests** (scoped, `VITEST_MAX_THREADS=4`):

```
$ node node_modules/.bin/vitest run packages/contract apps/server/src/threads/forms.test.ts packages/kit
Test Files  64 passed (64)
     Tests  1526 passed (1526)                                            # EXIT=0
```

Includes the contract's invariant suites (`openapi.test.ts`, `request-body-required.test.ts`,
`request-defaults.test.ts`, `index.test.ts`) — all green, untouched. `apps/server`'s
`forms.test.ts` (33 tests) passes unchanged against the imported constant, and `packages/kit`
passes, proving nothing downstream broke.

**Typecheck** (`npm run typecheck -w …`, all EXIT=0): `packages/contract`, `apps/server`,
`packages/kit`, `apps/ui`.

**Lint/format**: `npm run lint` EXIT=0, `npm run format:check` EXIT=0.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
