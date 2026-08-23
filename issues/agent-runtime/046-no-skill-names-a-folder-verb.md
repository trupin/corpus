# [AGENT-046] No skill names a `corpus folder` verb, so the agent reorganizes a folder one document at a time

## Domain

agent-runtime

## Status

todo

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

## Acceptance Criteria

- [ ] The skills say what an agent may do at folder level, rather than saying nothing
- [ ] Any folder verb a skill names is verified against a real build before the text ships
- [ ] The stewardship charter and whatever this issue decides do not contradict each other
- [ ] `scripts/workspace-template.test.ts` resolves every new invocation

## Testing Strategy

The template guard resolves `corpus …` invocations against `docs/cli.md` already. A decision
to keep folder acts out of the agent's hands needs its own assertion, in the style of
AGENT-045's `profile` clause — a recorded decision fails loudly when somebody reverses it by
accident.

## E2E Verification Log

_[Agent fills — state the model]_
