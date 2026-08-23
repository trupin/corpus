# [SERVER-144] Retrieval ranks the product's own skills into every pack

## Domain
server

## Status
todo

## Priority
P1 (important)

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md Section 9.1 — search and the semantic index
- SPEC.md Section 6 — the context pack
- SHARED-070 audit report — `issues/evals/SHARED-070-token-audit.md`

## Summary

Measured in the SHARED-070 audit (2026-08-23, fresh workspace, 5 user notes +
the installed template): across 7 retrieval calls (`thread context`,
`corpus search`, `doc related`), **52% of the output tokens (1,746 of 3,355)
were rows pointing at the product's own skill documents**. Concretely:

- `corpus search "rate assumption 6.1%" --limit 5` — the **top hit** was the
  comment skill's worked example (which contains that exact sentence); 3 of 5
  hits were skill documents; the actually-relevant user note ranked last.
- `corpus doc related doc_<mortgage-note> --limit 5` — the #1 related document
  for a user's mortgage note was `doc_skillorchestrate`.
- `corpus thread context` packs carried 4 of 11 excerpt rows naming
  `doc_skillcomment`, `doc_skillorchestrate`, `doc_skillconverse`,
  `doc_skillb8a2308c`.

Two costs. The token cost: ~580 tok/event of excerpts the agent must read past.
The relevance cost is worse: the skills' worked examples use realistic domain
prose (mortgages, rates, insurance, filing), so they are **honeypots** for
exactly the queries a real corpus produces, and they displace the row the agent
needed — which forces a second search. The effect is worst on small corpora,
which is every new workspace's first week.

## Acceptance Criteria
- [ ] Documents of type `skill`, `agent-def` and `template` are excluded from
      default ranking in `corpus search`, `corpus doc related`, and the context
      pack's related-excerpts section.
- [ ] They remain fully retrievable when asked for: `corpus search --type skill`
      (already the skill-genesis path in the comment skill) still finds them,
      and `doc show`/`doc related` on a skill id still works.
- [ ] A thread whose **parent** is a skill document still gets that skill as
      its parent block in the pack — the exclusion is about ranking neighbours,
      never about the document the conversation is on.
- [ ] Whether seed views/boards (`type: view`, `type: board`) join the
      exclusion is decided and stated — the audit saw `doc_seedattention` and
      `doc_seedinbox` rank into packs too.
- [ ] Re-run the audit's probe in a fresh workspace: the three calls above
      return user documents only, and the pack for an anchored comment on a
      mortgage note carries no `doc_skill*` row.

## Technical Design

### Files to Create/Modify
- `apps/server/src/` — ranking/query layer for search, related, and the pack
  builder (locate via the SPEC §9.1 implementation; likely shared candidate
  filtering)

### Key Implementation Details
Prefer one shared exclusion predicate over three copies. This is a ranking
default, not an index change — the documents stay indexed so `--type skill`
costs nothing extra. If the pack builder and search share candidate generation,
one filter covers all three verbs.

### Edge Cases
- `corpus search --type skill` and any explicit `--type` naming an excluded
  type bypasses the exclusion entirely.
- A workspace where the *user* writes documents of type `template` — the
  exclusion is by type, and that is the accepted cost; state it in the help
  text of `search` if help mentions ranking.
- The comment skill's genesis flow (`corpus search "<pattern>" --type skill`)
  must keep working unchanged.

## Testing Strategy
Server unit tests on the ranking layer: a corpus with one skill doc and one
note sharing a phrase ranks the note only by default, both under `--type`.
Pack-builder test: excerpt rows never name excluded types.

## E2E Verification Plan
Fresh `corpus init` workspace, seed one mortgage note, `corpus search "rate
assumption"` — expect no `doc_skill*` row without `--type skill`, and the note
first.

### Reproduction Steps (bugs only)
1. `corpus init` scratch workspace; `corpus server start`
2. Create a note containing "The working rate assumption is 6.1%"
3. `corpus search "rate assumption 6.1%" --limit 5`
4. Expected: the note first, no skill rows
5. Actual (2026-08-23, v0.19.0): `doc_skillcomment` first, 3/5 rows are skills

### Verification Steps
1. Restart server after the change, re-run the reproduction
2. Expected: user documents only; `corpus search "rate" --type skill` still
   returns the skills

## E2E Verification Log
_Filled in by the implementing agent._

### Reproduction (bugs only)
_[Agent fills]_

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
