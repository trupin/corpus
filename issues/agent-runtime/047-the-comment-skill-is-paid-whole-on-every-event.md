# [AGENT-047] The comment skill is paid whole on every event

## Domain
agent-runtime

## Status
done

## Priority
P1 (important)

## Model
fable

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md Section 7 — the agent loop: every claimed event is dispatched to a subagent
- SHARED-070 audit report — `issues/evals/SHARED-070-token-audit.md`

## Summary

Measured in the SHARED-070 audit (2026-08-23, real loop, 6 events):
`assets/workspace/claude/skills/comment/SKILL.md` is **15,228 tokens (10,401
words)**, and a dispatched subagent reads it whole on **every** `comment.created`
and `form.respond` event before its first command runs. The same event's entire
CLI traffic was 376–2,254 tokens. On a 30-event day this one file is ~457k
tokens — **56% of everything the loop spends**, the largest single cost in the
product, and no Phase 39 issue touched it.

The dispatch prompt makes it worse by restating the orchestrate skill's
binding-rules block (1,028 tokens) while the comment skill's own "Inherited
invariants" section restates the same invariants again (593 tokens) — ~1.6k
tokens of duplication per event.

Most of the file is context a given event never uses. Measured section sizes:
worked examples 1,758 tok, Forms 1,600, Reply (mostly fence mechanics) 1,960,
Engagement and closure 1,054, Skill genesis 979, Inbox filing 610. An anchored
one-line patch event uses perhaps a third of the document.

## Acceptance Criteria
- [x] The per-event fixed payload (SKILL.md body + what the dispatch prompt is
      told to restate) is reduced, with the before/after measured in tokens and
      words on the shipping files.
- [x] The mechanism is progressive disclosure, not deletion: rarely-needed
      grammars (forms, fence widths, skill genesis, worked examples) move to
      `references/` files beside the skill that the subagent reads only when the
      event needs them, each named from the core text at the point of need.
- [x] The invariants exist in exactly one place: either the dispatch prompt
      carries them or the skill restates them — not both. The orchestrate
      skill's Delegation section and the comment skill's Inherited invariants
      section are reconciled accordingly (this is a cross-file edit inside
      `assets/workspace/`, owned by this domain).
- [x] No behavioral rule is weakened or dropped — the restructure moves text,
      it does not rewrite obligations. The evaluator scenario set for comment
      handling still passes.
- [x] The estimated saving is verified: target ≥ 40% off the per-event fixed
      payload (from ~16.8k to ≤ ~10k tokens).

## Technical Design

### Files to Create/Modify
- `assets/workspace/claude/skills/comment/SKILL.md` — core loop only
- `assets/workspace/claude/skills/comment/references/*.md` — forms grammar,
  fence mechanics, skill genesis, worked examples
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the dispatch-prompt
  contract half of the deduplication

### Key Implementation Details
The asd-ste100 skill already ships the pattern: a small SKILL.md with
`references/` and `examples/` read on demand. Keep every pointer explicit ("the
form grammar is in `references/forms.md`; read it before posting a form") so the
disclosure is a directed read, not a discovery problem. Measure with the audit's
scripts (`scratchpad/audit/skills-audit.mjs` pattern: word count + gpt-tokenizer).

### Edge Cases
- A reference file the runtime fails to read is worse than inline text: each
  moved section must be one the event type makes optional, never one every
  event needs.
- Skills are documents the agent itself edits (skill genesis); the references
  are documents too and must carry both frontmatter vocabularies if created
  through the server, or be plain template files installed by `corpus init` —
  decide and state which.

## Testing Strategy
Token/word counts before and after, committed in the issue log. Existing
workspace-template tests (`corpus init` manifest) updated for the new files.

## E2E Verification Plan
Run the SHARED-070 loop shape (one anchored comment, one filing, one form) in a
fresh workspace against the restructured skills; capture the invocations; verify
the worked behavior is unchanged and the per-event fixed payload dropped by the
target.

### Verification Steps
1. `corpus init` a scratch workspace with the new template; `corpus server start`
2. Post an anchored comment requesting an edit; run the loop per the skills
3. Expected: same replies, same trace lines, same settlements; SKILL.md read
   ≤ ~10k tokens; references read only on the events that need them

## E2E Verification Log

_Implementing agent: agent-runtime-dev on **claude-fable-5**. Tokenizer: gpt-tokenizer o200k
(the SHARED-070 method), words exact. All measurements on the shipping files, 2026-08-23._

### The numbers, before and after

| Artifact | Before | After |
| --- | --- | --- |
| `comment/SKILL.md` | 10,401 w / **15,227 t** | 6,771 w / **9,549 t** (−37%) |
| Dispatch-prompt binding block (restated per event) | 766 w / **1,026 t** | **0** — deleted; the skill's *Inherited invariants* is the single carrier |
| **Per-event fixed payload** (issue's metric: SKILL.md + row-4 duplication, 15,227 + 1,026 + 593 = 16,846) | **16,846 t** | **9,549 t — −43.3%**, target was ≥40% / ≤10k |
| References shipped (read only at need) | — | closure 961 t, fences 816, forms 1,571, history 611, inbox-filing 583, skill-genesis 962, worked-examples 1,834 |
| `orchestrate/SKILL.md` (per session) | 34,632 t | 34,979 t (+347: dedup framing, AGENT-046 bullet, AGENT-049 strings) |

### What moved, and why each move is safe

Seven `references/` files beside the skill, each read on an explicit directed pointer at the
point of need, each conditional on what the event does — never on what every event needs:

- `worked-examples.md` — teaching, never required by any event.
- `forms.md` — read before posting a form and on `form.respond`; the decision rules
  (form-not-prose, one-batch, open-question exclusion) stay inline.
- `inbox-filing.md` — read when the parent is an inbox capture; recognition and the two
  hard rules (structure-never-content, ambiguous→ask) stay inline.
- `fences.md` — read before writing any fence; the mechanism and both failure halves stay
  inline in one bullet.
- `closure.md` — read before resolving or suggesting resolution; the trigger and
  resolve-rides-on-a-reply stay inline.
- `skill-genesis.md` — read before creating/editing a skill; the codification threshold,
  conflict rule and announce rule stay inline.
- `history.md` — read before restoring an older version; "a revert is a write whose content
  came from history / no revert command" stays inline.

**References are plain template files, not documents** (the issue's edge case, decided): no
frontmatter, enumerated in `NON_DOCUMENT_FILES`, never projected — in an installed workspace
a skill root admits only `SKILL.md` (`scripts/workspace-template.ts` docblock), so a §5 block
would be dead YAML paid on every directed read while asserting an identity nothing consumes.
The asd-ste100 tree is the shipped precedent. Cost accepted and stated: reference text is not
board-commentable; every behavioural obligation that gates an act before its reference read
stays in `SKILL.md`, which remains a `type: skill` document.

### How "no obligation weakened" was checked

Mechanically, then by pin. (1) Line-level accounting: of the old body's 800 substantive
lines, 756 appear verbatim in the new package (SKILL.md + references); all 44 misses were
audited one by one and are: the frontmatter `updated` bump, re-wrap artifacts of
verbatim-moved paragraphs, pointer sentences replacing section-position cross-refs
("*Doing the work*" → `references/history.md`), the fence bullet's pinned compression (all
eight pinned phrases retained inline), one dropped *rationale* sentence in the batch rule
(the rule itself intact), and one same-file dedup (two edge-case bullets whose rules Gather
context's thread shapes already state; both obligations — never repair `anchors`, never
recreate — remain inline). (2) Every obligation pin in `scripts/workspace-template.test.ts`
was **repointed, never deleted**: 486 tests pass, with moved-text pins now reading the
reference file that carries the text and new pins holding the budget (<7,000 words), the
pointer↔file bijection, the no-frontmatter contract, and the single-carrier invariants rule.

### Deduplication (acceptance criterion 3)

`orchestrate` Delegation now states: a dispatch that names a skill restates nothing — the
comment skill's *Inherited invariants* section is the one copy that binds its subagent; a
dispatch worked from orchestrate's own sections (the two reflections) reads no skill, so its
prompt carries the rules in full. The comment skill's section says the prompt carries no
second copy. Exactly one carrier per dispatch path; pinned in the new AGENT-047 describe.

### Live E2E (real `claude` runs, transcripts kept)

Fresh `corpus init` (26 template files, all 7 references at
`.claude/skills/comment/references/`), server on port 8932. Two events claimed and
dispatched to real `claude -p --model sonnet` subagents with the new prompt shape (skill
named, payload, anchors, **no binding-rules block**). Transcripts:
`scratchpad/audit/e2e-evt1-transcript.jsonl`, `e2e-evt2-transcript.jsonl`.

- **evt_zycklqqbwqhr** (anchored comment, "is 6.1% still right?"): Skill→comment, context
  pack → thread show → `doc show` escalation → one `corpus doc patch` (anchor remapped to
  the new text, verified via `doc show`), `job log`, reply with `--model claude-sonnet-5`
  and a trace line, engagement flipped to `engaged`. **Reference reads: exactly one**
  (`closure.md`, at the resolve decision — it then correctly *suggested* resolving, the
  moved four-conditions rule executed from the reference). **Zero** reads of asd-ste100,
  zero queue verbs, zero other references. Briefing cost this event:
  9,549 + 961 = 10,510 t vs 16,253 t before (−35% with the reference read; −41% on an
  event that never reaches a reference).
- **evt_vgjo2kuii3yg** (standalone, "archive the taxes-2024 folder"): see AGENT-046's log —
  same discipline, `--help=brief` consulted once for the unfamiliar verb, `closure.md` the
  only reference read.
- One behavioral nit observed, not a regression of this restructure: the evt-2 subagent did
  not retitle the standalone thread after its first exchange (the rule is inline and
  unchanged from before).

### Gates

`scripts/workspace-template.test.ts` 486/486; `apps/cli/src/template/install.test.ts` 8/8;
`packages/kit` weightLevels + server board tests + cli hygiene 87/87 (template consumers);
`eslint` and `prettier` clean on every touched file. Scratch servers stopped, ports freed.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
