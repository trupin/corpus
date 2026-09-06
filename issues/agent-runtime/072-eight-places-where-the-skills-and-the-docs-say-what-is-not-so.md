# [AGENT-072] Eight places where the skills and the docs say what is not so

## Domain

agent-runtime

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —

## Origin

Batched 2026-09-06 from **SHARED-003** (the PR #11 / PR #12 review ledger) by the
audit that closed it. Eight items across the ledger's five review rounds are the
same kind of defect — installed skill text or shipped documentation stating
something the product does not do — and they are one text pass, not eight issues.

The one text-drift item that was **not** batched here is the `agent.done`
wake-back claim in `comment/SKILL.md`: it contradicts signed spec text in two
places, so it was re-filed standalone as **AGENT-071**. Do that one first or
alongside; they touch the same file.

## Spec References

- SPEC.md §6 — anchors, forms, and the mention sigil
- SPEC.md §7 — the agent loop, delegation, retrieval discipline, archive
- SPEC.md §11 — validation warnings
- Each item below cites its own where it has one.

## Summary

Eight statements in the product's installed skills and in `docs/` describe
behaviour the product does not have, or contradict a neighbouring statement in
the same file. None is a code defect. Every one of them trains an agent — or an
operator — to expect something that will not happen. They are grouped because
they are one careful reading pass over four files, and because fixing them one at
a time would cost eight review rounds for text changes.

**Line numbers below are the ledger's, recorded between 2026-07-29 and
2026-07-31. Several of these files have been rewritten since. Verify each
location before editing, and record in the log where an item had moved or had
already been fixed.** An item that is already fixed is struck in the checklist
with the evidence, not silently ticked.

## Acceptance Criteria

Each item is either fixed or struck with evidence that it no longer applies.

- [ ] **1. The `unresolved` payload examples strip the `@` sigil the server
      sends.** `comment/SKILL.md:31` and `:394-395` show `"unresolved":
      ["nobody"]` where the server sends `@nobody` (`threads/mentions.ts:170`).
      The sigil is the discriminator between a mention and a skill invocation, so
      an agent matching on the example's spelling matches nothing. The same file
      is internally inconsistent: `:137-138` keeps the sigil. Make every example
      agree with the wire, and confirm which spelling the server actually sends
      before choosing — read `threads/mentions.ts` rather than trusting this
      issue.

- [ ] **2. `docs/workspace-template.md` contradicts itself about the manifest.**
      Around line 140 the manifest is declared tracked (the gitignore negation
      ships for it); at `:167` a later paragraph says it "is gitignored under
      `.corpus/*`". One of the two is wrong. Determine which by reading the
      shipped `assets/workspace/gitignore` and `corpus init`'s scaffold, then fix
      the false sentence — not both sentences into vagueness.

- [ ] **3. Two wrong sentences in `orchestrate/SKILL.md` (ledger NIT 22, one
      bullet, both halves).** _(a)_ At `:128-132` the touched-set rule for
      `form.respond` asks for the parent document id to compute the touched set.
      The `form.respond` payload names the thread, not the parent. The fallback
      is safe — serialize the event — but the rule as written cannot be followed.
      Either state the fallback as the rule, or state how to obtain the parent id
      with a verb the agent has. _(b)_ At `:68-69`, "no other knob" overlooks the
      global `--json`, which every verb takes. Reword so the sentence is true, or
      scope it to the knobs it meant.

- [ ] **4. The archived-collision 409 carries a name, the skill instructs an id.**
      (Audit SPEC finding 35, still open.) The server's 409 for an archived-name
      collision reports the **name**, while `comment/SKILL.md` tells the agent to
      run `corpus doc unarchive <id>`. The agent is handed one thing and told to
      use another. Fix the skill text to bridge the gap with a verb the agent
      has, or file the server half if the 409 should carry the id — decide and
      say which, do not leave it open a third time.

- [ ] **5. Both skills' "reversible" clauses name no verb.** (Audit SPEC finding
      36, still open.) `comment/SKILL.md:571` and `orchestrate/SKILL.md:58` both
      describe `corpus doc archive` as "reversible, still indexed, still in git"
      without naming `corpus doc unarchive`. An agent told an act is reversible
      and not told how to reverse it has been told half a thing. Name the verb in
      both.

- [ ] **6. A worked example labels a light-criterion dispatch with a heavier
      model.** The ledger recorded this at `orchestrate/SKILL.md:428` as a
      Haiku-criterion dispatch labelled "(Sonnet …)", which trains mis-tiering.
      The file has been substantially rewritten since (the model-weight riders of
      2026-08-06 and after), and the worked examples now sit near `:575-578`.
      **Re-verify against the current tiering table before changing anything** —
      if the example now matches its own criterion, strike this item with the
      evidence rather than editing it.

- [ ] **7. `db doctor`'s `--json` description is stale.** It still says the
      output is `{ok, drift, stats}`. It is not — `warnings` has since been added
      (`DoctorReportSchema`). One-line fix in the verb's description, then
      regenerate `docs/cli.md`. **This item is in `apps/cli`, not
      `assets/workspace`.** It is batched here because it is the same kind of
      defect and the same regeneration pass, but the file it edits belongs to the
      cli domain — coordinate rather than reaching into it blind. Note also that
      CONTRACT-099 may change this route's declared responses; if that issue is
      in flight, sequence after it so `docs/cli.md` is regenerated once.

- [ ] **8. `doc`'s topic description frames `list` as surveying the corpus.** It
      reads "the agent surveys the corpus", which is in tension with §7's
      never-enumerate discipline. Reword at the same `docs/cli.md` regeneration
      as item 7.

- [ ] Every fixed item has its before/after text quoted in the E2E log.
- [ ] `docs/cli.md` is regenerated exactly once, at the end, if items 7 or 8
      changed anything.

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/comment/SKILL.md` — items 1, 4, 5
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — items 3, 5, 6
- `docs/workspace-template.md` — item 2
- `apps/cli/src/commands/db/doctor.ts` and the `doc` topic registration — items
  7, 8 (cli domain; coordinate)
- `docs/cli.md` — regenerated

### Key Implementation Details

Read before writing, in this order:

1. `apps/server/src/threads/mentions.ts` — what the sigil actually is (item 1).
2. `assets/workspace/gitignore` and `apps/cli/src/commands/init/scaffold.ts` —
   whether the manifest is tracked (item 2).
3. The `form.respond` payload schema in `packages/contract` — what an event
   actually carries (item 3).
4. `DoctorReportSchema` — the real `--json` shape (item 7).

Every one of these items exists because someone wrote what they believed instead
of what the code does. Do not repeat that: each fix cites the file it was checked
against, in the log.

### Edge Cases

- Items 7 and 8 edit `apps/cli`. If the orchestrator would rather split them into
  a cli issue, do that — but then they must not be silently dropped from this
  batch's accounting.
- The repo's own `.claude/` is the development harness and is a different tree.
  Nothing here touches it.
- A skill file's fix reaches an existing user workspace only through `corpus
  workspace upgrade`. Say so in the log; do not imply otherwise.

## Testing Strategy

Text changes. Where a file has content tests, keep them green. Where a fix
depends on a claim about code (items 1, 2, 3, 7), the evidence is the code read,
quoted in the log.

## E2E Verification Plan

### Verification Steps

1. For each item: quote the before text, quote the after text, and name the file
   read to decide what "after" should say.
2. `corpus init` a scratch workspace from this tree and confirm the amended skill
   files install with the new text.
3. If `docs/cli.md` was regenerated, diff it and confirm only the intended lines
   moved.

## E2E Verification Log

_[Agent fills, item by item. An item struck as already-fixed needs its evidence
here too. State which model the implementing agent ran on.]_

## Completion Checklist (domain agent)

- [ ] Every one of the eight items is ticked or struck with evidence
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: every new sentence checked against the code it describes
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[AGENT-072]` prefix
