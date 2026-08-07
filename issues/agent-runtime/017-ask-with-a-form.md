# [AGENT-017] Ask with a form: batch the questions into one form, in one turn

## Domain

agent-runtime

## Status

todo

## Priority

P1 (important)

## Model

opus

## Dependencies

- Depends on: SERVER-068 — the skill must not document a grammar the server
  cannot parse, and the worked example in the skill is written as a form the
  product will actually accept
- Blocks: —
- Related: CONTRACT-038 (the grammar), UI-084 (the controls the person answers
  with). This issue is the one that makes any of them get used

## Spec References

- SPEC.md **§7**, Comment skill → "**Asking with a form**" (rider signed
  2026-08-05) — the stewardship rule this issue installs: ask with a form rather
  than a question in prose, ask the **whole batch at once** as fields of one form
  in one turn, mark a field optional when the work can proceed without it, keep
  questions short enough to read as controls, say in the same turn what will be
  done with the answers, and do **not** put open-ended conversation into a form
- SPEC.md **§6**, "Forms in turns" — the three field kinds, required by default,
  at most one form per turn, answered once as a whole, only the person answers
- SPEC.md **§11**, Attention — the unanswered form is the row that survives being
  read

## Summary

**This is the amendment that actually makes forms get used.** Richer controls
(CONTRACT-038, UI-084) make a form *worth* reaching for; nothing makes the agent
reach for it, so without this issue the whole chain ships a nicer control set on
a mechanism that stays rare. SHARED-021 said so plainly: it is "the single most
load-bearing piece of this rider for motivation 3".

Checked against the installed skill rather than assumed: the comment skill's
`## Forms` section does mention forms, and it is **narrower than SPEC now is**.
It says "Raise a form when a **bounded choice unblocks the work** — two or three
destinations for a capture, two readings of an ambiguous request", which frames a
form as a narrow exception. §7 now makes it the default shape for any turn whose
purpose is to get something from the person — a decision, a preference, a missing
fact, a go/no-go before doing work — and adds the batching rule the section has
nothing about at all: **every question the agent needs answered to proceed, as
fields of one form, in one turn**, rather than one question per turn.

The batching half is where the user's second motivation is actually served. A
form asked one question at a time puts the agent straight back to reading a
paragraph and working out which sentence answered which question, and whether the
two sentences it got covered all three asks. And the reason to prefer a form over
prose at all is §11's asymmetry: a question asked in prose leaves no trace that
anyone is waiting once the thread has been read, while an unanswered form's
Attention row survives being read and clears only by acting.

The section's grammar block is also now wrong on three counts and must move with
the change: it documents `prompt` + `options` only, it asserts **single-select**,
and it tells the agent that "**nothing validates the block when it is posted**" —
which SERVER-068 changes. A skill that teaches a grammar the server rejects is
worse than one that teaches nothing.

## Acceptance Criteria

- [ ] The comment skill instructs the agent to ask with a **form** when a turn's
      purpose is to get something from the person, rather than with a question in
      prose
- [ ] It states the **batching** rule: every question needed to proceed, as
      **fields of one form, in one turn** — never one question per turn
- [ ] It tells the agent to mark a field **optional** when it can proceed without
      it, and to mark generously (required-by-default is the grammar's default,
      and the fix for forms feeling like gates is more optional fields, not
      fewer forms)
- [ ] It says to keep questions **short enough to read as controls**, and to say
      **in the same turn** what will be done with the answers
- [ ] It keeps the exclusion: open-ended conversation is **not** a form. A form
      is for questions that have answers; everything else is ordinary prose
- [ ] The grammar block documents the **three field kinds** and required-vs-
      optional, and the worked ```` ```form ```` example is a **multi-field** form
      the product actually accepts
- [ ] The stale claims go: **single-select**, and "nothing validates the block
      when it is posted" (SERVER-068 refuses a malformed form at write time)
- [ ] It states that the agent **never answers a form**, including its own (§6)
- [ ] The `form.respond` continuation guidance survives and is updated to the
      richer payload — the answers arrive **keyed to the questions**, so the "find
      the form you raised at `formTs` and resume from exactly there; never re-ask,
      never re-explain from the top" rule gets easier to follow, not harder
- [ ] `scripts/workspace-template.test.ts` passes, including its exact section
      count and its pinned form-fence assertion

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/comment/SKILL.md` — the `## Forms` section
  (currently around L400-427), and its frontmatter `updated` timestamp
- `scripts/workspace-template.test.ts` — the assertions this necessarily moves
  (see below)

Note the directory really is `assets/workspace/claude/…`, without the dot; the
`.` is added at install time.

### The skill-file constraints that have bitten repeatedly

These are enforced mechanically by `scripts/workspace-template.test.ts` and are
the usual reason an agent-runtime change fails after the prose is already good.
**Verified against the file today** — do not trust a remembered count:

- **Exact section counts.** `expect(sections.size).toBe(13)` for the comment
  skill (test ~L836-858) and `toBe(16)` for orchestrate (~L457-474). Adding a
  `## ` section to the comment skill is therefore a **two-file** change. Prefer
  extending `## Forms` in place, which keeps the count at 13 and keeps everything
  about forms in one section — but if a new section is genuinely right, update the
  number in the same commit.
- **Every `## ` section body must exceed 400 characters** after trimming
  (`toBeGreaterThan(400)`, the heading line excluded). A short new section fails.
- **The comment skill's counter is fence-aware**; orchestrate's is not. The
  comment skill already has two `## ` lines living inside heredocs in its worked
  examples that are correctly not counted — so a `## ` inside a fence here is
  safe, and the same edit in orchestrate would not be.
- **The form fence is pinned by content**: the test asserts
  `expect(body).toContain("```form\nprompt: ")`. A multi-field example changes
  that line, so the assertion moves with it — and it must still assert
  *something*, or the skill's example stops being guarded.
- **`EXPECTED_TREE` is exhaustive equality**, so adding any file under
  `assets/workspace/` fails until the list is updated.
- **Required headings** are checked by lowercased substring, including `forms`
  for the comment skill — so the section may be renamed only if it still contains
  that word.
- **Forbidden prose.** Both skills ban the hedges `use your judgment`, `consider
  whether`, `you may want`, `if appropriate`; both ban `SPEC.md`, `CLAUDE.md` and
  `issues/`. This bites when transcribing rider or spec language, which is
  written in exactly that register — the skill must give an instruction, not
  describe a consideration.
- **Heredoc mechanics.** Every multi-line shell argument uses a quoted heredoc
  (`/^<<'EOF'$/`), and `-m "$(` is banned. A worked example posting a form is a
  multi-line body and therefore a heredoc.
- The comment skill must carry exactly **four** worked examples matching
  `/^\*\*\d+ — /`, and exactly **one** ```` ```prompt ```` fence.

### Key Implementation Details

**Write it as an instruction, not as a rationale.** The skill is prose the agent
executes; the *why* belongs here and in SPEC, and the banned-hedge list is the
test enforcing exactly that register. "Ask with a form" is an instruction; "you
may want to consider whether a form is appropriate" is three banned phrases and
no instruction.

**The batching rule needs a concrete shape to copy.** The most likely failure of
this issue is an agent that reads "ask with a form" and still asks one question
at a time, because a one-field example is what is in front of it. Make the worked
example a real multi-field ask — a decision, a selection and a fact — with one
field marked optional, and with the turn saying what will be done with the
answers. SHARED-021 named the test for this exactly: give the agent a task that
needs three decisions from the person, and it must come back with **one form of
three fields**, not three prose questions across three turns.

**Keep "an open question is not a form; it is a reply."** It is the existing
sentence that already carries §7's exclusion, and it is the guard against the
opposite failure — a form wrapped around a conversation, which is worse than
prose because it demands a submit for something that has no answer.

**Do not restate the loop.** The comment skill is forbidden from mentioning the
queue verbs and `.corpus/HALT`; the continuation guidance stays at the level of
"the answer comes back to you as `form.respond`; resume from there".

### Edge Cases

- A form the agent wants to ask **as part of** an answer it is already giving —
  still one turn, still at most one form
- A question that turns out to need re-asking: §6 forbids rewriting a turn that
  carries a form, so the agent asks again in a **new** turn rather than revising
- The person answers with every optional field blank — a complete answer; the
  agent proceeds rather than re-asking for the optional ones
- The person replies in prose instead of answering the form — the form stays
  unanswered and the Attention row stays; the agent does not treat the reply as
  the answer, and does not resolve the thread to clear it
- A form with a single field is still legitimate; batching is "everything you
  need", not "at least three"

## Testing Strategy

`scripts/workspace-template.test.ts` is the whole test surface — the skill is
prose, and its guarantees are structural. Add assertions in the same register the
file already uses: that the section states the batching rule, that the example
fence is multi-field, that the stale single-select claim is gone, and that the
"never answers a form" rule appears. Keep the existing form-fence containment
assertion alive in updated form rather than deleting it.

## E2E Verification Plan

### Verification Steps

The skill is only real once installed, so verify through the product, not the
repo:

1. `corpus init` a scratch workspace on a non-default port from the built package
   (so the template is the installed one, not the source tree), and confirm the
   comment skill landed at `.claude/skills/comment/SKILL.md` with the new section.
2. Start the real server and the agent loop in that workspace.
3. Comment on a document with a request that genuinely needs three things
   decided. **Expected: one agent turn carrying one form with three fields**, one
   of them optional — not three prose questions and not three turns.
4. Confirm the thread appears in Attention as "awaiting your answer"; open it and
   close it; the row is still there.
5. Answer the form. Confirm the agent resumes from where it staged the work
   rather than re-asking or re-explaining from the top.
6. Post a deliberately malformed form through the agent path and confirm the
   write is refused (SERVER-068), i.e. the skill's grammar guidance matches what
   the server enforces.
7. `corpus doc check` and `corpus db doctor` clean; stop the server.

## E2E Verification Log

### Post-Implementation Verification

_[Agent fills: workspace created from the built package, application restarted,
exact commands, observed output, the actual form the agent produced. State which
model you ran on.]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[AGENT-017]` prefix
