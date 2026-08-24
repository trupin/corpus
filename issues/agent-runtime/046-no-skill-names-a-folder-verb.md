# [AGENT-046] No skill names a `corpus folder` verb, so the agent reorganizes a folder one document at a time

## Domain

agent-runtime

## Status

done

## Priority

P2 (normal)

## Model

opus

## Dependencies

- Related: AGENT-045 (found this while correcting the same shape for `corpus board order`)

## Spec References

- SPEC.md **§9.2** — the directory-level acts
- SPEC.md **§4** — one act, one auto-commit

## Summary

Found while implementing AGENT-045, and deliberately not fixed there.

`docs/cli.md` documents four folder verbs — `corpus folder archive`, `corpus folder
unarchive`, `corpus folder rename` and `corpus folder delete`. Each is a bulk act, each
names every document it changed, and each "lands as the single auto-commit §4 requires".

`grep -rn "corpus folder" assets/workspace/` returns **nothing**. No skill names any of
them, in any register.

This is the exact shape AGENT-045 corrected for `corpus board order`: a verb that exists so
one act is one commit, and skill text that leaves the agent to spell that act as a loop of
per-document writes. The stewardship charter in `orchestrate/SKILL.md` points straight at
it — _"Obsolete documents are archived"_, _"Misfiled documents are moved (`corpus doc
move`)"_ — and both rules are written per document. An agent asked to retire a `finance/`
folder follows them into N `corpus doc archive` calls, whose commit story is whatever §4's
30-second window happens to make of them. `orchestrate/SKILL.md` already contemplates the
act it gives no verb for: its concurrency rules speak of _"a folder one event reorganizes
while another files into"_ it.

## The question this issue has to answer

**Is a folder act something the agent should be initiating at all?** The charter says the
agent moves a misfiled document and archives an obsolete one, both bounded acts on one
document that a reply can state in a line. A folder act is bounded by nothing the agent
chose — `corpus folder archive finance` archives every document and thread under it,
including ones the request never named. That may be exactly why no skill names one.

So the answer is not automatically "add the verbs to the stewardship list". It may be:

- name them, with the rule that a folder act is proposed in a reply and never started
  quietly (the same shape the charter already uses for a recurring sweep), or
- name only `corpus folder rename`, the one act that changes no status and loses nothing, or
- say outright that folder acts are the user's, which is what the silence means today and
  what nothing currently writes down.

`corpus folder delete` is user-only at the CLI, so that one is already decided.

## Decided by the user, 2026-08-23 — add the verbs, bounded

**Chosen: bounded adoption.** The skills use `corpus folder archive|unarchive|
rename|delete` **only where the folder is what the person named** — someone
asking for a folder to be archived, moved or renamed.

**Bulk stewardship the agent decided on its own stays per document.** The
charter's "obsolete documents are archived" and "misfiled documents are moved"
keep their per-document form, because the agent chose those documents and must
be able to name each one.

**Why it won.** A folder act is bounded by nothing the agent chose. `corpus
folder archive finance` archives every document and thread under it, including
ones nobody mentioned. The saving is real and the blast radius is the reason the
silence existed — bounding by *who named the folder* keeps the saving where the
scope was given to the agent rather than assumed by it.

**Rejected: add them plainly.** Cheapest in tokens and it lets an agent judgment
sweep up documents nobody named.

**Rejected: leave the silence.** The user declined. It is slower, more
expensive, and it leaves a real defect — the board-order shape, one level up —
in place for the case where a person really did say "archive this folder".

**Write the boundary into the skill as a rule, not as an example.** An example
of the safe case is not a rule against the unsafe one.

## Acceptance Criteria

- [x] The skills say what an agent may do at folder level, rather than saying nothing
- [x] Any folder verb a skill names is verified against a real build before the text ships
- [x] The stewardship charter and whatever this issue decides do not contradict each other
- [x] `scripts/workspace-template.test.ts` resolves every new invocation

## Testing Strategy

The template guard resolves `corpus …` invocations against `docs/cli.md` already. A decision
to keep folder acts out of the agent's hands needs its own assertion, in the style of
AGENT-045's `profile` clause — a recorded decision fails loudly when somebody reverses it by
accident.

## E2E Verification Log

_Implementing agent: agent-runtime-dev on **claude-fable-5**, 2026-08-23._

### What shipped

The decision, written in as a **rule** in the two places the two halves bind:

- `comment/SKILL.md` → *Doing the work* gains the bullet **"Act on a whole folder only where
  the folder is what the person named."** It names `corpus folder archive|unarchive|rename`
  for the person-named case, says the bulk act reaches documents the request never mentioned
  (read the printed list back, state the count in the reply), states the other half — where
  **you** picked the documents, stay per document, because you chose them and must be able to
  name each one; a folder verb never inherits that judgment — and keeps `corpus folder
  delete` the user's, with the archive detour.
- `orchestrate/SKILL.md` → *Stewardship* gains **"A folder verb serves a request that named
  the folder, and it never serves this charter,"** so the charter's per-document bullets
  cannot be read as an invitation to bulk acts. Distinct wording from the comment copy on
  purpose; the shingle detector stays green with no new STATED_TWICE entry.

### Verified against a real build (CLI 0.20.0, scratch workspace, port 8931/8932)

- `corpus folder archive probe --from agent` → per-document status lines +
  `archived probe — 1 document`, exit 0. `unarchive` and `rename probe probe2` likewise.
- `corpus folder delete inbox --from agent` → refused before any request, exit **2**:
  "deleting a folder is user-only — the agent archives, never deletes", naming
  `corpus folder archive` — exactly what the skill now says.
- **Live loop event** (real `claude -p --model sonnet` subagent, transcript
  `scratchpad/audit/e2e-evt2-transcript.jsonl`): a standalone ask "archive the taxes-2024
  folder" was worked with **one** `corpus folder archive taxes-2024 --from agent` — no
  per-document loop — landing as the single commit
  `folder archive: data/docs/taxes-2024 (2 documents) by agent`, with both documents named
  in the job log and in the reply.

### Guard

New describe `folder acts are bounded by who named the folder (AGENT-046)` in
`scripts/workspace-template.test.ts` pins the boundary sentences in both skills (as rules,
with `wrapped()` so re-wraps do not kill them) and the delete refusal claim; the existing
template-wide invocation resolver checks every `corpus folder …` spelling against
`docs/cli.md` with no change. 486/486 tests pass.
