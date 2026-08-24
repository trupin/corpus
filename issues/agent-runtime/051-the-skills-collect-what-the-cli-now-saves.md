# [AGENT-051] The skills collect what the CLI now saves

## Domain
agent-runtime

## Status
done

## Priority
P1 (important)

## Model
opus

## Dependencies
- Depends on: CLI-064, CLI-065
- Blocks: —

## Summary

**Filed by the orchestrator, 2026-08-23, on CLI-065's own report**, which said
it plainly: _"the orchestrate skill's reflection text should add `--fields
id,title,lastActor,updated` to its `doc list --json` command — CLI-065's saving
is unrealized until it does."_

Two savings shipped in v0.21.0 and **neither is collected by anything**:

| shipped | measured | collected today |
| --- | --- | --- |
| `doc list --fields` (CLI-065) | 203.1 → 36.7 tokens a row, **82%** | no — reflection still asks for whole rows |
| `corpus batch` (CLI-064) | 1265.5 → 353.9 ms an event, **3.58×** | no — no skill invokes it |

This is the third time in three releases that a saving shipped with nothing
asking for it. AGENT-045 was the first (`--help=brief`), UI-164 the second (a
refusal channel nothing read). **The rule is now established: a capability the
product does not use is not shipped, it is available.**

## Acceptance Criteria

- [x] The reflection listing asks for the fields it uses and no others. Which
      fields those are is read off the skill's own text, not guessed — if the
      skill reads a field the projection drops, the saving is a bug.
- [x] `corpus batch` is used where a skill makes a run of calls whose inputs do
      not depend on each other's outputs. The comment skill's write tail is the
      measured case: seven calls, 911.7 ms.
- [x] **A batch is not used where one command's input is another's output.**
      CLI-064 does not thread results between entries, and a skill that assumed
      it would fail in a way the report makes look like success.
- [x] The skill states that a batch is **not transactional**, or does not raise
      the question. §4's commit window may fold a batch's writes into one commit
      anyway, and a skill that saw that and inferred atomicity would be relying
      on timing.
- [x] The saving is **measured on the shipping skills**, before and after, in
      tokens for CLI-065 and in milliseconds for CLI-064 — the standard AGENT-045
      and SHARED-070 set for this domain.
- [x] No behavioural rule changes. This is a change to how the skill calls the
      tool, not to what it does.

## Technical Design

### Files to Create/Modify
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the reflection listing
- `assets/workspace/claude/skills/comment/SKILL.md` and its `references/` — the
  write tail
- `scripts/workspace-template.test.ts` — pins

### Key Implementation Details

**The comment skill was restructured hours ago** (AGENT-047) into a core file
plus seven references. Read the current text rather than any transcript: the
call sequence a batch would replace may now sit in a reference rather than the
body, and a batch instruction belongs where the calls are.

**A batch entry's `--from` matters.** CLI-064 resolves the actor per entry, and
an entry's own `--from` wins over the batch's. The skills pass `--from agent`,
so state it once on the batch rather than on every entry.

**`spawnSync({input})` cannot drive `corpus batch`** — that is CLI-066's socket
refusal, working as designed. A harness feeds a file descriptor, as a heredoc
does. Say so where the skill shows the invocation, or someone wrapping the skill
will hit it.

### Edge Cases
- A batch whose entries are all reads: safe, and the largest win.
- A batch where one entry fails: the skill must read the per-command report
  rather than the exit code alone, since exit 11 says only "something failed".
- A skill that already has one call: a batch of one is legal and pointless.

## Testing Strategy

Template tests pinning that the reflection listing carries `--fields`, that the
batch instruction names the non-transactional rule, and that no batch example
threads one entry's output into another's input.

## E2E Verification Plan

### Verification Steps
1. `corpus init` a scratch workspace from the built template
2. Run a real event through the comment skill and capture every invocation
3. Compare the token and millisecond totals against the same event before

## E2E Verification Log

### Post-Implementation Verification

**Model: Opus 5, 1M context (`claude-opus-5[1m]`).** Date 2026-08-23.

Two workspaces under the session scratchpad, both on their own ports — the
user's server on 8765 was never touched. `ws051` on **8803** for the
measurements, and `ws051b` on **8807** initialized from the built package after
the edits, so every claim below about the shipped skills is a claim about the
files `corpus init` installs. `npm run build` and `npm run package:build` were
run first: the timing arms use `dist-package/dist/corpus.js`, which is the
binary CLI-064 measured on.

#### 1 — The field list, read off the skill's own text

`--fields` is not a guess and is not CLI-065's example. The nine names are the
ones the reflection section's own sentences read, each keyed to the sentence
that reads it, and the test asserts that keying rather than the list:

| field | the sentence that reads it |
| --- | --- |
| `id` | "`corpus doc show <id>` is the deliberate second act" |
| `type`, `title`, `tags`, `stage`, `status`, `excerpt` | "The row carries the title, the type, the folder (its `path`), the tags, the stage, the status and an excerpt" |
| `path` | the same sentence — the row's field for the folder is `path`, and the prose now says so |
| `lastActor` | "`lastActor` on every row is what tells the two apart" |

`updated` is **not** in the list, though CLI-065's own example carries it:
nothing in the section reads it, the window is already bounded by `--since`,
and the default sort is `-updated`. It costs 16.0 tok/row, measured.

#### 2 — Tokens, before and after, on CLI-065's own 20-document corpus

Counted with `gpt-tokenizer` over the real command's real stdout, reusing
CLI-065's workspace so the baseline is comparable (`scratchpad/e2e/a051-final.js`):

```
before — reflection window read, whole --json row : 4072 tok / 20 rows -> 203.6 tok/row
after  — --fields id,type,title,path,status,stage,tags,excerpt,lastActor
                                                  : 1192 tok / 20 rows ->  59.6 tok/row

saving: 144.0 tok/row, 70.7% off, 3.42x leaner
a 500-document window: 101,800 -> 29,800 tokens
```

203.6 reproduces CLI-065's 203.1 on the same corpus. It is **not** their 36.7:
that figure is four fields, and this skill reads nine. The excerpt alone is
10.8 tok/row and the section says it is "the whole story" for most changes, so
dropping it to reach 36.7 would have been a behaviour change bought with a
number.

Falsification of the "no field is dropped" half, against the real CLI: every
one of the nine is present in a projected row, and a misspelled name is a usage
error listing the known ones **before any request is sent**.

```
$ corpus doc list --limit 1 --json --fields id,type,title,path,status,stage,tags,excerpt,lastActor
row 1 keys: ['id','type','title','path','status','stage','tags','excerpt','lastActor']   missing: []
$ corpus doc list --json --fields nosuch
{"error":{"code":"usage_error","message":"--fields names 1 field no row carries: nosuch.", …}}
```

Under `--json` the human tally line is gone, so the section now names the
`page` envelope instead. Run verbatim in the fresh workspace:
`page: {'total': 5, 'limit': 50, 'offset': 0}`.

#### 3 — Milliseconds, before and after, on the comment skill's worked event

Both arms are the same seven commands of worked example 1 — `thread context`,
`thread show`, `job log`, `doc show`, `doc patch`, `job log`, `thread reply` —
every write real, the patch alternating direction so the corpus is net
unchanged. 15 interleaved iterations per arm, same packaged binary both arms,
minima reported. The arms are bash scripts because `spawnSync({input})` gives
the child a **socket** and the CLI refuses one (see 5): a heredoc is a real
transport.

```
load avg 5.7 before, 5.4 after
separate (7 invocations)   min 2877.3   med 3402.7 ms
batched  (3 invocations)   min 1925.2   med 2277.6 ms
saving                     min  952.1 ms (1.49x)   med 1125.0 ms (1.49x)
```

A second run on the unbundled `apps/cli/dist` build at load 8.2: 3976.2 →
2408.9, saving 1567.3 ms (1.65×). Raw per-iteration timings in
`scratchpad/a051/`.

**Three invocations rather than one, deliberately.** CLI-064 measured all seven
as a single batch and reported 911.7 ms (3.58×), but that array held `doc show`
and the `doc patch` quoting it — and its own first run failed with
`patch_no_match` for exactly that reason. The shipped decomposition is the one
the dependency rule permits: a read batch, the escalation read alone, a write
batch. It removes 4 of the 7 process starts, and the absolute saving is the
same order as CLI-064's because a process start costs ~238 ms at this load.

#### 4 — Every shipped batch payload, executed rather than reviewed

A harness extracts every `corpus batch … <<'CORPUS_EOF' … CORPUS_EOF` block
from the **installed** skill files in `ws051b/.claude/skills/`, remaps its
example ids onto real documents, and runs it through a shell heredoc:

```
orchestrate/SKILL.md   #0  3 entries [doc patch, job log, thread reply]              exit=0
orchestrate/SKILL.md   #1  3 entries [doc related, search, search]                   exit=0
comment/SKILL.md       #2  2 entries [thread context, thread show]                   exit=0
comment/SKILL.md       #3  3 entries [doc patch, job log, thread reply]              exit=0
worked-examples.md     #4  3 entries [thread context, thread show, job log]          exit=0
worked-examples.md     #5  3 entries [doc patch, job log, thread reply]              exit=0
worked-examples.md     #6  2 entries [job log, thread reply]                         exit=0
worked-examples.md     #7  4 entries [doc move, doc edit, job log, thread reply]     exit=0
worked-examples.md     #8  4 entries [doc move, doc edit, job log, thread reply]     exit=0

9 shipped batch payloads run for real, 0 non-zero exits.
```

The trace line survives the JSON `\n`: the posted turn reads
`↳ updated the rate assumption in [[doc_wvkvnl7n]]` on its own final line.

#### 5 — Every factual claim the new section makes, checked against the real binary

Two were wrong when first written and were corrected against the CLI, not
against the docs.

| claim | measured |
| --- | --- |
| entry carrying `--json` | exit **2**, "names --json, which belongs to the batch invocation … Nothing was run." |
| empty array | exit **2**, "the batch is empty" |
| 201 commands | exit **2**, "at most 200 commands can run in one batch, and 201 were given." |
| one entry fails, the rest run | exit **11**, `details.failed:[1]`, `notRun:[]` |
| **a pipe is refused** | **wrong** — `echo '[…]' \| corpus batch` runs. Corrected: a heredoc and a pipe are the two transports read |
| a socket is refused | exit **2**, "stdin is a socket, and a socket is never read — no command list was taken" |
| `corpus queue idle` in a batch | **accepted and it holds.** Nothing refuses it, so the prohibition is a rule the skill states, not a mechanism |
| several writes land in one commit | **yes** — a 3-write batch moved the workspace from 116 commits to 117, one commit touching both files. This is why the skill denies atomicity in as many words |

**A gap found, and reported rather than worked around:** `corpus queue claim-all`
inside `corpus batch --json` returns `"value": null` — the claim payload is lost
from the JSON channel, silently, while `queue status` and `doc show` in the same
array carry theirs. In human mode it prints normally. The loop's claim is
therefore kept out of any batch and the section says why.

#### 6 — The hazard the skill names, reproduced

A refused patch beside a reply, in one array. The report says the patch failed
at position 1 — and the reply posted anyway, claiming a change that is not in
the document:

```
$ corpus batch --from agent   # patch --old quotes text that is not in the body
corpus: 1 of 3 commands failed; every command ran.
  { "failed": [ 1 ], "notRun": [] }
$ corpus thread show th_xq3n5yf4 | tail -2
agent · 2026-08-24T02:06:20Z
Updated the assumption in [[doc_wvkvnl7n]].
$ corpus doc show doc_wvkvnl7n | tail -2
The working rate assumption is 6.1% as of 2026-05-02, and every projection in
this document uses it.
```

That is the whole reason the comment skill's rule is *read what the report says
each entry did before you take your own turn at its word*.

#### 7 — No behavioural rule changes, and how that was checked

Three ways, none of them "I read it back".

- **The field list is derived, not asserted.** The pin walks the section's own
  sentences and fails if the projection omits a field one of them reads. A rule
  change that made the agent read something new fails the test until the
  projection carries it.
- **The single-owner registry.** The batch rule is registered to `orchestrate`
  with a detector over the mechanism's vocabulary: 6 sentences in the owner, 0
  in each of the other three skills, and `comment` carries a pointer instead.
  No second account of the constraints can ship.
- **The one rule the mechanism could have quietly changed was found and
  refused.** A batch entry is not on a command line, so somebody's words need
  no heredoc inside one — which would have deleted a site the AGENT-035 pin
  counts. Worked example 2 keeps its heredoc title as its own command and saves
  one invocation instead of two, and the "a run never shortens a reply" rule
  says the same thing for a reply body that is awkward as a JSON string.

#### Checks

`scripts/` suite: **986 passed (18 files)**, including 11 new pins.
`eslint` clean on the touched file. `prettier --check` clean on all four.
`comment/SKILL.md` is 6,990 words against the 7,000 the AGENT-047 budget pins.

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
