# [CONTRACT-084] A save that accepts an error has no way to say so on the wire

## Domain

contract

## Status

todo

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

- [ ] `WARNING_CODES` gains exactly one member for "the save carried a §11
      finding of error severity and did not refuse the write"
- [ ] Its description says what it is for, not merely its type, and states that
      `corpus doc check` still fails on the same finding — the code reports the
      save's tolerance of it, never a downgrade
- [ ] `detail` carries `"<check-code>: <specifics>"`, rendered verbatim by the
      console and the CLI, which already render warnings that way
- [ ] `packages/contract/src/schemas/check.ts` is **untouched** — `CHECK_CODES`,
      `CHECK_WARNING_CODES`, `CHECK_ERROR_CODES` and every severity stay as they
      are. No code moves across the validator's partition
- [ ] `openapi.json` and the typed client regenerated, not hand-edited
- [ ] `apps/server/src/check/codes.test.ts` still passes **unchanged** — its four
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

_(to be filled by the implementing agent)_
