# [SHARED-050] The product agent's register is controlled language

## Domain

shared

## Status

todo — **NEEDS USER SIGN-OFF.** Drafted 2026-08-18, not applied. SPEC.md changes
are the user's.

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Blocks: AGENT-037 (which ships the behaviour this sentence describes)
- Related: SHARED-049 (§7's skill enumeration — a separate rider, deliberately)

## Spec References

- SPEC.md **§8** lines 405-413 — agent participation semantics. Every bullet
  there governs **whether** and **where** the agent replies. None governs **how
  it writes**, which is the gap.
- SPEC.md **§7** line 129 — the shipped skill set, which SHARED-049 owns

## Summary

The user directed on 2026-08-18 that the ASD-STE100 controlled-language skill be
installed by default and applied to everything the agent writes. AGENT-037 ships
that behaviour. **No SPEC sentence describes it**, and how the agent writes to a
person is product behaviour a user notices immediately.

This is filed as its own rider rather than folded into SHARED-049. Both touch
what a workspace's agent is, and both were found in the same week, which is
exactly the pairing that went wrong before: batching riders is how a live §4/§7
contradiction stayed hidden through a sign-off. One rider, one release, read back
verbatim.

## Why a spec sentence and not just a skill

A skill is a file in a workspace, and a user can delete it. The register is not
an implementation detail of one skill — it is a promise about what reading Corpus
feels like, and it constrains every future surface that emits text. Without a
SPEC sentence, the next agent-facing feature has no reason to follow it, and the
rule decays to whichever skills happen to mention it.

There is also a real cost to state, and a spec is where a cost gets stated rather
than discovered. The skill itself warns against applying STE where voice is the
point. The user chose everything the agent writes, thread replies included, so
replies to a person about their own document will read flatter than they do now.
That is the user's call, made knowingly, and the sentence should not pretend the
trade does not exist.

## The drafted text — read this back verbatim before applying

Insert as a new bullet at the end of **§8**, after line 413:

> - **The agent writes to be read once.** Every text the agent produces for a
>   person — a thread reply, a comment answer, a status line, a job log, a
>   refusal — follows the controlled-language rules of the workspace's
>   `asd-ste100` skill: active voice, one instruction per sentence, no
>   semicolons, no phrasal verbs, no nominalization, no adjectives that claim
>   quality instead of showing it, and a list wherever a sequence would otherwise
>   be buried in prose. **A hedge keeps its strength** — "may have failed" never
>   becomes "failed", because a shorter sentence that promotes a hedge to a fact
>   is a different claim, and a length cap is exactly what tempts an author to cut
>   one. This governs the agent's **own prose and never what it quotes**: a
>   passage from a document, an error the server returned, a command's output, and
>   a person's own words all reach the reader unchanged. The rule is about one
>   reading and not about fewer words — the agent stops when a sentence has a
>   single possible meaning, not when it is shortest. The cost is accepted rather
>   than denied: a reply written this way is flatter than one written for voice,
>   and a conversation about a person's own document is where that is felt.
>   _(Rider signed 2026-08-__.)_

## What the sign-off decides

1. Whether §8 is the right home. The alternative is §7, next to the skill set —
   rejected in the draft because §7 describes what a workspace **contains** and
   §8 describes how the agent **behaves**, and this is behaviour.
2. Whether the rule names the skill (`asd-ste100`) or describes the discipline
   without naming a file. Naming it makes the sentence checkable and couples the
   spec to a vendored third-party file. **The draft names it**, on the grounds
   that an unnamed "write clearly" sentence is unenforceable.
3. Whether the accepted-cost sentence stays. It is unusual for this spec to admit
   a downside in the normative text. Keeping it is deliberate.

## Acceptance Criteria

- [ ] The user has signed the drafted text, verbatim
- [ ] SPEC.md §8 carries the signed sentence and nothing beyond it
- [ ] No other §8 bullet is reworded to agree with it
- [ ] `npm run spec:check` passes — the bullet cites §7 and must name a real
      section (INFRA-029)
- [ ] If it is **not** signed before v0.13.0 ships, the release notes say plainly
      that the behaviour ships and the spec does not yet describe it

## Technical Design

### Files to Create/Modify

- `SPEC.md` — §8 only

### Key Implementation Details

Quote rather than paraphrase when reading it back. Paraphrase is how §9.2 and §4
came to disagree (SHARED-045).

Apply only what is signed. A partial signature applies the signed part, and the
unsigned part stays in this file.

## Testing Strategy

`npm run spec:check` covers the cross-reference. There is nothing else to test:
this is a normative sentence, and AGENT-037 carries the behaviour and its pins.

## E2E Verification Plan

### Verification Steps

1. `git diff SPEC.md` shows exactly the signed text and nothing else
2. `npm run spec:check` passes

## E2E Verification Log

_[Filled after sign-off]_

## Completion Checklist (domain agent)

- [ ] N/A — orchestrator-applied after sign-off

## Completion Checklist (orchestrator)

- [ ] Committed with `[SHARED-050]` prefix
