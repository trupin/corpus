# [CLI-067] `queue fail` needs a reason, and two help strings now contradict the server

## Domain
cli

## Status
done

## Priority
P1 (important)

## Model
opus

## Dependencies
- Depends on: SERVER-145
- Blocks: —

## Spec References
- SPEC.md Section 7 — the queue, and "nobody settles work they did not claim"
  (rider signed 2026-08-13)
- SPEC.md Section 9 — exit codes

## Summary

Two consequences of SERVER-145, both in `apps/cli/src/commands/queue/transitions.ts`.

**1. Two help strings now state the opposite of what the server does.**

- `completeCommand` says: _"Idempotent: completing an already-completed event is
  not an error … exits 0 like the first"_. It is now a `409` at exit 5.
- `failCommand` offers `corpus queue fail evt_9f2a` as an example of failing
  without an annotation.

Help that describes behaviour the product does not have is worse than no help,
and this release's own audit (SHARED-070) measured help as the surface the agent
reads to decide what to do. A wrong sentence there is paid twice — once to read,
once to recover from acting on it.

**2. `corpus queue fail` still accepts no `--reason`.**

The orchestrate skill treats the reason as what an operator reads in the failed
row, and its examples always pass one. Without it a failed row can exist with
nothing to say why.

## The decision already made, so it is not re-litigated

SERVER-145's implementer settled the breaking-change question and the reasoning
holds: **making `--reason` required is a CLI-side usage error, and the route's
body stays `required: false`.** The reaper writes a `failed` event with its own
`error` without going through the route, so tightening the wire schema would
break an HTTP caller for nothing.

So: **exit 2, before any request is made.**

## Acceptance Criteria

- [x] `corpus queue fail <id>` without `--reason` is a usage error at **exit 2**
      with zero requests. Verified against a real server, and asserted as
      `expect(stub.requests).toEqual([])` rather than as an exit code.
- [x] The route's request body is unchanged. No schema touched — the contract's
      `POST /api/queue/{id}/fail` stays `required: false`, and
      `openapi.test.ts`'s body partition still records it as `false`.
- [x] `completeCommand`'s idempotence sentence is gone, replaced by the claim
      rule, in the **summary** as well as the description.
- [x] `failCommand`'s bare example is replaced. Both its examples now pass a
      reason, and a test asserts every one of them does.
- [x] Read all ten queue verbs. **One sibling found and fixed** (the topic
      paragraph), plus one adjacent defect the E2E surfaced. Both below.
- [x] `docs/cli.md` regenerated (+21/-11); `docs/generate.test.ts` green.
- [x] Checked — **and the criterion as written would have sent me past the
      real problem.** See "The brief register" below.

## Technical Design

### Files to Create/Modify
- `apps/cli/src/commands/queue/transitions.ts`
- its tests
- `docs/cli.md` — regenerated

### Key Implementation Details

The last acceptance criterion is the one to get right. CLI-056 made brief help
the first sentence of a description and AGENT-045 made the skills ask for brief.
So a correction written as a second or third sentence is invisible to every
reader this release just pointed at the brief register. **Put the rule in the
first sentence.**

### Edge Cases
- `--reason ""` — an empty reason is not a reason, and should fail the same way.
- A reason long enough to matter in a row. Do not invent a cap here; if one is
  needed, that is its own issue.

## Testing Strategy

Command tests: the missing flag exits 2 with no request issued (assert the stub
recorded **zero** requests — a test asserting only a non-zero exit would pass if
the request went out and the server refused it). The help strings' new text, and
their brief renderings.

**Falsify**: remove the required-flag check and watch the "no request issued"
assertion fail.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. `corpus queue fail <id>` with no `--reason` → today, a request is made
2. `corpus queue complete --help` → today, promises idempotence the server
   no longer offers

### Verification Steps
1. Both commands after the change, with real output
2. `corpus queue complete --help=brief` shows the corrected first sentence

## E2E Verification Log

### Reproduction (bugs only)

**Model: Opus 5 (1M context).**

Pre-fix, against the real binary at `apps/cli/dist`:

1. `corpus queue fail evt_...` with no `--reason` issued a POST. The stub-server
   test `"sends no body at all for a bare fail"` asserted exactly that behaviour
   and passed, which is why it had to be deleted rather than adjusted.
2. `corpus queue complete --help` printed *"Idempotent: completing an
   already-completed event is not an error, so a duplicated call after a retry
   exits 0 like the first."* Against a real server, the same call is now:
   `corpus: 409 conflict: queue event evt_3zozvcrtjujf is already processed` at
   exit 5. The help stated the opposite of the product.

### Post-Implementation Verification

#### The brief register — the criterion, and the correction to it

The issue says brief help is "the **first sentence** of each description". That
is true of a **flag** and an **argument**, and **false of a command**.
`renderCommandHelp` (`apps/cli/src/help.ts:155`) reads:

```ts
if (!brief && command.description !== undefined) sections.push("", command.description);
```

Brief drops a command's `description` **wholesale**. What a brief reader gets for
a verb is its **`summary`** and the glosses of its flags — no sentence of the
description at all. `help.test.ts` already pins this ("drops the description
paragraph and the examples").

So a correction written as the description's *first* sentence would still have
been invisible to every reader this release pointed at brief. **The rule had to
go in the `summary`.** It did, for all three verbs:

| verb | before | after |
| --- | --- | --- |
| `complete` | `Mark a claimed event processed.` | `Mark work you claimed processed — completing anything else is refused.` |
| `fail` | `Mark a claimed event failed.` | `Mark work you claimed failed, saying why in the required --reason.` |
| `abandon` | `Give up on an event for good.` | `Give up on an event for good, from any state but processed.` |

#### Second defect, found only by the E2E

Rendering the real binary's brief help showed:

```
Flags:
  --reason <text>  **Required.**
```

`gloss()` takes the first sentence, and `**Required.**` **is** a complete
sentence, so the brief reader got the single word "Required" and nothing about
what to write. A sweep over the whole registry found exactly two flags with this
shape — the one I had just written, and the pre-existing `queue defer
--blocked-on`. Both fixed by joining requirement and meaning into one sentence
(`**Required** — why the event failed, shown in the console's failed row.`), and
locked by a test over every queue flag's gloss. No unit test I had written could
have caught this. The E2E step earned its place.

#### The sibling the audit predicted

`apps/cli/src/commands/queue/index.ts` — the **topic** paragraph, read by anyone
running `corpus queue --help` — said *"every transition is idempotent so a
retried call is never a crash."* That is one sentence making the false claim for
all four verbs at once. Replaced with the claim rule and a pointer to
`corpus queue in-progress`.

Also corrected: the file docblock in `transitions.ts` ("All of them are
idempotent server-side"), and a stale cross-reference in `defer.ts` claiming
`queue fail` follows the same empty-reason rule — it no longer does.

`halt`, `resume` and `reap-stale` also claim idempotence. Those claims were
**checked and left**: SERVER-145 did not touch them, and their routes declare no
`409`.

#### Files changed

- `apps/cli/src/commands/queue/transitions.ts` — required `--reason`; three
  summaries; three descriptions; the flag gloss; file docblock
- `apps/cli/src/commands/queue/index.ts` — the topic paragraph
- `apps/cli/src/commands/queue/defer.ts` — `--blocked-on` gloss, stale comment
- `apps/cli/src/commands/queue/transitions.test.ts` — rewritten around the new
  behaviour, plus a help-register describe block
- `apps/cli/src/commands/queue/index.test.ts` — the wiring harness now passes a
  reason
- `docs/cli.md` — regenerated

#### Commands run, with real output

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/cli packages/contract
TEST=0
 Test Files  174 passed (174)
      Tests  4971 passed (4971)

$ npm run lint            → LINT=0
$ ./node_modules/.bin/prettier --check ...  → All matched files use Prettier code style!
$ npm run typecheck       → TYPECHECK=0 (server, ui, contract, kit)
$ npm run docs:cli -w apps/cli → generated ../../docs/cli.md   (+21/-11)
```

Against a real server on **port 8766** (the user's 8765 untouched):

```
=== 1. queue fail with NO --reason ===
corpus: `corpus queue fail` requires --reason <text>.
  Say why the work could not be done — it is what an operator reads in the failed row,
  and the only record of it. `corpus queue abandon` is the verb for giving up with
  nothing to add. Nothing was sent to the server.
EXIT=2

=== 2. queue fail with EMPTY --reason ===
(identical message)
EXIT=2

=== 3. queue fail WITH --reason, unknown id ===
corpus: 404 not_found: no queue event evt_doesnotexist
EXIT=5
```

Case 3 is what proves cases 1 and 2 sent nothing: the same id reaches the server
and returns a 404 the moment a reason is present.

#### Falsification — twice, because once was not enough

**(a) Remove the guard.** The three `refuses a --reason that is …` cases fail:

```
× refuses a --reason that is absent without sending a request
× refuses a --reason that is empty without sending a request
× refuses a --reason that is only spacing without sending a request
  → expected undefined to be an instance of UsageError
```

**(b) The counterfactual the issue asks for.** A temporary test, run with the
guard still removed and the stub answering `400` — the world where the request
goes out and the server refuses it:

```
✓ WEAK assertion — only a non-zero exit — passes with the bug present
× STRONG assertion — zero requests — fails with the bug present
  → expected [ { method: 'POST', …(5) } ] to deeply equal []
```

Exactly as predicted: an exit-code-only test is green against the bug. The
committed test asserts `stub.requests` is empty. Temporary file deleted, guard
restored, suite green.

## Completion Checklist (domain agent)
- [x] Tests written and passing — `apps/cli` 2041/2041, combined run 4971/4971
- [x] `/lint` passes — eslint 0, prettier clean, typecheck clean
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
