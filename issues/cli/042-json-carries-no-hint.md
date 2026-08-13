# [CLI-042] `--json` carries no `hint`, so a machine caller is told what happened and not what to do

## Domain

cli

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Related: CLI-035 (where it was found), SHARED-041 (the refusals that made it
  matter)

## Spec References

- Not spec text. This is about whether the CLI's machine surface is usable by
  the caller it exists for.

## Summary

Found by CLI-035's follow-up while fixing the patch route's stale-key hint, and
flagged rather than fixed because it is a **CLI-wide** decision, not a property
of one verb.

`toProblem` in `apps/cli/src/errors.ts` emits `{code, message, changed, details}`.
`hint` is documented as human-only, so **every** `--json` error the CLI raises
carries what went wrong and no instruction for what to do next.

It became visible on the patch route's stale-key refusal, where the message is
*"the patch itself is still good"* and the recovery — **run the same patch
again** — lives only in the human rendering. A machine caller reading that JSON
is told its patch is fine and given nothing to do about it.

That is the same shape as the finding that prompted the fix (a hint naming a
`--key` the verb does not have), one layer over: the human path was corrected and
the machine path never had the sentence at all.

## Why it matters more than it looks

The agent is the machine caller. Every refusal this repo has designed in the last
week — the stale key, the patch's two conflicts, the keyless-write refusal — was
written so that the *message names its own recovery*, because an agent that
cannot act on what it reads will guess. `--json` drops exactly that half.

## The question to answer first

**Should `hint` be machine-visible, or should the recovery live in `details`?**
Both are defensible and the issue should not assume:

- **Emit `hint`.** One line, and every existing refusal gains its recovery for
  free. But `hint` is prose written for a person, with backticks and command
  spellings, and publishing it makes it an interface — changing a hint becomes a
  breaking change for anyone parsing it.
- **Give the recovery a structure.** A `recovery` field naming the action and its
  arguments, rather than a sentence to be read. Honest for a machine, and more
  work: every error class needs one, and the ones that genuinely have no
  recovery must say so rather than omitting it.

Escalate with a recommendation rather than settling it in a diff — this fixes the
shape of every error the CLI emits.

## Acceptance Criteria

- [x] The question above is answered in writing
- [x] Whatever is chosen applies to **every** error class, not only the refusals
      that prompted it — a partial answer leaves a caller guessing which errors
      carry a recovery
- [x] An error with no meaningful recovery says so explicitly rather than
      omitting the field, so absence is never ambiguous
- [x] `docs/cli.md`'s exit-code table and the `--json` documentation agree with
      whatever shape lands

## Technical Design

### Files to Create/Modify

- `apps/cli/src/errors.ts`, and every error class if the answer is structural

## Testing Strategy

One case per error class asserting the machine surface carries a recovery, and
one asserting a no-recovery error says so.

## The answer — emit `hint`, always keyed (user decision, 2026-08-13)

Escalated with a recommendation rather than settled in a diff, as the issue asked.

**The decisive fact is who the machine caller is: the agent — an LLM.** It reads
*"the patch itself is still good — re-read the document and run the same patch
again"* better than it reads a `{action, args}` structure. A structured `recovery`
field would be more honest for a parser and **less** useful for the only consumer
that exists. That also defuses the objection the issue raised against emitting
prose — that publishing a hint makes it an interface, so rewording one becomes a
breaking change — because that assumes a brittle parser downstream, and an LLM
tolerates rewording that would break one.

**Semantics, so `null` is a claim rather than a gap.** `hint` is a follow-up the
message does not already contain. `null` says the CLI has no further instruction:
either the message is the whole story (a usage error that already enumerates the
values it would accept) or nothing about the request can be changed. The key is
**never omitted**, so a caller never has to tell "there is nothing to do" apart
from "nobody wrote a hint".

**One class needed more than the one-line change.** `InternalError` is a
`CliError`, so it would have reported `hint: null` while `toProblem`'s fallback
for a thrown non-`CliError` carried a sentence — the same situation, reached by
two roads, answering differently. It now defaults to a shared
`INTERNAL_ERROR_HINT` (a call site may still override), and both roads assert
against that one constant.

The 14 constructions that pass no hint were each read. Seven are `UsageError`s
whose message already enumerates what it would accept (`--status must be one of:
open, resolved, archived — got "x"`), where a hint would only repeat the message,
so `null` is accurate under the semantics above. The rest are server-response and
config failures whose content is the server's own message.

## E2E Verification Log

**Model: Opus 5 (1M context)** (`claude-opus-5[1m]`), run by the orchestrator
directly rather than delegated. Branch `phase-33-signed-riders`. No server
started, no port bound (8765 and 5173 untouched).

```
$ npx vitest run apps/cli                        → PASS (1414) FAIL (0)
$ npx vitest run scripts/generated-artifacts     → 6 passed (docs/cli.md drift)
$ npm run typecheck -w apps/cli                  → exit 0
$ npx eslint <changed files>                     → clean
$ npx prettier --check apps/cli/src docs/cli.md  → all use Prettier style
```

**The envelope, before and after**, on the refusal that prompted the issue —
`corpus doc patch` against a document an outside editor moved:

```json
{"error":{"code":"stale_key","message":"… the patch itself is still good …"}}
{"error":{"code":"stale_key","message":"… the patch itself is still good …",
          "hint":"…run the same patch again…","changed":false,"details":{…}}}
```

**Tests**: one case per error class asserting the machine surface carries a
recovery (9 classes, `it.each`), one asserting a no-recovery error says so with a
present-and-`null` field rather than an absent one, one asserting both roads to
an internal error give the same sentence, one asserting a call site can override
it, and one on the stale-key refusal specifically.

**`docs/cli.md` is generated** (`npm run docs:cli -w apps/cli`), so the `--json`
description was changed at its source in `registry/globals.ts` and the doc
regenerated — not hand-edited. The exit-code table is generated from `EXIT_CODES`
and needed no change: this issue changes what an error *carries*, not which code
it exits with.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
