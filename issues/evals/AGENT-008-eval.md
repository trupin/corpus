# Evaluation: AGENT-008

**Date**: 2026-07-31
**Sprint**: sprint-019 (Phase 7, Retrieval A)
**Evaluator model**: Opus 5 (1M context)
**Verdict**: PASS

Method: `corpus init` a **fresh** workspace at
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/eval-p7/agentws` (explicit path, `--port 8812`, no
server started), then read the **installed** copies at
`agentws/.claude/skills/{orchestrate,comment}/SKILL.md` as a skeptical user — never `assets/`.
Installed sizes: orchestrate 30 493 bytes / 505 lines, comment 27 158 bytes / 491 lines. Both
byte-identical to the template (`cmp -s`), so the installed text is the shipped text.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                          |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Verification log present                | PASS   | `issues/agent-runtime/008-retrieval-first-skills.md:49+` — per-site change tables for both files, an explicit "untouched" inventory, the install drill, the grep audit |
| Commands are specific and concrete      | PASS   | Every edit site given by line number with before/after wording; the install drill pastes `pwd`, the `corpus init` output, and `grep -n` line hits read back from the installed copy |
| Real E2E (not mocked)                   | PASS   | A real `corpus init` into a scratch workspace outside the repo, read back from the **installed** file, plus `diff -q` against `assets/`. The drill was **re-run against the final bytes** after the last rewrap — that detail is what makes the byte-identity claim mean anything |
| Scenarios cover acceptance criteria     | PASS   | TEST-712…721 each addressed                                                                                                                                    |
| Application restarted after changes     | N/A    | Install-and-read-back drill; no server started, and the log says so                                                                                            |
| Actual model recorded (implemented on:) | PASS   | "**Implemented on: opus** (Opus 5, 2026-07-31…)"                                                                                                                |
| Reproduction logged before fix (bugs)   | N/A    | Not a bug                                                                                                                                                      |
| Testing strategy corrected (TEST-719)   | PASS   | The log states both findings — `.prettierignore` excludes `assets/workspace/` so `format:check` is a no-op here, and `scaffold.test.ts:76-90` is a byte-fidelity copy test that cannot notice a wrong rule — and names what was run instead |

Cross-check of a countable claim: the log says `corpus search` appears 5× in the installed
orchestrate skill and 6× in the installed comment skill. My own extractor over the installed copies
counted **11** occurrences across the two files. Consistent.

## Criteria Results

| #   | Criterion                                                   | Result | Observed in the installed copies                                                                                                                                                          |
| --- | ----------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 712 | All three rules stated in both skills, in the surrounding voice | PASS | Both files carry a new **Invariant 6, "You retrieve; you never enumerate."** — orchestrate `:53`, comment `:65` — sitting inside the existing numbered invariant list beside attribution, archive-never-delete, lock-deferral and job-logging. Same imperative voice, same bold-lead formatting, no renumbering of 1–5. Comment additionally carries it as a co-equal bullet in *Gather context* (`:81`, "**Locating goes through retrieval**") beside the pre-existing "**State goes through the CLI**". Woven in, not bolted on |
| 713 | The tree-read licence is reconciled                         | PASS   | `grep -i "Content may be read from the tree"` → **no match**. In its place: "Never list `data/docs/`, never open files to find out what they are about… Reading follows retrieval, one id at a time and only where the ranking pointed — and it is `corpus doc show <id>`, never the markdown on disk." **No direct-read carve-out survives** — the replacement is stricter than the rule that forced it, so the two screens cannot contradict each other |
| 714 | Inbox filing no longer directs a directory sweep            | PASS   | `grep -i "Survey the folders"` → **no match**. Step 4 is now "**Choose a destination by finding its neighbours**": `corpus search "<what the capture is about>" --limit 5`, then `corpus doc show <id>` on the closest hit "whose path names the folder it lives in", plus "**Never go looking through the tree for folder names**" and a named branch for when search returns nothing. This is Open Conflict 2's ruling implemented — the hit's own path is the folder locator, and no nonexistent tree verb is invented to replace the sweep |
| 715 | Delegation carries anchors, forbids carrying documents      | PASS   | The prompt-contents list gained "**the anchors it should start from**". A new paragraph, "**A dispatch carries anchors, not documents**", instructs retrieving *before* dispatch and pasting the top lines back verbatim — "never paste a document body into a prompt, never hand over a file, and never ask a subagent to report the corpus's contents back to you". The binding-invariants list gained: "Retrieval discipline binds inside the subagent exactly as it binds you… never handed — and never asks for — a corpus dump." Comment mirrors it at `:66-70` and `:166` |
| 716 | Nothing else moved                                          | PASS   | Read as a user: the **N=10** concurrency block (`:251-255`), the lock/deferral protocol incl. `--blocked-on` and automatic re-entry, HALT, the model-by-weight table and its three-question judgment rule, the `↳ ` trace-line grammar ("the reply's **final line — and only its final line —**… A turn whose work changed nothing carries no trace") and the job-log rules all read intact and internally consistent with the new rules. No passage contradicts another |
| 717 | Worked examples use the verbs                               | PASS   | **Orchestrate**: the example opens `corpus search "rate assumption" --limit 5`, shows two ranked lines in the *real* output shape, dispatches them as anchors, and the subagent then reads `corpus doc show doc_a1b2c3` — "the second line never read at all". **Comment example 3**: `corpus search "home and auto insurance policies" --limit 5` → two ranked lines → `corpus doc show doc_3f9a01  # its path is data/docs/finance/… — that is the folder` → `corpus doc move`. Retrieval, then one deliberate read, then the act |
| 718 | Every `corpus …` invocation resolves — the build gate       | PASS   | `VITEST_MAX_THREADS=4 vitest run scripts/workspace-template.test.ts` → **96 passed**. Independently, my own resolver parsed every `` `corpus …` `` heading out of `docs/cli.md` (60 of them) and resolved all 30 distinct verbs used by the two installed skills, `corpus search` (×11) and `corpus doc related` (×6) included. **0 unresolved** |
| 720 | The installed workspace carries the rules                   | PASS   | Verified from my own fresh `corpus init`, reading the installed copies, not `assets/`                                                                                                       |
| 721 | No contradicting instruction survives, proved by grep       | PASS   | Independent grep audit below                                                                                                                                                              |

### Independent grep audit (`/usr/bin/grep -n -i` over the **installed** copies)

| Pattern            | Hits  | Verdict                                                                                                                       |
| ------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| `corpus doc get`   | **0** | The nonexistent verb (C13) is nowhere                                                                                         |
| `corpus tree`      | **0** | The nonexistent verb is nowhere                                                                                               |
| `corpus doc list`  | **0** | The list verb is **never** offered as a locator                                                                               |
| `directory`        | **0** | —                                                                                                                             |
| `folder.*exist`    | **0** | The old folder-survey phrasing is gone                                                                                        |
| `wholesale`        | **0** | —                                                                                                                             |
| `enumerate`        | 2     | Both are the **prohibition** — orchestrate `:53` / comment `:65`, "You retrieve; you never enumerate."                        |
| `read.*tree`       | 1     | orchestrate `:56` — "Never list a folder, never **sweep the tree**, never read documents to find out what is in them." Prohibition |
| `survey`           | 1     | comment `:354` — "Survey what changed this week…" inside a *stewardship prompt example*, i.e. the scope of a review task, not a directory read |
| `data/docs/`       | 3     | `:84` "**Never list** `data/docs/`" (prohibition) · `:199` states where inbox captures land (a fact about the product) · `:467` a path printed by `doc show`, used as folder evidence (that is the sanctioned locator). **None is an instruction to read the tree** |

Zero enumerate-style instructions survive. Every residual hit is either a prohibition or a
statement of fact, and I read each in context rather than counting.

### One more thing I checked

The output format quoted in the skills is the format the product actually prints. Skill text:

```
doc_a1b2c3  Mortgage options › Rates  …the working rate assumption is 6.1% as of 2026-05-02…
```

Real CLI, my workspace:

```
doc_h7atwbtz  Mortgage options › Rates › Rate lock  …zorblatt assumption we agreed is 6.1 percent…
```

Same field order, same two-space padded join, same `…snippet…` convention. The product
documentation and the product agree — which is the coupling the sprint flagged as breakable.

## Failures

None.

## Summary

9 of 9 criteria passed. This was a 996-line prose change across two load-bearing product files and
the failure mode was a skill that states a rule on one screen and contradicts it two screens later.
It does not: the tree-read licence and the folder-survey instruction are both **deleted**, not
merely outranked, and their replacements name the retrieval verbs concretely enough to follow.
`corpus doc list` — the most tempting wrong answer for "how do I find a folder" — appears **zero**
times in either file.
