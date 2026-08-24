# [CLI-064] A batch verb needs a decided exit code before it is worth building

## Domain
cli

## Status
done

## Priority
P1 (important)

## Model
fable

## Dependencies
- Depends on: CLI-057, CLI-058
- Blocks: —

## Spec References
- SPEC.md Section 2 — the CLI is the agent's whole surface
- SPEC.md Section 9 — exit codes and `--json`

## Summary

**CLI-058's recommendation, filed as its own issue because it needs a decision
rather than an implementation.**

CLI-058 measured the fixed cost at ~159 ms and found option 1 nearly spent: 10.1
ms taken by deferring `yaml`, 23.4 ms left in `@corpus/contract`
(CONTRACT-082), and a floor of ~135 ms that is over half Node's own — 33.6 ms
boot, 18.4 ms undici, 18.5 ms zod. Its conclusion, in its own words:

> **My recommendation is option 2, batching.** Nothing above changes the *count*
> of calls, and the count is where the cost is.

CLI-057 is the worked example: five `doc show` calls, 796.6 ms, became one call
at 189.0 ms — **608 ms saved, 4.2×**. That is forty times what deferring `yaml`
bought, on one read.

Generalising it means a way to send several commands in one invocation. The
build is cheap. **The semantics are not**, and that is why this is filed rather
than done.

## The decision this issue exists to make

**What does a compound invocation return when the third of five commands fails?**

Every answer has a cost:

- **Stop at the first failure.** Simple, and it makes a batch a worse `&&` chain:
  the agent must reason about what did and did not run.
- **Run everything, exit non-zero if any failed.** The exit code says "something
  went wrong" and nothing about what. An agent must parse `--json` to recover,
  so the human form becomes useless for the case that matters.
- **Run everything, exit with the first failure's code.** Sounds precise, and
  lies when two commands fail differently.

And `--json` has the same question one layer down: is it an array of results
positionally matching the input, an object keyed by something, or a result plus
a failure list? CLI-057 chose an array of the same payloads a single read emits,
with a missing id exiting 5 and naming `details.missing` and `details.found`.
That is a good precedent for one verb over many ids. **It is not obviously right
for many verbs**, because five different commands do not share a payload shape.

## Decided by the user, 2026-08-23 — run everything, report per command

**Chosen: every command runs.** Exit is non-zero if any failed. `--json` carries
one entry per command, in the order they were sent, saying whether it ran and
what it returned.

**"Did not run" must be distinguishable from "ran and returned nothing".** That
is the criterion the shape exists to satisfy — absence from the array is not an
answer.

**A batch is explicitly not transactional, and the verb's help says so.** §4's
commit window may fold a batch of writes into one commit anyway, and a reader
who sees that will assume atomicity nobody promised. Say it in the help rather
than leaving it to be inferred from a commit log.

**Rejected: stop at the first failure.** Simplest to build, and it makes a batch
a worse `&&` chain — the agent must then work out what did and did not run,
which is the reasoning the batch exists to remove.

**Rejected: exit with the first failure's code.** It sounds more precise than a
generic non-zero and lies when two commands fail differently: one code for two
causes, and the second invisible without parsing `--json` anyway — which the
chosen shape makes the caller do once, honestly.

**Build the semantics first.** The measurement is settled and is not the risk
here. Read CLI-057's decisions before starting: it solved the same problem for
one verb over many arguments, and its answers are a starting position rather
than a template.

## Decisions taken (implementation, 2026-08-23)

The user's decision above fixes the frame: every command runs, exit is non-zero
if any failed, `--json` reports per command in order, a batch is not
transactional. What follows are the decisions inside that frame, each with what
lost and why.

### 1. The verb is `corpus batch`, top-level, and its commands arrive as JSON on stdin

One entry per command, each entry the argv you would have given `corpus`, as a
JSON array of strings — `[["doc","show","doc_a1"],["thread","resolve","th_1","--from","agent"]]`
— read from a heredoc or a pipe. *Rejected: commands as quoted shell strings*
(`-c 'doc show a' -c '…'`): each string would need shell-style splitting, which
reintroduces the exact quoting hazard the skills' heredoc discipline exists to
avoid — a `$` or a backtick in a carried value silently mangles it. JSON needs
no splitting: every token arrives byte-exact, so `-m` becomes safe for bodies
that the shell would have eaten, and the heredoc ceremony inside a batch
disappears. *Rejected: a separator token in argv* (`corpus batch doc show a ++
thread resolve …`): no token can be guaranteed absent from a value, which is
CLI-057's separator argument applied to input. *Rejected: an
`{argv, stdin}` object form* for in-band bodies: a JSON string already carries
any bytes, so `-m` is the same capability with no second grammar.

The batch owns stdin, so a command inside it that would fall back to reading
stdin finds it already consumed and sees "no body" — deterministically, never a
hang. Bodies inside a batch travel as `-m` or `--file` in the entry's argv, and
the help says so.

Stdin is read only when `stdinKind()` says `file` or `fifo`. A socket is the
standing CLI-007/CLI-066 refusal (`stdinSocketRefusal`, exit 2, may not be
omitted); a TTY or `/dev/null` is "no commands were given", exit 2 naming the
heredoc form.

### 2. A malformed batch is refused whole, before anything runs

Every entry is resolved against the registry and fully parsed **before the
first one runs**. Unknown verb, unknown flag, missing argument, more than 200
entries (`MAX_PAGE_LIMIT`, CLI-057's cap and the same stated-cap refusal), an
empty batch, unparseable JSON: exit 2, nothing requested, the entry named by
position. This does not contradict "every command runs" — that rule governs
run-time failures. A mistyped batch that ran its well-formed half would leave
the caller reasoning about partial state, which is the reasoning the batch
exists to remove, and the whole batch is still the caller's to fix and resend
because nothing happened.

Also refused per entry, pre-flight: `--json`, `--help`, `--version`,
`--no-color`, `--verbose` (rendering is decided once, by the batch invocation
— and help is not data), `--workspace` (one batch, one workspace), a nested
`batch` (a grammar with no additional power), and any command that runs
without a workspace (`corpus init` — it creates workspaces rather than acting
in one) or `corpus upgrade` (it replaces the running tool and restarts the
server the rest of the batch is talking to). `--from` on the batch itself is
the default for entries that name none, exactly as `CORPUS_FROM` would be;
an entry's own `--from` wins. `--timeout` on the batch is the transport
timeout for every entry.

### 3. Two failure classes, because CLI-057's distinction transfers whole

- **A failure about the command** — a `404`, a `409`, a stale key, a patch
  refusal, a `422`, an unexpected exception in one handler — is recorded on
  that entry, and the batch continues. This is the user's "every command runs".
- **A failure about the run** — the server unreachable (exit-4 class), or a
  `401` (the token is the workspace's, so every remaining command is doomed
  identically) — is recorded on the entry that hit it and **ends the batch**;
  the remaining entries are reported as never run. Pressing on would
  manufacture up to 199 copies of one fact, which is CLI-057's argument
  unchanged. This is what makes "did not run" a real, reachable state rather
  than a decoration on the shape.

Execution is sequential, in order — CLI-057 decision 6 transfers: the report
stays in the order sent by construction, and each entry's failure is exactly
the failure the lone invocation would have raised.

### 4. The `--json` shape: an envelope per entry, because "did not run" must be sayable

Stdout carries one JSON value, an array with exactly one entry per command, in
the order sent:

- ran and succeeded: `{"command":[…],"ran":true,"ok":true,"value":<the
  command's own --json value, null when it emits none>}`
- ran and failed: `{"command":[…],"ran":true,"ok":false,"error":{code,message,
  hint,changed?,details?}}` — the same problem object a lone failure's
  envelope carries
- never ran: `{"command":[…],"ran":false}` — no `ok`, no `value`, no `error`,
  because nothing happened to report; the cause is on the last `ran` entry

CLI-057 rejected envelopes for `doc show` because its elements share one
payload shape and the misses could travel on the failure channel. Neither
holds here: five different commands share no payload shape, and "did not run"
must be present positionally — the criterion the user's decision names. So the
envelope wins. `value` is explicitly `null` rather than absent when a command
emitted nothing, so "ran and returned nothing" is written down, not inferred.
A batch of one still emits an array of one: the shape is the batch's, and
there is no pre-existing consumer to keep whole (unlike `doc show`'s one-id
object).

The human form prints each entry under a `──────── <n>: <command> ────────`
rule (CLI-057's `U+2500` rule, for the same forgeability reason), streaming
the command's own human lines as they happen; a failed entry prints
`failed — <message>` and the hint under its rule; a never-run entry prints
`not run.` — three states, distinguishable by eye and by `sed`.

### 5. Exit codes: 0 all-succeeded, a new exit 11 `batch_failed` otherwise

Exit 0 means every command ran and succeeded. Anything else is **exit 11**,
`batch_failed`, a new code whose meaning is: at least one command in the batch
failed or never ran — the per-command report on stdout says which, and reading
it is the next move. The summary error (stderr, human and `--json` alike)
names the counts and carries `details.failed` and `details.notRun` as 1-based
positions, so a machine caller recovers without re-deriving them.

Why a new code, when the CLI already has ten: exit codes here group by what
the caller does next (the `StaleKeyError`/`PatchRefusedError` doctrine), and
"read the per-entry report" is a next move no existing code names.
*Rejected: the first failure's code* — by the user, above. *Rejected:
`check_failed` (6)* — its documented meaning is "its work succeeded", which
reads as permission not to verify, and a batch whose third write failed after
two landed is not that. *Rejected: `partial_failure` (8)* — it asserts
`changed: true`, which is a lie for an all-read batch; CLI-057 rejected it for
the same reason one verb over. *Rejected: `internal_error` (1)* — nothing
malfunctioned. `BatchFailedError` leaves `changed` undefined — the honest
tri-state, since the entries themselves say what ran; the help states plainly
that what succeeded before a failure **stays done**.

### 6. Not transactional, said in the verb's help in so many words

The help says: a batch is not a transaction — every command that succeeded
stays done whatever fails after it, and §4's commit window folding several
writes into one git commit is an artifact of timing, not a promise of
atomicity. Decided by the user; recorded here because the help text is where
it is enforced.

## Acceptance Criteria

- [x] The exit-code rule is decided and written down, with the two rejected
      alternatives and why each lost. (Decisions taken §5 above: exit 0 /
      exit 11 `batch_failed`, four rejected alternatives recorded.)
- [x] The `--json` shape is decided, and it says for each command whether it ran.
      "It is absent from the array" is not an answer — an agent cannot tell
      *did not run* from *ran and returned nothing*. (Decisions taken §4:
      `ran` on every entry, `value: null` for ran-and-returned-nothing.)
- [x] Whether a batch is transactional is decided **explicitly**. It is not,
      the verb's help says so in so many words, and names §4's commit-window
      fold as an artifact of timing rather than a promise.
- [x] Only then, the verb — `corpus batch`, built after the decisions above
      were written into this file.
- [x] The saving is measured against real multi-call sequences the product's own
      skills make, not a synthetic five. (The comment skill's 7-call worked-event
      sequence, real writes, real claimed event — E2E log below.)

## Technical Design

### Files to Create/Modify
- the decision, in this issue file, before any source file
- `apps/cli/src/commands/` — the verb, once decided

### Key Implementation Details

**Do not start with the verb.** The measurement is already done and is not in
doubt. What is in doubt is what the thing means when it half-works, and a batch
verb whose failure semantics were decided by its implementation is one nobody
can rely on.

Read CLI-057's decisions first — the rule character, the repeat handling, the
cap at `MAX_PAGE_LIMIT`, the exit-5-with-details shape. It solved the same
problem for one verb over many arguments, and its answers are the starting
position rather than a template to copy.

### Edge Cases
- A command in the batch that is interactive or that writes to stdout in a form
  the batch cannot frame.
- A batch where one command's output is another's input. If that is out of
  scope, say so in the verb's help rather than leaving it to be discovered.
- A batch of one.

## Testing Strategy

Decided after the semantics are. Whatever they are, the test that matters is the
partial failure: three succeed, one fails, one never runs, and every one of those
three states is distinguishable in both output forms.

## E2E Verification Plan

### Verification Steps
1. Real invocations against a real server, including a partial failure
2. The measurement, against a sequence a shipped skill actually makes

## E2E Verification Log

**Model: Fable 5 (`claude-fable-5`).** Date 2026-08-23.

Packaged bundle (`npm run package:build`, v0.20.0) against a real daemonized
server on port **8766** in a scratch workspace under the session scratchpad —
the user's server on 8765 was never touched. 40 seeded documents, a real
thread (`th_o67m5q3s`) on `doc_7ctkgstn`, and a real claimed queue event
(`evt_sxgnzdvfb747`), so `job log` in the sequences below is genuine.

### The worked sequence, run for real

The current comment skill's worked-event sequence (post-AGENT-047): `thread
context`, `thread show`, `job log`, `doc show`, `doc patch`, `job log`,
`thread reply` — 7 calls — sent as one batch under `--json`. First run, exit
**11**, and the failure was real rather than staged: the patch quoted the
wrong document's body:

```
entries: 7
{"command":["thread","context"],"ran":true,"ok":true,"value":"object"}
{"command":["thread","show"],"ran":true,"ok":true,"value":"object"}
{"command":["job","log"],"ran":true,"ok":true,"value":"object"}
{"command":["doc","show"],"ran":true,"ok":true,"value":"object"}
{"command":["doc","patch"],"ran":true,"ok":false}   # error.code patch_no_match
{"command":["job","log"],"ran":true,"ok":true,"value":"object"}
{"command":["thread","reply"],"ran":true,"ok":true,"value":"object"}
# stderr: {"error":{"code":"batch_failed","message":"1 of 7 commands failed; every command ran.",
#          …,"details":{"failed":[5],"notRun":[]}}}
```

The failed patch cost its own entry alone — commands 6 and 7 still ran, which
is the decided semantics working on a real mistake. A corrected 3-command
batch (patch, job log, resolve) then ran green: exit 0, `ok: true,true,true`.

### The never-ran state, real server killed

```
$ corpus server stop && corpus batch <<'CORPUS_EOF'
[["doc","show","doc_7ctkgstn"],["doc","list"],["health"]]
CORPUS_EOF
──────── 1: doc show doc_7ctkgstn ────────
corpus: server not running for this workspace — run `corpus server start`
──────── 2: doc list ────────
not run.
──────── 3: health ────────
not run.
corpus: 1 of 3 commands failed and 2 never ran — a failure about the run, not about one
command, ended the batch at command 1.
  { "failed": [ 1 ], "notRun": [ 2, 3 ] }
exit=11
```

Three states, distinguishable by eye in the human form and positionally under
`--json` (`ran`/`ok`).

### The refusals, all before anything runs (exit 2, `runs` empty, 0 requests)

Verified E2E, each against the real binary: unknown verb (`command 2 (doc
frobnicate) is not a command this tool has`), entry carrying `--json` (names
the flag and says it belongs to the batch invocation), nested `batch`, empty
batch, no stdin (`no commands on stdin`), and a **socket** stdin from
`spawnSync({input})` — refused at exit 2 with zero bytes read, the CLI-066
discipline holding for the new verb.

### The measurement, against the sequence a shipped skill makes

Both arms are the same 7-command worked-event sequence above, every write
real (the patch alternates direction per iteration, net zero). 15 interleaved
runs per arm, same packaged binary both arms, minima reported. Two full runs
at different machine loads:

```
run 1 — load avg 10.6 before, 10.0 after (machine busy with 3 other agents):
  separate (7 invocations)  min 1735.8  med 2374.3 ms
  one batch                 min  476.3  med  751.2 ms
  saving                    min 1259.5 ms (3.64x)

run 2 — load avg 5.2 before, 4.5 after:
  separate (7 invocations)  min 1265.5  med 1869.6 ms
  one batch                 min  353.9  med  455.4 ms
  saving                    min  911.7 ms (3.58x)
```

The honest figure is run 2: **~0.9 s saved per worked event on the comment
skill's 7-call sequence, 3.6×**. Per-call arithmetic is coherent with the
audit and CLI-058: 1265.5/7 ≈ 181 ms per lone invocation against the audit's
164–190 ms floor; the batch's 353.9 ms is one startup plus seven round trips.
The audit's ~2.9 s/event ceiling assumed all ~15 calls of an event batch into
one invocation, which interleaved reasoning forbids — the batchable share is
the sequence measured here. Raw per-iteration timings:
`scratchpad/e2e/cli-064-measurement*.txt`.

### Falsification — the fix broken four ways on purpose

Each break was made in `batch.ts`, the scoped suite run, then restored (final
run green, 29/29):

| break | tests that failed |
|---|---|
| every failure aborts the batch (stop-at-first, the rejected alternative) | 2 — "charges a command-level failure to that command alone and keeps going"; "treats an unexpected exception as that command's failure" |
| a never-ran command is absent from the array | 2 — the mandated partial-failure test (both output forms) |
| `value: null` becomes absence for a command that emitted nothing | 1 — "emits value: null for a command that ran and returned nothing" |
| failures reported but never thrown (exit 0 with failures) | 5 — every exit-semantics test |

The mandated test is `batch.test.ts` "the mandated partial-failure test":
five commands — three succeed, one fails, one never runs — with all three
states asserted in both output forms, and the fifth handler proven never to
have executed.

### Checks

- `vitest run apps/cli` — 2,079 passed. The 2 failures are
  `resident.test.ts`/`agents.test.ts` fixture fallout of CONTRACT-071's
  `designationId` (landed mid-session), owned by the orchestrator's sweep —
  files this issue never touched.
- `tsc --noEmit -p apps/cli` — clean apart from those same two files.
- `eslint` on every touched file — clean, no rule disabled.
- `prettier --check` on every touched file and `docs/cli.md` — clean.
- `docs/cli.md` regenerated via `npm run docs:cli -w apps/cli`;
  `docs/generate.test.ts` green.
- Scratch server stopped (pids 84776, 89335); port 8766 verified free; the
  user's 8765 never touched.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix

## Audit note (SHARED-070, 2026-08-23)

The audit's measured loop feeds this decision two figures: a worked
`comment.created` event makes ~15 CLI calls (subagent + orchestrator share) at a
189 ms median per call under load ~2–4, so batching's ceiling is ~2.9 s of
fixed latency per event and ~86 s over a 30-event day. Token-wise the calls are
cheap (mean ~1,500 tok/event, in + out), so batching is a latency play, not a
context play. Full numbers: `issues/evals/SHARED-070-token-audit.md`.
