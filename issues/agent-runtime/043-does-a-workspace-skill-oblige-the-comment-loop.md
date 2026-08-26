# [AGENT-043] Does a workspace skill covering a domain oblige the comment loop to apply it?

## Domain
agent-runtime

## Status
done

## Priority
P2

## Model
fable

## Dependencies
- Depends on: SHARED-067
- Related: AGENT-044 (which stopped on it rather than filling it)

## Spec References
- SPEC.md **§1** — *"a domain gets its shape from the templates, views and skills a workspace holds"* (SHARED-067)
- SPEC.md **§7** — skills as documents

## Summary

Raised by AGENT-044 and deliberately not answered there, which was right.

SHARED-067's replacement premise says a domain *"gets its shape from the
templates, views and skills a workspace holds"*. Read plainly, that says a
workspace skill covering a request should be applied.

**No skill text says so today.** `comment`'s *Routing directives* covers only the
**directed** case — a `/<skill>` on the turn, which the server parses into the
payload. *Skill genesis* only tells the agent to look for an existing skill when
it is about to codify a pattern. Nothing says "a skill exists for this, use it".

## Why it was not just written

Adding *"apply a workspace skill when one covers this request"* is **new
behaviour with a real cost**: a discovery step on every turn, in a loop whose
whole retrieval discipline is that the agent retrieves rather than enumerates
(§7). It would also need a rule for what happens when two skills both look
applicable.

**And it may already be covered.** Claude Code invokes skills from their own
frontmatter descriptions, so the runtime may do this without the skill text
saying anything — in which case writing it down would be a second mechanism
beside a working one, which is this repository's most-repeated defect.

## Decided 2026-08-25 (user, surveyed)

**The question is answered. This is now a write, not a question.**

### Decision 1 — it is the runtime's job, and no discovery step is added

The evidence for the issue's own first decision was found before asking.
`profile`'s description is already written as a trigger — *"Reach for this
whenever somebody asks for an agent of their own, in whatever words they use —
'make me a proofreader', 'I want an agent that keeps the finances straight'"* —
and `asd-ste100` carries an explicit `Triggers:` clause. The runtime invokes on
that text. So the mechanism exists and works, and writing a procedure beside it
would be the second-mechanism defect this repository repeats most.

Rejected: **discovery on every turn**, which buys the strongest reading of §1 and
pays for it with one listing per turn forever, in the loop whose whole discipline
is that the agent retrieves rather than enumerates (§7) — and which competes with
the runtime on the common path, so a skill fires for two reasons and neither can
be switched off. Rejected: **discovery as a fallback**, cheaper but still a second
mechanism, placed exactly where the runtime is least likely to have fired.
Rejected: **closing it**, because the risk it leaves is real — a user's skill
sitting in a workspace, never firing, with nothing saying why.

**The cost is stated rather than hidden**: the skill text cannot enforce this. If
the runtime stops invoking by description, the rule stops holding silently.

### Decision 2 — skill genesis requires a description that says *when*

The rule that makes decision 1 work. A description is not a summary; it is the
only text read when deciding whether to reach for the skill. `profile` is the
pattern to copy.

### Decision 3 — two applicable skills need no tie-break

It followed from decision 1 rather than being decided separately. The tie is the
runtime's to resolve, and a rule here would be a rule about a choice this loop
does not make.

### Decision 4 — the three loop skills are the exception (orchestrator's call)

`comment`, `orchestrate` and `converse` are invoked **by name** — `orchestrate`
invokes `comment`, and a person invokes the other two as `/orchestrate` and
`/converse th_…`. Nothing discovers them, so trigger text on them would apply a
rule where it does not bite. The requirement covers skills that must be *found*,
and skill genesis says so rather than leaving a reader to infer it. This was not
put to the user: it is a scoping call inside a decision already made.

## Acceptance Criteria
- [x] Decision 1 answered from observed behaviour, not assumption
- [ ] ~~`comment/SKILL.md` states it near *Routing directives*~~ — **moved**, see
      below. The body had four words of budget left
- [x] `comment/references/skill-genesis.md` requires a description that names
      **when** to reach for the skill, citing `profile` as the pattern, and
      exempts a skill invoked only by name
- [x] No discovery step, no tie-break rule, and no second mechanism beside the
      runtime's own invocation
- [x] The stated cost — that the skill text cannot enforce this — is written
      down where the rule is, not only in this issue

## E2E Verification Log
_[Agent fills — state the model]_
