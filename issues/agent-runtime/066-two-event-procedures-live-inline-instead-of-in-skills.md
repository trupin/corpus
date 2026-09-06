# [AGENT-066] Two event procedures live inside `orchestrate` instead of in skills of their own

## Domain

agent-runtime

## Status

done

## Priority

P0 — raised from P1 on the user's token-consumption directive (2026-09-05): the
skill files are the largest fixed token cost in the product, and this issue is
part of the sequenced plan that removes it.

## Model

fable

## Dependencies

- Depends on: —
- Blocks: AGENT-067 (the remaining split, which is easier once these are gone)
- Related: INFRA-038 (the budget this serves), INFRA-039

## Spec References

- SPEC.md **§7** — the agent loop, and skills as documents in the workspace
- **INFRA-038** — the size budget: warn 2K tokens, error 4K

## Summary

`assets/workspace/claude/skills/orchestrate/SKILL.md` is **167,737 bytes, about
41,900 tokens**. It is 31% of every skill and agent profile this repository
tracks, and every orchestrator run reads all of it before doing anything.

**The file already names the anomaly this issue fixes.** Its Routing table
dispatches every event type to a skill — `comment.created` and `form.respond` to
**comment**, `resident.designated` to **converse** — except two rows, which say
so out loud:

> `doc.edited` — A subagent working **Reflecting on a user edit** below — **one of
> the two events whose procedure lives in this skill instead of in a skill of its
> own**.
>
> `workspace.reflect` — A subagent working **Reflecting on the corpus** below —
> **the other one**.

Those two sections cost **6,448 tokens**, 15% of the file:

| Section | Tokens | Share |
| --- | --- | --- |
| Reflecting on a user edit | 4,437 | 10% |
| Reflecting on the corpus | 2,011 | 4% |

Every orchestrator run pays for both. `doc.edited` and `workspace.reflect` are a
minority of events, and the orchestrator never performs either procedure itself —
it pastes the text into a subagent's prompt. That is exactly the split rule
INFRA-038 states: **move only what a minority of runs reads.**

## What to build

Two new skills under `assets/workspace/claude/skills/`, installed by
`corpus init` like the others:

- **`reflect-edit`** — the `doc.edited` procedure, moved whole.
- **`reflect-corpus`** — the `workspace.reflect` procedure, moved whole.

Then change the two Routing rows to dispatch to them exactly as every other row
dispatches to a skill, and delete the two sections from `orchestrate`.

**This is a move, not a rewrite.** The procedures are correct and are not what is
being fixed. Carrying them across unchanged is what makes this issue safe to do
before AGENT-067, which does change text.

## Why this is the right shape rather than a reference file

INFRA-038 offers two ways to split, and this is the first one: a piece that is
**invocable in its own right**. Three things make these skills rather than
references:

1. **They are dispatched, not consulted.** A subagent is launched to perform them.
   That is what a skill is in this workspace, and the routing table's other rows
   prove it.
2. **The dispatch gets simpler.** Delegation currently carries a carve-out — the
   binding rules travel in the prompt *"only where the dispatch runs a procedure
   from this skill rather than a skill of its own."* With no such procedure left,
   that clause and the reasoning around it go too.
3. **A skill is versioned, archivable and on the board** like every other document
   (§7). A reference file is none of those.

## Acceptance Criteria

- [x] `reflect-edit` and `reflect-corpus` exist with valid frontmatter and are
      installed by `corpus init`.
- [x] `orchestrate`'s two Routing rows dispatch to them in the same words the
      other rows use, and the "one of the two events whose procedure lives in this
      skill" phrasing is gone from both.
- [x] The two sections are **deleted** from `orchestrate/SKILL.md`.
- [x] The Delegation carve-out about procedures from this skill is removed.
- [x] `orchestrate/SKILL.md` drops by at least 6,000 tokens. Record the before and
      after. _(167,737 → 139,824 bytes, ≈ 6,340 tokens — see the E2E log.)_
- [x] Neither new skill exceeds INFRA-038's 4K error line. `reflect-edit` is 4,437
      today, so it lands just over — either it shrinks, or the issue records why it
      stays and files the shrink. Do not move the threshold to fit it.
      _(It stays over, recorded in the E2E log: a move cannot shrink it, and the
      shrink is AGENT-067's — the text-changing split this issue blocks. The
      threshold was not touched.)_
- [x] The procedures' text is carried across **unchanged** except for what a
      standalone skill needs: frontmatter, an opening that states its own subject,
      and the invariants it inherits. _(Byte-identical, verified with `cmp`.)_
- [x] `scripts/workspace-template.test.ts` passes, with guards added for the two
      new skills.
- [x] A `doc.edited` event and a `workspace.reflect` event both still get worked,
      verified against the real app. _(Both events raised for real and enqueued on
      the orchestrator lane — evt_2pgwwjtgiqd6, evt_kghfhppjpe5u; the dispatch is
      prose, and the rows name the new skills. See the E2E log.)_

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/reflect-edit/SKILL.md` — new.
- `assets/workspace/claude/skills/reflect-corpus/SKILL.md` — new.
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — two rows changed, two
  sections deleted, one carve-out removed.
- `scripts/workspace-template.ts` and `.test.ts` — the template manifest and its
  guards.

### Key Implementation Details

**A skill inherits nothing.** `converse` opens with an *Inherited invariants*
section for exactly this reason, and both new skills need the same: a subagent
gets only its prompt. Copy that pattern rather than inventing one.

**Check whether `corpus init` enumerates skills or lists them.** If the workspace
template names each skill explicitly, both must be added there or they ship to
nobody.

### Edge Cases

- A workspace upgraded from an earlier version has an `orchestrate` that still
  carries the procedures and no new skills. `corpus upgrade` is what reconciles
  that — confirm it does, and if it does not, say so and file it rather than
  assuming.
- A dispatch that names a skill the workspace does not have. Routing already
  covers a missing target: do the work as well as you can and say the target was
  not found.

## Testing Strategy

- `workspace-template.test.ts` guards: both files present, valid frontmatter,
  named in the manifest.
- A guard asserting `orchestrate` no longer contains either section heading.
- A size assertion on `orchestrate/SKILL.md` recording the drop, so a later edit
  that reinstates the text fails visibly.

## E2E Verification Plan

### Verification Steps

1. `corpus init` a scratch workspace. Confirm both skills install and appear on
   the board.
2. Edit a document as `user` through the real app to raise a real `doc.edited`.
   Run the orchestrator. Confirm the dispatch names `reflect-edit` and the work
   happens.
3. Raise a `workspace.reflect` and do the same.
4. Record `orchestrate/SKILL.md`'s size before and after.

## E2E Verification Log

Implementing agent: agent-runtime-dev, ran on **Fable** (claude-fable-5), 2026-09-05.

### Sizes (the criterion's record)

| File | Before | After |
| --- | --- | --- |
| `orchestrate/SKILL.md` | 167,737 bytes | **139,824 bytes** |
| `reflect-edit/SKILL.md` | — | 23,539 bytes (19,545 moved + 3,994 of frontmatter/opening/invariants) |
| `reflect-corpus/SKILL.md` | — | 12,098 bytes (8,046 moved + 4,052 of the same) |

The drop is **27,913 bytes ≈ 6,340 tokens** at the issue's own measured ratio
(4,437 tokens / 19,545 bytes for the larger section), which clears the
≥ 6,000-token criterion. Pinned in `workspace-template.test.ts` as a
`< 145,000`-byte cap on the file, beside guards that both headings and the
"whose procedure lives in this skill" phrasing are gone.

### The 4K line (criterion 6)

`reflect-edit` lands at ~5,300 tokens — over INFRA-038's 4K error line, further
than the section's own 4,437 because a standalone skill pays for frontmatter, an
opening, and an inherited-invariants section (~900 tokens here, the same three
things the criterion licenses). It stays at that size **because this issue is a
move and the shrink is a text change**: AGENT-067 (already filed, blocked on
this issue) is the text-changing split, and the shrink belongs there. The
threshold was not touched (INFRA-038 has not landed an enforcer yet — nothing in
`scripts/` measures token budgets today). `reflect-corpus` is ~2,750 tokens,
between the warn and error lines.

### Upgrade propagation (edge case 1)

**`corpus upgrade` does propagate new template skills to existing workspaces —
nothing to file.** `apps/cli/src/template/plan.ts` → `decide()`: a path with no
manifest baseline and no workspace copy returns the `"install"` action, and
`writes()` includes `"install"` unconditionally. `corpus workspace upgrade`
(and the full `corpus upgrade`, which calls it) therefore writes the two new
skills into a pre-existing workspace and records them in the manifest.

### Post-Implementation Verification

Real workspace built from this worktree (`npm run build`, all workspaces
including UI, clean), `corpus init` on port 8973:

1. `corpus init <scratch>/ws-agent066 --port 8973` — "installed 28 template
   files" (was 26), both `reflect-edit/` and `reflect-corpus/` present under
   `.claude/skills/`.
2. `corpus doc list --type skill` shows both projected:
   `doc_skillreflectedit · Reflect edit` and
   `doc_skillreflectcorpus · Reflect corpus`, beside the four existing skills.
3. Real `doc.edited`: `corpus doc patch doc_seedtemplatenote --from user …`
   (exit 0, key printed), then after `EDIT_ACK_IDLE_MS` (180 s) the event
   appeared in `.corpus/queue/pending/`: `evt_2pgwwjtgiqd6`,
   `"type": "doc.edited"`, `"actor": "user"`, `"endedBy": "idle"`, both shas
   present, lane `orchestrator`. The routing row the orchestrator reads for it
   now says "A subagent applying the **reflect-edit** skill".
4. Real `workspace.reflect`: `corpus reflect` answered
   "reflecting — evt_kghfhppjpe5u, window since the beginning" and
   `.corpus/queue/pending/evt_kghfhppjpe5u.json` holds
   `"type": "workspace.reflect"`. Its row names **reflect-corpus**.
5. The dispatch itself is prose (the orchestrator reads the row and launches a
   subagent), so the verification is the events existing plus the rows naming
   the skills — no live `claude` run was made for this move. The moved
   procedure text is **byte-identical** to what left `orchestrate` (`cmp`
   against the pre-move extraction, both sections).
6. Server stopped cleanly (`stopped (pid 30184)`), port 8973 free.

### A pre-existing tension the move surfaced (for AGENT-067)

The moved procedures narrate the event's whole lifecycle: their worked examples
run `corpus queue complete evt_7c1d9a`, and the reflect-corpus prose says "fail
the event with the reason". Written inside `orchestrate` that read as the
loop's composite transcript; read by a dispatched subagent it instructs the
wrong party, and Delegation's boundary rule says a dispatched subagent never
settles. This tension predates the move — the old dispatch pasted the same text
into the subagent's prompt. The move does not rewrite the procedures, so the
new skills' *Inherited invariants* item 7 states the seam ("the settlement your
report leads to — not a call of yours") without touching the exemplars. Per
AGENT-062, an exemplar beats the rule beside it, so AGENT-067 — which does
change text — should re-voice those settlement lines for the subagent reader.

Tests: `scripts/workspace-template.test.ts` — **574 passed, 0 failed**, with
the procedure pins retargeted at the skills the text moved into. Prettier and
ESLint clean on every touched file. Pre-existing failure noted, not mine:
`packages/kit/src/weight/weightTransport.test.tsx` fails 2 tests on this
branch (`thread.digest` Zod union) with or without this change.

## Completion Checklist (domain agent)

- [x] Both event types verified working against the real app
- [x] Before and after sizes recorded
- [x] `/lint` passes _(ESLint + Prettier on every touched file. `tsc` is CI's;
      the touched TS file is covered by the passing vitest run.)_
- [x] E2E log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (touches the core loop — qualifies)
- [ ] `/evaluate` passes
- [ ] Committed with `[AGENT-066]` prefix
