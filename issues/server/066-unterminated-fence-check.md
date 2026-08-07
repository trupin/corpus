# [SERVER-066] Report an unterminated fenced code block in `corpus doc check`

## Domain

server

## Status

done

## Priority

P1 (important)

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: AGENT-016 (fixes the producer — a skill rule that stops the agent writing the bad shape in the first place). This issue is the other half: making the failure *visible* when it happens anyway.

## Spec References

- SPEC.md Section 14 — "Validation, drift checks, and hooks"
- SPEC.md Section 6 — "Threads" (the `## <author> · <ts>` turn format)
- SPEC.md Section 5 — "Documents" (`[[refs]]`)

## Summary

A user reported losing their own reply in a thread. Root cause, confirmed: an
agent wrote a snippet whose closing fence sat on the same line as the content
(`` some code``` ``) rather than alone on its own line. CommonMark closes a fence
only on a line containing nothing but the delimiter run, so the fence never
closed and ran to the end of the body.

`apps/server/src/core/turns.ts` deliberately excludes fenced regions when
locating turn delimiters, so a snippet can quote a `## user · <ts>` heading
without faking a turn. That exclusion is correct and must not change — but it
means an unterminated fence makes every subsequent turn heading invisible.
Measured against the real `parseTurns`: the reported shape parses as **1** turn
where the corrected shape gives **2**, with the person's entire reply swallowed
into the agent's turn body. Nothing anywhere reported an error.

This issue makes §14's validator report it: a new `unterminated-fence` finding
naming the line the fence *opened* on, surfaced by `corpus doc check` and
`POST /api/check`.

## Acceptance Criteria

- [x] `corpus doc check` / `POST /api/check` reports an unterminated fenced block
      in a document body, at **error** severity.
- [x] The finding names the **line the fence opened on** (a file line, counting
      the frontmatter), and the delimiter run it opened with.
- [x] The detection is part of the **general** document check, not a
      thread-specific rule; the `detail` names the turn-swallowing consequence
      when the document is a thread.
- [x] It **does not block a write**: no mutation is refused because of it.
- [x] The fence grammar is not re-implemented — the check asks `core/code.ts`,
      the same module `fencedCodeRanges` (and therefore `turns.ts` and
      `refs.ts`) already asks.
- [x] No auto-repair anywhere; `parseTurns` is unchanged.
- [x] The contract's `CHECK_CODES` transcription carries the new code and the
      drift guard (`apps/server/src/check/codes.test.ts`) still passes.

## Technical Design

### Files to Create/Modify

- `apps/server/src/core/code.ts` — extract the fence scanner so it can answer a
  second question; add `unterminatedFence(text): OpenFence | null`.
- `apps/server/src/core/code.test.ts` — tests for the new question.
- `apps/server/src/core/document.ts` — `bodyStartLine(parsed)`: the 1-based file
  line number of the body's first line, so a body offset can be reported as a
  file line.
- `apps/server/src/core/check.ts` — the `unterminated-fence` code and rule.
- `apps/server/src/core/check.test.ts` — the rule's tests.
- `packages/contract/src/schemas/check.ts` — transcribe the new code (see
  "Contract note" below).
- `packages/contract/src/schemas/check.test.ts`,
  `packages/contract/src/openapi.test.ts`,
  `apps/server/src/check/codes.test.ts` — the counts these pin (13 → 14).
- `packages/contract/openapi.json`, `packages/contract/src/client/schema.generated.ts`
  — regenerated.

### Key Implementation Details

**One code, not two.** An unterminated fence is one defect with one fix (close
the fence). Its *consequences* differ by document type — a thread loses turns, an
ordinary document merely renders the rest as code (and loses every `[[ref]]` and
heading after it, since `refs.ts` and the chunker mask code the same way) — but
the action a person takes is identical. Splitting it would also force the
severity to vary with document type, which the contract cannot express: the
warning/error partition there is **by code**, and `codes.test.ts` asserts a code
never appears on both sides. So: one code, and the `detail` string names the
thread consequence when the document is a thread.

**Severity: error.** §14's warning family is the two states it carves out
explicitly — an anchor that no longer resolves, and a `[[ref]]` whose target does
not exist yet. Both are *normal outcomes of using the system as designed*, which
is why punishing them would be wrong. An unterminated fence is never that; it is
a mistake in the bytes, and in a thread it silently destroys content. Failing the
check is exactly what a check's verdict is for.

**It does not block a write**, and that is deliberate rather than an oversight:

1. The rule is decidable from one file, so it would otherwise belong in
   `LOCAL_CHECK_CODES`. But every existing member of that set describes a
   document the system *cannot index* — a save is refused because letting it
   through would break the projection. A document with an unterminated fence
   projects fine.
2. The trap: blocking is evaluated over the **whole body about to be written**,
   so once a bad turn is on disk (written before this check existed, or
   out-of-band, or by an external editor), every subsequent write to that thread
   would be refused — including the user's reply, and including the agent's own
   attempt to fix it via `corpus thread reply`. A blocking rule a pre-existing
   document can trip makes that document unwritable, which is strictly worse than
   the silent swallow it was meant to prevent.
3. Refusing an agent's turn mid-loop converts a cosmetic mistake into a stalled
   loop. AGENT-016 is the right place to stop the bad shape being produced;
   §14's job here is to make it findable afterwards.

So the code stays out of `LOCAL_CHECK_CODES` — the same shape `anchor-unused`
already has: an error that `corpus doc check` fails on and no save is refused
for.

**Precision.** `fencedCodeRanges` already models an unterminated fence (it runs
the range to end-of-text) but does not say *where it opened*. Rather than a
second scanner, the loop is extracted into `scanFences`, which returns both the
closed ranges and the still-open fence; `fencedCodeRanges` and
`unterminatedFence` are two readings of the one result. That keeps the module's
standing promise — one place that knows what "inside code" means — literally
true.

The reported line is a **file** line: `bodyStartLine(parsed)` counts the BOM,
opening fence, frontmatter and closing fence, so `line` is what an editor's
gutter shows. A body-relative number would make the operator do arithmetic to
find the thing they are being asked to fix, which defeats the point.

### Contract note (cross-domain)

`CHECK_CODES` exists twice by design: `apps/server/src/core/check.ts` is the
implementation and `packages/contract/src/schemas/check.ts` is a *transcription*
of it (the dependency direction forbids the contract importing the validator),
with `apps/server/src/check/codes.test.ts` as the drift guard that makes the copy
load-bearing. A new code therefore cannot land on the server alone without
failing that guard and the contract's own count assertions. The contract edit
here is exactly that transcription — one enum member, its doc text, the pinned
counts, and the regenerated `openapi.json` + typed client. No schema shape, no
route, no request/response field changes. Flagged for the orchestrator to route
past contract-dev.

### Edge Cases

- A closing fence **wider** than the opener still closes (CommonMark; AGENT-012's
  widening means openers vary) — not reported.
- A closing fence indented up to 3 spaces still closes; 4 spaces does not.
- A line that merely *starts with* backticks mid-content does not close, and one
  where the backticks are not at the line start does not either — the reported
  shape.
- Tilde fences (`~~~`) obey the same rule and are reported with their own run.
- An opening backtick fence whose info string contains a backtick is not a fence
  at all (CommonMark), so it opens nothing and is not reported.
- A document whose frontmatter fails validation still gets the fence finding —
  the two are independent, and the fence check runs before the validation
  `continue` so one bad field does not hide it.
- A file that does not parse at all reports `frontmatter-unparseable` and nothing
  else; there is no body to scan.

## Testing Strategy

Unit tests, colocated:

- `core/code.test.ts` — `unterminatedFence` over: the reported shape; a correctly
  closed fence; a wider closing run; an indented (≤3 spaces) closing fence; a
  4-space-indented one (does not close); a mid-content backtick line; tildes; an
  info string containing a backtick; and agreement with `fencedCodeRanges` (the
  open fence's start is the start of the last range, which ends at text length).
- `core/check.test.ts` — the finding's code, severity, and line number; a thread
  vs. a non-thread `detail`; a closed fence producing nothing; that a document
  with invalid frontmatter still reports it.
- `core/turns.test.ts` — pin the measured 1-vs-2 turn behaviour so the bug this
  issue exists for is a fixture, and so a future change to `parseTurns`
  tolerance shows up as a failing test rather than as a silent policy change.
- `docs/write.test.ts` (or equivalent) — a save whose body carries an
  unterminated fence **succeeds**; the write is not refused.
- `check/codes.test.ts` — the drift guard, count 14.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. `corpus init` a scratch workspace and start the real server.
2. Create a document, comment on it to open a thread.
3. Post an agent turn whose body carries the reported shape (fence opened, closed
   on the same line as the content), then post a user reply.
4. `GET /api/threads/{id}` — expected 2 turns; actual 1, with the user's reply
   inside the agent's turn body.
5. `corpus doc check` — expected some report of the problem; actual: clean.

### Verification Steps

1. Restart the server with the fix.
2. Re-run the same sequence; `corpus doc check` now exits 6 naming the file, the
   line the fence opened on, and the turn-swallowing consequence.
3. Close the fence properly through the API; `corpus doc check` goes clean and
   the thread reports 2 turns.
4. Confirm the write path is unaffected: the save in step 2 was accepted (`200`),
   and a `PUT` of an ordinary document with an unterminated fence also succeeds.

## E2E Verification Log

_Implemented on: **opus**._

Real workspace at `/tmp/corpus-066` (`corpus init --port 8811`), real server
process started with `corpus server start`, real HTTP over `127.0.0.1:8811`,
real CLI. Port 8765 was never touched. The reproduction below was run against a
server whose `checkUnterminatedFence` call was temporarily removed, so the
"before" is the actual pre-fix binary and not an argument about it.

### Reproduction (bugs only)

`corpus init` + `corpus server start` (pid 87013), then, through the API:

```
POST /api/docs   {"type":"note","title":"Fence demo","body":"Alpha paragraph.\n"}
  -> doc_hsmn4ycf
POST /api/threads {"parent":"doc_hsmn4ycf","selector":{"exact":"Alpha paragraph."},"body":"Real one."}
  -> th_vxdom7q6
POST /api/threads/th_vxdom7q6/turns  (x-corpus-author: agent)
     {"body":"Here is the snippet:\n\n```\nconst x = 1;```"}
  -> 201, warnings []
POST /api/threads/th_vxdom7q6/turns  (x-corpus-author: user)
     {"body":"Actually, no."}
  -> 201, warnings []
```

The thread reads back with the reply gone:

```
GET /api/threads/th_vxdom7q6
turn count: 2
authors: ['user', 'agent']
--- last turn body ---
Here is the snippet:

```
const x = 1;```

## user · 2026-08-07T01:08:20Z
Actually, no.
```

Three turns were written; two exist, and the person's reply is *inside* the
agent's turn body. Both writes were accepted with no warning.

And the validator said nothing:

```
POST /api/check {"ids":["th_vxdom7q6"]} -> {"ok":true,"errors":[],"warnings":[]}
$ corpus doc check
checked 14 documents — no findings.
exit=0
```

Independently confirmed against the real `parseTurns` outside any test harness
(`tsx`): the reported shape yields `1` turn `["agent"]`, the corrected shape
yields `2` turns `["agent","user"]` — the brief's numbers are right, and the
same 1-vs-2 measurement is now pinned in `core/turns.test.ts`.

### Post-Implementation Verification

Rule re-enabled, server restarted (pid 87697, later 88691) against the *same*
workspace — no rebuild of the corpus, no re-creation of the documents:

```
POST /api/check {"ids":["th_vxdom7q6"]}
ok: false
{
 "code": "unterminated-fence",
 "severity": "error",
 "docId": "th_vxdom7q6",
 "path": "data/threads/th_vxdom7q6.md",
 "detail": "unterminated fenced code block opened at line 19 with a run of 3 backticks:
            it closes only on a line holding nothing but 3 or more backticks, so everything
            after it reads as code — and every `## author · timestamp` turn heading after it
            is invisible, so those turns are lost"
}
warnings: []
```

Line 19 checked by hand against the file — line 19 is ```` ``` ```` and line 20
is `const x = 1;``` `, i.e. exactly the fence that never closed:

```
17 'Here is the snippet:'
18 ''
19 '```'
20 'const x = 1;```'
```

The CLI's verdict:

```
$ corpus doc check
error unterminated-fence data/threads/th_vxdom7q6.md: unterminated fenced code block
  opened at line 19 with a run of 3 backticks: it closes only on a line holding nothing
  but 3 or more backticks, so everything after it reads as code — and every
  `## author · timestamp` turn heading after it is invisible, so those turns are lost
corpus: 1 error in 14 documents.
  Fix the findings above; warnings alone would not have failed the check.
exit=6
```

(The first run of this rendered the marker as `` `\`\`\`` `` — a backtick run quoted
in backticks, which is the very ambiguity being reported. The `detail` now
describes the run by count instead, and a test asserts it contains no backtick
run at all.)

**Writes are not blocked** — the severity decision, verified against the real
write path rather than argued:

```
POST /api/threads/th_vxdom7q6/turns {"body":"still writable"}          -> 201
PUT  /api/docs/doc_hsmn4ycf {"body":"Alpha paragraph.\n\n```\nunclosed…"} -> 200, warnings []
```

The ordinary document is reported too, and its detail does **not** claim turns
were lost:

```
POST /api/check {"ids":["doc_hsmn4ycf","th_vxdom7q6"]}
 - data/docs/inbox/fence-demo.md | unterminated fenced code block opened at line 48
   with a run of 3 backticks: … so everything after it reads as code
 - data/threads/th_vxdom7q6.md   | … reads as code — and every `## author · timestamp`
   turn heading after it is invisible, so those turns are lost
```

Line 48 verified by hand in that file (frontmatter runs to line 45 because the
document carries an anchor entry; the fence is at 48).

CommonMark edge cases, each a real `PUT` followed by a real `POST /api/check`:

```
wider close (AGENT-012 widening)   PUT 200  ok=true
close indented 3 spaces            PUT 200  ok=true
close indented 4 spaces            PUT 200  ok=false  → reported at line 52
tilde fence left open              PUT 200  ok=false  → "a run of 4 tildes", line 48
```

Closing both fences through the API clears everything and restores the turns:

```
PUT /api/docs/th_vxdom7q6  (fence moved onto its own line)  -> 200
PUT /api/docs/doc_hsmn4ycf (fence closed)                   -> 200
POST /api/check -> {"ok": true, "errors": [], "warnings": []}
GET  /api/threads/th_vxdom7q6 -> turns: 4 ['user','agent','user','user']
$ corpus doc check   → checked 14 documents — no findings.   exit=0
$ corpus db doctor   → projection is clean — 14 documents from 14 files (2ms)  exit=0
```

Every mutation auto-committed with the acting party as author, as §4 requires:

```
fe28c1d doc edit: Fence demo (doc_hsmn4ycf) by user
edcebae doc edit: Re: "Alpha paragraph." (th_vxdom7q6) by user
771dbc9 comment: turn on th_vxdom7q6 by user
bc2708d comment: turn on th_vxdom7q6 by agent
last commit author: user <user@corpus.local>
```

Server stopped, port 8811 confirmed free (`lsof -nP -iTCP:8811 -sTCP:LISTEN` →
no rows).

**Checks:** `vitest run apps/server` — 169 files, 3380 tests, all pass.
`vitest run packages/contract` — 52 files, 1864 tests, all pass. CLI's
`doc/check.test.ts` + `staged.test.ts` — 31 tests, pass. `npm run typecheck`
clean across all 7 workspaces + scripts. `eslint` and `prettier --check` clean on
every touched file.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier on touched files, typecheck)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
