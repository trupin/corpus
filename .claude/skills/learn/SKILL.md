---
description: Record a durable lesson in the right guideline file, then check the change did not contradict, duplicate, or stale anything else. Use when something is learned that should outlive this session.
argument-hint: "<the thing to record>"
user_invocable: true
---

Take `$ARGUMENTS` — a fact, convention, correction or gotcha worth keeping — find the one place it belongs, write it there, and then verify the write did not break something else.

The third step is the point. Guidance files in this repo state rules **and their reasons**, and a rule added without checking its neighbours produces exactly the failure this repo keeps finding: a document confidently asserting something that is no longer true.

## 1. Decide whether it should be recorded at all

Not everything learned is durable. Record it if a future session would get it wrong without it. Do **not** record:

- Something the code already says plainly, or a test already enforces. A comment restating a test is a second copy that will drift.
- Something true only of this task, this branch, or this bug.
- A restatement of an existing rule. If it is already written, the answer is to _sharpen_ that rule, not add a second one — see step 4.

If it fails these, say so and stop. A guideline file that accumulates everything stops being read.

## 2. Find the one right home

**The first question is always: does this govern the development of Corpus, or the behaviour of the product?** Getting this wrong is the most costly mistake this skill can make, and it has been made.

| Home                                                    | What belongs there                                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                                             | How **this repo** is developed: orchestration, git workflow, model policy, machine load, tool usage. The dev harness.                  |
| `.claude/agents/<domain>-dev.md` → **Domain Knowledge** | A durable fact, decision or gotcha specific to one domain. Dated entries. This is the default home for "X bit me and will bite again". |
| `docs/TS_GUIDELINES.md`                                 | TypeScript conventions applying across workspaces.                                                                                     |
| `.claude/skills/<name>/SKILL.md`                        | How a _procedure_ should be run.                                                                                                       |
| **`SPEC.md`**                                           | Product behaviour — **requires user sign-off, always**. See below.                                                                     |
| **`assets/workspace/**`**                               | The _product's_ agent runtime, shipped to users' workspaces. Not this repo's harness.                                                  |

**Two hard rules:**

- **Never write to `SPEC.md` in this skill.** SPEC changes are user-signed without exception. If the lesson is product behaviour, draft the amendment as a `issues/shared/NNN-*.md` rider held for sign-off and say so — do not apply it.
- **`assets/workspace/` is the product, not the harness.** A lesson about how the _Corpus agent_ should behave in a user's workspace goes there (or to SPEC via a rider); a lesson about how _we_ build Corpus goes to `CLAUDE.md`. When the user says "add this to your guidelines" they usually mean the harness — but if the lesson is about the product's agent, ask rather than guess. This exact confusion has happened.

Prefer the **most specific** home that covers it. A domain gotcha in `CLAUDE.md` is noise for every agent that does not touch that domain.

## 3. Write it where the rule lives, with its reason

Find the passage that already governs the surrounding behaviour and extend _that_, rather than appending a new bullet somewhere plausible. A rule far from the thing it constrains is a rule nobody reads at the moment they need it.

Write the **reason**, not only the instruction. A rule whose reason is invisible gets optimised away by the next reader who thinks they see a simpler path. Where a concrete failure prompted it, name the failure — a rule with a scar is a rule people keep.

Match the file's existing voice and formatting. Where entries are dated, date it.

## 4. Check what the change just broke

This is the step that makes the skill worth invoking. Search for, and resolve, each of these:

1. **Direct contradiction.** Does any existing sentence now state the opposite? Search the file _and_ its neighbours for the terms in the new rule. Real example: `CLAUDE.md` and two scripts asserted "no allowlist anywhere in the path" while an allowlist was being added — the contradiction sat in the job that enforced it.
2. **A count, list or enumeration that is now short.** New rules frequently make a number stale. Real example: SPEC said the validator had "thirteen codes" after a fourteenth landed — every other count in the change was updated and the source of truth was the one place missed.
3. **A superseded rule.** If the new guidance replaces an old one, delete or amend the old one. Two rules that half-agree are worse than either alone, because a reader will follow whichever they meet first.
4. **A duplicated rule.** If the same guidance now exists in two homes, keep the specific one and have the general one point at it. Duplicates drift; they do not stay in sync.
5. **A claim about code that has moved.** If the new text cites a file, symbol, line or count, verify it _now_ — line citations rot fast and an issue file exists to be followed literally.
6. **A dependent artefact.** Does a test assert the text you changed? `scripts/workspace-template.test.ts` pins skill prose, and several tests pin exact counts. Run them.

Report what you checked, not merely that you checked.

## 5. Verify

Run whatever guards the file you touched:

- Prose and markdown: `npx prettier --check <file>`.
- Skill text under `assets/workspace/`: `VITEST_MAX_THREADS=4 npx vitest run scripts/workspace-template.test.ts` — it asserts section counts **exactly** and requires every `## ` section to exceed 400 characters, so a new section is a deliberate act.
- Anything with a count assertion: run the suite that pins it.

## 6. Report

State: what was recorded, **where and why there**, what step 4 turned up, and anything left for the user — in particular any SPEC rider drafted and awaiting sign-off.

If nothing was recorded, say why. That is a legitimate outcome.

## Rules

- One lesson, one home. If it genuinely belongs in two places, one of them points at the other.
- Never write to `SPEC.md`. Draft a rider instead.
- Do not delete an existing rule to make room without saying so explicitly in the report.
- Prefer sharpening an existing rule over adding a neighbouring one.
