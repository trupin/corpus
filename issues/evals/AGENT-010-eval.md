# Evaluation: AGENT-010

**Date**: 2026-08-02
**Sprint**: N/A (dogfood-todos-polish batch)
**Verdict**: PASS

## Environment

A workspace created from the shipped template: `corpus init /tmp/eval-dogfood-ws
--port 8891` → "installed 8 template files". Skill text read from the
**installed** copies under `/tmp/eval-dogfood-ws/.claude/skills/`, never from
`assets/workspace/`. Agent turn composed and posted through the CLI
(`corpus thread reply --from agent`), then rendered in the production UI served
by the real server.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                     |
| --------------------------------------- | ------ | ------------------------------------------------------------------------- |
| Verification log present                | PASS   | Nine numbered steps                                                       |
| Commands are specific and concrete      | PASS   | Real ids (`doc_wvi6rn7m`, `th_lhyufhvx`, `evt_vuzgr2ephocu`), real paths  |
| Real E2E (not mocked)                   | PASS   | Real `corpus init` + server + queue round trip; browser half deferred      |
| Scenarios cover acceptance criteria     | PASS   | All three                                                                  |
| Application restarted after changes     | PASS   | Fresh build + fresh workspace + server start/stop, ports verified free     |
| Actual model recorded (implemented on:) | PASS   | "Model: Opus 5 (1M context)"                                              |
| Reproduction logged before fix (bugs)   | N/A    | Not a bug                                                                  |

The log honestly declares its one gap ("Not verified in-browser: no Playwright
run"). That gap is what this evaluation closed.

## Criteria Results

| #   | Criterion                                                    | Result | Notes                                                                  |
| --- | ------------------------------------------------------------ | ------ | ---------------------------------------------------------------------- |
| 1   | comment + orchestrate SKILL.md carry the convention + example | PASS   | Present in the **installed** copies, with a worked ` ```prompt ` fence  |
| 2   | Wording leaves ordinary prose / code discussion alone         | PASS   | Explicit scope limit in the rule's own sentence                        |
| 3   | E2E: a real agent turn renders the labeled fence              | PASS   | Composed through the CLI, rendered as a copyable canvas in the real UI  |

### The convention, in a workspace `corpus init` just created

`/tmp/eval-dogfood-ws/.claude/skills/comment/SKILL.md`, line 302 (in **Reply**,
where the turn's contents are governed):

> **Anything the person will lift and reuse goes in a labeled fence.** A prompt
> you prepared for another agent, a command line to run, a config snippet, a
> message to send on: put it in a fenced block whose info string names what it
> is (`prompt`, `command`, `config`) — **one deliverable per fence**, with every
> word about it outside the fence. The board renders such a fence as a
> **copyable canvas**: the label is its title, and the copy button hands over
> the block's raw text, so the fence boundary is exactly what the person gets.
> This changes nothing else you write — prose stays prose, and code you are
> explaining rather than handing over is fenced however the explanation reads
> best.

The last sentence is criterion 2, stated in the rule itself. A worked example
follows at line 328 (` ```prompt ` with only the deliverable inside, framing
prose above, trace-line rule restated).

`/tmp/eval-dogfood-ws/.claude/skills/orchestrate/SKILL.md`, line 209, in
**Delegation**'s binding-rules list, deferring to the comment skill for the
statement rather than duplicating it. Both `updated:` stamps read
`2026-08-02T00:00:00Z`.

The installed files are what a user gets: both are recorded in
`.corpus/template-manifest.json` with sha256 digests.

### Raw markdown shape (through the CLI only)

`corpus thread create --parent doc_p2l2favt --quote "6.4%"` → `th_tzxroryx`,
anchored `anc_d3c24e47`; then `corpus thread reply th_tzxroryx --from agent`
with a turn written to the convention. Stored verbatim at
`data/threads/th_tzxroryx.md`:

```
## agent · 2026-08-03T01:02:10Z
Here is a prompt you can paste into a research agent. It names the figure and the document so the answer comes back checkable.

```prompt
Read [[doc_p2l2favt]] and say in three sentences whether the 6.4% rate
assumption still holds for the 2026 refinance.
```

I changed nothing in the corpus.
```

Info string preserved byte-for-byte through the write path; framing prose on
both sides, outside the fence.

### Rendered — the half the log left open

Thread opened in the production UI (`http://127.0.0.1:8891/`, real Chromium):

```
.fence-label   → "prompt"
.fence-canvas  → "Read [[doc_p2l2favt]] and say in three sentences whether the 6.4% rate⏎
                  assumption still holds for the 2026 refinance."
copy button    → aria-label "Copy the prompt block", class "fence-copy"
```

Clipboard first poisoned with `SENTINEL`, then the copy button clicked:

```
clipboard: "Read [[doc_p2l2favt]] and say in three sentences whether the 6.4% rate\nassumption still holds for the 2026 refinance."
button confirmation: "Copied"
prose outside the fence still present in the turn: true
```

The copy hands over **exactly** the fence's raw text — no label, no framing
prose, no trailing artefacts. The fence boundary is what the person gets, which
is the whole point of the convention.

## Failures

None.

## Summary

3 of 3 criteria passed. The convention reaches a real user workspace through
`corpus init`, an agent turn composed to it survives the write path byte-for-byte,
and the board renders it as a copyable canvas whose copy button lands on exactly
the deliverable. The one gap the implementer declared — no in-browser proof — is
now closed.
