# Evaluation: AGENT-009

**Date**: 2026-08-02
**Sprint**: sprint-022
**Verdict**: PASS
**Evaluator model**: Opus 5 (1M context)

Audited against the **installed** copy in a workspace created by `corpus init` at
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/eval-p9/ws/.claude/skills/`, never the repo
template. The evaluator then executed the skill's own opening instruction as the product agent
would (see "The loop", below).

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                    |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| Verification log present                | PASS   | `issues/agent-runtime/009-comment-skill-context-pack.md:50-282`                              |
| Commands are specific and concrete      | PASS   | `/usr/bin/grep` invocations with line numbers, before/after diff of the orchestrate paragraph |
| Real E2E (not mocked)                   | PASS   | Real `corpus init`, `diff` of installed vs template, then the named verb run live on a real anchored thread on a real server |
| Scenarios cover acceptance criteria     | PASS   | All five ACs have distinct evidence                                                          |
| Application restarted after changes     | PASS   | Fresh workspace + server on 8806, stopped, `lsof` showing 8806 free and 8765 never bound     |
| Actual model recorded (implemented on:) | PASS   | `implemented on: opus` (Opus 5, 1M context), 2026-08-01                                      |
| Reproduction logged before fix (bugs)   | N/A    | Prose amendment                                                                              |

## Criteria Results

| #   | Criterion                                                                | Result | Observed                                                                       |
| --- | ------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------- |
| 1   | Worked flow opens with the context verb; escalation stated; no default wholesale parent read | PASS | `## Gather context` opens with `corpus thread context th_4b8e2c` in a fence as the first instruction |
| 2   | Standalone path reads naturally with the related-only shape              | PASS   | `**Standalone** (\`parent: null\`, no anchor)` — "The pack prints no parent block at all, only the excerpts, because **the thread is the whole context**". Matches the live rendering exactly |
| 3   | Consistent with AGENT-008 (one retrieval doctrine, not two)              | PASS   | The pack is named an *instance* of "you retrieve; you never enumerate", not an exception; no contradicting read order survives |
| 4   | All five pack shapes carry a handling note                               | PASS   | Five bold labels at `:140,144,150,155,160` of the installed file                 |
| 5   | `orchestrate/SKILL.md`'s worked read path corrected to pack-first        | PASS   | `:470-474` now briefs with `corpus thread context` first and labels the `doc show` as an escalation |

## Evidence

### Byte fidelity of what `corpus init` actually installs

```
$ /usr/bin/diff ws/.claude/skills/comment/SKILL.md      assets/workspace/claude/skills/comment/SKILL.md
comment: IDENTICAL
$ /usr/bin/diff ws/.claude/skills/orchestrate/SKILL.md  assets/workspace/claude/skills/orchestrate/SKILL.md
orchestrate: IDENTICAL
```

### AC 1 — the literal opening of the installed skill

```
## Gather context

**Start from the briefing.** One command tells you what the conversation is about and what
else in the corpus bears on it:

    corpus thread context th_4b8e2c

That is the default context for every event that reaches this skill, and it is the first thing
you run.
```

Read order is then `corpus thread show` and stop: "**Those two reads are the whole default.**"
Escalation is a labelled section — `**Escalating past the pack** is a deliberate read of one named
document, never a sweep` — with four enumerated insufficiency cases (ask reaches past the pack;
about to rewrite a body; the pack says it truncated; the ranking was degraded), closed by "Nothing
else earns a full read — not a hunch, not background nobody asked for, and not the habit of opening
the parent because it is there."

The third case quotes the pack's truncation line **verbatim**, and I confirmed the real verb emits
exactly that string (CLI-021 eval): the skill's instruction and the tool's output agree character
for character.

### AC 5 — the orchestrate correction

```
:470  Inside the subagent, the comment skill briefs itself on the one thread that matters —
:471  `corpus thread context th_4b8e2c`, one bounded pack carrying the anchored passage with its
:472  enclosing section and whatever else bears on it, the second line never opened at all — reads
:473  the turns with `corpus thread show`, escalates to `corpus doc show doc_a1b2c3` because the
:474  edit below replaces the whole body, and does the work: …
```

### Every `corpus …` invocation resolves against `docs/cli.md`

Extracted every command-shaped `corpus <verb> [<sub>]` occurrence from both installed skills and
resolved each against a `docs/cli.md` heading:

```
ok  corpus doc archive/create/delete/edit/move/related/show/unarchive
ok  corpus job abandon/log/retry · corpus lock acquire/break/reap
ok  corpus queue claim-all/complete/defer/fail/halt/idle/reap-stale/resume/status
ok  corpus search            (## `corpus search`, docs/cli.md:205)
ok  corpus skill create/rollback
ok  corpus thread context    (### `corpus thread context`, docs/cli.md:1684)  ← the new one
ok  corpus thread reply/resolve/show
UNRESOLVED (all English prose, not invocations): "corpus bears on", "corpus of fifty", …
```

No dev-harness leakage: `grep -c "SPEC.md|CLAUDE.md|issues/|npm run|/implement"` → `0` in both files.

### The loop — the skill's opening instruction, executed

Acting as the product agent on a real `comment.created`, following the installed skill literally:

1. `corpus thread context th_wl7djw23` — **2,285 bytes**, carrying the anchored quote, the whole
   `## Watering` section (byte-identical to the file), and 10 ranked excerpts including a document
   sharing **zero** content words with the anchor and cited by nothing.
2. `corpus thread show th_wl7djw23` — **321 bytes**.
3. Stop. The pack was sufficient: the ask ("is this the right time of day for it?") is answerable
   from the quoted passage plus the `similar` excerpt on dawn misting, no truncation line was
   printed, and the ranking was not degraded — the skill's four insufficiency tests all read
   "no escalation".

**2,606 bytes read before any full-document escalation.** Reading the parent wholesale plus every
document the pack surfaced would have cost **66,494 bytes** (`corpus doc show` on all seven) — a
**25.5×** difference. The skill's own worked example is itself in the pack the verb returns.

## Failures

None.

## Summary

5 of 5 criteria passed, audited against the installed copy and then executed as the product agent
would. The skill's escalation criteria are testable against real tool output, and the one they
quote verbatim (the truncation line) matches the shipped verb exactly.
