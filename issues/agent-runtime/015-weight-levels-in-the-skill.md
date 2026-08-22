# [AGENT-015] Skill states the weight levels the picker reads, and honours a stated one

## Domain

agent-runtime

## Status

done

## Priority

P2 (nice-to-have)

## Model

opus

## Dependencies

- Depends on: **SHARED-022** (signed by the user 2026-08-06; all three amendments
  applied to SPEC.md — verified in place at §7's Orchestrator skill paragraph,
  §7's console bullet, and §10's "Smart input everywhere")
- Blocks: **UI-082** (the composer's picker reads its levels from the artefact
  this issue produces — do not build the picker against a hardcoded list)
- Related: **AGENT-018** (SHARED-023, todo) — the other half of §7's weight rule.
  018 governs how the orchestrator *judges* a weight when none was stated
  (consequence before difficulty, and stage-splitting); this issue governs what
  happens when one **was** stated. They edit the same section of the same file
  and should be sequenced rather than parallelised.

## Spec References

- SPEC.md **§7**, the **Orchestrator skill** paragraph — "**A request may choose
  the weight, and that choice is a directive.**" through "_(Rider signed
  2026-08-06.)_", including "choosing among the levels the skill itself defines"
  and the honour/deviate/disclose rules
- SPEC.md **§7**, the console bullet — "**A dispatch says what weight it went out
  at, and where that weight came from**"
- SPEC.md **§7** — "model names live in the skill, not here" (standing text, not
  amended by SHARED-022 and the reason the levels live here at all)
- SPEC.md **§10**, "Smart input everywhere" — the composer side, "from the levels
  the workspace's own agent guidance defines (§7), named as that guidance names
  them"
- SPEC.md **§2.4** — workspaces take template changes on their own schedule,
  which is why a level set cannot be pinned in code

## Summary

SPEC now says a request may state the weight its work is done at, and that the
levels on offer are **the ones the workspace's own orchestrator skill defines**.
The skill does define levels today — `assets/workspace/claude/skills/orchestrate/SKILL.md:232`
carries a three-row table (Small and mechanical → Haiku; Standard → Sonnet; Heavy
or judgment-laden → Opus 5) — but it defines them as *prose a model reads*, not
as a set anything else can read. Nothing can enumerate them, and the skill says
nothing about what to do with a weight the request already chose.

Two things follow, and both are this issue:

1. **The levels become a declared, readable set.** SHARED-022's Decision 1 is the
   whole reason the feature is more than a rename: "the offered choices are
   **read from the skill's own table**, not hardcoded into the UI. So editing the
   table changes both the routing *and* the picker, and the two can never
   disagree." A UI-side enum that happens to agree today is the failure mode
   being designed out — and it is the specific failure §2.4 guarantees, because
   a workspace on an older template would be offered levels its own skill does
   not implement.
2. **The skill honours a stated weight**, in its own voice, with the exclusions
   and the disclosure rule. Today its only guidance is "In doubt between two
   tiers, take the stronger" — a tie-break that, left unqualified, tells an agent
   to upgrade past an explicit instruction. SHARED-022's Decision 6 is explicit
   that this tie-break "governs only what the orchestrator chooses **for
   itself**, never what it does with an explicit instruction."

## The load-bearing property

**One source, read two ways.** The composer's picker and the orchestrator's
routing must be two readings of one artefact, exactly as `core/code.ts`'s
`fencedCodeRanges` and `unterminatedFence` are two readings of one scan
(SERVER-066). If they are two lists, they will disagree — not hypothetically, but
the first time a workspace edits its guidance, which is the *supported* way to
change routing (§7: skills are documents; SHARED-022's non-goals: "Not a
per-workspace setting panel — the durable half of the control is editing the
agent guidance document").

The skill is already reachable as a document: `.claude/skills` is watched and
projected (`apps/server/src/watcher/paths.ts:22`) and `skill` is a core document
type (`packages/contract/src/schemas/doc.ts:14`), so `GET /api/docs` already
returns it. The missing piece is that its levels are unparseable prose. This
issue makes them parseable **without** making them a schema — the artefact stays
a document a person can read, comment on, and edit in the app.

## Symmetry, stated because it is the part that gets dropped

A stated weight is honoured **in either direction**. Running *stronger* than asked
is the same defect as running weaker: it spends the person's budget against an
explicit instruction. SHARED-022, Decision 4: "The rule is stated as
substitution-in-either-direction, not as downgrade-protection." The skill must say
this in those terms, because an agent reading only "don't downgrade" plus "in
doubt take the stronger" will upgrade every time and believe it is being careful.

## Acceptance Criteria

- [x] The orchestrate skill's weight levels are stated in a form that can be
      **enumerated by a reader that is not a model** — a stable, parseable shape
      with, per level, a machine-usable key, the human name the composer displays,
      and the model it routes to
- [x] The levels remain **readable prose in a document**: a person opening the
      skill in the app still sees a table they can understand and edit, and the
      "what falls here" guidance survives
- [x] There is exactly **one** list. No second copy anywhere in
      `assets/workspace/`, and none in `apps/ui`, `packages/kit` or the contract
- [x] Renaming a level in the skill changes the name the composer offers, with no
      code change; adding a fourth level adds a fourth option
- [x] The skill states that **a stated weight is honoured, not weighed again** —
      the orchestrator dispatches at that weight rather than the one it would have
      picked
- [x] The skill states the prohibition **in both directions**, in those words:
      never quietly weaker, never quietly stronger
- [x] The existing tie-break ("In doubt between two tiers, take the stronger") is
      **scoped** to the orchestrator's own judgment, so it cannot be read as
      licence to upgrade past a stated weight
- [x] The skill states that **no stated weight means the orchestrator decides**,
      exactly as today — never a fixed default
- [x] The skill states the **unhonourable** path: the work is still done, at what
      the orchestrator judges best, and the deviation is stated **twice** — in the
      job's log while it runs, **and in the reply the request receives**, naming
      what was asked, that it could not be met, and what was used instead
- [x] The skill states that the choice **travels with the work**, not with the
      turn that received it — down through any further delegation
- [x] The skill's **dispatch log line** grammar names the weight **and where it
      came from** (stated by the request vs. judged by the orchestrator), and, when
      a stated one was not honoured, that fact and what ran instead — this is what
      §7's console bullet promises and what makes the feature testable by an
      evaluator reading SPEC alone
- [x] The skill states that disagreement is expressed **as speech, never as
      substitution**: work at the stated weight and say so in the reply; where
      proceeding would be expensive to unwind, ask first with a form

## Technical Design

### Files to Create/Modify

- `assets/workspace/claude/skills/orchestrate/SKILL.md` — the weight table
  (currently lines 229–240) and the dispatch-line grammar it already carries.
- Whatever tests pin the shipped workspace template's contents — locate before
  editing.

**Deliberately not modified here:** nothing in `apps/ui`, `packages/kit`,
`packages/contract` or `apps/server`. This issue produces the artefact; UI-082
consumes it. If consuming it turns out to need a route or a parse the server owns,
that is a **new contract/server issue** and must be escalated to the orchestrator
rather than absorbed here — see "The gap in the chain" below.

### Key Implementation Details

**Shape the levels so one artefact serves both readers.** The constraint pair is:
a model reads this file as instructions, and a program reads it to enumerate
options. The house solution for exactly this problem is already in the repo — a
fenced block with a declared info string, which `core/code.ts` masks and which
therefore cannot be confused with prose, plus the human table beside it. The
implementing agent should choose the concrete form, but it must satisfy: stable
to parse, obvious to a human editor, and **not duplicating** the guidance prose
(if the fence and the table can disagree, this issue has failed its own
acceptance criterion). Consider making the fence the source and the surrounding
prose the commentary, rather than two representations of the same facts.

**Order matters and is part of the contract.** The composer presents the levels in
some order; the skill's order is the one it should present. Lightest-first is what
the table does today.

**No preselection.** SHARED-022's non-goals: "Any implementation that preselects a
level for a person who has never chosen one has broken the feature's premise."
The artefact must not carry a "default" flag — absence of a choice is the
orchestrator's judgment (§7), which is a different thing from a level.

**Do not name models in SPEC, and do not move them out of the skill.** "Model
names live in the skill, not here" is standing signed text. The model ids stay in
this file and only in this file; the weight *keys* are what travel.

**Where AGENT-018 collides.** SHARED-023 (signed, applied) rewrote the same §7
paragraph to add consequence-before-difficulty judging and stage-splitting, and
AGENT-018 will edit this same table's surrounding guidance. Read
`issues/agent-runtime/018-consequence-and-splitting.md` before editing and
coordinate: 018 changes *how a weight is judged*, this issue changes *what the
levels are and what happens when one is stated*. The overlap is the tie-break
sentence, which both need to touch.

### The gap in the chain — flag for the orchestrator

SHARED-022's "Chain this implies" names three domains: agent-runtime (this
issue), **contract + server** ("a chosen level travels from a post to the queue
event and into the dispatch; a way for a composer to learn what levels this
workspace defines"), and ui (UI-082). **The contract and server issues do not
exist** — `issues/PLAN.md` carries no row for them, and a grep for weight-related
CONTRACT/SERVER issues returns nothing.

So the signed feature's chain is incomplete. This issue and UI-082 can be built
against the document as it is served by the existing `GET /api/docs` — the skill
is already a projected document — but a chosen weight has no way to reach the
queue event, which means UI-082's "the choice rides with the request" cannot be
satisfied by the UI alone. **The orchestrator should file the missing
contract/server issue before UI-082 starts**, or accept that UI-082 ships the
picker without the transport and is not evaluable end-to-end.

### Edge Cases

- **A workspace on an older template.** Its skill defines whatever levels it
  defines; the composer offers those. This is the case §2.4 makes normal, and it
  is the reason for the single source.
- **The skill's level block is malformed or missing** (hand-edited badly). The
  reader must degrade to "no levels offered" — the unset case, which is the
  ordinary behaviour — never to a hardcoded fallback list, which would be exactly
  the second source this issue forbids.
- **A level whose model the installed Claude Code does not provide.** This is the
  unhonourable path: do the work, disclose in the log and the reply.
- **A weight stated for work that enqueues nothing** (note-only). Nothing is
  dispatched, so nothing is governed; the skill need not handle it, and §10 makes
  it a presentation rule on the composer side.
- **A stated weight plus a targeted `@<subagent>`.** Both are directives (§8's
  "a directive, not a hint"); they compose — the named subagent runs at the stated
  weight.
- **Work split into stages** (SHARED-023 / AGENT-018). The prohibition on
  substituting in either direction binds the stages exactly as it binds the whole:
  a *material* stage may run lighter, a *deciding* stage runs at the governing
  weight — the stated one where a weight was stated.

## Testing Strategy

Skill text, so the automated surface is thin and the parse is the part worth
pinning:

- A test that reads the shipped `orchestrate/SKILL.md` and **enumerates the
  levels**, asserting the exact set and order the file declares. This is the test
  that makes "one source" real: it fails if the block is malformed, and it is the
  same reader UI-082 will use.
- A guard that no second level list exists — grep-shaped, over `apps/ui/src`,
  `packages/kit/src`, `packages/contract/src` and `assets/workspace/`.
- The packaging assertions over `assets/workspace/` still pass.
- If a test pins the skill's headings or required sections, extend it to require
  the honour/disclose rules rather than tolerate their absence.

## E2E Verification Plan

### Verification Steps

1. `corpus init` a scratch workspace on a non-default port; confirm the installed
   `.claude/skills/orchestrate/SKILL.md` carries the declared level set.
2. Start the real server. Confirm the skill is reachable as a document —
   `corpus doc list --type skill` and `corpus doc show <id>` — and that the level
   block round-trips through the projection intact.
3. Run the agent loop on an ordinary event with **no** weight stated. Expected:
   the dispatch line in the job's log names an orchestrator-judged weight, exactly
   as it does today, and nothing was preselected.
4. Dispatch an event whose request states a **light** weight for work the
   orchestrator would judge heavy. Expected: the work runs light, the dispatch
   line names the light level **and** that the request stated it, and no upgrade
   appears anywhere. Read the log with `corpus job log <eventId>`.
5. The mirror: a **heavy** weight stated for trivial work. Expected: no downgrade,
   same disclosure. This is the direction that is easy to get wrong.
6. **Rename a level in the skill** through the app (edit the skill document), then
   dispatch again. Expected: the dispatch line uses the new name, with no code
   change and no restart-dependent behaviour.
7. **Remove a level** the request states. Expected: the work still completes, the
   log records that the stated level was not honoured and what ran, **and the
   reply says so too** — verified by reading the turn on disk, since the log is
   reaped and the reply is the durable half.
8. Confirm the skill's own file is the only place the level names appear
   (repo-wide grep).

## E2E Verification Log

implemented on: **opus** (Opus 5, 1M context), 2026-08-08.

### The declared shape

The tier table in `## Delegation` **is** the declaration — it gained a `Key`
column and nothing else was duplicated beside it, so there is exactly one list
and no fence that could disagree with a table. It is identified by its **header
cells**, not by its raw line, because the template tree is in `.prettierignore`
and the padding is hand-maintained:

| Weight | Key | Model | What falls here |
| --- | --- | --- | --- |

- **Weight** — the name a composer displays. Reword it and the picker follows.
- **Key** — the token that travels on the request's `weight` field; survives a
  rename of the Weight cell, so a stored choice still resolves.
- **Model** / **What falls here** — for the agent; neither reaches a composer.

Shipped set, lightest first: `Small and mechanical`/`light`/Haiku,
`Standard`/`standard`/Sonnet, `Heavy or judgment-laden`/`heavy`/Opus 5.

The reference reader is `readWeightLevels()` in `scripts/workspace-template.ts`
(repo tooling, not shipped). It returns `[]` — never a partial or fallback set —
when the header cells are not spelled exactly, when the divider row is missing,
when a row has the wrong cell count, or when a row's Weight or Key is blank.

### Post-Implementation Verification

Workspace `/tmp/agent015-ws`, port **9077** (8765 and 5173 untouched), server
started and stopped through `corpus server start|stop`, workspace and scratch
scripts removed afterwards; `lsof -iTCP:9077 -sTCP:LISTEN` empty at teardown.

1. **`corpus init` installs the declaration.** `corpus init /tmp/agent015-ws
   --port 9077` → "installed 8 template files". `.claude/skills/orchestrate/SKILL.md:281`
   carries `| Weight | Key | Model | What falls here |` with the three rows.
2. **It round-trips through the projection.** `corpus doc list --type skill` →
   `doc_skillorchestrate  skill  open  Orchestrate  .claude/skills/orchestrate/SKILL.md`.
   `GET /api/docs/doc_skillorchestrate` (the route UI-082 reads) returned a body
   the reference reader enumerated as, verbatim:
   `[{"name":"Small and mechanical","key":"light","model":"Haiku"},{"name":"Standard","key":"standard","model":"Sonnet"},{"name":"Heavy or judgment-laden","key":"heavy","model":"Opus 5"}]`
3. **Rename through the app, no code change.** The projected body was edited via
   `corpus doc edit doc_skillorchestrate --from user` with `Standard` → `Everyday`.
   Re-fetching gave `…{"name":"Everyday","key":"standard",…}` — the offered name
   moved, the key did not, which is what keeps yesterday's choice resolvable.
4. **Remove a level.** Same path, `Heavy or judgment-laden` row deleted. The
   fetch then enumerated **two** levels. Adding a fourth is covered by fixture in
   `scripts/workspace-template.test.ts` ("follows a rename and a fourth level").
5. **A workspace that declares nothing.** Header cell `Key` renamed to `Tier`
   through the same edit → the live fetch enumerated `[]`. This is the §2.4
   older-template case, and it degrades to *no control*, never a fallback list.
6. **A stated weight really arrives where the skill says it does.**
   `POST /api/threads {"body":"@agent please tidy the inbox.","weight":"light"}`
   (CONTRACT-039 / SERVER-069, on this branch) produced
   `.corpus/queue/pending/evt_e6ipufq2jkfl.json` whose payload is
   `{"threadId":"th_wq32vnql","parentId":null,"turnTs":…,"mentions":[],"skills":[],"unresolved":[],"weight":"light"}`
   — the `weight` field carrying a **Key**, exactly as the skill now instructs the
   agent to read it. The job log already held, before any dispatch line could
   exist: `{"source":"server","line":"weight stated by the request: light"}` —
   which is the independent record the skill's fourth dispatch shape is checked
   against.
7. **Guards.** `npx vitest run scripts/workspace-template.test.ts` →
   **184 passed**, including AGENT-018's whole `weighing a dispatch` block
   unmodified, the exact 16-section count, and the >400-char rule. eslint and
   prettier clean on both touched TypeScript files; `tsc --noEmit -p
   scripts/tsconfig.json` clean.

**Not done here, and flagged instead:** the loop was not driven by a live
`claude` session, so the *dispatch lines themselves* are pinned by skill-text
assertions rather than observed in a running orchestrator — the four shapes are
prose the agent emits, and there is no producer for them outside a real session.
Steps 4/5 of the plan (stated-light / stated-heavy dispatch lines) are
consequently evidenced at the transport and grammar level, not at the console.

**One cross-domain mismatch, for the orchestrator.**
`packages/contract/src/schemas/weight.ts`'s `REQUESTED_WEIGHT_DESCRIPTION` says
the value is "a **level name** from the workspace's own agent guidance,
**verbatim**", and `apps/server/src/jobs/weight.ts`'s worked comment shows
`weight stated by the request: Small and mechanical`. This issue declares the
travelling token to be the **Key**, per the acceptance criterion asking for "a
machine-usable key, the human name the composer displays, and the model it routes
to". Nothing breaks — the field is an opaque, shape-validated string and both
values pass — but the contract's published description and that comment should be
corrected to say "the level's key" by contract-dev/server-dev. Not edited here:
out of domain.

## Non-goals

From SHARED-022, so the implementation cannot drift:

- **No model names in SPEC.md.**
- **No default model.** Unset means the orchestrator decides.
- **No silent substitution, in either direction.**
- **No new turn format** — the choice is request-time, not a property of a turn on
  disk.
- **No CLI flag.** `corpus thread reply` and the agent-facing verbs are how the
  agent writes, not how a person picks a weight.
- **Not a budget, quota or cost feature.** Nothing counts, caps, reports or bills
  tokens.
- **No retroactive anything.** Work already dispatched is unaffected.
- **Not a settings panel.** Editing the guidance document *is* the durable
  control.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier on the touched TypeScript; the template
      tree is `.prettierignore`d by design)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[AGENT-015]` prefix
