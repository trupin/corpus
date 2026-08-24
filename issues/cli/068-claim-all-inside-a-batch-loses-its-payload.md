# [CLI-068] `queue claim-all` inside a batch loses its payload, silently

## Domain
cli

## Status
done

## Priority
P0 (critical path)

## Model
opus

## Dependencies
- Depends on: CLI-064
- Blocks: —

## Spec References
- SPEC.md Section 2 — the CLI is the agent's whole surface
- SPEC.md Section 7 — the queue and claiming

## Summary

**Found by AGENT-051's implementer, hours after CLI-064 shipped in this same
release, while trying to use it.**

```
corpus batch --json   with  ["queue","claim-all"]  in the array
  → "value": null
```

The claim payload is **silently lost**. `queue status` and `doc show` in the
same array carry theirs. Human mode is fine — this is `--json` only, which is
the mode a caller parses.

CLI-064's whole design turns on one guarantee, stated in its own decision
record: `value` is **explicitly `null` when a command emits nothing**, so
*ran-and-returned-nothing* is written down rather than inferred. A command that
emits plenty and reports `null` breaks exactly that guarantee, and breaks it in
the direction that cannot be detected — the report says the command ran, says it
succeeded, and hands back nothing.

The agent worked around it rather than reaching into `apps/cli`: the loop's
claim is kept out of every batch and the skill says why. **That workaround is a
rule the skill states, not a mechanism**, so it holds only as long as nobody
writes a batch by hand.

## Why P0

An agent batching a claim gets an empty answer that reads as success, and then
works on nothing — or worse, on an event list it thinks is empty. This is the
same class as CLI-066: a value the caller sent or expected, dropped at exit 0.
That one took weeks to surface as an orphaned anchor. This one shipped today and
was caught within the hour by the first thing that tried to use it.

## The cause, in one sentence

`createNestedOutput` hardcoded `json: false`, so every command a batch runs was
told the invocation was in human mode — and `queue claim-all`, which writes its
payload with `out.write` when the mode is human and emits it only under
`--json`, took the human branch inside `corpus batch --json` and sent its claim
to the channel a `--json` parent suppresses.

Nothing about `claim-all` is special except that it is the only command whose
**whole payload** is on the mode-dependent branch. Three others read the same
flag and were wrong in three other ways. See the sweep below.

## Acceptance Criteria

- [x] `queue claim-all` inside `corpus batch --json` carries the same payload it
      carries alone. (Verified E2E against a real server with real claimable
      events, and by a paired shape comparison of the two arms.)
- [x] **The cause is named, not patched at the call site.** One line in
      `apps/cli/src/output.ts`, and no line in `batch.ts` or `claim-all.ts`.
- [x] Every command the registry knows is checked for the same loss — 60
      commands, both arms of the sweep below, with the affected four named and
      the other 56 accounted for.
- [x] A test asserts the payload's **contents**: every claimed event id, type
      and payload, and the `inProgress` set beside them. Falsified — with the
      loss restored it fails `expected null to deeply equal { … }`.
- [x] Human mode stays exactly as it is. A human batch is untouched by
      construction (`parent.json` is `false` there, which is what was hardcoded),
      and it is re-run E2E below.
- [x] AGENT-051's prohibition is revisited — recommendation below.

## Technical Design

### Files Modified (as shipped)
- `apps/cli/src/output.ts` — `createNestedOutput` carries `json: parent.json`
  instead of `false`. **One line.** Neither `batch.ts` nor `claim-all.ts` was
  touched: the loss was never in either.
- `apps/cli/src/output.test.ts` — the pinned `expect(nested.output.json).toBe(
  false)` was the bug, written down as a guarantee. Replaced by three tests: the
  mode is the parent's, a step still cannot print JSON, and a mode-branching
  step takes the branch the invocation asked for.
- `apps/cli/src/commands/batch.test.ts` — six tests, contents-asserting, against
  the shipped registry and a real socket.
- `apps/cli/src/commands/hygiene.test.ts` — a pinned inventory of every module
  that reads the output mode, so the next one shows up as a failing diff.

`docs/cli.md` is unchanged: no command's registry prose moved.

### Key Implementation Details

Read CLI-064's decision record in `issues/cli/064-*.md` first. The envelope's
shape — `{command, ran, ok, value|error}` — and the meaning of `value: null` are
settled and signed; this issue makes the implementation honour them, and must
not change them. **Neither changed.** `value` is still `null` exactly when a
command emitted nothing, and the test that pins it still passes with the fix in
and with the fix out.

**Do not fix this by special-casing `claim-all`.** The interesting question is
what class of command is affected, and a special case would leave the rest of
that class broken and unfindable.

### Why the flag lied, and why it did not have to

`createNestedOutput` exists so a composite verb — `corpus upgrade`, and now
`corpus batch` — can run ordinary handlers without each one printing its own
JSON document to stdout. It secures that two ways:

1. **Structurally.** `emit` captures the value into a closure rather than
   writing it, and `write` is routed through `line`, which the parent decides
   what to do with. A step cannot reach stdout at all.
2. **By the flag.** `json: false`, so a step that asks "am I in `--json`?"
   is told no.

The second was redundant with the first and, unlike the first, was a claim about
the world rather than a property of the plumbing. `Output.json` is **the
invocation's mode** — the thing `--json` sets — not a permission to print. A
step that reads it to decide _how to render_ is unaffected by the lie, because
the parent suppresses its lines anyway. A step that reads it to decide **what to
produce** is broken by it, and four commands do exactly that.

The fix carries the parent's mode. The no-print guarantee is untouched, because
it never rested on the flag: `output.test.ts` asserts it directly, under a
`--json` parent, with `emit`, `write` and `line` all exercised.

### Edge Cases
- A command that genuinely emits nothing — `value: null` is correct there, and
  the fix must not turn it into an empty object.
- A command whose payload is large: the batch caps at 200 entries and a claim
  payload can be long.
- Human mode, which is reported working and must stay so.

## Testing Strategy

A batch containing `queue claim-all` beside `queue status`, against a real
server with claimable events, asserting the claim's own fields in the envelope.

**Falsify**: restore the loss and watch the contents assertion fail. A test
asserting only `value !== null` would pass with an empty object in place.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Start a real server with at least one claimable event
2. `echo '[["queue","claim-all"],["queue","status"]]' | corpus batch --json`
3. Expected: both envelopes carry their payloads
4. Actual: the claim's `value` is `null`, and the status's is not

### Verification Steps
1. Repeat after the fix and compare the claim envelope against the same command
   run alone
2. Run the sweep and record which other commands were affected

## E2E Verification Log

implemented on: **opus** (claude-opus-5, 1M context)

**Setup.** Built bin (`npm run build`, v0.20.0), scratch workspace
`…/scratchpad/ws068`, its own daemonized server on port **8801**, pid 30178. The
user's server on 8765 was never touched. Three real threads on
`doc_nq4bgylu` seeded two real `comment.created` events before the
reproduction. Every run below is captured under `…/scratchpad/e2e068/`.

### Reproduction (bugs only)

Reported by AGENT-051's implementer, 2026-08-23. Reproduced here against the
real server before any code was changed:

```
$ corpus batch --json <<'CORPUS_EOF'
[["queue","claim-all"],["queue","status"],["doc","show","doc_nq4bgylu"]]
CORPUS_EOF
[{"command":["queue","claim-all"],"ran":true,"ok":true,"value":null},
 {"command":["queue","status"],"ran":true,"ok":true,"value":{…,"pending":0,"inProgress":2,…}},
 {"command":["doc","show","doc_nq4bgylu"],"ran":true,"ok":true,"value":{…}}]
exit=0

$ corpus queue status --json
{…,"pending":0,"inProgress":2,…}
```

**Worse than reported.** The two events were claimed — `pending` went 2 → 0 and
`inProgress` 0 → 2 — and the caller was handed `null` at exit 0. It then held
two events it could not name, could not settle and had no reason to think
existed. That is the CLI-066 shape exactly: a value dropped at exit 0, with the
damage surfacing later as state nobody can account for. Those two events are
still visible as `held 9m` orphans in the human-mode run further down, which is
the loss made concrete.

### The sweep: 60 commands, both arms

**Statically, the class is closed.** A command's `value` is whatever it hands
`out.emit`, and the nested output captures **every** `emit` unconditionally. The
only way a command's value can differ between running alone and running nested
is if the command reads the mode. Four modules in the whole CLI do:

| command | reads the mode to… | affected? |
| --- | --- | --- |
| `queue claim-all` | choose `emit` (`--json`) or `write` (human) for its **whole payload** | **YES — the reported loss.** `value: null` for a claim that emptied the queue |
| `doc list --fields` | refuse the projection unless `--json` is on | **YES.** Refused inside a `--json` batch, `usage_error`, exit 11 — visible, not silent |
| `server logs --follow` | refuse `--follow` under `--json`, because it never returns | **YES.** Not refused nested, so it followed the log and **hung the batch** — killed at a 6 s bound, exit 124 |
| `doc show --section` | write the section's raw bytes in human mode only | **no.** Its `emit` is unconditional, so the value always arrived; only the suppressed human lines differed |

The other **56** commands never read the mode, so nested and lone runs are the
same call by construction. The inventory is now pinned in `hygiene.test.ts` over
the whole of `src/`, with a fabricated rogue proving the scan catches a new one
and a fabricated doc comment proving it does not catch prose.

**Empirically**, paired arms against the real server — each command run alone
under `--json` and again as a one-entry `corpus batch --json`, values compared
by key shape. 19 commands run in both arms, **19 identical, 0 different**
(`…/scratchpad/e2e068/14-sweep-run.txt`):

```
agents  health  reflect  search  workspace diff  server status  server logs
doc list  doc related  doc show  doc diff  thread show  thread context
thread scope  queue status  job log  job list  db doctor  index status
```

`thread scope` failed identically in both arms (exit 5 / `<failed conflict>`),
which is the batch reporting the same failure the lone invocation raises. The
41 held back are named with a reason in that file: 3 a batch refuses outright
(`init`, `batch`, `upgrade`), 1 long-polls (`queue idle`), and 37 are writes or
state changes that cannot be run twice for a fair comparison. `doc check`,
`doc create` and `queue claim-all` were then run by hand in both arms anyway
(`…/15-sweep-extra.txt`, `…/08-after.txt`) — same shape each time.

### Post-Implementation Verification

**1. The reported case, fixed.** Same server, same batch shape, a freshly seeded
event:

```
$ corpus batch --json <<'CORPUS_EOF'
[["queue","claim-all"],["queue","status"],["doc","show","doc_nq4bgylu"]]
CORPUS_EOF
{
  "command": ["queue","claim-all"], "ran": true, "ok": true,
  "value": {
    "events": [{ "id": "evt_v3smplxfneg4", "type": "comment.created",
                 "created": "2026-08-24T02:29:16Z", "source": "thread",
                 "payload": { "threadId": "th_sx5ns2zj", "parentId": "doc_nq4bgylu",
                              "turnTs": "…", "mentions": [], "skills": [], "unresolved": [] } }],
    "inProgress": { "events": [ {"id":"evt_jdfeefc7u56e",…}, {"id":"evt_mb2olh66abd5",…} ],
                    "total": 2, "truncated": false }
  }
}
exit=0
```

The two events the reproduction orphaned are now visible in `inProgress` —
which is the point of that key, and was itself unreachable through a batch.

**2. Parity with the lone invocation**, two freshly seeded events, one per arm.
Ids and instants differ because the events differ; every key does not:

```
alone shape: {"events":[{created,id,payload:{mentions,parentId,skills,threadId,turnTs,unresolved},source,type}],
              "inProgress":{events:[{heldSince,id,originId,originTitle,type}],total,truncated}}
batch shape: (identical)
identical: true      event payload keys equal: true
```

**3. The other two live sites.**

```
$ corpus batch --json   [["doc","list","--fields","id,title","--limit","3"]]
[{…,"ok":true,"value":{"items":[{"id":"th_ihlo6zau","title":"Re: \"assumption\""},…],
                       "page":{"total":18,"limit":3,"offset":0}}}]        exit=0

$ timeout 20 corpus batch --json   [["server","logs","-f","-n","1"]]
[{…,"ok":false,"error":{"code":"usage_error","message":"--follow streams; it cannot be
   combined with --json.","hint":"Use `corpus server logs -n <count> --json` …"}}]
exit=11        # before the fix: exit 124, killed at the bound
```

**4. Human mode, unchanged.** The claim is still one JSON line on stdout under
its rule, and the in-progress block is still a readable stderr aside:

```
──────── 1: queue claim-all ────────
{"events":[{"id":"evt_vsyvs6ql2cb4",…}],"inProgress":{…,"total":5,"truncated":false}}
the server still holds 5 events in-progress — not claimed by this call:
  evt_wz7qtpjpm7nz  comment.created  held 35s  Re: "assumption"
  …
──────── 2: queue status ────────
queue running — pending 0, in-progress 6, deferred 0, processed 0, failed 0, abandoned 0
all 2 commands succeeded.        exit=0
```

`doc list --fields` in a **human** batch is still the refusal it is alone, word
for word — the mode really is human there, so the refusal is correct.

### Falsification

`json: parent.json` reverted to `json: false`, nothing else changed, scoped
suites re-run. **Six tests fail**, and the two that must not, do not:

```
× a nested output … > reports the parent's mode rather than inventing a human one
× a nested output … > gives a mode-branching step the branch the invocation asked for
× corpus batch (CLI-068) > carries queue claim-all's claim, field for field, …
× corpus batch (CLI-068) > hands the batch exactly what the same claim carries when it runs alone
× corpus batch (CLI-068) > lets doc list --fields see the --json its own refusal asks for
× corpus batch (CLI-068) > refuses server logs --follow inside a --json batch instead of streaming forever
✓ corpus batch (CLI-068) > does not turn a command that really emitted nothing into an empty object
✓ corpus batch (CLI-068) > keeps human mode exactly as it was: the claim is still one line on stdout
Tests  6 failed | 47 passed (53)
```

The contents assertion fails on contents, not on nullity:

```
AssertionError: expected null to deeply equal { Object (events, inProgress) }
- Expected: { "events": [ { "id": "evt_sxgnzdvfb747", "threadId": "th_o67m5q3s",
              "type": "comment.created" }, { "id": "evt_9k2m4p1qr8sv", … } ],
              "inProgress": { "events": [], "total": 0, "truncated": false } }
+ Received: null
```

A test asserting `value !== null` would have failed here too — but it would also
have passed on `{}`, which is why the claimed ids and types are named. The
`--follow` test is the sharper one: with the loss restored it does not fail, it
**hangs for 5.4 s** before vitest's own bound ends it, which is what the batch
did to a real caller.

Restored, both suites green: `53 passed (53)`.

## Follow-up 1: `corpus batch`'s help named one waiting verb, and there are two

Folded in here rather than filed separately, because it is the same finding. The
sweep turned up `server logs --follow` hanging a batch, and the verb's help
named only `queue idle` as a command that would hold one. Two instances make a
class, so the help now states the **rule** with both as its examples, rather
than a list a third verb will later be missing from:

> **An entry that waits holds every entry after it**, exactly as it would hold a
> shell: entries run one at a time, in order, and the batch is done when the
> last one is. The rule is the general one rather than a list of verbs — **if a
> command would not return on its own, it does not return here either** — and
> two shapes have it: a verb that long-polls (`corpus queue idle` parks for
> about eight minutes) and a verb that follows (`corpus server logs --follow`
> streams until interrupted). Neither is refused for being in a batch, because
> neither is a mistake outside one. Park and follow in their own invocations.
> `--follow` is the one that also collides with `--json`, which it may never be
> combined with: under `corpus batch --json` it is that ordinary usage error on
> its own entry, and the batch carries on.

The last sentence exists because the two modes genuinely differ after this
issue's fix, and a rule stated without it would be wrong in one of them: under
`--json` the entry is refused at exit 11 and the batch continues, and only in
human mode does `--follow` actually hold. Behaviour unchanged — help only.
`docs/cli.md` regenerated.

## Follow-up 2: three retrieval verbs under-described their ranking

SERVER-144 landed hours before this issue and changed what three CLI verbs rank,
without the help text following. Flagged by its implementer against
`search.ts`; on reading the change, the two **neighbour** surfaces were worse
off, so all three were corrected.

| verb | what the help now says |
| --- | --- |
| `corpus search` | `skill`, `agent-def` and `template` are ranked out by default — measured at 3 of 5 hits, top one included. **Naming any `--type` lifts it entirely**, so `--type skill` finds them. `view` and `board` are **kept**, because search asks _where is this said?_ and a board is a real answer. The accepted cost is stated: a user's own `template` documents need `--type template` |
| `corpus doc related` | five types are never neighbours — the three above plus `view` and `board`. **No flag widens it**: the route takes no type. A skill as the _subject_ still works |
| `corpus thread context` | the same five, with the reason (4 of 5 excerpt rows were the agent's own instructions quoted back to it) and the guard: a thread whose **parent** is a skill still gets that skill as its parent block |

Two constraints shaped where the prose went. The `--type` flag is
`DOC_FILTER_FLAGS`, shared with `corpus doc list` by one definition, so a
search-only fact may not go in it — `doc list` would then describe a default it
does not have. And CLI-056's rule means `--help=brief` renders only flag and
argument descriptions, never the command's. So the search-only behaviour lives
in `search`'s own description and in a new worked example
(`corpus search "…" --type skill`), which is where a reader looks for what
`--type` does to a ranking.

## Follow-up 3: one flaky test, measured rather than nudged

`workspace/maintenance.test.ts > stops git repacking the repository behind us
across a run of commits` timed out at 5000 ms in the orchestrator's full run and
passed 3 of 3 in isolation straight after. INFRA-020's third instance.

Measured before touching it, load average recorded per shape:

| shape | load | ms |
| --- | --- | --- |
| alone, `-t` filtered, 5 runs | 7.8–8.9 | 2056 · 2107 · 2304 · 2387 · 2480 |
| inside its own file, 8 runs | 7.3–16.3 | 1605 · 1878 · 2107 · 2184 · 2370 · 3158 · 3197 · 3278 |
| inside the whole `apps/cli` suite, 2 runs | 11–16 | 2901 · 3483 |
| inside a full run beside another agent's | — | **timed out at 5000** |

**The measurement says it is genuinely near its budget**, so the honest outcome
is a sized budget rather than no change. It costs **32–70% of vitest's 5 s
default**, median ~45%. INFRA-020's proposed rule is *>20% idle will flake under
the gate*, and the **cheapest run ever observed**, 1605 ms, is still over it.
Every load average above is 7 or higher, so no figure here is a true at-rest
one — which only strengthens the reading, since a minimum taken under load can
only over-state the at-rest cost, and that minimum already exceeds the rule.

**The spread is the diagnosis, and it is why the first three-run sample was not
enough.** The same shape ranges 1605–3278 ms at effectively the same reported
load — a 2× swing. The cost is 60 sequential `git commit`s, so it is dominated
by fsync and directory churn, which contend machine-wide and are invisible to a
CPU load average. Sampling three times caught only the bad end and would have
mis-stated the floor as 3.2 s. A budget has to cover the bad end of that spread
rather than its middle.

The work is real: a `git init`, **60 sequential real commits**, and a
`git fsck --full`. It gets `{ timeout: 20_000 }` with the table above written
beside it — ~9× the median and ~6× the worst run observed, which clears a
machine several times more contended than any seen here while still failing fast
if the commit loop stops progressing. **Not raised across the board**: every
other test in the file keeps the default, and none makes more than a handful of
commits. The same 20 s as SERVER-146's case, whose worst measured cost is the
same 3 s.

INFRA-020's second criterion — *make the work cheaper* — does not apply. The 60
is load-bearing: git 2.54's geometric-repack task was measured firing at the
41st commit through the product, so the count cannot fall far below that without
the test ceasing to prove the thing it names.

### Checks

- `vitest run apps/cli` — **105 files, 2,092 tests, all passed**, exit 0. Re-run
  after the three follow-ups: same, exit 0.
- `tsc --noEmit -p apps/cli` — exit 0.
- `eslint` on every touched file — exit 0, no rule disabled.
- `prettier --check` on every touched file and both issue files — clean.
- `npm run docs:cli -w apps/cli` — `docs/cli.md` regenerated. Byte identical for
  the fix itself; the four help edits are the only reason it moves.
- Scratch server stopped by pid, port 8801 verified free. 8765 never touched.

## AGENT-051's prohibition — recommendation

**Lift it, and replace it with a narrower rule about long-polling.**

AGENT-051's skill keeps the loop's claim out of every batch, and it was right
to: at the time, a batched claim returned nothing. That reason is now gone —
a batched `queue claim-all` carries what it carries alone, proven above against
a real server, in both arms, with the payload's contents asserted in a test that
fails when the loss returns.

Two things worth restating rather than deleting, because both survive this fix
and neither is about the payload:

1. **`queue idle` may not go in a batch, and never could.** It long-polls for
   about eight minutes. A batch runs its entries sequentially, so an `idle`
   entry holds every command after it for as long as it parks — exactly as it
   would hold a shell. `corpus batch`'s own help says this. The loop's parking
   step is therefore its own invocation, and that is a property of the verb, not
   a workaround.
2. **A claim in a batch is a claim.** A batch is not a transaction (CLI-064,
   decided by the user): if the claim succeeds and a later entry fails, the
   events stay claimed. That is the same exposure as running the two commands
   one after the other, so it is not an argument against batching — but a skill
   that batches a claim with the work that follows it should say what it does
   when the tail fails.

This is a recommendation to agent-runtime, not a change: `assets/workspace/` is
that domain's, and this issue touched nothing in it.

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
