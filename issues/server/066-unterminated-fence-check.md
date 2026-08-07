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

### Review-fix round — PR #26, findings A / B / C

_Fixed on: **opus**._ Real workspace `/tmp/corpus-066r` (`corpus init --port 8813`),
real server process, real HTTP, real CLI. Port 8765 untouched; server stopped and
8813 confirmed free at the end.

#### Finding A — a false `unterminated-fence` on valid CommonMark

**Reproduced first, against the shipped scanner, then against the real server.**
`unterminatedFence` run under `tsx` over the shipped `core/code.ts` (no test
harness):

```
list item                  {"marker":"```","start":13,"line":3}  ranges [{13,19}]
list item indented body    {"marker":"```","start":15,"line":3}  ranges [{15,29}]
ordered list               {"marker":"```","start":17,"line":3}  ranges [{17,24}]
blockquote                 null                                  ranges []
indented 4                 null                                  ranges []
```

The reviewer's fixture is one of a **class**, and the worst member is the shape
people actually write — marker and opening run on one line, body and closer
indented under it. And it is not only the error: `fencedCodeRanges` masked from
the *closer* to end-of-text, i.e. the wrong region, so `[[refs]]` and turn
headings after a bulleted snippet were invisible too.

Then through the product, with the container model disabled at its single seam so
the "before" is the running binary and not an argument about it:

```
POST /api/docs  {"title":"Bulleted fence","body":"Intro paragraph.\n\n- ```js\n  const x = 1;\n  ```\n\nAfter the list.\n"}
  -> 201 doc_h5gwarsy
$ corpus doc check          (container model off — the pre-fix scanner)
error unterminated-fence data/docs/inbox/bulleted-fence.md: … opened at line 18 …
corpus: 2 errors in 11 documents.
exit=6
$ corpus doc check          (fix live, same workspace, same bytes)
checked 11 documents — no findings.
exit=0
```

**How far containers are modelled, and where the line is drawn.** A fence's
**opening** line may sit behind a run of block-quote markers (`>`) and list-item
markers (`-`, `+`, `*`, `1.`, `1)`), and the fence records the block-quote depth
and the content column it opened behind. While that fence is open, each line has
exactly that many block-quote markers and up to that much indentation removed
before the closing rule is applied — and **nothing more**. In particular a *new*
list marker is never stripped from a line inside an open fence: inside a fence
there are no new containers, only continuations of the ones already entered, and
stripping one would let a line of code reading as a bulleted fence close the block
it belongs to (pinned by two tests: a bulleted and a quoted fence line inside a
margin-opened block are code, not closers).

The safety property that makes this cheap to reason about: **a text with no
container markers takes byte-for-byte the path it took before** — both widths are
zero and the regex is applied to the raw line, so every pre-existing case is
unchanged by construction.

What stays approximate, deliberately (full container parsing is a markdown
parser, which this module is not):

- **Containers never end.** A fence opened inside a list item stays open past the
  end of that item; CommonMark closes it at the item's boundary. The scanner errs
  toward "still inside code" — and errs *together*, because `fencedCodeRanges` and
  `unterminatedFence` are two readings of one scan, so the report always describes
  what `turns.ts` and `refs.ts` will really do with those bytes rather than
  contradicting them. That self-consistency is the invariant; CommonMark fidelity
  is the approximation.
- **Tabs are not expanded**; a container marker followed by a tab is not seen.
- **Setext underlines, link reference definitions and HTML blocks** are not
  modelled at all — none of them can contain or terminate a fence.
- A closer indented ≥4 spaces past its item's content column still fails to close
  (`FENCE_LINE`'s own rule, applied after the container prefix is removed).

#### Finding B — the fix now reaches the path the bug happens on

Fixed here, not deferred. `checkSave` returned `findings: report.warnings`, so a
non-blocking *error* was computed on every save and dropped: no response, no log.
It now returns the warnings **plus** the errors in a new `REPORTED_CHECK_CODES`
set, and `validateBeforeWrite` logs the two families apart —
`logger.error("document saved with validation errors", …)` and the existing
`logger.info(… warnings …)`.

**Log, not response — and the response half is a genuine contract question, not a
shortcut.** §14's wire warning family is a closed two-member set (the contract's
`CHECK_WARNING_CODES`; `check/codes.test.ts` asserts behaviourally that no code
appears on both sides of the severity partition, and `isSkillFrontmatterException`
already refuses to re-grade a finding for exactly this reason). Putting
`unterminated-fence` on a mutation response would need a third `WarningCode`,
which puts an **error**-severity §14 finding into the wire's *warning* channel —
a §14 semantics change, not a transcription. That belongs with the two SPEC-level
findings already going to the user, and SERVER-067's remaining scope is now
exactly that one question (the orchestrator should re-scope and re-rate it; this
round closed the silent half). `logger.error` was chosen over `logger.info`
deliberately: it is the one level the logger never gates, so a server run at
`--log-level silent` still says a thread's turns are being eaten as they are
written.

E2E on the exact path the user hit — the agent appends a turn:

```
POST /api/threads/th_rlnx5npg/turns  (x-corpus-author: agent)
     {"body":"Here is the snippet:\n\n```\nconst x = 1;```"}
  -> 201, warnings []
```

Before this round that produced nothing anywhere. Now, in `.corpus/server.log`:

```
{"level":"error","msg":"document saved with validation errors",
 "path":"data/threads/th_rlnx5npg.md",
 "errors":["unterminated-fence: unterminated fenced code block opened at line 19
   with a run of 3 backticks: … so everything after it reads as code — and every
   `## author · timestamp` turn heading after it is invisible, so those turns are lost"]}
```

The consequence still happens (the write is not blocked, per this issue's
severity decision) and is now announced as it happens:

```
POST … /turns  (x-corpus-author: user)  {"body":"Actually, no."}  -> 201
GET  /api/threads/th_rlnx5npg  -> turns: 2 ['user','agent']   # three were written
$ corpus doc check  -> error unterminated-fence data/threads/th_rlnx5npg.md …  exit=6
PUT  /api/docs/th_rlnx5npg  (closing fence moved onto its own line) -> 200
$ corpus doc check  -> checked 12 documents — no findings.  exit=0
GET  /api/threads/th_rlnx5npg  -> turns: 3 ['user','agent','user']
$ corpus db doctor  -> projection is clean — 12 documents from 12 files (2ms)  exit=0
```

**Does it generalise to `anchor-unused`? The mechanism does; the code is
deliberately excluded, and finding that out was the substantive discovery of this
round.** Wiring the log to "every error the save does not refuse" — the obvious
generalisation — made the server suite emit 8 log lines reading
`anchor-unused: anchor \`anc_…\` has no thread referencing it`, all of them false.
`anchor-unused` is a *cross-document* rule answered on the save path through the
projection, and during a multi-file mutation the projection is one write behind by
construction: `threads/create.ts:302` validates the parent document carrying the
**new** anchor entry immediately before writing the thread that claims it (and
`capture.ts:191-192` does the same). So the seam truthfully reports that nothing
claims it *yet* — on **every anchored comment**, the commonest write in the
product. Logging that would teach the reader to skip the very channel the fence
finding needs them to read, which is the same failure mode as finding A one level
up. So the reported set is explicit (`REPORTED_CHECK_CODES`, today
`unterminated-fence` alone: a property of the body's bytes and of nothing else),
a code in neither set is silent on the save path — the safe default — and
`corpus doc check`, which has no such blind spot, stays where a genuinely dangling
anchor is reported. Both directions are pinned in `write.test.ts`: the fence
reaches the log, and the exact parent text `threads/create.ts` produces does not.
Verified live: 1 validation-error line in the whole session, 0 mentioning
`anchor-unused`.

#### Finding C — stale count

`check/codes.test.ts:82` "two of the eleven error codes" → "twelve". Swept the
repo for the whole family (`eleven|twelve|thirteen|fourteen` across
`apps/server/src`, `packages/contract/src`, `apps/cli/src`): that comment was the
only stale one — the contract's prose, the generated client, `openapi.test.ts`,
`schemas/check.test.ts` and `check/routes.ts` all already read twelve/fourteen.

#### Checks

`vitest run apps/server packages/contract` — 221 files, **5269 tests, all pass**
(`VITEST_MAX_THREADS=4`), including the `turns.test.ts` 1-vs-2 pin and
`write.test.ts`'s not-refused case. New tests: 13 container shapes in
`core/code.test.ts` plus masking, non-closing and thematic-break guards; three
rule-level cases in `core/check.test.ts`; three log cases in `docs/write.test.ts`.
`tsc --noEmit` clean in `apps/server`; `eslint` and `prettier --check` clean on all
six touched files. `core/code.ts` is server-only (grep: no importer in
`apps/cli`, `apps/ui` or `packages`), so no consumer outside the scoped run is
affected.

### Review-fix round 2 — PR #26, MAJOR (tab-indented container bodies)

_Fixed on: **opus**._ Real workspace `/tmp/corpus-066r2` (`corpus init --port 8815`),
real server process, real HTTP, real CLI. Port 8765 untouched; server stopped and
8815 confirmed free at the end. `markdown-it` in commonmark mode was used as an
oracle throughout, so every claim about "what CommonMark does" below is a
rendering, not an opinion.

#### The regression, reproduced

The reviewer is right, and the fixture class is worse than the one round 1 fixed.
Round 1 measured the container prefix in **characters**; CommonMark measures
indentation in **columns**, where a tab advances to the next multiple of 4. A
fence opened behind a space-delimited marker was therefore seen, and a
tab-indented closer was not — `leadingSpaces` counted no allowance to strip and
`FENCE_LINE` rejects a leading tab.

Against the shipped `core/code.ts` under `tsx`, no test harness:

```
bullet + tab body        "- ```js\n\tcode\n\t```\n"     {"marker":"```","start":0,"line":1}  masks [0,19)
ordered + tab body       "1. ```js\n\tcode\n\t```\n"    {"marker":"```","start":0,"line":1}  masks [0,20)
nested bullet/quote      "  - > ```\n    > code\n    > ```\n"  {"marker":"```",...}         masks [0,31)
bullet + space (control) "- ```js\n  code\n  ```\n"     null
```

markdown-it closes all three. **On the pre-container scanner all three produced
no fence, no finding and no masking at all**, so the round-1 change converted
silent-and-harmless into loud-and-harmful.

Then through the product, with the fix backed out at its two seams (`expandTabs`
returning its argument, the sequential continuation walk restored) and the server
restarted, so the "before" is the running binary:

```
$ corpus doc check                     (shipped scanner, three tab/quote docs on disk)
error unterminated-fence data/docs/inbox/tab-ordered.md:  … opened at line 16 …
error unterminated-fence data/docs/inbox/tab-bullet.md:   … opened at line 16 …
error unterminated-fence data/docs/inbox/nested-quote.md: … opened at line 16 …
corpus: 3 errors in 12 documents.
exit=6
```

And the turn loss — this issue's own harm, now caused *by* its fix, on valid
CommonMark. Three turns written through the real API:

```
POST /api/threads/th_yl4nlbhf/turns (agent) {"body":"Try this:\n\n- ```js\n\tconst x = 1;\n\t```\n\nThat should do it."}  -> 201
POST /api/threads/th_yl4nlbhf/turns (user)  {"body":"Thanks, that worked."}                                              -> 201
GET  /api/threads/th_yl4nlbhf  -> turns: 2 ['user','agent']
last turn body: "Try this:\n\n- ```js\n\tconst x = 1;\n\t```\n\nThat should do it.\n\n## user · 2026-08-07T07:17:08Z\nThanks, that worked."
```

#### How tabs are handled

**Expanded once, at the top of the scan, and never again** — `expandTabs(line.text)`
is the first statement of the loop body, and every measurement below it (the
opener's `FENCE_LINE` test, `containerOpenPrefix`'s content-column arithmetic,
`containerContinuationWidth`'s allowance) then reads a line in which a character
offset *is* a column. The two readings cannot disagree about a tab because
neither ever sees one, which is the same argument that makes `fencedCodeRanges`
and `unterminatedFence` one scan rather than two. No caller does its own
expansion and no second constant exists; `TAB_STOP = 4` appears once.

This is what makes the within-line offsets safe: `scanFences` uses only
`line.start` and `line.contentEnd`, both taken from the *raw* line, and never an
offset derived from a match — so expansion cannot move a reported range by a byte.

It also deletes the old "a container marker followed by a tab is not seen"
caveat outright: `"-\t```js"` expands to `"-   ```js"`, giving a content column
of 4, which is exactly what CommonMark gives it.

#### Same round: the two MINORs

**Fixed — a quote marker indented past its own tolerance.**
`containerContinuationWidth` stripped block quotes *before* spending the
indentation allowance, so in `"  - > ```"` the continuation line `"    > code"`
carried four columns before its `>` and `BLOCKQUOTE_MARKER` (three spaces) matched
nothing. The walk now interleaves — spend the remaining allowance, then look for
the marker — mirroring the opener's walk, which had it right.

**Left approximate, and named: an ordered marker is a container wherever it
appears.** `"Some prose\n2. ```\nmore text\n"` has no list and no fence in
CommonMark (an ordered item may interrupt a paragraph only when it starts at 1),
and this scanner reads a container fence that never closes. Direction: **false
error**, narrow — it needs a non-1 ordered marker, immediately after a paragraph
line, opening a run that never closes.

It is left alone because **the obvious repair is wrong, and the oracle says so**:
`"1. a\n2. ```js\n   code\n   ```\n"` is a *sibling item* — markdown-it renders it
as a two-item list with a code block — because the "cannot interrupt a paragraph"
rule governs *starting* a list, not continuing one. Refusing the marker after a
non-blank line would make that item's closing fence read as a fresh opener, which
is finding A's failure returning through the front door, on a shape far commoner
than the one being fixed. Restricting the refusal by inspecting the previous line
does not rescue it either: `"# Heading\n2. ```js\n   code\n   ```\n"` is a genuine
list too. Telling these apart is paragraph tracking, i.e. a parser. Both the
divergence and this counterexample are now tests, so changing the policy is a
decision rather than an accident.

#### The docblock now names a direction for every entry

The reviewer's charge that the "what stays approximate" list read as exhaustive
and was not is accepted; it is rewritten to state the miss/false-error
distinction explicitly and to be true:

- **Containers never end** → **false error**. Newly stated, and it was previously
  spun as merely "errs toward still inside code". `"- ```js\n  code\n\nAfter.\n"`
  is a *closed* fence in CommonMark (the item's boundary closes it) and an
  unterminated one here. Pinned as a test.
- **A list marker is a container wherever it appears** → **false error**, narrow;
  above. New entry.
- **HTML blocks** → **false error** when a raw block holds an odd number of
  fence-looking lines. The old text claimed setext underlines, link reference
  definitions *and* HTML blocks "cannot contain or terminate a fence", which is
  false for HTML blocks; they are now a separate entry.
- **Setext underlines and link reference definitions** → genuinely cannot err in
  either direction; that claim is kept because it is true.
- **Tabs** → removed from the list; no longer approximate.

#### The container-free path is unchanged — how that was checked

Three ways, because it is the property the whole container model rests on.

1. **Structurally.** `expandTabs` returns its argument unchanged when the line
   holds no tab, and for a container-free line with tabs the outcome is provably
   the same: a tab anywhere in leading whitespace lands at column ≥ 4 from any
   starting column ≤ 3, so no tab can produce the ≤ 3-space indent `FENCE_LINE`
   requires — both the old and new code reject it. Expansion elsewhere in the line
   maps whitespace to whitespace, and the only two tests applied to `match[2]`
   are `.includes("`")` and `.trim() === ""`, both invariant under that.
2. **Over the repository.** The new scanner and a transcription of the
   pre-container scanner were run side by side over every markdown file in the
   tree — **520 tracked files, 519 byte-identical, 1 difference, container-bearing**:
   `issues/server/001-document-model-core.md` lines 238–243, a `>`-quoted fence
   that the old scanner did not see as a fence at all and the new one reads as a
   closed range. Both agree the file has no unterminated fence. That is the
   reviewer's "exactly one intended difference", reproduced. Only 2 files in the
   tree contain a tab at all, and both bear containers — which is precisely why
   this sweep alone would not have caught the regression, hence (3).
3. **Over the shape the repository does not have.** 5832 container-free
   three-line permutations built from 18 tab-bearing line shapes (tab at the
   margin, space-then-tab, tab inside an info string, tab-only lines, tab after a
   delimiter run, …), diffed against the same transcription: **0 divergences**.
   This one is now a permanent test — `describe("the container-free path is
   unchanged")` in `core/code.test.ts` carries the transcription and the
   permutation sweep, so a future change that quietly alters the container-free
   path fails there.

#### Tests

The regression tests are the point, and the previous round's covered
space-indented containers only. New in `core/code.test.ts`:

- `unterminatedFence with tab-indented containers` — 12 shapes that must close:
  tab bodies under `-`, `*`, `+`, `1.`, `1)`, tildes, space-then-tab, a marker
  itself followed by a tab (bullet, ordered, block quote), a tab body under a
  nested item, plus the quote-marker-indented-past-its-tolerance shape. Each
  fails on the shipped code. Plus: masking stays inside the item rather than
  running to end of body; a closer two tabs deep (8 columns, 6 past the content
  column) still does not close; a tab at the margin is still indented code.
- `unterminatedFence divergences that are accepted` — the two named false errors,
  plus the sibling-item counterexample that explains why the second is not
  repaired.
- `the container-free path is unchanged` — the differential above.

**Every "must close" fixture was verified against markdown-it, not by eye, and
two of my own drafts were wrong**: `"- ```js\n\t\tcode\n\t\t```\n"` and the same
under a nested item do *not* close in CommonMark (two tabs is 8 columns, ≥ 4 past
the content column, so the closer is swallowed into the block as indented code).
They were moved out of the closing list and one became the "four or more columns
past" assertion.

#### Checks

`vitest run apps/server packages/contract` — 221 files, **5288 tests, all pass**
(`VITEST_MAX_THREADS=4`); 5269 → 5288 is the 19 new cases. `tsc --noEmit` clean in
`apps/server`. `eslint` and `prettier --check` clean on both touched files
(`core/code.ts`, `core/code.test.ts`). `core/code.ts` remains server-only, so no
consumer outside the scoped run is affected. `corpus db doctor` clean over the
E2E workspace (14 documents from 14 files), and every mutation auto-committed
with the acting party as git author.

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
