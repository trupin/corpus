# [CONTRACT-084] A save that accepts an error has no way to say so on the wire

## Domain

contract

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Blocks: SERVER-067
- Related: SERVER-066 (which made the finding non-blocking), CONTRACT-047 (which
  decided the response warning family is one channel, not several)

## Spec References

- SPEC.md **§11** — the auto-commit paragraph: a hook failure during auto-commit
  means "the file mutation still stands … the failure surfaces loudly — **a
  warning on the API response**, a server log entry, and console visibility"
- SPEC.md **§11**, signed rider 2026-08-20 — "a third state exists beside warning
  and failure — an **error a save accepts** — and it exists on purpose"
- SPEC.md **§11**, signed rider 2026-08-10 — "A response's warnings also carry
  effects on documents the request never named. A warning is not only a failure."
- SPEC.md **§9.2** — mutation responses carry warnings

## Summary

Split out of SERVER-067, whose framing was wrong in a way worth recording,
because the same conflation is easy to repeat.

SERVER-067 argued that putting an error-severity §11 finding on a mutation
response would corrupt §11's severity partition, on the grounds that "§11's wire
warning family is a closed two-member set (`CHECK_WARNING_CODES`)". **Those are
two different families.** `CHECK_WARNING_CODES` in
`packages/contract/src/schemas/check.ts` is the *validator's* severity split — it
decides whether `corpus doc check` exits 0 or 6, and it is genuinely closed and
load-bearing. The *response* family is `WARNING_CODES` in
`packages/contract/src/schemas/warning.ts`, which has eight members today of
mixed severity, `commit_failed` among them. `check.ts`'s own docblock states the
separation: "**Not the §11 commit warning.** … It is unrelated to `Warning`".

So the question SERVER-067 escalated — *may an error-severity event travel the
response warning channel?* — **§11 already answers, in its own words.** The
auto-commit sentence calls the event a **failure** and puts it on the response as
a **warning**, in one sentence. The carried-effects rider says outright that "a
warning is not only a failure". The response channel spans from "nothing went
wrong at all" (`carried_skill`) to "your commit failed". A channel with that span
is a reporting channel, not a severity class.

**No rider is required.** No §11 sentence changes truth value when a save starts
reporting a tolerated error on its response. This is a transcription of the spec,
not an amendment to it.

**What is missing is one code.** A save that accepts a §11 error — an unterminated
fence today, or invalid frontmatter on a `.claude/` root since SERVER-123/124 —
has nowhere on the wire to say so. The party harmed is the agent whose turn was
silently eaten, and the agent reads responses, never `.corpus/server.log`.

## Acceptance Criteria

- [x] `WARNING_CODES` gains exactly one member for "the save carried a §11
      finding of error severity and did not refuse the write" — `validation_error`,
      inserted after `unresolved_ref` so the validation family stays together and
      the description's "the last two" still names the board pair
- [x] Its description says what it is for, not merely its type, and states that
      `corpus doc check` still fails on the same finding — the code reports the
      save's tolerance of it, never a downgrade
- [x] `detail` carries `"<check-code>: <specifics>"`, rendered verbatim by the
      console and the CLI, which already render warnings that way
- [x] `packages/contract/src/schemas/check.ts` is **untouched** — `CHECK_CODES`,
      `CHECK_WARNING_CODES`, `CHECK_ERROR_CODES` and every severity stay as they
      are. No code moves across the validator's partition
- [x] `openapi.json` and the typed client regenerated, not hand-edited
- [x] `apps/server/src/check/codes.test.ts` still passes **unchanged** — its four
      partition assertions are about the validator's split, and nothing crosses it

## Technical Design

Suggested name `validation_error`, style-matched to `commit_failed`. The final
name is the implementing agent's call.

One warning per finding, not one per save.

## Testing Strategy

Contract-side: the new code is declared, `openapi.json` regenerates cleanly, and
`codes.test.ts` passes with no edit. The behavioural tests belong to SERVER-067 —
a route-level case asserting `201` **with** the warning, and the pinned negative
asserting an ordinary anchored comment returns `201` with **no** response
warning.

## E2E Verification Log

**Model:** opus (`claude-opus-5[1m]`). **Date:** 2026-08-24. Isolated worktree
`.claude/worktrees/agent-ac4ea264a31fc4cc4`, own `npm install` and own
`packages/contract/dist` — so no `@corpus/*` import resolved to the main
checkout.

### What landed

One member, `validation_error`, in `WARNING_CODES`
(`packages/contract/src/schemas/warning.ts`), placed after `unresolved_ref`.
`packages/contract/src/schemas/check.ts` is byte-identical — it is not in the
diff. The module docblock gained the fourth family and the two-families argument
in full, so the next reader does not have to re-derive it. `warningsField`'s
published prose now says outright that the channel is a reporting channel and
not a severity class.

### 1 — Generation, and its idempotence

```
$ npm run build -w packages/contract      → EXIT=0
$ npm run generate -w packages/contract   → EXIT=0
  generated ./openapi.json
  generated ./src/client/schema.generated.ts
$ npm run generate -w packages/contract   → EXIT=0   (second run)
$ git diff --stat packages/contract/openapi.json packages/contract/src/client/schema.generated.ts
  openapi.json                   | 37 +++++-----   (unchanged by the second run)
  src/client/schema.generated.ts | 38 ++++------   (unchanged by the second run)
```

`"validation_error"` appears in the published enum and in the `Warning.code`
description at every one of the 17 mutation responses that spread
`warningsField`.

### 2 — The drift check fires on a hand-edited artifact

Deleted the `"validation_error",` line from the committed `openapi.json` by hand
and ran the one test that reads the committed files:

```
$ vitest run packages/contract/src/generation/artifacts.test.ts   → EXIT=1
FAIL  contract artifact generation > has openapi.json committed in sync with the route definitions
AssertionError: openapi.json is out of date and src/client/schema.generated.ts is current.
Cause: the committed document was edited by hand, or half a regeneration was committed —
the client types still describe the document the routes produce.
Fix: npm run generate -w packages/contract
```

Restored, re-ran, green.

### 3 — The typed client, against a mounted app, with a counterfactual `tsc`

A scratch spec (written, run, then deleted) mounted the real
`contractRoutes.updateDoc` on a real `OpenAPIHono`, answered it with one
`validation_error` warning, and read it back through the **generated** fetch
surface (`corpus.api.PUT("/api/docs/{id}")`), whose response type comes from
`schema.generated.ts` and not from a hand-written wrapper. The assertion is a
**narrowing**, so it is a compile-time claim as well as a runtime one:

```ts
if (warning.code !== "validation_error") throw new Error(`unexpected ${warning.code}`);
expect(warning.detail).toContain("unterminated-fence:");
```

- Runtime: `vitest` EXIT=0.
- Compile-time, with the code declared: `tsc --noEmit -p packages/contract`
  EXIT=0.
- Compile-time, **counterfactual** — the member removed from the committed
  generated union:

```
packages/contract/src/client/e2e-scratch.test.ts(78,9): error TS2367:
This comparison appears to be unintentional because the types
'"commit_failed" | "commit_skipped" | "orphaned_anchor" | "unresolved_ref" | "carried_skill"
 | "carried_reconciliation" | "stage_status" | "default_open_cleared"'
and '"validation_error"' have no overlap.
```

Note for the record: an earlier draft of the same scratch called
`corpus.capture(...)`, and the counterfactual passed — `capture` is a
hand-written multipart helper typed from the **zod** schema, so it proves nothing
about the generated client. Only a call on `corpus.api.*` exercises
`schema.generated.ts`.

### 4 — Tests, and their falsification

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run --reporter=verbose \
    packages/contract apps/server/src/check scripts/missing-profile-parity.test.ts
EXIT=0 · Test Files 74 passed (74) · Tests 3048 passed (3048)
```

`apps/server/src/check/codes.test.ts` is in that run, passes, and is **not in the
diff** — all seven of its cases green with no edit.

Falsified by removing the member from `WARNING_CODES` **and** replacing the
"still fails on the same bytes" clause with "the finding is downgraded to a
warning". Four tests fired, two per claim:

- `warning.test.ts > names exactly §11's two warning families, CONTRACT-047's third and CONTRACT-084's fourth`
- `warning.test.ts > gives a tolerated error a way to say so on the response`
- `openapi.test.ts > … > publishes the code in the shared warning vocabulary`
- `openapi.test.ts > … > says the check still fails on the same bytes`

### 5 — Checks

- `npm run typecheck -w packages/contract` → 0
- `tsc --noEmit -p scripts/tsconfig.json` → 0
- `eslint packages/contract/src` → 0, no rule disabled
- `prettier --check` on every touched file and both generated artifacts → clean

### The change is additive for every existing consumer

`Warning["code"]` is only ever **read** outside this package — no exhaustive
`switch` anywhere. `apps/cli`'s `EFFECT_WARNING_CODES` is a subset list,
`apps/ui` compares against single literals (`stage_status`) or interpolates
`warning.code` into a string. A full `npm run build` + `npm run typecheck` in
this worktree reports 22 errors, **all** in `apps/ui`, and every one names
`unread`, `enqueued`, `total`/`truncated` or `blockedOn` — fields SERVER-148 put
on the contract, whose consumers are UI-169 and its neighbours. None names a
warning code. Those errors pre-date this change.

### Handoff to SERVER-067

One line, so it is not re-derived: in `checkSave`
(`apps/server/src/docs/write.ts`), emit `{ code: "validation_error", detail:
\`${finding.code}: ${finding.detail}\` }` for **every** member of `tolerated` —
both the `REPORTED_CHECK_CODES` half and the `isClaudeRootFrontmatter` half —
and push them into the same `warnings` array the two `WARNING_CODE_BY_CHECK`
codes already go into. `WARNING_CODE_BY_CHECK` does not change:
`validation_error` is not keyed on a `CheckCode`, because one code carries all of
them and the finding's own code rides in `detail`. `REPORTED_CHECK_CODES` stays
an explicit allow-list, so `anchor-unused` still never reaches a response — the
published description now says so, and a widening would have to delete that
sentence first.
